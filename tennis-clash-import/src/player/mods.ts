/**
 * What a player's setup and skill tree do on court (phases 35 and 36): multipliers the
 * frame, strings, tension and shoes, and the tree's abilities, put on shots and movement.
 * 1 everywhere (0 for `disguise`) is a plain player.
 */
export interface PlayMods {
  /** Groundstroke and volley pace (and the pace cap the shot stats set). */
  pace: number;
  /** Shot scatter: below 1 is tighter. */
  scatter: number;
  /** Topspin on groundstrokes. */
  spin: number;
  /** Drop shot touch, on top of the Drop shot stat; above 1 is better. */
  touch: number;
  /** Top serve speed. */
  serve: number;
  /** Top running speed. */
  speed: number;
  /** Acceleration (the first step). */
  accel: number;
  /** Braking (how quickly the player stops and turns). */
  brake: number;
  /** Stamina drain and match fatigue: below 1 lasts longer. */
  drain: number;
  /** Forehand and backhand scatter, on top of `scatter` (skill tree). */
  fhScatter: number;
  bhScatter: number;
  /** Smash scatter. */
  smash: number;
  /** Serve scatter, on top of the Serve stat. */
  serveScatter: number;
  /** Second serves: scatter multiplier; below 1 also adds kick (more topspin). */
  kick: number;
  /** First serves: top speed multiplier. */
  bomb: number;
  /** Seconds a drop shot holds the other player back before they read it. */
  disguise: number;
  /** The perfect timing window. */
  timing: number;
  /** Scatter when facing a game point against you (multiplies the nerves everyone feels). */
  composure: number;
  /** Pace on your own game points. */
  clutch: number;
  /** How fast match fatigue builds. */
  fatigue: number;
  // String powers (phase 58).
  /** Chance (0..1) a groundstroke is a critical: more pace, half the scatter. Adds. */
  crit: number;
  /** Extra racket reach, m (Quick Catch). Adds. */
  reach: number;
  /** Stamina a swing costs (Stamina Shield). */
  hitCost: number;
  /** Volley pace, and volley scatter (Volley Counter). */
  volleyPace: number;
  volleyScatter: number;
  /** Power shot pace (Power Fiber). */
  powerPace: number;
  /** Topspin on perfectly timed shots (Spin Burst). */
  spinBurst: number;
  /** Return of serve pace, and its scatter (Return Ace). */
  returnPace: number;
  returnScatter: number;
  /** Share of the stamina bar won back with every point won (Second Wind). Adds. */
  secondWind: number;
  // The big tree (phase 59).
  /** Scatter from hitting at full stretch. */
  stretch: number;
  /** Scatter from hitting on the run. */
  runShot: number;
  /** Scatter from balls too low or too high. */
  lowBall: number;
  /** Scatter from tired arms. */
  tired: number;
  /** Scatter from going big. */
  powerControl: number;
  /** Scatter from a fast incoming ball. */
  incoming: number;
  /** How far a mistimed swing strays (pull, push and scatter). */
  late: number;
  /** Lob scatter. */
  lobScatter: number;
  /** Scatter with the other player at the net. */
  passing: number;
  /** Scatter while behind in the match. */
  comeback: number;
  /** Scatter on your own game points. */
  closer: number;
  /** Pace added per shot you've hit in the rally, up to MOMENTUM_CAP shots. Adds. */
  momentum: number;
  /** Reaction time (how soon the other player's shot is read). */
  read: number;
  /** Stamina regained between shots. */
  regen: number;
  /** Stamina regained between points. */
  refill: number;
  /** Scatter of your first shot after your serve. */
  plusOne: number;
  /** Stamina a serve costs. */
  serveCost: number;
}

/** Shots in a rally that keep adding momentum. */
export const MOMENTUM_CAP = 6;

/** Mods that add up rather than multiply. */
export const ADDITIVE_MODS: ReadonlySet<keyof PlayMods> = new Set(['disguise', 'crit', 'reach', 'secondWind', 'momentum']);

export const NO_MODS: Readonly<PlayMods> = Object.freeze({
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
  serveCost: 1,
});

/** Two sets of mods together: multipliers multiply, the disguise, crit, reach, second wind and momentum add. */
export function combineMods(a: Readonly<PlayMods>, b: Readonly<PlayMods>): PlayMods {
  const out = { ...a };
  for (const k of Object.keys(NO_MODS) as Array<keyof PlayMods>) out[k] = ADDITIVE_MODS.has(k) ? a[k] + b[k] : a[k] * b[k];
  return out;
}

/** Scatter everyone feels facing a game point against them, before composure. */
export const NERVES = 1.12;

/**
 * Where a player stands in the game: facing a game point against them (−1), on a game
 * point of their own (1), or neither (0).
 */
export type Pressure = -1 | 0 | 1;
