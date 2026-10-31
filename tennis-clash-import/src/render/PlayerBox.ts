import * as THREE from 'three';
import { BOX_POSES, lerpPose, restPose, type Pose } from '../characters/anim';
import type { Expression } from '../characters/faceRig';
import type { CharacterLook, GearLook } from '../characters/looks';
import { BONES, buildRig, fineDetail, LIFT_SCALE, setFineDetail, type Rig } from '../characters/rig';
import type { BoxSeats } from '../world/boxSeats';
import type { Seat } from '../world/Stadium';

/**
 * The players' boxes (phase 86): your team (head coach, assistants, physio and fitness
 * trainer) sitting together in the front rows of a side stand, and a top-20 rival's
 * team across the court. They watch every point and react to the big ones: on their
 * feet with fists up when you win one, head in hands when it goes the other way, the
 * coach's "come on!". A short cutaway shows them between some points.
 */
export interface BoxPerson {
  look: CharacterLook;
  gear: GearLook;
  /** The head coach shouts. */
  coach?: boolean;
}

type Mood = 'sit' | 'lean' | 'clap' | 'up' | 'head';

interface Member {
  rig: Rig;
  coach: boolean;
  pose: Pose;
  mood: Mood;
  /** Seconds left in the mood before sitting back. */
  left: number;
  /** A beat of their own, so the box doesn't move as one. */
  phase: number;
  seat: Seat | null;
}

const MOOD_TIME: Record<Mood, number> = { sit: 0, lean: 3.5, clap: 2.2, up: 2.4, head: 2.6 };
const FACE: Record<Mood, Expression> = { sit: 'calm', lean: 'focus', clap: 'joy', up: 'roar', head: 'hurt' };

export class PlayerBox {
  readonly group = new THREE.Group();
  private readonly sides: Record<'you' | 'rival', Member[]> = { you: [], rival: [] };
  private seats: BoxSeats = { you: [], rival: [] };
  private readonly target = restPose();
  private readonly shout: HTMLElement;
  private shoutFor = 0;
  private time = 0;

  constructor(host: HTMLElement) {
    this.group.name = 'player-boxes';
    this.shout = document.createElement('div');
    this.shout.className = 'box-shout';
    this.shout.hidden = true;
    host.append(this.shout);
  }

  /** Who sits in each box; an empty list leaves that box to the fans' empty seats. */
  setCrew(side: 'you' | 'rival', people: BoxPerson[]): void {
    for (const m of this.sides[side]) {
      this.group.remove(m.rig.group);
      m.rig.dispose();
    }
    // Two-centimetre bodies: they're small on screen and there can be eight of them.
    const was = fineDetail();
    setFineDetail(false);
    this.sides[side] = people.map((p, i) => {
      const rig = buildRig(p.look, p.gear, 'lo');
      // No rackets in the stands.
      rig.bones.racket.scale.setScalar(0.0001);
      rig.group.scale.setScalar(p.look.height ?? 1);
      this.group.add(rig.group);
      return { rig, coach: !!p.coach, pose: restPose(), mood: 'sit' as Mood, left: 0, phase: i * 1.7, seat: null };
    });
    setFineDetail(was);
    this.place(this.seats);
  }

  /** Sit everyone down in a venue's box seats (again after the venue changes). */
  place(seats: BoxSeats): void {
    this.seats = seats;
    for (const side of ['you', 'rival'] as const) {
      const list = seats[side];
      // The coach takes the middle of the front row.
      const order = [1, 0, 2, 4, 3, 5].filter((i) => i < list.length);
      this.sides[side].forEach((m, i) => {
        const seat = list[order[i]] ?? null;
        m.seat = seat;
        m.rig.group.visible = !!seat;
        if (!seat) return;
        // The seat's cushion is half a metre above its row's floor.
        // Sat back in the seat, so knees and feet stay behind the rail in front.
        m.rig.group.position.set(seat.pos.x - Math.sin(seat.yaw) * 0.22, seat.pos.y - 0.5, seat.pos.z - Math.cos(seat.yaw) * 0.22);
        m.rig.group.rotation.y = seat.yaw;
      });
    }
  }

  /** Whether a box has anyone in it. */
  has(side: 'you' | 'rival'): boolean {
    return this.sides[side].some((m) => m.seat);
  }

  /**
   * A point's verdict for one box: `good` (their player won it), `big` for a big moment.
   * Big wins bring them to their feet; small ones a clap; losses a lean or head in hands.
   */
  react(side: 'you' | 'rival', good: boolean, big: boolean): void {
    for (const m of this.sides[side]) {
      const r = Math.random();
      m.mood = good ? (big || r < 0.25 ? 'up' : 'clap') : big && r < 0.6 ? 'head' : r < 0.5 ? 'lean' : 'sit';
      m.left = MOOD_TIME[m.mood] * (0.85 + Math.random() * 0.3);
      m.rig.face?.set(FACE[m.mood]);
    }
    if (good && big) this.shoutFor = side === 'you' ? 1.6 : 0;
  }

  /** Everyone back in their seats (a new match, or the result). */
  settle(): void {
    for (const m of [...this.sides.you, ...this.sides.rival]) {
      m.mood = 'sit';
      m.left = 0;
      m.rig.face?.set('calm');
    }
    this.shoutFor = 0;
    this.shout.hidden = true;
  }

  /** A cutaway onto a box: where to stand the camera and what to look at. */
  shot(side: 'you' | 'rival'): { pos: THREE.Vector3; look: THREE.Vector3 } | null {
    const seated = this.sides[side].filter((m) => m.seat);
    if (!seated.length) return null;
    const c = new THREE.Vector3();
    for (const m of seated) c.add(m.rig.group.position);
    c.divideScalar(seated.length).add(new THREE.Vector3(0, 0.9, 0));
    // From the court side of the rail, at their eye level.
    const yaw = seated[0].seat!.yaw;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const pos = c.clone().addScaledVector(fwd, 3.6).add(new THREE.Vector3(0, 0.6, 0));
    return { pos, look: c.clone().add(new THREE.Vector3(0, 0.3, 0)) };
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const k = Math.min(1, dt * 8);
    for (const m of [...this.sides.you, ...this.sides.rival]) {
      if (!m.seat) continue;
      if (m.left > 0 && (m.left -= dt) <= 0) {
        m.mood = 'sit';
        m.rig.face?.set('calm');
      }
      const t = this.time + m.phase;
      let to: Pose = BOX_POSES.sit;
      if (m.mood === 'lean') to = BOX_POSES.lean;
      else if (m.mood === 'head') to = BOX_POSES.head;
      else if (m.mood === 'clap') to = Math.sin(t * 22) > 0 ? BOX_POSES.clapShut : BOX_POSES.clapOpen;
      else if (m.mood === 'up') to = Math.sin(t * 9) > 0 ? BOX_POSES.up : BOX_POSES.pump;
      lerpPose(m.pose, to, m.mood === 'clap' ? Math.min(1, dt * 30) : k, m.pose);
      // A little life while sitting: the head turns with the rally now and then.
      copyInto(this.target, m.pose);
      if (m.mood === 'sit') this.target.head[1] += 0.25 * Math.sin(t * 0.7);
      const b = m.rig.bones;
      for (const name of BONES) b[name].rotation.set(this.target[name][0], this.target[name][1], this.target[name][2]);
      b.root.position.y = this.target.lift * LIFT_SCALE;
      m.rig.face?.update(dt);
    }
    // The coach's "COME ON!" over their head.
    if (this.shoutFor > 0) {
      this.shoutFor -= dt;
      const coach = this.sides.you.find((m) => m.coach && m.seat) ?? this.sides.you.find((m) => m.seat);
      const head = coach ? coach.rig.bones.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.45, 0)) : null;
      const ndc = head?.project(camera);
      const show = !!ndc && ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95 && this.shoutFor > 0;
      this.shout.hidden = !show;
      if (show) {
        this.shout.textContent = 'COME ON!';
        this.shout.style.left = `${(ndc!.x * 0.5 + 0.5) * 100}%`;
        this.shout.style.top = `${(-ndc!.y * 0.5 + 0.5) * 100}%`;
      }
    } else if (!this.shout.hidden) this.shout.hidden = true;
  }
}

function copyInto(out: Pose, p: Pose): void {
  out.lift = p.lift;
  for (const name of BONES) {
    const a = p[name];
    const o = out[name];
    o[0] = a[0];
    o[1] = a[1];
    o[2] = a[2];
  }
}
