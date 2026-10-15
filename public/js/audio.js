/* Tiny WebAudio sound effects — no audio files needed. */
(function () {
  'use strict';
  const EK = (window.EK = window.EK || {});
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('ek_muted') === '1'; } catch (e) { /* ignore */ }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo, delay) {
    const a = ac();
    if (!a || muted) return;
    const t0 = a.currentTime + (delay || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, freq) {
    const a = ac();
    if (!a || muted) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq || 800;
    const g = a.createGain();
    g.gain.value = vol || 0.3;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  }

  EK.sfx = {
    unlock() { ac(); },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('ek_muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
    juggle() { tone(220, 0.06, 'sine', 0.08, 160); },
    kick(q) {
      tone(110, 0.18, 'sine', 0.5, 45);
      noise(0.08, 0.35, 1800);
      if (q > 0.95) tone(880, 0.25, 'triangle', 0.12, 1760, 0.04);
    },
    whiff() { noise(0.25, 0.2, 500); tone(300, 0.3, 'sawtooth', 0.05, 120); },
    bounce(v) { tone(140 + Math.min(v, 40) * 6, 0.08, 'sine', Math.min(0.25, 0.05 + v / 120), 90); },
    pad() { tone(200, 0.35, 'square', 0.12, 900); },
    splash() { noise(0.35, 0.35, 1200); },
    target(mult) {
      const notes = mult >= 3 ? [523, 659, 784, 1047] : mult === 2 ? [523, 659, 784] : [523, 659];
      notes.forEach((n, i) => tone(n, 0.18, 'triangle', 0.15, null, i * 0.09));
    },
    coin() { tone(988, 0.08, 'square', 0.08, null); tone(1319, 0.2, 'square', 0.08, null, 0.08); },
    click() { tone(600, 0.04, 'sine', 0.06); },
    levelUp() { [392, 523, 659, 784, 1047].forEach((n, i) => tone(n, 0.2, 'triangle', 0.14, null, i * 0.1)); },
  };
})();
