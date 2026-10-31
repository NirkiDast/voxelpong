import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { capsule, custom, ellipsoid, ribbon, superEllipsoid, roundBox, roundMax, Shape, smin, sphere, torus, type Prim, type V } from '../model/sdf';
import { DEFAULT_PALETTE, PAL, type Palette, type PaletteIndex } from '../voxel/palette';
import { FaceRig, type FaceMap } from './faceRig';
import { characterMaterial } from './material';
import { FINE, VOX, voxelGeometry, voxelize, VoxGrid, type VoxPart } from './voxelBody';
import type { Build, CharacterLook, Cut, FacialHair, GearLook, HairStyle, KitPattern } from './looks';

/**
 * Characters (remade after phase 23): smooth, cute sculpted players instead of voxels,
 * modelled on Nir's reference render. Every part is a signed distance field of soft
 * shapes (src/model/sdf.ts) meshed into a smooth surface and bound rigidly to one bone;
 * the face is a painted texture over the front of the head.
 *
 * Modelling units are centimetres; the model faces +z with its right side on −x.
 */
export const BONES = [
  'root',
  'hips',
  'torso',
  'head',
  'uArmR',
  'fArmR',
  'racket',
  'uArmL',
  'fArmL',
  'thighR',
  'shinR',
  'thighL',
  'shinL',
] as const;
export type BoneName = (typeof BONES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: 'root',
  torso: 'hips',
  head: 'torso',
  uArmR: 'torso',
  fArmR: 'uArmR',
  racket: 'fArmR',
  uArmL: 'torso',
  fArmL: 'uArmL',
  thighR: 'hips',
  shinR: 'thighR',
  thighL: 'hips',
  shinL: 'thighL',
};

const CM = 0.01;
/** Hip joint height (cm): the leg length. */
const HIP = 83;
/** Knee height (cm). */
const KNEE = 48;
/** The clips' root drops (crouches, lunges) were set for 60 cm legs. */
export const LIFT_SCALE = HIP / 60;
/** Height of the top of the head (with hair) in metres, for overhead UI. */
export const CHAR_HEIGHT = 1.76;

/** Body measurements (cm) by body shape. */
interface Frame {
  /** Shoulder joint x. */
  shoulder: number;
  /** Hip joint x. */
  hip: number;
  /** Neck base height. */
  neck: number;
  /** Shoulder joint height. */
  shoulderY: number;
  /** Limb thickness multiplier. */
  limb: number;
  /** Head size multiplier. */
  head: number;
}
const FRAMES: Record<'masc' | 'fem', Frame> = {
  masc: { shoulder: 17.2, hip: 8.9, neck: 134.4, shoulderY: 131.2, limb: 1.2, head: 0.92 },
  fem: { shoulder: 12.6, hip: 8.4, neck: 131.6, shoulderY: 129.4, limb: 1.04, head: 0.95 },
};

function pivots(f: Frame, w: number): Record<BoneName, V> {
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
    shinL: [leg, KNEE, 0],
  };
}

/** How wide each build is, as a multiple of regular (phase 20). */
/** Torso pivot height (cm): the waist. */
const TORSO = 101;

/**
 * Builds (phase 85), for both bodies: the frame's width (shoulders and hips), the waist,
 * the chest, limb thickness, glutes, a belly, and how much muscle definition shows.
 */
interface BuildSpec {
  w: number;
  waist: number;
  chest: number;
  limb: number;
  glute: number;
  belly: number;
  def: number;
}
const BUILDS: Record<Build, BuildSpec> = {
  lean: { w: 0.93, waist: 0.88, chest: 0.92, limb: 0.9, glute: 0.92, belly: 0, def: 1 },
  athletic: { w: 1, waist: 0.95, chest: 1.04, limb: 1, glute: 1, belly: 0, def: 0.85 },
  powerful: { w: 1.08, waist: 1.02, chest: 1.16, limb: 1.14, glute: 1.06, belly: 0, def: 0.9 },
  heavy: { w: 1.1, waist: 1.24, chest: 1.12, limb: 1.13, glute: 1.12, belly: 1, def: 0.2 },
};

/** The editor's Muscle slider (v71, 0..4, 2 is the old body) as a limb thickness multiplier. */
export const muscleScale = (m: number | undefined) => 1 + ((m ?? 2) - 2) * 0.085;

/** Muscle definition (phase 85): within a crease's half width, scaled by how defined the body is. */
function crease(c: Ctx, d: number, half: number, from = 0.45): boolean {
  return c.def > from && d < half * 1.45 * Math.min(1.4, c.def);
}
const defKey = (c: Ctx) => Math.round(c.def * 8) / 8;

/** Shirts with long sleeves, and shirts with no sleeves at all. */
const longSleeved = (cut: Cut) => cut === 'long' || cut === 'zip';
const sleeveless = (cut: Cut) => cut === 'tank' || cut === 'muscle' || cut === 'racerback' || cut === 'dress' || cut === 'racerdress';

export interface Rig {
  group: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  /** World position of the racket head centre, for effects. */
  racketHead(target: THREE.Vector3): THREE.Vector3;
  /** The moving face (phase 80); none on a bare skeleton. */
  face: FaceRig | null;
  dispose(): void;
}

/** Materials a part paints with; turned into colours from the look and gear. */
const enum M {
  Skin,
  Hair,
  Shirt,
  Trim,
  Bottom,
  Acc,
  White,
  ShoeAcc,
  Racket,
  Grip,
  RacketAcc,
  String,
  AccMark,
  Sock,
  SockMark,
  Eye,
  Lip,
  Brow,
  Stubble,
  // Branded gear (phase 27).
  Racket2,
  RacketText,
  StringLogo,
  Tape,
  Upper,
  Sole,
  Midsole,
  ShoeLogo,
  Logo,
  // v71: compression tights.
  Tights,
  // v75: clipped hair (fades, buzz cuts, between cornrows).
  Shaved,
  // Phase 63: strands of hair catching the light or in shadow, and the cloth's seams and prints.
  HairHi,
  HairLo,
  Seam,
  Pattern,
  /** A collar or placket standing proud of the shirt, in the shirt's colour. */
  Collar,
  // Phase 85: skin in the creases between muscles.
  SkinShade,
  // Phase 81: a beard's volume (painted into strands with the face), darker stubble, and grey.
  Beard,
  StubbleDark,
  Grey,
  GreyLo,
  GreyFuzz,
}

interface Part {
  shape: Shape;
  /** Cell size (cm): smaller for small, detailed parts. */
  h: number;
  /** Cell size at low detail, where the default (h × LO) would lose the part's detail. */
  lo?: number;
  /** Recolour by where a point is (local cm), given its shape's material. */
  paint?: (x: number, y: number, z: number, m: M) => M;
  /** Scale across (x, z) for the build. */
  wide?: [number, number];
  /** Extra triangles that aren't a field (racket strings). */
  extra?: () => THREE.BufferGeometry;
  /** The head: its front gets the face. */
  face?: boolean;
  /** Everything the shape depends on, to reuse its mesh. */
  key?: string;
  /** Uniform size (the head). */
  scale?: number;
}

/** What a part is drawn with. */
interface Ctx {
  l: CharacterLook;
  g: GearLook;
  f: Frame;
  w: number;
  fem: boolean;
  cut: Cut;
  skirt: boolean;
  /** v71: muscle (limb thickness ×) from the editor's slider, the bottoms and the socks. */
  mus: number;
  /** Phase 85: the build, and how strongly muscle definition is shaded (0 none .. ~1.5). */
  b: BuildSpec;
  def: number;
  bottom: 'shorts' | 'skirt' | 'long' | 'tights';
  socks: 'ankle' | 'crew' | 'high';
  /** Low detail: shapes that would alias at coarse cells are softened. */
  lo: boolean;
  /** Phase 63: a tennis dress (the top and skirt one piece in the shirt's colours), and the shirt's print. */
  dress: boolean;
  pattern?: KitPattern;
}

const cache = new Map<string, THREE.BufferGeometry>();
const EMPTY = new THREE.BufferGeometry();
for (const [name, n] of [['position', 3], ['normal', 3], ['color', 3], ['uv', 2], ['skinIndex', 4], ['skinWeight', 4]] as const)
  EMPTY.setAttribute(name, new THREE.Float32BufferAttribute([], n));
const CACHE_MAX = 24;

/**
 * Builds a character as one skinned mesh with rigid parts (GDD §10.4): every part is a
 * smooth sculpted surface bound 100% to one bone, so animation is part rotation. The
 * face texture is a second material on the same mesh.
 */
/**
 * How finely a character is built: 'hi' for close-ups (showroom, editor), 'lo' in
 * matches, 'none' for a skeleton with no surface yet (a view about to be dressed).
 */
export type Detail = 'hi' | 'lo' | 'none';

/** A built body as plain arrays, to hand between threads. */
export interface RigArrays {
  attrs: Array<[string, Float32Array | Uint16Array, number]>;
  index: Uint32Array;
  groups: Array<[number, number, number]>;
  /** Where the face's front is (phase 80). */
  face?: FaceMap;
}

/**
 * Detailed players (phase 64 setting): bodies in 1 cm blocks, or the lighter 2 cm ones
 * (a quarter of the triangles) for slower phones.
 */
let fine = true;
export function setFineDetail(on: boolean): void {
  fine = on;
}
export function fineDetail(): boolean {
  return fine;
}

const geoKey = (look: CharacterLook, gear: GearLook, detail: Detail) => JSON.stringify([look, gear, detail, fine]);

/** Whether this body is already built (so buildRig is quick). */
export function rigReady(look: CharacterLook, gear: GearLook, detail: Detail): boolean {
  return detail === 'none' || cache.has(geoKey(look, gear, detail));
}

/** Build a body's surface as arrays (in a worker). */
export function rigArrays(look: CharacterLook, gear: GearLook, detail: Detail): RigArrays {
  buildRig(look, gear, detail).dispose();
  const g = cache.get(geoKey(look, gear, detail))!;
  return {
    attrs: Object.entries(g.attributes).map(([n, a]) => [n, (a.array as Float32Array | Uint16Array).slice(), a.itemSize]),
    index: Uint32Array.from(g.index!.array),
    groups: g.groups.map((q) => [q.start, q.count, q.materialIndex ?? 0]),
    face: g.userData.face as FaceMap | undefined,
  };
}

/** Take a body built elsewhere (a worker) into the cache. */
export function adoptRig(look: CharacterLook, gear: GearLook, detail: Detail, a: RigArrays): void {
  const g = new THREE.BufferGeometry();
  for (const [n, arr, size] of a.attrs) g.setAttribute(n, new THREE.BufferAttribute(arr, size));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  for (const [s0, c0, m] of a.groups) g.addGroup(s0, c0, m);
  if (a.face) g.userData.face = a.face;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(geoKey(look, gear, detail), g);
}

/** Bone rotations the blocks are laid out in (the rig's bind pose). */
export type BakePose = Partial<Record<BoneName, V>>;

/**
 * The showroom stance, after Nir's references: feet wide, arms hanging a little out,
 * racket down in the right hand, head turned to the left. Close-ups are built in it, so
 * angled limbs are stepped blocks like the references rather than tilted grids.
 */
export const SHOWROOM_POSE: BakePose = {
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
  shinL: [0, 0, -0.07],
};

const BAKE_POSE: BakePose = Object.fromEntries(
  Object.entries(SHOWROOM_POSE).filter(([n]) => n !== 'head' && n !== 'torso' && n !== 'hips'),
);
// The racket has its own grid, laid out square to it (an even string lattice), and turns
// as one piece into the hand's angle.
{
  const e = (r: V | undefined) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...(r ?? [0, 0, 0])));
  const arm = e(BAKE_POSE.uArmR).multiply(e(BAKE_POSE.fArmR));
  const local = new THREE.Euler().setFromQuaternion(arm.invert());
  BAKE_POSE.racket = [local.x, local.y, local.z];
}

export function buildRig(look: CharacterLook, gear: GearLook, detail: Detail = 'hi', palette: Palette = DEFAULT_PALETTE): Rig {
  // Limbs are laid out at their display angles (so they step like the references); the
  // head and trunk stay square to the grid, so the face is clean, and turn as whole blocks.
  const pose: BakePose = detail === 'hi' ? BAKE_POSE : {};
  const fem = look.body === 'fem';
  const f = FRAMES[fem ? 'fem' : 'masc'];
  const b = BUILDS[look.build ?? 'athletic'] ?? BUILDS.athletic;
  const w = b.w;
  // A dress on a man's body is worn as its matching top (phase 63).
  const worn = gear.cut ?? 'tee';
  const dress = fem && (worn === 'dress' || worn === 'racerdress');
  const cut: Cut = !fem && worn === 'dress' ? 'tank' : !fem && worn === 'racerdress' ? 'racerback' : worn;
  const bottom = dress && look.bottom !== 'tights' ? 'skirt' : (look.bottom ?? 'shorts');
  const c: Ctx = {
    l: look,
    g: gear,
    f,
    w,
    fem,
    cut,
    skirt: bottom === 'skirt',
    mus: muscleScale(look.muscle) * b.limb,
    b,
    def: b.def * (0.55 + 0.225 * (look.muscle ?? 2)),
    bottom,
    socks: look.socks ?? 'crew',
    lo: true,
    dress,
    pattern: gear.kit?.pattern,
  };
  const PIVOT = pivots(f, w);
  const key = geoKey(look, gear, detail);
  let geo = detail === 'none' ? EMPTY : palette === DEFAULT_PALETTE ? cache.get(key) : undefined;
  if (!geo) {
    geo = buildGeometry(c, PIVOT, palette, pose);
    if (palette === DEFAULT_PALETTE) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      cache.set(key, geo);
    }
  }

  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = PIVOT[name];
    const parent = PARENT[name];
    const q = parent ? PIVOT[parent] : [0, 0, 0];
    b.position.set((p[0] - q[0]) * CM, (p[1] - q[1]) * CM, (p[2] - q[2]) * CM);
    if (parent) bones[parent].add(b);
    bones[name] = b;
  }
  const skeleton = new THREE.Skeleton(BONES.map((n) => bones[n]));
  const body = characterMaterial({ voxel: true });
  const mesh = new THREE.SkinnedMesh(geo, body);
  mesh.add(bones.root);
  // Bind in the pose the blocks were laid out in, then return to rest.
  for (const [name, r] of Object.entries(pose)) bones[name as BoneName].rotation.set(r[0], r[1], r[2]);
  mesh.updateMatrixWorld(true);
  mesh.bind(skeleton);
  for (const name of BONES) bones[name].rotation.set(0, 0, 0);
  mesh.updateMatrixWorld(true);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  // Blocks shade each other through their corner shading; cast shadows on them only add speckle.
  mesh.receiveShadow = false;
  mesh.name = 'character';
  // Taller or shorter players are the same model scaled (the editor's height, phase 20).
  mesh.scale.setScalar(look.height ?? 1);

  const group = new THREE.Group();
  group.add(mesh);
  const local = new THREE.Vector3(0, 0, RACKET_HEAD * CM);
  // The face rides on the head bone, laid over the blocks of its front.
  const map = geo.userData.face as FaceMap | undefined;
  const face = map && map.cells.length ? new FaceRig(look, map, f.head, palette.color(look.skin).clone(), palette.color(look.hair).clone(), body) : null;
  if (face) bones.head.add(face.mesh);
  return {
    group,
    bones,
    racketHead: (target) => target.copy(local).applyMatrix4(bones.racket.matrixWorld),
    face,
    dispose: () => {
      body.dispose();
      face?.dispose();
    },
  };
}

function buildGeometry(c: Ctx, PIVOT: Record<BoneName, V>, palette: Palette, pose: BakePose): THREE.BufferGeometry {
  const list: Array<[BoneName, Part]> = [
    ['hips', pelvis(c)],
    ['torso', torso(c)],
    ['head', head(c)],
    ['head', hair(c)],
    ['head', tail(c)],
    ['uArmR', upperArm(c)],
    ['fArmR', forearm(c, -1, true)],
    ['uArmL', upperArm(c)],
    ['fArmL', forearm(c, 1, false)],
    ['thighR', thigh(c, -1)],
    ['shinR', shin(c, -1)],
    ['thighL', thigh(c, 1)],
    ['shinL', shin(c, 1)],
    ['racket', racket(c)],
  ];
  // Each bone placed as in the pose (cm), so blocks are laid out world-aligned there.
  const place = {} as Record<BoneName, THREE.Object3D>;
  for (const name of BONES) {
    const o = new THREE.Object3D();
    const p = PIVOT[name];
    const parent = PARENT[name];
    const q = parent ? PIVOT[parent] : [0, 0, 0];
    o.position.set(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const r = pose[name];
    if (r) o.rotation.set(r[0], r[1], r[2]);
    if (parent) place[parent].add(o);
    place[name] = o;
  }
  place.root.updateMatrixWorld(true);
  const parts: VoxPart[] = list
    .filter(([, p]) => !p.shape.empty)
    .map(([bone, p]) => {
      const k = p.scale ?? 1;
      const [wx, wz] = p.wide ?? [1, 1];
      const m = place[bone].matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(k * wx, k, k * wz));
      return {
        shape: p.shape,
        bone: BONES.indexOf(bone),
        m: m.elements,
        s: k * Math.min(wx, 1, wz),
        paint: p.paint as VoxPart['paint'],
      };
    });
  const size = fine ? FINE : VOX;
  const key = JSON.stringify([list.map(([, p]) => p.key ?? ''), c.w, c.f.head, pose, size]);
  const racketBone = BONES.indexOf('racket');
  let grids = gridCache.get(key);
  if (!grids) {
    grids = [voxelize(parts.filter((p) => p.bone !== racketBone), size), voxelize(parts.filter((p) => p.bone === racketBone), VOX)];
    if (gridCache.size >= 12) gridCache.delete(gridCache.keys().next().value!);
    gridCache.set(key, grids);
  }
  const colors = materialColors(c, palette);
  const hp = new THREE.Vector3().setFromMatrixPosition(place.head.matrixWorld);
  const headAt: V = [hp.x, hp.y, hp.z];
  const headTurn = place.head.getWorldQuaternion(new THREE.Quaternion());
  const hk = c.f.head;
  const headBone = BONES.indexOf('head');
  const opts = {
    colors,
    unit: CM,
    sss: (m: number) => (m === M.Skin || m === M.Lip || m === M.Stubble || m === M.StubbleDark || m === M.GreyFuzz ? 0.45 : HAIRY.has(m) ? 0.35 : 0.12),
    vary: (m: number) => (HAIRY.has(m) ? 0.09 : m === M.Skin ? 0.02 : m === M.Eye ? 0 : 0.012),
  };
  let face: FaceMap | undefined;
  const body = voxelGeometry(grids[0], {
    ...opts,
    touch: (g) => {
      // A copy, so painting the face never changes the cached grid.
      const mats = g.mat.slice();
      face = paintFace(g, mats, headAt, headTurn, hk, headBone, c);
      return mats;
    },
  });
  const bat = voxelGeometry(grids[1], {
    ...opts,
    // The string bed: a lattice with a hole in every other block across the face (y, z).
    hole: (_i, j, k, m) => m === M.String && j % 2 !== 0 && k % 2 !== 0,
    // (The stencilled logo stays solid, so it reads.)
  });
  const geo = mergeGeometries([body, bat])!;
  if (face) geo.userData.face = face;
  body.dispose();
  bat.dispose();
  return geo;
}

const gridCache = new Map<string, [VoxGrid, VoxGrid]>();
/** Hair blocks: strands vary more and let more light through. */
const HAIRY = new Set<number>([M.Hair, M.HairHi, M.HairLo, M.Beard, M.Grey, M.GreyLo]);

/**
 * The front of the face. Eyes, brows and mouth are a separate layer that moves (phase 80,
 * faceRig.ts); here the skin blocks facing forward are recorded for it to sit on. Facial hair
 * (phase 81) is painted into the head's outer blocks: stubble dithered over the skin, shaped
 * styles in the hair's colour with soft edges, a beard's volume shaded into strands, and
 * grey creeping into hair, beard and stubble with age. Worked out in the head's own frame,
 * so it lands right whichever way the head was turned when the blocks were laid.
 */
function paintFace(g: VoxGrid, mats: Uint8Array, pivot: V, turn: THREE.Quaternion, k: number, headBone: number, c: Ctx): FaceMap {
  const back = turn.clone().invert();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
  // The grid axis closest to where the face looks: a face block is open that way.
  const ax = [Math.abs(fwd.x), Math.abs(fwd.y), Math.abs(fwd.z)];
  const a0 = ax.indexOf(Math.max(...ax));
  const step = [0, 0, 0];
  step[a0] = Math.sign(fwd.getComponent(a0));
  const v = new THREE.Vector3();
  const fh = c.l.facialHair ?? 'none';
  const grey = c.l.grey ?? 0;
  // At 2 cm blocks a dither reads as blotches: stubble goes to an even tint instead.
  const coarse = g.size > 1.5;
  const cells: number[] = [];
  const half = g.size / 2;
  for (let cc = 0; cc < g.nz; cc++)
    for (let b = 0; b < g.ny; b++)
      for (let a = 0; a < g.nx; a++) {
        const q = a + g.nx * (b + g.ny * cc);
        if (g.bone[q] !== headBone) continue;
        const m0 = g.mat[q];
        const skin = m0 === M.Skin;
        if (!skin && !HAIRY.has(m0) && m0 !== M.Shaved) continue;
        const i = a + g.i0, j = b + g.j0, kk = cc + g.k0;
        // Only the outer blocks show.
        if (g.filled(i + 1, j, kk) && g.filled(i - 1, j, kk) && g.filled(i, j + 1, kk) && g.filled(i, j - 1, kk) && g.filled(i, j, kk + 1) && g.filled(i, j, kk - 1)) continue;
        v.set(g.centre(i) - pivot[0], g.centre(j) - pivot[1], g.centre(kk) - pivot[2]).applyQuaternion(back);
        const x = v.x / k, y = v.y / k, z = v.z / k;
        const n = dither(i * 1.31, j * 0.77, kk * 1.13);
        let m = m0;
        if (skin) {
          if (v.z >= 4 * k && !g.filled(i + step[0], j + step[1], kk + step[2])) cells.push(v.x, v.y, v.z + half);
          m = facialHairAt(fh, x, y, z, n, coarse) ?? m;
        } else if (m0 === M.Beard) m = beardStrand(x, y, z, n);
        // Grey comes in clumps a couple of blocks across, not single specks.
        if (grey > 0 && m !== M.Skin) m = greyed(m, grey, x, y, z, 0.65 * dither(Math.floor(x / 1.6), Math.floor(y / 3.2), Math.floor(z / 1.6)) + 0.35 * dither(kk * 0.91, i * 1.7, j * 0.63));
        mats[q] = m;
      }
  return { size: g.size, cells: new Float32Array(cells) };
}

/** 0 at an edge, 1 at `w` cm inside it: soft borders for trimmed hair. */
const fade = (d: number, w: number) => Math.max(0, Math.min(1, d / w));

/**
 * How far (cm, head-part units) a point is inside the area a full beard grows on, negative
 * outside: under the cheekbone line from the sideburns down to the mouth's corners, in
 * front of the ears, round the jaw and a little way down the throat.
 */
function beardArea(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  // The cheek line: high at the sideburns, dropping to the corners of the moustache.
  const top = ax < 3 ? 13.9 : 13.9 + (ax - 3) * 0.45 + (z < 4 ? (4 - z) * 0.7 : 0);
  const sides = Math.min(top - y, z + 2.2);
  // The throat: fading out under the jaw.
  const low = y - (5.6 + Math.max(0, 3 - z) * 0.5);
  // The lips themselves stay bare.
  const lips = Math.max(Math.hypot(x / 3.3, (y - 11.4) / 0.9) - 1, 0) * 2;
  return Math.min(sides, low, z > 6 ? lips + 0.2 : 9);
}

/** The moustache's area: a band over the upper lip, drooping a little at the corners. */
function lipBand(x: number, y: number, lo: number, hi: number, w: number): number {
  const ax = Math.abs(x);
  const droop = Math.max(0, ax - 2.4) * 0.55;
  return Math.min(y - (lo - droop), hi - droop * 0.4 - y, w - ax);
}

/**
 * What a block of skin becomes under a facial hair style (head-part cm), or null where the
 * style leaves the skin bare. `n` is the block's own 0..1 for dithering.
 */
function facialHairAt(fh: FacialHair, x: number, y: number, z: number, n: number, coarse: boolean): M | null {
  if (fh === 'none' || z < -3) return null;
  const ax = Math.abs(x);
  const area = beardArea(x, y, z);
  // Stubble: a tint over the whole area, with darker hairs dithered in, fading at the edges.
  const stubble = (dense: number): M | null => {
    if (area <= 0) return null;
    const f = fade(area, 1.6) * (y < 8.4 ? fade(y - 5.6, 2.2) : 1);
    if (coarse) return f * dense > 0.45 ? (dense > 0.8 ? M.StubbleDark : M.Stubble) : null;
    if (n < f * dense * 0.85) return M.StubbleDark;
    // An even shadow over the core, breaking up towards the edges (and patchier when light).
    return f > (dense < 0.3 ? 0.6 : 0.35) || n < f * 1.6 ? M.Stubble : null;
  };
  // A shaped style: solid hair with a dithered rim `w` cm wide.
  const solid = (d: number, w = 0.6): M | null => (d <= 0 ? null : n < fade(d, w) * 1.05 ? (n < 0.18 ? M.HairLo : n > 0.86 ? M.HairHi : M.Hair) : n < 0.5 ? M.StubbleDark : null);
  const tache = () => (z > 6 ? solid(lipBand(x, y, 11.7, 14, 4.3), 0.5) : null);
  const chin = (w: number) => (z > 4 ? solid(Math.min(10.3 - y, w - ax * (1 + (10.3 - y) * 0.05), y - 7.4)) : null);
  switch (fh) {
    case 'light':
      return stubble(0.22);
    case 'stubble':
      return stubble(0.55);
    case 'heavy':
      return stubble(0.78);
    case 'moustache':
      return tache();
    case 'pencil':
      return z > 6 && ax > 0.5 ? solid(lipBand(x, y, 11.75, 12.6, 3.7), 0.3) : null;
    case 'horseshoe':
      // Down past the corners of the mouth to the jaw.
      return tache() ?? (z > 5 ? solid(Math.min(4.6 - ax, ax - 3.1, 13 - y, y - 8.6), 0.4) : null);
    case 'goatee':
      return tache() ?? chin(3.1) ?? (z > 6 ? solid(Math.min(4 - ax, 12.6 - y, y - 9.6), 0.5) : null);
    case 'soulpatch':
      return z > 6 ? solid(Math.min(2 - ax - Math.max(0, 9.6 - y) * 1.2, 10.7 - y, y - 8.2), 0.4) : null;
    case 'chinstrap': {
      if (area <= 0) return null;
      // Along the jawline, from the sideburns round the chin.
      const jaw = Math.max(9.4, 17.6 - (z + 1.5) * 0.72);
      return solid(Math.min(jaw + 1.5 - y, y - jaw + 3, area), 0.5);
    }
    case 'boxed':
    case 'beard':
    case 'longbeard': {
      // The volume covers the jaw; the cheeks above it and the throat below fade in stubble,
      // and the moustache is painted over the lip.
      return tache() ?? stubble(fh === 'boxed' ? 0.7 : 0.85);
    }
  }
  return null;
}

/** A beard's own blocks shaded into strands running down, darker underneath. */
function beardStrand(x: number, y: number, z: number, n: number): M {
  const u = x * 1.6 + Math.sin(y * 0.5) * 0.6;
  const f = u - Math.floor(u);
  const under = z < 4 && y < 10 ? 0.25 : 0;
  if (f < 0.28 + under || n < 0.12) return M.HairLo;
  if (f > 0.6 && f < 0.8 && n > 0.35) return M.HairHi;
  return M.Hair;
}

/**
 * Grey creeping in (phase 81): first at the temples and the chin, then everywhere. `grey`
 * is how far it has gone, 0..1; `n` the block's own 0..1.
 */
function greyed(m: M, grey: number, x: number, y: number, z: number, n: number): M {
  const ax = Math.abs(x);
  // Temples and sideburns first, then the beard's chin, then the crown last.
  const temple = ax > 7.5 && y > 14 && y < 26 && z > -6 ? 0.35 : 0;
  const chin = y < 12 && z > 2 ? 0.2 : 0;
  const crown = y > 30 ? -0.15 : 0;
  const p = Math.max(0, Math.min(1, grey * 0.95 + (temple + chin + crown) * Math.min(1, grey * 2.5)));
  if (n >= p) return m;
  switch (m) {
    case M.Hair:
    case M.HairHi:
    case M.Beard:
      // Salt and pepper: the first of it half grey, then silver.
      return n < p * 0.6 ? M.Grey : M.GreyLo;
    case M.HairLo:
      return M.GreyLo;
    case M.Stubble:
    case M.StubbleDark:
    case M.Shaved:
      return M.GreyFuzz;
  }
  return m;
}

/** Face texture space on the head part (cm): what the face painter draws into. */
export const FACE_BOX = { x0: -11, x1: 11, y0: 4, y1: 30 };

/** Grey hair for someone of this hair colour: silver with a trace of the old colour, `bright` 0..1. */
function greyOf(hair: THREE.Color, bright: number): THREE.Color {
  return new THREE.Color(0.8, 0.79, 0.77).multiplyScalar(bright).lerp(hair, 0.12);
}

function materialColors(c: Ctx, palette: Palette): Record<number, THREE.Color> {
  const { l, g } = c;
  const col = (i: PaletteIndex) => palette.color(i).clone();
  const shoeAcc = g.shoes !== PAL.white ? g.shoes : l.trim !== PAL.white ? l.trim : PAL.navy;
  const accMark = l.trim !== l.accessory ? l.trim : l.shirt !== l.accessory ? l.shirt : PAL.navy;
  const racketAcc = g.racket === PAL.white ? PAL.charcoal : PAL.white;
  const sockMark = l.trim !== PAL.white ? l.trim : l.shirt !== PAL.white ? l.shirt : PAL.navy;
  const out: Record<number, THREE.Color> = {
    [M.Skin]: col(l.skin),
    [M.SkinShade]: col(l.skin).multiplyScalar(0.76),
    [M.Hair]: col(l.hair),
    [M.Shirt]: col(l.shirt),
    [M.Trim]: col(l.trim),
    [M.Bottom]: col(l.shorts),
    [M.Acc]: col(l.accessory),
    [M.White]: col(PAL.white),
    [M.ShoeAcc]: col(shoeAcc),
    [M.Racket]: col(g.racket),
    [M.Grip]: col(g.grip),
    [M.RacketAcc]: col(racketAcc),
    [M.String]: col(PAL.offWhite),
    [M.AccMark]: col(accMark),
    [M.Sock]: col(PAL.white),
    [M.Tights]: col(PAL.charcoal),
    [M.SockMark]: col(sockMark),
    [M.Eye]: new THREE.Color(0x14204a),
    [M.Lip]: col(l.skin).multiply(new THREE.Color(0.86, 0.62, 0.6)),
    [M.Brow]: col(l.hair).multiplyScalar(0.7),
    [M.Stubble]: col(l.skin).lerp(col(l.hair), 0.3),
    [M.StubbleDark]: col(l.skin).lerp(col(l.hair), 0.7),
    [M.Beard]: col(l.hair),
    [M.Grey]: greyOf(col(l.hair), 0.92),
    [M.GreyLo]: col(l.hair).lerp(greyOf(col(l.hair), 0.85), 0.5),
    [M.GreyFuzz]: col(l.skin).lerp(greyOf(col(l.hair), 0.92), 0.45),
    [M.Shaved]: col(l.skin).lerp(col(l.hair), 0.5),
    [M.HairHi]: col(l.hair).multiplyScalar(1.17).lerp(new THREE.Color(1, 0.95, 0.88), 0.05),
    [M.HairLo]: col(l.hair).multiplyScalar(0.8),
    [M.Pattern]: col(l.trim),
  };
  // Branded gear: the real products' own colours.
  const hex = (v: number) => new THREE.Color(v);
  const rd = g.racketDesign;
  if (rd) {
    out[M.Racket] = hex(rd.frame);
    out[M.Racket2] = hex(rd.frame2);
    out[M.RacketAcc] = hex(rd.accent);
    out[M.RacketText] = hex(rd.text);
    out[M.StringLogo] = hex(rd.stencilColor);
  }
  if (g.wrap) {
    out[M.Grip] = hex(g.wrap.color);
    out[M.Tape] = hex(g.wrap.tape);
  }
  const sd = g.shoeDesign;
  if (sd) {
    out[M.Upper] = hex(sd.upper);
    out[M.Sole] = hex(sd.sole);
    out[M.Midsole] = hex(sd.mid);
    out[M.ShoeAcc] = hex(sd.accent);
    out[M.ShoeLogo] = hex(sd.logoColor);
  }
  if (g.kit) {
    out[M.Shirt] = hex(g.kit.shirt);
    out[M.Trim] = hex(g.kit.trim);
    out[M.Logo] = hex(g.kit.logoColor);
    out[M.Pattern] = hex(g.kit.pattern2 ?? g.kit.trim);
  }
  // Stitched seams: the shirt a shade darker (lighter on a dark shirt).
  {
    const sh = out[M.Shirt];
    const lum = 0.3 * sh.r + 0.59 * sh.g + 0.11 * sh.b;
    out[M.Collar] = sh.clone();
    out[M.Seam] = lum < 0.12 ? sh.clone().lerp(new THREE.Color(1, 1, 1), 0.12) : sh.clone().multiplyScalar(0.86);
  }
  // Toy-bright colours like the voxel references: deeper, more saturated tones.
  const hsl = { h: 0, s: 0, l: 0 };
  for (const k in out) {
    const cc = out[k];
    cc.getHSL(hsl);
    if (hsl.s > 0.15 && +k !== M.Skin && +k !== M.Lip) cc.setHSL(hsl.h, Math.min(1, hsl.s * 1.18), hsl.l * (hsl.l > 0.45 ? 0.94 : 1));
  }
  return out;
}

// ---------------------------------------------------------------- body parts

/** Hips: the shorts (or the top of the skirt), with the skirt flaring out from the waist. */
function pelvis(c: Ctx): Part {
  const s = new Shape();
  const r = c.fem ? 13.4 : 12;
  s.add(ellipsoid([0, 2, 0], [r, 10.5, 9.4]), M.Bottom);
  s.add(ellipsoid([0, 9, 0], [r - 1.6, 6, 8.4]), M.Bottom, 3);
  // Glutes (phase 85), fuller on a fem body and on bigger builds.
  const gl = c.b.glute;
  for (const sx of [-1, 1]) s.add(ellipsoid([sx * 5.4, 0.6, -4.4 - (gl - 1) * 4], c.fem ? [6.8, 7.6, 6.2 * gl] : [6.2, 7, 5.4 * gl]), M.Bottom, 3);
  if (c.skirt) s.add(skirt(10.8, c.lo), M.Bottom, 0.6);
  return {
    shape: s,
    h: 0.5,
    lo: 1.5,
    key: `pelvis:${c.fem}:${c.skirt}:${c.dress}:${c.pattern ?? ''}:${gl}`,
    wide: [c.w, 1],
    paint: (x, y, z, m) => {
      if (!c.skirt) {
        // A stripe down each side of the shorts, carrying on down the legs.
        return m === M.Bottom && Math.abs(x) > 11.6 && z > -3 && z < 3.2 ? M.Trim : m;
      }
      if (c.dress && m === M.Bottom) {
        // A dress's skirt: the shirt's colour and print, a trim band at the hem.
        if (y < -6.4) return M.Trim;
        return c.pattern && kitPrint(c.pattern, x, y + 12, z, 30) ? M.Pattern : M.Shirt;
      }
      // Two stripes along the hem, and one pleat in trim on the side.
      const hem = y < -7.4 || (y > -5.6 && y < -4.4);
      // One pleat panel on the left side in trim.
      const th = Math.atan2(x, z);
      return hem || (th > 0.98 && th < 1.33 && y < 9) ? M.Trim : m;
    },
  };
}

/** A pleated skirt: a thin flared shell from the waist to mid-thigh, open underneath. */
function skirt(waist: number, soft: boolean): Prim {
  const top = 12;
  const bottom = -7.5;
  return custom([0, 1, 0], 26, (x, y, z) => {
    const t = Math.min(1, Math.max(0, (top - y) / (top - bottom)));
    const a = Math.atan2(z, x);
    // Knife pleats that open toward the hem: each panel slants out, then folds back sharply.
    const u = (a * 18) / (2 * Math.PI);
    const f = u - Math.floor(u);
    // (Rounded folds at low detail, where sharp ones would break up.)
    const g = soft ? 0.5 - 0.5 * Math.cos(f * 2 * Math.PI) : f < 0.8 ? f / 0.8 : (1 - f) / 0.2;
    const pleat = 1 + (0.01 + 0.07 * t) * (g - 0.5);
    const rx = (waist + 8.5 * Math.pow(t, 0.85)) * pleat;
    const rz = (8.4 + 6.8 * Math.pow(t, 0.85)) * pleat;
    const e = (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz);
    // (Solid at low detail: a thin shell would fall apart between coarse cells.)
    const shell = soft ? e : Math.abs(e + 0.7) - 0.7;
    return roundMax(Math.max(shell, y - top), bottom - y, 0.3);
  });
}

/** Torso from the waist to the neck: a slim waist, ribcage, shoulders; the shirt painted by cut. */
function torso(c: Ctx): Part {
  const s = new Shape();
  const top = c.f.neck - TORSO;
  if (c.fem) {
    // A slim waist under a soft ribcage, sloping shoulders and a full, round bust.
    const { waist, chest, belly } = c.b;
    s.add(ellipsoid([0, 2.5, 0], [8.5 * waist, 7.5, 6.5 * waist]), M.Shirt);
    s.add(ellipsoid([0, 16.2, 0.1], [10.2 * Math.sqrt(chest), 10.4, 7.3 * Math.sqrt(chest)]), M.Shirt, 6);
    if (belly) s.add(ellipsoid([0, 5, 2.6], [8.8, 8, 7.6]), M.Shirt, 5);
    s.add(capsule([-8.8, top - 6.2, -0.6], [8.8, top - 6.2, -0.6], 3.8), M.Shirt, 5);
    for (const sx of [-1, 1]) s.add(capsule([sx * 3, top - 1.4, -0.8], [sx * 9.6, top - 5.4, -0.6], 2.6, 3.2), M.Shirt, 3);
    for (const sx of [-1, 1]) s.add(sphere([sx * 4.4, 19.2, 4.8], 5.1 * Math.sqrt(chest)), M.Shirt, 3);
    s.add(capsule([0, top - 6, -0.8], [0, top + 1, -0.6], 4.2, 3.7), M.Skin, 4);
  } else {
    // Phase 85: the waist narrower than the chest (a V), pecs under the shirt, a belly on a heavy build.
    const { waist, chest, belly } = c.b;
    s.add(ellipsoid([0, 3.5, 0], [10.4 * waist, 9, 7.6 * waist]), M.Shirt);
    s.add(roundBox([0, 15, 0.2], [12.8 * Math.sqrt(chest), 12, 9 * chest], 4.5), M.Shirt, 5);
    for (const sx of [-1, 1]) s.add(ellipsoid([sx * 5.4, 19.4, 6.4 * chest], [5.8, 4.4, 3.4 * chest]), M.Shirt, 3);
    if (belly) s.add(ellipsoid([0, 4.5, 3.4], [10.6, 8.8, 8.8]), M.Shirt, 5);
    const sh = c.f.shoulder - 3.6;
    s.add(capsule([-sh, top - 7.4, -0.6], [sh, top - 7.4, -0.6], 5.6), M.Shirt, 5);
    for (const sx of [-1, 1]) s.add(capsule([sx * 4.2, top - 1.4, -0.8], [sx * sh, top - 5.4, -0.6], 3.8, 4.6), M.Shirt, 4);
    s.add(capsule([0, top - 6, -0.8], [0, top + 1, -0.6], 4.8, 4.4), M.Skin, 3);
    // The shirt hangs out over the shorts.
    // (No deeper than the chest, so the front runs flat down to the hem: v75 fix for a
    // tummy 'pouch' where the hem stood out in a ledge.)
    if (!c.skirt) s.add(roundBox([0, -0.4, -0.2 + 1.6 * c.b.belly], [13 * Math.max(0.94, c.b.waist), 7.2, 8.6 * Math.max(0.94, c.b.waist)], 4), M.Shirt, 5);
  }
  // A thick waistband standing a little proud of the shirt (a dress under a skirt); a
  // shirt worn over shorts hangs loose over the hips instead.
  if (c.skirt) s.add(torus([0, 0.4, 0], (c.fem ? 8.1 : 10.1) * c.b.waist, 1.7, undefined, c.fem ? 0.8 : 0.78), M.Trim, 0.8);
  // Collars and plackets (phase 63): a layer of cloth one block proud of the shirt.
  const ops = s.near([0, 12, 0], 80);
  const cloth = (x: number, y: number, z: number) => s.eval(x, y, z, ops);
  if (c.cut === 'polo') s.add(collar(cloth, top, true), M.Collar, 0);
  // A dress's top is cut like a sleeveless crew neck, or a racerback.
  const cut: Cut = c.cut === 'dress' ? 'muscle' : c.cut === 'racerdress' ? 'racerback' : c.cut;
  const logo = c.g.kit?.logo;
  const pattern = c.pattern;
  // A dress runs on down into the skirt: no waistband, the shirt's colours all the way.
  const waistband = c.skirt && !c.dress;
  return {
    shape: s,
    h: 0.6,
    key: `torso:${c.fem}:${c.cut}:${logo ?? ''}:${pattern ?? ''}:${c.dress}:${c.l.build ?? ''}`,
    wide: [c.w, 1],
    paint: (x, y, z, m) => {
      if (m === M.Trim && !c.dress) return m;
      const ax = Math.abs(x);
      if (m === M.Collar) {
        // The collar's tipped edge and the placket's buttons.
        if (cut === 'polo' && (y > top + 0.4 || (z > 3 && y < top - 4.6 && ax > 1.6))) return M.Trim;
        if (z > 3 && ax < 1.2 && y < top - 2) return Math.round((y - top) / 2.4) % 2 === 0 && cut !== 'zip' ? M.White : cut === 'zip' ? M.Trim : M.Collar;
        return M.Collar;
      }
      // Waistband (a dress has a thin belt line in trim instead).
      if (waistband && y > -1.5 && y < 2.6) return M.Trim;
      if (c.dress && y > 0.2 && y < 1.6) return M.Trim;
      if (cut === 'tank') {
        // Bare shoulders and a scooped neck; straps edged in trim.
        const strap = c.fem ? 7.4 : 8.6;
        if (y > top - 12 && ax > strap + 3) return M.Skin;
        const scoop = z > 0 ? top - 8.5 : top - 4;
        if (ax < strap && y > scoop) return M.Skin;
        if (y > top - 12 && ax > strap) return M.Trim;
      } else if (cut === 'muscle') {
        // Sleeveless with a crew neck: deep armholes edged in trim.
        const hole = c.fem ? 9.4 : 11.4;
        const neckY = top - 3.4 - (z > 0 ? 2.4 * Math.max(0, 1 - (ax / 6.4) ** 2) : 0);
        if (ax < 7.5 && y > neckY + 1.2) return M.Skin;
        if (ax < 7.5 && y > neckY) return M.Trim;
        if (y > top - 14 && ax > hole + 1.2) return M.Skin;
        if (y > top - 14 && ax > hole) return M.Trim;
      } else if (cut === 'racerback') {
        // Thin straps at the front, meeting in a narrow Y between the shoulder blades.
        const strap = c.fem ? 6.6 : 7.8;
        const scoop = z > 0 ? top - 9 : top - 3;
        if (z > 0) {
          if (y > top - 12 && ax > strap + 2.6) return M.Skin;
          if (ax < strap && y > scoop) return M.Skin;
          if (y > top - 12 && ax > strap + 1.2) return M.Trim;
        } else {
          const half = 1.8 + Math.max(0, top - 2 - y) * 0.62;
          if (y > top - 15 && ax > half + 1.1) return M.Skin;
          if (y > top - 15 && ax > half) return M.Trim;
          if (y > top - 1.5) return M.Skin;
        }
      } else if (cut === 'vneck') {
        // A V at the front, edged in trim.
        const v = z > 0 ? (y - (top - 11)) * 0.62 : -1;
        const back = z <= 0 && ax < 7.5 && y > top - 3.4;
        if ((z > 0 && ax < v) || back) return M.Skin;
        if ((z > 0 && ax < v + 1.3 && y > top - 12) || (z <= 0 && ax < 7.5 && y > top - 4.6)) return M.Trim;
      } else {
        // Round or polo neck at the collar line.
        const neckY = top - 3.4 - (z > 0 ? 2.4 * Math.max(0, 1 - (ax / 6.4) ** 2) : 0);
        if (ax < 7.5 && y > neckY + 1.2) return M.Skin;
        if (ax < 7.5 && y > neckY) return M.Trim;
        if (cut === 'polo' && z > 3 && y > top - 10 && ax < 0.8 + (y - top + 10) * 0.3) return M.Trim;
        // A henley's buttoned placket.
        if (cut === 'henley' && z > 3 && y > top - 13 && ax < 1.4) return ax < 0.7 && Math.abs(((y - top) % 3.2) + 1.6) < 0.6 ? M.White : M.Seam;
        // A quarter zip down the front.
        if (cut === 'zip' && z > 3 && y > top - 17 && ax < 0.9) return M.Trim;
        // Raglan seams from the collar to under the arms.
        if (cut === 'raglan' && y > top - 13 && Math.abs(ax - (7.2 + (top - y) * 0.42)) < 1) return M.Trim;
      }
      // Side panels in trim, from under the arms down to the waistband (not on a print).
      const th = Math.abs(Math.atan2(x, z));
      if (!pattern && th > 1.15 && th < 1.65 && y < top - 8.5) return M.Trim;
      // A branded shirt's logo on the left of the chest.
      if (logo && m === M.Shirt && z > 2 && chestLogo(logo, x - 5.2, y - (top - 12))) return M.Logo;
      // Stitching (phase 63): over the shoulders, down the sides and round the hem.
      if (m === M.Shirt) {
        if (pattern && kitPrint(pattern, x, y, z, top)) return M.Pattern;
        if (y > top - 6 && ax > 7.5 && Math.abs(z + 0.6) < 0.5) return M.Seam;
        if (Math.abs(th - 1.62) < 0.05 && y < top - 9) return M.Seam;
        if (!c.skirt && Math.abs(y + 5.6) < 0.5) return M.Seam;
      }
      return m;
    },
  };
}

/** A chest logo around (0, 0) on the shirt front (cm; blocks are 2 cm, so marks are bold). */
function chestLogo(kind: string, x: number, y: number): boolean {
  const near = (ax: number, ay: number, bx: number, by: number, w: number) => seg2(x, y, ax, ay, bx, by) < w;
  switch (kind) {
    case 'swoosh':
      return near(-3, 1.4, -1, -1.4, 0.9) || near(-1, -1.4, 4, 1.8, 0.9);
    case 'stripes':
      return near(-2.6, -2, -2.6, 0, 0.75) || near(0, -2, 0, 1.4, 0.75) || near(2.6, -2, 2.6, 2.8, 0.75);
    case 'laurel':
      return Math.abs(Math.hypot(x, y) - 2.6) < 0.9 && y < 1.6;
    case 'ua':
      return near(-3, 2, -3, -1, 0.8) || near(-3, -1, 3, -1, 0.8) || near(3, 2, 3, -1, 0.8);
    case 'fila':
      return Math.abs(x) < 2.6 && Math.abs(y) < 2.2;
    case 'croc':
      // A small crocodile: a long low body and a snout.
      return (Math.abs(x) < 2.8 && Math.abs(y) < 0.9) || near(2.4, 0.2, 4.2, 0.8, 0.6);
    case 'w':
      return near(-3.2, 2, -1.6, -2, 0.7) || near(-1.6, -2, 0, 1, 0.7) || near(0, 1, 1.6, -2, 0.7) || near(1.6, -2, 3.2, 2, 0.7);
    default:
      return false;
  }
}

/**
 * Where a printed shirt shows its print (phase 63), in the shirt's local cm: 1 cm blocks
 * are fine enough for pinstripes, dots and chevrons.
 */
function kitPrint(kind: KitPattern, x: number, y: number, z: number, top = 30): boolean {
  const fr = (v: number) => v - Math.floor(v);
  // Round the body, so stripes keep their spacing on the sides.
  const u = Math.atan2(x, z) * 10;
  switch (kind) {
    case 'stripes':
      return fr(u / 4.4) < 0.36;
    case 'pinstripe':
      return fr(u / 3.2) < 0.2;
    case 'hoops':
      return fr(y / 6.5) < 0.38;
    case 'chevron':
      return fr((y + Math.abs(x) * 0.75) / 7) < 0.3;
    case 'dots': {
      const row = Math.floor(y / 4.2);
      const cu = u / 4.2 + (row % 2) * 0.5;
      return Math.hypot(fr(cu) - 0.5, fr(y / 4.2) - 0.5) < 0.24;
    }
    case 'fade':
      // Dithered in from the hem, thinning toward the chest.
      return dither(x, y, z) < (top - 10 - y) / 26;
    case 'block':
      return y > top - 15 && y < top - 8;
    case 'print':
      // Loose scribbled curves, like a tennis-ball seam print.
      return Math.abs(Math.sin(u * 0.55 + Math.sin(y * 0.3) * 1.6) + Math.sin(y * 0.42 - u * 0.2)) < 0.22;
    default:
      return false;
  }
}

/**
 * A collar one block proud of the shirt (phase 63): a band round the neck and, for a
 * polo, two pointed flaps folded down on the chest; a henley or zip gets only a short
 * standing band and the placket.
 */
function collar(cloth: (x: number, y: number, z: number) => number, top: number, flaps: boolean): Prim {
  return custom([0, top - 3, 2], 14, (x, y, z) => {
    const shell = cloth(x, y, z) - 1;
    const ax = Math.abs(x);
    // The band: round the neck at the collar line, narrower behind.
    const band = Math.max(Math.abs(y - (top - 0.6)) - 1.3, Math.hypot(x / 7.4, (z + 0.6) / 6.4) - 1);
    // The flaps: a triangle each side of the placket, pointing down and out.
    let flap = 1;
    if (flaps && z > 2) {
      const py = top - y;
      flap = Math.max(1.2 + py * 0.5 - ax, ax - (6.6 - py * 0.4), py - 6, -py - 0.2);
    }
    // The placket down the front.
    const placket = z > 2 ? Math.max(ax - 1.2, y - top + 1, top - (flaps ? 9.5 : 12) - y) : 1;
    return Math.max(shell, Math.min(band, flap, placket));
  });
}

/** Upper arm: shoulder cap, biceps, and the sleeve for the cut. */
function upperArm(c: Ctx): Part {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  s.add(capsule([0, 0, 0], [0, -25, 0], 3.5 * k, 2.85 * k), M.Skin);
  s.add(ellipsoid([0, -2.4, 0], [3.9 * k, 5, 3.8 * k]), M.Skin, 3);
  s.add(ellipsoid([0, -11.5, 0.5], [3.2 * k, 6.5, 3.2 * k]), M.Skin, 2.5);
  // Biceps in front and triceps behind (phase 85).
  s.add(ellipsoid([0, -12.8, 1.5], [3.1 * k, 5.6, 2.9 * k]), M.Skin, 2);
  s.add(ellipsoid([0, -9.5, -1.3], [3.2 * k, 7, 3 * k]), M.Skin, 2.5);
  if (longSleeved(c.cut)) s.add(capsule([0, 1, 0], [0, -24.5, 0], 5.6 * k, 4.3 * k), M.Shirt, 1);
  else if (!sleeveless(c.cut)) {
    // A fitted short sleeve over the shoulder.
    s.add(ellipsoid([0, -1.8, 0], [5 * k, 6.8, 4.8 * k]), M.Shirt, 1);
    s.add(capsule([0, -2, 0], [0, -10.2, 0.3], 4.5 * k, 4.2 * k), M.Shirt, 1.5);
  }
  const hem = longSleeved(c.cut) ? -99 : -8.6;
  // A raglan tee's sleeves are all in the trim colour.
  const raglan = c.cut === 'raglan';
  return {
    shape: s,
    h: 0.55,
    key: `uArm:${k}:${c.cut}:${c.pattern ?? ''}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, y, z, m) => {
      if (m === M.Skin) {
        // The deltoid's edge down the outside, and the line between biceps and triceps.
        const th = Math.abs(Math.atan2(x, z));
        if (crease(c, Math.abs(y + 8 + 1.2 * Math.cos(th)), 0.55) && th > 0.9) return M.SkinShade;
        if (y < -10 && y > -21 && crease(c, Math.abs(th - Math.PI / 2), 0.16)) return M.SkinShade;
        return m;
      }
      if (m !== M.Shirt) return m;
      if (raglan || y < hem) return M.Trim;
      if (c.pattern && c.pattern !== 'block' && c.pattern !== 'fade' && kitPrint(c.pattern, x, y + 20, z)) return M.Pattern;
      // Stitching just above the cuff.
      return Math.abs(y - hem - 1.2) < 0.5 ? M.Seam : m;
    },
  };
}

/** Forearm, wristband (with a small square on it) and a hand: closed round the grip, or relaxed. */
function forearm(c: Ctx, side: 1 | -1, holding: boolean): Part {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  s.add(capsule([0, 0, 0], [0, -19, 0.3], 2.9 * k, 2.2 * k), M.Skin);
  s.add(ellipsoid([0, -5, 0.4], [3.2 * k, 6.2, 3.0 * k]), M.Skin, 3);
  if (longSleeved(c.cut)) s.add(capsule([0, 0.5, 0], [0, -12, 0.2], 4.4 * k, 3.6 * k), M.Shirt, 1);
  // A chunky terry wristband.
  s.add(capsule([0, -13.8, 0.3], [0, -18.4, 0.3], 3.7 * k), M.Acc, 0.5);
  if (holding) {
    // Fist: palm, knuckles and a thumb wrapped over the grip.
    s.add(roundBox([0, -23.5, 1.2], [2.3, 3.4, 3.2], 1.8), M.Skin, 1.2);
    s.add(capsule([side * 1.6, -21, 2.4], [side * 0.6, -23.4, 4.4], 1.2, 1.0), M.Skin, 0.8);
  } else {
    // Relaxed hand: a flat palm, fingers curling in toward the leg, the thumb in front.
    const inn = -side;
    s.add(roundBox([0, -22.2, 0.6], [1.3, 2.9, 3.3], 1.2), M.Skin, 1.2);
    const fingers: Array<[number, number]> = [[2.3, 4.4], [0.8, 4.9], [-0.7, 4.6], [-2.1, 3.8]];
    for (const [zf, len] of fingers) {
      const a: V = [inn * 0.1, -24.4, zf + 0.6];
      const b: V = [inn * 0.6, -24.4 - len * 0.6, zf + 0.5];
      const e: V = [inn * 1.5, -24.4 - len * 0.95, zf + 0.4];
      s.add(capsule(a, b, 0.78, 0.7), M.Skin, 0.5);
      s.add(capsule(b, e, 0.7, 0.6), M.Skin, 0.4);
    }
    s.add(capsule([inn * 0.6, -21, 3.2], [inn * 1.2, -23.6, 4.6], 1.0, 0.85), M.Skin, 0.9);
    s.add(capsule([inn * 1.2, -23.6, 4.6], [inn * 1.6, -25.4, 4.5], 0.85, 0.7), M.Skin, 0.4);
  }
  return {
    shape: s,
    h: 0.4,
    key: `fArm:${side}:${holding}:${k}:${longSleeved(c.cut)}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, y, z, m) => {
      // The ridge of the forearm's top muscle (phase 85).
      if (m === M.Skin && y < -1.5 && y > -11 && crease(c, Math.abs(Math.atan2(x * side, z) - 1.15), 0.2)) return M.SkinShade;
      if (m === M.Shirt && y < -10.6) return M.Trim;
      if (m === M.Acc && z > 2.6 && Math.abs(x) < 1.5 && y < -14.9 && y > -17.4) return M.AccMark;
      return m;
    },
  };
}

/** Where the racket head's centre sits along the racket bone (cm). */
export const RACKET_HEAD = 38;
/** Racket pointing along +z from the hand: grip, butt cap, open throat, strung oval head. */
function racket(c: Ctx): Part {
  const d = c.g.racketDesign;
  const tape = !!c.g.wrap;
  const s = new Shape();
  s.add(capsule([0, 0, -2.6], [0, 0, 17], 1.45, 1.35), M.Grip);
  s.add(ellipsoid([0, 0, -3.2], [1.9, 1.9, 1.1]), M.RacketAcc, 0.5);
  s.add(capsule([0, 0, 16], [0, 0, 18.5], 1.5, 1.3), M.Racket, 0.6);
  for (const sy of [-1, 1]) s.add(capsule([0, 0, 18], [0, sy * 5.6, 26.5], 1.05, 0.95), M.Racket, 1.2);
  // Yonex's isometric head is squarer than the usual oval.
  const iso = d?.head === 'iso';
  const ry = iso ? 11.4 : 12;
  const rz = iso ? 15 : 15.6;
  const p = iso ? 2.7 : 2;
  const ring = (y: number, z: number) => ((Math.abs(y / ry) ** p + Math.abs((z - RACKET_HEAD) / rz) ** p) ** (1 / p) - 1) * Math.min(ry, rz);
  s.add(
    custom([0, 0, RACKET_HEAD], rz + 2, (x, y, z) => Math.hypot(ring(y, z), x * 1.2) - 1.7),
    M.Racket,
    1,
  );
  // The string bed (holes are punched in it block by block).
  s.add(
    custom([0, 0, RACKET_HEAD], rz, (x, y, z) => Math.max(ring(y, z) + 0.8, Math.abs(x) - 1.1)),
    M.String,
  );
  return {
    shape: s,
    h: 0.4,
    key: `racket:${d ? `${d.pattern}:${d.stencil}:${iso}` : ''}:${tape}`,
    paint: (x, y, z, m) => {
      // Overgrip with its finishing tape at the top.
      if (m === M.Grip) return tape && z > 14.6 ? M.Tape : m;
      if (m === M.String) return d && stencil(d.stencil, y, z - RACKET_HEAD) ? M.StringLogo : m;
      if (m !== M.Racket) return m;
      if (!d) {
        // White accents on the tip and the frame's shoulders.
        const tip = z > RACKET_HEAD + rz - 3.2;
        const shoulders = Math.abs(y) > ry - 2.5 && z > RACKET_HEAD - 7 && z < RACKET_HEAD - 1;
        return tip || shoulders ? M.RacketAcc : m;
      }
      // Where on the frame: 0 at the tip, 1 at the bottom of the head, beyond on the throat.
      const inHead = z > RACKET_HEAD - rz + 1.2;
      const t = inHead ? Math.abs(Math.atan2(y / ry, (z - RACKET_HEAD) / rz)) / Math.PI : 1.2;
      // The bridge, and the bands at three and nine o'clock.
      if (!inHead && z > 15.5 && z < 19) return M.RacketAcc;
      if (inHead && t > 0.47 && t < 0.53) return M.RacketAcc;
      // Lettering along the sides of the head (2 and 10 o'clock), block by block.
      const side = Math.abs(x) > 0.9;
      if (inHead && side && t > 0.28 && t < 0.42 && Math.floor((z + 100) / 2) % 3 !== 0) return M.RacketText;
      const checker = (Math.floor((y + 100) / 2) + Math.floor((z + 100) / 2)) % 2 === 0;
      switch (d.pattern) {
        case 'split':
          return t > 0.5 ? M.Racket2 : m;
        case 'throat':
          return !inHead || t > 0.85 ? M.Racket2 : m;
        case 'fade':
          // frame2 at the tip, dithered into the frame colour down the head.
          return t < 0.16 || (t < 0.3 && checker) ? M.Racket2 : m;
        default:
          return m;
      }
    },
    extra: () => strings(ry - 0.9, rz - 0.9),
  };
}

/** Brand stencils on the strings, 5×5 blocks (rows from the top of the head down). */
const STENCILS: Record<string, string[]> = {
  W: ['1...1', '1...1', '1.1.1', '11.11', '1...1'],
  B: ['1111.', '1...1', '1111.', '1...1', '1111.'],
  Y: ['1...1', '.1.1.', '..1..', '..1..', '..1..'],
  H: ['1...1', '1...1', '11111', '1...1', '1...1'],
};

/** Is string-bed point (y across, z from the head centre, cm) inside the stencil? */
function stencil(kind: string, y: number, z: number): boolean {
  const cell = 2;
  const col = Math.floor(y / cell + 2.5);
  const row = Math.floor(-z / cell + 2.5);
  if (col < 0 || col > 4 || row < 0 || row > 4) return false;
  return STENCILS[kind][row][col] === '1';
}

/** The string bed: thin crossed strings inside the head (plain geometry, not a field). */
function strings(ry: number, rz: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const t = 0.22;
  for (let y = -ry + 1.4; y < ry - 0.5; y += 1.55) {
    const half = rz * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
    const g = new THREE.BoxGeometry(t, t, half * 2);
    g.translate(0, y, RACKET_HEAD);
    parts.push(g);
  }
  for (let z = -rz + 1.5; z < rz - 0.5; z += 1.55) {
    const half = ry * Math.sqrt(Math.max(0, 1 - (z / rz) ** 2));
    const g = new THREE.BoxGeometry(t, half * 2, t);
    g.translate(0.05, 0, RACKET_HEAD + z);
    parts.push(g);
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const base = pos.length / 3;
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const gi = g.index!;
    for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** Thigh: strong, tapering to the knee, under the shorts' leg (bare under a skirt). */
function thigh(c: Ctx, side: 1 | -1): Part {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  // One clean taper, so the blocks step evenly down the leg.
  s.add(capsule([0, 2, 0], [0, -HIP + KNEE, 0.4], 7.4 * k, 4.6 * k), M.Skin);
  // Quads in front, the teardrop above the inside of the knee, hamstrings behind (phase 85).
  s.add(ellipsoid([0, -13, 2.2], [6.6 * k, 13, 5.4 * k]), M.Skin, 4);
  s.add(ellipsoid([-side * 2.6, -27, 2.2], [3.4 * k, 5, 3.2 * k]), M.Skin, 2.5);
  s.add(ellipsoid([0, -15, -2], [6 * k, 13, 5 * k]), M.Skin, 4);
  // Compression tights under the shorts, down past the knee (v71).
  if (c.bottom === 'tights') s.add(capsule([0, 2, 0], [0, -HIP + KNEE, 0.4], 7.4 * k + 0.5, 4.6 * k + 0.5), M.Tights, 0.4);
  // Long shorts reach the knee (v71); the usual ones stop mid-thigh.
  if (c.bottom === 'long') s.add(capsule([0, 4, 0], [0, -HIP + KNEE + 3, 0.3], 7.4 * k + 1.3, 5 * k + 1.7), M.Bottom, 0.6);
  else if (!c.skirt) s.add(capsule([0, 4, 0], [0, -10.5, 0.2], 7.4 * k + 1.3, 6.3 * k + 1.7), M.Bottom, 0.6);
  return {
    shape: s,
    h: 0.6,
    key: `thigh:${side}:${k}:${c.bottom}:${defKey(c)}`,
    wide: [Math.sqrt(c.w), Math.sqrt(c.w)],
    paint: (x, _y, _z, m) => {
      if (m === M.Skin) {
        // Where the quads meet the hamstrings down the outside, and the line over the knee.
        const th = Math.atan2(x * side, _z);
        if (_y < -4 && _y > -31 && crease(c, Math.abs(th - 1.75), 0.15)) return M.SkinShade;
        if (_z > 1 && crease(c, Math.abs(_y + 31.6 - 0.1 * x * x), 0.6)) return M.SkinShade;
        return m;
      }
      if (m !== M.Bottom) return m;
      // A trim hem and a stripe down the outside.
      if (x * side > 6.6 * k && Math.abs(_z) < 2.6 * k) return M.Trim;
      return m;
    },
  };
}

/** Knee, calf and shin; a crew sock with a small square, and a chunky trainer. */
function shin(c: Ctx, side: 1 | -1): Part {
  const k = c.f.limb * c.mus;
  const s = new Shape();
  const f = -KNEE;
  s.add(capsule([0, 0, 0.4], [0, f + 9, 0], 4.6 * k, 2.7 * k), M.Skin);
  s.add(ellipsoid([0, -1.4, 2.2], [3.1 * k, 3.2, 2.4 * k]), M.Skin, 2.5);
  s.add(ellipsoid([0.4 * side, -11, -1.8], [5.2 * k, 10.8, 5.2 * k]), M.Skin, 3);
  // Tights carry on over the knee and the top of the calf.
  if (c.bottom === 'tights') s.add(capsule([0, 2, 0.4], [0, -13, -0.8], 4.9 * k + 0.5, 5.4 * k + 0.4), M.Tights, 0.4);
  // Socks with a ribbed cuff: ankle, crew or high (v71).
  const sockTop = c.socks === 'ankle' ? 11.5 : c.socks === 'high' ? 31 : 23.6;
  const sockR = c.socks === 'high' ? 4.6 * k : 3.75 * k;
  s.add(capsule([0, f + sockTop, -0.1], [0, f + 8, 0.2], sockR, 3.4 * k), M.Sock, 0.4);
  s.add(capsule([0, f + sockTop - 1.2, -0.1], [0, f + sockTop + 1, -0.1], sockR + 0.25 * k), M.Sock, 0.3);
  // Trainer: a thick two-tone sole, a round toe box, a padded heel and collar, a tongue.
  s.add(
    custom([0, f + 1.8, 3.6], 15, (x, y, z) => {
      const t = Math.max(-1, Math.min(1, (z - 4.5) / 15));
      const rx = 6.6 + 0.6 * t;
      const e = (Math.hypot(x / rx, (z - 4.5) / 15.6) - 1) * rx;
      return roundMax(e, Math.abs(y - f - 2.1) - 2.1, 1.1);
    }),
    M.White,
  );
  s.add(ellipsoid([0, f + 5.8, 10.4], [6.3, 3.8, 7.4]), M.White, 2.4);
  s.add(ellipsoid([0, f + 7.6, 3.8], [6.1, 5.2, 7.2]), M.White, 2.2);
  s.add(ellipsoid([0, f + 7.6, -4.6], [5.9, 6, 5.6]), M.White, 2);
  s.add(torus([0, f + 10.2, -1.4], 3.7, 1.35, [0.25, 0, 0]), M.White, 1.2);
  s.add(ellipsoid([0, f + 10.2, 3.4], [2.6, 2.2, 2.6]), M.White, 1.4);
  const sd = c.g.shoeDesign;
  /** Distance in the side view (z, height) to the trim check on the trainer's side. */
  const check = (z: number, v: number) => Math.min(seg2(z, v, -1.4, 8.4, 3.2, 4.4), seg2(z, v, 3.2, 4.4, 10.4, 8)) - 1.2;
  return {
    shape: s,
    h: 0.5,
    key: `shin:${side}:${k}:${c.bottom}:${c.socks}:${sd?.logo ?? ''}:${defKey(c)}`,
    paint: (x, y, z, m) => {
      if (m === M.Skin) {
        // The calf's two heads from behind, and the edge of the shin bone in front (phase 85).
        const th = Math.atan2(x * side, z);
        if (y < -3 && y > -20 && (crease(c, Math.abs(th + 2.35), 0.17) || crease(c, Math.abs(th - 2.25), 0.14))) return M.SkinShade;
        if (y < -6 && y > -28 && crease(c, Math.abs(th + 0.3), 0.1, 0.8)) return M.SkinShade;
        return m;
      }
      if (m === M.Sock && x * side > 1.2 && z > 0.6 && y > f + sockTop - 6 && y < f + sockTop - 3.2) return M.SockMark;
      if (m !== M.White) return m;
      const v = y - f;
      if (sd) {
        // A real shoe: outsole, midsole, the brand's mark on both sides, the heel counter.
        if (v < 1.6) return M.Sole;
        if (v < 3.4) return M.Midsole;
        if (Math.abs(x) > 3.4 && shoeLogo(sd.logo, z, v)) return M.ShoeLogo;
        if (z < -6.4 && v > 5.6 && v < 10.5) return M.ShoeAcc;
        return M.Upper;
      }
      // Outsole, the check on both sides, and the heel counter.
      if (v < 2) return M.ShoeAcc;
      if (Math.abs(x) > 3.4 && v < 10 && check(z, v) < 0) return M.ShoeAcc;
      if (z < -6.4 && v > 5.6 && v < 10.5) return M.ShoeAcc;
      return m;
    },
  };
}

/**
 * The brand mark on a shoe's side, in the side view (z toe-ward, v up from the sole, cm):
 * Nike's swoosh, adidas' three stripes, the ASICS crossing stripes, New Balance's N.
 */
function shoeLogo(kind: string, z: number, v: number): boolean {
  const near = (ax: number, ay: number, bx: number, by: number, w: number) => seg2(z, v, ax, ay, bx, by) < w;
  switch (kind) {
    case 'swoosh':
      return Math.min(seg2(z, v, -5, 9.4, 1.6, 4.4), seg2(z, v, 1.6, 4.4, 12, 8.6)) < 1.1;
    case 'stripes':
      return [0, 1, 2].some((k) => near(0.6 + k * 4, 3.6, -3 + k * 4, 10.4, 0.75));
    case 'asics':
      return near(-6, 4.6, 8, 10, 0.8) || near(-4, 9.6, 7, 4, 0.8) || near(-2.4, 10.4, 9.4, 5.6, 0.7);
    case 'nb':
      return near(-1.5, 4.2, -1.5, 10, 0.95) || near(-1.5, 10, 4.5, 4.2, 0.95) || near(4.5, 4.2, 4.5, 10, 0.95);
    default:
      return false;
  }
}

/** Distance from (x, y) to the segment from (ax, ay) to (bx, by). */
function seg2(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

// ---------------------------------------------------------------- head

/** The cranium: hair and headwear are shaped around it. Head parts are modelled at this size and scaled by the frame's head size. */
const SKULL_C: V = [0, 22, 0];
const SKULL_R: V = [10.8, 13.2, 11.8];
/** The lower face: soft cheeks narrowing to the chin. */
const CHEEKS = superEllipsoid([0, 17.4, 2.6], [9.4, 8.8, 9.6], 4);

/** Head and neck: a big round cranium, soft cheeks, a small pointed chin, ears and a button nose. */
function head(c: Ctx): Part {
  const s = new Shape();
  const neck = c.fem ? 4 : 4.8;
  s.add(capsule([0, -6, -0.8], [0, 8, 0], neck + 0.2, neck), M.Skin);
  s.add(ellipsoid(SKULL_C, SKULL_R), M.Skin, 3);
  // A flat-fronted block face (clean rows of blocks, like the references), narrowing to the chin.
  s.add(roundBox([0, 17.8, 2.6], [9.6, 8.6, 9.8], 3.4), M.Skin, 3);
  s.add(roundBox([0, 11.6, 3.2], [c.fem ? 6.2 : 6.6, 2.8, 9.2], 2.4), M.Skin, 2);
  for (const sx of [-1, 1]) {
    s.add(ellipsoid([sx * 10.4, 17, -1.6], [1.4, 2.8, 2.1]), M.Skin, 1);
  }
  const fh = c.l.facialHair ?? 'none';
  const full = fh === 'boxed' || fh === 'beard' || fh === 'longbeard';
  if (full) s.add(beard(fh), M.Beard, 1.5);
  return { shape: s, h: 0.4, face: true, scale: c.f.head, key: `head:${c.fem}:${full ? fh : ''}` };
}

/**
 * A beard with volume along the jaw (phase 81): short and trimmed square (boxed), full,
 * or long, hanging below the chin. The cheeks above it fade out in stubble (paintFace).
 */
function beard(style: 'boxed' | 'beard' | 'longbeard'): Prim {
  const jaw = ellipsoid([0, 13.4, 2.4], [11, 11.4, 11.4]);
  const thick = style === 'boxed' ? 0.55 : 1.1;
  const top = style === 'boxed' ? 14.4 : 15;
  // The long beard's fall: a rounded wedge from the chin to the collarbones.
  const fall = ellipsoid([0, 6.2, 8.4], [6.2, 6.4, 4.4]);
  return custom([0, 10, 3], 16, (x, y, z) => {
    let d = jaw.d(x, y, z) - thick;
    if (style === 'longbeard') d = smin(d, fall.d(x, y, z), 2.5);
    // Only below the cheekbones and in front of the ears, leaving the lips clear.
    const lips = Math.hypot(x / 3.6, (y - 11) / 1.6) - 1;
    return Math.max(d, y - top + Math.max(0, 3.5 - Math.abs(x)) * 0.25, -z - 1, -lips * 1.5);
  });
}

/** Distance to the head's surface (skull and cheeks), hanging straight down below the skull's widest line. */
function headHang(x: number, y: number, z: number): number {
  return smin(skullHang(x, y, z), CHEEKS.d(x, y, z), 4.5);
}

/** Distance to the skull, continued straight down below its widest line so hair hangs. */
function skullHang(x: number, y: number, z: number): number {
  if (y >= SKULL_C[1]) {
    const px = x / SKULL_R[0];
    const py = (y - SKULL_C[1]) / SKULL_R[1];
    const pz = z / SKULL_R[2];
    const k0 = Math.hypot(px, py, pz);
    const k1 = Math.hypot(px / SKULL_R[0], py / SKULL_R[1], pz / SKULL_R[2]);
    return (k0 * (k0 - 1)) / k1;
  }
  return (Math.hypot(x / SKULL_R[0], z / SKULL_R[2]) - 1) * Math.min(SKULL_R[0], SKULL_R[2]);
}

const SKULL = ellipsoid(SKULL_C, SKULL_R);
const NECK = capsule([0, -6, -0.8], [0, 8, 0], 4.1, 3.9);
/** Distance to the head as it is (skull, cheeks, nape), for hair pulled back tight. */
function headFit(x: number, y: number, z: number): number {
  return smin(smin(SKULL.d(x, y, z), CHEEKS.d(x, y, z), 4.5), NECK.d(x, y, z), 6);
}

/** Centre the hair is laid out around. */
const HC: V = [0, 21, -0.5];
const outward = (p: V): V => {
  const d: V = [p[0] - HC[0], (p[1] - HC[1]) * 0.6, p[2] - HC[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** The point `off` cm out from the head at azimuth `th` (0 = front, + = the model's left) and elevation `el`. */
function onHead(th: number, el: number, off: number): V {
  const dir: V = [Math.sin(th) * Math.cos(el), Math.sin(el), Math.cos(th) * Math.cos(el)];
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

/** Catmull-Rom through values, `n` steps per span. */
function spline<T extends number[]>(pts: T[], n = 3): T[] {
  const out: T[] = [];
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
        p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as T,
      );
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * A lock of hair laid over the head: control points are [azimuth, elevation, offset,
 * half width, half thickness], smoothed into a flat strip that tapers to its tip.
 */
function lock(ctrl: Array<[number, number, number, number, number]>): Prim {
  const pts = spline(ctrl, 4);
  return ribbon(
    pts.map(([th, el, off]) => onHead(th, el, off)),
    pts.map((p) => p[3]),
    // Chunky, like sculpted toy hair.
    pts.map((p) => p[4] * 1.5),
    outward,
  );
}

/** Options for a hair cap. */
interface CapOpts {
  /** Grooves converge on this point (where hair is tied), or run from the crown. */
  tie?: V;
  grooves?: number;
  /** Extra thickness at the crown. */
  crown?: number;
  /** Pulled back tight against the head instead of hanging. */
  fit?: boolean;
  /** Cut straight across (a bob), not ending in clumps. */
  blunt?: boolean;
}

/** The hair hugging the head down to a hairline, thickest at the crown, grooved into clumps. */
function hairCap(base: (th: number) => number, thick: number, o: CapOpts = {}): Prim {
  const tie = o.tie;
  const g = o.grooves ?? 0.35;
  const crownK = o.crown ?? 0.6;
  return custom([0, 22, 0], 26, (x, y, z) => {
    const th = Math.atan2(x, z);
    let edge = base(th);
    // Hair hanging below the ears ends in uneven pointed clumps, not a straight cut (phase 63).
    if (edge < 16 && !o.blunt) edge -= Math.min(1, (16 - edge) / 6) * 2.6 * (0.5 + 0.5 * Math.cos(th * 9 + 0.7 * Math.sin(th * 4))) ** 3;
    const crown = Math.max(0, (y - 24) / 12);
    let phi: number;
    if (tie) {
      // Angle around the line from the head's centre through the tie.
      const ax = tie[0] - HC[0], ay = tie[1] - HC[1], az = tie[2] - HC[2];
      const al = Math.hypot(ax, ay, az);
      const vx = x - tie[0], vy = y - tie[1], vz = z - tie[2];
      const dot = (vx * ax + vy * ay + vz * az) / al;
      const qx = vx - (ax / al) * dot;
      const qy = vy - (ay / al) * dot;
      const qz = vz - (az / al) * dot;
      phi = Math.atan2(qx, qy * (az / al) - qz * (ay / al));
    } else phi = th;
    // Big clumps, and finer strands within them at 1 cm blocks (phase 63).
    const groove = g * (0.5 + 0.5 * Math.cos(phi * 11)) + (o.fit ? 0.18 : 0.45) * (0.5 + 0.5 * Math.cos(phi * 25 + 1.3));
    // Thin at the hairline so the hair grows out of the skin rather than ending in a step.
    const u = Math.min(1, Math.max(0, (y - edge) / 5));
    // Long hanging hair falls away from the head a little toward its ends, for volume (phase 63).
    const fall = o.fit ? 0 : Math.min(1.8, Math.max(0, 21 - y) * 0.11) * Math.min(1, Math.max(0, 16 - edge) / 6);
    const t = thick * (1 + crown * crown * crownK) + fall - groove * u;
    const taper = 0.12 + 0.88 * u * u * (3 - 2 * u);
    return roundMax((o.fit ? headFit(x, y, z) : headHang(x, y, z)) - t * taper, (edge - y) * 0.7, 0.6);
  });
}

/** Hairline heights all round: forehead, above the ears, the back. */
function hairline(front: number, ears: number, back: number): (th: number) => number {
  return (th) => {
    const a = Math.abs(th);
    const ss = (e0: number, e1: number) => {
      const t = Math.min(1, Math.max(0, (a - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    // Smoothly down from the forehead to above the ears, then down to the nape.
    // A little higher at the temples than mid-forehead.
    return front + 1.2 * Math.min(1, a) ** 2 + (ears - front - 1.2) * ss(1.0, 1.45) + (back - ears) * ss(1.85, 2.5);
  };
}

type LockPts = Array<[number, number, number, number, number]>;

/** Bangs swept across the forehead from a parting on the model's right, in thick clumps with pointed tips. */
const BANGS: LockPts[] = [
  [[-0.5, 0.9, 0.7, 3.6, 1.3], [-0.15, 0.66, 1.2, 4.6, 1.5], [0.25, 0.44, 1.3, 4.2, 1.4], [0.55, 0.28, 1.1, 3.0, 1.1], [0.78, 0.12, 1.0, 1.4, 0.8], [0.88, 0.02, 0.9, 0.3, 0.4]],
  [[-0.35, 0.95, 0.9, 3.4, 1.2], [0.0, 0.76, 1.3, 4.2, 1.3], [0.4, 0.58, 1.4, 3.6, 1.2], [0.68, 0.4, 1.3, 2.0, 0.9], [0.82, 0.26, 1.1, 0.4, 0.45]],
  [[-0.6, 0.9, 0.7, 3.0, 1.2], [-0.75, 0.64, 1.1, 3.2, 1.3], [-0.85, 0.4, 1.1, 2.2, 1.0], [-0.9, 0.22, 0.9, 0.4, 0.45]],
  [[-0.2, 0.86, 0.9, 3.2, 1.2], [0.0, 0.56, 1.4, 3.4, 1.3], [0.1, 0.3, 1.2, 2.0, 1.0], [0.14, 0.14, 1.0, 0.4, 0.45]],
];

/** Wavy locks falling in front of the ears to the jaw, flicking out at the tips. */
function sideLocks(sd: number): LockPts[] {
  const long = sd < 0 ? 1 : 0.9;
  return [
    [
      [sd * 1.0, 0.72, 0.6, 3.2, 1.2],
      [sd * 1.12, 0.42, 1.2, 3.8, 1.4],
      [sd * 1.2, 0.12, 1.6, 3.8, 1.4],
      [sd * 1.16, -0.18 * long, 1.6, 3.4, 1.3],
      [sd * 1.24, -0.46 * long, 2.2, 2.8, 1.1],
      [sd * 1.36, -0.66 * long, 3.2, 1.6, 0.8],
      [sd * 1.5, -0.74 * long, 4.4, 0.3, 0.4],
    ],
    [
      [sd * 1.3, 0.7, 0.6, 3.0, 1.1],
      [sd * 1.42, 0.36, 1.2, 3.4, 1.3],
      [sd * 1.5, 0.04, 1.8, 3.0, 1.2],
      [sd * 1.56, -0.26 * long, 2.4, 2.2, 1.0],
      [sd * 1.66, -0.44 * long, 3.4, 0.4, 0.45],
    ],
  ];
}


/**
 * A big ponytail like the reference's: from a high tie the hair rises, arcs back in one
 * thick rope, then falls past the shoulders as a fan of fat wavy clumps that swing out
 * and end in curled tips.
 */
function ponytail(s: Shape, tie: V): void {
  const [, ty, tz] = tie;
  // A big, puffy curly tail like the reference: it springs up out of the scrunchie, over
  // and down behind the head to about the jaw, as a cluster of round curls.
  const core: Array<[number, number, number, number]> = [
    [0, ty + 1.8, tz - 2.4, 4.4],
    [0, ty + 3.6, tz - 7.6, 5.8],
    [-1.6, ty + 1.6, tz - 13.4, 6.6],
    [2, ty - 2.8, tz - 16, 6.8],
    [-2.2, ty - 8, tz - 17, 6.6],
    [1.4, ty - 13, tz - 16.4, 6],
    [-0.8, ty - 17.6, tz - 15, 5],
    [1.2, ty - 21, tz - 13.4, 3.6],
  ];
  for (const [x, y, z, r] of core) s.add(sphere([x, y, z], r), M.Hair, 2.4);
  // The scrunchie.
  s.add(torus([0, ty + 0.4, tz - 0.6], 3.4, 1.5, [0.9, 0, 0]), M.AccMark, 0.3);
  // Curls bubbling out of the surface.
  for (let i = 0; i < 26; i++) {
    const [x, y, z, r] = core[1 + (i % (core.length - 1))];
    const a = i * 2.39996;
    const el = Math.sin(i * 1.7) * 0.9;
    const d = r * 0.92;
    s.add(sphere([x + Math.cos(a) * Math.cos(el) * d, y + Math.sin(el) * d, z + Math.sin(a) * Math.cos(el) * d * 0.8], 2.1 + (i % 3) * 0.5), M.Hair, 0.8);
  }
}

/** A smooth, straight ponytail: up out of the tie, then hanging down the back of the head. */
function sleekTail(s: Shape, tie: V): void {
  const [, ty, tz] = tie;
  const pts: Array<[V, number]> = [
    [[0, ty + 0.8, tz - 2], 3.4],
    [[0, ty + 0.6, tz - 6.4], 3.9],
    [[0, ty - 2.6, tz - 10], 4],
    [[0, ty - 8, tz - 10.8], 3.6],
    [[0, ty - 15, tz - 10.4], 3],
    [[0, ty - 21, tz - 9.4], 2.2],
    [[0, ty - 25.6, tz - 8.4], 0.8],
  ];
  for (let i = 0; i + 1 < pts.length; i++) s.add(capsule(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]), M.Hair, 1.6);
  s.add(torus([0, ty + 0.4, tz - 0.6], 3.4, 1.5, [0.9, 0, 0]), M.AccMark, 0.3);
}

/** A three-strand plait along a path: fat beads alternating side to side, tied at the end. */
function plait(s: Shape, path: V[], r: number): void {
  const pts = spline(path, 6);
  const n = pts.length;
  for (let i = 0; i < n - 1; i++) {
    const [x, y, z] = pts[i];
    const t = i / (n - 1);
    const side = i % 2 ? 1 : -1;
    const rr = r * (1 - 0.25 * t);
    s.add(ellipsoid([x + side * rr * 0.35, y, z], [rr, rr * 0.75, rr * 0.9]), M.Hair, 0.4);
  }
  const end = pts[n - 1];
  const prev = pts[n - 2];
  s.add(torus([prev[0], prev[1] - 0.6, prev[2]], r * 0.55, 0.9), M.AccMark, 0.2);
  // The loose end below the band.
  s.add(capsule([prev[0], prev[1] - 1.2, prev[2]], [end[0], end[1] - 2.4, end[2]], r * 0.8, r * 0.3), M.Hair, 0.6);
}

/** A bunch tied high behind one ear, springing out and curling down. */
function pigtail(s: Shape, sd: number): void {
  const tie: V = [sd * 10.4, 25, -6];
  const pts: Array<[V, number]> = [
    [[sd * 11.4, 25.6, -6.6], 2.8],
    [[sd * 14.2, 25, -7.4], 3.4],
    [[sd * 16, 21, -7.6], 3.2],
    [[sd * 16.4, 15.4, -7], 2.6],
    [[sd * 15.4, 10.6, -6.2], 1.6],
    [[sd * 14.6, 8.2, -5.6], 0.6],
  ];
  for (let i = 0; i + 1 < pts.length; i++) s.add(capsule(pts[i][0], pts[i + 1][0], pts[i][1], pts[i + 1][1]), M.Hair, 1.4);
  s.add(torus(tie, 2.6, 1.2, [0, 0, sd * 1.4]), M.AccMark, 0.3);
}

/** Where the ponytail is tied: high on the crown. */
const TIE: V = [0, 37.2, -6.4];

/** A ponytail is its own, coarser part: big soft shapes need fewer cells than bangs. */
function tail(c: Ctx): Part {
  const s = new Shape();
  const st = c.l.hairStyle;
  if (st === 'ponytail') ponytail(s, TIE);
  else if (st === 'sleek') sleekTail(s, TIE);
  else if (st === 'braid') plait(s, [[0, 19.5, -13.6], [0, 13, -14.6], [0, 4, -14.4], [0, -6, -13.6], [0, -12, -13]], 3);
  else if (st === 'twinbraids')
    for (const sd of [-1, 1]) plait(s, [[sd * 9.6, 17, -7.5], [sd * 11, 10, -6.6], [sd * 11.6, 4, -5.6], [sd * 12, -1.5, -4.6]], 2.4);
  else if (st === 'pigtails') for (const sd of [-1, 1]) pigtail(s, sd);
  // Strands round the tail's own line.
  const paint = (x: number, y: number, z: number, m: M) => (m === M.Hair ? strands(x, y, z, 0, -15, 18) : m);
  return { shape: s, h: 0.6, lo: 1.3, scale: c.f.head, key: `tail:${c.l.hairStyle}`, paint };
}

/** Hair, by style, and whatever is worn on the head. */
function hair(c: Ctx): Part {
  const s = new Shape();
  const l = c.l;
  const style = l.hairStyle;
  const wear = l.headwear ?? 'none';
  const cap = wear === 'cap';
  const locks = (ls: LockPts[], k = 0.8) => {
    for (const p of ls) s.add(lock(p), M.Hair, k);
  };
  /** A cone standing out of the head. */
  const spike = (th: number, el: number, len: number, r: number, tilt: number) => {
    const a = onHead(th, el, -0.4);
    const b = onHead(th, el + tilt, len);
    s.add(capsule(a, b, r, 0.25), M.Hair, 1.6);
  };
  /** Outer radius of the hair over the skull, for headwear. */
  let over = 2;
  switch (style) {
    case 'ponytail': {
      s.add(hairCap(hairline(27, 21.5, 9), 1.6, { tie: TIE, grooves: 0.22, crown: 0.15, fit: true }), M.Hair);
      locks(BANGS);
      // Side locks rounder and chunkier than the bangs.
      for (const sd of [-1, 1]) locks(sideLocks(sd).map((l) => l.map(([th, el, off, w, t]): LockPts[number] => [th, el, off, w * 0.9, t * 1.15])));
      over = 2.1;
      break;
    }
    case 'bun': {
      const top: V = [0, 35.6, -5.2];
      s.add(hairCap(hairline(27, 21.5, 9), 1.5, { tie: top, grooves: 0.4, fit: true }), M.Hair);
      locks(BANGS.slice(0, 2));
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 5)]);
      if (!cap) {
        // A round bun wound from a thick coil, tied with a scrunchie.
        s.add(ellipsoid([0, 39.2, -7.2], [5.6, 4.8, 5.6]), M.Hair, 2);
        s.add(torus([0, 40.6, -7.2], 3.4, 1.7, [-0.35, 0, 0]), M.Hair, 1.2);
        s.add(torus([0, 36, -5.8], 3.6, 1.2, [-0.35, 0, 0]), M.AccMark, 0.3);
      }
      over = 2;
      break;
    }
    case 'long':
      s.add(hairCap(hairline(26.5, 4, -13), 2.2, { grooves: 0.3 }), M.Hair);
      locks(BANGS);
      for (const sd of [-1, 1])
        locks([
          [[sd * 0.92, 0.74, 0.6, 3.0, 1.0], [sd * 1.02, 0.4, 1.2, 3.4, 1.1], [sd * 1.1, 0.0, 1.6, 3.4, 1.2], [sd * 1.12, -0.4, 2.2, 3.2, 1.2], [sd * 1.1, -0.8, 3, 2.4, 1.0], [sd * 1.06, -1.05, 3.6, 0.4, 0.5]],
        ]);
      over = 2.8;
      break;
    case 'bob':
      s.add(hairCap(hairline(25, 9, 8), 2.4, { grooves: 0.35, crown: 0.4, blunt: true }), M.Hair);
      locks([
        [[0.3, 0.9, 1, 3.4, 1.2], [0.1, 0.6, 1.6, 3.6, 1.2], [-0.05, 0.36, 1.4, 3.0, 1.0], [-0.12, 0.22, 1.0, 0.6, 0.6]],
        [[0.6, 0.86, 1, 3.2, 1.2], [0.48, 0.56, 1.6, 3.4, 1.2], [0.36, 0.32, 1.4, 2.6, 1.0], [0.3, 0.2, 1.0, 0.6, 0.6]],
        [[-0.2, 0.9, 1, 3.2, 1.2], [-0.34, 0.58, 1.6, 3.4, 1.2], [-0.46, 0.34, 1.4, 2.6, 1.0], [-0.52, 0.22, 1.0, 0.6, 0.6]],
      ]);
      over = 3.2;
      break;
    case 'afro': {
      const ball = ellipsoid([0, 26, -1.6], [16, 15, 15.6]);
      s.add(
        custom([0, 26, -1.6], 20, (x, y, z) => {
          const bumps = (Math.sin(x * 0.8 + 1) * Math.sin(y * 0.8) * Math.sin(z * 0.8 + 2)) * 0.8;
          return roundMax(ball.d(x, y, z) + bumps, 23.5 - y - Math.max(0, -z) * 1.2 + Math.max(0, z - 8) * 0.6, 1.2);
        }),
        M.Hair,
      );
      over = 5;
      break;
    }
    case 'mohawk':
      s.add(hairCap(hairline(26.5, 21.5, 12), 0.45, { grooves: 0, crown: 0 }), M.Hair);
      if (!cap) for (let i = 0; i < 7; i++) spike(0, 0.75 + i * 0.32, 7.5 - Math.abs(i - 2.5) * 0.7, 2.6, -0.2);
      over = 0.8;
      break;
    case 'spiky':
      s.add(hairCap(hairline(26, 21, 11), 1.3, { grooves: 0.2 }), M.Hair);
      if (!cap)
        for (const [th, el, len] of [[-0.5, 0.7, 4.4], [0, 0.75, 5], [0.5, 0.7, 4.4], [-1.0, 0.8, 4], [1.0, 0.8, 4], [-0.4, 1.15, 5.2], [0.4, 1.15, 5.2], [0, 1.45, 5.4], [-1.5, 1.05, 4.2], [1.5, 1.05, 4.2], [-2.3, 1.0, 4.4], [2.3, 1.0, 4.4], [3.14, 1.0, 4.6], [-2.8, 0.6, 4], [2.8, 0.6, 4]] as const)
          spike(th, el, len, 2.8, 0.3);
      locks([
        [[-0.3, 0.7, 0.8, 2.4, 1.0], [-0.4, 0.5, 1.2, 1.8, 0.9], [-0.5, 0.36, 1.1, 0.4, 0.5]],
        [[0.25, 0.7, 0.8, 2.4, 1.0], [0.3, 0.5, 1.2, 1.8, 0.9], [0.36, 0.38, 1.1, 0.4, 0.5]],
      ]);
      over = 2.2;
      break;
    case 'messy': {
      // Thick, tousled hair like the reference boy's: a full cap with chunky tufts
      // pointing every which way over the crown, poking out round the band.
      s.add(hairCap(hairline(25.5, 20.5, 10), 2, { grooves: 0.3 }), M.Hair);
      const jit = (i: number, k: number) => Math.sin(i * 12.9898 + k * 78.233) * 0.5;
      let i = 0;
      for (const [el, ring] of [[0.5, 7], [0.95, 6], [1.35, 3]] as const)
        for (let n = 0; n < ring; n++, i++) {
          const th = (n / ring) * 2 * Math.PI + el * 1.3 + jit(i, 4) * 0.4;
          // Shorter tufts low at the front, over the face.
          const front = Math.cos(th) > 0.5 && el < 0.7;
          const len = (cap ? 0.6 : front ? 5 : 7) + jit(i, 1) * 3;
          const a = onHead(th, el, 0.4);
          // Swept up and round to one side, like the reference's.
          const tip = onHead(th + 0.35 + jit(i, 2) * 0.5, el + 0.12 + jit(i, 3) * 0.35, len);
          s.add(capsule(a, tip, 2.6, 0.7), M.Hair, 0.4);
        }
      over = 3.2;
      break;
    }
    // ---- v75 men's styles.
    case 'buzz':
      s.add(hairCap(hairline(25, 20.5, 10), 0.7, { grooves: 0, crown: 0, fit: true }), M.Hair);
      over = 0.9;
      break;
    case 'fade':
      // Clipped short at the sides, fuller on top.
      s.add(hairCap(hairline(25.2, 20.5, 10), 0.55, { grooves: 0, crown: 0, fit: true }), M.Hair);
      s.add(hairCap(hairline(25.2, 27.5, 28), 3, { grooves: 0.4, crown: 0.2, fit: true }), M.Hair, 1);
      locks([
        [[0.2, 0.5, 0.8, 2.8, 1.0], [0.1, 0.42, 1.0, 2.4, 0.9], [0.0, 0.36, 0.8, 0.4, 0.45]],
        [[-0.25, 0.52, 0.8, 2.6, 1.0], [-0.35, 0.43, 1.0, 2.2, 0.9], [-0.45, 0.38, 0.8, 0.4, 0.45]],
      ]);
      over = 1.8;
      break;
    case 'quiff':
      // A fade with the front swept up and back in a big wave.
      s.add(hairCap(hairline(25.2, 20.5, 10), 0.55, { grooves: 0, crown: 0, fit: true }), M.Hair);
      s.add(hairCap(hairline(25.2, 28, 29), 1.8, { grooves: 0.3, crown: 0.2, fit: true }), M.Hair, 1);
      for (const th of [-0.5, -0.2, 0.1, 0.4])
        locks([[[th, 0.4, 0.8, 3.0, 1.2], [th * 0.9, 0.6, 4.6, 3.6, 1.6], [th * 0.8, 0.88, 6.2, 3.6, 1.6], [th * 0.7, 1.2, 4.6, 3.0, 1.3], [th * 0.6, 1.55, 1.6, 0.8, 0.6]]], 1.2);
      over = 2.4;
      break;
    case 'sidepart':
      // Neat and short, parted on the model's left and combed across.
      s.add(hairCap(hairline(25, 20.5, 10.5), 1.4, { grooves: 0.2, crown: 0.3, fit: true }), M.Hair);
      for (const [el, off] of [[1.15, 1.6], [0.92, 1.8], [0.7, 1.6]] as const)
        locks([[[0.62, el + 0.08, 0.8, 2.8, 1.0], [0.3, el, off, 3.6, 1.2], [-0.1, el - 0.08, off + 0.2, 3.6, 1.2], [-0.5, el - 0.2, off, 3.0, 1.1], [-0.85, el - 0.3, 1.0, 0.8, 0.6]]]);
      over = 2;
      break;
    case 'slick': {
      // Combed straight back from the forehead.
      s.add(hairCap(hairline(25, 20.5, 9.5), 1.6, { tie: [0, 20, -16], grooves: 0.45, crown: 0.2, fit: true }), M.Hair);
      for (const th of [-0.55, -0.2, 0.15, 0.5])
        locks([[[th, 0.42, 0.6, 2.6, 1.0], [th * 0.95, 0.9, 1.6, 3.2, 1.2], [th * 0.85, 1.45, 1.8, 3.2, 1.2], [th * 0.7, 2.0, 1.4, 2.6, 1.0], [th * 0.6, 2.45, 0.8, 0.8, 0.6]]]);
      over = 2;
      break;
    }
    case 'manbun':
      // Pulled back into a bun at the back of the head.
      s.add(hairCap(hairline(25, 20.5, 10), 1.4, { tie: [0, 31, -9], grooves: 0.45, fit: true }), M.Hair);
      for (const th of [-0.45, 0, 0.45]) locks([[[th, 0.42, 0.6, 2.6, 1.0], [th * 0.9, 0.95, 1.4, 3.0, 1.1], [th * 0.7, 1.5, 1.3, 2.6, 1.0], [th * 0.5, 1.9, 0.8, 0.8, 0.6]]]);
      if (!cap) {
        s.add(ellipsoid([0, 32, -11.8], [4.8, 4.4, 4.4]), M.Hair, 1.6);
        s.add(torus([0, 31.4, -9.6], 3.2, 1.2, [1.1, 0, 0]), M.AccMark, 0.3);
      }
      over = 2;
      break;
    case 'curtains':
      // Parted in the middle, falling either side of the forehead like curtains.
      s.add(hairCap(hairline(25.5, 17.5, 8.5), 2, { grooves: 0.3, crown: 0.3 }), M.Hair);
      for (const sd of [-1, 1])
        locks([
          [[sd * 0.06, 1.0, 1.0, 3.2, 1.2], [sd * 0.3, 0.76, 1.7, 3.8, 1.3], [sd * 0.55, 0.5, 1.8, 3.4, 1.2], [sd * 0.78, 0.3, 1.5, 2.2, 0.9], [sd * 0.9, 0.16, 1.1, 0.4, 0.45]],
          [[sd * 0.2, 1.1, 1.0, 3.0, 1.1], [sd * 0.55, 0.9, 1.6, 3.4, 1.2], [sd * 0.85, 0.62, 1.7, 3.0, 1.1], [sd * 1.05, 0.38, 1.4, 1.6, 0.8], [sd * 1.15, 0.24, 1.0, 0.4, 0.45]],
        ]);
      over = 2.6;
      break;
    case 'curly': {
      // Short tight curls piled on top.
      s.add(hairCap(hairline(25.2, 20.5, 10), 1.6, { grooves: 0, crown: 0.4, fit: true }), M.Hair);
      if (!cap)
        for (let i = 0; i < 46; i++) {
          const th = i * 2.39996;
          const el = 0.45 + 1.1 * Math.sqrt(((i * 0.618) % 1));
          // Not low over the ears.
          if (el < 0.7 && Math.abs(Math.sin(th)) > 0.75) continue;
          s.add(sphere(onHead(th, el, 1.6), 2.3 + (i % 3) * 0.3), M.Hair, 0.5);
        }
      over = 3;
      break;
    }
    case 'flow':
      // Swept back and down to the collar, flicking out at the ends.
      s.add(hairCap(hairline(25.5, 13, -3), 2.2, { grooves: 0.35, crown: 0.3 }), M.Hair);
      for (const th of [-0.5, -0.15, 0.2, 0.55])
        locks([[[th, 0.45, 0.8, 2.8, 1.1], [th * 1.1, 0.95, 1.8, 3.4, 1.3], [th * 1.2, 1.5, 2, 3.4, 1.3], [th * 1.3, 2.1, 1.8, 3, 1.2]]]);
      for (const sd of [-1, 1])
        locks([[[sd * 1.5, 0.5, 1.6, 3.4, 1.2], [sd * 1.75, 0.0, 2.2, 3.6, 1.3], [sd * 1.9, -0.45, 2.8, 3.0, 1.1], [sd * 2.05, -0.62, 4, 0.5, 0.5]], [[sd * 2.4, 0.4, 1.8, 3.4, 1.2], [sd * 2.5, -0.1, 2.4, 3.6, 1.3], [sd * 2.6, -0.5, 3.0, 2.6, 1.0], [sd * 2.7, -0.66, 4.2, 0.5, 0.5]]]);
      over = 2.8;
      break;
    case 'locs': {
      // Thick round locs from all over the head, hanging to the shoulders.
      s.add(hairCap(hairline(25.5, 20.5, 10), 1.1, { grooves: 0.3, crown: 0.3, fit: true }), M.Hair);
      const n = 12;
      for (let i = 0; i < n; i++) {
        const th = 1.25 + (i / (n - 1)) * (2 * Math.PI - 2.5);
        const back = Math.max(0, -Math.cos(th));
        const len = -0.8 - 0.3 * back + Math.sin(i * 7.7) * 0.08;
        locks([[[th * 0.9, 1.2, 0.8, 1.3, 1.1], [th, 0.7, 2.0, 1.4, 1.2], [th * 1.02, 0.1, 2.6, 1.4, 1.2], [th * 1.03, len * 0.6, 3.0, 1.35, 1.15], [th * 1.04, len, 3.2, 1.0, 0.9]]], 0);
      }
      // A few swept over the top and back.
      for (const th of [-0.4, 0.05, 0.5]) locks([[[th, 0.45, 0.8, 1.3, 1.1], [th + 0.05, 0.95, 2.2, 1.4, 1.2], [th + 0.1, 1.5, 2.4, 1.4, 1.2], [th + 0.1, 2.1, 2.2, 1.3, 1.1]]], 0);
      over = 3;
      break;
    }
    case 'cornrows':
      // Tight braided rows running back from the hairline.
      s.add(hairCap(hairline(25.5, 20.5, 10), 1.3, { tie: [0, 16, -14], grooves: 1.1, crown: 0, fit: true }), M.Hair);
      over = 1.2;
      break;
    case 'bald':
      over = 0;
      break;

    // ---- v75 women's styles.
    case 'pixie':
      s.add(hairCap(hairline(25, 19.5, 9), 1.6, { grooves: 0.3, crown: 0.5, fit: true }), M.Hair);
      locks(BANGS.slice(0, 2).map((l) => l.map(([th, el, off, w, t]): LockPts[number] => [th, el, off, w * 0.95, t])));
      for (const sd of [-1, 1]) locks([[[sd * 1.1, 0.6, 0.6, 2.6, 1.0], [sd * 1.2, 0.36, 1.0, 2.4, 0.9], [sd * 1.28, 0.18, 0.9, 0.4, 0.45]]]);
      over = 2;
      break;
    case 'lob':
      // A long bob: straight to the shoulders, cut blunt, with a side parting.
      s.add(hairCap(hairline(25.5, 4, 0), 2.4, { grooves: 0.3, crown: 0.35, blunt: true }), M.Hair);
      locks(BANGS.slice(0, 3));
      for (const sd of [-1, 1])
        locks([[[sd * 0.95, 0.74, 0.6, 3.0, 1.0], [sd * 1.05, 0.36, 1.2, 3.4, 1.2], [sd * 1.1, -0.1, 1.8, 3.4, 1.2], [sd * 1.12, -0.5, 2.4, 3.2, 1.2], [sd * 1.14, -0.68, 2.8, 2.6, 1.0]]]);
      over = 3;
      break;
    case 'waves':
      // Long and wavy, past the shoulders.
      s.add(hairCap(hairline(26.5, 2, -16), 2.4, { grooves: 0.45 }), M.Hair);
      locks(BANGS.slice(0, 2));
      for (const sd of [-1, 1])
        for (const [th0, k] of [[0.95, 1], [1.35, 0.95], [2.0, 0.9]] as const)
          locks([[[sd * th0, 0.74, 0.6, 3.0, 1.0], [sd * (th0 + 0.08), 0.35, 1.6, 3.4, 1.2], [sd * (th0 - 0.04), 0.0, 2.6, 3.6, 1.3], [sd * (th0 + 0.1), -0.35 * k, 2.0, 3.4, 1.3], [sd * (th0 - 0.02), -0.7 * k, 3.0, 3.0, 1.2], [sd * (th0 + 0.08), -0.95 * k, 2.6, 2.2, 1.0], [sd * th0, -1.1 * k, 3.2, 0.4, 0.5]]]);
      over = 3;
      break;
    case 'curls': {
      // A big mane of ringlets down past the shoulders.
      s.add(hairCap(hairline(26, 4, -10), 2.6, { grooves: 0.2, crown: 0.4 }), M.Hair);
      locks(BANGS.slice(0, 2));
      for (let i = 0; i < 70; i++) {
        const side = i % 2 ? 1 : -1;
        const th = side * (0.95 + ((i * 0.618) % 1) * 2.2);
        const el = 0.9 - ((i * 0.381) % 1) * 1.95;
        s.add(sphere(onHead(th, el, 2.6), 2.4 + (i % 3) * 0.35), M.Hair, 0.5);
      }
      over = 3.6;
      break;
    }
    case 'sleek':
      // Scraped back into a smooth high ponytail.
      s.add(hairCap(hairline(26.5, 21.5, 9), 1.4, { tie: TIE, grooves: 0.3, crown: 0.1, fit: true }), M.Hair);
      over = 1.6;
      break;
    case 'braid':
      // Pulled back into one plait down the back.
      s.add(hairCap(hairline(26.5, 21, 9), 1.5, { tie: [0, 20, -13], grooves: 0.4, crown: 0.2, fit: true }), M.Hair);
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 4)]);
      over = 1.8;
      break;
    case 'twinbraids':
      // Parted in the middle into two plaits behind the ears.
      s.add(hairCap(hairline(26.5, 20, 8), 1.5, { grooves: 0.35, crown: 0.1, fit: true }), M.Hair);
      for (const sd of [-1, 1]) locks([[[sd * 0.05, 1.05, 0.8, 3.0, 1.1], [sd * 0.4, 0.8, 1.2, 3.4, 1.2], [sd * 0.8, 0.55, 1.2, 3.0, 1.1], [sd * 1.2, 0.36, 1.0, 1.6, 0.8]]]);
      over = 1.8;
      break;
    case 'pigtails':
      s.add(hairCap(hairline(26, 20.5, 9), 1.6, { grooves: 0.3, crown: 0.2, fit: true }), M.Hair);
      locks(BANGS.slice(0, 2));
      over = 2;
      break;
    case 'topknot':
      s.add(hairCap(hairline(26.5, 21, 9), 1.4, { tie: [0, 36, -1], grooves: 0.4, fit: true }), M.Hair);
      for (const sd of [-1, 1]) locks([sideLocks(sd)[0].slice(0, 5)]);
      if (!cap) {
        s.add(ellipsoid([0, 39.6, -1.2], [5, 4.2, 5]), M.Hair, 1.8);
        s.add(torus([0, 41, -1.2], 3, 1.6), M.Hair, 1);
        s.add(torus([0, 36.6, -1.1], 3.4, 1.1), M.AccMark, 0.3);
      }
      over = 1.8;
      break;
    case 'spacebuns':
      s.add(hairCap(hairline(26, 20.5, 9), 1.5, { grooves: 0.3, fit: true }), M.Hair);
      locks(BANGS.slice(0, 2));
      if (!cap)
        for (const sd of [-1, 1]) {
          s.add(ellipsoid([sd * 8.2, 36, -3], [4.2, 4, 4.2]), M.Hair, 1.6);
          s.add(torus([sd * 8.2, 37.3, -3], 2.6, 1.3, [0, 0, -sd * 0.5]), M.Hair, 1);
        }
      over = 1.8;
      break;
    case 'puff': {
      // An afro puff: pulled back to one big round puff at the back of the crown.
      s.add(hairCap(hairline(26, 20.5, 9), 1.5, { tie: [0, 33, -9], grooves: 0.4, fit: true }), M.Hair);
      if (!cap) {
        const ball = ellipsoid([0, 36, -13], [8.4, 7.6, 7.6]);
        s.add(custom([0, 36, -13], 11, (x, y, z) => ball.d(x, y, z) + Math.sin(x * 0.9 + 1) * Math.sin(y * 0.9) * Math.sin(z * 0.9 + 2) * 0.7), M.Hair, 1.5);
        s.add(torus([0, 33, -9.2], 3.6, 1.2, [0.9, 0, 0]), M.AccMark, 0.3);
      }
      over = 2;
      break;
    }

    case 'crop':
    default:
      s.add(hairCap(hairline(24.6, 21, 11), 1.1, { grooves: 0.25, crown: 0.5, fit: true }), M.Hair);
      locks([
        [[0.3, 0.8, 0.6, 2.6, 0.9], [0.18, 0.6, 0.9, 2.4, 0.8], [0.06, 0.46, 0.8, 0.4, 0.45]],
        [[-0.2, 0.8, 0.6, 2.6, 0.9], [-0.3, 0.6, 0.9, 2.4, 0.8], [-0.42, 0.47, 0.8, 0.4, 0.45]],
        [[0.7, 0.78, 0.6, 2.4, 0.9], [0.62, 0.58, 0.9, 2.2, 0.8], [0.52, 0.47, 0.8, 0.4, 0.45]],
      ]);
      over = 1.6;
      break;
  }

  // Headwear in the accessory colour, with a small mark on the front. It sits on
  // whatever is outermost, the hair or the head, so it never floats or sinks in.
  const hairOps = s.near([0, 22, 0], 80);
  const outer = (x: number, y: number, z: number) => Math.min(headHang(x, y, z) - 0.3, s.eval(x, y, z, hairOps));
  const tilt = wear === 'visor' ? 0 : wear === 'headband' ? 0.08 : 0.2;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // Half the thickness of bands and brims (thicker at low detail, so coarse cells keep them whole).
  const thin = c.lo ? 0.8 : 0.5;
  // A ring hugging the head, tipped at the front by `tilt`: its radius all round is
  // found once from the outermost surface (hair or head) and smoothed, so it neither
  // floats nor follows every lock.
  const band = (y0: number, height: number, half = thin) => {
    const N = 72;
    // Visors hug the hair over the skull, ignoring locks that hang loose at the sides; a
    // headband sits close on the head, with tufts springing out round it.
    const o = wear === 'headband' ? (x: number, y: number, z: number) => headHang(x, y, z) - 0.6 : outer;
    // The surface's radius all round at the band's bottom, middle and top, so the band
    // follows the curve of the head instead of standing off it like a bucket.
    const levels = [-0.85, 0, 0.85];
    const rads = levels.map((lv) => {
      let rad = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const th = (i / N) * 2 * Math.PI;
        const sx = Math.sin(th);
        const sz = Math.cos(th);
        let r = 30;
        for (; r > 4; r -= 0.2) {
          const z = sz * r;
          const yc = y0 - (z * st) / ct;
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
      let f = ((Math.atan2(x, z) / (2 * Math.PI) + 1) % 1) * N;
      const i0 = Math.floor(f) % N;
      f -= Math.floor(f);
      const at = (k: number) => rads[k][i0] * (1 - f) + rads[k][(i0 + 1) % N] * f;
      // A curve through the three radii.
      const u = Math.max(-1.2, Math.min(1.2, py / (0.85 * height)));
      const r0 = at(0), r1 = at(1), r2 = at(2);
      const r = r1 + ((r2 - r0) / 2) * u + ((r0 + r2) / 2 - r1) * u * u;
      const e = Math.hypot(x, z) - r - 0.05 - half;
      // Full height at the front, narrower round the back.
      const hgt = height * (0.6 + 0.4 * Math.max(0, z / Math.max(1, Math.hypot(x, z))));
      return roundMax(Math.abs(e) - half, Math.abs(py) - hgt, Math.min(0.9, half * 0.9)) * 0.8;
    });
  };
  let markY = 0;
  if (wear === 'visor' || wear === 'headband') {
    // The visor's band is tall and padded, like the reference's.
    const y0 = wear === 'visor' ? 30 : 27;
    const hh = wear === 'visor' ? 3.2 : 2.2;
    s.add(band(y0, hh, wear === 'visor' ? 1.6 : 1.2), M.Acc, 0.3);
    markY = y0 - Math.tan(tilt) * 13.5;
    if (wear === 'visor') s.add(brim(markY - hh + 1.2, SKULL_R[2] + over - 1.5, 0, 1.15), M.Acc, 0);
  } else if (wear === 'cap') {
    // A round crown over the head and anything the hair pushes out, down to a line tipped at the back.
    s.add(
      custom([0, 26, -0.5], 24, (x, y, z) => {
        const cut = 25 - y + z * 0.2;
        return roundMax(Math.min(headHang(x, y, z) - over - 0.6, outer(x, y, z) - 0.7), cut, 0.5);
      }),
      M.Acc,
      0,
    );
    s.add(brim(26.2, SKULL_R[2] + over - 0.6, 0.12, thin * 1.3), M.Acc, 1.2);
    markY = 31;
  }
  return {
    shape: s,
    h: 0.4,
    lo: 1.05,
    scale: c.f.head,
    key: `hair:${style}:${wear}`,
    paint: (x, y, z, m) => {
      if (m === M.Hair) return hairPaint(style, x, y, z);
      if (m !== M.Acc || wear === 'none') return m;
      if (wear === 'cap') return z > 8 && Math.abs(x) < 3 && Math.abs(y - markY) < 2.2 ? M.AccMark : m;
      if (z > 8 && z < SKULL_R[2] + over + 4 && x > 1.6 && x < 7.4 && Math.abs(y - markY - 0.6) < 1.7) return M.AccMark;
      return m;
    },
  };
}

/** A curved brim sticking out over the forehead from `front`, tipped down by `tilt`. */
/** A steady 0..1 per block, for dithered fades. */
const dither = (x: number, y: number, z: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/**
 * Markings that make a style read at block size (v75): clipped sides on fades, a parting,
 * combed grooves, the scalp between cornrows.
 */
/**
 * Strands (phase 63): at 1 cm blocks hair shows its strands, streaks of lighter and darker
 * hair running out from the crown and down, broken up so they read as hair, not stripes.
 * `cx`, `cz` is the axis the strands run round (the crown, or a tail's own line).
 */
function strands(x: number, y: number, z: number, cx = 0, cz = -2, n = 26): number {
  const az = Math.atan2(x - cx, z - cz);
  // A gentle wave along each strand.
  const u = (az / (2 * Math.PI)) * n + 0.35 * Math.sin(y * 0.33 + az * 3);
  const i = Math.floor(u);
  const f = u - i;
  // Each strand comes and goes along its length.
  const seg = dither(i * 1.7, Math.floor(y / 7 + (i % 3) / 3), 0.37);
  if (f < 0.3 && seg < 0.85) return M.HairLo;
  if (f > 0.5 && f < 0.76 && seg > 0.3) return M.HairHi;
  return M.Hair;
}

function hairPaint(style: HairStyle, x: number, y: number, z: number): number {
  const hairAt = () => strands(x, y, z);
  switch (style) {
    case 'buzz':
      // Stubble-short hair: a dark haze over the scalp, a little denser on top.
      return dither(Math.floor(x), Math.floor(y), Math.floor(z)) < 0.42 + Math.max(0, y - 28) * 0.03 ? M.HairLo : M.Shaved;
    case 'fade':
    case 'quiff': {
      // Clipped below the temples, blending into the longer top.
      const t = (y - 24) / 4 + (z < -6 ? -0.3 : 0);
      if (t >= 1) return hairAt();
      return t <= 0 || dither(x, y, z) > t ? M.Shaved : M.Hair;
    }
    case 'sidepart': {
      const th = Math.atan2(x, z);
      return y > 28 && z > -4 && Math.abs(th - 0.62) < 0.1 ? M.Shaved : hairAt();
    }
    case 'curtains':
      return y > 29 && z > 2 && Math.abs(x) < 0.8 ? M.Shaved : hairAt();
    case 'slick':
    case 'manbun':
    case 'sleek':
      // Comb lines running back.
      return y > 25 && ((x + 101) % 3.2) < 0.7 ? M.HairLo : y > 25 && ((x + 101) % 3.2) > 1.9 && ((x + 101) % 3.2) < 2.5 ? M.HairHi : hairAt();
    case 'cornrows': {
      // Rows fanning back from the hairline, scalp between them.
      const u = (Math.atan2(x, y - 12) * 9) / Math.PI;
      return u - Math.floor(u) < 0.3 ? M.Shaved : u - Math.floor(u) > 0.62 && u - Math.floor(u) < 0.75 ? M.HairHi : M.Hair;
    }
    case 'braid':
    case 'twinbraids':
    case 'topknot':
    case 'spacebuns':
    case 'puff':
      return y > 25 && ((x + 101) % 3.4) < 0.7 ? M.HairLo : hairAt();
    default:
      return hairAt();
  }
}

function brim(y0: number, front: number, tilt: number, half: number): Prim {
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return custom([0, y0, front + 2], 16, (x, y, z) => {
    const dz = z - front + 5.4;
    const py = (y - y0) * ct + dz * st;
    const pz = -(y - y0) * st + dz * ct;
    // Flat, so it is one even layer of blocks.
    const bend = 0;
    const e = (Math.hypot(x / 12.6, (pz + 3.2) / 15.5) - 1) * 12;
    // Only in front: the sides end where they meet the band.
    const back = 1.4 - pz;
    return roundMax(roundMax(e, back, 2), Math.abs(py + bend) - half, half * 0.95);
  });
}
