import { Vector3 } from '@babylonjs/core';
import type { Combatant } from '../combat/Types';

/** What the director needs to know about each enemy. */
export interface Tactical {
  readonly id: number;
  readonly position: Vector3;
  readonly heavy: boolean;
  readonly alive: boolean;
  /** In combat with the player (holding, circling or attacking). */
  readonly engaged: boolean;
  /** Ranged enemies do not need melee tokens, they share a separate pool. */
  readonly ranged: boolean;
  /** Bosses run their own pattern and ignore tokens. */
  readonly boss: boolean;
  alert(source: Vector3, target: Combatant): void;
}

/**
 * Group tactics: who may attack the player right now (attack tokens, so a crowd takes turns instead
 * of piling in), where everyone else stands while they wait (slots spread around the player), and
 * alerts that spread through a group when one of them is engaged.
 */
export class AiDirector {
  private members = new Set<Tactical>();
  private tokens = new Map<number, number>();
  /** How many melee / ranged attackers may act on the player at once (difficulty). */
  maxMelee = 2;
  maxRanged = 2;
  /** Seconds an enemy must wait after giving a token back before it can take one again. */
  rest = 0.8;
  private lastHeld = new Map<number, number>();
  private time = 0;

  add(m: Tactical): void {
    this.members.add(m);
  }

  remove(m: Tactical): void {
    this.members.delete(m);
    this.tokens.delete(m.id);
  }

  clear(): void {
    this.members.clear();
    this.tokens.clear();
    this.lastHeld.clear();
  }

  update(dt: number): void {
    this.time += dt;
    for (const m of this.members) if (!m.alive) this.release(m);
  }

  private used(ranged: boolean): number {
    let n = 0;
    for (const [id, w] of this.tokens) {
      const m = [...this.members].find((x) => x.id === id);
      if (m && m.ranged === ranged) n += w;
    }
    return n;
  }

  /** Ask to attack. Heavy enemies cost two tokens; the closest waiting enemies are served first. */
  request(m: Tactical, target: Combatant): boolean {
    if (m.boss) return true;
    if (this.tokens.has(m.id)) return true;
    const since = this.time - (this.lastHeld.get(m.id) ?? -99);
    if (since < this.rest) return false;
    const cost = m.heavy ? 2 : 1;
    const max = m.ranged ? this.maxRanged : this.maxMelee;
    if (this.used(m.ranged) + cost > max) {
      // a closer enemy can take a token from one that is still walking in from far away
      return false;
    }
    // prefer the nearest of the waiting enemies: someone closer gets it first
    const d = Vector3.DistanceSquared(m.position, target.position);
    for (const o of this.members) {
      if (o === m || !o.alive || !o.engaged || o.ranged !== m.ranged || this.tokens.has(o.id)) continue;
      if (Vector3.DistanceSquared(o.position, target.position) < d - 4) {
        const os = this.time - (this.lastHeld.get(o.id) ?? -99);
        if (os >= this.rest && Math.random() < 0.5) return false;
      }
    }
    this.tokens.set(m.id, cost);
    return true;
  }

  holds(m: Tactical): boolean {
    return m.boss || this.tokens.has(m.id);
  }

  release(m: Tactical): void {
    if (this.tokens.delete(m.id)) this.lastHeld.set(m.id, this.time);
  }

  /**
   * Where a waiting enemy should stand: on a ring round the target, at an angle spread from the
   * others so the group surrounds the player rather than queueing in a line.
   */
  slot(m: Tactical, target: Combatant, radius: number, out = new Vector3()): Vector3 {
    const engaged = [...this.members].filter((o) => o.alive && o.engaged && !o.boss);
    const angles = engaged.map((o) => ({ o, a: Math.atan2(o.position.x - target.position.x, o.position.z - target.position.z) }));
    angles.sort((p, q) => p.a - q.a);
    const i = angles.findIndex((p) => p.o === m);
    const n = angles.length;
    let a = i >= 0 ? angles[i].a : 0;
    if (n > 1 && i >= 0) {
      // relax toward the middle of the gap between the two neighbours
      const prev = angles[(i - 1 + n) % n].a;
      const next = angles[(i + 1) % n].a;
      const gapPrev = wrap(a - prev);
      const gapNext = wrap(next - a);
      a += (gapNext - gapPrev) * 0.25;
    }
    return out.set(target.position.x + Math.sin(a) * radius, target.position.y, target.position.z + Math.cos(a) * radius);
  }

  /** One enemy found the player: the others nearby hear about it. */
  alertAround(from: Vector3, radius: number, target: Combatant): void {
    for (const m of this.members) {
      if (!m.alive || m.engaged) continue;
      if (Vector3.DistanceSquared(m.position, from) < radius * radius) m.alert(from, target);
    }
  }

  get engagedCount(): number {
    let n = 0;
    for (const m of this.members) if (m.alive && m.engaged) n++;
    return n;
  }
}

function wrap(a: number): number {
  a %= Math.PI * 2;
  return a < 0 ? a + Math.PI * 2 : a;
}
