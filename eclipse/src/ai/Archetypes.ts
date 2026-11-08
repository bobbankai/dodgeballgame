import type { Element } from '../combat/Types';

/** Where an attack's damage comes from. */
export type HitShape =
  /** The equipped weapon's blade (base -> tip on the weapon socket). */
  | { kind: 'weapon'; socket?: string }
  /** Limbs: segments between bones (claws, shield bashes, stomps). */
  | { kind: 'bones'; pairs: [string, string][]; radius: number }
  /** Nothing swings: damage comes from `impact` areas or projectiles only. */
  | { kind: 'none' };

export interface EnemyAttack {
  id: string;
  clip: string;
  /** Clip used when `clip` is not in the library yet. */
  fallback?: string;
  speed?: number;
  damage: number;
  poise: number;
  /** 0..1: hit-stop, shake and the size of the victim's reaction. */
  weight: number;
  knockback: number;
  element?: Element;
  /** Distance band (metres, edge to edge) in which this attack is chosen. */
  range: [number, number];
  /** Largest angle off facing (radians) to start it. */
  angle?: number;
  cooldown: number;
  /** Base utility: how much this enemy likes the move. */
  score: number;
  parryable: boolean;
  unblockable?: boolean;
  knockdown?: boolean;
  /** Turn rate while winding up (rad/s) and for how long. */
  track: number;
  trackTime: number;
  /** Scales the clip's root motion (lunges cover more ground). */
  lunge?: number;
  /** Follow-up attacks and the chance to chain into one. */
  next?: string[];
  chain?: number;
  /** Area damage at the clip's `impact` event, centred ahead of the enemy (radius, distance). */
  impact?: { radius: number; ahead: number; damage?: number; vfx?: string };
  /** Projectile spawned at the clip's `release` event. */
  projectile?: string;
  /** Spell that erupts under the target at `release` (after a telegraph). */
  eruption?: { radius: number; delay: number; vfx: string };
  hit?: HitShape;
  /** Super armour through the swing (light hits do not interrupt). */
  armour?: boolean;
  /** Visual tell before the swing: a glint (parryable) or a red flare (unblockable). */
  tell?: 'glint' | 'red';
  /** Status build-up applied with each hit. */
  status?: { burn?: number; soak?: number; shock?: number; root?: number };
}

export interface EnemyArchetype {
  id: string;
  name: string;
  /** Character model id (public/assets/chars/<model>). */
  model: string;
  weapon?: string;
  weaponL?: string;
  scale: number;
  health: number;
  poise: number;
  stamina: number;
  radius: number;
  height: number;
  walk: number;
  run: number;
  /** Strafing speed while circling the player. */
  strafe: number;
  sight: number;
  /** Field of view (radians, full angle). */
  fov: number;
  hearing: number;
  /** 0..1: how readily it presses the attack. */
  aggression: number;
  /** Chance to block / dodge an incoming attack it sees coming. */
  block: number;
  dodge: number;
  /** Distance it likes to hold when it is not attacking. */
  holdRange: number;
  /** Large enemies take more attack tokens and shrug off light hits. */
  heavy: boolean;
  /** Can be executed when its poise breaks. */
  executable: boolean;
  attacks: EnemyAttack[];
  resist?: Partial<Record<Element, number>>;
  xp: number;
  aether: number;
  /** Rendering tint for corrupted variants (multiplies the emissive glow). */
  glow?: [number, number, number];
  /** Casters keep away from the player. */
  ranged?: boolean;
  /** Locomotion clips (defaults: idle/walk/run + guard strafes). */
  loco?: { idle?: string; walk?: string; run?: string; combatIdle?: string };
}

const SWORD: HitShape = { kind: 'weapon' };

/** Chapter One, the Ashen Kingdom: Ignaroth's burnt legions. */
export const ARCHETYPES: Record<string, EnemyArchetype> = {
  thrall: {
    id: 'thrall', name: 'Ashbound Thrall', model: 'thrall', weapon: 'ashblade', scale: 1,
    health: 90, poise: 26, stamina: 60, radius: 0.36, height: 1.8,
    walk: 1.4, run: 4.4, strafe: 1.5, sight: 18, fov: 2.2, hearing: 9,
    aggression: 0.75, block: 0.05, dodge: 0.08, holdRange: 3.2, heavy: false, executable: true,
    xp: 22, aether: 6, glow: [1.0, 0.45, 0.12],
    loco: { walk: 'e_shamble' },
    attacks: [
      { id: 'slash', clip: 'e_slash', fallback: 'light_1', damage: 16, poise: 14, weight: 0.3, knockback: 0.4, range: [0, 1.6], cooldown: 1.2, score: 1, parryable: true, track: 9, trackTime: 0.3, next: ['slash2'], chain: 0.45, hit: SWORD, tell: 'glint' },
      { id: 'slash2', clip: 'light_2', damage: 18, poise: 16, weight: 0.35, knockback: 0.5, range: [0, 1.8], cooldown: 1.5, score: 0, parryable: true, track: 6, trackTime: 0.2, hit: SWORD },
      { id: 'lunge', clip: 'e_lunge', fallback: 'sprint_attack', damage: 22, poise: 20, weight: 0.45, knockback: 0.8, range: [2.4, 5.5], cooldown: 4, score: 0.8, parryable: true, track: 7, trackTime: 0.35, lunge: 1.25, hit: SWORD, tell: 'glint' },
    ],
    resist: { fire: 0.5, water: 1.4 },
  },
  cinder_knight: {
    id: 'cinder_knight', name: 'Cinder Knight', model: 'cinder_knight', weapon: 'cinder_greatsword', scale: 1,
    health: 300, poise: 95, stamina: 120, radius: 0.48, height: 2.2,
    walk: 1.3, run: 3.6, strafe: 1.2, sight: 22, fov: 2.0, hearing: 10,
    aggression: 0.55, block: 0.35, dodge: 0.0, holdRange: 3.6, heavy: true, executable: true,
    xp: 80, aether: 18, glow: [1.0, 0.38, 0.08],
    attacks: [
      { id: 'cleave', clip: 'e_overhead', fallback: 'heavy_1', speed: 0.85, damage: 42, poise: 45, weight: 0.85, knockback: 1.4, range: [0, 2.4], cooldown: 3.2, score: 1, parryable: true, track: 5, trackTime: 0.55, armour: true, impact: { radius: 1.8, ahead: 2.0, damage: 20, vfx: 'emberSlam' }, hit: SWORD, tell: 'glint' },
      { id: 'sweep', clip: 'heavy_2', speed: 0.8, damage: 36, poise: 40, weight: 0.75, knockback: 1.6, range: [0, 2.6], cooldown: 3.5, score: 0.9, parryable: false, unblockable: false, knockdown: true, track: 4, trackTime: 0.45, armour: true, hit: SWORD },
      { id: 'combo', clip: 'light_3', speed: 0.85, damage: 28, poise: 26, weight: 0.5, knockback: 0.6, range: [0, 2.2], cooldown: 2.5, score: 0.8, parryable: true, track: 6, trackTime: 0.3, next: ['combo2'], chain: 0.7, armour: true, hit: SWORD },
      { id: 'combo2', clip: 'light_4', speed: 0.85, damage: 34, poise: 34, weight: 0.65, knockback: 1.2, range: [0, 2.6], cooldown: 3, score: 0, parryable: true, track: 5, trackTime: 0.25, armour: true, hit: SWORD },
      { id: 'thrust', clip: 'e_thrust', fallback: 'sprint_attack', speed: 0.9, damage: 40, poise: 40, weight: 0.8, knockback: 1.6, range: [2.6, 6], cooldown: 6, score: 0.7, parryable: false, unblockable: true, track: 6, trackTime: 0.6, lunge: 1.5, armour: true, hit: SWORD, tell: 'red' },
    ],
    resist: { fire: 0.3, physical: 0.85, water: 1.3 },
  },
  pyre_acolyte: {
    id: 'pyre_acolyte', name: 'Pyre Acolyte', model: 'acolyte', scale: 1,
    health: 110, poise: 22, stamina: 60, radius: 0.34, height: 1.8,
    walk: 1.4, run: 4.0, strafe: 1.6, sight: 24, fov: 2.4, hearing: 10,
    aggression: 0.6, block: 0, dodge: 0.3, holdRange: 9, heavy: false, executable: true, ranged: true,
    xp: 34, aether: 10, glow: [1.0, 0.5, 0.15],
    attacks: [
      { id: 'firebolt', clip: 'cast_push', damage: 24, poise: 18, weight: 0.4, knockback: 0.6, element: 'fire', range: [3, 18], cooldown: 2.6, score: 1, parryable: false, track: 8, trackTime: 0.5, projectile: 'firebolt', hit: { kind: 'none' }, status: { burn: 30 } },
      { id: 'pyre', clip: 'cast_slam', damage: 34, poise: 30, weight: 0.6, knockback: 1.2, element: 'fire', range: [4, 16], cooldown: 7, score: 0.7, parryable: false, knockdown: true, track: 4, trackTime: 0.4, eruption: { radius: 2.2, delay: 1.1, vfx: 'firePillar' }, hit: { kind: 'none' }, status: { burn: 45 } },
      { id: 'shove', clip: 'cast_arc', damage: 10, poise: 30, weight: 0.4, knockback: 2.4, element: 'fire', range: [0, 2.2], cooldown: 5, score: 1.2, parryable: false, track: 8, trackTime: 0.3, impact: { radius: 2.6, ahead: 0.6, vfx: 'fireBurst' }, hit: { kind: 'none' } },
    ],
    resist: { fire: 0.2, water: 1.5 },
  },
};

export function archetype(id: string): EnemyArchetype {
  const a = ARCHETYPES[id];
  if (!a) throw new Error(`unknown enemy ${id}`);
  return a;
}
