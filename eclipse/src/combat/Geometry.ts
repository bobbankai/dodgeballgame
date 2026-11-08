/**
 * Small, allocation-light geometry helpers for hit detection (plain numbers so they are fast and
 * unit-testable without the engine).
 */
export type V3 = { x: number; y: number; z: number };

export function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function lerpV(a: V3, b: V3, t: number): V3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * Closest points between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9).
 * Returns squared distance and the parameters s (on segment 1) and t (on segment 2).
 */
export function segSegDist2(p1: V3, q1: V3, p2: V3, q2: V3): { d2: number; s: number; t: number } {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    return { d2: dot(r, r), s: 0, t: 0 };
  }
  if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = dot(d1, d2);
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
  const c1 = { x: p1.x + d1.x * s, y: p1.y + d1.y * s, z: p1.z + d1.z * s };
  const c2 = { x: p2.x + d2.x * t, y: p2.y + d2.y * t, z: p2.z + d2.z * t };
  const dd = sub(c1, c2);
  return { d2: dot(dd, dd), s, t };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Does a blade (segment base-tip with a thickness) moving from (b0,t0) to (b1,t1) touch a capsule?
 * The sweep is sub-sampled so fast swings cannot tunnel through thin targets. Returns the contact
 * point (on the capsule surface side) or null.
 */
export function sweptBladeHitsCapsule(b0: V3, t0: V3, b1: V3, t1: V3, bladeR: number, ca: V3, cb: V3, cr: number, steps = 6): V3 | null {
  const r = bladeR + cr;
  const r2 = r * r;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const b = lerpV(b0, b1, k);
    const t = lerpV(t0, t1, k);
    const res = segSegDist2(b, t, ca, cb);
    if (res.d2 <= r2) {
      return lerpV(b, t, res.s);
    }
  }
  return null;
}

/** Sphere (centre c, radius r) against a capsule. */
export function sphereHitsCapsule(c: V3, r: number, ca: V3, cb: V3, cr: number): boolean {
  const res = segSegDist2(c, c, ca, cb);
  const rr = r + cr;
  return res.d2 <= rr * rr;
}

/** Is point p inside a cone (apex, unit direction, half-angle cos, range)? */
export function inCone(p: V3, apex: V3, dir: V3, cosHalf: number, range: number): boolean {
  const d = sub(p, apex);
  const len = Math.sqrt(dot(d, d));
  if (len > range) return false;
  if (len < 1e-6) return true;
  return dot(d, dir) / len >= cosHalf;
}
