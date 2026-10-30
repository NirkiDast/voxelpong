// Phone controller: reads tilt + swing from motion sensors (or touch) and streams them to the PC.
import { Controller } from './net.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const params = new URLSearchParams(location.search);
const slot = Number(params.get('slot')) || 1;
let room = (params.get('room') || '').toUpperCase();

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
        connecting: 'Connecting…', connected: `Connected · room ${room}`,
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
  if (m.t === 'ping') link.send({ t: 'pong', ts: m.ts });
  else if (m.t === 'hap') { buzz(m.k, m.p); if (m.k === 'hit' || m.k === 'smash') flashHit(m.k === 'smash'); }
  else if (m.t === 'st') {
    $('you').textContent = m.you ?? 0;
    $('them').textContent = m.them ?? 0;
    $('startBtn').classList.toggle('hide', !(m.demo || m.mode === 'over'));
    $('cue').textContent = m.serve ? 'YOUR SERVE: SWING!' : m.point === 'won' ? 'POINT!' : m.point === 'lost' ? '' : '';
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
  $('paddle').style.filter = 'brightness(2.2) drop-shadow(0 0 20px #29e7ff)';
  setTimeout(() => { $('paddle').style.filter = ''; }, 120);
}

// ---------- Motion ----------
let neutral = null; // { roll, pitch }
let lastOri = null;

async function enableMotion() {
  $('setupErr').textContent = '';
  try {
    const DOE = window.DeviceOrientationEvent, DME = window.DeviceMotionEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      const a = await DOE.requestPermission();
      const b = DME && typeof DME.requestPermission === 'function' ? await DME.requestPermission() : 'granted';
      if (a !== 'granted' || b !== 'granted') throw new Error('Motion access was denied. You can use touch controls instead.');
    }
    if (!window.isSecureContext) throw new Error('Motion sensors need an https:// address. Use touch controls, or open the hosted version.');
    addEventListener('deviceorientation', onOrientation);
    addEventListener('devicemotion', onMotion);
    setTimeout(() => {
      if (!lastOri) $('setupErr').textContent = 'No motion data yet. If nothing happens, try touch controls.';
    }, 1500);
    state.mode = 'motion';
    startPlay();
  } catch (e) {
    $('setupErr').textContent = e.message;
  }
}

// Up vector in device coordinates, derived from Euler angles. Unlike raw beta/gamma it has no
// gimbal flip when the phone is held upright.
function upVector(e) {
  const b = (e.beta || 0) * Math.PI / 180, g = (e.gamma || 0) * Math.PI / 180;
  return { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
}

function onOrientation(e) {
  if (e.beta == null) return;
  const u = upVector(e);
  const roll = -u.x;                 // + when tilted right
  const pitch = Math.atan2(u.z, u.y); // 0 upright, + when the top leans away
  lastOri = { roll, pitch };
  if (!neutral) neutral = { ...lastOri };
  if (state.mode !== 'motion') return;
  state.x = clamp((roll - neutral.roll) / 0.45, -1.5, 1.5);
  state.y = clamp(-(pitch - neutral.pitch) / 0.5, -1.5, 1.5);
}

// Swing: spike in rotation rate or linear acceleration. We collect the peak for 50 ms, then send once.
let swingLock = 0, peak = null;
function onMotion(e) {
  if (state.mode !== 'motion') return;
  const r = e.rotationRate || {};
  const rot = Math.hypot(r.alpha || 0, r.beta || 0, r.gamma || 0);
  const a = e.acceleration || {};
  const acc = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  const now = performance.now();
  if (peak) {
    peak.rot = Math.max(peak.rot, rot);
    peak.acc = Math.max(peak.acc, acc);
    if (Math.abs(a.x || 0) > Math.abs(peak.ax)) peak.ax = a.x || 0;
    if (now - peak.t > 50) {
      const p = clamp(Math.max((peak.rot - 280) / 700, (peak.acc - 14) / 26), 0, 1) * 0.75 + 0.25;
      sendSwing(p, clamp(peak.ax / 14, -1, 1));
      peak = null;
    }
    return;
  }
  if (now > swingLock && (rot > 280 || acc > 14)) {
    peak = { t: now, rot, acc, ax: a.x || 0 };
    swingLock = now + 380;
  }
}

function sendSwing(p, d) {
  link?.send({ t: 'sw', p: +p.toFixed(2), d: +d.toFixed(2) });
  swingVisual = 1;
  $('swingFill').style.width = `${Math.round(p * 100)}%`;
}

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
$('calBtn').addEventListener('click', () => { if (lastOri) neutral = { ...lastOri }; buzz('join'); });
$('startBtn').addEventListener('click', () => link?.send({ t: 'start' }));
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && wakeLock !== null) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ }
  }
});

// Stream paddle position ~30 times a second (only when it changes, plus a heartbeat).
setInterval(() => {
  const now = performance.now();
  const moved = Math.abs(state.x - state.sentX) > 0.004 || Math.abs(state.y - state.sentY) > 0.004;
  if (moved || now - state.lastSend > 250) {
    link?.send({ t: 'in', x: +state.x.toFixed(3), y: +state.y.toFixed(3) });
    state.sentX = state.x; state.sentY = state.y; state.lastSend = now;
  }
}, 33);

// ---------- Paddle drawing ----------
(function drawPaddle() {
  const g = $('padPix');
  let html = '';
  for (let y = 0; y < 17; y++) {
    for (let x = 0; x < 17; x++) {
      const d = Math.hypot(x - 8, y - 8);
      if (d > 8.3) continue;
      const fill = d > 7.2 ? '#29e7ff' : ((x + y) % 2 ? '#d8233a' : '#c41f34');
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
