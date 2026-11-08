// Hazards: areas on the ground that hurt whoever stands in them. A shattered fire pot leaves a pool of
// burning oil that sets fighters alight; lava banks scorch; the King's black flame leaves blighted ground.
// Each zone has a lifetime (fading out at the end) and applies its status effect to anyone inside at a
// fixed rate, so standing in it is punished but running through it is survivable.
import * as THREE from 'three';
import type { StatusKind } from './Status';

export interface HazardTarget {
  body: { pos: THREE.Vector3; radius: number };
  dead: boolean;
  /** apply an effect (the fighter's StatusEffects.apply) */
  afflict(kind: StatusKind, amount: number, level?: number): void;
}

export interface HazardSpec {
  kind: StatusKind;
  /** applied each tick: seconds for timed effects, points for meters */
  amount: number;
  level?: number;
  /** seconds between applications */
  every: number;
  /** vertical reach above / below the zone's centre */
  height: number;
}

export const HAZARDS = {
  oil: { kind: 'burn', amount: 2.5, level: 0, every: 0.5, height: 1.2 },
  lava: { kind: 'burn', amount: 5, level: 1, every: 0.5, height: 1.5 },
  blight: { kind: 'blight', amount: 4, every: 0.5, height: 1.2 },
  frost: { kind: 'frost', amount: 18, every: 0.5, height: 1.2 },
} as const satisfies Record<string, HazardSpec>;

export interface Zone {
  spec: HazardSpec;
  pos: THREE.Vector3;
  radius: number;
  life: number;
  age: number;
  /** next application time per target */
  next: Map<HazardTarget, number>;
  /** render handle owned by the host */
  view?: unknown;
  dead: boolean;
}

export class Hazards {
  readonly zones: Zone[] = [];
  onAdd: ((z: Zone) => void) | null = null;
  onRemove: ((z: Zone) => void) | null = null;

  add(spec: HazardSpec, pos: THREE.Vector3, radius: number, life: number): Zone {
    // a new pool on top of an old one renews it rather than stacking
    for (const z of this.zones) {
      if (!z.dead && z.spec === spec && z.pos.distanceTo(pos) < Math.min(z.radius, radius) * 0.6) {
        z.age = 0;
        z.life = Math.max(z.life - z.age, life);
        z.radius = Math.max(z.radius, radius);
        return z;
      }
    }
    const z: Zone = { spec, pos: pos.clone(), radius, life, age: 0, next: new Map(), dead: false };
    this.zones.push(z);
    this.onAdd?.(z);
    return z;
  }

  /** 0..1 strength of a zone (it shrinks over its last second) */
  strength(z: Zone): number {
    const left = z.life - z.age;
    return THREE.MathUtils.clamp(left, 0, 1) * THREE.MathUtils.clamp(z.age / 0.25, 0, 1);
  }

  /** is a point inside any live zone of this kind? */
  inside(p: THREE.Vector3, kind?: StatusKind): boolean {
    for (const z of this.zones) {
      if (z.dead || (kind && z.spec.kind !== kind)) continue;
      const r = z.radius * Math.max(0.3, this.strength(z));
      if (Math.hypot(p.x - z.pos.x, p.z - z.pos.z) < r && Math.abs(p.y - z.pos.y) < z.spec.height) return true;
    }
    return false;
  }

  update(dt: number, targets: readonly HazardTarget[]): void {
    for (const z of this.zones) {
      if (z.dead) continue;
      z.age += dt;
      if (z.age >= z.life) { z.dead = true; this.onRemove?.(z); continue; }
      const r = z.radius * Math.max(0.3, this.strength(z));
      for (const t of targets) {
        if (t.dead) continue;
        const p = t.body.pos;
        if (Math.hypot(p.x - z.pos.x, p.z - z.pos.z) > r + t.body.radius * 0.5 || Math.abs(p.y - z.pos.y) > z.spec.height) continue;
        const due = z.next.get(t) ?? 0;
        if (z.age < due) continue;
        z.next.set(t, z.age + z.spec.every);
        t.afflict(z.spec.kind, z.spec.amount, z.spec.level);
      }
    }
    for (let i = this.zones.length - 1; i >= 0; i--) if (this.zones[i].dead) this.zones.splice(i, 1);
  }

  clear(): void {
    for (const z of this.zones) if (!z.dead) { z.dead = true; this.onRemove?.(z); }
    this.zones.length = 0;
  }
}
