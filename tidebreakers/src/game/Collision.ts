// Lightweight level collision: a ground height function, static wall shapes in the XZ plane (circles and
// oriented boxes with a height range), dynamic arena barriers, and circle-vs-circle separation between
// fighters. Enough for brawler arenas, docks, decks and cliff paths without a physics engine.
import { Vector3 } from '@babylonjs/core';

export interface CircleCol { kind: 'circle'; x: number; z: number; r: number; y0: number; y1: number; tag?: string }
export interface BoxCol { kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; y0: number; y1: number; tag?: string }
export type Collider = CircleCol | BoxCol;

export interface Platform { x: number; z: number; hx: number; hz: number; rot: number; top: number; tag?: string }

export class Collision {
  colliders: Collider[] = [];
  platforms: Platform[] = [];
  /** ground height from terrain (default flat at 0); platforms add walkable tops */
  terrain: (x: number, z: number) => number = () => 0;
  /** arena barrier: fighters stay inside this circle while active */
  arena: { x: number; z: number; r: number } | null = null;
  /** world bounds (kill / respawn plane) */
  minY = -20;
  water = -1e9;

  addCircle(x: number, z: number, r: number, y0 = -10, y1 = 10, tag?: string): void {
    this.colliders.push({ kind: 'circle', x, z, r, y0, y1, tag });
  }

  addBox(x: number, z: number, hx: number, hz: number, rot = 0, y0 = -10, y1 = 10, tag?: string): void {
    this.colliders.push({ kind: 'box', x, z, hx, hz, rot, y0, y1, tag });
  }

  addPlatform(x: number, z: number, hx: number, hz: number, top: number, rot = 0, tag?: string): void {
    this.platforms.push({ x, z, hx, hz, rot, top, tag });
  }

  /** Highest walkable surface at (x, z) not above `maxY` (step height tolerance). */
  groundAt(x: number, z: number, maxY = 1e9): number {
    let g = this.terrain(x, z);
    for (const p of this.platforms) {
      if (p.top > maxY) continue;
      const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
      const dx = x - p.x, dz = z - p.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= p.hx && Math.abs(lz) <= p.hz && p.top > g) g = p.top;
    }
    return g;
  }

  /** Pushes a circle (x, z, r) at height range [y, y+h] out of colliders. Mutates pos. */
  resolve(pos: Vector3, r: number, h: number, useArena = true): boolean {
    let hit = false;
    for (const c of this.colliders) {
      if (pos.y + h < c.y0 || pos.y > c.y1) continue;
      if (c.kind === 'circle') {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz);
        const m = c.r + r;
        if (d < m && d > 1e-6) {
          pos.x = c.x + (dx / d) * m;
          pos.z = c.z + (dz / d) * m;
          hit = true;
        }
      } else {
        const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
        const dx = pos.x - c.x, dz = pos.z - c.z;
        let lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const qx = Math.max(-c.hx, Math.min(c.hx, lx)), qz = Math.max(-c.hz, Math.min(c.hz, lz));
        let ox = lx - qx, oz = lz - qz;
        let d = Math.hypot(ox, oz);
        if (d < r) {
          if (d < 1e-6) {
            // inside: push out along the shallowest axis
            const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
            if (px < pz) { lx = Math.sign(lx || 1) * (c.hx + r); } else { lz = Math.sign(lz || 1) * (c.hz + r); }
          } else {
            lx = qx + (ox / d) * r;
            lz = qz + (oz / d) * r;
          }
          const c2 = Math.cos(c.rot), s2 = Math.sin(c.rot);
          pos.x = c.x + lx * c2 - lz * s2;
          pos.z = c.z + lx * s2 + lz * c2;
          hit = true;
          void ox; void oz; void d;
          ox = 0; oz = 0; d = 0;
        }
      }
    }
    if (this.arena && useArena) {
      const dx = pos.x - this.arena.x, dz = pos.z - this.arena.z;
      const d = Math.hypot(dx, dz);
      const m = this.arena.r - r;
      if (d > m) {
        pos.x = this.arena.x + (dx / d) * m;
        pos.z = this.arena.z + (dz / d) * m;
        hit = true;
      }
    }
    return hit;
  }

  /** Ray march for the camera: returns the free distance along dir from `from` up to maxD. */
  raycast(from: Vector3, dir: Vector3, maxD: number, radius = 0.25): number {
    const steps = 24;
    let free = maxD;
    const p = new Vector3();
    for (let i = 1; i <= steps; i++) {
      const t = (maxD * i) / steps;
      p.copyFrom(from).addInPlace(dir.scale(t));
      const g = this.groundAt(p.x, p.z, p.y + 0.5);
      if (p.y < g + radius) { free = Math.max(0.6, t - maxD / steps); break; }
      const q = p.clone();
      if (this.resolve(q, radius, 0.1, false) && Vector3.DistanceSquared(q, p) > 1e-6) {
        // only solid tall colliders block the camera
        free = Math.max(0.6, t - maxD / steps);
        break;
      }
    }
    return free;
  }
}
