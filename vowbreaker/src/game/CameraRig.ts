import { FreeCamera, Vector3 } from '@babylonjs/core';
import type { PostChain } from '../render/PostChain';

export interface Shot {
  pos: Vector3;
  target: Vector3;
  fov?: number;
  roll?: number;
}

interface Rail {
  from: Shot;
  to: Shot;
  t: number;
  dur: number;
  ease: (x: number) => number;
}

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/**
 * The camera: in fights it frames the player and the target from behind the player's shoulder,
 * pulling out as they separate; in cutscenes the director gives it shots and rails. Shake,
 * a zoom punch on big hits and a gentle handheld drift sit on top of both.
 */
export class CameraRig {
  mode: 'fight' | 'shot' | 'orbit' = 'fight';
  player: { pos: Vector3; height: number } | null = null;
  target: { pos: Vector3; height: number } | null = null;
  private pos = new Vector3(0, 2, -6);
  private look = new Vector3(0, 1, 0);
  private fov = 0.8;
  private shake = 0;
  private shakeT = 0;
  private punch = 0;
  private rail: Rail | null = null;
  /** side of the player the camera sits on (+1 right shoulder, -1 left) */
  side = 1;
  baseFov = 0.82;
  handheld = 0.012;
  private t = 0;
  orbitAngle = 0;
  orbitCenter = new Vector3();
  orbitRadius = 6;
  orbitHeight = 2;
  orbitSpeed = 0.15;

  constructor(readonly cam: FreeCamera, private post: PostChain) {}

  addShake(amount: number): void {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  zoomPunch(amount: number): void {
    this.punch = Math.max(this.punch, amount);
  }

  /** Cut to a static shot (no blur across the cut). */
  cut(s: Shot): void {
    this.mode = 'shot';
    this.rail = null;
    this.pos.copyFrom(s.pos);
    this.look.copyFrom(s.target);
    this.fov = s.fov ?? this.baseFov;
    this.post.cutPending = true;
  }

  /** Move from one shot to another over `dur` seconds. */
  move(from: Shot, to: Shot, dur: number, ease = easeInOut): void {
    this.cut(from);
    this.rail = { from: { ...from, fov: from.fov ?? this.baseFov }, to: { ...to, fov: to.fov ?? this.baseFov }, t: 0, dur, ease };
  }

  orbit(center: Vector3, radius: number, height: number, startAngle: number, speed: number): void {
    this.mode = 'orbit';
    this.orbitCenter.copyFrom(center);
    this.orbitRadius = radius;
    this.orbitHeight = height;
    this.orbitAngle = startAngle;
    this.orbitSpeed = speed;
    this.post.cutPending = true;
  }

  fight(): void {
    if (this.mode !== 'fight') this.post.cutPending = true;
    this.mode = 'fight';
    this.rail = null;
    this.snap = true;
  }

  private snap = true;

  get railDone(): boolean {
    return !this.rail || this.rail.t >= this.rail.dur;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.mode === 'fight' && this.player) {
      const p = this.player.pos;
      const tg = this.target ? this.target.pos : null;
      let fwd: Vector3;
      let sep = 0;
      if (tg) {
        fwd = tg.subtract(p);
        fwd.y = 0;
        sep = fwd.length();
        if (sep < 0.01) fwd.set(0, 0, 1);
        fwd.normalize();
      } else {
        fwd = this.look.subtract(this.pos);
        fwd.y = 0;
        fwd.normalize();
      }
      const right = new Vector3(fwd.z, 0, -fwd.x);
      const back = 3.0 + Math.min(sep, 14) * 0.45;
      const up = 1.45 + Math.min(sep, 14) * 0.09;
      const wantPos = p.add(fwd.scale(-back)).add(right.scale(this.side * (2.1 + sep * 0.12))).add(new Vector3(0, up, 0));
      wantPos.y = Math.max(wantPos.y, p.y * 0.5 + 1.2);
      const mid = tg ? p.add(tg).scale(0.5) : p.add(fwd.scale(3));
      const wantLook = mid.add(new Vector3(0, (this.player.height * 0.55) + (tg ? Math.max(tg.y, p.y) * 0.4 : 0), 0));
      const k = this.snap ? 1 : 1 - Math.exp(-dt * 5);
      const kl = this.snap ? 1 : 1 - Math.exp(-dt * 7);
      this.snap = false;
      this.pos.addInPlace(wantPos.subtract(this.pos).scale(k));
      this.look.addInPlace(wantLook.subtract(this.look).scale(kl));
      this.fov += (this.baseFov - this.fov) * (1 - Math.exp(-dt * 4));
    } else if (this.mode === 'orbit') {
      this.orbitAngle += this.orbitSpeed * dt;
      this.pos.set(this.orbitCenter.x + Math.sin(this.orbitAngle) * this.orbitRadius, this.orbitCenter.y + this.orbitHeight,
        this.orbitCenter.z + Math.cos(this.orbitAngle) * this.orbitRadius);
      this.look.copyFrom(this.orbitCenter).addInPlaceFromFloats(0, 1, 0);
    } else if (this.rail) {
      const r = this.rail;
      r.t = Math.min(r.dur, r.t + dt);
      const e = r.ease(r.dur > 0 ? r.t / r.dur : 1);
      Vector3.LerpToRef(r.from.pos, r.to.pos, e, this.pos);
      Vector3.LerpToRef(r.from.target, r.to.target, e, this.look);
      this.fov = (r.from.fov ?? this.baseFov) + ((r.to.fov ?? this.baseFov) - (r.from.fov ?? this.baseFov)) * e;
    }
    // shake (noise, decaying), punch, handheld drift
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.shakeT += dt * 38;
    const s = this.shake * this.shake * 0.35;
    const n = (a: number) => Math.sin(this.shakeT * a) * 0.6 + Math.sin(this.shakeT * a * 2.31 + 1.7) * 0.4;
    const hh = this.handheld;
    const off = new Vector3(n(1.0) * s + Math.sin(this.t * 0.7) * hh, n(1.3) * s + Math.sin(this.t * 0.53 + 2) * hh, n(0.9) * s * 0.5);
    this.punch = Math.max(0, this.punch - dt * 3);
    this.cam.position.copyFrom(this.pos.add(off));
    this.cam.setTarget(this.look.add(off.scale(0.5)));
    this.cam.fov = Math.max(0.25, this.fov - this.punch * 0.25);
  }

  get lookAt(): Vector3 {
    return this.look;
  }

  get position(): Vector3 {
    return this.pos;
  }
}
