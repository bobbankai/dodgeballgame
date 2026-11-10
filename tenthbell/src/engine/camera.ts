// One camera for everything: it frames a fight from the side, and takes directed shots in cutscenes.
import { Scalar, Vector3 } from '@babylonjs/core';
import { Gfx } from './gfx';

export interface Shot { pos: [number, number, number]; look: [number, number, number]; fov?: number; /** depth of field: focus distance in metres, 0 = off */ focus?: number; fstop?: number }
const ease = (t: number) => t * t * (3 - 2 * t);

export class Cam {
  pos = new Vector3(0, 1.3, 6); look = new Vector3(0, 1.0, 0); fov = 0.52;
  /** 0..1, decays: violence of the camera shake */ trauma = 0;
  /** extra zoom that springs back (a punch-in on big hits) */ kick = 0;
  private from: { pos: Vector3; look: Vector3; fov: number } | null = null;
  private to: Shot | null = null; private tt = 0; private dur = 0; private done: (() => void) | null = null;
  private time = 0; private roll = 0;
  /** hand-held drift in cutscenes */ sway = 0;

  constructor(private g: Gfx) {}

  /** Frame two fighters standing at xa and xb. */
  fight(xa: number, xb: number, dt: number, bound = 6.2) {
    const mid = (xa + xb) / 2, sep = Math.abs(xa - xb);
    const dist = Scalar.Clamp(3.7 + sep * 1.05, 4.7, 9.2);
    const cx = Scalar.Clamp(mid, -bound + dist * 0.42, bound - dist * 0.42);
    const k = 1 - Math.exp(-dt * 5.5);
    this.pos.x += (cx * 0.92 - this.pos.x) * k;
    this.pos.y += (1.22 + sep * 0.03 - this.pos.y) * k;
    this.pos.z += (dist - this.pos.z) * k;
    this.look.x += (cx - this.look.x) * k;
    this.look.y += (1.02 - this.look.y) * k;
    this.look.z += (0 - this.look.z) * k;
    this.fov += (0.52 - this.fov) * k;
    this.focus(0);
  }

  /** Move to a shot over dur seconds (0 = cut). Resolves when it arrives; needs update() to be called. */
  shot(s: Shot, dur = 0): Promise<void> {
    this.done?.();
    if (s.focus !== undefined) this.focus(s.focus, s.fstop);
    if (dur <= 0) {
      this.pos.set(...s.pos); this.look.set(...s.look); this.fov = s.fov ?? this.fov;
      this.to = null;
      return Promise.resolve();
    }
    this.from = { pos: this.pos.clone(), look: this.look.clone(), fov: this.fov };
    this.to = s; this.tt = 0; this.dur = dur;
    return new Promise((r) => { this.done = r; });
  }

  focus(metres: number, fstop = 2.0) {
    const p = this.g.pipe;
    if (!this.g.tier.dof) return;
    const on = metres > 0;
    if (p.depthOfFieldEnabled !== on) p.depthOfFieldEnabled = on;
    if (on) { p.depthOfField.focusDistance = metres * 1000; p.depthOfField.fStop = fstop; p.depthOfField.focalLength = 85; }
  }

  update(dt: number) {
    this.time += dt;
    if (this.to) {
      this.tt += dt;
      const k = ease(Math.min(1, this.tt / this.dur));
      const f = this.from!, t = this.to;
      Vector3.LerpToRef(f.pos, new Vector3(...t.pos), k, this.pos);
      Vector3.LerpToRef(f.look, new Vector3(...t.look), k, this.look);
      this.fov = f.fov + ((t.fov ?? f.fov) - f.fov) * k;
      if (this.tt >= this.dur) { this.to = null; const d = this.done; this.done = null; d?.(); }
    }
    this.trauma = Math.max(0, this.trauma - dt * 1.9);
    this.kick += (0 - this.kick) * Math.min(1, dt * 9);
    const s = this.trauma * this.trauma, t = this.time;
    const n = (a: number, b: number) => Math.sin(t * a) * Math.sin(t * b + 1.7);
    const c = this.g.camera;
    c.position.set(this.pos.x + s * 0.09 * n(61, 23) + this.sway * 0.02 * n(0.7, 0.31), this.pos.y + s * 0.07 * n(53, 31) + this.sway * 0.015 * n(0.53, 0.23), this.pos.z + s * 0.05 * n(47, 19));
    const dir = this.look.subtract(this.pos);
    c.position.addInPlace(dir.scale(this.kick * 0.1));
    c.upVector.set(Math.sin(this.roll + s * 0.03 * n(71, 29)), 1, 0).normalize();
    c.setTarget(this.look);
    c.fov = this.fov * (1 - this.kick * 0.08);
  }
}
