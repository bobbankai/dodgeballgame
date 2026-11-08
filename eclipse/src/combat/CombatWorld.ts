import { Vector3 } from '@babylonjs/core';
import type { Combatant, DamageInfo, HitResult, HurtCapsule, Team } from './Types';
import { sphereHitsCapsule, sweptBladeHitsCapsule } from './Geometry';
import { EventBus } from '../core/Events';

export interface HitEvent {
  attacker: Combatant | null;
  victim: Combatant;
  info: DamageInfo;
  result: HitResult;
  part: HurtCapsule | null;
}

export interface CombatEvents {
  hit: HitEvent;
  death: { victim: Combatant; killer: Combatant | null };
  parry: { defender: Combatant; attacker: Combatant | null };
  perfectDodge: { defender: Combatant; attacker: Combatant | null };
}

/**
 * Registry of everything that can fight, with the queries combat and AI need: swept weapon hits,
 * sphere/area damage, nearest targets for lock-on and auto-aim, and who is attacking whom (for
 * group tactics). Hit results are broadcast so audio, VFX, UI and the camera can react.
 */
export class CombatWorld {
  private all = new Map<number, Combatant>();
  readonly events = new EventBus<CombatEvents>();
  /** attacker id -> current target id (AI uses this to limit how many enemies attack at once). */
  readonly engaged = new Map<number, number>();
  private nextId = 1;

  newId(): number {
    return this.nextId++;
  }

  add(c: Combatant): void {
    this.all.set(c.id, c);
  }

  remove(c: Combatant): void {
    this.all.delete(c.id);
    this.engaged.delete(c.id);
  }

  clear(): void {
    this.all.clear();
    this.engaged.clear();
  }

  get list(): Combatant[] {
    return [...this.all.values()];
  }

  enemiesOf(team: Team): Combatant[] {
    return this.list.filter((c) => c.alive && c.team !== team && c.team !== 'neutral');
  }

  /** Number of combatants currently attacking `target`. */
  attackersOn(target: Combatant): number {
    let n = 0;
    for (const t of this.engaged.values()) if (t === target.id) n++;
    return n;
  }

  /**
   * A weapon swing for one step. `already` holds victims hit earlier in the same swing (one hit per
   * target per swing). Returns the hits made this step.
   */
  sweep(attacker: Combatant, b0: Vector3, t0: Vector3, b1: Vector3, t1: Vector3, bladeR: number,
    already: Set<number>, make: (victim: Combatant, point: Vector3) => DamageInfo): HitEvent[] {
    const out: HitEvent[] = [];
    for (const c of this.all.values()) {
      if (!c.alive || c === attacker || c.team === attacker.team || already.has(c.id)) continue;
      // broad phase: distance from the blade's midpoint to the victim's centre
      const mid = Vector3.Center(b1, t1);
      const reach = Vector3.Distance(b1, t1) + c.radius + c.height + 1;
      if (Vector3.DistanceSquared(mid, c.position) > reach * reach) continue;
      let best: { p: Vector3; part: HurtCapsule } | null = null;
      for (const h of c.hurtboxes()) {
        const p = sweptBladeHitsCapsule(b0, t0, b1, t1, bladeR, h.a, h.b, h.radius);
        if (p && (!best || h.mult > best.part.mult)) best = { p: new Vector3(p.x, p.y, p.z), part: h };
      }
      if (!best) continue;
      already.add(c.id);
      const info = make(c, best.p);
      out.push(this.apply(attacker, c, info, best.part));
    }
    return out;
  }

  /** Damage everything of other teams inside a sphere (explosions, slams, boss area attacks). */
  area(attacker: Combatant | null, team: Team, center: Vector3, radius: number, already: Set<number> | null,
    make: (victim: Combatant) => DamageInfo): HitEvent[] {
    const out: HitEvent[] = [];
    for (const c of this.all.values()) {
      if (!c.alive || c === attacker || c.team === team || (already && already.has(c.id))) continue;
      let touched = false;
      for (const h of c.hurtboxes()) {
        if (sphereHitsCapsule(center, radius, h.a, h.b, h.radius)) {
          touched = true;
          break;
        }
      }
      if (!touched) continue;
      already?.add(c.id);
      out.push(this.apply(attacker, c, make(c), null));
    }
    return out;
  }

  apply(attacker: Combatant | null, victim: Combatant, info: DamageInfo, part: HurtCapsule | null): HitEvent {
    const wasAlive = victim.alive;
    const result = victim.receive(info, part);
    const ev: HitEvent = { attacker, victim, info, result, part };
    this.events.emit('hit', ev);
    if (result === 'parried') this.events.emit('parry', { defender: victim, attacker });
    if (wasAlive && !victim.alive) this.events.emit('death', { victim, killer: attacker });
    return ev;
  }

  /** Living targets of other teams, nearest first, optionally within a view cone. */
  targets(from: Combatant, range: number, dir?: Vector3, cosHalf = -1): Combatant[] {
    const res: [number, Combatant][] = [];
    const p = new Vector3();
    for (const c of this.all.values()) {
      if (!c.alive || !c.targetable || c.team === from.team || c.team === 'neutral') continue;
      c.aimPoint(p);
      const d = p.subtract(from.position);
      d.y = 0;
      const dist = d.length();
      if (dist > range) continue;
      if (dir && dist > 0.5 && Vector3.Dot(d.scale(1 / dist), dir) < cosHalf) continue;
      res.push([dist, c]);
    }
    return res.sort((a, b) => a[0] - b[0]).map((r) => r[1]);
  }
}
