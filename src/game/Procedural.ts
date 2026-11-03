import * as THREE from 'three';

/** A bone that swings loose (a scarf, a braid, a satchel): a damped spring driven by how the body moves. */
export interface LooseBone {
  bone: string;
  /** Degrees of swing per m/s² of acceleration. */
  gain: number;
  /** Spring stiffness (1/s²) and damping (1/s): lower swings slower and longer. */
  stiff?: number;
  damp?: number;
  /** Largest swing either way, degrees. */
  max?: number;
  /** Hangs down (true) or stands up: which way "behind" is. */
  down?: boolean;
}

export interface ProceduralOptions {
  /** Bones that turn to look, chest first, with their share of the turn (yaw, pitch). */
  look?: [string, number, number][];
  /** Turn no further than this (radians) each way; beyond it the head comes back to the front. */
  maxYaw?: number;
  maxPitch?: number;
  loose?: LooseBone[];
}

const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _mq = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _h = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
const _acc = new THREE.Vector3();
const DEG = Math.PI / 180;

interface Managed {
  bone: THREE.Object3D;
  /** What the mixer last wrote (we put it back before the mixer runs again). */
  mixed: THREE.Quaternion;
}

/**
 * Life layered on top of the animation clips: the head (and a little of the neck and chest) turns
 * to look at things, and loose things swing behind when the body speeds up, stops or turns.
 *
 * The mixer only writes a bone when its own value changes, so every bone this touches is put back
 * to the mixer's value before the mixer runs (before()), then turned on top of it (after()).
 */
export class Procedural {
  /** A world point to look at, or null to look where the body faces. */
  look: THREE.Vector3 | null = null;
  /** How much of the turn to make (cutscene poses and running turn it down). */
  lookWeight = 1;
  private bones = new Map<string, Managed>();
  private yaw = 0;
  private pitch = 0;
  private weight = 0;
  private springs: { def: LooseBone; p: number; r: number; vp: number; vr: number }[] = [];
  private last = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private fresh = true;
  private head: THREE.Object3D | null = null;

  constructor(private model: THREE.Object3D, private opts: ProceduralOptions) {
    const take = (name: string) => {
      const bone = model.getObjectByName(name);
      if (bone && !this.bones.has(name)) this.bones.set(name, { bone, mixed: bone.quaternion.clone() });
      return bone;
    };
    for (const [name] of opts.look ?? []) take(name);
    for (const l of opts.loose ?? []) if (take(l.bone)) this.springs.push({ def: l, p: 0, r: 0, vp: 0, vr: 0 });
    this.head = model.getObjectByName('head') ?? null;
  }

  /** Where the head is (for others to look at). */
  headPosition(out: THREE.Vector3) {
    if (!this.head) return this.model.getWorldPosition(out).add(_v.set(0, 1.2, 0));
    this.head.getWorldPosition(out);
    return out;
  }

  /** Teleported: don't swing from the jump. */
  reset() {
    this.fresh = true;
    for (const s of this.springs) s.p = s.r = s.vp = s.vr = 0;
  }

  /** Call just before the mixer updates. */
  before() {
    for (const m of this.bones.values()) m.bone.quaternion.copy(m.mixed);
  }

  /** Call just after the mixer updates. */
  after(dt: number) {
    for (const m of this.bones.values()) m.mixed.copy(m.bone.quaternion);
    if (dt <= 0) return;
    this.model.updateWorldMatrix(true, false);
    this.model.getWorldQuaternion(_mq);
    _ax.set(1, 0, 0).applyQuaternion(_mq);
    _ay.set(0, 1, 0).applyQuaternion(_mq);
    _az.set(0, 0, 1).applyQuaternion(_mq);
    this.applyLook(dt);
    this.applyLoose(dt);
  }

  /** Turn a bone by a world-space rotation, keeping the rest of its pose. */
  private turn(bone: THREE.Object3D, world: THREE.Quaternion) {
    bone.parent!.getWorldQuaternion(_pq);
    // local' = P⁻¹ · R · P · local
    _q.copy(_pq).invert().multiply(world).multiply(_pq);
    bone.quaternion.premultiply(_q);
  }

  private applyLook(dt: number) {
    const look = this.opts.look;
    if (!look?.length) return;
    let wantYaw = 0, wantPitch = 0, wantW = 0;
    if (this.look && this.head) {
      // where the target is, seen from the head, in the body's own frame (forward is +Z)
      this.head.getWorldPosition(_h);
      _v.subVectors(this.look, _h);
      const x = _v.dot(_ax), y = _v.dot(_ay), z = _v.dot(_az);
      const yaw = Math.atan2(x, z), pitch = Math.atan2(y, Math.hypot(x, z));
      const maxYaw = this.opts.maxYaw ?? 1.2, maxPitch = this.opts.maxPitch ?? 0.5;
      // behind her: the head comes back round rather than wrench over the shoulder
      const behind = THREE.MathUtils.smoothstep(Math.abs(yaw), maxYaw + 0.25, maxYaw + 0.75);
      wantYaw = THREE.MathUtils.clamp(yaw, -maxYaw, maxYaw);
      wantPitch = THREE.MathUtils.clamp(pitch, -maxPitch, maxPitch);
      wantW = (1 - behind) * this.lookWeight;
    }
    const k = 1 - Math.exp(-dt * 5);
    this.weight += (wantW - this.weight) * k;
    // the head leads, the angles follow a touch behind (eyes first, then the head, as people do)
    if (wantW > 0.01) {
      this.yaw += (wantYaw - this.yaw) * k;
      this.pitch += (wantPitch - this.pitch) * k;
    }
    if (this.weight < 0.002) return;
    for (const [name, sy, sp] of look) {
      const m = this.bones.get(name);
      if (!m) continue;
      _qy.setFromAxisAngle(_ay, this.yaw * sy * this.weight);
      // (pitch about the turned right-hand axis: look up is a turn back about +X)
      _qx.setFromAxisAngle(_ax, -this.pitch * sp * this.weight);
      this.turn(m.bone, _qy.multiply(_qx));
    }
  }

  private applyLoose(dt: number) {
    if (!this.springs.length) return;
    this.model.getWorldPosition(_v);
    if (this.fresh || _v.distanceToSquared(this.last) > 4) {
      this.last.copy(_v);
      this.vel.set(0, 0, 0);
      this.fresh = false;
      return;
    }
    const v = _h.subVectors(_v, this.last).divideScalar(dt);
    this.last.copy(_v);
    _acc.subVectors(v, this.vel).divideScalar(dt);
    this.vel.copy(v);
    if (_acc.length() > 40) _acc.setLength(40);
    const fwd = _acc.dot(_az), side = _acc.dot(_ax), up = _acc.dot(_ay);
    // sub-steps keep the stiff springs stable at low frame rates
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (const s of this.springs) {
      const d = s.def, k = d.stiff ?? 90, c = d.damp ?? 9, g = d.gain * DEG;
      // speeding up swings it back, stopping swings it on; a sideways push swings it out the other way
      // (a falling body lets it lift)
      // (scaled by the stiffness so `gain` is the swing a steady push settles at)
      const fp = k * g * (fwd - Math.min(0, up) * 0.3) * (d.down === false ? -1 : 1);
      const fr = -k * g * side;
      for (let i = 0; i < n; i++) {
        s.vp += (fp - k * s.p - c * s.vp) * h;
        s.vr += (fr - k * s.r - c * s.vr) * h;
        s.p += s.vp * h;
        s.r += s.vr * h;
      }
      const max = (d.max ?? 25) * DEG;
      s.p = THREE.MathUtils.clamp(s.p, -max, max);
      s.r = THREE.MathUtils.clamp(s.r, -max, max);
      const m = this.bones.get(d.bone)!;
      _qx.setFromAxisAngle(_ax, s.p);
      _qy.setFromAxisAngle(_az, s.r);
      this.turn(m.bone, _qx.multiply(_qy));
    }
  }
}
