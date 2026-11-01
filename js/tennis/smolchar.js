// Smol Tennis characters (imported from Nir's Tennis Clash project, bundled into smol.js) driven
// for the neon doubles game: a looping base (ready / run / serve wait) with one-shot strokes on top,
// plus a glowing team-coloured ring on the racket so it reads in the dark arena.
import * as THREE from 'three';
import './strokes.js';   // adds the shot-specific stroke clips to CLIPS
import { buildRig, BONES, LIFT_SCALE, RACKET_HEAD, CLIPS, sample, restPose, copyPose, lerpPose, LOOKS, STARTER_GEAR, expressionFor, PAL } from './smol.js';

// Two players per team, each from the Smol roster, recoloured into the team's neon kit.
const ROSTER = [
  { id: 'rio', shirt: PAL.cyan, trim: PAL.white, wrist: PAL.cyan },
  { id: 'juno', shirt: PAL.teal, trim: PAL.cyan, wrist: PAL.cyan },
  { id: 'wren', shirt: PAL.pink, trim: PAL.white, wrist: PAL.pink },
  { id: 'mila', shirt: PAL.purple, trim: PAL.pink, wrist: PAL.pink },
];

export const SMOL_SCALE = 1.3; // a little larger than life so they read from the far baseline

export function createSmolPlayer(i, teamColor) {
  const r = ROSTER[i];
  const look = { ...LOOKS[r.id], shirt: r.shirt, trim: r.trim };
  const gear = { ...STARTER_GEAR[r.id], wristband: r.wrist };
  const rig = buildRig(look, gear, 'lo');
  const group = new THREE.Group();
  group.add(rig.group);
  rig.group.scale.setScalar(SMOL_SCALE);

  // Glowing ring around the racket head (the racket bone points along +z; the face lies in its y-z plane).
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.135, 0.012, 6, 28),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor).multiplyScalar(2.4) }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.scale.set(1, 1.25, 1);
  ring.position.set(0, 0, (RACKET_HEAD + 1) * 0.01);
  rig.bones.racket.add(ring);

  const st = {
    base: 'ready', baseT: 0, runK: 0, runT: 0, sideK: 0, c: restPose(),
    shot: null, shotT: 0, shotFade: 0,
    pose: restPose(), a: restPose(), b: restPose(), s: restPose(),
  };

  // Play a one-shot clip, optionally starting part way (e.g. at its contact frame).
  function play(name, from = 0) {
    const c = CLIPS[name];
    if (!c) return;
    st.shot = name;
    st.shotT = from;
    st.shotFade = 0;
    rig.face?.set(expressionFor(name));
  }
  function setBase(name) {
    if (st.base !== name) { st.base = name; st.baseT = 0; rig.face?.set(expressionFor(name)); }
  }
  const contactOf = (name) => CLIPS[name]?.contact ?? 0;

  function update(dt, speed, side = 0) {
    st.baseT += dt;
    // Base: blend ready with a run or a side-step by speed (or a serve loop). The gait has its own
    // clock that speeds up smoothly, so changing speed never makes the legs jump.
    const target = st.base === 'ready' ? Math.min(1, speed / 3.5) : 0;
    st.runK += (target - st.runK) * Math.min(1, dt * 8);
    st.sideK += (side - st.sideK) * Math.min(1, dt * 6);
    st.runT += dt * (0.75 + Math.min(speed, 9) * 0.09);
    if (st.base === 'ready') {
      sample(CLIPS.ready, st.baseT, st.a);
      sample(CLIPS.run, st.runT, st.b);
      sample(CLIPS.sidestep, st.runT * 0.75, st.c);
      lerpPose(st.b, st.c, st.sideK, st.b);
      lerpPose(st.a, st.b, st.runK, st.pose);
    } else {
      sample(CLIPS[st.base], st.baseT, st.pose);
    }
    // One-shot on top, fading back to the base at the end.
    if (st.shot) {
      const c = CLIPS[st.shot];
      st.shotT += dt;
      st.shotFade = Math.min(1, st.shotFade + dt / 0.06);
      sample(c, st.shotT, st.s);
      const out = st.shotT > c.duration - 0.12 ? Math.max(0, (c.duration - st.shotT) / 0.12) : 1;
      lerpPose(st.pose, st.s, st.shotFade * out, st.pose);
      if (st.shotT >= c.duration) { st.shot = null; rig.face?.set(expressionFor(st.base)); }
    }
    const b = rig.bones;
    for (const name of BONES) {
      const p = st.pose[name];
      b[name].rotation.set(p[0], p[1], p[2]);
    }
    b.root.position.y = st.pose.lift * LIFT_SCALE;
    rig.face?.update(dt);
  }

  const _v = new THREE.Vector3();
  return {
    group, rig, play, setBase, update, contactOf,
    busy: () => !!st.shot,
    racketHead: (v = _v) => rig.racketHead(v),
    leftHand: (v = _v) => rig.bones.fArmL.getWorldPosition(v),
  };
}
void copyPose;
