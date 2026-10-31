import { NO_MODS, type PlayMods } from '../player/mods';

/**
 * Height and age (phase 52): what your body brings to the court.
 *
 * Height runs 150 to 200 cm. Shorter players change direction and get going quicker but
 * serve slower; taller ones serve bigger but are slower to turn and accelerate.
 *
 * A career runs from 18 to 40. Stamina peaks at 28 and then fades slowly; accuracy keeps
 * improving to 35 and then slips. At 18 the legs are fine but the aim isn't yet. All of
 * it mild: a few percent either way.
 */

export const HEIGHT_MIN = 150;
export const HEIGHT_MAX = 200;
/** The figure's own height at scale 1. */
export const STANDARD_CM = 172;

export const START_AGE = 18;
export const RETIRE_AGE = 40;

/** Your age in a season of your career: 18 in the first. */
export const ageInSeason = (season: number) => START_AGE + Math.max(0, season - 1);

export const clampCm = (cm: number) => Math.round(Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, cm)));
/** A look's height multiplier for a height in cm, and back. */
export const scaleOfCm = (cm: number) => clampCm(cm) / STANDARD_CM;
export const cmOfScale = (scale: number | undefined) => clampCm((scale ?? 1) * STANDARD_CM);

/** What height does: −1 at 150 cm, 0 at the standard 172, +1 at 200. */
function tall(cm: number): number {
  const d = clampCm(cm) - STANDARD_CM;
  return d / (d > 0 ? HEIGHT_MAX - STANDARD_CM : STANDARD_CM - HEIGHT_MIN);
}

/** Acceleration, braking and serve speed for a height. */
export function heightMods(cm: number): PlayMods {
  const t = tall(cm);
  return { ...NO_MODS, accel: 1 - 0.1 * t, brake: 1 - 0.1 * t, serve: 1 + 0.07 * t };
}

/** Piecewise-linear curve through [age, value] points. */
function curve(points: Array<[number, number]>, age: number): number {
  if (age <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [a1, v1] = points[i];
    if (age <= a1) {
      const [a0, v0] = points[i - 1];
      return v0 + ((v1 - v0) * (age - a0)) / (a1 - a0);
    }
  }
  return points[points.length - 1][1];
}

/** Stamina drain by age: below 1 lasts longer. Best at 28. */
export const staminaAt = (age: number) => curve([[18, 1.02], [28, 0.92], [34, 0.99], [40, 1.1]], age);
/** Shot scatter by age: below 1 is more accurate. Best at 35. */
export const scatterAt = (age: number) => curve([[18, 1.1], [26, 0.98], [35, 0.9], [40, 0.97]], age);

/** What age does to a player's game. */
export function ageMods(age: number): PlayMods {
  const drain = staminaAt(age);
  return { ...NO_MODS, drain, fatigue: drain, scatter: scatterAt(age) };
}

/** How height and age read as percentages, for the editor and profile ("+5% serve"). */
export function percent(x: number, better: 'up' | 'down' = 'up'): string {
  const p = Math.round((better === 'up' ? x - 1 : 1 - x) * 100);
  return `${p > 0 ? '+' : p < 0 ? '−' : '±'}${Math.abs(p)}%`;
}
