// Combat core shared by the player and enemies.
import * as THREE from 'three';
import type { Character } from './Character';
import type { Body } from './World';

export type Team = 'player' | 'enemy';
export type HitResult = 'hit' | 'blocked' | 'parried' | 'dodged' | 'killed' | 'armor' | 'none';

export interface Hit {
  from: Combatant;
  damage: number;
  poise: number;
  heavy: boolean;
  unblockable?: boolean;
  knock?: number; // knockdown force
  point: THREE.Vector3;
  dir: THREE.Vector3; // from attacker toward target (flat)
  kind: 'slash' | 'blunt' | 'fire' | 'ice' | 'shadow';
  art?: boolean;
}

export interface Combatant {
  team: Team;
  name: string;
  char: Character;
  body: Body;
  hp: number;
  maxHp: number;
  dead: boolean;
  yaw: number;
  /** can be hit right now */
  targetable(): boolean;
  receive(hit: Hit): HitResult;
  /** world point to aim at (chest) */
  center(out?: THREE.Vector3): THREE.Vector3;
}

const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), b0 = new THREE.Vector3(), b1 = new THREE.Vector3();
const seg = new THREE.Line3(), seg2 = new THREE.Line3();
const p1 = new THREE.Vector3(), p2 = new THREE.Vector3();

/** closest distance between two segments; writes the closest point on the first into out */
export function segSegDist(s0: THREE.Vector3, s1: THREE.Vector3, t0: THREE.Vector3, t1: THREE.Vector3, out?: THREE.Vector3): number {
  const d1 = p1.subVectors(s1, s0), d2 = p2.subVectors(t1, t0);
  const r = new THREE.Vector3().subVectors(s0, t0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let s = 0, t = 0;
  if (a <= 1e-8 && e <= 1e-8) { s = t = 0; } else if (a <= 1e-8) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); } else {
    const c = d1.dot(r);
    if (e <= 1e-8) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else {
      const b = d1.dot(d2), den = a * e - b * b;
      s = den !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  const c1 = new THREE.Vector3().copy(s0).addScaledVector(d1, s);
  const c2 = new THREE.Vector3().copy(t0).addScaledVector(d2, t);
  if (out) out.copy(c1).lerp(c2, 0.5);
  return c1.distanceTo(c2);
}

/**
 * Swept blade test: the blade moved from (pb0, pt0) to (pb1, pt1) this frame. Sample segments across
 * the sweep and test them against the target capsule. Returns the contact point or null.
 */
export function bladeSweep(pb0: THREE.Vector3, pt0: THREE.Vector3, pb1: THREE.Vector3, pt1: THREE.Vector3, target: Body, bladeR = 0.07): THREE.Vector3 | null {
  const r = target.radius + bladeR;
  b0.set(target.pos.x, target.pos.y + target.radius, target.pos.z);
  b1.set(target.pos.x, target.pos.y + target.height - target.radius * 0.5, target.pos.z);
  const out = new THREE.Vector3();
  const steps = Math.max(2, Math.ceil(pt0.distanceTo(pt1) / 0.15) + 1);
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    a0.copy(pb0).lerp(pb1, k);
    a1.copy(pt0).lerp(pt1, k);
    if (segSegDist(a0, a1, b0, b1, out) < r) return out;
  }
  void seg; void seg2;
  return null;
}

/** forgiving fallback: target inside a cone in front of the attacker within reach */
export function inCone(from: THREE.Vector3, yaw: number, to: Body, reach: number, halfAngle: number): boolean {
  const dx = to.pos.x - from.x, dz = to.pos.z - from.z;
  const d = Math.hypot(dx, dz) - to.radius;
  if (d > reach || Math.abs(to.pos.y - from.y) > 1.6) return false;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const cos = (dx * fx + dz * fz) / Math.max(1e-4, Math.hypot(dx, dz));
  return cos > Math.cos(halfAngle) || d < 0.25;
}

/** global time effects: hit-stop (freeze both fighters briefly) and slow motion */
export class TimeFX {
  private stops = new Map<Character, number>();
  private slowT = 0;
  private slowK = 1;
  scale = 1;

  hitStop(chars: Character[], dur: number): void {
    for (const c of chars) this.stops.set(c, Math.max(this.stops.get(c) ?? 0, dur));
  }

  slowmo(k: number, dur: number): void { this.slowK = k; this.slowT = dur; }

  /** per-character time scale for this frame */
  charScale(c: Character): number { return (this.stops.get(c) ?? 0) > 0 ? 0.02 : 1; }

  update(dt: number): void {
    for (const [c, t] of this.stops) {
      const n = t - dt;
      if (n <= 0) this.stops.delete(c); else this.stops.set(c, n);
    }
    if (this.slowT > 0) {
      this.slowT -= dt;
      this.scale += (this.slowK - this.scale) * Math.min(1, dt * 20);
    } else this.scale += (1 - this.scale) * Math.min(1, dt * 6);
  }
}

export function yawTo(from: THREE.Vector3, to: THREE.Vector3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
