// Voxel Tennis host: renders the arena on the PC, runs ball physics, doubles rules, AI and FX.
// Phones connect exactly like in ping pong (same controller page and messages).
//
// How a human hits: your player runs to the ball by itself. You only swing the phone. When you swing
// decides where the ball goes (early pulls it cross-court, late pushes it down the line), how hard
// you swing sets the pace, and swinging upward or downward through the ball adds topspin or slice.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { C, TEAM_COLORS, buildArena, buildPlayer, buildTennisBall } from './court.js';
import { Particles, Rings, Trail, Shake } from '../fx.js';
import { Host } from '../net.js';
import { sfx, unlockAudio } from '../audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const rnd = (a, b) => a + Math.random() * (b - a);
const sideOf = (team) => (team === 0 ? 1 : -1);   // team 0 plays at z > 0

// ---------- Tuning ----------
const GAME_SPEED = 0.82;      // whole simulation slightly slowed so swing timing is comfortable
const GRAV = 9.8;
const DRAG = 0.07;
const SWEET = 0.12;           // seconds between the phone's swing trigger and an ideal contact
const EARLY = 0.42, LATE = 0.1; // swing timing window around contact
const REACH = 1.5;            // metres a player can stretch to reach the ball
const SERVE_ORDER = [0, 2, 1, 3];
const AI_LEVELS = {
  easy:   { speed: 5.2, err: 1.6, miss: 0.12, power: [0.25, 0.55], fault: 0.25 },
  medium: { speed: 6.2, err: 1.0, miss: 0.06, power: [0.35, 0.75], fault: 0.15 },
  hard:   { speed: 7.2, err: 0.55, miss: 0.025, power: [0.5, 0.9], fault: 0.08 },
};
const settings = { level: 'medium', games: 3 };

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07051a);
scene.fog = new THREE.FogExp2(0x07051a, 0.018);

scene.add(new THREE.HemisphereLight(0x6a5cff, 0x1a0f2a, 0.5));
const key = new THREE.DirectionalLight(0xfff1e0, 2.3);
key.position.set(4, 18, 6);
key.target.position.set(0, 0, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -10, right: 10, top: 16, bottom: -16, near: 2, far: 40 });
key.shadow.bias = -0.0005;
key.shadow.normalBias = 0.02;
scene.add(key, key.target);
for (const [x, z, col] of [[-9, 6, TEAM_COLORS[0]], [9, -6, TEAM_COLORS[1]], [-9, -8, 0x9b5cff], [9, 8, 0x9b5cff]]) {
  const l = new THREE.PointLight(col, 40, 22, 1.6);
  l.position.set(x, 3.5, z);
  scene.add(l);
}

const arena = buildArena(scene);
const particles = new Particles(scene);
const rings = new Rings(scene);
const trail = new Trail(scene, 22, C.R * 2.2);
const shake = new Shake();

const ballMesh = buildTennisBall();
scene.add(ballMesh);
const ballLight = new THREE.PointLight(0xd8ff66, 3, 3, 2);
scene.add(ballLight);

// ---------- Post-processing ----------
const LENS_SHADER = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 }, vignette: { value: 0.5 }, time: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float amount; uniform float vignette; uniform float time; varying vec2 vUv;
    void main(){
      vec2 d = vUv - 0.5; float r = dot(d, d);
      vec2 off = d * amount * (0.6 + r * 3.0);
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= 1.0 - vignette * smoothstep(0.12, 0.9, r * 2.2);
      float n = fract(sin(dot(vUv * 913.7 + time, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.01;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 120);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: 18, aperture: 0.00018, maxblur: 0.006 });
bokeh.materialBokeh.fragmentShader = bokeh.materialBokeh.fragmentShader.replace(
  'float factor = ( focus + viewZ );',
  'float factor = ( focus + viewZ ); factor = sign( factor ) * max( abs( factor ) - 9.0, 0.0 ); if ( factor > 0.0 ) factor *= 0.3;'
);
bokeh.materialBokeh.needsUpdate = true;
composer.addPass(bokeh);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 1.05);
composer.addPass(bloom);
const lens = new ShaderPass(LENS_SHADER);
composer.addPass(lens);
composer.addPass(new OutputPass());

// ---------- Players ----------
// 0: you (near team, A), 1: your partner (near, B), 2 and 3: the far team.
const LOOKS = [
  { skin: 0xf1c27d, hair: 0x2b1b12 }, { skin: 0xc68642, hair: 0x101010 },
  { skin: 0xe0ac69, hair: 0x8a3b12 }, { skin: 0x8d5524, hair: 0x1a1a1a },
];
const players = [0, 1, 2, 3].map((i) => {
  const team = i < 2 ? 0 : 1;
  const ch = buildPlayer({ color: TEAM_COLORS[team], ...LOOKS[i] });
  scene.add(ch.group);
  return {
    i, team, ch, kind: 'ai', slot: i < 2 ? i + 1 : 0, phone: false,
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), role: 'back', half: 1,
    plan: null, swing: null, swingAnim: 1, swingSide: 1, serveAnim: -1, runPhase: rnd(0, 6),
    control: 'touch', racket: null, hist: [], profile: null, lastSwingId: -1, hand: 'right',
  };
});

const ball = {
  pos: new THREE.Vector3(0, 1, 0), vel: new THREE.Vector3(), spin: 0,
  live: false, serve: false, netTouch: false, lastTeam: -1, lastHitter: -1, bounces: 0, held: true,
};

const G = {
  phase: 'serve', demo: true, time: 0, timer: 0,
  pts: [0, 0], games: [0, 0], gameIdx: 0, server: 0, second: false,
  shots: 0, hitStop: 0, fovPunch: 0, chroma: 0, deadUntil: 0, nextFn: null,
};

// ---------- Ball physics (shared by the live ball and the predictor) ----------
function netHeightAt(x) {
  return C.NET_H + (C.POST_H - C.NET_H) * Math.pow(Math.min(1, Math.abs(x) / (C.HW + 0.45)), 2);
}
// Advances b by dt. Returns 'bounce', 'net' or null.
function stepBall(b, dt) {
  const g = GRAV + b.spin * 4.0;
  const pz = b.pos.z;
  b.vel.y -= g * dt;
  b.vel.multiplyScalar(1 - DRAG * dt);
  b.pos.addScaledVector(b.vel, dt);
  if (Math.sign(pz) !== Math.sign(b.pos.z) && pz !== 0 && Math.abs(b.pos.x) < C.HW + 0.5 && b.pos.y < netHeightAt(b.pos.x) + C.R) {
    b.vel.z *= -0.12;
    b.vel.x *= 0.4;
    b.vel.y *= 0.3;
    b.pos.z = Math.sign(pz) * 0.08;
    return 'net';
  }
  if (b.pos.y < C.R && b.vel.y < 0) {
    b.pos.y = C.R;
    const top = b.spin > 0, slice = b.spin < 0;
    b.vel.y = -b.vel.y * (slice ? 0.55 : top ? 0.74 : 0.68);
    const f = slice ? 0.72 : top ? 0.9 : 0.82;
    b.vel.x *= f;
    b.vel.z *= f;
    b.spin *= 0.4;
    return 'bounce';
  }
  return null;
}

function predict(maxT = 4) {
  const b = { pos: ball.pos.clone(), vel: ball.vel.clone(), spin: ball.spin };
  const out = [];
  const h = 1 / 120;
  let bounces = 0, firstBounce = null;
  for (let t = h; t < maxT; t += h) {
    const ev = stepBall(b, h);
    if (ev === 'bounce') { bounces++; if (!firstBounce) firstBounce = b.pos.clone(); if (bounces >= 2) break; }
    out.push({ t, pos: b.pos.clone(), vy: b.vel.y, bounces });
  }
  return { samples: out, firstBounce };
}

// Velocity that sends a ball from p to land at (tx, tz) with flight time T, raised until it clears the net.
function shotVelocity(p, tx, tz, T, spin, netMargin = 0.35) {
  const g = GRAV + spin * 4.0;
  const v = new THREE.Vector3();
  for (let k = 0; k < 30; k++) {
    const dragK = 1 + DRAG * T * 0.5;
    v.set((tx - p.x) / T * dragK, 0, (tz - p.z) / T * dragK);
    v.y = (C.R - p.y + 0.5 * g * T * T) / T;
    // Height at the net.
    if (Math.sign(p.z) === Math.sign(tz) || Math.abs(v.z) < 0.01) break;
    const tn = -p.z / v.z;
    const yn = p.y + v.y * tn - 0.5 * g * tn * tn;
    if (yn > netHeightAt(p.x + v.x * tn) + netMargin) break;
    T *= 1.07;
  }
  return v;
}

// ---------- Scoring ----------
const PT_NAMES = ['0', '15', '30', '40'];
function pointText() {
  const [a, b] = G.pts;
  if (a >= 3 && b >= 3) {
    if (a === b) return ['DEUCE', ''];
    return a > b ? ['AD', ''] : ['', 'AD'];
  }
  return [PT_NAMES[Math.min(a, 3)], PT_NAMES[Math.min(b, 3)]];
}
const teamName = (t) => (t === 0 ? (players[1].kind === 'human' ? 'P1 & P2' : 'YOU & CPU') : 'CPU & CPU');
function renderScore() {
  const [a, b] = pointText();
  $('sName0').textContent = teamName(0);
  $('sName1').textContent = teamName(1);
  $('sGames0').textContent = G.games[0];
  $('sGames1').textContent = G.games[1];
  $('sPts0').textContent = a === 'DEUCE' ? '40' : a;
  $('sPts1').textContent = a === 'DEUCE' ? '40' : b;
  $('sServe0').style.visibility = players[G.server].team === 0 ? 'visible' : 'hidden';
  $('sServe1').style.visibility = players[G.server].team === 1 ? 'visible' : 'hidden';
}

function award(team, call) {
  if (G.phase === 'dead' || G.phase === 'over') return;
  G.phase = 'dead';
  ball.live = false;
  G.pts[team]++;
  const [a, b] = G.pts;
  let gameWon = (a >= 4 || b >= 4) && Math.abs(a - b) >= 2;
  const youWon = team === 0;
  if (!G.demo) sfx.point(youWon);
  if (call) callout(call, youWon ? TEAM_COLORS[0] : TEAM_COLORS[1]);
  players.forEach((p) => { if (p.phone) haptic(p, p.team === team ? 'win' : 'lose'); });
  if (gameWon) {
    G.games[team]++;
    G.pts = [0, 0];
    G.gameIdx++;
    const matchWon = G.games[team] >= settings.games && !G.demo;
    setTimeout(() => callout(matchWon ? 'GAME, SET & MATCH' : 'GAME', TEAM_COLORS[team], 'big'), 700);
    if (G.demo && G.games[team] >= 3) { G.games = [0, 0]; }
    renderScore();
    later(2.2, matchWon ? () => gameOver(team) : startPoint);
  } else {
    renderScore();
    const [pa, pb] = pointText();
    const txt = pa === 'DEUCE' ? 'DEUCE' : pa === 'AD' ? `ADVANTAGE ${teamName(0)}` : pb === 'AD' ? `ADVANTAGE ${teamName(1)}` : `${pa} - ${pb}`;
    setTimeout(() => { if (!G.demo) callout(txt, 0xffffff); }, 650);
    later(1.8, startPoint);
  }
}
function later(sec, fn) { G.deadUntil = G.time + sec; G.nextFn = fn; }

// ---------- Point setup ----------
function startPoint() {
  G.server = SERVE_ORDER[G.gameIdx % 4];
  G.second = false;
  setupServe();
}
function setupServe() {
  const s = players[G.server];
  const sg = sideOf(s.team);
  const deuce = (G.pts[0] + G.pts[1]) % 2 === 0;
  const sx = sg * (deuce ? 1 : -1);  // server's x sign: their right half on the deuce side
  const partner = players.find((p) => p.team === s.team && p !== s);
  s.role = 'back'; partner.role = 'front';
  s.pos.set(sx * 1.4, 0, sg * (C.HL + 0.5));
  partner.pos.set(-sx * 2.4, 0, sg * 4.2);
  s.half = Math.sign(s.pos.x); partner.half = -s.half;
  // Receiving team: player A takes the deuce court, player B the ad court.
  const rt = 1 - s.team, rs = sideOf(rt);
  const box = -sx;                     // x sign of the target service box
  const ra = players[rt * 2], rb = players[rt * 2 + 1];
  const receiver = deuce ? ra : rb;
  const rpart = deuce ? rb : ra;
  receiver.role = 'back'; rpart.role = 'front';
  receiver.pos.set(box * 2.7, 0, rs * (C.HL - 0.2));
  rpart.pos.set(-box * 2.4, 0, rs * 5.8);
  receiver.half = box; rpart.half = -box;
  players.forEach((p) => { p.vel.set(0, 0, 0); p.plan = null; p.swing = null; p.serveAnim = -1; });
  G.serveBox = box;
  G.phase = 'serve';
  G.timer = 0;
  ball.live = false; ball.serve = false; ball.held = true; ball.netTouch = false; ball.bounces = 0; ball.spin = 0;
  ball.vel.set(0, 0, 0);
  trail.clear();
  renderScore();
  sendState();
  if (!G.demo) {
    const me = s.kind === 'human';
    const who = me ? (players[1].kind === 'human' ? `P${s.i + 1} serve` : 'Your serve') : null;
    const how = s.control === 'racket' ? 'flick the phone up to toss, then swing' : 'click / swing to toss, again to hit';
    setHint(me ? `${who}${G.second ? ' (second serve)' : ''}: ${how}` : (G.second ? 'Second serve' : ''));
  }
}

function setHint(t) {
  $('hint').textContent = t;
  $('hint').classList.toggle('hide', !t);
}

// ---------- Serving ----------
function holdBallAt(s) {
  const fx = s.ch.offArm.getWorldPosition(new THREE.Vector3());
  ball.pos.set(fx.x, 1.25, fx.z - sideOf(s.team) * 0.25);
}
function toss(s) {
  if (G.phase !== 'serve') return;
  G.phase = 'toss';
  G.timer = 0;
  G.toss0 = G.time;
  ball.held = false;
  ball.vel.set(0, 5.4, 0);
  ball.spin = 0;
  s.serveAnim = 0;
  sfx.blip();
  if (s.phone) haptic(s, 'join');
}
function hitServe(s, power, { spin = 0, aim = 0 } = {}) {
  const sg = sideOf(s.team);
  // Contact quality: best near the top of the toss.
  const q = clamp((ball.pos.y - 1.9) / 0.9, 0.25, 1);
  const err = (1 - q) * 1.6 + Math.max(0, power - 0.85) * 2.5;
  const box = G.serveBox;
  const tx = box * clamp(1.6 + aim * 1.2, 0.4, C.SHW - 0.35) + rnd(-1, 1) * err * 0.8;
  const tz = -sg * (C.SVC - 0.8 - (1 - power) * 1.6) - sg * rnd(-0.4, 1) * err;
  const T = lerp(1.15, 0.62, power) * (spin > 0 ? 1.12 : 1);
  ball.vel.copy(shotVelocity(ball.pos, tx, tz, T, spin, 0.1 + q * 0.25 - err * 0.12));
  ball.spin = spin;
  ball.live = true; ball.serve = true; ball.netTouch = false; ball.bounces = 0;
  ball.lastTeam = s.team; ball.lastHitter = s.i;
  s.serveAnim = 0.55;
  G.phase = 'rally';
  G.shots = 0;
  setHint('');
  hitFx(s, power, power > 0.8);
  planReceivers();
  sendState();
}

// ---------- Rally: who goes for the ball ----------
function planReceivers() {
  players.forEach((p) => { p.plan = null; });
  const team = 1 - ball.lastTeam;
  const sg = sideOf(team);
  const { samples, firstBounce } = predict();
  if (!samples.length) return;
  const mates = players.filter((p) => p.team === team);
  const front = mates.find((p) => p.role === 'front') || mates[0];
  const back = mates.find((p) => p !== front);
  let pick = null;
  // The net player volleys balls that come through their zone at a playable height (not serves).
  if (!ball.serve) {
    let best = null;
    for (const s of samples) {
      if (s.bounces > 0) break;
      if (Math.sign(s.pos.z) !== sg) continue;
      const az = Math.abs(s.pos.z);
      if (az < 1.2 || az > 7) continue;
      if (s.pos.y < 0.35 || s.pos.y > 2.6) continue;
      if (Math.abs(s.pos.x - front.pos.x) > 2.8) continue;
      if (!best || Math.abs(s.pos.z - front.pos.z) < Math.abs(best.pos.z - front.pos.z)) best = s;
    }
    if (best) pick = { p: front, s: best, volley: true };
  }
  if (!pick) {
    // Baseline player: after the first bounce on our side, as it comes down through hitting height.
    let best = null;
    for (const s of samples) {
      if (s.bounces === 0) continue;
      if (Math.sign(s.pos.z) !== sg) break;
      if ((s.vy < 0 && s.pos.y < 1.35) || Math.abs(s.pos.z) > C.HL + 4) { best = s; break; }
    }
    if (!best) return;
    // Clearly going out? The AI leaves it. A human still gets the choice.
    const out = firstBounce && (Math.abs(firstBounce.x) > C.HW + 0.3 || Math.abs(firstBounce.z) > C.HL + 0.3 || Math.sign(firstBounce.z) !== sg);
    const who = Math.abs(best.pos.x - back.pos.x) < Math.abs(best.pos.x - front.pos.x) + 3 ? back : front;
    if (out && who.kind !== 'human') return;
    pick = { p: who, s: best, volley: false };
  }
  const p = pick.p;
  const handX = sideOf(p.team) * (p.hand === 'left' ? -1 : 1);
  const fore = (pick.s.pos.x - p.pos.x) * handX > -0.6;
  p.plan = {
    t: G.time + pick.s.t / 1, contact: pick.s.pos.clone(), volley: pick.volley, fore,
    stand: new THREE.Vector3(pick.s.pos.x - handX * (fore ? 0.85 : -0.85), 0, pick.s.pos.z + sideOf(p.team) * 0.3),
    shotId: G.shots, done: false,
  };
  p.plan.stand.z = sideOf(p.team) * Math.max(0.8, Math.abs(p.plan.stand.z));
  p.swingSide = fore ? 1 : -1;
}

function hitBall(p, { power, aim = 0, spin = 0, lob = false, quality = 1 }) {
  const sg = sideOf(p.team);
  const err = (1 - quality) * 2.2;
  let tx = clamp(aim * (C.HW - 0.9), -(C.HW - 0.6), C.HW - 0.6) + rnd(-1, 1) * err;
  let tz, T;
  if (lob) {
    tz = -sg * (C.HL - 1.6 - rnd(0, 1.5)) - sg * rnd(-0.6, 0.6) * err;
    T = 1.9;
  } else {
    tz = -sg * (C.HL - 1.4 - (1 - power) * 5.2) - sg * rnd(-0.5, 0.8) * err;
    const dist = Math.hypot(tx - ball.pos.x, tz - ball.pos.z);
    T = dist / lerp(13, 27, power);
    if (spin > 0) T *= 1.12;
    if (spin < 0) T *= 1.15;
  }
  ball.vel.copy(shotVelocity(ball.pos, tx, tz, T, lob ? 0 : spin, 0.25 + quality * 0.2 - err * 0.15));
  ball.spin = lob ? 0 : spin;
  ball.live = true; ball.serve = false; ball.bounces = 0; ball.netTouch = false;
  ball.lastTeam = p.team; ball.lastHitter = p.i;
  G.shots++;
  p.plan = null;
  hitFx(p, power, power > 0.85 && ball.pos.y > 1.6);
  planReceivers();
}

// AI picks a target away from the nearest opponent.
function aiHit(p) {
  const L = AI_LEVELS[G.demo ? 'medium' : settings.level];
  // Long rallies make the CPU shakier, so points always end.
  const tired = 1 + G.shots * 0.12;
  if (Math.random() < L.miss * tired * (p.plan.volley ? 1.5 : 1)) { p.plan.done = true; p.swingAnim = 0; return; }
  const opp = players.filter((o) => o.team !== p.team);
  const gapX = -Math.sign(opp.reduce((a, o) => a + o.pos.x, 0) || rnd(-1, 1));
  const aim = clamp(gapX * rnd(0.3, 0.9) + rnd(-0.3, 0.3), -0.95, 0.95);
  const lob = !p.plan.volley && Math.random() < 0.06;
  hitBall(p, {
    power: rnd(...L.power), aim, spin: Math.random() < 0.5 ? rnd(0.2, 0.7) : (Math.random() < 0.3 ? -0.5 : 0),
    lob, quality: clamp(1 - L.err * tired * rnd(0, 0.35), 0.2, 1),
  });
  p.swingAnim = 0;
}

// ---------- Human input ----------
// A swing arrives from the phone (or mouse/keyboard).
function onSwing(i, power, extra = {}) {
  const p = players[i];
  if (!p || p.kind !== 'human') return;
  if (G.phase === 'over' && G.timer > 1.2) { startMatch(); return; }
  if (G.server === i && G.phase === 'serve') {
    if (p.control !== 'racket') toss(p);  // phone racket mode tosses with an upward flick instead
    return;
  }
  if (G.server === i && G.phase === 'toss') {
    if (p.control !== 'racket' && ball.pos.y > 1.7 && G.timer > 0.2) {
      const spin = racketSpin(p);
      hitServe(p, power, { spin: spin > 0.25 ? 0.8 : 0, aim: extra.aim || 0 });
    }
    return;
  }
  p.swingAnim = 0;
  sfx.whoosh(power);
  // Phone racket swings are read straight from the motion stream at contact (racketHit), like ping pong.
  if (p.control === 'racket') return;
  p.swing = { t: G.time, power, spin: 0, lob: !!extra.lob, aim: extra.aim || 0 };
  tryHumanHit(p);
}

// Phone racket mode: when the ball reaches you, look back over the last half second of racket motion
// for the fastest forward swing. Its peak sets the timing (aim) and its speed sets the power.
const RLATE = 0.2;
function racketHit(p) {
  const pl = p.plan;
  const thr = p.profile?.thr ?? 1.0, full = p.profile?.full ?? 5.5;
  let best = null;
  for (const h of p.hist) if (h.gt >= pl.t - EARLY && (!best || h.fwd > best.fwd)) best = h;
  const late = G.time > pl.t + RLATE;
  if (!best || best.fwd <= thr) { if (late) pl.done = true; return; }
  // Still speeding up? Give it a couple of frames to reach its peak.
  const lastH = p.hist[p.hist.length - 1];
  if (best === lastH && !late && G.time < pl.t + 0.08) return;
  const d = Math.hypot(p.pos.x - pl.stand.x, p.pos.z - pl.stand.z);
  if (d > REACH) { pl.done = true; return; }
  const dt = pl.t - best.gt;                       // > 0: swing peaked before the ball arrived
  const tim = clamp((dt - 0.03) / 0.16, -1, 1);
  const handX = sideOf(p.team) * (p.hand === 'left' ? -1 : 1);
  const pullDir = pl.fore ? -handX : handX;
  let up = 0, n = 0;
  for (const h of p.hist) if (Math.abs(h.t - best.t) < 90) { up += h.up; n++; }
  up = n ? up / n : 0;
  const spin = up > 0.8 ? clamp(up / 2.5, 0.25, 1) : up < -0.8 ? -0.6 : 0;
  const quality = clamp(1 - Math.abs(dt - 0.03) / 0.4, 0.4, 1);
  hitBall(p, { power: clamp((best.fwd - thr) / (full - thr), 0.1, 1), aim: clamp(tim * pullDir * 0.9, -1, 1), spin, quality });
  if (!G.demo && Math.abs(dt - 0.03) < 0.05) popupAt('PERFECT', ball.pos, TEAM_COLORS[p.team], 'big');
  p.swingAnim = 0;
}

// Upward racket-head motion during the swing means topspin, downward means slice.
function racketSpin(p) {
  if (p.control !== 'racket' || !p.hist.length) return 0;
  const now = performance.now();
  let up = 0, n = 0;
  for (const h of p.hist) if (now - h.t < 160) { up += h.up; n++; }
  up = n ? up / n : 0;
  return up > 0.7 ? clamp(up / 2.5, 0.25, 1) : up < -0.7 ? -0.6 : 0;
}

function tryHumanHit(p) {
  const pl = p.plan, sw = p.swing;
  if (!pl || pl.done || !sw || !ball.live) return false;
  const dt = pl.t - sw.t;               // how early the swing was
  if (dt > EARLY) return false;          // too early for now; maybe a later swing
  if (G.time < pl.t) return false;       // wait for the ball to arrive
  if (dt < -LATE) { pl.done = true; return false; }
  // Reach check: did the player get there?
  const d = Math.hypot(p.pos.x - pl.stand.x, p.pos.z - pl.stand.z);
  if (d > REACH) { pl.done = true; return false; }
  // Timing decides direction. Early pulls the ball across your body, late pushes it the other way.
  const tim = clamp((dt - SWEET) / 0.2, -1, 1);
  const handX = sideOf(p.team) * (p.hand === 'left' ? -1 : 1);
  const pullDir = pl.fore ? -handX : handX;            // world x direction of a pulled shot
  const aimWorld = clamp(tim * pullDir * 0.9 + sw.aim * 0.3, -1, 1);
  const quality = clamp(1 - Math.abs(dt - SWEET) / 0.45, 0.35, 1);
  const call = Math.abs(dt - SWEET) < 0.05 ? 'PERFECT' : null;
  hitBall(p, { power: sw.power, aim: aimWorld, spin: sw.spin, lob: sw.lob, quality });
  if (call && !G.demo) popupAt(call, ball.pos, TEAM_COLORS[p.team], 'big');
  p.swing = null;
  return true;
}

// ---------- Rules: bounces and the net ----------
function onBounce(pos, speed) {
  sfx.bounce(speed);
  rings.spawn(pos.clone().setY(0.01), new THREE.Color(0xd8ff66), { flat: true, from: 0.1, to: 0.9, dur: 0.4 });
  if (!ball.live) return;
  const sideTeam = pos.z > 0 ? 0 : 1;
  const lineCall = (x, z) => Math.abs(x) <= C.HW + C.R && Math.abs(z) <= C.HL + C.R;
  if (ball.serve) {
    const sg = sideOf(ball.lastTeam);
    const inBox = sideTeam !== ball.lastTeam && Math.abs(pos.z) <= C.SVC + C.R &&
      pos.x * G.serveBox >= -C.R && Math.abs(pos.x) <= C.SHW + C.R;
    void sg;
    if (inBox && ball.netTouch) { ball.live = false; callout('LET', 0xffffff); G.phase = 'dead'; later(1.2, setupServe); return; }
    if (!inBox) {
      ball.live = false;
      if (G.second) { award(1 - ball.lastTeam, 'DOUBLE FAULT'); return; }
      callout('FAULT', 0xff6b6b);
      G.phase = 'dead';
      G.second = true;
      later(1.3, setupServe);
      return;
    }
    ball.serve = false;
    ball.bounces = 1;
    return;
  }
  if (ball.bounces === 0) {
    if (sideTeam === ball.lastTeam) { award(1 - ball.lastTeam, 'NET'); return; }
    if (!lineCall(pos.x, pos.z)) { award(sideTeam, 'OUT'); return; }
    ball.bounces = 1;
    return;
  }
  award(ball.lastTeam, G.shots <= 1 && ball.lastTeam === players[G.server].team ? 'ACE!' : 'WINNER!');
}

// ---------- FX ----------
function hitFx(p, power, smash) {
  const head = p.ch.racket.userData.head.getWorldPosition(new THREE.Vector3());
  const col = new THREE.Color(TEAM_COLORS[p.team]);
  particles.burst(ball.pos, col, { count: 10 + Math.round(power * 16), speed: 2 + power * 4, size: 0.05, life: 0.5 });
  rings.spawn(ball.pos.clone(), col, { from: 0.1, to: 0.9 + power, dur: 0.3, normalZ: 1 });
  sfx.hit(power, smash);
  if (!G.demo) {
    shake.add(smash ? 0.45 : 0.08 + power * 0.12);
    G.hitStop = smash ? 0.06 : 0.015 + power * 0.015;
    G.fovPunch = smash ? 4 : power * 1.2;
    G.chroma = smash ? 0.006 : 0.0015 * power;
  }
  trail.color.set(col).lerp(new THREE.Color(1, 1, 1), 0.4);
  if (p.phone) haptic(p, smash ? 'smash' : 'hit', power);
  void head;
}

function callout(text, color, cls = 'huge') {
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.left = '50%';
  el.style.top = '36%';
  el.style.color = `#${new THREE.Color(color).getHexString()}`;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
const _v = new THREE.Vector3();
function popupAt(text, pos, color, cls = '') {
  _v.copy(pos).project(camera);
  if (_v.z > 1) return;
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.left = `${(_v.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-_v.y * 0.5 + 0.5) * innerHeight - 30}px`;
  el.style.color = `#${new THREE.Color(color).getHexString()}`;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ---------- Movement and animation ----------
function homeOf(p) {
  const sg = sideOf(p.team);
  const z = p.role === 'front' ? sg * 4.2 : sg * (C.HL - 0.3);
  const shift = ball.live ? clamp(ball.pos.x * 0.35, -1.5, 1.5) : 0;
  return new THREE.Vector3(p.half * 2.4 + shift, 0, z);
}

function updatePlayer(p, dt) {
  const L = AI_LEVELS[G.demo ? 'medium' : settings.level];
  const speed = p.kind === 'human' ? 7.8 : L.speed;
  let target;
  if (G.phase === 'serve' || G.phase === 'toss') target = p.pos.clone();
  else if (p.plan && !p.plan.done) target = p.plan.stand;
  else target = homeOf(p);
  const d = new THREE.Vector3(target.x - p.pos.x, 0, target.z - p.pos.z);
  const dist = d.length();
  const want = dist > 0.05 ? d.multiplyScalar(Math.min(speed, dist * 6) / dist) : d.set(0, 0, 0);
  p.vel.lerp(want, 1 - Math.exp(-10 * dt));
  p.pos.addScaledVector(p.vel, dt);
  // Stay on your own side of the net.
  const sg = sideOf(p.team);
  if (p.pos.z * sg < 0.7) p.pos.z = sg * 0.7;

  // Contact.
  if (p.plan && !p.plan.done && ball.live && G.time >= p.plan.t) {
    if (p.kind === 'ai') {
      const reach = Math.hypot(p.pos.x - p.plan.stand.x, p.pos.z - p.plan.stand.z);
      if (reach < REACH) aiHit(p);
      else p.plan.done = true;
    } else if (p.control === 'racket') {
      racketHit(p);
    } else if (!tryHumanHit(p) && G.time > p.plan.t + LATE) {
      p.plan.done = true;
    }
  }
  // AI starts its swing animation a moment before contact.
  if (p.kind === 'ai' && p.plan && !p.plan.done && p.plan.t - G.time < 0.25 && p.swingAnim >= 1) p.swingAnim = 0;
}

function animatePlayer(p, dt) {
  const ch = p.ch;
  ch.group.position.copy(p.pos);
  const face = p.team === 0 ? 0 : Math.PI;
  ch.group.rotation.y = face;
  const sp = Math.hypot(p.vel.x, p.vel.z);
  const run = clamp(sp / 6, 0, 1);
  p.runPhase += dt * (6 + sp * 2.2);
  const s = Math.sin(p.runPhase);
  ch.legs[0].rotation.x = s * 0.9 * run;
  ch.legs[1].rotation.x = -s * 0.9 * run;
  ch.body.position.y = 0.62 + Math.abs(Math.cos(p.runPhase)) * 0.05 * run;
  ch.offArm.rotation.set(-s * 0.7 * run, 0, 0);
  ch.body.rotation.set(0.12 * run, 0, 0);
  // Ready position: racket held up in front.
  ch.racketArm.rotation.set(-0.9, 0, -0.25 * ch.hs);
  ch.racket.rotation.set(-0.9, 0, 0.5 * ch.hs);

  // Ground-stroke swing: twist the body and sweep the racket arm across.
  if (p.swingAnim < 1) {
    p.swingAnim = Math.min(1, p.swingAnim + dt / 0.42);
    const k = p.swingAnim;
    const e = k < 0.35 ? -k / 0.35 : -1 + (k - 0.35) / 0.65 * 2;  // back, then through
    const side = p.swingSide * ch.hs;
    ch.body.rotation.y = -e * 0.9 * side;
    ch.racketArm.rotation.set(-1.25, 0, 0);
    ch.racketArm.rotation.z = (0.6 + e * 0.3) * ch.hs * (p.swingSide > 0 ? 1 : -0.4);
    ch.racket.rotation.set(-1.0, 0, 0);
  }
  // Serve: toss arm up, racket behind the head, then over the top.
  if (p.serveAnim >= 0) {
    p.serveAnim += dt;
    const k = p.serveAnim;
    if (k < 0.55) {
      ch.offArm.rotation.set(-2.9 * Math.min(1, k / 0.25), 0, 0);
      ch.racketArm.rotation.set(-2.8 * Math.min(1, k / 0.4), 0, 0);
      ch.racket.rotation.set(-1.4, 0, 0);
    } else if (k < 0.85) {
      const u = (k - 0.55) / 0.3;
      ch.offArm.rotation.set(-2.9 + u * 2.4, 0, 0);
      ch.racketArm.rotation.set(-3.4 + u * 3.0, 0, 0);
      ch.racket.rotation.set(-0.3, 0, 0);
    } else if (G.phase !== 'toss') p.serveAnim = -1;
    else ch.racketArm.rotation.set(-2.8, 0, 0);
  }
}

// Serving in racket mode: a forward swing after the toss went up hits the serve.
function serveSwing(s) {
  const thr = s.profile?.thr ?? 1.0, full = s.profile?.full ?? 5.5;
  const now = performance.now();
  let best = null;
  for (const h of s.hist) if (h.gt > G.toss0 + 0.25 && now - h.t < 150 && (!best || h.fwd > best.fwd)) best = h;
  if (!best || best.fwd <= thr) return false;
  const up = best.up;
  hitServe(s, clamp((best.fwd - thr) / (full - thr), 0.1, 1), { spin: up > 0.8 ? 0.8 : 0 });
  return true;
}

// ---------- Main update ----------
function update(dt) {
  G.time += dt;
  G.timer += dt;
  if (G.nextFn && G.time >= G.deadUntil) { const f = G.nextFn; G.nextFn = null; f(); }

  const s = players[G.server];
  if (G.phase === 'serve') {
    holdBallAt(s);
    if (s.kind === 'ai' && G.timer > (G.demo ? 0.8 : 1.3)) toss(s);
    if (s.kind === 'human' && s.control === 'racket' && G.timer > 0.4) {
      const now = performance.now();
      if (s.hist.some((h) => now - h.t < 120 && h.up > 2.0 && h.up > Math.abs(h.fwd) * 1.5)) toss(s);
    }
  } else if (G.phase === 'toss') {
    stepBall(ball, dt);
    if (s.kind === 'ai' && ball.vel.y < 0 && ball.pos.y < 2.7) {
      const L = AI_LEVELS[G.demo ? 'medium' : settings.level];
      const fault = Math.random() < (G.second ? L.fault * 0.4 : L.fault);
      hitServe(s, G.second ? rnd(0.3, 0.55) : rnd(0.55, 0.9), { spin: G.second ? 0.8 : 0, aim: rnd(-1, 1) * (fault ? 3 : 0.8) });
    } else if (s.kind === 'human' && s.control === 'racket' && ball.pos.y > 1.7 && G.timer > 0.3 && serveSwing(s)) {
      // served from the motion stream
    } else if (ball.pos.y <= C.R + 0.01 && ball.vel.y <= 0.01) {
      // Dropped the toss: just take it again.
      if (!G.demo && s.kind === 'human') setHint('Missed it: flick up to toss again, then swing');
      G.phase = 'serve';
      G.timer = 0;
      s.serveAnim = -1;
    }
  } else if (G.phase === 'rally' || G.phase === 'dead') {
    const n = 4;
    for (let k = 0; k < n; k++) {
      const ev = stepBall(ball, dt / n);
      if (ev === 'bounce') onBounce(ball.pos, Math.abs(ball.vel.y));
      if (ev === 'net') {
        sfx.net();
        if (ball.live) { ball.netTouch = true; planReceivers(); }
      }
    }
    if (ball.live && (Math.abs(ball.pos.z) > 30 || Math.abs(ball.pos.x) > 25)) award(1 - ball.lastTeam, 'OUT');
  }
  players.forEach((p) => updatePlayer(p, dt));
}

// ---------- Camera ----------
const camPos = new THREE.Vector3(0, 6, C.HL + 10);
const camLook = new THREE.Vector3(0, 0.6, -3);
function updateCamera(dt) {
  let tp, tl;
  if (G.demo) {
    const a = G.time * 0.08;
    tp = new THREE.Vector3(Math.sin(a) * 20, 8, Math.cos(a) * 24);
    tl = new THREE.Vector3(0, 0.5, 0);
  } else {
    const me = players[0];
    const fx = clamp(me.pos.x * 0.3 + ball.pos.x * 0.15, -3, 3);
    tp = new THREE.Vector3(fx, 6.2, C.HL + 9.5);
    tl = new THREE.Vector3(fx * 0.4, 0.6, -3.5);
  }
  camPos.x = damp(camPos.x, tp.x, 3, dt); camPos.y = damp(camPos.y, tp.y, 3, dt); camPos.z = damp(camPos.z, tp.z, 3, dt);
  camLook.lerp(tl, 1 - Math.exp(-4 * dt));
  shake.update(dt);
  camera.position.copy(camPos).add(shake.offset);
  camera.lookAt(camLook);
  camera.rotation.z += shake.roll;
  G.fovPunch = damp(G.fovPunch, 0, 8, dt);
  camera.fov = 48 + G.fovPunch;
  camera.updateProjectionMatrix();
  bokeh.uniforms.focus.value = camera.position.distanceTo(ball.live || G.phase === 'toss' ? ball.pos : camLook);
  G.chroma = damp(G.chroma, 0, 6, dt);
  lens.uniforms.amount.value = G.chroma;
  lens.uniforms.time.value = G.time;
}

// ---------- Network ----------
const pingMs = [0, 0];
const host = new Host({
  onStatus(state, info) {
    const el = $('netStatus');
    if (state === 'ready') { el.textContent = `Room ${info}`; el.className = 'pill ok'; renderQR(1); renderQR(2); }
    else if (state === 'error') { el.textContent = info; el.className = 'pill bad'; }
    else { el.textContent = 'Connecting to pairing server…'; el.className = 'pill'; }
  },
  onJoin(slot) {
    const p = players[slot - 1];
    if (!p) return;
    p.phone = true;
    $(`p${slot}State`).textContent = 'Phone connected';
    $(`p${slot}Card`).classList.add('joined');
    sfx.join();
    callout(`P${slot} CONNECTED`, TEAM_COLORS[0], 'big');
    sendState();
  },
  onLeave(slot) {
    const p = players[slot - 1];
    if (!p) return;
    p.phone = false;
    $(`p${slot}State`).textContent = 'Waiting for phone…';
    $(`p${slot}Card`).classList.remove('joined');
    pingMs[slot - 1] = 0;
  },
  onData(slot, m) {
    const p = players[slot - 1];
    if (!p || !m) return;
    if (m.t === 'r' && Array.isArray(m.h) && Array.isArray(m.n) && Array.isArray(m.v)) {
      p.control = 'racket';
      p.racket = { h: new THREE.Vector3(...m.h), n: new THREE.Vector3(...m.n), v: new THREE.Vector3(...m.v) };
      const now = performance.now();
      p.hist.push({ t: now, gt: G.time, fwd: -m.v[2], lat: m.v[0], up: m.v[1] });
      while (p.hist.length && now - p.hist[0].t > 900) p.hist.shift();
    } else if (m.t === 'in') {
      p.control = 'tilt';
    } else if (m.t === 'sw') {
      if (m.id != null) { if (m.id === p.lastSwingId) return; p.lastSwingId = m.id; }
      onSwing(p.i, clamp(+m.p || 0.5, 0, 1), { aim: clamp(+m.d || 0, -1, 1) * 0.3 });
    } else if (m.t === 'pong') {
      const rtt = performance.now() - m.ts;
      pingMs[slot - 1] = pingMs[slot - 1] ? pingMs[slot - 1] * 0.7 + rtt * 0.3 : rtt;
      const parts = players.slice(0, 2).map((q, k) => (q.phone && pingMs[k] ? `P${k + 1} ${Math.round(pingMs[k])} ms` : null)).filter(Boolean);
      $('ping').textContent = parts.length ? parts.join(' · ') : 'No phone';
    } else if (m.t === 'prof') {
      p.profile = m;
      p.hand = m.hand === 'left' ? 'left' : 'right';
      callout(`P${slot} SWING CALIBRATED`, TEAM_COLORS[0], 'big');
    } else if (m.t === 'start') {
      if (G.demo || G.phase === 'over') startMatch();
    }
  },
});
setInterval(() => { players.forEach((p) => { if (p.phone) host.sendFast(p.slot, { t: 'ping', ts: performance.now() }); }); }, 1000);
function haptic(p, kind, power = 0.5) { if (p.phone && p.kind === 'human') host.send(p.slot, { t: 'hap', k: kind, p: power }); }
function sendState() {
  players.slice(0, 2).forEach((p) => {
    if (!p.phone) return;
    host.send(p.slot, { t: 'st', mode: G.phase === 'over' ? 'over' : 'rally', demo: G.demo, you: G.games[0], them: G.games[1],
      serve: (G.phase === 'serve' || G.phase === 'toss') && G.server === p.i && !G.demo });
  });
}
function renderQR(slot) {
  const url = host.controllerUrl(slot);
  const qr = window.qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  $(`qr${slot}`).innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  $(`url${slot}`).textContent = url;
  $(`url${slot}`).href = url;
}

// ---------- Mouse / keyboard (for playing without a phone) ----------
addEventListener('mousedown', (e) => {
  enableAudio();
  if (G.demo || e.target.closest('button, a, input, label')) return;
  onSwing(0, e.button === 2 ? 0.55 : 0.75, { lob: e.button === 2, aim: 0 });
});
addEventListener('contextmenu', (e) => { if (!G.demo) e.preventDefault(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !G.demo) { e.preventDefault(); onSwing(0, 0.75); }
  if (e.code === 'Escape' && !G.demo) toLobby();
});
let audioOn = false;
function enableAudio() { if (!audioOn) { unlockAudio(); audioOn = true; $('soundHint')?.classList.add('hide'); } }
addEventListener('pointerdown', enableAudio, { once: true });

// ---------- Game flow ----------
function startMatch() {
  enableAudio();
  G.demo = false;
  players[0].kind = 'human';
  players[1].kind = players[1].phone ? 'human' : 'ai';
  players[0].control = players[0].phone ? players[0].control : 'touch';
  G.pts = [0, 0]; G.games = [0, 0]; G.gameIdx = 0;
  $('lobby').classList.add('hide');
  $('overPanel').classList.add('hide');
  $('hud').classList.remove('hide');
  sfx.blip();
  startPoint();
}
function toLobby() {
  G.demo = true;
  players.forEach((p) => { p.kind = 'ai'; });
  G.pts = [0, 0]; G.games = [0, 0];
  $('lobby').classList.remove('hide');
  $('hud').classList.add('hide');
  $('overPanel').classList.add('hide');
  setHint('');
  startPoint();
}
function gameOver(team) {
  G.phase = 'over';
  G.timer = 0;
  const win = team === 0;
  $('banner').textContent = win ? (players[1].kind === 'human' ? 'YOU BOTH WIN!' : 'YOU WIN!') : 'CPU WINS';
  $('banner').style.color = win ? 'var(--p1)' : 'var(--p2)';
  $('overPanel').classList.remove('hide');
  if (win) sfx.win();
  setHint('');
  sendState();
}
$('btnStart').addEventListener('click', startMatch);
$('btnAgain').addEventListener('click', startMatch);
$('btnMenu').addEventListener('click', toLobby);
document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
  settings.level = b.dataset.level;
  document.querySelectorAll('[data-level]').forEach((x) => x.classList.toggle('on', x === b));
  sfx.blip();
}));
document.querySelectorAll('[data-games]').forEach((b) => b.addEventListener('click', () => {
  settings.games = +b.dataset.games;
  document.querySelectorAll('[data-games]').forEach((x) => x.classList.toggle('on', x === b));
  sfx.blip();
}));

// ---------- Loop ----------
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
const perf = { frames: 0, since: performance.now(), level: 0 };
const debug = { render: true };
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (G.hitStop > 0) { G.hitStop -= dt; dt *= 0.08; }
  const sdt = dt * GAME_SPEED;
  update(sdt);
  players.forEach((p) => animatePlayer(p, sdt));
  ballMesh.position.copy(ball.pos);
  ballMesh.rotation.x += sdt * 12; ballMesh.rotation.y += sdt * 7;
  ballLight.position.copy(ball.pos);
  if (ball.live) trail.push(ball.pos, ball.vel.length() / 4); else trail.clear();
  trail.update();
  particles.update(dt);
  rings.update(dt);
  updateCamera(dt);
  // Crowd light sticks sway.
  arena.crowdMesh.position.y = Math.sin(G.time * 2.2) * 0.04;
  perf.frames++;
  if (now - perf.since > 1000) {
    const fps = perf.frames * 1000 / (now - perf.since);
    $('fps').textContent = `${Math.round(fps)} fps`;
    if (fps < 45 && perf.level === 0 && !G.demo) { perf.level = 1; bokeh.enabled = false; }
    else if (fps < 45 && perf.level === 1) { perf.level = 2; renderer.setPixelRatio(1); composer.setSize(innerWidth, innerHeight); }
    perf.frames = 0; perf.since = now;
  }
  if (!debug.render) return;
  renderer.shadowMap.needsUpdate = true;
  composer.render();
}
toLobby();
requestAnimationFrame(frame);

window.__tennis = { G, ball, players, startMatch, toLobby, onSwing, settings, debug, predict };
