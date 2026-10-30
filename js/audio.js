// Tiny synthesized sound kit, so the game needs no audio files.
let ctx = null;
let master = null;
let noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { freq = 2000, q = 1, vol = 0.3, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  hit(power = 0.5, smash = false) {
    const p = 0.6 + power * 0.6;
    noise(0.05, { freq: 2600, q: 2, vol: 0.5 * p });
    tone(1050 + power * 300, 0.07, { vol: 0.35 * p, slide: 0.7 });
    tone(520, 0.05, { type: 'triangle', vol: 0.2 * p });
    if (smash) {
      tone(110, 0.35, { type: 'sawtooth', vol: 0.35, slide: 0.4 });
      noise(0.4, { freq: 800, q: 0.7, vol: 0.4, sweep: 0.2, type: 'lowpass' });
    }
  },
  bounce(v = 1) {
    const k = Math.min(1, v / 4);
    tone(1500, 0.04, { vol: 0.25 * k + 0.05, slide: 0.8 });
    noise(0.025, { freq: 4000, q: 3, vol: 0.15 * k });
  },
  net() {
    tone(180, 0.18, { type: 'triangle', vol: 0.4, slide: 0.6 });
    noise(0.12, { freq: 600, q: 1, vol: 0.25 });
  },
  floor() {
    tone(700, 0.06, { vol: 0.12, slide: 0.7 });
  },
  whoosh(power = 0.5) {
    noise(0.18, { freq: 500, q: 1.5, vol: 0.12 + power * 0.15, sweep: 4 });
  },
  point(win) {
    const notes = win ? [523, 659, 784, 1047] : [440, 370, 311];
    notes.forEach((n, i) => tone(n, 0.18, { type: 'square', vol: 0.12, delay: i * 0.08 }));
  },
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((n, i) => tone(n, 0.25, { type: 'square', vol: 0.12, delay: i * 0.11 }));
  },
  blip() {
    tone(880, 0.06, { type: 'square', vol: 0.08 });
  },
  join() {
    tone(660, 0.08, { type: 'square', vol: 0.1 });
    tone(990, 0.12, { type: 'square', vol: 0.1, delay: 0.08 });
  },
};
