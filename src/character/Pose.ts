import * as THREE from 'three';
import { BONE_COUNT, BONE_INDEX, BONE_NAMES, BoneName, LOWER_BODY, UPPER_BODY, mirrorName } from './Skeleton';
import { armQuat } from './ArmIK';

/** Bones authored in arm space (raise, swing, twist) rather than Euler. */
export const ARM_BONES = new Set<number>([BONE_INDEX.upperArmL, BONE_INDEX.upperArmR]);
export function armSide(bone: number): 1 | -1 {
  return bone === BONE_INDEX.upperArmL ? 1 : -1;
}

const DEG = Math.PI / 180;

/** A full skeleton pose: local bone quaternions + hips translation offset. */
export class Pose {
  readonly q = new Float32Array(BONE_COUNT * 4);
  readonly root = new Float32Array(3);
  constructor() {
    this.identity();
  }
  identity() {
    for (let i = 0; i < BONE_COUNT; i++) {
      this.q[i * 4] = 0;
      this.q[i * 4 + 1] = 0;
      this.q[i * 4 + 2] = 0;
      this.q[i * 4 + 3] = 1;
    }
    this.root.fill(0);
    return this;
  }
  copy(p: Pose) {
    this.q.set(p.q);
    this.root.set(p.root);
    return this;
  }
  setEuler(bone: number, x: number, y: number, z: number) {
    eulerToQuat(x, y, z, this.q, bone * 4);
  }
  /** Blend toward `b` by w (0..1) for every bone (optionally weighted per bone). */
  blend(b: Pose, w: number, mask?: Float32Array) {
    if (w <= 0) return this;
    for (let i = 0; i < BONE_COUNT; i++) {
      const wi = mask ? w * mask[i] : w;
      if (wi <= 0) continue;
      nlerpInto(this.q, i * 4, b.q, i * 4, Math.min(1, wi));
    }
    const rw = mask ? w * mask[0] : w;
    for (let k = 0; k < 3; k++) this.root[k] += (b.root[k] - this.root[k]) * Math.min(1, rw);
    return this;
  }
  /** Multiply an additive rotation (Euler radians) onto a bone: q = q * add. */
  addEuler(bone: number, x: number, y: number, z: number) {
    if (x === 0 && y === 0 && z === 0) return;
    eulerToQuat(x, y, z, tmpQ, 0);
    mulInto(this.q, bone * 4, tmpQ);
  }
  /** Pre-multiply (rotation in parent space): q = add * q. */
  preEuler(bone: number, x: number, y: number, z: number) {
    if (x === 0 && y === 0 && z === 0) return;
    eulerToQuat(x, y, z, tmpQ, 0);
    preMulInto(this.q, bone * 4, tmpQ);
  }
  applyTo(bones: THREE.Bone[], bindOffsets: THREE.Vector3[]) {
    for (let i = 0; i < BONE_COUNT; i++) {
      bones[i].quaternion.set(this.q[i * 4], this.q[i * 4 + 1], this.q[i * 4 + 2], this.q[i * 4 + 3]);
    }
    const h = bones[0];
    h.position.set(bindOffsets[0].x + this.root[0], bindOffsets[0].y + this.root[1], bindOffsets[0].z + this.root[2]);
  }
}

const tmpQ = new Float32Array(4);

export function eulerToQuat(x: number, y: number, z: number, out: Float32Array, o: number) {
  // XYZ order (matches THREE.Euler default)
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[o] = s1 * c2 * c3 + c1 * s2 * s3;
  out[o + 1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[o + 2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[o + 3] = c1 * c2 * c3 - s1 * s2 * s3;
}

function nlerpInto(a: Float32Array, ao: number, b: Float32Array, bo: number, t: number) {
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  const dot = a[ao] * bx + a[ao + 1] * by + a[ao + 2] * bz + a[ao + 3] * bw;
  if (dot < 0) {
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  const x = a[ao] + (bx - a[ao]) * t;
  const y = a[ao + 1] + (by - a[ao + 1]) * t;
  const z = a[ao + 2] + (bz - a[ao + 2]) * t;
  const w = a[ao + 3] + (bw - a[ao + 3]) * t;
  const l = Math.hypot(x, y, z, w) || 1;
  a[ao] = x / l;
  a[ao + 1] = y / l;
  a[ao + 2] = z / l;
  a[ao + 3] = w / l;
}

function mulInto(a: Float32Array, ao: number, b: Float32Array) {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  a[ao] = ax * bw + aw * bx + ay * bz - az * by;
  a[ao + 1] = ay * bw + aw * by + az * bx - ax * bz;
  a[ao + 2] = az * bw + aw * bz + ax * by - ay * bx;
  a[ao + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

function preMulInto(a: Float32Array, ao: number, b: Float32Array) {
  const ax = b[0], ay = b[1], az = b[2], aw = b[3];
  const bx = a[ao], by = a[ao + 1], bz = a[ao + 2], bw = a[ao + 3];
  a[ao] = ax * bw + aw * bx + ay * bz - az * by;
  a[ao + 1] = ay * bw + aw * by + az * bx - ax * bz;
  a[ao + 2] = az * bw + aw * bz + ax * by - ay * bx;
  a[ao + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

// ---------------------------------------------------------------------------
// Keyframed clips
// ---------------------------------------------------------------------------

export type PoseSpec = Partial<Record<BoneName, [number, number, number]>> & { root?: [number, number, number] };

export interface ClipDef {
  name: string;
  duration: number;
  loop?: boolean;
  /** Which bones the clip controls. 'mentioned' = bones used in any key. */
  owns?: 'mentioned' | 'all' | 'upper' | 'lower';
  keys: { t: number; pose: PoseSpec }[];
  /** Mirror the whole clip left↔right. */
  mirror?: boolean;
}

export interface CompiledClip {
  name: string;
  duration: number;
  loop: boolean;
  times: Float32Array;
  /** per bone: Float32Array(keys*3) of radians, or null if not animated */
  tracks: (Float32Array | null)[];
  rootTrack: Float32Array | null;
  mask: Float32Array;
}

function mirrorSpec(p: PoseSpec): PoseSpec {
  const out: PoseSpec = {};
  for (const k of Object.keys(p) as (keyof PoseSpec)[]) {
    if (k === 'root') {
      const r = p.root!;
      out.root = [-r[0], r[1], r[2]];
      continue;
    }
    const e = p[k] as [number, number, number];
    const bi = BONE_INDEX[k as BoneName];
    out[mirrorName(k as BoneName)] = ARM_BONES.has(bi) ? [e[0], e[1], e[2]] : [e[0], -e[1], -e[2]];
  }
  return out;
}

export function compileClip(def: ClipDef): CompiledClip {
  const keys = def.keys.map((k) => ({ t: k.t, pose: def.mirror ? mirrorSpec(k.pose) : k.pose }));
  const n = keys.length;
  const times = new Float32Array(keys.map((k) => k.t));
  const tracks: (Float32Array | null)[] = [];
  const mentioned = new Set<BoneName>();
  for (const k of keys) for (const b of Object.keys(k.pose)) if (b !== 'root') mentioned.add(b as BoneName);
  const owns = def.owns ?? 'mentioned';
  const mask = new Float32Array(BONE_COUNT);
  for (const name of BONE_NAMES) {
    const i = BONE_INDEX[name];
    let own = false;
    if (owns === 'all') own = true;
    else if (owns === 'upper') own = UPPER_BODY.includes(name) || mentioned.has(name);
    else if (owns === 'lower') own = LOWER_BODY.includes(name) || mentioned.has(name);
    else own = mentioned.has(name);
    mask[i] = own ? 1 : 0;
    if (!own) {
      tracks.push(null);
      continue;
    }
    const arr = new Float32Array(n * 3);
    const unit = ARM_BONES.has(i) ? 1 : DEG;
    // Fill: carry nearest defined value forward/backward; default 0 (arms: relaxed at sides).
    let last: [number, number, number] | null = ARM_BONES.has(i) ? [6, 90, 0] : null;
    const defined: boolean[] = [];
    for (let j = 0; j < n; j++) {
      const e = keys[j].pose[name];
      defined.push(!!e);
      if (e) last = e;
      const v = e ?? last;
      if (v) {
        arr[j * 3] = v[0] * unit;
        arr[j * 3 + 1] = v[1] * unit;
        arr[j * 3 + 2] = v[2] * unit;
      }
    }
    // backward fill for leading undefined keys
    const firstDef = defined.indexOf(true);
    if (firstDef > 0) for (let j = 0; j < firstDef; j++) for (let c = 0; c < 3; c++) arr[j * 3 + c] = arr[firstDef * 3 + c];
    tracks.push(arr);
  }
  let rootTrack: Float32Array | null = null;
  if (keys.some((k) => k.pose.root)) {
    rootTrack = new Float32Array(n * 3);
    let last: [number, number, number] = [0, 0, 0];
    const firstIdx = keys.findIndex((k) => k.pose.root);
    if (firstIdx >= 0) last = keys[firstIdx].pose.root!;
    for (let j = 0; j < n; j++) {
      const r = keys[j].pose.root ?? last;
      last = r;
      rootTrack.set(r, j * 3);
    }
  }
  return { name: def.name, duration: def.duration, loop: !!def.loop, times, tracks, rootTrack, mask };
}

/** Cubic Hermite sample of a keyed track; tangents from neighbours (Catmull-Rom, non-uniform). */
/**
 * Looping clips must repeat their first key at t = duration; tangents then wrap
 * around so the cycle is C1-continuous. One-shot clips ease in/out at the ends.
 */
function sampleTrack(times: Float32Array, data: Float32Array, stride: number, t: number, loop: boolean, duration: number, out: number[]) {
  const n = times.length;
  if (n === 1 || t <= times[0]) {
    for (let c = 0; c < stride; c++) out[c] = data[c];
    return;
  }
  if (t >= times[n - 1]) {
    for (let c = 0; c < stride; c++) out[c] = data[(n - 1) * stride + c];
    return;
  }
  let i = 0;
  while (i < n - 2 && t > times[i + 1]) i++;
  const i1 = i + 1;
  const t0 = times[i], t1 = times[i1];
  const h = t1 - t0 || 1e-5;
  let ip = -1, tp = 0, inx = -1, tn = 0;
  if (i > 0) {
    ip = i - 1;
    tp = times[ip];
  } else if (loop && n > 2) {
    ip = n - 2;
    tp = times[n - 2] - duration;
  }
  if (i1 < n - 1) {
    inx = i1 + 1;
    tn = times[inx];
  } else if (loop && n > 2) {
    inx = 1;
    tn = times[1] + duration;
  }
  const u = Math.min(1, Math.max(0, (t - t0) / h));
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  for (let c = 0; c < stride; c++) {
    const p0 = data[i * stride + c];
    const p1 = data[i1 * stride + c];
    const m0 = ip < 0 ? 0 : ((p1 - data[ip * stride + c]) / Math.max(1e-4, t1 - tp)) * h;
    const m1 = inx < 0 ? 0 : ((data[inx * stride + c] - p0) / Math.max(1e-4, tn - t0)) * h;
    out[c] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  }
}

const tmp3 = [0, 0, 0];
export function sampleClip(clip: CompiledClip, t: number, out: Pose) {
  if (clip.loop) {
    t = t % clip.duration;
    if (t < 0) t += clip.duration;
  } else t = Math.max(0, Math.min(clip.duration, t));
  for (let b = 0; b < BONE_COUNT; b++) {
    const tr = clip.tracks[b];
    if (!tr) continue;
    sampleTrack(clip.times, tr, 3, t, clip.loop, clip.duration, tmp3);
    if (ARM_BONES.has(b)) armQuat(armSide(b), tmp3[0], tmp3[1], tmp3[2], out.q, b * 4);
    else eulerToQuat(tmp3[0], tmp3[1], tmp3[2], out.q, b * 4);
  }
  if (clip.rootTrack) {
    sampleTrack(clip.times, clip.rootTrack, 3, t, clip.loop, clip.duration, tmp3);
    out.root[0] = tmp3[0];
    out.root[1] = tmp3[1];
    out.root[2] = tmp3[2];
  } else out.root.fill(0);
}
