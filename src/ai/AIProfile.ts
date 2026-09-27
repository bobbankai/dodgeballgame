import type { PersonalityId } from '../game/Athlete';

/** Decision-making parameters for an AI athlete. */
export interface AIParams {
  /** Seconds after a throw before the AI perceives the ball. */
  reaction: number;
  /** Std-dev (s) of catch/dodge timing error. */
  timingSigma: number;
  /** Probability of responding correctly to a threat at all. */
  awareness: number;
  catchBias: number;
  dodgeBias: number;
  aimErrorMul: number;
  lead: number;
  decisionInterval: number;
  coordination: number;
  fakeChance: number;
  curveChance: number;
  perfectReleaseSkill: number;
  abilityUse: number;
  aggression: number;
  /** preferred distance from the centre line while holding a ball */
  attackDepth: number;
  /** preferred distance from the centre line when not holding */
  restDepth: number;
  /** fraction of full charge preferred (0 = quick throws) */
  chargeTendency: number;
  maxHold: number;
  jukeAmount: number;
  passChance: number;
  protect: boolean;
  /** How strongly this AI prefers targeting the human player (0..1). */
  playerFocus: number;
}

const TIER = {
  reaction: [0.95, 0.52, 0.42, 0.33, 0.27, 0.22, 0.18],
  timingSigma: [0.25, 0.13, 0.1, 0.08, 0.066, 0.054, 0.045],
  awareness: [0.1, 0.45, 0.6, 0.72, 0.8, 0.87, 0.92],
  aimErrorMul: [3, 1.9, 1.5, 1.2, 1.0, 0.85, 0.72],
  lead: [0, 0.2, 0.35, 0.5, 0.62, 0.75, 0.85],
  decisionInterval: [1.0, 0.6, 0.45, 0.36, 0.3, 0.24, 0.2],
  coordination: [0, 0, 0.15, 0.4, 0.6, 0.8, 0.9],
  fakeChance: [0, 0, 0, 0.06, 0.12, 0.2, 0.25],
  curveChance: [0, 0, 0.05, 0.12, 0.2, 0.3, 0.35],
  perfectReleaseSkill: [0, 0, 0.1, 0.25, 0.4, 0.55, 0.7],
  abilityUse: [0, 0, 0, 0.2, 0.4, 0.65, 0.9],
};

export function aiParams(personality: PersonalityId, tier: number): AIParams {
  const t = Math.max(0, Math.min(6, Math.round(tier)));
  const p: AIParams = {
    reaction: TIER.reaction[t],
    timingSigma: TIER.timingSigma[t],
    awareness: TIER.awareness[t],
    catchBias: 0.5,
    dodgeBias: 0.5,
    aimErrorMul: TIER.aimErrorMul[t],
    lead: TIER.lead[t],
    decisionInterval: TIER.decisionInterval[t],
    coordination: TIER.coordination[t],
    fakeChance: TIER.fakeChance[t],
    curveChance: TIER.curveChance[t],
    perfectReleaseSkill: TIER.perfectReleaseSkill[t],
    abilityUse: TIER.abilityUse[t],
    aggression: 0.55,
    attackDepth: 4,
    restDepth: 5,
    chargeTendency: 0.5,
    maxHold: 5,
    jukeAmount: 0.4,
    passChance: 0.1,
    protect: false,
    playerFocus: 0.3,
  };
  switch (personality) {
    case 'aggressor':
      Object.assign(p, { aggression: 0.92, attackDepth: 2.0, restDepth: 3.2, chargeTendency: 0.3, catchBias: 0.35, dodgeBias: 0.6, maxHold: 2.6, jukeAmount: 0.5, playerFocus: 0.55 });
      break;
    case 'defender':
      Object.assign(p, { aggression: 0.4, attackDepth: 4.5, restDepth: 4.5, chargeTendency: 0.6, catchBias: 0.9, dodgeBias: 0.3, maxHold: 5.5, protect: true, jukeAmount: 0.25 });
      p.timingSigma *= 0.85;
      break;
    case 'sniper':
      Object.assign(p, { aggression: 0.55, attackDepth: 7.2, restDepth: 7.5, chargeTendency: 1.0, catchBias: 0.35, dodgeBias: 0.65, maxHold: 6, jukeAmount: 0.3, playerFocus: 0.45 });
      p.aimErrorMul *= 0.7;
      p.lead = Math.min(1, p.lead + 0.15);
      p.perfectReleaseSkill = Math.min(0.95, p.perfectReleaseSkill + 0.2);
      break;
    case 'speedster':
      Object.assign(p, { aggression: 0.75, attackDepth: 3.5, restDepth: 4.2, chargeTendency: 0.15, catchBias: 0.3, dodgeBias: 0.9, maxHold: 3, jukeAmount: 1.0 });
      p.awareness = Math.min(0.97, p.awareness + 0.08);
      p.reaction *= 0.85;
      break;
    case 'powerhouse':
      Object.assign(p, { aggression: 0.6, attackDepth: 3.8, restDepth: 5, chargeTendency: 1.0, catchBias: 0.7, dodgeBias: 0.25, maxHold: 5, jukeAmount: 0.15 });
      break;
    case 'tactician':
      Object.assign(p, { aggression: 0.5, attackDepth: 4.8, restDepth: 5.5, chargeTendency: 0.6, catchBias: 0.6, dodgeBias: 0.5, maxHold: 5, passChance: 0.4, jukeAmount: 0.35 });
      p.fakeChance += 0.15;
      p.coordination = Math.min(1, p.coordination + 0.25);
      p.lead = Math.min(1, p.lead + 0.1);
      break;
    case 'boss':
      Object.assign(p, { aggression: 0.8, attackDepth: 3.5, restDepth: 4.5, chargeTendency: 0.7, catchBias: 0.7, dodgeBias: 0.7, maxHold: 3.5, jukeAmount: 0.7, playerFocus: 0.8 });
      break;
    case 'dummy':
      Object.assign(p, { aggression: 0, attackDepth: 6, restDepth: 6, chargeTendency: 0.2, catchBias: 0, dodgeBias: 0, maxHold: 99, jukeAmount: 0.15, awareness: 0 });
      break;
    case 'balanced':
    default:
      break;
  }
  return p;
}
