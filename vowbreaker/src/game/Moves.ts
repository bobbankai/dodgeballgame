/**
 * Move data. Times are in seconds of game time (the clips run at 30 fps, so one clip frame is
 * 0.033 s). A move: startup -> active (hitbox out) -> recovery; cancels open once it connects.
 */
export type MoveKind = 'strike' | 'projectile' | 'area' | 'buff' | 'grab';

export interface Move {
  name: string;
  clip: string;
  speed?: number;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  blockstun?: number;
  push: number;
  launch?: number;
  knockdown?: boolean;
  spike?: boolean;
  /** hitbox: a sphere at a bone, or `reach` metres in front of the chest */
  bone?: string;
  reach?: number;
  radius: number;
  lunge?: number;
  hits?: number;
  air?: boolean;
  kind: MoveKind;
  cost?: number;
  gain?: number;
  /** what this move can be cancelled into once it hits (or is blocked) */
  cancel?: string[];
  heavy?: boolean;
  unblockable?: boolean;
  /** technique payloads */
  projectile?: ProjectileSpec;
  area?: AreaSpec;
  buff?: BuffSpec;
  vfx?: string;
  sfx?: string;
  /** a cinematic camera beat for big techniques */
  showcase?: boolean;
  /** this hit applies a technique mark (Hollow Bell seal, Gravebrand) */
  mark?: string;
  /** label shown on the HUD */
  label?: string;
}

export interface ProjectileSpec {
  speed: number;
  radius: number;
  life: number;
  count?: number;
  spread?: number;
  homing?: number;
  ground?: boolean;
  kind: string;
}

export interface AreaSpec {
  radius: number;
  /** centred on: self, in front of self, or on the target after a delay */
  at: 'self' | 'front' | 'target';
  delay?: number;
  cone?: number;
  kind: string;
}

export interface BuffSpec {
  kind: 'slow-field' | 'pull' | 'armor';
  radius: number;
  duration: number;
}

const LIGHT = ['light2', 'heavy', 'tech1', 'tech2', 'tech3', 'dash'];

/** The shared string every human fighter has (the clips are shared too). */
export function baseMoves(): Record<string, Move> {
  return {
    light1: { name: 'light1', clip: 'light1', startup: 0.1, active: 0.08, recovery: 0.2, damage: 22, hitstun: 0.32, push: 1.6, bone: 'hand_L', radius: 0.42, lunge: 2.2, kind: 'strike', gain: 4, cancel: LIGHT, sfx: 'punch' },
    light2: { name: 'light2', clip: 'light2', startup: 0.12, active: 0.08, recovery: 0.22, damage: 26, hitstun: 0.34, push: 1.8, bone: 'hand_R', radius: 0.44, lunge: 2.6, kind: 'strike', gain: 4, cancel: ['light3', 'heavy', 'tech1', 'tech2', 'tech3', 'dash'], sfx: 'punch' },
    light3: { name: 'light3', clip: 'light3', startup: 0.14, active: 0.09, recovery: 0.26, damage: 30, hitstun: 0.38, push: 2.2, bone: 'hand_L', radius: 0.48, lunge: 2.4, kind: 'strike', gain: 5, cancel: ['light4', 'heavy', 'tech1', 'tech2', 'tech3', 'dash'], sfx: 'punch' },
    light4: { name: 'light4', clip: 'light4', startup: 0.18, active: 0.12, recovery: 0.36, damage: 46, hitstun: 0.5, push: 6.5, bone: 'foot_R', radius: 0.55, lunge: 2.0, kind: 'strike', gain: 7, knockdown: true, cancel: ['tech1', 'tech2', 'tech3'], sfx: 'kick', heavy: true },
    heavy: { name: 'heavy', clip: 'heavy', startup: 0.24, active: 0.12, recovery: 0.36, damage: 52, hitstun: 0.7, push: 1.2, launch: 9.5, bone: 'hand_R', radius: 0.55, lunge: 2.4, kind: 'strike', gain: 8, cancel: ['jump', 'tech1', 'tech2', 'tech3'], sfx: 'heavy', heavy: true },
    heavy2: { name: 'heavy2', clip: 'heavy2', startup: 0.36, active: 0.14, recovery: 0.4, damage: 64, hitstun: 0.6, push: 8.5, bone: 'foot_R', radius: 0.6, lunge: 1.4, kind: 'strike', gain: 8, knockdown: true, cancel: ['tech1', 'tech2', 'tech3'], sfx: 'heavy', heavy: true },
    dash_attack: { name: 'dash_attack', clip: 'dash_attack', startup: 0.14, active: 0.12, recovery: 0.3, damage: 38, hitstun: 0.5, push: 4.5, bone: 'hand_R', radius: 0.5, lunge: 9, kind: 'strike', gain: 5, cancel: ['light1', 'heavy', 'tech1', 'tech2', 'tech3'], sfx: 'punch' },
    air_light: { name: 'air_light', clip: 'air_light', startup: 0.08, active: 0.1, recovery: 0.18, damage: 24, hitstun: 0.45, push: 1.4, launch: 3.2, bone: 'hand_R', radius: 0.5, lunge: 1.2, kind: 'strike', air: true, gain: 4, cancel: ['air_light2', 'air_heavy'], sfx: 'punch' },
    air_light2: { name: 'air_light2', clip: 'air_light', speed: 1.15, startup: 0.07, active: 0.1, recovery: 0.18, damage: 24, hitstun: 0.45, push: 1.4, launch: 3.2, bone: 'hand_R', radius: 0.5, lunge: 1.2, kind: 'strike', air: true, gain: 4, cancel: ['air_heavy'], sfx: 'punch' },
    air_heavy: { name: 'air_heavy', clip: 'air_heavy', startup: 0.2, active: 0.12, recovery: 0.3, damage: 48, hitstun: 0.6, push: 2, spike: true, knockdown: true, bone: 'foot_R', radius: 0.6, lunge: 0.6, kind: 'strike', air: true, gain: 7, sfx: 'heavy', heavy: true },
    throw: { name: 'throw', clip: 'throw', startup: 0.16, active: 0.08, recovery: 0.5, damage: 58, hitstun: 0.8, push: 7, knockdown: true, reach: 0.9, radius: 0.6, lunge: 1.5, kind: 'grab', unblockable: true, gain: 8, sfx: 'heavy' },
  };
}

/** A fighter's whole kit: base string, techniques, domain and stats. */
export interface Kit {
  id: string;
  name: string;
  palette: number;
  health: number;
  walk: number;
  run: number;
  moves: Record<string, Move>;
  techs: [string, string, string];
  domain?: { name: string; id: number; tick: number; damage: number };
  /** curses: which base moves they lack, plus extras */
  ai?: string;
}

function kit(id: string, name: string, palette: number, techs: Record<string, Move>, extra: Partial<Kit> = {}): Kit {
  const moves = { ...baseMoves(), ...techs };
  const names = Object.keys(techs) as string[];
  return {
    id, name, palette, health: 1000, walk: 3.4, run: 7.2, moves,
    techs: [names[0], names[1], names[2]],
    ...extra,
  };
}

export const KITS: Record<string, () => Kit> = {
  itsuki: () => kit('itsuki', 'Itsuki Kagari', 0, {
    toll: { name: 'toll', label: 'Toll', clip: 'cast_palm', startup: 0.38, active: 0.1, recovery: 0.4, damage: 90, hitstun: 0.7, push: 9, kind: 'area', cost: 25, gain: 0, area: { radius: 2.4, at: 'front', cone: 0.9, kind: 'toll' }, knockdown: true, vfx: 'toll', sfx: 'bell', mark: 'bell', radius: 0 },
    bellchain: { name: 'bellchain', label: 'Bell Chain', clip: 'cast_throw', startup: 0.24, active: 0.05, recovery: 0.36, damage: 55, hitstun: 0.5, push: 3, kind: 'projectile', cost: 20, projectile: { speed: 19, radius: 0.55, life: 1.1, count: 3, spread: 0.18, kind: 'bell' }, sfx: 'bell', mark: 'bell', radius: 0 },
    requiem: { name: 'requiem', label: 'Requiem', clip: 'cast_slam', startup: 0.6, active: 0.12, recovery: 0.5, damage: 120, hitstun: 0.9, push: 3, launch: 11, kind: 'area', cost: 45, area: { radius: 4.6, at: 'self', kind: 'requiem' }, vfx: 'requiem', sfx: 'toll', showcase: true, radius: 0 },
  }, { domain: { name: 'Temple of the Unrung Bell', id: 0, tick: 1.4, damage: 45 } }),

  sayo: () => kit('sayo', 'Sayo Tachibana', 1, {
    cranes: { name: 'cranes', label: 'Crane Volley', clip: 'cast_throw', startup: 0.22, active: 0.05, recovery: 0.34, damage: 34, hitstun: 0.4, push: 2, kind: 'projectile', cost: 18, projectile: { speed: 13, radius: 0.45, life: 2.2, count: 3, spread: 0.45, homing: 3.5, kind: 'crane' }, sfx: 'paper', radius: 0 },
    wolf: { name: 'wolf', label: 'Paper Wolf', clip: 'cast_palm', startup: 0.3, active: 0.05, recovery: 0.4, damage: 70, hitstun: 0.7, push: 2, launch: 9, kind: 'projectile', cost: 25, projectile: { speed: 15, radius: 0.7, life: 1.2, ground: true, kind: 'wolf' }, sfx: 'paper', radius: 0 },
    fold: { name: 'fold', label: 'Folded Blade', clip: 'heavy2', startup: 0.3, active: 0.3, recovery: 0.4, damage: 26, hitstun: 0.4, push: 2.5, kind: 'area', cost: 30, hits: 4, area: { radius: 2.8, at: 'self', kind: 'blade' }, sfx: 'slash', radius: 0, knockdown: true },
  }, { domain: { name: 'Garden of Folded Prayers', id: 1, tick: 1.1, damage: 38 }, walk: 3.6, run: 7.6 }),

  mikami: () => kit('mikami', 'Genjirō Mikami', 2, {
    ripple: { name: 'ripple', label: 'Ripple', clip: 'cast_palm', startup: 0.28, active: 0.1, recovery: 0.36, damage: 70, hitstun: 0.6, push: 10, kind: 'area', cost: 20, area: { radius: 3.6, at: 'front', cone: 1.1, kind: 'ripple' }, knockdown: true, sfx: 'water', radius: 0 },
    stillpoint: { name: 'stillpoint', label: 'Still Point', clip: 'cast_raise', startup: 0.3, active: 0.05, recovery: 0.4, damage: 0, hitstun: 0, push: 0, kind: 'buff', cost: 35, buff: { kind: 'slow-field', radius: 6, duration: 5 }, sfx: 'still', radius: 0, showcase: true },
    moonfall: { name: 'moonfall', label: 'Moonfall', clip: 'cast_slam', startup: 0.45, active: 0.12, recovery: 0.45, damage: 110, hitstun: 0.8, push: 2, launch: 10, kind: 'area', cost: 40, area: { radius: 2.4, at: 'target', delay: 0.5, kind: 'moonfall' }, sfx: 'heavy', radius: 0 },
  }, { domain: { name: 'Mirror Lake of Ten Thousand Moons', id: 2, tick: 1.2, damage: 50 }, health: 1100 }),

  sojin: () => kit('sojin', 'Sōjin Amagiri', 3, {
    lanterns: { name: 'lanterns', label: 'Lantern Flock', clip: 'cast_raise', startup: 0.4, active: 0.05, recovery: 0.4, damage: 42, hitstun: 0.45, push: 2, kind: 'projectile', cost: 22, projectile: { speed: 8, radius: 0.55, life: 3.4, count: 5, spread: 0.9, homing: 2.2, kind: 'lantern' }, sfx: 'fire', radius: 0 },
    pyre: { name: 'pyre', label: 'Pyre', clip: 'cast_palm', startup: 0.36, active: 0.15, recovery: 0.42, damage: 85, hitstun: 0.6, push: 7, kind: 'area', cost: 25, area: { radius: 4, at: 'front', cone: 0.7, kind: 'fire' }, knockdown: true, sfx: 'fire', radius: 0 },
    parade: { name: 'parade', label: 'Night Parade', clip: 'cast_slam', startup: 0.5, active: 0.2, recovery: 0.5, damage: 110, hitstun: 0.8, push: 9, launch: 8, kind: 'area', cost: 40, area: { radius: 5, at: 'self', kind: 'firering' }, sfx: 'fire', radius: 0, showcase: true },
  }, { domain: { name: 'Night Parade Without End', id: 3, tick: 1.0, damage: 42 }, health: 1400, walk: 3.0 }),

  ryoga: () => kit('ryoga', 'Ryōga Hoshino', 4, {
    brand: { name: 'brand', label: 'Brand', clip: 'cast_throw', startup: 0.2, active: 0.05, recovery: 0.3, damage: 40, hitstun: 0.45, push: 2, kind: 'projectile', cost: 15, projectile: { speed: 22, radius: 0.5, life: 1, kind: 'brand' }, mark: 'brand', sfx: 'gravity', radius: 0 },
    crush: { name: 'crush', label: 'Crush', clip: 'cast_slam', startup: 0.42, active: 0.4, recovery: 0.45, damage: 30, hitstun: 0.5, push: 0, hits: 4, kind: 'area', cost: 35, area: { radius: 2.6, at: 'target', delay: 0.25, kind: 'gravity' }, sfx: 'gravity', radius: 0, knockdown: true },
    graveward: { name: 'graveward', label: 'Graveward', clip: 'cast_raise', startup: 0.3, active: 0.1, recovery: 0.36, damage: 30, hitstun: 0.8, push: -9, kind: 'buff', cost: 25, buff: { kind: 'pull', radius: 9, duration: 0.6 }, sfx: 'gravity', radius: 0 },
  }, { walk: 3.6, run: 7.8, health: 1100 }),
};

/** Curses and minions: AI-only kits built from the same parts. */
export const CURSE_KITS: Record<string, () => Kit> = {
  mudhand: () => {
    const k = kit('mudhand', 'Mudhand', 6, {
      lunge: { name: 'lunge', clip: 'dash_attack', startup: 0.3, active: 0.15, recovery: 0.5, damage: 30, hitstun: 0.5, push: 4, bone: 'hand_R', radius: 0.6, lunge: 9, kind: 'strike', sfx: 'claw' },
      spit: { name: 'spit', clip: 'cast_throw', startup: 0.4, active: 0.05, recovery: 0.5, damage: 25, hitstun: 0.4, push: 2, kind: 'projectile', projectile: { speed: 12, radius: 0.4, life: 1.5, kind: 'tar' }, radius: 0 },
      grab: { name: 'grab', clip: 'throw', startup: 0.3, active: 0.1, recovery: 0.6, damage: 35, hitstun: 0.7, push: 5, reach: 0.9, radius: 0.7, kind: 'grab', unblockable: true, knockdown: true },
    }, { health: 180, walk: 2.4, run: 4.5, ai: 'grunt' });
    return k;
  },
  acolyte: () => kit('acolyte', 'Lantern Acolyte', 3, {
    ember: { name: 'ember', clip: 'cast_throw', startup: 0.35, active: 0.05, recovery: 0.4, damage: 26, hitstun: 0.4, push: 2, kind: 'projectile', projectile: { speed: 13, radius: 0.4, life: 1.6, kind: 'ember' }, radius: 0 },
    flare: { name: 'flare', clip: 'cast_palm', startup: 0.45, active: 0.1, recovery: 0.45, damage: 45, hitstun: 0.5, push: 6, kind: 'area', area: { radius: 2.2, at: 'front', cone: 0.9, kind: 'fire' }, radius: 0 },
    rush: { name: 'rush', clip: 'dash_attack', startup: 0.2, active: 0.12, recovery: 0.4, damage: 30, hitstun: 0.45, push: 4, bone: 'hand_R', radius: 0.5, lunge: 8, kind: 'strike' },
  }, { health: 260, ai: 'grunt' }),
  umbrella: () => kit('umbrella', 'Red Umbrella', 6, {
    needles: { name: 'needles', clip: 'cast_throw', startup: 0.35, active: 0.05, recovery: 0.4, damage: 22, hitstun: 0.35, push: 1.5, kind: 'projectile', projectile: { speed: 17, radius: 0.35, life: 1.4, count: 5, spread: 0.5, kind: 'needle' }, radius: 0 },
    spin: { name: 'spin', clip: 'heavy2', startup: 0.35, active: 0.4, recovery: 0.4, damage: 24, hitstun: 0.35, push: 3, hits: 4, kind: 'area', area: { radius: 2.6, at: 'self', kind: 'umbrella' }, radius: 0, knockdown: true },
    downpour: { name: 'downpour', clip: 'cast_raise', startup: 0.5, active: 0.3, recovery: 0.5, damage: 70, hitstun: 0.6, push: 2, kind: 'area', area: { radius: 2.2, at: 'target', delay: 0.6, kind: 'rainspike' }, radius: 0, showcase: true },
  }, { health: 900, walk: 2.8, ai: 'boss' }),
  bride: () => kit('bride', 'The Weeping Bride', 6, {
    veil: { name: 'veil', clip: 'light4', startup: 0.3, active: 0.15, recovery: 0.4, damage: 40, hitstun: 0.5, push: 6, reach: 2.4, radius: 0.9, kind: 'strike', knockdown: true },
    tears: { name: 'tears', clip: 'cast_raise', startup: 0.45, active: 0.6, recovery: 0.4, damage: 20, hitstun: 0.3, push: 0, hits: 3, kind: 'area', area: { radius: 2.4, at: 'target', delay: 0.7, kind: 'tears' }, radius: 0 },
    wail: { name: 'wail', clip: 'domain', speed: 1.4, startup: 0.6, active: 0.2, recovery: 0.4, damage: 80, hitstun: 0.9, push: 11, kind: 'area', area: { radius: 5.5, at: 'self', kind: 'wail' }, radius: 0, knockdown: true, showcase: true },
  }, { health: 1200, walk: 2.6, ai: 'boss' }),
  shiragami: () => kit('shiragami', 'Shiragami', 1, {
    stamp: { name: 'stamp', clip: 'cast_slam', startup: 0.55, active: 0.15, recovery: 0.6, damage: 90, hitstun: 0.8, push: 8, kind: 'area', area: { radius: 3.4, at: 'front', cone: 1.4, kind: 'paperquake' }, radius: 0, knockdown: true },
    swarm: { name: 'swarm', clip: 'cast_raise', startup: 0.45, active: 0.05, recovery: 0.5, damage: 30, hitstun: 0.4, push: 2, kind: 'projectile', projectile: { speed: 10, radius: 0.45, life: 3, count: 6, spread: 1.2, homing: 3, kind: 'crane' }, radius: 0 },
    sweep: { name: 'sweep', clip: 'heavy2', speed: 0.75, startup: 0.5, active: 0.2, recovery: 0.6, damage: 70, hitstun: 0.7, push: 9, reach: 2.4, radius: 1.4, kind: 'strike', knockdown: true },
  }, { health: 1500, walk: 2.2, ai: 'boss' }),
  littlebell: () => kit('littlebell', 'The Little Bell', 0, {
    ember: { name: 'ember', clip: 'cast_throw', startup: 0.3, active: 0.05, recovery: 0.4, damage: 30, hitstun: 0.4, push: 2, kind: 'projectile', projectile: { speed: 11, radius: 0.45, life: 2, count: 3, spread: 0.4, homing: 2, kind: 'ember' }, radius: 0 },
    toll: { name: 'toll', clip: 'cast_palm', startup: 0.35, active: 0.1, recovery: 0.4, damage: 70, hitstun: 0.6, push: 9, kind: 'area', area: { radius: 3, at: 'self', kind: 'toll' }, radius: 0, knockdown: true },
    blaze: { name: 'blaze', clip: 'cast_raise', startup: 0.5, active: 0.4, recovery: 0.4, damage: 26, hitstun: 0.35, push: 2, hits: 4, kind: 'area', area: { radius: 2.4, at: 'target', delay: 0.6, kind: 'fire' }, radius: 0 },
  }, { health: 1100, walk: 2.6, ai: 'boss' }),
};

export function getKit(id: string): Kit {
  const f = KITS[id] ?? CURSE_KITS[id];
  if (!f) throw new Error('no kit ' + id);
  return f();
}
