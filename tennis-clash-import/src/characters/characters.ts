import type { PlayStyle } from '../ai/profiles';

/** The seven stats (GDD §6.1), 0–100. Drop shot joined in phase 28; agility shows as Speed. */
export interface Stats {
  agility: number;
  stamina: number;
  serve: number;
  volley: number;
  forehand: number;
  backhand: number;
  dropshot: number;
}

/** In the order Nir listed them for skill points (phase 28). */
export const STAT_KEYS: Array<keyof Stats> = ['serve', 'forehand', 'backhand', 'dropshot', 'volley', 'agility', 'stamina'];

export const STAT_LABEL: Record<keyof Stats, string> = {
  agility: 'Speed',
  stamina: 'Stamina',
  serve: 'Serve',
  volley: 'Volley',
  forehand: 'Forehand',
  backhand: 'Backhand',
  dropshot: 'Drop shot',
};

export interface CharacterDef {
  id: string;
  name: string;
  style: PlayStyle;
  /** 1 = right-handed, −1 = left-handed (forehand on the other side). */
  handed: 1 | -1;
  /** Signature colour for UI chips and swatches (matches the character's shirt). */
  color: number;
  /** The six stats; play style shifts them, gear trades them (phase 21). */
  base: Stats;
  /** First tour it plays rivals on (0 = from the start). */
  unlockTour: number;
  /** The country played for (phase 39: your player's; tour rivals carry their own). */
  flag?: string;
}

/**
 * The first six characters, one per unlock step, styles following GDD §6.2. Names and
 * looks are our own.
 */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'rio',
    name: 'Rio',
    style: 'baseliner',
    handed: 1,
    color: 0xf59f00,
    base: { agility: 46, stamina: 46, serve: 46, volley: 40, forehand: 56, backhand: 52, dropshot: 44 },
    unlockTour: 0,
  },
  {
    id: 'juno',
    name: 'Juno',
    style: 'all-round',
    handed: 1,
    color: 0x20c997,
    base: { agility: 49, stamina: 49, serve: 48, volley: 54, forehand: 48, backhand: 48, dropshot: 52 },
    unlockTour: 1,
  },
  {
    id: 'wren',
    name: 'Wren',
    style: 'counterpuncher',
    handed: -1,
    color: 0x845ef7,
    base: { agility: 58, stamina: 58, serve: 40, volley: 40, forehand: 47, backhand: 47, dropshot: 50 },
    unlockTour: 2,
  },
  {
    id: 'ash',
    name: 'Ash',
    style: 'serve-volley',
    handed: 1,
    color: 0x339af0,
    base: { agility: 47, stamina: 44, serve: 58, volley: 57, forehand: 46, backhand: 42, dropshot: 48 },
    unlockTour: 3,
  },
  {
    id: 'sora',
    name: 'Sora',
    style: 'counterpuncher',
    handed: 1,
    color: 0xf06595,
    base: { agility: 57, stamina: 55, serve: 40, volley: 41, forehand: 54, backhand: 44, dropshot: 55 },
    unlockTour: 4,
  },
  {
    id: 'mila',
    name: 'Mila',
    style: 'baseliner',
    handed: -1,
    color: 0xe03131,
    base: { agility: 47, stamina: 47, serve: 50, volley: 42, forehand: 58, backhand: 56, dropshot: 42 },
    unlockTour: 5,
  },
];

/**
 * Your own player (phase 20): made in the editor rather than picked from the roster. An
 * even 50 everywhere; gear from the store trades stats for a play style (phase 21).
 */
export const YOU: CharacterDef = {
  id: 'you',
  name: 'You',
  style: 'all-round',
  handed: 1,
  color: 0x4cb8ff,
  base: { agility: 50, stamina: 50, serve: 50, volley: 50, forehand: 50, backhand: 50, dropshot: 50 },
  unlockTour: 0,
};

/** Name and hand your player (from the save or the editor). */
export function setYou(name: string, handed: 1 | -1, flag?: string): void {
  YOU.name = name;
  YOU.handed = handed;
  YOU.flag = flag;
}

/** The player on the other phone in a local PvP match (phase 22): plays in their own gear. */
export const PEER: CharacterDef = { ...YOU, id: 'peer', name: 'Friend', color: 0xff8a4c, base: { ...YOU.base } };

export function setPeer(name: string, handed: 1 | -1): void {
  PEER.name = name;
  PEER.handed = handed;
}

/** The tour fields' rivals (phase 29), added as they are generated. */
const FIELD = new Map<string, CharacterDef>();

export function registerCharacter(def: CharacterDef): void {
  FIELD.set(def.id, def);
}

export function characterById(id: string | null | undefined): CharacterDef {
  if (id === YOU.id) return YOU;
  if (id === PEER.id) return PEER;
  return CHARACTERS.find((c) => c.id === id) ?? (id ? FIELD.get(id) : undefined) ?? CHARACTERS[0];
}

/** A character's stats (a copy). */
export function statsOf(c: CharacterDef): Stats {
  return { ...c.base };
}

/** One number for a quick comparison (the average of the stats). */
export function rating(s: Stats): number {
  return Math.round(STAT_KEYS.reduce((sum, k) => sum + s[k], 0) / STAT_KEYS.length);
}
