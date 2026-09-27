export type HairStyle = 'bald' | 'buzz' | 'short' | 'spiky' | 'mohawk' | 'afro' | 'bun' | 'ponytail' | 'swept';
export type BrowStyle = 'neutral' | 'angry' | 'calm' | 'raised';

export interface Appearance {
  skin: number;
  hair: number;
  hairStyle: HairStyle;
  brow: BrowStyle;
  jersey: number;
  trim: number;
  shorts: number;
  shoes: number;
  sole: number;
  socks: number;
  accent: number;
  eyes?: number;
  /** Uniform height scale (≈0.92..1.1). */
  height: number;
  /** Girth multiplier for torso/limbs (≈0.85..1.35). */
  bulk: number;
  headband?: boolean;
  wristbands?: boolean;
  sleeveless?: boolean;
  /** Emissive accent glow (supernatural competitors). */
  glow?: number;
  glowStrength?: number;
  /** Visor/mask over the eyes (boss flair). */
  visor?: boolean;
}

/** Palette slot indices written into the mesh's `aSlot` attribute. */
export const SLOT = {
  skin: 0,
  jersey: 1,
  trim: 2,
  shorts: 3,
  shoes: 4,
  sole: 5,
  hair: 6,
  eyes: 7,
  socks: 8,
  accent: 9,
  visor: 10,
} as const;
export const SLOT_COUNT = 11;

export const SKIN_TONES = [0xf3d2b8, 0xe8b894, 0xd29a70, 0xb07a52, 0x8a5a3a, 0x5e3b27, 0xf6dcc9];
export const HAIR_COLORS = [0x1b1411, 0x3a2418, 0x6b4125, 0xa8743d, 0xd8b56e, 0x2a2a30, 0xc23b2a, 0xe9e4da];

export function defaultAppearance(): Appearance {
  return {
    skin: SKIN_TONES[2],
    hair: HAIR_COLORS[0],
    hairStyle: 'short',
    brow: 'neutral',
    jersey: 0x1fb6c8,
    trim: 0xf4efe3,
    shorts: 0x1a2433,
    shoes: 0x1a1d24,
    sole: 0xf2f0ea,
    socks: 0xf2f0ea,
    accent: 0xff6a3d,
    height: 1,
    bulk: 1,
    headband: false,
    wristbands: true,
  };
}
