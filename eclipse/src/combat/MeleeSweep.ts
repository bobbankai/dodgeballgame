import { Vector3 } from '@babylonjs/core';
import type { CombatWorld, HitEvent } from './CombatWorld';
import type { Combatant, DamageInfo } from './Types';

/** A segment in world space (blade base -> tip, or a limb from joint to joint). */
export interface Segment {
  a: Vector3;
  b: Vector3;
}

/**
 * Swept melee hit detection shared by everything that swings something: each step the striking
 * segment is swept from where it was last step to where it is now, so fast swings never tunnel
 * through a target, and each victim is hit at most once per swing.
 */
export class MeleeSweep {
  readonly hits = new Set<number>();
  private prev: Segment[] = [];
  active = false;

  begin(): void {
    this.active = true;
    this.prev = [];
  }

  end(): void {
    this.active = false;
    this.prev = [];
  }

  /** A new swing: everyone can be hit again. */
  reset(): void {
    this.hits.clear();
    this.end();
  }

  step(world: CombatWorld, attacker: Combatant, now: Segment[], radius: number, make: (victim: Combatant, point: Vector3) => DamageInfo): HitEvent[] {
    if (!this.active) return [];
    const out: HitEvent[] = [];
    for (let i = 0; i < now.length; i++) {
      const p = this.prev[i] ?? now[i];
      out.push(...world.sweep(attacker, p.a, p.b, now[i].a, now[i].b, radius, this.hits, make));
    }
    this.prev = now.map((s) => ({ a: s.a.clone(), b: s.b.clone() }));
    return out;
  }
}
