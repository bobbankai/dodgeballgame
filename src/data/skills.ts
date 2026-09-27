import type { Perks } from '../game/Stats';

export type BranchId = 'power' | 'technique' | 'mobility' | 'defense' | 'special';

export interface SkillNode {
  id: string;
  branch: BranchId;
  name: string;
  kind: 'mechanic' | 'ability' | 'passive' | 'ultimate';
  desc: string;
  detail: string;
  cost: number;
  level: number;
  requires: string[];
  icon: string;
  apply?: (p: Perks) => void;
  /** Ability id unlocked by this node. */
  ability?: string;
  /** Needs the story-unlocked ultimate. */
  needsUltimate?: boolean;
}

export const BRANCHES: { id: BranchId; name: string; color: string; blurb: string }[] = [
  { id: 'power', name: 'Power', color: '#ff6a3d', blurb: 'Hit harder. Break guards.' },
  { id: 'technique', name: 'Technique', color: '#27e0d0', blurb: 'Outsmart. Curve. Deceive.' },
  { id: 'mobility', name: 'Mobility', color: '#8fd8ff', blurb: 'Be impossible to pin down.' },
  { id: 'defense', name: 'Defense', color: '#7cf29a', blurb: 'Catch everything.' },
  { id: 'special', name: 'Special', color: '#ffd166', blurb: 'Bend the game itself.' },
];

export const SKILLS: SkillNode[] = [
  // ------------------------------------------------------------------ POWER
  {
    id: 'heavyArm', branch: 'power', name: 'Heavy Arm', kind: 'passive', icon: 'bolt', cost: 150, level: 2, requires: [],
    desc: 'Charge 20% faster; fully charged throws fly faster.',
    detail: 'Your wind-up gathers force quicker and full-charge throws gain extra velocity — the gap between a quick throw and a real throw grows.',
    apply: (p) => (p.heavyArm = true),
  },
  {
    id: 'powerShot', branch: 'power', name: 'Power Shot', kind: 'ability', icon: 'bolt', cost: 320, level: 4, requires: ['heavyArm'], ability: 'powerShot',
    desc: 'ABILITY (Q): your next throw becomes a blazing Power Shot.',
    detail: 'Energy gathers into the ball during a heavier wind-up. Power Shots travel at extreme speed, deal 2 damage and can only be held with a perfectly timed catch.',
  },
  {
    id: 'shockwave', branch: 'power', name: 'Shockwave', kind: 'mechanic', icon: 'sun', cost: 450, level: 7, requires: ['powerShot'],
    desc: 'Power Shots and perfect releases burst on impact.',
    detail: 'Impacts release a pressure wave that staggers nearby opponents and knocks balls out of their hands.',
    apply: (p) => (p.shockwave = true),
  },
  {
    id: 'guardBreak', branch: 'power', name: 'Guard Breaker', kind: 'mechanic', icon: 'shield', cost: 600, level: 10, requires: ['shockwave'],
    desc: 'Full-charge throws must be caught perfectly.',
    detail: 'Any fully charged throw becomes "heavy": ordinary catches and blocks fumble. Only a perfect catch holds it.',
    apply: (p) => (p.guardBreak = true),
  },
  {
    id: 'meteor', branch: 'power', name: 'Meteor Drive', kind: 'ultimate', icon: 'sun', cost: 900, level: 14, requires: ['guardBreak'], needsUltimate: true,
    desc: 'OVERTHROW impact radius +60% and it damages everyone caught in it.',
    detail: 'The ultimate lands like a meteor: a far wider shockwave that hurts every opponent it touches.',
  },
  // ------------------------------------------------------------------ TECHNIQUE
  {
    id: 'curve', branch: 'technique', name: 'Curveball', kind: 'mechanic', icon: 'wind', cost: 150, level: 2, requires: [],
    desc: 'Hold left/right while releasing to bend the throw.',
    detail: 'Sidespin curves the ball around defenders. The throw still arrives at your target — it just comes from an angle they did not expect. AI opponents read curves much worse than straight throws.',
    apply: (p) => (p.curve = true),
  },
  {
    id: 'fake', branch: 'technique', name: 'Pump Fake', kind: 'mechanic', icon: 'eye', cost: 250, level: 3, requires: [],
    desc: 'Press CATCH while charging to fake the throw.',
    detail: 'Sell the throw, then hold it. Opponents who read your wind-up will dodge or reach for a catch that never comes — and they are wide open.',
    apply: (p) => (p.fake = true),
  },
  {
    id: 'perfectRelease', branch: 'technique', name: 'Sweet Spot', kind: 'passive', icon: 'target', cost: 400, level: 6, requires: ['curve'],
    desc: 'Much wider perfect-release window.',
    detail: 'Releasing just as the charge peaks is easier, and perfect releases fly faster and truer.',
    apply: (p) => (p.perfectRelease = true),
  },
  {
    id: 'ricochet', branch: 'technique', name: 'Bank Shot', kind: 'mechanic', icon: 'wind', cost: 550, level: 9, requires: ['perfectRelease'],
    desc: 'Wall ricochets keep full speed and home in.',
    detail: 'Throw into the boards: the ball rebounds at full speed and seeks the nearest opponent. Hit people hiding behind the angle.',
    apply: (p) => (p.ricochet = true),
  },
  {
    id: 'phantom', branch: 'technique', name: 'Phantom Throw', kind: 'ability', icon: 'eye', cost: 800, level: 12, requires: ['ricochet', 'fake'], ability: 'phantom',
    desc: 'ABILITY (Q): a decoy flies true while the real ball vanishes.',
    detail: 'A phantom ball follows the obvious line. The real one turns invisible and bends in from another angle, reappearing only at the last moment.',
  },
  // ------------------------------------------------------------------ MOBILITY
  {
    id: 'swiftFeet', branch: 'mobility', name: 'Swift Feet', kind: 'passive', icon: 'wind', cost: 120, level: 1, requires: [],
    desc: 'Higher top speed and sharper acceleration.',
    detail: 'Change direction faster and reach loose balls first.',
    apply: (p) => (p.swiftFeet = true),
  },
  {
    id: 'secondWind', branch: 'mobility', name: 'Second Wind', kind: 'passive', icon: 'wind', cost: 300, level: 4, requires: ['swiftFeet'],
    desc: '+1 dodge charge.',
    detail: 'Chain dodges back to back to escape crossfire.',
    apply: (p) => (p.extraDodge += 1),
  },
  {
    id: 'perfectDodge', branch: 'mobility', name: 'Perfect Dodge', kind: 'mechanic', icon: 'eye', cost: 400, level: 6, requires: ['secondWind'],
    desc: 'Last-instant dodges slow time and refund the dodge.',
    detail: 'Dodge through a ball at the final moment to trigger slow motion, refund the charge and gain energy.',
    apply: (p) => (p.perfectDodge = true),
  },
  {
    id: 'slideThrow', branch: 'mobility', name: 'Slide Throw', kind: 'mechanic', icon: 'bolt', cost: 500, level: 9, requires: ['perfectDodge'],
    desc: 'Start charging mid-dodge.',
    detail: 'Your dash never breaks your wind-up: dodge, slide and fire in one motion.',
    apply: (p) => (p.slideThrow = true),
  },
  {
    id: 'blink', branch: 'mobility', name: 'Blink Step', kind: 'ability', icon: 'wind', cost: 750, level: 12, requires: ['slideThrow'], ability: 'blink',
    desc: 'ABILITY (Q): phase-dash and leave a decoy behind.',
    detail: 'A long invulnerable dash. An afterimage lingers where you stood — opponents waste their throws on it.',
  },
  // ------------------------------------------------------------------ DEFENSE
  {
    id: 'softHands', branch: 'defense', name: 'Soft Hands', kind: 'passive', icon: 'shield', cost: 150, level: 2, requires: [],
    desc: 'Much wider catch window.',
    detail: 'Catching gets more forgiving: the window after pressing catch lasts longer.',
    apply: (p) => (p.softHands = true),
  },
  {
    id: 'perfectCatch', branch: 'defense', name: 'Perfect Catch', kind: 'mechanic', icon: 'star', cost: 300, level: 3, requires: [],
    desc: 'Catch at the last instant for a perfect catch.',
    detail: 'Time your catch right as the ball arrives: slow motion, full stamina, a burst of energy — and the only way to hold heavy throws.',
    apply: (p) => (p.perfectCatch = true),
  },
  {
    id: 'counterThrow', branch: 'defense', name: 'Counter Throw', kind: 'mechanic', icon: 'bolt', cost: 450, level: 6, requires: ['perfectCatch'],
    desc: 'Perfect catches instantly charge your next throw.',
    detail: 'Turn defense into offense: after a perfect catch your next throw is fully charged immediately and hits harder.',
    apply: (p) => (p.counterThrow = true),
  },
  {
    id: 'deflect', branch: 'defense', name: 'Deflect', kind: 'mechanic', icon: 'shield', cost: 600, level: 9, requires: ['counterThrow'],
    desc: 'Block throws with the ball you hold; perfect blocks reflect.',
    detail: 'Hold CATCH while carrying a ball to parry. Block at the last instant to send the throw straight back at its owner.',
    apply: (p) => {
      p.deflect = true;
      p.reflect = true;
    },
  },
  {
    id: 'ironHands', branch: 'defense', name: 'Iron Body', kind: 'passive', icon: 'shield', cost: 900, level: 13, requires: ['deflect'],
    desc: '+1 heart. Catch heavy throws with normal timing.',
    detail: 'Take an extra hit, and power throws no longer knock the ball out of your hands.',
    apply: (p) => {
      p.ironHands = true;
      p.extraHearts += 1;
    },
  },
  // ------------------------------------------------------------------ SPECIAL
  {
    id: 'focus', branch: 'special', name: 'Focus', kind: 'passive', icon: 'star', cost: 200, level: 5, requires: [],
    desc: '+30% energy gain.',
    detail: 'Abilities come back online much faster.',
    apply: (p) => (p.focus = true),
  },
  {
    id: 'overcharge', branch: 'special', name: 'Overcharge', kind: 'passive', icon: 'sun', cost: 400, level: 8, requires: ['focus'], needsUltimate: true,
    desc: 'Ultimate meter builds 25% faster.',
    detail: 'Every hit, catch and dodge feeds OVERTHROW faster.',
    apply: (p) => (p.overcharge = true),
  },
  {
    id: 'supernova', branch: 'special', name: 'Supernova', kind: 'ultimate', icon: 'crown', cost: 1000, level: 15, requires: ['overcharge'], needsUltimate: true,
    desc: 'OVERTHROW chains through two more opponents.',
    detail: 'After the first impact the ball ricochets onward, seeking up to two additional targets.',
    apply: (p) => (p.supernova = true),
  },
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillNode>;

export const ABILITIES: Record<string, { name: string; cost: number; icon: string; desc: string }> = {
  powerShot: { name: 'Power Shot', cost: 50, icon: 'bolt', desc: 'Next throw becomes a Power Shot.' },
  phantom: { name: 'Phantom Throw', cost: 55, icon: 'eye', desc: 'Decoy + invisible real ball.' },
  blink: { name: 'Blink Step', cost: 40, icon: 'wind', desc: 'Invulnerable phase-dash with decoy.' },
};
