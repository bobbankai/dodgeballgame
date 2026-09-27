import { TUNING } from '../config/tuning';

export const ATTRIBUTE_KEYS = ['power', 'release', 'accuracy', 'catching', 'agility', 'evasion', 'stamina', 'control', 'special'] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];
export type Attributes = Record<AttributeKey, number>;

export const ATTRIBUTE_INFO: Record<AttributeKey, { name: string; desc: string }> = {
  power: { name: 'Throw Power', desc: 'Ball velocity and impact force.' },
  release: { name: 'Throw Speed', desc: 'Faster wind-up and charge time.' },
  accuracy: { name: 'Accuracy', desc: 'Tighter spread and stronger lock-on.' },
  catching: { name: 'Catching', desc: 'Wider catch and perfect-catch windows.' },
  agility: { name: 'Agility', desc: 'Top speed and acceleration.' },
  evasion: { name: 'Dodge', desc: 'Dodge distance, i-frames and recharge.' },
  stamina: { name: 'Stamina', desc: 'Longer sprints and faster recovery.' },
  control: { name: 'Control', desc: 'Curve strength and perfect-release window.' },
  special: { name: 'Special', desc: 'Energy gain and ability strength.' },
};

export const MAX_ATTRIBUTE = 10;

export function baseAttributes(v = 1): Attributes {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, v])) as Attributes;
}

/** Mechanics toggled by skills (player) or difficulty/personality (AI). */
export interface Perks {
  curve: boolean;
  fake: boolean;
  perfectCatch: boolean;
  counterThrow: boolean;
  deflect: boolean;
  reflect: boolean;
  perfectDodge: boolean;
  slideThrow: boolean;
  extraDodge: number;
  extraHearts: number;
  heavyArm: boolean;
  shockwave: boolean;
  guardBreak: boolean;
  ricochet: boolean;
  ironHands: boolean;
  diveCatch: boolean;
  swiftFeet: boolean;
  focus: boolean;
  overcharge: boolean;
  supernova: boolean;
  perfectRelease: boolean;
  softHands: boolean;
}

export function noPerks(): Perks {
  return {
    curve: false, fake: false, perfectCatch: false, counterThrow: false, deflect: false, reflect: false,
    perfectDodge: false, slideThrow: false, extraDodge: 0, extraHearts: 0, heavyArm: false, shockwave: false,
    guardBreak: false, ricochet: false, ironHands: false, diveCatch: false, swiftFeet: false, focus: false,
    overcharge: false, supernova: false, perfectRelease: false, softHands: false,
  };
}

/** Numbers actually used during play, derived from attributes + perks. */
export interface DerivedStats {
  quickSpeed: number;
  maxSpeed: number;
  chargeTime: number;
  aimErrorDeg: number;
  assist: number;
  catchWindow: number;
  perfectWindow: number;
  jog: number;
  sprint: number;
  accel: number;
  dodgeDistance: number;
  dodgeRecharge: number;
  dodgeCharges: number;
  iframeEnd: number;
  staminaMax: number;
  staminaRegen: number;
  curveStrength: number;
  perfectReleaseWindow: number;
  energyGain: number;
  abilityPower: number;
  maxHearts: number;
  /** catch strength: balls with power above this fumble on non-perfect catches */
  catchStrength: number;
}

export function deriveStats(a: Attributes, p: Perks, baseHearts = 2): DerivedStats {
  const l = (k: AttributeKey) => Math.max(0, Math.min(MAX_ATTRIBUTE, a[k]) - 1);
  const T = TUNING;
  return {
    quickSpeed: T.throw.quickSpeed + l('power') * 0.6,
    maxSpeed: T.throw.chargedSpeed + l('power') * 1.05 + (p.heavyArm ? 2.2 : 0),
    chargeTime: (T.throw.chargeTime - l('release') * 0.034) * (p.heavyArm ? 0.8 : 1),
    aimErrorDeg: T.throw.baseAimErrorDeg - l('accuracy') * 0.3,
    assist: 0.32 + l('accuracy') * 0.045,
    catchWindow: T.catch.window + l('catching') * 0.013 + (p.softHands ? 0.1 : 0),
    perfectWindow: T.catch.perfectWindow + l('catching') * 0.005 + (p.softHands ? 0.02 : 0),
    jog: T.move.jog + l('agility') * 0.11 + (p.swiftFeet ? 0.35 : 0),
    sprint: T.move.sprint + l('agility') * 0.15 + (p.swiftFeet ? 0.7 : 0),
    accel: T.move.accel + l('agility') * 1.6 + (p.swiftFeet ? 6 : 0),
    dodgeDistance: T.dodge.distance + l('evasion') * 0.08,
    dodgeRecharge: T.dodge.rechargeTime - l('evasion') * 0.06,
    dodgeCharges: T.dodge.charges + p.extraDodge,
    iframeEnd: T.dodge.iframeEnd + l('evasion') * 0.006,
    staminaMax: T.stamina.max + l('stamina') * 12,
    staminaRegen: T.stamina.regen + l('stamina') * 1.6,
    curveStrength: 10 + l('control') * 1.6,
    perfectReleaseWindow: T.throw.perfectWindow + l('control') * 0.012 + (p.perfectRelease ? 0.06 : 0),
    energyGain: (1 + l('special') * 0.06) * (p.focus ? 1.3 : 1),
    abilityPower: 1 + l('special') * 0.05,
    maxHearts: baseHearts + p.extraHearts,
    catchStrength: 1.05 + l('catching') * 0.03 + (p.ironHands ? 1 : 0),
  };
}
