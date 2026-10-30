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
  for (const s of ['join', 'setup', 'play']) $(s).classList.toggle('hide', s !== id);
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
      if (ok) buzz('join');
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

// ---------- Motion ----------
// Tilt comes from the phone's "up" vector. deviceorientation alone is smoothed by the OS and lags,
// so we integrate the raw gyroscope (devicemotion.rotationRate) for instant response and use
// orientation only to slowly correct drift. Gyro sign conventions differ between browsers, so two
// estimates (one per sign) run side by side and the one that agrees with orientation wins.
let neutral = null;        // { roll, pitch } captured on recenter
let measured = null;       // latest up vector from deviceorientation
const est = [null, null];  // gyro-integrated up vectors for sign +1 / -1
const estErr = [0, 0];
let lastMotionT = 0;
let gyroSeen = false;

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
    addEventListener('deviceorientation', onOrientation);
    addEventListener('devicemotion', onMotion);
    setTimeout(() => {
      if (!measured) $('setupErr').textContent = 'No motion data yet. If nothing happens, try touch controls.';
    }, 1500);
    state.mode = 'motion';
    startPlay();
  } catch (e) {
    $('setupErr').textContent = e.message;
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Up vector in device coordinates from Euler angles. Unlike raw beta/gamma it has no gimbal flip
// when the phone is held upright.
function upFromEuler(e) {
  const b = (e.beta || 0) * Math.PI / 180, g = (e.gamma || 0) * Math.PI / 180;
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)];
}

// Sensor event rates, reported to the PC once a second for the diagnostics panel.
const rates = { ori: 0, mot: 0, sent: 0 };
setInterval(() => {
  link?.send({ t: 'diag', ori: rates.ori, mot: rates.mot, sent: rates.sent, gyro: gyroSeen, mode: state.mode, ua: navigator.userAgent.slice(0, 90) });
  rates.ori = rates.mot = rates.sent = 0;
}, 1000);

function onOrientation(e) {
  rates.ori++;
  if (e.beta == null) return;
  measured = upFromEuler(e);
  for (let k = 0; k < 2; k++) {
    if (!est[k]) { est[k] = measured.slice(); continue; }
    const d = Math.hypot(est[k][0] - measured[0], est[k][1] - measured[1], est[k][2] - measured[2]);
    estErr[k] = estErr[k] * 0.97 + d;
    // Gentle pull toward the absolute reading removes gyro drift.
    est[k] = norm(est[k].map((v, i) => v + (measured[i] - v) * 0.06));
  }
  if (!gyroSeen) applyUp(measured);
}

function bestEstimate() {
  if (!est[0]) return measured;
  return estErr[0] <= estErr[1] ? est[0] : est[1];
}

function applyUp(u) {
  if (!u || state.mode !== 'motion') return;
  const roll = -u[0];                  // + when tilted right
  const pitch = Math.atan2(u[2], u[1]); // 0 upright, + when the top leans away
  if (!neutral) neutral = { roll, pitch };
  state.x = clamp((roll - neutral.roll) / 0.42, -1.5, 1.5);
  state.y = clamp(-(pitch - neutral.pitch) / 0.5, -1.5, 1.5);
  pushInput();
}

let swingLock = 0;
function onMotion(e) {
  rates.mot++;
  const now = performance.now();
  const dt = lastMotionT ? clamp((now - lastMotionT) / 1000, 0, 0.05) : 0;
  lastMotionT = now;
  const r = e.rotationRate;
  if (r && r.alpha != null && est[0]) {
    gyroSeen = true;
    // Angular velocity in device axes (rad/s): beta is around x, gamma around y, alpha around z.
    const w = [r.beta, r.gamma, r.alpha].map((v) => (v || 0) * Math.PI / 180);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const u = est[k];
      // A world-fixed vector seen from a rotating body changes by -w x u.
      const c = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
      est[k] = norm([u[0] - s * c[0] * dt, u[1] - s * c[1] * dt, u[2] - s * c[2] * dt]);
    }
    applyUp(bestEstimate());
  }
  if (state.mode !== 'motion') return;
  // Swing: a spike in rotation rate or linear acceleration, sent the instant it is detected.
  const rot = r ? Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0) : 0;
  const a = e.acceleration || {};
  const acc = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  if (now > swingLock && (rot > 260 || acc > 13)) {
    swingLock = now + 380;
    const p = clamp(Math.max((rot - 260) / 500, (acc - 13) / 18), 0, 1) * 0.7 + 0.3;
    sendSwing(p, clamp((a.x || 0) / 12, -1, 1));
  }
}

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
setInterval(() => { if (performance.now() - state.lastSend > 200) { state.lastSend = 0; state.sentX = 9; pushInput(); } }, 200);

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
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}

$('motionBtn').addEventListener('click', enableMotion);
$('touchBtn').addEventListener('click', () => { state.mode = 'touch'; startPlay(); });
$('modeBtn').addEventListener('click', () => {
  if (state.mode === 'touch') enableMotion();
  else { state.mode = 'touch'; startPlay(); }
});
$('calBtn').addEventListener('click', () => {
  const u = bestEstimate();
  if (u) neutral = { roll: -u[0], pitch: Math.atan2(u[2], u[1]) };
  buzz('join');
});
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
