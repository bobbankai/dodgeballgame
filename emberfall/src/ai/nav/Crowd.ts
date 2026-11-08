// Local avoidance for groups of agents: a sampling velocity-obstacle solver. Each agent proposes the
// velocity it wants; candidate velocities around it (turned, slowed, stopped) are scored by how far they
// stray from the wish and how soon they would collide with any neighbour, assuming neighbours share the
// work of avoiding (the reciprocal assumption: each agent takes half the evasion). The best candidate wins.
// Cheap, stable for the handful of melee agents a fight has, and no oscillation when two agents meet head
// on, because both prefer the same side.
import * as THREE from 'three';

export interface CrowdAgent {
  pos: THREE.Vector3;
  /** current planar velocity */
  vel: THREE.Vector3;
  radius: number;
  /** agents with higher priority do less of the avoiding (a charging brute does not step aside) */
  priority?: number;
}

export interface AvoidOptions {
  /** how far ahead (s) collisions matter */
  horizon?: number;
  /** cost per m/s of deviation from the desired velocity */
  deviation?: number;
  /** cost scale of an imminent collision */
  collision?: number;
  /** neighbours further than this are ignored (m) */
  range?: number;
}

/** time until two discs moving with relative velocity v (from a towards b at offset p) touch; Infinity if never */
export function timeToCollision(px: number, pz: number, vx: number, vz: number, r: number): number {
  // |p - v t| = r  →  (v·v) t² - 2 (p·v) t + (p·p - r²) = 0
  const c = px * px + pz * pz - r * r;
  if (c < 0) return 0; // already overlapping
  const a = vx * vx + vz * vz;
  if (a < 1e-9) return Infinity;
  const b = px * vx + pz * vz;
  if (b <= 0) return Infinity; // moving apart
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  return (b - Math.sqrt(disc)) / a;
}

// candidate directions relative to the wish (radians) and speed factors
const ANGLES = [0, 0.26, -0.26, 0.55, -0.55, 0.9, -0.9, 1.35, -1.35, 2.0, -2.0];
const SPEEDS = [1, 0.6, 0.3];

/**
 * the velocity `self` should take (written to `out`) given the velocity it wants and its neighbours.
 * Velocities are planar (y is ignored).
 */
export function avoid(self: CrowdAgent, desired: THREE.Vector3, others: readonly CrowdAgent[], out: THREE.Vector3, o: AvoidOptions = {}): THREE.Vector3 {
  const horizon = o.horizon ?? 1.5;
  const wDev = o.deviation ?? 1.0;
  const wCol = o.collision ?? 2.2;
  const range = o.range ?? 6;
  const speed = Math.hypot(desired.x, desired.z);
  // neighbours that matter
  const near: CrowdAgent[] = [];
  for (const a of others) {
    if (a === self) continue;
    const dx = a.pos.x - self.pos.x, dz = a.pos.z - self.pos.z;
    if (dx * dx + dz * dz < range * range) near.push(a);
  }
  if (!near.length || speed < 1e-4) return out.set(desired.x, 0, desired.z);
  const base = Math.atan2(desired.x, desired.z);
  let best = Infinity, bx = desired.x, bz = desired.z;
  for (const s of SPEEDS) {
    for (const da of ANGLES) {
      const ang = base + da;
      const cvx = Math.sin(ang) * speed * s, cvz = Math.cos(ang) * speed * s;
      // deviation from the wish, plus a slight preference for passing on the right: when two agents meet
      // head on, both pick the same side instead of mirroring each other into a standoff
      let cost = wDev * Math.hypot(cvx - desired.x, cvz - desired.z) + (da > 0 ? 0.08 : 0) * speed;
      for (const a of near) {
        const px = a.pos.x - self.pos.x, pz = a.pos.z - self.pos.z;
        // reciprocal: we assume the other agent takes its share of the avoidance
        const share = THREE.MathUtils.clamp(0.5 + ((a.priority ?? 0) - (self.priority ?? 0)) * 0.25, 0.1, 0.9);
        const rvx = (cvx - self.vel.x) / share + self.vel.x - a.vel.x;
        const rvz = (cvz - self.vel.z) / share + self.vel.z - a.vel.z;
        const t = timeToCollision(px, pz, rvx, rvz, self.radius + a.radius + 0.05);
        if (t < horizon) cost += wCol * (horizon / Math.max(t, 0.05) - 1) * (speed > 0 ? 1 : 0);
        // overlapping right now: strongly prefer moving apart
        const d = Math.hypot(px, pz);
        const overlap = self.radius + a.radius - d;
        if (overlap > 0 && d > 1e-4) cost += overlap * 8 * Math.max(0, (cvx * px + cvz * pz) / d);
      }
      if (cost < best) { best = cost; bx = cvx; bz = cvz; }
    }
  }
  // stopping is always an option, but a last resort (it makes no progress at all)
  let stopCost = wDev * speed * 2.2;
  for (const a of near) {
    const px = a.pos.x - self.pos.x, pz = a.pos.z - self.pos.z;
    const t = timeToCollision(px, pz, -a.vel.x, -a.vel.z, self.radius + a.radius);
    if (t < horizon) stopCost += wCol * (horizon / Math.max(t, 0.05) - 1);
  }
  if (stopCost < best) { bx = 0; bz = 0; }
  return out.set(bx, 0, bz);
}
