import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return lerp(b0, b1, clamp01(invLerp(a0, a1, v)));
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. `sharpness` ~ 1/time-constant. */
export function damp(sharpness: number, dt: number): number {
  return 1 - Math.exp(-sharpness * dt);
}

export function dampTo(current: number, target: number, sharpness: number, dt: number): number {
  return current + (target - current) * damp(sharpness, dt);
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function dampAngle(current: number, target: number, sharpness: number, dt: number): number {
  return current + angleDiff(current, target) * damp(sharpness, dt);
}

/** Moves an angle toward a target with a maximum angular speed. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

export const Ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t: number) => t * t * t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t: number) => 1 - Math.pow(1 - t, 4),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t: number) => {
    const c4 = TAU / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};
export type EaseName = keyof typeof Ease;

/** Critically-damped spring for scalar values. */
export class Spring1 {
  value: number;
  velocity = 0;
  constructor(value = 0, public stiffness = 120, public damping = 2 * Math.sqrt(120)) {
    this.value = value;
  }
  update(target: number, dt: number): number {
    const f = -this.stiffness * (this.value - target) - this.damping * this.velocity;
    this.velocity += f * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
  impulse(v: number) {
    this.velocity += v;
  }
}

/** Critically damped vector spring (semi-implicit Euler, sub-stepped for stability). */
export class SpringVec3 {
  readonly value = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  constructor(public stiffness = 200, public damping = 2 * Math.sqrt(200)) {}
  update(target: THREE.Vector3, dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.tmp.copy(this.value).sub(target).multiplyScalar(-this.stiffness);
      this.tmp.addScaledVector(this.velocity, -this.damping);
      this.velocity.addScaledVector(this.tmp, h);
      this.value.addScaledVector(this.velocity, h);
    }
    return this.value;
  }
  snap(v: THREE.Vector3) {
    this.value.copy(v);
    this.velocity.set(0, 0, 0);
  }
}

/** Deterministic seeded PRNG (mulberry32). */
export class RNG {
  private s: number;
  constructor(seed = 1234567) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  /** Approximately normal distribution (Box–Muller). */
  gauss(mean = 0, sd = 1) {
    const u = Math.max(1e-9, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

export const rng = new RNG((Date.now() ^ 0x5eed) >>> 0);

export function randRange(a: number, b: number) {
  return a + (b - a) * Math.random();
}

/** Simple 1D value noise, smooth, for camera shake and idle motion. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin((n + seed * 157.31) * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}

/** Closest points between segments p1-q1 and p2-q2. Returns squared distance; writes s,t params. */
export function segmentSegmentClosest(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  out: { s: number; t: number; c1: THREE.Vector3; c2: THREE.Vector3 },
): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0, t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  out.s = s;
  out.t = t;
  out.c1.set(p1.x + d1x * s, p1.y + d1y * s, p1.z + d1z * s);
  out.c2.set(p2.x + d2x * t, p2.y + d2y * t, p2.z + d2z * t);
  return out.c1.distanceToSquared(out.c2);
}

/** Ray vs axis-aligned box. Returns distance or -1. */
export function rayBox(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  min: THREE.Vector3, max: THREE.Vector3,
): number {
  let tmin = -Infinity, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [min.x, min.y, min.z], mx = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  if (tmax < 0) return -1;
  return tmin >= 0 ? tmin : 0;
}

export function formatTime(sec: number): string {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const V3 = {
  up: new THREE.Vector3(0, 1, 0),
  zero: new THREE.Vector3(0, 0, 0),
};

/** Solve launch direction so a projectile at `speed` under gravity `g` reaches target. Returns false if unreachable. Prefers low arc. */
export function solveBallisticLow(
  from: THREE.Vector3,
  to: THREE.Vector3,
  speed: number,
  g: number,
  outDir: THREE.Vector3,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dy = to.y - from.y;
  const horiz = Math.hypot(dx, dz);
  if (horiz < 1e-4) {
    outDir.set(0, Math.sign(dy) || 1, 0);
    return true;
  }
  if (g <= 1e-4) {
    outDir.set(dx, dy, dz).normalize();
    return true;
  }
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * horiz * horiz + 2 * dy * v2);
  if (disc < 0) {
    // unreachable: throw at 45 degrees toward target
    const ang = Math.PI / 4;
    outDir.set((dx / horiz) * Math.cos(ang), Math.sin(ang), (dz / horiz) * Math.cos(ang));
    return false;
  }
  const ang = Math.atan2(v2 - Math.sqrt(disc), g * horiz);
  const c = Math.cos(ang);
  outDir.set((dx / horiz) * c, Math.sin(ang), (dz / horiz) * c);
  return true;
}
