import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { clamp, rng } from '../core/math';
import type { Athlete, Controller } from '../game/Athlete';
import type { Ball } from '../game/Ball';
import type { World } from '../game/World';
import { AIParams } from './AIProfile';
import type { TeamBrain } from './TeamBrain';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _p = new THREE.Vector3();
const _vel = new THREE.Vector3();

interface Threat {
  ball: Ball;
  eta: number;
  missOffset: THREE.Vector3;
  heavy: boolean;
}

interface Pending {
  kind: 'catch' | 'dodge' | 'block';
  at: number;
  dir?: THREE.Vector3;
  ball: Ball;
}

export interface AbilityUser {
  useAbility(a: Athlete): boolean;
  useUltimate(a: Athlete): boolean;
  abilityCost(a: Athlete): number;
}

/**
 * Tactical AI. Perceives thrown balls only after a reaction delay, reads visible
 * wind-ups, predicts trajectories and responds with human-like timing error.
 * Uses the exact same Athlete API as the player — no special powers.
 */
export const AI_DEBUG = { threats: 0, unaware: 0, catch: 0, dodge: 0, block: 0, noTools: 0, execCatch: 0, execCatchFail: 0, execDodge: 0, execDodgeFail: 0, stale: 0 };

export class AIController implements Controller {
  mode: 'retrieve' | 'attack' | 'position' = 'position';
  target: Athlete | null = null;
  claim: Ball | null = null;
  private decisionTimer = Math.random() * 0.3;
  private noticed = new Map<Ball, number>();
  private responded = new Set<Ball>();
  private pending: Pending | null = null;
  private holdTime = 0;
  private chargeGoal = 0.5;
  private perfectOffset = -1;
  private planFake = false;
  private faked = false;
  private planCurve = 0;
  private jukeTimer = 0;
  private jukeOffset = 0;
  private anchor = new THREE.Vector3();
  private waitCatchTimer = 0;
  private relayUntil = 0;
  abilities: AbilityUser | null = null;
  /** Tutorial / scripted behaviour hooks. */
  passive = false;
  noThrow = false;
  scriptMove: THREE.Vector3 | null = null;
  inVolley = false;
  volleyGo = false;
  /** Temporary aggression boost (boss phases). */
  rage = 0;
  private fooled = new Map<number, boolean>();
  /** Opponent we are watching wind up (enables anticipation). */
  private watch: Athlete | null = null;
  private watchSince = 0;

  constructor(
    public athlete: Athlete,
    public params: AIParams,
    public world: World,
    public brain: TeamBrain,
  ) {
    athlete.world = world;
  }

  onEvent(type: string) {
    if (type === 'relay') this.relayUntil = this.world.time.gameTime + 1.2;
  }

  private get now() {
    return this.world.time.gameTime;
  }

  private side() {
    return this.athlete.team === 0 ? 1 : -1;
  }

  update(dt: number) {
    const a = this.athlete;
    if (!a.canAct) {
      this.pending = null;
      return;
    }
    // --- read wind-ups: who is about to throw at me? ---
    const danger = this.brain.mostDangerousOpponent(a);
    if (danger && danger.isWindingUp && (danger.aimTarget === a || danger.aimTarget === null)) {
      if (this.watch !== danger) {
        this.watch = danger;
        this.watchSince = this.now;
      }
    } else if (this.watch && !(this.watch.isWindingUp || this.now - this.watch.lastThrowTime < 0.3)) this.watch = null;

    // --- reactive layer: threats ---
    this.handleThreats();
    if (this.pending && this.now >= this.pending.at) this.executePending();

    // --- deliberative layer ---
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.params.decisionInterval * (0.7 + Math.random() * 0.6);
      this.decide();
    }
    this.jukeTimer -= dt;
    if (this.jukeTimer <= 0) {
      this.jukeTimer = 0.45 + Math.random() * (1.4 - this.params.jukeAmount * 0.8);
      this.jukeOffset = (Math.random() * 2 - 1) * (0.6 + this.params.jukeAmount * 2.2);
    }

    if (this.scriptMove) {
      this.moveToward(this.scriptMove, false, 0.6);
      return;
    }
    if (a.ball) this.attack(dt);
    else if (this.claim && this.claim.state === 'loose' && !this.claim.live) this.retrieve();
    else this.position(dt);
  }

  // ------------------------------------------------------------------ perception
  private predict(ball: Ball, chest0: THREE.Vector3, maxT: number): { minD: number; t: number; offset: THREE.Vector3 } {
    const info = ball.info!;
    const me = this.athlete;
    _p.copy(ball.pos);
    _vel.copy(ball.vel);
    const g = TUNING.gravity * info.gravityScale;
    const step = 0.02;
    let minD = Infinity, tMin = 0;
    const off = new THREE.Vector3();
    const chest = new THREE.Vector3();
    for (let t = 0; t <= maxT; t += step) {
      // our own motion over the next fraction of a second (decays: we'd react/brake)
      const k = Math.min(t, 0.35);
      chest.set(chest0.x + me.vel.x * k, chest0.y, chest0.z + me.vel.z * k);
      const d = _p.distanceTo(chest);
      if (d < minD) {
        minD = d;
        tMin = t;
        off.subVectors(_p, chest);
      }
      if (d > minD + 1.5) break;
      _vel.y -= g * step;
      if (info.curve) _vel.addScaledVector(info.curve, step);
      _p.addScaledVector(_vel, step);
      if (_p.y < 0.1) break;
    }
    return { minD, t: tMin, offset: off };
  }

  private handleThreats() {
    const a = this.athlete;
    if (this.params.awareness <= 0 || this.passive) return;
    const chest = a.chestPos(new THREE.Vector3());
    let best: Threat | null = null;
    for (const b of this.world.balls.balls) {
      if (!b.live || !b.info || !b.thrower || b.thrower.team === a.team || b.ignore.has(a)) continue;
      if (b.hiddenTimer > 0) continue; // phantom: invisible
      let seen = this.noticed.get(b);
      if (seen === undefined || b.info.time < 0.05 && seen < this.now - 2) {
        // anticipation: a wind-up we were already watching is read much faster
        const anticipated = this.watch === b.thrower && this.now - this.watchSince > 0.12;
        const react = this.params.reaction * (anticipated ? 0.42 : 1);
        seen = this.now + react * (0.75 + Math.random() * 0.6) - b.info.time;
        this.noticed.set(b, seen);
        this.responded.delete(b);
      }
      if (this.now < seen) continue;
      const pr = this.predict(b, chest, 1.4);
      if (pr.minD > 0.85) continue;
      const catchReach = TUNING.catch.reach + 0.3;
      const eta = Math.max(0, pr.t - catchReach / Math.max(8, b.speed));
      if (!best || eta < best.eta) best = { ball: b, eta, missOffset: pr.offset, heavy: (b.info.power > a.stats.catchStrength) || b.info.kind === 'ultimate' };
    }
    if (!best || this.responded.has(best.ball)) return;
    this.responded.add(best.ball);
    AI_DEBUG.threats++;
    // awareness roll: sometimes the AI simply doesn't react
    if (Math.random() > this.params.awareness) {
      AI_DEBUG.unaware++;
      return;
    }
    this.chooseResponse(best);
  }

  private chooseResponse(th: Threat) {
    const a = this.athlete;
    const p = this.params;
    const canCatch = !a.ball && a.catchCooldown <= 0 && (a.state === 'free' || a.state === 'catchRecover');
    const canBlock = !!a.ball && a.perks.deflect;
    const canDodge = a.dodgeCharges >= 1;
    let wCatch = canCatch ? p.catchBias : 0;
    if (th.heavy) wCatch *= a.perks.perfectCatch ? 0.4 : 0.05;
    if (th.ball.info?.curve) wCatch *= 0.7;
    if (th.ball.info?.kind === 'phantom') wCatch *= 0.6;
    const wDodge = canDodge ? p.dodgeBias + (th.heavy ? 0.4 : 0) : 0;
    const wBlock = canBlock ? 0.6 : 0;
    const total = wCatch + wDodge + wBlock;
    const sigma = p.timingSigma;
    const now = this.now;
    if (total <= 0) {
      AI_DEBUG.noTools++;
      // no tools: try to side-step
      const dir = this.sideStepDir(th);
      this.pending = null;
      a.move.copy(dir);
      return;
    }
    let r = Math.random() * total;
    if ((r -= wCatch) < 0) {
      const tryPerfect = a.perks.perfectCatch && (th.heavy || Math.random() < p.perfectReleaseSkill);
      const lead = tryPerfect ? a.stats.perfectWindow * 0.55 : a.stats.catchWindow * 0.45;
      this.pending = { kind: 'catch', at: now + th.eta - lead + rng.gauss(0, sigma), ball: th.ball };
      AI_DEBUG.catch++;
    } else if ((r -= wDodge) < 0) {
      this.pending = { kind: 'dodge', at: now + th.eta - 0.14 + rng.gauss(0, sigma * 0.8), dir: this.sideStepDir(th), ball: th.ball };
      AI_DEBUG.dodge++;
    } else {
      this.pending = { kind: 'block', at: now + th.eta - 0.1 + rng.gauss(0, sigma), ball: th.ball };
    }
  }

  private sideStepDir(th: Threat): THREE.Vector3 {
    const a = this.athlete;
    const v = _v.copy(th.ball.vel).setY(0).normalize();
    const perp = new THREE.Vector3(-v.z, 0, v.x);
    // move away from the side the ball is going to pass on
    let sign = th.missOffset.dot(perp) > 0 ? -1 : 1;
    // avoid walls
    const hw = this.world.court.halfWidth - 1.2;
    const probe = a.pos.x + perp.x * sign * 3;
    if (Math.abs(probe) > hw) sign = -sign;
    return perp.multiplyScalar(sign);
  }

  private executePending() {
    const a = this.athlete;
    const pd = this.pending!;
    this.pending = null;
    if (!pd.ball.live) {
      AI_DEBUG.stale++;
      return;
    }
    if (pd.kind === 'catch') {
      if (a.startCatch()) AI_DEBUG.execCatch++;
      else AI_DEBUG.execCatchFail++;
    } else if (pd.kind === 'dodge') {
      if (a.dodge(pd.dir!)) AI_DEBUG.execDodge++;
      else AI_DEBUG.execDodgeFail++;
    }
    else a.startCatch(); // block when holding
  }

  // ------------------------------------------------------------------ decisions
  private decide() {
    const a = this.athlete;
    if (a.ball) {
      this.mode = 'attack';
      if (!this.target || !this.target.active || Math.random() < 0.25) this.target = this.pickTarget();
      this.maybeUseAbility();
    } else {
      this.claim = this.brain.claimFor(this);
      this.mode = this.claim ? 'retrieve' : 'position';
      this.holdTime = 0;
      this.faked = false;
      if (this.claim) this.maybeUseAbility();
    }
  }

  private pickTarget(): Athlete | null {
    const a = this.athlete;
    const p = this.params;
    const opps = this.world.opponentsOf(a);
    if (!opps.length) return null;
    const focus = this.brain.focus;
    let best: Athlete | null = null;
    let bestS = -Infinity;
    for (const o of opps) {
      const d = o.pos.distanceTo(a.pos);
      let s = 10 / (d + 2);
      if (o.vulnerable) s += 2.5;
      if (o.state === 'charging' || o.state === 'power') s += 0.8;
      if (o.state === 'catching' || o.state === 'blocking') s -= 1.5;
      s += (o.maxHearts - o.hearts) * 0.6;
      if (o.isPlayer) s += p.playerFocus * 1.8;
      if (focus === o) s += p.coordination * 2;
      if (this.world.court.blocked(a.chestPos(_v), o.chestPos(_v2))) s -= 3;
      s += Math.random() * 0.8;
      if (s > bestS) {
        bestS = s;
        best = o;
      }
    }
    return best;
  }

  private maybeUseAbility() {
    const a = this.athlete;
    if (!this.abilities || this.params.abilityUse <= 0) return;
    if (a.profile.ultimate && a.ult >= TUNING.ult.max && a.ball && Math.random() < this.params.abilityUse * 0.5) {
      if (this.abilities.useUltimate(a)) return;
    }
    if (a.profile.ability && a.energy >= this.abilities.abilityCost(a) && Math.random() < this.params.abilityUse * 0.35) this.abilities.useAbility(a);
  }

  // ------------------------------------------------------------------ behaviours
  private attack(dt: number) {
    const a = this.athlete;
    const p = this.params;
    this.holdTime += dt;
    if (!this.target || !this.target.active) this.target = this.pickTarget();
    const t = this.target;
    if (!t) return;
    const side = this.side();
    const hw = this.world.court.halfWidth;

    // positioning spot: preferred depth, lateral offset for angle + juke
    const depth = clamp(p.attackDepth - this.rage * 1.5, 1.2, this.world.court.halfLength - 1);
    const lateral = clamp(t.pos.x * 0.35 + this.jukeOffset * 0.6 + this.brain.spacingOffset(this) * 0.5, -hw + 1.2, hw - 1.2);
    this.anchor.set(lateral, 0, side * depth);

    const charging = a.state === 'charging' || a.state === 'power';
    const relay = this.now < this.relayUntil;
    if (!charging) this.moveToward(this.anchor, this.holdTime < 1.2 && a.pos.distanceTo(this.anchor) > 4, 1);
    else this.moveToward(this.anchor, false, 0.5);
    this.face(t.pos);

    // aim
    const dist = a.pos.distanceTo(t.pos);
    const speed = a.stats.maxSpeed * (0.6 + 0.4 * this.chargeGoal);
    const tf = dist / speed;
    t.chestPos(_v);
    _v.x += t.vel.x * tf * p.lead;
    _v.z += t.vel.z * tf * p.lead;
    _v.y -= 0.1;
    // extra (personality/tier) aim error
    const err = (p.aimErrorMul - 1) * 0.06 * dist;
    if (err > 0) {
      _v.x += rng.gauss(0, err);
      _v.y += rng.gauss(0, err * 0.4);
    }
    // blink decoys: lower-tier AIs often throw at the afterimage
    const decoy = this.world.decoyFor(t);
    if (decoy) {
      let f = this.fooled.get(decoy.id);
      if (f === undefined) {
        f = Math.random() > this.params.awareness * 0.7;
        this.fooled.set(decoy.id, f);
      }
      if (f) _v.set(decoy.pos.x, 1.2, decoy.pos.z);
    }
    a.aimPoint.copy(_v);
    a.aimTarget = t;
    a.aimPitch = 0;
    a.curveInput = this.planCurve;

    if (this.noThrow || this.passive) return;
    if (!charging && (a.state === 'free' || a.state === 'catchRecover')) {
      // pass to a better-positioned teammate?
      if (!relay && this.holdTime > 0.6 && Math.random() < p.passChance * dt * 2) {
        const mate = this.brain.bestPassTarget(this);
        if (mate && a.passTo(mate)) {
          (mate.controller as AIController | null)?.onEvent?.('relay');
          return;
        }
      }
      const ready = relay || this.holdTime > 0.35 + (1 - p.aggression - this.rage) * 0.9 || a.pos.distanceTo(this.anchor) < 1.5;
      const volleyWait = this.inVolley && !this.volleyGo;
      if (ready || volleyWait) {
        if (a.startCharge()) {
          const tend = relay ? 0 : p.chargeTendency;
          this.chargeGoal = t.vulnerable ? Math.min(tend, 0.3) : clamp(tend + (Math.random() - 0.5) * 0.3, 0, 1);
          this.perfectOffset = this.chargeGoal > 0.9 && Math.random() < p.perfectReleaseSkill ? Math.max(0, a.stats.perfectReleaseWindow * 0.5 + rng.gauss(0, p.timingSigma)) : -1;
          this.planFake = !this.faked && a.perks.fake && Math.random() < p.fakeChance;
          this.planCurve = a.perks.curve && Math.random() < p.curveChance ? (Math.random() < 0.5 ? -1 : 1) : 0;
        }
      }
      return;
    }
    if (charging) {
      // fake: cancel early to bait a reaction, then re-throw
      if (this.planFake && a.charge > 0.45) {
        this.planFake = false;
        this.faked = true;
        a.cancelCharge(true);
        return;
      }
      // smart AIs wait out a catch stance
      if ((t.state === 'catching' || t.state === 'blocking') && this.params.coordination > 0.3 && this.waitCatchTimer < 0.8) {
        this.waitCatchTimer += dt;
        return;
      }
      this.waitCatchTimer = 0;
      if (this.inVolley && !this.volleyGo && this.holdTime < p.maxHold + 2) return;
      let release = a.charge >= this.chargeGoal - 1e-3;
      if (this.perfectOffset >= 0) release = a.fullTime >= this.perfectOffset;
      if (a.state === 'power') release = a.stateTime > 0.35;
      if (t.vulnerable && a.charge > 0.2) release = true;
      if (this.holdTime > p.maxHold) release = true;
      if (release) {
        a.releaseCharge();
        this.holdTime = 0;
        this.faked = false;
      }
    }
  }

  private retrieve() {
    const a = this.athlete;
    const b = this.claim!;
    const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
    const contested = Math.abs(b.pos.z) < 2.5;
    const target = _v.set(b.pos.x + b.vel.x * 0.15, 0, b.pos.z + b.vel.z * 0.15);
    this.moveToward(target, d > 3 || contested, 1);
    // keep eyes on the most dangerous opponent while close; face the ball while sprinting
    if (d < 2.5) {
      const threat = this.brain.mostDangerousOpponent(a);
      if (threat) this.face(threat.pos);
    } else a.faceYaw = null;
  }

  private position(dt: number) {
    const a = this.athlete;
    const p = this.params;
    const side = this.side();
    const hw = this.world.court.halfWidth;
    const hl = this.world.court.halfLength;
    const oppHolding = this.world.opponentsOf(a).filter((o) => o.ball).length;
    const ourHolding = this.world.teammatesOf(a).filter((o) => o.ball).length + (a.ball ? 1 : 0);
    // pressure forward when opponents are empty-handed, back off when they're loaded
    let depth = p.restDepth + oppHolding * 0.9 - (oppHolding === 0 ? 1.5 : 0) - ourHolding * 0.3 - this.rage;
    depth = clamp(depth, 1.5, hl - 1.2);
    let x = this.brain.formationX(this) + this.jukeOffset;
    // defender: step into the lane protecting a targeted teammate
    const guard = p.protect ? this.brain.teammateUnderFire(a) : null;
    if (guard) {
      const shooter = guard.shooter;
      _v2.subVectors(shooter.pos, guard.mate.pos).setY(0).normalize();
      const spot = _v.copy(guard.mate.pos).addScaledVector(_v2, 1.6);
      x = spot.x;
      depth = Math.abs(spot.z);
    }
    this.anchor.set(clamp(x, -hw + 1, hw - 1), 0, side * depth);
    this.moveToward(this.anchor, false, 0.9);
    const threat = this.brain.mostDangerousOpponent(a);
    if (threat) this.face(threat.pos);
    else this.face(_v.set(a.pos.x, 0, -side * 5));
  }

  // ------------------------------------------------------------------ helpers
  private moveToward(p: THREE.Vector3, run: boolean, speedScale: number) {
    const a = this.athlete;
    const dx = p.x - a.pos.x, dz = p.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) {
      a.move.set(0, 0, 0);
      a.wantSprint = false;
      return;
    }
    const k = Math.min(1, d / 0.9) * speedScale;
    a.move.set((dx / d) * k, 0, (dz / d) * k);
    a.wantSprint = run && d > 2.5;
  }

  private face(p: THREE.Vector3) {
    const a = this.athlete;
    a.faceYaw = Math.atan2(p.x - a.pos.x, p.z - a.pos.z);
  }
}
