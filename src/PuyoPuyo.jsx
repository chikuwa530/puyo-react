

// Puyo Puyo - シンプルだけどルールに沿った実装
// - フィールド: 縦12×横6（画面外に上方向1マス許容）
// - 組ぷよは縦向きで上に1マス分はみ出して生成される
// - 色数は3〜5で設定可能
// - 回転・左右移動・高速落下・ハードドロップ
// - ネクスト表示
// - 固定後は「ぶら下がりぷよ」を落下させてから消去判定（説明のルールに合わせる）
// - 4個以上で消去、同時消去は1連鎖扱い、消去毎に連鎖としてカウント
// - 窒息（ゲームオーバー）は固定化の結果、画面外（上方向）にぷよが残る/生成位置がふさがっていると判定

const COLS = 6;
const ROWS = 12;
const MIN_COLORS = 3;
const MAX_COLORS = 5;

// change this to 3..5 to match rule
const COLOR_COUNT = 5;
const COLOR_PALETTE = ["red", "green", "blue", "yellow", "purple"];
const COLORS = COLOR_PALETTE.slice(0, Math.min(Math.max(COLOR_COUNT, MIN_COLORS), MAX_COLORS));

function randColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

function makeEmptyGrid() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function cloneGrid(g) {
  return g.map(row => row.slice());
}

export default function PuyoPuyo() {
  const [grid, setGrid] = useState(makeEmptyGrid());
  const [active, setActive] = useState(null); // {parts: [{r,c,color},{r,c,color}]}  r can be -1 (above screen)
  const [nextPair, setNextPair] = useState([randColor(), randColor()]);
  const [gameOver, setGameOver] = useState(false);
  const [score, setScore] = useState(0);
  const [chainCount, setChainCount] = useState(0);
  const gravityRef = useRef(800);
  const tickRef = useRef(null);
  const keysRef = useRef({});

  // spawn at r = -1 (top part) and r = 0 (bottom part), same column (vertical)
  function spawnPair() {
    const colors = nextPair;
    const mid = Math.floor(COLS / 2) - 1;
    const pair = {
      parts: [
        { r: 0, c: mid, color: colors[0] },
        { r: -1, c: mid, color: colors[1] },
      ],
    };
    setNextPair([randColor(), randColor()]);
    // if spawn collides immediately with existing puyos (including above-screen), game over
    if (!canPlace(pair, grid)) {
      setGameOver(true);
      setActive(null);
    } else setActive(pair);
  }

  // lock active into grid, return new grid and whether any part was above screen (overflow)
  function lockActive(g, a) {
    const ng = cloneGrid(g);
    let overflow = false;
    for (const p of a.parts) {
      if (p.r < 0) { overflow = true; continue; }
      if (p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS) ng[p.r][p.c] = p.color;
    }
    return { ng, overflow };
  }

  // test placement: parts may have r < 0 (allowed), but c must be in bounds and r cannot be >= ROWS or collide when r>=0
  function canPlace(a, g) {
    for (const p of a.parts) {
      if (p.c < 0 || p.c >= COLS) return false;
      if (p.r >= ROWS) return false;
      if (p.r >= 0 && g[p.r][p.c]) return false;
    }
    return true;
  }

  // move/rotate active
  function moveActive(dr, dc, rotation = 0) {
    if (!active) return;
    const newA = { parts: active.parts.map(p => ({ ...p })) };
    if (rotation !== 0) {
      const base = newA.parts[0];
      const other = newA.parts[1];
      const relR = other.r - base.r;
      const relC = other.c - base.c;
      let nrel;
      if (rotation === 1) nrel = { r: -relC, c: relR };
      else nrel = { r: relC, c: -relR };
      other.r = base.r + nrel.r;
      other.c = base.c + nrel.c;
    }
    for (const p of newA.parts) { p.r += dr; p.c += dc; }
    if (canPlace(newA, grid)) setActive(newA);
    else {
      // wall kicks for rotation
      if (rotation !== 0) {
        for (const kick of [-1, 1, -2, 2]) {
          const kicked = { parts: newA.parts.map(p => ({ ...p })) };
          for (const p of kicked.parts) p.c += kick;
          if (canPlace(kicked, grid)) { setActive(kicked); return; }
        }
      }
    }
  }

  // single gravity tick for active
  function stepDown() {
    if (!active) return;
    const candidate = { parts: active.parts.map(p => ({ ...p, r: p.r + 1 })) };
    if (canPlace(candidate, grid)) { setActive(candidate); }
    else {
      // lock and then apply post-lock falling + resolve
      const { ng, overflow } = lockActive(grid, active);
      setGrid(ng);
      setActive(null);
      // if any locked part was above screen, that's a game over (窒息に近い判定)
      if (overflow) { setTimeout(() => setGameOver(true), 10); return; }
      // after locking, force any single hanging puyos to fall before checking clears (ルールに合わせる)
      setTimeout(() => postLockGravityAndResolve(ng), 10);
    }
  }

  function hardDrop() {
    if (!active) return;
    let candidate = { parts: active.parts.map(p => ({ ...p })) };
    while (true) {
      const down = { parts: candidate.parts.map(p => ({ ...p, r: p.r + 1 })) };
      if (canPlace(down, grid)) candidate = down;
      else break;
    }
    const { ng, overflow } = lockActive(grid, candidate);
    setGrid(ng);
    setActive(null);
    if (overflow) { setTimeout(() => setGameOver(true), 10); return; }
    setTimeout(() => postLockGravityAndResolve(ng), 10);
  }

  // apply gravity so any puyo with empty below falls (single-piece fall) until stable, then resolve chains
  function postLockGravityAndResolve(startGrid) {
    let g = cloneGrid(startGrid);
    // apply gravity until no change
    while (true) {
      let changed = false;
      for (let c = 0; c < COLS; c++) {
        let write = ROWS - 1;
        for (let r = ROWS - 1; r >= 0; r--) {
          if (g[r][c]) { g[write][c] = g[r][c]; if (write !== r) { g[r][c] = null; changed = true; } write--; }
        }
        while (write >= 0) { g[write][c] = null; write--; }
      }
      if (!changed) break;
    }
    // now resolve deletions and chain reactions
    resolveChains(g);
  }

  // resolve groups of 4+ repeatedly and count chains
  function resolveChains(startGrid) {
    let g = cloneGrid(startGrid);
    let totalCleared = 0;
    let chains = 0;
    while (true) {
      const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
      const toClear = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
      let foundAny = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (g[r][c] && !visited[r][c]) {
            const color = g[r][c];
            const q = [[r, c]];
            visited[r][c] = true;
            const group = [[r, c]];
            while (q.length) {
              const [cr, cc] = q.shift();
              const neigh = [[cr-1,cc],[cr+1,cc],[cr,cc-1],[cr,cc+1]];
              for (const [nr, nc] of neigh) {
                if (nr>=0 && nr<ROWS && nc>=0 && nc<COLS && !visited[nr][nc] && g[nr][nc] === color) {
                  visited[nr][nc] = true;
                  q.push([nr,nc]);
                  group.push([nr,nc]);
                }
              }
            }
            if (group.length >= 4) {
              foundAny = true;
              for (const [gr, gc] of group) toClear[gr][gc] = true;
            }
          }
        }
      }
      if (!foundAny) break;
      let clearedThis = 0;
      for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (toClear[r][c]) { g[r][c] = null; clearedThis++; }
      totalCleared += clearedThis;
      chains += 1;
      // after clear, apply gravity (pieces above fall)
      for (let c=0;c<COLS;c++) {
        let write = ROWS-1;
        for (let r=ROWS-1;r>=0;r--) {
          if (g[r][c]) { g[write][c] = g[r][c]; if (write!==r) g[r][c] = null; write--; }
        }
        while (write>=0) { g[write][c] = null; write--; }
      }
    }

    if (totalCleared > 0) {
      // simple scoring: base points times chain multiplier
      const chainMultiplier = 1 + (chains - 1) * 0.5; // 1.0, 1.5, 2.0 ...
      setScore(s => s + Math.floor(totalCleared * 10 * chainMultiplier));
      setChainCount(ch => ch + chains);
      setGrid(g);
      // spawn next after a delay
      setTimeout(() => {
        // spawn blocked if top area (r=0 or r=-1 area) is occupied at spawn position
        const spawnBlocked = g[0].some(cell => cell !== null);
        if (spawnBlocked) { setGameOver(true); setActive(null); }
        else spawnPair();
      }, 350);
    } else {
      // no clears -> just spawn next
      setGrid(g);
      const spawnBlocked = g[0].some(cell => cell !== null);
      if (spawnBlocked) { setGameOver(true); setActive(null); }
      else spawnPair();
    }
  }

  // input handling
  useEffect(() => {
    function onKeyDown(e) {
      if (gameOver) return;
      if (keysRef.current[e.code]) return;
      keysRef.current[e.code] = true;
      if (e.code === "ArrowLeft") moveActive(0, -1);
      else if (e.code === "ArrowRight") moveActive(0, 1);
      else if (e.code === "ArrowDown") stepDown();
      else if (e.code === "ArrowUp") moveActive(0, 0, 1);
      else if (e.code === "Space") hardDrop();
    }
    function onKeyUp(e) { delete keysRef.current[e.code]; }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, [active, grid, gameOver]);

  // gravity loop
  useEffect(() => {
    if (gameOver) return;
    if (!active) return;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => { stepDown(); }, gravityRef.current);
    return () => clearInterval(tickRef.current);
  }, [active, grid, gameOver]);

  // start
  useEffect(() => {
    setGrid(makeEmptyGrid());
    setScore(0);
    setChainCount(0);
    setGameOver(false);
    setNextPair([randColor(), randColor()]);
    setTimeout(() => spawnPair(), 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // overlay active
  const displayGrid = cloneGrid(grid);
  if (active) {
    for (const p of active.parts) {
      if (p.r >= 0 && p.r < ROWS && p.c >= 0 && p.c < COLS) displayGrid[p.r][p.c] = p.color;
    }
  }

  function resetGame() {
    setGrid(makeEmptyGrid());
    setActive(null);
    setNextPair([randColor(), randColor()]);
    setScore(0);
    setChainCount(0);
    setGameOver(false);
    setTimeout(spawnPair, 200);
  }

  return (
    <div className="p-4 flex flex-col items-center gap-4">
      <h1 className="text-2xl font-bold">ぷよぷよ - ルール準拠版</h1>
      <div className="flex gap-6">
        <div>
          <div className="grid grid-cols-6 gap-1 p-1 bg-slate-800 rounded" style={{ width: 6 * 40 + 6 * 4 }}>
            {displayGrid.map((row, r) => row.map((cell, c) => (
              <div key={`${r}-${c}`} className={`w-10 h-10 rounded flex items-center justify-center border border-slate-700 ${cell ? "shadow-inner" : "bg-slate-900"}`}>
                {cell && (
                  <div className={`w-8 h-8 rounded-full ${cell === 'red' ? 'bg-red-500' : ''} ${cell === 'green' ? 'bg-green-500' : ''} ${cell === 'blue' ? 'bg-blue-500' : ''} ${cell === 'yellow' ? 'bg-yellow-400' : ''} ${cell === 'purple' ? 'bg-purple-500' : ''}`} />
                )}
              </div>
            )) )}
          </div>
          <div className="mt-2 text-sm text-slate-300">Controls: ← → (move) ↑ (rotate) ↓ (soft drop) Space (hard drop)</div>
        </div>

        <div className="w-48 flex flex-col gap-3">
          <div className="p-3 bg-slate-900 rounded shadow">
            <div className="text-sm text-slate-400">Next</div>
            <div className="mt-2 flex gap-2">
              {nextPair.map((col, i) => (
                <div key={i} className="w-10 h-10 rounded-full flex items-center justify-center border border-slate-700">
                  <div className={`w-8 h-8 rounded-full ${col === 'red' ? 'bg-red-500' : ''} ${col === 'green' ? 'bg-green-500' : ''} ${col === 'blue' ? 'bg-blue-500' : ''} ${col === 'yellow' ? 'bg-yellow-400' : ''} ${col === 'purple' ? 'bg-purple-500' : ''}`} />
                </div>
              ))}
            </div>
          </div>

          <div className="p-3 bg-slate-900 rounded shadow">
            <div className="text-sm text-slate-400">Score</div>
            <div className="text-xl font-mono">{Math.floor(score)}</div>
          </div>

          <div className="p-3 bg-slate-900 rounded shadow">
            <div className="text-sm text-slate-400">Chains (累計)</div>
            <div className="text-xl font-mono">{chainCount}</div>
          </div>

          <div className="p-3 bg-slate-900 rounded shadow flex gap-2">
            <button className="px-3 py-1 rounded bg-blue-600" onClick={() => { if (!active && !gameOver) spawnPair(); }}>Start / Resume</button>
            <button className="px-3 py-1 rounded bg-red-600" onClick={resetGame}>Reset</button>
          </div>

          {gameOver && (
            <div className="p-3 bg-red-900 text-white rounded">Game Over</div>
          )}
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-400">ルールに合わせて「固定後の個別落下（ぶら下がり落下）」と消去判定の順序を実装しました。色数は3〜5で調整可能です。</div>
    </div>
  );
}
