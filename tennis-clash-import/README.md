# Smol Tennis character import

Character models and animation code copied from the Smol Tennis (Tennis Clash web) game,
TypeScript + Three.js 0.186.1. Folder layout mirrors the original `src/` so relative imports
keep working. There are **no texture or model files**: every character is built procedurally
in code (SDF shapes voxelised onto a 2 cm grid) and painted from a shared palette.

## characters/
- `rig.ts` – the main character builder: body parts as SDF shapes, hair styles, builds, kits, racket/shoe/kit paint jobs, bones and skinned voxel mesh (`buildRig`, `BONES`, `CHAR_HEIGHT`).
- `voxelBody.ts` – samples SDF parts onto one voxel grid, assigns each block to one bone, emits faces with corner AO and bevel UVs.
- `material.ts` – the toy-like character material (baked AO, bevel, colour jitter).
- `faceRig.ts` – animated faces: eyes, lids, brows, mouth as small blocks, with expressions (blink, grin, roar...).
- `face.ts` – older painted-texture face, now only used by dev tools (legacy).
- `looks.ts` – `CharacterLook` / `GearLook` data: hair, skin, eyes, build, height, kit cuts and patterns, plus `RacketDesign`, `ShoeDesign`, `KitDesign`.
- `anim.ts` – skeleton poses and spline clips: strokes, serve, run, lunge, slide, celebrations, players' box poses (`CLIPS`, `sample`, `BOX_POSES`, `hipTurn`, `aim`).
- `characters.ts` – roster definitions and stat keys.
- `staffLooks.ts` – seeded looks for coaches and medical staff.
- `rigBuilder.ts` + `rig.worker.ts` – build detailed bodies in a Web Worker (Vite `?worker&inline` import).

## Supporting files
- `model/sdf.ts` – signed-distance shape primitives and smooth unions used by `rig.ts`.
- `voxel/palette.ts` – the shared colour palette (`PAL`, `DEFAULT_PALETTE`).
- `meta/physique.ts` – height/age scaling (`scaleOfCm`) used by `looks.ts`.
- `player/mods.ts` – the `PlayMods` type `physique.ts` needs.
- `player/PlayerView.ts` – drives a rig in a match: plays clips, run lean, head tracking, expressions.
- `player/endings.ts` – win/loss celebration clips picked per occasion.
- `render/PlayerBox.ts` – low-detail seated team members in the stands using `BOX_POSES`.
- `render/Showroom.ts` + `render/characterLights.ts` – close-up character display with studio lighting.
- `meta/gear.ts` – the store's real-product gear and their paint jobs (designs feed `GearLook`).

## Not included (game code these files reference)
`PlayerView.ts` needs `config`, `hit/*`, `PlayerSim`; `characters.ts` needs `ai/profiles`;
`staffLooks.ts` needs `meta/names`, `meta/skills`, `meta/fitness`; `gear.ts` needs
`meta/setup`, `skills`, `coaches`, `fitness`, `press`; `PlayerBox.ts` needs `world/*` types.
The core rig (`rig.ts`, `voxelBody.ts`, `material.ts`, `faceRig.ts`, `looks.ts`, `anim.ts`,
`sdf.ts`, `palette.ts`, `physique.ts`, `mods.ts`) is self-contained apart from `three`.
