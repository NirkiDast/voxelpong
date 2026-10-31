import * as THREE from 'three';
import { PAL, type Palette } from '../voxel/palette';
import type { CharacterLook } from './looks';

/** Pixels per centimetre of face at full size. */
const PX = 18;
/** Face texture area in head-part cm (matches FACE_BOX in rig.ts). */
const X0 = -11;
const X1 = 11;
const Y0 = 4;
const Y1 = 30;

type RGB = [number, number, number];

/**
 * The face (character remake): big glossy eyes with heavy upper lashes, light brows, a
 * small mouth and soft blush, painted into a texture laid over the front of the head.
 * Drawn with signed distances per pixel, so edges are smooth at any size and it works
 * without a canvas (unit tests).
 */
export function faceTexture(l: CharacterLook, palette: Palette, size = 1): THREE.DataTexture {
  const S = PX * size;
  const W = Math.round((X1 - X0) * S);
  const H = Math.round((Y1 - Y0) * S);
  const data = new Uint8Array(W * H * 4);
  const fem = l.body === 'fem';
  const hex = (i: number): RGB => {
    const h = palette.hexOf(i);
    return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  };
  const skin = hex(l.skin);
  const hair = hex(l.hair);
  const dark = l.skin === PAL.skin4 || l.skin === PAL.skin5 || l.skin === PAL.skin3;
  const ink: RGB = [26, 28, 44];
  const browC = mix(hair, ink, 0.45);
  const lip: RGB = dark ? mix(skin, [60, 20, 20], 0.55) : mix(skin, [150, 50, 60], 0.55);
  const blush: RGB = dark ? mix(skin, [200, 70, 90], 0.3) : [250, 150, 160];
  const irisTop: RGB = [10, 12, 28];
  const irisBot: RGB = [40, 58, 110];

  const eyes = l.eyes ?? 'round';
  const hw = eyes === 'narrow' ? 2.6 : eyes === 'wide' ? 2.7 : 2.55;
  const hh = eyes === 'narrow' ? 2.2 : eyes === 'wide' ? 3.7 : 3.4;
  const EX = 5.0;
  const EY = 17.4;
  const brows = l.brows ?? 'thin';
  const mouth = l.mouth ?? 'neutral';
  const fh = l.facialHair ?? 'none';

  for (let j = 0; j < H; j++) {
    const y = Y0 + (j + 0.5) / S;
    for (let i = 0; i < W; i++) {
      const x = X0 + (i + 0.5) / S;
      // Transparent pixels keep the skin colour so filtering never darkens edges.
      let r = skin[0], g = skin[1], b = skin[2], a = 0;
      const over = (c: RGB, alpha: number) => {
        if (alpha <= 0) return;
        const k = Math.min(1, alpha);
        if (a === 0) [r, g, b] = c;
        r = r * (1 - k) + c[0] * k;
        g = g * (1 - k) + c[1] * k;
        b = b * (1 - k) + c[2] * k;
        a = a + (1 - a) * k;
      };
      const cover = (d: number) => Math.min(1, Math.max(0, 0.5 - d * S));
      const ax = Math.abs(x);

      // Blush under the eyes.
      const bl = Math.hypot((ax - 6.4) / 2.1, (y - 13.6) / 1.1);
      over(blush, Math.max(0, 1 - bl) ** 2 * (fem ? 0.35 : 0.18));

      // Stubble shadow over the jaw.
      if (fh === 'stubble' || fh === 'beard') {
        const jaw = y < 13.4 && ax < 9.5 && !(Math.hypot(x / 2.6, (y - 10.8) / 1.1) < 1);
        if (jaw) over(hair, (0.25 + 0.15 * hash(i, j)) * Math.min(1, (13.4 - y) / 1.2));
      }

      // Eyes: tall ovals almost filled by a dark glossy iris, a heavy upper lash line and
      // a big highlight on the side the light comes from.
      const ex = ax - EX;
      const ey = y - EY;
      const sx = x - Math.sign(x) * EX;
      const eyeD = (Math.hypot(ex / hw, (ey > 0 ? ey * 1.05 : ey) / hh) - 1) * Math.min(hw, hh);
      const inEye = cover(eyeD);
      if (inEye > 0) {
        over([250, 250, 252], inEye);
        const ix = ex + 0.28;
        const iy = ey - 0.05;
        const irisD = (Math.hypot(ix / (hw * 0.9), iy / (hh * 0.98)) - 1) * hw * 0.9;
        const t = Math.min(1, Math.max(0, (iy / hh + 1) / 2));
        over(mix(irisBot, irisTop, t ** 0.7), cover(irisD) * inEye);
        // A darker rim and pupil.
        over(irisTop, cover(Math.abs(irisD + 0.12) - 0.12) * inEye * 0.7);
        over([8, 9, 20], cover((Math.hypot(ix / (hw * 0.45), iy / (hh * 0.5)) - 1) * hw * 0.45) * inEye * 0.85);
        const hx = sx + Math.sign(x) * 0.28;
        over([255, 255, 255], cover(Math.hypot(hx - 0.55, iy - hh * 0.42) - hw * 0.27) * inEye);
        over([255, 255, 255], cover(Math.hypot(hx + 0.55, iy + hh * 0.5) - hw * 0.1) * inEye * 0.8);
      }
      // Upper lash line over the top of the eye, running a little past the outer corner.
      {
        const top = eyeTop(ex, hw, hh);
        const thick = (fem ? 0.6 : 0.42) + (fem ? 0.22 : 0.06) * Math.max(0, ex / hw);
        const d = Math.max(Math.abs(ey - top - thick * 0.3) - thick * 0.5, ex - hw * (fem ? 1.06 : 1.0), -hw * 0.98 - ex);
        over(ink, cover(d));
        // A soft crease above the lid.
        if (Math.abs(ex) < hw * 0.85) over(mix(skin, ink, 0.25), cover(Math.abs(ey - top - 0.9) - 0.06) * 0.5);
      }

      // Brows: thick at the inner end, thinning toward the outside.
      if (brows !== 'none') {
        const bx = ax - EX - 0.1;
        const by = y - (EY + hh + 1.25 - (bx / 3) ** 2 * 0.55 + bx * 0.1);
        const thick = brows === 'thick' ? 0.6 : 0.46;
        const len = brows === 'thick' ? 2.6 : 2.4;
        const taper = 1 - 0.55 * Math.min(1, Math.max(0, (bx + len) / (2 * len)));
        const d = Math.max(Math.abs(by) - thick * taper, Math.hypot(Math.max(0, Math.abs(bx) - len + 0.3), 0) - 0.3);
        over(browC, cover(d));
      }

      // Mouth.
      const my = y - 11.9;
      if (mouth === 'grin') {
        const d = Math.max(Math.hypot(x / 1.9, Math.min(0, my) / 1.2) - 1, my - 0.05);
        over(mix(lip, [80, 20, 30], 0.5), cover(d * 1.4));
        over([255, 255, 255], cover(Math.max(d * 1.4, -(my + 0.38))));
      } else if (mouth === 'smile') {
        const d = Math.max(Math.abs(my - (x / 1.7) ** 2 * 0.55) - 0.13, ax - 1.7);
        over(lip, cover(d));
      } else {
        over(lip, cover(Math.max(Math.abs(my - (x / 1.2) ** 2 * 0.12) - 0.11, ax - 1.1)));
      }
      if (fh === 'moustache' || fh === 'beard') {
        const d = Math.max(Math.abs(y - 12 + ax * 0.12) - 0.42, ax - 2.4);
        over(hair, cover(d));
      }

      const o = (j * W + i) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Height of the top edge of the eye above its centre at offset `ex`. */
function eyeTop(ex: number, hw: number, hh: number): number {
  const u = Math.min(1, Math.abs(ex) / hw);
  return hh * Math.sqrt(1 - u * u) / 1.1 + ex * 0.08;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function hash(i: number, j: number): number {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
