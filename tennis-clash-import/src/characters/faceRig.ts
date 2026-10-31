import * as THREE from 'three';
import type { Brows, CharacterLook, EyeColor, Eyes } from './looks';

/**
 * Faces that move (phase 80). The eyes, brows and mouth are no longer painted into the
 * body's blocks: they are a small layer of half-centimetre blocks laid on the front of the
 * head, following its steps, so they can change. Eyes have whites, a coloured iris, a
 * pupil and a catch-light under a lash line; lids close over them (blinks, squints,
 * tired eyes), brows lift and knit, and the mouth grins, roars or grits its teeth.
 *
 * Coordinates are the head bone's own, in cm: +z out of the face, +y up, the player's
 * right side on −x.
 */

/** The front of the face as built: one entry per skin block facing forward (x, y, front z), cm. */
export interface FaceMap {
  size: number;
  cells: Float32Array;
}

export type Expression = 'calm' | 'focus' | 'effort' | 'joy' | 'roar' | 'anger' | 'hurt' | 'tired' | 'shock' | 'smirk';
export const EXPRESSIONS: Expression[] = ['calm', 'focus', 'effort', 'joy', 'roar', 'anger', 'hurt', 'tired', 'shock', 'smirk'];

/** Iris colours. */
export const EYE_COLORS: Record<EyeColor, number> = {
  dark: 0x2b1d17,
  brown: 0x5c3920,
  hazel: 0x80602e,
  green: 0x3f7b4c,
  blue: 0x3f70c2,
  grey: 0x6c7d8e,
};

/** Size of one face block (cm). */
const PX = 0.5;
const CM = 0.01;
/** Where the features sit on the head (cm; heights scale with the head). */
const EYE_X = 4.2;
const EYE_Y = 17.6;
const MOUTH_Y = 11.4;
/** Eye openings in blocks (wide, tall) by eye shape. */
const EYE_DIMS: Record<Eyes, [number, number]> = {
  round: [6, 9],
  wide: [8, 9],
  narrow: [6, 6],
  almond: [8, 7],
  hooded: [7, 8],
};

type Lid = 'open' | 'focus' | 'tired' | 'angry' | 'sad' | 'closed' | 'happy' | 'wide' | 'smug';
type MouthKind = 'none' | 'line' | 'smile' | 'grin' | 'open' | 'o' | 'frown' | 'grit' | 'pant' | 'smirk';
/** Brow shape, in blocks: all up, the inner end, the outer end, and one brow only (a raised eyebrow). */
interface Brow {
  lift: number;
  inner: number;
  outer: number;
  one?: number;
}
interface Look {
  lid: Lid;
  brow: Brow;
  mouth: MouthKind | 'own';
}

const FACES: Record<Expression, Look> = {
  calm: { lid: 'open', brow: { lift: 0, inner: 0, outer: 0 }, mouth: 'own' },
  focus: { lid: 'focus', brow: { lift: 0, inner: -1, outer: 0 }, mouth: 'line' },
  effort: { lid: 'focus', brow: { lift: 0, inner: -2, outer: 1 }, mouth: 'grit' },
  joy: { lid: 'happy', brow: { lift: 2, inner: 0, outer: 0 }, mouth: 'grin' },
  roar: { lid: 'angry', brow: { lift: 0, inner: -2, outer: 1 }, mouth: 'open' },
  anger: { lid: 'angry', brow: { lift: 0, inner: -2, outer: 1 }, mouth: 'grit' },
  hurt: { lid: 'sad', brow: { lift: 0, inner: 2, outer: -1 }, mouth: 'frown' },
  tired: { lid: 'tired', brow: { lift: 0, inner: 1, outer: -1 }, mouth: 'pant' },
  shock: { lid: 'wide', brow: { lift: 3, inner: 0, outer: 0 }, mouth: 'o' },
  smirk: { lid: 'smug', brow: { lift: 0, inner: 0, outer: 0, one: 2 }, mouth: 'smirk' },
};

/** Mouths drawn row by row, top first: l lip line, m inside the mouth, t teeth, g tongue. */
const MOUTHS: Record<Exclude<MouthKind, 'none'>, string[]> = {
  line: ['llllll'],
  smile: ['l........l', 'll......ll', '.llllllll.'],
  grin: ['l..........l', '.tttttttttt.', '.mmmmmmmmmm.', '..mmmmmmmm..', '...llllll...'],
  open: ['..llllllll..', '.tttttttttt.', 'lmmmmmmmmmml', 'lmmmmmmmmmml', 'lmmmggggmmml', '.lmmggggmml.', '..llllllll..'],
  o: ['.llll.', 'lmmmml', 'lmmmml', 'lmmmml', '.llll.'],
  frown: ['..llllll..', '.ll....ll.', 'l........l'],
  grit: ['.llllllllll.', 'lttttttttttl', 'lttttttttttl', '.llllllllll.'],
  pant: ['.llll.', 'lmmmml', 'lmmggl', '.llll.'],
  smirk: ['........ll', '.......ll.', 'lllllll...'],
};

type Kind = 'lash' | 'white' | 'iris' | 'irisDark' | 'irisLight' | 'pupil' | 'glint' | 'lid' | 'brow' | 'lip' | 'inside' | 'teeth' | 'tongue';
export interface FacePixel {
  x: number;
  y: number;
  kind: Kind;
}

/** Which face goes with each animation clip. */
export function expressionFor(clip: string): Expression {
  switch (clip) {
    case 'ready':
    case 'run':
    case 'sidestep':
    case 'splitStep':
    case 'serveReady':
    case 'serveToss':
    case 'volleyFh':
    case 'volleyBh':
      return 'focus';
    case 'forehand':
    case 'backhand':
    case 'backhand1':
    case 'serve':
    case 'smash':
      return 'effort';
    case 'celebrate':
    case 'celebrate2':
    case 'celebrate3':
    case 'celebrateLoop':
    case 'winWave':
    case 'waveLoop':
    case 'winArms':
    case 'armsUpLoop':
    case 'winKneel':
    case 'kneelLoop':
    case 'winLie':
    case 'lieLoop':
      return 'joy';
    case 'clench':
    case 'winRoar':
    case 'roarLoop':
      return 'roar';
    case 'shakeHead':
    case 'racketSmash':
      return 'anger';
    case 'winDisbelief':
    case 'disbeliefLoop':
      return 'shock';
    case 'dejected':
    case 'dejected2':
    case 'dejectedLoop':
    case 'loseCrouch':
    case 'crouchLoop':
    case 'loseHips':
    case 'hipsLoop':
      return 'hurt';
    case 'tired':
      return 'tired';
    default:
      return 'calm';
  }
}

/** A player's eye colour: their own, or one picked from their look for players who never chose. */
export function eyeColorOf(look: CharacterLook): EyeColor {
  if (look.eyeColor && look.eyeColor in EYE_COLORS) return look.eyeColor;
  const h = (look.skin * 31 + look.hair * 17 + look.hairStyle.length * 7) % 100;
  return h < 30 ? 'brown' : h < 52 ? 'dark' : h < 66 ? 'hazel' : h < 80 ? 'blue' : h < 92 ? 'green' : 'grey';
}

/**
 * Brow shapes (phase 81), in blocks: how thick, how much fuller at the head, how much
 * thinner at the tail, extra blocks past the eye at each end, and the line's rise along
 * it (t 0 at the inner end, 1 at the tail).
 */
interface BrowShape {
  thick: number;
  head: number;
  taper: number;
  start: number;
  tail: number;
  ragged?: boolean;
  arch: (t: number) => number;
}
const BROWS: Record<Exclude<Brows, 'none'>, BrowShape> = {
  thin: { thick: 2, head: 0, taper: 0, start: 0, tail: 0, arch: (t) => Math.sin(Math.PI * t) * 1.2 },
  thick: { thick: 3, head: 1, taper: 0, start: 0, tail: 0, arch: (t) => Math.sin(Math.PI * t) * 1.2 },
  // A high arch peaking two thirds along, thinning to a fine tail.
  arched: { thick: 2, head: 1, taper: 1, start: 0, tail: 1, arch: (t) => (t < 0.66 ? (t / 0.66) * 2.6 : 2.6 - ((t - 0.66) / 0.34) * 3) },
  // Flat and level, the same weight all along.
  straight: { thick: 2, head: 1, taper: 0, start: 0, tail: 0, arch: (t) => t * 0.3 },
  // A sharp angle: rising straight, then breaking down at the corner.
  angled: { thick: 2, head: 1, taper: 1, start: 0, tail: 1, arch: (t) => (t < 0.72 ? (t / 0.72) * 2.2 : 2.2 - ((t - 0.72) / 0.28) * 3.2) },
  // Heavy and untamed, longer at both ends.
  bushy: { thick: 3, head: 1, taper: 0, start: 1, tail: 1, ragged: true, arch: (t) => Math.sin(Math.PI * t) * 1 },
  // Soft and short, a gentle curve that stops at the eye's corner.
  soft: { thick: 2, head: 0, taper: 1, start: -1, tail: -1, arch: (t) => Math.sin(Math.PI * t) * 1.6 },
};

/** Lay out one face: every block of the eyes, brows and mouth, head-local cm. */
export function facePixels(look: CharacterLook, e: Expression, blink: boolean, gaze: [number, number], k: number): FacePixel[] {
  const f = FACES[e];
  const out: FacePixel[] = [];
  const shape: Eyes = look.eyes && look.eyes in EYE_DIMS ? look.eyes : 'round';
  const [w, h] = EYE_DIMS[shape];
  const fem = look.body === 'fem';
  const lid: Lid = blink && f.lid !== 'happy' ? 'closed' : f.lid;
  const eyeTop = EYE_Y * k - 0.1 + (h * PX) / 2;
  const inner = EYE_X - 1.4;
  for (const s of [-1, 1]) {
    // Column 0 is the inner corner, by the nose.
    const at = (c: number, r: number, kind: Kind) => out.push({ x: s * (inner + (c + 0.5) * PX), y: eyeTop - (r + 0.5) * PX, kind });
    eye(w, h, shape, lid, fem, s, gaze, at);
    // Brows: from just inside the eye to past its outer corner, in their own shape (phase 81),
    // then lifted or knitted by the expression.
    if (look.brows !== 'none') {
      const b = BROWS[look.brows ?? 'thin'] ?? BROWS.thin;
      const c0 = -2 - b.start;
      const c1 = w + 2 + b.tail;
      for (let c = c0; c <= c1; c++) {
        const t = (c - c0) / (c1 - c0);
        const off = f.brow.lift + f.brow.inner * (1 - t) + f.brow.outer * t + (s > 0 ? (f.brow.one ?? 0) : 0) + b.arch(t);
        // Fuller at the inner end, tapering to the tail; a bushy brow's top edge is ragged.
        let n = b.thick + (t < 0.25 ? b.head : 0) - (c === c1 ? 1 : 0) - (t > 0.8 ? b.taper : 0);
        if (b.ragged && (c * 7 + s * 3) % 5 === 0) n++;
        for (let q = 0; q < Math.max(1, n); q++) at(c, -3 - Math.round(off) - q, 'brow');
      }
    }
  }
  const kind = f.mouth === 'own' ? (look.mouth === 'grin' ? 'grin' : look.mouth === 'smile' ? 'smile' : 'none') : f.mouth;
  if (kind !== 'none') {
    const rows = MOUTHS[kind];
    const top = MOUTH_Y * k + (rows.length * PX) / 2;
    rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.') continue;
        const kd: Kind = ch === 'l' ? 'lip' : ch === 'm' ? 'inside' : ch === 't' ? 'teeth' : 'tongue';
        out.push({ x: (c - (row.length - 1) / 2) * PX, y: top - (r + 0.5) * PX, kind: kd });
      }
    });
  }
  return out;
}

/** One eye in blocks: lids, lash line, white, iris, pupil and the catch-light. */
function eye(w: number, h: number, shape: Eyes, lid: Lid, fem: boolean, side: number, gaze: [number, number], at: (c: number, r: number, k: Kind) => void): void {
  if (lid === 'closed') {
    for (let r = 0; r < h - 1; r++) for (let c = 0; c < w; c++) at(c, r, r === h - 2 ? 'lash' : 'lid');
    if (fem) at(w, h - 3, 'lash');
    return;
  }
  if (lid === 'happy') {
    // A smiling eye: an upturned arc.
    for (let c = 0; c < w; c++) at(c, h - 3 - Math.round(2 * Math.sin((Math.PI * c) / (w - 1))), 'lash');
    return;
  }
  const hood = shape === 'hooded' ? 1 : 0;
  const top = (c: number): number => {
    const t = c / (w - 1);
    switch (lid) {
      case 'focus':
      case 'smug':
        return 2 + hood;
      case 'tired':
        return 3 + hood;
      case 'angry':
        return Math.round(3 - 2 * t) + hood;
      case 'sad':
        return Math.round(1 + 2 * t) + hood;
      default:
        return hood;
    }
  };
  const bottom = lid === 'focus' || lid === 'angry' ? 1 : 0;
  const wide = lid === 'wide';
  // The iris follows the gaze a block either way; it shrinks in a startled, wide-open eye.
  const cc = (w - 1) / 2 + gaze[0] * side;
  const ih = (w >= 8 ? 2.5 : 2) - (wide ? 0.5 : 0);
  const r0 = wide ? 2 : 1;
  const r1 = wide ? h - 3 : h - 2;
  const rc = (r0 + r1) / 2 + gaze[1];
  const glintC = Math.round(cc + ih * 0.5);
  for (let c = 0; c < w; c++) {
    const t = top(c);
    for (let r = 0; r < h; r++) {
      // Rounded lower corners.
      if (r === h - 1 && (c === 0 || c === w - 1)) continue;
      if (r < t || r >= h - bottom) {
        at(c, r, 'lid');
        continue;
      }
      if (r === t) {
        at(c, r, 'lash');
        continue;
      }
      const inIris = Math.abs(c - cc) <= ih && r >= r0 && r <= r1;
      if (!inIris) {
        at(c, r, 'white');
        continue;
      }
      const pupil = Math.abs(c - cc) <= (w % 2 ? 0.5 : 1) - (wide ? 0.5 : 0) + 0.01 && Math.abs(r - rc) <= (h >= 7 ? 1 : 0.5) - (wide ? 0.5 : 0);
      const first = Math.max(r0, t + 1);
      if (c === glintC && r === first) at(c, r, 'glint');
      else if (pupil) at(c, r, 'pupil');
      else if (r === first) at(c, r, 'irisDark');
      else if (r === r1) at(c, r, 'irisLight');
      else at(c, r, 'iris');
    }
  }
  // A flick of lashes past the outer corner.
  if (fem) {
    at(w, top(w - 1), 'lash');
    at(w, top(w - 1) - 1, 'lash');
  }
}

/** The colours a face is drawn in. */
function palette(look: CharacterLook, skin: THREE.Color, hair: THREE.Color): Record<Kind, THREE.Color> {
  const iris = new THREE.Color(EYE_COLORS[eyeColorOf(look)]);
  return {
    lash: new THREE.Color(0x1b1513),
    white: new THREE.Color(0xf2eee6),
    iris,
    irisDark: iris.clone().multiplyScalar(0.62),
    irisLight: iris.clone().lerp(new THREE.Color(1, 1, 1), 0.28),
    pupil: new THREE.Color(0x0c0b10),
    glint: new THREE.Color(0xffffff),
    lid: skin.clone().multiplyScalar(0.94),
    // Brows grey a little behind the hair (phase 81).
    brow: hair.clone().multiplyScalar(0.7).lerp(new THREE.Color(0.72, 0.71, 0.69), (look.grey ?? 0) * 0.45),
    lip: skin.clone().multiply(new THREE.Color(0.6, 0.4, 0.38)),
    inside: new THREE.Color(0x3b1519),
    teeth: new THREE.Color(0xf3eee4),
    tongue: new THREE.Color(0xc0585a),
  };
}

/** How far each kind stands off the face (cm): lashes and brows in relief, the rest flush. */
const RAISE: Record<Kind, number> = {
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
  tongue: 0.06,
};

/** The block layer for a face, laid over the head's front (metres, head-local). */
export function faceGeometry(pixels: FacePixel[], map: FaceMap, colors: Record<Kind, THREE.Color>): THREE.BufferGeometry {
  const { size, cells } = map;
  const ox = cells[0] ?? 0;
  const oy = cells[1] ?? 0;
  const depth = new Map<number, number>();
  const key = (i: number, j: number) => (i + 2048) * 4096 + (j + 2048);
  for (let q = 0; q < cells.length; q += 3) {
    const kk = key(Math.round((cells[q] - ox) / size), Math.round((cells[q + 1] - oy) / size));
    depth.set(kk, Math.max(depth.get(kk) ?? -Infinity, cells[q + 2]));
  }
  const zAt = (x: number, y: number) => depth.get(key(Math.round((x - ox) / size), Math.round((y - oy) / size)));
  const grid = new Map<string, { p: FacePixel; z: number; front: number }>();
  const pk = (x: number, y: number) => `${Math.round(x / PX)},${Math.round(y / PX)}`;
  for (const p of pixels) {
    const z = zAt(p.x, p.y);
    // Off the skin (under a fringe or a cap): not drawn.
    if (z === undefined) continue;
    grid.set(pk(p.x, p.y), { p, z, front: z + RAISE[p.kind] });
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const fuv: number[] = [];
  const ao: number[] = [];
  const sss: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[], color: THREE.Color, s: number) => {
    const start = pos.length / 3;
    for (const v of [a, b, c, d]) {
      pos.push(v[0] * CM, v[1] * CM, v[2] * CM);
      nor.push(n[0], n[1], n[2]);
      col.push(color.r, color.g, color.b);
      // The middle of a block face: no bevel seams between these tiny blocks.
      fuv.push(0.5, 0.5);
      ao.push(1);
      sss.push(s);
    }
    idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const side = new THREE.Color();
  const H = PX / 2;
  for (const { p, z, front } of grid.values()) {
    const c = colors[p.kind];
    const s = p.kind === 'lid' ? 0.45 : p.kind === 'brow' ? 0.35 : p.kind === 'lip' || p.kind === 'tongue' ? 0.3 : 0.05;
    const { x, y } = p;
    quad([x - H, y - H, front], [x + H, y - H, front], [x + H, y + H, front], [x - H, y + H, front], [0, 0, 1], c, s);
    side.copy(c).multiplyScalar(0.78);
    const back = z - 0.3;
    // Walls where the layer steps down (or ends), so it never shows a gap over the head's steps.
    const wall = (dx: number, dy: number) => {
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('fuv', new THREE.Float32BufferAttribute(fuv, 2));
  geo.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  geo.setAttribute('sss', new THREE.Float32BufferAttribute(sss, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * A player's face: an expression set by what they're doing, with blinks and a wandering
 * gaze when calm. Each look is built once and kept.
 */
export class FaceRig {
  readonly mesh: THREE.Mesh;
  private readonly built = new Map<string, THREE.BufferGeometry>();
  private readonly colors: Record<Kind, THREE.Color>;
  private expr: Expression = 'calm';
  private blinking = 0;
  private nextBlink = 1 + Math.random() * 3;
  private gaze: [number, number] = [0, 0];
  /** A held look (the tunnel staredown, phase 87): no random glances while set. */
  private held: [number, number] | null = null;
  private nextGaze = 1.5;
  private last = 0;
  private shown = '';

  constructor(
    private readonly look: CharacterLook,
    private readonly map: FaceMap,
    private readonly k: number,
    skin: THREE.Color,
    hair: THREE.Color,
    material: THREE.Material,
  ) {
    this.colors = palette(look, skin, hair);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.name = 'face';
    this.mesh.frustumCulled = false;
    this.draw();
  }

  get expression(): Expression {
    return this.expr;
  }

  /** Show this expression. */
  set(e: Expression): void {
    if (e === this.expr) return;
    this.expr = e;
    if (e !== 'calm') this.gaze = this.held ? [...this.held] : [0, 0];
    this.draw();
  }

  /** Hold the eyes one way (−1..1 across, −1..1 up and down), or let them wander again. */
  hold(gaze: [number, number] | null): void {
    this.held = gaze ? [Math.sign(gaze[0]), Math.sign(gaze[1])] : null;
    this.gaze = this.held ? [...this.held] : [0, 0];
    this.draw();
  }

  /** Close the eyes for a moment now. */
  blink(): void {
    this.blinking = 0.13;
    this.draw();
  }

  /** Blinks and glances; call every frame (it keeps its own clock when no step is given). */
  update(dt?: number): void {
    const now = performance.now() / 1000;
    const step = dt ?? Math.min(0.1, this.last ? now - this.last : 0);
    this.last = now;
    if (this.blinking > 0 && (this.blinking -= step) <= 0) this.draw();
    if ((this.nextBlink -= step) <= 0) {
      this.blink();
      // Now and then a double blink.
      this.nextBlink = Math.random() < 0.15 ? 0.3 : 2.2 + Math.random() * 3.6;
    }
    if (this.expr === 'calm' && !this.held && (this.nextGaze -= step) <= 0) {
      const r = Math.random();
      this.gaze = [r < 0.25 ? -1 : r < 0.5 ? 1 : 0, Math.random() < 0.15 ? -1 : 0];
      this.nextGaze = 1.2 + Math.random() * 2.6;
      this.draw();
    }
  }

  private draw(): void {
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

  dispose(): void {
    for (const g of this.built.values()) g.dispose();
    this.built.clear();
  }
}
