import * as THREE from 'three';
import { STAT_KEYS, type CharacterDef, type Stats } from '../characters/characters';
import { lookOf, starterGear, type Cut, type GearLook, type KitDesign, type RacketDesign, type ShoeDesign } from '../characters/looks';
import { combineMods, type PlayMods } from '../player/mods';
import { DEFAULT_PALETTE, PAL, type PaletteIndex } from '../voxel/palette';
import { setupMods, setupOf, type Setup } from './setup';
import { addBonus, skillBonus, skillMods, type Skills } from './skills';
import { teamBonus, teamMods, type Team } from './coaches';
import { bodyMods, type Body } from './fitness';
import { repMods, type Rep } from './press';
import { ageInSeason, ageMods } from './physique';

/**
 * Looks (phase 21, looks only since phase 35): racket paint jobs, wraps, shoes and
 * clothing bought with coins in the store. They change how your player looks (racket,
 * wrap and shoe colours, the shirt and its cut) and nothing else: how you play comes from
 * your setup (setup.ts). New items appear as your ranking opens store tours.
 *
 * Since phase 27 every item is a real product (Wilson Blade 98, adidas Barricade, Yonex
 * Super Grap...) painted the way the real one is, as far as voxels allow.
 */

export type StatKey = keyof Stats;
export type GearSlot = 'racket' | 'wrap' | 'shoes' | 'clothing';

export const SLOTS: GearSlot[] = ['racket', 'wrap', 'shoes', 'clothing'];
export const SLOT_LABEL: Record<GearSlot, string> = { racket: 'Racket', wrap: 'Wrap', shoes: 'Shoes', clothing: 'Clothing' };
/** Store tab names. */
export const SLOT_PLURAL: Record<GearSlot, string> = { racket: 'Rackets', wrap: 'Wraps', shoes: 'Shoes', clothing: 'Clothing' };

export interface GearDef {
  id: string;
  slot: GearSlot;
  name: string;
  /** Tour that puts it in the store. */
  tour: number;
  price: number;
  /** Colour on the model (racket frame, wrap, shoes); null keeps the starter colour. */
  color: PaletteIndex | null;
  /** Clothing: the shirt's cut. */
  cut?: Cut;
  /** The maker, for the store card. */
  brand: string;
  /** The real product's paint job (one of these, by slot). */
  racket?: RacketDesign;
  shoe?: ShoeDesign;
  wrap?: { color: number; tape: number };
  kit?: KitDesign;
}

type Look = Pick<GearDef, 'racket' | 'shoe' | 'wrap' | 'kit' | 'cut'>;

const g = (id: string, slot: GearSlot, brand: string, name: string, tour: number, price: number, color: PaletteIndex | null, look: Look = {}): GearDef => ({
  id,
  slot,
  brand,
  name,
  tour,
  price,
  color,
  ...look,
});

const racket = (frame: number, frame2: number, accent: number, text: number, pattern: RacketDesign['pattern'], stencil: RacketDesign['stencil'], stencilColor: number, head: RacketDesign['head'] = 'oval'): Look => ({
  racket: { frame, frame2, accent, text, pattern, stencil, stencilColor, head },
});
const shoe = (upper: number, sole: number, mid: number, accent: number, logo: ShoeDesign['logo'], logoColor: number): Look => ({ shoe: { upper, sole, mid, accent, logo, logoColor } });
const wrap = (color: number, tape: number): Look => ({ wrap: { color, tape } });
const kit = (cut: Cut | undefined, shirt: number, trim: number, logo: KitDesign['logo'], logoColor: number, pattern?: KitDesign['pattern'], pattern2?: number): Look => ({
  cut,
  kit: { shirt, trim, logo, logoColor, ...(pattern ? { pattern } : {}), ...(pattern2 !== undefined ? { pattern2 } : {}) },
});

/**
 * The catalogue: a free starter per slot, then more unlocking tour by tour. Real products, each in its best-known colours (2022-2024 models).
 */
export const GEAR: GearDef[] = [
  g('starter-racket', 'racket', 'Head', 'Ti.S6', 1, 0, PAL.lightGrey, racket(0xb9bec7, 0x2f6fbf, 0x2f6fbf, 0x1d3f7a, 'throat', 'H', 0x1d3f7a)),
  g('hammer', 'racket', 'Babolat', 'Pure Drive', 1, 250, PAL.blue, racket(0x1a6fd6, 0x0d3f8f, 0xf4f6f8, 0xf4f6f8, 'throat', 'B', 0x15171c)),
  g('whisper', 'racket', 'Wilson', 'Pro Staff 97', 2, 750, PAL.black, racket(0x1b1b1e, 0x2a2a2e, 0x8e1b2c, 0xc8c8c8, 'solid', 'W', 0xe6e6e6)),
  g('speed', 'racket', 'Head', 'Speed MP', 2, 1200, PAL.white, racket(0xf1f1ee, 0x18191c, 0x9aa0a6, 0x18191c, 'split', 'H', 0x18191c)),
  g('eagle', 'racket', 'Wilson', 'Blade 98', 3, 2400, PAL.forest, racket(0x2f6a4b, 0x0f1914, 0xb3793f, 0xdbe8df, 'fade', 'W', 0x15171c)),
  g('defyer', 'racket', 'Wilson', 'Defyer 100', 3, 3600, PAL.red, racket(0xe0232b, 0x141416, 0x141416, 0xf4f4f4, 'throat', 'W', 0x15171c)),
  g('thunderbolt', 'racket', 'Babolat', 'Pure Aero', 4, 6250, PAL.yellow, racket(0xf2d21b, 0x15171b, 0xf4f6f8, 0x15171b, 'split', 'B', 0x15171c)),
  g('vcore', 'racket', 'Yonex', 'VCORE 98', 4, 8000, PAL.red, racket(0xb3122e, 0x18181a, 0xe8e8e8, 0xf4f4f4, 'throat', 'Y', 0x15171c, 'iso')),
  g('royal', 'racket', 'Yonex', 'EZONE 98', 5, 12500, PAL.blue, racket(0x1b55d6, 0x4cc0ee, 0xf4f6f8, 0xf4f6f8, 'fade', 'Y', 0x15171c, 'iso')),

  g('classic-wrap', 'wrap', 'Wilson', 'Pro Overgrip', 1, 0, PAL.white, wrap(0xf4f4f1, 0x1a1a1a)),
  g('tacky', 'wrap', 'Tourna', 'Grip Original', 1, 150, PAL.sky, wrap(0x7fb8e0, 0xf4f4f1)),
  g('talon', 'wrap', 'Yonex', 'Super Grap', 2, 500, PAL.yellow, wrap(0xf2e231, 0x1a1a1a)),
  g('volley-tape', 'wrap', 'Babolat', 'VS Original', 3, 1800, PAL.black, wrap(0x222428, 0xf4f4f1)),
  g('viper', 'wrap', 'Head', 'Prime Tour', 4, 5000, PAL.charcoal, wrap(0x3b3f46, 0xe0362c)),
  g('silk', 'wrap', 'Wilson', 'Pro Overgrip Pink', 5, 11250, PAL.pink, wrap(0xf07fb0, 0xf4f4f1)),

  g('court-runner', 'shoes', 'Asics', 'Gel-Dedicate 8', 1, 0, PAL.white, shoe(0xf3f4f6, 0x24357f, 0xf3f4f6, 0x2a5ad6, 'asics', 0x2a5ad6)),
  g('feather', 'shoes', 'Nike', 'Zoom Vapor 11', 1, 200, PAL.lime, shoe(0xf4f4f4, 0xc8f03c, 0xf4f4f4, 0x151515, 'swoosh', 0x151515)),
  g('marathon', 'shoes', 'Asics', 'Gel-Resolution 9', 2, 700, PAL.blue, shoe(0x2b49b5, 0xf2d22a, 0xf3f4f6, 0xf2d22a, 'asics', 0xf3f4f6)),
  g('lightning', 'shoes', 'adidas', 'Adizero Ubersonic 4', 3, 2200, PAL.yellow, shoe(0xe6f34a, 0x1a1a1a, 0xf4f4f4, 0x1a1a1a, 'stripes', 0x1a1a1a)),
  g('slider', 'shoes', 'adidas', 'Barricade 13', 4, 6000, PAL.white, shoe(0xf4f4f4, 0x1f2a5c, 0xd9dde4, 0xd4252f, 'stripes', 0x1f2a5c)),
  g('comet', 'shoes', 'New Balance', 'Fresh Foam X Lav v2', 5, 12000, PAL.navy, shoe(0x1d2b4f, 0x8a9099, 0xf4f4f4, 0xb8bfc8, 'nb', 0xf4f4f4)),

  g('club-tee', 'clothing', 'Club', 'Club Kit', 1, 0, null),
  g('tank', 'clothing', 'Nike', 'Dri-FIT Slam Tank', 1, 200, null, kit('tank', 0xf4f4f4, 0x151515, 'swoosh', 0x151515)),
  g('compression', 'clothing', 'Under Armour', 'HeatGear Long Sleeve', 2, 700, null, kit('long', 0x1b1c1f, 0x5d6168, 'ua', 0xf4f4f4)),
  g('polo', 'clothing', 'Fred Perry', 'Twin Tipped Polo', 3, 2000, null, kit('polo', 0xf5f4ef, 0x1f5b3a, 'laurel', 0x1f5b3a)),
  g('mesh', 'clothing', 'adidas', 'Club 3-Stripes Tank', 4, 5500, null, kit('tank', 0x1e2a5a, 0xf4f4f4, 'stripes', 0xf4f4f4)),
  g('heritage', 'clothing', 'Fila', 'Heritage Long Sleeve', 5, 11500, null, kit('long', 0xf5f4ef, 0x1d2b55, 'fila', 0xc8102e)),
  // v71: more cuts (V-neck, raglan, sleeveless, quarter-zip) and more makers.
  g('team-vneck', 'clothing', 'Wilson', 'Team V-Neck', 1, 250, null, kit('vneck', 0xd31f2b, 0xf4f4f4, 'w', 0xf4f4f4)),
  g('rafa-sleeveless', 'clothing', 'Nike', 'Rafa Sleeveless', 2, 900, null, kit('muscle', 0xc6f03a, 0x151515, 'swoosh', 0x151515)),
  g('club-raglan', 'clothing', 'adidas', 'Club Raglan Tee', 2, 1100, null, kit('raglan', 0xf4f4f4, 0x1e2a5a, 'stripes', 0x1e2a5a)),
  g('ultra-dry', 'clothing', 'Lacoste', 'Ultra-Dry Polo', 3, 2600, null, kit('polo', 0xf5f4ef, 0x1f5b3a, 'croc', 0x2e8b4a)),
  g('tech-zip', 'clothing', 'Under Armour', 'Tech Quarter-Zip', 3, 3200, null, kit('zip', 0x2b2f36, 0xd4252f, 'ua', 0xf4f4f4)),
  g('heritage-vneck', 'clothing', 'Fila', 'Heritage V-Neck', 4, 6000, null, kit('vneck', 0x1d2b55, 0xc8102e, 'fila', 0xc8102e)),
  g('court-raglan', 'clothing', 'Nike', 'Court Heritage Raglan', 4, 6800, null, kit('raglan', 0xf4f4f4, 0x151515, 'swoosh', 0x151515)),
  g('pro-sleeveless', 'clothing', 'adidas', 'Pro Sleeveless', 5, 11000, null, kit('muscle', 0x1b1c1f, 0xe6f34a, 'stripes', 0xe6f34a)),
  g('tour-zip', 'clothing', 'Wilson', 'Tour Quarter-Zip', 5, 12500, null, kit('zip', 0xf5f4ef, 0x8e1b2c, 'w', 0x8e1b2c)),
  // Phase 63: printed shirts, a henley, a racerback and tennis dresses (worn as the matching top on a man's body).
  g('victory-racerback', 'clothing', 'Nike', 'Court Victory Tank', 1, 300, null, kit('racerback', 0xe23a6a, 0xf4f4f4, 'swoosh', 0xf4f4f4)),
  g('club-striped', 'clothing', 'adidas', 'Club Striped Tee', 2, 950, null, kit('tee', 0xf4f4f4, 0x1e2a5a, 'stripes', 0x1e2a5a, 'stripes', 0x1e2a5a)),
  g('essenza-henley', 'clothing', 'Fila', 'Essenza Henley', 2, 1000, null, kit('henley', 0x1d2b55, 0xf5f4ef, 'fila', 0xc8102e)),
  g('victory-dress', 'clothing', 'Nike', 'Court Victory Dress', 2, 1300, null, kit('dress', 0xf4f4f4, 0x151515, 'swoosh', 0x151515)),
  g('heritage-hoops', 'clothing', 'Fila', 'Heritage Hoop Tee', 3, 2400, null, kit('tee', 0x1d2b55, 0xc8102e, 'fila', 0xf5f4ef, 'hoops', 0xf5f4ef)),
  g('dot-tank', 'clothing', 'Wilson', 'Polka Dot Tank', 3, 2800, null, kit('tank', 0xf4f4f4, 0xd31f2b, 'w', 0xd31f2b, 'dots', 0xd31f2b)),
  g('y-dress', 'clothing', 'adidas', 'Y-Dress', 3, 3000, null, kit('racerdress', 0x1e2a5a, 0xc6f03a, 'stripes', 0xc6f03a)),
  g('tech-fade', 'clothing', 'Under Armour', 'Tech Fade Tee', 4, 5800, null, kit('tee', 0x15171c, 0xd4252f, 'ua', 0xf4f4f4, 'fade', 0xd4252f)),
  g('pinstripe-polo', 'clothing', 'Lacoste', 'Pinstripe Polo', 4, 6500, null, kit('polo', 0xf5f4ef, 0x1f2a5c, 'croc', 0x2e8b4a, 'pinstripe', 0x1f2a5c)),
  g('sport-dress', 'clothing', 'Lacoste', 'Sport Tennis Dress', 4, 7000, null, kit('dress', 0x9ad7c6, 0xf5f4ef, 'croc', 0x2e8b4a, 'block', 0xf5f4ef)),
  g('slam-chevron', 'clothing', 'Nike', 'Court Slam Chevron Tee', 5, 10500, null, kit('vneck', 0x151515, 0xc6f03a, 'swoosh', 0xc6f03a, 'chevron', 0xc6f03a)),
  g('heritage-dress', 'clothing', 'Fila', 'Heritage Striped Dress', 5, 12000, null, kit('dress', 0xf5f4ef, 0x1d2b55, 'fila', 0xc8102e, 'stripes', 0x1d2b55)),
  g('team-henley', 'clothing', 'Wilson', 'Team Henley', 6, 15500, null, kit('henley', 0x8e1b2c, 0xf5f4ef, 'w', 0xf5f4ef, 'block', 0xf5f4ef)),
  g('slam-print-dress', 'clothing', 'Nike', 'Court Slam Printed Dress', 6, 17500, null, kit('racerdress', 0x2fb3a0, 0xf4f4f4, 'swoosh', 0xf4f4f4, 'print', 0xf4f4f4)),
  g('sport-vneck', 'clothing', 'Lacoste', 'Sport V-Neck', 6, 16000, null, kit('vneck', 0x1f2a5c, 0xf4f4f4, 'croc', 0x2e8b4a)),
  g('advantage-polo', 'clothing', 'Nike', 'Court Advantage Polo', 7, 20000, null, kit('polo', 0x151515, 0xf4f4f4, 'swoosh', 0xf4f4f4)),
];

const BY_ID = new Map(GEAR.map((d) => [d.id, d]));

export function gearDef(id: string): GearDef {
  const d = BY_ID.get(id);
  if (!d) throw new Error(`Unknown gear ${id}`);
  return d;
}

export function isGear(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id);
}

/** Items of one slot, in store order. */
export function itemsFor(slot: GearSlot): GearDef[] {
  // By tour, then price (v71: added items sit among the old ones).
  return GEAR.filter((d) => d.slot === slot).sort((a, b) => a.tour - b.tour || a.price - b.price);
}

/** The free item every player starts with in a slot. */
export function starterItem(slot: GearSlot): GearDef {
  return itemsFor(slot)[0];
}

/** What's worn: one item per slot. */
export type Kit = Record<GearSlot, string>;

export function starterKit(): Kit {
  return { racket: 'starter-racket', wrap: 'classic-wrap', shoes: 'court-runner', clothing: 'club-tee' };
}

/** The part of the profile gear needs. */
export interface GearOwner {
  coins: number;
  /** Item ids you own (the starters always). */
  owned: string[];
  kit: Kit;
}

export function owns(p: GearOwner, id: string): boolean {
  return gearDef(id).price === 0 || p.owned.includes(id);
}

/** Your kit, with the starter in any slot holding something you don't own. */
export function kitOf(p: GearOwner): Kit {
  const out = starterKit();
  for (const s of SLOTS) {
    const id = p.kit?.[s];
    if (isGear(id) && gearDef(id).slot === s && owns(p, id)) out[s] = id;
  }
  return out;
}

/** Why an item can't be bought, or null. `reached` is the highest tour you've reached. */
/** Since phase 33 a store tour opens at a career ranking: the best you need for its gear. */
const TOUR_RANK = [Infinity, Infinity, 250, 160, 100, 50, 20, 5];

export function tourRank(tour: number): number {
  return TOUR_RANK[Math.max(1, Math.min(7, tour))];
}

/** "RANK #100": what opens a store tour, for its locks. */
export function tourLock(tour: number): string {
  return `RANK #${tourRank(tour)}`;
}

export function buyBlock(p: GearOwner, id: string, reached: number): string | null {
  const d = gearDef(id);
  if (owns(p, id)) return 'OWNED';
  if (d.tour > reached) return tourLock(d.tour);
  if (p.coins < d.price) return 'NOT ENOUGH COINS';
  return null;
}

/** Buy an item and put it on. */
export function buy(p: GearOwner, id: string, reached: number): boolean {
  if (buyBlock(p, id, reached)) return false;
  p.coins -= gearDef(id).price;
  p.owned.push(id);
  equip(p, id);
  return true;
}

/** Put on an item you own. */
export function equip(p: GearOwner, id: string): boolean {
  if (!owns(p, id)) return false;
  p.kit = { ...kitOf(p), [gearDef(id).slot]: id };
  return true;
}

/** Base stats plus a bonus (skill points), each kept within 0–100: what the player plays with. */
export function withGear(base: Stats, bonus: Partial<Stats>): Stats {
  const out = { ...base };
  for (const k of STAT_KEYS) out[k] = THREE.MathUtils.clamp(base[k] + (bonus[k] ?? 0), 0, 100);
  return out;
}

/** How a kit dresses a model: item colours over the character's starter colours, and the shirt cut. */
export function kitLook(kit: Kit, base: GearLook, swap?: string): GearLook {
  const k = { ...kit };
  if (swap) k[gearDef(swap).slot] = swap;
  const look = { ...base };
  const racketColor = gearDef(k.racket).color;
  const wrapColor = gearDef(k.wrap).color;
  const shoes = gearDef(k.shoes).color;
  if (racketColor !== null) look.racket = racketColor;
  if (wrapColor !== null) look.grip = wrapColor;
  if (shoes !== null) look.shoes = shoes;
  // The real products' paint jobs.
  look.racketDesign = gearDef(k.racket).racket;
  look.wrap = gearDef(k.wrap).wrap;
  look.shoeDesign = gearDef(k.shoes).shoe;
  look.kit = gearDef(k.clothing).kit;
  // Starter clothing keeps the character's own cut.
  look.cut = gearDef(k.clothing).cut ?? base.cut ?? 'tee';
  return look;
}

/**
 * A rival dressed in its kit (phase 29): the store's racket, wrap and shoes as they come,
 * but the shirt's cut and logo in the rival's own colours, so a field of rivals in the
 * same few shirts still reads as different people.
 */
export function rivalLook(kit: Kit, charId: string): GearLook {
  const look = kitLook(kit, starterGear(charId));
  if (look.kit) {
    const own = lookOf(charId);
    look.kit = { ...look.kit, shirt: DEFAULT_PALETTE.hexOf(own.shirt), trim: DEFAULT_PALETTE.hexOf(own.trim), logoColor: DEFAULT_PALETTE.hexOf(own.trim), ...(look.kit.pattern ? { pattern2: DEFAULT_PALETTE.hexOf(own.trim) } : {}) };
  }
  return look;
}

export function gearLookOf(p: GearOwner, charId: string, swap?: string): GearLook {
  return kitLook(kitOf(p), starterGear(charId), swap);
}

/** What a match needs to power and dress a character: skill points, setup and looks. */
export interface Geared {
  bonus: Partial<Stats>;
  look: GearLook;
  mods?: PlayMods;
  /** Match items taken in (phase 58). */
  items?: string[];
  /** The Signature Move (phase 59), for the HUD's callouts. */
  sig?: { id: string; level: number };
}

/** Everything a match needs to dress and power your character: skills, setup and looks. */
export function geared(p: GearOwner & { items?: string[]; skills?: Skills; setup: Setup; team?: Team; body?: Body; rep?: Rep; career?: { season: number } }, def: CharacterDef): Geared {
  let mods = combineMods(combineMods(combineMods(setupMods(setupOf(p)), skillMods(p.skills)), combineMods(teamMods(p.team), bodyMods(p.body))), repMods(p.rep));
  // Your age's stamina and accuracy (phase 52).
  if (p.career) mods = combineMods(mods, ageMods(ageInSeason(p.career.season)));
  return { bonus: addBonus(skillBonus(p.skills), teamBonus(p.team)), look: gearLookOf(p, def.id), mods, items: [...(p.items ?? [])], ...(p.skills?.sig ? { sig: { ...p.skills.sig } } : {}) };
}

/** A rival's kit for a tour: anything in the store by then (rivals have their own tastes too). */
export function rivalKit(tour: number, random: () => number = Math.random): Kit {
  const kit = starterKit();
  for (const s of SLOTS) {
    const pool = itemsFor(s).filter((d) => d.tour <= tour);
    kit[s] = pool[Math.floor(random() * pool.length)].id;
  }
  return kit;
}
