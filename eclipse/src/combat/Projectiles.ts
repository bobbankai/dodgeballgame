import { Color3, MeshBuilder, StandardMaterial, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import type { CombatWorld, HitEvent } from './CombatWorld';
import type { Combatant, DamageInfo, Team } from './Types';
import { segSegDist2 } from './Geometry';
import type { Physics } from '../physics/Physics';
import { Layer } from '../physics/Physics';
import type { Vfx, FxHandle } from '../vfx/Vfx';

export interface ProjectileDef {
  speed: number;
  radius: number;
  gravity: number;
  /** Turn rate toward the target (rad/s); 0 flies straight. */
  homing: number;
  /** Homing stops this close to the target, so a sidestep at the last moment works. */
  homingCutoff: number;
  life: number;
  core: [number, number, number];
  coreSize: number;
  trail: string;
  impact: string;
  /** Area damage radius on impact (0 = direct hits only). */
  splash: number;
  scorch?: boolean;
}

export const PROJECTILES: Record<string, ProjectileDef> = {
  firebolt: { speed: 15, radius: 0.22, gravity: 0, homing: 1.6, homingCutoff: 4, life: 3, core: [6, 2.6, 0.8], coreSize: 0.28, trail: 'fireTrail', impact: 'fireBurst', splash: 1.2, scorch: true },
  emberShard: { speed: 22, radius: 0.15, gravity: -4, homing: 0, homingCutoff: 0, life: 2.5, core: [5, 1.8, 0.4], coreSize: 0.18, trail: 'fireTrail', impact: 'fireBurst', splash: 0 },
  waterOrb: { speed: 11, radius: 0.28, gravity: 0, homing: 1.8, homingCutoff: 3.5, life: 3.5, core: [0.6, 2.4, 3.2], coreSize: 0.34, trail: 'waterTrail', impact: 'splash', splash: 1.4 },
  cinderArc: { speed: 24, radius: 0.9, gravity: 0, homing: 0.6, homingCutoff: 3, life: 1.1, core: [7, 3, 0.9], coreSize: 0.55, trail: 'fireTrail', impact: 'fireBurst', splash: 1.8, scorch: true },
  stormBolt: { speed: 30, radius: 0.2, gravity: 0, homing: 1.2, homingCutoff: 5, life: 1.6, core: [2.4, 2.2, 6.5], coreSize: 0.22, trail: 'stormTrail', impact: 'shockBurst', splash: 1.2 },
  featherBlade: { speed: 24, radius: 0.18, gravity: 0, homing: 0.5, homingCutoff: 6, life: 2.2, core: [3.0, 2.9, 4.2], coreSize: 0.18, trail: 'stormTrail', impact: 'shockBurst', splash: 0 },
  sporePod: { speed: 13, radius: 0.24, gravity: -5, homing: 0.8, homingCutoff: 4, life: 3, core: [1.4, 2.2, 0.5], coreSize: 0.26, trail: 'sporeTrail', impact: 'sporeBurst', splash: 1.8 },
  thornDart: { speed: 26, radius: 0.15, gravity: -2, homing: 0.4, homingCutoff: 5, life: 2, core: [1.6, 2.4, 0.6], coreSize: 0.14, trail: 'sporeTrail', impact: 'sporeBurst', splash: 0 },
  sunRay: { speed: 32, radius: 0.2, gravity: 0, homing: 1.4, homingCutoff: 4, life: 1.5, core: [7, 5, 2], coreSize: 0.22, trail: 'sunTrail', impact: 'sunBurst', splash: 1.2, scorch: true },
  voidOrb: { speed: 12, radius: 0.32, gravity: 0, homing: 2.2, homingCutoff: 3, life: 4, core: [0.6, 0.3, 1.4], coreSize: 0.42, trail: 'voidTrail', impact: 'voidBurst', splash: 1.8 },
  aetherBolt: { speed: 26, radius: 0.24, gravity: 0, homing: 3, homingCutoff: 1.5, life: 2, core: [1.6, 2.6, 6], coreSize: 0.26, trail: 'aether', impact: 'aether', splash: 1.6 },
};

class Projectile {
  readonly pos: Vector3;
  readonly vel: Vector3;
  age = 0;
  alive = true;
  mesh: Mesh;
  trail: FxHandle | null;
  constructor(readonly def: ProjectileDef, from: Vector3, dir: Vector3, readonly owner: Combatant | null, readonly team: Team,
    readonly make: (victim: Combatant, point: Vector3) => DamageInfo, readonly target: Combatant | null, mesh: Mesh, trail: FxHandle | null) {
    this.pos = from.clone();
    this.vel = dir.normalizeToNew().scale(def.speed);
    this.mesh = mesh;
    this.trail = trail;
  }
}

/**
 * Spells and thrown things: they fly (with gravity and limited homing), hit combatants of other teams
 * by a swept test (fast bolts cannot pass through a target between steps), stop on world geometry,
 * splash, and leave scorch marks. Ranged hits cannot be parried but can be blocked or dodged.
 */
export class Projectiles {
  private list: Projectile[] = [];
  private mats = new Map<string, StandardMaterial>();
  private spare: Mesh[] = [];
  onImpact: ((at: Vector3, def: ProjectileDef) => void) | null = null;

  constructor(private scene: Scene, private world: CombatWorld, private physics: Physics, private vfx: Vfx) {}

  fire(id: string, from: Vector3, dir: Vector3, owner: Combatant | null, team: Team,
    make: (victim: Combatant, point: Vector3) => DamageInfo, target: Combatant | null = null): void {
    const def = PROJECTILES[id];
    if (!def) return;
    let mat = this.mats.get(id);
    if (!mat) {
      mat = new StandardMaterial(`proj_${id}`, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = new Color3(...def.core);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      this.mats.set(id, mat);
    }
    const mesh = this.spare.pop() ?? MeshBuilder.CreateSphere('proj', { diameter: 1, segments: 8 }, this.scene);
    mesh.isPickable = false;
    mesh.material = mat;
    mesh.scaling.setAll(def.coreSize);
    mesh.position.copyFrom(from);
    mesh.setEnabled(true);
    const trail = this.vfx.attach(def.trail, from);
    this.list.push(new Projectile(def, from, dir, owner, team, make, target, mesh, trail));
  }

  update(dt: number): HitEvent[] {
    const hits: HitEvent[] = [];
    const prev = new Vector3();
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      prev.copyFrom(p.pos);
      const def = p.def;
      if (def.homing > 0 && p.target && p.target.alive) {
        const aim = p.target.aimPoint(new Vector3()).subtract(p.pos);
        const dist = aim.length();
        if (dist > def.homingCutoff) {
          const want = aim.scale(1 / dist);
          const cur = p.vel.normalizeToNew();
          const ang = Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(cur, want))));
          const k = ang > 1e-4 ? Math.min(1, (def.homing * dt) / ang) : 1;
          const nd = Vector3.Lerp(cur, want, k).normalize();
          p.vel.copyFrom(nd.scale(p.vel.length()));
        }
      }
      p.vel.y += def.gravity * dt;
      p.pos.addInPlace(p.vel.scale(dt));
      // combatants first: a bolt that reaches someone this step hits them
      let victim: Combatant | null = null;
      let best = Infinity;
      for (const c of this.world.list) {
        if (!c.alive || c.team === p.team || c === p.owner) continue;
        for (const h of c.hurtboxes()) {
          const r = segSegDist2(prev, p.pos, h.a, h.b);
          const rr = def.radius + h.radius;
          if (r.d2 <= rr * rr && r.s < best) {
            best = r.s;
            victim = c;
          }
        }
      }
      if (victim) {
        const at = Vector3.Lerp(prev, p.pos, best);
        hits.push(this.world.apply(p.owner, victim, p.make(victim, at), null));
        this.explode(p, at, victim, hits);
        continue;
      }
      const ray = this.physics.raycast(prev, p.pos, Layer.World);
      if (ray.hit) {
        this.explode(p, ray.point, null, hits);
        continue;
      }
      if (p.age > def.life) {
        this.explode(p, p.pos, null, hits);
        continue;
      }
      p.mesh.position.copyFrom(p.pos);
      p.trail?.move(p.pos);
    }
    this.list = this.list.filter((p) => p.alive);
    return hits;
  }

  private explode(p: Projectile, at: Vector3, direct: Combatant | null, hits: HitEvent[]): void {
    p.alive = false;
    p.trail?.stop();
    p.mesh.setEnabled(false);
    this.spare.push(p.mesh);
    const back = p.vel.normalizeToNew().scale(-1);
    this.vfx.burst(p.def.impact, at, back);
    if (p.def.splash > 0) {
      const done = new Set<number>();
      if (direct) done.add(direct.id);
      hits.push(...this.world.area(p.owner, p.team, at, p.def.splash, done, (v) => {
        const info = p.make(v, v.position);
        return { ...info, amount: info.amount * 0.5, poise: info.poise * 0.5 };
      }));
    }
    this.onImpact?.(at, p.def);
  }

  clear(): void {
    for (const p of this.list) {
      p.trail?.stop();
      p.mesh.dispose();
    }
    this.list = [];
  }
}
