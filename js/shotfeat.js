// Shot recognition shared by the phone (calibration) and the tennis host (live play).
// A swing is boiled down to a small feature vector taken around its fastest moment:
// which way the racket head travelled, which way the face pointed, where the racket head was
// (overhead for serves), the wrist's rotation axis, and how fast it went.
// Each calibrated shot keeps the average and spread of its recordings; a live swing is matched to
// the nearest one, measured in "spreads" so steady features count more than wobbly ones.

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mag = (a) => Math.hypot(a[0], a[1], a[2]);

// Version 2 features don't depend on which way the phone believes "forward" is. Phone sensors
// drift around the vertical axis (badly so after hard swings), so everything here is either a
// vertical component (gravity keeps those honest) or an angle between two of the swing's own
// vectors, which no drift can change.
export const FEAT_VERSION = 2;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Groups of features with their weight and the smallest spread we trust.
const PARTS = [
  { key: 'dirY', n: 1, w: 1.3, floor: 0.16 },    // swing going up (topspin, lob) or down (slice)
  { key: 'rise', n: 1, w: 1.0, floor: 0.18 },    // path curving upward through the swing
  { key: 'faceY', n: 1, w: 1.1, floor: 0.16 },   // face open to the sky or closed over
  { key: 'headY', n: 1, w: 1.0, floor: 0.18 },   // racket head up (serves) or down (low balls)
  { key: 'axisY', n: 1, w: 1.4, floor: 0.2 },    // turning left or right: forehand vs backhand
  { key: 'faceDir', n: 1, w: 0.9, floor: 0.18 }, // face square to the swing (flat) or brushing it
  { key: 'headDir', n: 1, w: 0.6, floor: 0.2 },
  { key: 'speed', n: 1, w: 1.0, floor: 0.22 },   // log of peak racket-head speed
];
export const FEAT_LEN = PARTS.reduce((a, p) => a + p.n, 0);

// samples: [{ t, v:[3], w:[3], h:[3], n:[3] }]. Returns null if there is no real movement.
export function shotFeatures(samples) {
  if (!samples || samples.length < 3) return null;
  let peak = 0, peakI = 0;
  samples.forEach((s, i) => { const m = mag(s.v); if (m > peak) { peak = m; peakI = i; } });
  if (peak < 0.4) return null;
  const strong = samples.filter((s) => mag(s.v) >= peak * 0.5);
  const sum = (f, list = strong) => list.reduce((a, s) => { const x = f(s); return [a[0] + x[0], a[1] + x[1], a[2] + x[2]]; }, [0, 0, 0]);
  const dir = norm(sum((s) => s.v));
  const face = norm(sum((s) => s.n || [0, 0, -1]));
  const head = norm(sum((s) => s.h || [0, 1, 0]));
  const axis = norm(sum((s) => s.w || [0, 0, 0]));
  // Upward curve: vertical share of the motion in the second half of the fast part minus the first.
  const half = Math.max(1, Math.floor(strong.length / 2));
  const vy = (list) => { const d = norm(sum((s) => s.v, list)); return d[1]; };
  const rise = strong.length >= 2 ? vy(strong.slice(half)) - vy(strong.slice(0, half)) : 0;
  const vec = [dir[1], rise, face[1], head[1], axis[1], Math.abs(dot(face, dir)), dot(head, dir), Math.log(peak)];
  return { vec, peak, peakT: samples[peakI].t };
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
    v: FEAT_VERSION,
    mu: mu.map((x) => +x.toFixed(3)),
    sd: sd.map((x) => +Math.sqrt(x).toFixed(3)),
    peak: +(fs.map((f) => f.peak).sort((a, b) => a - b)[Math.floor(fs.length / 2)]).toFixed(2),
  };
}

// True when a stored model was made with the current feature set.
export const modelOk = (m) => !!m && m.v === FEAT_VERSION && Array.isArray(m.mu) && m.mu.length === FEAT_LEN;

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

// Nearest calibrated shot among `names`. Returns { name, dist, second, secondDist } or null.
export function classify(vec, models, names) {
  let best = null, second = null;
  for (const name of names) {
    const m = models[name];
    if (!modelOk(m)) continue;
    const dist = shotDistance(vec, m);
    if (!best || dist < best.dist) { second = best; best = { name, dist }; }
    else if (!second || dist < second.dist) second = { name, dist };
  }
  if (best && second) { best.second = second.name; best.secondDist = second.dist; }
  return best;
}

// Leave-one-out check of a calibration: for each recording, which shot would the others call it?
// Returns pairs of shots that got mixed up, worst first: [{ a, b, n }].
export function confusions(featsByShot) {
  const keys = Object.keys(featsByShot).filter((k) => featsByShot[k]?.length >= 2);
  const mix = {};
  for (const k of keys) {
    featsByShot[k].forEach((f, i) => {
      const models = {};
      for (const j of keys) {
        const list = j === k ? featsByShot[j].filter((_, x) => x !== i) : featsByShot[j];
        models[j] = shotModel(list);
      }
      const c = classify(f.vec, models, keys);
      if (c && c.name !== k) { const id = [k, c.name].sort().join('|'); mix[id] = (mix[id] || 0) + 1; }
    });
  }
  return Object.entries(mix).map(([id, n]) => { const [a, b] = id.split('|'); return { a, b, n }; }).sort((x, y) => y.n - x.n);
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
