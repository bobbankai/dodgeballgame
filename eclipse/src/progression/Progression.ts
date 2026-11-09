import { EventBus } from '../core/Events';
import type { Player } from '../player/Player';

/** A node in the skill tree. Effects are applied to the player's modifiers when learned. */
export interface Skill {
  id: string;
  branch: 'blade' | 'bulwark' | 'godspark';
  name: string;
  desc: string;
  cost: number;
  /** Skills that must be learned first. */
  requires: string[];
  apply(p: Player): void;
}

export const SKILLS: Skill[] = [
  // ---------------------------------------------------------------- Blade: offence
  { id: 'keen_edge', branch: 'blade', name: 'Keen Edge', desc: 'Light attacks deal 10% more damage.', cost: 1, requires: [],
    apply: (p) => { p.mods.damage *= 1.1; } },
  { id: 'heavy_hand', branch: 'blade', name: 'Heavy Hand', desc: 'Your blows break poise 20% faster.', cost: 1, requires: ['keen_edge'],
    apply: (p) => { p.mods.poiseDamage *= 1.2; } },
  { id: 'momentum', branch: 'blade', name: 'Momentum', desc: 'Attacks cost 20% less stamina.', cost: 2, requires: ['keen_edge'],
    apply: (p) => { p.mods.staminaCost *= 0.8; } },
  { id: 'executioner', branch: 'blade', name: 'Executioner', desc: 'All damage +15%. Executions and ripostes restore 10% health.', cost: 2, requires: ['heavy_hand'],
    apply: (p) => { p.mods.damage *= 1.15; p.mods.executionHeal = 0.1; } },
  // ---------------------------------------------------------------- Bulwark: defence
  { id: 'vigil_guard', branch: 'bulwark', name: 'Vigil Guard', desc: 'The parry window is 40% wider.', cost: 1, requires: [],
    apply: (p) => { p.mods.parryWindow *= 1.4; } },
  { id: 'iron_will', branch: 'bulwark', name: 'Iron Will', desc: 'Light hits no longer stagger you as easily (+30% flinch resistance).', cost: 1, requires: ['vigil_guard'],
    apply: (p) => { p.mods.flinchResist = Math.min(0.8, p.mods.flinchResist + 0.3); } },
  { id: 'deep_flask', branch: 'bulwark', name: 'Deep Flask', desc: 'One more ember flask.', cost: 2, requires: ['vigil_guard'],
    apply: (p) => { p.maxFlasks += 1; p.flasks = p.maxFlasks; } },
  { id: 'second_wind', branch: 'bulwark', name: 'Second Wind', desc: 'Maximum health +20%.', cost: 2, requires: ['iron_will'],
    apply: (p) => { p.stats.maxHealth = Math.round(p.stats.maxHealth * 1.2); p.stats.health = p.stats.maxHealth; } },
  // ---------------------------------------------------------------- Godspark: abilities
  { id: 'kindling', branch: 'godspark', name: 'Kindling', desc: 'Gain 30% more aether from hits, parries and dodges.', cost: 1, requires: [],
    apply: (p) => { p.mods.aetherGain *= 1.3; } },
  { id: 'phase_step', branch: 'godspark', name: 'Phase Step', desc: 'Dodges carry you 25% further.', cost: 1, requires: ['kindling'],
    apply: (p) => { p.mods.dodgeDistance *= 1.25; } },
  { id: 'overflow', branch: 'godspark', name: 'Overflow', desc: 'Abilities cost 25% less aether.', cost: 2, requires: ['kindling'],
    apply: (p) => { p.mods.abilityCost *= 0.75; } },
  { id: 'radiance', branch: 'godspark', name: 'Radiance', desc: 'Abilities deal 30% more damage.', cost: 2, requires: ['overflow'],
    apply: (p) => { p.mods.abilityDamage *= 1.3; } },
];

export interface ProgressState {
  xp: number;
  level: number;
  points: number;
  skills: string[];
  /** Godsparks claimed (unlock abilities and chapters). */
  sparks: string[];
}

interface ProgressEvents {
  xp: { amount: number; total: number };
  levelUp: { level: number };
  learned: { skill: Skill };
}

/**
 * Experience, levels and the skill tree. Killing enemies grants XP; each level gives a skill point
 * and a little health and stamina. Skills apply to the player's modifiers immediately and again on
 * every load (the player object is rebuilt from the saved state).
 */
export class Progression {
  state: ProgressState = { xp: 0, level: 1, points: 0, skills: [], sparks: [] };
  readonly events = new EventBus<ProgressEvents>();

  static xpFor(level: number): number {
    return Math.round(120 * Math.pow(level, 1.55));
  }

  get nextAt(): number {
    return Progression.xpFor(this.state.level);
  }

  addXp(amount: number, p: Player | null): void {
    const s = this.state;
    s.xp += amount;
    this.events.emit('xp', { amount, total: s.xp });
    while (s.xp >= this.nextAt) {
      s.xp -= this.nextAt;
      s.level++;
      s.points++;
      if (p) this.levelBonus(p);
      this.events.emit('levelUp', { level: s.level });
    }
  }

  private levelBonus(p: Player): void {
    p.stats.maxHealth += 12;
    p.stats.health = p.stats.maxHealth;
    p.stats.maxStamina += 3;
  }

  canLearn(id: string): boolean {
    const sk = SKILLS.find((x) => x.id === id);
    if (!sk || this.state.skills.includes(id)) return false;
    return this.state.points >= sk.cost && sk.requires.every((r) => this.state.skills.includes(r));
  }

  learn(id: string, p: Player | null): boolean {
    if (!this.canLearn(id)) return false;
    const sk = SKILLS.find((x) => x.id === id)!;
    this.state.points -= sk.cost;
    this.state.skills.push(id);
    if (p) sk.apply(p);
    this.events.emit('learned', { skill: sk });
    return true;
  }

  /** Re-applies everything earned to a freshly created player. */
  applyAll(p: Player): void {
    for (let l = 2; l <= this.state.level; l++) this.levelBonus(p);
    for (const id of this.state.skills) SKILLS.find((x) => x.id === id)?.apply(p);
  }
}
