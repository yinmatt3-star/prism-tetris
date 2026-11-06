/* Prism · 俄罗斯方块 — Canvas 渲染层 */
(function (global) {
  'use strict';

  const T = global.PrismTetris;
  const COLS = T.COLS;
  const HIDDEN = T.HIDDEN;
  const TOTAL = T.TOTAL;
  const VISIBLE = T.ROWS;

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) {
    const A = hexToRgb(a);
    const B = Array.isArray(b) ? b : hexToRgb(b);
    const r = Math.round(A[0] + (B[0] - A[0]) * t);
    const g = Math.round(A[1] + (B[1] - A[1]) * t);
    const bl = Math.round(A[2] + (B[2] - A[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function alpha(hex, a) {
    const c = hexToRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  const DARK_COLOR = {};

  class BoardView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cell = 30;
      this.dpr = 1;
      this.bg = null;
      this.dark = false;
      this.landing = { row: -1, t: 0 };
    }

    layout(cell, dpr, dark) {
      const c = Math.max(10, Math.round(cell));
      const changed = c !== this.cell || dpr !== this.dpr || dark !== this.dark || !this.bg;
      this.cell = c;
      this.dpr = dpr;
      this.dark = !!dark;
      if (!changed) return;
      const w = c * COLS;
      const h = c * VISIBLE;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.width = w;
      this.height = h;
      this.buildBackground();
    }

    buildBackground() {
      const c = this.cell;
      const dpr = this.dpr;
      const w = c * COLS;
      const h = c * VISIBLE;
      const off = document.createElement('canvas');
      off.width = Math.round(w * dpr);
      off.height = Math.round(h * dpr);
      const g = off.getContext('2d');
      g.scale(dpr, dpr);

      const surface = g.createLinearGradient(0, 0, 0, h);
      if (this.dark) {
        surface.addColorStop(0, 'rgba(12,14,20,0.55)');
        surface.addColorStop(1, 'rgba(6,7,11,0.72)');
      } else {
        surface.addColorStop(0, 'rgba(255,255,255,0.50)');
        surface.addColorStop(1, 'rgba(255,255,255,0.28)');
      }
      g.fillStyle = surface;
      g.fillRect(0, 0, w, h);

      const inset = Math.max(1.2, c * 0.055);
      const rad = c * 0.24;
      g.fillStyle = this.dark ? 'rgba(255,255,255,0.05)' : 'rgba(20,22,34,0.04)';
      for (let y = 0; y < VISIBLE; y++) {
        for (let x = 0; x < COLS; x++) {
          roundRect(g, x * c + inset, y * c + inset, c - inset * 2, c - inset * 2, rad);
          g.fill();
        }
      }

      this.bg = off;
    }

    drawBlock(g, px, py, color, opts) {
      const o = opts || {};
      const c = this.cell;
      const inset = c * 0.055;
      const x = px + inset;
      const y = py + inset;
      const w = c - inset * 2;
      const h = c - inset * 2;
      const r = c * 0.24;

      if (o.ghost) {
        g.save();
        roundRect(g, x, y, w, h, r);
        g.fillStyle = alpha(color, this.dark ? 0.10 : 0.08);
        g.fill();
        g.lineWidth = Math.max(1.2, c * 0.06);
        g.strokeStyle = alpha(color, this.dark ? 0.55 : 0.42);
        g.stroke();
        g.restore();
        return;
      }

      const grad = g.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, mix(color, [255, 255, 255], this.dark ? 0.30 : 0.42));
      grad.addColorStop(0.48, color);
      grad.addColorStop(1, mix(color, [0, 0, 0], this.dark ? 0.30 : 0.14));

      g.save();
      if (o.flash) {
        g.globalAlpha = o.flash;
        g.shadowColor = alpha(color, 0.75);
        g.shadowBlur = c * 0.6;
      }
      roundRect(g, x, y, w, h, r);
      g.fillStyle = grad;
      g.fill();

      // Inner light: a hairline highlight along the top edge.
      g.save();
      g.clip();
      const shine = g.createLinearGradient(x, y, x, y + h * 0.55);
      shine.addColorStop(0, 'rgba(255,255,255,' + (this.dark ? 0.34 : 0.5) + ')');
      shine.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = shine;
      roundRect(g, x, y, w, h, r);
      g.fill();
      g.restore();
      g.restore();
    }

    drawPieceCells(g, cells, px, py, color, opts) {
      for (let i = 0; i < cells.length; i++) {
        this.drawBlock(g, px + cells[i][0] * this.cell, py + cells[i][1] * this.cell, color, opts);
      }
    }

    render(game, now) {
      const g = this.ctx;
      const c = this.cell;
      const dpr = this.dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this.width, this.height);
      if (this.bg) g.drawImage(this.bg, 0, 0, this.width, this.height);

      const clear = game.clearAnim;
      const clearingRows = clear ? clear.rows : null;

      // Locked blocks.
      for (let y = HIDDEN; y < TOTAL; y++) {
        const row = game.grid[y];
        let isClearing = false;
        if (clearingRows) {
          for (let i = 0; i < clearingRows.length; i++) {
            if (clearingRows[i] === y) {
              isClearing = true;
              break;
            }
          }
        }
        for (let x = 0; x < COLS; x++) {
          const type = row[x];
          if (!type) continue;
          const color = T.PIECES[type].color;
          if (isClearing) {
            const t = Math.min(1, clear.t / clear.duration);
            const shrink = 1 - 0.85 * t;
            const off = (c * (1 - shrink)) / 2;
            g.save();
            g.globalAlpha = 1 - t * 0.35;
            g.translate(x * c + c / 2, (y - HIDDEN) * c + c / 2);
            g.scale(shrink, shrink);
            g.translate(-c / 2, -c / 2);
            this.drawBlock(g, 0, 0, color, { flash: 1 - t * 0.4 });
            g.restore();
            if (off < 0) {
              /* keep linter calm */
            }
          } else {
            this.drawBlock(g, x * c, (y - HIDDEN) * c, color);
          }
        }
      }

      // White sweep across clearing rows.
      if (clear) {
        const t = Math.min(1, clear.t / clear.duration);
        g.save();
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < clear.rows.length; i++) {
          const y = clear.rows[i] - HIDDEN;
          const fade = Math.sin(Math.PI * Math.min(1, t * 1.15));
          const lg = g.createLinearGradient(0, y * c, this.width, y * c);
          lg.addColorStop(0, 'rgba(255,255,255,0)');
          lg.addColorStop(0.5, 'rgba(255,255,255,' + 0.55 * fade + ')');
          lg.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = lg;
          g.fillRect(0, y * c + c * 0.1, this.width, c * 0.8);
        }
        g.restore();
      }

      const p = game.piece;
      if (!p) return;

      const color = T.PIECES[p.type].color;
      const liveCells = game.cellsFor(p.type, p.rot);

      // No landing preview: the player has to read the stack. Drawing only the
      // active piece keeps the difficulty where it belongs.
      for (let i = 0; i < liveCells.length; i++) {
        const gx = p.x + liveCells[i][0];
        const gy = p.y + liveCells[i][1];
        if (gy < HIDDEN) continue;
        this.drawBlock(g, gx * c, (gy - HIDDEN) * c, color, {});
      }
    }
  }

  class PiecePreview {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cell = 12;
      this.dpr = 1;
      this.dark = false;
    }

    layout(cell, dpr, dark) {
      this.cell = cell;
      this.dpr = dpr;
      this.dark = !!dark;
      const w = this.canvas.clientWidth || cell * 4;
      const h = this.canvas.clientHeight || cell * 3;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.w = w;
      this.h = h;
    }

    draw(type, opts) {
      const g = this.ctx;
      const c = this.cell;
      const dpr = this.dpr;
      if (!this.w) this.layout(c, dpr, this.dark);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, this.w, this.h);
      if (!type) return;

      const cells = T.ROT[type][0].cells;
      let minX = 9;
      let maxX = -9;
      let minY = 9;
      let maxY = -9;
      for (const [x, y] of cells) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      const bw = (maxX - minX + 1) * c;
      const bh = (maxY - minY + 1) * c;
      const ox = (this.w - bw) / 2 - minX * c;
      const oy = (this.h - bh) / 2 - minY * c;
      const color = T.PIECES[type].color;
      const o = opts || {};

      for (const [x, y] of cells) {
        const px = ox + x * c;
        const py = oy + y * c;
        const inset = c * 0.06;
        const r = c * 0.26;
        const grad = g.createLinearGradient(px, py, px, py + c);
        grad.addColorStop(0, mix(color, [255, 255, 255], this.dark ? 0.28 : 0.4));
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, mix(color, [0, 0, 0], this.dark ? 0.28 : 0.12));
        g.save();
        if (o.alpha != null) g.globalAlpha = o.alpha;
        roundRect(g, px + inset, py + inset, c - inset * 2, c - inset * 2, r);
        g.fillStyle = grad;
        g.fill();
        g.restore();
      }
    }
  }

  global.PrismView = { BoardView: BoardView, PiecePreview: PiecePreview, roundRect: roundRect, mix: mix, alpha: alpha };
})(window);
