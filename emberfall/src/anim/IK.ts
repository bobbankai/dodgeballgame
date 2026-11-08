// Inverse kinematics for the characters.
//
// solveTwoBone: the analytic two-joint solver (shoulder-elbow-wrist, hip-knee-ankle). Given the chain's
// current world pose and a target, it first bends the middle joint so the chain spans exactly the
// distance to the target (law of cosines), then swings the whole chain to point at it. The bend happens
// in the chain's existing plane, so knees keep bending forwards the way the animation had them, and an
// optional pole vector can steer that plane.
//
// FootIK: feet that stand on the ground they are actually on. Each frame, after the animation:
//   - a ray under each foot finds the ground's height and slope there,
//   - the pelvis drops by however far the lower foot has to reach down (stairs, slopes, a rock),
//   - each leg is bent with solveTwoBone to put its foot on its own ground,
//   - and each foot tilts to the slope beneath it, as much as an ankle can.
// Offsets are smoothed so feet do not snap from step to step, and the whole effect fades with a weight the
// owner controls (off in the air, lighter at a sprint). The pose the animation wrote is restored before the
// next frame's animation runs, so the corrections never accumulate.
import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _footT = new THREE.Vector3(); // FootIK's target (solveTwoBone uses _t internally)
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _bc = new THREE.Vector3();
const _ba = new THREE.Vector3();
const _at = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

/** rotate a bone by a world-space rotation, keeping its children attached */
export function rotateBoneWorld(bone: THREE.Object3D, r: THREE.Quaternion): void {
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(r);
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_pq);
    _pq.invert();
    bone.quaternion.copy(_pq.multiply(_wq));
  } else bone.quaternion.copy(_wq);
  bone.updateMatrixWorld(true);
}

export interface TwoBoneResult {
  /** the target was out of reach (the chain was straightened towards it) */
  clamped: boolean;
  /** distance from the end effector to the target after solving */
  error: number;
}

/**
 * bend the chain root -> mid -> end so `end` reaches `target` (world space). `weight` blends between the
 * current pose (0) and the solution (1). `pole`, when given, is a world point the middle joint should bend
 * towards.
 */
export function solveTwoBone(root: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, weight = 1, pole?: THREE.Vector3): TwoBoneResult {
  root.updateMatrixWorld(true);
  root.getWorldPosition(_a);
  mid.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const lab = _b.distanceTo(_a), lcb = _c.distanceTo(_b);
  const eps = 1e-4;
  const dist = _t.copy(target).sub(_a).length();
  const lat = THREE.MathUtils.clamp(dist, eps, lab + lcb - eps);
  const clamped = dist > lab + lcb - eps;
  _ab.copy(_b).sub(_a).normalize();
  _ac.copy(_c).sub(_a).normalize();
  _ba.copy(_a).sub(_b).normalize();
  _bc.copy(_c).sub(_b).normalize();
  // current and desired interior angles at the root and at the middle joint
  const ac_ab0 = Math.acos(clamp1(_ac.dot(_ab)));
  const ba_bc0 = Math.acos(clamp1(_ba.dot(_bc)));
  const ac_ab1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const ba_bc1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
  // the bend axis: normal of the chain's plane (or of the plane through the pole)
  if (pole) {
    _at.copy(pole).sub(_a);
    _axis.crossVectors(_ac, _at);
  } else _axis.crossVectors(_ac, _ab);
  if (_axis.lengthSq() < 1e-10) {
    // a straight chain has no plane: pick any axis perpendicular to it
    _axis.set(1, 0, 0);
    if (Math.abs(_ac.x) > 0.9) _axis.set(0, 0, 1);
    _axis.cross(_ac);
  }
  _axis.normalize();
  if (pole) {
    // the knee should end on the pole's side: the axis sign follows from the root angle direction
    _axis.negate();
  }
  // 1) bend: open / close the root and middle joints
  _q.setFromAxisAngle(_axis, (ac_ab1 - ac_ab0) * weight);
  rotateBoneWorld(root, _q);
  _q.setFromAxisAngle(_axis, (ba_bc1 - ba_bc0) * weight);
  rotateBoneWorld(mid, _q);
  // 2) swing: point the chain at the target
  end.getWorldPosition(_c);
  _ac.copy(_c).sub(_a).normalize();
  _at.copy(target).sub(_a).normalize();
  _q.setFromUnitVectors(_ac, _at);
  if (weight < 1) _q.slerp(new THREE.Quaternion(), 1 - weight);
  rotateBoneWorld(root, _q);
  end.getWorldPosition(_c);
  return { clamped, error: _c.distanceTo(target) };
}

/** what the IK asks of the world under a foot */
export type GroundProbe = (x: number, y: number, z: number, normal: THREE.Vector3) => number | null;

interface Leg {
  thigh: THREE.Bone;
  calf: THREE.Bone;
  foot: THREE.Bone;
  /** smoothed vertical correction (m) */
  offset: number;
  /** smoothed ground normal */
  normal: THREE.Vector3;
  /** last frame's ground height (for the debug view) */
  ground: number;
}

export interface FootIKOptions {
  /** how far above the foot the probe starts / below it reaches (m) */
  probeUp?: number;
  probeDown?: number;
  /** most the pelvis may drop (m) */
  maxDrop?: number;
  /** steepest tilt the ankle follows (degrees) */
  maxTilt?: number;
  /** smoothing speed (1/s) */
  speed?: number;
}

export class FootIK {
  /** 0..1, set by the owner each frame (0 in the air) */
  weight = 1;
  private w = 0;
  private legs: Leg[] = [];
  private pelvis: THREE.Bone | null;
  private pelvisOffset = 0;
  private saved = new Map<THREE.Bone, { q: THREE.Quaternion; p: THREE.Vector3 }>();
  private o: Required<FootIKOptions>;
  /** diagnostics */
  lastError = 0;

  constructor(bones: Map<string, THREE.Bone>, private probe: GroundProbe, o: FootIKOptions = {}) {
    this.o = { probeUp: o.probeUp ?? 0.6, probeDown: o.probeDown ?? 0.7, maxDrop: o.maxDrop ?? 0.45, maxTilt: o.maxTilt ?? 32, speed: o.speed ?? 14 };
    this.pelvis = bones.get('pelvis') ?? null;
    for (const s of ['l', 'r']) {
      const thigh = bones.get(`thigh_${s}`), calf = bones.get(`calf_${s}`), foot = bones.get(`foot_${s}`);
      if (thigh && calf && foot) this.legs.push({ thigh, calf, foot, offset: 0, normal: new THREE.Vector3(0, 1, 0), ground: 0 });
    }
  }

  get ready(): boolean { return this.legs.length === 2 && !!this.pelvis; }

  /** put back the animated pose (call before the animation updates) */
  restore(): void {
    for (const [b, s] of this.saved) { b.quaternion.copy(s.q); b.position.copy(s.p); }
  }

  /** remember the animated pose (call right after the animation updates) */
  capture(): void {
    const keep = (b: THREE.Bone | null) => {
      if (!b) return;
      const s = this.saved.get(b);
      if (s) { s.q.copy(b.quaternion); s.p.copy(b.position); } else this.saved.set(b, { q: b.quaternion.clone(), p: b.position.clone() });
    };
    keep(this.pelvis);
    for (const l of this.legs) { keep(l.thigh); keep(l.calf); keep(l.foot); }
  }

  /** apply after animation (and after capture); `root` is the character's root object */
  apply(dt: number, root: THREE.Object3D): void {
    if (!this.ready) return;
    const k = Math.min(1, dt * this.o.speed);
    this.w += (this.weight - this.w) * Math.min(1, dt * 8);
    if (this.w < 0.01) { for (const l of this.legs) { l.offset *= 1 - k; l.normal.lerp(UP, k); } this.pelvisOffset *= 1 - k; return; }
    root.updateMatrixWorld(true);
    const baseY = root.getWorldPosition(_a).y;
    // 1) where is the ground under each foot, relative to the plane the animation assumes (the root's)
    const want: number[] = [];
    for (const l of this.legs) {
      l.foot.getWorldPosition(_c);
      const n = _b.set(0, 1, 0);
      const g = this.probe(_c.x, baseY + this.o.probeUp, _c.z, n);
      let off = 0;
      if (g !== null && g > baseY - this.o.probeDown) off = THREE.MathUtils.clamp(g - baseY, -this.o.maxDrop, this.o.probeUp);
      l.ground = g ?? baseY;
      // only tilt to slopes the ankle can manage
      if (g !== null && n.y > Math.cos(THREE.MathUtils.degToRad(this.o.maxTilt))) l.normal.lerp(n, k).normalize();
      else l.normal.lerp(UP, k).normalize();
      l.offset += (off - l.offset) * k;
      want.push(l.offset);
    }
    // 2) the pelvis drops so the lower foot can reach its ground (never rises: legs cannot stretch)
    const drop = Math.min(0, Math.min(...want));
    this.pelvisOffset += (drop - this.pelvisOffset) * k;
    if (this.pelvis && Math.abs(this.pelvisOffset) > 1e-4) {
      this.pelvis.getWorldPosition(_b);
      _b.y += this.pelvisOffset * this.w;
      this.pelvis.parent!.worldToLocal(_b);
      this.pelvis.position.copy(_b);
      this.pelvis.updateMatrixWorld(true);
    }
    // 3) each foot to its own ground, then tilted to the slope
    let err = 0;
    for (const l of this.legs) {
      l.foot.getWorldPosition(_footT);
      // the animation's own lift of the foot above its plane is kept (a raised foot in the walk stays raised)
      _footT.y += (l.offset - this.pelvisOffset) * this.w;
      err = Math.max(err, solveTwoBone(l.thigh, l.calf, l.foot, _footT, this.w).error);
      if (l.normal.y < 0.9999) {
        _q.setFromUnitVectors(UP, l.normal);
        if (this.w < 1) _q.slerp(IDQ, 1 - this.w);
        rotateBoneWorld(l.foot, _q);
      }
    }
    this.lastError = err;
  }

  /** the smoothed pelvis drop (m), for debugging */
  get drop(): number { return this.pelvisOffset; }
}

const UP = new THREE.Vector3(0, 1, 0);
const IDQ = new THREE.Quaternion();

/** reach for a point with an arm (hand on a railing, a hand on Ren's shoulder): a thin wrapper for arms */
export function reachArm(bones: Map<string, THREE.Bone>, side: 'l' | 'r', target: THREE.Vector3, weight = 1, pole?: THREE.Vector3): TwoBoneResult | null {
  const up = bones.get(`upperarm_${side}`), low = bones.get(`lowerarm_${side}`), hand = bones.get(`hand_${side}`);
  if (!up || !low || !hand) return null;
  return solveTwoBone(up, low, hand, target, weight, pole);
}
