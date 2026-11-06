/* Prism · 声音与触感 */
(function (global) {
  'use strict';

  class SoundKit {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.enabled = true;
      this.ready = false;
      this.pending = 0;
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 24;
        comp.ratio.value = 6;
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        this.ready = true;
      } catch (e) {
        this.ready = false;
      }
    }

    resume() {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    setEnabled(on) {
      this.enabled = !!on;
      if (this.master) {
        this.master.gain.setTargetAtTime(this.enabled ? 0.32 : 0, this.ctx.currentTime, 0.02);
      }
    }

    tone(freq, opts) {
      if (!this.ready || !this.enabled) return;
      const o = opts || {};
      const t0 = this.ctx.currentTime + (o.delay || 0);
      const dur = o.dur || 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = o.cutoff || 4200;
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + dur);
      const peak = (o.gain == null ? 0.25 : o.gain) * (o.vol == null ? 1 : o.vol);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    noise(dur, vol, cutoff) {
      if (!this.ready || !this.enabled) return;
      const t0 = this.ctx.currentTime;
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = cutoff || 1800;
      filter.Q.value = 0.8;
      const gain = this.ctx.createGain();
      gain.gain.value = vol;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    }

    play(name, data) {
      if (!this.enabled) return;
      if (!this.ready) this.init();
      if (!this.ready) return;
      const d = data || {};
      switch (name) {
        case 'move':
          this.tone(520, { type: 'sine', dur: 0.045, gain: 0.05, cutoff: 2600 });
          break;
        case 'rotate':
          this.tone(680, { type: 'sine', dur: 0.07, gain: 0.075, to: 880, cutoff: 3200 });
          break;
        case 'hold':
          this.tone(420, { type: 'sine', dur: 0.09, gain: 0.07, to: 620, cutoff: 2600 });
          break;
        case 'lock':
          this.tone(150, { type: 'sine', dur: 0.11, gain: 0.16, to: 92, cutoff: 1200 });
          this.noise(0.06, 0.035, 900);
          break;
        case 'harddrop':
          this.tone(110, { type: 'sine', dur: 0.16, gain: 0.2, to: 60, cutoff: 900 });
          this.noise(0.09, 0.05, 700);
          break;
        case 'clear': {
          const n = Math.min(4, Math.max(1, d.count || 1));
          const chords = [
            [523.25, 659.25, 783.99],
            [523.25, 659.25, 783.99, 1046.5],
            [587.33, 739.99, 880.0, 1174.66],
            [659.25, 830.61, 987.77, 1318.51],
          ];
          const notes = chords[n - 1] || chords[0];
          notes.forEach((f, i) => {
            this.tone(f, { type: 'triangle', dur: 0.32, gain: 0.12, delay: i * 0.035, cutoff: 6000 });
            this.tone(f / 2, { type: 'sine', dur: 0.28, gain: 0.06, delay: i * 0.035, cutoff: 1200 });
          });
          if (n === 4) {
            this.tone(1567.98, { type: 'sine', dur: 0.5, gain: 0.07, delay: 0.16, cutoff: 7000 });
            this.tone(2093.0, { type: 'sine', dur: 0.45, gain: 0.045, delay: 0.2, cutoff: 8000 });
          }
          break;
        }
        case 'levelup':
          this.tone(783.99, { type: 'triangle', dur: 0.22, gain: 0.1 });
          this.tone(1046.5, { type: 'triangle', dur: 0.3, gain: 0.1, delay: 0.1 });
          this.tone(1318.51, { type: 'triangle', dur: 0.34, gain: 0.08, delay: 0.2 });
          break;
        case 'over':
          this.tone(392, { type: 'triangle', dur: 0.3, gain: 0.12, to: 370 });
          this.tone(329.63, { type: 'triangle', dur: 0.34, gain: 0.12, delay: 0.16 });
          this.tone(261.63, { type: 'triangle', dur: 0.55, gain: 0.12, delay: 0.34 });
          break;
        case 'tap':
          this.tone(1200, { type: 'sine', dur: 0.035, gain: 0.05, cutoff: 5000 });
          break;
        case 'start':
          this.tone(523.25, { type: 'triangle', dur: 0.16, gain: 0.08 });
          this.tone(783.99, { type: 'triangle', dur: 0.24, gain: 0.08, delay: 0.09 });
          break;
        default:
          break;
      }
    }
  }

  const Haptics = {
    enabled: true,
    bridge: null,
    buzz(ms) {
      if (!this.enabled) return;
      if (this.bridge) {
        try {
          this.bridge.vibrate(ms);
          return;
        } catch (e) {
          /* fall through */
        }
      }
      if (navigator.vibrate) {
        try {
          navigator.vibrate(ms);
        } catch (e) {
          /* ignore */
        }
      }
    },
    light() {
      this.buzz(8);
    },
    medium() {
      this.buzz(14);
    },
    heavy() {
      this.buzz(22);
    },
  };

  global.PrismAudio = { SoundKit: SoundKit, Haptics: Haptics };
})(window);
