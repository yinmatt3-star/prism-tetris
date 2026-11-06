/* Prism · 俄罗斯方块 — 游戏核心逻辑（无 DOM 依赖） */
(function (global) {
  'use strict';

  const COLS = 10;
  const ROWS = 20;
  const HIDDEN = 4;
  const TOTAL = ROWS + HIDDEN;
  const LOCK_DELAY = 500;
  const MAX_LOCK_RESETS = 15;
  const CLEAR_MS = 220;

  const PIECES = {
    I: { color: '#5AC8FA', matrix: ['....', '####', '....', '....'] },
    J: { color: '#0A84FF', matrix: ['#..', '###', '...'] },
    L: { color: '#FF9F0A', matrix: ['..#', '###', '...'] },
    O: { color: '#FFD60A', matrix: ['##', '##'] },
    S: { color: '#30D158', matrix: ['.##', '##.', '...'] },
    T: { color: '#BF5AF2', matrix: ['.#.', '###', '...'] },
    Z: { color: '#FF453A', matrix: ['##.', '.##', '...'] },
  };

  const TYPES = ['I', 'J', 'L', 'O', 'S', 'T', 'Z'];

  function rotateMatrix(rows) {
    const n = rows.length;
    const out = [];
    for (let y = 0; y < n; y++) {
      let line = '';
      for (let x = 0; x < n; x++) line += rows[n - 1 - x][y];
      out.push(line);
    }
    return out;
  }

  function cellsOf(rows) {
    const cells = [];
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        if (rows[y][x] === '#') cells.push([x, y]);
      }
    }
    return cells;
  }

  // Pre-compute the four SRS rotation states for every piece.
  const ROT = {};
  for (const type of TYPES) {
    const states = [];
    let m = PIECES[type].matrix;
    for (let r = 0; r < 4; r++) {
      states.push({ cells: cellsOf(m), size: m.length });
      m = rotateMatrix(m);
    }
    ROT[type] = states;
  }

  // SRS wall kicks. Values use "y up"; the engine converts to screen space.
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };

  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };

  const CLEAR_SCORE = [0, 100, 300, 500, 800];
  const TSPIN_SCORE = [400, 800, 1200, 1600];
  const TSPIN_MINI_SCORE = [100, 200, 400, 0];

  // Spawn column offsets keep pieces visually centred on the 10-wide field.
  const SPAWN_X = { I: 3, J: 3, L: 3, O: 4, S: 3, T: 3, Z: 3 };

  class Tetris {
    constructor(options) {
      this.options = options || {};
      this.onEvent = this.options.onEvent || function () {};
      this.reset(true);
    }

    emit(type, data) {
      try {
        this.onEvent(type, data || {});
      } catch (err) {
        /* never let a listener break the simulation */
      }
    }

    reset(silent) {
      this.grid = [];
      for (let y = 0; y < TOTAL; y++) this.grid.push(new Array(COLS).fill(null));

      this.bag = [];
      this.queue = [];
      this._refillQueue();

      this.piece = null;
      this.holdType = null;
      this.holdUsed = false;

      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.combo = -1;
      this.b2b = false;
      this.pieceCount = 0;

      this.gravityAcc = 0;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.softDropHeld = false;

      this.clearAnim = null;
      this.lastAction = null;
      this.state = 'idle';
      this.elapsed = 0;

      if (!silent) this.emit('reset');
    }

    start() {
      this.reset(true);
      this.state = 'playing';
      this.spawn();
      this.emit('start');
    }

    pause() {
      if (this.state === 'playing') {
        this.state = 'paused';
        this.emit('pause');
      }
    }

    resume() {
      if (this.state === 'paused') {
        this.state = 'playing';
        this.emit('resume');
      }
    }

    _refillQueue() {
      while (this.queue.length < 7) {
        if (this.bag.length === 0) {
          this.bag = TYPES.slice();
          for (let i = this.bag.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = this.bag[i];
            this.bag[i] = this.bag[j];
            this.bag[j] = t;
          }
        }
        this.queue.push(this.bag.pop());
      }
    }

    spawn(type) {
      this._refillQueue();
      const t = type || this.queue.shift();
      this._refillQueue();

      const state = ROT[t][0];
      let minY = 99;
      for (const c of state.cells) minY = Math.min(minY, c[1]);

      const piece = {
        type: t,
        rot: 0,
        x: SPAWN_X[t],
        y: HIDDEN - minY,
        cells: state.cells,
      };

      if (this.collides(piece.type, piece.rot, piece.x, piece.y)) {
        this.piece = piece;
        this.state = 'over';
        this.emit('gameover', { reason: 'blockout' });
        return;
      }

      this.piece = piece;
      this.pieceCount++;
      this.lastAction = 'spawn';
      this.gravityAcc = 0;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.holdUsed = false;
      this.emit('spawn', { type: t });
    }

    cellsFor(type, rot) {
      return ROT[type][rot].cells;
    }

    collides(type, rot, x, y) {
      const cells = ROT[type][rot].cells;
      for (let i = 0; i < cells.length; i++) {
        const gx = x + cells[i][0];
        const gy = y + cells[i][1];
        if (gx < 0 || gx >= COLS || gy >= TOTAL) return true;
        if (gy >= 0 && this.grid[gy][gx]) return true;
      }
      return false;
    }

    canMove(dx, dy, piece) {
      const p = piece || this.piece;
      if (!p) return false;
      return !this.collides(p.type, p.rot, p.x + dx, p.y + dy);
    }

    getGhostY() {
      const p = this.piece;
      if (!p) return 0;
      let y = p.y;
      while (!this.collides(p.type, p.rot, p.x, y + 1)) y++;
      return y;
    }

    _touchGround() {
      if (!this.piece) return;
      if (this.canMove(0, 1)) return;
      if (this.lockResets < MAX_LOCK_RESETS) {
        this.lockResets++;
        this.lockTimer = 0;
      }
    }

    move(dx) {
      if (this.state !== 'playing' || this.clearAnim || !this.piece) return false;
      if (this.collides(this.piece.type, this.piece.rot, this.piece.x + dx, this.piece.y)) return false;
      this.piece.x += dx;
      this.lastAction = 'move';
      this._touchGround();
      this.emit('move', { dx: dx });
      return true;
    }

    rotate(dir) {
      if (this.state !== 'playing' || this.clearAnim || !this.piece) return false;
      const p = this.piece;
      const from = p.rot;
      const to = (from + (dir > 0 ? 1 : 3)) % 4;
      if (p.type === 'O') return false;
      const table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
      const kicks = table[from + '>' + to] || [[0, 0]];
      for (let i = 0; i < kicks.length; i++) {
        const nx = p.x + kicks[i][0];
        const ny = p.y - kicks[i][1];
        if (!this.collides(p.type, to, nx, ny)) {
          p.x = nx;
          p.y = ny;
          p.rot = to;
          // Keep the piece's own cell list in sync: the renderer and lock()
          // both read p.cells, so a stale list means "rotation does nothing".
          p.cells = ROT[p.type][to].cells;
          this.lastAction = 'rotate';
          this.lastKick = i;
          this._touchGround();
          this.emit('rotate', { dir: dir });
          return true;
        }
      }
      return false;
    }

    softDrop() {
      if (this.state !== 'playing' || this.clearAnim || !this.piece) return false;
      if (!this.canMove(0, 1)) return false;
      this.piece.y++;
      // Moving / soft dropping never scores: points come from placing a piece
      // (+10 on lock) and from clearing lines.
      this.gravityAcc = 0;
      this.lastAction = 'softdrop';
      this.emit('softdrop');
      return true;
    }

    hardDrop() {
      if (this.state !== 'playing' || this.clearAnim || !this.piece) return false;
      let dist = 0;
      while (this.canMove(0, 1)) {
        this.piece.y++;
        dist++;
      }
      this.lastAction = 'harddrop';
      this.emit('harddrop', { distance: dist });
      this.lock();
      return true;
    }

    hold() {
      if (this.state !== 'playing' || this.clearAnim || !this.piece || this.holdUsed) return false;
      const current = this.piece.type;
      const swap = this.holdType;
      this.holdType = current;
      this.holdUsed = true;
      this.piece = null;
      if (swap) {
        this.spawn(swap);
      } else {
        this.spawn();
      }
      this.holdUsed = true;
      this.emit('hold', { type: this.holdType });
      return true;
    }

    _detectTSpin() {
      const p = this.piece;
      if (!p || p.type !== 'T' || this.lastAction !== 'rotate') return { tspin: false, mini: false };
      const cx = p.x + 1;
      const cy = p.y + 1;
      const corners = [
        [0, 0],
        [2, 0],
        [0, 2],
        [2, 2],
      ];
      let filled = 0;
      const f = [];
      for (let i = 0; i < 4; i++) {
        const gx = cx - 1 + corners[i][0];
        const gy = cy - 1 + corners[i][1];
        const solid = gx < 0 || gx >= COLS || gy >= TOTAL || (gy >= 0 && !!this.grid[gy][gx]);
        f[i] = solid;
        if (solid) filled++;
      }
      if (filled < 3) return { tspin: false, mini: false };
      // corners order: TL, TR, BL, BR; front corners per rotation
      const front = [
        [f[0], f[1]],
        [f[1], f[3]],
        [f[2], f[3]],
        [f[0], f[2]],
      ][p.rot];
      const mini = !(front[0] && front[1]);
      return { tspin: true, mini: mini };
    }

    _gravityMs() {
      const lvl = Math.min(this.level, 20);
      const base = Math.pow(0.8 - (lvl - 1) * 0.007, lvl - 1) * 1000;
      return Math.max(28, base);
    }

    lock() {
      const p = this.piece;
      if (!p) return;
      const spin = this._detectTSpin();
      const cells = [];
      let above = false;

      for (let i = 0; i < p.cells.length; i++) {
        const gx = p.x + p.cells[i][0];
        const gy = p.y + p.cells[i][1];
        cells.push([gx, gy]);
        if (gy < HIDDEN) above = true;
        if (gy >= 0 && gy < TOTAL && gx >= 0 && gx < COLS) this.grid[gy][gx] = p.type;
      }

      const cleared = [];
      for (let y = 0; y < TOTAL; y++) {
        if (this.grid[y].every((v) => !!v)) cleared.push(y);
      }

      this.emit('lock', { cells: cells, tspin: spin.tspin, mini: spin.mini });

      this.piece = null;
      this.lockTimer = 0;
      this.lockResets = 0;
      this.gravityAcc = 0;

      if (cleared.length > 0) {
        this._applyClearScore(cleared.length, spin);
        this.clearAnim = { rows: cleared, t: 0, duration: CLEAR_MS };
        this.clearingCount = cleared.length;
        this.emit('clear', {
          rows: cleared,
          count: cleared.length,
          tspin: spin.tspin,
          mini: spin.mini,
          combo: this.combo,
          score: this.score,
        });
      } else {
        this.combo = -1;
        if (above) {
          this.state = 'over';
          this.emit('gameover', { reason: 'lockout' });
        } else {
          this.spawn();
        }
      }
    }

    _applyClearScore(n, spin) {
      let base;
      let difficult = false;
      if (spin.tspin) {
        base = (spin.mini ? TSPIN_MINI_SCORE[n] : TSPIN_SCORE[n]) * this.level;
        difficult = true;
        if (spin.mini && n === 0) base = 100 * this.level;
      } else {
        base = CLEAR_SCORE[n] * this.level;
        difficult = n === 4;
      }

      this.combo++;
      let bonus = 0;
      if (this.combo > 0) bonus += 50 * this.combo * this.level;
      if (difficult && this.b2b) bonus += Math.floor(base * 0.5);
      if (n === 4) {
        // Rows that are not full must be empty for a perfect clear.
        let perfect = true;
        for (let y = 0; y < TOTAL && perfect; y++) {
          let full = true;
          for (let x = 0; x < COLS; x++) {
            if (!this.grid[y][x]) {
              full = false;
              break;
            }
          }
          if (full) continue;
          for (let x = 0; x < COLS; x++) {
            if (this.grid[y][x]) {
              perfect = false;
              break;
            }
          }
        }
        if (perfect) {
          bonus += 1000 * this.level;
          this.emit('perfect');
        }
      }

      this.b2b = difficult;
      this.score += base + bonus;
      this.pendingGain = { base: base, bonus: bonus, total: base + bonus, n: n };
    }

    _finishClear() {
      const rows = this.clearAnim.rows;
      for (let i = 0; i < rows.length; i++) {
        this.grid.splice(rows[i], 1);
        this.grid.unshift(new Array(COLS).fill(null));
      }
      const n = rows.length;
      this.lines += n;
      const newLevel = 1 + Math.floor(this.lines / 10);
      const leveled = newLevel > this.level;
      this.level = newLevel;
      this.clearAnim = null;
      this.emit('cleared', { count: n, lines: this.lines, gain: this.pendingGain });
      if (leveled) this.emit('levelup', { level: this.level });
      this.spawn();
    }

    update(dt) {
      if (this.state !== 'playing') return;
      if (dt > 100) dt = 100;
      this.elapsed += dt;

      if (this.clearAnim) {
        this.clearAnim.t += dt;
        if (this.clearAnim.t >= this.clearAnim.duration) this._finishClear();
        return;
      }

      if (!this.piece) return;

      if (this.canMove(0, 1)) {
        this.gravityAcc += dt;
        const g = this._gravityMs();
        while (this.gravityAcc >= g && this.canMove(0, 1)) {
          this.piece.y++;
          this.gravityAcc -= g;
        }
        this.lockTimer = 0;
      } else {
        this.gravityAcc = 0;
        this.lockTimer += dt;
        if (this.lockTimer >= LOCK_DELAY) this.lock();
      }
    }
  }

  Tetris.COLS = COLS;
  Tetris.ROWS = ROWS;
  Tetris.HIDDEN = HIDDEN;
  Tetris.TOTAL = TOTAL;
  Tetris.PIECES = PIECES;
  Tetris.ROT = ROT;
  Tetris.TYPES = TYPES;

  global.PrismTetris = Tetris;
})(window);
