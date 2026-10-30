// Voxel scene construction: room, table, net, paddles, ball, scoreboard.
import * as THREE from 'three';

export const T = {
  L: 2.74, W: 1.525, Y: 0.76, NET_H: 0.1525, R: 0.03,
};
T.HL = T.L / 2;
T.HW = T.W / 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const BOX = new THREE.BoxGeometry(1, 1, 1);

// Random but repeatable, so the room looks the same every load.
let seed = 1337;
export function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

// Collects boxes and turns them into one InstancedMesh.
export class VoxelBatch {
  constructor() { this.items = []; }
  add(x, y, z, sx, sy, sz, color, k = 1) {
    const c = new THREE.Color(color);
    if (k !== 1) c.multiplyScalar(k);
    this.items.push({ x, y, z, sx, sy, sz, c });
    return this;
  }
  build(material, { cast = false, receive = false } = {}) {
    const mesh = new THREE.InstancedMesh(BOX, material, Math.max(1, this.items.length));
    this.items.forEach((it, i) => {
      _p.set(it.x, it.y, it.z);
      _s.set(it.sx, it.sy, it.sz);
      mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      mesh.setColorAt(i, it.c);
    });
    mesh.count = this.items.length;
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return mesh;
  }
}

export const litMat = () => new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.05 });
export const glowMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff });

function jitter(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (rand() - 0.5) * amt)));
  return c;
}

export const COLORS = {
  p1: 0x29e7ff, // cyan
  p2: 0xff3d9a, // magenta
  ball: new THREE.Color(1, 0.75, 0.45).multiplyScalar(4),
};

export function buildRoom(scene) {
  const lit = new VoxelBatch();
  const glow = new VoxelBatch();

  // Floor: chunky wooden voxels with a darker rug under the table.
  const fs = 0.3;
  for (let i = -20; i < 20; i++) {
    for (let j = -20; j < 20; j++) {
      const x = (i + 0.5) * fs, z = (j + 0.5) * fs;
      const rug = Math.abs(x) < 1.8 && Math.abs(z) < 2.6;
      const base = rug ? ((i + j) & 1 ? 0x2a1f4a : 0x251a40) : 0x3b2a22;
      const h = 0.1 + rand() * 0.015;
      lit.add(x, -h / 2, z, fs, h, fs, jitter(base, rug ? 0.03 : 0.08));
    }
  }
  // Rug border glow.
  for (const sx of [-1, 1]) glow.add(sx * 1.8, 0.012, 0, 0.03, 0.01, 5.2, COLORS.p1, 1.1);
  for (const sz of [-1, 1]) glow.add(0, 0.012, sz * 2.6, 3.64, 0.01, 0.03, COLORS.p1, 1.1);

  // Walls on three sides with neon strips.
  const ws = 0.5;
  const wall = (fn) => {
    for (let a = -12; a < 12; a++) {
      for (let b = 0; b < 9; b++) fn(a, b);
    }
  };
  wall((a, b) => lit.add((a + 0.5) * ws, (b + 0.5) * ws, -6, ws, ws, ws * (0.8 + rand() * 0.6), jitter(0x1b1638, 0.05)));
  wall((a, b) => lit.add(-6, (b + 0.5) * ws, (a + 0.5) * ws, ws * (0.8 + rand() * 0.6), ws, ws, jitter(0x1b1638, 0.05)));
  wall((a, b) => lit.add(6, (b + 0.5) * ws, (a + 0.5) * ws, ws * (0.8 + rand() * 0.6), ws, ws, jitter(0x1b1638, 0.05)));
  // Front wall: only seen by player 2 in split screen.
  wall((a, b) => lit.add((a + 0.5) * ws, (b + 0.5) * ws, 6, ws, ws, ws * (0.8 + rand() * 0.6), jitter(0x1b1638, 0.05)));
  for (const y of [0.35, 3.1]) {
    const col = y < 1 ? COLORS.p1 : COLORS.p2;
    glow.add(0, y, -5.62, 12, 0.05, 0.05, col, 1.8);
    glow.add(0, y, 5.62, 12, 0.05, 0.05, col, 1.8);
    glow.add(-5.62, y, 0, 0.05, 0.05, 12, col, 1.8);
    glow.add(5.62, y, 0, 0.05, 0.05, 12, col, 1.8);
  }

  // Pillars with glowing caps.
  for (const [x, z] of [[-4.2, -4.6], [4.2, -4.6], [-4.8, 0.5], [4.8, 0.5], [-4.2, 4.6], [4.2, 4.6]]) {
    for (let k = 0; k < 10; k++) lit.add(x, 0.15 + k * 0.3, z, 0.42, 0.3, 0.42, jitter(0x2a2350, 0.06));
    glow.add(x, 3.05, z, 0.5, 0.08, 0.5, k2col(x), 2);
  }

  // Voxel speakers and a couch-ish block in the back for scale.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 5; k++) lit.add(sx * 3.4, 0.2 + k * 0.4, sz * 5.3, 0.6, 0.4, 0.5, jitter(0x15121f, 0.04));
      glow.add(sx * 3.4, 1.4, sz * 5.04, 0.36, 0.36, 0.02, 0xffb347, 1.6);
      glow.add(sx * 3.4, 0.6, sz * 5.04, 0.24, 0.24, 0.02, 0xffb347, 1.3);
    }
  }

  // Potted voxel plants.
  for (const [x, z] of [[-3.6, -2.2], [3.7, -3.0], [3.5, 3.6], [-3.8, 4.2]]) {
    lit.add(x, 0.2, z, 0.4, 0.4, 0.4, 0x6b3b2a);
    for (let k = 0; k < 26; k++) {
      const a = rand() * Math.PI * 2, r = rand() * 0.35, h = 0.5 + rand() * 0.8;
      lit.add(x + Math.cos(a) * r, h, z + Math.sin(a) * r, 0.16, 0.16, 0.16, jitter(0x2e8b57, 0.2));
    }
  }

  scene.add(lit.build(litMat(), { receive: true, cast: false }));
  scene.add(glow.build(glowMat()));
}

function k2col(x) { return x < 0 ? COLORS.p1 : COLORS.p2; }

export function buildTable(scene) {
  const lit = new VoxelBatch();
  const glow = new VoxelBatch();
  const nz = 40, nx = 22;
  const vz = T.L / nz, vx = T.W / nx, th = 0.05;
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nx; j++) {
      const z = -T.HL + (i + 0.5) * vz, x = -T.HW + (j + 0.5) * vx;
      lit.add(x, T.Y - th / 2, z, vx * 0.985, th, vz * 0.985, jitter(0x1d47b8, 0.06));
    }
  }
  // White lines (slight glow so they catch bloom).
  const ly = T.Y + 0.002, lh = 0.004, lw = 0.02;
  glow.add(-T.HW + lw / 2, ly, 0, lw, lh, T.L, 0xffffff, 1.0);
  glow.add(T.HW - lw / 2, ly, 0, lw, lh, T.L, 0xffffff, 1.0);
  glow.add(0, ly, -T.HL + lw / 2, T.W, lh, lw, 0xffffff, 1.0);
  glow.add(0, ly, T.HL - lw / 2, T.W, lh, lw, 0xffffff, 1.0);
  glow.add(0, ly, 0, 0.006, lh, T.L, 0xffffff, 0.9);
  // Apron + legs.
  for (const sx of [-1, 1]) lit.add(sx * (T.HW - 0.04), T.Y - 0.09, 0, 0.04, 0.08, T.L - 0.1, 0x111522);
  for (const sz of [-1, 1]) lit.add(0, T.Y - 0.09, sz * (T.HL - 0.04), T.W - 0.1, 0.08, 0.04, 0x111522);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        lit.add(sx * (T.HW - 0.15), 0.04 + k * 0.08, sz * (T.HL - 0.25), 0.07, 0.08, 0.07, jitter(0x2b2f3d, 0.05));
      }
    }
    lit.add(sx * (T.HW - 0.15), 0.3, 0, 0.05, 0.05, T.L - 0.5, 0x2b2f3d);
  }
  // Net: checker of tiny voxels, posts and a glowing tape.
  const ns = 0.025;
  for (let x = -T.HW - 0.06; x <= T.HW + 0.06; x += ns) {
    for (let y = 0; y < 6; y++) {
      if (((Math.round(x / ns) + y) & 1) === 0) {
        lit.add(x, T.Y + ns * (y + 0.5), 0, ns * 0.9, ns * 0.9, 0.006, 0x232634);
      }
    }
  }
  glow.add(0, T.Y + T.NET_H - 0.006, 0, T.W + 0.15, 0.012, 0.01, 0xffffff, 1.4);
  for (const sx of [-1, 1]) {
    lit.add(sx * (T.HW + 0.09), T.Y + T.NET_H / 2, 0, 0.03, T.NET_H + 0.02, 0.03, 0x50566b);
  }

  scene.add(lit.build(litMat(), { cast: true, receive: true }));
  scene.add(glow.build(glowMat()));
}

// Paddle: group -> pivot (animated) -> voxel meshes. Blade faces +z/-z.
export function buildPaddle(rimColor, facing) {
  const lit = new VoxelBatch();
  const glow = new VoxelBatch();
  const v = 0.017, rad = 0.082;
  for (let i = -5; i <= 5; i++) {
    for (let j = -5; j <= 5; j++) {
      const x = i * v, y = j * v;
      const d = Math.hypot(x, y);
      if (d > rad + 0.002) continue;
      const edge = d > rad - v * 1.1;
      if (edge) glow.add(x, y, 0, v, v, 0.016, rimColor, 1.6);
      else {
        lit.add(x, y, -facing * 0.004, v * 0.96, v * 0.96, 0.008, jitter(0xd8233a, 0.05));
        lit.add(x, y, facing * 0.004, v * 0.96, v * 0.96, 0.008, 0x161616);
      }
    }
  }
  for (let k = 0; k < 6; k++) lit.add(0, -rad - 0.01 - k * 0.018, 0, 0.026, 0.018, 0.022, jitter(0xb9874f, 0.06));
  const pivot = new THREE.Group();
  const litMesh = lit.build(litMat(), { cast: true });
  const glowMesh = glow.build(glowMat(), { cast: false });
  pivot.add(litMesh, glowMesh);
  // Grip point sits below the blade, so rotate around the handle.
  const holder = new THREE.Group();
  holder.add(pivot);
  pivot.position.y = 0;
  return { group: holder, pivot, glowMesh, litMesh };
}

export function buildBall() {
  const s = T.R * 2;
  const mat = new THREE.MeshBasicMaterial({ color: COLORS.ball.clone() });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  mesh.castShadow = true;
  return mesh;
}

// 3x5 pixel font for the voxel scoreboard.
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
  8: '111101111101111', 9: '111101111001111',
};

export class Scoreboard {
  // flip: a board on the front wall, facing player 2, with player 2's score on the left.
  constructor(scene, flip = false) {
    this.flip = flip;
    this.group = new THREE.Group();
    this.group.position.set(0, 1.95, flip ? 5.55 : -5.55);
    if (flip) this.group.rotation.y = Math.PI;
    this.px = 0.12;
    this.slots = []; // 4 digits
    const count = 4 * 15 + 6;
    this.mesh = new THREE.InstancedMesh(BOX, glowMat(), count);
    const xs = [-1.7, -1.1, 0.75, 1.35];
    let n = 0;
    xs.forEach((ox) => {
      const ids = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          _p.set(ox + c * this.px, (2 - r) * this.px, 0);
          _s.set(this.px * 0.9, this.px * 0.9, 0.08);
          this.mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
          ids.push(n++);
        }
      }
      this.slots.push(ids);
    });
    // Dash in the middle.
    for (let k = 0; k < 3; k++) {
      _p.set(-0.12 + k * this.px, 0, 0);
      _s.set(this.px * 0.9, this.px * 0.9, 0.08);
      this.mesh.setMatrixAt(n, _m.compose(_p, _q, _s));
      this.mesh.setColorAt(n, new THREE.Color(0xffffff).multiplyScalar(1.5));
      n++;
    }
    this.mesh.count = n;
    // Dark backing panel.
    const back = new VoxelBatch();
    for (let i = -14; i <= 14; i++) {
      for (let j = -4; j <= 4; j++) back.add(i * 0.14, j * 0.14, -0.08, 0.14, 0.14, 0.06, jitter(0x0c0a18, 0.04));
    }
    this.group.add(back.build(litMat()), this.mesh);
    scene.add(this.group);
    this.pop = [0, 0];
    this.set(0, 0);
  }

  set(a, b) {
    const sides = this.flip ? [1, 0] : [0, 1];
    if (this.flip) [a, b] = [b, a];
    const digits = [Math.floor(a / 10) % 10, a % 10, Math.floor(b / 10) % 10, b % 10];
    const on = [new THREE.Color(0x29e7ff).multiplyScalar(3.2), new THREE.Color(0xff3d9a).multiplyScalar(3.2)];
    const off = new THREE.Color(0x15122a);
    digits.forEach((d, i) => {
      const bits = FONT[d];
      const lead = (i === 0 && a < 10) || (i === 2 && b < 10);
      this.slots[i].forEach((id, k) => {
        const lit = bits[k] === '1' && !lead;
        this.mesh.setColorAt(id, lit ? on[sides[i < 2 ? 0 : 1]] : off);
      });
    });
    this.mesh.instanceColor.needsUpdate = true;
  }
}
