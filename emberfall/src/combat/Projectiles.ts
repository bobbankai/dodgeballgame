// Projectiles: thrown fire pots, arrows and bolts of black flame.
//   - aimed with a ballistic solver that leads a moving target (iterating the flight time),
//   - integrated with gravity and drag, swept against the world (a ray along each frame's motion) and
//     against fighters' capsules (segment-to-segment distance), so nothing tunnels through at speed,
//   - a parry sends a projectile back at whoever threw it, faster; a dodge lets it fly past,
//   - fire pots shatter where they land and leave a pool of burning oil behind (see Hazards).
// The system knows nothing about rendering or the game: a host supplies the world, the fighters and the
// effects, so the flight model is tested on its own.
import * as THREE from 'three';
import { segSegDist, type Combatant, type Hit, type HitResult, type Team } from '../game/Combat';
import type { DamageType } from './DamageModel';

export type ProjectileKind = 'firepot' | 'arrow' | 'blackfire';

export interface ProjectileSpec {
  speed: number;
  gravity: number;
  /** linear drag per second */
  drag: number;
  radius: number;
  damage: number;
  poise: number;
  type: DamageType;
  heavy?: boolean;
  unblockable?: boolean;
  /** splash radius on impact (0 = none) */
  aoe?: number;
  /** leaves a burning pool */
  pool?: { radius: number; time: number };
  /** seconds before it falls apart */
  life: number;
  /** prefers a lobbed arc (fire pots over cover) */
  lob?: boolean;
}

export const PROJECTILES: Record<ProjectileKind, ProjectileSpec> = {
  firepot: { speed: 16, gravity: 14, drag: 0.02, radius: 0.13, damage: 14, poise: 18, type: 'fire', aoe: 2.2, pool: { radius: 2.0, time: 6 }, life: 5, lob: true },
  arrow: { speed: 34, gravity: 9.8, drag: 0.01, radius: 0.05, damage: 11, poise: 10, type: 'pierce', life: 4 },
  blackfire: { speed: 16, gravity: 0, drag: 0, radius: 0.28, damage: 22, poise: 30, type: 'shadow', heavy: true, aoe: 1.6, life: 4 },
};

export interface Projectile {
  kind: ProjectileKind;
  spec: ProjectileSpec;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  team: Team;
  owner: Combatant | null;
  age: number;
  dead: boolean;
  reflected: boolean;
  /** fighters it has already passed through (a dodge): not tested again */
  passed: Set<Combatant>;
  /** render handle owned by the host */
  view?: unknown;
}

export interface ProjectileHost {
  /** distance to the first world obstacle along a ray (`far` if none) */
  raycast(o: THREE.Vector3, d: THREE.Vector3, far: number): number;
  /** fighters a projectile from `team` may hit */
  targets(team: Team): Combatant[];
  /** something was struck: effects, sound, the fire pool */
  impact?(p: Projectile, at: THREE.Vector3, target: Combatant | null, result: HitResult | null): void;
  spawned?(p: Projectile): void;
  removed?(p: Projectile): void;
  /** the projectile was reflected by a parry */
  reflected?(p: Projectile, by: Combatant): void;
}

/**
 * the launch velocity that carries a projectile from `from` to a target moving with `targetVel`, at muzzle
 * speed `speed` under `gravity`; null when out of range. `high` picks the lobbed solution.
 */
export function solveBallistic(from: THREE.Vector3, to: THREE.Vector3, targetVel: THREE.Vector3 | null, speed: number, gravity: number, high = false, out = new THREE.Vector3()): { vel: THREE.Vector3; time: number } | null {
  const aim = new THREE.Vector3().copy(to);
  let t = from.distanceTo(to) / speed;
  for (let iter = 0; iter < 6; iter++) {
    if (targetVel) aim.copy(to).addScaledVector(targetVel, t);
    const dx = aim.x - from.x, dz = aim.z - from.z, dy = aim.y - from.y;
    const d = Math.hypot(dx, dz);
    if (gravity <= 1e-6) {
      const L = Math.hypot(d, dy);
      if (L < 1e-6) return null;
      t = L / speed;
      out.set(dx, dy, dz).multiplyScalar(speed / L);
      continue;
    }
    if (d < 1e-4) {
      // straight up or down
      out.set(0, Math.sign(dy) * speed, 0);
      t = Math.abs(dy) / speed;
      continue;
    }
    const v2 = speed * speed;
    const disc = v2 * v2 - gravity * (gravity * d * d + 2 * dy * v2);
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const tan = (v2 + (high ? root : -root)) / (gravity * d);
    const ang = Math.atan(tan);
    const vh = speed * Math.cos(ang), vy = speed * Math.sin(ang);
    t = d / vh;
    out.set((dx / d) * vh, vy, (dz / d) * vh);
  }
  return { vel: out, time: t };
}

/** where a projectile with this velocity would be after t seconds (no drag) */
export function ballisticAt(from: THREE.Vector3, vel: THREE.Vector3, gravity: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(from.x + vel.x * t, from.y + vel.y * t - 0.5 * gravity * t * t, from.z + vel.z * t);
}

const segA = new THREE.Vector3();
const capA = new THREE.Vector3();
const capB = new THREE.Vector3();
const dir = new THREE.Vector3();
const hitPt = new THREE.Vector3();

export class ProjectileSystem {
  readonly list: Projectile[] = [];
  /** totals (tests, tuning) */
  stats = { spawned: 0, hits: 0, reflected: 0, expired: 0 };

  constructor(public host: ProjectileHost) {}

  spawn(kind: ProjectileKind, from: THREE.Vector3, vel: THREE.Vector3, team: Team, owner: Combatant | null): Projectile {
    const p: Projectile = { kind, spec: PROJECTILES[kind], pos: from.clone(), vel: vel.clone(), team, owner, age: 0, dead: false, reflected: false, passed: new Set() };
    this.list.push(p);
    this.stats.spawned++;
    this.host.spawned?.(p);
    return p;
  }

  /** throw at a fighter, leading its motion; null when out of reach */
  throwAt(kind: ProjectileKind, from: THREE.Vector3, target: Combatant, targetVel: THREE.Vector3 | null, team: Team, owner: Combatant | null): Projectile | null {
    const spec = PROJECTILES[kind];
    const aim = target.center(new THREE.Vector3());
    if (spec.lob) aim.y = target.body.pos.y + 0.3; // pots are thrown at the feet
    const sol = solveBallistic(from, aim, targetVel, spec.speed, spec.gravity, !!spec.lob) ?? solveBallistic(from, aim, targetVel, spec.speed, spec.gravity, !spec.lob);
    if (sol) return this.spawn(kind, from, sol.vel, team, owner);
    // just out of reach: throw as far as possible towards it (45 degrees), it lands short
    if (spec.gravity <= 0) return null;
    const dx = aim.x - from.x, dz = aim.z - from.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return null;
    const h = spec.speed * Math.SQRT1_2;
    return this.spawn(kind, from, new THREE.Vector3((dx / d) * h, h, (dz / d) * h), team, owner);
  }

  update(dt: number): void {
    for (const p of this.list) {
      if (p.dead) continue;
      p.age += dt;
      if (p.age > p.spec.life) { this.kill(p); this.stats.expired++; continue; }
      const prev = segA.copy(p.pos);
      p.vel.y -= p.spec.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.spec.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const step = p.pos.distanceTo(prev);
      if (step < 1e-6) continue;
      // fighters first (a body in front of a wall is hit before the wall)
      let hitT = Infinity;
      let victim: Combatant | null = null;
      for (const c of this.host.targets(p.team)) {
        if (c.dead || !c.targetable() || (c === p.owner && !p.reflected) || p.passed.has(c)) continue;
        const b = c.body;
        capA.set(b.pos.x, b.pos.y + b.radius, b.pos.z);
        capB.set(b.pos.x, b.pos.y + b.height - b.radius * 0.5, b.pos.z);
        const d = segSegDist(prev, p.pos, capA, capB, hitPt);
        if (d < b.radius + p.spec.radius) {
          const t = prev.distanceTo(hitPt) / step;
          if (t < hitT) { hitT = t; victim = c; }
        }
      }
      dir.copy(p.pos).sub(prev).divideScalar(step);
      const wall = this.host.raycast(prev, dir, step + p.spec.radius);
      const wallT = wall < step + p.spec.radius ? wall / step : Infinity;
      if (victim && hitT <= wallT) {
        const at = prev.clone().addScaledVector(dir, Math.min(step, hitT * step));
        this.strike(p, victim, at);
      } else if (wallT <= 1) {
        const at = prev.clone().addScaledVector(dir, Math.max(0, wall - p.spec.radius));
        this.land(p, at);
      }
    }
    // compact
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].dead) this.list.splice(i, 1);
  }

  private hitOf(p: Projectile, to: Combatant, at: THREE.Vector3, scale = 1): Hit {
    const d = new THREE.Vector3(p.vel.x, 0, p.vel.z);
    if (d.lengthSq() < 1e-6) d.set(to.body.pos.x - at.x, 0, to.body.pos.z - at.z);
    d.normalize();
    return {
      from: p.owner ?? to, damage: p.spec.damage * scale * (p.reflected ? 1.5 : 1), poise: p.spec.poise * scale, heavy: !!p.spec.heavy,
      unblockable: p.spec.unblockable, point: at.clone(), dir: d, kind: p.spec.type === 'shadow' ? 'shadow' : p.spec.type === 'fire' ? 'fire' : 'slash',
    };
  }

  private strike(p: Projectile, victim: Combatant, at: THREE.Vector3): void {
    const res = victim.receive(this.hitOf(p, victim, at));
    if (res === 'parried' && p.owner && !p.owner.dead) {
      // sent back to the thrower, straight and faster
      p.reflected = true;
      p.team = victim.team;
      const target = p.owner.center(new THREE.Vector3());
      p.vel.copy(target.sub(at)).normalize().multiplyScalar(p.spec.speed * 1.6 + 6);
      p.pos.copy(at).addScaledVector(p.vel, 0.02);
      p.age = 0;
      p.owner = victim;
      this.stats.reflected++;
      this.host.reflected?.(p, victim);
      return;
    }
    if (res === 'dodged') { p.passed.add(victim); return; } // it flies on past
    this.stats.hits++;
    this.host.impact?.(p, at, victim, res);
    if (p.spec.aoe) this.splash(p, at, victim);
    this.kill(p);
  }

  private land(p: Projectile, at: THREE.Vector3): void {
    this.host.impact?.(p, at, null, null);
    if (p.spec.aoe) this.splash(p, at, null);
    this.kill(p);
  }

  /** splash damage to everyone else in the radius (half damage, falling off with distance) */
  private splash(p: Projectile, at: THREE.Vector3, already: Combatant | null): void {
    const r = p.spec.aoe ?? 0;
    for (const c of this.host.targets(p.team)) {
      if (c === already || c.dead || !c.targetable()) continue;
      const d = c.center(new THREE.Vector3()).distanceTo(at);
      if (d > r) continue;
      const res = c.receive(this.hitOf(p, c, at, 0.5 * (1 - (d / r) * 0.5)));
      this.host.impact?.(p, at, c, res);
    }
  }

  private kill(p: Projectile): void {
    if (p.dead) return;
    p.dead = true;
    this.host.removed?.(p);
  }

  clear(): void {
    for (const p of this.list) this.kill(p);
    this.list.length = 0;
  }
}
