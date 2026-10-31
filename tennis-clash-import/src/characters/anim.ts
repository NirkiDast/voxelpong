import * as THREE from 'three';
import { BONES, SHOWROOM_POSE, type BoneName } from './rig';

/** Joint rotations (Euler XYZ, radians) plus a vertical root offset in metres. */
export type Pose = { lift: number } & Record<BoneName, [number, number, number]>;
export type PoseEdit = Partial<Omit<Pose, 'lift'>> & { lift?: number };

export type ClipName =
  | 'idle'
  | 'showroom'
  | 'ready'
  | 'run'
  | 'walk'
  | 'sidestep'
  | 'forehand'
  | 'backhand'
  | 'backhand1'
  | 'volleyFh'
  | 'volleyBh'
  | 'smash'
  | 'serveReady'
  | 'serveToss'
  | 'serve'
  | 'splitStep'
  | 'celebrate'
  | 'celebrate2'
  | 'celebrate3'
  | 'celebrateLoop'
  | 'dejected'
  | 'dejected2'
  | 'dejectedLoop'
  | 'tired'
  | 'press'
  | 'clench'
  | 'shakeHead'
  | 'winWave'
  | 'waveLoop'
  | 'winRoar'
  | 'roarLoop'
  | 'winArms'
  | 'armsUpLoop'
  | 'winKneel'
  | 'kneelLoop'
  | 'winLie'
  | 'lieLoop'
  | 'winDisbelief'
  | 'disbeliefLoop'
  | 'loseCrouch'
  | 'crouchLoop'
  | 'loseHips'
  | 'hipsLoop'
  | 'racketSmash';

export interface Clip {
  duration: number;
  loop: boolean;
  keys: Array<{ t: number; pose: Pose; hold?: boolean }>;
  /** When the racket meets the ball; swings start here so contact lands on the hit frame. */
  contact?: number;
}

/*
 * Conventions (model faces +z, right arm on −x, limbs hang down):
 * - arm or leg x < 0 swings it forward and up; forearm x < 0 bends the elbow forward
 * - right arm z < 0 lifts it out to the side (left arm: z > 0)
 * - torso or root y < 0 turns the right shoulder back
 * - racket points forward from the hand; racket x < 0 tips its head up, y > 0 across to the left
 */

export function restPose(): Pose {
  const p = { lift: 0 } as Pose;
  for (const b of BONES) p[b] = [0, 0, 0];
  return p;
}

export function pose(base: Pose, edit: PoseEdit): Pose {
  const p = { ...base } as Pose;
  for (const b of BONES) p[b] = [...base[b]] as [number, number, number];
  for (const [k, v] of Object.entries(edit)) {
    if (k === 'lift') p.lift = v as number;
    else p[k as BoneName] = [...(v as [number, number, number])];
  }
  return p;
}

/** Feet apart, knees bent, racket up in front with the free hand on the throat. */
const READY = pose(restPose(), {
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
  fArmL: [-1.0, 0, 0],
});

const IDLE = pose(restPose(), {
  torso: [0.05, 0, 0],
  uArmR: [-0.15, 0, -0.1],
  fArmR: [-0.5, 0, 0],
  racket: [1.1, 0, 0],
  uArmL: [0, 0, 0.1],
  fArmL: [-0.3, 0, 0],
});

/**
 * Between points (phase 62): standing easy, knees soft, the racket held up in front with
 * its head tipped up and across, and the free hand cradling the throat (solved with
 * tests/_ik.test.ts so the hand really sits on it).
 */
const STANCE = pose(IDLE, {
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
  fArmL: [-1.106, -0.02, -0.051],
});

/**
 * The showroom stance, after Nir's reference: feet wide, weight even, arms hanging a
 * little out from the body, racket down in the right hand, head turned to her left.
 */
const SHOWROOM = pose(restPose(), { lift: -0.018, ...SHOWROOM_POSE });

/** At the press conference desk: a slight lean, forearms resting on the table, hands together. */
const PRESS = pose(restPose(), {
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
  fArmL: [-1.35, 0, 0],
});

function clip(duration: number, loop: boolean, keys: Array<[number, Pose]>, contact?: number): Clip {
  return { duration, loop, contact, keys: keys.map(([t, p]) => ({ t, pose: p })) };
}

/**
 * The other foot's half of a stride: legs swap sides (mirrored), hips and shoulders
 * twist the other way, and the arms swap their swing (each keeps its own hand).
 */
function stride(p: Pose): Pose {
  const m = (r: R3): R3 => [r[0], -r[1], -r[2]];
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
    fArmL: [p.fArmR[0], p.fArmL[1], p.fArmL[2]],
  });
}

// Run: a four-beat stride per foot (reach, load, drive, float), leaning into the run,
// hips and shoulders twisting against each other and the arms pumping with the legs.
const RUN_BODY = pose(READY, {
  head: [-0.3, 0, 0],
  racket: [0.35, 0.15, 0],
});
const RUN_REACH = pose(RUN_BODY, {
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
  fArmL: [-1.45, 0, 0],
});
const RUN_LOAD = pose(RUN_REACH, {
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
  fArmL: [-1.4, 0, 0],
});
const RUN_DRIVE = pose(RUN_REACH, {
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
  fArmL: [-1.05, 0, 0],
});
const RUN_FLOAT = pose(RUN_DRIVE, {
  lift: 0.09,
  hips: [0, -0.14, 0],
  torso: [0.34, 0.24, 0],
  thighR: [0.7, 0, -0.04],
  shinR: [1.35, 0, 0],
  thighL: [-1.0, 0, 0.04],
  shinL: [0.55, 0, 0],
  uArmR: [-0.65, 0, -0.18],
  fArmR: [-1.45, 0, 0],
  uArmL: [0.6, 0, 0.18],
  fArmL: [-1.0, 0, 0],
});

/**
 * Walking on court (phase 61, the intro's walk-out): upright, heel down with the leg
 * nearly straight, the free arm swinging against it, the racket carried easy at the side.
 */
const WALK_CONTACT = pose(IDLE, {
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
  fArmL: [-0.35, 0, 0],
});
const WALK_PASS = pose(WALK_CONTACT, {
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
  fArmL: [-0.32, 0, 0],
});

const WIDE = pose(READY, { thighR: [-0.4, 0, -0.38], thighL: [-0.4, 0, 0.38], shinR: [0.7, 0, 0], shinL: [0.7, 0, 0], lift: -0.07 });
const NARROW = pose(READY, { thighR: [-0.35, 0, -0.04], thighL: [-0.35, 0, 0.04], lift: -0.01 });

/**
 * Turn the hips by `yaw` while the legs keep the angles given in `p` relative to the
 * court, so the feet stay planted as the body coils and uncoils.
 */
function hipTurn(p: Pose, yaw: number, pitch = 0): Pose {
  const out = pose(p, { hips: [pitch, yaw, 0] });
  const undo = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0)).invert();
  for (const b of ['thighR', 'thighL'] as const) {
    const q = undo.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p[b])));
    const e = new THREE.Euler().setFromQuaternion(q);
    out[b] = [e.x, e.y, e.z];
  }
  return out;
}

const euler = (r: [number, number, number]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
const unit = (v: [number, number, number]) => new THREE.Vector3(...v).normalize();

/**
 * Point the racket along `dir` (in the character's own frame: +z toward the net, −x the
 * racket side, +y up) with its strings facing as near to `face` as the shaft allows,
 * whatever the arm is doing, by solving its wrist angle back through the chain.
 */
function aim(p: Pose, dir: [number, number, number], face: [number, number, number]): Pose {
  const chain = euler(p.root).multiply(euler(p.hips)).multiply(euler(p.torso)).multiply(euler(p.uArmR)).multiply(euler(p.fArmR));
  const z = unit(dir);
  const x = unit(face).addScaledVector(z, -unit(face).dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const want = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  const e = new THREE.Euler().setFromQuaternion(chain.invert().multiply(want));
  return pose(p, { racket: [e.x, e.y, e.z] });
}

type R3 = [number, number, number];

/**
 * Animation exaggeration (phase 84): push a pose further from READY in the body (hips,
 * torso, legs, height), arms and racket left as aimed, so the load is deeper and the
 * finish bigger without moving where the racket meets the ball.
 */
const BODY: BoneName[] = ['root', 'hips', 'torso', 'thighR', 'thighL', 'shinR', 'shinL'];
function deep(p: Pose, k: number, liftK = k): Pose {
  const out = pose(p, {});
  for (const b of BODY) out[b] = [0, 1, 2].map((i) => READY[b][i] + (p[b][i] - READY[b][i]) * k) as R3;
  out.lift = READY.lift + (p.lift - READY.lift) * liftK;
  return out;
}
/** The back foot coming up onto its toes behind, the weight all through onto the front leg. */
function heelUp(p: Pose, side: 'R' | 'L', pitch: number, bend: number): Pose {
  const t = side === 'R' ? 'thighR' : 'thighL';
  const sh = side === 'R' ? 'shinR' : 'shinL';
  return pose(p, { [t]: [pitch, p[t][1], p[t][2]], [sh]: [bend, p[sh][1], p[sh][2]] } as PoseEdit);
}

/** Legs: [thigh pitch, thigh spread, shin bend] per side. */
function legs(r: [number, number, number], l: [number, number, number]): PoseEdit {
  return { thighR: [r[0], 0, -r[1]], shinR: [r[2], 0, 0], thighL: [l[0], 0, l[1]], shinL: [l[2], 0, 0] };
}

// Forehand: a unit turn (hips and shoulders coiled, weight loaded on the back leg), the
// racket drops and lags behind the hand, the hips fire first, contact out in front with
// the arm long, then through the ball and wrapped round over the left shoulder.
const FH_BACK = aim(
  hipTurn(
    pose(READY, {
      lift: -0.08,
      ...legs([-0.6, 0.22, 1.0], [-0.3, 0.12, 0.55]),
      torso: [0.22, -0.6, 0.06],
      head: [-0.15, 1.05, 0],
      uArmR: [-0.2, 0, -1.0],
      fArmR: [-0.8, 0, 0],
      uArmL: [-1.45, 0, 0.5],
      fArmL: [-0.15, 0, 0],
    }),
    -0.6,
  ),
  [-0.25, 0.8, -0.55],
  [0.3, 0.3, 0.9],
);
const FH_DROP = aim(
  hipTurn(
    pose(READY, {
      lift: -0.1,
      ...legs([-0.55, 0.2, 0.95], [-0.4, 0.14, 0.7]),
      torso: [0.25, -0.75, 0.1],
      head: [-0.2, 0.75, 0],
      uArmR: [0.3, 0, -0.45],
      fArmR: [-0.65, 0, 0],
      uArmL: [-1.2, 0, 0.6],
      fArmL: [-0.3, 0, 0],
    }),
    -0.2,
  ),
  [-0.35, -0.55, -0.75],
  [0.2, -0.5, 0.8],
);
const FH_HIT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.05,
      ...legs([-0.3, 0.16, 0.65], [-0.5, 0.12, 0.8]),
      torso: [0.22, -0.1, -0.05],
      head: [-0.2, -0.2, 0],
      uArmR: [-1.0, 0, -0.7],
      fArmR: [-0.25, 0, 0],
      uArmL: [-0.7, 0, 0.75],
      fArmL: [-0.8, 0, 0],
    }),
    0.35,
  ),
  [-0.95, -0.1, 0.3],
  [0, 0, 1],
);
const FH_EXT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.03,
      ...legs([-0.1, 0.14, 0.55], [-0.45, 0.1, 0.7]),
      torso: [0.2, 0.25, -0.06],
      head: [-0.2, -0.55, 0],
      uArmR: [-1.55, 0, -0.15],
      fArmR: [-0.55, 0, 0],
      uArmL: [-0.35, 0, 0.55],
      fArmL: [-1.3, 0, 0],
    }),
    0.55,
  ),
  [-0.1, 0.6, 0.8],
  [1, 0, 0],
);
const FH_FOLLOW = aim(
  hipTurn(
    pose(READY, {
      lift: -0.04,
      ...legs([0.2, 0.1, 0.65], [-0.35, 0.1, 0.55]),
      torso: [0.15, 0.35, -0.05],
      head: [-0.2, -0.85, 0],
      uArmR: [-1.3, 0, 0.85],
      fArmR: [-1.6, 0, 0],
      uArmL: [-0.45, 0, 0.3],
      fArmL: [-1.6, 0, 0],
    }),
    0.7,
  ),
  [0.35, 0.15, -0.9],
  [0, -1, 0],
);

// Two-handed backhand: the same coil the other way, both hands on the grip, racket
// dropping below the ball, contact out in front of the left hip, finish over the right shoulder.
const BH_BACK = aim(
  hipTurn(
    pose(READY, {
      lift: -0.08,
      ...legs([-0.3, 0.12, 0.55], [-0.6, 0.22, 1.0]),
      torso: [0.22, 0.65, -0.06],
      head: [-0.15, -1.1, 0],
      uArmR: [-0.75, 0, 0.75],
      fArmR: [-0.75, 0, 0],
      uArmL: [-0.35, 0, 0.5],
      fArmL: [-1.0, 0, 0],
    }),
    0.6,
  ),
  [0.3, 0.65, -0.7],
  [-0.3, 0.3, 0.9],
);
const BH_DROP = aim(
  hipTurn(
    pose(READY, {
      lift: -0.1,
      ...legs([-0.4, 0.14, 0.7], [-0.55, 0.2, 0.95]),
      torso: [0.25, 0.75, -0.08],
      head: [-0.2, -0.8, 0],
      uArmR: [-0.4, 0, 0.6],
      fArmR: [-0.5, 0, 0],
      uArmL: [0, 0, 0.4],
      fArmL: [-0.7, 0, 0],
    }),
    0.2,
  ),
  [0.35, -0.5, -0.8],
  [-0.2, -0.5, 0.8],
);
const BH_HIT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.05,
      ...legs([-0.5, 0.12, 0.8], [-0.3, 0.16, 0.65]),
      torso: [0.22, 0.1, 0.05],
      head: [-0.2, 0.2, 0],
      uArmR: [-1.05, 0, 0.85],
      fArmR: [-0.25, 0, 0],
      uArmL: [-1.0, 0, 0.35],
      fArmL: [-0.55, 0, 0],
    }),
    -0.3,
  ),
  [0.95, -0.1, 0.3],
  [0, 0, 1],
);
const BH_EXT = aim(
  hipTurn(
    pose(READY, {
      lift: -0.03,
      ...legs([-0.45, 0.1, 0.7], [-0.1, 0.14, 0.55]),
      torso: [0.2, -0.25, 0.06],
      head: [-0.2, 0.5, 0],
      uArmR: [-1.6, 0, 0.35],
      fArmR: [-0.5, 0, 0],
      uArmL: [-1.65, 0, -0.05],
      fArmL: [-0.75, 0, 0],
    }),
    -0.5,
  ),
  [0.1, 0.6, 0.8],
  [-1, 0, 0],
);
const BH_FOLLOW = aim(
  hipTurn(
    pose(READY, {
      lift: -0.04,
      ...legs([-0.35, 0.1, 0.55], [0.2, 0.1, 0.65]),
      torso: [0.15, -0.35, 0.05],
      head: [-0.2, 0.8, 0],
      uArmR: [-1.75, 0, -0.55],
      fArmR: [-1.35, 0, 0],
      uArmL: [-1.75, 0, -0.85],
      fArmL: [-1.5, 0, 0],
    }),
    -0.65,
  ),
  [-0.35, 0.15, -0.9],
  [0, -1, 0],
);
// One-handed: the free hand lets go of the throat at the drop and sweeps back for balance
// as the hitting arm swings long and high.
const BH1_BACK = pose(BH_BACK, { uArmL: [-0.7, 0, 0.25], fArmL: [-1.5, 0, 0] });
const BH1_DROP = pose(BH_DROP, { uArmL: [-0.4, 0, 0.3], fArmL: [-1.3, 0, 0] });
const BH1_HIT = aim(pose(BH_HIT, { uArmR: [-1.1, 0, 0.55], fArmR: [-0.1, 0, 0], uArmL: [0.45, 0, 0.55], fArmL: [-0.2, 0, 0] }), [0.95, -0.15, 0.25], [0, 0, 1]);
const BH1_EXT = aim(pose(BH_EXT, { uArmR: [-1.75, 0, -0.1], fArmR: [-0.15, 0, 0], uArmL: [0.6, 0, 0.75], fArmL: [-0.1, 0, 0] }), [0.25, 0.75, 0.6], [-1, 0, 0]);
const BH1_FOLLOW = aim(pose(BH_FOLLOW, { uArmR: [-2.35, 0, -0.75], fArmR: [-0.2, 0, 0], uArmL: [0.55, 0, 0.9], fArmL: [-0.15, 0, 0] }), [-0.1, 0.9, -0.4], [-1, 0, 0]);

const LOW = { lift: -0.12, ...legs([-0.75, 0.2, 1.2], [-0.75, 0.2, 1.2]) };
// Volleys: a short turn with the racket head up beside the head, a firm punch forward
// with a step in on the opposite foot, held for a beat, then back to ready.
const VFH_BACK = aim(
  hipTurn(pose(READY, { ...LOW, torso: [0.28, -0.4, 0.04], head: [-0.2, 0.5, 0], uArmR: [-0.55, 0, -0.85], fArmR: [-1.0, 0, 0], uArmL: [-1.1, 0, 0.45], fArmL: [-0.4, 0, 0] }), -0.3),
  [-0.55, 0.75, -0.25],
  [0.2, 0, 1],
);
const VFH_HIT = aim(
  hipTurn(pose(READY, { lift: -0.13, ...legs([-0.35, 0.2, 0.8], [-1.0, 0.12, 1.25]), torso: [0.35, -0.15, 0], head: [-0.25, 0.1, 0], uArmR: [-1.15, 0, -0.65], fArmR: [-0.45, 0, 0], uArmL: [-0.8, 0, 0.6], fArmL: [-0.6, 0, 0] }), -0.1),
  [-0.7, 0.45, 0.55],
  [0.3, -0.2, 1],
);
const VFH_PUNCH = aim(pose(VFH_HIT, { uArmR: [-1.3, 0, -0.45], fArmR: [-0.3, 0, 0] }), [-0.45, 0.35, 0.8], [0.6, -0.3, 0.7]);
const VBH_BACK = aim(
  hipTurn(pose(READY, { ...LOW, torso: [0.28, 0.45, -0.04], head: [-0.2, -0.55, 0], uArmR: [-0.85, 0, 0.6], fArmR: [-0.9, 0, 0], uArmL: [-0.6, 0, 0.45], fArmL: [-1.1, 0, 0] }), 0.3),
  [0.55, 0.75, -0.25],
  [-0.2, 0, 1],
);
const VBH_HIT = aim(
  hipTurn(pose(READY, { lift: -0.13, ...legs([-1.0, 0.12, 1.25], [-0.35, 0.2, 0.8]), torso: [0.35, 0.15, 0], head: [-0.25, -0.1, 0], uArmR: [-1.2, 0, 0.45], fArmR: [-0.3, 0, 0], uArmL: [-0.2, 0, 0.75], fArmL: [-0.6, 0, 0] }), 0.1),
  [0.7, 0.45, 0.55],
  [-0.3, -0.2, 1],
);
const VBH_PUNCH = aim(pose(VBH_HIT, { uArmR: [-1.35, 0, 0.25], fArmR: [-0.2, 0, 0], uArmL: [0.15, 0, 0.8] }), [0.45, 0.35, 0.8], [-0.6, -0.3, 0.7]);

// Overheads: the trophy pose (racket arm cocked, free arm pointing up at the ball, knees
// loaded), the racket drops behind the back, the body uncoils up into contact at full
// stretch, the wrist turns over and the racket comes down across the left side as the
// player lands on the left foot with the right leg kicking back.
function trophy(root: R3): Pose {
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
        fArmL: [0, 0, 0],
      }),
      -0.45,
    ),
    [-0.2, 0.55, -0.8],
    [-1, 0, 0],
  );
}
function scratch(root: R3): Pose {
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
        fArmL: [-0.5, 0, 0],
      }),
      -0.2,
    ),
    [-0.1, -1, -0.25],
    [-1, 0, 0],
  );
}
function overHit(root: R3): Pose {
  return aim(
    pose(READY, {
      root,
      lift: 0.12,
      ...legs([0.05, 0.05, 0.3], [-0.1, 0.05, 0.35]),
      hips: [0, 0, 0],
      torso: [0.0, 0.15, -0.12],
      head: [-0.45, 0, 0],
      uArmR: [-2.95, 0, -0.2],
      fArmR: [-0.05, 0, 0],
      uArmL: [-1.1, 0, 0.45],
      fArmL: [-1.0, 0, 0],
    }),
    [-0.05, 1, 0.35],
    [0, 0.2, 1],
  );
}
function overPronate(root: R3): Pose {
  return aim(
    hipTurn(
      pose(READY, {
        root,
        lift: 0.07,
        ...legs([0.3, 0.1, 0.75], [-0.35, 0.1, 0.45]),
        torso: [0.35, 0.35, -0.05],
        head: [-0.3, -0.2, 0],
        uArmR: [-2.0, 0, -0.1],
        fArmR: [-0.1, 0, 0],
        uArmL: [-0.5, 0, 0.6],
        fArmL: [-1.4, 0, 0],
      }),
      0.3,
    ),
    [0.05, -0.2, 1],
    [-1, 0, 0],
  );
}
function overFollow(root: R3): Pose {
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
        fArmL: [-1.2, 0, 0],
      }),
      0.5,
    ),
    [0.55, -0.65, -0.5],
    [0, 0, -1],
  );
}
const SQUARE: R3 = [0, 0, 0];
const TROPHY = trophy(SQUARE);
const OVER_FOLLOW = overFollow(SQUARE);
const SIDE_ON: R3 = [0, -0.8, 0];
const SERVE_HOLD = pose(IDLE, {
  root: SIDE_ON,
  lift: -0.02,
  torso: [0.12, 0, 0],
  ...legs([-0.18, 0.12, 0.32], [-0.22, 0.12, 0.36]),
  uArmL: [-1.25, 0, 0.15],
  fArmL: [-0.2, 0, 0],
  uArmR: [-0.15, 0, -0.35],
  fArmR: [-1.1, 0, 0],
  racket: [0.5, 0.3, 0],
  head: [0, 0.7, 0],
});

// The serve (rebuilt in phase 65), after real servers: side-on with the ball and racket
// together, a bounce or two, then both arms drop together and rise together, the toss
// arm going up straight as the racket swings back and the knees load deep, hips pushed
// toward the court and the shoulders tilted (the trophy). The legs drive, the racket
// drops behind the back as the body rises, the player leaves the ground and meets the
// ball at full stretch, the wrist turns over, and they land on the front foot inside the
// court with the back leg kicking up behind, the racket finishing across the left side.
/** Bouncing the ball: knees dip, the free hand pushes down. */
const SERVE_BOUNCE = pose(SERVE_HOLD, {
  lift: -0.05,
  torso: [0.28, 0, 0],
  head: [0.25, 0.6, 0],
  ...legs([-0.35, 0.12, 0.62], [-0.4, 0.12, 0.66]),
  uArmL: [-0.55, 0, 0.12],
  fArmL: [-0.35, 0, 0],
});
/** Arms down together, the weight rocking onto the back foot. */
const SERVE_DIP = pose(SERVE_HOLD, {
  lift: -0.03,
  torso: [0.18, -0.1, 0],
  head: [0.05, 0.65, 0],
  ...legs([-0.1, 0.12, 0.3], [-0.32, 0.12, 0.42]),
  uArmL: [-0.35, 0, 0.1],
  fArmL: [-0.1, 0, 0],
  uArmR: [0.25, 0, -0.3],
  fArmR: [-0.3, 0, 0],
  racket: [0.9, 0.2, 0],
});
/** The ball leaves the hand: toss arm going up straight, racket swinging back and up, knees starting to load. */
const SERVE_RELEASE = aim(
  hipTurn(
    pose(SERVE_HOLD, {
      lift: -0.07,
      ...legs([-0.4, 0.14, 0.75], [-0.3, 0.14, 0.6]),
      torso: [-0.12, -0.35, 0.14],
      head: [-0.45, 0.5, 0],
      uArmL: [-2.45, 0, 0.12],
      fArmL: [-0.05, 0, 0],
      uArmR: [-0.75, 0, -1.15],
      fArmR: [-0.9, 0, 0],
    }),
    -0.3,
  ),
  [-0.35, 0.35, -0.85],
  [-1, 0, 0],
);
/** The trophy, deep: knees loaded, back arched, shoulders tilted, racket cocked, toss arm pointing at the ball. */
const SERVE_TROPHY = aim(
  hipTurn(
    pose(READY, {
      root: SIDE_ON,
      lift: -0.3,
      ...legs([-0.95, 0.16, 1.85], [-0.75, 0.16, 1.5]),
      torso: [-0.56, -0.58, 0.32],
      head: [-0.62, 0.5, 0],
      uArmR: [-1.6, 0, -1.45],
      fArmR: [-1.75, 0, 0],
      uArmL: [-3.0, 0, 0.1],
      fArmL: [0, 0, 0],
    }),
    -0.42,
    0.12,
  ),
  [-0.2, 0.6, -0.78],
  [-1, 0, 0],
);
/** Legs driving up, the racket starting to fall behind the head. */
const SERVE_DRIVE = aim(
  hipTurn(
    pose(READY, {
      root: [0, -0.7, 0],
      lift: -0.03,
      ...legs([-0.3, 0.1, 0.55], [-0.24, 0.1, 0.45]),
      torso: [-0.34, -0.4, 0.22],
      head: [-0.6, 0.4, 0],
      uArmR: [-2.2, 0, -1.0],
      fArmR: [-2.1, 0, 0],
      uArmL: [-2.6, 0, 0.25],
      fArmL: [-0.3, 0, 0],
    }),
    -0.3,
  ),
  [-0.15, -0.6, -0.8],
  [-1, 0, 0],
);
/** The racket drop: elbow high, racket head hanging down the back as the body rises off the ground. */
const SERVE_DROP = aim(
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
      fArmL: [-1.1, 0, 0],
    }),
    -0.15,
  ),
  [-0.05, -1, -0.3],
  [-1, 0, 0],
);
/** Contact: off the ground at full stretch, the arm and racket in one line up and a little in front. */
const SERVE_HIT = aim(
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
    fArmL: [-1.6, 0, 0],
  }),
  [-0.05, 1, 0.32],
  [0, 0.2, 1],
);
/** The wrist turned over, the body folding forward, the back leg starting to kick. */
const SERVE_PRONATE = aim(
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
      fArmL: [-1.5, 0, 0],
    }),
    0.25,
  ),
  [0.2, -0.75, 0.6],
  [-1, 0, 0],
);
/** Landing on the front foot inside the court, the back leg kicked up behind, the racket coming across. */
const SERVE_LAND = aim(
  hipTurn(
    pose(READY, {
      root: [0, 0.1, 0],
      lift: -0.2,
      thighL: [-0.95, 0, 0.1],
      shinL: [1.45, 0, 0],
      thighR: [1.35, 0, -0.14],
      shinR: [2.0, 0, 0],
      torso: [0.75, 0.38, 0],
      head: [-0.45, -0.25, 0],
      uArmR: [-0.9, 0, 0.55],
      fArmR: [-0.3, 0, 0],
      uArmL: [-0.35, 0, 0.45],
      fArmL: [-1.3, 0, 0],
    }),
    0.45,
  ),
  [0.6, -0.75, -0.25],
  [0, 0, -1],
);
/** Recovering: the back foot comes through, racket finished low on the left. */
const SERVE_FINISH = aim(
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
      fArmL: [-1.2, 0, 0],
    }),
    0.4,
  ),
  [0.55, -0.6, -0.55],
  [0, 0, -1],
);

const JUMP = pose(READY, {
  lift: 0.24,
  torso: [-0.1, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-3.0, 0, -0.25],
  fArmR: [0, 0, 0],
  racket: [-0.6, 0, 0],
  uArmL: [-2.8, 0, 0.3],
  fArmL: [0, 0, 0],
  thighR: [-0.7, 0, -0.1],
  thighL: [-0.7, 0, 0.1],
  shinR: [1.2, 0, 0],
  shinL: [1.2, 0, 0],
});
const PUMP = pose(IDLE, { uArmL: [-1.5, 0, 0.35], fArmL: [-1.9, 0, 0], torso: [0.15, 0, 0], head: [-0.2, 0, 0], uArmR: [-0.3, 0, -0.2] });
const SLUMP = pose(IDLE, {
  lift: -0.015,
  hips: [0, 0.1, -0.06],
  torso: [0.26, -0.05, 0.05],
  head: [0.24, 0.1, 0],
  ...legs([-0.08, 0.04, 0.22], [0.02, 0.06, 0.05]),
  uArmR: [0.08, 0, 0.02],
  fArmR: [-0.15, 0, 0],
  racket: [1.45, 0, 0],
  uArmL: [0.06, 0, -0.02],
  fArmL: [-0.1, 0, 0],
});
const HANDS_ON_KNEES = pose(READY, {
  lift: -0.1,
  torso: [0.95, 0, 0],
  head: [0.1, 0, 0],
  uArmR: [-0.75, 0, -0.1],
  fArmR: [0, 0, 0],
  racket: [1.2, 0, 0],
  uArmL: [-0.75, 0, 0.1],
  fArmL: [0, 0, 0],
});

/** Split step (phase 17): a little hop as the opponent hits, landing wide and low, ready to push off. */
const HOP = pose(READY, { lift: 0.1, thighR: [-0.25, 0, -0.1], thighL: [-0.25, 0, 0.1], shinR: [0.35, 0, 0], shinL: [0.35, 0, 0] });
const LAND = pose(WIDE, { lift: -0.1, thighR: [-0.65, 0, -0.38], thighL: [-0.65, 0, 0.38], shinR: [1.05, 0, 0], shinL: [1.05, 0, 0] });

/**
 * Reaching (phase 17), blended over a swing by how far the ball is from the body: a
 * long lunge out to the forehand or backhand side, legs and torso only, and a crouch
 * for low balls.
 */
export const LUNGE: Record<'forehand' | 'backhand', PoseEdit> = {
  forehand: { lift: -0.26, torso: [0.5, -0.25, 0.34], thighR: [-0.4, 0, -0.95], shinR: [0.25, 0, 0], thighL: [-1.15, 0, 0.2], shinL: [1.8, 0, 0] },
  backhand: { lift: -0.26, torso: [0.5, 0.25, -0.34], thighL: [-0.4, 0, 0.95], shinL: [0.25, 0, 0], thighR: [-1.15, 0, -0.2], shinR: [1.8, 0, 0] },
};
/**
 * The clay slide (phase 84): the outside leg stretched long along the ground, the other
 * folded deep underneath, sitting low with the free arm out for balance.
 */
export const SLIDE: Record<'forehand' | 'backhand', PoseEdit> = {
  forehand: { lift: -0.36, torso: [0.42, -0.3, 0.3], thighR: [-0.3, 0, -1.25], shinR: [0.05, 0, 0], thighL: [-1.25, 0, 0.12], shinL: [2.15, 0, 0], uArmL: [-0.6, 0, 1.3], fArmL: [-0.3, 0, 0] },
  backhand: { lift: -0.36, torso: [0.42, 0.3, -0.3], thighL: [-0.3, 0, 1.25], shinL: [0.05, 0, 0], thighR: [-1.25, 0, -0.12], shinR: [2.15, 0, 0] },
};
export const CROUCH: PoseEdit = { ...LOW, lift: -0.18, torso: [0.5, 0, 0] };

/** The "come on!" pump: knees bent, body crunched over, fist yanked down to the hip. */
const PUMP_DOWN = pose(IDLE, {
  lift: -0.09,
  ...legs([-0.55, 0.2, 0.95], [-0.55, 0.2, 0.95]),
  torso: [0.4, 0.15, 0],
  head: [-0.45, -0.1, 0],
  uArmL: [-0.35, 0, 0.3],
  fArmL: [-2.1, 0, 0],
  uArmR: [0.2, 0, -0.45],
  fArmR: [-0.4, 0, 0],
  racket: [0.9, 0, 0],
});
const PUMP_UP = pose(IDLE, {
  lift: -0.02,
  ...legs([-0.15, 0.12, 0.3], [-0.15, 0.12, 0.3]),
  torso: [-0.05, 0.25, 0],
  head: [-0.3, -0.2, 0],
  uArmL: [-2.2, 0, 0.45],
  fArmL: [-1.7, 0, 0],
  uArmR: [-0.1, 0, -0.3],
  fArmR: [-0.5, 0, 0],
});
const CROUCH_LOAD = pose(IDLE, {
  lift: -0.11,
  ...legs([-0.7, 0.14, 1.25], [-0.7, 0.14, 1.25]),
  torso: [0.5, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [0.5, 0, -0.2],
  fArmR: [-0.3, 0, 0],
  uArmL: [0.5, 0, 0.2],
  fArmL: [-0.3, 0, 0],
});
const ARMS_UP = pose(JUMP, { uArmR: [-3.05, 0, -0.45], uArmL: [-3.05, 0, 0.45], fArmR: [0, 0, 0], fArmL: [0, 0, 0], racket: [-0.9, 0, 0], head: [-0.45, 0, 0] });
const SALUTE = pose(IDLE, {
  torso: [-0.1, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-2.5, 0, -0.55],
  fArmR: [-0.2, 0, 0],
  racket: [-1.1, 0, 0],
  uArmL: [-0.5, 0, 0.35],
  fArmL: [-2.1, 0, 0],
});
const RACKET_DROP = pose(SLUMP, { head: [0.3, 0, 0], uArmR: [-0.1, 0, -0.15], racket: [1.6, 0.4, 0], torso: [0.25, 0, 0] });


// Phase 62: celebrations picked by the occasion, and loss reactions.
/** A small, tight fist clenched at the chest, eyes to the box. */
const CLENCH = pose(STANCE, {
  torso: [0.18, -0.2, 0],
  head: [-0.1, -0.35, 0],
  uArmL: [-0.55, 0, 0.35],
  fArmL: [-2.2, 0, 0],
});
/** Hands on hips, looking at the ground. */
const HIPS = pose(IDLE, {
  torso: [0.12, 0, 0],
  head: [0.32, 0, 0],
  uArmR: [0.25, 0, -0.75],
  fArmR: [-0.35, 0, 1.75],
  racket: [1.9, 0.3, 0.2],
  uArmL: [0.25, 0, 0.75],
  fArmL: [-0.35, 0, -1.75],
});
/** Racket raised to the crowd, free hand on the heart. */
const WAVE = pose(IDLE, {
  torso: [-0.05, 0, 0],
  head: [-0.25, 0, 0],
  uArmR: [-2.75, 0, -0.35],
  fArmR: [-0.25, 0, 0],
  racket: [-1.0, 0, 0],
  uArmL: [-0.45, 0, 0.1],
  fArmL: [-2.05, 0, 0.3],
});
/** Both fists pumped down, crouched, roaring up at the sky. */
const ROAR = pose(PUMP_DOWN, {
  lift: -0.12,
  ...legs([-0.75, 0.28, 1.2], [-0.75, 0.28, 1.2]),
  torso: [0.35, 0, 0],
  head: [-0.75, 0, 0],
  uArmR: [-0.35, 0, -0.55],
  fArmR: [-2.1, 0, 0],
  racket: [0.4, 0, 0],
  uArmL: [-0.35, 0, 0.55],
  fArmL: [-2.1, 0, 0],
});
/** Down on both knees, arms thrown up. */
const KNEEL = pose(ARMS_UP, {
  lift: -0.34,
  torso: [-0.12, 0, 0],
  head: [-0.55, 0, 0],
  thighR: [0, 0, -0.08],
  thighL: [0, 0, 0.08],
  shinR: [1.57, 0, 0],
  shinL: [1.57, 0, 0],
});
/** Flat on the back on the court, arms out wide, knees up a little. */
const LIE = pose(restPose(), {
  lift: -0.47,
  hips: [-1.5, 0, 0],
  head: [0.25, 0, 0],
  thighR: [-0.6, 0, -0.15],
  thighL: [-0.3, 0, 0.12],
  shinR: [1.0, 0, 0],
  shinL: [0.5, 0, 0],
  uArmR: [0, 0, -1.6],
  fArmR: [-0.3, 0, 0],
  racket: [0.6, 0.6, 0],
  uArmL: [0, 0, 1.6],
  fArmL: [-0.3, 0, 0],
});
/** Sitting down to it: the way down onto the back. */
const SIT = pose(restPose(), {
  lift: -0.5,
  hips: [-0.35, 0, 0],
  torso: [0.15, 0, 0],
  head: [-0.3, 0, 0],
  ...legs([-1.3, 0.15, 1.5], [-1.3, 0.15, 1.5]),
  uArmR: [-1.8, 0, -0.5],
  fArmR: [-0.2, 0, 0],
  uArmL: [-1.8, 0, 0.5],
  fArmL: [-0.2, 0, 0],
});
/** Hands on the head: "I can't believe it." */
const DISBELIEF = pose(IDLE, {
  torso: [-0.08, 0, 0],
  head: [-0.3, 0, 0],
  uArmR: [-1.9, 0, -1.45],
  fArmR: [-2.35, 0, 0],
  racket: [0.9, 0, 0],
  uArmL: [-1.9, 0, 1.45],
  fArmL: [-2.35, 0, 0],
});
/** A deep squat, head in the hands. */
const HEAD_IN_HANDS = pose(restPose(), {
  lift: -0.3,
  ...legs([-1.55, 0.22, 2.2], [-1.55, 0.22, 2.2]),
  torso: [0.75, 0, 0],
  head: [0.55, 0, 0],
  uArmR: [-0.95, 0, -0.25],
  fArmR: [-2.35, 0, 0],
  racket: [3.0, -0.2, 0],
  uArmL: [-0.95, 0, 0.25],
  fArmL: [-2.35, 0, 0],
});

/**
 * The people in your box (phase 86): sitting on a seat (hips level with the cushion,
 * thighs flat, shins down), leaning in, clapping, head in hands, and up on their feet.
 */
const BOX_SIT = pose(restPose(), {
  lift: -0.19,
  hips: [0, 0, 0],
  torso: [0.08, 0, 0],
  head: [-0.12, 0, 0],
  ...legs([-1.5, 0.14, 1.5], [-1.5, 0.14, 1.5]),
  uArmR: [-0.75, 0, -0.12],
  fArmR: [-0.75, 0, 0],
  uArmL: [-0.75, 0, 0.12],
  fArmL: [-0.75, 0, 0],
});
/**
 * Standing in the tunnel before the walk-out (phase 87), one stance per attitude: chest out
 * and chin up (cocky), dead still (cold), eyes down on the strings (nervous), easy (friendly),
 * and a raised free hand to say hello.
 */
export const TUNNEL_POSES = {
  stand: IDLE,
  stance: STANCE,
  chest: pose(IDLE, { lift: 0.005, torso: [-0.07, 0, 0], head: [-0.14, 0, 0], uArmR: [-0.08, 0, -0.2], fArmR: [-0.35, 0, 0], uArmL: [0.05, 0, 0.22], fArmL: [-0.2, 0, 0] }),
  still: pose(IDLE, { torso: [0.03, 0, 0], head: [0.04, 0, 0], uArmR: [-0.05, 0, -0.08], fArmR: [-0.3, 0, 0], uArmL: [0.02, 0, 0.06], fArmL: [-0.15, 0, 0] }),
  down: pose(STANCE, { lift: -0.02, torso: [0.2, 0, 0], head: [0.34, 0, 0] }),
  hello: pose(IDLE, { uArmL: [-0.55, 0, 0.95], fArmL: [-1.75, 0, 0], head: [-0.06, 0, 0] }),
};

export const BOX_POSES = {
  sit: BOX_SIT,
  lean: pose(BOX_SIT, { torso: [0.5, 0, 0], head: [-0.45, 0, 0], uArmR: [-0.95, 0, -0.2], fArmR: [-1.75, 0, 0], uArmL: [-0.95, 0, 0.2], fArmL: [-1.75, 0, 0] }),
  clapOpen: pose(BOX_SIT, { torso: [0.15, 0, 0], uArmR: [-1.2, 0, 0.1], fArmR: [-1.0, 0, 0], uArmL: [-1.2, 0, -0.1], fArmL: [-1.0, 0, 0] }),
  clapShut: pose(BOX_SIT, { torso: [0.15, 0, 0], uArmR: [-1.2, 0, 0.42], fArmR: [-1.05, 0, 0], uArmL: [-1.2, 0, -0.42], fArmL: [-1.05, 0, 0] }),
  head: pose(BOX_SIT, { torso: [0.85, 0, 0], head: [0.5, 0, 0], uArmR: [-0.55, 0, -0.25], fArmR: [-2.55, 0, 0], uArmL: [-0.55, 0, 0.25], fArmL: [-2.55, 0, 0] }),
  /** On their feet, both fists up: "come on!" */
  up: pose(IDLE, { lift: -0.01, torso: [-0.1, 0, 0], head: [-0.3, 0, 0], uArmR: [-2.4, 0, -0.5], fArmR: [-1.4, 0, 0], uArmL: [-2.4, 0, 0.5], fArmL: [-1.4, 0, 0] }),
  pump: pose(IDLE, { lift: -0.04, torso: [0.25, 0, 0], head: [-0.2, 0, 0], ...legs([-0.3, 0.14, 0.5], [-0.3, 0.14, 0.5]), uArmR: [-0.9, 0, -0.35], fArmR: [-2.2, 0, 0], uArmL: [-0.9, 0, 0.35], fArmL: [-2.2, 0, 0] }),
};

/**
 * The racket smash (phase 88): up over the head, slammed into the court, once more for
 * good measure, then a look at the wreck, a turn away and a hand out for a new one.
 */
const SMASH_UP = pose(IDLE, {
  lift: 0.02,
  torso: [-0.18, 0.25, 0],
  head: [-0.25, 0.1, 0],
  uArmR: [-2.95, 0, -0.2],
  fArmR: [-0.45, 0, 0],
  racket: [1.45, 0, 0],
  uArmL: [-0.5, 0, 0.45],
  fArmL: [-0.8, 0, 0],
});
const SMASH_SLAM = pose(IDLE, {
  lift: -0.12,
  ...legs([-0.65, 0.22, 1.0], [-0.55, 0.22, 0.9]),
  torso: [0.95, -0.1, 0],
  head: [0.1, 0, 0],
  uArmR: [-0.75, 0, -0.05],
  fArmR: [-0.2, 0, 0],
  racket: [0.9, 0, 0],
  uArmL: [0.1, 0, 0.35],
  fArmL: [-0.6, 0, 0],
});
const SMASH_RECOIL = pose(SMASH_SLAM, { lift: -0.06, torso: [0.6, -0.05, 0], uArmR: [-1.6, 0, -0.1], fArmR: [-0.5, 0, 0], racket: [0.1, 0, 0] });
const SMASH_LOOK = pose(IDLE, { lift: -0.03, torso: [0.35, 0, 0], head: [0.45, 0, 0], uArmR: [-0.2, 0, -0.15], fArmR: [-0.4, 0, 0], racket: [1.4, 0, 0], uArmL: [0.1, 0, 0.2] });
const SMASH_ASK = pose(IDLE, { torso: [0.05, -0.35, 0], head: [-0.05, -0.6, 0], uArmL: [-0.9, 0, 0.75], fArmL: [-0.5, 0, 0], uArmR: [0.05, 0, -0.1], fArmR: [-0.3, 0, 0] });

export const CLIPS: Record<ClipName, Clip> = {
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
    [2.8, STANCE],
  ]),
  // Phase 62: point reactions (a clench, a shake of the head) and match endings by occasion,
  // each a way in and a pose to hold.
  clench: clip(1.1, false, [
    [0, STANCE],
    [0.2, CLENCH],
    [0.4, pose(CLENCH, { fArmL: [-2.45, 0, 0], torso: [0.24, -0.25, 0] })],
    [0.7, CLENCH],
    [1.1, STANCE],
  ]),
  shakeHead: clip(1.5, false, [
    [0, STANCE],
    [0.3, HIPS],
    [0.55, pose(HIPS, { head: [0.3, 0.32, 0] })],
    [0.8, pose(HIPS, { head: [0.3, -0.32, 0] })],
    [1.05, pose(HIPS, { head: [0.3, 0.25, 0] })],
    [1.5, STANCE],
  ]),
  winWave: clip(0.8, false, [
    [0, IDLE],
    [0.4, pose(WAVE, { uArmR: [-2.3, 0, -0.3] })],
    [0.8, WAVE],
  ]),
  waveLoop: clip(2.2, true, [
    [0, WAVE],
    [0.55, pose(WAVE, { uArmR: [-2.8, 0, -0.65], torso: [-0.05, 0.12, 0], head: [-0.25, 0.25, 0] })],
    [1.1, WAVE],
    [1.65, pose(WAVE, { uArmR: [-2.7, 0, -0.1], torso: [-0.05, -0.12, 0], head: [-0.25, -0.25, 0] })],
    [2.2, WAVE],
  ]),
  winRoar: clip(1, false, [
    [0, IDLE],
    [0.25, pose(ROAR, { lift: -0.05, head: [-0.3, 0, 0] })],
    [0.5, ROAR],
    [1, ROAR],
  ]),
  roarLoop: clip(1.8, true, [
    [0, ROAR],
    [0.45, pose(ROAR, { lift: -0.1, head: [-0.85, 0, 0], fArmR: [-2.3, 0, 0], fArmL: [-2.3, 0, 0] })],
    [0.9, ROAR],
    [1.35, pose(ROAR, { lift: -0.13, torso: [0.4, 0, 0], head: [-0.65, 0, 0] })],
    [1.8, ROAR],
  ]),
  winArms: clip(0.9, false, [
    [0, IDLE],
    [0.3, pose(ARMS_UP, { lift: -0.06, ...legs([-0.45, 0.2, 0.8], [-0.45, 0.2, 0.8]), uArmR: [-1.6, 0, -0.4], uArmL: [-1.6, 0, 0.4], fArmR: [-0.8, 0, 0], fArmL: [-0.8, 0, 0], head: [-0.1, 0, 0] })],
    [0.6, pose(ARMS_UP, { lift: 0.06 })],
    [0.9, ARMS_UP],
  ]),
  armsUpLoop: clip(1.6, true, [
    [0, ARMS_UP],
    [0.4, pose(ARMS_UP, { lift: 0.02, uArmR: [-2.9, 0, -0.6], uArmL: [-2.9, 0, 0.6] })],
    [0.8, pose(ARMS_UP, { lift: 0.1 })],
    [1.2, pose(ARMS_UP, { lift: 0.02, uArmR: [-2.9, 0, -0.6], uArmL: [-2.9, 0, 0.6] })],
    [1.6, ARMS_UP],
  ]),
  winKneel: clip(1.2, false, [
    [0, IDLE],
    [0.3, pose(KNEEL, { lift: -0.18, shinR: [1.0, 0, 0], shinL: [1.0, 0, 0], thighR: [-0.5, 0, -0.08], thighL: [-0.5, 0, 0.08], uArmR: [-0.5, 0, -0.3], uArmL: [-0.5, 0, 0.3], torso: [0.4, 0, 0], head: [0.1, 0, 0] })],
    [0.6, pose(KNEEL, { torso: [0.5, 0, 0], head: [0.3, 0, 0], uArmR: [-0.6, 0, -0.3], uArmL: [-0.6, 0, 0.3], fArmR: [-1.2, 0, 0], fArmL: [-1.2, 0, 0] })],
    [1.0, KNEEL],
    [1.2, KNEEL],
  ]),
  kneelLoop: clip(2, true, [
    [0, KNEEL],
    [1, pose(KNEEL, { torso: [-0.2, 0, 0], head: [-0.7, 0, 0], uArmR: [-2.95, 0, -0.65], uArmL: [-2.95, 0, 0.65] })],
    [2, KNEEL],
  ]),
  winLie: clip(1.4, false, [
    [0, IDLE],
    [0.35, pose(SIT, { hips: [0, 0, 0], lift: -0.15, ...legs([-0.6, 0.15, 0.9], [-0.6, 0.15, 0.9]), torso: [0.3, 0, 0] })],
    [0.75, SIT],
    [1.15, LIE],
    [1.4, LIE],
  ]),
  lieLoop: clip(3, true, [
    [0, LIE],
    [1.5, pose(LIE, { torso: [-0.06, 0, 0], uArmR: [0, 0, -1.75], uArmL: [0, 0, 1.75], head: [0.15, 0.2, 0] })],
    [3, LIE],
  ]),
  winDisbelief: clip(0.9, false, [
    [0, IDLE],
    [0.45, pose(DISBELIEF, { head: [0.1, 0, 0], torso: [0.1, 0, 0] })],
    [0.9, DISBELIEF],
  ]),
  disbeliefLoop: clip(2.6, true, [
    [0, DISBELIEF],
    [0.65, pose(DISBELIEF, { head: [-0.35, 0.3, 0], hips: [0, 0.15, 0] })],
    [1.3, pose(DISBELIEF, { head: [-0.45, 0, 0], torso: [-0.15, 0, 0] })],
    [1.95, pose(DISBELIEF, { head: [-0.35, -0.3, 0], hips: [0, -0.15, 0] })],
    [2.6, DISBELIEF],
  ]),
  loseCrouch: clip(1.2, false, [
    [0, IDLE],
    [0.45, pose(SLUMP, { lift: -0.1, torso: [0.45, 0, 0], head: [0.4, 0, 0] })],
    [0.9, HEAD_IN_HANDS],
    [1.2, HEAD_IN_HANDS],
  ]),
  crouchLoop: clip(3, true, [
    [0, HEAD_IN_HANDS],
    [1.5, pose(HEAD_IN_HANDS, { torso: [0.82, 0, 0], head: [0.6, 0.15, 0] })],
    [3, HEAD_IN_HANDS],
  ]),
  loseHips: clip(0.8, false, [
    [0, IDLE],
    [0.8, HIPS],
  ]),
  hipsLoop: clip(2.8, true, [
    [0, HIPS],
    [0.7, pose(HIPS, { head: [0.3, 0.3, 0] })],
    [1.4, pose(HIPS, { head: [-0.25, 0, 0], torso: [0, 0, 0] })],
    [2.1, pose(HIPS, { head: [0.3, -0.3, 0] })],
    [2.8, HIPS],
  ]),
  idle: clip(2.4, true, [
    [0, STANCE],
    [1.2, pose(STANCE, { lift: -0.02, torso: [0.11, 0, 0], head: [-0.07, 0, 0] })],
    [2.4, STANCE],
  ]),
  // Breathing and a slow glance, so the model never stands frozen.
  showroom: clip(4.8, true, [
    [0, SHOWROOM],
    [1.6, pose(SHOWROOM, { torso: [-0.025, 0.06, -0.02], head: [0.02, 0.46, 0.02] })],
    [3.2, pose(SHOWROOM, { torso: [0.015, 0.04, -0.03], head: [0.05, 0.53, -0.01] })],
    [4.8, SHOWROOM],
  ]),
  ready: clip(0.6, true, [
    [0, READY],
    [0.3, pose(READY, { lift: -0.03 })],
    [0.6, READY],
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
    [0.5, RUN_REACH],
  ]),
  // A shuffle: push off wide and low, feet snap together in a skip, land wide again.
  walk: clip(1.1, true, [
    [0, WALK_CONTACT],
    [0.275, WALK_PASS],
    [0.55, stride(WALK_CONTACT)],
    [0.825, stride(WALK_PASS)],
    [1.1, WALK_CONTACT],
  ]),
  sidestep: clip(0.36, true, [
    [0, WIDE],
    [0.09, pose(WIDE, { lift: -0.03, thighR: [-0.38, 0, -0.22], thighL: [-0.38, 0, 0.22], shinR: [0.6, 0, 0], shinL: [0.6, 0, 0] })],
    [0.18, pose(NARROW, { lift: 0.02, shinR: [0.45, 0, 0], shinL: [0.45, 0, 0] })],
    [0.27, pose(WIDE, { lift: -0.04, thighR: [-0.35, 0, -0.3], thighL: [-0.35, 0, 0.3], shinR: [0.55, 0, 0], shinL: [0.55, 0, 0] })],
    [0.36, WIDE],
  ]),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  forehand: clip(0.76, false, [
    [0, deep(FH_BACK, 1.5, 1.8)],
    [0.09, deep(FH_DROP, 1.55, 1.7)],
    [0.16, deep(FH_HIT, 1.15)],
    [0.25, deep(FH_EXT, 1.3)],
    [0.38, heelUp(deep(FH_FOLLOW, 1.3), 'R', 0.28, 0.85)],
    [0.5, heelUp(deep(FH_FOLLOW, 1.25), 'R', 0.22, 0.7)],
    [0.76, READY],
  ], 0.16),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  backhand: clip(0.76, false, [
    [0, deep(BH_BACK, 1.5, 1.8)],
    [0.09, deep(BH_DROP, 1.55, 1.7)],
    [0.16, deep(BH_HIT, 1.15)],
    [0.25, deep(BH_EXT, 1.3)],
    [0.38, heelUp(deep(BH_FOLLOW, 1.3), 'L', 0.28, 0.85)],
    [0.5, heelUp(deep(BH_FOLLOW, 1.25), 'L', 0.22, 0.7)],
    [0.76, READY],
  ], 0.16),
  // Phase 84: a deeper coil and sit, the drive up through contact, then a full finish
  // held a beat with the back foot up on its toes.
  backhand1: clip(0.76, false, [
    [0, deep(BH1_BACK, 1.5, 1.8)],
    [0.09, deep(BH1_DROP, 1.55, 1.7)],
    [0.16, deep(BH1_HIT, 1.15)],
    [0.25, deep(BH1_EXT, 1.3)],
    [0.38, heelUp(deep(BH1_FOLLOW, 1.3), 'L', 0.28, 0.85)],
    [0.5, heelUp(deep(BH1_FOLLOW, 1.25), 'L', 0.22, 0.7)],
    [0.76, READY],
  ], 0.16),
  volleyFh: clip(0.4, false, [
    [0, VFH_BACK],
    [0.08, VFH_HIT],
    [0.2, VFH_PUNCH],
    [0.4, READY],
  ], 0.08),
  volleyBh: clip(0.4, false, [
    [0, VBH_BACK],
    [0.08, VBH_HIT],
    [0.2, VBH_PUNCH],
    [0.4, READY],
  ], 0.08),
  smash: clip(0.74, false, [
    [0, TROPHY],
    [0.08, scratch(SQUARE)],
    [0.16, overHit(SQUARE)],
    [0.25, overPronate(SQUARE)],
    [0.44, OVER_FOLLOW],
    [0.74, READY],
  ], 0.16),
  // A bounce or two of the ball while waiting to serve, then a settle.
  serveReady: clip(2.4, true, [
    [0, SERVE_HOLD],
    [0.3, SERVE_BOUNCE],
    [0.55, SERVE_HOLD],
    [0.85, SERVE_BOUNCE],
    [1.1, SERVE_HOLD],
    [2.4, SERVE_HOLD],
  ]),
  // Toss and serve (phase 54, rebuilt in phase 65): arms down together, up together, the
  // ball released as the toss arm passes the head, then the deep trophy held until the
  // swing, swaying a little as the knees keep loading.
  serveToss: clip(4, true, [
    [0, SERVE_HOLD],
    [0.1, SERVE_DIP],
    [0.24, SERVE_RELEASE],
    [0.48, SERVE_TROPHY],
    [1.0, pose(SERVE_TROPHY, { lift: -0.2 })],
    [4, pose(SERVE_TROPHY, { lift: -0.2 })],
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
    [0.92, READY],
  ], 0.22),
  celebrate: clip(1.2, false, [
    [0, IDLE],
    [0.16, PUMP_UP],
    [0.32, PUMP_DOWN],
    [0.5, pose(PUMP_DOWN, { torso: [0.32, 0.1, 0], fArmL: [-1.9, 0, 0] })],
    [0.62, pose(PUMP_UP, { uArmL: [-1.5, 0, 0.4] })],
    [0.76, PUMP_DOWN],
    [1.2, IDLE],
  ]),
  splitStep: clip(0.34, false, [
    [0, READY],
    [0.1, HOP],
    [0.2, LAND],
    [0.34, READY],
  ]),
  // Crouch, spring up with both arms high, land soft and bounce once more.
  celebrate2: clip(1.25, false, [
    [0, IDLE],
    [0.14, CROUCH_LOAD],
    [0.34, ARMS_UP],
    [0.52, pose(CROUCH_LOAD, { lift: -0.07, uArmR: [-2.6, 0, -0.5], uArmL: [-2.6, 0, 0.5], fArmR: [-0.3, 0, 0], fArmL: [-0.3, 0, 0], racket: [-0.6, 0, 0] })],
    [0.72, pose(ARMS_UP, { lift: 0.08 })],
    [0.92, pose(ARMS_UP, { lift: -0.02, thighR: [-0.2, 0, -0.1], thighL: [-0.2, 0, 0.1], shinR: [0.35, 0, 0], shinL: [0.35, 0, 0] })],
    [1.25, IDLE],
  ]),
  celebrate3: clip(1.2, false, [
    [0, IDLE],
    [0.25, pose(SALUTE, { hips: [0, -0.25, 0], head: [-0.3, -0.2, 0] })],
    [0.5, pose(SALUTE, { lift: 0.04, fArmL: [-1.6, 0, 0] })],
    [0.75, pose(SALUTE, { hips: [0, 0.3, 0], head: [-0.3, 0.3, 0] })],
    [0.95, pose(SALUTE, { lift: 0.04, hips: [0, 0.15, 0], fArmL: [-1.6, 0, 0] })],
    [1.2, IDLE],
  ]),
  celebrateLoop: clip(0.9, true, [
    [0, PUMP],
    [0.3, JUMP],
    [0.6, pose(JUMP, { lift: 0.05 })],
    [0.9, PUMP],
  ]),
  dejected: clip(1.4, false, [
    [0, IDLE],
    [0.35, SLUMP],
    [0.65, pose(SLUMP, { head: [0.2, -0.3, 0] })],
    [0.85, pose(SLUMP, { head: [0.22, 0.32, 0] })],
    [1.1, SLUMP],
    [1.4, IDLE],
  ]),
  dejected2: clip(1.4, false, [
    [0, IDLE],
    [0.3, RACKET_DROP],
    [0.55, pose(RACKET_DROP, { head: [0.3, 0.45, 0] })],
    [0.8, pose(RACKET_DROP, { head: [0.3, -0.45, 0] })],
    [1.05, RACKET_DROP],
    [1.4, IDLE],
  ]),
  dejectedLoop: clip(2.4, true, [
    [0, HANDS_ON_KNEES],
    [1.2, pose(HANDS_ON_KNEES, { lift: -0.12, torso: [1.0, 0, 0] })],
    [2.4, HANDS_ON_KNEES],
  ]),
  // Press conference (phase 40): leaning on the desk, forearms on it, looking round the
  // room at the reporters, and a hand up now and then to make a point.
  press: clip(6, true, [
    [0, PRESS],
    [1.4, pose(PRESS, { head: [-0.08, 0.28, 0.04] })],
    [2.6, pose(PRESS, { head: [-0.02, 0.05, 0], uArmR: [-0.8, 0.35, -0.35], fArmR: [-1.8, 0, 0] })],
    [3.4, pose(PRESS, { head: [-0.04, -0.06, -0.02], uArmR: [-0.75, 0.3, -0.33], fArmR: [-1.65, 0, 0] })],
    [4.6, pose(PRESS, { head: [-0.1, -0.3, -0.04] })],
    [6, PRESS],
  ]),
  // Worn out between points (phase 28): hands on knees, eyes up the court, quick heaving breaths.
  tired: clip(0.9, true, [
    [0, pose(HANDS_ON_KNEES, { torso: [0.78, 0, 0], head: [-0.45, 0, 0] })],
    [0.45, pose(HANDS_ON_KNEES, { lift: -0.115, torso: [0.9, 0, 0], head: [-0.52, 0, 0], uArmR: [-0.68, 0, -0.12], uArmL: [-0.68, 0, 0.12] })],
    [0.9, pose(HANDS_ON_KNEES, { torso: [0.78, 0, 0], head: [-0.45, 0, 0] })],
  ]),
};

/**
 * Sample a clip at time `t` into `out`. Keys are joined by smooth curves (Catmull-Rom,
 * so motion carries through a key instead of stopping on it); a one-shot clip eases
 * out of its first key and into its last, and a looping one flows round.
 */
export function sample(c: Clip, t: number, out: Pose): Pose {
  const time = c.loop ? ((t % c.duration) + c.duration) % c.duration : Math.min(Math.max(t, 0), c.duration);
  const keys = c.keys;
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= time) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, n - 1)];
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (time - a.t) / span)) : 1;
  // Neighbours for the tangents (a loop's last key repeats its first).
  const prev = (k: number) => {
    if (k > 0) return { key: keys[k - 1], dt: 0 };
    return c.loop && n > 2 ? { key: keys[n - 2], dt: -c.duration } : null;
  };
  const next = (k: number) => {
    if (k < n - 1) return { key: keys[k + 1], dt: 0 };
    return c.loop && n > 2 ? { key: keys[1], dt: c.duration } : null;
  };
  const pa = prev(i);
  const nb = next(i + 1);
  // Tangent scale per key: a key flagged `hold` stops there.
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
  const f = (p0: number, p1: number, p2: number, p3: number) => h00 * p1 + h10 * ta * (p2 - p0) + h01 * p2 + h11 * tb * (p3 - p1);
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

export function lerpPose(a: Pose, b: Pose, s: number, out: Pose): Pose {
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

export function copyPose(src: Pose, out: Pose): Pose {
  return lerpPose(src, src, 0, out);
}
