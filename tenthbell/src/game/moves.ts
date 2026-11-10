// What every strike does, and who has which. Timing and reach are not here: they are read from the clips
// themselves (the Blender tools export when and where each strike lands), so rules and pictures agree.

export type Button = 'L' | 'H' | 'K' | 'S' | 'D';
export interface Move {
  clip: string;
  /** light 1, kick 2, heavy 3, special 4: a move that touched cancels into a higher level or the next of its chain */ level: number;
  dmg: number; /** seconds the victim cannot act */ stun: number; /** same when blocked */ block: number;
  /** push on the victim, m/s */ push: number; /** guard meter removed when blocked */ guard: number;
  /** metres the attacker travels before the first hit */ step?: number;
  /** what a clean hit does beyond stun */ fall?: 'stagger' | 'down';
  /** frozen frames on contact, seconds */ stop: number; shake: number; cost?: number; sound: 'light' | 'heavy' | 'kick' | 'bell';
  /** where it lands on the body, for the reaction clip */ zone: 'high' | 'body' | 'low';
  /** how much of the clip plays before recovery can be cancelled by blocking or moving again (fraction of its length) */ free?: number;
}

const m = (clip: string, level: number, dmg: number, stun: number, push: number, guard: number, zone: Move['zone'], sound: Move['sound'], x: Partial<Move> = {}): Move =>
  ({ clip, level, dmg, stun, block: stun * 0.55, push, guard, zone, sound, stop: 0.045 + dmg * 0.006, shake: dmg * 0.012, ...x });

export const MOVES: Record<string, Move> = {
  jab: m('jab', 1, 4, 0.30, 0.5, 6, 'high', 'light'),
  cross: m('cross', 1, 6, 0.36, 0.9, 9, 'high', 'light', { step: 0.12 }),
  hook: m('hook', 1, 8, 0.42, 1.1, 12, 'high', 'heavy', { step: 0.1 }),
  upper: m('upper', 3, 12, 0.5, 1.2, 20, 'high', 'heavy', { fall: 'stagger', step: 0.15 }),
  body: m('body', 3, 9, 0.46, 0.8, 14, 'body', 'heavy', { step: 0.12 }),
  lowkick: m('lowkick', 2, 6, 0.34, 0.6, 8, 'low', 'kick'),
  frontkick: m('frontkick', 2, 8, 0.4, 2.6, 12, 'body', 'kick'),
  roundhouse: m('roundhouse', 3, 14, 0.55, 1.6, 24, 'high', 'kick', { fall: 'down' }),
  knee: m('knee', 3, 11, 0.5, 1.0, 16, 'body', 'heavy', { step: 0.38 }),
  palm: m('palm', 4, 20, 0.6, 3.2, 45, 'body', 'bell', { fall: 'down', step: 0.55, cost: 50, stop: 0.2, shake: 0.5 }),
  overhead: m('overhead', 4, 22, 0.6, 2.2, 50, 'high', 'bell', { fall: 'down', step: 0.3, cost: 50, stop: 0.2, shake: 0.55 }),
};

export interface Kit {
  /** shown in the move list and on the health bar */ title: string;
  hp: number; /** damage multiplier */ power: number; /** walk speed multiplier */ speed: number;
  L: string[]; K: string[]; H: string; fH: string; bH: string; fK: string; S: string;
  /** AI: 0..1 how often it presses forward, blocks, and how quick it is to react */ ai: { press: number; guard: number; react: number; whiff: number };
}

export const KITS: Record<string, Kit> = {
  kessa: { title: 'KESSA VALE', hp: 100, power: 1, speed: 1.05, L: ['jab', 'cross', 'hook'], K: ['lowkick', 'roundhouse'], H: 'upper', fH: 'knee', bH: 'body', fK: 'frontkick', S: 'palm',
           ai: { press: 0.6, guard: 0.5, react: 0.3, whiff: 0.1 } },
  rook: { title: 'ROOK MALLOY', hp: 120, power: 1.15, speed: 0.82, L: ['jab', 'hook'], K: ['lowkick'], H: 'body', fH: 'upper', bH: 'body', fK: 'frontkick', S: 'overhead',
          ai: { press: 0.7, guard: 0.22, react: 0.5, whiff: 0.28 } },
  wren: { title: 'WREN TANAKA', hp: 90, power: 0.95, speed: 1.18, L: ['jab', 'cross'], K: ['lowkick', 'frontkick', 'roundhouse'], H: 'knee', fH: 'roundhouse', bH: 'body', fK: 'frontkick', S: 'palm',
          ai: { press: 0.45, guard: 0.55, react: 0.26, whiff: 0.12 } },
  dee: { title: 'DEE "THE SAINT" VALE', hp: 110, power: 1.1, speed: 1.0, L: ['jab', 'cross', 'hook'], K: ['lowkick', 'roundhouse'], H: 'upper', fH: 'knee', bH: 'body', fK: 'frontkick', S: 'palm',
         ai: { press: 0.5, guard: 0.62, react: 0.22, whiff: 0.08 } },
  crane: { title: 'SILAS CRANE', hp: 135, power: 1.25, speed: 0.95, L: ['jab', 'cross', 'hook'], K: ['lowkick', 'frontkick'], H: 'upper', fH: 'body', bH: 'body', fK: 'frontkick', S: 'overhead',
           ai: { press: 0.62, guard: 0.6, react: 0.2, whiff: 0.06 } },
};
