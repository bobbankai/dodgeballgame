import type { Vector3 } from '@babylonjs/core';

export type Element = 'physical' | 'fire' | 'water' | 'lightning' | 'life' | 'light' | 'void';
export type Team = 'player' | 'enemy' | 'neutral';

/** Everything a hit carries. */
export interface DamageInfo {
  amount: number;
  /** Poise damage: breaking poise staggers and opens an execution. */
  poise: number;
  element: Element;
  /** World-space direction the blow travels (attacker -> victim). */
  direction: Vector3;
  point: Vector3;
  source: Combatant | null;
  /** Heavier hits freeze the frame longer and shake the camera more (0..1). */
  weight: number;
  knockback: number;
  /** Sends the victim into the air (launchers). */
  launch?: boolean;
  /** Knocks the victim down (heavy area attacks). */
  knockdown?: boolean;
  /** Cannot be blocked (grabs, some boss attacks); can still be dodged. */
  unblockable?: boolean;
  /** Can be parried (most melee). */
  parryable: boolean;
  /** Projectiles and area effects are not parried; they can be blocked or dodged. */
  ranged?: boolean;
  /** A riposte or execution (guaranteed critical). */
  critical?: boolean;
  /** Status build-up applied with the hit. */
  status?: { burn?: number; soak?: number; shock?: number; root?: number };
  tag?: string;
}

export type HitResult = 'hit' | 'blocked' | 'parried' | 'dodged' | 'immune' | 'guardbreak' | 'killed' | 'staggered';

/** A capsule hurt volume attached to a bone (or to the actor's root). */
export interface HurtCapsule {
  a: Vector3;
  b: Vector3;
  radius: number;
  /** Damage multiplier (heads take more, armoured parts less). */
  mult: number;
  part: string;
}

/** Anything that can be hit: the player, enemies, bosses, destructible props. */
export interface Combatant {
  readonly id: number;
  readonly team: Team;
  readonly name: string;
  /** Feet position. */
  readonly position: Vector3;
  readonly radius: number;
  readonly height: number;
  readonly alive: boolean;
  /** Bosses and large enemies resist knockback/launch. */
  readonly heavy: boolean;
  hurtboxes(): HurtCapsule[];
  receive(hit: DamageInfo, part: HurtCapsule | null): HitResult;
  /** Can this combatant be locked on to? */
  readonly targetable: boolean;
  /** Point to aim at / lock on to. */
  aimPoint(out: Vector3): Vector3;
}
