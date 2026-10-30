// Host page: renders the game on the PC and runs physics, rules, AI and FX.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { T, COLORS, buildRoom, buildTable, buildPaddle, buildBall, Scoreboard } from './world.js';
import { Particles, Rings, Trail, Shake, Motes } from './fx.js';
import { Host } from './net.js';
import { sfx, unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Tuning ----------
const GRAV = 8.2;          // slightly floaty so motion controls have time
const SPEED = 0.9;         // global sim speed
const PZ = T.HL + 0.32;    // paddle plane distance from the net
const WIN_AT = 11;
const AI_LEVELS = {
  easy:   { speed: 1.5, err: 0.15, react: 0.32, power: [0.2, 0.5],  reach: 0.15, miss: 0.2,  sloppy: 0.6 },
  medium: { speed: 2.4, err: 0.08, react: 0.2,  power: [0.35, 0.75], reach: 0.17, miss: 0.1,  sloppy: 0.4 },
  hard:   { speed: 3.6, err: 0.035, react: 0.1, power: [0.55, 0.95], reach: 0.2, miss: 0.04, sloppy: 0.2 },
};
const settings = { level: 'medium', assist: true, mode: '1p' };

// ---------- Renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Shadows are refreshed once per frame by hand, not once per render pass (DoF and split screen render the scene several times).
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07051a);
scene.fog = new THREE.FogExp2(0x07051a, 0.075);

const BASE_FOV = 52;

scene.add(new THREE.HemisphereLight(0x6a5cff, 0x1a0f2a, 0.55));
const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
key.position.set(0.4, 5, 0.9);
key.target.position.set(0, T.Y, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -2.4, right: 2.4, top: 2.4, bottom: -2.4, near: 1, far: 8 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.01;
scene.add(key, key.target);
const rimA = new THREE.PointLight(COLORS.p1, 6, 9, 1.6);
rimA.position.set(-3, 2.2, 1.5);
const rimB = new THREE.PointLight(COLORS.p2, 6, 9, 1.6);
rimB.position.set(3, 2.2, -2);
scene.add(rimA, rimB);

buildRoom(scene);
buildTable(scene);
const boards = [new Scoreboard(scene), new Scoreboard(scene, true)];
const particles = new Particles(scene);
const rings = new Rings(scene);
const trail = new Trail(scene);
const shake = new Shake();
const motes = new Motes(scene, 18);

const ballMesh = buildBall();
scene.add(ballMesh);
const ballLight = new THREE.PointLight(0xffaa66, 1.6, 1.6, 2);
scene.add(ballLight);

// ---------- Post-processing: DoF -> bloom -> chroma/vignette -> tonemap ----------
// Each player gets a camera + composer so two-player mode can render split screen.
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

function makeView() {
  const camera = new THREE.PerspectiveCamera(BASE_FOV, innerWidth / innerHeight, 0.05, 40);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bokeh = new BokehPass(scene, camera, { focus: 3.0, aperture: 0.0035, maxblur: 0.008 });
  // Keep a sharp band around the focus distance and blur the foreground less than the background,
  // so the table and ball stay crisp while the room melts away.
  bokeh.materialBokeh.fragmentShader = bokeh.materialBokeh.fragmentShader.replace(
    'float factor = ( focus + viewZ );',
    'float factor = ( focus + viewZ ); factor = sign( factor ) * max( abs( factor ) - 0.9, 0.0 ); if ( factor > 0.0 ) factor *= 0.3;'
  );
  bokeh.materialBokeh.needsUpdate = true;
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.35, 1.15);
  composer.addPass(bloom);
  const lens = new ShaderPass(LENS_SHADER);
  composer.addPass(lens);
  composer.addPass(new OutputPass());
  return { camera, composer, bokeh, bloom, lens, pos: new THREE.Vector3(), look: new THREE.Vector3(), focus: 3 };
}
const views = [makeView(), makeView()];

// ---------- Players & ball ----------
const players = [0, 1].map((i) => {
  const zs = i === 0 ? 1 : -1;
  const color = new THREE.Color(i === 0 ? COLORS.p1 : COLORS.p2);
  const pad = buildPaddle(i === 0 ? COLORS.p1 : COLORS.p2, -zs);
  scene.add(pad.group);
  return {
    i, zs, color, pad,
    kind: 'ai',
    input: { x: 0, y: 0 },
    swing: null,
    pos: new THREE.Vector3(0, T.Y + 0.2, zs * PZ),
    swingAnim: 1, squash: 0, zoneGlow: 0,
    ai: { plan: null, timer: 0, err: new THREE.Vector2(), swung: false },
    phone: false,
  };
});

const ball = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(),
  inPlay: false, lastHitter: -1, bounces: [0, 0], flash: 0,
};

const G = {
  mode: 'lobby', demo: true, split: false, score: [0, 0], server: 0, rally: 0, timer: 0,
  hitStop: 0, timeScale: 1, fovPunch: 0, chroma: 0, time: 0, heat: 0,
};

// ---------- Networking ----------
let audioReady = false;
const pingMs = [0, 0];
const lastSwingId = [-1, -1];
const host = new Host({
  onStatus(state, info) {
    const el = $('netStatus');
    if (state === 'ready') {
      el.textContent = `Room ${info}`;
      el.className = 'pill ok';
      renderQR(1);
      renderQR(2);
    } else if (state === 'error') {
      el.textContent = info;
      el.className = 'pill bad';
    } else {
      el.textContent = 'Connecting to pairing server…';
      el.className = 'pill';
    }
  },
  onJoin(slot) {
    const i = slot - 1;
    if (!players[i]) return;
    players[i].phone = true;
    $(`p${slot}State`).textContent = 'Phone connected';
    $(`p${slot}Card`).classList.add('joined');
    sfx.join();
    popupScreen(`P${slot} CONNECTED`, players[i].color.getHex());
    if (slot === 2 && G.demo) selectMode('2p');
    sendState();
  },
  onLeave(slot) {
    const i = slot - 1;
    if (!players[i]) return;
    players[i].phone = false;
    $(`p${slot}State`).textContent = 'Waiting for phone…';
    $(`p${slot}Card`).classList.remove('joined');
    pingMs[i] = 0;
    showPing();
  },
  onData(slot, m) {
    const i = slot - 1;
    const p = players[i];
    if (!p || !m) return;
    if (m.t === 'in') {
      p.input.x = clamp(+m.x || 0, -1.5, 1.5);
      p.input.y = clamp(+m.y || 0, -1.5, 1.5);
      if (i === 0) lastPhoneInput = performance.now();
    } else if (m.t === 'sw') {
      // Swings arrive on both the fast and the reliable channel; act on the first copy only.
      if (m.id != null) {
        if (m.id === lastSwingId[i]) return;
        lastSwingId[i] = m.id;
      }
      humanSwing(i, clamp(+m.p || 0.5, 0, 1), clamp(+m.d || 0, -1, 1));
    } else if (m.t === 'pong') {
      const rtt = performance.now() - m.ts;
      pingMs[i] = pingMs[i] ? pingMs[i] * 0.7 + rtt * 0.3 : rtt;
      showPing();
    } else if (m.t === 'start') {
      if (G.demo || G.mode === 'over') startGame();
    }
  },
});
let lastPhoneInput = 0;
// Round-trip time to each phone, shown in the corner so lag is visible.
setInterval(() => {
  players.forEach((p, i) => { if (p.phone) host.sendFast(i + 1, { t: 'ping', ts: performance.now() }); });
}, 1000);
function showPing() {
  const parts = players.map((p, i) => (p.phone && pingMs[i] ? `P${i + 1} ${Math.round(pingMs[i])} ms` : null)).filter(Boolean);
  const worst = Math.max(...pingMs);
  $('ping').textContent = parts.length ? parts.join(' · ') : 'No phone';
  $('ping').className = `pill ${!parts.length ? '' : worst < 40 ? 'ok' : worst < 90 ? '' : 'bad'}`;
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

// Each phone gets the score from its own point of view.
function sendState(extra = {}) {
  [1, 2].forEach((slot) => {
    const i = slot - 1;
    const msg = {
      t: 'st', mode: G.mode, demo: G.demo,
      you: G.score[i], them: G.score[1 - i],
      serve: G.mode === 'serve' && G.server === i,
    };
    if (extra.winner != null) msg.point = extra.winner === i ? 'won' : 'lost';
    host.send(slot, msg);
  });
}

function haptic(p, kind, power = 0.5) {
  if (players[p].kind === 'human') host.send(p + 1, { t: 'hap', k: kind, p: power });
}

const names = () => (G.split ? ['P1', 'P2'] : ['YOU', 'AI']);

// ---------- Mouse / keyboard fallback ----------
let mouseVX = 0, lastMX = 0;
addEventListener('pointermove', (e) => {
  if (performance.now() - lastPhoneInput < 1500) return;
  const p = players[0];
  p.input.x = (e.clientX / innerWidth * 2 - 1) * 1.35;
  p.input.y = -(e.clientY / innerHeight * 2 - 1) * 1.3;
  mouseVX = mouseVX * 0.6 + (e.clientX - lastMX) * 0.4;
  lastMX = e.clientX;
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  enableAudio();
  if (G.demo) return;
  humanSwing(0, e.button === 2 || e.shiftKey ? 1 : 0.6, clamp(mouseVX / 25, -1, 1));
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  enableAudio();
  if (e.code === 'Space' && !G.demo) { humanSwing(0, 1, clamp(mouseVX / 25, -1, 1)); e.preventDefault(); }
  if (e.code === 'Escape') toLobby();
  if (e.code === 'Enter' && (G.demo || G.mode === 'over')) startGame();
});
addEventListener('pointerdown', enableAudio);

function enableAudio() {
  unlockAudio();
  if (!audioReady) { audioReady = true; $('soundHint')?.classList.add('hide'); }
}

// ---------- Physics helpers ----------
// Velocity that lands the ball at (tx, table, tz) with the given horizontal speed, clearing the net.
function computeShot(from, tx, tz, hSpeed) {
  const ty = T.Y + T.R;
  let v = hSpeed;
  const out = new THREE.Vector3();
  for (let k = 0; k < 16; k++) {
    const dx = tx - from.x, dz = tz - from.z;
    const D = Math.hypot(dx, dz);
    const t = D / v;
    const vy = (ty - from.y + 0.5 * GRAV * t * t) / t;
    out.set(dx / t, vy, dz / t);
    if (Math.sign(from.z) === Math.sign(tz) || out.z === 0) return out;
    const tn = -from.z / out.z;
    const yn = from.y + vy * tn - 0.5 * GRAV * tn * tn;
    if (yn > T.Y + T.NET_H + T.R + 0.03) return out;
    v *= 0.9;
  }
  return out;
}

function canHit(p) {
  return G.mode === 'rally' && ball.inPlay && ball.lastHitter !== p && ball.bounces[p] >= 1;
}

function humanSwing(p, power, dir) {
  const pl = players[p];
  if (pl.kind !== 'human') return;
  pl.swing = { t: G.time, p: power, d: dir };
  pl.swingAnim = 0;
  sfx.whoosh(power);
  if (G.mode === 'serve' && G.server === p) serve(p, power, dir);
  else if (G.mode === 'over' && G.timer > 1.2) startGame();
}

function serve(p, power = 0.5, dir = 0) {
  const pl = players[p];
  holdBall();
  const tx = clamp(pl.zs * dir * 0.45 + rnd(-0.2, 0.2), -0.6, 0.6);
  const tz = -pl.zs * rnd(0.55, 1.05);
  ball.vel.copy(computeShot(ball.pos, tx, tz, 3.6 + power * 1.6));
  ball.inPlay = true;
  ball.lastHitter = p;
  ball.bounces = [0, 0];
  G.mode = 'rally';
  G.rally = 0;
  trail.clear();
  hitFx(p, 0.35 + power * 0.3, false);
  sendState();
}

function performHit(p, { power, dir = 0, quality = 1, auto = false, targetX = null }) {
  const pl = players[p];
  const zs = pl.zs;
  power = clamp(power, 0, 1);
  const high = ball.pos.y > T.Y + 0.3;
  const smash = !auto && power > 0.72 && high && quality > 0.35;
  const off = ball.pos.x - pl.pos.x;
  let tx = targetX ?? (zs * dir * 0.55 + off * 2.0 + pl.pos.x * 0.15);
  tx = clamp(tx, -0.68, 0.68) + (Math.random() - 0.5) * (1 - quality) * 0.7;
  let tz = -zs * clamp(0.4 + 0.85 * power + (Math.random() - 0.5) * (1 - quality) * 0.5, 0.25, 1.32);
  let hs = (3.3 + power * 3.6) * (0.85 + 0.15 * quality);
  if (smash) { hs = 7.6; tz = -zs * rnd(0.8, 1.2); }
  if (auto) hs = 3.0;
  ball.vel.copy(computeShot(ball.pos, tx, tz, hs));
  ball.lastHitter = p;
  ball.bounces = [0, 0];
  G.rally++;
  pl.squash = 1;
  if (pl.kind === 'ai') pl.swingAnim = 0;
  hitFx(p, power, smash);
  if (G.rally > 0 && G.rally % 5 === 0) popup3D(`RALLY x${G.rally}`, ball.pos, 0xffd166, 'big', p);
}

function hitFx(p, power, smash) {
  const pl = players[p];
  const c = pl.color.clone().multiplyScalar(3);
  G.hitStop = 0.035 + power * 0.05 + (smash ? 0.1 : 0);
  shake.add(0.16 + power * 0.22 + (smash ? 0.45 : 0));
  G.chroma = Math.max(G.chroma, 0.004 + power * 0.008 + (smash ? 0.025 : 0));
  G.fovPunch = Math.max(G.fovPunch, 1.5 + power * 2.5 + (smash ? 6 : 0));
  ball.flash = 1;
  particles.burst(ball.pos, c, { count: 16 + Math.round(power * 26) + (smash ? 40 : 0), speed: 2 + power * 2.5 + (smash ? 3 : 0), size: 0.022, life: 0.55, up: 0.2, dir: new THREE.Vector3(0, 0.3, -pl.zs), spread: 1.4 });
  rings.spawn(ball.pos, c, { to: 0.25 + power * 0.25 + (smash ? 0.5 : 0), dur: 0.3, normalZ: pl.zs });
  sfx.hit(power, smash);
  haptic(p, smash ? 'smash' : 'hit', power);
  if (smash) {
    G.timeScale = 0.3;
    popup3D('SMASH!', ball.pos, pl.color.getHex(), 'big', p);
    flash(0.35);
  }
}

function onBounce(side, speed) {
  sfx.bounce(speed);
  const c = new THREE.Color(1, 1, 1).lerp(heatColor(), 0.6).multiplyScalar(2.2);
  rings.spawn(new THREE.Vector3(ball.pos.x, T.Y + 0.004, ball.pos.z), c, { flat: true, to: 0.16, dur: 0.45 });
  particles.burst(new THREE.Vector3(ball.pos.x, T.Y + 0.01, ball.pos.z), c, { count: 6, speed: 1, size: 0.012, life: 0.35, up: 1 });
  shake.add(0.03);
  if (!ball.inPlay) return;
  const h = ball.lastHitter, opp = 1 - h;
  if (side === h) return award(opp, ball.bounces[opp] === 0 && G.rally === 0 ? 'FAULT' : 'OWN SIDE');
  ball.bounces[opp]++;
  if (ball.bounces[opp] >= 2) award(h, G.rally === 0 ? 'ACE!' : 'WINNER!');
}

function onNet() {
  sfx.net();
  shake.add(0.12);
  particles.burst(ball.pos, new THREE.Color(3, 3, 3), { count: 10, speed: 1.2, size: 0.012, life: 0.4 });
  if (ball.inPlay) popup3D('NET', ball.pos, 0xffffff, '', ball.pos.z > 0 ? 0 : 1);
}

function onOut() {
  if (!ball.inPlay) return;
  const h = ball.lastHitter, opp = 1 - h;
  if (ball.bounces[opp] >= 1) award(h, players[opp].kind === 'ai' || G.demo ? 'WINNER!' : 'MISSED');
  else award(opp, 'OUT');
}

function award(winner, reason) {
  ball.inPlay = false;
  stats.push({ winner, reason, rally: G.rally });
  G.score[winner]++;
  G.mode = 'point';
  G.timer = 0;
  boards.forEach((b) => { b.set(G.score[0], G.score[1]); b.group.scale.setScalar(1.12); });
  const col = players[winner].color.getHex();
  const humanWon = winner === 0;
  popupScreen(reason, col);
  if (!G.demo) {
    sfx.point(G.split || humanWon);
    haptic(winner, 'win');
    haptic(1 - winner, 'lose');
  }
  const c = players[winner].color.clone().multiplyScalar(3);
  particles.burst(new THREE.Vector3(rnd(-1, 1), 1.95, -5.4), c, { count: 12, speed: 2.2, size: 0.035, life: 1, up: 0.6, grav: 0.6 });
  shake.add(0.2);
  const [a, b] = G.score;
  if (!G.demo && (a >= WIN_AT || b >= WIN_AT) && Math.abs(a - b) >= 2) {
    G.mode = 'over';
    G.timer = 0;
    G.timeScale = 0.25;
    setTimeout(() => {
      $('banner').textContent = G.split ? `P${winner + 1} WINS!` : humanWon ? 'YOU WIN!' : 'AI WINS';
      $('banner').style.color = winner === 0 ? '#29e7ff' : '#ff3d9a';
      $('overPanel').classList.remove('hide');
      sfx.win();
      flash(0.5);
      for (let k = 0; k < 8; k++) {
        setTimeout(() => particles.burst(new THREE.Vector3(rnd(-1.5, 1.5), rnd(1.2, 2.2), rnd(-2, 0)), new THREE.Color().setHSL(Math.random(), 1, 0.6).multiplyScalar(4), { count: 40, speed: 3.5, size: 0.03, life: 1.6, up: 0.4, grav: 0.5 }), k * 160);
      }
    }, 500);
  } else if (G.demo && (a >= WIN_AT || b >= WIN_AT)) {
    G.score = [0, 0];
    setTimeout(() => boards.forEach((b) => b.set(0, 0)), 1200);
  }
  sendState({ winner });
}

function nextServe() {
  const total = G.score[0] + G.score[1];
  const deuce = G.score[0] >= WIN_AT - 1 && G.score[1] >= WIN_AT - 1;
  G.server = deuce ? total % 2 : Math.floor(total / 2) % 2;
  G.mode = 'serve';
  G.timer = 0;
  ball.inPlay = false;
  ball.vel.set(0, 0, 0);
  holdBall();
  trail.clear();
  for (const p of players) { p.ai.plan = null; p.ai.swung = false; p.ai.timer = 0; }
  sendState();
  if (!G.demo) {
    $('hint').textContent = G.split ? `P${G.server + 1} serve: swing!` : G.server === 0 ? 'Your serve: swing!' : 'AI serves';
    $('hint').classList.remove('hide');
  }
}

// ---------- Ball physics ----------
function holdBall() {
  const s = players[G.server];
  ball.pos.set(s.pos.x, Math.max(s.pos.y, T.Y + 0.12) + 0.05 + Math.abs(Math.sin(G.time * 4)) * 0.06, s.pos.z - s.zs * 0.08);
}

function stepBall(dt) {
  if (G.mode === 'serve') return holdBall();
  const n = 4, h = dt / n;
  for (let k = 0; k < n; k++) {
    const prevZ = ball.pos.z;
    ball.vel.y -= GRAV * h;
    ball.vel.multiplyScalar(1 - 0.04 * h);
    ball.pos.addScaledVector(ball.vel, h);
    // Table.
    if (ball.vel.y < 0 && ball.pos.y - T.R <= T.Y && ball.pos.y > T.Y - 0.05 &&
        Math.abs(ball.pos.x) <= T.HW && Math.abs(ball.pos.z) <= T.HL) {
      const sp = -ball.vel.y;
      ball.pos.y = T.Y + T.R;
      ball.vel.y = sp * 0.8;
      ball.vel.x *= 0.98;
      ball.vel.z *= 0.98;
      onBounce(ball.pos.z > 0 ? 0 : 1, sp);
    }
    // Net.
    if (Math.sign(prevZ) !== Math.sign(ball.pos.z) && prevZ !== 0 &&
        ball.pos.y < T.Y + T.NET_H + T.R && ball.pos.y > T.Y && Math.abs(ball.pos.x) < T.HW + 0.1) {
      ball.vel.z *= -0.25;
      ball.vel.x *= 0.5;
      ball.pos.z = Math.sign(prevZ) * T.R * 1.2;
      onNet();
    }
    // Floor.
    if (ball.pos.y < T.R && ball.vel.y < 0) {
      ball.pos.y = T.R;
      ball.vel.y *= -0.55;
      ball.vel.x *= 0.8;
      ball.vel.z *= 0.8;
      if (Math.abs(ball.vel.y) > 0.4) sfx.floor();
      onOut();
    }
    if (Math.abs(ball.pos.z) > PZ + 1.2 || Math.abs(ball.pos.x) > 3) onOut();
  }
  ball.rot.x += ball.vel.z * dt * 8;
  ball.rot.z -= ball.vel.x * dt * 8;
}

// Simulate forward to find where the ball crosses a player's paddle plane after bouncing on their side.
function predict(p) {
  const pl = players[p];
  const pos = ball.pos.clone(), vel = ball.vel.clone();
  let bounced = ball.bounces[p] >= 1;
  const h = 1 / 240;
  for (let i = 0; i < 240 * 3; i++) {
    vel.y -= GRAV * h;
    pos.addScaledVector(vel, h);
    if (vel.y < 0 && pos.y - T.R <= T.Y && Math.abs(pos.x) <= T.HW && Math.abs(pos.z) <= T.HL) {
      pos.y = T.Y + T.R;
      vel.y *= -0.8;
      if ((pos.z > 0 ? 0 : 1) === p) bounced = true;
    }
    if (bounced && (pos.z - pl.pos.z) * pl.zs >= -0.02) return pos;
    if (pos.y < 0.1) return pos;
  }
  return pos;
}

// ---------- Player control ----------
function updateHuman(pl, dt) {
  const ap = settings.assist;
  let tx = clamp(pl.input.x, -1.3, 1.3) * 0.85 * pl.zs;
  let ty = T.Y + 0.04 + (clamp(pl.input.y, -1, 1) * 0.5 + 0.5) * 0.4;
  if (ap && G.mode === 'rally' && ball.lastHitter !== pl.i) {
    const near = clamp(1 - Math.abs(ball.pos.z - pl.pos.z) / 2.4, 0, 1);
    ty = lerp(ty, clamp(ball.pos.y, T.Y + 0.03, T.Y + 0.6), 0.8 * near);
    tx = lerp(tx, ball.pos.x, 0.2 * near);
  }
  // Light smoothing only: the phone already sends clean, fused orientation, and every bit of damping is lag.
  pl.pos.x = damp(pl.pos.x, tx, 45, dt);
  pl.pos.y = damp(pl.pos.y, ty, 30, dt);

  // Swing hit window: a swing stays "armed" briefly so a slightly early swing still connects.
  if (pl.swing && G.time - pl.swing.t < 0.2 && canHit(pl.i)) {
    const dz = (ball.pos.z - pl.pos.z) * pl.zs;
    const dx = ball.pos.x - pl.pos.x, dy = ball.pos.y - pl.pos.y;
    if (dz > -0.6 && dz < 0.2 && Math.abs(dx) < 0.46 && Math.abs(dy) < 0.44) {
      const q = 1 - Math.min(1, Math.hypot(dx / 0.46, dy / 0.44, (dz + 0.15) / 0.55) / 1.3);
      performHit(pl.i, { power: pl.swing.p, dir: pl.swing.d, quality: q });
      pl.swing = null;
    }
  }
  // Assist: a ball that runs straight into the paddle gets blocked back softly.
  if (ap && canHit(pl.i)) {
    const dz = (ball.pos.z - pl.pos.z) * pl.zs;
    if (Math.abs(dz) < 0.05 && Math.abs(ball.pos.x - pl.pos.x) < 0.11 && Math.abs(ball.pos.y - pl.pos.y) < 0.11) {
      performHit(pl.i, { power: 0.2, quality: 0.7, auto: true });
    }
  }
}

function updateAI(pl, dt) {
  const L = AI_LEVELS[G.demo ? 'medium' : settings.level];
  const ai = pl.ai;
  let tx = ball.pos.x * 0.3, ty = T.Y + 0.2;
  if (G.mode === 'serve' && G.server === pl.i) {
    tx = Math.sin(G.time * 1.3) * 0.2;
    ty = T.Y + 0.14;
    if (G.timer > (G.demo ? 0.9 : 1.2)) serve(pl.i, rnd(0.2, 0.7), rnd(-1, 1));
  } else if (G.mode === 'rally' && ball.inPlay && ball.lastHitter !== pl.i) {
    ai.timer += dt;
    if (!ai.plan && ai.timer > L.react) {
      ai.plan = predict(pl.i);
      // Long rallies make the AI sloppier so points always end.
      const tired = 1 + G.rally * 0.07;
      ai.err.set((Math.random() - 0.5) * 2 * L.err * tired, (Math.random() - 0.5) * L.err * tired);
      if (Math.random() < L.miss + G.rally * 0.008) ai.err.x = Math.sign(Math.random() - 0.5) * L.reach * rnd(1.1, 1.8);
    }
    if (ai.plan) { tx = ai.plan.x + ai.err.x; ty = clamp(ai.plan.y + ai.err.y, T.Y + 0.02, T.Y + 0.8); }
  } else {
    ai.plan = null; ai.timer = 0; ai.swung = false;
  }
  const step = L.speed * dt;
  pl.pos.x += clamp(tx - pl.pos.x, -step, step);
  pl.pos.y += clamp(ty - pl.pos.y, -step, step);

  if (canHit(pl.i) && !ai.swung) {
    const dz = (ball.pos.z - pl.pos.z) * pl.zs;
    if (dz > -0.1 && dz < 0.25) {
      const d = Math.hypot(ball.pos.x - pl.pos.x, ball.pos.y - pl.pos.y);
      if (d < L.reach) {
        const opp = players[1 - pl.i];
        const away = opp.pos.x > 0 ? -1 : 1;
        const tX = Math.random() < 0.75 ? away * rnd(0.2, 0.62) : rnd(-0.5, 0.5);
        performHit(pl.i, { power: rnd(...L.power), quality: 1 - (d / L.reach) * 0.5 - Math.random() * L.sloppy, targetX: tX });
      } else {
        ai.swung = true;
        pl.swingAnim = 0;
      }
    }
  }
}

function updatePaddleVisual(pl, dt) {
  pl.swingAnim = Math.min(1, pl.swingAnim + dt * 4.5);
  pl.squash = Math.max(0, pl.squash - dt * 6);
  const s = pl.swingAnim;
  const curve = Math.sin(Math.min(1, s * 1.6) * Math.PI) * (1 - s * 0.3);
  const g = pl.pad.group;
  g.position.copy(pl.pos);
  g.position.z -= pl.zs * curve * 0.12;
  pl.pad.pivot.rotation.x = -pl.zs * curve * 0.9;
  pl.pad.pivot.rotation.z = -pl.zs * clamp(pl.pos.x, -1, 1) * 0.35;
  const sq = 1 + pl.squash * 0.25;
  pl.pad.pivot.scale.set(sq, 1 / sq, 1);
  // Brighten the rim when a hit is possible right now.
  const dz = (ball.pos.z - pl.pos.z) * pl.zs;
  const inZone = canHit(pl.i) && dz > -0.6 && dz < 0.2 ? 1 : 0;
  pl.zoneGlow = damp(pl.zoneGlow, inZone, 18, dt);
  const m = pl.pad.glowMesh;
  const col = pl.color.clone().multiplyScalar(1.6 + pl.zoneGlow * 2 + pl.squash * 2.5);
  for (let i = 0; i < m.count; i++) m.setColorAt(i, col);
  m.instanceColor.needsUpdate = true;
}

// ---------- FX helpers ----------
function heatColor() {
  const k = clamp(G.rally / 14, 0, 1);
  const a = new THREE.Color(0.3, 0.9, 1), b = new THREE.Color(1, 0.6, 0.15), c = new THREE.Color(1, 0.15, 0.4);
  return k < 0.5 ? a.lerp(b, k * 2) : b.lerp(c, (k - 0.5) * 2);
}

function flash(a) {
  const f = $('flash');
  f.style.transition = 'none';
  f.style.opacity = a;
  requestAnimationFrame(() => { f.style.transition = 'opacity 0.35s ease-out'; f.style.opacity = 0; });
}

const _v = new THREE.Vector3();
function popup3D(text, pos, color, cls = '', view = 0) {
  const v = G.split ? views[view] : views[0];
  _v.copy(pos).project(v.camera);
  const vw = G.split ? innerWidth / 2 : innerWidth;
  const x = (G.split ? view * vw : 0) + (_v.x * 0.5 + 0.5) * vw, y = (-_v.y * 0.5 + 0.5) * innerHeight;
  spawnPopup(text, x, y, color, cls);
}
function popupScreen(text, color) {
  spawnPopup(text, innerWidth / 2, innerHeight * 0.38, color, 'huge');
}
function spawnPopup(text, x, y, color, cls) {
  const el = document.createElement('div');
  el.className = `popup ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.color = `#${new THREE.Color(color).getHexString()}`;
  $('popups').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// ---------- Game flow ----------
function startGame() {
  enableAudio();
  G.demo = false;
  G.split = settings.mode === '2p';
  players[0].kind = 'human';
  players[1].kind = G.split ? 'human' : 'ai';
  $('lblL').textContent = names()[0];
  $('lblR').textContent = names()[1];
  layout();
  G.score = [0, 0];
  boards.forEach((b) => b.set(0, 0));
  G.server = 0;
  G.timeScale = 1;
  $('lobby').classList.add('hide');
  $('overPanel').classList.add('hide');
  $('hud').classList.remove('hide');
  sfx.blip();
  nextServe();
}

function toLobby() {
  G.demo = true;
  G.split = false;
  players[0].kind = 'ai';
  players[1].kind = 'ai';
  layout();
  G.score = [0, 0];
  boards.forEach((b) => b.set(0, 0));
  $('lobby').classList.remove('hide');
  $('hud').classList.add('hide');
  $('overPanel').classList.add('hide');
  $('hint').classList.add('hide');
  nextServe();
}

$('btnStart').addEventListener('click', startGame);
$('btnAgain').addEventListener('click', startGame);
$('btnMenu').addEventListener('click', toLobby);
document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => {
  settings.level = b.dataset.level;
  document.querySelectorAll('[data-level]').forEach((x) => x.classList.toggle('on', x === b));
  sfx.blip();
}));
$('assist').addEventListener('change', (e) => { settings.assist = e.target.checked; });
function selectMode(mode) {
  settings.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x.dataset.mode === mode));
  $('aiOpts').classList.toggle('hide', mode === '2p');
  $('p2Card').classList.toggle('soon', mode !== '2p');
}
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { selectMode(b.dataset.mode); sfx.blip(); }));

// ---------- Cameras & split screen ----------
function layout() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  views.forEach((v) => {
    const vw = G.split ? w / 2 : w;
    v.camera.aspect = vw / h;
    v.camera.updateProjectionMatrix();
    v.composer.setPixelRatio(renderer.getPixelRatio());
    v.composer.setSize(vw, h);
  });
  $('divider').classList.toggle('hide', !G.split);
}

function updateCameras(rdt) {
  G.fovPunch = damp(G.fovPunch, 0, 8, rdt);
  views.forEach((v, i) => {
    if (i === 1 && !G.split) return;
    const p = players[i];
    const cam = v.camera;
    if (G.demo) {
      const a = G.time * 0.12;
      v.pos.set(Math.sin(a) * 3.6, 1.9 + Math.sin(G.time * 0.2) * 0.25, Math.cos(a) * 3.6);
      v.look.set(0, T.Y, 0);
    } else {
      // Split screen views are narrow, so pull the camera back and up a little.
      const back = G.split ? 1.45 : 1.2, up = G.split ? 1.78 : 1.62;
      v.pos.set(p.pos.x * 0.3, up, p.zs * (PZ + back));
      v.look.set(p.pos.x * 0.1 + ball.pos.x * 0.08, 0.7, -p.zs * 0.75);
    }
    const k = G.demo ? 1 - Math.exp(-2 * rdt) : 1 - Math.exp(-6 * rdt);
    cam.position.lerp(v.pos, k);
    cam.position.add(shake.offset);
    cam.lookAt(v.look);
    cam.rotateZ(shake.roll);
    cam.fov = (G.split ? 62 : BASE_FOV) - G.fovPunch;
    cam.updateProjectionMatrix();
    // Depth of field follows the ball.
    const target = (ball.inPlay || G.mode === 'serve') ? cam.position.distanceTo(ball.pos) : cam.position.distanceTo(v.look);
    v.focus = damp(v.focus, target, 6, rdt);
    v.bokeh.uniforms.focus.value = v.focus;
    cam.position.sub(shake.offset);
  });
}

function render(rdt) {
  renderer.shadowMap.needsUpdate = true;
  const w = innerWidth, h = innerHeight;
  if (!G.split) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    views[0].composer.render(rdt);
    return;
  }
  renderer.setScissorTest(true);
  views.forEach((v, i) => {
    renderer.setViewport(i * w / 2, 0, w / 2, h);
    renderer.setScissor(i * w / 2, 0, w / 2, h);
    v.composer.render(rdt);
    renderer.shadowMap.needsUpdate = false;
  });
  renderer.setScissorTest(false);
}

// Automatic quality: if the PC can't hold a smooth frame rate, drop depth of field, then resolution.
// A slow frame rate adds input lag of its own.
const perf = { frames: 0, since: performance.now(), level: 0, low: 0 };
function trackPerf() {
  perf.frames++;
  const now = performance.now();
  if (now - perf.since < 1000) return;
  const fps = (perf.frames * 1000) / (now - perf.since);
  perf.frames = 0;
  perf.since = now;
  $('fps').textContent = `${Math.round(fps)} fps`;
  if (G.demo || !debug.render || debug.lockQuality) return;
  perf.low = fps < 50 ? perf.low + 1 : 0;
  if (perf.low >= 2 && perf.level < 2) {
    perf.level++;
    perf.low = 0;
    if (perf.level === 1) views.forEach((v) => { v.bokeh.enabled = false; });
    if (perf.level === 2) { renderer.setPixelRatio(1); layout(); }
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
function frame() {
  const rdt = Math.min(0.05, clock.getDelta());
  G.time += rdt;
  G.timer += rdt;

  let dt = rdt * SPEED * G.timeScale;
  if (G.hitStop > 0) { G.hitStop -= rdt; dt = 0; }
  G.timeScale = damp(G.timeScale, 1, G.mode === 'over' ? 0.6 : 3, rdt);

  if (dt > 0) {
    for (const pl of players) (pl.kind === 'human' ? updateHuman : updateAI)(pl, dt);
    stepBall(dt);
    if (G.mode === 'point' && G.timer > 1.4) nextServe();
  }
  for (const pl of players) updatePaddleVisual(pl, rdt);

  // Ball visuals.
  ballMesh.position.copy(ball.pos);
  ballMesh.rotation.set(ball.rot.x, 0, ball.rot.z);
  ball.flash = Math.max(0, ball.flash - rdt * 5);
  const heat = heatColor();
  ballMesh.material.color.copy(COLORS.ball).lerp(heat.clone().multiplyScalar(4), 0.35).multiplyScalar(1 + ball.flash * 1.5);
  ballMesh.scale.setScalar(1 + ball.flash * 0.6);
  ballLight.position.copy(ball.pos);
  ballLight.color.copy(heat);
  ballLight.intensity = 1.4 + ball.flash * 4;
  trail.color.copy(heat).multiplyScalar(2);
  if (dt > 0) trail.push(ball.pos, ball.vel.length());
  trail.update();
  if (G.mode === 'serve') trail.clear();

  particles.update(dt > 0 ? dt : 0);
  rings.update(rdt);
  shake.update(rdt);
  motes.update(G.time);
  for (const b of boards) b.group.scale.setScalar(damp(b.group.scale.x, 1, 6, rdt));

  G.chroma = damp(G.chroma, 0, 7, rdt);
  for (const v of views) {
    v.lens.uniforms.amount.value = 0.0015 + G.chroma;
    v.lens.uniforms.time.value = G.time % 100;
    v.bloom.strength = 0.42 + clamp(G.rally / 30, 0, 0.18) + ball.flash * 0.15;
  }
  rimA.intensity = 6 + Math.sin(G.time * 2) * 1.5;
  rimB.intensity = 6 + Math.cos(G.time * 2.3) * 1.5;

  updateCameras(rdt);
  updateHud();
  trackPerf();
  if (debug.render) render(rdt);
  requestAnimationFrame(frame);
}

function updateHud() {
  if (G.demo) return;
  $('scoreL').textContent = G.score[0];
  $('scoreR').textContent = G.score[1];
  $('rally').textContent = G.rally > 1 ? `RALLY ${G.rally}` : '';
  if (G.mode !== 'serve') $('hint').classList.add('hide');
}

addEventListener('resize', layout);

// Debug hook for automated tests.
const stats = [];
const debug = { render: true };
window.__vxpp = { G, ball, players, startGame, humanSwing, settings, stats, debug, selectMode, perf };

toLobby();
views.forEach((v) => v.camera.position.set(0, 2, 4));
frame();
