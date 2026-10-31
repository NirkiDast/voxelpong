// Voxel tennis arena: dark wooden indoor court with neon lines, net, stands, light rigs,
// plus the chibi voxel players and their glowing rackets.
import * as THREE from 'three';
import { VoxelBatch, litMat, glowMat } from '../world.js';

// Real doubles court, metres. The net is at z = 0; team 0 (near, the camera side) plays at z > 0.
export const C = {
  HL: 11.885,        // half length (net to baseline)
  HW: 5.485,         // half width, doubles
  SHW: 4.115,        // half width, singles (service boxes)
  SVC: 6.40,         // service line distance from the net
  NET_H: 0.914, POST_H: 1.07,
  R: 0.06,           // ball radius (about twice real size, so it reads on a TV)
};

export const TEAM_COLORS = [0x29e7ff, 0xff3d9a];

let seed = 4242;
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
function jitter(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (rand() - 0.5) * amt)));
  return c;
}

export function buildArena(scene) {
  const lit = new VoxelBatch();
  const glow = new VoxelBatch();

  // Wooden floor: long planks. The court itself is a warmer, lighter stain than the surround.
  const PW = 0.36, PL = 2.4;
  for (let i = -30; i < 30; i++) {
    const x = (i + 0.5) * PW;
    const off = (i % 4) * 0.6;
    for (let z = -26 - off; z < 26; z += PL) {
      const cz = z + PL / 2;
      const inCourt = Math.abs(x) < C.HW + 0.8 && Math.abs(cz) < C.HL + 2.2;
      const base = inCourt ? 0x8a5a33 : 0x3a2618;
      lit.add(x, -0.05, cz, PW * 0.97, 0.1, PL * 0.985, jitter(base, inCourt ? 0.07 : 0.06));
    }
  }

  // Court lines: thin neon strips.
  const LW = 0.06, LY = 0.004, LK = 1.5, LC = 0xe8f6ff;
  const line = (x, z, sx, sz) => glow.add(x, LY, z, sx, 0.008, sz, LC, LK);
  for (const s of [-1, 1]) {
    line(0, s * C.HL, C.HW * 2 + LW, LW);                // baselines
    line(s * C.HW, 0, LW, C.HL * 2);                     // doubles sidelines
    line(s * C.SHW, 0, LW, C.HL * 2);                    // singles sidelines
    line(0, s * C.SVC, C.SHW * 2, LW);                   // service lines
    line(0, s * (C.HL - 0.1), LW, 0.2);                  // centre marks
  }
  line(0, 0, LW, C.SVC * 2);                             // centre service line
  // Coloured glow just outside each half, so you can tell the sides apart at a glance.
  for (const s of [-1, 1]) {
    const col = s > 0 ? TEAM_COLORS[0] : TEAM_COLORS[1];
    glow.add(0, 0.003, s * (C.HL + 1.6), C.HW * 2 + 2, 0.006, 0.08, col, 1.2);
    for (const sx of [-1, 1]) glow.add(sx * (C.HW + 1.0), 0.003, s * (C.HL / 2 + 0.8), 0.08, 0.006, C.HL + 1.6, col, 1.2);
  }

  // Net: posts, a see-through voxel mesh and a glowing top tape.
  for (const sx of [-1, 1]) {
    lit.add(sx * (C.HW + 0.45), C.POST_H / 2, 0, 0.12, C.POST_H, 0.12, 0x20202a);
    glow.add(sx * (C.HW + 0.45), C.POST_H + 0.04, 0, 0.16, 0.06, 0.16, 0xff3d9a, 2);
  }
  const net = new VoxelBatch();
  for (let x = -C.HW - 0.4; x <= C.HW + 0.4; x += 0.12) {
    const h = C.NET_H + (C.POST_H - C.NET_H) * Math.pow(Math.abs(x) / (C.HW + 0.45), 2);
    net.add(x, h / 2, 0, 0.012, h, 0.012, 0x9aa0c8);
  }
  for (let y = 0.1; y < C.NET_H; y += 0.12) net.add(0, y, 0, C.HW * 2 + 0.9, 0.012, 0.012, 0x9aa0c8);
  const netMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
  scene.add(net.build(netMat));
  for (let x = -C.HW - 0.4; x <= C.HW + 0.4; x += 0.3) {
    const h = C.NET_H + (C.POST_H - C.NET_H) * Math.pow(Math.abs(x) / (C.HW + 0.45), 2);
    glow.add(x, h, 0, 0.31, 0.05, 0.03, 0xffffff, 1.4);
  }

  // Stands on both sides: stepped dark tiers with a crowd of glowing light sticks.
  const crowd = new VoxelBatch();
  const cc = [0x29e7ff, 0xff3d9a, 0xffd166, 0x9b5cff];
  for (const sx of [-1, 1]) {
    for (let tier = 0; tier < 7; tier++) {
      const x = sx * (C.HW + 4.2 + tier * 1.1);
      const y = 0.35 + tier * 0.7;
      lit.add(x, y / 2, 0, 1.1, y, 50, jitter(0x15111f, 0.04));
      for (let z = -24; z < 24; z += 0.75) {
        if (rand() < 0.25) continue;
        const zz = z + rand() * 0.3;
        // Silhouette body + head, and a glowing stick or phone light above some of them.
        lit.add(x, y + 0.3, zz, 0.35, 0.5, 0.35, jitter(0x231d33, 0.1));
        lit.add(x, y + 0.7, zz, 0.28, 0.28, 0.28, jitter(0x2b2440, 0.1));
        if (rand() < 0.45) crowd.add(x - sx * 0.1, y + 1.0 + rand() * 0.25, zz, 0.06, 0.22, 0.06, cc[(rand() * 4) | 0], 1.2 + rand());
      }
    }
    // Neon rail along the front of each stand.
    glow.add(sx * (C.HW + 3.6), 0.9, 0, 0.06, 0.06, 48, sx < 0 ? TEAM_COLORS[0] : TEAM_COLORS[1], 2);
  }
  // End walls with big neon frames.
  for (const sz of [-1, 1]) {
    for (let x = -22; x < 22; x += 1) lit.add(x + 0.5, 3, sz * 27, 1, 6, 0.6, jitter(0x120e1e, 0.05));
    glow.add(0, 0.6, sz * 26.65, 30, 0.06, 0.06, sz < 0 ? TEAM_COLORS[1] : TEAM_COLORS[0], 2);
    glow.add(0, 5.2, sz * 26.65, 30, 0.06, 0.06, 0x9b5cff, 1.6);
  }
  // Overhead light rigs.
  for (let z = -12; z <= 12; z += 6) {
    glow.add(0, 9, z, 14, 0.12, 0.3, 0xfff1e0, 1.4);
    lit.add(0, 9.15, z, 14.4, 0.12, 0.5, 0x1a1626);
  }

  scene.add(lit.build(litMat(), { receive: true }));
  scene.add(glow.build(glowMat()));
  const crowdMesh = crowd.build(glowMat());
  scene.add(crowdMesh);
  return { crowdMesh };
}

// ---------- Players ----------
// Chibi voxel athlete: big head, small body, team-coloured outfit with glowing trim, and a racket
// whose frame glows. Built facing -z; the game rotates the whole group to face the net.
export function buildPlayer({ color, skin = 0xf1c27d, hair = 0x2b1b12, hand = 'right' }) {
  const g = new THREE.Group();
  const v = 0.06;
  const part = (fn) => { const b = new VoxelBatch(); fn(b); return b; };
  const mesh = (b, glowing = false) => {
    const m = b.build(glowing ? glowMat() : litMat(), { cast: !glowing });
    return m;
  };
  const shirt = new THREE.Color(color).multiplyScalar(0.55);
  const dark = 0x1b1a2a;

  // Body pivot at the hips.
  const body = new THREE.Group();
  body.position.y = 0.62;
  g.add(body);
  body.add(mesh(part((b) => {
    b.add(0, 0.24, 0, 0.42, 0.36, 0.26, shirt);           // torso
    b.add(0, 0.02, 0, 0.4, 0.14, 0.25, dark);             // shorts
  })));
  body.add(mesh(part((b) => {
    b.add(0, 0.42, -0.135, 0.44, 0.03, 0.01, color, 1.8); // collar trim
    b.add(0, 0.09, -0.13, 0.42, 0.02, 0.01, color, 1.6);  // waistband
  }), true));

  // Head with hair, eyes and a glowing headband.
  const head = new THREE.Group();
  head.position.y = 0.72;
  body.add(head);
  head.add(mesh(part((b) => {
    b.add(0, 0, 0, 0.5, 0.46, 0.46, skin);
    b.add(0, 0.2, 0.03, 0.54, 0.14, 0.5, hair);
    b.add(0, 0.06, 0.22, 0.54, 0.3, 0.1, hair);
    b.add(-0.11, 0.0, -0.235, v, v * 1.4, 0.02, 0x101018);
    b.add(0.11, 0.0, -0.235, v, v * 1.4, 0.02, 0x101018);
    b.add(0, -0.12, -0.235, 0.1, 0.025, 0.02, 0x8a3a3a);
  })));
  head.add(mesh(part((b) => b.add(0, 0.12, 0, 0.53, 0.05, 0.49, color, 2)), true));

  // Legs pivot at the hips.
  const legs = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * 0.11, 0.62, 0);
    p.add(mesh(part((b) => {
      b.add(0, -0.28, 0, 0.13, 0.5, 0.14, skin);
      b.add(0, -0.56, -0.03, 0.16, 0.1, 0.24, 0xf4f4f8);
    })));
    p.add(mesh(part((b) => b.add(0, -0.61, -0.03, 0.17, 0.02, 0.25, color, 2)), true));
    g.add(p);
    return p;
  });

  // Arms pivot at the shoulders. The racket hangs off the playing hand.
  const hs = hand === 'left' ? -1 : 1;
  const arms = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * 0.27, 0.4, 0);
    p.add(mesh(part((b) => {
      b.add(0, -0.06, 0, 0.13, 0.14, 0.14, shirt);
      b.add(0, -0.24, 0, 0.11, 0.26, 0.12, skin);
    })));
    body.add(p);
    return p;
  });
  const racketArm = arms[hs > 0 ? 1 : 0];
  const offArm = arms[hs > 0 ? 0 : 1];
  const racket = buildRacket(color);
  racket.position.set(0, -0.38, 0);
  racketArm.add(racket);

  g.scale.setScalar(1.55);
  return { group: g, body, head, legs, arms, racketArm, offArm, racket, hs };
}

export function buildRacket(color) {
  const r = new THREE.Group();
  const grip = new VoxelBatch();
  for (let k = 0; k < 5; k++) grip.add(0, -k * 0.05, 0, 0.045, 0.05, 0.045, k < 3 ? 0x222233 : 0x34344a);
  r.add(grip.build(litMat(), { cast: true }));
  // Oval frame of glowing voxels plus a faint string bed.
  const frame = new VoxelBatch();
  const strings = new VoxelBatch();
  const cx = 0, cy = -0.47, ax = 0.15, ay = 0.2, s = 0.035;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) frame.add(cx + Math.cos(a) * ax, cy + Math.sin(a) * ay, 0, s, s, s, color, 2.2);
  frame.add(0, -0.25, 0, 0.04, 0.06, 0.04, color, 2.2);
  for (let x = -ax + 0.04; x < ax; x += 0.045) strings.add(x, cy, 0, 0.008, ay * 2 * Math.sqrt(1 - (x / ax) ** 2), 0.008, 0xffffff);
  for (let y = -ay + 0.04; y < ay; y += 0.045) strings.add(0, cy + y, 0, ax * 2 * Math.sqrt(1 - (y / ay) ** 2), 0.008, 0.008, 0xffffff);
  r.add(frame.build(glowMat()));
  const sm = strings.build(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
  r.add(sm);
  // The racket head centre, used for the hit sparkle.
  const head = new THREE.Object3D();
  head.position.set(0, cy, 0);
  r.add(head);
  r.userData.head = head;
  return r;
}

export function buildTennisBall() {
  const s = C.R * 2;
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 1, 0.25).multiplyScalar(2.6) });
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  m.castShadow = true;
  return m;
}
