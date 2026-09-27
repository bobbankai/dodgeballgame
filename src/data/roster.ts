import { Appearance, defaultAppearance, HairStyle, BrowStyle, SKIN_TONES, HAIR_COLORS } from '../character/Appearance';
import type { AthleteProfile, PersonalityId } from '../game/Athlete';
import { Attributes, AttributeKey, baseAttributes, noPerks, Perks } from '../game/Stats';

export interface TeamKit {
  name: string;
  short: string;
  jersey: number;
  trim: number;
  shorts: number;
  accent: number;
  shoes?: number;
  socks?: number;
  glow?: number;
}

export const KITS: Record<string, TeamKit> = {
  player: { name: 'Overthrow', short: 'OVR', jersey: 0x19b8c4, trim: 0xf4efe3, shorts: 0x17202e, accent: 0xff6a3d, shoes: 0x1a1d24 },
  rec: { name: 'Maplewood Rec', short: 'MRC', jersey: 0x6d7a8c, trim: 0xe8e4da, shorts: 0x2e3440, accent: 0xf2c14e },
  harbor: { name: 'Harbor Hustlers', short: 'HBR', jersey: 0xd9443a, trim: 0x1b1b22, shorts: 0x1b1b22, accent: 0xffd166 },
  wolves: { name: 'Westbrook Wolves', short: 'WBW', jersey: 0x5b3fb8, trim: 0xf2c94c, shorts: 0x231a44, accent: 0xf2c94c },
  eagles: { name: 'Eastside Eagles', short: 'ESE', jersey: 0x2e7d32, trim: 0xf5f5f5, shorts: 0x1b3d1d, accent: 0xffffff },
  vipers: { name: 'Skyline Vipers', short: 'SKV', jersey: 0x0f9d58, trim: 0x111111, shorts: 0x0b0d0c, accent: 0xb6ff3b },
  ricochet: { name: 'Ricochet Crew', short: 'RCX', jersey: 0xff7a18, trim: 0x1e1e24, shorts: 0x1e1e24, accent: 0x33d6ff },
  titans: { name: 'Metro Titans', short: 'MTT', jersey: 0x1e3a8a, trim: 0xdc2626, shorts: 0x0f172a, accent: 0xf8fafc },
  syndicate: { name: 'Iron Syndicate', short: 'IRN', jersey: 0x2b2b2e, trim: 0xb91c1c, shorts: 0x18181b, accent: 0xef4444 },
  phantoms: { name: 'Night Phantoms', short: 'NPH', jersey: 0x4c1d95, trim: 0x22d3ee, shorts: 0x1e1036, accent: 0x22d3ee },
  royals: { name: 'Crown Royals', short: 'CRW', jersey: 0xf5f0e1, trim: 0xc8a14a, shorts: 0x1a1a1a, accent: 0xc8a14a },
  eclipse: { name: 'The Eclipsed', short: 'ECL', jersey: 0x14121c, trim: 0x8b5cf6, shorts: 0x0a0910, accent: 0xa78bfa, glow: 0xa78bfa },
  monarch: { name: 'The Monarch', short: 'MON', jersey: 0x0c0a12, trim: 0xf59e0b, shorts: 0x07060a, accent: 0xfbbf24, glow: 0xf59e0b },
};

export interface ProfileSpec {
  id: string;
  name: string;
  title?: string;
  number?: number;
  kit: TeamKit;
  personality: PersonalityId;
  tier: number;
  hair?: HairStyle;
  hairColor?: number;
  skin?: number;
  brow?: BrowStyle;
  height?: number;
  bulk?: number;
  headband?: boolean;
  visor?: boolean;
  sleeveless?: boolean;
  hearts?: number;
  attrs?: Partial<Attributes>;
  perks?: Partial<Perks>;
  ability?: string | null;
  ultimate?: string | null;
  boss?: boolean;
  seed?: number;
}

/** Base attribute budget by tier so late-game opponents are genuinely stronger. */
const TIER_ATTR = [1, 2, 3, 4, 5, 6, 7];

const PERSONALITY_ATTR: Record<PersonalityId, Partial<Record<AttributeKey, number>>> = {
  aggressor: { power: 1, release: 2, agility: 1, catching: -1 },
  defender: { catching: 3, evasion: -1, power: -1, stamina: 1 },
  sniper: { accuracy: 3, power: 1, agility: -1, control: 2 },
  speedster: { agility: 3, evasion: 3, power: -2, stamina: 2 },
  powerhouse: { power: 3, catching: 1, agility: -2, evasion: -2 },
  tactician: { control: 2, accuracy: 1, catching: 1 },
  balanced: {},
  boss: { power: 2, accuracy: 2, catching: 2, agility: 1, evasion: 2, control: 2, special: 3 },
  dummy: {},
};

function tierPerks(tier: number, personality: PersonalityId): Partial<Perks> {
  const p: Partial<Perks> = {};
  if (tier >= 2) p.perfectCatch = true;
  if (tier >= 3) {
    p.fake = true;
    p.curve = personality === 'sniper' || personality === 'tactician' || personality === 'boss';
  }
  if (tier >= 4) {
    p.perfectDodge = true;
    p.counterThrow = true;
    p.curve = true;
  }
  if (tier >= 5) {
    p.deflect = personality === 'defender' || personality === 'boss';
    p.shockwave = personality === 'powerhouse' || personality === 'boss';
    p.ricochet = personality === 'tactician' || personality === 'boss';
  }
  if (personality === 'speedster' && tier >= 3) p.extraDodge = 1;
  return p;
}

export function makeProfile(s: ProfileSpec): AthleteProfile {
  let seed = s.seed ?? hash(s.id);
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const app: Appearance = {
    ...defaultAppearance(),
    skin: s.skin ?? SKIN_TONES[Math.floor(rnd() * SKIN_TONES.length)],
    hair: s.hairColor ?? HAIR_COLORS[Math.floor(rnd() * HAIR_COLORS.length)],
    hairStyle: s.hair ?? (['short', 'buzz', 'spiky', 'swept', 'ponytail', 'afro', 'bun', 'mohawk'] as HairStyle[])[Math.floor(rnd() * 8)],
    brow: s.brow ?? (s.personality === 'aggressor' || s.boss ? 'angry' : rnd() < 0.3 ? 'calm' : 'neutral'),
    jersey: s.kit.jersey,
    trim: s.kit.trim,
    shorts: s.kit.shorts,
    accent: s.kit.accent,
    shoes: s.kit.shoes ?? 0x1c1f26,
    socks: s.kit.socks ?? 0xf2f0ea,
    height: s.height ?? 0.96 + rnd() * 0.1,
    bulk: s.bulk ?? (s.personality === 'powerhouse' ? 1.25 : s.personality === 'speedster' ? 0.9 : 0.95 + rnd() * 0.12),
    headband: s.headband ?? rnd() < 0.3,
    wristbands: rnd() < 0.6,
    visor: s.visor,
    sleeveless: s.sleeveless ?? (s.personality === 'powerhouse' && rnd() < 0.7),
    glow: s.kit.glow,
    glowStrength: s.kit.glow ? 1.2 : 0,
  };
  const base = TIER_ATTR[Math.max(0, Math.min(6, s.tier))];
  const attrs = baseAttributes(base);
  const mod = PERSONALITY_ATTR[s.personality] ?? {};
  for (const k of Object.keys(attrs) as AttributeKey[]) {
    attrs[k] = Math.max(1, Math.min(10, attrs[k] + (mod[k] ?? 0) + (s.attrs?.[k] ?? 0)));
  }
  const perks: Perks = { ...noPerks(), ...tierPerks(s.tier, s.personality), ...(s.perks ?? {}) };
  return {
    id: s.id,
    name: s.name,
    title: s.title,
    number: s.number ?? 1 + Math.floor(rnd() * 98),
    appearance: app,
    attributes: attrs,
    perks,
    baseHearts: s.hearts ?? 2,
    personality: s.personality,
    tier: s.tier,
    boss: s.boss,
    ability: s.ability ?? null,
    ultimate: s.ultimate ?? null,
  };
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Generic filler athletes for a kit. */
const FIRST = ['Dex', 'Mara', 'Kip', 'Juno', 'Rory', 'Tess', 'Omar', 'Lena', 'Zeke', 'Priya', 'Cole', 'Nia', 'Beau', 'Ivy', 'Rex', 'Sol', 'Kai', 'Wren', 'Theo', 'Ada', 'Milo', 'Suki', 'Vic', 'Lou'];
export function filler(kit: TeamKit, idx: number, tier: number, personality: PersonalityId, seed = 0): AthleteProfile {
  const name = FIRST[(idx * 7 + seed * 5 + kit.short.charCodeAt(0)) % FIRST.length];
  return makeProfile({ id: `${kit.short}-${name}-${idx}-${seed}`, name, kit, personality, tier, seed: hash(kit.short) + idx * 101 + seed * 997 });
}
