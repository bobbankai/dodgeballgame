// Third-person camera: orbit around the player with mouse/stick, auto-framing of the lock-on target,
// collision with the level, trauma-based shake, and scripted shots for cutscenes (eased moves).
import { TargetCamera, Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { Collision } from './Collision';

export interface Shot { pos: Vector3; target: Vector3; fov?: number; dur?: number; ease?: 'smooth' | 'linear' | 'out';
  /** keep framing a moving point (an actor's head): the shot keeps its offsets from it as it moves */
  follow?: () => Vector3;
  /** the camera's own follow point when it should move differently from the target (crouching actors) */
  followCam?: () => Vector3 }

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
  /** what the camera looks at (TargetCamera.getTarget() only updates at render time) */
  readonly target = new Vector3(0, 1, 0);
  /** distance from `from` toward `to` to the first visible surface in between (null: clear). Scripted shots use
   *  it to step in front of walls and roofs the camera would otherwise be behind or inside. */
  occlude: ((from: Vector3, to: Vector3) => number | null) | null = null;
  /** sea surface height at (x, z), when the level has a sea: the camera stays above it */
  waterAt: ((x: number, z: number) => number) | null = null;
  /** size (height) of the locked-on target: big ones (the serpent) pull the camera back and up */
  lockSize: (() => number) | null = null;
  private followAt: Vector3 | null = null;
  private followRef: Vector3 | null = null;
  private camAt: Vector3 | null = null;
  private camRef: Vector3 | null = null;
  private occFrac = 1;
  private occWant = 1;
  private occT = 0;
  private playOccT = 0;
  private playFree = 1e9;

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
    const from: Shot = { pos: this.cam.position.clone(), target: this.target.clone(), fov: this.cam.fov };
    this.followRef = s.follow ? s.follow().clone() : null;
    this.followAt = this.followRef ? this.followRef.clone() : null;
    this.camRef = s.followCam ? s.followCam().clone() : null;
    this.camAt = this.camRef ? this.camRef.clone() : null;
    this.shot = { from, to: s, t: 0, dur: s.dur ?? 0, ease: s.ease ?? 'smooth' };
    if (!s.dur) { this.holdShot = s; this.shot = null; }
    // a new shot: check what's in front of the lens straight away, and cut (don't glide) to the result
    this.occT = 0;
    this.occFrac = -1;
  }

  /** Pulls a scripted camera position toward its target until nothing visible stands in between. */
  private unblock(pos: Vector3, target: Vector3, dt: number): Vector3 {
    if (!this.occlude) return pos;
    const len = Vector3.Distance(pos, target);
    if (len < 0.4) return pos;
    this.occT -= dt;
    if (this.occT <= 0) {
      this.occT = 0.1;
      // start off the subject (further for wider shots) so whatever the subject stands in or sits in (a boat's
      // hull round its centre) doesn't count as being in front of the lens
      const dir = pos.subtract(target).scale(1 / len);
      const off = Math.min(1.6, Math.max(0.25, len * 0.22));
      const start = target.add(dir.scale(off));
      const d = this.occlude(start, pos);
      // never closer than 0.8 m: past that a face is cropped to a chin, worse than a sliver of whatever is in the way
      this.occWant = d === null ? 1 : Math.max(Math.min(1, 0.8 / len), 0.12, (d + off - 0.3) / len);
    }
    this.occFrac = this.occFrac < 0 ? this.occWant : this.occFrac + (this.occWant - this.occFrac) * Math.min(1, dt * 6);
    return this.occFrac >= 0.999 ? pos : Vector3.Lerp(target, pos, this.occFrac);
  }

  release(): void {
    this.shot = null;
    this.holdShot = null;
    // continue orbit from where the shot left the camera
    const f = this.follow?.() ?? this.focus;
    const d = this.cam.position.subtract(f);
    this.yaw = Math.atan2(-d.x, -d.z);
  }

  private look(t: Vector3): void {
    this.target.copyFrom(t);
    this.cam.setTarget(t);
  }

  get scripted(): boolean { return !!(this.shot || this.holdShot); }

  /** How far the followed point has moved since the shot was set (smoothed), for tracking shots. */
  private track(s: Shot, dt: number): Vector3 {
    if (!s.follow || !this.followRef || !this.followAt) return Vector3.Zero();
    this.followAt = Vector3.Lerp(this.followAt, s.follow(), Math.min(1, dt * 5));
    return this.followAt.subtract(this.followRef);
  }

  private trackCam(s: Shot, dt: number, fallback: Vector3): Vector3 {
    if (!s.followCam || !this.camRef || !this.camAt) return fallback;
    this.camAt = Vector3.Lerp(this.camAt, s.followCam(), Math.min(1, dt * 5));
    return this.camAt.subtract(this.camRef);
  }

  shake(amount: number): void { this.trauma = Math.min(1, this.trauma + amount); }

  update(dt: number, look: { x: number; y: number }): void {
    this.t += dt;
    if (this.shot) {
      const s = this.shot;
      s.t += dt;
      let u = Math.min(1, s.t / Math.max(s.dur, 1e-3));
      u = s.ease === 'linear' ? u : s.ease === 'out' ? 1 - (1 - u) ** 3 : u * u * (3 - 2 * u);
      const mv = this.track(s.to, dt).scale(u);
      const mc = this.trackCam(s.to, dt, mv).scale(s.to.followCam ? u : 1);
      const tg = Vector3.Lerp(s.from.target, s.to.target, u).add(mv);
      this.cam.position.copyFrom(this.unblock(Vector3.Lerp(s.from.pos, s.to.pos, u).add(mc), tg, dt));
      this.look(tg);
      this.cam.fov = (s.from.fov ?? this.fovBase) + ((s.to.fov ?? this.fovBase) - (s.from.fov ?? this.fovBase)) * u;
      if (s.t >= s.dur) { this.holdShot = s.to; this.shot = null; }
      this.applyShake(dt);
      return;
    }
    if (this.holdShot) {
      const mv = this.track(this.holdShot, dt);
      const mc = this.trackCam(this.holdShot, dt, mv);
      const tg = this.holdShot.target.add(mv);
      this.cam.position.copyFrom(this.unblock(this.holdShot.pos.add(mc), tg, dt));
      this.look(tg);
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
      // a big target (the serpent) is framed from further back and higher, so it never fills the screen
      const big = Math.max(0, (this.lockSize?.() ?? 0) - 2.0);
      const mid = Vector3.Lerp(this.focus, lt, 0.32);
      center = new Vector3(mid.x, this.focus.y + this.heightOffset + big * 0.5, mid.z);
      this.distTarget = Math.min(7.5 + big * 3, 4.6 + d.length() * 0.18 + big * 2.6);
    } else {
      this.distTarget = 4.6;
    }
    this.dist += (this.distTarget - this.dist) * Math.min(1, dt * 3);
    const dir = new Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    let free = this.col.raycast(center, dir, this.dist);
    // visible scenery without collision (awnings, roofs, rigging) also keeps the camera in front of it
    if (this.occlude) {
      this.playOccT -= dt;
      if (this.playOccT <= 0) {
        this.playOccT = 0.1;
        const d = this.occlude(center.add(dir.scale(0.3)), center.add(dir.scale(this.dist)));
        this.playFree = d === null ? 1e9 : Math.max(0.6, d + 0.3 - 0.35);
      }
      free = Math.min(free, this.playFree);
    }
    this.collided += (free - this.collided) * Math.min(1, dt * (free < this.collided ? 20 : 4));
    const pos = center.add(dir.scale(this.collided));
    // pushed in close by a wall or a slope: rise over the player's head instead of sinking into their body
    if (this.collided < 2.4) {
      const lift = (2.4 - this.collided) * 0.5;
      pos.y += lift;
      center.y += lift * 0.25;
    }
    this.cam.position.copyFrom(pos);
    this.look(center);
    this.cam.fov += (this.fovBase - this.cam.fov) * Math.min(1, dt * 4);
    this.applyShake(dt);
  }

  /** Lifts the lens clear of the sea surface (scripted or not). */
  private aboveWater(): void {
    if (!this.waterAt) return;
    const p = this.cam.position;
    const w = this.waterAt(p.x, p.z) + 0.3;
    if (p.y < w) p.y = w;
  }

  private applyShake(dt: number): void {
    this.aboveWater();
    if (this.trauma <= 0) return;
    const s = this.trauma * this.trauma;
    const t = this.t * 38;
    const off = new Vector3(Math.sin(t * 1.1) * 0.12 * s, Math.sin(t * 1.7 + 1) * 0.1 * s, Math.sin(t * 1.3 + 2) * 0.08 * s);
    this.cam.position.addInPlace(off);
    const tg = this.target.add(off.scale(0.5));
    this.look(tg);
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
  }
}
