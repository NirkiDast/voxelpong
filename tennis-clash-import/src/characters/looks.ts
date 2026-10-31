import { PAL, type PaletteIndex } from '../voxel/palette';
import { HEIGHT_MAX, HEIGHT_MIN, scaleOfCm } from '../meta/physique';

export type HairStyle =
  // Men's (v75 added buzz to bald).
  | 'crop' | 'messy' | 'spiky' | 'mohawk' | 'buzz' | 'fade' | 'sidepart' | 'quiff' | 'slick' | 'curtains' | 'curly' | 'flow' | 'manbun' | 'locs' | 'cornrows' | 'bald'
  // Women's (v75 added pixie to puff).
  | 'bun' | 'ponytail' | 'bob' | 'pixie' | 'lob' | 'waves' | 'curls' | 'sleek' | 'braid' | 'twinbraids' | 'pigtails' | 'topknot' | 'spacebuns' | 'puff'
  // Both.
  | 'long' | 'afro';

/** The hair styles the editor offers for each body (v75: hair follows the body you pick). */
export const HAIR_FOR: Record<Body, HairStyle[]> = {
  masc: ['buzz', 'crop', 'fade', 'sidepart', 'quiff', 'slick', 'curtains', 'messy', 'spiky', 'curly', 'mohawk', 'flow', 'long', 'manbun', 'locs', 'cornrows', 'afro', 'bald'],
  fem: ['pixie', 'bob', 'lob', 'long', 'waves', 'curls', 'ponytail', 'sleek', 'braid', 'twinbraids', 'pigtails', 'bun', 'topknot', 'spacebuns', 'puff', 'afro'],
};
/** What a body starts with when you switch to it. */
export const HAIR_DEFAULT: Record<Body, HairStyle> = { masc: 'messy', fem: 'ponytail' };
/** Body shape (phase 23). */
export type Body = 'masc' | 'fem';
/** Shorts, or a pleated skirt (phase 23). */
export type Bottom = 'shorts' | 'skirt' | 'long' | 'tights';
/** Socks (v71). */
export type Socks = 'ankle' | 'crew' | 'high';
/** Worn on the head, in the accessory colour (phase 23; was part of some hair styles). */
export type Headwear = 'none' | 'headband' | 'visor' | 'cap';
/** Build (phase 85): four shapes for both bodies. Saves from before map slim, regular, broad onto the first three. */
export type Build = 'lean' | 'athletic' | 'powerful' | 'heavy';
export type Eyes = 'round' | 'narrow' | 'wide' | 'almond' | 'hooded';
/** Iris colour (phase 80). */
export type EyeColor = 'dark' | 'brown' | 'hazel' | 'green' | 'blue' | 'grey';
export type Brows = 'thin' | 'thick' | 'arched' | 'straight' | 'angled' | 'bushy' | 'soft' | 'none';
export type Mouth = 'neutral' | 'smile' | 'grin';
/**
 * Facial hair (phase 81): stubble in three densities, shaped styles painted on the skin,
 * and beards with volume (boxed, full, long).
 */
export type FacialHair =
  | 'none' | 'light' | 'stubble' | 'heavy'
  | 'moustache' | 'pencil' | 'horseshoe' | 'goatee' | 'soulpatch' | 'chinstrap'
  | 'boxed' | 'beard' | 'longbeard';

/**
 * How a character looks (GDD §6.4, §10.4): distinct hair shape, outfit colours
 * and skin tone, so each one reads at a glance from the far baseline.
 */
export interface CharacterLook {
  skin: PaletteIndex;
  hair: PaletteIndex;
  hairStyle: HairStyle;
  shirt: PaletteIndex;
  /** Second shirt colour: collar, shoulder stripe. */
  trim: PaletteIndex;
  /** Shorts or skirt. */
  shorts: PaletteIndex;
  /** Headband, visor, cap, hair tie and wristbands. */
  accessory: PaletteIndex;
  backhand: 'one' | 'two';
  /** Body (phase 20 editor): height as a multiple of the standard 1.72 m (any 150–200 cm since phase 52), and build. */
  height?: number;
  build?: Build;
  /** Face (phase 20 editor). */
  eyes?: Eyes;
  /** Phase 80; players without one get a colour picked from their look. */
  eyeColor?: EyeColor;
  brows?: Brows;
  mouth?: Mouth;
  facialHair?: FacialHair;
  /** Phase 81: how grey the hair, brows and beard have gone, 0..1 (set from age, never saved). */
  grey?: number;
  /** Phase 23: body shape, shorts or skirt, and what's worn on the head. */
  body?: Body;
  bottom?: Bottom;
  headwear?: Headwear;
  /** v71 slider, 0..4 with 2 as standard: muscle (arms and legs). */
  muscle?: number;
  socks?: Socks;
}

/** Your own player's id: its look and name come from the save (phase 20). */
export const YOU_ID = 'you';
/** The player on the other phone in a local PvP match (phase 22): their own editor look. */
export const PEER_ID = 'peer';

/** Heights the editor offers. */
export const HEIGHTS = [0.94, 1, 1.06] as const;

/** A sensible first player for the editor to start from. */
export function defaultLook(): CharacterLook {
  // A new player starts as the art reference: white and blue kit, visor, big ponytail.
  return {
    skin: PAL.skin1,
    hair: PAL.hairBrown,
    hairStyle: 'ponytail',
    shirt: PAL.white,
    trim: PAL.blue,
    shorts: PAL.white,
    accessory: PAL.white,
    backhand: 'two',
    height: 1,
    build: 'athletic',
    eyes: 'round',
    eyeColor: 'brown',
    brows: 'thin',
    mouth: 'neutral',
    facialHair: 'none',
    body: 'fem',
    bottom: 'skirt',
    headwear: 'visor',
    muscle: 2,
    socks: 'crew',
  };
}

/** What the editor offers for each part (and all a save may hold). */
export const LOOK_OPTIONS = {
  skin: [PAL.skin0, PAL.skin1, PAL.skin2, PAL.skinMid, PAL.skin3, PAL.skin4, PAL.skin5],
  hair: [PAL.hairBlack, PAL.hairBrown, PAL.hairAuburn, PAL.hairRed, PAL.hairBlond, PAL.hairPlatinum, PAL.hairGrey, PAL.hairBlue, PAL.hairPink],
  hairStyle: [...new Set([...HAIR_FOR.masc, ...HAIR_FOR.fem])] as HairStyle[],
  body: ['masc', 'fem'] as Body[],
  bottom: ['shorts', 'long', 'skirt', 'tights'] as Bottom[],
  socks: ['ankle', 'crew', 'high'] as Socks[],
  headwear: ['none', 'headband', 'visor', 'cap'] as Headwear[],
  kit: [
    PAL.white, PAL.lightGrey, PAL.charcoal, PAL.black, PAL.navy, PAL.seatNavy, PAL.blue, PAL.cyan, PAL.teal, PAL.mint,
    PAL.forest, PAL.green, PAL.lime, PAL.yellow, PAL.gold, PAL.orange, PAL.coral, PAL.red, PAL.maroon, PAL.pink,
    PAL.lavender, PAL.purple,
  ],
  build: ['lean', 'athletic', 'powerful', 'heavy'] as Build[],
  eyes: ['round', 'almond', 'wide', 'narrow', 'hooded'] as Eyes[],
  eyeColor: ['dark', 'brown', 'hazel', 'green', 'blue', 'grey'] as EyeColor[],
  brows: ['thin', 'thick', 'arched', 'straight', 'angled', 'bushy', 'soft', 'none'] as Brows[],
  mouth: ['neutral', 'smile', 'grin'] as Mouth[],
  facialHair: ['none', 'light', 'stubble', 'heavy', 'moustache', 'pencil', 'horseshoe', 'goatee', 'soulpatch', 'chinstrap', 'boxed', 'beard', 'longbeard'] as FacialHair[],
};

/**
 * A look read from a save: every field checked against what the editor offers, anything
 * else replaced from `fallback`, so a hand-edited save can't draw garbage.
 */
export function sanitizeLook(v: unknown, fallback: CharacterLook = defaultLook()): CharacterLook {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pick = <T>(key: keyof CharacterLook, allowed: readonly T[]): T =>
    allowed.includes(r[key] as T) ? (r[key] as T) : (fallback[key] as T);
  return {
    skin: pick('skin', LOOK_OPTIONS.skin),
    hair: pick('hair', LOOK_OPTIONS.hair),
    hairStyle: pick('hairStyle', LOOK_OPTIONS.hairStyle),
    shirt: pick('shirt', LOOK_OPTIONS.kit),
    trim: pick('trim', LOOK_OPTIONS.kit),
    shorts: pick('shorts', LOOK_OPTIONS.kit),
    accessory: pick('accessory', LOOK_OPTIONS.kit),
    backhand: pick('backhand', ['one', 'two'] as const),
    // Any height from 150 to 200 cm (phase 52); anything outside it isn't a person.
    height: typeof r.height === 'number' && r.height >= scaleOfCm(HEIGHT_MIN) - 1e-9 && r.height <= scaleOfCm(HEIGHT_MAX) + 1e-9 ? r.height : fallback.height,
    build: (({ slim: 'lean', regular: 'athletic', broad: 'powerful' }) as Record<string, Build>)[r.build as string] ?? pick('build', LOOK_OPTIONS.build),
    eyes: pick('eyes', LOOK_OPTIONS.eyes),
    ...(LOOK_OPTIONS.eyeColor.includes(r.eyeColor as EyeColor) ? { eyeColor: r.eyeColor as EyeColor } : fallback.eyeColor ? { eyeColor: fallback.eyeColor } : {}),
    brows: pick('brows', LOOK_OPTIONS.brows),
    mouth: pick('mouth', LOOK_OPTIONS.mouth),
    facialHair: pick('facialHair', LOOK_OPTIONS.facialHair),
    body: pick('body', LOOK_OPTIONS.body),
    bottom: pick('bottom', LOOK_OPTIONS.bottom),
    // Saves from before phase 23: the cap was a hair style, and some styles wore a headband.
    headwear: LOOK_OPTIONS.headwear.includes(r.headwear as Headwear)
      ? (r.headwear as Headwear)
      : r.hairStyle === 'cap'
        ? 'cap'
        : ['spiky', 'afro', 'long'].includes(r.hairStyle as string)
          ? 'headband'
          : (fallback.headwear ?? 'none'),
    muscle: slider(r.muscle, fallback.muscle),
    socks: pick('socks', LOOK_OPTIONS.socks),
  };
}

/** A body slider from a save: a whole step 0..4, else the fallback (2, the standard body). */
function slider(v: unknown, fallback = 2): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4 ? v : fallback;
}

/** A random build, heavy the rarest (phase 85). */
export function anyBuild(random: () => number): Build {
  const r = random();
  return r < 0.28 ? 'lean' : r < 0.68 ? 'athletic' : r < 0.9 ? 'powerful' : 'heavy';
}

/** A random player for the editor's Randomize button. */
export function randomLook(random: () => number = Math.random): CharacterLook {
  const any = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
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
    backhand: random() < 0.75 ? 'two' : 'one',
    height: scaleOfCm(158 + Math.round((random() + random()) * 18)),
    build: anyBuild(random),
    eyes: any(LOOK_OPTIONS.eyes),
    eyeColor: any(LOOK_OPTIONS.eyeColor),
    brows: any(LOOK_OPTIONS.brows),
    mouth: any(LOOK_OPTIONS.mouth),
    facialHair: body === 'fem' || random() < 0.6 ? 'none' : any(LOOK_OPTIONS.facialHair),
    body,
    bottom: body === 'fem' && random() < 0.6 ? 'skirt' : random() < 0.75 ? 'shorts' : any(['long', 'tights'] as Bottom[]),
    muscle: Math.floor(random() * 5),
    socks: any(LOOK_OPTIONS.socks),
    headwear: any(LOOK_OPTIONS.headwear),
  };
}

let yours: CharacterLook = defaultLook();
let peers: CharacterLook = defaultLook();

/** Set what your player looks like (from the save, or the editor's live preview). */
export function setYourLook(look: CharacterLook): void {
  yours = { ...look };
}

/** What the other phone's player looks like (sent when the phones pair). */
export function setPeerLook(look: CharacterLook): void {
  peers = { ...look };
}

/** Shirt cuts the store's clothing comes in (phase 21). */
export type Cut = 'tee' | 'tank' | 'long' | 'polo' | 'vneck' | 'raglan' | 'muscle' | 'zip'
  // Phase 63: a buttoned henley, a racerback tank and two tennis dresses (worn as a matching top on a man's body).
  | 'henley' | 'racerback' | 'dress' | 'racerdress';

/** A shirt's print (phase 63), in `pattern2` (or the trim colour). */
export type KitPattern = 'stripes' | 'hoops' | 'pinstripe' | 'chevron' | 'dots' | 'fade' | 'block' | 'print';

/**
 * A real racket's paint job (phase 27), in its own colours (0xRRGGBB): the main frame
 * colour, a second one laid on by `pattern`, an accent (bridge, bands), the colour of
 * the lettering on the frame, the logo stencilled on the strings, and the head shape
 * (Yonex's squarer isometric head).
 */
export interface RacketDesign {
  frame: number;
  frame2: number;
  accent: number;
  text: number;
  /** solid: one colour; split: top half / bottom half; fade: frame2 dithered in toward the tip; throat: frame2 on the throat and handle. */
  pattern: 'solid' | 'split' | 'fade' | 'throat';
  stencil: 'W' | 'B' | 'Y' | 'H';
  stencilColor: number;
  head?: 'oval' | 'iso';
}

/** A real shoe's colours (phase 27): upper, outsole, midsole, heel accent and the brand mark on the side. */
export interface ShoeDesign {
  upper: number;
  sole: number;
  mid: number;
  accent: number;
  logo: 'swoosh' | 'stripes' | 'asics' | 'nb';
  logoColor: number;
}

/** A real shirt's colours and chest logo (phase 27). */
export interface KitDesign {
  shirt: number;
  trim: number;
  logo: 'swoosh' | 'stripes' | 'laurel' | 'ua' | 'fila' | 'croc' | 'w';
  logoColor: number;
  pattern?: KitPattern;
  pattern2?: number;
}

/** What gear shows on the model: racket, wrap and shoe colours, the wristband, and the shirt cut. */
export interface GearLook {
  racket: PaletteIndex;
  grip: PaletteIndex;
  shoes: PaletteIndex;
  wristband: PaletteIndex;
  cut?: Cut;
  /** Branded items (phase 27): their real paint jobs, over the plain colours above. */
  racketDesign?: RacketDesign;
  shoeDesign?: ShoeDesign;
  /** Overgrip colour and its finishing tape (0xRRGGBB). */
  wrap?: { color: number; tape: number };
  kit?: KitDesign;
}

/** The roster (rivals since phase 20), redrawn in phase 23: three men, three women. */
export const LOOKS: Record<string, CharacterLook> = {
  rio: { skin: PAL.skin2, hair: PAL.hairBrown, hairStyle: 'messy', shirt: PAL.orange, trim: PAL.white, shorts: PAL.seatNavy, accessory: PAL.white, backhand: 'two', body: 'masc', bottom: 'shorts', headwear: 'headband', mouth: 'smile' },
  juno: { skin: PAL.skin3, hair: PAL.hairBlack, hairStyle: 'bun', shirt: PAL.teal, trim: PAL.white, shorts: PAL.white, accessory: PAL.yellow, backhand: 'two', body: 'fem', bottom: 'skirt', headwear: 'headband', eyes: 'wide' },
  wren: { skin: PAL.skin1, hair: PAL.hairRed, hairStyle: 'ponytail', shirt: PAL.purple, trim: PAL.pink, shorts: PAL.charcoal, accessory: PAL.white, backhand: 'two', body: 'fem', bottom: 'shorts', headwear: 'visor', mouth: 'smile' },
  ash: { skin: PAL.skin1, hair: PAL.hairBlond, hairStyle: 'crop', shirt: PAL.blue, trim: PAL.white, shorts: PAL.white, accessory: PAL.white, backhand: 'one', body: 'masc', bottom: 'shorts', headwear: 'cap', brows: 'thick' },
  sora: { skin: PAL.skin2, hair: PAL.hairBlack, hairStyle: 'long', shirt: PAL.pink, trim: PAL.white, shorts: PAL.white, accessory: PAL.cyan, backhand: 'two', body: 'masc', bottom: 'shorts', headwear: 'headband', facialHair: 'stubble' },
  mila: { skin: PAL.skin4, hair: PAL.hairBlack, hairStyle: 'afro', shirt: PAL.red, trim: PAL.yellow, shorts: PAL.black, accessory: PAL.yellow, backhand: 'one', body: 'fem', bottom: 'skirt', headwear: 'headband', eyes: 'wide' },
};

/** Starter gear each character is drawn with until the gear phase hands out real items. */
export const STARTER_GEAR: Record<string, GearLook> = {
  rio: { racket: PAL.charcoal, grip: PAL.white, shoes: PAL.white, wristband: PAL.orange },
  juno: { racket: PAL.white, grip: PAL.teal, shoes: PAL.white, wristband: PAL.teal },
  wren: { racket: PAL.purple, grip: PAL.black, shoes: PAL.charcoal, wristband: PAL.pink },
  ash: { racket: PAL.blue, grip: PAL.white, shoes: PAL.white, wristband: PAL.white },
  sora: { racket: PAL.pink, grip: PAL.white, shoes: PAL.lightGrey, wristband: PAL.cyan },
  mila: { racket: PAL.red, grip: PAL.black, shoes: PAL.black, wristband: PAL.yellow },
};

export function lookOf(id: string): CharacterLook {
  const base = id === YOU_ID ? { ...yours } : id === PEER_ID ? { ...peers } : (LOOKS[id] ?? LOOKS.rio);
  const age = id === PEER_ID ? undefined : ageOf(id);
  return age === undefined || base.grey !== undefined ? base : { ...base, grey: greyAt(age, id) };
}

let ageOf: (id: string) => number | undefined = () => undefined;

/** Who is how old this season (phase 81), so hair greys with age: set by the game once a career is loaded. */
export function setAges(fn: (id: string) => number | undefined): void {
  ageOf = fn;
}

/**
 * How grey someone has gone at an age (phase 81): it starts somewhere from 29 to 38 (their
 * own, from their id) and creeps in over the next twelve years or so. In tenths, so the
 * same person draws the same way all season.
 */
export function greyAt(age: number, id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003;
  const onset = 29 + (h % 1000) / 1000 * 9;
  return Math.round(Math.max(0, Math.min(0.9, (age - onset) / 12)) * 10) / 10;
}

export function starterGear(id: string): GearLook {
  if (id === YOU_ID || id === PEER_ID) {
    const l = lookOf(id);
    return { racket: PAL.blue, grip: PAL.white, shoes: PAL.white, wristband: l.accessory, cut: l.body === 'fem' ? 'tank' : 'polo' };
  }
  return { ...(STARTER_GEAR[id] ?? STARTER_GEAR.rio) };
}
