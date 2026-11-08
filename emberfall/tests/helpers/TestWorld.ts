// A small analytic world for navigation tests: a heightfield plus solid axis-aligned boxes. It answers the
// same two questions the game's collision world does (ground below a point, distance along a ray), exactly,
// so tests can build walls, bridges, gates and stairs without loading any assets.
import * as THREE from 'three';
import type { NavSource } from '../../src/ai/nav/NavGrid';

export interface Box { min: THREE.Vector3; max: THREE.Vector3 }

export class TestWorld implements NavSource {
  boxes: Box[] = [];
  bounds: THREE.Vector2[] | null = null;
  mesh: THREE.Mesh | null = null;
  rays = 0;

  constructor(public height: (x: number, z: number) => number = () => 0) {}

  /** a solid box from (x0, y0, z0) to (x1, y1, z1) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    this.boxes.push({ min: new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), max: new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)) });
    return this;
  }

  /** a wall along x (thickness t) */
  wallX(x0: number, x1: number, z: number, h = 3, t = 0.3): this { return this.box(x0, -1, z - t / 2, x1, h, z + t / 2); }
  /** a wall along z */
  wallZ(z0: number, z1: number, x: number, h = 3, t = 0.3): this { return this.box(x - t / 2, -1, z0, x + t / 2, h, z1); }

  ground(x: number, y: number, z: number, maxDrop = 50, normal?: THREE.Vector3): number | null {
    this.rays++;
    // candidates: the terrain and every box face crossed by the vertical line below y
    let best = -Infinity;
    let up = true;
    const th = this.height(x, z);
    if (th <= y) best = th;
    for (const b of this.boxes) {
      if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
      // the top face, seen from above
      if (b.max.y <= y && b.max.y > best) { best = b.max.y; up = true; }
      // the bottom face, seen from inside the box (a ray started inside hits it)
      if (b.min.y <= y && y < b.max.y && b.min.y > best) { best = b.min.y; up = false; }
    }
    if (best === -Infinity || y - best > maxDrop) return null;
    if (normal) {
      if (!up) normal.set(0, -1, 0);
      else if (best === th) {
        const e = 0.05;
        const dx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
        const dz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
        normal.set(-dx, 1, -dz).normalize();
      } else normal.set(0, 1, 0);
    }
    return best;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, far: number): number {
    this.rays++;
    let best = far;
    for (const b of this.boxes) {
      const t = rayBox(o, d, b);
      if (t >= 0 && t < best) best = t;
    }
    // terrain: march the ray against the heightfield
    const step = 0.1;
    for (let t = 0; t < best; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.height(x, z)) { best = Math.max(0, t - step / 2); break; }
    }
    return best;
  }
}

/** distance along a ray to a box (slab method), -1 if missed; 0 when starting inside */
export function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: Box): number {
  let t0 = 0, t1 = Infinity;
  for (const k of ['x', 'y', 'z'] as const) {
    const inv = 1 / d[k];
    let ta = (b.min[k] - o[k]) * inv, tb = (b.max[k] - o[k]) * inv;
    if (Number.isNaN(ta) || Number.isNaN(tb)) {
      if (o[k] < b.min[k] || o[k] > b.max[k]) return -1;
      continue;
    }
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
