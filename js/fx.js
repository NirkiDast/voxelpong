// Juice: voxel particle bursts, shock rings, bounce decals, ball trail, camera shake.
import * as THREE from 'three';
import { T } from './world.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const BOX = new THREE.BoxGeometry(1, 1, 1);

export class Particles {
  constructor(scene, max = 700) {
    this.max = max;
    this.mesh = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = [];
    for (let i = 0; i < max; i++) {
      this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1, size: 0, grav: 1 });
      this.mesh.setColorAt(i, new THREE.Color(0));
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    }
    this.next = 0;
    scene.add(this.mesh);
  }

  burst(pos, color, { count = 20, speed = 2, size = 0.025, life = 0.6, up = 0.5, grav = 1, dir = null, spread = 1 } = {}) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const q = this.p[i];
      q.pos.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5 + up, Math.random() - 0.5).normalize();
      if (dir) v.multiplyScalar(spread).add(dir).normalize();
      q.vel.copy(v).multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      q.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      q.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(20);
      q.max = q.life = life * (0.6 + Math.random() * 0.8);
      q.size = size * (0.5 + Math.random());
      q.grav = grav;
      const c = color.clone();
      if (Math.random() < 0.3) c.lerp(new THREE.Color(5, 5, 5), 0.5);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      q.vel.y -= 6 * q.grav * dt;
      q.vel.multiplyScalar(1 - 1.2 * dt);
      q.pos.addScaledVector(q.vel, dt);
      // Land on the table or floor.
      const onTable = Math.abs(q.pos.x) < T.HW && Math.abs(q.pos.z) < T.HL;
      const ground = onTable && q.pos.y > T.Y - 0.05 ? T.Y : 0;
      if (q.pos.y < ground + q.size / 2 && q.vel.y < 0) {
        q.pos.y = ground + q.size / 2;
        q.vel.y *= -0.35;
        q.vel.x *= 0.6;
        q.vel.z *= 0.6;
        q.spin.multiplyScalar(0.5);
      }
      q.rot.addScaledVector(q.spin, dt);
      const k = Math.max(0, q.life / q.max);
      const s = q.size * Math.min(1, k * 2.5);
      _q.setFromEuler(_e.set(q.rot.x, q.rot.y, q.rot.z));
      this.mesh.setMatrixAt(i, _m.compose(q.pos, _q, _s.set(s, s, s)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// Expanding square rings (a 4-segment ring looks voxel-y) and table decals.
export class Rings {
  constructor(scene, n = 12) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.85, 1, 4, 1);
    geo.rotateZ(Math.PI / 4);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, t: 0, dur: 1, from: 0.05, to: 0.4, base: new THREE.Color() });
    }
    this.next = 0;
  }

  spawn(pos, color, { flat = false, from = 0.05, to = 0.45, dur = 0.35, normalZ = 1 } = {}) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.mesh.position.copy(pos);
    it.mesh.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    if (!flat && normalZ < 0) it.mesh.rotation.y = Math.PI;
    it.base.copy(color);
    Object.assign(it, { t: 0, dur, from, to });
    it.mesh.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.t += dt;
      const k = it.t / it.dur;
      if (k >= 1) { it.mesh.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      const s = it.from + (it.to - it.from) * e;
      it.mesh.scale.setScalar(s);
      it.mesh.material.color.copy(it.base).multiplyScalar(1 - k);
      it.mesh.material.opacity = 1 - k;
    }
  }
}

// Voxel afterimage trail behind the ball.
export class Trail {
  constructor(scene, n = 26) {
    this.n = n;
    this.hist = [];
    this.mesh = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), n);
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, new THREE.Color(0));
    scene.add(this.mesh);
  }

  push(pos, speed) {
    this.hist.unshift({ p: pos.clone(), s: speed });
    if (this.hist.length > this.n) this.hist.pop();
  }

  clear() { this.hist.length = 0; }

  update() {
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      const h = this.hist[i];
      if (!h || i === 0) {
        this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
        continue;
      }
      const k = 1 - i / this.n;
      const s = T.R * 2 * (0.25 + 0.75 * k) * Math.min(1, h.s / 3);
      this.mesh.setMatrixAt(i, _m.compose(h.p, _q.identity(), _s.set(s, s, s)));
      c.copy(this.color).multiplyScalar(k * k * 1.6);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// Trauma-based camera shake.
export class Shake {
  constructor() { this.trauma = 0; this.t = 0; this.offset = new THREE.Vector3(); this.roll = 0; }
  add(a) { this.trauma = Math.min(1, this.trauma + a); }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const n = (f, o) => Math.sin(this.t * f + o) * Math.sin(this.t * f * 0.7 + o * 2.1);
    this.offset.set(n(53, 1) * 0.06 * s, n(61, 2) * 0.05 * s, n(47, 3) * 0.03 * s);
    this.roll = n(39, 4) * 0.04 * s;
  }
}

// Floating glowing motes drifting around the room.
export class Motes {
  constructor(scene, n = 90) {
    this.mesh = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    this.items = [];
    const cols = [new THREE.Color(0x29e7ff), new THREE.Color(0xff3d9a), new THREE.Color(0xffb347)];
    for (let i = 0; i < n; i++) {
      const it = {
        base: new THREE.Vector3((Math.random() - 0.5) * 10, 0.4 + Math.random() * 3, -5 + Math.random() * 7),
        ph: Math.random() * 10,
        s: 0.015 + Math.random() * 0.03,
      };
      this.items.push(it);
      this.mesh.setColorAt(i, cols[i % 3].clone().multiplyScalar(1.5 + Math.random() * 2));
    }
    scene.add(this.mesh);
  }
  update(t) {
    this.items.forEach((it, i) => {
      _p.set(it.base.x + Math.sin(t * 0.3 + it.ph) * 0.3, it.base.y + Math.sin(t * 0.5 + it.ph * 2) * 0.2, it.base.z + Math.cos(t * 0.25 + it.ph) * 0.3);
      _q.setFromEuler(_e.set(t + it.ph, t * 0.7, 0));
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s.set(it.s, it.s, it.s)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
