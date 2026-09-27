import * as THREE from 'three';
import { Input } from '../core/Input';
import { clamp } from '../core/math';
import { GameCamera } from '../camera/GameCamera';
import type { Athlete, Controller } from './Athlete';
import type { World } from './World';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _ray = new THREE.Ray();

export interface AbilityHooks {
  useAbility(a: Athlete): boolean;
  useUltimate(a: Athlete): boolean;
}

/**
 * Human control: camera-relative movement, soft lock-on aiming, input buffering
 * and context-sensitive buttons. Only sets intents / calls Athlete actions.
 */
export class PlayerController implements Controller {
  lockTarget: Athlete | null = null;
  /** 0..1 how strongly the reticle is on the lock target (HUD). */
  lockStrength = 0;
  private charging = false;
  private manualLock: Athlete | null = null;
  private manualLockTime = 0;
  enabled = true;
  abilities: AbilityHooks | null = null;
  /** Restrict actions (tutorial gating). */
  allow = { move: true, throw: true, catch: true, dodge: true, sprint: true, pass: true, ability: true, ultimate: true };

  constructor(
    public athlete: Athlete,
    public input: Input,
    public cam: GameCamera,
    public world: World,
  ) {}

  /** Camera look runs every frame, even during countdowns. */
  updateLook() {
    if (!this.enabled) return;
    this.cam.look(this.input.lookDX, this.input.lookDY);
    if (this.input.pressed('shoulder')) this.cam.shoulder *= -1;
  }

  update(dt: number) {
    if (!this.enabled) return;
    const a = this.athlete;
    const inp = this.input;
    const cam = this.cam;

    // movement relative to camera yaw
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
    const rx = -fz, rz = fx;
    const mx = this.allow.move ? inp.moveX.value : 0;
    const my = this.allow.move ? inp.moveY.value : 0;
    a.move.set(fx * my + rx * mx, 0, fz * my + rz * mx);
    a.wantSprint = this.allow.sprint && inp.isDown('sprint');
    a.faceYaw = cam.yaw;
    a.aimPitch = clamp(cam.pitch + 0.08, -0.5, 0.7);
    a.curveInput = mx;

    this.updateAim();

    // --- throw (buffered: a tap just before gaining the ball still throws) ---
    if (this.allow.throw) {
      const wantCharge = inp.isDown('throw') || inp.buffered('throw', 0.16);
      if (!this.charging && wantCharge && a.ball && a.startCharge()) {
        this.charging = true;
        inp.consume('throw');
      }
      if (this.charging) {
        if (a.state !== 'charging' && a.state !== 'power') this.charging = false; // interrupted
        else if (!inp.isDown('throw')) {
          a.releaseCharge();
          this.charging = false;
        }
      }
    }

    // --- catch / fake / block ---
    if (this.allow.catch) {
      if (inp.pressed('catch') && (a.state === 'charging')) {
        a.cancelCharge(true);
        this.charging = false;
        inp.consume('catch');
      } else if (inp.buffered('catch', 0.12)) {
        if (a.startCatch()) inp.consume('catch');
      }
      if (a.state === 'blocking' && !inp.isDown('catch')) a.endBlock();
    }

    // --- dodge ---
    if (this.allow.dodge && inp.buffered('dodge', 0.14)) {
      const dir = _v.copy(a.move);
      if (dir.lengthSq() < 0.05) dir.set(rx, 0, rz).multiplyScalar(inp.moveX.value < 0 ? -1 : 1);
      if (a.dodge(dir)) inp.consume('dodge');
    }

    // --- pass / call for pass ---
    if (this.allow.pass && inp.pressed('pass')) {
      if (a.ball) {
        const mate = this.pickPassTarget();
        if (mate) a.passTo(mate);
      } else {
        const mate = this.world.teammatesOf(a).find((m) => m.ball && m.canAct);
        if (mate) {
          mate.passTo(a);
        }
      }
    }

    // --- lob: a high arc over cover onto the locked target ---
    if (this.allow.throw && a.ball && inp.buffered('lob', 0.14)) {
      if (a.lob()) {
        this.charging = false;
        inp.consume('lob');
      }
    }

    // --- abilities ---
    if (this.allow.ability && inp.pressed('ability') && this.abilities) this.abilities.useAbility(a);
    if (this.allow.ultimate && inp.pressed('ultimate') && this.abilities) this.abilities.useUltimate(a);

    // --- manual target cycling ---
    if (inp.pressed('target')) this.cycleTarget();
    if (this.manualLock) {
      this.manualLockTime -= dt;
      if (this.manualLockTime > 0 && this.manualLock.active) {
        this.manualLock.chestPos(_v);
        this.cam.faceTowards(_v, Math.min(1, dt * 10));
      } else this.manualLock = null;
    }
  }

  private pickPassTarget(): Athlete | null {
    const a = this.athlete;
    let best: Athlete | null = null;
    let bestScore = -Infinity;
    const fwd = _v2.set(Math.sin(this.cam.yaw), 0, Math.cos(this.cam.yaw));
    for (const m of this.world.teammatesOf(a)) {
      if (m.ball) continue;
      const d = _v.copy(m.pos).sub(a.pos).setY(0);
      const dist = d.length();
      const score = d.normalize().dot(fwd) * 2 - dist * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return best;
  }

  private cycleTarget() {
    const opps = this.world.opponentsOf(this.athlete);
    if (!opps.length) return;
    opps.sort((p, q) => Math.atan2(p.pos.x - this.athlete.pos.x, p.pos.z - this.athlete.pos.z) - Math.atan2(q.pos.x - this.athlete.pos.x, q.pos.z - this.athlete.pos.z));
    const idx = this.lockTarget ? opps.indexOf(this.lockTarget) : -1;
    this.manualLock = opps[(idx + 1) % opps.length];
    this.manualLockTime = 0.35;
  }

  /**
   * Soft lock-on: the opponent closest to the reticle (within a cone that widens
   * with the Accuracy stat) becomes the target. The aim point leads the target's
   * velocity partially, so juking and dodging still beat throws.
   */
  private updateAim() {
    const a = this.athlete;
    const cam = this.cam;
    _ray.set(cam.aimOrigin, cam.aimDir);
    let best: Athlete | null = null;
    let bestAng = (8 + a.stats.assist * 10) * (Math.PI / 180);
    const chest = new THREE.Vector3();
    for (const o of this.world.opponentsOf(a)) {
      o.chestPos(chest);
      const to = _v.copy(chest).sub(cam.aimOrigin);
      const dist = to.length();
      const ang = to.normalize().angleTo(cam.aimDir);
      // bias toward closer / more central targets
      const effective = ang * (1 + dist * 0.012);
      if (effective < bestAng) {
        bestAng = effective;
        best = o;
      }
    }
    if (this.manualLock && this.manualLock.active) best = this.manualLock;
    this.lockTarget = best;
    this.lockStrength = best ? 1 : 0;
    a.aimTarget = best;
    if (best) {
      const from = a.chestPos(_v2);
      best.chestPos(chest);
      const dist = chest.distanceTo(from);
      const speed = a.stats.maxSpeed * (0.6 + 0.4 * a.charge);
      const tFlight = dist / speed;
      const lead = 0.55 + a.stats.assist * 0.25;
      chest.x += best.vel.x * tFlight * lead;
      chest.z += best.vel.z * tFlight * lead;
      chest.y -= 0.12;
      a.aimPoint.copy(chest);
    } else {
      // free aim: intersect the floor or project far along the ray
      const far = 26;
      const p = _v.copy(cam.aimOrigin).addScaledVector(cam.aimDir, far);
      if (cam.aimDir.y < -0.02) {
        const t = -cam.aimOrigin.y / cam.aimDir.y;
        if (t > 0 && t < far) p.copy(cam.aimOrigin).addScaledVector(cam.aimDir, t);
      }
      // lobs: aiming upward gives a higher arc target
      a.aimPoint.copy(p);
    }
  }
}
