import type { Element } from './Types';

/** One attack of the player's moveset. Timing comes from the clip's authored events. */
export interface AttackDef {
  id: string;
  clip: string;
  damage: number;
  poise: number;
  stamina: number;
  element?: Element;
  /** 0..1: hit-stop length, camera shake and hit-reaction size. */
  weight: number;
  knockback: number;
  launch?: boolean;
  knockdown?: boolean;
  /** Super armour while winding up (the player is not flinched by light hits). */
  armour?: boolean;
  /** Next attack when light / heavy is pressed during the combo window. */
  nextLight?: string;
  nextHeavy?: string;
  /** Aether gained per hit. */
  aether: number;
  /** Turn towards the target / stick direction at the start (radians per second). */
  track: number;
  /** Area damage at an 'impact' event (radius, metres). */
  impactRadius?: number;
}

export const ATTACKS: Record<string, AttackDef> = {
  light_1: { id: 'light_1', clip: 'light_1', damage: 18, poise: 12, stamina: 10, weight: 0.25, knockback: 0.3, nextLight: 'light_2', nextHeavy: 'heavy_2', aether: 4, track: 14 },
  light_2: { id: 'light_2', clip: 'light_2', damage: 21, poise: 14, stamina: 10, weight: 0.3, knockback: 0.35, nextLight: 'light_3', nextHeavy: 'heavy_2', aether: 4, track: 12 },
  light_3: { id: 'light_3', clip: 'light_3', damage: 26, poise: 22, stamina: 12, weight: 0.45, knockback: 0.5, nextLight: 'light_4', nextHeavy: 'heavy_1', aether: 5, track: 10 },
  light_4: { id: 'light_4', clip: 'light_4', damage: 38, poise: 34, stamina: 16, weight: 0.65, knockback: 1.4, aether: 8, track: 8, armour: true },
  heavy_1: { id: 'heavy_1', clip: 'heavy_1', damage: 52, poise: 48, stamina: 24, weight: 0.85, knockback: 1.2, nextLight: 'light_2', aether: 8, track: 8, armour: true, impactRadius: 1.6 },
  heavy_2: { id: 'heavy_2', clip: 'heavy_2', damage: 44, poise: 40, stamina: 22, weight: 0.7, knockback: 0.4, launch: true, nextLight: 'light_3', aether: 7, track: 9, armour: true },
  charged: { id: 'charged', clip: 'heavy_1', damage: 88, poise: 80, stamina: 30, weight: 1, knockback: 2.2, knockdown: true, aether: 12, track: 6, armour: true, impactRadius: 2.6 },
  sprint: { id: 'sprint', clip: 'sprint_attack', damage: 32, poise: 26, stamina: 16, weight: 0.55, knockback: 1.0, nextLight: 'light_2', aether: 5, track: 6 },
  air: { id: 'air', clip: 'air_attack', damage: 46, poise: 40, stamina: 14, weight: 0.85, knockback: 1.5, knockdown: true, aether: 6, track: 4, impactRadius: 2.2 },
  riposte: { id: 'riposte', clip: 'riposte', damage: 95, poise: 999, stamina: 0, weight: 1, knockback: 1.8, knockdown: true, aether: 20, track: 20 },
  execution: { id: 'execution', clip: 'riposte', damage: 160, poise: 999, stamina: 0, weight: 1, knockback: 2.2, knockdown: true, aether: 25, track: 20 },
};
