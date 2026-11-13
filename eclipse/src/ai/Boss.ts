import { Vector3 } from '@babylonjs/core';
import { Enemy, type AiContext } from './Enemy';
import type { Character } from '../character/Character';
import type { EnemyArchetype, EnemyAttack } from './Archetypes';
import type { Combatant, DamageInfo, Element, HitResult, HurtCapsule } from '../combat/Types';
import type { ClipEvent } from '../anim/Clip';

export interface BossPhase {
  /** Health fraction at which this phase begins (the first phase starts at 1). */
  at: number;
  /** Attack ids available in this phase. */
  attacks: string[];
  /** Animation speed multiplier (later phases are faster). */
  speed: number;
  aggression: number;
}

export interface BossDef {
  archetype: EnemyArchetype;
  title: string;
  phases: BossPhase[];
  /** Name of a special-move set registered with `Boss.specials`. */
  kit: string;
  /** The god's element: colours the phase-change blast (default fire). */
  element?: Element;
}

/** Phase-change blast per element: burst effect, shockwave colour (HDR rgb + intensity). */
const ROAR_FX: Record<string, { vfx: string; ring: [number, number, number, number] }> = {
  fire: { vfx: 'firePillar', ring: [1, 0.5, 0.15, 5] },
  water: { vfx: 'geyser', ring: [0.3, 0.8, 1, 4] },
};

/** A special move: runs on the attack's clip events ('channel', 'release', 'impact') and each step. */
export interface Special {
  event?(b: Boss, a: EnemyAttack, e: ClipEvent): void;
  start?(b: Boss, a: EnemyAttack): void;
  step?(b: Boss, a: EnemyAttack, dt: number): void;
  end?(b: Boss, a: EnemyAttack): void;
}

/**
 * A god: an enemy with phases. Each phase unlocks moves, speeds the animations and raises
 * aggression; crossing a phase threshold triggers a roaring transition (invulnerable, a blast that
 * pushes the player back). Bosses never wait for attack tokens, pick moves by range with a strong
 * preference for gap closers when far, and their poise breaks into a long stagger that takes extra
 * damage instead of an execution. Special moves (fire lines, leaps, meteor rain, novas, summons)
 * are plugged in per boss through `specials`.
 */
export class Boss extends Enemy {
  static specials: Record<string, Record<string, Special>> = {};
  /** Per-boss behaviour that runs every step (hovering, auras), by kit name. */
  static passives: Record<string, (b: Boss, dt: number) => void> = {};
  readonly bossDef: BossDef;
  phase = 0;
  transitioning = false;
  /** Hooks the level wires up (music, arena changes, adds). */
  onPhase: ((phase: number) => void) | null = null;
  spawnAdds: ((at: Vector3, count: number) => void) | null = null;
  private used = new Set<string>();

  constructor(ctx: AiContext, def: BossDef, char: Character, at: Vector3, yaw: number) {
    super(ctx, def.archetype, char, at, yaw, def.archetype.name, true);
    this.bossDef = def;
    this.stats.poiseDelay = 4;
  }

  override update(dt: number): void {
    super.update(dt);
    if (this.alive) Boss.passives[this.bossDef.kit]?.(this, dt);
  }

  get title(): string {
    return this.bossDef.title;
  }

  get phases(): number[] {
    return this.bossDef.phases.slice(1).map((p) => p.at);
  }

  private get kit(): Record<string, Special> {
    return Boss.specials[this.bossDef.kit] ?? {};
  }

  private get phaseDef(): BossPhase {
    return this.bossDef.phases[this.phase];
  }

  /** Used once per fight (summons). */
  once(id: string): boolean {
    if (this.used.has(id)) return false;
    this.used.add(id);
    return true;
  }

  protected override pickAttack(t: Combatant, d: number): EnemyAttack | null {
    const allowed = new Set(this.phaseDef.attacks);
    let best: EnemyAttack | null = null;
    let bestScore = 0;
    for (const a of this.def.attacks) {
      if (!allowed.has(a.id) || a.score <= 0) continue;
      if ((this.cooldowns.get(a.id) ?? 0) > this.time) continue;
      if (a.id === 'summon' && this.used.has('summon')) continue;
      const [lo, hi] = a.range;
      const miss = d < lo ? lo - d : d > hi ? d - hi : 0;
      if (miss > 3) continue;
      let s = a.score * (miss > 0 ? 0.4 / (1 + miss) : 1);
      // far away: strongly prefer moves that close the gap or reach across it
      if (d > 7 && lo >= 5) s *= 2.2;
      // the player behind him: area moves (no blade to aim) catch them where a swing would miss
      if (this.angleTo(t.position) > 1.6) s *= a.hit?.kind === 'none' ? 1.8 : 0.5;
      s *= 0.7 + Math.random() * 0.6;
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    if (best && Math.random() > 0.55 + this.phaseDef.aggression * 0.45) return null;
    return best;
  }

  protected override startAttack(a: EnemyAttack): void {
    const scaled = { ...a, speed: (a.speed ?? 1) * this.phaseDef.speed };
    super.startAttack(scaled);
    if (a.id === 'summon') this.used.add('summon');
    const sp = this.kit[a.id];
    sp?.start?.(this, scaled);
  }

  protected override attackTick(dt: number): void {
    super.attackTick(dt);
    const a = this.attack;
    if (a) this.kit[a.id]?.step?.(this, a, dt);
  }

  protected override endAttack(): void {
    const a = this.attack;
    if (a) this.kit[a.id]?.end?.(this, a);
    super.endAttack();
  }

  protected override onClipEvent(e: ClipEvent): void {
    const a = this.attack;
    const sp = a ? this.kit[a.id] : undefined;
    if (sp?.event && (e.name === 'impact' || e.name === 'release' || e.name === 'channel')) {
      sp.event(this, a!, e);
      // a special replaces the generic impact/projectile behaviour for its own events
      if (e.name !== 'channel') return;
    }
    super.onClipEvent(e);
  }

  override receive(hit: DamageInfo, part: HurtCapsule | null): HitResult {
    if (this.transitioning) return 'immune';
    const r = super.receive(hit, part);
    const next = this.bossDef.phases[this.phase + 1];
    if (this.alive && next && this.stats.healthFrac <= next.at) this.enterPhase(this.phase + 1);
    return r;
  }

  private enterPhase(i: number): void {
    this.phase = i;
    this.transitioning = true;
    if (this.attack) this.kit[this.attack.id]?.end?.(this, this.attack);
    this.attack = null;
    this.sweep.end();
    this.executable = false;
    this.setState('taunt');
    this.stop();
    this.stats.resetPoise();
    const at = this.position.clone();
    const el = this.bossDef.element ?? 'fire';
    const fx = ROAR_FX[el] ?? ROAR_FX.fire;
    this.ctx.vfx.burst(fx.vfx, at, Vector3.Up(), 1.6);
    this.ctx.ground.shockwave(at, 9, fx.ring, 0.7);
    // the roar's blast pushes the player out of melee range
    this.ctx.world.area(this, this.team, at.add(new Vector3(0, 1, 0)), 4.5, null, (v) => {
      const dir = v.position.subtract(at);
      dir.y = 0;
      dir.normalize();
      return { amount: 8, poise: 60, element: el, direction: dir, point: v.position.clone(), source: this, weight: 0.6, knockback: 2.5, knockdown: true, parryable: false, unblockable: true, ranged: true, tag: 'roar' };
    });
    this.char.animator.play(this.clip('e_alert', 'stagger'), {
      fade: 0.15,
      speed: 0.8,
      onEnd: () => {
        this.transitioning = false;
        this.toCombat();
      },
    });
    this.onPhase?.(i);
  }

  /** Bosses stagger long instead of being executed. */
  protected override stun(seconds: number): void {
    super.stun(seconds * 1.4);
    this.executable = false;
  }

  /** Displacement applied this step on top of the clip's root motion (special moves). */
  setWarp(v: Vector3): void {
    this.warp.copyFrom(v);
  }

  get facing(): Vector3 {
    return this.char.forward;
  }
}
