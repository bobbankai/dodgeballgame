import type { Clip } from './Clip';

/**
 * A full skeleton pose in flat arrays: rotation quaternions and positions per bone. Bones a clip
 * does not animate keep the rest values. All blending happens in these buffers before anything is
 * written to the scene graph.
 */
export class Pose {
  readonly n: number;
  readonly rot: Float32Array;
  readonly pos: Float32Array;

  constructor(n: number) {
    this.n = n;
    this.rot = new Float32Array(n * 4);
    this.pos = new Float32Array(n * 3);
  }

  copyFrom(o: Pose): this {
    this.rot.set(o.rot);
    this.pos.set(o.pos);
    return this;
  }

  /** Samples a clip into this pose; untouched bones are copied from `rest`. */
  sample(clip: Clip, t: number, rest: Pose): this {
    const [i0, i1, f] = clip.frameAt(t);
    for (let b = 0; b < this.n; b++) {
      const r = clip.rot[b];
      const o4 = b * 4;
      if (r) {
        const a = i0 * 4;
        const c = i1 * 4;
        let x = r[c], y = r[c + 1], z = r[c + 2], w = r[c + 3];
        if (r[a] * x + r[a + 1] * y + r[a + 2] * z + r[a + 3] * w < 0) {
          x = -x; y = -y; z = -z; w = -w;
        }
        let qx = r[a] + (x - r[a]) * f;
        let qy = r[a + 1] + (y - r[a + 1]) * f;
        let qz = r[a + 2] + (z - r[a + 2]) * f;
        let qw = r[a + 3] + (w - r[a + 3]) * f;
        const l = 1 / Math.hypot(qx, qy, qz, qw);
        qx *= l; qy *= l; qz *= l; qw *= l;
        this.rot[o4] = qx; this.rot[o4 + 1] = qy; this.rot[o4 + 2] = qz; this.rot[o4 + 3] = qw;
      } else {
        this.rot[o4] = rest.rot[o4]; this.rot[o4 + 1] = rest.rot[o4 + 1]; this.rot[o4 + 2] = rest.rot[o4 + 2]; this.rot[o4 + 3] = rest.rot[o4 + 3];
      }
      const p = clip.pos[b];
      const o3 = b * 3;
      if (p) {
        const a = i0 * 3;
        const c = i1 * 3;
        this.pos[o3] = p[a] + (p[c] - p[a]) * f;
        this.pos[o3 + 1] = p[a + 1] + (p[c + 1] - p[a + 1]) * f;
        this.pos[o3 + 2] = p[a + 2] + (p[c + 2] - p[a + 2]) * f;
      } else {
        this.pos[o3] = rest.pos[o3]; this.pos[o3 + 1] = rest.pos[o3 + 1]; this.pos[o3 + 2] = rest.pos[o3 + 2];
      }
    }
    return this;
  }

  /**
   * this = lerp(this, other, w * mask[b]) per bone. Quaternions are normalised-lerped with the
   * shortest-path sign fix, which is exact enough for crossfades and blend spaces.
   */
  blend(other: Pose, w: number, mask?: Float32Array): this {
    if (w <= 0) return this;
    for (let b = 0; b < this.n; b++) {
      const k = mask ? w * mask[b] : w;
      if (k <= 0) continue;
      const o4 = b * 4;
      let x = other.rot[o4], y = other.rot[o4 + 1], z = other.rot[o4 + 2], ww = other.rot[o4 + 3];
      const ax = this.rot[o4], ay = this.rot[o4 + 1], az = this.rot[o4 + 2], aw = this.rot[o4 + 3];
      if (ax * x + ay * y + az * z + aw * ww < 0) {
        x = -x; y = -y; z = -z; ww = -ww;
      }
      let qx = ax + (x - ax) * k, qy = ay + (y - ay) * k, qz = az + (z - az) * k, qw = aw + (ww - aw) * k;
      const l = 1 / Math.hypot(qx, qy, qz, qw);
      qx *= l; qy *= l; qz *= l; qw *= l;
      this.rot[o4] = qx; this.rot[o4 + 1] = qy; this.rot[o4 + 2] = qz; this.rot[o4 + 3] = qw;
      const o3 = b * 3;
      this.pos[o3] += (other.pos[o3] - this.pos[o3]) * k;
      this.pos[o3 + 1] += (other.pos[o3 + 1] - this.pos[o3 + 1]) * k;
      this.pos[o3 + 2] += (other.pos[o3 + 2] - this.pos[o3 + 2]) * k;
    }
    return this;
  }

  /**
   * Additive layer: this = this * (add * inverse(ref))^w per bone (rotations only), for breathing,
   * flinches and leaning on top of any base motion.
   */
  additive(add: Pose, ref: Pose, w: number, mask?: Float32Array): this {
    if (w <= 0) return this;
    for (let b = 0; b < this.n; b++) {
      const k = mask ? w * mask[b] : w;
      if (k <= 0) continue;
      const o = b * 4;
      // delta = add * conj(ref)
      const rx = -ref.rot[o], ry = -ref.rot[o + 1], rz = -ref.rot[o + 2], rw = ref.rot[o + 3];
      const ax = add.rot[o], ay = add.rot[o + 1], az = add.rot[o + 2], aw = add.rot[o + 3];
      let dx = aw * rx + ax * rw + ay * rz - az * ry;
      let dy = aw * ry - ax * rz + ay * rw + az * rx;
      let dz = aw * rz + ax * ry - ay * rx + az * rw;
      let dw = aw * rw - ax * rx - ay * ry - az * rz;
      // scale the delta by k (nlerp from identity)
      if (dw < 0) { dx = -dx; dy = -dy; dz = -dz; dw = -dw; }
      dx *= k; dy *= k; dz *= k; dw = 1 + (dw - 1) * k;
      const l = 1 / Math.hypot(dx, dy, dz, dw);
      dx *= l; dy *= l; dz *= l; dw *= l;
      // this = delta * this
      const bx = this.rot[o], by = this.rot[o + 1], bz = this.rot[o + 2], bw = this.rot[o + 3];
      this.rot[o] = dw * bx + dx * bw + dy * bz - dz * by;
      this.rot[o + 1] = dw * by - dx * bz + dy * bw + dz * bx;
      this.rot[o + 2] = dw * bz + dx * by - dy * bx + dz * bw;
      this.rot[o + 3] = dw * bw - dx * bx - dy * by - dz * bz;
    }
    return this;
  }
}
