// Shot-specific stroke animations, built from the Smol Tennis strokes by reshaping their key
// poses: where the racket goes (low-to-high for topspin, high-to-low for slice, long and level
// for flat), how far the body loads and uncoils, and a deliberately exaggerated, held finish.
// Registers new clips in CLIPS: fhFlat fhTop fhSlice bhFlat bhTop bhSlice dropFh dropBh
// srvFlat srvKick srvSlice.
import * as THREE from 'three';
import { CLIPS } from './smol.js';

const clone = (p) => JSON.parse(JSON.stringify(p));
const READY = clone(CLIPS.ready.keys[0].pose);
const BODY = ['hips', 'torso', 'thighR', 'shinR', 'thighL', 'shinL'];

const q = new THREE.Quaternion(), e = new THREE.Euler();
const quat = (r) => new THREE.Quaternion().setFromEuler(e.set(r[0], r[1], r[2]));
// Racket orientation in character space (+z forward, +y up, +x the player's left).
function racketQ(p) {
  return quat(p.root).multiply(quat(p.hips)).multiply(quat(p.torso)).multiply(quat(p.uArmR)).multiply(quat(p.fArmR)).multiply(quat(p.racket));
}
function getAim(p) {
  const r = racketQ(p);
  return { dir: new THREE.Vector3(0, 0, 1).applyQuaternion(r), face: new THREE.Vector3(1, 0, 0).applyQuaternion(r) };
}
function setAim(p, dir, face) {
  const chain = quat(p.root).multiply(quat(p.hips)).multiply(quat(p.torso)).multiply(quat(p.uArmR)).multiply(quat(p.fArmR));
  const z = dir.clone().normalize();
  const x = face.clone().addScaledVector(z, -face.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const r = new THREE.Euler().setFromQuaternion(chain.invert().multiply(want));
  p.racket = [r.x, r.y, r.z];
}

// One key edit. Bone values are added to the pose; `deep` pushes the body further from ready;
// the racket keeps its aim in space unless told otherwise, then `tip` raises (+) or drops (-)
// the racket head and `open` rolls the face open toward the sky (+) or closed (-), in radians.
// `aimDir`/`aimFace` set the racket outright.
function edit(src, o = {}) {
  const p = clone(src);
  const before = getAim(p);
  if (o.deep) {
    for (const b of BODY) p[b] = p[b].map((v, i) => READY[b][i] + (v - READY[b][i]) * o.deep);
    p.lift = READY.lift + (p.lift - READY.lift) * o.deep;
  }
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v) && p[k] && k !== 'aimDir' && k !== 'aimFace') p[k] = p[k].map((x, i) => x + v[i]);
  }
  if (o.lift) p.lift += o.lift;
  let { dir, face } = o.keepAim === false ? getAim(p) : before;
  if (o.aimDir) dir = new THREE.Vector3(...o.aimDir).normalize();
  if (o.aimFace) face = new THREE.Vector3(...o.aimFace).normalize();
  if (o.tip) {
    const axis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
    if (axis.lengthSq() > 1e-4) {
      q.setFromAxisAngle(axis.normalize(), o.tip);
      dir = dir.clone().applyQuaternion(q); face = face.clone().applyQuaternion(q);
    }
  }
  if (o.open) {
    // Roll about the racket's own axis, picking the direction that turns the face upward.
    const a = new THREE.Quaternion().setFromAxisAngle(dir, o.open), b = new THREE.Quaternion().setFromAxisAngle(dir, -o.open);
    const fa = face.clone().applyQuaternion(a), fb = face.clone().applyQuaternion(b);
    face = (Math.sign(o.open) > 0) === (fa.y > fb.y) ? fa : fb;
  }
  setAim(p, dir, face);
  return p;
}

function make(base, duration, keys, contact) {
  return { duration, loop: false, contact, keys: keys.map(([t, pose, hold]) => ({ t, pose, hold })) };
}
const K = (name) => CLIPS[name].keys.map((k) => k.pose);

// ---------- Forehands ----------
{
  const [BACK, DROP, HIT, EXT, FOL, FOL2] = K('forehand');
  // Topspin: racket drops way below the ball, knees bent deep, then the whole body drives up
  // (a little hop), racket brushing up the back of the ball and finishing high: the "buggy whip".
  CLIPS.fhTop = make('forehand', 0.86, [
    [0, edit(BACK, { deep: 1.25, tip: -0.2 })],
    [0.09, edit(DROP, { deep: 1.45, lift: -0.08, uArmR: [0.45, 0, 0], tip: -0.45 })],
    [0.16, edit(HIT, { deep: 1.1, lift: 0.04, uArmR: [0.2, 0, 0], tip: 0.35, open: -0.2 })],
    [0.24, edit(EXT, { lift: 0.14, uArmR: [-0.25, 0, 0], fArmR: [-0.3, 0, 0], tip: 0.35, keepAim: false })],
    [0.36, edit(FOL, { deep: 1.3, lift: 0.08, uArmR: [-0.3, 0, 0], fArmR: [-0.2, 0, 0], keepAim: false })],
    [0.6, edit(FOL2, { deep: 1.25, uArmR: [-0.3, 0, 0], fArmR: [-0.2, 0, 0], keepAim: false }), true],
    [0.86, READY],
  ], 0.16);
  // Flat: a level take-back, racket head on the line of the ball, arm long through contact and a
  // long reach out at the target held for a beat before it comes round, finishing lower.
  CLIPS.fhFlat = make('forehand', 0.86, [
    [0, edit(BACK, { deep: 1.3, uArmR: [0.15, 0, 0], tip: -0.35 })],
    [0.09, edit(DROP, { deep: 1.35, uArmR: [-0.15, 0, 0], tip: 0.35 })],
    [0.16, edit(HIT, { deep: 1.2, uArmR: [-0.1, 0, 0], open: -0.05 })],
    [0.25, edit(EXT, { deep: 1.35, lift: -0.04, uArmR: [0.35, 0, 0.1], fArmR: [0.4, 0, 0], aimDir: [0.05, 0.05, 1], aimFace: [1, 0, 0], keepAim: false })],
    [0.38, edit(EXT, { deep: 1.35, lift: -0.05, uArmR: [0.4, 0.15, 0.4], fArmR: [0.2, 0, 0], aimDir: [0.6, 0, 0.8], aimFace: [0.8, 0, -0.6], keepAim: false }), true],
    [0.58, edit(FOL2, { deep: 1.2, uArmR: [0.4, 0, 0], tip: -0.3, keepAim: false })],
    [0.86, READY],
  ], 0.16);
  // Slice: racket set high with an open face, then it carves down and forward under the ball,
  // body staying low and leaning in, finishing long and low out in front.
  const HIGH = edit(BACK, { deep: 1.25, uArmR: [-0.55, 0, -0.2], fArmR: [-0.3, 0, 0], aimDir: [-0.35, 0.85, -0.4], aimFace: [0, 0.4, 1], keepAim: false });
  CLIPS.fhSlice = make('forehand', 0.88, [
    [0, HIGH],
    [0.08, edit(HIGH, { deep: 1.1, torso: [0.1, 0.15, 0], uArmR: [0.2, 0, 0], tip: -0.3 })],
    [0.16, edit(HIT, { deep: 1.2, lift: -0.05, torso: [0.12, 0, 0], open: 0.7 })],
    [0.26, edit(EXT, { deep: 1.3, lift: -0.1, torso: [0.25, -0.15, 0], uArmR: [0.55, 0, 0.1], fArmR: [0.4, 0, 0], aimDir: [0.1, -0.15, 1], aimFace: [0.2, 1, 0.1], keepAim: false })],
    [0.42, edit(EXT, { deep: 1.3, lift: -0.12, torso: [0.3, -0.05, 0], uArmR: [0.5, 0, 0.35], fArmR: [0.3, 0, 0], aimDir: [0.4, -0.1, 0.9], aimFace: [0.1, 1, 0], keepAim: false }), true],
    [0.6, edit(FOL2, { deep: 1.1, uArmR: [0.7, 0, 0], tip: -0.5, keepAim: false })],
    [0.88, READY],
  ], 0.16);
  // Drop shot: disguised as the slice, then it softens: short swing, face wide open,
  // racket cradled up under the ball and held there.
  CLIPS.dropFh = make('forehand', 0.95, [
    [0, edit(HIGH, { deep: 0.9 })],
    [0.1, edit(HIGH, { deep: 0.9, uArmR: [0.25, 0, 0], tip: -0.3 })],
    [0.18, edit(HIT, { deep: 1.0, lift: -0.08, torso: [0.15, 0, 0], open: 1.0 })],
    [0.3, edit(HIT, { deep: 1.4, lift: -0.16, torso: [0.25, 0, 0], uArmR: [-0.2, 0, 0.25], aimDir: [-0.3, 0.1, 1], aimFace: [0, 1, -0.1], keepAim: false })],
    [0.6, edit(HIT, { deep: 1.4, lift: -0.18, torso: [0.25, 0, 0], uArmR: [-0.25, 0, 0.3], aimDir: [-0.2, 0.3, 1], aimFace: [0, 1, -0.3], keepAim: false }), true],
    [0.95, READY],
  ], 0.18);
}

// ---------- Backhands (two-handed for drive strokes, one-handed for slice and drop) ----------
{
  const [BACK, DROP, HIT, EXT, FOL, FOL2] = K('backhand');
  CLIPS.bhTop = make('backhand', 0.86, [
    [0, edit(BACK, { deep: 1.25, tip: -0.2 })],
    [0.09, edit(DROP, { deep: 1.45, lift: -0.08, tip: -0.5 })],
    [0.16, edit(HIT, { deep: 1.1, lift: 0.04, tip: 0.35, open: -0.2 })],
    [0.24, edit(EXT, { lift: 0.14, tip: 0.8 })],
    [0.36, edit(FOL, { deep: 1.3, lift: 0.08, tip: 0.6 })],
    [0.6, edit(FOL2, { deep: 1.25, tip: 0.5 }), true],
    [0.86, READY],
  ], 0.16);
  CLIPS.bhFlat = make('backhand', 0.86, [
    [0, edit(BACK, { deep: 1.3, tip: -0.3 })],
    [0.09, edit(DROP, { deep: 1.35, tip: 0.35 })],
    [0.16, edit(HIT, { deep: 1.2 })],
    [0.25, edit(EXT, { deep: 1.35, lift: -0.04, aimDir: [-0.05, 0.05, 1], aimFace: [-1, 0, 0] })],
    [0.38, edit(EXT, { deep: 1.35, lift: -0.05, aimDir: [-0.55, 0.1, 0.8], aimFace: [-0.8, 0, -0.55] }), true],
    [0.58, edit(FOL2, { deep: 1.2, tip: -0.3 })],
    [0.86, READY],
  ], 0.16);
  const [B1, , H1, E1] = K('backhand1');
  const HIGH = edit(B1, { deep: 1.25, tip: 0.5, open: 0.4 });
  CLIPS.bhSlice = make('backhand1', 0.88, [
    [0, HIGH],
    [0.08, edit(HIGH, { deep: 1.1, tip: -0.2 })],
    [0.16, edit(H1, { deep: 1.2, lift: -0.05, torso: [0.12, 0, 0], open: 0.7 })],
    [0.26, edit(E1, { deep: 1.3, lift: -0.1, torso: [0.25, 0, 0], aimDir: [-0.1, -0.15, 1], aimFace: [-0.2, 1, 0.1] })],
    [0.42, edit(E1, { deep: 1.3, lift: -0.12, torso: [0.3, 0, 0], aimDir: [-0.45, -0.05, 0.9], aimFace: [-0.1, 1, 0] }), true],
    [0.62, edit(E1, { deep: 1.15, lift: -0.06, torso: [0.2, 0, 0], aimDir: [-0.6, -0.3, 0.7], aimFace: [0, 1, 0] })],
    [0.88, READY],
  ], 0.16);
  CLIPS.dropBh = make('backhand1', 0.95, [
    [0, edit(HIGH, { deep: 0.9 })],
    [0.1, edit(HIGH, { deep: 0.9, tip: -0.3 })],
    [0.18, edit(H1, { deep: 1.0, lift: -0.08, torso: [0.15, 0, 0], open: 1.0 })],
    [0.3, edit(H1, { deep: 1.0, lift: -0.1, torso: [0.2, 0, 0], aimDir: [0.3, 0.1, 1], aimFace: [0, 1, -0.1] })],
    [0.6, edit(H1, { deep: 1.0, lift: -0.1, torso: [0.2, 0, 0], aimDir: [0.2, 0.25, 1], aimFace: [0, 1, -0.2] }), true],
    [0.95, READY],
  ], 0.18);
}

// ---------- Serves (keys: trophy, drive, drop, hit, pronate, land, finish, ready) ----------
{
  const [TRO, DRV, DRP, HIT, PRO, LAND, FIN] = K('serve');
  // Flat: everything bigger: deeper knee bend, a real leap into the ball, slammed landing.
  CLIPS.srvFlat = make('serve', 1.0, [
    [0, edit(TRO, { deep: 1.25, lift: -0.06 })],
    [0.08, edit(DRV, { deep: 1.2 })],
    [0.15, edit(DRP, { deep: 1.2, lift: 0.08 })],
    [0.22, edit(HIT, { lift: 0.32, uArmR: [-0.1, 0, 0] })],
    [0.3, edit(PRO, { lift: 0.3, deep: 1.2 })],
    [0.44, edit(LAND, { deep: 1.35, lift: -0.06 })],
    [0.7, edit(FIN, { deep: 1.25 }), true],
    [1.0, READY],
  ], 0.22);
  // Kick: arched right back under the ball, racket whipping up and out, finishing on the
  // racket side instead of across the body.
  CLIPS.srvKick = make('serve', 1.0, [
    [0, edit(TRO, { deep: 1.2, torso: [-0.35, 0.1, 0], head: [-0.25, 0, 0], lift: -0.08 })],
    [0.08, edit(DRV, { torso: [-0.4, 0, 0] })],
    [0.15, edit(DRP, { torso: [-0.3, 0, 0], lift: 0.06, tip: -0.3 })],
    [0.22, edit(HIT, { lift: 0.26, torso: [-0.15, -0.1, 0], uArmR: [0, 0, -0.25], tip: 0.3, open: 0.25 })],
    [0.32, edit(HIT, { lift: 0.24, torso: [0.05, -0.2, 0], uArmR: [0.1, 0, -0.75], aimDir: [-0.7, 0.6, 0.3], keepAim: false })],
    [0.46, edit(LAND, { deep: 1.2, torso: [0, -0.35, 0], uArmR: [0.2, 0, -0.6], keepAim: false })],
    [0.7, edit(LAND, { deep: 1.2, lift: 0.02, torso: [-0.05, -0.35, 0], uArmR: [0.4, 0, -0.5], keepAim: false }), true],
    [1.0, READY],
  ], 0.22);
  // Slice serve: hit round the side of the ball, then the whole body corkscrews over and
  // the racket wraps hard across to the far hip.
  CLIPS.srvSlice = make('serve', 1.0, [
    [0, edit(TRO, { deep: 1.2, torso: [0, -0.25, 0] })],
    [0.08, edit(DRV, { torso: [0, -0.2, 0] })],
    [0.15, edit(DRP, { lift: 0.06 })],
    [0.22, edit(HIT, { lift: 0.24, open: -0.5, tip: -0.15 })],
    [0.3, edit(PRO, { lift: 0.2, torso: [0.15, 0.35, 0] })],
    [0.44, edit(LAND, { deep: 1.3, torso: [0.15, 0.45, 0] })],
    [0.7, edit(FIN, { deep: 1.3, torso: [0.1, 0.4, 0] }), true],
    [1.0, READY],
  ], 0.22);
}

export const STROKE_CLIPS = ['fhFlat', 'fhTop', 'fhSlice', 'bhFlat', 'bhTop', 'bhSlice', 'dropFh', 'dropBh', 'srvFlat', 'srvKick', 'srvSlice'];
