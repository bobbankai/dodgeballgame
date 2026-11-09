import { Quaternion, Vector3, type UniversalCamera } from '@babylonjs/core';
import type { Physics } from '../physics/Physics';
import { Layer } from '../physics/Physics';

export interface CameraTarget {
  /** World point the camera orbits (the character's chest). */
  pivot: Vector3;
}

export interface LockTarget {
  position: Vector3;
  /** Height above position to frame (bosses are tall). */
  height: number;
  radius: number;
}

/**
 * Third-person camera: orbit around the player with smoothed follow, collision against the world
 * (a centre ray plus four offset rays so railings and thin posts do not make it pop), lock-on
 * framing that keeps player and target on screen, distance and FOV that react to sprinting and
 * combat, impulse shake (scaled by the accessibility setting) and a cinematic override.
 */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.25;
  distance = 4.2;
  baseDistance = 4.2;
  minPitch = -0.6;
  maxPitch = 1.15;
  shoulder = 0.45;
  fovBase = 0.9;
  /** Height of standing water the camera stays above (null: none). */
  waterLevel: number | null = null;
  fovKick = 0;
  shakeScale = 1;
  lock: LockTarget | null = null;
  /** When set, gameplay control is suspended and the camera follows the cinematic. */
  cinematic = false;
  private pivot = new Vector3();
  private smoothedPivot = new Vector3();
  private curDistance = 4.2;
  private trauma = 0;
  private shakeT = 0;
  private recoil = new Vector3();
  private initialized = false;
  private camPos = new Vector3();

  constructor(readonly camera: UniversalCamera, private physics: Physics) {}

  /** Adds screen shake (0..1 trauma; the visible shake is trauma squared). */
  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A directional kick (heavy impacts). */
  kick(dir: Vector3, amount: number): void {
    this.recoil.addInPlace(dir.scale(amount * this.shakeScale));
  }

  snapBehind(forwardYaw: number): void {
    this.yaw = forwardYaw + Math.PI;
  }

  update(dt: number, target: CameraTarget, look: { x: number; y: number }): void {
    if (this.cinematic) return;
    this.yaw -= look.x;
    this.pitch = Math.min(this.maxPitch, Math.max(this.minPitch, this.pitch + look.y));
    this.pivot.copyFrom(target.pivot);
    if (!this.initialized) {
      this.smoothedPivot.copyFrom(this.pivot);
      this.initialized = true;
    }
    // soft follow: fast horizontally, softer vertically (stairs and jumps do not jerk the view)
    const k = 1 - Math.exp(-dt * 14);
    const kv = 1 - Math.exp(-dt * 7);
    this.smoothedPivot.x += (this.pivot.x - this.smoothedPivot.x) * k;
    this.smoothedPivot.z += (this.pivot.z - this.smoothedPivot.z) * k;
    this.smoothedPivot.y += (this.pivot.y - this.smoothedPivot.y) * kv;

    let wantDist = this.baseDistance;
    if (this.lock) {
      // frame player and target: turn the orbit behind the player, facing the target
      const to = this.lock.position.subtract(this.smoothedPivot);
      const lockYaw = Math.atan2(to.x, to.z) + Math.PI;
      let d = lockYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 6));
      const flat = Math.hypot(to.x, to.z);
      const wantPitch = 0.18 + Math.min(0.3, this.lock.height / Math.max(flat, 1) * 0.25);
      this.pitch += (wantPitch - this.pitch) * (1 - Math.exp(-dt * 3));
      wantDist = this.baseDistance + Math.min(3.5, this.lock.radius * 0.6 + this.lock.height * 0.25);
    }
    // orbit position
    const cp = Math.cos(this.pitch);
    const dir = new Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const pivot = this.smoothedPivot.add(right.scale(-this.shoulder * 0.0));
    // collision: shorten the arm to the nearest hit of several rays
    let allowed = wantDist;
    const probe = (offset: Vector3) => {
      const from = pivot.add(offset.scale(0.4));
      const to = pivot.add(dir.scale(wantDist)).add(offset);
      const hit = this.physics.raycast(from, to, Layer.World);
      if (hit.hit) allowed = Math.min(allowed, Math.max(0.6, hit.distance - 0.25));
    };
    probe(Vector3.Zero());
    const up = Vector3.Up();
    probe(up.scale(0.25));
    probe(up.scale(-0.2));
    probe(right.scale(0.3));
    probe(right.scale(-0.3));
    // pull in fast, ease back out slowly
    const rate = allowed < this.curDistance ? 18 : 3;
    this.curDistance += (allowed - this.curDistance) * (1 - Math.exp(-dt * rate));
    this.camPos.copyFrom(pivot).addInPlace(dir.scale(this.curDistance));
    // never dip under a water surface (the level sets it): ride just above it instead
    if (this.waterLevel !== null && this.camPos.y < this.waterLevel + 0.3) this.camPos.y = this.waterLevel + 0.3;
    // shake: smooth noise driven by trauma^2
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma * this.shakeScale;
    const n = (f: number, o: number) => Math.sin(this.shakeT * f + o) * 0.6 + Math.sin(this.shakeT * f * 2.3 + o * 1.7) * 0.4;
    const shakeOff = new Vector3(n(31, 1), n(37, 4), n(29, 7)).scale(0.12 * s);
    this.recoil.scaleInPlace(Math.exp(-dt * 10));
    this.camera.position.copyFrom(this.camPos).addInPlace(shakeOff).addInPlace(this.recoil);
    const lookAt = pivot.add(right.scale(this.shoulder * 0.0)).add(new Vector3(0, 0.15, 0));
    if (this.lock) {
      const mid = Vector3.Lerp(lookAt, this.lock.position.add(new Vector3(0, this.lock.height * 0.45, 0)), 0.3);
      this.camera.setTarget(mid);
    } else {
      this.camera.setTarget(lookAt);
    }
    const roll = n(23, 2) * 0.02 * s;
    this.camera.rotation.z = roll;
    this.camera.fov += (this.fovBase + this.fovKick - this.camera.fov) * (1 - Math.exp(-dt * 5));
  }

  /** Forward (on the ground plane) of the camera, for camera-relative movement. */
  get flatForward(): Vector3 {
    return new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get flatRight(): Vector3 {
    return new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Point the camera at a world-space orientation (used when a cinematic hands control back). */
  blendFromCurrent(): void {
    const fwd = this.camera.getDirection(new Vector3(0, 0, 1));
    this.yaw = Math.atan2(fwd.x, fwd.z) + Math.PI;
    this.pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
    void Quaternion;
  }
}
