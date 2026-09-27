import * as THREE from 'three';
import { clamp, damp, dampAngle, dampTo, noise1, rayBox, Spring1, SpringVec3 } from '../core/math';
import type { Athlete } from '../game/Athlete';

export type CameraMode = 'follow' | 'spectate' | 'cinematic' | 'orbit';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Third-person gameplay camera: over-the-shoulder follow with smoothing,
 * anticipation, collision, sprint/charge FOV shaping and trauma-based shake.
 */
export class GameCamera {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'follow';
  target: Athlete | null = null;
  yaw = Math.PI;
  pitch = -0.08;
  shoulder = 1;
  private shoulderBlend = 1;
  private pivot = new SpringVec3(260, 2 * Math.sqrt(260) * 0.95);
  private dist = 3.6;
  private fov = new Spring1(62, 90, 2 * Math.sqrt(90) * 0.8);
  baseFov = 62;
  private fovPunch = 0;
  private trauma = 0;
  private kick = new SpringVec3(160, 2 * Math.sqrt(160) * 0.7);
  private t = 0;
  bounds = new THREE.Box3(new THREE.Vector3(-14, 0.3, -18), new THREE.Vector3(14, 12, 18));
  blockers: THREE.Box3[] = [];
  /** Orbit params (attract mode). */
  orbitCenter = new THREE.Vector3();
  orbitRadius = 14;
  orbitHeight = 5;
  orbitSpeed = 0.08;
  private orbitAngle = 0;
  shakeScale = 1;
  /** Aim ray (world). */
  readonly aimOrigin = new THREE.Vector3();
  readonly aimDir = new THREE.Vector3();
  private lookYawOffset = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setTarget(a: Athlete | null, snap = false) {
    this.target = a;
    if (a && snap) {
      this.pivot.snap(_v.set(a.pos.x, 1.55, a.pos.z));
      this.kick.snap(_v.set(0, 0, 0));
    }
  }

  addTrauma(v: number) {
    this.trauma = Math.min(1, this.trauma + v * this.shakeScale);
  }
  punchFov(v: number) {
    this.fovPunch += v;
  }
  kickDir(dir: THREE.Vector3, amount: number) {
    this.kick.velocity.addScaledVector(dir, amount);
  }

  /** Snap yaw toward a world point (target cycling). */
  faceTowards(p: THREE.Vector3, blend = 1) {
    if (!this.target) return;
    const yaw = Math.atan2(p.x - this.target.pos.x, p.z - this.target.pos.z);
    this.yaw = this.yaw + (((yaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * blend;
  }

  update(realDt: number) {
    this.t += realDt;
    this.trauma = Math.max(0, this.trauma - realDt * 1.7);
    this.fovPunch *= Math.exp(-realDt * 7);
    if (this.mode === 'cinematic') {
      this.updateAimRay();
      return;
    }
    if (this.mode === 'orbit') {
      this.orbitAngle += realDt * this.orbitSpeed;
      const p = _v.set(
        this.orbitCenter.x + Math.sin(this.orbitAngle) * this.orbitRadius,
        this.orbitCenter.y + this.orbitHeight,
        this.orbitCenter.z + Math.cos(this.orbitAngle) * this.orbitRadius,
      );
      this.camera.position.copy(p);
      this.camera.lookAt(this.orbitCenter);
      this.fov.update(this.baseFov, realDt);
      this.camera.fov = this.fov.value;
      this.camera.updateProjectionMatrix();
      this.updateAimRay();
      return;
    }
    const a = this.target;
    if (!a) return;

    // desired framing parameters
    const charging = a.state === 'charging' || a.state === 'power';
    const sprinting = a.sprinting;
    let distTarget = charging ? 3.2 : sprinting ? 3.95 : 3.6;
    let shoulderX = charging ? 0.85 : 0.62;
    let up = charging ? 0.22 : 0.3;
    let fovTarget = this.baseFov + (sprinting ? 7 : 0) - (charging ? 5 * (0.5 + a.charge * 0.5) : 0) + this.fovPunch;
    if (this.mode === 'spectate') {
      distTarget = 5.2;
      shoulderX = 0;
      up = 0.8;
      fovTarget = this.baseFov;
      // auto-orbit toward the action
      this.yaw = dampAngle(this.yaw, a.team === 0 ? Math.PI : 0, 1.2, realDt);
      this.pitch = dampTo(this.pitch, -0.22, 2, realDt);
    }
    this.dist = dampTo(this.dist, distTarget, 5, realDt);
    this.shoulderBlend = dampTo(this.shoulderBlend, this.shoulder, 8, realDt);

    // pivot with slight anticipation of movement
    const lead = _v2.set(a.vel.x, 0, a.vel.z).multiplyScalar(0.07);
    const pivotTarget = _v.set(a.pos.x + lead.x, a.pos.y + a.y * 0.6 + 1.52 * a.rig.height, a.pos.z + lead.z);
    this.pivot.update(pivotTarget, realDt);
    const pivot = this.pivot.value;

    // orientation
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const fwd = _v2.set(sy * cp, sp, cy * cp);
    const right = new THREE.Vector3(-cy, 0, sy);
    const upv = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // shoulder offset first, then pull back
    const shoulderPos = new THREE.Vector3().copy(pivot).addScaledVector(right, shoulderX * this.shoulderBlend).addScaledVector(upv, up);
    let dist = this.dist;
    // collision: blockers
    const back = fwd.clone().negate();
    for (const b of this.blockers) {
      const hit = rayBox(shoulderPos.x, shoulderPos.y, shoulderPos.z, back.x, back.y, back.z, b.min, b.max);
      if (hit >= 0 && hit < dist + 0.25) dist = Math.max(0.6, hit - 0.25);
    }
    const camPos = shoulderPos.clone().addScaledVector(back, dist);
    // keep inside arena volume; if clamped, the camera slides along the bound
    const clamped = camPos.clone().clamp(this.bounds.min, this.bounds.max);
    if (clamped.distanceToSquared(camPos) > 1e-6) {
      camPos.copy(clamped);
    }
    if (camPos.y < 0.35) camPos.y = 0.35;

    // kick + shake
    this.kick.update(_v.set(0, 0, 0), realDt);
    camPos.add(this.kick.value);
    const tr = this.trauma * this.trauma;
    this.camera.position.copy(camPos);
    const look = camPos.clone().addScaledVector(fwd, 10);
    this.camera.lookAt(look);
    // aim ray uses the un-shaken orientation so shake never disturbs aiming
    this.aimOrigin.copy(camPos);
    this.aimDir.copy(fwd);
    if (tr > 0.0001) {
      const s = tr * 0.035;
      this.camera.rotateX(noise1(this.t * 22, 1) * s);
      this.camera.rotateY(noise1(this.t * 22, 2) * s);
      this.camera.rotateZ(noise1(this.t * 18, 3) * s * 0.7);
    }
    this.fov.update(fovTarget, realDt);
    this.camera.fov = this.fov.value;
    this.camera.updateProjectionMatrix();
  }

  private updateAimRay() {
    this.aimOrigin.copy(this.camera.position);
    this.camera.getWorldDirection(this.aimDir);
  }

  /** Look input (radians). */
  look(dx: number, dy: number) {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -0.62, 0.72);
  }
}
