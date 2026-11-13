import * as THREE from 'three/webgpu';
import type { Actor, HitInfo, HitOutcome } from '@/gameplay/actor';
import type { ClipEvents } from '@/assets/loader';
import type { GameCtx } from '@/gameplay/ctx';
import { timeScale } from '@/core/loop';

/** Radius of the striking sphere on the attacking bone, from the clip's authored reach. */
export const strikeRadius = (reach = 0.4) => 0.17 + reach * 0.26;

export interface Contact {
  target: Actor;
  point: THREE.Vector3;
}

const v1 = new THREE.Vector3();

/**
 * Hit detection. During a clip's hit window the striker bone (hand, foot, ...) carries a sphere; any hostile actor whose hurt capsule
 * the sphere touches, and who is in front of the attacker, is hit once per swing (`done` records who already was).
 */
export function strikeTest(attacker: Actor, ev: ClipEvents, targets: Actor[], done: Set<Actor>): Contact[] {
  const out: Contact[] = [];
  const point = attacker.bonePos(ev.striker ?? 'hand_l', new THREE.Vector3());
  const r = strikeRadius(ev.reach);
  const fwd = attacker.forward(v1);
  for (const t of targets) {
    if (!t.alive || done.has(t) || hostileTo(attacker, t) === false) continue;
    const d = t.distanceToPoint(point);
    if (d > r) continue;
    const to = new THREE.Vector3(t.pos.x - attacker.pos.x, 0, t.pos.z - attacker.pos.z);
    const flat = to.length();
    if (flat > 0.001 && fwd.dot(to.divideScalar(flat)) < -0.15) continue; // not behind the attacker
    out.push({ target: t, point: point.clone() });
  }
  return out;
}

export function hostileTo(a: Actor, b: Actor): boolean {
  if (a === b) return false;
  const friendly = (t: Actor['team']) => (t === 'enemy' ? 'enemy' : 'player');
  return friendly(a.team) !== friendly(b.team);
}

/**
 * Apply a contact: build the HitInfo from the clip's authored numbers, let the target decide the outcome (block/parry/dodge/damage), then
 * drive the feedback: hit-stop, camera, effects, sound. Returns the outcome so the attacker can react (e.g. get parried).
 */
export function applyStrike(ctx: GameCtx, attacker: Actor, clip: string, ev: ClipEvents, c: Contact, scale = 1): HitOutcome {
  const dir = new THREE.Vector3(c.target.pos.x - attacker.pos.x, 0, c.target.pos.z - attacker.pos.z).normalize();
  const heavy = (ev.damage ?? 1) >= 2.5;
  const info: HitInfo = {
    attacker, clip, heavy, dir, point: c.point,
    damage: (ev.damage ?? 1) * 8 * scale,
    stagger: ev.stagger ?? 0.4,
    guardbreak: !!ev.guardbreak,
    launch: ev.launch ?? 0,
  };
  const out = c.target.receiveHit(info);
  switch (out) {
    case 'hit':
    case 'killed':
      timeScale.hitstop = Math.max(timeScale.hitstop, heavy ? 6 : 3);
      ctx.camera.addShake(heavy ? 0.34 : 0.14);
      ctx.camera.fovKick = heavy ? 3.2 : 1.2;
      ctx.fx.hit(c.point, dir, { heavy, blocked: false, parried: false });
      ctx.sfx.play(heavy ? 'hit_heavy' : 'hit_light', { at: c.point });
      break;
    case 'blocked':
      timeScale.hitstop = Math.max(timeScale.hitstop, 2);
      ctx.camera.addShake(0.1);
      ctx.fx.hit(c.point, dir, { heavy, blocked: true, parried: false });
      ctx.sfx.play('block', { at: c.point });
      break;
    case 'parried':
      timeScale.hitstop = Math.max(timeScale.hitstop, 7);
      ctx.camera.addShake(0.22);
      ctx.camera.fovKick = -2;
      ctx.fx.hit(c.point, dir, { heavy, blocked: true, parried: true });
      ctx.fx.pulse(c.point, 'parry');
      ctx.sfx.play('parry', { at: c.point });
      attacker.onParried();
      break;
    default:
      break;
  }
  return out;
}
