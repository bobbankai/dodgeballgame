// Enemy archetypes. Attack clips come from assets/anims/human.json (shared rig).
import type { EnemyDef } from '../game/Enemy';

const M = (name: string) => `assets/chars/${name}.glb`;

export const FOOTMAN: EnemyDef = {
  id: 'footman', name: 'Hollow Footman', model: M('hollow_footman'), weapon: 'machete', hp: 55, poise: 28, walk: 1.5, run: 3.4,
  idle: 'e_idle', move: ['walk', 'run'], aggression: 0.55, block: 0.2, skill: 0.35, flank: 0.5, caution: 0.35, spacing: 2.4, glow: [2.2, 0.7, 0.25],
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', blockClip: 'block_hit', evade: { back: 'dodge_back' },
  attacks: [
    { clip: 'e_slash', range: [0, 2.3], damage: 12, poise: 15, cooldown: 2.2, track: 5, chain: 'e_slash_b' },
    { clip: 'e_slash_b', range: [0, 2.2], damage: 12, poise: 15, cooldown: 3.5, weight: 0, track: 4 },
    { clip: 'e_thrust', range: [1.6, 3.6], damage: 15, poise: 20, cooldown: 4, track: 3, weight: 0.8 },
  ],
};

export const SPEARMAN: EnemyDef = {
  id: 'spearman', name: 'Hollow Pikeman', model: M('hollow_spearman'), weapon: 'estoc', hp: 65, poise: 34, walk: 1.4, run: 3.2,
  idle: 'e_idle', move: ['walk', 'run'], aggression: 0.5, block: 0.15, skill: 0.45, flank: 0.3, caution: 0.5, spacing: 3.2, glow: [2.2, 0.7, 0.25],
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', blockClip: 'block_hit', evade: { back: 'dodge_back', left: 'dodge_left', right: 'dodge_right' },
  attacks: [
    { clip: 'e_thrust', range: [1.8, 4.2], damage: 16, poise: 22, cooldown: 2.4, track: 3 },
    { clip: 'e_sweep', range: [0, 2.8], damage: 14, poise: 25, cooldown: 4, track: 4 },
    { clip: 'e_lunge', range: [3.5, 6.5], damage: 20, poise: 30, cooldown: 6, track: 2, unblockable: true, weight: 0.6 },
  ],
};

export const BRUTE: EnemyDef = {
  id: 'brute', name: 'Hollow Brute', model: M('hollow_brute'), weapon: 'warhammer', scale: 1.22, hp: 160, poise: 80, damage: 1.2, walk: 1.2, run: 2.8,
  idle: 'b_idle', move: ['walk', 'run'], aggression: 0.45, skill: 0.15, flank: 0.1, caution: 0, spacing: 2.8, superArmor: 0.7, radius: 0.5, glow: [2.6, 0.6, 0.15],
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death', roar: 'b_roar',
  attacks: [
    { clip: 'b_slam', range: [0, 3.0], damage: 30, poise: 50, heavy: true, knock: 1, cooldown: 4, track: 2.2, guardBreak: 2 },
    { clip: 'b_sweep', range: [0, 3.2], damage: 24, poise: 40, heavy: true, cooldown: 4.5, track: 3, guardBreak: 1.6 },
    { clip: 'b_charge', range: [4, 9], damage: 28, poise: 50, heavy: true, knock: 1, unblockable: true, cooldown: 9, track: 1.5, weight: 0.5 },
  ],
};

/** Chapter One boss: Gorran the Ashen. A huge brute with a war hammer; below half health he rages
 * (phase 2 unlocks the charge and a double slam, and his cracks burn hotter). */
export const GORRAN: EnemyDef = {
  id: 'gorran', name: 'Gorran the Ashen', model: M('hollow_brute'), weapon: 'warhammer', scale: 1.42, hp: 620, poise: 160, damage: 1.25,
  walk: 1.3, run: 3.4, idle: 'b_idle', move: ['walk', 'run'], aggression: 0.6, skill: 0.35, flank: 0, caution: 0, spacing: 3.2,
  boss: true, superArmor: 0.85, radius: 0.62, glow: [3.2, 0.8, 0.18],
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death', roar: 'b_roar',
  attacks: [
    { clip: 'b_slam', range: [0, 3.4], damage: 30, poise: 55, heavy: true, knock: 1, cooldown: 3.4, track: 2.4, guardBreak: 2 },
    { clip: 'b_sweep', range: [0, 3.6], damage: 24, poise: 45, heavy: true, cooldown: 3.8, track: 3, guardBreak: 1.6, chain: 'b_slam' },
    { clip: 'b_charge', range: [4.5, 11], damage: 30, poise: 60, heavy: true, knock: 1, unblockable: true, cooldown: 7, track: 1.6, weight: 0.8, phase: 0.55 },
    { clip: 'b_slam', range: [0, 3.4], damage: 34, poise: 60, heavy: true, knock: 1, cooldown: 5, track: 2.6, guardBreak: 2.4, chain: 'b_sweep', phase: 0.5, aoe: 3.2 },
  ],
};

/** Chapter Two boss: Hisame of the Drowned Bell. The shrine maiden, Hollowed by grief: fast, evasive,
 * lunging; at half health she rings the bell, the rain hardens and the wraiths answer. */
export const HISAME: EnemyDef = {
  id: 'hisame', name: 'Hisame of the Drowned Bell', model: M('hisame_hollow'), weapon: 'saber', hp: 560, poise: 90, damage: 1.1,
  walk: 2.0, run: 5.2, idle: 'w_idle', move: ['walk', 'sprint'], aggression: 0.7, skill: 0.85, flank: 0.6, caution: 0.4, spacing: 3.6,
  boss: true, superArmor: 0.3, glow: [0.5, 1.3, 3.2], roar: 'b_roar',
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', evade: { back: 'dodge_back', left: 'dodge_left', right: 'dodge_right' },
  attacks: [
    { clip: 'w_dash', range: [2.5, 8], damage: 18, poise: 22, cooldown: 2.6, track: 1.2 },
    { clip: 'w_flurry', range: [0, 2.4], damage: 11, poise: 12, cooldown: 2.4, track: 6, chain: 'e_sweep' },
    { clip: 'e_sweep', range: [0, 3.0], damage: 16, poise: 25, cooldown: 3.2, track: 4, weight: 0.7 },
    { clip: 'e_lunge', range: [3.5, 7.5], damage: 24, poise: 34, cooldown: 5, track: 2, unblockable: true, weight: 0.7, phase: 0.55 },
  ],
};

/** Chapter Three boss: the Frost Warden, an ice-crusted giant guarding the pass */
export const FROST_WARDEN: EnemyDef = {
  id: 'warden', name: 'The Frost Warden', model: M('hollow_brute'), weapon: 'warhammer', scale: 1.62, hp: 780, poise: 200, damage: 1.35,
  walk: 1.15, run: 3.0, idle: 'b_idle', move: ['walk', 'run'], aggression: 0.55, skill: 0.4, flank: 0, caution: 0, spacing: 3.6,
  boss: true, superArmor: 0.9, radius: 0.7, glow: [0.6, 1.5, 3.4], roar: 'b_roar',
  resist: { fire: 1.4, frost: 0.2 }, statusResist: { frost: 0, burn: 1.5 },
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death',
  attacks: [
    { clip: 'b_slam', range: [0, 3.8], damage: 34, poise: 60, heavy: true, knock: 1, cooldown: 3.6, track: 2.2, guardBreak: 2.2, aoe: 3.6 },
    { clip: 'b_sweep', range: [0, 4.0], damage: 26, poise: 48, heavy: true, cooldown: 3.8, track: 2.8, guardBreak: 1.8, chain: 'b_slam' },
    { clip: 'b_charge', range: [5, 12], damage: 32, poise: 60, heavy: true, knock: 1, unblockable: true, cooldown: 7.5, track: 1.4, weight: 0.7 },
    { clip: 'b_slam', range: [0, 4.2], damage: 38, poise: 70, heavy: true, knock: 1, cooldown: 4.5, track: 2.6, guardBreak: 2.6, chain: 'b_sweep', phase: 0.5, aoe: 4.5 },
  ],
};

/** Chapter Four boss: the Forgemother, armoured smith of the Heart Forge. Slow, enormous hammer blows that
 * leave the ground burning; at half health she pours the black fire into her armour and the forge's
 * smiths come to her (phase 2: charges, a double slam and a wider shockwave). */
export const FORGEMOTHER: EnemyDef = {
  id: 'forgemother', name: 'The Forgemother', model: M('forgemother'), weapon: 'warhammer', scale: 1.3, hp: 900, poise: 230, damage: 1.4,
  walk: 1.25, run: 3.3, idle: 'b_idle', move: ['walk', 'run'], aggression: 0.6, skill: 0.5, flank: 0, caution: 0, spacing: 3.4,
  boss: true, superArmor: 0.9, radius: 0.6, glow: [3.6, 1.1, 0.22], roar: 'b_roar',
  resist: { fire: 0.35, slash: 0.85 }, statusResist: { burn: 0.2, bleed: 0.6 },
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death',
  attacks: [
    { clip: 'b_slam', range: [0, 3.6], damage: 32, poise: 60, heavy: true, knock: 1, cooldown: 3.2, track: 2.4, guardBreak: 2.2, aoe: 3.4 },
    { clip: 'b_sweep', range: [0, 3.8], damage: 26, poise: 48, heavy: true, cooldown: 3.6, track: 3, guardBreak: 1.8, chain: 'b_slam' },
    { clip: 'e_thrust', range: [2.0, 4.6], damage: 22, poise: 35, cooldown: 4.2, track: 3, weight: 0.6 },
    { clip: 'b_charge', range: [5, 12], damage: 34, poise: 60, heavy: true, knock: 1, unblockable: true, cooldown: 6.5, track: 1.5, weight: 0.8, phase: 0.55 },
    { clip: 'b_slam', range: [0, 4.4], damage: 38, poise: 70, heavy: true, knock: 1, cooldown: 4.2, track: 2.6, guardBreak: 2.6, chain: 'b_sweep', phase: 0.5, aoe: 5.0 },
  ],
};

/** a Hollow smith: a footman with a forging hammer, found working at the anvils */
export const SMITH: EnemyDef = {
  ...FOOTMAN, id: 'smith', name: 'Hollow Smith', weapon: 'warhammer', hp: 80, poise: 40, damage: 1.1, walk: 1.3, run: 3.0, aggression: 0.5, block: 0.1, glow: [2.8, 0.8, 0.2],
  attacks: [
    { clip: 'b_slam', range: [0, 2.6], damage: 20, poise: 30, heavy: true, cooldown: 3.4, track: 2.5, guardBreak: 1.6 },
    { clip: 'e_slash', range: [0, 2.3], damage: 13, poise: 16, cooldown: 2.4, track: 5, chain: 'e_slash_b' },
    { clip: 'e_slash_b', range: [0, 2.2], damage: 13, poise: 16, cooldown: 3.5, weight: 0, track: 4 },
  ],
};

/** Chapter Five: Ren, possessed. He fights like his sister taught him, too fast and guarding everything; the
 * duel is won by breaking his guard. He cannot be killed: beaten down to a fifth of his health, he yields. */
export const REN_HOLLOW: EnemyDef = {
  id: 'ren', name: 'Ren, Possessed', model: M('ren'), weapon: 'katana', hp: 420, poise: 70, damage: 0.9, minHp: 0.2,
  walk: 2.0, run: 5.0, idle: 'w_idle', move: ['walk', 'sprint'], aggression: 0.65, block: 0.55, skill: 0.85, flank: 0.7, caution: 0.35, spacing: 3.0,
  boss: true, superArmor: 0.1, glow: [1.6, 0.25, 1.1], roar: 'b_roar',
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', blockClip: 'block_hit', evade: { back: 'dodge_back', left: 'dodge_left', right: 'dodge_right' },
  attacks: [
    { clip: 'e_slash', range: [0, 2.3], damage: 12, poise: 14, cooldown: 1.8, track: 6, chain: 'e_slash_b' },
    { clip: 'e_slash_b', range: [0, 2.2], damage: 12, poise: 14, cooldown: 2.8, weight: 0, track: 5, chain: 'e_thrust' },
    { clip: 'e_thrust', range: [1.6, 3.8], damage: 15, poise: 20, cooldown: 3.2, track: 3, weight: 0.6 },
    { clip: 'w_dash', range: [2.5, 7.5], damage: 16, poise: 18, cooldown: 3.0, track: 1.2 },
    { clip: 'w_flurry', range: [0, 2.2], damage: 9, poise: 9, cooldown: 3.4, track: 6, phase: 0.6 },
  ],
};

/** The final boss: Lord Soen, the Hollow King. A swordmaster in black lacquer; at half health he takes the
 * black flame into himself, grows, and adds hammer-heavy shockwaves and charges to his blade-work. */
export const HOLLOW_KING: EnemyDef = {
  id: 'king', name: 'Soen, the Hollow King', model: M('hollow_king'), weapon: 'katana', scale: 1.14, hp: 1250, poise: 260, damage: 1.45,
  walk: 1.6, run: 4.4, idle: 'e_idle', move: ['walk', 'run'], aggression: 0.7, block: 0.3, skill: 0.9, flank: 0.3, caution: 0.15, spacing: 3.4,
  boss: true, superArmor: 0.6, radius: 0.5, glow: [3.2, 2.5, 1.2], roar: 'b_roar',
  resist: { shadow: 0, fire: 0.8 }, statusResist: { blight: 0, burn: 0.5, bleed: 0.5 },
  // phase two: bolts of black flame hurled across the courtyard
  ranged: { kind: 'blackfire', clip: 'e_thrust', range: [5.5, 20], cooldown: 6.5, release: 0.5, phase: 0.5, weight: 0.7 },
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death', blockClip: 'block_hit', evade: { back: 'dodge_back', left: 'dodge_left', right: 'dodge_right' },
  attacks: [
    { clip: 'e_slash', range: [0, 2.6], damage: 20, poise: 26, cooldown: 2.2, track: 5, chain: 'e_slash_b' },
    { clip: 'e_slash_b', range: [0, 2.6], damage: 20, poise: 26, cooldown: 3.0, weight: 0, track: 4, chain: 'e_sweep' },
    { clip: 'e_sweep', range: [0, 3.2], damage: 22, poise: 34, cooldown: 3.4, track: 3.5, weight: 0.8 },
    { clip: 'e_thrust', range: [1.8, 4.4], damage: 24, poise: 34, cooldown: 3.6, track: 3, weight: 0.7 },
    { clip: 'w_dash', range: [3, 9], damage: 24, poise: 30, cooldown: 4.5, track: 1.2, weight: 0.7 },
    { clip: 'e_lunge', range: [4, 8], damage: 30, poise: 40, cooldown: 6, track: 2, unblockable: true, weight: 0.6 },
    // phase two: the black flame
    { clip: 'b_slam', range: [0, 4.4], damage: 36, poise: 70, heavy: true, knock: 1, cooldown: 4.0, track: 2.6, guardBreak: 2.4, aoe: 5.2, phase: 0.5, chain: 'e_sweep' },
    { clip: 'b_charge', range: [5, 13], damage: 34, poise: 60, heavy: true, knock: 1, unblockable: true, cooldown: 7, track: 1.6, weight: 0.7, phase: 0.5 },
    { clip: 'w_flurry', range: [0, 2.6], damage: 14, poise: 14, cooldown: 3.2, track: 6, phase: 0.5 },
  ],
};

/** a Hollow that keeps its distance and lobs pots of burning oil (they leave fire on the ground) */
export const THROWER: EnemyDef = {
  id: 'thrower', name: 'Hollow Firethrower', model: M('hollow_footman'), weapon: 'dagger', hp: 50, poise: 20, walk: 1.5, run: 3.4,
  idle: 'e_idle', move: ['walk', 'run'], aggression: 0.4, block: 0.05, skill: 0.4, flank: 0.2, caution: 0.75, spacing: 9, glow: [3.0, 0.9, 0.2],
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', evade: { back: 'dodge_back' },
  statusResist: { burn: 0.3 },
  ranged: { kind: 'firepot', clip: 'e_slash', range: [4.5, 16], cooldown: 3.8, release: 0.42, weight: 0.85 },
  attacks: [
    { clip: 'e_slash', range: [0, 2.0], damage: 9, poise: 10, cooldown: 2.6, track: 5 },
  ],
};

export const WRAITH: EnemyDef = {
  id: 'wraith', name: 'Hollow Wraith', model: M('hollow_wraith'), weapon: 'dagger', offhand: 'dagger', hp: 45, poise: 20, walk: 2.2, run: 5.0,
  idle: 'w_idle', move: ['walk', 'sprint'], aggression: 0.75, skill: 0.75, flank: 0.9, caution: 0.6, spacing: 3.4, glow: [0.6, 1.4, 3.2],
  hurt: ['hit_front', 'hit_back'], stagger: 'guard_break', death: 'death', evade: { back: 'dodge_back', left: 'dodge_left', right: 'dodge_right' },
  attacks: [
    { clip: 'w_dash', range: [2.5, 7], damage: 14, poise: 15, cooldown: 3, track: 1 },
    { clip: 'w_flurry', range: [0, 2.2], damage: 9, poise: 8, cooldown: 2.8, track: 6 },
  ],
};

export const ARCHER: EnemyDef = {
  id: 'archer', name: 'Hollow Archer', model: M('hollow_footman'), weapon: 'dagger', hp: 40, poise: 18, walk: 1.5, run: 3.6,
  idle: 'e_idle', move: ['walk', 'run'], aggression: 0.6, spacing: 8, glow: [2.2, 0.7, 0.25],
  hurt: ['hit_front'], stagger: 'guard_break', death: 'death',
  attacks: [{ clip: 'e_slash', range: [0, 2.2], damage: 10, poise: 10, cooldown: 2.5 }],
};

/** fall back to the hero rig with player clips while enemy assets are missing */
export function withFallback(d: EnemyDef, have: (clip: string) => boolean, haveModel: boolean): EnemyDef {
  const map: Record<string, string> = {
    e_idle: 'idle', b_idle: 'idle', w_idle: 'idle', e_walk: 'walk', b_walk: 'walk', w_walk: 'walk',
    e_slash: 'attack_1', e_slash_b: 'attack_2', e_thrust: 'attack_3', e_sweep: 'attack_3', e_lunge: 'attack_4',
    b_slam: 'attack_4', b_sweep: 'heavy_release', b_charge: 'attack_4', w_dash: 'attack_2', w_flurry: 'attack_1',
    e_hit_a: 'hit_front', e_hit_b: 'hit_back', e_stagger: 'guard_break', b_stagger: 'guard_break', e_death: 'death',
  };
  const fix = (c?: string) => (c && !have(c) ? map[c] ?? c : c);
  return {
    ...d,
    model: haveModel ? d.model : 'assets/chars/kaede.glb',
    weapon: haveModel ? d.weapon : 'katana',
    idle: fix(d.idle), move: d.move?.map((m) => fix(m)!), hurt: d.hurt?.map((h) => fix(h)!), stagger: fix(d.stagger), death: fix(d.death),
    attacks: d.attacks.map((a) => ({ ...a, clip: fix(a.clip)!, chain: fix(a.chain) })),
  };
}
