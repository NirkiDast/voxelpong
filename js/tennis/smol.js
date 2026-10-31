var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// characters/rig.ts
import * as THREE5 from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// model/sdf.ts
function roundMax(a, b, r) {
  const ua = Math.max(a + r, 0);
  const ub = Math.max(b + r, 0);
  return Math.hypot(ua, ub) + Math.min(Math.max(a + r, b + r), 0) - r;
}
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
var Shape = class {
  constructor() {
    __publicField(this, "ops", []);
    /** Material of the shape nearest the last evaluated point. */
    __publicField(this, "mat", 0);
  }
  /** Blend a shape in (k = blend radius in cm), painted with material `mat`. */
  add(prim, mat, k = 0) {
    this.ops.push({ prim, mode: "add", k, mat });
    return this;
  }
  /** Carve a shape out. */
  sub(prim, k = 0) {
    this.ops.push({ prim, mode: "sub", k, mat: -1 });
    return this;
  }
  /** Keep only what is also inside `prim`. */
  int(prim, k = 0) {
    this.ops.push({ prim, mode: "int", k, mat: -1 });
    return this;
  }
  /** Bounds of everything added, padded. */
  bounds(pad = 1) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const o of this.ops) {
      if (o.mode !== "add") continue;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], o.prim.c[i] - o.prim.r - pad);
        max[i] = Math.max(max[i], o.prim.c[i] + o.prim.r + pad);
      }
    }
    return { min, max };
  }
  /** The shapes added so far, in order. */
  get list() {
    return this.ops;
  }
  /** Add a shape with its blend radius and material exactly as given (for assembling shapes). */
  push(op) {
    this.ops.push(op);
    return this;
  }
  get empty() {
    return !this.ops.some((o) => o.mode === "add");
  }
  /** Indices of the shapes that can matter within `r` of a point (the others are left out). */
  near(c, r) {
    const out = [];
    for (const o of this.ops) {
      if (o.mode === "int") {
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
  eval(x, y, z, ops = this.ops) {
    let d = 1e9;
    let mat = 0;
    for (const o of ops) {
      const p = o.prim;
      const dx = x - p.c[0];
      const dy = y - p.c[1];
      const dz = z - p.c[2];
      const bound = Math.sqrt(dx * dx + dy * dy + dz * dz) - p.r;
      if (o.mode === "add") {
        if (bound - d >= o.k && bound > d) continue;
        const di = p.d(x, y, z);
        if (di < d) mat = o.mat;
        d = smin(d, di, o.k);
      } else if (o.mode === "sub") {
        if (bound >= -d + o.k) continue;
        d = -smin(-d, p.d(x, y, z), o.k);
      } else {
        d = -smin(-d, -p.d(x, y, z), o.k);
      }
    }
    this.mat = mat;
    return d;
  }
};
var len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function sphere(c, r) {
  return { c, r, d: (x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r };
}
function superEllipsoid(c, r, p) {
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
    }
  };
}
function ellipsoid(c, r) {
  return {
    c,
    r: Math.max(...r),
    d: (x, y, z) => {
      const px = (x - c[0]) / r[0];
      const py = (y - c[1]) / r[1];
      const pz = (z - c[2]) / r[2];
      const k0 = len3(px, py, pz);
      const k1 = len3(px / r[0], py / r[1], pz / r[2]);
      return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(...r);
    }
  };
}
function capsule(a, b, ra, rb = ra) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l2 = ba[0] ** 2 + ba[1] ** 2 + ba[2] ** 2;
  const l = Math.sqrt(l2);
  const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
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
    }
  };
}
function roundBox(c, h, r, rot) {
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
    }
  };
}
function torus(c, R, r, rot, scaleZ = 1) {
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
    }
  };
}
function custom(c, r, d) {
  return { c, r, d };
}
function invRot(r) {
  const [a, b, c] = r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const m = [
    cb * cc,
    -cb * sc,
    sb,
    ca * sc + sa * sb * cc,
    ca * cc - sa * sb * sc,
    -sa * cb,
    sa * sc - ca * sb * cc,
    sa * cc + ca * sb * sc,
    ca * cb
  ];
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}
function mul(m, x, y, z) {
  return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
}
function ribbon(pts, ws, ts, out) {
  const segs = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const L = len3(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1e-6;
    const T = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
    const o = out([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const dt = o[0] * T[0] + o[1] * T[1] + o[2] * T[2];
    let N = [o[0] - T[0] * dt, o[1] - T[1] * dt, o[2] - T[2] * dt];
    const nl = len3(N[0], N[1], N[2]) || 1;
    N = [N[0] / nl, N[1] / nl, N[2] / nl];
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    const r = Math.max(ws[i], ws[i + 1], ts[i], ts[i + 1]);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    segs.push({ a, T, N, B, L, w0: ws[i], w1: ws[i + 1], t0: ts[i], t1: ts[i + 1], m, r: L / 2 + r });
  }
  return ribbonOf(segs);
}
function ribbonOf(segs) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const s of segs)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], s.m[k] - s.r);
      max[k] = Math.max(max[k], s.m[k] + s.r);
    }
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const self = {
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
        const d = k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -t;
        if (d < best) best = d;
      }
      return best;
    },
    restrict: (q, r) => {
      const keep = segs.filter((s) => len3(q[0] - s.m[0], q[1] - s.m[1], q[2] - s.m[2]) - s.r < r);
      if (!keep.length) return null;
      return keep.length === segs.length ? self : ribbonOf(keep);
    }
  };
  return self;
}

// voxel/palette.ts
import * as THREE from "three";
var PAL = {
  empty: 0,
  // Neutrals
  white: 1,
  offWhite: 2,
  lightGrey: 3,
  grey: 4,
  midGrey: 5,
  darkGrey: 6,
  charcoal: 7,
  black: 8,
  // Hard court blues
  courtBlue: 9,
  courtBlueDark: 10,
  surround: 11,
  surroundLight: 12,
  // Clay
  clay: 13,
  clayDark: 14,
  clayLight: 15,
  // Grass
  grass: 16,
  grassDark: 17,
  grassLight: 18,
  hedge: 19,
  hedgeDark: 20,
  // Ball
  ball: 21,
  ballSeam: 22,
  // Skin tones
  skin1: 23,
  skin2: 24,
  skin3: 25,
  skin4: 26,
  // Hair
  hairBlack: 27,
  hairBrown: 28,
  hairBlond: 29,
  hairRed: 30,
  // Seats and stands
  seatBlue: 31,
  seatNavy: 32,
  concrete: 33,
  concreteDark: 34,
  // Buildings and city
  glass: 35,
  glassDark: 36,
  window: 37,
  brick: 38,
  brickDark: 39,
  sand: 40,
  stone: 41,
  stoneDark: 42,
  roofRed: 43,
  sea: 44,
  seaDark: 45,
  // Bright accents for shirts, banners, flags
  red: 46,
  orange: 47,
  yellow: 48,
  lime: 49,
  green: 50,
  teal: 51,
  cyan: 52,
  sky: 53,
  blue: 54,
  purple: 55,
  pink: 56,
  // Fixtures
  netCord: 57,
  postGreen: 58,
  wood: 59,
  woodDark: 60,
  lamp: 61,
  /** The tour's accent colour (banners, landmark stripes); set per tour. */
  accent: 62,
  accentDark: 63,
  // Character editor (phase 20): more skin tones, hair and kit colours.
  skin0: 64,
  skinMid: 65,
  skin5: 66,
  hairGrey: 67,
  hairAuburn: 68,
  hairPlatinum: 69,
  hairBlue: 70,
  hairPink: 71,
  navy: 72,
  maroon: 73,
  mint: 74,
  lavender: 75,
  coral: 76,
  gold: 77,
  forest: 78,
  // Arenas (phase 26): structure, roofs, glass, screens and lamps, plants, tour seat colours.
  steel: 79,
  steelDark: 80,
  roofWhite: 81,
  roofUnder: 82,
  glassTint: 83,
  ledBlack: 84,
  ledWhite: 85,
  ledAccent: 86,
  floodLamp: 87,
  screenBlue: 88,
  windowWarm: 89,
  ivy: 90,
  ivyLight: 91,
  flowerPink: 92,
  flowerWhite: 93,
  palmTrunk: 94,
  palmLeaf: 95,
  blossom: 96,
  lantern: 97,
  neonPink: 98,
  neonCyan: 99,
  seatA: 100,
  seatB: 101,
  shell: 102,
  shellDark: 103,
  rubber: 104,
  terracotta: 105,
  stoneWarm: 106,
  tunnel: 107,
  ledYellow: 108,
  shellTrim: 109,
  plantDark: 110,
  water: 111,
  // Slam venues (phase 41): volcano, sky citadel, blossom garden and neon city.
  lava: 112,
  magma: 113,
  basalt: 114,
  basaltDark: 115,
  ash: 116,
  cloud: 117,
  cloudShade: 118,
  falls: 119,
  marble: 120,
  marbleVein: 121,
  petal: 122,
  petalDeep: 123,
  neonPurple: 124,
  neonYellow: 125,
  neonGreen: 126,
  holo: 127,
  // Phase 42: the other venues' worlds.
  ice: 128,
  iceDeep: 129,
  snow: 130,
  snowShade: 131,
  crystal: 132,
  aurora: 133,
  auroraViolet: 134,
  sandstone: 135,
  sandstoneDark: 136,
  ruinMoss: 137,
  cypress: 138,
  olive: 139,
  jungle: 140,
  jungleDark: 141,
  vine: 142,
  templeStone: 143,
  templeDark: 144,
  jade: 145,
  karst: 146,
  karstDark: 147,
  mist: 148,
  lagoon: 149,
  lagoonDeep: 150,
  beach: 151,
  canyon: 152,
  canyonDark: 153,
  canyonLight: 154,
  cactus: 155,
  castle: 156,
  castleDark: 157,
  slate: 158,
  torch: 159,
  // Phase 64: the new venues' worlds.
  shroomCap: 160,
  shroomSpot: 161,
  shroomGlow: 162,
  stalk: 163,
  moss: 164,
  moonRock: 165,
  moonDark: 166,
  regolith: 167,
  earthBlue: 168,
  earthGreen: 169,
  shipWood: 170,
  sail: 171,
  boneRock: 172,
  copper: 173,
  brass: 174,
  soot: 175,
  nebula: 176,
  planetA: 177,
  planetRing: 178,
  rainbowRed: 179,
  rainbowOrange: 180,
  deepSea: 181,
  // Phase 70: the new hard-court worlds.
  dune: 182,
  duneShade: 183,
  lakeTurq: 184,
  maple: 185,
  mapleGold: 186,
  bark: 187,
  barkDark: 188,
  acorn: 189,
  oakLeaf: 190,
  dragonScale: 191,
  firework: 192,
  // Phase 71: the clay worlds.
  adobe: 193,
  adobeDark: 194,
  pastelPink: 195,
  pastelYellow: 196,
  pastelBlue: 197,
  prairie: 198,
  // Phase 72: the grass worlds.
  bamboo: 199,
  bambooDark: 200,
  asphalt: 201,
  // Phase 73: lavender rows, chocolate, candy, carnival bulbs.
  lavField: 202,
  lavDark: 203,
  chocolate: 204,
  chocoLight: 205,
  candyPink: 206,
  candyMint: 207,
  bulb: 208,
  // Phase 82: waterfalls with depth, wet and mossy rock.
  fallsBlue: 209,
  foam: 210,
  rockWet: 211,
  rockMoss: 212
};
var EMISSIVE = {
  [PAL.ledWhite]: 0.8,
  [PAL.ledAccent]: 0.5,
  [PAL.floodLamp]: 2,
  [PAL.screenBlue]: 0.9,
  [PAL.windowWarm]: 0.75,
  [PAL.lantern]: 1.1,
  [PAL.neonPink]: 1.2,
  [PAL.neonCyan]: 1.2,
  [PAL.ledYellow]: 1,
  [PAL.lava]: 1.5,
  [PAL.magma]: 0.6,
  [PAL.falls]: 0.25,
  [PAL.foam]: 0.3,
  [PAL.neonPurple]: 1.2,
  [PAL.neonYellow]: 1.2,
  [PAL.neonGreen]: 1.2,
  [PAL.holo]: 0.9,
  [PAL.crystal]: 0.55,
  [PAL.aurora]: 1.1,
  [PAL.auroraViolet]: 1.1,
  [PAL.torch]: 1.4,
  [PAL.shroomGlow]: 1.1,
  [PAL.earthBlue]: 0.7,
  [PAL.earthGreen]: 0.7,
  [PAL.nebula]: 1,
  [PAL.planetA]: 0.6,
  [PAL.planetRing]: 0.6,
  [PAL.rainbowRed]: 0.5,
  [PAL.rainbowOrange]: 0.5,
  [PAL.firework]: 1,
  [PAL.bulb]: 1.2
};
var PALETTE_SIZE = 213;
var BASE = {
  [PAL.white]: 16777215,
  [PAL.offWhite]: 15855591,
  [PAL.lightGrey]: 13225686,
  [PAL.grey]: 10134446,
  [PAL.midGrey]: 7173762,
  [PAL.darkGrey]: 4673370,
  [PAL.charcoal]: 2830650,
  [PAL.black]: 1382429,
  [PAL.courtBlue]: 3900100,
  [PAL.courtBlueDark]: 3370920,
  [PAL.surround]: 3050090,
  [PAL.surroundLight]: 3512431,
  [PAL.clay]: 13133114,
  [PAL.clayDark]: 11096879,
  [PAL.clayLight]: 14187342,
  [PAL.grass]: 5941311,
  [PAL.grassDark]: 4953141,
  [PAL.grassLight]: 7060044,
  [PAL.hedge]: 3111482,
  [PAL.hedgeDark]: 2383661,
  [PAL.ball]: 15136058,
  [PAL.ballSeam]: 16515030,
  [PAL.skin1]: 16167550,
  [PAL.skin2]: 14919546,
  [PAL.skin3]: 11565650,
  [PAL.skin4]: 7226928,
  [PAL.hairBlack]: 2038554,
  [PAL.hairBrown]: 8342058,
  [PAL.hairBlond]: 14860392,
  [PAL.hairRed]: 11817002,
  [PAL.seatBlue]: 3108784,
  [PAL.seatNavy]: 2244718,
  [PAL.concrete]: 12106946,
  [PAL.concreteDark]: 9278363,
  [PAL.glass]: 9421800,
  [PAL.glassDark]: 6263741,
  [PAL.window]: 16508833,
  [PAL.brick]: 12747370,
  [PAL.brickDark]: 10314831,
  [PAL.sand]: 15259304,
  [PAL.stone]: 14209732,
  [PAL.stoneDark]: 11445652,
  [PAL.roofRed]: 12600634,
  [PAL.sea]: 3116996,
  [PAL.seaDark]: 2519715,
  [PAL.red]: 14826299,
  [PAL.orange]: 15895592,
  [PAL.yellow]: 16240442,
  [PAL.lime]: 10933818,
  [PAL.green]: 4173402,
  [PAL.teal]: 2270874,
  [PAL.cyan]: 5032424,
  [PAL.sky]: 9357808,
  [PAL.blue]: 2773728,
  [PAL.purple]: 9067224,
  [PAL.pink]: 15495078,
  [PAL.netCord]: 1909291,
  [PAL.postGreen]: 2050615,
  [PAL.wood]: 11039807,
  [PAL.woodDark]: 8148016,
  [PAL.lamp]: 16774084,
  [PAL.accent]: 16739146,
  [PAL.accentDark]: 13914159,
  [PAL.skin0]: 16571586,
  [PAL.skinMid]: 13209186,
  [PAL.skin5]: 4861472,
  [PAL.hairGrey]: 12170928,
  [PAL.hairAuburn]: 8008736,
  [PAL.hairPlatinum]: 15918788,
  [PAL.hairBlue]: 3829720,
  [PAL.hairPink]: 15231656,
  [PAL.navy]: 2046568,
  [PAL.maroon]: 9053238,
  [PAL.mint]: 9429952,
  [PAL.lavender]: 12166128,
  [PAL.coral]: 16743010,
  [PAL.gold]: 14723370,
  [PAL.forest]: 2845509,
  [PAL.steel]: 9148326,
  [PAL.steelDark]: 5661039,
  [PAL.roofWhite]: 15659508,
  [PAL.roofUnder]: 11121599,
  [PAL.glassTint]: 7311004,
  [PAL.ledBlack]: 1382173,
  [PAL.ledWhite]: 16054271,
  [PAL.ledAccent]: 16739146,
  [PAL.floodLamp]: 16774880,
  [PAL.screenBlue]: 5213695,
  [PAL.windowWarm]: 16765843,
  [PAL.ivy]: 2910766,
  [PAL.ivyLight]: 4886330,
  [PAL.flowerPink]: 15891120,
  [PAL.flowerWhite]: 16184063,
  [PAL.palmTrunk]: 10123858,
  [PAL.palmLeaf]: 3971646,
  [PAL.blossom]: 16102348,
  [PAL.lantern]: 16743738,
  [PAL.neonPink]: 16727976,
  [PAL.neonCyan]: 4188927,
  [PAL.seatA]: 3108784,
  [PAL.seatB]: 2244718,
  [PAL.shell]: 12830927,
  [PAL.shellDark]: 9344415,
  [PAL.rubber]: 2830393,
  [PAL.terracotta]: 12607804,
  [PAL.stoneWarm]: 14865074,
  [PAL.tunnel]: 856085,
  [PAL.ledYellow]: 16767050,
  [PAL.shellTrim]: 16777215,
  [PAL.plantDark]: 2051364,
  [PAL.water]: 3840720,
  [PAL.lava]: 16742940,
  [PAL.magma]: 12727834,
  [PAL.basalt]: 6048846,
  [PAL.basaltDark]: 3945014,
  [PAL.ash]: 9076352,
  [PAL.cloud]: 16185599,
  [PAL.cloudShade]: 13227754,
  [PAL.falls]: 13496063,
  [PAL.marble]: 15855076,
  [PAL.marbleVein]: 14077888,
  [PAL.petal]: 16234704,
  [PAL.petalDeep]: 14842534,
  [PAL.neonPurple]: 10636287,
  [PAL.neonYellow]: 16769354,
  [PAL.neonGreen]: 6160250,
  [PAL.holo]: 8378623,
  [PAL.ice]: 12575986,
  [PAL.iceDeep]: 6991574,
  [PAL.snow]: 15988991,
  [PAL.snowShade]: 13820142,
  [PAL.crystal]: 8385279,
  [PAL.aurora]: 6094768,
  [PAL.auroraViolet]: 10779903,
  [PAL.sandstone]: 14466188,
  [PAL.sandstoneDark]: 11571038,
  [PAL.ruinMoss]: 8358992,
  [PAL.cypress]: 2902572,
  [PAL.olive]: 9083482,
  [PAL.jungle]: 3112238,
  [PAL.jungleDark]: 1856548,
  [PAL.vine]: 5808954,
  [PAL.templeStone]: 9146230,
  [PAL.templeDark]: 6054482,
  [PAL.jade]: 4173450,
  [PAL.karst]: 11057840,
  [PAL.karstDark]: 7636862,
  [PAL.mist]: 15002862,
  [PAL.lagoon]: 4184271,
  [PAL.lagoonDeep]: 1875132,
  [PAL.beach]: 16116168,
  [PAL.canyon]: 12868142,
  [PAL.canyonDark]: 9190175,
  [PAL.canyonLight]: 14913616,
  [PAL.cactus]: 5147194,
  [PAL.castle]: 11314581,
  [PAL.castleDark]: 7301470,
  [PAL.slate]: 4739682,
  [PAL.torch]: 16754746,
  [PAL.shroomCap]: 14169162,
  [PAL.shroomSpot]: 16773858,
  [PAL.shroomGlow]: 5238992,
  [PAL.stalk]: 15129284,
  [PAL.moss]: 3428410,
  [PAL.moonRock]: 10132644,
  [PAL.moonDark]: 6053478,
  [PAL.regolith]: 13027534,
  [PAL.earthBlue]: 3108824,
  [PAL.earthGreen]: 4890698,
  [PAL.shipWood]: 6964262,
  [PAL.sail]: 15787724,
  [PAL.boneRock]: 13616818,
  [PAL.copper]: 13137203,
  [PAL.brass]: 14263361,
  [PAL.soot]: 2893862,
  [PAL.nebula]: 10116351,
  [PAL.planetA]: 14711370,
  [PAL.planetRing]: 15257496,
  [PAL.rainbowRed]: 16734810,
  [PAL.rainbowOrange]: 16752704,
  [PAL.deepSea]: 1920890,
  [PAL.dune]: 15251572,
  [PAL.duneShade]: 12880466,
  [PAL.lakeTurq]: 2865348,
  [PAL.maple]: 14172191,
  [PAL.mapleGold]: 15769636,
  [PAL.bark]: 8016948,
  [PAL.barkDark]: 5125152,
  [PAL.acorn]: 11565620,
  [PAL.oakLeaf]: 6262572,
  [PAL.dragonScale]: 2076794,
  [PAL.firework]: 16773824,
  [PAL.adobe]: 13138506,
  [PAL.adobeDark]: 10114098,
  [PAL.pastelPink]: 15906992,
  [PAL.pastelYellow]: 16178314,
  [PAL.pastelBlue]: 11063532,
  [PAL.prairie]: 14202976,
  [PAL.bamboo]: 8831040,
  [PAL.bambooDark]: 5147178,
  [PAL.asphalt]: 3948100,
  [PAL.lavField]: 9071304,
  [PAL.lavDark]: 6179470,
  [PAL.chocolate]: 5911584,
  [PAL.chocoLight]: 9066034,
  [PAL.candyPink]: 16026304,
  [PAL.candyMint]: 9103560,
  [PAL.bulb]: 16773296,
  [PAL.fallsBlue]: 9227240,
  [PAL.foam]: 16186623,
  [PAL.rockWet]: 6122344,
  [PAL.rockMoss]: 6259014
};
var CROWD_SHIRTS = [
  PAL.red,
  PAL.orange,
  PAL.yellow,
  PAL.lime,
  PAL.green,
  PAL.teal,
  PAL.cyan,
  PAL.blue,
  PAL.purple,
  PAL.pink,
  PAL.white,
  PAL.accent
];
var Palette = class _Palette {
  constructor(overrides = {}) {
    __publicField(this, "linear", []);
    __publicField(this, "hex", []);
    for (let i = 0; i < PALETTE_SIZE; i++) {
      const hex = overrides[i] ?? BASE[i] ?? 16711935;
      this.hex[i] = hex;
      this.linear[i] = new THREE.Color().setHex(hex);
    }
  }
  color(i) {
    return this.linear[i] ?? this.linear[0];
  }
  hexOf(i) {
    return this.hex[i] ?? 16711935;
  }
  /** The same palette with the accent slots swapped (one per tour). */
  withAccent(accent, accentDark) {
    return new _Palette({ ...this.overrides(), [PAL.accent]: accent, [PAL.accentDark]: accentDark });
  }
  overrides() {
    const o = {};
    this.hex.forEach((h, i) => o[i] = h);
    return o;
  }
};
var DEFAULT_PALETTE = new Palette();

// characters/faceRig.ts
import * as THREE2 from "three";
var EYE_COLORS = {
  dark: 2825495,
  brown: 6043936,
  hazel: 8413230,
  green: 4160332,
  blue: 4157634,
  grey: 7110030
};
var PX = 0.5;
var CM = 0.01;
var EYE_X = 4.2;
var EYE_Y = 17.6;
var MOUTH_Y = 11.4;
var EYE_DIMS = {
  round: [6, 9],
  wide: [8, 9],
  narrow: [6, 6],
  almond: [8, 7],
  hooded: [7, 8]
};
var FACES = {
  calm: { lid: "open", brow: { lift: 0, inner: 0, outer: 0 }, mouth: "own" },
  focus: { lid: "focus", brow: { lift: 0, inner: -1, outer: 0 }, mouth: "line" },
  effort: { lid: "focus", brow: { lift: 0, inner: -2, outer: 1 }, mouth: "grit" },
  joy: { lid: "happy", brow: { lift: 2, inner: 0, outer: 0 }, mouth: "grin" },
  roar: { lid: "angry", brow: { lift: 0, inner: -2, outer: 1 }, mouth: "open" },
  anger: { lid: "angry", brow: { lift: 0, inner: -2, outer: 1 }, mouth: "grit" },
  hurt: { lid: "sad", brow: { lift: 0, inner: 2, outer: -1 }, mouth: "frown" },
  tired: { lid: "tired", brow: { lift: 0, inner: 1, outer: -1 }, mouth: "pant" },
  shock: { lid: "wide", brow: { lift: 3, inner: 0, outer: 0 }, mouth: "o" },
  smirk: { lid: "smug", brow: { lift: 0, inner: 0, outer: 0, one: 2 }, mouth: "smirk" }
};
var MOUTHS = {
  line: ["llllll"],
  smile: ["l........l", "ll......ll", ".llllllll."],
  grin: ["l..........l", ".tttttttttt.", ".mmmmmmmmmm.", "..mmmmmmmm..", "...llllll..."],
  open: ["..llllllll..", ".tttttttttt.", "lmmmmmmmmmml", "lmmmmmmmmmml", "lmmmggggmmml", ".lmmggggmml.", "..llllllll.."],
  o: [".llll.", "lmmmml", "lmmmml", "lmmmml", ".llll."],
  frown: ["..llllll..", ".ll....ll.", "l........l"],
  grit: [".llllllllll.", "lttttttttttl", "lttttttttttl", ".llllllllll."],
  pant: [".llll.", "lmmmml", "lmmggl", ".llll."],
  smirk: ["........ll", ".......ll.", "lllllll..."]
};
function expressionFor(clip2) {
  switch (clip2) {
    case "ready":
    case "run":
    case "sidestep":
    case "splitStep":
    case "serveReady":
    case "serveToss":
    case "volleyFh":
    case "volleyBh":
      return "focus";
    case "forehand":
    case "backhand":
    case "backhand1":
    case "serve":
    case "smash":
      return "effort";
    case "celebrate":
    case "celebrate2":
    case "celebrate3":
    case "celebrateLoop":
    case "winWave":
    case "waveLoop":
    case "winArms":
    case "armsUpLoop":
    case "winKneel":
    case "kneelLoop":
    case "winLie":
    case "lieLoop":
      return "joy";
    case "clench":
    case "winRoar":
    case "roarLoop":
      return "roar";
    case "shakeHead":
    case "racketSmash":
      return "anger";
    case "winDisbelief":
    case "disbeliefLoop":
      return "shock";
    case "dejected":
    case "dejected2":
    case "dejectedLoop":
    case "loseCrouch":
    case "crouchLoop":
    case "loseHips":
    case "hipsLoop":
      return "hurt";
    case "tired":
      return "tired";
    default:
      return "calm";
  }
}
function eyeColorOf(look) {
  if (look.eyeColor && look.eyeColor in EYE_COLORS) return look.eyeColor;
  const h = (look.skin * 31 + look.hair * 17 + look.hairStyle.length * 7) % 100;
  return h < 30 ? "brown" : h < 52 ? "dark" : h < 66 ? "hazel" : h < 80 ? "blue" : h < 92 ? "green" : "grey";
}
var BROWS = {
  thin: { thick: 2, head: 0, taper: 0, start: 0, tail: 0, arch: (t) => Math.sin(Math.PI * t) * 1.2 },
  thick: { thick: 3, head: 1, taper: 0, start: 0, tail: 0, arch: (t) => Math.sin(Math.PI * t) * 1.2 },
  // A high arch peaking two thirds along, thinning to a fine tail.
  arched: { thick: 2, head: 1, taper: 1, start: 0, tail: 1, arch: (t) => t < 0.66 ? t / 0.66 * 2.6 : 2.6 - (t - 0.66) / 0.34 * 3 },
  // Flat and level, the same weight all along.
  straight: { thick: 2, head: 1, taper: 0, start: 0, tail: 0, arch: (t) => t * 0.3 },
  // A sharp angle: rising straight, then breaking down at the corner.
  angled: { thick: 2, head: 1, taper: 1, start: 0, tail: 1, arch: (t) => t < 0.72 ? t / 0.72 * 2.2 : 2.2 - (t - 0.72) / 0.28 * 3.2 },
  // Heavy and untamed, longer at both ends.
  bushy: { thick: 3, head: 1, taper: 0, start: 1, tail: 1, ragged: true, arch: (t) => Math.sin(Math.PI * t) * 1 },
  // Soft and short, a gentle curve that stops at the eye's corner.
  soft: { thick: 2, head: 0, taper: 1, start: -1, tail: -1, arch: (t) => Math.sin(Math.PI * t) * 1.6 }
};
function facePixels(look, e, blink, gaze, k) {
  const f = FACES[e];
  const out = [];
  const shape = look.eyes && look.eyes in EYE_DIMS ? look.eyes : "round";
  const [w, h] = EYE_DIMS[shape];
  const fem = look.body === "fem";
  const lid = blink && f.lid !== "happy" ? "closed" : f.lid;
  const eyeTop = EYE_Y * k - 0.1 + h * PX / 2;
  const inner = EYE_X - 1.4;
  for (const s of [-1, 1]) {
    const at = (c, r, kind2) => out.push({ x: s * (inner + (c + 0.5) * PX), y: eyeTop - (r + 0.5) * PX, kind: kind2 });
    eye(w, h, shape, lid, fem, s, gaze, at);
    if (look.brows !== "none") {
      const b = BROWS[look.brows ?? "thin"] ?? BROWS.thin;
      const c0 = -2 - b.start;
      const c1 = w + 2 + b.tail;
      for (let c = c0; c <= c1; c++) {
        const t = (c - c0) / (c1 - c0);
        const off = f.brow.lift + f.brow.inner * (1 - t) + f.brow.outer * t + (s > 0 ? f.brow.one ?? 0 : 0) + b.arch(t);
        let n = b.thick + (t < 0.25 ? b.head : 0) - (c === c1 ? 1 : 0) - (t > 0.8 ? b.taper : 0);
        if (b.ragged && (c * 7 + s * 3) % 5 === 0) n++;
        for (let q = 0; q < Math.max(1, n); q++) at(c, -3 - Math.round(off) - q, "brow");
      }
    }
  }
  const kind = f.mouth === "own" ? look.mouth === "grin" ? "grin" : look.mouth === "smile" ? "smile" : "none" : f.mouth;
  if (kind !== "none") {
    const rows = MOUTHS[kind];
    const top = MOUTH_Y * k + rows.length * PX / 2;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === ".") continue;
        const kd = ch === "l" ? "lip" : ch === "m" ? "inside" : ch === "t" ? "teeth" : "tongue";
        out.push({ x: (c - (row.length - 1) / 2) * PX, y: top - (r + 0.5) * PX, kind: kd });
      }
    });
  }
  return out;
}
function eye(w, h, shape, lid, fem, side, gaze, at) {
  if (lid === "closed") {
    for (let r = 0; r < h - 1; r++) for (let c = 0; c < w; c++) at(c, r, r === h - 2 ? "lash" : "lid");
    if (fem) at(w, h - 3, "lash");
    return;
  }
  if (lid === "happy") {
    for (let c = 0; c < w; c++) at(c, h - 3 - Math.round(2 * Math.sin(Math.PI * c / (w - 1))), "lash");
    return;
  }
  const hood = shape === "hooded" ? 1 : 0;
  const top = (c) => {
    const t = c / (w - 1);
    switch (lid) {
      case "focus":
      case "smug":
        return 2 + hood;
      case "tired":
        return 3 + hood;
      case "angry":
        return Math.round(3 - 2 * t) + hood;
      case "sad":
        return Math.round(1 + 2 * t) + hood;
      default:
        return hood;
    }
  };
  const bottom = lid === "focus" || lid === "angry" ? 1 : 0;
  const wide = lid === "wide";
  const cc = (w - 1) / 2 + gaze[0] * side;
  const ih = (w >= 8 ? 2.5 : 2) - (wide ? 0.5 : 0);
  const r0 = wide ? 2 : 1;
  const r1 = wide ? h - 3 : h - 2;
  const rc = (r0 + r1) / 2 + gaze[1];
  const glintC = Math.round(cc + ih * 0.5);
  for (let c = 0; c < w; c++) {
    const t = top(c);
    for (let r = 0; r < h; r++) {
      if (r === h - 1 && (c === 0 || c === w - 1)) continue;
      if (r < t || r >= h - bottom) {
        at(c, r, "lid");
        continue;
      }
      if (r === t) {
        at(c, r, "lash");
        continue;
      }
      const inIris = Math.abs(c - cc) <= ih && r >= r0 && r <= r1;
      if (!inIris) {
        at(c, r, "white");
        continue;
      }
      const pupil = Math.abs(c - cc) <= (w % 2 ? 0.5 : 1) - (wide ? 0.5 : 0) + 0.01 && Math.abs(r - rc) <= (h >= 7 ? 1 : 0.5) - (wide ? 0.5 : 0);
      const first = Math.max(r0, t + 1);
      if (c === glintC && r === first) at(c, r, "glint");
      else if (pupil) at(c, r, "pupil");
      else if (r === first) at(c, r, "irisDark");
      else if (r === r1) at(c, r, "irisLight");
      else at(c, r, "iris");
    }
  }
  if (fem) {
    at(w, top(w - 1), "lash");
    at(w, top(w - 1) - 1, "lash");
  }
}
function palette(look, skin, hair2) {
  const iris = new THREE2.Color(EYE_COLORS[eyeColorOf(look)]);
  return {
    lash: new THREE2.Color(1774867),
    white: new THREE2.Color(15920870),
    iris,
    irisDark: iris.clone().multiplyScalar(0.62),
    irisLight: iris.clone().lerp(new THREE2.Color(1, 1, 1), 0.28),
    pupil: new THREE2.Color(789264),
    glint: new THREE2.Color(16777215),
    lid: skin.clone().multiplyScalar(0.94),
    // Brows grey a little behind the hair (phase 81).
    brow: hair2.clone().multiplyScalar(0.7).lerp(new THREE2.Color(0.72, 0.71, 0.69), (look.grey ?? 0) * 0.45),
    lip: skin.clone().multiply(new THREE2.Color(0.6, 0.4, 0.38)),
    inside: new THREE2.Color(3872025),
    teeth: new THREE2.Color(15986404),
    tongue: new THREE2.Color(12605530)
  };
}
var RAISE = {
  lash: 0.22,
  brow: 0.25,
  lip: 0.12,
  white: 0.05,
  iris: 0.05,
  irisDark: 0.05,
  irisLight: 0.05,
  pupil: 0.05,
  glint: 0.07,
  lid: 0.08,
  inside: 0.03,
  teeth: 0.09,
  tongue: 0.06
};
function faceGeometry(pixels, map, colors) {
  const { size, cells } = map;
  const ox = cells[0] ?? 0;
  const oy = cells[1] ?? 0;
  const depth = /* @__PURE__ */ new Map();
  const key = (i, j) => (i + 2048) * 4096 + (j + 2048);
  for (let q = 0; q < cells.length; q += 3) {
    const kk = key(Math.round((cells[q] - ox) / size), Math.round((cells[q + 1] - oy) / size));
    depth.set(kk, Math.max(depth.get(kk) ?? -Infinity, cells[q + 2]));
  }
  const zAt = (x, y) => depth.get(key(Math.round((x - ox) / size), Math.round((y - oy) / size)));
  const grid = /* @__PURE__ */ new Map();
  const pk = (x, y) => `${Math.round(x / PX)},${Math.round(y / PX)}`;
  for (const p of pixels) {
    const z = zAt(p.x, p.y);
    if (z === void 0) continue;
    grid.set(pk(p.x, p.y), { p, z, front: z + RAISE[p.kind] });
  }
  const pos = [];
  const nor = [];
  const col = [];
  const fuv = [];
  const ao = [];
  const sss = [];
  const idx = [];
  const quad = (a, b, c, d, n, color, s) => {
    const start = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0] * CM, v[1] * CM, v[2] * CM);
      nor.push(n[0], n[1], n[2]);
      col.push(color.r, color.g, color.b);
      fuv.push(0.5, 0.5);
      ao.push(1);
      sss.push(s);
    }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const side = new THREE2.Color();
  const H = PX / 2;
  for (const { p, z, front } of grid.values()) {
    const c = colors[p.kind];
    const s = p.kind === "lid" ? 0.45 : p.kind === "brow" ? 0.35 : p.kind === "lip" || p.kind === "tongue" ? 0.3 : 0.05;
    const { x, y } = p;
    quad([x - H, y - H, front], [x + H, y - H, front], [x + H, y + H, front], [x - H, y + H, front], [0, 0, 1], c, s);
    side.copy(c).multiplyScalar(0.78);
    const back = z - 0.3;
    const wall = (dx, dy) => {
      const n = grid.get(pk(x + dx * PX, y + dy * PX));
      if (n && n.front >= front - 1e-3) return;
      const lo = Math.max(back, n ? n.front : back);
      if (dx > 0) quad([x + H, y - H, lo], [x + H, y + H, lo], [x + H, y + H, front], [x + H, y - H, front], [1, 0, 0], side, s);
      else if (dx < 0) quad([x - H, y + H, lo], [x - H, y - H, lo], [x - H, y - H, front], [x - H, y + H, front], [-1, 0, 0], side, s);
      else if (dy > 0) quad([x + H, y + H, lo], [x - H, y + H, lo], [x - H, y + H, front], [x + H, y + H, front], [0, 1, 0], side, s);
      else quad([x - H, y - H, lo], [x + H, y - H, lo], [x + H, y - H, front], [x - H, y - H, front], [0, -1, 0], side, s);
    };
    wall(1, 0);
    wall(-1, 0);
    wall(0, 1);
    wall(0, -1);
  }
  const geo = new THREE2.BufferGeometry();
  geo.setAttribute("position", new THREE2.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE2.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE2.Float32BufferAttribute(col, 3));
  geo.setAttribute("fuv", new THREE2.Float32BufferAttribute(fuv, 2));
  geo.setAttribute("ao", new THREE2.Float32BufferAttribute(ao, 1));
  geo.setAttribute("sss", new THREE2.Float32BufferAttribute(sss, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
var FaceRig = class {
  constructor(look, map, k, skin, hair2, material) {
    this.look = look;
    this.map = map;
    this.k = k;
    __publicField(this, "mesh");
    __publicField(this, "built", /* @__PURE__ */ new Map());
    __publicField(this, "colors");
    __publicField(this, "expr", "calm");
    __publicField(this, "blinking", 0);
    __publicField(this, "nextBlink", 1 + Math.random() * 3);
    __publicField(this, "gaze", [0, 0]);
    /** A held look (the tunnel staredown, phase 87): no random glances while set. */
    __publicField(this, "held", null);
    __publicField(this, "nextGaze", 1.5);
    __publicField(this, "last", 0);
    __publicField(this, "shown", "");
    this.colors = palette(look, skin, hair2);
    this.mesh = new THREE2.Mesh(new THREE2.BufferGeometry(), material);
    this.mesh.name = "face";
    this.mesh.frustumCulled = false;
    this.draw();
  }
  get expression() {
    return this.expr;
  }
  /** Show this expression. */
  set(e) {
    if (e === this.expr) return;
    this.expr = e;
    if (e !== "calm") this.gaze = this.held ? [...this.held] : [0, 0];
    this.draw();
  }
  /** Hold the eyes one way (−1..1 across, −1..1 up and down), or let them wander again. */
  hold(gaze) {
    this.held = gaze ? [Math.sign(gaze[0]), Math.sign(gaze[1])] : null;
    this.gaze = this.held ? [...this.held] : [0, 0];
    this.draw();
  }
  /** Close the eyes for a moment now. */
  blink() {
    this.blinking = 0.13;
    this.draw();
  }
  /** Blinks and glances; call every frame (it keeps its own clock when no step is given). */
  update(dt) {
    const now = performance.now() / 1e3;
    const step = dt ?? Math.min(0.1, this.last ? now - this.last : 0);
    this.last = now;
    if (this.blinking > 0 && (this.blinking -= step) <= 0) this.draw();
    if ((this.nextBlink -= step) <= 0) {
      this.blink();
      this.nextBlink = Math.random() < 0.15 ? 0.3 : 2.2 + Math.random() * 3.6;
    }
    if (this.expr === "calm" && !this.held && (this.nextGaze -= step) <= 0) {
      const r = Math.random();
      this.gaze = [r < 0.25 ? -1 : r < 0.5 ? 1 : 0, Math.random() < 0.15 ? -1 : 0];
      this.nextGaze = 1.2 + Math.random() * 2.6;
      this.draw();
    }
  }
  draw() {
    const blink = this.blinking > 0;
    const key = `${this.expr}|${blink ? 1 : 0}|${this.gaze[0]},${this.gaze[1]}`;
    if (key === this.shown) return;
    this.shown = key;
    let g = this.built.get(key);
    if (!g) {
      g = faceGeometry(facePixels(this.look, this.expr, blink, this.gaze, this.k), this.map, this.colors);
      this.built.set(key, g);
    }
    this.mesh.geometry = g;
  }
  dispose() {
    for (const g of this.built.values()) g.dispose();
    this.built.clear();
  }
};

// characters/material.ts
import * as THREE3 from "three";
function characterMaterial({ voxel = false, ...opts } = {}) {
  const mat = new THREE3.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, ...opts });
  if (voxel) mat.defines = { VOXEL: "" };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: new THREE3.Color(1714778) };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float ao;\nattribute float sss;\nvarying float vAo;\nvarying float vSss;\n#ifdef VOXEL\nattribute vec2 fuv;\nvarying vec2 vFuv;\n#endif").replace("#include <begin_vertex>", "#include <begin_vertex>\nvAo = ao;\nvSss = sss;\n#ifdef VOXEL\nvFuv = fuv;\n#endif");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vAo;\nvarying float vSss;\nuniform vec3 uRim;\n#ifdef VOXEL\nvarying vec2 vFuv;\n#endif").replace("#include <lights_physical_pars_fragment>", PHYSICAL_PARS).replace(
      "#include <color_fragment>",
      `#include <color_fragment>
#ifdef VOXEL
{
  // Soft bevelled block edges: a slight darkening in the seams, a lighter lip inside them.
  vec2 e2 = min(vFuv, 1.0 - vFuv);
  float e = min(e2.x, e2.y);
  // Fades out where blocks are only a few pixels across, so small figures don't shimmer.
  float px = max(fwidth(vFuv.x), fwidth(vFuv.y));
  float k = 1.0 - smoothstep(0.1, 0.3, px);
  float seam = 1.0 - smoothstep(0.0, max(0.07, px * 1.2), e);
  float lip = smoothstep(0.04, 0.1, e) * (1.0 - smoothstep(0.1, 0.2, e));
  diffuseColor.rgb *= 1.0 - k * (0.3 * seam - 0.07 * lip);
}
#endif
diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0, 0.72, 0.6), (1.0 - vAo) * vSss);`
    ).replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
{
  float facing = saturate(dot(normal, normalize(vViewPosition)));
  float skin = step(0.9, vSss);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.9, 0.7, 0.6), skin * pow(1.0 - facing, 2.0));
}`
    ).replace(
      "#include <roughnessmap_fragment>",
      "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.62, step(0.3, vSss) * step(vSss, 0.4));"
    ).replace(
      "#include <aomap_fragment>",
      `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= vAo;
reflectedLight.indirectSpecular *= vAo;
reflectedLight.directDiffuse *= mix(1.0, vAo, 0.55);
reflectedLight.directSpecular *= mix(1.0, vAo, 0.8);`
    ).replace(
      "#include <opaque_fragment>",
      `{
  float fres = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0) * (1.0 - 0.8 * vSss);
  outgoingLight += uRim * fres * vAo;
  // Highlights roll off softly below the bloom threshold: white kit under a high sun or
  // floodlights reads bright, never as a glowing blob.
  float peak = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
  if (peak > 0.82) outgoingLight *= (0.82 + 0.16 * (1.0 - exp(-(peak - 0.82) * 3.0))) / peak;
}
#include <opaque_fragment>`
    );
  };
  mat.customProgramCacheKey = () => voxel ? "character-voxel" : "character";
  return mat;
}
var PHYSICAL_PARS = THREE3.ShaderChunk.lights_physical_pars_fragment.replace(
  /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
  `float dotNLraw = dot( geometryNormal, directLight.direction );
	// Hair wraps light the most, so a ponytail turned from the key never goes muddy.
	float wrapK = vSss > 0.3 && vSss < 0.4 ? 0.7 : 0.5 * vSss;
	float dotNL = saturate( ( dotNLraw + wrapK ) / ( 1.0 + wrapK ) );
	vec3 irradiance = dotNL * directLight.color;
	// Light scattering under the skin: a warm band along the shadow edge.
	float edge = smoothstep( -0.5, 0.05, dotNLraw ) * ( 1.0 - smoothstep( 0.05, 0.55, dotNLraw ) );
	irradiance += vSss * edge * vec3( 0.32, 0.12, 0.04 ) * directLight.color;`
);
if (PHYSICAL_PARS === THREE3.ShaderChunk.lights_physical_pars_fragment) console.warn("character material: lighting patch did not apply");

// characters/voxelBody.ts
import * as THREE4 from "three";
var VOX = 2;
var FINE = 1;
var VoxGrid = class {
  constructor(i0, j0, k0, nx, ny, nz, size = VOX) {
    this.i0 = i0;
    this.j0 = j0;
    this.k0 = k0;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.size = size;
    __publicField(this, "mat");
    __publicField(this, "part");
    __publicField(this, "bone");
    __publicField(this, "dist");
    const n = nx * ny * nz;
    this.mat = new Uint8Array(n);
    this.part = new Int8Array(n).fill(-1);
    this.bone = new Int8Array(n).fill(-1);
    this.dist = new Float32Array(n).fill(Infinity);
  }
  /** Cell index for world cell (i, j, k), or −1 outside. */
  at(i, j, k) {
    const a = i - this.i0, b = j - this.j0, c = k - this.k0;
    if (a < 0 || b < 0 || c < 0 || a >= this.nx || b >= this.ny || c >= this.nz) return -1;
    return a + this.nx * (b + this.ny * c);
  }
  filled(i, j, k) {
    const q = this.at(i, j, k);
    return q >= 0 && this.part[q] >= 0;
  }
  /** Centre of world cell index i along an axis (cm). */
  centre(i) {
    return (i + 0.5) * this.size;
  }
};
function voxelize(parts, VOX2) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const boxes = parts.map((p) => {
    const b = p.shape.bounds(1);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    const e = p.m;
    for (let q = 0; q < 8; q++) {
      const x = q & 1 ? b.max[0] : b.min[0];
      const y = q & 2 ? b.max[1] : b.min[1];
      const z = q & 4 ? b.max[2] : b.min[2];
      const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      for (let a = 0; a < 3; a++) {
        mn[a] = Math.min(mn[a], Math.floor(w[a] / VOX2));
        mx[a] = Math.max(mx[a], Math.ceil(w[a] / VOX2));
      }
    }
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], mn[a]);
      hi[a] = Math.max(hi[a], mx[a]);
    }
    return { mn, mx };
  });
  const g = new VoxGrid(lo[0], lo[1], lo[2], hi[0] - lo[0] + 1, hi[1] - lo[1] + 1, hi[2] - lo[2] + 1, VOX2);
  const B = 4;
  parts.forEach((p, pi) => {
    const { mn, mx } = boxes[pi];
    const s = p.s;
    const inv = new THREE4.Matrix4().fromArray(Array.from(p.m)).invert().elements;
    const toLocal = (i, j, k) => {
      const x = g.centre(i), y = g.centre(j), z = g.centre(k);
      return [
        inv[0] * x + inv[4] * y + inv[8] * z + inv[12],
        inv[1] * x + inv[5] * y + inv[9] * z + inv[13],
        inv[2] * x + inv[6] * y + inv[10] * z + inv[14]
      ];
    };
    for (let bk = mn[2]; bk <= mx[2]; bk += B)
      for (let bj = mn[1]; bj <= mx[1]; bj += B)
        for (let bi = mn[0]; bi <= mx[0]; bi += B) {
          const c = toLocal(bi + B / 2 - 0.5, bj + B / 2 - 0.5, bk + B / 2 - 0.5);
          const ops = p.shape.near(c, (VOX2 * B * 0.9 + VOX2) / s);
          if (!ops.some((o) => o.mode === "add")) continue;
          const d0 = p.shape.eval(c[0], c[1], c[2], ops) * s;
          const R = VOX2 * B * 0.87 * 1.6 + VOX2;
          if (d0 > R) continue;
          for (let k = bk; k < Math.min(bk + B, mx[2] + 1); k++)
            for (let j = bj; j < Math.min(bj + B, mx[1] + 1); j++)
              for (let i = bi; i < Math.min(bi + B, mx[0] + 1); i++) {
                const [x, y, z] = toLocal(i, j, k);
                const d = p.shape.eval(x, y, z, ops) * s - VOX2 * 0.18;
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
function tidy(g) {
  const near = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let pass = 0; pass < 2; pass++) {
    const out = g.mat.slice();
    for (let c = 0; c < g.nz; c++)
      for (let b = 0; b < g.ny; b++)
        for (let a = 0; a < g.nx; a++) {
          const q = a + g.nx * (b + g.ny * c);
          if (g.part[q] < 0) continue;
          const m = g.mat[q];
          const count = /* @__PURE__ */ new Map();
          let same = 0;
          for (const [x, y, z] of near) {
            const n = g.at(a + g.i0 + x, b + g.j0 + y, c + g.k0 + z);
            if (n < 0 || g.part[n] < 0 || g.bone[n] !== g.bone[q]) continue;
            if (g.mat[n] === m) same++;
            else count.set(g.mat[n], (count.get(g.mat[n]) ?? 0) + 1);
          }
          if (same > 0 || count.size === 0) continue;
          let best = -1, most = 0;
          for (const [k, v] of count) if (v > most) best = k, most = v;
          if (most >= 2) out[q] = best;
        }
    g.mat.set(out);
  }
}
var DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] }
];
function cellHash(i, j, k) {
  let h = i * 73856093 ^ j * 19349663 ^ k * 83492791;
  h = Math.imul(h ^ h >>> 13, 1540483477);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function voxelGeometry(g, o) {
  const VOX2 = g.size;
  const mats = o.touch ? o.touch(g) : g.mat;
  const hole = o.hole;
  const solid = (i, j, k) => {
    const q = g.at(i, j, k);
    return q >= 0 && g.part[q] >= 0 && !(hole && hole(i, j, k, g.mat[q]));
  };
  const pos = [];
  const nor = [];
  const col = [];
  const fuv = [];
  const ao = [];
  const sss = [];
  const si = [];
  const sw = [];
  const idx = [];
  const AO = [0.76, 0.86, 0.94, 1];
  const tmp = new THREE4.Color();
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
          const cx = g.centre(i) + n[0] * VOX2 / 2;
          const cy = g.centre(j) + n[1] * VOX2 / 2;
          const cz = g.centre(k) + n[2] * VOX2 / 2;
          const start = pos.length / 3;
          const occ = [];
          for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const x = cx + (su * u[0] + sv * v[0]) * VOX2 / 2;
            const y = cy + (su * u[1] + sv * v[1]) * VOX2 / 2;
            const z = cz + (su * u[2] + sv * v[2]) * VOX2 / 2;
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
          if (occ[0] + occ[2] >= occ[1] + occ[3]) idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
          else idx.push(start + 1, start + 2, start + 3, start + 1, start + 3, start);
        }
      }
  const geo = new THREE4.BufferGeometry();
  geo.setAttribute("position", new THREE4.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE4.Float32BufferAttribute(nor, 3));
  geo.setAttribute("color", new THREE4.Float32BufferAttribute(col, 3));
  geo.setAttribute("fuv", new THREE4.Float32BufferAttribute(fuv, 2));
  geo.setAttribute("ao", new THREE4.Float32BufferAttribute(ao, 1));
  geo.setAttribute("sss", new THREE4.Float32BufferAttribute(sss, 1));
  geo.setAttribute("skinIndex", new THREE4.Uint16BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE4.Float32BufferAttribute(sw, 4));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

// characters/rig.ts
var BONES = [
  "root",
  "hips",
  "torso",
  "head",
  "uArmR",
  "fArmR",
  "racket",
  "uArmL",
  "fArmL",
  "thighR",
  "shinR",
  "thighL",
  "shinL"
];
var PARENT = {
  root: null,
  hips: "root",
  torso: "hips",
  head: "torso",
  uArmR: "torso",
  fArmR: "uArmR",
  racket: "fArmR",
  uArmL: "torso",
  fArmL: "uArmL",
  thighR: "hips",
  shinR: "thighR",
  thighL: "hips",
  shinL: "thighL"
};
var CM2 = 0.01;
var HIP = 83;
var KNEE = 48;
var LIFT_SCALE = HIP / 60;
var CHAR_HEIGHT = 1.76;
var FRAMES = {
  masc: { shoulder: 17.2, hip: 8.9, neck: 134.4, shoulderY: 131.2, limb: 1.2, head: 0.92 },
  fem: { shoulder: 12.6, hip: 8.4, neck: 131.6, shoulderY: 129.4, limb: 1.04, head: 0.95 }
};
function pivots(f, w) {
  const arm = f.shoulder * w;
  const leg = f.hip * w;
  return {
    root: [0, 0, 0],
    hips: [0, 88, 0],
    torso: [0, TORSO, 0],
    head: [0, f.neck, 0],
    uArmR: [-arm, f.shoulderY, -0.5],
    fArmR: [-arm, f.shoulderY - 25, -0.5],
    racket: [-arm, f.shoulderY - 49, 0.8],
    uArmL: [arm, f.shoulderY, -0.5],
    fArmL: [arm, f.shoulderY - 25, -0.5],
    thighR: [-leg, HIP, 0],
    shinR: [-leg, KNEE, 0],
    thighL: [leg, HIP, 0],
    shinL: [leg, KNEE, 0]
  };
}
var TORSO = 101;
var BUILDS = {
  lean: { w: 0.93, waist: 0.88, chest: 0.92, limb: 0.9, glute: 0.92, belly: 0, def: 1 },
  athletic: { w: 1, waist: 0.95, chest: 1.04, limb: 1, glute: 1, belly: 0, def: 0.85 },
  powerful: { w: 1.08, waist: 1.02, chest: 1.16, limb: 1.14, glute: 1.06, belly: 0, def: 0.9 },
  heavy: { w: 1.1, waist: 1.24, chest: 1.12, limb: 1.13, glute: 1.12, belly: 1, def: 0.2 }
};
var muscleScale = (m) => 1 + ((m ?? 2) - 2) * 0.085;
function crease(c, d, half, from = 0.45) {
  return c.def > from && d < half * 1.45 * Math.min(1.4, c.def);
}
var defKey = (c) => Math.round(c.def * 8) / 8;
var longSleeved = (cut) => cut === "long" || cut === "zip";
var sleeveless = (cut) => cut === "tank" || cut === "muscle" || cut === "racerback" || cut === "dress" || cut === "racerdress";
var cache = /* @__PURE__ */ new Map();
var EMPTY = new THREE5.BufferGeometry();
for (const [name, n] of [["position", 3], ["normal", 3], ["color", 3], ["uv", 2], ["skinIndex", 4], ["skinWeight", 4]])
  EMPTY.setAttribute(name, new THREE5.Float32BufferAttribute([], n));
var CACHE_MAX = 24;
var fine = true;
var geoKey = (look, gear, detail) => JSON.stringify([look, gear, detail, fine]);
var SHOWROOM_POSE = {
  hips: [0, -0.08, 0.03],
  torso: [0, 0.05, -0.02],
  head: [0.04, 0.3, 0],
  uArmR: [0.05, 0, -0.36],
  fArmR: [-0.2, 0, 0.08],
  racket: [1.561, -0.276, 1.529],
  uArmL: [-0.05, 0, 0.34],
  fArmL: [-0.25, 0, -0.06],
  thighR: [0, 0, -0.32],
  thighL: [0, 0, 0.3],
  shinR: [0, 0, 0.07],
  shinL: [0, 0, -0.07]
};
var BAKE_POSE = Object.fromEntries(
  Object.entries(SHOWROOM_POSE).filter(([n]) => n !== "head" && n !== "torso" && n !== "hips")
);
{
  const e = (r) => new THREE5.Quaternion().setFromEuler(new THREE5.Euler(...r ?? [0, 0, 0]));
  const arm = e(BAKE_POSE.uArmR).multiply(e(BAKE_POSE.fArmR));
  const local = new THREE5.Euler().setFromQuaternion(arm.invert());
  BAKE_POSE.racket = [local.x, local.y, local.z];
}
function buildRig(look, gear, detail = "hi", palette2 = DEFAULT_PALETTE) {
  const pose2 = detail === "hi" ? BAKE_POSE : {};
  const fem = look.body === "fem";
  const f = FRAMES[fem ? "fem" : "masc"];
  const b = BUILDS[look.build ?? "athletic"] ?? BUILDS.athletic;
  const w = b.w;
  const worn = gear.cut ?? "tee";
  const dress = fem && (worn === "dress" || worn === "racerdress");
  const cut = !fem && worn === "dress" ? "tank" : !fem && worn === "racerdress" ? "racerback" : worn;
  const bottom = dress && look.bottom !== "tights" ? "skirt" : look.bottom ?? "shorts";
  const c = {
    l: look,
    g: gear,
    f,
    w,
    fem,
    cut,
    skirt: bottom === "skirt",
    mus: muscleScale(look.muscle) * b.limb,
    b,
    def: b.def * (0.55 + 0.225 * (look.muscle ?? 2)),
    bottom,
    socks: look.socks ?? "crew",
    lo: true,
    dress,
    pattern: gear.kit?.pattern
  };
  const PIVOT = pivots(f, w);
  const key = geoKey(look, gear, detail);
  let geo = detail === "none" ? EMPTY : palette2 === DEFAULT_PALETTE ? cache.get(key) : void 0;
  if (!geo) {
    geo = buildGeometry(c, PIVOT, palette2, pose2);
    if (palette2 === DEFAULT_PALETTE) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, geo);
    }
  }
  const bones = {};
  for (const name of BONES) {
    const b2 = new THREE5.Bone();
    b2.name = name;
    const p = PIVOT[name];
    const parent = PARENT[name];
    const q = parent ? PIVOT[parent] : [0, 0, 0];
    b2.position.set((p[0] - q[0]) * CM2, (p[1] - q[1]) * CM2, (p[2] - q[2]) * CM2);
    if (parent) bones[parent].add(b2);
    bones[name] = b2;
  }
  const skeleton = new THREE5.Skeleton(BONES.map((n) => bones[n]));
  const body = characterMaterial({ voxel: true });
  const mesh = new THREE5.SkinnedMesh(geo, body);
  mesh.add(bones.root);
  for (const [name, r] of Object.entries(pose2)) bones[name].rotation.set(r[0], r[1], r[2]);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton);
  for (const name of BONES) bones[name].rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.name = "character";
  mesh.scale.setScalar(look.height ?? 1);
  const group = new THREE5.Group();
  group.add(mesh);
  const local = new THREE5.Vector3(0, 0, RACKET_HEAD * CM2);
  const map = geo.userData.face;
  const face = map && map.cells.length ? new FaceRig(look, map, f.head, palette2.color(look.skin).clone(), palette2.color(look.hair).clone(), body) : null;
  if (face) bones.head.add(face.mesh);
  return {
    group,
    bones,
    racketHead: (target) => target.copy(local).applyMatrix4(bones.racket.matrixWorld),
    face,
    dispose: () => {
      body.dispose();
      face?.dispose();
    }
  };
}
function buildGeometry(c, PIVOT, palette2, pose2) {
  const list = [
    ["hips", pelvis(c)],
    ["torso", torso(c)],
    ["head", head(c)],
    ["head", hair(c)],
    ["head", tail(c)],
    ["uArmR", upperArm(c)],
    ["fArmR", forearm(c, -1, true)],
    ["uArmL", upperArm(c)],
    ["fArmL", forearm(c, 1, false)],
    ["thighR", thigh(c, -1)],
    ["shinR", shin(c, -1)],
    ["thighL", thigh(c, 1)],
    ["shinL", shin(c, 1)],
    ["racket", racket(c)]
  ];
  const place = {};
  for (const name of BONES) {
    const o = new THREE5.Object3D();
    const p = PIVOT[name];
    const parent = PARENT[name];
    const q = parent ? PIVOT[parent] : [0, 0, 0];
    o.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const r = pose2[name];
    if (r) o.rotation.set(r[0], r[1], r[2]);
    if (parent) place[parent].add(o);
    place[name] = o;
  }
  place.root.updateMatrixWorld(true);
  const parts = list.filter(([, p]) => !p.shape.empty).map(([bone, p]) => {
    const k = p.scale ?? 1;
    const [wx, wz] = p.wide ?? [1, 1];
    const m = place[bone].matrixWorld.clone().multiply(new THREE5.Matrix4().makeScale(k * wx, k, k * wz));
    return {
      shape: p.shape,
      bone: BONES.indexOf(bone),
      m: m.elements,
      s: k * Math.min(wx, 1, wz),
      paint: p.paint
    };
  });
  const size = fine ? FINE : VOX;
  const key = JSON.stringify([list.map(([, p]) => p.key ?? ""), c.w, c.f.head, pose2, size]);
  const racketBone = BONES.indexOf("racket");
  let grids = gridCache.get(key);
  if (!grids) {
    grids = [voxelize(parts.filter((p) => p.bone !== racketBone), size), voxelize(parts.filter((p) => p.bone === racketBone), VOX)];
    if (gridCache.size >= 12) gridCache.delete(gridCache.keys().next().value);
    gridCache.set(key, grids);
  }
  const colors = materialColors(c, palette2);
  const hp = new THREE5.Vector3().setFromMatrixPosition(place.head.matrixWorld);
  const headAt = [hp.x, hp.y, hp.z];
  const headTurn = place.head.getWorldQuaternion(new THREE5.Quaternion());
  const hk = c.f.head;
  const headBone = BONES.indexOf("head");
  const opts = {
    colors,
    unit: CM2,
    sss: (m) => m === 0 /* Skin */ || m === 16 /* Lip */ || m === 18 /* Stubble */ || m === 37 /* StubbleDark */ || m === 40 /* GreyFuzz */ ? 0.45 : HAIRY.has(m) ? 0.35 : 0.12,
    vary: (m) => HAIRY.has(m) ? 0.09 : m === 0 /* Skin */ ? 0.02 : m === 15 /* Eye */ ? 0 : 0.012
  };
  let face;
  const body = voxelGeometry(grids[0], {
    ...opts,
    touch: (g) => {
      const mats = g.mat.slice();
      face = paintFace(g, mats, headAt, headTurn, hk, headBone, c);
      return mats;
    }
  });
  const bat = voxelGeometry(grids[1], {
    ...opts,
    // The string bed: a lattice with a hole in every other block across the face (y, z).
    hole: (_i, j, k, m) => m === 11 /* String */ && j % 2 !== 0 && k % 2 !== 0
    // (The stencilled logo stays solid, so it reads.)
  });
  const geo = mergeGeometries([body, bat]);
  if (face) geo.userData.face = face;
  body.dispose();
  bat.dispose();
  return geo;
}
var gridCache = /* @__PURE__ */ new Map();
var HAIRY = /* @__PURE__ */ new Set([1 /* Hair */, 30 /* HairHi */, 31 /* HairLo */, 36 /* Beard */, 38 /* Grey */, 39 /* GreyLo */]);
function paintFace(g, mats, pivot, turn, k, headBone, c) {
  const back = turn.clone().invert();
  const fwd = new THREE5.Vector3(0, 0, 1).applyQuaternion(turn);
  const ax = [Math.abs(fwd.x), Math.abs(fwd.y), Math.abs(fwd.z)];
  const a0 = ax.indexOf(Math.max(...ax));
  const step = [0, 0, 0];
  step[a0] = Math.sign(fwd.getComponent(a0));
  const v = new THREE5.Vector3();
  const fh = c.l.facialHair ?? "none";
  const grey = c.l.grey ?? 0;
  const coarse = g.size > 1.5;
  const cells = [];
  const half = g.size / 2;
  for (let cc = 0; cc < g.nz; cc++)
    for (let b = 0; b < g.ny; b++)
      for (let a = 0; a < g.nx; a++) {
        const q = a + g.nx * (b + g.ny * cc);
        if (g.bone[q] !== headBone) continue;
        const m0 = g.mat[q];
        const skin = m0 === 0 /* Skin */;
        if (!skin && !HAIRY.has(m0) && m0 !== 29 /* Shaved */) continue;
        const i = a + g.i0, j = b + g.j0, kk = cc + g.k0;
        if (g.filled(i + 1, j, kk) && g.filled(i - 1, j, kk) && g.filled(i, j + 1, kk) && g.filled(i, j - 1, kk) && g.filled(i, j, kk + 1) && g.filled(i, j, kk - 1)) continue;
        v.set(g.centre(i) - pivot[0], g.centre(j) - pivot[1], g.centre(kk) - pivot[2]).applyQuaternion(back);
        const x = v.x / k, y = v.y / k, z = v.z / k;
        const n = dither(i * 1.31, j * 0.77, kk * 1.13);
        let m = m0;
        if (skin) {
          if (v.z >= 4 * k && !g.filled(i + step[0], j + step[1], kk + step[2])) cells.push(v.x, v.y, v.z + half);
          m = facialHairAt(fh, x, y, z, n, coarse) ?? m;
        } else if (m0 === 36 /* Beard */) m = beardStrand(x, y, z, n);
        if (grey > 0 && m !== 0 /* Skin */) m = greyed(m, grey, x, y, z, 0.65 * dither(Math.floor(x / 1.6), Math.floor(y / 3.2), Math.floor(z / 1.6)) + 0.35 * dither(kk * 0.91, i * 1.7, j * 0.63));
        mats[q] = m;
      }
  return { size: g.size, cells: new Float32Array(cells) };
}
var fade = (d, w) => Math.max(0, Math.min(1, d / w));
function beardArea(x, y, z) {
  const ax = Math.abs(x);
  const top = ax < 3 ? 13.9 : 13.9 + (ax - 3) * 0.45 + (z < 4 ? (4 - z) * 0.7 : 0);
  const sides = Math.min(top - y, z + 2.2);
  const low = y - (5.6 + Math.max(0, 3 - z) * 0.5);
  const lips = Math.max(Math.hypot(x / 3.3, (y - 11.4) / 0.9) - 1, 0) * 2;
  return Math.min(sides, low, z > 6 ? lips + 0.2 : 9);
}
function lipBand(x, y, lo, hi, w) {
  const ax = Math.abs(x);
  const droop = Math.max(0, ax - 2.4) * 0.55;
  return Math.min(y - (lo - droop), hi - droop * 0.4 - y, w - ax);
}
function facialHairAt(fh, x, y, z, n, coarse) {
  if (fh === "none" || z < -3) return null;
  const ax = Math.abs(x);
  const area = beardArea(x, y, z);
  const stubble = (dense) => {
    if (area <= 0) return null;
    const f = fade(area, 1.6) * (y < 8.4 ? fade(y - 5.6, 2.2) : 1);
    if (coarse) return f * dense > 0.45 ? dense > 0.8 ? 37 /* StubbleDark */ : 18 /* Stubble */ : null;
    if (n < f * dense * 0.85) return 37 /* StubbleDark */;
    return f > (dense < 0.3 ? 0.6 : 0.35) || n < f * 1.6 ? 18 /* Stubble */ : null;
  };
  const solid = (d, w = 0.6) => d <= 0 ? null : n < fade(d, w) * 1.05 ? n < 0.18 ? 31 /* HairLo */ : n > 0.86 ? 30 /* HairHi */ : 1 /* Hair */ : n < 0.5 ? 37 /* StubbleDark */ : null;
  const tache = () => z > 6 ? solid(lipBand(x, y, 11.7, 14, 4.3), 0.5) : null;
  const chin = (w) => z > 4 ? solid(Math.min(10.3 - y, w - ax * (1 + (10.3 - y) * 0.05), y - 7.4)) : null;
  switch (fh) {
    case "light":
      return stubble(0.22);
    case "stubble":
      return stubble(0.55);
    case "heavy":
      return stubble(0.78);
    case "moustache":
      return tache();
    case "pencil":
      return z > 6 && ax > 0.5 ? solid(lipBand(x, y, 11.75, 12.6, 3.7), 0.3) : null;
    case "horseshoe":
      return tache() ?? (z > 5 ? solid(Math.min(4.6 - ax, ax - 3.1, 13 - y, y - 8.6), 0.4) : null);
    case "goatee":
      return tache() ?? chin(3.1) ?? (z > 6 ? solid(Math.min(4 - ax, 12.6 - y, y - 9.6), 0.5) : null);
    case "soulpatch":
      return z > 6 ? solid(Math.min(2 - ax - Math.max(0, 9.6 - y) * 1.2, 10.7 - y, y - 8.2), 0.4) : null;
    case "chinstrap": {
      if (area <= 0) return null;
      const jaw = Math.max(9.4, 17.6 - (z + 1.5) * 0.72);
      return solid(Math.min(jaw + 1.5 - y, y - jaw + 3, area), 0.5);
    }
    case "boxed":
    case "beard":
    case "longbeard": {
      return tache() ?? stubble(fh === "boxed" ? 0.7 : 0.85);
    }
  }
  return null;
}
function beardStrand(x, y, z, n) {
  const u = x * 1.6 + Math.sin(y * 0.5) * 0.6;
  const f = u - Math.floor(u);
  const under = z < 4 && y < 10 ? 0.25 : 0;
  if (f < 0.28 + under || n < 0.12) return 31 /* HairLo */;
  if (f > 0.6 && f < 0.8 && n > 0.35) return 30 /* HairHi */;
  return 1 /* Hair */;
}
function greyed(m, grey, x, y, z, n) {
  const ax = Math.abs(x);
  const temple = ax > 7.5 && y > 14 && y < 26 && z > -6 ? 0.35 : 0;
  const chin = y < 12 && z > 2 ? 0.2 : 0;
  const crown = y > 30 ? -0.15 : 0;
  const p = Math.max(0, Math.min(1, grey * 0.95 + (temple + chin + crown) * Math.min(1, grey * 2.5)));
  if (n >= p) return m;
  switch (m) {
    case 1 /* Hair */:
    case 30 /* HairHi */:
    case 36 /* Beard */:
      return n < p * 0.6 ? 38 /* Grey */ : 39 /* GreyLo */;
    case 31 /* HairLo */:
      return 39 /* GreyLo */;
    case 18 /* Stubble */:
    case 37 /* StubbleDark */:
    case 29 /* Shaved */:
      return 40 /* GreyFuzz */;
  }
  return m;
}
function greyOf(hair2, bright) {
  return new THREE5.Color(0.8, 0.79, 0.77).multiplyScalar(bright).lerp(hair2, 0.12);
}
function materialColors(c, palette2) {
  const { l, g } = c;
  const col = (i) => palette2.color(i).clone();
  const shoeAcc = g.shoes !== PAL.white ? g.shoes : l.trim !== PAL.white ? l.trim : PAL.navy;
  const accMark = l.trim !== l.accessory ? l.trim : l.shirt !== l.accessory ? l.shirt : PAL.navy;
  const racketAcc = g.racket === PAL.white ? PAL.charcoal : PAL.white;
  const sockMark = l.trim !== PAL.white ? l.trim : l.shirt !== PAL.white ? l.shirt : PAL.navy;
  const out = {
    [0 /* Skin */]: col(l.skin),
    [35 /* SkinShade */]: col(l.skin).multiplyScalar(0.76),
    [1 /* Hair */]: col(l.hair),
    [2 /* Shirt */]: col(l.shirt),
    [3 /* Trim */]: col(l.trim),
    [4 /* Bottom */]: col(l.shorts),
    [5 /* Acc */]: col(l.accessory),
    [6 /* White */]: col(PAL.white),
    [7 /* ShoeAcc */]: col(shoeAcc),
    [8 /* Racket */]: col(g.racket),
    [9 /* Grip */]: col(g.grip),
    [10 /* RacketAcc */]: col(racketAcc),
    [11 /* String */]: col(PAL.offWhite),
    [12 /* AccMark */]: col(accMark),
    [13 /* Sock */]: col(PAL.white),
    [28 /* Tights */]: col(PAL.charcoal),
    [14 /* SockMark */]: col(sockMark),
    [15 /* Eye */]: new THREE5.Color(1318986),
    [16 /* Lip */]: col(l.skin).multiply(new THREE5.Color(0.86, 0.62, 0.6)),
    [17 /* Brow */]: col(l.hair).multiplyScalar(0.7),
    [18 /* Stubble */]: col(l.skin).lerp(col(l.hair), 0.3),
    [37 /* StubbleDark */]: col(l.skin).lerp(col(l.hair), 0.7),
    [36 /* Beard */]: col(l.hair),
    [38 /* Grey */]: greyOf(col(l.hair), 0.92),
    [39 /* GreyLo */]: col(l.hair).lerp(greyOf(col(l.hair), 0.85), 0.5),
    [40 /* GreyFuzz */]: col(l.skin).lerp(greyOf(col(l.hair), 0.92), 0.45),
    [29 /* Shaved */]: col(l.skin).lerp(col(l.hair), 0.5),
    [30 /* HairHi */]: col(l.hair).multiplyScalar(1.17).lerp(new THREE5.Color(1, 0.95, 0.88), 0.05),
    [31 /* HairLo */]: col(l.hair).multiplyScalar(0.8),
    [33 /* Pattern */]: col(l.trim)
  };
  const hex = (v) => new THREE5.Color(v);
  const rd = g.racketDesign;
  if (rd) {
    out[8 /* Racket */] = hex(rd.frame);
    out[19 /* Racket2 */] = hex(rd.frame2);
    out[10 /* RacketAcc */] = hex(rd.accent);
    out[20 /* RacketText */] = hex(rd.text);
    out[21 /* StringLogo */] = hex(rd.stencilColor);
  }
  if (g.wrap) {
    out[9 /* Grip */] = hex(g.wrap.color);
    out[22 /* Tape */] = hex(g.wrap.tape);
  }
  const sd = g.shoeDesign;
  if (sd) {
    out[23 /* Upper */] = hex(sd.upper);
    out[24 /* Sole */] = hex(sd.sole);
    out[25 /* Midsole */] = hex(sd.mid);
    out[7 /* ShoeAcc */] = hex(sd.accent);
    out[26 /* ShoeLogo */] = hex(sd.logoColor);
  }
  if (g.kit) {
    out[2 /* Shirt */] = hex(g.kit.shirt);
    out[3 /* Trim */] = hex(g.kit.trim);
    out[27 /* Logo */] = hex(g.kit.logoColor);
    out[33 /* Pattern */] = hex(g.kit.pattern2 ?? g.kit.trim);
  }
  {
    const sh = out[2 /* Shirt */];
    const lum = 0.3 * sh.r + 0.59 * sh.g + 0.11 * sh.b;
    out[34 /* Collar */] = sh.clone();
    out[32 /* Seam */] = lum < 0.12 ? sh.clone().lerp(new THREE5.Color(1, 1, 1), 0.12) : sh.clone().multiplyScalar(0.86);
  }
  const hsl = { h: 0, s: 0, l: 0 };
  for (const k in out) {
    const cc = out[k];
    cc.getHSL(hsl);
    if (hsl.s > 0.15 && +k !== 0 /* Skin */ && +k !== 16 /* Lip */) cc.setHSL(hsl.h, Math.min(1, hsl.s * 1.18), hsl.l * (hsl.l > 0.45 ? 0.94 : 1));
  }
  return out;
}
function pelvis(c) {
  const s = new Shape();
  const r = c.fem ? 13.4 : 12;
  s.add(ellipsoid([0, 2, 0], [r, 10.5, 9.4]), 4 /* Bottom */);
  s.add(ellipsoid([0, 9, 0], [r - 1.6, 6, 8.4]), 4 /* Bottom */, 3);
  const gl = c.b.glute;
  for (const sx of [-1, 1]) s.add(ellipsoid([sx * 5.4, 0.6, -4.4 - (gl - 1) * 4], c.fem ? [6.8, 7.6, 6.2 * gl] : [6.2, 7, 5.4 * gl]), 4 /* Bottom */, 3);
  if (c.skirt) s.add(skirt(10.8, c.lo), 4 /* Bottom */, 0.6);
  return {
    shape: s,
    h: 0.5,
    lo: 1.5,
    key: `pelvis:${c.fem}:${c.skirt}:${c.dress}:${c.pattern ?? ""}:${gl}`,
    wide: [c.w, 1],
    paint: (x, y, z, m) => {
      if (!c.skirt) {
        return m === 4 /* Bottom */ && Math.abs(x) > 11.6 && z > -3 && z < 3.2 ? 3 /* Trim */ : m;
      }
      if (c.dress && m === 4 /* Bottom */) {
        if (y < -6.4) return 3 /* Trim */;
        return c.pattern && kitPrint(c.pattern, x, y + 12, z, 30) ? 33 /* Pattern */ : 2 /* Shirt */;
      }
      const hem = y < -7.4 || y > -5.6 && y < -4.4;
      const th = Math.atan2(x, z);
      return hem || th > 0.98 && th < 1.33 && y < 9 ? 3 /* Trim */ : m;
    }
  };
}
function skirt(waist, soft) {
  const top = 12;
  const bottom = -7.5;
  return custom([0, 1, 0], 26, (x, y, z) => {
    const t = Math.min(1, Math.max(0, (top - y) / (top - bottom)));
    const a = Math.atan2(z, x);
    const u = a * 18 / (2 * Math.PI);
    const f = u - Math.floor(u);
    const g = soft ? 0.5 - 0.5 * Math.cos(f * 2 * Math.PI) : f < 0.8 ? f / 0.8 : (1 - f) / 0.2;
    const pleat = 1 + (0.01 + 0.07 * t) * (g - 0.5);
    const rx = (waist + 8.5 * Math.pow(t, 0.85)) * pleat;
    const rz = (8.4 + 6.8 * Math.pow(t, 0.85)) * pleat;
    const e = (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
    const shell = soft ? e : Math.abs(e + 0.7) - 0.7;
    return roundMax(Math.max(shell, y - top), bottom - y, 0.3);
  });
}
function torso(c) {
  const s = new Shape();
  const top = c.f.neck - TORSO;
  if (c.fem) {
    const { waist, chest, belly } = c.b;
    s.add(ellipsoid([0, 2.5, 0], [8.5 * waist, 7.5, 6.5 * waist]), 2 /* Shirt */);
    s.add(ellipsoid([0, 16.2, 0.1], [10.2 * Math.sqrt(chest), 10.4, 7.3 * Math.sqrt(chest)]), 2 /* Shirt */, 6);
    if (belly) s.add(ellipsoid([0, 5, 2.6], [8.8, 8, 7.6]), 2 /* Shirt */, 5);
    s.add(capsule([-8.8, top - 6.2, -0.6], [8.8, top - 6.2, -0.6], 3.8), 2 /* Shirt */, 5);
    for (const sx of [-1, 1]) s.add(capsule([sx * 3, top - 1.4, -0.8], [sx * 9.6, top - 5.4, -0.6], 2.6, 3.2), 2 /* Shirt */, 3);
    for (const sx of [-1, 1]) s.add(sphere([sx * 4.4, 19.2, 4.8], 5.1 * Math.sqrt(chest)), 2 /* Shirt */, 3);
    s.add(capsule([0, top - 6, -0.8], [0, top + 1, -0.6], 4.2, 3.7), 0 /* Skin */, 4);
  } else {
    const { waist, chest, belly } = c.b;
    s.add(ellipsoid([0, 3.5, 0], [10.4 * waist, 9, 7.6 * waist]), 2 /* Shirt */);
    s.add(roundBox([0, 15, 0.2], [12.8 * Math.sqrt(chest), 12, 9 * chest], 4.5), 2 /* Shirt */, 5);
    for (const sx of [-1, 1]) s.add(ellipsoid([sx * 5.4, 19.4, 6.4 * chest], [5.8, 4.4, 3.4 * chest]), 2 /* Shirt */, 3);
    if (belly) s.add(ellipsoid([0, 4.5, 3.4], [10.6, 8.8, 8.8]), 2 /* Shirt */, 5);
    const sh = c.f.shoulder - 3.6;
    s.add(capsule([-sh, top - 7.4, -0.6], [sh, top - 7.4, -0.6], 5.6), 2 /* Shirt */, 5);
    for (const sx of [-1, 1]) s.add(capsule([sx * 4.2, top - 1.4, -0.8], [sx * sh, top - 5.4, -0.6], 3.8, 4.6), 2 /* Shirt */, 4);
    s.add(capsule([0, top - 6, -0.8], [0, top + 1, -0.6], 4.8, 4.4), 0 /* Skin */, 3);
    if (!c.skirt) s.add(roundBox([0, -0.4, -0.2 + 1.6 * c.b.belly], [13 * Math.max(0.94, c.b.waist), 7.2, 8.6 * Math.max(0.94, c.b.waist)], 4), 2 /* Shirt */, 5);
  }
  if (c.skirt) s.add(torus([0, 0.4, 0], (c.fem ? 8.1 : 10.1) * c.b.waist, 1.7, void 0, c.fem ? 0.8 : 0.78), 3 /* Trim */, 0.8);
  const ops = s.near([0, 12, 0], 80);
  const cloth = (x, y, z) => s.eval(x, y, z, ops);
  if (c.cut === "polo") s.add(collar(cloth, top, true), 34 /* Collar */, 0);
  const cut = c.cut === "dress" ? "muscle" : c.cut === "racerdress" ? "racerback" : c.cut;
  const logo = c.g.kit?.logo;
  const pattern = c.pattern;
  const waistband = c.skirt && !c.dress;
  return {
    shape: s,
    h: 0.6,
    key: `torso:${c.fem}:${c.cut}:${logo ?? ""}:${pattern ?? ""}:${c.dress}:${c.l.build ?? ""}`,
    wide: [c.w, 1],
    paint: (x, y, z, m) => {
      if (m === 3 /* Trim */ && !c.dress) return m;
      const ax = Math.abs(x);
      if (m === 34 /* Collar */) {
        if (cut === "polo" && (y > top + 0.4 || z > 3 && y < top - 4.6 && ax > 1.6)) return 3 /* Trim */;
        if (z > 3 && ax < 1.2 && y < top - 2) return Math.round((y - top) / 2.4) % 2 === 0 && cut !== "zip" ? 6 /* White */ : cut === "zip" ? 3 /* Trim */ : 34 /* Collar */;
        return 34 /* Collar */;
      }
      if (waistband && y > -1.5 && y < 2.6) return 3 /* Trim */;
      if (c.dress && y > 0.2 && y < 1.6) return 3 /* Trim */;
      if (cut === "tank") {
        const strap = c.fem ? 7.4 : 8.6;
        if (y > top - 12 && ax > strap + 3) return 0 /* Skin */;
        const scoop = z > 0 ? top - 8.5 : top - 4;
        if (ax < strap && y > scoop) return 0 /* Skin */;
        if (y > top - 12 && ax > strap) return 3 /* Trim */;
      } else if (cut === "muscle") {
        const hole = c.fem ? 9.4 : 11.4;
        const neckY = top - 3.4 - (z > 0 ? 2.4 * Math.max(0, 1 - (ax / 6.4) ** 2) : 0);
        if (ax < 7.5 && y > neckY + 1.2) return 0 /* Skin */;
        if (ax < 7.5 && y > neckY) return 3 /* Trim */;
        if (y > top - 14 && ax > hole + 1.2) return 0 /* Skin */;
        if (y > top - 14 && ax > hole) return 3 /* Trim */;
      } else if (cut === "racerback") {
        const strap = c.fem ? 6.6 : 7.8;
        const scoop = z > 0 ? top - 9 : top - 3;
        if (z > 0) {
          if (y > top - 12 && ax > strap + 2.6) return 0 /* Skin */;
          if (ax < strap && y > scoop) return 0 /* Skin */;
          if (y > top - 12 && ax > strap + 1.2) return 3 /* Trim */;
        } else {
          const half = 1.8 + Math.max(0, top - 2 - y) * 0.62;
          if (y > top - 15 && ax > half + 1.1) return 0 /* Skin */;
          if (y > top - 15 && ax > half) return 3 /* Trim */;
          if (y > top - 1.5) return 0 /* Skin */;
        }
      } else if (cut === "vneck") {
        const v = z > 0 ? (y - (top - 11)) * 0.62 : -1;
        const back = z <= 0 && ax < 7.5 && y > top - 3.4;
        if (z > 0 && ax < v || back) return 0 /* Skin */;
        if (z > 0 && ax < v + 1.3 && y > top - 12 || z <= 0 && ax < 7.5 && y > top - 4.6) return 3 /* Trim */;
      } else {
        const neckY = top - 3.4 - (z > 0 ? 2.4 * Math.max(0, 1 - (ax / 6.4) ** 2) : 0);
        if (ax < 7.5 && y > neckY + 1.2) return 0 /* Skin */;
        if (ax < 7.5 && y > neckY) return 3 /* Trim */;
        if (cut === "polo" && z > 3 && y > top - 10 && ax < 0.8 + (y - top + 10) * 0.3) return 3 /* Trim */;
        if (cut === "henley" && z > 3 && y > top - 13 && ax < 1.4) return ax < 0.7 && Math.abs((y - top) % 3.2 + 1.6) < 0.6 ? 6 /* White */ : 32 /* Seam */;
        if (cut === "zip" && z > 3 && y > top - 17 && ax < 0.9) return 3 /* Trim */;
        if (cut === "raglan" && y > top - 13 && Math.abs(ax - (7.2 + (top - y) * 0.42)) < 1) return 3 /* Trim */;
      }
      const th = Math.abs(Math.atan2(x, z));
      if (!pattern && th > 1.15 && th < 1.65 && y < top - 8.5) return 3 /* Trim */;
      if (logo && m === 2 /* Shirt */ && z > 2 && chestLogo(logo, x - 5.2, y - (top - 12))) return 27 /* Logo */;
      if (m === 2 /* Shirt */) {
        if (pattern && kitPrint(pattern, x, y, z, top)) return 33 /* Pattern */;
        if (y > top - 6 && ax > 7.5 && Math.abs(z + 0.6) < 0.5) return 32 /* Seam */;
        if (Math.abs(th - 1.62) < 0.05 && y < top - 9) return 32 /* Seam */;
        if (!c.skirt && Math.abs(y + 5.6) < 0.5) return 32 /* Seam */;
      }
      return m;
    }
  };
}
function chestLogo(kind, x, y) {
  const near = (ax, ay, bx, by, w) => seg2(x, y, ax, ay, bx, by) < w;
  switch (kind) {
    case "swoosh":
      return near(-3, 1.4, -1, -1.4, 0.9) || near(-1, -1.4, 4, 1.8, 0.9);
    case "stripes":
      return near(-2.6, -2, -2.6, 0, 0.75) || near(0, -2, 0, 1.4, 0.75) || near(2.6, -2, 2.6, 2.8, 0.75);
    case "laurel":
      return Math.abs(Math.hypot(x, y) - 2.6) < 0.9 && y < 1.6;
    case "ua":
      return near(-3, 2, -3, -1, 0.8) || near(-3, -1, 3, -1, 0.8) || near(3, 2, 3, -1, 0.8);
    case "fila":
      return Math.abs(x) < 2.6 && Math.abs(y) < 2.2;
    case "croc":
      return Math.abs(x) < 2.8 && Math.abs(y) < 0.9 || near(2.4, 0.2, 4.2, 0.8, 0.6);
    case "w":
      return near(-3.2, 2, -1.6, -2, 0.7) || near(-1.6, -2, 0, 1, 0.7) || near(0, 1, 1.6, -2, 0.7) || near(1.6, -2, 3.2, 2, 0.7);
    default:
      return false;
  }
}
function kitPrint(kind, x, y, z, top = 30) {
  const fr = (v) => v - Math.floor(v);
  const u = Math.atan2(x, z) * 10;
  switch (kind) {
    case "stripes":
      return fr(u / 4.4) < 0.36;
    case "pinstripe":
      return fr(u / 3.2) < 0.2;
    case "hoops":
      return fr(y / 6.5) < 0.38;
    case "chevron":
      return fr((y + Math.abs(x) * 0.75) / 7) < 0.3;
    case "dots": {
      const row = Math.floor(y / 4.2);
      const cu = u / 4.2 + row % 2 * 0.5;
      return Math.hypot(fr(cu) - 0.5, fr(y / 4.2) - 0.5) < 0.24;
    }
    case "fade":
      return dither(x, y, z) < (top - 10 - y) / 26;
    case "block":
      return y > top - 15 && y < top - 8;
    case "print":
      return Math.abs(Math.sin(u * 0.55 + Math.sin(y * 0.3) * 1.6) + Math.sin(y * 0.42 - u * 0.2)) < 0.22;
    default:
      return false;
  }
}
function collar(cloth, top, flaps) {
  return custom([0, top - 3, 2], 14, (x, y, z) => {
    const shell = cloth(x, y, z) - 1;
    const ax = Math.abs(x);
    const band = Math.max(Math.abs(y - (top - 0.6)) - 1.3, Math.hypot(x / 7.4, (z + 0.6) / 6.4) - 1);
    let flap = 1;
    if (flaps && z > 2) {
      const py = top - y;
      flap = Math.max(1.2 + py * 0.5 - ax, ax - (6.6 - py * 0.4), py - 6, -py - 0.2);
    }
    const placket = z > 2 ? Math.max(ax - 1.2, y - top + 1, top - (flaps ? 9.5 : 12) - y) : 1;
    return Math.max(shell, Math.min(band, flap, placket));
  });
}
function upperArm(c) {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  s.add(capsule([0, 0, 0], [0, -25, 0], 3.5 * k, 2.85 * k), 0 /* Skin */);
  s.add(ellipsoid([0, -2.4, 0], [3.9 * k, 5, 3.8 * k]), 0 /* Skin */, 3);
  s.add(ellipsoid([0, -11.5, 0.5], [3.2 * k, 6.5, 3.2 * k]), 0 /* Skin */, 2.5);
  s.add(ellipsoid([0, -12.8, 1.5], [3.1 * k, 5.6, 2.9 * k]), 0 /* Skin */, 2);
  s.add(ellipsoid([0, -9.5, -1.3], [3.2 * k, 7, 3 * k]), 0 /* Skin */, 2.5);
  if (longSleeved(c.cut)) s.add(capsule([0, 1, 0], [0, -24.5, 0], 5.6 * k, 4.3 * k), 2 /* Shirt */, 1);
  else if (!sleeveless(c.cut)) {
    s.add(ellipsoid([0, -1.8, 0], [5 * k, 6.8, 4.8 * k]), 2 /* Shirt */, 1);
    s.add(capsule([0, -2, 0], [0, -10.2, 0.3], 4.5 * k, 4.2 * k), 2 /* Shirt */, 1.5);
  }
  const hem = longSleeved(c.cut) ? -99 : -8.6;
  const raglan = c.cut === "raglan";
  return {
    shape: s,
    h: 0.55,
    key: `uArm:${k}:${c.cut}:${c.pattern ?? ""}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, y, z, m) => {
      if (m === 0 /* Skin */) {
        const th = Math.abs(Math.atan2(x, z));
        if (crease(c, Math.abs(y + 8 + 1.2 * Math.cos(th)), 0.55) && th > 0.9) return 35 /* SkinShade */;
        if (y < -10 && y > -21 && crease(c, Math.abs(th - Math.PI / 2), 0.16)) return 35 /* SkinShade */;
        return m;
      }
      if (m !== 2 /* Shirt */) return m;
      if (raglan || y < hem) return 3 /* Trim */;
      if (c.pattern && c.pattern !== "block" && c.pattern !== "fade" && kitPrint(c.pattern, x, y + 20, z)) return 33 /* Pattern */;
      return Math.abs(y - hem - 1.2) < 0.5 ? 32 /* Seam */ : m;
    }
  };
}
function forearm(c, side, holding) {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  s.add(capsule([0, 0, 0], [0, -19, 0.3], 2.9 * k, 2.2 * k), 0 /* Skin */);
  s.add(ellipsoid([0, -5, 0.4], [3.2 * k, 6.2, 3 * k]), 0 /* Skin */, 3);
  if (longSleeved(c.cut)) s.add(capsule([0, 0.5, 0], [0, -12, 0.2], 4.4 * k, 3.6 * k), 2 /* Shirt */, 1);
  s.add(capsule([0, -13.8, 0.3], [0, -18.4, 0.3], 3.7 * k), 5 /* Acc */, 0.5);
  if (holding) {
    s.add(roundBox([0, -23.5, 1.2], [2.3, 3.4, 3.2], 1.8), 0 /* Skin */, 1.2);
    s.add(capsule([side * 1.6, -21, 2.4], [side * 0.6, -23.4, 4.4], 1.2, 1), 0 /* Skin */, 0.8);
  } else {
    const inn = -side;
    s.add(roundBox([0, -22.2, 0.6], [1.3, 2.9, 3.3], 1.2), 0 /* Skin */, 1.2);
    const fingers = [[2.3, 4.4], [0.8, 4.9], [-0.7, 4.6], [-2.1, 3.8]];
    for (const [zf, len] of fingers) {
      const a = [inn * 0.1, -24.4, zf + 0.6];
      const b = [inn * 0.6, -24.4 - len * 0.6, zf + 0.5];
      const e = [inn * 1.5, -24.4 - len * 0.95, zf + 0.4];
      s.add(capsule(a, b, 0.78, 0.7), 0 /* Skin */, 0.5);
      s.add(capsule(b, e, 0.7, 0.6), 0 /* Skin */, 0.4);
    }
    s.add(capsule([inn * 0.6, -21, 3.2], [inn * 1.2, -23.6, 4.6], 1, 0.85), 0 /* Skin */, 0.9);
    s.add(capsule([inn * 1.2, -23.6, 4.6], [inn * 1.6, -25.4, 4.5], 0.85, 0.7), 0 /* Skin */, 0.4);
  }
  return {
    shape: s,
    h: 0.4,
    key: `fArm:${side}:${holding}:${k}:${longSleeved(c.cut)}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, y, z, m) => {
      if (m === 0 /* Skin */ && y < -1.5 && y > -11 && crease(c, Math.abs(Math.atan2(x * side, z) - 1.15), 0.2)) return 35 /* SkinShade */;
      if (m === 2 /* Shirt */ && y < -10.6) return 3 /* Trim */;
      if (m === 5 /* Acc */ && z > 2.6 && Math.abs(x) < 1.5 && y < -14.9 && y > -17.4) return 12 /* AccMark */;
      return m;
    }
  };
}
var RACKET_HEAD = 38;
function racket(c) {
  const d = c.g.racketDesign;
  const tape = !!c.g.wrap;
  const s = new Shape();
  s.add(capsule([0, 0, -2.6], [0, 0, 17], 1.45, 1.35), 9 /* Grip */);
  s.add(ellipsoid([0, 0, -3.2], [1.9, 1.9, 1.1]), 10 /* RacketAcc */, 0.5);
  s.add(capsule([0, 0, 16], [0, 0, 18.5], 1.5, 1.3), 8 /* Racket */, 0.6);
  for (const sy of [-1, 1]) s.add(capsule([0, 0, 18], [0, sy * 5.6, 26.5], 1.05, 0.95), 8 /* Racket */, 1.2);
  const iso = d?.head === "iso";
  const ry = iso ? 11.4 : 12;
  const rz = iso ? 15 : 15.6;
  const p = iso ? 2.7 : 2;
  const ring = (y, z) => ((Math.abs(y / ry) ** p + Math.abs((z - RACKET_HEAD) / rz) ** p) ** (1 / p) - 1) * Math.min(ry, rz);
  s.add(
    custom([0, 0, RACKET_HEAD], rz + 2, (x, y, z) => Math.hypot(ring(y, z), x * 1.2) - 1.7),
    8 /* Racket */,
    1
  );
  s.add(
    custom([0, 0, RACKET_HEAD], rz, (x, y, z) => Math.max(ring(y, z) + 0.8, Math.abs(x) - 1.1)),
    11 /* String */
  );
  return {
    shape: s,
    h: 0.4,
    key: `racket:${d ? `${d.pattern}:${d.stencil}:${iso}` : ""}:${tape}`,
    paint: (x, y, z, m) => {
      if (m === 9 /* Grip */) return tape && z > 14.6 ? 22 /* Tape */ : m;
      if (m === 11 /* String */) return d && stencil(d.stencil, y, z - RACKET_HEAD) ? 21 /* StringLogo */ : m;
      if (m !== 8 /* Racket */) return m;
      if (!d) {
        const tip = z > RACKET_HEAD + rz - 3.2;
        const shoulders = Math.abs(y) > ry - 2.5 && z > RACKET_HEAD - 7 && z < RACKET_HEAD - 1;
        return tip || shoulders ? 10 /* RacketAcc */ : m;
      }
      const inHead = z > RACKET_HEAD - rz + 1.2;
      const t = inHead ? Math.abs(Math.atan2(y / ry, (z - RACKET_HEAD) / rz)) / Math.PI : 1.2;
      if (!inHead && z > 15.5 && z < 19) return 10 /* RacketAcc */;
      if (inHead && t > 0.47 && t < 0.53) return 10 /* RacketAcc */;
      const side = Math.abs(x) > 0.9;
      if (inHead && side && t > 0.28 && t < 0.42 && Math.floor((z + 100) / 2) % 3 !== 0) return 20 /* RacketText */;
      const checker = (Math.floor((y + 100) / 2) + Math.floor((z + 100) / 2)) % 2 === 0;
      switch (d.pattern) {
        case "split":
          return t > 0.5 ? 19 /* Racket2 */ : m;
        case "throat":
          return !inHead || t > 0.85 ? 19 /* Racket2 */ : m;
        case "fade":
          return t < 0.16 || t < 0.3 && checker ? 19 /* Racket2 */ : m;
        default:
          return m;
      }
    },
    extra: () => strings(ry - 0.9, rz - 0.9)
  };
}
var STENCILS = {
  W: ["1...1", "1...1", "1.1.1", "11.11", "1...1"],
  B: ["1111.", "1...1", "1111.", "1...1", "1111."],
  Y: ["1...1", ".1.1.", "..1..", "..1..", "..1.."],
  H: ["1...1", "1...1", "11111", "1...1", "1...1"]
};
function stencil(kind, y, z) {
  const cell = 2;
  const col = Math.floor(y / cell + 2.5);
  const row = Math.floor(-z / cell + 2.5);
  if (col < 0 || col > 4 || row < 0 || row > 4) return false;
  return STENCILS[kind][row][col] === "1";
}
function strings(ry, rz) {
  const parts = [];
  const t = 0.22;
  for (let y = -ry + 1.4; y < ry - 0.5; y += 1.55) {
    const half = rz * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
    const g = new THREE5.BoxGeometry(t, t, half * 2);
    g.translate(0, y, RACKET_HEAD);
    parts.push(g);
  }
  for (let z = -rz + 1.5; z < rz - 0.5; z += 1.55) {
    const half = ry * Math.sqrt(Math.max(0, 1 - (z / rz) ** 2));
    const g = new THREE5.BoxGeometry(t, half * 2, t);
    g.translate(0.05, 0, RACKET_HEAD + z);
    parts.push(g);
  }
  const pos = [];
  const nor = [];
  const idx = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const gi = g.index;
    for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
    g.dispose();
  }
  const out = new THREE5.BufferGeometry();
  out.setAttribute("position", new THREE5.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE5.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
function thigh(c, side) {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  s.add(capsule([0, 2, 0], [0, -HIP + KNEE, 0.4], 7.4 * k, 4.6 * k), 0 /* Skin */);
  s.add(ellipsoid([0, -13, 2.2], [6.6 * k, 13, 5.4 * k]), 0 /* Skin */, 4);
  s.add(ellipsoid([-side * 2.6, -27, 2.2], [3.4 * k, 5, 3.2 * k]), 0 /* Skin */, 2.5);
  s.add(ellipsoid([0, -15, -2], [6 * k, 13, 5 * k]), 0 /* Skin */, 4);
  if (c.bottom === "tights") s.add(capsule([0, 2, 0], [0, -HIP + KNEE, 0.4], 7.4 * k + 0.5, 4.6 * k + 0.5), 28 /* Tights */, 0.4);
  if (c.bottom === "long") s.add(capsule([0, 4, 0], [0, -HIP + KNEE + 3, 0.3], 7.4 * k + 1.3, 5 * k + 1.7), 4 /* Bottom */, 0.6);
  else if (!c.skirt) s.add(capsule([0, 4, 0], [0, -10.5, 0.2], 7.4 * k + 1.3, 6.3 * k + 1.7), 4 /* Bottom */, 0.6);
  return {
    shape: s,
    h: 0.6,
    key: `thigh:${side}:${k}:${c.bottom}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, _y, _z, m) => {
      if (m === 0 /* Skin */) {
        const th = Math.atan2(x * side, _z);
        if (_y < -4 && _y > -31 && crease(c, Math.abs(th - 1.75), 0.15)) return 35 /* SkinShade */;
        if (_z > 1 && crease(c, Math.abs(_y + 31.6 - 0.1 * x * x), 0.6)) return 35 /* SkinShade */;
        return m;
      }
      if (m !== 4 /* Bottom */) return m;
      if (x * side > 6.6 * k && Math.abs(_z) < 2.6 * k) return 3 /* Trim */;
      return m;
    }
  };
}
function shin(c, side) {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  const f = -KNEE;
  s.add(capsule([0, 0, 0.4], [0, f + 9, 0], 4.6 * k, 2.7 * k), 0 /* Skin */);
  s.add(ellipsoid([0, -1.4, 2.2], [3.1 * k, 3.2, 2.4 * k]), 0 /* Skin */, 2.5);
  s.add(ellipsoid([0.4 * side, -11, -1.8], [5.2 * k, 10.8, 5.2 * k]), 0 /* Skin */, 3);
  if (c.bottom === "tights") s.add(capsule([0, 2, 0.4], [0, -13, -0.8], 4.9 * k + 0.5, 5.4 * k + 0.4), 28 /* Tights */, 0.4);
  const sockTop = c.socks === "ankle" ? 11.5 : c.socks === "high" ? 31 : 23.6;
  const sockR = c.socks === "high" ? 4.6 * k : 3.75 * k;
  s.add(capsule([0, f + sockTop, -0.1], [0, f + 8, 0.2], sockR, 3.4 * k), 13 /* Sock */, 0.4);
  s.add(capsule([0, f + sockTop - 1.2, -0.1], [0, f + sockTop + 1, -0.1], sockR + 0.25 * k), 13 /* Sock */, 0.3);
  s.add(
    custom([0, f + 1.8, 3.6], 15, (x, y, z) => {
      const t = Math.max(-1, Math.min(1, (z - 4.5) / 15));
      const rx = 6.6 + 0.6 * t;
      const e = (Math.hypot(x / rx, (z - 4.5) / 15.6) - 1) * rx;
      return roundMax(e, Math.abs(y - f - 2.1) - 2.1, 1.1);
    }),
    6 /* White */
  );
  s.add(ellipsoid([0, f + 5.8, 10.4], [6.3, 3.8, 7.4]), 6 /* White */, 2.4);
  s.add(ellipsoid([0, f + 7.6, 3.8], [6.1, 5.2, 7.2]), 6 /* White */, 2.2);
  s.add(ellipsoid([0, f + 7.6, -4.6], [5.9, 6, 5.6]), 6 /* White */, 2);
  s.add(torus([0, f + 10.2, -1.4], 3.7, 1.35, [0.25, 0, 0]), 6 /* White */, 1.2);
  s.add(ellipsoid([0, f + 10.2, 3.4], [2.6, 2.2, 2.6]), 6 /* White */, 1.4);
  const sd = c.g.shoeDesign;
  const check = (z, v) => Math.min(seg2(z, v, -1.4, 8.4, 3.2, 4.4), seg2(z, v, 3.2, 4.4, 10.4, 8)) - 1.2;
  return {
    shape: s,
    h: 0.5,
    key: `shin:${side}:${k}:${c.bottom}:${c.socks}:${sd?.logo ?? ""}:${defKey(c)}`,
    paint: (x, y, z, m) => {
      if (m === 0 /* Skin */) {
        const th = Math.atan2(x * side, z);
        if (y < -3 && y > -20 && (crease(c, Math.abs(th + 2.35), 0.17) || crease(c, Math.abs(th - 2.25), 0.14))) return 35 /* SkinShade */;
        if (y < -6 && y > -28 && crease(c, Math.abs(th + 0.3), 0.1, 0.8)) return 35 /* SkinShade */;
        return m;
      }
      if (m === 13 /* Sock */ && x * side > 1.2 && z > 0.6 && y > f + sockTop - 6 && y < f + sockTop - 3.2) return 14 /* SockMark */;
      if (m !== 6 /* White */) return m;
      const v = y - f;
      if (sd) {
        if (v < 1.6) return 24 /* Sole */;
        if (v < 3.4) return 25 /* Midsole */;
        if (Math.abs(x) > 3.4 && shoeLogo(sd.logo, z, v)) return 26 /* ShoeLogo */;
        if (z < -6.4 && v > 5.6 && v < 10.5) return 7 /* ShoeAcc */;
        return 23 /* Upper */;
      }
      if (v < 2) return 7 /* ShoeAcc */;
      if (Math.abs(x) > 3.4 && v < 10 && check(z, v) < 0) return 7 /* ShoeAcc */;
      if (z < -6.4 && v > 5.6 && v < 10.5) return 7 /* ShoeAcc */;
      return m;
    }
  };
}
function shoeLogo(kind, z, v) {
  const near = (ax, ay, bx, by, w) => seg2(z, v, ax, ay, bx, by) < w;
  switch (kind) {
    case "swoosh":
      return Math.min(seg2(z, v, -5, 9.4, 1.6, 4.4), seg2(z, v, 1.6, 4.4, 12, 8.6)) < 1.1;
    case "stripes":
      return [0, 1, 2].some((k) => near(0.6 + k * 4, 3.6, -3 + k * 4, 10.4, 0.75));
    case "asics":
      return near(-6, 4.6, 8, 10, 0.8) || near(-4, 9.6, 7, 4, 0.8) || near(-2.4, 10.4, 9.4, 5.6, 0.7);
    case "nb":
      return near(-1.5, 4.2, -1.5, 10, 0.95) || near(-1.5, 10, 4.5, 4.2, 0.95) || near(4.5, 4.2, 4.5, 10, 0.95);
    default:
      return false;
  }
}
function seg2(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}
var SKULL_C = [0, 22, 0];
var SKULL_R = [10.8, 13.2, 11.8];
var CHEEKS = superEllipsoid([0, 17.4, 2.6], [9.4, 8.8, 9.6], 4);
function head(c) {
  const s = new Shape();
  const neck = c.fem ? 4 : 4.8;
  s.add(capsule([0, -6, -0.8], [0, 8, 0], neck + 0.2, neck), 0 /* Skin */);
  s.add(ellipsoid(SKULL_C, SKULL_R), 0 /* Skin */, 3);
  s.add(roundBox([0, 17.8, 2.6], [9.6, 8.6, 9.8], 3.4), 0 /* Skin */, 3);
  s.add(roundBox([0, 11.6, 3.2], [c.fem ? 6.2 : 6.6, 2.8, 9.2], 2.4), 0 /* Skin */, 2);
  for (const sx of [-1, 1]) {
    s.add(ellipsoid([sx * 10.4, 17, -1.6], [1.4, 2.8, 2.1]), 0 /* Skin */, 1);
  }
  const fh = c.l.facialHair ?? "none";
  const full = fh === "boxed" || fh === "beard" || fh === "longbeard";
  if (full) s.add(beard(fh), 36 /* Beard */, 1.5);
  return { shape: s, h: 0.4, face: true, scale: c.f.head, key: `head:${c.fem}:${full ? fh : ""}` };
}
function beard(style) {
  const jaw = ellipsoid([0, 13.4, 2.4], [11, 11.4, 11.4]);
  const thick = style === "boxed" ? 0.55 : 1.1;
  const top = style === "boxed" ? 14.4 : 15;
  const fall = ellipsoid([0, 6.2, 8.4], [6.2, 6.4, 4.4]);
  return custom([0, 10, 3], 16, (x, y, z) => {
    let d = jaw.d(x, y, z) - thick;
    if (style === "longbeard") d = smin(d, fall.d(x, y, z), 2.5);
    const lips = Math.hypot(x / 3.6, (y - 11) / 1.6) - 1;
    return Math.max(d, y - top + Math.max(0, 3.5 - Math.abs(x)) * 0.25, -z - 1, -lips * 1.5);
  });
}
function headHang(x, y, z) {
  return smin(skullHang(x, y, z), CHEEKS.d(x, y, z), 4.5);
}
function skullHang(x, y, z) {
  if (y >= SKULL_C[1]) {
    const px = x / SKULL_R[0];
    const py = (y - SKULL_C[1]) / SKULL_R[1];
    const pz = z / SKULL_R[2];
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / SKULL_R[0], py / SKULL_R[1], pz / SKULL_R[2]);
    return k0 * (k0 - 1) / k1;
  }
  return (Math.hypot(x / SKULL_R[0], z / SKULL_R[2]) - 1) * Math.min(SKULL_R[0], SKULL_R[2]);
}
var SKULL = ellipsoid(SKULL_C, SKULL_R);
var NECK = capsule([0, -6, -0.8], [0, 8, 0], 4.1, 3.9);
function headFit(x, y, z) {
  return smin(smin(SKULL.d(x, y, z), CHEEKS.d(x, y, z), 4.5), NECK.d(x, y, z), 6);
}
var HC = [0, 21, -0.5];
var outward = (p) => {
  const d = [p[0] - HC[0], (p[1] - HC[1]) * 0.6, p[2] - HC[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};
function onHead(th, el, off) {
  const dir = [Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)];
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (headHang(HC[0] + dir[0] * m, HC[1] + dir[1] * m, HC[2] + dir[2] * m) < 0) lo = m;
    else hi = m;
  }
  const r = lo + off;
  return [HC[0] + dir[0] * r, HC[1] + dir[1] * r, HC[2] + dir[2] * r];
}
function spline(pts, n = 3) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push(
        p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3))
      );
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function lock(ctrl) {
  const pts = spline(ctrl, 4);
  return ribbon(
    pts.map(([th, el, off]) => onHead(th, el, off)),
    pts.map((p) => p[3]),
    // Chunky, like sculpted toy hair.
    pts.map((p) => p[4] * 1.5),
    outward
  );
}
function hairCap(base, thick, o = {}) {
  const tie = o.tie;
  const g = o.grooves ?? 0.35;
  const crownK = o.crown ?? 0.6;
  return custom([0, 22, 0], 26, (x, y, z) => {
    const th = Math.atan2(x, z);
    let edge = base(th);
    if (edge < 16 && !o.blunt) edge -= Math.min(1, (16 - edge) / 6) * 2.6 * (0.5 + 0.5 * Math.cos(th * 9 + 0.7 * Math.sin(th * 4))) ** 3;
    const crown = Math.max(0, (y - 24) / 12);
    let phi;
    if (tie) {
      const ax = tie[0] - HC[0], ay = tie[1] - HC[1], az = tie[2] - HC[2];
      const al = Math.hypot(ax, ay, az);
      const vx = x - tie[0], vy = y - tie[1], vz = z - tie[2];
      const dot = (vx * ax + vy * ay + vz * az) / al;
      const qx = vx - ax / al * dot;
      const qy = vy - ay / al * dot;
      const qz = vz - az / al * dot;
      phi = Math.atan2(qx, qy * (az / al) - qz * (ay / al));
    } else phi = th;
    const groove = g * (0.5 + 0.5 * Math.cos(phi * 11)) + (o.fit ? 0.18 : 0.45) * (0.5 + 0.5 * Math.cos(phi * 25 + 1.3));
    const u = Math.min(1, Math.max(0, (y - edge) / 5));
    const fall = o.fit ? 0 : Math.min(1.8, Math.max(0, 21 - y) * 0.11) * Math.min(1, Math.max(0, 16 - edge) / 6);
    const t = thick * (1 + crown * crown * crownK) + fall - groove * u;
    const taper = 0.12 + 0.88 * u * u * (3 - 2 * u);
    return roundMax((o.fit ? headFit(x, y, z) : headHang(x, y, z)) - t * taper, (edge - y) * 0.7, 0.6);
  });
}
function hairline(front, ears, back) {
  return (th) => {
    const a = Math.abs(th);
    const ss = (e0, e1) => {
      const t = Math.min(1, Math.max(0, (a - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    return front + 1.2 * Math.min(1, a) ** 2 + (ears - front - 1.2) * ss(1, 1.45) + (back - ears) * ss(1.85, 2.5);
  };
}
var BANGS = [
  [[-0.5, 0.9, 0.7, 3.6, 1.3], [-0.15, 0.66, 1.2, 4.6, 1.5], [0.25, 0.44, 1.3, 4.2, 1.4], [0.55, 0.28, 1.1, 3, 1.1], [0.78, 0.12, 1, 1.4, 0.8], [0.88, 0.02, 0.9, 0.3, 0.4]],
  [[-0.35, 0.95, 0.9, 3.4, 1.2], [0, 0.76, 1.3, 4.2, 1.3], [0.4, 0.58, 1.4, 3.6, 1.2], [0.68, 0.4, 1.3, 2, 0.9], [0.82, 0.26, 1.1, 0.4, 0.45]],
  [[-0.6, 0.9, 0.7, 3, 1.2], [-0.75, 0.64, 1.1, 3.2, 1.3], [-0.85, 0.4, 1.1, 2.2, 1], [-0.9, 0.22, 0.9, 0.4, 0.45]],
  [[-0.2, 0.86, 0.9, 3.2, 1.2], [0, 0.56, 1.4, 3.4, 1.3], [0.1, 0.3, 1.2, 2, 1], [0.14, 0.14, 1, 0.4, 0.45]]
];
function sideLocks(sd) {
  const long = sd < 0 ? 1 : 0.9;
  return [
    [
      [sd * 1, 0.72, 0.6, 3.2, 1.2],
      [sd * 1.12, 0.42, 1.2, 3.8, 1.4],
      [sd * 1.2, 0.12, 1.6, 3.8, 1.4],
      [sd * 1.16, -0.18 * long, 1.6, 3.4, 1.3],
      [sd * 1.24, -0.46 * long, 2.2, 2.8, 1.1],
      [sd * 1.36, -0.66 * long, 3.2, 1.6, 0.8],
      [sd * 1.5, -0.74 * long, 4.4, 0.3, 0.4]
    ],
    [
      [sd * 1.3, 0.7, 0.6, 3, 1.1],
      [sd * 1.42, 0.36, 1.2, 3.4, 1.3],
      [sd * 1.5, 0.04, 1.8, 3, 1.2],
      [sd * 1.56, -0.26 * long, 2.4, 2.2, 1],
      [sd * 1.66, -0.44 * long, 3.4, 0.4, 0.45]
    ]
  ];
}
function ponytail(s, tie) {
  const [, ty, tz] = tie;
  const core = [
    [0, ty + 1.8, tz - 2.4, 4.4],
    [0, ty + 3.6, tz - 7.6, 5.8],
    [-1.6, ty + 1.6, tz - 13.4, 6.6],
    [2, ty - 2.8, tz - 16, 6.8],
    [-2.2, ty - 8, tz - 17, 6.6],
    [1.4, ty - 13, tz - 16.4, 6],
    [-0.8, ty - 17.6, tz - 15, 5],
    [1.2, ty - 21, tz - 13.4, 3.6]
  ];
  for (const [x, y, z, r] of core) s.add(sphere([x, y, z], r), 1 /* Hair */, 2.4);
  s.add(torus([0, ty + 0.4, tz - 0.6], 3.4, 1.5, [0.9, 0, 0]), 12 /* AccMark */, 0.3);
  for (let i = 0; i < 26; i++) {
    const [x, y, z, r] = core[1 + i % (core.length - 1)];
    const a = i * 2.39996;
    const el = Math.sin(i * 1.7) * 0.9;
    const d = r * 0.92;
    s.add(sphere([x + Math.cos(a) * Math.cos(el) * d, y + Math.sin(el) * d, z + Math.sin(a) * Math.cos(el) * d * 0.8], 2.1 + i % 3 * 0.5), 1 /* Hair */, 0.8);
  }
}
function sleekTail(s, tie) {
  const [, ty, tz] = tie;
  const pts = [
    [[0, ty + 0.8, tz - 2], 3.4],
    [[0, ty + 0.6, tz - 6.4], 3.9],
    [[0, ty - 2.6, tz - 10], 4],
    [[0, ty - 8, tz - 10.8], 3.6],
    [[0, ty - 15, tz - 10.4], 3],
    [[0, ty - 21, tz - 9.4], 2.2],
    [[0, ty - 25.6, tz - 8.4], 0.8]
  ];
  for (let i = 0; i + 1 < pts.length; i++) s.add(capsule(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]), 1 /* Hair */, 1.6);
  s.add(torus([0, ty + 0.4, tz - 0.6], 3.4, 1.5, [0.9, 0, 0]), 12 /* AccMark */, 0.3);
}
function plait(s, path, r) {
  const pts = spline(path, 6);
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const [x, y, z] = pts[i];
    const t = i / (n - 1);
    const side = i % 2 ? 1 : -1;
    const rr = r * (1 - 0.25 * t);
    s.add(ellipsoid([x + side * rr * 0.35, y, z], [rr, rr * 0.75, rr * 0.9]), 1 /* Hair */, 0.4);
  }
  const end = pts[n - 1];
  const prev = pts[n - 2];
  s.add(torus([prev[0], prev[1] - 0.6, prev[2]], r * 0.55, 0.9), 12 /* AccMark */, 0.2);
  s.add(capsule([prev[0], prev[1] - 1.2, prev[2]], [end[0], end[1] - 2.4, end[2]], r * 0.8, r * 0.3), 1 /* Hair */, 0.6);
}
function pigtail(s, sd) {
  const tie = [sd * 10.4, 25, -6];
  const pts = [
    [[sd * 11.4, 25.6, -6.6], 2.8],
    [[sd * 14.2, 25, -7.4], 3.4],
    [[sd * 16, 21, -7.6], 3.2],
    [[sd * 16.4, 15.4, -7], 2.6],
    [[sd * 15.4, 10.6, -6.2], 1.6],
    [[sd * 14.6, 8.2, -5.6], 0.6]
  ];
  for (let i = 0; i + 1 < pts.length; i++) s.add(capsule(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]), 1 /* Hair */, 1.4);
  s.add(torus(tie, 2.6, 1.2, [0, 0, sd * 1.4]), 12 /* AccMark */, 0.3);
}
var TIE = [0, 37.2, -6.4];
function tail(c) {
  const s = new Shape();
  const st = c.l.hairStyle;
  if (st === "ponytail") ponytail(s, TIE);
  else if (st === "sleek") sleekTail(s, TIE);
  else if (st === "braid") plait(s, [[0, 19.5, -13.6], [0, 13, -14.6], [0, 4, -14.4], [0, -6, -13.6], [0, -12, -13]], 3);
  else if (st === "twinbraids")
    for (const sd of [-1, 1]) plait(s, [[sd * 9.6, 17, -7.5], [sd * 11, 10, -6.6], [sd * 11.6, 4, -5.6], [sd * 12, -1.5, -4.6]], 2.4);
  else if (st === "pigtails") for (const sd of [-1, 1]) pigtail(s, sd);
  const paint = (x, y, z, m) => m === 1 /* Hair */ ? strands(x, y, z, 0, -15, 18) : m;
  return { shape: s, h: 0.6, lo: 1.3, scale: c.f.head, key: `tail:${c.l.hairStyle}`, paint };
}
function hair(c) {
  const s = new Shape();
  const l = c.l;
  const style = l.hairStyle;
  const wear = l.headwear ?? "none";
  const cap = wear === "cap";
  const locks = (ls, k = 0.8) => {
    for (const p of ls) s.add(lock(p), 1 /* Hair */, k);
  };
  const spike = (th, el, len, r, tilt2) => {
    const a = onHead(th, el, -0.4);
    const b = onHead(th, el + tilt2, len);
    s.add(capsule(a, b, r, 0.25), 1 /* Hair */, 1.6);
  };
  let over = 2;
  switch (style) {
    case "ponytail": {
      s.add(hairCap(hairline(27, 21.5, 9), 1.6, { tie: TIE, grooves: 0.22, crown: 0.15, fit: true }), 1 /* Hair */);
      locks(BANGS);
      for (const sd of [-1, 1]) locks(sideLocks(sd).map((l2) => l2.map(([th, el, off, w, t]) => [th, el, off, w * 0.9, t * 1.15])));
      over = 2.1;
      break;
    }
    case "bun": {
      const top = [0, 35.6, -5.2];
      s.add(hairCap(hairline(27, 21.5, 9), 1.5, { tie: top, grooves: 0.4, fit: true }), 1 /* Hair */);
      locks(BANGS.slice(0, 2));
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 5)]);
      if (!cap) {
        s.add(ellipsoid([0, 39.2, -7.2], [5.6, 4.8, 5.6]), 1 /* Hair */, 2);
        s.add(torus([0, 40.6, -7.2], 3.4, 1.7, [-0.35, 0, 0]), 1 /* Hair */, 1.2);
        s.add(torus([0, 36, -5.8], 3.6, 1.2, [-0.35, 0, 0]), 12 /* AccMark */, 0.3);
      }
      over = 2;
      break;
    }
    case "long":
      s.add(hairCap(hairline(26.5, 4, -13), 2.2, { grooves: 0.3 }), 1 /* Hair */);
      locks(BANGS);
      for (const sd of [-1, 1])
        locks([
          [[sd * 0.92, 0.74, 0.6, 3, 1], [sd * 1.02, 0.4, 1.2, 3.4, 1.1], [sd * 1.1, 0, 1.6, 3.4, 1.2], [sd * 1.12, -0.4, 2.2, 3.2, 1.2], [sd * 1.1, -0.8, 3, 2.4, 1], [sd * 1.06, -1.05, 3.6, 0.4, 0.5]]
        ]);
      over = 2.8;
      break;
    case "bob":
      s.add(hairCap(hairline(25, 9, 8), 2.4, { grooves: 0.35, crown: 0.4, blunt: true }), 1 /* Hair */);
      locks([
        [[0.3, 0.9, 1, 3.4, 1.2], [0.1, 0.6, 1.6, 3.6, 1.2], [-0.05, 0.36, 1.4, 3, 1], [-0.12, 0.22, 1, 0.6, 0.6]],
        [[0.6, 0.86, 1, 3.2, 1.2], [0.48, 0.56, 1.6, 3.4, 1.2], [0.36, 0.32, 1.4, 2.6, 1], [0.3, 0.2, 1, 0.6, 0.6]],
        [[-0.2, 0.9, 1, 3.2, 1.2], [-0.34, 0.58, 1.6, 3.4, 1.2], [-0.46, 0.34, 1.4, 2.6, 1], [-0.52, 0.22, 1, 0.6, 0.6]]
      ]);
      over = 3.2;
      break;
    case "afro": {
      const ball = ellipsoid([0, 26, -1.6], [16, 15, 15.6]);
      s.add(
        custom([0, 26, -1.6], 20, (x, y, z) => {
          const bumps = Math.sin(x * 0.8 + 1) * Math.sin(y * 0.8) * Math.sin(z * 0.8 + 2) * 0.8;
          return roundMax(ball.d(x, y, z) + bumps, 23.5 - y - Math.max(0, -z) * 1.2 + Math.max(0, z - 8) * 0.6, 1.2);
        }),
        1 /* Hair */
      );
      over = 5;
      break;
    }
    case "mohawk":
      s.add(hairCap(hairline(26.5, 21.5, 12), 0.45, { grooves: 0, crown: 0 }), 1 /* Hair */);
      if (!cap) for (let i = 0; i < 7; i++) spike(0, 0.75 + i * 0.32, 7.5 - Math.abs(i - 2.5) * 0.7, 2.6, -0.2);
      over = 0.8;
      break;
    case "spiky":
      s.add(hairCap(hairline(26, 21, 11), 1.3, { grooves: 0.2 }), 1 /* Hair */);
      if (!cap)
        for (const [th, el, len] of [[-0.5, 0.7, 4.4], [0, 0.75, 5], [0.5, 0.7, 4.4], [-1, 0.8, 4], [1, 0.8, 4], [-0.4, 1.15, 5.2], [0.4, 1.15, 5.2], [0, 1.45, 5.4], [-1.5, 1.05, 4.2], [1.5, 1.05, 4.2], [-2.3, 1, 4.4], [2.3, 1, 4.4], [3.14, 1, 4.6], [-2.8, 0.6, 4], [2.8, 0.6, 4]])
          spike(th, el, len, 2.8, 0.3);
      locks([
        [[-0.3, 0.7, 0.8, 2.4, 1], [-0.4, 0.5, 1.2, 1.8, 0.9], [-0.5, 0.36, 1.1, 0.4, 0.5]],
        [[0.25, 0.7, 0.8, 2.4, 1], [0.3, 0.5, 1.2, 1.8, 0.9], [0.36, 0.38, 1.1, 0.4, 0.5]]
      ]);
      over = 2.2;
      break;
    case "messy": {
      s.add(hairCap(hairline(25.5, 20.5, 10), 2, { grooves: 0.3 }), 1 /* Hair */);
      const jit = (i2, k) => Math.sin(i2 * 12.9898 + k * 78.233) * 0.5;
      let i = 0;
      for (const [el, ring] of [[0.5, 7], [0.95, 6], [1.35, 3]])
        for (let n = 0; n < ring; n++, i++) {
          const th = n / ring * 2 * Math.PI + el * 1.3 + jit(i, 4) * 0.4;
          const front = Math.cos(th) > 0.5 && el < 0.7;
          const len = (cap ? 0.6 : front ? 5 : 7) + jit(i, 1) * 3;
          const a = onHead(th, el, 0.4);
          const tip = onHead(th + 0.35 + jit(i, 2) * 0.5, el + 0.12 + jit(i, 3) * 0.35, len);
          s.add(capsule(a, tip, 2.6, 0.7), 1 /* Hair */, 0.4);
        }
      over = 3.2;
      break;
    }
    // ---- v75 men's styles.
    case "buzz":
      s.add(hairCap(hairline(25, 20.5, 10), 0.7, { grooves: 0, crown: 0, fit: true }), 1 /* Hair */);
      over = 0.9;
      break;
    case "fade":
      s.add(hairCap(hairline(25.2, 20.5, 10), 0.55, { grooves: 0, crown: 0, fit: true }), 1 /* Hair */);
      s.add(hairCap(hairline(25.2, 27.5, 28), 3, { grooves: 0.4, crown: 0.2, fit: true }), 1 /* Hair */, 1);
      locks([
        [[0.2, 0.5, 0.8, 2.8, 1], [0.1, 0.42, 1, 2.4, 0.9], [0, 0.36, 0.8, 0.4, 0.45]],
        [[-0.25, 0.52, 0.8, 2.6, 1], [-0.35, 0.43, 1, 2.2, 0.9], [-0.45, 0.38, 0.8, 0.4, 0.45]]
      ]);
      over = 1.8;
      break;
    case "quiff":
      s.add(hairCap(hairline(25.2, 20.5, 10), 0.55, { grooves: 0, crown: 0, fit: true }), 1 /* Hair */);
      s.add(hairCap(hairline(25.2, 28, 29), 1.8, { grooves: 0.3, crown: 0.2, fit: true }), 1 /* Hair */, 1);
      for (const th of [-0.5, -0.2, 0.1, 0.4])
        locks([[[th, 0.4, 0.8, 3, 1.2], [th * 0.9, 0.6, 4.6, 3.6, 1.6], [th * 0.8, 0.88, 6.2, 3.6, 1.6], [th * 0.7, 1.2, 4.6, 3, 1.3], [th * 0.6, 1.55, 1.6, 0.8, 0.6]]], 1.2);
      over = 2.4;
      break;
    case "sidepart":
      s.add(hairCap(hairline(25, 20.5, 10.5), 1.4, { grooves: 0.2, crown: 0.3, fit: true }), 1 /* Hair */);
      for (const [el, off] of [[1.15, 1.6], [0.92, 1.8], [0.7, 1.6]])
        locks([[[0.62, el + 0.08, 0.8, 2.8, 1], [0.3, el, off, 3.6, 1.2], [-0.1, el - 0.08, off + 0.2, 3.6, 1.2], [-0.5, el - 0.2, off, 3, 1.1], [-0.85, el - 0.3, 1, 0.8, 0.6]]]);
      over = 2;
      break;
    case "slick": {
      s.add(hairCap(hairline(25, 20.5, 9.5), 1.6, { tie: [0, 20, -16], grooves: 0.45, crown: 0.2, fit: true }), 1 /* Hair */);
      for (const th of [-0.55, -0.2, 0.15, 0.5])
        locks([[[th, 0.42, 0.6, 2.6, 1], [th * 0.95, 0.9, 1.6, 3.2, 1.2], [th * 0.85, 1.45, 1.8, 3.2, 1.2], [th * 0.7, 2, 1.4, 2.6, 1], [th * 0.6, 2.45, 0.8, 0.8, 0.6]]]);
      over = 2;
      break;
    }
    case "manbun":
      s.add(hairCap(hairline(25, 20.5, 10), 1.4, { tie: [0, 31, -9], grooves: 0.45, fit: true }), 1 /* Hair */);
      for (const th of [-0.45, 0, 0.45]) locks([[[th, 0.42, 0.6, 2.6, 1], [th * 0.9, 0.95, 1.4, 3, 1.1], [th * 0.7, 1.5, 1.3, 2.6, 1], [th * 0.5, 1.9, 0.8, 0.8, 0.6]]]);
      if (!cap) {
        s.add(ellipsoid([0, 32, -11.8], [4.8, 4.4, 4.4]), 1 /* Hair */, 1.6);
        s.add(torus([0, 31.4, -9.6], 3.2, 1.2, [1.1, 0, 0]), 12 /* AccMark */, 0.3);
      }
      over = 2;
      break;
    case "curtains":
      s.add(hairCap(hairline(25.5, 17.5, 8.5), 2, { grooves: 0.3, crown: 0.3 }), 1 /* Hair */);
      for (const sd of [-1, 1])
        locks([
          [[sd * 0.06, 1, 1, 3.2, 1.2], [sd * 0.3, 0.76, 1.7, 3.8, 1.3], [sd * 0.55, 0.5, 1.8, 3.4, 1.2], [sd * 0.78, 0.3, 1.5, 2.2, 0.9], [sd * 0.9, 0.16, 1.1, 0.4, 0.45]],
          [[sd * 0.2, 1.1, 1, 3, 1.1], [sd * 0.55, 0.9, 1.6, 3.4, 1.2], [sd * 0.85, 0.62, 1.7, 3, 1.1], [sd * 1.05, 0.38, 1.4, 1.6, 0.8], [sd * 1.15, 0.24, 1, 0.4, 0.45]]
        ]);
      over = 2.6;
      break;
    case "curly": {
      s.add(hairCap(hairline(25.2, 20.5, 10), 1.6, { grooves: 0, crown: 0.4, fit: true }), 1 /* Hair */);
      if (!cap)
        for (let i = 0; i < 46; i++) {
          const th = i * 2.39996;
          const el = 0.45 + 1.1 * Math.sqrt(i * 0.618 % 1);
          if (el < 0.7 && Math.abs(Math.sin(th)) > 0.75) continue;
          s.add(sphere(onHead(th, el, 1.6), 2.3 + i % 3 * 0.3), 1 /* Hair */, 0.5);
        }
      over = 3;
      break;
    }
    case "flow":
      s.add(hairCap(hairline(25.5, 13, -3), 2.2, { grooves: 0.35, crown: 0.3 }), 1 /* Hair */);
      for (const th of [-0.5, -0.15, 0.2, 0.55])
        locks([[[th, 0.45, 0.8, 2.8, 1.1], [th * 1.1, 0.95, 1.8, 3.4, 1.3], [th * 1.2, 1.5, 2, 3.4, 1.3], [th * 1.3, 2.1, 1.8, 3, 1.2]]]);
      for (const sd of [-1, 1])
        locks([[[sd * 1.5, 0.5, 1.6, 3.4, 1.2], [sd * 1.75, 0, 2.2, 3.6, 1.3], [sd * 1.9, -0.45, 2.8, 3, 1.1], [sd * 2.05, -0.62, 4, 0.5, 0.5]], [[sd * 2.4, 0.4, 1.8, 3.4, 1.2], [sd * 2.5, -0.1, 2.4, 3.6, 1.3], [sd * 2.6, -0.5, 3, 2.6, 1], [sd * 2.7, -0.66, 4.2, 0.5, 0.5]]]);
      over = 2.8;
      break;
    case "locs": {
      s.add(hairCap(hairline(25.5, 20.5, 10), 1.1, { grooves: 0.3, crown: 0.3, fit: true }), 1 /* Hair */);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const th = 1.25 + i / (n - 1) * (2 * Math.PI - 2.5);
        const back = Math.max(0, -Math.cos(th));
        const len = -0.8 - 0.3 * back + Math.sin(i * 7.7) * 0.08;
        locks([[[th * 0.9, 1.2, 0.8, 1.3, 1.1], [th, 0.7, 2, 1.4, 1.2], [th * 1.02, 0.1, 2.6, 1.4, 1.2], [th * 1.03, len * 0.6, 3, 1.35, 1.15], [th * 1.04, len, 3.2, 1, 0.9]]], 0);
      }
      for (const th of [-0.4, 0.05, 0.5]) locks([[[th, 0.45, 0.8, 1.3, 1.1], [th + 0.05, 0.95, 2.2, 1.4, 1.2], [th + 0.1, 1.5, 2.4, 1.4, 1.2], [th + 0.1, 2.1, 2.2, 1.3, 1.1]]], 0);
      over = 3;
      break;
    }
    case "cornrows":
      s.add(hairCap(hairline(25.5, 20.5, 10), 1.3, { tie: [0, 16, -14], grooves: 1.1, crown: 0, fit: true }), 1 /* Hair */);
      over = 1.2;
      break;
    case "bald":
      over = 0;
      break;
    // ---- v75 women's styles.
    case "pixie":
      s.add(hairCap(hairline(25, 19.5, 9), 1.6, { grooves: 0.3, crown: 0.5, fit: true }), 1 /* Hair */);
      locks(BANGS.slice(0, 2).map((l2) => l2.map(([th, el, off, w, t]) => [th, el, off, w * 0.95, t])));
      for (const sd of [-1, 1]) locks([[[sd * 1.1, 0.6, 0.6, 2.6, 1], [sd * 1.2, 0.36, 1, 2.4, 0.9], [sd * 1.28, 0.18, 0.9, 0.4, 0.45]]]);
      over = 2;
      break;
    case "lob":
      s.add(hairCap(hairline(25.5, 4, 0), 2.4, { grooves: 0.3, crown: 0.35, blunt: true }), 1 /* Hair */);
      locks(BANGS.slice(0, 3));
      for (const sd of [-1, 1])
        locks([[[sd * 0.95, 0.74, 0.6, 3, 1], [sd * 1.05, 0.36, 1.2, 3.4, 1.2], [sd * 1.1, -0.1, 1.8, 3.4, 1.2], [sd * 1.12, -0.5, 2.4, 3.2, 1.2], [sd * 1.14, -0.68, 2.8, 2.6, 1]]]);
      over = 3;
      break;
    case "waves":
      s.add(hairCap(hairline(26.5, 2, -16), 2.4, { grooves: 0.45 }), 1 /* Hair */);
      locks(BANGS.slice(0, 2));
      for (const sd of [-1, 1])
        for (const [th0, k] of [[0.95, 1], [1.35, 0.95], [2, 0.9]])
          locks([[[sd * th0, 0.74, 0.6, 3, 1], [sd * (th0 + 0.08), 0.35, 1.6, 3.4, 1.2], [sd * (th0 - 0.04), 0, 2.6, 3.6, 1.3], [sd * (th0 + 0.1), -0.35 * k, 2, 3.4, 1.3], [sd * (th0 - 0.02), -0.7 * k, 3, 3, 1.2], [sd * (th0 + 0.08), -0.95 * k, 2.6, 2.2, 1], [sd * th0, -1.1 * k, 3.2, 0.4, 0.5]]]);
      over = 3;
      break;
    case "curls": {
      s.add(hairCap(hairline(26, 4, -10), 2.6, { grooves: 0.2, crown: 0.4 }), 1 /* Hair */);
      locks(BANGS.slice(0, 2));
      for (let i = 0; i < 70; i++) {
        const side = i % 2 ? 1 : -1;
        const th = side * (0.95 + i * 0.618 % 1 * 2.2);
        const el = 0.9 - i * 0.381 % 1 * 1.95;
        s.add(sphere(onHead(th, el, 2.6), 2.4 + i % 3 * 0.35), 1 /* Hair */, 0.5);
      }
      over = 3.6;
      break;
    }
    case "sleek":
      s.add(hairCap(hairline(26.5, 21.5, 9), 1.4, { tie: TIE, grooves: 0.3, crown: 0.1, fit: true }), 1 /* Hair */);
      over = 1.6;
      break;
    case "braid":
      s.add(hairCap(hairline(26.5, 21, 9), 1.5, { tie: [0, 20, -13], grooves: 0.4, crown: 0.2, fit: true }), 1 /* Hair */);
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 4)]);
      over = 1.8;
      break;
    case "twinbraids":
      s.add(hairCap(hairline(26.5, 20, 8), 1.5, { grooves: 0.35, crown: 0.1, fit: true }), 1 /* Hair */);
      for (const sd of [-1, 1]) locks([[[sd * 0.05, 1.05, 0.8, 3, 1.1], [sd * 0.4, 0.8, 1.2, 3.4, 1.2], [sd * 0.8, 0.55, 1.2, 3, 1.1], [sd * 1.2, 0.36, 1, 1.6, 0.8]]]);
      over = 1.8;
      break;
    case "pigtails":
      s.add(hairCap(hairline(26, 20.5, 9), 1.6, { grooves: 0.3, crown: 0.2, fit: true }), 1 /* Hair */);
      locks(BANGS.slice(0, 2));
      over = 2;
      break;
    case "topknot":
      s.add(hairCap(hairline(26.5, 21, 9), 1.4, { tie: [0, 36, -1], grooves: 0.4, fit: true }), 1 /* Hair */);
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 5)]);
      if (!cap) {
        s.add(ellipsoid([0, 39.6, -1.2], [5, 4.2, 5]), 1 /* Hair */, 1.8);
        s.add(torus([0, 41, -1.2], 3, 1.6), 1 /* Hair */, 1);
        s.add(torus([0, 36.6, -1.1], 3.4, 1.1), 12 /* AccMark */, 0.3);
      }
      over = 1.8;
      break;
    case "spacebuns":
      s.add(hairCap(hairline(26, 20.5, 9), 1.5, { grooves: 0.3, fit: true }), 1 /* Hair */);
      locks(BANGS.slice(0, 2));
      if (!cap)
        for (const sd of [-1, 1]) {
          s.add(ellipsoid([sd * 8.2, 36, -3], [4.2, 4, 4.2]), 1 /* Hair */, 1.6);
          s.add(torus([sd * 8.2, 37.3, -3], 2.6, 1.3, [0, 0, -sd * 0.5]), 1 /* Hair */, 1);
        }
      over = 1.8;
      break;
    case "puff": {
      s.add(hairCap(hairline(26, 20.5, 9), 1.5, { tie: [0, 33, -9], grooves: 0.4, fit: true }), 1 /* Hair */);
      if (!cap) {
        const ball = ellipsoid([0, 36, -13], [8.4, 7.6, 7.6]);
        s.add(custom([0, 36, -13], 11, (x, y, z) => ball.d(x, y, z) + Math.sin(x * 0.9 + 1) * Math.sin(y * 0.9) * Math.sin(z * 0.9 + 2) * 0.7), 1 /* Hair */, 1.5);
        s.add(torus([0, 33, -9.2], 3.6, 1.2, [0.9, 0, 0]), 12 /* AccMark */, 0.3);
      }
      over = 2;
      break;
    }
    case "crop":
    default:
      s.add(hairCap(hairline(24.6, 21, 11), 1.1, { grooves: 0.25, crown: 0.5, fit: true }), 1 /* Hair */);
      locks([
        [[0.3, 0.8, 0.6, 2.6, 0.9], [0.18, 0.6, 0.9, 2.4, 0.8], [0.06, 0.46, 0.8, 0.4, 0.45]],
        [[-0.2, 0.8, 0.6, 2.6, 0.9], [-0.3, 0.6, 0.9, 2.4, 0.8], [-0.42, 0.47, 0.8, 0.4, 0.45]],
        [[0.7, 0.78, 0.6, 2.4, 0.9], [0.62, 0.58, 0.9, 2.2, 0.8], [0.52, 0.47, 0.8, 0.4, 0.45]]
      ]);
      over = 1.6;
      break;
  }
  const hairOps = s.near([0, 22, 0], 80);
  const outer = (x, y, z) => Math.min(headHang(x, y, z) - 0.3, s.eval(x, y, z, hairOps));
  const tilt = wear === "visor" ? 0 : wear === "headband" ? 0.08 : 0.2;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  const thin = c.lo ? 0.8 : 0.5;
  const band = (y0, height, half = thin) => {
    const N = 72;
    const o = wear === "headband" ? (x, y, z) => headHang(x, y, z) - 0.6 : outer;
    const levels = [-0.85, 0, 0.85];
    const rads = levels.map((lv) => {
      let rad = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const th = i / N * 2 * Math.PI;
        const sx = Math.sin(th);
        const sz = Math.cos(th);
        let r = 30;
        for (; r > 4; r -= 0.2) {
          const z = sz * r;
          const yc = y0 - z * st / ct;
          if (o(sx * r, yc + lv * height, z) < 0) break;
        }
        rad[i] = r;
      }
      for (let pass = 0; pass < 4; pass++) {
        const next = new Float32Array(N);
        for (let i = 0; i < N; i++) next[i] = (rad[(i + N - 1) % N] + 2 * rad[i] + rad[(i + 1) % N]) / 4;
        rad = next;
      }
      return rad;
    });
    return custom([0, y0, 0], 22, (x, y, z) => {
      const py = (y - y0) * ct + z * st;
      let f = (Math.atan2(x, z) / (2 * Math.PI) + 1) % 1 * N;
      const i0 = Math.floor(f) % N;
      f -= Math.floor(f);
      const at = (k) => rads[k][i0] * (1 - f) + rads[k][(i0 + 1) % N] * f;
      const u = Math.max(-1.2, Math.min(1.2, py / (0.85 * height)));
      const r0 = at(0), r1 = at(1), r2 = at(2);
      const r = r1 + (r2 - r0) / 2 * u + ((r0 + r2) / 2 - r1) * u * u;
      const e = Math.hypot(x, z) - r - 0.05 - half;
      const hgt = height * (0.6 + 0.4 * Math.max(0, z / Math.max(1, Math.hypot(x, z))));
      return roundMax(Math.abs(e) - half, Math.abs(py) - hgt, Math.min(0.9, half * 0.9)) * 0.8;
    });
  };
  let markY = 0;
  if (wear === "visor" || wear === "headband") {
    const y0 = wear === "visor" ? 30 : 27;
    const hh = wear === "visor" ? 3.2 : 2.2;
    s.add(band(y0, hh, wear === "visor" ? 1.6 : 1.2), 5 /* Acc */, 0.3);
    markY = y0 - Math.tan(tilt) * 13.5;
    if (wear === "visor") s.add(brim(markY - hh + 1.2, SKULL_R[2] + over - 1.5, 0, 1.15), 5 /* Acc */, 0);
  } else if (wear === "cap") {
    s.add(
      custom([0, 26, -0.5], 24, (x, y, z) => {
        const cut = 25 - y + z * 0.2;
        return roundMax(Math.min(headHang(x, y, z) - over - 0.6, outer(x, y, z) - 0.7), cut, 0.5);
      }),
      5 /* Acc */,
      0
    );
    s.add(brim(26.2, SKULL_R[2] + over - 0.6, 0.12, thin * 1.3), 5 /* Acc */, 1.2);
    markY = 31;
  }
  return {
    shape: s,
    h: 0.4,
    lo: 1.05,
    scale: c.f.head,
    key: `hair:${style}:${wear}`,
    paint: (x, y, z, m) => {
      if (m === 1 /* Hair */) return hairPaint(style, x, y, z);
      if (m !== 5 /* Acc */ || wear === "none") return m;
      if (wear === "cap") return z > 8 && Math.abs(x) < 3 && Math.abs(y - markY) < 2.2 ? 12 /* AccMark */ : m;
      if (z > 8 && z < SKULL_R[2] + over + 4 && x > 1.6 && x < 7.4 && Math.abs(y - markY - 0.6) < 1.7) return 12 /* AccMark */;
      return m;
    }
  };
}
var dither = (x, y, z) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return v - Math.floor(v);
};
function strands(x, y, z, cx = 0, cz = -2, n = 26) {
  const az = Math.atan2(x - cx, z - cz);
  const u = az / (2 * Math.PI) * n + 0.35 * Math.sin(y * 0.33 + az * 3);
  const i = Math.floor(u);
  const f = u - i;
  const seg = dither(i * 1.7, Math.floor(y / 7 + i % 3 / 3), 0.37);
  if (f < 0.3 && seg < 0.85) return 31 /* HairLo */;
  if (f > 0.5 && f < 0.76 && seg > 0.3) return 30 /* HairHi */;
  return 1 /* Hair */;
}
function hairPaint(style, x, y, z) {
  const hairAt = () => strands(x, y, z);
  switch (style) {
    case "buzz":
      return dither(Math.floor(x), Math.floor(y), Math.floor(z)) < 0.42 + Math.max(0, y - 28) * 0.03 ? 31 /* HairLo */ : 29 /* Shaved */;
    case "fade":
    case "quiff": {
      const t = (y - 24) / 4 + (z < -6 ? -0.3 : 0);
      if (t >= 1) return hairAt();
      return t <= 0 || dither(x, y, z) > t ? 29 /* Shaved */ : 1 /* Hair */;
    }
    case "sidepart": {
      const th = Math.atan2(x, z);
      return y > 28 && z > -4 && Math.abs(th - 0.62) < 0.1 ? 29 /* Shaved */ : hairAt();
    }
    case "curtains":
      return y > 29 && z > 2 && Math.abs(x) < 0.8 ? 29 /* Shaved */ : hairAt();
    case "slick":
    case "manbun":
    case "sleek":
      return y > 25 && (x + 101) % 3.2 < 0.7 ? 31 /* HairLo */ : y > 25 && (x + 101) % 3.2 > 1.9 && (x + 101) % 3.2 < 2.5 ? 30 /* HairHi */ : hairAt();
    case "cornrows": {
      const u = Math.atan2(x, y - 12) * 9 / Math.PI;
      return u - Math.floor(u) < 0.3 ? 29 /* Shaved */ : u - Math.floor(u) > 0.62 && u - Math.floor(u) < 0.75 ? 30 /* HairHi */ : 1 /* Hair */;
    }
    case "braid":
    case "twinbraids":
    case "topknot":
    case "spacebuns":
    case "puff":
      return y > 25 && (x + 101) % 3.4 < 0.7 ? 31 /* HairLo */ : hairAt();
    default:
      return hairAt();
  }
}
function brim(y0, front, tilt, half) {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return custom([0, y0, front + 2], 16, (x, y, z) => {
    const dz = z - front + 5.4;
    const py = (y - y0) * ct + dz * st;
    const pz = -(y - y0) * st + dz * ct;
    const bend = 0;
    const e = (Math.hypot(x / 12.6, (pz + 3.2) / 15.5) - 1) * 12;
    const back = 1.4 - pz;
    return roundMax(roundMax(e, back, 2), Math.abs(py + bend) - half, half * 0.95);
  });
}

// characters/anim.ts
import * as THREE6 from "three";
function restPose() {
  const p = { lift: 0 };
  for (const b of BONES) p[b] = [0, 0, 0];
  return p;
}
function pose(base, edit) {
  const p = { ...base };
  for (const b of BONES) p[b] = [...base[b]];
  for (const [k, v] of Object.entries(edit)) {
    if (k === "lift") p.lift = v;
    else p[k] = [...v];
  }
  return p;
}
var READY = pose(restPose(), {
  lift: -0.05,
  torso: [0.25, 0, 0],
  head: [-0.2, 0, 0],
  thighR: [-0.45, 0, -0.12],
  thighL: [-0.45, 0, 0.12],
  shinR: [0.75, 0, 0],
  shinL: [0.75, 0, 0],
  uArmR: [-0.45, 0, -0.25],
  fArmR: [-0.9, 0, 0],
  racket: [0.6, 0.5, 0],
  uArmL: [-0.55, 0, 0.25],
  fArmL: [-1, 0, 0]
});
var IDLE = pose(restPose(), {
  torso: [0.05, 0, 0],
  uArmR: [-0.15, 0, -0.1],
  fArmR: [-0.5, 0, 0],
  racket: [1.1, 0, 0],
  uArmL: [0, 0, 0.1],
  fArmL: [-0.3, 0, 0]
});
var STANCE = pose(IDLE, {
  lift: -0.012,
  torso: [0.08, 0, 0],
  head: [-0.04, 0, 0],
  thighR: [-0.1, 0, -0.05],
  shinR: [0.16, 0, 0],
  thighL: [-0.1, 0, 0.05],
  shinL: [0.16, 0, 0],
  uArmR: [-0.25, 0.2, 0],
  fArmR: [-1.2, 0, 0],
  racket: [0.6, 0.85, 0],
  uArmL: [-0.602, -0.19, -0.2],
  fArmL: [-1.106, -0.02, -0.051]
});
var SHOWROOM = pose(restPose(), { lift: -0.018, ...SHOWROOM_POSE });
var PRESS = pose(restPose(), {
  // Sitting: thighs out level, shins down.
  thighR: [-1.5, 0, 0.06],
  shinR: [1.5, 0, 0],
  thighL: [-1.5, 0, -0.06],
  shinL: [1.5, 0, 0],
  torso: [0.22, 0, 0],
  head: [-0.12, 0, 0],
  // Forearms on the desk, hands together in front.
  uArmR: [-0.45, 0.7, -0.35],
  fArmR: [-1.35, 0, 0],
  uArmL: [-0.45, -0.7, 0.35],
  fArmL: [-1.35, 0, 0]
});
function clip(duration, loop, keys, contact) {
  return { duration, loop, contact, keys: keys.map(([t, p]) => ({ t, pose: p })) };
}
function stride(p) {
  const m = (r) => [r[0], -r[1], -r[2]];
  return pose(p, {
    thighR: m(p.thighL),
    thighL: m(p.thighR),
    shinR: m(p.shinL),
    shinL: m(p.shinR),
    hips: m(p.hips),
    torso: m(p.torso),
    head: m(p.head),
    uArmR: [p.uArmL[0], p.uArmR[1], p.uArmR[2]],
    uArmL: [p.uArmR[0], p.uArmL[1], p.uArmL[2]],
    fArmR: [p.fArmL[0], p.fArmR[1], p.fArmR[2]],
    fArmL: [p.fArmR[0], p.fArmL[1], p.fArmL[2]]
  });
}
var RUN_BODY = pose(READY, {
  head: [-0.3, 0, 0],
  racket: [0.35, 0.15, 0]
});
var RUN_REACH = pose(RUN_BODY, {
  lift: -0.01,
  hips: [0, 0.14, 0],
  torso: [0.32, -0.26, 0],
  head: [-0.3, 0.12, 0],
  thighR: [-0.95, 0, -0.04],
  shinR: [0.3, 0, 0],
  thighL: [0.6, 0, 0.04],
  shinL: [0.75, 0, 0],
  uArmR: [0.7, 0, -0.18],
  fArmR: [-1.05, 0, 0],
  uArmL: [-0.65, 0, 0.18],
  fArmL: [-1.45, 0, 0]
});
var RUN_LOAD = pose(RUN_REACH, {
  lift: -0.06,
  hips: [0, 0.05, 0],
  torso: [0.36, -0.1, 0],
  head: [-0.32, 0.05, 0],
  thighR: [-0.2, 0, -0.04],
  shinR: [0.65, 0, 0],
  thighL: [0.1, 0, 0.04],
  shinL: [1.75, 0, 0],
  uArmR: [0.15, 0, -0.18],
  fArmR: [-1.2, 0, 0],
  uArmL: [-0.2, 0, 0.18],
  fArmL: [-1.4, 0, 0]
});
var RUN_DRIVE = pose(RUN_REACH, {
  lift: 0.05,
  hips: [0, -0.1, 0],
  torso: [0.38, 0.12, 0],
  head: [-0.3, -0.06, 0],
  thighR: [0.6, 0, -0.04],
  shinR: [0.3, 0, 0],
  thighL: [-1.15, 0, 0.04],
  shinL: [1.45, 0, 0],
  uArmR: [-0.55, 0, -0.18],
  fArmR: [-1.4, 0, 0],
  uArmL: [0.5, 0, 0.18],
  fArmL: [-1.05, 0, 0]
});
var RUN_FLOAT = pose(RUN_DRIVE, {
  lift: 0.09,
  hips: [0, -0.14, 0],
  torso: [0.34, 0.24, 0],
  thighR: [0.7, 0, -0.04],
  shinR: [1.35, 0, 0],
  thighL: [-1, 0, 0.04],
  shinL: [0.55, 0, 0],
  uArmR: [-0.65, 0, -0.18],
  fArmR: [-1.45, 0, 0],
  uArmL: [0.6, 0, 0.18],
  fArmL: [-1, 0, 0]
});
var WALK_CONTACT = pose(IDLE, {
  lift: -0.012,
  hips: [0, 0.06, 0],
  torso: [0.04, -0.07, 0],
  head: [-0.02, 0.04, 0],
  thighR: [-0.38, 0, -0.03],
  shinR: [0.06, 0, 0],
  thighL: [0.3, 0, 0.03],
  shinL: [0.18, 0, 0],
  uArmR: [0.12, 0, -0.12],
  fArmR: [-0.45, 0, 0],
  uArmL: [-0.32, 0, 0.12],
  fArmL: [-0.35, 0, 0]
});
var WALK_PASS = pose(WALK_CONTACT, {
  lift: 0.012,
  hips: [0, 0, 0],
  torso: [0.04, 0, 0],
  head: [-0.02, 0, 0],
  thighR: [0.02, 0, -0.03],
  shinR: [0.04, 0, 0],
  thighL: [-0.22, 0, 0.03],
  shinL: [0.7, 0, 0],
  uArmR: [-0.05, 0, -0.12],
  fArmR: [-0.5, 0, 0],
  uArmL: [0.02, 0, 0.12],
  fArmL: [-0.32, 0, 0]
});
var WIDE = pose(READY, { thighR: [-0.4, 0, -0.38], thighL: [-0.4, 0, 0.38], shinR: [0.7, 0, 0], shinL: [0.7, 0, 0], lift: -0.07 });
var NARROW = pose(READY, { thighR: [-0.35, 0, -0.04], thighL: [-0.35, 0, 0.04], lift: -0.01 });
function hipTurn(p, yaw, pitch = 0) {
  const out = pose(p, { hips: [pitch, yaw, 0] });
  const undo = new THREE6.Quaternion().setFromEuler(new THREE6.Euler(pitch, yaw, 0)).invert();
  for (const b of ["thighR", "thighL"]) {
    const q = undo.clone().multiply(new THREE6.Quaternion().setFromEuler(new THREE6.Euler(...p[b])));
    const e = new THREE6.Euler().setFromQuaternion(q);
    out[b] = [e.x, e.y, e.z];
  }
  return out;
}
var euler = (r) => new THREE6.Quaternion().setFromEuler(new THREE6.Euler(r[0], r[1], r[2]));
var unit = (v) => new THREE6.Vector3(...v).normalize();
function aim(p, dir, face) {
  const chain = euler(p.root).multiply(euler(p.hips)).multiply(euler(p.torso)).multiply(euler(p.uArmR)).multiply(euler(p.fArmR));
  const z = unit(dir);
  const x = unit(face).addScaledVector(z, -unit(face).dot(z)).normalize();
  const y = new THREE6.Vector3().crossVectors(z, x);
  const want = new THREE6.Quaternion().setFromRotationMatrix(new THREE6.Matrix4().makeBasis(x, y, z));
  const e = new THREE6.Euler().setFromQuaternion(chain.invert().multiply(want));
  return pose(p, { racket: [e.x, e.y, e.z] });
}
var BODY = ["root", "hips", "torso", "thighR", "thighL", "shinR", "shinL"];
function deep(p, k, liftK = k) {
  const out = pose(p, {});
  for (const b of BODY) out[b] = [0, 1, 2].map((i) => READY[b][i] + (p[b][i] - READY[b][i]) * k);
  out.lift = READY.lift + (p.lift - READY.lift) * liftK;
  return out;
}
function heelUp(p, side, pitch, bend) {
  const t = side === "R" ? "thighR" : "thighL";
  const sh = side === "R" ? "shinR" : "shinL";
  return pose(p, { [t]: [pitch, p[t][1], p[t][2]], [sh]: [bend, p[sh][1], p[sh][2]] });
}
function legs(r, l) {
  return { thighR: [r[0], 0, -r[1]], shinR: [r[2], 0, 0], thighL: [l[0], 0, l[1]], shinL: [l[2], 0, 0] };
}
var FH_BACK = aim(
  hipTurn(
    pose(READY, {
      lift: -0.08,
      ...legs([-0.6, 0.22, 1], [-0.3, 0.12, 0.55]),
      torso: [0.22, -0.6, 0.06],
      head: [-0.15, 1.05, 0],
      uArmR: [-0.2, 0, -1],
      fArmR: [-0.8, 0, 0],
      uArmL: [-1.45, 0, 0.5],
      fArmL: [-0.15, 0, 0]
    }),
    -0.6
  ),
  [-0.25, 0.8, -0.55],
  [0.3, 0.3, 0.9]
);
var FH_DROP = aim(
  hipTurn(
    pose(READY, {
      lift: -0.1,
      ...legs([-0.55, 0.2, 0.95], [-0.4, 0.14, 0.7]),
      torso: [0.25, -0.75, 0.1],
      head: [-0.2, 0.75, 0],
      uArmR: [0.3, 0, -0.45],
      fArmR: [-0.65, 0, 0],
      uArmL: [-1.2, 0, 0.6],
      fArmL: [-0.3, 0, 0]
    }),
    -0.2
  ),
  [-0.35, -0.55, -0.75],
  [0.2, -0.5, 0.8]
);
var FH_HIT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.05,
      ...legs([-0.3, 0.16, 0.65], [-0.5, 0.12, 0.8]),
      torso: [0.22, -0.1, -0.05],
      head: [-0.2, -0.2, 0],
      uArmR: [-1, 0, -0.7],
      fArmR: [-0.25, 0, 0],
      uArmL: [-0.7, 0, 0.75],
      fArmL: [-0.8, 0, 0]
    }),
    0.35
  ),
  [-0.95, -0.1, 0.3],
  [0, 0, 1]
);
var FH_EXT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.03,
      ...legs([-0.1, 0.14, 0.55], [-0.45, 0.1, 0.7]),
      torso: [0.2, 0.25, -0.06],
      head: [-0.2, -0.55, 0],
      uArmR: [-1.55, 0, -0.15],
      fArmR: [-0.55, 0, 0],
      uArmL: [-0.35, 0, 0.55],
      fArmL: [-1.3, 0, 0]
    }),
    0.55
  ),
  [-0.1, 0.6, 0.8],
  [1, 0, 0]
);
var FH_FOLLOW = aim(
  hipTurn(
    pose(READY, {
      lift: -0.04,
      ...legs([0.2, 0.1, 0.65], [-0.35, 0.1, 0.55]),
      torso: [0.15, 0.35, -0.05],
      head: [-0.2, -0.85, 0],
      uArmR: [-1.3, 0, 0.85],
      fArmR: [-1.6, 0, 0],
      uArmL: [-0.45, 0, 0.3],
      fArmL: [-1.6, 0, 0]
    }),
    0.7
  ),
  [0.35, 0.15, -0.9],
  [0, -1, 0]
);
var BH_BACK = aim(
  hipTurn(
    pose(READY, {
      lift: -0.08,
      ...legs([-0.3, 0.12, 0.55], [-0.6, 0.22, 1]),
      torso: [0.22, 0.65, -0.06],
      head: [-0.15, -1.1, 0],
      uArmR: [-0.75, 0, 0.75],
      fArmR: [-0.75, 0, 0],
      uArmL: [-0.35, 0, 0.5],
      fArmL: [-1, 0, 0]
    }),
    0.6
  ),
  [0.3, 0.65, -0.7],
  [-0.3, 0.3, 0.9]
);
var BH_DROP = aim(
  hipTurn(
    pose(READY, {
      lift: -0.1,
      ...legs([-0.4, 0.14, 0.7], [-0.55, 0.2, 0.95]),
      torso: [0.25, 0.75, -0.08],
      head: [-0.2, -0.8, 0],
      uArmR: [-0.4, 0, 0.6],
      fArmR: [-0.5, 0, 0],
      uArmL: [0, 0, 0.4],
      fArmL: [-0.7, 0, 0]
    }),
    0.2
  ),
  [0.35, -0.5, -0.8],
  [-0.2, -0.5, 0.8]
);
var BH_HIT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.05,
      ...legs([-0.5, 0.12, 0.8], [-0.3, 0.16, 0.65]),
      torso: [0.22, 0.1, 0.05],
      head: [-0.2, 0.2, 0],
      uArmR: [-1.05, 0, 0.85],
      fArmR: [-0.25, 0, 0],
      uArmL: [-1, 0, 0.35],
      fArmL: [-0.55, 0, 0]
    }),
    -0.3
  ),
  [0.95, -0.1, 0.3],
  [0, 0, 1]
);
var BH_EXT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.03,
      ...legs([-0.45, 0.1, 0.7], [-0.1, 0.14, 0.55]),
      torso: [0.2, -0.25, 0.06],
      head: [-0.2, 0.5, 0],
      uArmR: [-1.6, 0, 0.35],
      fArmR: [-0.5, 0, 0],
      uArmL: [-1.65, 0, -0.05],
      fArmL: [-0.75, 0, 0]
    }),
    -0.5
  ),
  [0.1, 0.6, 0.8],
  [-1, 0, 0]
);
var BH_FOLLOW = aim(
  hipTurn(
    pose(READY, {
      lift: -0.04,
      ...legs([-0.35, 0.1, 0.55], [0.2, 0.1, 0.65]),
      torso: [0.15, -0.35, 0.05],
      head: [-0.2, 0.8, 0],
      uArmR: [-1.75, 0, -0.55],
      fArmR: [-1.35, 0, 0],
      uArmL: [-1.75, 0, -0.85],
      fArmL: [-1.5, 0, 0]
    }),
    -0.65
  ),
  [-0.35, 0.15, -0.9],
  [0, -1, 0]
);
var BH1_BACK = pose(BH_BACK, { uArmL: [-0.7, 0, 0.25], fArmL: [-1.5, 0, 0] });
var BH1_DROP = pose(BH_DROP, { uArmL: [-0.4, 0, 0.3], fArmL: [-1.3, 0, 0] });
var BH1_HIT = aim(pose(BH_HIT, { uArmR: [-1.1, 0, 0.55], fArmR: [-0.1, 0, 0], uArmL: [0.45, 0, 0.55], fArmL: [-0.2, 0, 0] }), [0.95, -0.15, 0.25], [0, 0, 1]);
var BH1_EXT = aim(pose(BH_EXT, { uArmR: [-1.75, 0, -0.1], fArmR: [-0.15, 0, 0], uArmL: [0.6, 0, 0.75], fArmL: [-0.1, 0, 0] }), [0.25, 0.75, 0.6], [-1, 0, 0]);
var BH1_FOLLOW = aim(pose(BH_FOLLOW, { uArmR: [-2.35, 0, -0.75], fArmR: [-0.2, 0, 0], uArmL: [0.55, 0, 0.9], fArmL: [-0.15, 0, 0] }), [-0.1, 0.9, -0.4], [-1, 0, 0]);
var LOW = { lift: -0.12, ...legs([-0.75, 0.2, 1.2], [-0.75, 0.2, 1.2]) };
var VFH_BACK = aim(
  hipTurn(pose(READY, { ...LOW, torso: [0.28, -0.4, 0.04], head: [-0.2, 0.5, 0], uArmR: [-0.55, 0, -0.85], fArmR: [-1, 0, 0], uArmL: [-1.1, 0, 0.45], fArmL: [-0.4, 0, 0] }), -0.3),
  [-0.55, 0.75, -0.25],
  [0.2, 0, 1]
);
var VFH_HIT = aim(
  hipTurn(pose(READY, { lift: -0.13, ...legs([-0.35, 0.2, 0.8], [-1, 0.12, 1.25]), torso: [0.35, -0.15, 0], head: [-0.25, 0.1, 0], uArmR: [-1.15, 0, -0.65], fArmR: [-0.45, 0, 0], uArmL: [-0.8, 0, 0.6], fArmL: [-0.6, 0, 0] }), -0.1),
  [-0.7, 0.45, 0.55],
  [0.3, -0.2, 1]
);
var VFH_PUNCH = aim(pose(VFH_HIT, { uArmR: [-1.3, 0, -0.45], fArmR: [-0.3, 0, 0] }), [-0.45, 0.35, 0.8], [0.6, -0.3, 0.7]);
var VBH_BACK = aim(
  hipTurn(pose(READY, { ...LOW, torso: [0.28, 0.45, -0.04], head: [-0.2, -0.55, 0], uArmR: [-0.85, 0, 0.6], fArmR: [-0.9, 0, 0], uArmL: [-0.6, 0, 0.45], fArmL: [-1.1, 0, 0] }), 0.3),
  [0.55, 0.75, -0.25],
  [-0.2, 0, 1]
);
var VBH_HIT = aim(
  hipTurn(pose(READY, { lift: -0.13, ...legs([-1, 0.12, 1.25], [-0.35, 0.2, 0.8]), torso: [0.35, 0.15, 0], head: [-0.25, -0.1, 0], uArmR: [-1.2, 0, 0.45], fArmR: [-0.3, 0, 0], uArmL: [-0.2, 0, 0.75], fArmL: [-0.6, 0, 0] }), 0.1),
  [0.7, 0.45, 0.55],
  [-0.3, -0.2, 1]
);
var VBH_PUNCH = aim(pose(VBH_HIT, { uArmR: [-1.35, 0, 0.25], fArmR: [-0.2, 0, 0], uArmL: [0.15, 0, 0.8] }), [0.45, 0.35, 0.8], [-0.6, -0.3, 0.7]);
function trophy(root) {
  return aim(
    hipTurn(
      pose(READY, {
        root,
        lift: -0.07,
        ...legs([-0.45, 0.16, 0.85], [-0.3, 0.16, 0.6]),
        torso: [-0.22, -0.45, 0.16],
        head: [-0.5, 0.45, 0],
        uArmR: [-1.5, 0, -1.4],
        fArmR: [-1.65, 0, 0],
        uArmL: [-2.85, 0, 0.12],
        fArmL: [0, 0, 0]
      }),
      -0.45
    ),
    [-0.2, 0.55, -0.8],
    [-1, 0, 0]
  );
}
function scratch(root) {
  return aim(
    hipTurn(
      pose(READY, {
        root,
        lift: 0.02,
        ...legs([-0.2, 0.1, 0.45], [-0.15, 0.1, 0.35]),
        torso: [-0.18, -0.25, 0.1],
        head: [-0.5, 0.25, 0],
        uArmR: [-2.3, 0, -0.75],
        fArmR: [-2.1, 0, 0],
        uArmL: [-2.2, 0, 0.3],
        fArmL: [-0.5, 0, 0]
      }),
      -0.2
    ),
    [-0.1, -1, -0.25],
    [-1, 0, 0]
  );
}
function overHit(root) {
  return aim(
    pose(READY, {
      root,
      lift: 0.12,
      ...legs([0.05, 0.05, 0.3], [-0.1, 0.05, 0.35]),
      hips: [0, 0, 0],
      torso: [0, 0.15, -0.12],
      head: [-0.45, 0, 0],
      uArmR: [-2.95, 0, -0.2],
      fArmR: [-0.05, 0, 0],
      uArmL: [-1.1, 0, 0.45],
      fArmL: [-1, 0, 0]
    }),
    [-0.05, 1, 0.35],
    [0, 0.2, 1]
  );
}
function overPronate(root) {
  return aim(
    hipTurn(
      pose(READY, {
        root,
        lift: 0.07,
        ...legs([0.3, 0.1, 0.75], [-0.35, 0.1, 0.45]),
        torso: [0.35, 0.35, -0.05],
        head: [-0.3, -0.2, 0],
        uArmR: [-2, 0, -0.1],
        fArmR: [-0.1, 0, 0],
        uArmL: [-0.5, 0, 0.6],
        fArmL: [-1.4, 0, 0]
      }),
      0.3
    ),
    [0.05, -0.2, 1],
    [-1, 0, 0]
  );
}
function overFollow(root) {
  return aim(
    hipTurn(
      pose(READY, {
        root,
        lift: -0.07,
        ...legs([0.4, 0.1, 0.95], [-0.55, 0.12, 0.85]),
        torso: [0.55, 0.35, 0],
        head: [-0.4, -0.3, 0],
        uArmR: [-0.45, 0, 0.75],
        fArmR: [-0.35, 0, 0],
        uArmL: [-0.3, 0, 0.3],
        fArmL: [-1.2, 0, 0]
      }),
      0.5
    ),
    [0.55, -0.65, -0.5],
    [0, 0, -1]
  );
}
var SQUARE = [0, 0, 0];
var TROPHY = trophy(SQUARE);
var OVER_FOLLOW = overFollow(SQUARE);
var SIDE_ON = [0, -0.8, 0];
var SERVE_HOLD = pose(IDLE, {
  root: SIDE_ON,
  lift: -0.02,
  torso: [0.12, 0, 0],
  ...legs([-0.18, 0.12, 0.32], [-0.22, 0.12, 0.36]),
  uArmL: [-1.25, 0, 0.15],
  fArmL: [-0.2, 0, 0],
  uArmR: [-0.15, 0, -0.35],
  fArmR: [-1.1, 0, 0],
  racket: [0.5, 0.3, 0],
  head: [0, 0.7, 0]
});
var SERVE_BOUNCE = pose(SERVE_HOLD, {
  lift: -0.05,
  torso: [0.28, 0, 0],
  head: [0.25, 0.6, 0],
  ...legs([-0.35, 0.12, 0.62], [-0.4, 0.12, 0.66]),
  uArmL: [-0.55, 0, 0.12],
  fArmL: [-0.35, 0, 0]
});
var SERVE_DIP = pose(SERVE_HOLD, {
  lift: -0.03,
  torso: [0.18, -0.1, 0],
  head: [0.05, 0.65, 0],
  ...legs([-0.1, 0.12, 0.3], [-0.32, 0.12, 0.42]),
  uArmL: [-0.35, 0, 0.1],
  fArmL: [-0.1, 0, 0],
  uArmR: [0.25, 0, -0.3],
  fArmR: [-0.3, 0, 0],
  racket: [0.9, 0.2, 0]
});
var SERVE_RELEASE = aim(
  hipTurn(
    pose(SERVE_HOLD, {
      lift: -0.07,
      ...legs([-0.4, 0.14, 0.75], [-0.3, 0.14, 0.6]),
      torso: [-0.12, -0.35, 0.14],
      head: [-0.45, 0.5, 0],
      uArmL: [-2.45, 0, 0.12],
      fArmL: [-0.05, 0, 0],
      uArmR: [-0.75, 0, -1.15],
      fArmR: [-0.9, 0, 0]
    }),
    -0.3
  ),
  [-0.35, 0.35, -0.85],
  [-1, 0, 0]
);
var SERVE_TROPHY = aim(
  hipTurn(
    pose(READY, {
      root: SIDE_ON,
      lift: -0.3,
      ...legs([-0.95, 0.16, 1.85], [-0.75, 0.16, 1.5]),
      torso: [-0.56, -0.58, 0.32],
      head: [-0.62, 0.5, 0],
      uArmR: [-1.6, 0, -1.45],
      fArmR: [-1.75, 0, 0],
      uArmL: [-3, 0, 0.1],
      fArmL: [0, 0, 0]
    }),
    -0.42,
    0.12
  ),
  [-0.2, 0.6, -0.78],
  [-1, 0, 0]
);
var SERVE_DRIVE = aim(
  hipTurn(
    pose(READY, {
      root: [0, -0.7, 0],
      lift: -0.03,
      ...legs([-0.3, 0.1, 0.55], [-0.24, 0.1, 0.45]),
      torso: [-0.34, -0.4, 0.22],
      head: [-0.6, 0.4, 0],
      uArmR: [-2.2, 0, -1],
      fArmR: [-2.1, 0, 0],
      uArmL: [-2.6, 0, 0.25],
      fArmL: [-0.3, 0, 0]
    }),
    -0.3
  ),
  [-0.15, -0.6, -0.8],
  [-1, 0, 0]
);
var SERVE_DROP = aim(
  hipTurn(
    pose(READY, {
      root: [0, -0.55, 0],
      lift: 0.28,
      ...legs([0.05, 0.05, 0.35], [0.2, 0.05, 0.5]),
      torso: [-0.26, -0.22, 0.16],
      head: [-0.55, 0.25, 0],
      uArmR: [-2.65, 0, -0.62],
      fArmR: [-2.35, 0, 0],
      uArmL: [-1.6, 0, 0.42],
      fArmL: [-1.1, 0, 0]
    }),
    -0.15
  ),
  [-0.05, -1, -0.3],
  [-1, 0, 0]
);
var SERVE_HIT = aim(
  pose(READY, {
    root: [0, -0.3, 0],
    lift: 0.44,
    thighR: [0.6, 0, -0.04],
    shinR: [1.25, 0, 0],
    thighL: [-0.3, 0, 0.04],
    shinL: [0.35, 0, 0],
    hips: [0, 0, 0],
    torso: [0.1, 0.12, -0.12],
    head: [-0.55, 0, 0],
    uArmR: [-2.85, 0, -0.16],
    fArmR: [-0.03, 0, 0],
    uArmL: [-0.8, 0, 0.5],
    fArmL: [-1.6, 0, 0]
  }),
  [-0.05, 1, 0.32],
  [0, 0.2, 1]
);
var SERVE_PRONATE = aim(
  hipTurn(
    pose(READY, {
      root: [0, -0.05, 0],
      lift: 0.38,
      thighR: [1.15, 0, -0.1],
      shinR: [1.8, 0, 0],
      thighL: [-0.4, 0, 0.08],
      shinL: [0.3, 0, 0],
      torso: [0.42, 0.32, -0.05],
      head: [-0.3, -0.2, 0],
      uArmR: [-1.45, 0, 0.05],
      fArmR: [-0.15, 0, 0],
      uArmL: [-0.5, 0, 0.6],
      fArmL: [-1.5, 0, 0]
    }),
    0.25
  ),
  [0.2, -0.75, 0.6],
  [-1, 0, 0]
);
var SERVE_LAND = aim(
  hipTurn(
    pose(READY, {
      root: [0, 0.1, 0],
      lift: -0.2,
      thighL: [-0.95, 0, 0.1],
      shinL: [1.45, 0, 0],
      thighR: [1.35, 0, -0.14],
      shinR: [2, 0, 0],
      torso: [0.75, 0.38, 0],
      head: [-0.45, -0.25, 0],
      uArmR: [-0.9, 0, 0.55],
      fArmR: [-0.3, 0, 0],
      uArmL: [-0.35, 0, 0.45],
      fArmL: [-1.3, 0, 0]
    }),
    0.45
  ),
  [0.6, -0.75, -0.25],
  [0, 0, -1]
);
var SERVE_FINISH = aim(
  hipTurn(
    pose(READY, {
      root: [0, 0.15, 0],
      lift: -0.08,
      ...legs([-0.5, 0.14, 0.9], [-0.35, 0.14, 0.75]),
      torso: [0.5, 0.3, 0],
      head: [-0.35, -0.2, 0],
      uArmR: [-0.4, 0, 0.75],
      fArmR: [-0.4, 0, 0],
      uArmL: [-0.3, 0, 0.3],
      fArmL: [-1.2, 0, 0]
    }),
    0.4
  ),
  [0.55, -0.6, -0.55],
  [0, 0, -1]
);
var JUMP = pose(READY, {
  lift: 0.24,
  torso: [-0.1, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-3, 0, -0.25],
  fArmR: [0, 0, 0],
  racket: [-0.6, 0, 0],
  uArmL: [-2.8, 0, 0.3],
  fArmL: [0, 0, 0],
  thighR: [-0.7, 0, -0.1],
  thighL: [-0.7, 0, 0.1],
  shinR: [1.2, 0, 0],
  shinL: [1.2, 0, 0]
});
var PUMP = pose(IDLE, { uArmL: [-1.5, 0, 0.35], fArmL: [-1.9, 0, 0], torso: [0.15, 0, 0], head: [-0.2, 0, 0], uArmR: [-0.3, 0, -0.2] });
var SLUMP = pose(IDLE, {
  lift: -0.015,
  hips: [0, 0.1, -0.06],
  torso: [0.26, -0.05, 0.05],
  head: [0.24, 0.1, 0],
  ...legs([-0.08, 0.04, 0.22], [0.02, 0.06, 0.05]),
  uArmR: [0.08, 0, 0.02],
  fArmR: [-0.15, 0, 0],
  racket: [1.45, 0, 0],
  uArmL: [0.06, 0, -0.02],
  fArmL: [-0.1, 0, 0]
});
var HANDS_ON_KNEES = pose(READY, {
  lift: -0.1,
  torso: [0.95, 0, 0],
  head: [0.1, 0, 0],
  uArmR: [-0.75, 0, -0.1],
  fArmR: [0, 0, 0],
  racket: [1.2, 0, 0],
  uArmL: [-0.75, 0, 0.1],
  fArmL: [0, 0, 0]
});
var HOP = pose(READY, { lift: 0.1, thighR: [-0.25, 0, -0.1], thighL: [-0.25, 0, 0.1], shinR: [0.35, 0, 0], shinL: [0.35, 0, 0] });
var LAND = pose(WIDE, { lift: -0.1, thighR: [-0.65, 0, -0.38], thighL: [-0.65, 0, 0.38], shinR: [1.05, 0, 0], shinL: [1.05, 0, 0] });
var CROUCH = { ...LOW, lift: -0.18, torso: [0.5, 0, 0] };
var PUMP_DOWN = pose(IDLE, {
  lift: -0.09,
  ...legs([-0.55, 0.2, 0.95], [-0.55, 0.2, 0.95]),
  torso: [0.4, 0.15, 0],
  head: [-0.45, -0.1, 0],
  uArmL: [-0.35, 0, 0.3],
  fArmL: [-2.1, 0, 0],
  uArmR: [0.2, 0, -0.45],
  fArmR: [-0.4, 0, 0],
  racket: [0.9, 0, 0]
});
var PUMP_UP = pose(IDLE, {
  lift: -0.02,
  ...legs([-0.15, 0.12, 0.3], [-0.15, 0.12, 0.3]),
  torso: [-0.05, 0.25, 0],
  head: [-0.3, -0.2, 0],
  uArmL: [-2.2, 0, 0.45],
  fArmL: [-1.7, 0, 0],
  uArmR: [-0.1, 0, -0.3],
  fArmR: [-0.5, 0, 0]
});
var CROUCH_LOAD = pose(IDLE, {
  lift: -0.11,
  ...legs([-0.7, 0.14, 1.25], [-0.7, 0.14, 1.25]),
  torso: [0.5, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [0.5, 0, -0.2],
  fArmR: [-0.3, 0, 0],
  uArmL: [0.5, 0, 0.2],
  fArmL: [-0.3, 0, 0]
});
var ARMS_UP = pose(JUMP, { uArmR: [-3.05, 0, -0.45], uArmL: [-3.05, 0, 0.45], fArmR: [0, 0, 0], fArmL: [0, 0, 0], racket: [-0.9, 0, 0], head: [-0.45, 0, 0] });
var SALUTE = pose(IDLE, {
  torso: [-0.1, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-2.5, 0, -0.55],
  fArmR: [-0.2, 0, 0],
  racket: [-1.1, 0, 0],
  uArmL: [-0.5, 0, 0.35],
  fArmL: [-2.1, 0, 0]
});
var RACKET_DROP = pose(SLUMP, { head: [0.3, 0, 0], uArmR: [-0.1, 0, -0.15], racket: [1.6, 0.4, 0], torso: [0.25, 0, 0] });
var CLENCH = pose(STANCE, {
  torso: [0.18, -0.2, 0],
  head: [-0.1, -0.35, 0],
  uArmL: [-0.55, 0, 0.35],
  fArmL: [-2.2, 0, 0]
});
var HIPS = pose(IDLE, {
  torso: [0.12, 0, 0],
  head: [0.32, 0, 0],
  uArmR: [0.25, 0, -0.75],
  fArmR: [-0.35, 0, 1.75],
  racket: [1.9, 0.3, 0.2],
  uArmL: [0.25, 0, 0.75],
  fArmL: [-0.35, 0, -1.75]
});
var WAVE = pose(IDLE, {
  torso: [-0.05, 0, 0],
  head: [-0.25, 0, 0],
  uArmR: [-2.75, 0, -0.35],
  fArmR: [-0.25, 0, 0],
  racket: [-1, 0, 0],
  uArmL: [-0.45, 0, 0.1],
  fArmL: [-2.05, 0, 0.3]
});
var ROAR = pose(PUMP_DOWN, {
  lift: -0.12,
  ...legs([-0.75, 0.28, 1.2], [-0.75, 0.28, 1.2]),
  torso: [0.35, 0, 0],
  head: [-0.75, 0, 0],
  uArmR: [-0.35, 0, -0.55],
  fArmR: [-2.1, 0, 0],
  racket: [0.4, 0, 0],
  uArmL: [-0.35, 0, 0.55],
  fArmL: [-2.1, 0, 0]
});
var KNEEL = pose(ARMS_UP, {
  lift: -0.34,
  torso: [-0.12, 0, 0],
  head: [-0.55, 0, 0],
  thighR: [0, 0, -0.08],
  thighL: [0, 0, 0.08],
  shinR: [1.57, 0, 0],
  shinL: [1.57, 0, 0]
});
var LIE = pose(restPose(), {
  lift: -0.47,
  hips: [-1.5, 0, 0],
  head: [0.25, 0, 0],
  thighR: [-0.6, 0, -0.15],
  thighL: [-0.3, 0, 0.12],
  shinR: [1, 0, 0],
  shinL: [0.5, 0, 0],
  uArmR: [0, 0, -1.6],
  fArmR: [-0.3, 0, 0],
  racket: [0.6, 0.6, 0],
  uArmL: [0, 0, 1.6],
  fArmL: [-0.3, 0, 0]
});
var SIT = pose(restPose(), {
  lift: -0.5,
  hips: [-0.35, 0, 0],
  torso: [0.15, 0, 0],
  head: [-0.3, 0, 0],
  ...legs([-1.3, 0.15, 1.5], [-1.3, 0.15, 1.5]),
  uArmR: [-1.8, 0, -0.5],
  fArmR: [-0.2, 0, 0],
  uArmL: [-1.8, 0, 0.5],
  fArmL: [-0.2, 0, 0]
});
var DISBELIEF = pose(IDLE, {
  torso: [-0.08, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-1.9, 0, -1.45],
  fArmR: [-2.35, 0, 0],
  racket: [0.9, 0, 0],
  uArmL: [-1.9, 0, 1.45],
  fArmL: [-2.35, 0, 0]
});
var HEAD_IN_HANDS = pose(restPose(), {
  lift: -0.3,
  ...legs([-1.55, 0.22, 2.2], [-1.55, 0.22, 2.2]),
  torso: [0.75, 0, 0],
  head: [0.55, 0, 0],
  uArmR: [-0.95, 0, -0.25],
  fArmR: [-2.35, 0, 0],
  racket: [3, -0.2, 0],
  uArmL: [-0.95, 0, 0.25],
  fArmL: [-2.35, 0, 0]
});
var BOX_SIT = pose(restPose(), {
  lift: -0.19,
  hips: [0, 0, 0],
  torso: [0.08, 0, 0],
  head: [-0.12, 0, 0],
  ...legs([-1.5, 0.14, 1.5], [-1.5, 0.14, 1.5]),
  uArmR: [-0.75, 0, -0.12],
  fArmR: [-0.75, 0, 0],
  uArmL: [-0.75, 0, 0.12],
  fArmL: [-0.75, 0, 0]
});
var TUNNEL_POSES = {
  stand: IDLE,
  stance: STANCE,
  chest: pose(IDLE, { lift: 5e-3, torso: [-0.07, 0, 0], head: [-0.14, 0, 0], uArmR: [-0.08, 0, -0.2], fArmR: [-0.35, 0, 0], uArmL: [0.05, 0, 0.22], fArmL: [-0.2, 0, 0] }),
  still: pose(IDLE, { torso: [0.03, 0, 0], head: [0.04, 0, 0], uArmR: [-0.05, 0, -0.08], fArmR: [-0.3, 0, 0], uArmL: [0.02, 0, 0.06], fArmL: [-0.15, 0, 0] }),
  down: pose(STANCE, { lift: -0.02, torso: [0.2, 0, 0], head: [0.34, 0, 0] }),
  hello: pose(IDLE, { uArmL: [-0.55, 0, 0.95], fArmL: [-1.75, 0, 0], head: [-0.06, 0, 0] })
};
var BOX_POSES = {
  sit: BOX_SIT,
  lean: pose(BOX_SIT, { torso: [0.5, 0, 0], head: [-0.45, 0, 0], uArmR: [-0.95, 0, -0.2], fArmR: [-1.75, 0, 0], uArmL: [-0.95, 0, 0.2], fArmL: [-1.75, 0, 0] }),
  clapOpen: pose(BOX_SIT, { torso: [0.15, 0, 0], uArmR: [-1.2, 0, 0.1], fArmR: [-1, 0, 0], uArmL: [-1.2, 0, -0.1], fArmL: [-1, 0, 0] }),
  clapShut: pose(BOX_SIT, { torso: [0.15, 0, 0], uArmR: [-1.2, 0, 0.42], fArmR: [-1.05, 0, 0], uArmL: [-1.2, 0, -0.42], fArmL: [-1.05, 0, 0] }),
  head: pose(BOX_SIT, { torso: [0.85, 0, 0], head: [0.5, 0, 0], uArmR: [-0.55, 0, -0.25], fArmR: [-2.55, 0, 0], uArmL: [-0.55, 0, 0.25], fArmL: [-2.55, 0, 0] }),
  /** On their feet, both fists up: "come on!" */
  up: pose(IDLE, { lift: -0.01, torso: [-0.1, 0, 0], head: [-0.3, 0, 0], uArmR: [-2.4, 0, -0.5], fArmR: [-1.4, 0, 0], uArmL: [-2.4, 0, 0.5], fArmL: [-1.4, 0, 0] }),
  pump: pose(IDLE, { lift: -0.04, torso: [0.25, 0, 0], head: [-0.2, 0, 0], ...legs([-0.3, 0.14, 0.5], [-0.3, 0.14, 0.5]), uArmR: [-0.9, 0, -0.35], fArmR: [-2.2, 0, 0], uArmL: [-0.9, 0, 0.35], fArmL: [-2.2, 0, 0] })
};
var SMASH_UP = pose(IDLE, {
  lift: 0.02,
  torso: [-0.18, 0.25, 0],
  head: [-0.25, 0.1, 0],
  uArmR: [-2.95, 0, -0.2],
  fArmR: [-0.45, 0, 0],
  racket: [1.45, 0, 0],
  uArmL: [-0.5, 0, 0.45],
  fArmL: [-0.8, 0, 0]
});
var SMASH_SLAM = pose(IDLE, {
  lift: -0.12,
  ...legs([-0.65, 0.22, 1], [-0.55, 0.22, 0.9]),
  torso: [0.95, -0.1, 0],
  head: [0.1, 0, 0],
  uArmR: [-0.75, 0, -0.05],
  fArmR: [-0.2, 0, 0],
  racket: [0.9, 0, 0],
  uArmL: [0.1, 0, 0.35],
  fArmL: [-0.6, 0, 0]
});
var SMASH_RECOIL = pose(SMASH_SLAM, { lift: -0.06, torso: [0.6, -0.05, 0], uArmR: [-1.6, 0, -0.1], fArmR: [-0.5, 0, 0], racket: [0.1, 0, 0] });
var SMASH_LOOK = pose(IDLE, { lift: -0.03, torso: [0.35, 0, 0], head: [0.45, 0, 0], uArmR: [-0.2, 0, -0.15], fArmR: [-0.4, 0, 0], racket: [1.4, 0, 0], uArmL: [0.1, 0, 0.2] });
var SMASH_ASK = pose(IDLE, { torso: [0.05, -0.35, 0], head: [-0.05, -0.6, 0], uArmL: [-0.9, 0, 0.75], fArmL: [-0.5, 0, 0], uArmR: [0.05, 0, -0.1], fArmR: [-0.3, 0, 0] });
var CLIPS = {
  racketSmash: clip(2.8, false, [
    [0, STANCE],
    [0.32, SMASH_UP],
    [0.56, SMASH_SLAM],
    [0.7, SMASH_RECOIL],
    [0.86, pose(SMASH_SLAM, { lift: -0.1, torso: [0.85, -0.05, 0] })],
    [1.25, SMASH_LOOK],
    [1.6, HIPS],
    [2.05, SMASH_ASK],
    [2.4, SMASH_ASK],
    [2.8, STANCE]
  ]),
  // Phase 62: point reactions (a clench, a shake of the head) and match endings by occasion,
  // each a way in and a pose to hold.
  clench: clip(1.1, false, [
    [0, STANCE],
    [0.2, CLENCH],
    [0.4, pose(CLENCH, { fArmL: [-2.45, 0, 0], torso: [0.24, -0.25, 0] })],
    [0.7, CLENCH],
    [1.1, STANCE]
  ]),
  shakeHead: clip(1.5, false, [
    [0, STANCE],
    [0.3, HIPS],
    [0.55, pose(HIPS, { head: [0.3, 0.32, 0] })],
    [0.8, pose(HIPS, { head: [0.3, -0.32, 0] })],
    [1.05, pose(HIPS, { head: [0.3, 0.25, 0] })],
    [1.5, STANCE]
  ]),
  winWave: clip(0.8, false, [
    [0, IDLE],
    [0.4, pose(WAVE, { uArmR: [-2.3, 0, -0.3] })],
    [0.8, WAVE]
  ]),
  waveLoop: clip(2.2, true, [
    [0, WAVE],
    [0.55, pose(WAVE, { uArmR: [-2.8, 0, -0.65], torso: [-0.05, 0.12, 0], head: [-0.25, 0.25, 0] })],
    [1.1, WAVE],
    [1.65, pose(WAVE, { uArmR: [-2.7, 0, -0.1], torso: [-0.05, -0.12, 0], head: [-0.25, -0.25, 0] })],
    [2.2, WAVE]
  ]),
  winRoar: clip(1, false, [
    [0, IDLE],
    [0.25, pose(ROAR, { lift: -0.05, head: [-0.3, 0, 0] })],
    [0.5, ROAR],
    [1, ROAR]
  ]),
  roarLoop: clip(1.8, true, [
    [0, ROAR],
    [0.45, pose(ROAR, { lift: -0.1, head: [-0.85, 0, 0], fArmR: [-2.3, 0, 0], fArmL: [-2.3, 0, 0] })],
    [0.9, ROAR],
    [1.35, pose(ROAR, { lift: -0.13, torso: [0.4, 0, 0], head: [-0.65, 0, 0] })],
    [1.8, ROAR]
  ]),
  winArms: clip(0.9, false, [
    [0, IDLE],
    [0.3, pose(ARMS_UP, { lift: -0.06, ...legs([-0.45, 0.2, 0.8], [-0.45, 0.2, 0.8]), uArmR: [-1.6, 0, -0.4], uArmL: [-1.6, 0, 0.4], fArmR: [-0.8, 0, 0], fArmL: [-0.8, 0, 0], head: [-0.1, 0, 0] })],
    [0.6, pose(ARMS_UP, { lift: 0.06 })],
    [0.9, ARMS_UP]
  ]),
  armsUpLoop: clip(1.6, true, [
    [0, ARMS_UP],
    [0.4, pose(ARMS_UP, { lift: 0.02, uArmR: [-2.9, 0, -0.6], uArmL: [-2.9, 0, 0.6] })],
    [0.8, pose(ARMS_UP, { lift: 0.1 })],
    [1.2, pose(ARMS_UP, { lift: 0.02, uArmR: [-2.9, 0, -0.6], uArmL: [-2.9, 0, 0.6] })],
    [1.6, ARMS_UP]
  ]),
  winKneel: clip(1.2, false, [
    [0, IDLE],
    [0.3, pose(KNEEL, { lift: -0.18, shinR: [1, 0, 0], shinL: [1, 0, 0], thighR: [-0.5, 0, -0.08], thighL: [-0.5, 0, 0.08], uArmR: [-0.5, 0, -0.3], uArmL: [-0.5, 0, 0.3], torso: [0.4, 0, 0], head: [0.1, 0, 0] })],
    [0.6, pose(KNEEL, { torso: [0.5, 0, 0], head: [0.3, 0, 0], uArmR: [-0.6, 0, -0.3], uArmL: [-0.6, 0, 0.3], fArmR: [-1.2, 0, 0], fArmL: [-1.2, 0, 0] })],
    [1, KNEEL],
    [1.2, KNEEL]
  ]),
  kneelLoop: clip(2, true, [
    [0, KNEEL],
    [1, pose(KNEEL, { torso: [-0.2, 0, 0], head: [-0.7, 0, 0], uArmR: [-2.95, 0, -0.65], uArmL: [-2.95, 0, 0.65] })],
    [2, KNEEL]
  ]),
  winLie: clip(1.4, false, [
    [0, IDLE],
    [0.35, pose(SIT, { hips: [0, 0, 0], lift: -0.15, ...legs([-0.6, 0.15, 0.9], [-0.6, 0.15, 0.9]), torso: [0.3, 0, 0] })],
    [0.75, SIT],
    [1.15, LIE],
    [1.4, LIE]
  ]),
  lieLoop: clip(3, true, [
    [0, LIE],
    [1.5, pose(LIE, { torso: [-0.06, 0, 0], uArmR: [0, 0, -1.75], uArmL: [0, 0, 1.75], head: [0.15, 0.2, 0] })],
    [3, LIE]
  ]),
  winDisbelief: clip(0.9, false, [
    [0, IDLE],
    [0.45, pose(DISBELIEF, { head: [0.1, 0, 0], torso: [0.1, 0, 0] })],
    [0.9, DISBELIEF]
  ]),
  disbeliefLoop: clip(2.6, true, [
    [0, DISBELIEF],
    [0.65, pose(DISBELIEF, { head: [-0.35, 0.3, 0], hips: [0, 0.15, 0] })],
    [1.3, pose(DISBELIEF, { head: [-0.45, 0, 0], torso: [-0.15, 0, 0] })],
    [1.95, pose(DISBELIEF, { head: [-0.35, -0.3, 0], hips: [0, -0.15, 0] })],
    [2.6, DISBELIEF]
  ]),
  loseCrouch: clip(1.2, false, [
    [0, IDLE],
    [0.45, pose(SLUMP, { lift: -0.1, torso: [0.45, 0, 0], head: [0.4, 0, 0] })],
    [0.9, HEAD_IN_HANDS],
    [1.2, HEAD_IN_HANDS]
  ]),
  crouchLoop: clip(3, true, [
    [0, HEAD_IN_HANDS],
    [1.5, pose(HEAD_IN_HANDS, { torso: [0.82, 0, 0], head: [0.6, 0.15, 0] })],
    [3, HEAD_IN_HANDS]
  ]),
  loseHips: clip(0.8, false, [
    [0, IDLE],
    [0.8, HIPS]
  ]),
  hipsLoop: clip(2.8, true, [
    [0, HIPS],
    [0.7, pose(HIPS, { head: [0.3, 0.3, 0] })],
    [1.4, pose(HIPS, { head: [-0.25, 0, 0], torso: [0, 0, 0] })],
    [2.1, pose(HIPS, { head: [0.3, -0.3, 0] })],
    [2.8, HIPS]
  ]),
  idle: clip(2.4, true, [
    [0, STANCE],
    [1.2, pose(STANCE, { lift: -0.02, torso: [0.11, 0, 0], head: [-0.07, 0, 0] })],
    [2.4, STANCE]
  ]),
  // Breathing and a slow glance, so the model never stands frozen.
  showroom: clip(4.8, true, [
    [0, SHOWROOM],
    [1.6, pose(SHOWROOM, { torso: [-0.025, 0.06, -0.02], head: [0.02, 0.46, 0.02] })],
    [3.2, pose(SHOWROOM, { torso: [0.015, 0.04, -0.03], head: [0.05, 0.53, -0.01] })],
    [4.8, SHOWROOM]
  ]),
  ready: clip(0.6, true, [
    [0, READY],
    [0.3, pose(READY, { lift: -0.03 })],
    [0.6, READY]
  ]),
  run: clip(0.5, true, [
    [0, RUN_REACH],
    [0.0625, RUN_LOAD],
    [0.125, RUN_DRIVE],
    [0.1875, RUN_FLOAT],
    [0.25, stride(RUN_REACH)],
    [0.3125, stride(RUN_LOAD)],
    [0.375, stride(RUN_DRIVE)],
    [0.4375, stride(RUN_FLOAT)],
    [0.5, RUN_REACH]
  ]),
  // A shuffle: push off wide and low, feet snap together in a skip, land wide again.
  walk: clip(1.1, true, [
    [0, WALK_CONTACT],
    [0.275, WALK_PASS],
    [0.55, stride(WALK_CONTACT)],
    [0.825, stride(WALK_PASS)],
    [1.1, WALK_CONTACT]
  ]),
  sidestep: clip(0.36, true, [
    [0, WIDE],
    [0.09, pose(WIDE, { lift: -0.03, thighR: [-0.38, 0, -0.22], thighL: [-0.38, 0, 0.22], shinR: [0.6, 0, 0], shinL: [0.6, 0, 0] })],
    [0.18, pose(NARROW, { lift: 0.02, shinR: [0.45, 0, 0], shinL: [0.45, 0, 0] })],
    [0.27, pose(WIDE, { lift: -0.04, thighR: [-0.35, 0, -0.3], thighL: [-0.35, 0, 0.3], shinR: [0.55, 0, 0], shinL: [0.55, 0, 0] })],
    [0.36, WIDE]
  ]),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  forehand: clip(0.76, false, [
    [0, deep(FH_BACK, 1.5, 1.8)],
    [0.09, deep(FH_DROP, 1.55, 1.7)],
    [0.16, deep(FH_HIT, 1.15)],
    [0.25, deep(FH_EXT, 1.3)],
    [0.38, heelUp(deep(FH_FOLLOW, 1.3), "R", 0.28, 0.85)],
    [0.5, heelUp(deep(FH_FOLLOW, 1.25), "R", 0.22, 0.7)],
    [0.76, READY]
  ], 0.16),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  backhand: clip(0.76, false, [
    [0, deep(BH_BACK, 1.5, 1.8)],
    [0.09, deep(BH_DROP, 1.55, 1.7)],
    [0.16, deep(BH_HIT, 1.15)],
    [0.25, deep(BH_EXT, 1.3)],
    [0.38, heelUp(deep(BH_FOLLOW, 1.3), "L", 0.28, 0.85)],
    [0.5, heelUp(deep(BH_FOLLOW, 1.25), "L", 0.22, 0.7)],
    [0.76, READY]
  ], 0.16),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  backhand1: clip(0.76, false, [
    [0, deep(BH1_BACK, 1.5, 1.8)],
    [0.09, deep(BH1_DROP, 1.55, 1.7)],
    [0.16, deep(BH1_HIT, 1.15)],
    [0.25, deep(BH1_EXT, 1.3)],
    [0.38, heelUp(deep(BH1_FOLLOW, 1.3), "L", 0.28, 0.85)],
    [0.5, heelUp(deep(BH1_FOLLOW, 1.25), "L", 0.22, 0.7)],
    [0.76, READY]
  ], 0.16),
  volleyFh: clip(0.4, false, [
    [0, VFH_BACK],
    [0.08, VFH_HIT],
    [0.2, VFH_PUNCH],
    [0.4, READY]
  ], 0.08),
  volleyBh: clip(0.4, false, [
    [0, VBH_BACK],
    [0.08, VBH_HIT],
    [0.2, VBH_PUNCH],
    [0.4, READY]
  ], 0.08),
  smash: clip(0.74, false, [
    [0, TROPHY],
    [0.08, scratch(SQUARE)],
    [0.16, overHit(SQUARE)],
    [0.25, overPronate(SQUARE)],
    [0.44, OVER_FOLLOW],
    [0.74, READY]
  ], 0.16),
  // A bounce or two of the ball while waiting to serve, then a settle.
  serveReady: clip(2.4, true, [
    [0, SERVE_HOLD],
    [0.3, SERVE_BOUNCE],
    [0.55, SERVE_HOLD],
    [0.85, SERVE_BOUNCE],
    [1.1, SERVE_HOLD],
    [2.4, SERVE_HOLD]
  ]),
  // Toss and serve (phase 54, rebuilt in phase 65): arms down together, up together, the
  // ball released as the toss arm passes the head, then the deep trophy held until the
  // swing, swaying a little as the knees keep loading.
  serveToss: clip(4, true, [
    [0, SERVE_HOLD],
    [0.1, SERVE_DIP],
    [0.24, SERVE_RELEASE],
    [0.48, SERVE_TROPHY],
    [1, pose(SERVE_TROPHY, { lift: -0.2 })],
    [4, pose(SERVE_TROPHY, { lift: -0.2 })]
  ]),
  // From the trophy: drive, racket drop, contact in the air at 0.22 s, pronation, landing
  // on the front foot with the back leg kicked up, then back to ready.
  serve: clip(0.92, false, [
    [0, SERVE_TROPHY],
    [0.08, SERVE_DRIVE],
    [0.15, SERVE_DROP],
    [0.22, SERVE_HIT],
    [0.3, SERVE_PRONATE],
    [0.42, SERVE_LAND],
    [0.62, SERVE_FINISH],
    [0.92, READY]
  ], 0.22),
  celebrate: clip(1.2, false, [
    [0, IDLE],
    [0.16, PUMP_UP],
    [0.32, PUMP_DOWN],
    [0.5, pose(PUMP_DOWN, { torso: [0.32, 0.1, 0], fArmL: [-1.9, 0, 0] })],
    [0.62, pose(PUMP_UP, { uArmL: [-1.5, 0, 0.4] })],
    [0.76, PUMP_DOWN],
    [1.2, IDLE]
  ]),
  splitStep: clip(0.34, false, [
    [0, READY],
    [0.1, HOP],
    [0.2, LAND],
    [0.34, READY]
  ]),
  // Crouch, spring up with both arms high, land soft and bounce once more.
  celebrate2: clip(1.25, false, [
    [0, IDLE],
    [0.14, CROUCH_LOAD],
    [0.34, ARMS_UP],
    [0.52, pose(CROUCH_LOAD, { lift: -0.07, uArmR: [-2.6, 0, -0.5], uArmL: [-2.6, 0, 0.5], fArmR: [-0.3, 0, 0], fArmL: [-0.3, 0, 0], racket: [-0.6, 0, 0] })],
    [0.72, pose(ARMS_UP, { lift: 0.08 })],
    [0.92, pose(ARMS_UP, { lift: -0.02, thighR: [-0.2, 0, -0.1], thighL: [-0.2, 0, 0.1], shinR: [0.35, 0, 0], shinL: [0.35, 0, 0] })],
    [1.25, IDLE]
  ]),
  celebrate3: clip(1.2, false, [
    [0, IDLE],
    [0.25, pose(SALUTE, { hips: [0, -0.25, 0], head: [-0.3, -0.2, 0] })],
    [0.5, pose(SALUTE, { lift: 0.04, fArmL: [-1.6, 0, 0] })],
    [0.75, pose(SALUTE, { hips: [0, 0.3, 0], head: [-0.3, 0.3, 0] })],
    [0.95, pose(SALUTE, { lift: 0.04, hips: [0, 0.15, 0], fArmL: [-1.6, 0, 0] })],
    [1.2, IDLE]
  ]),
  celebrateLoop: clip(0.9, true, [
    [0, PUMP],
    [0.3, JUMP],
    [0.6, pose(JUMP, { lift: 0.05 })],
    [0.9, PUMP]
  ]),
  dejected: clip(1.4, false, [
    [0, IDLE],
    [0.35, SLUMP],
    [0.65, pose(SLUMP, { head: [0.2, -0.3, 0] })],
    [0.85, pose(SLUMP, { head: [0.22, 0.32, 0] })],
    [1.1, SLUMP],
    [1.4, IDLE]
  ]),
  dejected2: clip(1.4, false, [
    [0, IDLE],
    [0.3, RACKET_DROP],
    [0.55, pose(RACKET_DROP, { head: [0.3, 0.45, 0] })],
    [0.8, pose(RACKET_DROP, { head: [0.3, -0.45, 0] })],
    [1.05, RACKET_DROP],
    [1.4, IDLE]
  ]),
  dejectedLoop: clip(2.4, true, [
    [0, HANDS_ON_KNEES],
    [1.2, pose(HANDS_ON_KNEES, { lift: -0.12, torso: [1, 0, 0] })],
    [2.4, HANDS_ON_KNEES]
  ]),
  // Press conference (phase 40): leaning on the desk, forearms on it, looking round the
  // room at the reporters, and a hand up now and then to make a point.
  press: clip(6, true, [
    [0, PRESS],
    [1.4, pose(PRESS, { head: [-0.08, 0.28, 0.04] })],
    [2.6, pose(PRESS, { head: [-0.02, 0.05, 0], uArmR: [-0.8, 0.35, -0.35], fArmR: [-1.8, 0, 0] })],
    [3.4, pose(PRESS, { head: [-0.04, -0.06, -0.02], uArmR: [-0.75, 0.3, -0.33], fArmR: [-1.65, 0, 0] })],
    [4.6, pose(PRESS, { head: [-0.1, -0.3, -0.04] })],
    [6, PRESS]
  ]),
  // Worn out between points (phase 28): hands on knees, eyes up the court, quick heaving breaths.
  tired: clip(0.9, true, [
    [0, pose(HANDS_ON_KNEES, { torso: [0.78, 0, 0], head: [-0.45, 0, 0] })],
    [0.45, pose(HANDS_ON_KNEES, { lift: -0.115, torso: [0.9, 0, 0], head: [-0.52, 0, 0], uArmR: [-0.68, 0, -0.12], uArmL: [-0.68, 0, 0.12] })],
    [0.9, pose(HANDS_ON_KNEES, { torso: [0.78, 0, 0], head: [-0.45, 0, 0] })]
  ])
};
function sample(c, t, out) {
  const time = c.loop ? (t % c.duration + c.duration) % c.duration : Math.min(Math.max(t, 0), c.duration);
  const keys = c.keys;
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= time) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, n - 1)];
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (time - a.t) / span)) : 1;
  const prev = (k) => {
    if (k > 0) return { key: keys[k - 1], dt: 0 };
    return c.loop && n > 2 ? { key: keys[n - 2], dt: -c.duration } : null;
  };
  const next = (k) => {
    if (k < n - 1) return { key: keys[k + 1], dt: 0 };
    return c.loop && n > 2 ? { key: keys[1], dt: c.duration } : null;
  };
  const pa = prev(i);
  const nb = next(i + 1);
  const ta = a.hold || !pa ? 0 : span / (b.t - (pa.key.t + pa.dt));
  const tb = b.hold || !nb ? 0 : span / (nb.key.t + nb.dt - a.t);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const P = pa ? pa.key.pose : a.pose;
  const N = nb ? nb.key.pose : b.pose;
  const f = (p0, p1, p2, p3) => h00 * p1 + h10 * ta * (p2 - p0) + h01 * p2 + h11 * tb * (p3 - p1);
  out.lift = f(P.lift, a.pose.lift, b.pose.lift, N.lift);
  for (const k of BONES) {
    const o = out[k] ?? (out[k] = [0, 0, 0]);
    const p0 = P[k], p1 = a.pose[k], p2 = b.pose[k], p3 = N[k];
    o[0] = f(p0[0], p1[0], p2[0], p3[0]);
    o[1] = f(p0[1], p1[1], p2[1], p3[1]);
    o[2] = f(p0[2], p1[2], p2[2], p3[2]);
  }
  return out;
}
function lerpPose(a, b, s, out) {
  out.lift = a.lift + (b.lift - a.lift) * s;
  for (const k of BONES) {
    const pa = a[k];
    const pb = b[k];
    const o = out[k] ?? (out[k] = [0, 0, 0]);
    o[0] = pa[0] + (pb[0] - pa[0]) * s;
    o[1] = pa[1] + (pb[1] - pa[1]) * s;
    o[2] = pa[2] + (pb[2] - pa[2]) * s;
  }
  return out;
}
function copyPose(src, out) {
  return lerpPose(src, src, 0, out);
}

// player/mods.ts
var NO_MODS = Object.freeze({
  pace: 1,
  scatter: 1,
  spin: 1,
  touch: 1,
  serve: 1,
  speed: 1,
  accel: 1,
  brake: 1,
  drain: 1,
  fhScatter: 1,
  bhScatter: 1,
  smash: 1,
  serveScatter: 1,
  kick: 1,
  bomb: 1,
  disguise: 0,
  timing: 1,
  composure: 1,
  clutch: 1,
  fatigue: 1,
  crit: 0,
  reach: 0,
  hitCost: 1,
  volleyPace: 1,
  volleyScatter: 1,
  powerPace: 1,
  spinBurst: 1,
  returnPace: 1,
  returnScatter: 1,
  secondWind: 0,
  stretch: 1,
  runShot: 1,
  lowBall: 1,
  tired: 1,
  powerControl: 1,
  incoming: 1,
  late: 1,
  lobScatter: 1,
  passing: 1,
  comeback: 1,
  closer: 1,
  momentum: 0,
  read: 1,
  regen: 1,
  refill: 1,
  plusOne: 1,
  serveCost: 1
});

// meta/physique.ts
var HEIGHT_MIN = 150;
var HEIGHT_MAX = 200;
var STANDARD_CM = 172;
var clampCm = (cm) => Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, cm)));
var scaleOfCm = (cm) => clampCm(cm) / STANDARD_CM;

// characters/looks.ts
var HAIR_FOR = {
  masc: ["buzz", "crop", "fade", "sidepart", "quiff", "slick", "curtains", "messy", "spiky", "curly", "mohawk", "flow", "long", "manbun", "locs", "cornrows", "afro", "bald"],
  fem: ["pixie", "bob", "lob", "long", "waves", "curls", "ponytail", "sleek", "braid", "twinbraids", "pigtails", "bun", "topknot", "spacebuns", "puff", "afro"]
};
var YOU_ID = "you";
var PEER_ID = "peer";
function defaultLook() {
  return {
    skin: PAL.skin1,
    hair: PAL.hairBrown,
    hairStyle: "ponytail",
    shirt: PAL.white,
    trim: PAL.blue,
    shorts: PAL.white,
    accessory: PAL.white,
    backhand: "two",
    height: 1,
    build: "athletic",
    eyes: "round",
    eyeColor: "brown",
    brows: "thin",
    mouth: "neutral",
    facialHair: "none",
    body: "fem",
    bottom: "skirt",
    headwear: "visor",
    muscle: 2,
    socks: "crew"
  };
}
var LOOK_OPTIONS = {
  skin: [PAL.skin0, PAL.skin1, PAL.skin2, PAL.skinMid, PAL.skin3, PAL.skin4, PAL.skin5],
  hair: [PAL.hairBlack, PAL.hairBrown, PAL.hairAuburn, PAL.hairRed, PAL.hairBlond, PAL.hairPlatinum, PAL.hairGrey, PAL.hairBlue, PAL.hairPink],
  hairStyle: [.../* @__PURE__ */ new Set([...HAIR_FOR.masc, ...HAIR_FOR.fem])],
  body: ["masc", "fem"],
  bottom: ["shorts", "long", "skirt", "tights"],
  socks: ["ankle", "crew", "high"],
  headwear: ["none", "headband", "visor", "cap"],
  kit: [
    PAL.white,
    PAL.lightGrey,
    PAL.charcoal,
    PAL.black,
    PAL.navy,
    PAL.seatNavy,
    PAL.blue,
    PAL.cyan,
    PAL.teal,
    PAL.mint,
    PAL.forest,
    PAL.green,
    PAL.lime,
    PAL.yellow,
    PAL.gold,
    PAL.orange,
    PAL.coral,
    PAL.red,
    PAL.maroon,
    PAL.pink,
    PAL.lavender,
    PAL.purple
  ],
  build: ["lean", "athletic", "powerful", "heavy"],
  eyes: ["round", "almond", "wide", "narrow", "hooded"],
  eyeColor: ["dark", "brown", "hazel", "green", "blue", "grey"],
  brows: ["thin", "thick", "arched", "straight", "angled", "bushy", "soft", "none"],
  mouth: ["neutral", "smile", "grin"],
  facialHair: ["none", "light", "stubble", "heavy", "moustache", "pencil", "horseshoe", "goatee", "soulpatch", "chinstrap", "boxed", "beard", "longbeard"]
};
function anyBuild(random) {
  const r = random();
  return r < 0.28 ? "lean" : r < 0.68 ? "athletic" : r < 0.9 ? "powerful" : "heavy";
}
function randomLook(random = Math.random) {
  const any = (list) => list[Math.floor(random() * list.length)];
  const shirt = any(LOOK_OPTIONS.kit);
  const body = any(LOOK_OPTIONS.body);
  return {
    skin: any(LOOK_OPTIONS.skin),
    hair: any(LOOK_OPTIONS.hair),
    hairStyle: any(HAIR_FOR[body]),
    shirt,
    trim: any(LOOK_OPTIONS.kit.filter((c) => c !== shirt)),
    shorts: any([PAL.white, PAL.black, PAL.charcoal, PAL.navy, shirt]),
    accessory: any(LOOK_OPTIONS.kit),
    backhand: random() < 0.75 ? "two" : "one",
    height: scaleOfCm(158 + Math.round((random() + random()) * 18)),
    build: anyBuild(random),
    eyes: any(LOOK_OPTIONS.eyes),
    eyeColor: any(LOOK_OPTIONS.eyeColor),
    brows: any(LOOK_OPTIONS.brows),
    mouth: any(LOOK_OPTIONS.mouth),
    facialHair: body === "fem" || random() < 0.6 ? "none" : any(LOOK_OPTIONS.facialHair),
    body,
    bottom: body === "fem" && random() < 0.6 ? "skirt" : random() < 0.75 ? "shorts" : any(["long", "tights"]),
    muscle: Math.floor(random() * 5),
    socks: any(LOOK_OPTIONS.socks),
    headwear: any(LOOK_OPTIONS.headwear)
  };
}
var yours = defaultLook();
var peers = defaultLook();
var LOOKS = {
  rio: { skin: PAL.skin2, hair: PAL.hairBrown, hairStyle: "messy", shirt: PAL.orange, trim: PAL.white, shorts: PAL.seatNavy, accessory: PAL.white, backhand: "two", body: "masc", bottom: "shorts", headwear: "headband", mouth: "smile" },
  juno: { skin: PAL.skin3, hair: PAL.hairBlack, hairStyle: "bun", shirt: PAL.teal, trim: PAL.white, shorts: PAL.white, accessory: PAL.yellow, backhand: "two", body: "fem", bottom: "skirt", headwear: "headband", eyes: "wide" },
  wren: { skin: PAL.skin1, hair: PAL.hairRed, hairStyle: "ponytail", shirt: PAL.purple, trim: PAL.pink, shorts: PAL.charcoal, accessory: PAL.white, backhand: "two", body: "fem", bottom: "shorts", headwear: "visor", mouth: "smile" },
  ash: { skin: PAL.skin1, hair: PAL.hairBlond, hairStyle: "crop", shirt: PAL.blue, trim: PAL.white, shorts: PAL.white, accessory: PAL.white, backhand: "one", body: "masc", bottom: "shorts", headwear: "cap", brows: "thick" },
  sora: { skin: PAL.skin2, hair: PAL.hairBlack, hairStyle: "long", shirt: PAL.pink, trim: PAL.white, shorts: PAL.white, accessory: PAL.cyan, backhand: "two", body: "masc", bottom: "shorts", headwear: "headband", facialHair: "stubble" },
  mila: { skin: PAL.skin4, hair: PAL.hairBlack, hairStyle: "afro", shirt: PAL.red, trim: PAL.yellow, shorts: PAL.black, accessory: PAL.yellow, backhand: "one", body: "fem", bottom: "skirt", headwear: "headband", eyes: "wide" }
};
var STARTER_GEAR = {
  rio: { racket: PAL.charcoal, grip: PAL.white, shoes: PAL.white, wristband: PAL.orange },
  juno: { racket: PAL.white, grip: PAL.teal, shoes: PAL.white, wristband: PAL.teal },
  wren: { racket: PAL.purple, grip: PAL.black, shoes: PAL.charcoal, wristband: PAL.pink },
  ash: { racket: PAL.blue, grip: PAL.white, shoes: PAL.white, wristband: PAL.white },
  sora: { racket: PAL.pink, grip: PAL.white, shoes: PAL.lightGrey, wristband: PAL.cyan },
  mila: { racket: PAL.red, grip: PAL.black, shoes: PAL.black, wristband: PAL.yellow }
};
function lookOf(id) {
  const base = id === YOU_ID ? { ...yours } : id === PEER_ID ? { ...peers } : LOOKS[id] ?? LOOKS.rio;
  const age = id === PEER_ID ? void 0 : ageOf(id);
  return age === void 0 || base.grey !== void 0 ? base : { ...base, grey: greyAt(age, id) };
}
var ageOf = () => void 0;
function greyAt(age, id) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
  const onset = 29 + h % 1e3 / 1e3 * 9;
  return Math.round(Math.max(0, Math.min(0.9, (age - onset) / 12)) * 10) / 10;
}
function starterGear(id) {
  if (id === YOU_ID || id === PEER_ID) {
    const l = lookOf(id);
    return { racket: PAL.blue, grip: PAL.white, shoes: PAL.white, wristband: l.accessory, cut: l.body === "fem" ? "tank" : "polo" };
  }
  return { ...STARTER_GEAR[id] ?? STARTER_GEAR.rio };
}
export {
  BONES,
  CHAR_HEIGHT,
  CLIPS,
  LIFT_SCALE,
  LOOKS,
  PAL,
  RACKET_HEAD,
  STARTER_GEAR,
  buildRig,
  copyPose,
  defaultLook,
  expressionFor,
  lerpPose,
  randomLook,
  restPose,
  sample,
  starterGear
};
