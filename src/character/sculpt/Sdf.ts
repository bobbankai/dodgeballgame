/**
 * Signed-distance "clay" for sculpting characters procedurally.
 *
 * Shapes are primitives (spheres, ellipsoids, tapered capsules, rounded boxes, tori, planes)
 * combined with smooth unions / subtractions / intersections, so forms flow into each other
 * the way a sculpted model does (shoulder into arm, nose into face, finger into palm).
 * Every primitive carries a palette slot and bone influences used later for skinning.
 */

export const PK = { Sphere: 0, Ellipsoid: 1, RoundCone: 2, RoundBox: 3, Torus: 4, Plane: 5, Group: 6 } as const;
export type PK = (typeof PK)[keyof typeof PK];

export const Op = { Union: 0, Subtract: 1, Intersect: 2 } as const;
export type Op = (typeof Op)[keyof typeof Op];

/** [boneIndex, weight] pairs. */
export type BoneMix = [number, number][];

export interface Mat3 {
  // row-major world->local rotation
  e: number[];
}

let nextId = 0;

export class Prim {
  readonly id = nextId++;
  kind: PK;
  op: Op = Op.Union as Op;
  /** smooth blend radius against what came before (0 = hard) */
  k = 0;
  slot = -1;
  /** bone influences; bonesB (optional) is blended in along a round cone's axis between t0..t1 */
  bonesA: BoneMix = [];
  bonesB: BoneMix | null = null;
  t0 = 0.75;
  t1 = 1;
  /** free tag (crowd limb parts, paint rules) */
  tag = 0;
  // geometry (world / modelling space)
  ax = 0;
  ay = 0;
  az = 0;
  bx = 0;
  by = 0;
  bz = 0;
  r1 = 0;
  r2 = 0;
  sx = 1;
  sy = 1;
  sz = 1;
  rot: number[] | null = null;
  noiseAmp = 0;
  noiseFreq = 0;
  children: Prim[] = [];
  // bounding sphere for culling
  bcx = 0;
  bcy = 0;
  bcz = 0;
  br = 1e9;
  // cached round-cone terms
  private baL2 = 0;

  constructor(kind: PK) {
    this.kind = kind;
  }

  /** world-space bounding sphere (call after geometry is final) */
  finalize(): this {
    switch (this.kind) {
      case PK.Sphere:
        this.bcx = this.ax;
        this.bcy = this.ay;
        this.bcz = this.az;
        this.br = this.r1;
        break;
      case PK.Ellipsoid:
        this.bcx = this.ax;
        this.bcy = this.ay;
        this.bcz = this.az;
        this.br = Math.max(this.sx, this.sy, this.sz);
        break;
      case PK.RoundCone: {
        this.bcx = (this.ax + this.bx) / 2;
        this.bcy = (this.ay + this.by) / 2;
        this.bcz = (this.az + this.bz) / 2;
        const l = len3(this.bx - this.ax, this.by - this.ay, this.bz - this.az);
        this.br = l / 2 + Math.max(this.r1, this.r2);
        this.baL2 = l * l;
        break;
      }
      case PK.RoundBox:
        this.bcx = this.ax;
        this.bcy = this.ay;
        this.bcz = this.az;
        this.br = len3(this.sx, this.sy, this.sz) + this.r1;
        break;
      case PK.Torus:
        this.bcx = this.ax;
        this.bcy = this.ay;
        this.bcz = this.az;
        this.br = Math.max(this.sx, this.sz) + this.r2;
        break;
      case PK.Plane:
        this.br = 1e9;
        break;
      case PK.Group: {
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        let unbounded = false;
        for (const c of this.children) {
          c.finalize();
          if (c.op !== Op.Union) continue;
          if (c.br > 1e8) {
            unbounded = true;
            continue;
          }
          minX = Math.min(minX, c.bcx - c.br);
          minY = Math.min(minY, c.bcy - c.br);
          minZ = Math.min(minZ, c.bcz - c.br);
          maxX = Math.max(maxX, c.bcx + c.br);
          maxY = Math.max(maxY, c.bcy + c.br);
          maxZ = Math.max(maxZ, c.bcz + c.br);
        }
        if (unbounded && minX === Infinity) this.br = 1e9;
        else {
          this.bcx = (minX + maxX) / 2;
          this.bcy = (minY + maxY) / 2;
          this.bcz = (minZ + maxZ) / 2;
          this.br = len3(maxX - minX, maxY - minY, maxZ - minZ) / 2;
        }
        break;
      }
    }
    this.br += this.noiseAmp;
    return this;
  }

  /** Raw distance of this primitive (no combination). */
  dist(x: number, y: number, z: number): number {
    let d: number;
    switch (this.kind) {
      case PK.Sphere:
        d = len3(x - this.ax, y - this.ay, z - this.az) - this.r1;
        break;
      case PK.Ellipsoid: {
        let px = x - this.ax, py = y - this.ay, pz = z - this.az;
        if (this.rot) {
          const m = this.rot;
          const qx = m[0] * px + m[1] * py + m[2] * pz;
          const qy = m[3] * px + m[4] * py + m[5] * pz;
          const qz = m[6] * px + m[7] * py + m[8] * pz;
          px = qx;
          py = qy;
          pz = qz;
        }
        const k0 = len3(px / this.sx, py / this.sy, pz / this.sz);
        const k1 = len3(px / (this.sx * this.sx), py / (this.sy * this.sy), pz / (this.sz * this.sz));
        d = k1 < 1e-9 ? -Math.min(this.sx, this.sy, this.sz) : (k0 * (k0 - 1)) / k1;
        break;
      }
      case PK.RoundCone:
        d = this.roundCone(x, y, z);
        break;
      case PK.RoundBox: {
        let px = x - this.ax, py = y - this.ay, pz = z - this.az;
        if (this.rot) {
          const m = this.rot;
          const qx = m[0] * px + m[1] * py + m[2] * pz;
          const qy = m[3] * px + m[4] * py + m[5] * pz;
          const qz = m[6] * px + m[7] * py + m[8] * pz;
          px = qx;
          py = qy;
          pz = qz;
        }
        const qx = Math.abs(px) - this.sx;
        const qy = Math.abs(py) - this.sy;
        const qz = Math.abs(pz) - this.sz;
        d = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - this.r1;
        break;
      }
      case PK.Torus: {
        let px = x - this.ax, py = y - this.ay, pz = z - this.az;
        if (this.rot) {
          const m = this.rot;
          const qx = m[0] * px + m[1] * py + m[2] * pz;
          const qy = m[3] * px + m[4] * py + m[5] * pz;
          const qz = m[6] * px + m[7] * py + m[8] * pz;
          px = qx;
          py = qy;
          pz = qz;
        }
        // major radius follows an ellipse (sx, sz) in the ring plane
        const rho = len2(px, pz);
        let q: number;
        if (rho < 1e-9) q = -Math.min(this.sx, this.sz);
        else {
          const c = px / rho, s = pz / rho;
          q = rho - (this.sx * this.sz) / len2(this.sz * c, this.sx * s);
        }
        d = len2(q, py) - this.r2;
        break;
      }
      case PK.Plane:
        // (ax,ay,az) point, (bx,by,bz) unit normal; negative = inside (behind the normal)
        d = (x - this.ax) * this.bx + (y - this.ay) * this.by + (z - this.az) * this.bz;
        break;
      case PK.Group:
        d = evalList(this.children, x, y, z);
        break;
    }
    if (this.noiseAmp > 0) d -= this.noiseAmp * (noise3(x * this.noiseFreq, y * this.noiseFreq, z * this.noiseFreq) * 2 - 1);
    return d;
  }

  /** Parameter along a round cone's axis (0 at a, 1 at b); 0 for other shapes. */
  axisT(x: number, y: number, z: number): number {
    if (this.kind !== PK.RoundCone || this.baL2 <= 0) return 0;
    const t = ((x - this.ax) * (this.bx - this.ax) + (y - this.ay) * (this.by - this.ay) + (z - this.az) * (this.bz - this.az)) / this.baL2;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  }

  // iq's round cone (tapered capsule)
  private roundCone(x: number, y: number, z: number): number {
    const bax = this.bx - this.ax, bay = this.by - this.ay, baz = this.bz - this.az;
    const l2 = this.baL2 || bax * bax + bay * bay + baz * baz;
    const rr = this.r1 - this.r2;
    const a2 = l2 - rr * rr;
    const il2 = 1 / l2;
    const pax = x - this.ax, pay = y - this.ay, paz = z - this.az;
    const yy = pax * bax + pay * bay + paz * baz;
    const zz = yy - l2;
    const wx = pax * l2 - bax * yy, wy = pay * l2 - bay * yy, wz = paz * l2 - baz * yy;
    const x2 = wx * wx + wy * wy + wz * wz;
    const y2 = yy * yy * l2;
    const z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - this.r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - this.r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - this.r1;
  }
}

/** Fold a list of primitives in order with their ops and blend radii. */
export function evalList(list: Prim[], x: number, y: number, z: number): number {
  let d = 1e9;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const k = p.k;
    // conservative culling: a far-away primitive cannot change the result
    if (p.br < 1e8) {
      const lb = len3(x - p.bcx, y - p.bcy, z - p.bcz) - p.br;
      if (p.op === Op.Union) {
        if (lb >= d + k) continue;
      } else if (p.op === Op.Subtract) {
        if (lb > k) continue;
      }
    }
    const e = p.dist(x, y, z);
    if (p.op === Op.Union) d = k > 0 ? smin(d, e, k) : Math.min(d, e);
    else if (p.op === Op.Subtract) d = k > 0 ? smax(d, -e, k) : Math.max(d, -e);
    else d = k > 0 ? smax(d, e, k) : Math.max(d, e);
  }
  return d;
}

/**
 * Same fold, also returning which top-level primitive "owns" the point (dominant in the blend)
 * — used for palette slots.
 */
export function evalOwner(list: Prim[], x: number, y: number, z: number): Prim | null {
  let d = 1e9;
  let owner: Prim | null = null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const k = p.k;
    if (p.br < 1e8) {
      const lb = len3(x - p.bcx, y - p.bcy, z - p.bcz) - p.br;
      if (p.op === Op.Union && lb >= d + k) continue;
      if (p.op === Op.Subtract && lb > k) continue;
    }
    const e = p.dist(x, y, z);
    if (p.op === Op.Union) {
      const h = k > 0 ? clamp01(0.5 + (0.5 * (d - e)) / k) : e < d ? 1 : 0;
      if (h > 0.5 && p.slot >= 0) owner = p;
      d = k > 0 ? smin(d, e, k) : Math.min(d, e);
    } else if (p.op === Op.Subtract) {
      // the carved surface takes the cutter's slot (ear bowls, mouth)
      if (-e > d && p.slot >= 0) owner = p;
      d = k > 0 ? smax(d, -e, k) : Math.max(d, -e);
    } else {
      d = k > 0 ? smax(d, e, k) : Math.max(d, e);
    }
  }
  return owner;
}

/** Fast vector lengths (Math.hypot is several times slower in hot loops). */
export function len3(x: number, y: number, z: number) {
  return Math.sqrt(x * x + y * y + z * z);
}
export function len2(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ------------------------------------------------------------------ value noise
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;
}
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx), fy),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx), fy),
    fz,
  );
}

// ------------------------------------------------------------------ builders
type V3 = [number, number, number];

export interface PrimOpts {
  k?: number;
  slot?: number;
  bones?: BoneMix;
  bonesB?: BoneMix;
  t0?: number;
  t1?: number;
  op?: Op;
  tag?: number;
  noise?: [number, number];
}

function apply(p: Prim, o: PrimOpts): Prim {
  if (o.k !== undefined) p.k = o.k;
  if (o.slot !== undefined) p.slot = o.slot;
  if (o.bones) p.bonesA = o.bones;
  if (o.bonesB) p.bonesB = o.bonesB;
  if (o.t0 !== undefined) p.t0 = o.t0;
  if (o.t1 !== undefined) p.t1 = o.t1;
  if (o.op !== undefined) p.op = o.op;
  if (o.tag !== undefined) p.tag = o.tag;
  if (o.noise) {
    p.noiseAmp = o.noise[0];
    p.noiseFreq = o.noise[1];
  }
  return p;
}

export function sphere(c: V3, r: number, o: PrimOpts = {}) {
  const p = new Prim(PK.Sphere);
  [p.ax, p.ay, p.az] = c;
  p.r1 = r;
  return apply(p, o);
}

/** rot: world->local rotation matrix (row-major 3x3), e.g. from rotInv(). */
export function ellipsoid(c: V3, radii: V3, o: PrimOpts & { rot?: number[] } = {}) {
  const p = new Prim(PK.Ellipsoid);
  [p.ax, p.ay, p.az] = c;
  [p.sx, p.sy, p.sz] = radii;
  p.rot = o.rot ?? null;
  return apply(p, o);
}

export function roundCone(a: V3, b: V3, ra: number, rb: number, o: PrimOpts = {}) {
  const p = new Prim(PK.RoundCone);
  [p.ax, p.ay, p.az] = a;
  [p.bx, p.by, p.bz] = b;
  p.r1 = ra;
  p.r2 = rb;
  return apply(p, o);
}

export function roundBox(c: V3, half: V3, r: number, o: PrimOpts & { rot?: number[] } = {}) {
  const p = new Prim(PK.RoundBox);
  [p.ax, p.ay, p.az] = c;
  [p.sx, p.sy, p.sz] = half;
  p.r1 = r;
  p.rot = o.rot ?? null;
  return apply(p, o);
}

/** Ring in the local XZ plane (axis = local Y); `ellipse` gives absolute major radii (x, z). */
export function torus(c: V3, major: number, minor: number, o: PrimOpts & { rot?: number[]; ellipse?: [number, number] } = {}) {
  const p = new Prim(PK.Torus);
  [p.ax, p.ay, p.az] = c;
  p.sx = p.sz = major;
  p.r2 = minor;
  p.rot = o.rot ?? null;
  if (o.ellipse) {
    p.sx = o.ellipse[0];
    p.sz = o.ellipse[1];
  }
  return apply(p, o);
}

/** Half-space: negative behind the (unit) normal. */
export function plane(point: V3, normal: V3, o: PrimOpts = {}) {
  const p = new Prim(PK.Plane);
  [p.ax, p.ay, p.az] = point;
  const l = Math.hypot(...normal) || 1;
  p.bx = normal[0] / l;
  p.by = normal[1] / l;
  p.bz = normal[2] / l;
  return apply(p, o);
}

export function group(children: Prim[], o: PrimOpts = {}) {
  const p = new Prim(PK.Group);
  p.children = children;
  return apply(p, o);
}

/** Row-major world->local rotation for a local frame whose Y axis points along `dir`. */
export function frameY(dir: V3): number[] {
  const l = Math.hypot(...dir) || 1;
  const y = [dir[0] / l, dir[1] / l, dir[2] / l];
  const ref = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  // x = ref × y, z = x × y  (right-handed-ish frame; only needs to be orthonormal)
  let x = [ref[1] * y[2] - ref[2] * y[1], ref[2] * y[0] - ref[0] * y[2], ref[0] * y[1] - ref[1] * y[0]];
  const lx = len3(x[0], x[1], x[2]);
  x = [x[0] / lx, x[1] / lx, x[2] / lx];
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

/** World->local rotation from Euler angles (radians, XYZ) of the local frame. */
export function rotInv(rx: number, ry: number, rz: number): number[] {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Rx * Ry * Rz (three.js 'XYZ'); inverse = transpose
  const r00 = cy * cz, r01 = -cy * sz, r02 = sy;
  const r10 = cx * sz + sx * sy * cz, r11 = cx * cz - sx * sy * sz, r12 = -sx * cy;
  const r20 = sx * sz - cx * sy * cz, r21 = sx * cz + cx * sy * sz, r22 = cx * cy;
  return [r00, r10, r20, r01, r11, r21, r02, r12, r22];
}
