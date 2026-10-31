/**
 * Smooth sculpting with signed distance fields (character remake): a model is a list of
 * soft shapes (spheres, ellipsoids, tapered capsules, rounded boxes, rings) blended
 * together with smooth unions, carved with smooth subtractions, and tagged with a
 * material each. `meshSdf` (src/model/mesher.ts) turns the field into a smooth mesh.
 *
 * Units are centimetres; every primitive carries a bounding sphere so a point far from
 * it can skip the exact distance.
 */
export type V = [number, number, number];

export interface Prim {
  /** Signed distance at a point (negative inside). */
  d: (x: number, y: number, z: number) => number;
  /** Bounding sphere: the shape lies within `r` of `c`. */
  c: V;
  r: number;
  /** The same shape with only its pieces that reach within `r` of `c` (null if none do). */
  restrict?: (c: V, r: number) => Prim | null;
}

type Mode = 'add' | 'sub' | 'int';
export interface Op {
  prim: Prim;
  mode: Mode;
  k: number;
  mat: number;
}

/** max(a, b) with the edge where they meet rounded off by radius r (both shapes shrunk to keep size). */
export function roundMax(a: number, b: number, r: number): number {
  const ua = Math.max(a + r, 0);
  const ub = Math.max(b + r, 0);
  return Math.hypot(ua, ub) + Math.min(Math.max(a + r, b + r), 0) - r;
}

/** Polynomial smooth minimum (k = blend radius). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export class Shape {
  private readonly ops: Op[] = [];
  /** Material of the shape nearest the last evaluated point. */
  mat = 0;

  /** Blend a shape in (k = blend radius in cm), painted with material `mat`. */
  add(prim: Prim, mat: number, k = 0): this {
    this.ops.push({ prim, mode: 'add', k, mat });
    return this;
  }

  /** Carve a shape out. */
  sub(prim: Prim, k = 0): this {
    this.ops.push({ prim, mode: 'sub', k, mat: -1 });
    return this;
  }

  /** Keep only what is also inside `prim`. */
  int(prim: Prim, k = 0): this {
    this.ops.push({ prim, mode: 'int', k, mat: -1 });
    return this;
  }

  /** Bounds of everything added, padded. */
  bounds(pad = 1): { min: V; max: V } {
    const min: V = [Infinity, Infinity, Infinity];
    const max: V = [-Infinity, -Infinity, -Infinity];
    for (const o of this.ops) {
      if (o.mode !== 'add') continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], o.prim.c[i] - o.prim.r - pad);
        max[i] = Math.max(max[i], o.prim.c[i] + o.prim.r + pad);
      }
    }
    return { min, max };
  }

  /** The shapes added so far, in order. */
  get list(): readonly Op[] {
    return this.ops;
  }

  /** Add a shape with its blend radius and material exactly as given (for assembling shapes). */
  push(op: Op): this {
    this.ops.push(op);
    return this;
  }

  get empty(): boolean {
    return !this.ops.some((o) => o.mode === 'add');
  }

  /** Indices of the shapes that can matter within `r` of a point (the others are left out). */
  near(c: V, r: number): Op[] {
    const out: Op[] = [];
    for (const o of this.ops) {
      if (o.mode === 'int') {
        out.push(o);
        continue;
      }
      const d = Math.hypot(c[0] - o.prim.c[0], c[1] - o.prim.c[1], c[2] - o.prim.c[2]) - o.prim.r;
      if (d >= r + o.k) continue;
      if (o.prim.restrict) {
        const p = o.prim.restrict(c, r + o.k);
        if (p) out.push({ ...o, prim: p });
      } else out.push(o);
    }
    return out;
  }

  eval(x: number, y: number, z: number, ops: Op[] = this.ops): number {
    let d = 1e9;
    let mat = 0;
    for (const o of ops) {
      const p = o.prim;
      const dx = x - p.c[0];
      const dy = y - p.c[1];
      const dz = z - p.c[2];
      const bound = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r;
      if (o.mode === 'add') {
        if (bound - d >= o.k && bound > d) continue;
        const di = p.d(x, y, z);
        if (di < d) mat = o.mat;
        d = smin(d, di, o.k);
      } else if (o.mode === 'sub') {
        if (bound >= -d + o.k) continue;
        d = -smin(-d, p.d(x, y, z), o.k);
      } else {
        d = -smin(-d, -p.d(x, y, z), o.k);
      }
    }
    this.mat = mat;
    return d;
  }
}

const len3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

export function sphere(c: V, r: number): Prim {
  return { c, r, d: (x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r };
}

/** Ellipsoid (a good approximation of the true distance near the surface). */
/** A rounded box: |x|^p + |y|^p + |z|^p = 1 on the radii (p = 2 is an ellipsoid; higher is boxier). Approximate distance. */
export function superEllipsoid(c: V, r: V, p: number): Prim {
  const m = Math.min(...r);
  return {
    c,
    r: Math.max(...r) * 1.2,
    d: (x, y, z) => {
      const px = Math.abs(x - c[0]) / r[0];
      const py = Math.abs(y - c[1]) / r[1];
      const pz = Math.abs(z - c[2]) / r[2];
      const k = Math.pow(px ** p + py ** p + pz ** p, 1 / p);
      return (k - 1) * m;
    },
  };
}

export function ellipsoid(c: V, r: V): Prim {
  return {
    c,
    r: Math.max(...r),
    d: (x, y, z) => {
      const px = (x - c[0]) / r[0];
      const py = (y - c[1]) / r[1];
      const pz = (z - c[2]) / r[2];
      const k0 = len3(px, py, pz);
      const k1 = len3(px / r[0], py / r[1], pz / r[2]);
      return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
    },
  };
}

/** A capsule from `a` (radius ra) to `b` (radius rb), tapering between them. */
export function capsule(a: V, b: V, ra: number, rb = ra): Prim {
  const ba: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  const l = Math.sqrt(l2);
  const c: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  // Exact round cone (Inigo Quilez).
  const rr = ra - rb;
  const a2 = l2 - rr * rr;
  const il2 = 1 / (l2 || 1);
  return {
    c,
    r: l / 2 + Math.max(ra, rb),
    d: (x, y, z) => {
      const pax = x - a[0];
      const pay = y - a[1];
      const paz = z - a[2];
      const yv = pax * ba[0] + pay * ba[1] + paz * ba[2];
      const zv = yv - l2;
      const qx = pax * l2 - ba[0] * yv;
      const qy = pay * l2 - ba[1] * yv;
      const qz = paz * l2 - ba[2] * yv;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yv * yv * l2;
      const z2 = zv * zv * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
      if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
      return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra;
    },
  };
}

/** A chain of capsules through `pts` with radii `rs` (blend them with the shape's k). */
export function chain(pts: V[], rs: number[]): Prim[] {
  const out: Prim[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push(capsule(pts[i], pts[i + 1], rs[i], rs[i + 1]));
  return out;
}

/** Box with rounded edges: centre, half size, edge radius; optional rotation (Euler XYZ). */
export function roundBox(c: V, h: V, r: number, rot?: V): Prim {
  const m = rot ? invRot(rot) : null;
  return {
    c,
    r: len3(h[0], h[1], h[2]),
    d: (x, y, z) => {
      let px = x - c[0];
      let py = y - c[1];
      let pz = z - c[2];
      if (m) [px, py, pz] = mul(m, px, py, pz);
      const qx = Math.abs(px) - h[0] + r;
      const qy = Math.abs(py) - h[1] + r;
      const qz = Math.abs(pz) - h[2] + r;
      return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
    },
  };
}

/** A ring: centre, major radius, tube radius; lying in the xz plane, optionally rotated. */
export function torus(c: V, R: number, r: number, rot?: V, scaleZ = 1): Prim {
  const m = rot ? invRot(rot) : null;
  return {
    c,
    r: R * Math.max(1, scaleZ) + r,
    d: (x, y, z) => {
      let px = x - c[0];
      let py = y - c[1];
      let pz = z - c[2];
      if (m) [px, py, pz] = mul(m, px, py, pz);
      const q = Math.hypot(px, pz / scaleZ) - R;
      return Math.hypot(q, py) - r;
    },
  };
}

/** Any shape from a function, with a bounding sphere. */
export function custom(c: V, r: number, d: (x: number, y: number, z: number) => number): Prim {
  return { c, r, d };
}

/** The same shape mirrored across x = 0. */
export function mirrorX(p: Prim): Prim {
  return { c: [-p.c[0], p.c[1], p.c[2]], r: p.r, d: (x, y, z) => p.d(-x, y, z) };
}

/** A shape with its surface pushed out by `f` (negative pulls in): strands, pleats. */
export function displace(p: Prim, amount: number, f: (x: number, y: number, z: number) => number): Prim {
  return { c: p.c, r: p.r + Math.abs(amount), d: (x, y, z) => p.d(x, y, z) - amount * f(x, y, z) };
}

type M3 = number[];
function invRot(r: V): M3 {
  // Rotation matrix for Euler XYZ, transposed (its inverse).
  const [a, b, c] = r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  // R = Rx * Ry * Rz (three.js XYZ order)
  const m = [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function mul(m: M3, x: number, y: number, z: number): V {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}

/**
 * A flat strip along `pts` (hair locks): `ws` half widths and `ts` half thicknesses at
 * each point, lying flat against the surface whose outward direction is `out(p)`.
 */
export function ribbon(pts: V[], ws: number[], ts: number[], out: (p: V) => V): Prim {
  const segs: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = len3(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
    const T: V = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
    const o = out([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const dt = o[0] * T[0] + o[1] * T[1] + o[2] * T[2];
    let N: V = [o[0] - T[0] * dt, o[1] - T[1] * dt, o[2] - T[2] * dt];
    const nl = len3(N[0], N[1], N[2]) || 1;
    N = [N[0] / nl, N[1] / nl, N[2] / nl];
    const B: V = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const r = Math.max(ws[i], ws[i + 1], ts[i], ts[i + 1]);
    const m: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    segs.push({ a, T, N, B, L, w0: ws[i], w1: ws[i + 1], t0: ts[i], t1: ts[i + 1], m, r: L / 2 + r });
  }
  return ribbonOf(segs);
}

interface Seg {
  a: V;
  T: V;
  N: V;
  B: V;
  L: number;
  w0: number;
  w1: number;
  t0: number;
  t1: number;
  /** Bounding sphere. */
  m: V;
  r: number;
}

function ribbonOf(segs: Seg[]): Prim {
  const min: V = [Infinity, Infinity, Infinity];
  const max: V = [-Infinity, -Infinity, -Infinity];
  for (const s of segs)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], s.m[k] - s.r);
      max[k] = Math.max(max[k], s.m[k] + s.r);
    }
  const c: V = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const self: Prim = {
    c,
    r: len3(max[0] - c[0], max[1] - c[1], max[2] - c[2]),
    d: (x, y, z) => {
      let best = 1e9;
      for (const s of segs) {
        const bx = x - s.m[0], by = y - s.m[1], bz = z - s.m[2];
        if (Math.sqrt(bx * bx + by * by + bz * bz) - s.r > best) continue;
        const px = x - s.a[0];
        const py = y - s.a[1];
        const pz = z - s.a[2];
        const u = px * s.T[0] + py * s.T[1] + pz * s.T[2];
        const uc = Math.min(s.L, Math.max(0, u));
        const f = uc / s.L;
        const w = s.w0 + (s.w1 - s.w0) * f;
        const t = s.t0 + (s.t1 - s.t0) * f;
        const qx = px - s.T[0] * uc;
        const qy = py - s.T[1] * uc;
        const qz = pz - s.T[2] * uc;
        const n = qx * s.N[0] + qy * s.N[1] + qz * s.N[2];
        const b = qx * s.B[0] + qy * s.B[1] + qz * s.B[2];
        const du = u - uc;
        const k0 = len3(b / w, n / t, du / t);
        const k1 = len3(b / (w * w), n / (t * t), du / (t * t));
        const d = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -t;
        if (d < best) best = d;
      }
      return best;
    },
    restrict: (q, r) => {
      const keep = segs.filter((s) => len3(q[0] - s.m[0], q[1] - s.m[1], q[2] - s.m[2]) - s.r < r);
      if (!keep.length) return null;
      return keep.length === segs.length ? self : ribbonOf(keep);
    },
  };
  return self;
}

/** Several shapes as one, joined without blending (keeps thin tips thin). */
export function union(prims: Prim[]): Prim {
  const min: V = [Infinity, Infinity, Infinity];
  const max: V = [-Infinity, -Infinity, -Infinity];
  for (const p of prims)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.c[k] - p.r);
      max[k] = Math.max(max[k], p.c[k] + p.r);
    }
  const c: V = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const self: Prim = {
    c,
    r: len3(max[0] - c[0], max[1] - c[1], max[2] - c[2]),
    d: (x, y, z) => {
      let d = 1e9;
      for (const p of prims) {
        const bx = x - p.c[0], by = y - p.c[1], bz = z - p.c[2];
        if (Math.sqrt(bx * bx + by * by + bz * bz) - p.r > d) continue;
        const v = p.d(x, y, z);
        if (v < d) d = v;
      }
      return d;
    },
    restrict: (q, r) => {
      const keep = prims.filter((p) => len3(q[0] - p.c[0], q[1] - p.c[1], q[2] - p.c[2]) - p.r < r);
      if (!keep.length) return null;
      return keep.length === prims.length ? self : keep.length === 1 ? keep[0] : union(keep);
    },
  };
  return self;
}

/**
 * A shape posed by an affine transform: modelled around the origin, scaled by `s` per
 * axis, then rotated and moved by `m` (a rigid 4×4 matrix, column-major as three.js
 * stores it).
 */
export function posed(p: Prim, m: ArrayLike<number>, s: V): Prim {
  const k = Math.min(s[0], s[1], s[2]);
  const big = Math.max(s[0], s[1], s[2]);
  // Rotation columns and translation.
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r01 = m[4], r11 = m[5], r21 = m[6];
  const r02 = m[8], r12 = m[9], r22 = m[10];
  const tx = m[12], ty = m[13], tz = m[14];
  const ix = 1 / s[0];
  const iy = 1 / s[1];
  const iz = 1 / s[2];
  /** World point to the shape's own frame (the transpose undoes the rotation). */
  const local = (x: number, y: number, z: number): V => {
    const dx = x - tx, dy = y - ty, dz = z - tz;
    return [(r00 * dx + r10 * dy + r20 * dz) * ix, (r01 * dx + r11 * dy + r21 * dz) * iy, (r02 * dx + r12 * dy + r22 * dz) * iz];
  };
  const cx = p.c[0] * s[0], cy = p.c[1] * s[1], cz = p.c[2] * s[2];
  const self: Prim = {
    c: [r00 * cx + r01 * cy + r02 * cz + tx, r10 * cx + r11 * cy + r12 * cz + ty, r20 * cx + r21 * cy + r22 * cz + tz],
    r: p.r * big,
    d: (x, y, z) => {
      const dx = x - tx, dy = y - ty, dz = z - tz;
      return p.d((r00 * dx + r10 * dy + r20 * dz) * ix, (r01 * dx + r11 * dy + r21 * dz) * iy, (r02 * dx + r12 * dy + r22 * dz) * iz) * k;
    },
  };
  if (p.restrict)
    self.restrict = (c, r) => {
      const q = p.restrict!(local(c[0], c[1], c[2]), r / k);
      return q === p ? self : q ? posed(q, m, s) : null;
    };
  return self;
}
