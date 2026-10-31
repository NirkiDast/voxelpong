// Shot recognition shared by the phone (calibration) and the tennis host (live play).
// A swing is boiled down to a small feature vector taken around its fastest moment:
// which way the racket head travelled, which way the face pointed, where the racket head was
// (overhead for serves), the wrist's rotation axis, and how fast it went.
// Each calibrated shot keeps the average and spread of its recordings; a live swing is matched to
// the nearest one, measured in "spreads" so steady features count more than wobbly ones.

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mag = (a) => Math.hypot(a[0], a[1], a[2]);

// Groups of features with their weight and the smallest spread we trust.
const PARTS = [
  { key: 'dir', n: 3, w: 1.2, floor: 0.22 },
  { key: 'face', n: 3, w: 1.0, floor: 0.25 },
  { key: 'head', n: 3, w: 0.7, floor: 0.25 },
  { key: 'axis', n: 3, w: 0.8, floor: 0.3 },
  { key: 'speed', n: 1, w: 0.9, floor: 0.25 },
];

// samples: [{ t, v:[3], w:[3], h:[3], n:[3] }]. Returns null if there is no real movement.
export function shotFeatures(samples) {
  if (!samples || samples.length < 3) return null;
  let peak = 0, peakI = 0;
  samples.forEach((s, i) => { const m = mag(s.v); if (m > peak) { peak = m; peakI = i; } });
  if (peak < 0.4) return null;
  const strong = samples.filter((s) => mag(s.v) >= peak * 0.5);
  const sum = (f) => strong.reduce((a, s) => { const x = f(s); return [a[0] + x[0], a[1] + x[1], a[2] + x[2]]; }, [0, 0, 0]);
  const dir = norm(sum((s) => s.v));
  const face = norm(sum((s) => s.n || [0, 0, -1]));
  const head = norm(sum((s) => s.h || [0, 1, 0]));
  const axis = norm(sum((s) => s.w || [0, 0, 0]));
  const speed = [Math.log(peak)];
  return { vec: [...dir, ...face, ...head, ...axis, ...speed], peak, peakT: samples[peakI].t };
}

// From several recordings of one shot: mean and spread per feature.
export function shotModel(featList) {
  const fs = featList.filter(Boolean);
  if (!fs.length) return null;
  const n = fs[0].vec.length;
  const mu = new Array(n).fill(0), sd = new Array(n).fill(0);
  for (const f of fs) f.vec.forEach((x, i) => { mu[i] += x / fs.length; });
  for (const f of fs) f.vec.forEach((x, i) => { sd[i] += (x - mu[i]) ** 2 / fs.length; });
  return {
    mu: mu.map((x) => +x.toFixed(3)),
    sd: sd.map((x) => +Math.sqrt(x).toFixed(3)),
    peak: +(fs.map((f) => f.peak).sort((a, b) => a - b)[Math.floor(fs.length / 2)]).toFixed(2),
  };
}

export function shotDistance(vec, model) {
  let d = 0, i = 0;
  for (const p of PARTS) {
    for (let k = 0; k < p.n; k++, i++) {
      const s = Math.max(model.sd[i] * 1.5, p.floor);
      d += p.w * ((vec[i] - model.mu[i]) / s) ** 2;
    }
  }
  return Math.sqrt(d);
}

// Nearest calibrated shot among `names`. Returns { name, dist } or null.
export function classify(vec, models, names) {
  let best = null;
  for (const name of names) {
    const m = models[name];
    if (!m) continue;
    const dist = shotDistance(vec, m);
    if (!best || dist < best.dist) best = { name, dist };
  }
  return best;
}

// The calibration steps, in order. `kind` groups what the game does with each.
export const TENNIS_SHOTS = [
  { key: 'fhFlat', title: 'FLAT FOREHAND', text: 'A clean, hard forehand straight through the ball.' },
  { key: 'fhTop', title: 'TOPSPIN FOREHAND', text: 'Forehand brushing up the back of the ball: start low, finish high.' },
  { key: 'fhSlice', title: 'FOREHAND SLICE', text: 'Forehand from high to low with an open racket face, cutting under the ball.' },
  { key: 'bhFlat', title: 'FLAT BACKHAND', text: 'A clean, hard backhand straight through the ball.' },
  { key: 'bhTop', title: 'TOPSPIN BACKHAND', text: 'Backhand brushing up: start low, finish high.' },
  { key: 'bhSlice', title: 'BACKHAND SLICE', text: 'Backhand from high to low with an open racket face, cutting under the ball.' },
  { key: 'lob', title: 'LOB', text: 'Lift the ball high over the net: open face, swing upward.' },
  { key: 'drop', title: 'DROP SHOT', text: 'A soft, short touch with an open face, as if to just clear the net.' },
  { key: 'toss', title: 'SERVE TOSS', text: 'The toss before a serve: lift the phone up smoothly, like releasing the ball.' },
  { key: 'srvFlat', title: 'FLAT SERVE', text: 'Your full service motion, hitting hard and straight through the ball. Hold from the take-back to the finish.' },
  { key: 'srvSpin', title: 'SPIN (SLICE) SERVE', text: 'Full service motion brushing across the side of the ball, so it curves away. Hold from the take-back to the finish.' },
  { key: 'srvKick', title: 'KICK SERVE', text: 'Full service motion brushing up the back of the ball, low to high, finishing up and over. Hold from the take-back to the finish.' },
];
