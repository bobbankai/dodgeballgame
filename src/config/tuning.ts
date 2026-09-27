/**
 * Central gameplay tuning. Units: metres, seconds, m/s.
 * Everything that affects game feel lives here so it can be tweaked in one place.
 */
export const TUNING = {
  gravity: 9.81,

  athlete: {
    radius: 0.34,
    height: 1.78,
    chestHeight: 1.28,
    /** Minimum distance kept from the centre line. */
    centerMargin: 0.4,
    wallMargin: 0.42,
  },

  move: {
    jog: 5.0,
    sprint: 7.2,
    chargeWalk: 3.2,
    catchWalk: 2.0,
    throwWalk: 2.4,
    accel: 30,
    decel: 36,
    sprintAccel: 22,
    turnSharpness: 16,
    sprintTurnSharpness: 9,
  },

  stamina: {
    max: 100,
    sprintDrain: 26,
    regen: 22,
    regenDelay: 0.55,
    minToSprint: 12,
  },

  dodge: {
    distance: 3.5,
    duration: 0.3,
    iframeStart: 0.02,
    iframeEnd: 0.22,
    recover: 0.08,
    charges: 2,
    rechargeTime: 1.55,
    perfectRadius: 1.3,
  },

  throw: {
    quickSpeed: 17,
    chargedSpeed: 26,
    chargeTime: 0.85,
    /** window after reaching full charge that counts as a perfect release */
    perfectWindow: 0.2,
    perfectBonus: 1.12,
    /** hold shorter than this = quick throw */
    quickThreshold: 0.14,
    /** gravity multiplier while a thrown ball is live (flatter, readable arcs) */
    liveGravity: 0.5,
    recover: 0.3,
    momentumCarry: 0.35,
    baseAimErrorDeg: 3.6,
    maxRange: 30,
  },

  catch: {
    window: 0.3,
    perfectWindow: 0.085,
    whiffRecover: 0.4,
    reach: 0.8,
    frontDot: 0.1,
    counterDuration: 2.5,
  },

  ball: {
    radius: 0.12,
    floorRestitution: 0.6,
    wallRestitution: 0.74,
    floorFriction: 0.82,
    rollDecel: 1.6,
    pickupRadius: 0.95,
    pickupMaxHeight: 1.35,
    pickupMaxSpeed: 9,
    maxWallBouncesLive: 2,
    hitRebound: 0.28,
  },

  damage: {
    hitstun: 0.48,
    knockback: 3.2,
    powerKnockback: 6,
    invulnAfterHit: 0.75,
  },

  energy: {
    max: 100,
    passive: 1.2,
    hit: 12,
    catch: 16,
    perfectCatch: 28,
    perfectDodge: 16,
    perfectRelease: 6,
    gotHit: 6,
  },

  ult: {
    max: 100,
    hit: 11,
    catch: 14,
    perfectCatch: 24,
    perfectDodge: 10,
    gotHit: 9,
    ko: 8,
  },

  feel: {
    hitStopNormal: 0.055,
    hitStopPower: 0.12,
    hitStopKO: 0.1,
    perfectCatchSlowmo: 0.5,
    perfectDodgeSlowmo: 0.4,
  },

  round: {
    timeLimit: 100,
    countdown: 3,
    reviveOnCatch: true,
  },
} as const;
