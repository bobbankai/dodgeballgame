// Attack data. Times are seconds into the attack's clip (scaled by `speed`).
export interface ProjectileDef {
  speed: number; damage: number; radius: number; life: number; vfx: string; gravity?: number; knock?: number;
  parryable?: boolean; homing?: number;
}

export interface AttackDef {
  id: string;
  clip: string;
  speed?: number;
  hit: number[];                 // hit frame times
  damage: number;
  reach: number;                 // metres from the attacker's centre
  arc: number;                   // half-angle in degrees (180 = all round)
  height?: [number, number];     // vertical band (relative to attacker feet)
  knock: number;                 // knockback speed (m/s)
  launch?: number;               // upward speed on hit
  stagger: number;               // hit-stun seconds
  hitstop: number;
  shake: number;
  lunge?: number;                // forward travel during lungeTime
  lungeTime?: [number, number];
  combo?: number;                // from this time the next combo input is accepted
  end?: number;                  // attack ends (default: clip length)
  unblockable?: boolean;
  knockdown?: boolean;
  armor?: boolean;               // attacker can't be interrupted
  vfx?: string;
  sfx?: string;
  meter?: number;                // storm gained on hit
  cost?: number;                 // storm spent
  aoe?: boolean;
  impact?: boolean;              // impact frame (inverted flash) on hit
  telegraph?: number;            // seconds of red warning before the first hit (enemy attacks)
  projectile?: ProjectileDef;
  air?: boolean;                 // usable / used in the air
  iframes?: [number, number];
  spin?: number;                 // degrees the attacker rotates over the attack (visual root spin)
}

const A = (d: AttackDef) => d;

// ------------------------------------------------------------------------------------------------ Kai
export const KAI = {
  jab: A({ id: 'jab', clip: 'jab', hit: [0.12], damage: 6, reach: 1.7, arc: 55, knock: 1.5, stagger: 0.35, hitstop: 0.05, shake: 0.12, combo: 0.16, end: 0.34, lunge: 0.35, lungeTime: [0.05, 0.13], vfx: 'punch', sfx: 'punch', meter: 3 }),
  cross: A({ id: 'cross', clip: 'cross', hit: [0.14], damage: 8, reach: 1.8, arc: 55, knock: 2.2, stagger: 0.4, hitstop: 0.06, shake: 0.16, combo: 0.2, end: 0.4, lunge: 0.45, lungeTime: [0.06, 0.15], vfx: 'punch', sfx: 'punch', meter: 3 }),
  backfist: A({ id: 'backfist', clip: 'backfist', hit: [0.29], damage: 10, reach: 2.0, arc: 120, knock: 3, stagger: 0.45, hitstop: 0.07, shake: 0.2, combo: 0.34, end: 0.56, lunge: 0.3, lungeTime: [0.15, 0.3], vfx: 'swipe', sfx: 'whoosh_hit', meter: 4 }),
  windkick: A({ id: 'windkick', clip: 'windkick', hit: [0.25], damage: 18, reach: 2.5, arc: 80, knock: 9, stagger: 0.7, hitstop: 0.11, shake: 0.42, end: 0.72, lunge: 0.5, lungeTime: [0.1, 0.26], knockdown: true, vfx: 'gale', sfx: 'heavy_hit', meter: 6, impact: true }),
  gale_hammer: A({ id: 'gale_hammer', clip: 'gale_hammer', hit: [0.32], damage: 16, reach: 1.9, arc: 60, knock: 1, launch: 9.5, stagger: 0.9, hitstop: 0.1, shake: 0.35, end: 0.66, lunge: 0.4, lungeTime: [0.2, 0.33], vfx: 'uppercut', sfx: 'heavy_hit', meter: 5, impact: true }),
  charged: A({ id: 'charged', clip: 'gale_hammer', hit: [0.32], damage: 34, reach: 2.4, arc: 90, knock: 4, launch: 12, stagger: 1.2, hitstop: 0.14, shake: 0.6, end: 0.7, lunge: 0.8, lungeTime: [0.2, 0.33], vfx: 'uppercut_big', sfx: 'heavy_hit', meter: 8, impact: true, armor: true }),
  air_attack: A({ id: 'air_attack', clip: 'air_attack', hit: [0.3], damage: 14, reach: 2.0, arc: 80, height: [-2.5, 1.5], knock: 2, launch: -14, stagger: 0.8, hitstop: 0.09, shake: 0.35, end: 0.5, knockdown: true, vfx: 'gale', sfx: 'heavy_hit', meter: 5, air: true }),
  air_jab: A({ id: 'air_jab', clip: 'jab', hit: [0.12], damage: 7, reach: 1.9, arc: 70, height: [-1.5, 1.5], knock: 1, launch: 3.2, stagger: 0.5, hitstop: 0.06, shake: 0.12, combo: 0.18, end: 0.32, vfx: 'punch', sfx: 'punch', meter: 3, air: true }),
  gale_burst: A({ id: 'gale_burst', clip: 'gale_burst', hit: [0.35], damage: 20, reach: 4.2, arc: 180, knock: 12, stagger: 1.0, hitstop: 0.12, shake: 0.55, end: 0.8, aoe: true, knockdown: true, unblockable: true, vfx: 'burst', sfx: 'wind_blast', cost: 30, impact: true, iframes: [0.0, 0.4] }),
  tempest_dash: A({ id: 'tempest_dash', clip: 'tempest_dash', hit: [0.2, 0.28, 0.36], damage: 9, reach: 2.2, arc: 60, knock: 6, stagger: 0.6, hitstop: 0.06, shake: 0.3, end: 0.7, lunge: 7.5, lungeTime: [0.16, 0.42], vfx: 'dash', sfx: 'dash_hit', cost: 30, iframes: [0.1, 0.45], knockdown: true }),
  hurricane: A({ id: 'hurricane', clip: 'hurricane', hit: [0.75, 0.85, 0.95, 1.05, 1.15], damage: 14, reach: 4.5, arc: 180, knock: 5, launch: 6, stagger: 1.2, hitstop: 0.08, shake: 0.5, end: 1.75, aoe: true, unblockable: true, vfx: 'hurricane', sfx: 'hurricane', cost: 100, impact: true, iframes: [0, 1.6], armor: true, knockdown: true }),
};

export const KAI_COMBO = ['jab', 'cross', 'backfist', 'windkick'] as const;

// ------------------------------------------------------------------------------------------------ enemies
export const ENEMY = {
  slash1: A({ id: 'slash1', clip: 'slash1', hit: [0.36], damage: 9, reach: 2.1, arc: 60, knock: 3, stagger: 0.45, hitstop: 0.06, shake: 0.2, telegraph: 0.3, lunge: 0.5, lungeTime: [0.25, 0.38], vfx: 'slash', sfx: 'blade' }),
  slash2: A({ id: 'slash2', clip: 'slash2', hit: [0.4], damage: 10, reach: 2.3, arc: 90, knock: 3.5, stagger: 0.45, hitstop: 0.06, shake: 0.22, telegraph: 0.32, vfx: 'slash', sfx: 'blade' }),
  thrust: A({ id: 'thrust', clip: 'thrust', hit: [0.33], damage: 11, reach: 2.8, arc: 30, knock: 4, stagger: 0.5, hitstop: 0.07, shake: 0.22, telegraph: 0.28, lunge: 1.2, lungeTime: [0.22, 0.35], vfx: 'thrust', sfx: 'blade' }),
  punch: A({ id: 'punch', clip: 'jab', hit: [0.12], damage: 6, reach: 1.6, arc: 50, knock: 2, stagger: 0.35, hitstop: 0.05, shake: 0.12, telegraph: 0.25, vfx: 'punch', sfx: 'punch' }),
  hook: A({ id: 'hook', clip: 'cross', hit: [0.14], damage: 8, reach: 1.7, arc: 60, knock: 2.5, stagger: 0.4, hitstop: 0.06, shake: 0.15, telegraph: 0.28, vfx: 'punch', sfx: 'punch' }),
  bash: A({ id: 'bash', clip: 'shield_bash', hit: [0.42], damage: 14, reach: 2.4, arc: 50, knock: 9, stagger: 0.8, hitstop: 0.1, shake: 0.4, telegraph: 0.45, unblockable: true, knockdown: true, lunge: 1.6, lungeTime: [0.3, 0.45], vfx: 'shock', sfx: 'heavy_hit', armor: true }),
  smash: A({ id: 'smash', clip: 'overhead', hit: [0.7], damage: 18, reach: 2.8, arc: 50, knock: 6, stagger: 0.8, hitstop: 0.12, shake: 0.55, telegraph: 0.6, knockdown: true, vfx: 'shock', sfx: 'slam', armor: true }),
  shoot: A({ id: 'shoot', clip: 'shoot', hit: [0.04], damage: 0, reach: 0, arc: 0, knock: 0, stagger: 0, hitstop: 0, shake: 0.05, telegraph: 0.9,
    projectile: { speed: 26, damage: 10, radius: 0.25, life: 1.6, vfx: 'bullet', knock: 3, parryable: true } }),
  // bosses
  sweep: A({ id: 'sweep', clip: 'sweep', hit: [0.62], damage: 16, reach: 3.6, arc: 120, knock: 8, stagger: 0.7, hitstop: 0.1, shake: 0.45, telegraph: 0.45, knockdown: true, vfx: 'slash_big', sfx: 'blade_heavy', armor: true }),
  lance: A({ id: 'lance', clip: 'thrust', hit: [0.33], damage: 15, reach: 4.2, arc: 25, knock: 7, stagger: 0.6, hitstop: 0.09, shake: 0.35, telegraph: 0.4, lunge: 4, lungeTime: [0.2, 0.36], vfx: 'thrust', sfx: 'blade_heavy', armor: true }),
  cleave: A({ id: 'cleave', clip: 'overhead', hit: [0.7], damage: 22, reach: 3.4, arc: 40, knock: 6, stagger: 0.9, hitstop: 0.13, shake: 0.6, telegraph: 0.55, knockdown: true, unblockable: true, vfx: 'shock_big', sfx: 'slam', armor: true }),
  chain: A({ id: 'chain', clip: 'throw', hit: [0.4], damage: 12, reach: 7, arc: 20, knock: -8, stagger: 0.7, hitstop: 0.08, shake: 0.3, telegraph: 0.5, vfx: 'chain', sfx: 'chain', armor: true }),
  stomp: A({ id: 'stomp', clip: 'overhead', hit: [0.7], damage: 20, reach: 5, arc: 180, aoe: true, knock: 9, stagger: 0.8, hitstop: 0.12, shake: 0.7, telegraph: 0.7, knockdown: true, unblockable: true, vfx: 'shock_big', sfx: 'slam', armor: true }),
  saber1: A({ id: 'saber1', clip: 'slash1', speed: 1.35, hit: [0.36], damage: 12, reach: 2.5, arc: 70, knock: 3, stagger: 0.45, hitstop: 0.07, shake: 0.25, telegraph: 0.18, lunge: 1.2, lungeTime: [0.2, 0.36], vfx: 'slash', sfx: 'blade' }),
  saber2: A({ id: 'saber2', clip: 'slash2', speed: 1.35, hit: [0.4], damage: 12, reach: 2.6, arc: 100, knock: 4, stagger: 0.45, hitstop: 0.07, shake: 0.25, telegraph: 0.18, vfx: 'slash', sfx: 'blade' }),
  saber3: A({ id: 'saber3', clip: 'thrust', speed: 1.3, hit: [0.33], damage: 15, reach: 3.6, arc: 25, knock: 7, stagger: 0.6, hitstop: 0.1, shake: 0.35, telegraph: 0.22, lunge: 3.5, lungeTime: [0.2, 0.35], vfx: 'thrust', sfx: 'blade_heavy', knockdown: true }),
};
