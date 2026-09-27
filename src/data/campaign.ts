import type { AthleteProfile } from '../game/Athlete';
import type { MatchConfig, MatchMode, MatchRules } from '../game/Match';
import { filler, KITS, makeProfile, TeamKit } from './roster';

export interface ChapterDef {
  id: string;
  num: number;
  name: string;
  location: string;
  arena: string;
  blurb: string;
  intro?: string;
}

export interface CampaignMatch {
  id: string;
  chapter: string;
  title: string;
  opponent: string;
  desc: string;
  mode?: MatchMode;
  tags: string[];
  boss?: boolean;
  /** builds a fresh config each time (random fillers stay stable via seeds) */
  build: () => Omit<MatchConfig, 'home'> & { homeMates: AthleteProfile[] };
  requires?: string[];
  introCinematic?: string;
  outroCinematic?: string;
  /** Story unlocks when first cleared */
  unlocks?: { ultimate?: boolean; cred?: number; points?: number };
}

export const CHAPTERS: ChapterDef[] = [
  { id: 'c1', num: 1, name: 'Rec League', location: 'Maplewood Rec Center', arena: 'rec', blurb: 'Scuffed floors, a busted scoreboard and a dream the size of a stadium.', intro: 'intro' },
  { id: 'c2', num: 2, name: 'Street Courts', location: 'Harbor Street Court', arena: 'street', blurb: 'Nobody hands you respect on the waterfront. You take it.' },
  { id: 'c3', num: 3, name: 'The Invitational', location: 'Westbrook Fieldhouse', arena: 'school', blurb: 'Bleachers. Banners. A real crowd — and real pressure.', intro: 'invitational' },
  { id: 'c4', num: 4, name: 'City League', location: 'Skyline Rooftop', arena: 'rooftop', blurb: 'Forty floors up, under the city lights, the game gets serious.' },
  { id: 'c5', num: 5, name: 'Elite Underground', location: 'The Pit', arena: 'underground', blurb: 'An invitation-only circuit where the best play for keeps.' },
  { id: 'c6', num: 6, name: 'The Crown', location: 'Crown Arena', arena: 'stadium', blurb: 'Twenty thousand fans. One trophy. Everybody wants your head.', intro: 'championship' },
  { id: 'c7', num: 7, name: 'Eclipse', location: 'The Eclipse Court', arena: 'eclipse', blurb: 'Beyond the championship lies the court no one returns from.' },
];

// ------------------------------------------------------------------ signature characters
export const COACH = () => makeProfile({ id: 'coach-marla', name: 'Coach Marla', kit: { ...KITS.rec, jersey: 0x33415c }, personality: 'dummy', tier: 0, hair: 'bun', hairColor: 0x6b4125, brow: 'calm', height: 0.98, headband: false, seed: 11 });

export const JAX = (tier: number) =>
  makeProfile({
    id: 'jax', name: 'Jax', title: "Jax 'Ricochet' Rourke", number: 13, kit: KITS.ricochet, personality: 'tactician', tier, hair: 'spiky', hairColor: 0xd8b56e, brow: 'angry', height: 1.02, headband: true, hearts: 3, boss: true,
    perks: { ricochet: true, fake: true, curve: true }, attrs: { accuracy: 2, control: 2 }, seed: 1313,
  });

export const BRICK = () =>
  makeProfile({
    id: 'brick', name: 'Brick', title: "Andre 'Brick' Okafor", number: 55, kit: KITS.wolves, personality: 'powerhouse', tier: 4, hair: 'buzz', hairColor: 0x1b1411, skin: 0x5e3b27, brow: 'angry', height: 1.08, bulk: 1.35, hearts: 3, boss: true,
    ability: 'powerShot', perks: { shockwave: true }, seed: 5555,
  });

export const VANTA = () =>
  makeProfile({
    id: 'vanta', name: 'Vanta', title: 'Vanta — The Shade', number: 0, kit: KITS.phantoms, personality: 'speedster', tier: 6, hair: 'ponytail', hairColor: 0xe9e4da, skin: 0xf6dcc9, brow: 'angry', height: 0.98, bulk: 0.9, hearts: 3, boss: true, visor: true,
    ability: 'blink', perks: { perfectDodge: true, slideThrow: true, extraDodge: 1 }, seed: 777,
  });

export const REGINA = () =>
  makeProfile({
    id: 'regina', name: 'Regina', title: 'Regina Vale — The Wall', number: 1, kit: KITS.royals, personality: 'defender', tier: 6, hair: 'afro', hairColor: 0x2a2a30, skin: 0x8a5a3a, brow: 'calm', height: 1.04, bulk: 1.05, hearts: 3, boss: true,
    ability: 'powerShot', perks: { deflect: true, reflect: true, ironHands: true, counterThrow: true }, seed: 101,
  });

export const MONARCH = () =>
  makeProfile({
    id: 'monarch', name: 'The Monarch', title: 'The Monarch', number: 1, kit: KITS.monarch, personality: 'boss', tier: 6, hair: 'mohawk', hairColor: 0xf59e0b, skin: 0x5e3b27, brow: 'angry', height: 1.12, bulk: 1.15, hearts: 4, boss: true, visor: true,
    ability: 'phantom', ultimate: 'overthrow', perks: { deflect: true, reflect: true, shockwave: true, ricochet: true, guardBreak: true }, attrs: { power: 1, special: 2 }, seed: 9999,
  });

function team(kit: TeamKit, n: number, tier: number, personalities: AthleteProfile['personality'][], seed: number) {
  return Array.from({ length: n }, (_, i) => filler(kit, i, tier, personalities[i % personalities.length], seed));
}

function mates(n: number, tier: number, seed: number) {
  return team(KITS.player, n, tier, ['defender', 'aggressor', 'tactician'], seed);
}

type Base = {
  arena: string;
  mode?: MatchMode;
  away: AthleteProfile[];
  mates?: AthleteProfile[];
  rounds?: number;
  balls?: number;
  time?: number;
  tier: number;
  xp: number;
  cred: number;
  rules?: MatchRules;
  objective?: string;
  waves?: AthleteProfile[][];
  court?: { halfWidth: number; halfLength: number };
  subtitle: string;
};

function cfg(id: string, title: string, b: Base) {
  return () => ({
    id,
    title,
    subtitle: b.subtitle,
    mode: b.mode ?? 'elimination',
    arena: b.arena,
    away: b.away,
    homeMates: b.mates ?? [],
    waves: b.waves,
    roundsToWin: b.rounds ?? 2,
    ballCount: b.balls ?? Math.max(3, (b.mates?.length ?? 0) + 1 + b.away.length - 1),
    timeLimit: b.time ?? 100,
    tier: b.tier,
    reward: { xp: b.xp, cred: b.cred },
    rules: b.rules,
    objective: b.objective,
    court: b.court,
  });
}

const SMALL = { halfWidth: 5.2, halfLength: 8 };
const MID = { halfWidth: 6, halfLength: 9.2 };

export const MATCHES: CampaignMatch[] = [
  // ------------------------------------------------------------------ CH1
  {
    id: 'm1-1', chapter: 'c1', title: 'First Practice', opponent: 'Coach Marla', mode: 'tutorial', tags: ['Tutorial'],
    desc: 'Coach Marla walks you through the fundamentals: movement, throwing, catching and dodging.',
    build: cfg('m1-1', 'First Practice', { arena: 'rec', mode: 'tutorial', away: [filler(KITS.rec, 0, 0, 'dummy', 1), COACH()], tier: 0, xp: 120, cred: 120, balls: 3, rounds: 1, time: 0, subtitle: 'PRACTICE' }),
  },
  {
    id: 'm1-2', chapter: 'c1', title: 'Pickup Game', opponent: 'Dex', mode: 'elimination', tags: ['1v1'], requires: ['m1-1'],
    desc: 'A regular at the rec center wants to see if the new kid is any good. Best of three, one on one.',
    build: cfg('m1-2', 'Pickup Game', { arena: 'rec', away: [makeProfile({ id: 'dex', name: 'Dex', kit: KITS.rec, personality: 'balanced', tier: 1, hair: 'short', seed: 42 })], tier: 1, xp: 140, cred: 90, balls: 3, court: SMALL, subtitle: 'DEX' }),
  },
  {
    id: 'm1-3', chapter: 'c1', title: 'League Opener', opponent: 'Maplewood Regulars', tags: ['2v2'], requires: ['m1-2'],
    desc: 'Your first league night. A teammate has your back — the Regulars have been playing together for years.',
    build: cfg('m1-3', 'League Opener', { arena: 'rec', away: team(KITS.rec, 2, 1, ['aggressor', 'defender'], 3), mates: mates(1, 1, 3), tier: 1, xp: 170, cred: 110, balls: 3, court: MID, subtitle: 'REGULARS' }),
  },
  {
    id: 'm1-4', chapter: 'c1', title: 'Rec League Final', opponent: 'Maplewood All-Stars', tags: ['3v3', 'Final'], requires: ['m1-3'],
    desc: 'Three on three for the rec league trophy. Win it and the street courts will start to hear your name.',
    build: cfg('m1-4', 'Rec League Final', { arena: 'rec', away: team(KITS.rec, 3, 2, ['aggressor', 'sniper', 'defender'], 4), mates: mates(2, 2, 4), tier: 2, xp: 220, cred: 160, balls: 4, subtitle: 'ALL-STARS' }),
    unlocks: { cred: 100 },
  },
  // ------------------------------------------------------------------ CH2
  {
    id: 'm2-1', chapter: 'c2', title: 'Harbor Hustle', opponent: 'Harbor Hustlers', tags: ['2v2'], requires: ['m1-4'],
    desc: 'The waterfront crew plays fast and dirty. Watch for quick throws off the pickup.',
    build: cfg('m2-1', 'Harbor Hustle', { arena: 'street', away: team(KITS.harbor, 2, 2, ['aggressor', 'speedster'], 5), mates: mates(1, 2, 5), tier: 2, xp: 240, cred: 150, balls: 3, court: MID, subtitle: 'HUSTLERS' }),
  },
  {
    id: 'm2-2', chapter: 'c2', title: 'King of the Court', opponent: 'Challengers', mode: 'survival', tags: ['Survival', '3 waves'], requires: ['m2-1'],
    desc: 'Hold the court against wave after wave of challengers. Your hearts carry over — survive all three waves.',
    build: cfg('m2-2', 'King of the Court', {
      arena: 'street', mode: 'survival', away: [], tier: 2, xp: 280, cred: 180, balls: 4, time: 0, court: MID, subtitle: 'CHALLENGERS',
      mates: mates(1, 2, 6),
      waves: [team(KITS.harbor, 1, 2, ['aggressor'], 60), team(KITS.harbor, 2, 2, ['sniper', 'defender'], 61), team(KITS.harbor, 2, 2, ['aggressor', 'speedster'], 62)],
      objective: 'Survive all waves',
    }),
  },
  {
    id: 'm2-3', chapter: 'c2', title: 'The Rival', opponent: "Jax 'Ricochet' Rourke", tags: ['Rival', '3v3'], boss: true, requires: ['m2-2'], introCinematic: 'rival',
    desc: 'Jax runs the harbor. He banks throws off the boards and never lets you forget it. Watch the angles.',
    build: cfg('m2-3', 'The Rival', { arena: 'street', away: [JAX(3), ...team(KITS.ricochet, 2, 2, ['aggressor', 'defender'], 7)], mates: mates(2, 2, 7), tier: 3, xp: 340, cred: 240, balls: 4, subtitle: 'RICOCHET CREW' }),
    unlocks: { cred: 150 },
  },
  // ------------------------------------------------------------------ CH3
  {
    id: 'm3-1', chapter: 'c3', title: 'Round of Eight', opponent: 'Eastside Eagles', tags: ['3v3', 'Tournament'], requires: ['m2-3'],
    desc: 'The invitational opens against a disciplined Eagles side. They catch well — make them move.',
    build: cfg('m3-1', 'Round of Eight', { arena: 'school', away: team(KITS.eagles, 3, 3, ['defender', 'sniper', 'tactician'], 8), mates: mates(2, 3, 8), tier: 3, xp: 360, cred: 230, balls: 4, subtitle: 'EAGLES' }),
  },
  {
    id: 'm3-2', chapter: 'c3', title: 'Semifinal', opponent: 'Westbrook Wolves', tags: ['3v3', 'Tournament'], requires: ['m3-1'],
    desc: 'The home team, a packed fieldhouse, and a crowd that wants you gone.',
    build: cfg('m3-2', 'Semifinal', { arena: 'school', away: team(KITS.wolves, 3, 3, ['aggressor', 'speedster', 'sniper'], 9), mates: mates(2, 3, 9), tier: 3, xp: 380, cred: 250, balls: 4, subtitle: 'WOLVES' }),
  },
  {
    id: 'm3-3', chapter: 'c3', title: 'Clock Run', opponent: 'Eagles Reserves', mode: 'timeAttack', tags: ['Time Attack', '60s'], requires: ['m3-2'],
    desc: 'An exhibition between rounds: eliminate all three opponents before the minute is up.',
    build: cfg('m3-3', 'Clock Run', { arena: 'school', mode: 'timeAttack', away: team(KITS.eagles, 3, 1, ['balanced', 'defender', 'speedster'], 10), mates: mates(2, 2, 10), tier: 2, xp: 300, cred: 220, balls: 5, rounds: 1, time: 60, objective: 'Eliminate everyone in 60 seconds', subtitle: 'RESERVES' }),
  },
  {
    id: 'm3-4', chapter: 'c3', title: 'Invitational Final', opponent: "Andre 'Brick' Okafor", tags: ['Boss', '3v3', 'Final'], boss: true, requires: ['m3-3'], introCinematic: 'brick',
    desc: 'The Wolves captain throws power shots that knock the ball out of ordinary hands. Perfect catches only.',
    build: cfg('m3-4', 'Invitational Final', { arena: 'school', away: [BRICK(), ...team(KITS.wolves, 2, 3, ['defender', 'aggressor'], 11)], mates: mates(2, 3, 11), tier: 4, xp: 460, cred: 320, balls: 4, subtitle: 'WOLVES' }),
    unlocks: { cred: 200 },
  },
  // ------------------------------------------------------------------ CH4
  {
    id: 'm4-1', chapter: 'c4', title: 'Rooftop Rumble', opponent: 'Skyline Vipers', tags: ['3v3'], requires: ['m3-4'],
    desc: 'The city league plays under the skyline. The Vipers coordinate crossfire throws — never stand still.',
    build: cfg('m4-1', 'Rooftop Rumble', { arena: 'rooftop', away: team(KITS.vipers, 3, 4, ['aggressor', 'tactician', 'sniper'], 12), mates: mates(2, 4, 12), tier: 4, xp: 480, cred: 320, balls: 4, subtitle: 'VIPERS' }),
  },
  {
    id: 'm4-2', chapter: 'c4', title: 'Ricochet Night', opponent: 'Metro Titans', tags: ['3v3', 'Special Rules'], requires: ['m4-1'],
    desc: 'League special: every throw banks off the boards and seeks a target. Angles are everything.',
    build: cfg('m4-2', 'Ricochet Night', { arena: 'rooftop', away: team(KITS.titans, 3, 4, ['powerhouse', 'defender', 'aggressor'], 13), mates: mates(2, 4, 13), tier: 4, xp: 500, cred: 340, balls: 4, rules: { ricochet: true }, objective: 'Special rules: all throws ricochet', subtitle: 'TITANS' }),
  },
  {
    id: 'm4-3', chapter: 'c4', title: 'Rival Rematch', opponent: "Jax 'Ricochet' Rourke", tags: ['Rival', 'Boss', '3v3'], boss: true, requires: ['m4-2'], introCinematic: 'rematch', outroCinematic: 'awakening',
    desc: 'Jax has been training. So have you. Settle it under the city lights.',
    build: cfg('m4-3', 'Rival Rematch', { arena: 'rooftop', away: [JAX(5), ...team(KITS.ricochet, 2, 4, ['speedster', 'sniper'], 14)], mates: mates(2, 4, 14), tier: 5, xp: 600, cred: 420, balls: 4, subtitle: 'RICOCHET CREW' }),
    unlocks: { ultimate: true, cred: 250 },
  },
  // ------------------------------------------------------------------ CH5
  {
    id: 'm5-1', chapter: 'c5', title: 'Iron Syndicate', opponent: 'Iron Syndicate', tags: ['3v3', 'Cover'], requires: ['m4-3'],
    desc: 'The Pit has cover blocks on both halves. Use them — and use the boards to throw around them.',
    build: cfg('m5-1', 'Iron Syndicate', { arena: 'underground', away: team(KITS.syndicate, 3, 5, ['powerhouse', 'sniper', 'tactician'], 15), mates: mates(2, 5, 15), tier: 5, xp: 620, cred: 420, balls: 4, subtitle: 'SYNDICATE' }),
  },
  {
    id: 'm5-2', chapter: 'c5', title: 'The Gauntlet', opponent: 'Underground Elites', mode: 'survival', tags: ['Survival', '4 waves'], requires: ['m5-1'],
    desc: 'Four waves of elite challengers. The Pit does not care how tired you are.',
    build: cfg('m5-2', 'The Gauntlet', {
      arena: 'underground', mode: 'survival', away: [], tier: 5, xp: 700, cred: 480, balls: 4, time: 0, subtitle: 'ELITES', mates: mates(2, 5, 16),
      waves: [team(KITS.syndicate, 2, 4, ['aggressor', 'sniper'], 70), team(KITS.phantoms, 2, 5, ['speedster', 'tactician'], 71), team(KITS.syndicate, 3, 5, ['powerhouse', 'defender', 'aggressor'], 72), team(KITS.phantoms, 3, 5, ['sniper', 'speedster', 'tactician'], 73)],
      objective: 'Survive all waves',
    }),
  },
  {
    id: 'm5-3', chapter: 'c5', title: 'Shade', opponent: 'Vanta', tags: ['Boss', '3v3'], boss: true, requires: ['m5-2'], introCinematic: 'vanta',
    desc: 'Vanta blinks across the court and leaves afterimages behind. Watch the real one — and punish her recovery.',
    build: cfg('m5-3', 'Shade', { arena: 'underground', away: [VANTA(), ...team(KITS.phantoms, 2, 5, ['defender', 'sniper'], 17)], mates: mates(2, 5, 17), tier: 6, xp: 760, cred: 520, balls: 4, subtitle: 'PHANTOMS' }),
    unlocks: { cred: 300, points: 2 },
  },
  // ------------------------------------------------------------------ CH6
  {
    id: 'm6-1', chapter: 'c6', title: 'Quarterfinal', opponent: 'Night Phantoms', tags: ['3v3', 'Championship'], requires: ['m5-3'],
    desc: 'The Crown Championship begins. Twenty thousand fans and every camera in the city.',
    build: cfg('m6-1', 'Quarterfinal', { arena: 'stadium', away: team(KITS.phantoms, 3, 5, ['speedster', 'tactician', 'sniper'], 18), mates: mates(2, 5, 18), tier: 5, xp: 780, cred: 520, balls: 4, subtitle: 'PHANTOMS' }),
  },
  {
    id: 'm6-2', chapter: 'c6', title: 'Semifinal', opponent: 'Metro Titans', tags: ['3v3', 'Championship'], requires: ['m6-1'],
    desc: 'The Titans are coordinated, powerful and patient. Break their formation.',
    build: cfg('m6-2', 'Semifinal', { arena: 'stadium', away: team(KITS.titans, 3, 6, ['powerhouse', 'tactician', 'defender'], 19), mates: mates(2, 5, 19), tier: 6, xp: 820, cred: 560, balls: 4, rounds: 2, subtitle: 'TITANS' }),
  },
  {
    id: 'm6-3', chapter: 'c6', title: 'Grand Final', opponent: 'Regina Vale', tags: ['Boss', 'Final', 'Best of 5'], boss: true, requires: ['m6-2'], introCinematic: 'regina',
    desc: 'The reigning champion reflects throws straight back at you. Her team protects her. Best of five.',
    build: cfg('m6-3', 'Grand Final', { arena: 'stadium', away: [REGINA(), ...team(KITS.royals, 2, 6, ['sniper', 'aggressor'], 20)], mates: mates(2, 6, 20), tier: 6, xp: 950, cred: 700, balls: 4, rounds: 3, subtitle: 'ROYALS' }),
    unlocks: { cred: 400, points: 2 },
  },
  // ------------------------------------------------------------------ CH7
  {
    id: 'm7-1', chapter: 'c7', title: 'Into the Eclipse', opponent: 'The Eclipsed', tags: ['3v3', 'Supernatural'], requires: ['m6-3'], introCinematic: 'eclipse',
    desc: 'Shadows that play like champions. The court itself pulses with strange energy.',
    build: cfg('m7-1', 'Into the Eclipse', { arena: 'eclipse', away: team(KITS.eclipse, 3, 6, ['speedster', 'tactician', 'powerhouse'], 21), mates: mates(2, 6, 21), tier: 6, xp: 1000, cred: 700, balls: 4, subtitle: 'ECLIPSED' }),
  },
  {
    id: 'm7-2', chapter: 'c7', title: 'Overthrow', opponent: 'The Monarch', tags: ['Final Boss'], boss: true, requires: ['m7-1'], introCinematic: 'monarch', outroCinematic: 'ending',
    desc: 'The Monarch has never lost. Four hearts, every technique you know — and an ultimate of their own.',
    build: cfg('m7-2', 'Overthrow', { arena: 'eclipse', away: [MONARCH(), ...team(KITS.eclipse, 2, 6, ['defender', 'sniper'], 22)], mates: mates(2, 6, 22), tier: 6, xp: 1400, cred: 1000, balls: 4, rounds: 2, time: 120, rules: { hazards: true }, subtitle: 'THE MONARCH' }),
  },
];

export const MATCH_BY_ID = Object.fromEntries(MATCHES.map((m) => [m.id, m])) as Record<string, CampaignMatch>;

export function chapterMatches(ch: string) {
  return MATCHES.filter((m) => m.chapter === ch);
}

export function isUnlocked(m: CampaignMatch, completed: Record<string, unknown>) {
  return (m.requires ?? []).every((r) => r in completed);
}

export function chapterUnlocked(ch: ChapterDef, completed: Record<string, unknown>) {
  const first = MATCHES.find((m) => m.chapter === ch.id);
  return !!first && isUnlocked(first, completed);
}

/** Quick-match options */
export const QUICK_ARENAS = ['rec', 'street', 'school', 'rooftop', 'underground', 'stadium', 'eclipse'];
export const QUICK_KITS = ['harbor', 'wolves', 'eagles', 'vipers', 'titans', 'syndicate', 'phantoms', 'royals', 'eclipse'];
