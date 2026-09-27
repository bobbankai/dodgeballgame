import type * as THREE from 'three';
import type { Athlete } from './Athlete';
import type { Ball } from './Ball';

export type TeamId = 0 | 1;

export type ThrowKind = 'quick' | 'charged' | 'power' | 'ultimate' | 'pass' | 'reflect' | 'relay' | 'phantom';

export interface ThrowInfo {
  kind: ThrowKind;
  /** 0..~2 relative strength used for VFX, damage and catch difficulty. */
  power: number;
  damage: number;
  perfect: boolean;
  /** Needs a perfect catch to hold (fumbles otherwise). */
  heavy: boolean;
  curve: THREE.Vector3 | null;
  homing: Athlete | null;
  homingStrength: number;
  gravityScale: number;
  target: Athlete | null;
  shockwave: boolean;
  ricochet: boolean;
  chain: number;
  time: number;
  wallBounces: number;
  speed: number;
  /** Receiver for passes. */
  receiver: Athlete | null;
}

export interface GameEvents {
  throw: { athlete: Athlete; ball: Ball; info: ThrowInfo };
  chargeStart: { athlete: Athlete };
  chargeFull: { athlete: Athlete };
  hit: { victim: Athlete; thrower: Athlete | null; ball: Ball; damage: number; ko: boolean; point: THREE.Vector3; dir: THREE.Vector3; power: number };
  catch: { catcher: Athlete; thrower: Athlete | null; ball: Ball; perfect: boolean; point: THREE.Vector3 };
  fumble: { athlete: Athlete; ball: Ball; point: THREE.Vector3 };
  block: { athlete: Athlete; ball: Ball; reflect: boolean; point: THREE.Vector3 };
  whiff: { athlete: Athlete };
  dodge: { athlete: Athlete; dir: THREE.Vector3 };
  perfectDodge: { athlete: Athlete; ball: Ball };
  pickup: { athlete: Athlete; ball: Ball };
  bounce: { ball: Ball; surface: 'floor' | 'wall' | 'obstacle' | 'athlete'; speed: number; point: THREE.Vector3; normal: THREE.Vector3 };
  clash: { a: Ball; b: Ball; point: THREE.Vector3 };
  ko: { athlete: Athlete; by: Athlete | null };
  revive: { athlete: Athlete };
  pass: { from: Athlete; to: Athlete; ball: Ball };
  ability: { athlete: Athlete; id: string };
  ultimateStart: { athlete: Athlete };
  ultimateRelease: { athlete: Athlete; ball: Ball };
  shockwave: { point: THREE.Vector3; radius: number; source: Athlete | null };
  footstep: { athlete: Athlete; intensity: number };
  fake: { athlete: Athlete };
  roundStart: { round: number };
  roundEnd: { round: number; winner: TeamId | -1 };
  matchEnd: { winner: TeamId | -1 };
  countdown: { value: number };
  announce: { text: string; sub?: string; style?: 'hit' | 'catch' | 'perfect' | 'ko' | 'round' | 'info' | 'warn' | 'ultimate' };
}
