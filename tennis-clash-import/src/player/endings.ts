import type { ClipName } from '../characters/anim';

/**
 * How a match ends for each player (phase 62): the celebration or the loss picked by the
 * occasion. A clip to play once on the winning point, then a pose held on a loop.
 */
export interface Ending {
  intro: ClipName | null;
  loop: ClipName;
}

export const ENDINGS = {
  /** A Slam or the Tour Finals won: down on the back on the court, arms wide. */
  major: { intro: 'winLie', loop: 'lieLoop' },
  /** Any other title: down on both knees, arms thrown up. */
  title: { intro: 'winKneel', loop: 'kneelLoop' },
  /** Beat someone ranked far above you: hands to the head. */
  upset: { intro: 'winDisbelief', loop: 'disbeliefLoop' },
  /** Won it in the deciding game: crouched, fists pumped, a roar. */
  tight: { intro: 'winRoar', loop: 'roarLoop' },
  /** A one-sided win: the racket raised to the crowd. */
  easy: { intro: 'winWave', loop: 'waveLoop' },
  /** Any other win: arms up. */
  win: { intro: 'winArms', loop: 'armsUpLoop' },
  /** Lost a final or a close one: a deep crouch, head in the hands. */
  tough: { intro: 'loseCrouch', loop: 'crouchLoop' },
  /** Beaten heavily: hands on the hips, looking at the ground. */
  heavy: { intro: 'loseHips', loop: 'hipsLoop' },
  /** Any other loss: head down. */
  loss: { intro: null, loop: 'dejectedLoop' },
} satisfies Record<string, Ending>;

export type EndingKind = keyof typeof ENDINGS;

export interface MatchEnd {
  /** Points won in the match by the winner and by the loser. */
  points: [number, number];
  /** Games won by the winner and the loser (games mode), or null in a points race. */
  games: [number, number] | null;
  /** A tournament final, and whether it was a Slam or the Tour Finals. */
  final: boolean;
  major: boolean;
  /** Rankings of the winner and the loser (null: unranked). */
  ranks: [number | null, number | null];
}

/** An upset: the winner ranked at least twice as low as the loser and 20 places or more below. */
export function isUpset([w, l]: [number | null, number | null]): boolean {
  if (l === null) return false;
  const wr = w ?? 999;
  return wr >= l * 2 && wr - l >= 20;
}

/** Which celebration and which loss fit how the match went. */
export function endingKinds(m: MatchEnd): { win: EndingKind; lose: EndingKind } {
  const [pw, pl] = m.points;
  // Close: it went to the deciding game, or a race won by two points or fewer.
  const tight = m.games ? m.games[1] >= m.games[0] - 1 && m.games[1] > 0 : pw - pl <= 2;
  // One-sided: no game dropped and fewer than half as many points.
  const easy = !tight && (m.games ? m.games[1] === 0 : true) && pl * 2 < pw;
  const win: EndingKind = m.final ? (m.major ? 'major' : 'title') : isUpset(m.ranks) ? 'upset' : tight ? 'tight' : easy ? 'easy' : 'win';
  const lose: EndingKind = m.final || tight ? 'tough' : easy ? 'heavy' : 'loss';
  return { win, lose };
}

export function endingsFor(m: MatchEnd): { win: Ending; lose: Ending } {
  const k = endingKinds(m);
  return { win: ENDINGS[k.win], lose: ENDINGS[k.lose] };
}
