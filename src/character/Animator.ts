import * as THREE from 'three';
import { BONE_COUNT, BONE_DEFS, BONE_INDEX as B, LOWER_BODY } from './Skeleton';
import { CompiledClip, Pose, eulerToQuat, sampleClip } from './Pose';
import { armQuat } from './ArmIK';
import { CLIPS, ClipName } from './Clips';
import { CharacterRig } from './CharacterBuilder';
import { clamp, dampTo, lerp, noise1, smoothstep, wrapAngle } from '../core/math';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const LOWER_IDX = new Set(LOWER_BODY.map((n) => B[n]));

export interface AnimInput {
  /** Local-space velocity (x: toward character's left/+X, z: forward). m/s */
  velX: number;
  velZ: number;
  /** Local-space acceleration for procedural lean. m/s² */
  accX: number;
  accZ: number;
  grounded: boolean;
  holding: boolean;
  /** 0 relaxed .. 1 athletic ready stance */
  alert: number;
  /** Upper-body aim offsets relative to body facing (radians). +yaw = toward +X. +pitch = up. */
  aimYaw: number;
  aimPitch: number;
  aimWeight: number;
  /** 0..1 extra trembling on the throwing arm while charging */
  chargeShake: number;
  /** extra crouch 0..1 */
  crouch: number;
}

export function defaultAnimInput(): AnimInput {
  return { velX: 0, velZ: 0, accX: 0, accZ: 0, grounded: true, holding: false, alert: 1, aimYaw: 0, aimPitch: 0, aimWeight: 1, chargeShake: 0, crouch: 0 };
}

interface Layer {
  clip: CompiledClip;
  name: ClipName;
  time: number;
  speed: number;
  weight: number;
  target: number;
  fadeRate: number;
  legs: number;
  hold: boolean;
  manual: boolean;
  fadeOut: number;
}

interface PlayOpts {
  fade?: number;
  speed?: number;
  /** Weight applied to lower-body bones (0 = upper body only). */
  legs?: number;
  /** One-shot clips hold their last frame until stopped. */
  hold?: boolean;
  /** Clip time is driven externally through setTime(). */
  manual?: boolean;
  time?: number;
  fadeOut?: number;
}

/** Converts (forward, outward) swing angles to arm-space (raise, swing). */
function armDir(fwdDeg: number, outDeg: number): [number, number] {
  const f = fwdDeg * DEG, o = outDeg * DEG;
  const dx = Math.sin(o);
  const dy = -Math.cos(o) * Math.cos(f);
  const dz = Math.cos(o) * Math.sin(f);
  const raise = Math.acos(clamp(-dy, -1, 1)) / DEG;
  const swing = Math.atan2(dx, dz) / DEG;
  return [raise, swing];
}

/**
 * Layered animation controller:
 *   1. procedural locomotion (speed/direction-synced gait, idle stance, strafing)
 *   2. ball-carry arm override
 *   3. keyframed action layers with cross-fades and per-layer leg weights
 *   4. procedural additives: aim distribution, lean, flinch springs, breathing, charge tremble
 */
export class Animator {
  readonly pose = new Pose();
  private base = new Pose();
  private tmp = new Pose();
  private layers: Layer[] = [];
  private bindOffsets: THREE.Vector3[];
  private mask = new Float32Array(BONE_COUNT);

  // locomotion state
  phase = 0;
  private speed = 0;
  private dirX = 0;
  private dirZ = 1;
  private hipsYaw = 0;
  private holdW = 0;
  private alert = 1;
  private t = Math.random() * 10;
  private airW = 0;
  private crouch = 0;
  private leanX = 0;
  private leanZ = 0;
  // flinch spring (pitch, roll)
  private fx = 0; private fvx = 0;
  private fz = 0; private fvz = 0;
  /** Phase-crossing callbacks for footsteps. */
  onFootstep: ((side: 1 | -1, intensity: number) => void) | null = null;
  private lastStepSign = 0;

  constructor(private rig: CharacterRig) {
    this.bindOffsets = BONE_DEFS.map((d) => new THREE.Vector3(...d.offset));
  }

  play(name: ClipName, o: PlayOpts = {}) {
    const clip = CLIPS[name];
    if (!clip) {
      console.warn('missing clip', name);
      return;
    }
    const fade = o.fade ?? 0.12;
    for (const l of this.layers) {
      l.target = 0;
      l.fadeRate = 1 / Math.max(0.001, fade);
    }
    this.layers.push({
      clip,
      name,
      time: o.time ?? 0,
      speed: o.speed ?? 1,
      weight: fade <= 0 ? 1 : 0,
      target: 1,
      fadeRate: 1 / Math.max(0.001, fade),
      legs: o.legs ?? 1,
      hold: o.hold ?? false,
      manual: o.manual ?? false,
      fadeOut: o.fadeOut ?? 0.18,
    });
    if (this.layers.length > 4) this.layers.shift();
  }

  stop(fade = 0.15) {
    for (const l of this.layers) {
      l.target = 0;
      l.fadeRate = 1 / Math.max(0.001, fade);
    }
  }

  /** The currently dominant (fading-in / active) clip. */
  current(): ClipName | null {
    for (let i = this.layers.length - 1; i >= 0; i--) if (this.layers[i].target > 0) return this.layers[i].name;
    return null;
  }

  setTime(name: ClipName, t: number) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.name === name && l.target > 0) {
        l.time = t;
        return;
      }
    }
  }

  setLegs(name: ClipName, legs: number) {
    for (const l of this.layers) if (l.name === name) l.legs = legs;
  }

  flinch(localDirX: number, localDirZ: number, strength: number) {
    // hit coming from direction d pushes body away: bend back when hit from front (z>0)
    this.fvx += -localDirZ * strength * 14;
    this.fvz += localDirX * strength * 10;
  }

  snapLocomotion() {
    this.speed = 0;
    this.hipsYaw = 0;
  }

  update(dt: number, inp: AnimInput) {
    this.t += dt;
    this.computeLocomotion(dt, inp);
    const out = this.pose.copy(this.base);

    // action layers
    for (let i = 0; i < this.layers.length; i++) {
      const l = this.layers[i];
      if (!l.manual) l.time += dt * l.speed;
      if (!l.clip.loop && !l.hold && !l.manual && l.time >= l.clip.duration - l.fadeOut && l.target > 0) {
        l.target = 0;
        l.fadeRate = 1 / Math.max(0.001, l.fadeOut);
      }
      l.weight = l.weight < l.target ? Math.min(l.target, l.weight + dt * l.fadeRate) : Math.max(l.target, l.weight - dt * l.fadeRate);
    }
    this.layers = this.layers.filter((l) => l.weight > 0.0001 || l.target > 0);
    for (const l of this.layers) {
      if (l.weight <= 0) continue;
      sampleClip(l.clip, l.time, this.tmp);
      for (let b = 0; b < BONE_COUNT; b++) this.mask[b] = l.clip.mask[b] * (LOWER_IDX.has(b) ? l.legs : 1);
      const w = smoothstep(0, 1, l.weight);
      out.blend(this.tmp, w, this.mask);
    }

    this.applyAdditives(dt, inp);
    out.applyTo(this.rig.bones, this.bindOffsets);
  }

  private computeLocomotion(dt: number, inp: AnimInput) {
    const P = this.base;
    const rawSpeed = Math.hypot(inp.velX, inp.velZ);
    this.speed = dampTo(this.speed, rawSpeed, 14, dt);
    if (rawSpeed > 0.3) {
      const k = 1 - Math.exp(-12 * dt);
      this.dirX += (inp.velX / rawSpeed - this.dirX) * k;
      this.dirZ += (inp.velZ / rawSpeed - this.dirZ) * k;
    }
    this.alert = dampTo(this.alert, inp.alert, 4, dt);
    this.holdW = dampTo(this.holdW, inp.holding ? 1 : 0, 10, dt);
    this.airW = dampTo(this.airW, inp.grounded ? 0 : 1, 12, dt);
    this.crouch = dampTo(this.crouch, inp.crouch, 14, dt);
    this.leanX = dampTo(this.leanX, clamp(inp.accX, -40, 40), 8, dt);
    this.leanZ = dampTo(this.leanZ, clamp(inp.accZ, -40, 40), 8, dt);

    const sp = this.speed;
    const moveW = smoothstep(0.12, 1.1, sp);
    const runW = smoothstep(2.2, 4.4, sp);
    const sprintW = smoothstep(5.7, 7.6, sp);
    const cycle = lerp(lerp(1.25, 2.35, runW), 3.2, sprintW);
    this.phase = (this.phase + (TAU * sp * dt) / cycle) % TAU;

    // footstep events at each leg's mid-stance
    const stepSign = Math.sign(Math.sin(this.phase * 1 + Math.PI / 2 + Math.PI / 2));
    if (moveW > 0.4 && stepSign !== this.lastStepSign && this.lastStepSign !== 0) {
      this.onFootstep?.(stepSign > 0 ? 1 : -1, lerp(0.4, 1, runW) + sprintW * 0.3);
    }
    this.lastStepSign = stepSign;

    const A = lerp(lerp(0.36, 0.6, runW), 0.8, sprintW);
    const kneeSwing = lerp(lerp(52, 98, runW), 118, sprintW);
    const kneeStance = lerp(lerp(8, 28, runW), 22, sprintW);
    const bob = lerp(0.022, 0.045, runW);
    const lean = lerp(lerp(3, 9, runW), 17, sprintW);
    const armSwing = lerp(lerp(20, 42, runW), 62, sprintW);
    const elbow = lerp(lerp(22, 82, runW), 96, sprintW);
    const armOut = lerp(10, 16, runW);

    const alpha = Math.atan2(this.dirX, this.dirZ);
    const backward = Math.abs(alpha) > 100 * DEG;
    const targetHipsYaw = moveW < 0.05 ? 0 : backward ? wrapAngle(alpha - Math.PI) * 0.4 : clamp(alpha * 0.55, -48 * DEG, 48 * DEG);
    this.hipsYaw = dampTo(this.hipsYaw, targetHipsYaw * moveW, 10, dt);
    const legAngle = alpha - this.hipsYaw;
    const cl = Math.cos(legAngle), sl = Math.sin(legAngle);

    // ---- gait pose ----
    const p = this.phase;
    const al = this.alert;
    const crouchY = -0.03 * al - this.crouch * 0.14;
    P.identity();
    P.root[1] = crouchY + bob * Math.cos(2 * p) * (1 - 2 * runW) * moveW - 0.02 * runW;
    P.setEuler(B.hips, 0, this.hipsYaw + 6 * DEG * Math.sin(p) * moveW, 3 * DEG * Math.cos(p) * moveW);

    for (const side of [-1, 1] as const) {
      const pp = side === -1 ? p : p + Math.PI;
      const s = A * Math.sin(pp);
      const thighX = -s * cl * moveW;
      const thighZ = s * sl * moveW * 0.9;
      const swing = Math.cos(pp);
      const knee = (kneeSwing * Math.pow(Math.max(0, swing), 1.3) + kneeStance * Math.max(0, -swing)) * DEG * moveW;
      // idle ready stance blend
      const idleThighX = (-16 * al - this.crouch * 30) * DEG;
      const idleKnee = (28 * al + 3 + this.crouch * 50) * DEG;
      const tx = lerp(idleThighX, thighX - 10 * DEG * al * (1 - runW), moveW);
      const kn = lerp(idleKnee, knee + (10 * al) * DEG * (1 - runW), moveW);
      // abduction magnitude; side=+1 is the left leg (+X) where abduction is z>0
      const spread = (lerp(7 * al + 3, 2, moveW) + this.crouch * 6) * DEG;
      const thighBone = side === -1 ? B.thighR : B.thighL;
      const shinBone = side === -1 ? B.shinR : B.shinL;
      const footBone = side === -1 ? B.footR : B.footL;
      P.setEuler(thighBone, tx, 0, thighZ + side * spread);
      P.setEuler(shinBone, kn, 0, 0);
      const toe = moveW * Math.max(0, Math.sin(pp - 0.6)) * 18 * DEG * (0.6 + runW);
      P.setEuler(footBone, -(tx + kn) * 0.92 + toe, 0, -side * spread * 0.8);
    }

    // torso
    const torsoLean = (lean * moveW + 7 * al * (1 - moveW) + this.crouch * 12) * DEG;
    const breathe = Math.sin(this.t * 1.7) * 1.2 * DEG;
    P.setEuler(B.spine, torsoLean * 0.6, -this.hipsYaw * 0.55 - 5 * DEG * Math.sin(p) * moveW, 0);
    P.setEuler(B.chest, torsoLean * 0.4 + breathe, -this.hipsYaw * 0.45 - 4 * DEG * Math.sin(p) * moveW, 0);
    P.setEuler(B.neck, -torsoLean * 0.4, 0, 0);
    P.setEuler(B.head, -torsoLean * 0.25 - breathe * 0.5, 0, 0);
    P.setEuler(B.clavL, 0, 0, Math.sin(this.t * 1.7) * 1.5 * DEG);
    P.setEuler(B.clavR, 0, 0, -Math.sin(this.t * 1.7) * 1.5 * DEG);

    // arms
    for (const side of [-1, 1] as const) {
      const pp = side === -1 ? p : p + Math.PI;
      const swingF = armSwing * Math.sin(pp) * moveW; // right arm back when right leg forward
      const idleF = 22 * al + 4;
      const f = lerp(idleF, -swingF + 8 * runW, moveW);
      const o = lerp(12 * al + 8, armOut, moveW);
      const [raise, sw] = armDir(f, o);
      const upper = side === -1 ? B.upperArmR : B.upperArmL;
      const fore = side === -1 ? B.foreArmR : B.foreArmL;
      const hand = side === -1 ? B.handR : B.handL;
      armQuat(side === -1 ? -1 : 1, raise, sw, lerp(10, 0, moveW), P.q, upper * 4);
      const el = lerp(-(50 * al + 14), -(elbow + Math.max(0, swingF) * 0.3), moveW) * DEG;
      P.setEuler(fore, el, 0, 0);
      P.setEuler(hand, lerp(-8, 5, moveW) * DEG, 0, 0);
    }

    // ball carry (right arm)
    if (this.holdW > 0.001) {
      this.tmp.identity();
      const bob2 = Math.sin(p) * 6 * moveW;
      const [raise, sw] = armDir(32 + bob2, 20);
      armQuat(-1, raise, sw, 18, this.tmp.q, B.upperArmR * 4);
      eulerToQuat(-98 * DEG, 0, 0, this.tmp.q, B.foreArmR * 4);
      eulerToQuat(-18 * DEG, 0, 8 * DEG, this.tmp.q, B.handR * 4);
      eulerToQuat(0, 6 * DEG, 0, this.tmp.q, B.clavR * 4);
      this.mask.fill(0);
      this.mask[B.upperArmR] = this.mask[B.foreArmR] = this.mask[B.handR] = this.mask[B.clavR] = 1;
      P.blend(this.tmp, this.holdW, this.mask);
    }

    // airborne tuck
    if (this.airW > 0.001) {
      this.tmp.identity();
      eulerToQuat(-45 * DEG, 0, 6 * DEG, this.tmp.q, B.thighL * 4);
      eulerToQuat(-20 * DEG, 0, -6 * DEG, this.tmp.q, B.thighR * 4);
      eulerToQuat(80 * DEG, 0, 0, this.tmp.q, B.shinL * 4);
      eulerToQuat(60 * DEG, 0, 0, this.tmp.q, B.shinR * 4);
      eulerToQuat(20 * DEG, 0, 0, this.tmp.q, B.footL * 4);
      eulerToQuat(25 * DEG, 0, 0, this.tmp.q, B.footR * 4);
      this.mask.fill(0);
      this.mask[B.thighL] = this.mask[B.thighR] = this.mask[B.shinL] = this.mask[B.shinR] = this.mask[B.footL] = this.mask[B.footR] = 1;
      P.blend(this.tmp, this.airW, this.mask);
    }
  }

  private applyAdditives(dt: number, inp: AnimInput) {
    const P = this.pose;
    // flinch spring
    const k = 160, c = 2 * Math.sqrt(160) * 0.55;
    this.fvx += (-k * this.fx - c * this.fvx) * dt;
    this.fx += this.fvx * dt;
    this.fvz += (-k * this.fz - c * this.fvz) * dt;
    this.fz += this.fvz * dt;
    const fx = clamp(this.fx, -0.9, 0.9), fz = clamp(this.fz, -0.7, 0.7);
    if (Math.abs(fx) + Math.abs(fz) > 1e-4) {
      P.addEuler(B.spine, fx * 0.4, 0, fz * 0.4);
      P.addEuler(B.chest, fx * 0.5, 0, fz * 0.4);
      P.addEuler(B.neck, fx * 0.35, 0, fz * 0.2);
    }

    // lean into acceleration (small, readable)
    const lx = this.leanX * 0.35 * DEG, lz = this.leanZ * 0.3 * DEG;
    P.preEuler(B.hips, clamp(lz, -12 * DEG, 12 * DEG), 0, clamp(-lx, -12 * DEG, 12 * DEG));

    // aim distribution through the spine
    const w = inp.aimWeight;
    if (w > 0.001) {
      const yaw = clamp(inp.aimYaw, -100 * DEG, 100 * DEG) * w;
      const pitch = clamp(inp.aimPitch, -50 * DEG, 60 * DEG) * w;
      P.preEuler(B.spine, 0, yaw * 0.3, 0);
      P.preEuler(B.chest, -pitch * 0.35, yaw * 0.35, 0);
      P.preEuler(B.neck, -pitch * 0.3, yaw * 0.15, 0);
      P.preEuler(B.head, -pitch * 0.35, yaw * 0.2, 0);
    }

    if (inp.chargeShake > 0.001) {
      const s = inp.chargeShake;
      const n1 = noise1(this.t * 22, 1) * 2.2 * DEG * s;
      const n2 = noise1(this.t * 19, 2) * 1.5 * DEG * s;
      P.addEuler(B.upperArmR, n1, 0, n2);
      P.addEuler(B.chest, n2 * 0.4, n1 * 0.3, 0);
    }
  }

  /** Blend weight of a named clip, for gameplay queries. */
  weightOf(name: ClipName) {
    let w = 0;
    for (const l of this.layers) if (l.name === name) w = Math.max(w, l.weight);
    return w;
  }
}
