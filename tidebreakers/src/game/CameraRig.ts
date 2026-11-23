// Third-person camera: orbit around the player with mouse/stick, auto-framing of the lock-on target,
// collision with the level, trauma-based shake, and scripted shots for cutscenes (eased moves).
import { TargetCamera, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { Collision } from './Collision';

export interface Shot { pos: Vector3; target: Vector3; fov?: number; dur?: number; ease?: 'smooth' | 'linear' | 'out' }

export class CameraRig {
  cam: TargetCamera;
  yaw = 0;
  pitch = 0.32;
  dist = 4.6;
  distTarget = 4.6;
  heightOffset = 1.45;
  focus = new Vector3();
  follow: (() => Vector3) | null = null;
  lock: (() => Vector3 | null) | null = null;
  trauma = 0;
  fovBase = 0.85;
  private t = 0;
  private shot: { from: Shot; to: Shot; t: number; dur: number; ease: string } | null = null;
  private holdShot: Shot | null = null;
  private collided = 4.6;
  freeze = false;

  constructor(scene: Scene, readonly col: Collision) {
    this.cam = new TargetCamera('main', new Vector3(0, 3, -6), scene);
    this.cam.minZ = 0.08;
    this.cam.maxZ = 2000;
    this.cam.fov = this.fovBase;
    scene.activeCamera = this.cam;
  }

  get forwardYaw(): number { return this.yaw; }

  /** Scripted shot (cutscenes). With dur, eases from the current view. */
  shotTo(s: Shot): void {
    const from: Shot = { pos: this.cam.position.clone(), target: this.cam.getTarget().clone(), fov: this.cam.fov };
    this.shot = { from, to: s, t: 0, dur: s.dur ?? 0, ease: s.ease ?? 'smooth' };
    if (!s.dur) { this.holdShot = s; this.shot = null; }
  }

  release(): void {
    this.shot = null;
    this.holdShot = null;
    // continue orbit from where the shot left the camera
    const f = this.follow?.() ?? this.focus;
    const d = this.cam.position.subtract(f);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  get scripted(): boolean { return !!(this.shot || this.holdShot); }

  shake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt: number, look: { x: number; y: number }): void {
    this.t += dt;
    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      let u = Math.min(1, s.t / Math.max(s.dur, 1e-3));
      u = s.ease === 'linear' ? u : s.ease === 'out' ? 1 - (1 - u) ** 3 : u * u * (3 - 2 * u);
      this.cam.position.copyFrom(Vector3.Lerp(s.from.pos, s.to.pos, u));
      this.cam.setTarget(Vector3.Lerp(s.from.target, s.to.target, u));
      this.cam.fov = (s.from.fov ?? this.fovBase) + ((s.to.fov ?? this.fovBase) - (s.from.fov ?? this.fovBase)) * u;
      if (s.t >= s.dur) { this.holdShot = s.to; this.shot = null; }
      this.applyShake(dt);
      return;
    }
    if (this.holdShot) {
      this.cam.position.copyFrom(this.holdShot.pos);
      this.cam.setTarget(this.holdShot.target);
      this.cam.fov = this.holdShot.fov ?? this.fovBase;
      this.applyShake(dt);
      return;
    }
    if (this.freeze) return;
    this.yaw += look.x;
    this.pitch = Math.max(-0.25, Math.min(1.05, this.pitch + look.y));
    const f = this.follow?.() ?? this.focus;
    this.focus = Vector3.Lerp(this.focus, f, Math.min(1, dt * 10));
    let center = this.focus.add(new Vector3(0, this.heightOffset, 0));
    const lt = this.lock?.() ?? null;
    if (lt) {
      // turn to keep the target in frame behind the player and look between them
      const d = lt.subtract(this.focus);
      const want = Math.atan2(d.x, d.z);
      const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
      this.yaw += diff * Math.min(1, dt * 3.5);
      const mid = Vector3.Lerp(this.focus, lt, 0.32);
      center = new Vector3(mid.x, this.focus.y + this.heightOffset, mid.z);
      this.distTarget = Math.min(7.5, 4.6 + d.length() * 0.18);
    } else {
      this.distTarget = 4.6;
    }
    this.dist += (this.distTarget - this.dist) * Math.min(1, dt * 3);
    const dir = new Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const free = this.col.raycast(center, dir, this.dist);
    this.collided += (free - this.collided) * Math.min(1, dt * (free < this.collided ? 20 : 4));
    const pos = center.add(dir.scale(this.collided));
    this.cam.position.copyFrom(pos);
    this.cam.setTarget(center);
    this.cam.fov += (this.fovBase - this.cam.fov) * Math.min(1, dt * 4);
    this.applyShake(dt);
  }

  private applyShake(dt: number): void {
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const off = new Vector3(Math.sin(t * 1.1) * 0.12 * s, Math.sin(t * 1.7 + 1) * 0.1 * s, Math.sin(t * 1.3 + 2) * 0.08 * s);
    this.cam.position.addInPlace(off);
    const tg = this.cam.getTarget().add(off.scale(0.5));
    this.cam.setTarget(tg);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
  }
}
