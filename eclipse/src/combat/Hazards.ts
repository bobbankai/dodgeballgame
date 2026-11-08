import { Vector3 } from '@babylonjs/core';
import type { CombatWorld, HitEvent } from './CombatWorld';
import type { Combatant, DamageInfo, Team } from './Types';
import type { Vfx } from '../vfx/Vfx';
import type { GroundFx } from '../vfx/GroundFx';

interface Timer {
  at: number;
  fn: () => void;
}

interface Zone {
  center: Vector3;
  radius: number;
  until: number;
  team: Team;
  owner: Combatant | null;
  tick: number;
  next: Map<number, number>;
  make: (victim: Combatant) => DamageInfo;
}

/**
 * Area attacks that play out over time on the game clock: telegraphed eruptions (a warning circle,
 * then the strike), lingering damage zones (burning ground, tide pools, storm fields), and a small
 * scheduler for anything else that should happen "in N seconds" (it follows hit-stop and pauses).
 */
export class Hazards {
  private timers: Timer[] = [];
  private zones: Zone[] = [];
  time = 0;
  onHit: ((h: HitEvent) => void) | null = null;

  constructor(private world: CombatWorld, private vfx: Vfx, private ground: GroundFx) {}

  after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  /** Warning circle for `delay` seconds, then an eruption that hits everyone of other teams inside. */
  eruption(at: Vector3, radius: number, delay: number, vfx: string, owner: Combatant | null, team: Team,
    make: (victim: Combatant) => DamageInfo, opts: { color?: [number, number, number, number]; scorch?: boolean; zone?: number } = {}): void {
    const pos = at.clone();
    this.ground.telegraph(pos, radius, delay, opts.color);
    this.after(delay, () => {
      this.vfx.burst(vfx, pos, Vector3.Up(), radius / 2);
      this.ground.shockwave(pos, radius * 1.4, opts.color ? [opts.color[0], opts.color[1], opts.color[2], opts.color[3] * 1.3] : undefined);
      if (opts.scorch !== false) this.ground.scorch(pos, radius * 1.1);
      const hits = this.world.area(owner, team, pos, radius, null, make);
      for (const h of hits) this.onHit?.(h);
      if (opts.zone) this.zone(pos, radius * 0.9, opts.zone, owner, team, 0.5, (v) => {
        const i = make(v);
        return { ...i, amount: i.amount * 0.12, poise: 0, knockdown: false, knockback: 0, weight: 0.05 };
      });
    });
  }

  /** Damages anyone standing inside every `tick` seconds until it expires. */
  zone(center: Vector3, radius: number, duration: number, owner: Combatant | null, team: Team, tick: number, make: (victim: Combatant) => DamageInfo): void {
    this.zones.push({ center: center.clone(), radius, until: this.time + duration, team, owner, tick, next: new Map(), make });
  }

  update(dt: number): void {
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    for (const z of this.zones) {
      for (const c of this.world.list) {
        if (!c.alive || c.team === z.team) continue;
        const dx = c.position.x - z.center.x;
        const dz = c.position.z - z.center.z;
        if (dx * dx + dz * dz > z.radius * z.radius || Math.abs(c.position.y - z.center.y) > 1.5) continue;
        if ((z.next.get(c.id) ?? 0) > this.time) continue;
        z.next.set(c.id, this.time + z.tick);
        const h = this.world.apply(z.owner, c, z.make(c), null);
        this.onHit?.(h);
      }
    }
    this.zones = this.zones.filter((z) => z.until > this.time);
  }

  clear(): void {
    this.timers = [];
    this.zones = [];
  }
}
