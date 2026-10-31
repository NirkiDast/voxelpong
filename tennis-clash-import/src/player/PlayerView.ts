import * as THREE from 'three';
import { expressionFor } from '../characters/faceRig';
import { STAMINA } from '../config';
import { CLIPS, copyPose, CROUCH, lerpPose, LUNGE, restPose, sample, SLIDE, type ClipName, type Pose, type PoseEdit } from '../characters/anim';
import { lookOf, starterGear, type CharacterLook, type GearLook } from '../characters/looks';
import { BONES, buildRig, CHAR_HEIGHT, LIFT_SCALE, rigReady, type Detail, type Rig } from '../characters/rig';
import { prepareRig } from '../characters/rigBuilder';
import type { ShotType } from '../hit/swipeMapping';
import { PlayerSim } from './PlayerSim';
import type { Ending } from './endings';
import { markerMesh } from '../hit/markers';

const BAR_W = 0.9;
const BAR_H = 0.11;
/** Seconds before contact the backswing starts building. */
const WINDUP = 0.42;

/** What the view needs to know besides the sim. */
export interface ViewContext {
  /** Seconds until the incoming ball reaches this player's racket, if one is coming. */
  ttc: number | null;
  volleying: boolean;
  /** Standing at the line waiting to serve. */
  serving: boolean;
  /** The ball is tossed up and the server waits to hit it (phase 54). */
  tossing?: boolean;
  /** A ball is in play. */
  live: boolean;
  /** Where the ball is, for the eyes to follow (null when there is none to watch). */
  ball?: THREE.Vector3 | null;
}

export type SwingKind = ShotType | 'serve' | 'miss';

/**
 * How a swing met the ball (phase 17), so the body shows it instead of words: `offset`
 * shifts the swing in time (early swings are already through the ball, late ones still
 * catching up), `lunge` 0..1 stretches out for a wide ball, `low` 0..1 crouches for a
 * low one, and `whiff` swings at thin air from the start.
 */
export interface SwingShape {
  offset?: number;
  lunge?: number;
  low?: number;
  whiff?: boolean;
}

const CELEBRATE: ClipName[] = ['celebrate', 'clench', 'celebrate2', 'clench', 'celebrate3'];
const DEJECTED: ClipName[] = ['dejected', 'shakeHead', 'dejected2'];
/** Fatigue past which a player bends over between points. */
const TIRED_FATIGUE = 0.22;
const STROKES = new Set<ClipName>(['forehand', 'backhand', 'backhand1', 'volleyFh', 'volleyBh']);

/**
 * A player drawn as an animated voxel character (GDD §6.4, §10.4): picks the
 * clip from what the sim is doing, builds the backswing as the ball arrives, and
 * snaps into the swing on the frame the hit happens so contact lines up with it.
 */
export class PlayerView {
  readonly group = new THREE.Group();
  private rig: Rig;
  private look: CharacterLook;
  private gear: GearLook;
  private mirrored = false;
  private readonly bar = new THREE.Group();
  private readonly barFill: THREE.Mesh;
  private readonly barMat: THREE.MeshBasicMaterial;
  private readonly shadow: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();

  private oneShot: { clip: ClipName; t: number; lead?: number } | null = null;
  /** Reach blended over the current stroke: lunge toward the stroke side and crouch. */
  private reach: { lunge: number; low: number; side: 'forehand' | 'backhand' } | null = null;
  private readonly lungeFh = withEdit(LUNGE.forehand);
  private readonly lungeBh = withEdit(LUNGE.backhand);
  private readonly crouch = withEdit(CROUCH);
  private readonly slideFh = withEdit(SLIDE.forehand);
  private readonly slideBh = withEdit(SLIDE.backhand);
  /** +1 when the last run headed to the forehand side, −1 to the backhand (phase 57). */
  private plantSide = 1;
  /** Points won and lost so far, to vary the reaction. */
  private readonly reactions = { won: 0, lost: 0 };
  private loopName: ClipName = 'idle';
  /** How tired the body looks (0..1), and the breathing phase. */
  private tired = 0;
  private breath = 0;
  private loopTime = 0;
  /** End-of-match pose held until the next match. */
  private ending: 'win' | 'lose' | null = null;
  /** The pose held at match end, picked by the occasion (phase 62). */
  private endingLoop: ClipName | null = null;
  private readonly shown: Pose = restPose();
  private readonly target: Pose = restPose();
  private readonly scratch: Pose = restPose();
  /** What is drawn: the animated pose plus the lean and the eyes on the ball. */
  private readonly drawn: Pose = restPose();
  /** Smoothed lean into the run (root pitch, root roll) and how much the head follows the ball. */
  private readonly lean = { x: 0, z: 0 };
  private gaze = 0;
  private yaw = 0;
  private firstFrame = true;
  /** Whether the model has its surface yet (see the constructor). */
  private built = false;
  private barShown = true;

  /** `detail`: 'hi' for close-ups (showroom), 'lo' on court. */
  constructor(
    characterId = 'rio',
    private readonly detail: Detail = 'lo',
  ) {
    this.look = lookOf(characterId);
    this.gear = starterGear(characterId);
    // Only a skeleton until dressed (setCharacter) or first shown: views are usually
    // dressed straight away, and a full build is slow.
    this.rig = buildRig(this.look, this.gear, 'none');
    this.group.add(this.rig.group);

    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.013;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);

    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(BAR_W + 0.06, BAR_H + 0.06),
      new THREE.MeshBasicMaterial({ color: 0x0e1426, transparent: true, opacity: 0.8, depthTest: false }),
    );
    // Transparent too, so renderOrder (not the opaque pass) puts it over the backing.
    this.barMat = new THREE.MeshBasicMaterial({ color: 0x45e08f, transparent: true, depthTest: false });
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, BAR_H), this.barMat);
    this.barFill.position.z = 0.001;
    back.renderOrder = 10;
    this.barFill.renderOrder = 11;
    this.bar.add(back, this.barFill);
    this.bar.position.y = CHAR_HEIGHT + 0.4;
    this.group.add(this.bar);
  }

  /** Dress as a character; left-handers mirror the whole rig. */
  setCharacter(id: string, handed: 1 | -1, gear: GearLook = starterGear(id)): void {
    this.look = lookOf(id);
    this.mirrored = handed === -1;
    this.setGear(gear);
  }

  /** Swap visible gear (racket, grip, shoes, wristband). */
  setGear(gear: GearLook): void {
    this.gear = { ...gear };
    this.built = true;
    const look = this.look;
    const token = ++this.dressing;
    if (this.detail !== 'hi' || rigReady(look, this.gear, 'hi')) {
      this.dress(this.detail);
      return;
    }
    // A detailed body takes seconds to build: show the match-detail body while it builds
    // off the page's thread, then swap.
    const g = this.gear;
    const swap = (d: Detail) => {
      if (token === this.dressing && !(d === 'lo' && rigReady(look, g, 'hi'))) this.dress(d);
    };
    if (rigReady(look, g, 'lo')) this.dress('lo');
    else void prepareRig(look, g, 'lo').then(() => swap('lo'));
    void prepareRig(look, g, 'hi').then(() => swap('hi'));
  }

  /** Build the body again as it is (the Detailed players setting changed, phase 64). */
  redress(): void {
    if (this.built) this.setGear(this.gear);
  }

  /** Bumped on each dressing, so slow builds for an earlier look are dropped. */
  private dressing = 0;

  private dress(detail: Detail): void {
    this.group.remove(this.rig.group);
    this.rig.dispose();
    this.rig = buildRig(this.look, this.gear, detail);
    this.rig.group.scale.x = this.mirrored ? -1 : 1;
    this.rig.bones.racket.scale.setScalar(this.noRacket ? 1e-4 : 1);
    this.group.add(this.rig.group);
  }

  private noRacket = false;

  /** Through the smash: debris on each slam, the broken racket gone, a new one in hand. */
  private smashing(from: number, to: number): void {
    for (const [at, hard] of [[0.56, true], [0.86, false]] as const) {
      if (from < at && to >= at) this.onSmashImpact?.(this.rig.racketHead(new THREE.Vector3()), hard);
    }
    const gone = to > 0.92 && to < 2.3;
    this.rig.bones.racket.scale.setScalar(this.noRacket || gone ? 1e-4 : 1);
  }

  /** Put the racket away (the press room, phase 40). */
  hideRacket(on = true): void {
    this.noRacket = on;
    // The racket is skinned into the one character mesh: shrink its bone to nothing.
    this.rig.bones.racket.scale.setScalar(on ? 1e-4 : 1);
  }

  get currentGear(): GearLook {
    return { ...this.gear };
  }

  /** Name of what's playing, for tests and the debug overlay. */
  get state(): ClipName {
    return this.oneShot?.clip ?? this.loopName;
  }

  /** A swing happened this frame: jump to the clip's contact frame, shaped by how it met the ball. */
  swing(kind: SwingKind, stroke: 'forehand' | 'backhand', shape: SwingShape = {}): void {
    const clip = this.clipFor(kind, stroke);
    const c = CLIPS[clip];
    const t = THREE.MathUtils.clamp(shape.whiff ? 0 : (c.contact ?? 0) - (shape.offset ?? 0), 0, c.duration * 0.6);
    // Start a touch behind and catch up at double speed, so the racket visibly sweeps
    // into the ball over a few frames instead of jumping there.
    const lead = Math.min(t, kind === 'serve' || kind === 'smash' ? 0.1 : 0.06);
    this.oneShot = { clip, t: t - lead, lead };
    const lunge = shape.lunge ?? 0;
    const low = shape.low ?? 0;
    this.reach = STROKES.has(clip) && (lunge > 0.01 || low > 0.01) ? { lunge, low, side: stroke } : null;
  }

  /**
   * The serve swing from the trophy pose (phase 54b): the racket drops behind the back and
   * comes up through the ball, which is struck `SERVE_SWING` seconds later, at the clip's
   * contact frame. Played whole, so every serve reads clearly, yours and theirs.
   */
  serveWindup(): void {
    this.oneShot = { clip: 'serve', t: 0 };
    this.reach = null;
  }

  /** The opponent just hit: a little split-step hop, ready to push off. */
  splitStep(): void {
    if (this.ending || this.oneShot) return;
    this.oneShot = { clip: 'splitStep', t: 0 };
  }

  /** React to the end of a point, with a different celebration (or sulk) from time to time. */
  /** The racket smash (phase 88): the slams hit the court here; the racket is gone till a new one comes. */
  onSmashImpact: ((at: THREE.Vector3, hard: boolean) => void) | null = null;

  smash(): void {
    if (this.ending) return;
    this.oneShot = { clip: 'racketSmash', t: 0 };
  }

  react(won: boolean): void {
    if (this.ending) return;
    const clip = won ? CELEBRATE[this.reactions.won++ % CELEBRATE.length] : DEJECTED[this.reactions.lost++ % DEJECTED.length];
    this.oneShot = { clip, t: 0 };
  }

  /** Hold a win or lose pose until cleared (null) for the next match; `how` picks which (phase 62). */
  setEnding(e: 'win' | 'lose' | null, how?: Ending): void {
    this.ending = e;
    this.endingLoop = e ? (how?.loop ?? null) : null;
    // The stamina bar would hang in front of the close-up.
    this.bar.visible = e === null && this.barShown && !this.inLobby;
    if (e) this.oneShot = how?.intro ? { clip: how.intro, t: 0 } : null;
  }

  /** The soft blob under the feet, for when the sun casts no real shadows. */
  setBlobShadow(on: boolean): void {
    this.shadow.visible = on;
  }

  /** Stand in the lobby: no stamina bar overhead (phase 25). */
  set lobby(on: boolean) {
    this.inLobby = on;
    this.bar.visible = !on && this.ending === null && this.barShown;
  }
  private inLobby = false;
  private lobbyIdle = 3;

  hideBar(): void {
    this.barShown = false;
    this.bar.visible = false;
  }

  /** Drop the blob shadow under the feet (where real shadows are cast instead). */
  hideBlob(): void {
    this.shadow.visible = false;
  }

  /** Freeze on one frame of a clip (the character gallery and screenshots). */
  /** Build the model now if nothing has dressed it yet. */
  ensureBuilt(): void {
    if (!this.built) this.setGear(this.gear);
  }

  showClip(name: ClipName, t: number): void {
    this.ensureBuilt();
    sample(CLIPS[name], t, this.shown);
    this.apply(this.shown);
    this.rig.face?.set(expressionFor(name));
    this.rig.face?.update();
  }

  racketHead(target: THREE.Vector3): THREE.Vector3 {
    return this.rig.racketHead(target);
  }

  sync(p: PlayerSim, alpha: number, camera: THREE.Camera, dt: number, ctx: ViewContext): void {
    this.ensureBuilt();
    this.group.position.copy(this.tmp.lerpVectors(p.prevPos, p.pos, alpha));

    // Facing: toward the net, turning into a long run when no ball is coming.
    const base = p.side === 'near' ? Math.PI : 0;
    let turn = 0;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    // Walking on for the intro (phase 61): facing the way they walk, whichever way that is.
    const walking = p.walkSpeed !== null && speed > 0.3;
    const runningFree = !p.tracking && (speed > 2.2 || walking) && !this.oneShot;
    if (runningFree) {
      const dir = Math.atan2(p.vel.x, p.vel.z);
      turn = walking ? wrap(dir - base) : THREE.MathUtils.clamp(wrap(dir - base), -1.2, 1.2);
    }
    this.yaw += wrap(base + turn - this.yaw) * Math.min(1, dt * 10);
    if (this.firstFrame) this.yaw = base;
    this.rig.group.rotation.y = this.yaw;

    // Pick the clip.
    // Moving always means legs moving: walking to the serve spot or still slowing down after
    // the last point used to play a standing clip, so the player slid across the court.
    let loop: ClipName;
    const fw = p.footwork;
    // The side the run was heading: the leg that plants when it stops.
    if (speed > 1.2 && fw.plant < 0.05) this.plantSide = Math.sign(p.vel.x * p.rightX() * p.handedness) || this.plantSide;
    // Small adjusting steps near the ball (phase 57): one shuffle step per push of the sim.
    const adjusting = fw.adjusting && speed > 0.12 && !this.ending;
    if (adjusting) loop = 'sidestep';
    else if (walking) loop = 'walk';
    // Any real movement gets stepping legs (2026-10-30: slow moves played a standing clip and slid).
    else if (speed > 0.25) {
      // Side-steps while lining up a ball or moving mostly sideways (or backpedalling).
      const forwardSpeed = p.vel.z * p.forward();
      loop = !runningFree && (p.tracking || Math.abs(p.vel.x) > Math.abs(p.vel.z) || forwardSpeed < -0.5) ? 'sidestep' : 'run';
    } else if (this.ending) loop = this.endingLoop ?? (this.ending === 'win' ? 'celebrateLoop' : 'dejectedLoop');
    else if (ctx.tossing) loop = 'serveToss';
    else if (ctx.serving) loop = 'serveReady';
    else if (ctx.live || p.tracking) loop = 'ready';
    // Worn out (phase 28): between points a tired player bends over to get their breath back.
    else loop = !this.inLobby && (p.fatigue > TIRED_FATIGUE || p.staminaFraction < STAMINA.tiredThreshold) ? 'tired' : 'idle';
    if (loop !== this.loopName) {
      this.loopName = loop;
      this.loopTime = 0;
    }
    // Feet that match the ground (phase 57): the run's stride grows with speed and the
    // shuffle covers about a metre a cycle, so neither skates.
    if (adjusting) this.loopTime = (fw.steps * CLIPS.sidestep.duration) / 2;
    else if (loop === 'run') this.loopTime += dt * THREE.MathUtils.clamp(speed / (4.8 * (0.55 + 0.17 * speed)), 0.45, 1.3);
    else if (loop === 'sidestep') this.loopTime += dt * THREE.MathUtils.clamp(speed / 3, 0.5, 1.8);
    else if (loop === 'walk') this.loopTime += dt * THREE.MathUtils.clamp(speed / 1.5, 0.4, 1.4);
    else this.loopTime += dt;
    sample(CLIPS[loop], this.loopTime, this.target);
    // Braking into a change of direction: sink and plant the outside leg.
    // Only once nearly stopped: a frozen lunge while still moving at speed read as sliding (2026-10-30).
    const planted = fw.plant * THREE.MathUtils.clamp(1 - speed / 2.2, 0, 1);
    if (planted > 0.02 && !this.ending) {
      blendLegs(this.target, this.plantSide > 0 ? this.lungeFh : this.lungeBh, planted * 0.75);
      this.target.lift = THREE.MathUtils.lerp(this.target.lift, -0.08, planted * 0.6);
    }
    // Sliding into the stop on clay (phase 84): down into the split, outside leg long.
    if (fw.slide > 0.02 && !this.ending) blendLegs(this.target, this.plantSide > 0 ? this.slideFh : this.slideBh, fw.slide * 0.9);

    // In the lobby you stay loose: a shadow swing or a hop now and then.
    if (this.inLobby && !this.oneShot && (this.lobbyIdle -= dt) <= 0) {
      const pick = Math.random();
      this.oneShot = { clip: pick < 0.45 ? 'forehand' : pick < 0.8 ? this.clipFor('ground', 'backhand') : 'splitStep', t: 0 };
      this.lobbyIdle = 6 + Math.random() * 5;
    }

    let snap = false;
    // A smash cut short still ends with a racket in hand.
    if (this.oneShot?.clip !== 'racketSmash' && !this.noRacket && this.rig.bones.racket.scale.x < 0.5) this.rig.bones.racket.scale.setScalar(1);
    if (this.oneShot) {
      const c = CLIPS[this.oneShot.clip];
      const catchUp = Math.min(this.oneShot.lead ?? 0, dt);
      if (catchUp) this.oneShot.lead! -= catchUp;
      const before = this.oneShot.t;
      this.oneShot.t += dt + catchUp;
      if (this.oneShot.clip === 'racketSmash') this.smashing(before, this.oneShot.t);
      if (this.oneShot.t >= c.duration) {
        this.oneShot = null;
        this.reach = null;
      } else {
        sample(c, this.oneShot.t, this.scratch);
        // Legs keep running under a swing, a split step or a celebration while the player is
        // still moving (not when stretching out for a ball).
        const legs = speed > 0.5 && !this.reach;
        if (legs) for (const b of ['thighR', 'thighL', 'shinR', 'shinL'] as const) this.scratch[b] = this.target[b];
        if (this.reach) {
          // Hold the stretch through contact, then come back up as the swing finishes.
          const k = THREE.MathUtils.clamp((c.duration - this.oneShot.t) / (c.duration * 0.45), 0, 1);
          const env = k * k * (3 - 2 * k);
          // On clay a long stretch becomes a slide into the ball (phase 84).
          const fh = this.reach.side === 'forehand';
          const slide = PlayerSim.surface === 'clay' && this.reach.lunge > 0.35;
          blendLegs(this.scratch, slide ? (fh ? this.slideFh : this.slideBh) : fh ? this.lungeFh : this.lungeBh, this.reach.lunge * env);
          blendLegs(this.scratch, this.crouch, this.reach.low * env * (1 - this.reach.lunge));
        }
        copyPose(this.scratch, this.target);
        snap = true;
      }
    } else if (ctx.ttc !== null && ctx.ttc < WINDUP && ctx.ttc > -0.1 && !this.ending) {
      // Backswing builds as the ball arrives, so the hit frame only has to swing through.
      const clip = this.clipFor(ctx.volleying ? 'volley' : 'ground', p.stroke);
      // In the last moments the racket starts dropping into the slot (but no further:
      // the swing itself only goes when the player swings).
      const c = CLIPS[clip];
      const contact = c.contact ?? 0;
      sample(c, THREE.MathUtils.clamp(contact - ctx.ttc, 0, contact * 0.55), this.scratch);
      const w = THREE.MathUtils.clamp(1 - ctx.ttc / WINDUP, 0, 1);
      lerpPose(this.target, this.scratch, w * w * (3 - 2 * w), this.target);
    }

    // Swings are snappy; everything else eases between poses.
    if (snap || this.firstFrame) copyPose(this.target, this.shown);
    else lerpPose(this.shown, this.target, Math.min(1, dt * 14), this.shown);
    this.firstFrame = false;
    this.overlay(p, dt, ctx);
    this.apply(this.drawn);
    // The face follows what the body is doing (phase 80): set for the swing, a roar, a sulk.
    const face = this.rig.face;
    if (face) {
      face.set(expressionFor(this.oneShot?.clip ?? loop));
      face.update(dt);
    }

    // Stamina bar always faces the camera; colour shifts as it drains.
    this.bar.quaternion.copy(camera.quaternion);
    const frac = p.staminaFraction;
    this.barFill.scale.x = Math.max(0.001, frac);
    this.barFill.position.x = -(BAR_W * (1 - frac)) / 2;
    this.barMat.color.setHex(frac > 0.6 ? 0x45e08f : frac > STAMINA.tiredThreshold ? 0xffb547 : 0xff5e70);
    this.shadow.scale.setScalar(1 - Math.min(0.4, Math.max(0, this.shown.lift) * 1.5));
  }

  /**
   * Layers on top of the clip: the body leans into its run (forward when running at the
   * net, into the side when shuffling) and the head turns to keep the eyes on the ball.
   */
  private overlay(p: PlayerSim, dt: number, ctx: ViewContext): void {
    copyPose(this.shown, this.drawn);
    const free = !this.ending && !ctx.serving;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const flip = this.mirrored ? -1 : 1;
    const fwd = p.vel.x * sin + p.vel.z * cos;
    const side = (p.vel.x * cos - p.vel.z * sin) * flip;
    const k = Math.min(1, dt * 6);
    this.lean.x += ((free ? THREE.MathUtils.clamp(fwd * 0.035, -0.1, 0.2) : 0) - this.lean.x) * k;
    this.lean.z += ((free ? THREE.MathUtils.clamp(-side * 0.03, -0.15, 0.15) : 0) - this.lean.z) * k;
    this.drawn.root[0] += this.lean.x;
    this.drawn.root[2] += this.lean.z;

    // Running low on stamina (phase 28): shoulders drop and the chest heaves.
    const tired = THREE.MathUtils.clamp(1 - p.staminaFraction / STAMINA.tiredThreshold, 0, 1) * (free ? 1 : 0);
    this.tired += (tired - this.tired) * Math.min(1, dt * 3);
    if (this.tired > 0.01 && this.loopName !== 'tired') {
      this.breath += dt * 9;
      const t = this.tired;
      this.drawn.torso[0] += t * (0.14 + 0.05 * Math.sin(this.breath));
      this.drawn.head[0] += t * 0.08;
      this.drawn.uArmR[2] += t * 0.06;
      this.drawn.uArmL[2] -= t * 0.06;
    }

    const watching = free && ctx.live && !!ctx.ball && !(this.oneShot && !STROKES.has(this.oneShot.clip) && this.oneShot.clip !== 'splitStep');
    this.gaze += ((watching ? 0.8 : 0) - this.gaze) * Math.min(1, dt * 5);
    if (this.gaze < 0.01 || !ctx.ball) return;
    const d = this.tmp.copy(ctx.ball).sub(this.group.position);
    d.y -= CHAR_HEIGHT * 0.9;
    const lx = (d.x * cos - d.z * sin) * flip;
    const lz = d.x * sin + d.z * cos;
    const r = this.drawn;
    const yaw = Math.atan2(lx, lz) - (r.root[1] + r.hips[1] + r.torso[1]);
    const pitch = -Math.atan2(d.y, Math.hypot(lx, lz)) - (r.root[0] + r.hips[0] + r.torso[0]);
    const h = r.head;
    h[1] += (THREE.MathUtils.clamp(wrap(yaw), -1.15, 1.15) - h[1]) * this.gaze;
    h[0] += (THREE.MathUtils.clamp(pitch, -0.7, 0.45) - h[0]) * this.gaze;
  }

  private clipFor(kind: SwingKind | 'ground', stroke: 'forehand' | 'backhand'): ClipName {
    if (kind === 'serve') return 'serve';
    if (kind === 'smash') return 'smash';
    if (kind === 'volley') return stroke === 'forehand' ? 'volleyFh' : 'volleyBh';
    if (stroke === 'forehand') return 'forehand';
    return this.look.backhand === 'one' ? 'backhand1' : 'backhand';
  }

  /** Everything that moves when this player is drawn, for the point replay (phase 47). */
  trackables(): THREE.Object3D[] {
    return [this.group, this.rig.group, ...BONES.map((b) => this.rig.bones[b])];
  }

  private apply(pose: Pose): void {
    const b = this.rig.bones;
    for (const name of BONES) {
      const r = pose[name];
      b[name].rotation.set(r[0], r[1], r[2]);
    }
    b.root.position.y = pose.lift * LIFT_SCALE;
  }
}

/** A full pose from a legs-and-torso edit (other bones left at rest; only the edited ones blend). */
function withEdit(edit: PoseEdit): { pose: Pose; bones: Array<keyof PoseEdit> } {
  const p = restPose();
  for (const [k, v] of Object.entries(edit)) {
    if (k === 'lift') p.lift = v as number;
    else p[k as Exclude<keyof Pose, 'lift'>] = [...(v as [number, number, number])];
  }
  return { pose: p, bones: Object.keys(edit) as Array<keyof PoseEdit> };
}

/** Blend only the bones an edit touches (and the root height) toward it. */
function blendLegs(out: Pose, to: { pose: Pose; bones: Array<keyof PoseEdit> }, w: number): void {
  if (w <= 0) return;
  for (const b of to.bones) {
    if (b === 'lift') {
      out.lift += (to.pose.lift - out.lift) * w;
      continue;
    }
    const a = out[b];
    const t = to.pose[b];
    out[b] = [a[0] + (t[0] - a[0]) * w, a[1] + (t[1] - a[1]) * w, a[2] + (t[2] - a[2]) * w];
  }
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Where the local player was sent by a tap (GDD §9.1, §9.3): a white ring that pops in
 * with a ripple, pulses while the player runs and fades once they get there.
 */
export class TapMarker {
  readonly mesh = new THREE.Group();
  private readonly ring = markerMesh('tap', 0.95, 0xffe066);
  private readonly ripple = markerMesh('tap', 0.95, 0xffe066);
  private life = 0;
  private age = 0;

  constructor() {
    this.ring.renderOrder = 1;
    this.ripple.renderOrder = 1;
    this.mesh.add(this.ring, this.ripple);
  }

  show(at: THREE.Vector3): void {
    this.mesh.position.set(at.x, 0.01, at.z);
    this.life = 1;
    this.age = 0;
  }

  update(dt: number, arrived: boolean): void {
    if (this.life <= 0) return;
    this.age += dt;
    // Pulse while travelling; fade quickly once the player gets there.
    this.life -= dt * (arrived ? 3 : 0.25);
    const pop = Math.min(1, this.age / 0.12);
    const pulse = 1 + Math.sin(this.age * 8) * 0.06;
    this.ring.scale.setScalar(pop * pulse);
    this.ring.material.opacity = Math.max(0, Math.min(0.95, this.life));
    // One ripple grows out of the ring when the tap lands.
    const r = Math.min(1, this.age / 0.45);
    this.ripple.scale.setScalar(1 + r * 0.9);
    this.ripple.material.opacity = (1 - r) * 0.7;
  }
}
