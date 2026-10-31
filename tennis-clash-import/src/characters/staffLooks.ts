import { PAL, type PaletteIndex } from '../voxel/palette';
import { MORE_FIRST, NAMES } from '../meta/names';
import type { CoachSpeciality as Branch } from '../meta/skills';
import type { StaffRole } from '../meta/fitness';
import { LOOK_OPTIONS, type CharacterLook, type GearLook, type HairStyle } from './looks';

/**
 * Faces for the people on your team (phase 50): every coach gets a voxel look of their
 * own, seeded by who they are so they look the same every time you meet them, dressed in
 * a white club polo trimmed in their speciality's colour. The medical staff are three fixed people.
 */

/** The polo each speciality wears (the same hues as its badge). */
const SPECIALITY_SHIRT: Record<Branch, PaletteIndex> = {
  serve: PAL.blue,
  baseline: PAL.green,
  net: PAL.purple,
  movement: PAL.orange,
  mind: PAL.pink,
};

/** A string to a seed (FNV-1a). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Whether a name's first name is on the women's list for its country. */
export function femName(name: string, flag: string): boolean {
  const first = name.split(' ')[0];
  return !!(NAMES[flag]?.[1].includes(first) || MORE_FIRST[flag]?.[1].includes(first));
}

export interface StaffFace {
  /** Portrait cache key. */
  key: string;
  look: CharacterLook;
  gear: GearLook;
}

/** A coach's face: older than the players (greyer, fewer wild hairdos), in a club polo. */
export function coachFace(c: { id: string; name: string; flag: string; speciality: Branch }): StaffFace {
  const r = seeded(hash(c.name + c.flag));
  const any = <T>(list: readonly T[]): T => list[Math.floor(r() * list.length)];
  const fem = femName(c.name, c.flag);
  const shirt = SPECIALITY_SHIRT[c.speciality];
  const hair = any([PAL.hairGrey, PAL.hairGrey, PAL.hairPlatinum, PAL.hairBlack, PAL.hairBrown, PAL.hairBlond, PAL.hairAuburn]);
  const styles: HairStyle[] = fem ? ['bun', 'bob', 'ponytail', 'lob', 'pixie', 'topknot', 'braid'] : ['crop', 'crop', 'sidepart', 'buzz', 'slick', 'bald', 'messy', 'afro'];
  const look: CharacterLook = {
    skin: any(LOOK_OPTIONS.skin),
    hair,
    hairStyle: any(styles),
    // White club polo with their colour on the trim, so it reads over the badge.
    shirt: PAL.white,
    trim: shirt,
    shorts: PAL.navy,
    accessory: shirt,
    backhand: 'two',
    body: fem ? 'fem' : 'masc',
    bottom: 'shorts',
    build: any(LOOK_OPTIONS.build),
    eyes: any(LOOK_OPTIONS.eyes),
    brows: any(['thin', 'thick', 'thick'] as const),
    mouth: any(['neutral', 'smile', 'neutral'] as const),
    facialHair: fem ? 'none' : any(['none', 'stubble', 'heavy', 'moustache', 'horseshoe', 'goatee', 'boxed', 'beard', 'beard', 'longbeard'] as const),
    // Coaches have been round the tour a while: most have some grey.
    grey: Math.round(r() * 8) / 10,
    headwear: r() < 0.22 ? 'cap' : r() < 0.12 ? 'visor' : 'none',
  };
  return { key: `coach:${c.id}:${c.name}`, look, gear: { racket: PAL.charcoal, grip: PAL.white, shoes: PAL.white, wristband: shirt, cut: 'polo' } };
}

/** The doctor, the physio and the fitness trainer. */
const STAFF_LOOKS: Record<StaffRole, CharacterLook> = {
  doctor: { skin: PAL.skin2, hair: PAL.hairGrey, hairStyle: 'crop', shirt: PAL.white, trim: PAL.lightGrey, shorts: PAL.navy, accessory: PAL.white, backhand: 'two', body: 'masc', bottom: 'shorts', headwear: 'none', facialHair: 'boxed', brows: 'bushy', grey: 0.7 },
  physio: { skin: PAL.skin3, hair: PAL.hairBlack, hairStyle: 'bun', shirt: PAL.teal, trim: PAL.white, shorts: PAL.navy, accessory: PAL.teal, backhand: 'two', body: 'fem', bottom: 'shorts', headwear: 'none', mouth: 'smile' },
  trainer: { skin: PAL.skin4, hair: PAL.hairBlack, hairStyle: 'crop', shirt: PAL.red, trim: PAL.black, shorts: PAL.black, accessory: PAL.red, backhand: 'two', body: 'masc', bottom: 'shorts', headwear: 'cap', build: 'powerful', mouth: 'grin' },
};

export function staffFace(role: StaffRole): StaffFace {
  const look = STAFF_LOOKS[role];
  return { key: `staff:${role}`, look, gear: { racket: PAL.charcoal, grip: PAL.white, shoes: PAL.white, wristband: look.accessory, cut: role === 'physio' ? 'tee' : 'polo' } };
}
