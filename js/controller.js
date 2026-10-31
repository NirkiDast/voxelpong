// Phone controller: reads tilt + swing from motion sensors (or touch) and streams them to the PC.
import { Controller } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = new URLSearchParams(location.search);
const slot = Number(params.get('slot')) === 2 ? 2 : 1;
let room = (params.get('room') || '').toUpperCase();

const ME = slot === 2 ? '#ff3d9a' : '#29e7ff';
document.documentElement.style.setProperty('--me', ME);
$('who').innerHTML = `PLAYER ${slot}<br>PADDLE`;

const state = { x: 0, y: 0, mode: 'motion', sentX: 9, sentY: 9, lastSend: 0 };
let link = null;

// ---------- Screens ----------
function show(id) {
  for (const s of ['join', 'setup', 'calib', 'play']) $(s).classList.toggle('hide', s !== id);
}

if (!room) show('join');
else boot();

$('joinBtn').addEventListener('click', () => {
  room = $('roomInput').value.trim().toUpperCase();
  if (room.length < 4) return;
  history.replaceState(null, '', `?room=${room}&slot=${slot}`);
  boot();
});

function boot() {
  show('setup');
  link = new Controller({
    room, slot,
    onStatus(s) {
      const ok = s === 'connected';
      $('dot').classList.toggle('ok', ok);
      $('conn').textContent = {
        connecting: 'Connecting…', connected: `P${slot} · room ${room}`,
        nohost: 'Big screen not found, retrying…', lost: 'Connection lost, retrying…',
      }[s] || s;
      if (ok) { buzz('join'); if (profile) link.send({ t: 'prof', ...profile }); }
    },
    onData,
  });
}

// ---------- Messages from the PC ----------
function onData(m) {
  if (!m) return;
  if (m.t === 'ping') link.sendFast({ t: 'pong', ts: m.ts });
  else if (m.t === 'hap') { buzz(m.k, m.p); if (m.k === 'hit' || m.k === 'smash') flashHit(m.k === 'smash'); }
  else if (m.t === 'st') {
    $('you').textContent = m.you ?? 0;
    $('them').textContent = m.them ?? 0;
    $('startBtn').classList.toggle('hide', !(m.demo || m.mode === 'over'));
    $('cue').textContent = m.serve ? 'YOUR SERVE: SWING!' : m.point === 'won' ? 'POINT!' : '';
  }
}

// ---------- Haptics ----------
// Android: Vibration API. iOS has no vibrate(); on iOS 18+ toggling a switch input gives a light tick.
const canVibrate = typeof navigator.vibrate === 'function';
function tick(times = 1, gap = 60) {
  for (let i = 0; i < times; i++) setTimeout(() => $('hapticLabel').click(), i * gap);
}
function buzz(kind, power = 0.5) {
  const patterns = {
    hit: [Math.round(25 + power * 45)],
    smash: [90, 30, 60],
    win: [40, 60, 40, 60, 120],
    lose: [200],
    join: [30, 40, 30],
  };
  const pat = patterns[kind] || [30];
  if (canVibrate) navigator.vibrate(pat);
  else tick(kind === 'smash' ? 3 : kind === 'win' ? 4 : 1);
}

function flashHit(smash) {
  const f = $('hitFlash');
  f.style.transition = 'none';
  f.style.opacity = smash ? 1 : 0.7;
  requestAnimationFrame(() => { f.style.transition = 'opacity 0.3s'; f.style.opacity = 0; });
  $('paddle').style.filter = `brightness(2.2) drop-shadow(0 0 20px ${ME})`;
  setTimeout(() => { $('paddle').style.filter = ''; }, 120);
}

// ---------- Racket motion ----------
// The phone is the racket handle. We track its full 3D orientation and the speed of the racket head,
// and send both to the PC in "player space": x = your right, y = up, z = toward you (the table is -z).
//  - Orientation: Chrome's RelativeOrientationSensor (gyro + accelerometer fusion, low latency) when
//    available, otherwise deviceorientation (iPhone).
//  - Racket-head velocity: angular velocity x racket length, plus a short-term estimate from linear
//    acceleration, so both wrist flicks and arm pushes count.
const RACKET_LEN = 0.45;      // metres from grip to the middle of the blade
let qDev = null;              // device -> world quaternion [x, y, z, w]
let wDev = [0, 0, 0];         // angular velocity, device frame, rad/s
let aDev = [0, 0, 0];         // linear acceleration (no gravity), device frame, m/s^2
let frame = null;             // { F, U, R } world-space forward/up/right captured at recenter
let vLin = [0, 0, 0];
let lastPoseT = 0;
let sensorKind = 'none';

const rates = { ori: 0, mot: 0, sent: 0 };
setInterval(() => {
  link?.send({ t: 'diag', ori: rates.ori, mot: rates.mot, sent: rates.sent, gyro: sensorKind, mode: state.mode, ua: navigator.userAgent.slice(0, 90) });
  rates.ori = rates.mot = rates.sent = 0;
}, 1000);

// --- small vector / quaternion helpers ---
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qrot(q, v) {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
  return [p[0], p[1], p[2]];
}
// deviceorientation angles (Z-X'-Y'' intrinsic, degrees) -> quaternion.
function qFromEuler(alpha, beta, gamma) {
  const r = Math.PI / 360;
  const qz = [0, 0, Math.sin(alpha * r), Math.cos(alpha * r)];
  const qx = [Math.sin(beta * r), 0, 0, Math.cos(beta * r)];
  const qy = [0, Math.sin(gamma * r), 0, Math.cos(gamma * r)];
  return qmul(qmul(qz, qx), qy);
}

async function enableMotion() {
  $('setupErr').textContent = '';
  try {
    if (!window.isSecureContext) throw new Error('Motion sensors need an https:// address. Use touch controls, or open the hosted version.');
    const DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const a = await DOE.requestPermission();
      const b = DME && typeof DME.requestPermission === 'function' ? await DME.requestPermission() : 'granted';
      if (a !== 'granted' || b !== 'granted') throw new Error('Motion access was denied. You can use touch controls instead.');
    }
    if (!startGenericSensors()) startLegacySensors();
    setTimeout(() => {
      if (!qDev) $('setupErr').textContent = 'No motion data yet. If nothing happens, try touch controls.';
    }, 1500);
    state.mode = 'motion';
    frame = null;
    startCalibration();
  } catch (e) {
    $('setupErr').textContent = e.message;
  }
}

function startGenericSensors() {
  if (!('RelativeOrientationSensor' in window) || !('Gyroscope' in window)) return false;
  try {
    const ori = new RelativeOrientationSensor({ frequency: 60, referenceFrame: 'device' });
    const gyr = new Gyroscope({ frequency: 60 });
    const lin = 'LinearAccelerationSensor' in window ? new LinearAccelerationSensor({ frequency: 60 }) : null;
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      ori.stop(); gyr.stop(); lin?.stop();
      startLegacySensors();
    };
    ori.addEventListener('error', fail);
    gyr.addEventListener('error', fail);
    gyr.addEventListener('reading', () => { wDev = [gyr.x, gyr.y, gyr.z]; rates.mot++; });
    lin?.addEventListener('reading', () => { aDev = [lin.x, lin.y, lin.z]; });
    ori.addEventListener('reading', () => {
      if (failed) return;
      sensorKind = 'sensor-api';
      rates.ori++;
      setPose(Array.from(ori.quaternion), 'sensor');
    });
    ori.start(); gyr.start(); lin?.start();
    // Some browsers expose the API but never deliver readings; fall back if nothing arrives.
    setTimeout(() => { if (sensorKind !== 'sensor-api') startLegacySensors(); }, 1000);
    return true;
  } catch (err) {
    console.warn('Generic sensors unavailable', err);
    return false;
  }
}

let legacyStarted = false;
function startLegacySensors() {
  if (legacyStarted) return;
  legacyStarted = true;
  addEventListener('deviceorientation', (e) => {
    if (e.beta == null || sensorKind === 'sensor-api') return;
    sensorKind = 'deviceorientation';
    rates.ori++;
    setPose(qFromEuler(e.alpha || 0, e.beta, e.gamma || 0), 'sensor');
  });
  addEventListener('devicemotion', (e) => {
    if (sensorKind === 'sensor-api') return;
    rates.mot++;
    const r = e.rotationRate;
    if (r) wDev = [r.beta || 0, r.gamma || 0, r.alpha || 0].map((v) => v * Math.PI / 180);
    const a = e.acceleration;
    if (a) aDev = [a.x || 0, a.y || 0, a.z || 0];
  });
}

// Orientation can come from the motion sensors or, during AR, from the AR camera tracking (Chrome
// may pause sensor events while AR runs). Switching source re-homes the racket automatically.
let poseSrc = null, lastSensorT = 0;
function setPose(q, src) {
  const now = performance.now();
  if (src === 'sensor') lastSensorT = now;
  else if (now - lastSensorT < 150) return; // fresh sensor data wins
  if (src !== poseSrc) { poseSrc = src; frame = null; }
  qDev = q;
  onPose();
}

// Recenter: the current pose becomes "racket upright, face toward the screen".
function calibrate() {
  if (xr.session) xr.frame = null; // AR re-homes position on its next frame
  if (!qDev) return;
  const up = [0, 0, 1];
  let f = qrot(qDev, [0, 0, -1]);          // the back of the phone points at the screen
  f = [f[0], f[1], 0];
  if (Math.hypot(f[0], f[1]) < 0.3) { const t = qrot(qDev, [0, 1, 0]); f = [t[0], t[1], 0]; }
  const F = norm(f);
  frame = { F, U: up, R: cross(F, up) };
  vLin = [0, 0, 0];
}

const toPlayer = (v) => [dot(v, frame.R), dot(v, frame.U), -dot(v, frame.F)];

let swingLock = 0;
function onPose() {
  if (state.mode !== 'motion') return;
  if (!frame) calibrate();
  const now = performance.now();
  const dt = lastPoseT ? clamp((now - lastPoseT) / 1000, 0, 0.05) : 0.016;
  lastPoseT = now;

  const head = toPlayer(qrot(qDev, [0, 1, 0]));   // direction from grip to blade
  const face = toPlayer(qrot(qDev, [0, 0, -1]));  // the hitting face (back of the phone)
  const w = toPlayer(qrot(qDev, wDev));
  const a = toPlayer(qrot(qDev, aDev));
  // Leaky integration gives a short-term arm velocity without long-term drift.
  vLin = add(scale(vLin, Math.exp(-dt * 7)), scale(a, dt));
  // In AR mode the arm's real velocity comes from tracked position instead of the accelerometer.
  const v = add(cross(w, scale(head, RACKET_LEN)), xr.p ? xr.vel : scale(vLin, 0.8));
  if (recording) recording.samples.push({ t: now, v, w });

  state.x = clamp(head[0] / 0.7, -1.5, 1.5);
  state.y = clamp(-face[1] / 0.7, -1.5, 1.5);
  if (now - state.lastSend >= 8) {
    const r3 = (u) => u.map((k) => +k.toFixed(3));
    const msg = { t: 'r', h: r3(head), n: r3(face), v: r3(v), w: r3(w) };
    if (xr.p) msg.p = r3(xr.p);
    link?.sendFast(msg);
    rates.sent++;
    state.lastSend = now;
  }
  // A forward swing also fires a discrete event (used to serve, and for the phone's own feedback).
  const fwd = -v[2];
  const thr = profile ? profile.thr * 1.2 : 1.6;
  const full = profile ? profile.full : 5.6;
  if (!recording && fwd > thr && now > swingLock) {
    swingLock = now + 400;
    sendSwing(clamp((fwd - thr) / (full - thr), 0, 1) * 0.7 + 0.3, clamp(v[0] / 3, -1, 1));
  }
}

// ---------- Full motion: AR position tracking (WebXR + ARCore, Android Chrome) ----------
// The back camera and motion sensors together give the phone's position in the room, in metres.
// Positions are sent relative to where the phone was at recenter, in player space.
const xr = { session: null, ref: null, gl: null, frame: null, p0: null, p: null, last: null, lastT: 0, vel: [0, 0, 0], lastQ: null };
const QX90 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // AR world is y-up; the sensor world is z-up
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

(async () => {
  let ok = false;
  try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { ok = false; }
  $('arBtn').classList.toggle('hide', !ok);
  $('arNote').textContent = ok ? '' : 'Full motion (AR) needs an Android phone with Google Play Services for AR.';
})();

async function toggleAR() {
  if (xr.session) { xr.session.end(); return; }
  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: document.body },
    });
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { xrCompatible: true });
    if (gl.makeXRCompatible) await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    xr.ref = await session.requestReferenceSpace('local');
    Object.assign(xr, { session, gl, frame: null, p: null, last: null, lastQ: null });
    document.documentElement.classList.add('ar');
    $('arBtn').textContent = 'Stop full motion';
    $('cue').textContent = 'FULL MOTION ON';
    session.addEventListener('end', () => {
      Object.assign(xr, { session: null, p: null, frame: null });
      document.documentElement.classList.remove('ar');
      $('arBtn').textContent = 'Full motion (AR)';
      $('cue').textContent = '';
    });
    session.requestAnimationFrame(onXRFrame);
  } catch (e) {
    console.warn('AR failed', e);
    $('cue').textContent = 'AR COULD NOT START';
  }
}

function onXRFrame(t, frameXR) {
  const session = frameXR.session;
  session.requestAnimationFrame(onXRFrame);
  const gl = xr.gl;
  gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const pose = frameXR.getViewerPose(xr.ref);
  if (!pose) { $('cue').textContent = 'AR LOST TRACKING: POINT AT THE ROOM'; xr.p = null; return; }
  const P = pose.transform.position, O = pose.transform.orientation;
  const p = [P.x, P.y, P.z], q = [O.x, O.y, O.z, O.w];
  const now = performance.now();
  if (!xr.frame) {
    let f = qrot(q, [0, 0, -1]);
    f = [f[0], 0, f[2]];
    if (Math.hypot(f[0], f[2]) < 0.3) { const tt = qrot(q, [0, 1, 0]); f = [tt[0], 0, tt[2]]; }
    const F = norm(f), U = [0, 1, 0];
    xr.frame = { F, U, R: cross(F, U) };
    xr.p0 = p; xr.last = null; xr.vel = [0, 0, 0];
  }
  const fr = xr.frame;
  const d = sub(p, xr.p0);
  const rel = [dot(d, fr.R), dot(d, fr.U), -dot(d, fr.F)];
  if (xr.last) {
    const dt = clamp((now - xr.lastT) / 1000, 0.005, 0.1);
    xr.vel = add(scale(xr.vel, 0.35), scale(sub(rel, xr.last), 0.65 / dt));
  }
  xr.last = rel; xr.lastT = now; xr.p = rel;
  if ($('cue').textContent.startsWith('AR LOST')) $('cue').textContent = '';
  // If the motion sensors went quiet during AR, drive the racket angle from the AR pose instead.
  if (now - lastSensorT > 150) {
    if (xr.lastQ) {
      const dq = qmul([-xr.lastQ[0], -xr.lastQ[1], -xr.lastQ[2], xr.lastQ[3]], q); // device-frame delta
      const ang = 2 * Math.acos(clamp(dq[3], -1, 1));
      const sn = Math.sqrt(Math.max(1e-9, 1 - dq[3] * dq[3]));
      const dt = clamp((now - (xr.lastQT || now)) / 1000, 0.005, 0.1);
      wDev = [dq[0] / sn * ang / dt, dq[1] / sn * ang / dt, dq[2] / sn * ang / dt];
    }
    xr.lastQ = q; xr.lastQT = now;
    setPose(qmul(QX90, q), 'xr');
  }
}

// ---------- Swing calibration ----------
// Step 1: face the TV and recenter. Steps 2 and 3: three forehands, then three backhands. For each
// swing the player holds a thumb on the pad from the start of the motion to the end, which cuts the
// recording cleanly. From that we learn how hard this person swings, how long a swing takes, and
// which way their wrist turns on each side. The profile is saved on the phone and sent to the PC.
let profile = null;
try { profile = JSON.parse(localStorage.getItem('vxpp-swing-profile') || 'null'); } catch { /* private mode */ }
let recording = null;
const cal = { step: 0, swings: { fh: [], bh: [] } };
const CAL_STEPS = [
  { key: 'center', title: 'FACE THE TV', text: 'Stand where you will play. Hold the phone like a racket handle: upright, screen facing you, the back pointing at the TV. Then tap the circle.', pad: 'TAP WHEN READY' },
  { key: 'fh', title: 'FOREHAND x3', text: 'Take your racket back first. Then press and hold the circle with your thumb as you start swinging forward, and let go when your follow-through ends.', pad: 'HOLD, SWING, RELEASE' },
  { key: 'bh', title: 'BACKHAND x3', text: 'Same with your backhand: take it back, press and hold as you start swinging forward, and release when the follow-through ends.', pad: 'HOLD, SWING, RELEASE' },
];

function startCalibration() {
  cal.step = 0;
  cal.swings = { fh: [], bh: [] };
  $('calSkip').textContent = profile ? 'Use my last calibration' : 'Skip';
  show('calib');
  renderCal();
  link?.send({ t: 'cal', state: 'start' });
}

function renderCal(msg = '') {
  const st = CAL_STEPS[cal.step];
  $('calStep').textContent = `STEP ${cal.step + 1} OF 3`;
  $('calTitle').textContent = st.title;
  $('calText').textContent = st.text;
  $('holdPad').textContent = st.pad;
  const n = st.key === 'center' ? -1 : cal.swings[st.key].length;
  $('calDots').classList.toggle('hide', n < 0);
  [...$('calDots').children].forEach((d, i) => d.classList.toggle('done', i < n));
  $('calMsg').textContent = msg;
}

$('holdPad').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const st = CAL_STEPS[cal.step];
  if (st.key === 'center') {
    if (!qDev) { renderCal('Waiting for motion sensors…'); return; }
    calibrate();
    buzz('join');
    cal.step = 1;
    renderCal();
    return;
  }
  $('holdPad').classList.add('down');
  recording = { t0: performance.now(), samples: [] };
  if (canVibrate) navigator.vibrate(10);
});
const endHold = () => {
  if (!recording) return;
  $('holdPad').classList.remove('down');
  const rec = recording;
  recording = null;
  analyzeSwing(rec);
};
$('holdPad').addEventListener('pointerup', endHold);
$('holdPad').addEventListener('pointercancel', endHold);
$('holdPad').addEventListener('contextmenu', (e) => e.preventDefault());

function analyzeSwing(rec) {
  const st = CAL_STEPS[cal.step];
  const dur = performance.now() - rec.t0;
  let peak = 0, peakAt = 0;
  for (const s of rec.samples) { const f = -s.v[2]; if (f > peak) { peak = f; peakAt = s.t - rec.t0; } }
  if (dur < 120 || rec.samples.length < 4) return renderCal('Too quick: hold the circle for the whole swing.');
  if (dur > 3000) return renderCal('That was long: press when you start swinging, release when you finish.');
  if (peak < 0.8) return renderCal('Swing a bit harder, toward the TV.');
  // Average rotation direction during the fast part of the swing, weighted by speed.
  const axis = [0, 0, 0];
  for (const s of rec.samples) {
    if (-s.v[2] < peak * 0.4) continue;
    for (let k = 0; k < 3; k++) axis[k] += s.w[k];
  }
  cal.swings[st.key].push({ peak, dur, peakAt, axis: norm(axis), lat: rec.samples.reduce((a, s) => a + s.v[0], 0) / rec.samples.length });
  buzz('hit', 0.6);
  if (cal.swings[st.key].length < 3) return renderCal(`Nice! ${3 - cal.swings[st.key].length} to go.`);
  if (cal.step === 1) { cal.step = 2; return renderCal('Forehand learned.'); }
  finishCalibration();
}

const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
function finishCalibration() {
  const all = [...cal.swings.fh, ...cal.swings.bh];
  const typical = median(all.map((s) => s.peak));
  const meanAxis = (list) => norm(list.reduce((a, s) => add(a, s.axis), [0, 0, 0]));
  profile = {
    thr: +Math.max(0.6, typical * 0.3).toFixed(2),   // gentler than this is not a swing
    full: +(typical * 1.15).toFixed(2),               // a normal swing lands around 85% power
    win: Math.round(clamp(median(all.map((s) => s.peakAt)) + 60, 120, 260)), // ms of timing slack
    fh: meanAxis(cal.swings.fh).map((k) => +k.toFixed(3)),
    bh: meanAxis(cal.swings.bh).map((k) => +k.toFixed(3)),
    // Right-handed forehands sweep right to left across the body.
    hand: median(cal.swings.fh.map((s) => s.lat)) < 0 ? 'right' : 'left',
  };
  try { localStorage.setItem('vxpp-swing-profile', JSON.stringify(profile)); } catch { /* private mode */ }
  link?.send({ t: 'prof', ...profile });
  buzz('win');
  startPlay();
}

$('calRedo').addEventListener('click', startCalibration);
$('calSkip').addEventListener('click', () => {
  if (!frame) calibrate();
  if (profile) link?.send({ t: 'prof', ...profile });
  startPlay();
});
$('swingCalBtn').addEventListener('click', startCalibration);
$('arBtn').addEventListener('click', toggleAR);

let swingId = 0;
function sendSwing(p, d) {
  const msg = { t: 'sw', id: ++swingId, p: +p.toFixed(2), d: +d.toFixed(2) };
  // Fast channel first for speed, reliable channel as a backup; the PC ignores the duplicate.
  link?.sendFast(msg);
  link?.send(msg);
  swingVisual = 1;
  $('swingFill').style.width = `${Math.round(p * 100)}%`;
}

// Send every change right away (capped at ~120 per second) instead of batching on a timer.
function pushInput() {
  const now = performance.now();
  if (now - state.lastSend < 8) return;
  if (Math.abs(state.x - state.sentX) < 0.002 && Math.abs(state.y - state.sentY) < 0.002 && now - state.lastSend < 250) return;
  link?.sendFast({ t: 'in', x: +state.x.toFixed(3), y: +state.y.toFixed(3) });
  rates.sent++;
  state.sentX = state.x; state.sentY = state.y; state.lastSend = now;
}
// Heartbeat so the PC keeps the last position even if packets were dropped.
setInterval(() => { if (state.mode === 'touch' && performance.now() - state.lastSend > 200) { state.lastSend = 0; state.sentX = 9; pushInput(); } }, 200);

// ---------- Touch / mouse fallback ----------
let touch = null;
addEventListener('pointerdown', (e) => {
  if (state.mode !== 'touch' || e.target.closest('button')) return;
  touch = { x: e.clientX, y: e.clientY, t: performance.now(), lastY: e.clientY, lastT: performance.now(), vy: 0 };
  setTouchPos(e);
});
addEventListener('pointermove', (e) => {
  if (state.mode !== 'touch' || !touch) return;
  const now = performance.now();
  const dt = Math.max(1, now - touch.lastT);
  touch.vy = touch.vy * 0.5 + ((e.clientY - touch.lastY) / dt) * 0.5;
  touch.lastY = e.clientY;
  touch.lastT = now;
  setTouchPos(e);
  if (touch.vy < -1.4 && now > swingLock) {
    swingLock = now + 350;
    sendSwing(clamp((-touch.vy - 1.4) / 3, 0, 1) * 0.7 + 0.3, clamp((e.clientX - touch.x) / 120, -1, 1));
  }
});
addEventListener('pointerup', (e) => {
  if (state.mode !== 'touch' || !touch) return;
  const now = performance.now();
  if (now - touch.t < 250 && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) < 15 && now > swingLock) {
    swingLock = now + 300;
    sendSwing(0.55, 0);
  }
  touch = null;
});
function setTouchPos(e) {
  state.x = clamp((e.clientX / innerWidth) * 2 - 1, -1, 1) * 1.3;
  state.y = clamp(-((e.clientY / innerHeight) * 2 - 1) * 1.4 + 0.3, -1.3, 1.3);
  pushInput();
}

// ---------- Play screen ----------
let wakeLock = null;
async function startPlay() {
  show('play');
  $('touchHint').classList.toggle('hide', state.mode !== 'touch');
  $('modeBtn').textContent = state.mode === 'touch' ? 'Motion mode' : 'Touch mode';
  $('calBtn').classList.toggle('hide', state.mode === 'touch');
  $('swingCalBtn').classList.toggle('hide', state.mode === 'touch');
  link?.send({ t: 'cal', state: 'done' });
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}

$('motionBtn').addEventListener('click', enableMotion);
$('touchBtn').addEventListener('click', () => { state.mode = 'touch'; startPlay(); });
$('modeBtn').addEventListener('click', () => {
  if (state.mode === 'touch') enableMotion();
  else { state.mode = 'touch'; startPlay(); }
});
$('calBtn').addEventListener('click', () => { calibrate(); buzz('join'); });
$('startBtn').addEventListener('click', () => link?.send({ t: 'start' }));
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock !== null) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// ---------- Paddle drawing ----------
(function drawPaddle() {
  const g = $('padPix');
  let html = '';
  for (let y = 0; y < 17; y++) {
    for (let x = 0; x < 17; x++) {
      const d = Math.hypot(x - 8, y - 8);
      if (d > 8.3) continue;
      const fill = d > 7.2 ? ME : ((x + y) % 2 ? '#d8233a' : '#c41f34');
      html += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  }
  for (let y = 16; y < 25; y++) {
    for (let x = 7; x < 10; x++) html += `<rect x="${x}" y="${y}" width="1" height="1" fill="${(x + y) % 2 ? '#b9874f' : '#a77843'}"/>`;
  }
  g.innerHTML = html;
})();

let swingVisual = 0;
(function animate() {
  swingVisual = Math.max(0, swingVisual - 0.08);
  const rot = state.x * 25;
  const tilt = -state.y * 18 + swingVisual * 35;
  $('paddle').style.transform = `translateX(${state.x * 40}px) rotate(${rot}deg) perspective(400px) rotateX(${tilt}deg) scale(${1 + swingVisual * 0.15})`;
  if (swingVisual === 0) $('swingFill').style.width = '0%';
  requestAnimationFrame(animate);
})();
