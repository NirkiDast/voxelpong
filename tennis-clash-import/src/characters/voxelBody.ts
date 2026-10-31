import * as THREE from 'three';
import type { Shape, V } from '../model/sdf';

/**
 * Voxel figures (character restart, after Nir's voxel references): every part's shape
 * is sampled onto ONE world-aligned grid of cubes in the rest pose, and each cube is
 * given to exactly one part (the one it is deepest inside), so no two surfaces ever
 * overlap. A cube's face is drawn only where it meets air or a cube moved by another
 * bone, so the mesh is a clean shell of whole blocks. Each face carries its own corner
 * shading (how boxed-in each corner is), a per-block colour variation, and
 * coordinates across the face that the material uses for soft bevelled edges.
 */

/** Edge of one block (cm): the racket's grid. */
export const VOX = 2;
/** The body's finer grid (phase 63): heads, hair and clothes in 1 cm blocks. */
export const FINE = 1;

export interface VoxPart {
  shape: Shape;
  /** Bone index this part moves with. */
  bone: number;
  /** Part space to world (cm) as a column-major 4×4: the bone's posed placement and the part's size. */
  m: ArrayLike<number>;
  /** The smallest scale in `m` (distances in the part shrink or grow by it). */
  s: number;
  /** Final material for a point in the part (local cm) given the shape's material. */
  paint?: (x: number, y: number, z: number, m: number) => number;
}

export interface VoxOptions {
  /** Colour per material. */
  colors: Record<number, THREE.Color>;
  /** Light-scatter amount per material (skin ~1). */
  sss: (m: number) => number;
  /** How much a block's colour may vary, per material (hair more than cloth). */
  vary: (m: number) => number;
  /** Materials to draw with, worked out once all blocks are known (faces); the grid is left unchanged. */
  touch?: (g: VoxGrid) => Uint8Array;
  /** Cells to leave open (string beds), by world cell and material. */
  hole?: (i: number, j: number, k: number, m: number) => boolean;
  /** Metres per cm. */
  unit: number;
}

/** The filled grid: what is in each cell. */
export class VoxGrid {
  readonly mat: Uint8Array;
  readonly part: Int8Array;
  readonly bone: Int8Array;
  readonly dist: Float32Array;
  constructor(
    readonly i0: number,
    readonly j0: number,
    readonly k0: number,
    readonly nx: number,
    readonly ny: number,
    readonly nz: number,
    /** Edge of one block (cm). */
    readonly size: number = VOX,
  ) {
    const n = nx * ny * nz;
    this.mat = new Uint8Array(n);
    this.part = new Int8Array(n).fill(-1);
    this.bone = new Int8Array(n).fill(-1);
    this.dist = new Float32Array(n).fill(Infinity);
  }
  /** Cell index for world cell (i, j, k), or −1 outside. */
  at(i: number, j: number, k: number): number {
    const a = i - this.i0, b = j - this.j0, c = k - this.k0;
    if (a < 0 || b < 0 || c < 0 || a >= this.nx || b >= this.ny || c >= this.nz) return -1;
    return a + this.nx * (b + this.ny * c);
  }
  filled(i: number, j: number, k: number): boolean {
    const q = this.at(i, j, k);
    return q >= 0 && this.part[q] >= 0;
  }
  /** Centre of world cell index i along an axis (cm). */
  centre(i: number): number {
    return (i + 0.5) * this.size;
  }
}

/** Fill the grid from the parts. */
export function voxelize(parts: VoxPart[], VOX: number): VoxGrid {
  const lo: V = [Infinity, Infinity, Infinity];
  const hi: V = [-Infinity, -Infinity, -Infinity];
  const boxes = parts.map((p) => {
    const b = p.shape.bounds(1);
    const mn: V = [Infinity, Infinity, Infinity];
    const mx: V = [-Infinity, -Infinity, -Infinity];
    const e = p.m;
    for (let q = 0; q < 8; q++) {
      const x = q & 1 ? b.max[0] : b.min[0];
      const y = q & 2 ? b.max[1] : b.min[1];
      const z = q & 4 ? b.max[2] : b.min[2];
      const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], Math.floor(w[a] / VOX));
        mx[a] = Math.max(mx[a], Math.ceil(w[a] / VOX));
      }
    }
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], mn[a]);
      hi[a] = Math.max(hi[a], mx[a]);
    }
    return { mn, mx };
  });
  const g = new VoxGrid(lo[0], lo[1], lo[2], hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1, VOX);
  const B = 4;
  parts.forEach((p, pi) => {
    const { mn, mx } = boxes[pi];
    const s = p.s;
    const inv = new THREE.Matrix4().fromArray(Array.from(p.m)).invert().elements;
    const toLocal = (i: number, j: number, k: number): V => {
      const x = g.centre(i), y = g.centre(j), z = g.centre(k);
      return [
        inv[0] * x + inv[4] * y + inv[8] * z + inv[12],
        inv[1] * x + inv[5] * y + inv[9] * z + inv[13],
        inv[2] * x + inv[6] * y + inv[10] * z + inv[14],
      ];
    };
    for (let bk = mn[2]; bk <= mx[2]; bk += B)
      for (let bj = mn[1]; bj <= mx[1]; bj += B)
        for (let bi = mn[0]; bi <= mx[0]; bi += B) {
          const c = toLocal(bi + B / 2 - 0.5, bj + B / 2 - 0.5, bk + B / 2 - 0.5);
          const ops = p.shape.near(c, (VOX * B * 0.9 + VOX) / s);
          if (!ops.some((o) => o.mode === 'add')) continue;
          // A block well clear of the surface is all air (phase 63: at 1 cm blocks most are).
          // Kept generous, as blended fields aren't exact distances.
          const d0 = p.shape.eval(c[0], c[1], c[2], ops) * s;
          const R = VOX * B * 0.87 * 1.6 + VOX;
          if (d0 > R) continue;
          for (let k = bk; k < Math.min(bk + B, mx[2] + 1); k++)
            for (let j = bj; j < Math.min(bj + B, mx[1] + 1); j++)
              for (let i = bi; i < Math.min(bi + B, mx[0] + 1); i++) {
                const [x, y, z] = toLocal(i, j, k);
                // Slightly generous, so thin bands and brims keep whole blocks.
                const d = p.shape.eval(x, y, z, ops) * s - VOX * 0.18;
                if (d >= 0) continue;
                const q = g.at(i, j, k);
                if (d >= g.dist[q]) continue;
                g.dist[q] = d;
                g.part[q] = pi;
                g.bone[q] = p.bone;
                const m = p.shape.mat;
                g.mat[q] = p.paint ? p.paint(x, y, z, m) : m;
              }
        }
  });
  tidy(g);
  return g;
}

/**
 * Clean up stray colours: a block whose colour none of its neighbours on the same bone
 * share (a lone speck of shirt on skin where a neckline crosses the grid) takes the
 * colour most of them have.
 */
function tidy(g: VoxGrid): void {
  const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let pass = 0; pass < 2; pass++) {
    const out = g.mat.slice();
    for (let c = 0; c < g.nz; c++)
      for (let b = 0; b < g.ny; b++)
        for (let a = 0; a < g.nx; a++) {
          const q = a + g.nx * (b + g.ny * c);
          if (g.part[q] < 0) continue;
          const m = g.mat[q];
          const count = new Map<number, number>();
          let same = 0;
          for (const [x, y, z] of near) {
            const n = g.at(a + g.i0 + x, b + g.j0 + y, c + g.k0 + z);
            if (n < 0 || g.part[n] < 0 || g.bone[n] !== g.bone[q]) continue;
            if (g.mat[n] === m) same++;
            else count.set(g.mat[n], (count.get(g.mat[n]) ?? 0) + 1);
          }
          if (same > 0 || count.size === 0) continue;
          let best = -1, most = 0;
          for (const [k, v] of count) if (v > most) (best = k), (most = v);
          if (most >= 2) out[q] = best;
        }
    g.mat.set(out);
  }
}

const DIRS: Array<{ n: V; u: V; v: V }> = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

/** A small stable hash of a cell, 0..1. */
export function cellHash(i: number, j: number, k: number): number {
  let h = (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The block shell as a skinned geometry (rest pose, metres). */
export function voxelGeometry(g: VoxGrid, o: VoxOptions): THREE.BufferGeometry {
  const VOX = g.size;
  const mats = o.touch ? o.touch(g) : g.mat;
  const hole = o.hole;
  const solid = (i: number, j: number, k: number): boolean => {
    const q = g.at(i, j, k);
    return q >= 0 && g.part[q] >= 0 && !(hole && hole(i, j, k, g.mat[q]));
  };
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const fuv: number[] = [];
  const ao: number[] = [];
  const sss: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const idx: number[] = [];
  const AO = [0.76, 0.86, 0.94, 1];
  const tmp = new THREE.Color();
  for (let c = 0; c < g.nz; c++)
    for (let b = 0; b < g.ny; b++)
      for (let a = 0; a < g.nx; a++) {
        const q = a + g.nx * (b + g.ny * c);
        if (g.part[q] < 0) continue;
        const i = a + g.i0, j = b + g.j0, k = c + g.k0;
        if (hole && hole(i, j, k, g.mat[q])) continue;
        const bone = g.bone[q];
        const m = mats[q];
        const base = o.colors[m];
        const h = cellHash(i, j, k);
        tmp.copy(base).multiplyScalar(1 + (h - 0.5) * 2 * o.vary(m));
        for (const { n, u, v } of DIRS) {
          const ni = i + n[0], nj = j + n[1], nk = k + n[2];
          if (solid(ni, nj, nk) && g.bone[g.at(ni, nj, nk)] === bone) continue;
          // Corners of the face, and how boxed-in each is (cells in front of it).
          const cx = g.centre(i) + (n[0] * VOX) / 2;
          const cy = g.centre(j) + (n[1] * VOX) / 2;
          const cz = g.centre(k) + (n[2] * VOX) / 2;
          const start = pos.length / 3;
          const occ: number[] = [];
          for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = cx + ((su * u[0] + sv * v[0]) * VOX) / 2;
            const y = cy + ((su * u[1] + sv * v[1]) * VOX) / 2;
            const z = cz + ((su * u[2] + sv * v[2]) * VOX) / 2;
            pos.push(x * o.unit, y * o.unit, z * o.unit);
            nor.push(n[0], n[1], n[2]);
            col.push(tmp.r, tmp.g, tmp.b);
            fuv.push((su + 1) / 2, (sv + 1) / 2);
            const s1 = solid(ni + su * u[0], nj + su * u[1], nk + su * u[2]) ? 1 : 0;
            const s2 = solid(ni + sv * v[0], nj + sv * v[1], nk + sv * v[2]) ? 1 : 0;
            const cc = solid(ni + su * u[0] + sv * v[0], nj + su * u[1] + sv * v[1], nk + su * u[2] + sv * v[2]) ? 1 : 0;
            const l = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
            occ.push(l);
            ao.push(AO[l]);
            sss.push(o.sss(m));
            si.push(bone, 0, 0, 0);
            sw.push(1, 0, 0, 0);
          }
          // Split along the diagonal that keeps corner shading even.
          if (occ[0] + occ[2] >= occ[1] + occ[3]) idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          else idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
        }
      }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('fuv', new THREE.Float32BufferAttribute(fuv, 2));
  geo.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  geo.setAttribute('sss', new THREE.Float32BufferAttribute(sss, 1));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
