// The damage model: how much a hit hurts and how much it breaks posture. One place for every rule so the
// player's blade, the enemies' weapons, projectiles, hazards and status effects all agree:
//   - damage types with per-target resistances (the Forgemother shrugs off fire, the Frost Warden fears it),
//   - situational multipliers: backstab on an unaware target, a staggered target, a counter-hit that lands
//     while the target is winding up its own attack, a perfect-dodge riposte,
//   - critical hits (rare, never random against bosses' first phase), and a floor so chip damage always shows,
//   - posture damage, which heavy hits and blocked hits deal more of.
export type DamageType = 'slash' | 'blunt' | 'pierce' | 'fire' | 'frost' | 'shadow';

export type Resistances = Partial<Record<DamageType, number>>;

export interface DamageContext {
  /** the target had not noticed the attacker */
  backstab?: boolean;
  /** the target's posture is broken */
  staggered?: boolean;
  /** the target was winding up an attack (a trade the defender wins) */
  counter?: boolean;
  /** a riposte straight after a perfect dodge or parry */
  riposte?: boolean;
  /** the hit came from an Ember Art */
  art?: boolean;
  /** 0..1 chance of a critical (rolled with `roll`) */
  critChance?: number;
  /** deterministic roll in 0..1 (tests); Math.random by default */
  roll?: number;
  /** global multiplier (difficulty, chapter scaling) */
  scale?: number;
}

export interface DamageResult {
  amount: number;
  crit: boolean;
  /** the product of all situational multipliers */
  mult: number;
  /** the resistance multiplier that applied */
  resist: number;
  /** labels of what applied, for the combat log and floating text */
  tags: string[];
}

export const MULT = {
  backstab: 2.0,
  staggered: 1.5,
  counter: 1.3,
  riposte: 1.6,
  crit: 1.75,
  art: 1.0,
} as const;

/** the resistance multiplier for a damage type (1 = normal, below 1 resists, above 1 is a weakness) */
export function resistOf(r: Resistances | undefined, type: DamageType): number {
  const v = r?.[type];
  return v === undefined ? 1 : Math.max(0, v);
}

export function computeDamage(base: number, type: DamageType, resist: Resistances | undefined, ctx: DamageContext = {}): DamageResult {
  const tags: string[] = [];
  let mult = 1;
  if (ctx.backstab) { mult *= MULT.backstab; tags.push('backstab'); }
  if (ctx.staggered) { mult *= MULT.staggered; tags.push('staggered'); }
  if (ctx.counter) { mult *= MULT.counter; tags.push('counter'); }
  if (ctx.riposte) { mult *= MULT.riposte; tags.push('riposte'); }
  const roll = ctx.roll ?? Math.random();
  const crit = (ctx.critChance ?? 0) > 0 && roll < (ctx.critChance ?? 0);
  if (crit) { mult *= MULT.crit; tags.push('crit'); }
  const r = resistOf(resist, type);
  if (r < 0.95) tags.push('resisted');
  else if (r > 1.05) tags.push('weak');
  const raw = base * mult * r * (ctx.scale ?? 1);
  // a hit that connects always does something (immunity aside), so the player sees the bar move
  const amount = r <= 0 ? 0 : Math.max(raw, Math.min(1, base * 0.05));
  return { amount, crit, mult, resist: r, tags };
}

export interface PostureContext {
  heavy?: boolean;
  blocked?: boolean;
  /** guard-break multiplier of the attack (warhammers) */
  guardBreak?: number;
  /** the defender's posture toughness (bosses higher) */
  toughness?: number;
}

/** posture (poise / guard) damage of a hit */
export function postureDamage(base: number, c: PostureContext = {}): number {
  let m = c.heavy ? 1.6 : 1;
  if (c.blocked) m *= 1.2 * (c.guardBreak ?? 1);
  return (base * m) / Math.max(0.25, c.toughness ?? 1);
}

/** health and posture regeneration curve: nothing while recently hit, then ramping up */
export function regenRate(base: number, sinceHit: number, delay = 2.5, ramp = 2): number {
  if (sinceHit < delay) return 0;
  return base * Math.min(1, (sinceHit - delay) / ramp);
}

/** a running tally for debugging and balancing: damage dealt per source and per type */
export class CombatLog {
  private entries: { t: number; from: string; to: string; amount: number; type: DamageType; tags: string[] }[] = [];
  readonly limit: number;

  constructor(limit = 400) { this.limit = limit; }

  add(t: number, from: string, to: string, amount: number, type: DamageType, tags: string[] = []): void {
    this.entries.push({ t, from, to, amount, type, tags });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
  }

  /** total damage dealt by a source (or everyone) in the last `window` seconds before `now` */
  dealt(now: number, window = Infinity, from?: string): number {
    let s = 0;
    for (const e of this.entries) if (now - e.t <= window && (!from || e.from === from)) s += e.amount;
    return s;
  }

  /** damage per second over a window */
  dps(now: number, window: number, from?: string): number {
    return window > 0 ? this.dealt(now, window, from) / window : 0;
  }

  byType(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const e of this.entries) out[e.type] = (out[e.type] ?? 0) + e.amount;
    return out;
  }

  get size(): number { return this.entries.length; }
  clear(): void { this.entries.length = 0; }
}
