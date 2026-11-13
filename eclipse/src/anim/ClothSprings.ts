import { Quaternion, Vector3, type TransformNode } from '@babylonjs/core';
import type { RigBinding } from './Animator';

interface Panel {
  node: TransformNode;
  rest: Quaternion;
  /** The bone's rest direction (its +Y) and the way the panel faces out, both in pelvis space. */
  dir: Vector3;
  out: Vector3;
  /** Spring state: the swing offset added to `dir`, and its rate. */
  o: Vector3;
  v: Vector3;
}

const Y = new Vector3(0, 1, 0);
const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();
const tmpV = new Vector3();
const tmpV2 = new Vector3();
const target = new Vector3();

/**
 * Secondary motion for hanging cloth (robes, skirts, tabards): four hem bones under the pelvis
 * (cloth_f / _b / _l / _r, added by tools/blender/cloth.py) swung by damped springs after the
 * animation is posed. Each panel hangs along the effective gravity (gravity less the hips'
 * acceleration, so it trails a lunge and swings on after a stop, like a pendulum), flares out when
 * the body spins, and is pushed out by a thigh swinging into it (a stride or a kick lifts the front
 * of a robe instead of passing through it).
 */
export class ClothSprings {
  stiffness = 60;
  damping = 6.5;
  /** How strongly the hips' acceleration tilts the hang (1 = a free pendulum). */
  inertia = 1.2;
  /** How far the hem follows that hang, against the waist holding it to the body's own angle. */
  gravity = 0.7;
  flare = 0.06;
  kick = 0.75;
  /** Largest swing (offset of the unit bone direction: 0.7 is about 35 degrees). */
  max = 0.7;
  /** How much each panel shares its neighbours' targets, so the hem moves as one ring of cloth. */
  coupling = 0.3;

  private panels: Panel[] = [];
  private targets: Vector3[] = [];
  private ring: number[][] = [];
  private thighs: { node: TransformNode; rest: Vector3 }[] = [];
  private lastPos = new Vector3();
  private vel = new Vector3();
  private accel = new Vector3();
  private lastFwd = new Vector3();
  private yawRate = 0;
  private started = false;

  static create(rig: RigBinding): ClothSprings | null {
    return rig.bone('cloth_f') ? new ClothSprings(rig) : null;
  }

  private pelvis: TransformNode;
  /** Down, in pelvis space, in the bind pose: the hang is measured from it. */
  private restDown = new Vector3(0, -1, 0);

  private constructor(rig: RigBinding) {
    this.pelvis = rig.bone('pelvis')!;
    this.pelvis.computeWorldMatrix(true);
    Quaternion.InverseToRef(this.pelvis.absoluteRotationQuaternion, tmpQ);
    this.restDown.set(0, -1, 0).rotateByQuaternionToRef(tmpQ, this.restDown);
    for (const name of ['cloth_f', 'cloth_b', 'cloth_l', 'cloth_r']) {
      const node = rig.bone(name);
      if (!node) continue;
      const i = rig.index.get(name)!;
      const r = rig.rest.rot;
      const rest = new Quaternion(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
      const dir = Y.rotateByQuaternionToRef(rest, new Vector3()).normalize();
      // outward: the bone's head away from the pelvis, across the pelvis's own up axis
      const out = node.position.clone();
      out.subtractInPlace(Y.scale(Vector3.Dot(out, Y)));
      if (out.lengthSquared() < 1e-8) out.copyFrom(dir.cross(Y));
      out.normalize();
      this.panels.push({ node, rest, dir, out, o: new Vector3(), v: new Vector3() });
      this.targets.push(new Vector3());
    }
    // ring neighbours: front and back sit between left and right, and the sides between them
    this.ring = this.panels.map((p) => this.panels.map((q, j) => (Math.abs(Vector3.Dot(p.out, q.out)) < 0.5 ? j : -1)).filter((j) => j >= 0));
    for (const name of ['thigh_l', 'thigh_r']) {
      const node = rig.bone(name);
      const i = rig.index.get(name);
      if (!node || i === undefined) continue;
      const r = rig.rest.rot;
      const q = new Quaternion(r[i * 4], r[i * 4 + 1], r[i * 4 + 2], r[i * 4 + 3]);
      this.thighs.push({ node, rest: Y.rotateByQuaternionToRef(q, new Vector3()).normalize() });
    }
  }

  update(dt: number): void {
    if (dt <= 0 || !this.panels.length) return;
    const pelvis = this.pelvis;
    pelvis.computeWorldMatrix(true);
    const pos = pelvis.getAbsolutePosition();
    const wq = pelvis.absoluteRotationQuaternion;
    const fwd = tmpV.copyFrom(Vector3.Forward()).rotateByQuaternionToRef(wq, tmpV);
    fwd.y = 0;
    if (!this.started) {
      this.started = true;
      this.lastPos.copyFrom(pos);
      this.lastFwd.copyFrom(fwd);
      return;
    }
    // hips' velocity and acceleration (world), low-passed so a walk's bob doesn't jitter the hem
    const vx = (pos.x - this.lastPos.x) / dt;
    const vy = (pos.y - this.lastPos.y) / dt;
    const vz = (pos.z - this.lastPos.z) / dt;
    const k = 1 - Math.exp(-dt / 0.06);
    this.accel.x += ((vx - this.vel.x) / dt - this.accel.x) * k;
    this.accel.y += ((vy - this.vel.y) / dt - this.accel.y) * k;
    this.accel.z += ((vz - this.vel.z) / dt - this.accel.z) * k;
    this.vel.set(vx, vy, vz);
    this.lastPos.copyFrom(pos);
    if (vx * vx + vy * vy + vz * vz > 900) {
      this.reset(); // teleported
      return;
    }
    // turning: yaw rate of the hips
    const cross = this.lastFwd.x * fwd.z - this.lastFwd.z * fwd.x;
    const dot = this.lastFwd.x * fwd.x + this.lastFwd.z * fwd.z;
    const yr = Math.atan2(cross, dot) / dt;
    this.yawRate += (yr - this.yawRate) * (1 - Math.exp(-dt / 0.1));
    this.lastFwd.copyFrom(fwd);
    // effective gravity in pelvis space: the way a pendulum on the hips would hang right now
    Quaternion.InverseToRef(wq, tmpQ);
    const s = this.inertia;
    const down = tmpV2.set(-this.accel.x * s, -9.81 - Math.max(-6, Math.min(6, this.accel.y * s)), -this.accel.z * s);
    const dl = down.length();
    if (dl > 30) down.scaleInPlace(30 / dl);
    down.normalize().rotateByQuaternionToRef(tmpQ, down);
    const flare = Math.min(0.4, Math.abs(this.yawRate) * this.flare);
    this.panels.forEach((p, i) => {
      // hang toward the ground, flare out on a spin, and give way to a thigh swinging into the panel
      const t0 = this.targets[i].copyFrom(down).subtractInPlace(this.restDown).scaleInPlace(this.gravity);
      t0.addInPlace(p.out.scale(flare));
      for (const t of this.thighs) {
        const q = t.node.rotationQuaternion;
        if (!q) continue;
        const cur = Y.rotateByQuaternionToRef(q, tmpV);
        const push = Vector3.Dot(cur, p.out) - Vector3.Dot(t.rest, p.out);
        if (push > 0) t0.addInPlace(p.out.scale(push * this.kick));
      }
    });
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i];
      // a panel pushed out drags its neighbours part of the way (cloth is one piece)
      target.copyFrom(this.targets[i]).scaleInPlace(1 - this.coupling);
      const nb = this.ring[i];
      for (const j of nb) target.addInPlace(this.targets[j].scale(this.coupling / Math.max(1, nb.length)));
      if (!nb.length) target.copyFrom(this.targets[i]);
      // damped spring (semi-implicit Euler)
      p.v.x += (this.stiffness * (target.x - p.o.x) - this.damping * p.v.x) * dt;
      p.v.y += (this.stiffness * (target.y - p.o.y) - this.damping * p.v.y) * dt;
      p.v.z += (this.stiffness * (target.z - p.o.z) - this.damping * p.v.z) * dt;
      p.o.addInPlace(p.v.scale(dt));
      const len = p.o.length();
      if (len > this.max) {
        p.o.scaleInPlace(this.max / len);
        p.v.scaleInPlace(0.5);
      }
      // swing the bone from its rest direction to (rest + offset), about its head
      const nd = tmpV.copyFrom(p.dir).addInPlace(p.o).normalize();
      Quaternion.FromUnitVectorsToRef(p.dir, nd, tmpQ2);
      const rq = p.node.rotationQuaternion ?? (p.node.rotationQuaternion = new Quaternion());
      tmpQ2.multiplyToRef(p.rest, rq);
    }
  }

  /** Settle instantly (after a teleport or a cut). */
  reset(): void {
    this.started = false;
    for (const p of this.panels) {
      p.o.setAll(0);
      p.v.setAll(0);
    }
    this.accel.setAll(0);
    this.vel.setAll(0);
    this.yawRate = 0;
  }
}
