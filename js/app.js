/* Prism · 俄罗斯方块 — 界面与交互 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const native = window.PrismNative || null;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const store = {
    get(key, fallback) {
      try {
        if (native && native.load) {
          const v = native.load(key);
          if (v !== null && v !== undefined && v !== '') return v;
        }
      } catch (e) {}
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch (e) {}
      try {
        if (native && native.save) native.save(key, String(value));
      } catch (e) {}
    },
  };

  const prefs = {
    sound: store.get('prism.sound', '1') !== '0',
    haptic: store.get('prism.haptic', '1') !== '0',
    theme: store.get('prism.theme', 'auto'),
    best: parseInt(store.get('prism.best', '0'), 10) || 0,
    bestLines: parseInt(store.get('prism.bestLines', '0'), 10) || 0,
  };

  const audio = new window.PrismAudio.SoundKit();
  const haptics = window.PrismAudio.Haptics;
  haptics.bridge = native;
  audio.enabled = prefs.sound;
  haptics.enabled = prefs.haptic;

  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let dark = false;
  // The native shell reports the system theme explicitly: some WebViews keep a
  // stale prefers-color-scheme value after the system switches.
  let systemDark = null;

  function resolveTheme() {
    if (prefs.theme === 'dark') return true;
    if (prefs.theme === 'light') return false;
    if (systemDark !== null) return systemDark;
    return !!(darkQuery && darkQuery.matches);
  }

  function applyTheme() {
    dark = resolveTheme();
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#08080C' : '#F4F4F9');
    if (view) {
      view.dark = dark;
      view.buildBackground();
    }
    layout(true);
    syncPreviews();
  }

  /* ---------------- engine ---------------- */

  const boardCanvas = $('#board');
  const view = new window.PrismView.BoardView(boardCanvas);

  const nextCanvases = $$('#nextStack canvas');
  const holdCanvas = $('#holdCanvas');
  const nextViews = nextCanvases.map((c) => new window.PrismView.PiecePreview(c));
  const holdView = new window.PrismView.PiecePreview(holdCanvas);

  const game = new window.PrismTetris({ onEvent: handleEvent });

  let running = false;
  let lastTime = 0;
  let overTimer = null;

  /* ---------------- UI helpers ---------------- */

  function fmt(n) {
    return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const counters = {};

  function countTo(el, target, key) {
    if (!el) return;
    const state = counters[key] || (counters[key] = { value: 0, target: 0, raf: 0, el: el });
    state.el = el;
    state.target = target;
    if (state.raf) return;
    const step = () => {
      const diff = state.target - state.value;
      if (Math.abs(diff) < 1) {
        state.value = state.target;
        state.el.textContent = fmt(state.value);
        state.raf = 0;
        return;
      }
      state.value += diff * 0.28 + Math.sign(diff) * 0.6;
      state.el.textContent = fmt(state.value);
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }

  function setStats(animate) {
    if (animate) {
      countTo($('#statScore'), game.score, 'score');
      countTo($('#statLines'), game.lines, 'lines');
      countTo($('#statLevel'), game.level, 'level');
    } else {
      $('#statScore').textContent = fmt(game.score);
      $('#statLines').textContent = fmt(game.lines);
      $('#statLevel').textContent = fmt(game.level);
      counters.score = { value: game.score, target: game.score, raf: 0, el: $('#statScore') };
      counters.lines = { value: game.lines, target: game.lines, raf: 0, el: $('#statLines') };
      counters.level = { value: game.level, target: game.level, raf: 0, el: $('#statLevel') };
    }
  }

  function syncPreviews() {
    const queue = game.queue || [];
    nextViews.forEach((pv, i) => pv.draw(queue[i] || null));
    holdView.draw(game.holdType || null, { alpha: game.holdUsed ? 0.35 : 1 });
    const holdCard = $('#holdCard');
    if (holdCard) {
      holdCard.classList.toggle('used', !!game.holdUsed);
      holdCard.classList.toggle('has-piece', !!game.holdType);
    }
  }

  function floatText(text, opts) {
    const fx = $('#fx');
    if (!fx) return;
    const o = opts || {};
    const el = document.createElement('div');
    el.className = 'float-text ' + (o.cls || '');
    el.textContent = text;
    el.style.left = (o.x != null ? o.x : 50) + '%';
    el.style.top = (o.y != null ? o.y : 42) + '%';
    fx.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1100);
  }

  function toast(text, cls) {
    const layer = $('#toast');
    if (!layer) return;
    const el = document.createElement('div');
    el.className = 'toast-item ' + (cls || '');
    el.textContent = text;
    layer.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 1400);
  }

  /* ---------------- sharing ---------------- */

  const SHARE_TITLE = 'PRISM · 俄罗斯方块';

  function pageUrl() {
    return location.href.split('#')[0];
  }

  function legacyCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ta.setSelectionRange(0, text.length);
      if (document.execCommand('copy')) done();
      else toast('复制失败，请手动复制地址栏链接');
    } catch (e) {
      toast('复制失败，请手动复制地址栏链接');
    }
    document.body.removeChild(ta);
  }

  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
    } else {
      legacyCopy(text, done);
    }
  }

  function shareGame(text) {
    const url = pageUrl();
    const message = text || '来玩一局 PRISM 俄罗斯方块，打开链接就能玩';
    const copy = () => copyText(message + '\n' + url, () => toast('链接已复制，发给朋友吧'));
    // Phones get the native share sheet; desktops just get the link on the clipboard.
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.share && /^https?:/i.test(url)) {
      navigator
        .share({ title: SHARE_TITLE, text: message, url: url })
        .then(() => {
          toast('已打开分享');
        })
        .catch((err) => {
          if (err && err.name === 'AbortError') return; // user backed out
          copy();
        });
      return;
    }
    copy();
  }

  /* ---------------- events ---------------- */

  let lastMoveSound = 0;

  function handleEvent(type, data) {
    switch (type) {
      case 'spawn':
        syncPreviews();
        break;
      case 'move':
        if (performance.now() - lastMoveSound > 55) {
          audio.play('move');
          lastMoveSound = performance.now();
        }
        break;
      case 'rotate':
        audio.play('rotate');
        haptics.light();
        break;
      case 'hold':
        audio.play('hold');
        haptics.light();
        syncPreviews();
        break;
      case 'softdrop':
        break;
      case 'harddrop':
        audio.play('harddrop');
        haptics.heavy();
        break;
      case 'lock':
        audio.play('lock');
        haptics.medium();
        setStats(true);
        break;
      case 'clear': {
        audio.play('clear', { count: data.count });
        haptics.heavy();
        {
          const scoreEl = $('#statScore');
          if (scoreEl) {
            scoreEl.classList.remove('bump');
            void scoreEl.offsetWidth;
            scoreEl.classList.add('bump');
          }
        }
        const gain = game.pendingGain || {};
        const amount = gain.total || 0;
        const rowY = data.rows && data.rows.length ? (data.rows[0] - window.PrismTetris.HIDDEN) / 20 * 100 : 40;
        floatText('+' + fmt(amount), { y: clamp(rowY, 8, 80), cls: data.count === 4 ? 'big' : '' });
        if (data.tspin) {
          floatText(data.mini ? 'T-SPIN MINI' : 'T-SPIN', { y: 24, cls: 'accent small' });
        }
        if (game.combo > 0) {
          floatText('COMBO ×' + (game.combo + 1), { y: 32, cls: 'combo small' });
        }
        if (data.count === 4) toast('TETRIS', 'strong');
        setStats(true);
        break;
      }
      case 'cleared':
        setStats(true);
        syncPreviews();
        break;
      case 'levelup':
        audio.play('levelup');
        toast('LEVEL ' + data.level);
        break;
      case 'perfect':
        toast('PERFECT CLEAR', 'strong');
        break;
      case 'gameover':
        audio.play('over');
        haptics.heavy();
        handleGameOver();
        break;
      case 'pause':
        break;
      case 'resume':
        break;
      default:
        break;
    }
  }

  /* ---------------- layout ---------------- */

  let layoutRaf = 0;

  function layout(force) {
    if (layoutRaf && !force) return;
    if (layoutRaf) cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(() => {
      layoutRaf = 0;
      doLayout();
    });
  }

  function doLayout() {
    const area = $('#playArea');
    if (!area || !area.clientWidth) return;
    const rail = $('.rail');
    const railW = rail ? rail.offsetWidth : 66;
    const gap = 10;
    const style = getComputedStyle(area);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const availW = area.clientWidth - padX - railW - gap - 14;
    const availH = area.clientHeight - padY - 14;
    let cell = Math.floor(Math.min(availW / 10, availH / 20));
    cell = clamp(cell, 11, 40);

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    view.layout(cell, dpr, dark);

    if (rail) rail.style.height = view.height + 12 + 'px';

    const pvCell = Math.max(7, Math.round(cell * 0.42));
    nextViews.forEach((pv) => {
      pv.layout(pvCell, dpr, dark);
      pv.draw(null);
    });
    holdView.layout(pvCell, dpr, dark);
    holdView.draw(null);

    const stack = $('#nextStack');
    if (stack) {
      stack.style.setProperty('--pv-cell', pvCell + 'px');
    }
    syncPreviews();
  }

  /* ---------------- screens & overlays ---------------- */

  function showScreen(name) {
    $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
    document.body.dataset.screen = name;
  }

  function openSheet(id) {
    const o = $('#overlay');
    if (!o) return;
    o.classList.add('show');
    $$('.sheet', o).forEach((s) => s.classList.toggle('active', s.id === id));
    document.body.classList.add('modal');
  }

  function closeSheets() {
    const o = $('#overlay');
    if (!o) return;
    o.classList.remove('show');
    $$('.sheet', o).forEach((s) => s.classList.remove('active'));
    document.body.classList.remove('modal');
  }

  function updateHomeStats() {
    $('#homeBest').textContent = fmt(Math.max(prefs.best, game.score || 0));
    $('#homeLines').textContent = fmt(Math.max(prefs.bestLines, game.lines || 0));
  }

  function startGame() {
    audio.init();
    audio.resume();
    closeSheets();
    if (overTimer) {
      clearTimeout(overTimer);
      overTimer = null;
    }
    showScreen('game');
    document.body.dataset.screen = 'game';
    game.start();
    setStats(false);
    syncPreviews();
    layout(true);
    setTimeout(() => layout(true), 60);
    running = true;
    lastTime = 0;
    audio.play('start');
    haptics.light();
  }

  function goHome() {
    game.pause();
    running = false;
    closeSheets();
    updateHomeStats();
    showScreen('home');
    audio.play('tap');
  }

  function pauseGame() {
    if (game.state !== 'playing') return;
    game.pause();
    updatePauseSheet();
    openSheet('sheetPause');
    audio.play('tap');
    haptics.light();
  }

  function resumeGame() {
    closeSheets();
    game.resume();
    lastTime = 0;
    audio.play('tap');
  }

  function restartGame() {
    closeSheets();
    if (overTimer) {
      clearTimeout(overTimer);
      overTimer = null;
    }
    game.start();
    setStats(false);
    syncPreviews();
    running = true;
    lastTime = 0;
    layout(true);
    audio.play('start');
  }

  let lastGameWasRecord = false;

  function handleGameOver() {
    running = false;
    const score = game.score;
    const lines = game.lines;
    lastGameWasRecord = score > prefs.best && score > 0;
    if (score > prefs.best) {
      prefs.best = score;
      store.set('prism.best', score);
    }
    if (lines > prefs.bestLines) {
      prefs.bestLines = lines;
      store.set('prism.bestLines', lines);
    }
    overTimer = setTimeout(() => {
      overTimer = null;
      fillGameOver();
      openSheet('sheetOver');
      updateHomeStats();
    }, 620);
  }

  function fillGameOver() {
    $('#overScore').textContent = fmt(game.score);
    $('#overLines').textContent = fmt(game.lines);
    $('#overLevel').textContent = fmt(game.level);
    $('#overBest').textContent = fmt(prefs.best);
    const badge = $('#overBadge');
    if (badge) badge.classList.toggle('show', lastGameWasRecord);
  }

  function updatePauseSheet() {
    $('#pauseScore').textContent = fmt(game.score);
    $('#pauseLevel').textContent = fmt(game.level);
    $('#pauseLines').textContent = fmt(game.lines);
  }

  /* ---------------- input ---------------- */

  const repeat = {
    dir: 0,
    timer: null,
    delay: 0,
    start(act) {
      this.stop();
      if (act === 'left') this.step(-1);
      else if (act === 'right') this.step(1);
      else if (act === 'down') this.softStep();
      this.dir = act;
      this.delay = act === 'left' || act === 'right' ? 165 : 70;
      this.timer = setTimeout(() => {
        this.timer = setInterval(() => {
          if (act === 'left' || act === 'right') this.step(act === 'left' ? -1 : 1);
          else this.softStep();
        }, act === 'left' || act === 'right' ? 42 : 45);
      }, this.delay);
    },
    step(dx) {
      game.move(dx);
    },
    softStep() {
      if (game.softDrop()) {
        haptics.light();
      }
    },
    stop() {
      if (this.timer) {
        clearTimeout(this.timer);
        clearInterval(this.timer);
        this.timer = null;
      }
      this.dir = 0;
    },
  };

  function bindControls() {
    $$('.ctrl').forEach((btn) => {
      const act = btn.dataset.act;
      const down = (e) => {
        e.preventDefault();
        if (game.state !== 'playing') return;
        btn.classList.add('pressed');
        if (act === 'rotate') {
          audio.resume();
          game.rotate(1);
          haptics.light();
        } else if (act === 'drop') {
          game.hardDrop();
        } else {
          repeat.start(act);
        }
      };
      const up = () => {
        btn.classList.remove('pressed');
        repeat.stop();
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    const holdCard = $('#holdCard');
    if (holdCard) {
      holdCard.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (game.state !== 'playing') return;
        holdCard.classList.add('pressed');
        game.hold();
      });
      const un = () => holdCard.classList.remove('pressed');
      holdCard.addEventListener('pointerup', un);
      holdCard.addEventListener('pointercancel', un);
      holdCard.addEventListener('pointerleave', un);
    }

    // Never let a repeated move run away if the release lands outside the button.
    const release = () => {
      repeat.stop();
      $$('.ctrl').forEach((b) => b.classList.remove('pressed'));
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    window.addEventListener('blur', release, true);
  }

  function bindGestures() {
    const wrap = $('#boardWrap');
    if (!wrap) return;
    let active = false;
    let id = null;
    let sx = 0;
    let sy = 0;
    let lx = 0;
    let ly = 0;
    let st = 0;
    let accumX = 0;
    let accumY = 0;
    let moved = false;
    let softLock = false;

    const begin = (e) => {
      if (game.state !== 'playing' || game.clearAnim) return;
      if (e.button != null && e.button !== 0) return;
      active = true;
      id = e.pointerId;
      sx = lx = e.clientX;
      sy = ly = e.clientY;
      st = performance.now();
      accumX = 0;
      accumY = 0;
      moved = false;
      softLock = false;
      audio.resume();
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch (err) {}
    };

    const move = (e) => {
      if (!active || e.pointerId !== id) return;
      const cell = view.cell || 30;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      const totalX = Math.abs(e.clientX - sx);
      const totalY = Math.abs(e.clientY - sy);
      if (totalX > 12 || totalY > 12) moved = true;

      if (totalY > totalX * 1.15 && e.clientY > sy) {
        accumY += Math.abs(dy);
        const stepY = Math.max(14, cell * 0.62);
        while (accumY >= stepY) {
          accumY -= stepY;
          game.softDrop();
          softLock = true;
        }
      } else if (totalX >= totalY) {
        accumX += dx;
        const stepX = Math.max(16, cell * 0.72);
        while (Math.abs(accumX) >= stepX) {
          const dir = accumX > 0 ? 1 : -1;
          game.move(dir);
          accumX -= dir * stepX;
        }
      }
    };

    const end = (e) => {
      if (!active || (e && e.pointerId !== id)) return;
      active = false;
      const dt = Math.max(1, performance.now() - st);
      const dy = (e ? e.clientY : sy) - sy;
      const dx = (e ? e.clientX : sx) - sx;
      const vy = dy / dt;
      if (!moved && dt < 380 && Math.abs(dx) < 14 && Math.abs(dy) < 14) {
        game.rotate(1);
        haptics.light();
      } else if (dy > 52 && vy > 0.8 && dy > Math.abs(dx) * 1.4) {
        // A quick downward flick commits the piece.
        game.hardDrop();
      }
      id = null;
    };

    wrap.addEventListener('pointerdown', begin);
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', () => {
      active = false;
      id = null;
    });
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (document.body.dataset.screen !== 'game') {
        if (e.key === 'Enter' && document.body.dataset.screen === 'home') startGame();
        return;
      }
      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (game.state === 'playing') pauseGame();
        else if (game.state === 'paused') resumeGame();
        return;
      }
      if (game.state !== 'playing') return;
      switch (e.key) {
        case 'ArrowLeft':
          game.move(-1);
          break;
        case 'ArrowRight':
          game.move(1);
          break;
        case 'ArrowDown':
          game.softDrop();
          break;
        case 'ArrowUp':
        case 'x':
        case 'X':
          game.rotate(1);
          break;
        case 'z':
        case 'Z':
          game.rotate(-1);
          break;
        case ' ':
          e.preventDefault();
          game.hardDrop();
          break;
        case 'c':
        case 'C':
        case 'Shift':
          game.hold();
          break;
        case 'r':
        case 'R':
          restartGame();
          break;
        default:
          return;
      }
      if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
    });
  }

  /* ---------------- toggles ---------------- */

  function paintToggles() {
    const s = $('#tgSound');
    const h = $('#tgHaptic');
    if (s) s.classList.toggle('on', prefs.sound);
    if (h) h.classList.toggle('on', prefs.haptic);
    const gs = $('#btnSound');
    if (gs) {
      gs.classList.toggle('muted', !prefs.sound);
      gs.setAttribute('aria-label', prefs.sound ? '关闭音效' : '开启音效');
    }
    const th = $('#btnTheme');
    if (th) th.dataset.mode = prefs.theme;
  }

  function bindUI() {
    $('#btnStart').addEventListener('click', startGame);
    $('#btnPause').addEventListener('click', pauseGame);
    $('#btnSound').addEventListener('click', () => {
      prefs.sound = !prefs.sound;
      audio.setEnabled(prefs.sound);
      store.set('prism.sound', prefs.sound ? '1' : '0');
      paintToggles();
      if (prefs.sound) audio.play('tap');
    });
    $('#tgSound').addEventListener('click', () => {
      prefs.sound = !prefs.sound;
      audio.setEnabled(prefs.sound);
      store.set('prism.sound', prefs.sound ? '1' : '0');
      paintToggles();
      if (prefs.sound) audio.play('tap');
    });
    $('#tgHaptic').addEventListener('click', () => {
      prefs.haptic = !prefs.haptic;
      haptics.enabled = prefs.haptic;
      store.set('prism.haptic', prefs.haptic ? '1' : '0');
      paintToggles();
      haptics.medium();
      audio.play('tap');
    });
    $('#btnTheme').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const idx = order.indexOf(prefs.theme);
      prefs.theme = order[(idx + 1) % order.length];
      store.set('prism.theme', prefs.theme);
      applyTheme();
      paintToggles();
      audio.play('tap');
    });

    $('#btnShare').addEventListener('click', () => {
      audio.play('tap');
      shareGame();
    });
    const shareScore = $('#btnShareScore');
    if (shareScore) {
      shareScore.addEventListener('click', () => {
        audio.play('tap');
        shareGame(
          '我在 PRISM 俄罗斯方块拿了 ' +
            fmt(game.score) +
            ' 分、消除 ' +
            fmt(game.lines) +
            ' 行，等级 ' +
            fmt(game.level) +
            '，来挑战我'
        );
      });
    }

    $('#btnResume').addEventListener('click', resumeGame);
    $('#btnRestartPause').addEventListener('click', restartGame);
    $('#btnQuit').addEventListener('click', goHome);

    $('#btnPlayAgain').addEventListener('click', restartGame);
    $('#btnHome').addEventListener('click', goHome);

    const scrim = $('.scrim');
    if (scrim) {
      scrim.addEventListener('click', () => {
        if ($('#sheetPause').classList.contains('active')) resumeGame();
      });
    }

    if (darkQuery) {
      const handler = () => {
        if (prefs.theme === 'auto') applyTheme();
      };
      if (darkQuery.addEventListener) darkQuery.addEventListener('change', handler);
      else if (darkQuery.addListener) darkQuery.addListener(handler);
    }

    window.addEventListener('resize', () => layout());
    window.addEventListener('orientationchange', () => setTimeout(() => layout(true), 120));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game.state === 'playing' && !$('#overlay').classList.contains('show')) {
        pauseGame();
      }
    });
    window.addEventListener('blur', () => {
      if (game.state === 'playing' && document.body.dataset.screen === 'game') pauseGame();
    });
    window.addEventListener('pointerdown', () => audio.resume(), { once: true });
  }

  /* ---------------- main loop ---------------- */

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastTime) lastTime = now;
    let dt = now - lastTime;
    lastTime = now;
    if (dt > 250) dt = 16;
    if (running && game.state === 'playing') {
      game.update(dt);
      setStats(true);
    }
    if (view.bg) view.render(game, now);
  }

  /* ---------------- native bridge ---------------- */

  window.PrismApp = {
    onBack() {
      if ($('#overlay').classList.contains('show')) {
        if ($('#sheetPause').classList.contains('active')) resumeGame();
        else if ($('#sheetOver').classList.contains('active')) goHome();
        return true;
      }
      if (document.body.dataset.screen === 'game') {
        if (game.state === 'playing') {
          pauseGame();
          return true;
        }
        if (game.state === 'paused') {
          resumeGame();
          return true;
        }
        goHome();
        return true;
      }
      return false;
    },
    onResume() {
      applyTheme();
      layout(true);
    },
    onHide() {
      if (game.state === 'playing') pauseGame();
    },
    onSystemTheme(night) {
      systemDark = !!night;
      if (prefs.theme === 'auto') applyTheme();
    },
    onInsets(top, bottom, left, right) {
      const root = document.documentElement;
      root.style.setProperty('--sat', top + 'px');
      root.style.setProperty('--sab', bottom + 'px');
      root.style.setProperty('--sal', left + 'px');
      root.style.setProperty('--sar', right + 'px');
      layout(true);
    },
  };

  /* ---------------- boot ---------------- */

  function boot() {
    applyTheme();
    paintToggles();
    showScreen('home');
    $('#homeBest').textContent = fmt(prefs.best);
    $('#homeLines').textContent = fmt(prefs.bestLines);
    document.body.dataset.screen = 'home';
    bindUI();
    bindControls();
    bindGestures();
    bindKeyboard();
    doLayout();
    syncPreviews();
    setStats(false);
    requestAnimationFrame(frame);
    setTimeout(() => {
      document.body.classList.add('ready');
      layout(true);
    }, 30);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  if (/[?&]debug=1/.test(location.search)) {
    window.__prism = {
      game: game,
      view: view,
      start: startGame,
      restart: restartGame,
      pause: pauseGame,
      resume: resumeGame,
      layout: doLayout,
      prefs: prefs,
      theme(mode) {
        prefs.theme = mode;
        store.set('prism.theme', mode);
        applyTheme();
        paintToggles();
      },
    };
  }
})();

