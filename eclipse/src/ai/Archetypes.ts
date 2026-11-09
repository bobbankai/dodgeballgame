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
  eruption?: { radius: number; delay: number; vfx: string; color?: [number, number, number, number]; scorch?: boolean; zone?: number };
  hit?: HitShape;
  /** Super armour through the swing (light hits do not interrupt). */
  armour?: boolean;
  /** Visual tell before the swing: a glint (parryable) or a red flare (unblockable). */
  tell?: 'glint' | 'red';
  /** Status build-up applied with each hit. */
  status?: { burn?: number; soak?: number; shock?: number; root?: number };
  /** Casts a protective ward (shield hit points) on the most wounded ally in range at `release`. */
  ward?: { amount: number; range: number };
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
  /** Sound for alerts and staggers (defaults by size: thrall groan, knight effort, giant roar). */
  voice?: string;
  /** How it leaves the world: particles, the dissolve edge colour and a sound (default: ash). */
  death?: { vfx?: string; color?: [number, number, number]; sound?: string };
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

const SPEAR: HitShape = { kind: 'weapon' };
/** The drowned come apart into brine and sea-glow rather than ash. */
const BRINE = { vfx: 'deathBrine', color: [0.2, 0.85, 1.0] as [number, number, number], sound: 'brine_dissolve' };

/** Chapter Two, the Drowned Empire: Thaloryn's drowned legions. */
Object.assign(ARCHETYPES, {
  reaver: {
    id: 'reaver', name: 'Drowned Reaver', model: 'reaver', weapon: 'reaver_spear', scale: 1,
    health: 140, poise: 45, stamina: 90, radius: 0.38, height: 1.95,
    walk: 1.5, run: 4.6, strafe: 1.6, sight: 20, fov: 2.2, hearing: 10,
    aggression: 0.7, block: 0.12, dodge: 0.18, holdRange: 3.8, heavy: false, executable: true,
    xp: 45, aether: 9, voice: 'drowned_groan', death: BRINE,
    attacks: [
      { id: 'jab', clip: 'riposte', speed: 1.1, damage: 20, poise: 16, weight: 0.35, knockback: 0.5, range: [0.5, 2.8], cooldown: 1.4, score: 1, parryable: true, track: 9, trackTime: 0.25, next: ['jab2'], chain: 0.5, hit: SPEAR, tell: 'glint', status: { soak: 20 } },
      { id: 'jab2', clip: 'riposte', speed: 1.2, damage: 22, poise: 18, weight: 0.4, knockback: 0.7, range: [0.5, 3.0], cooldown: 2, score: 0, parryable: true, track: 7, trackTime: 0.2, hit: SPEAR, status: { soak: 20 } },
      { id: 'lunge', clip: 'e_lunge', fallback: 'sprint_attack', damage: 28, poise: 26, weight: 0.55, knockback: 1.0, range: [3, 7.5], cooldown: 4, score: 0.9, parryable: true, track: 7, trackTime: 0.35, lunge: 1.2, hit: SPEAR, tell: 'glint' },
      { id: 'sweep', clip: 'heavy_2', speed: 0.9, damage: 26, poise: 34, weight: 0.65, knockback: 1.4, range: [0, 2.6], cooldown: 5, score: 0.7, parryable: false, knockdown: true, track: 5, trackTime: 0.35, armour: true, hit: SPEAR, tell: 'red' },
    ],
    resist: { water: 0.4, lightning: 1.5, fire: 1.1 },
  },
  tidecaller: {
    id: 'tidecaller', name: 'Tidecaller', model: 'tidecaller', scale: 1,
    health: 100, poise: 22, stamina: 60, radius: 0.34, height: 1.8,
    walk: 1.4, run: 4.0, strafe: 1.6, sight: 24, fov: 2.4, hearing: 10,
    aggression: 0.55, block: 0, dodge: 0.3, holdRange: 10, heavy: false, executable: true, ranged: true,
    xp: 40, aether: 10, voice: 'drowned_groan', death: BRINE,
    attacks: [
      { id: 'orb', clip: 'cast_push', damage: 20, poise: 16, weight: 0.35, knockback: 0.8, element: 'water', range: [3, 18], cooldown: 2.4, score: 1, parryable: false, track: 8, trackTime: 0.5, projectile: 'waterOrb', hit: { kind: 'none' }, status: { soak: 35 } },
      { id: 'ward', clip: 'cast_heal', damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 30], cooldown: 9, score: 1.3, parryable: false, track: 2, trackTime: 0.2, hit: { kind: 'none' }, ward: { amount: 90, range: 14 } },
      { id: 'surge', clip: 'cast_arc', damage: 12, poise: 30, weight: 0.4, knockback: 3, element: 'water', range: [0, 2.4], cooldown: 5, score: 1.2, parryable: false, track: 8, trackTime: 0.3, impact: { radius: 2.8, ahead: 0.5, vfx: 'splash' }, hit: { kind: 'none' } },
    ],
    resist: { water: 0.2, lightning: 1.6 },
  },
} satisfies Record<string, EnemyArchetype>);

const GLAIVE: HitShape = { kind: 'weapon' };
/** The storm-touched burn out into motes of lightning. */
const STORMLIT = { vfx: 'deathStorm', color: [0.7, 0.65, 1.0] as [number, number, number], sound: 'storm_dissolve' };
const STRIKE = { radius: 1.6, delay: 1.0, vfx: 'lightningStrike', color: [0.65, 0.6, 1, 4] as [number, number, number, number], scorch: false, zone: 0 };

/** Chapter Three, the Shattered Sky: Vaeltris's storm-bound monks and their wardens. */
Object.assign(ARCHETYPES, {
  monk: {
    id: 'monk', name: 'Stormbound Monk', model: 'monk', weapon: 'storm_glaive', scale: 1,
    health: 130, poise: 34, stamina: 110, radius: 0.36, height: 1.85,
    walk: 1.6, run: 5.0, strafe: 2.2, sight: 22, fov: 2.4, hearing: 12,
    aggression: 0.75, block: 0.1, dodge: 0.38, holdRange: 3.6, heavy: false, executable: true,
    xp: 55, aether: 10, voice: 'monk_kiai', death: STORMLIT,
    attacks: [
      { id: 'cut', clip: 'light_1', speed: 1.15, damage: 18, poise: 14, weight: 0.32, knockback: 0.5, element: 'lightning', range: [0, 2.8], cooldown: 1.2, score: 1, parryable: true, track: 9, trackTime: 0.25, next: ['cut2'], chain: 0.6, hit: GLAIVE, tell: 'glint', status: { shock: 18 } },
      { id: 'cut2', clip: 'light_2', speed: 1.2, damage: 18, poise: 14, weight: 0.32, knockback: 0.5, element: 'lightning', range: [0, 3.0], cooldown: 1.4, score: 0, parryable: true, track: 7, trackTime: 0.2, next: ['spin'], chain: 0.45, hit: GLAIVE, status: { shock: 18 } },
      { id: 'spin', clip: 'light_3', speed: 1.1, damage: 24, poise: 22, weight: 0.45, knockback: 1.2, element: 'lightning', range: [0, 3.2], cooldown: 3, score: 0, parryable: false, track: 4, trackTime: 0.2, hit: GLAIVE, tell: 'red', status: { shock: 30 } },
      { id: 'vault', clip: 'sprint_attack', speed: 1.05, damage: 26, poise: 26, weight: 0.5, knockback: 1.0, element: 'lightning', range: [3, 8], cooldown: 4, score: 0.9, parryable: true, track: 7, trackTime: 0.35, lunge: 1.3, hit: GLAIVE, tell: 'glint', status: { shock: 25 } },
    ],
    resist: { lightning: 0.3, water: 1.3, fire: 1.0 },
  },
  warden: {
    id: 'warden', name: 'Tempest Warden', model: 'warden', scale: 1.05,
    health: 115, poise: 26, stamina: 60, radius: 0.36, height: 1.95,
    walk: 1.3, run: 3.8, strafe: 1.5, sight: 28, fov: 2.4, hearing: 12,
    aggression: 0.5, block: 0, dodge: 0.2, holdRange: 12, heavy: false, executable: true, ranged: true,
    xp: 50, aether: 12, voice: 'monk_kiai', death: STORMLIT,
    attacks: [
      { id: 'bolt', clip: 'cast_push', damage: 22, poise: 16, weight: 0.35, knockback: 0.6, element: 'lightning', range: [3, 22], cooldown: 2.2, score: 1, parryable: false, track: 8, trackTime: 0.45, projectile: 'stormBolt', hit: { kind: 'none' }, status: { shock: 30 } },
      { id: 'strike', clip: 'cast_slam', damage: 30, poise: 30, weight: 0.5, knockback: 1.2, element: 'lightning', range: [4, 20], cooldown: 5.5, score: 1.2, parryable: false, unblockable: true, track: 3, trackTime: 0.3, eruption: STRIKE, hit: { kind: 'none' }, tell: 'red', status: { shock: 45 } },
      { id: 'ward', clip: 'cast_heal', damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 30], cooldown: 10, score: 1.1, parryable: false, track: 2, trackTime: 0.2, hit: { kind: 'none' }, ward: { amount: 80, range: 14 } },
    ],
    resist: { lightning: 0.2, water: 1.4 },
  },
} satisfies Record<string, EnemyArchetype>);

const MAUL: HitShape = { kind: 'weapon' };
/** The forest's own fall apart into petals, leaves and sap-light. */
const BLOSSOM = { vfx: 'deathBloom', color: [0.75, 1.0, 0.35] as [number, number, number], sound: 'bloom_dissolve' };
const ROOTS = { radius: 1.8, delay: 1.1, vfx: 'rootBurst', color: [0.55, 0.9, 0.25, 3] as [number, number, number, number], scorch: false, zone: 0 };

/** Chapter Four, the Forgotten Sanctuary: Sylvaris's overgrown pilgrims and her keepers. */
Object.assign(ARCHETYPES, {
  thornbound: {
    id: 'thornbound', name: 'Thornbound', model: 'thornbound', weapon: 'thorn_maul', scale: 1.1,
    health: 210, poise: 70, stamina: 120, radius: 0.42, height: 2.0,
    walk: 1.2, run: 3.6, strafe: 1.2, sight: 18, fov: 2.2, hearing: 10,
    aggression: 0.7, block: 0, dodge: 0, holdRange: 3.0, heavy: true, executable: true,
    xp: 70, aether: 12, voice: 'thorn_groan', death: BLOSSOM,
    loco: { walk: 'e_shamble' },
    attacks: [
      { id: 'smash', clip: 'e_overhead', fallback: 'heavy_1', speed: 0.85, damage: 34, poise: 40, weight: 0.75, knockback: 1.6, element: 'life', range: [0, 2.6], cooldown: 2.6, score: 1, parryable: true, track: 6, trackTime: 0.4, armour: true, hit: MAUL, tell: 'glint', status: { root: 30 } },
      { id: 'swing', clip: 'heavy_2', speed: 0.85, damage: 30, poise: 34, weight: 0.65, knockback: 2.0, range: [0, 2.8], cooldown: 3.2, score: 0.9, parryable: false, knockdown: true, track: 4, trackTime: 0.35, armour: true, hit: MAUL, tell: 'red' },
      { id: 'roots', clip: 'cast_slam', speed: 0.9, damage: 26, poise: 30, weight: 0.5, knockback: 0.6, element: 'life', range: [3, 12], cooldown: 7, score: 1.1, parryable: false, unblockable: true, track: 3, trackTime: 0.3, armour: true, eruption: ROOTS, hit: { kind: 'none' }, tell: 'red', status: { root: 70 } },
    ],
    resist: { fire: 1.6, life: 0.3, lightning: 0.8, physical: 0.85 },
  },
  bloomcaller: {
    id: 'bloomcaller', name: 'Bloomcaller', model: 'bloomcaller', scale: 1,
    health: 95, poise: 20, stamina: 60, radius: 0.34, height: 1.8,
    walk: 1.4, run: 4.2, strafe: 1.7, sight: 26, fov: 2.4, hearing: 12,
    aggression: 0.5, block: 0, dodge: 0.32, holdRange: 11, heavy: false, executable: true, ranged: true,
    xp: 48, aether: 12, voice: 'bloom_sigh', death: BLOSSOM,
    attacks: [
      { id: 'spore', clip: 'cast_push', damage: 18, poise: 12, weight: 0.3, knockback: 0.5, element: 'life', range: [3, 18], cooldown: 2.4, score: 1, parryable: false, track: 7, trackTime: 0.45, projectile: 'sporePod', hit: { kind: 'none' }, status: { root: 25 } },
      { id: 'bloom', clip: 'cast_heal', damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 30], cooldown: 9, score: 1.3, parryable: false, track: 2, trackTime: 0.2, hit: { kind: 'none' }, ward: { amount: 100, range: 14 } },
      { id: 'grasp', clip: 'cast_slam', damage: 22, poise: 26, weight: 0.45, knockback: 0.4, element: 'life', range: [4, 16], cooldown: 6, score: 1.1, parryable: false, unblockable: true, track: 3, trackTime: 0.3, eruption: ROOTS, hit: { kind: 'none' }, tell: 'red', status: { root: 70 } },
    ],
    resist: { fire: 1.5, life: 0.2 },
  },
} satisfies Record<string, EnemyArchetype>);

export function archetype(id: string): EnemyArchetype {
  const a = ARCHETYPES[id];
  if (!a) throw new Error(`unknown enemy ${id}`);
  return a;
}
