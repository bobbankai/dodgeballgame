// A reusable valley: a walkable route (polyline with ground heights and half-widths) through wooded hills,
// with far mountain ranges, optional streams/lakes cut into the ground, forests of real trees near the
// route and impostors beyond, rocks, grass and the playable bounds. Chapters 2 and 3 are built on it.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { buildTerrain, fbm, grass, impostors, rand, scatter, type Xform } from './common';
import type { TerrainLayer } from '../render/Terrain';
import type { FXOptions } from '../render/MaterialFX';

export const sstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return [Math.sqrt(x * x + z * z), t];
}

export interface ValleySpec {
  /** route points: x, z, ground height */
  path: [number, number, number][];
  /** walkable half-width at each route point */
  width: number[];
  /** hill height either side (m) */
  hills?: number;
  /** extra local shaping (plateaus, basins): returns the adjusted height */
  shape?: (x: number, z: number, y: number, near: { d: number; h: number; w: number }) => number;
  seed?: number;
}

export class Valley {
  constructor(readonly s: ValleySpec) {}

  near(x: number, z: number): { d: number; h: number; w: number } {
    const P = this.s.path, W = this.s.width;
    let best = { d: 1e9, h: 0, w: 10 };
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const [d, t] = segDist(x, z, a[0], a[1], b[0], b[1]);
      if (d < best.d) best = { d, h: a[2] + (b[2] - a[2]) * t, w: W[i] + (W[i + 1] - W[i]) * t };
    }
    return best;
  }

  height = (x: number, z: number): number => {
    const p = this.near(x, z);
    const out = Math.max(0, p.d - p.w);
    const seed = this.s.seed ?? 3;
    const hills = this.s.hills ?? 14;
    let y = p.h + hills * (1 - Math.exp(-out / 26)) + Math.max(0, out - 50) * 0.12;
    y += (fbm(x * 0.025, z * 0.025, 4, seed) - 0.5) * Math.min(9, 0.4 + out * 0.16);
    y += sstep(50, 160, out) * 22 * fbm(x * 0.012 + 3, z * 0.012, 3, seed + 8);
    const rn = 1 - Math.abs(fbm(x * 0.003 + 7, z * 0.003, 4, seed + 10) * 2 - 1);
    y += sstep(220, 560, out) * 190 * rn * rn;
    y += (fbm(x * 0.2, z * 0.2, 2, seed + 6) - 0.5) * 0.22;
    return this.s.shape ? this.s.shape(x, z, y, p) : y;
  };

  /** the playable terrain plus the far ring to the horizon */
  build(game: Game, layers: TerrainLayer[], farLayers: TerrainLayer[], splat: (x: number, z: number, h: number, slope: number) => [number, number, number, number], center = new THREE.Vector2(0, 0), fx: FXOptions = {}): void {
    buildTerrain(game, { size: 420, seg: 300, center, height: this.height, splat, layers, fx });
    buildTerrain(game, {
      size: 1600, seg: 160, center, collide: false, pom: 0, layers: farLayers, fx,
      height: (x, z) => this.height(x, z) - (Math.abs(x - center.x) < 205 && Math.abs(z - center.y) < 205 ? 2.0 : 0),
      splat: (x, z, h, slope) => { const w = splat(x, z, h, slope); return [w[0] * 0.3, w[1] + w[0] * 0.7, 0, w[3]]; },
    });
  }

  /** playable corridor around the route (extra polygon points for wider areas can be spliced in) */
  bounds(margin = 2): THREE.Vector2[] {
    const left: THREE.Vector2[] = [], right: THREE.Vector2[] = [];
    const P = this.s.path;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      // perpendicular to the local direction
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const w = this.s.width[i] + margin;
      left.push(new THREE.Vector2(x + nx * w, z + nz * w));
      right.push(new THREE.Vector2(x - nx * w, z - nz * w));
    }
    return [...left, ...right.reverse()];
  }

  /** trees near the route (real) and impostor forests on every hillside */
  async forest(game: Game, o: { kinds: [string, number][]; far: [string, number][]; count?: number; farCount?: number; blocked?: (x: number, z: number) => boolean; extent: [number, number, number, number]; scale?: number }): Promise<void> {
    const r = rand(this.s.seed ?? 3);
    const pick = (list: [string, number][]) => {
      let k = r();
      for (const [n, w] of list) { if (k < w) return n; k -= w; }
      return list[list.length - 1][0];
    };
    const lists: Record<string, Xform[]> = {};
    const [x0, x1, z0, z1] = o.extent;
    const want = o.count ?? 420;
    let n = 0;
    for (let i = 0; i < want * 6 && n < want; i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      const p = this.near(x, z);
      const far = p.d - p.w;
      if (far < 1.5 || far > 70) continue;
      if (o.blocked?.(x, z)) continue;
      const kind = pick(o.kinds);
      const v = Math.floor(r() * 3);
      (lists[`${kind}_${v}`] ??= []).push({ x, z, rot: r() * 6.28, scale: (o.scale ?? 1) * (0.85 + r() * 0.4), y: this.height(x, z) - 0.05 });
      n++;
    }
    await Promise.all(Object.entries(lists).map(([k, list]) => scatter(game, `assets/env/trees/${k}.glb`, list, { tree: true, trunk: k.startsWith('bamboo') ? 0.45 : 0.32 })));
    const farL: Record<string, Xform[]> = {};
    const fc = o.farCount ?? 14000;
    let m = 0;
    for (let i = 0; i < fc * 6 && m < fc; i++) {
      const x = (r() - 0.5) * 1000 + (x0 + x1) / 2, z = (r() - 0.5) * 1000 + (z0 + z1) / 2;
      const p = this.near(x, z);
      const off = p.d - p.w;
      if (off < 16 || off > 480) continue;
      if (o.blocked?.(x, z)) continue;
      if (fbm(x * 0.02, z * 0.02, 3, 41) < 0.33) continue;
      const kind = pick(o.far);
      (farL[kind] ??= []).push({ x, z, rot: 0, scale: 0.75 + r() * 0.5, y: this.height(x, z) });
      m++;
    }
    for (const [k, list] of Object.entries(farL)) impostors(game, k, list);
  }

  /** rocks among the trees and grass on the verges */
  async groundCover(game: Game, o: { extent: [number, number, number, number]; rocks?: number; tufts?: number; tint?: THREE.Color; blocked?: (x: number, z: number) => boolean; laneW?: (x: number, z: number, p: { d: number; w: number }) => boolean }): Promise<void> {
    const r = rand((this.s.seed ?? 3) + 50);
    const [x0, x1, z0, z1] = o.extent;
    const woods: Record<string, Xform[]> = { boulder_a: [], boulder_b: [], boulder_c: [] };
    let n = 0;
    for (let i = 0; i < (o.rocks ?? 140) * 20 && n < (o.rocks ?? 140); i++) {
      const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
      const p = this.near(x, z);
      const off = p.d - p.w;
      if (off < 1.5 || off > 45 || o.blocked?.(x, z)) continue;
      const k = r();
      woods[k < 0.45 ? 'boulder_b' : k < 0.8 ? 'boulder_a' : 'boulder_c'].push({ x, z, rot: r() * 6.28, scale: 0.6 + r() * 0.9, y: this.height(x, z) - 0.25 });
      n++;
    }
    await Promise.all(Object.entries(woods).map(([k, list]) => scatter(game, `assets/env/rocks/${k}.glb`, list, { collide: true })));
    if ((o.tufts ?? 0) > 0) {
      const tufts: Xform[] = [];
      for (let i = 0; i < (o.tufts ?? 0) * 3 && tufts.length < (o.tufts ?? 0); i++) {
        const x = x0 + r() * (x1 - x0), z = z0 + r() * (z1 - z0);
        const p = this.near(x, z);
        if (p.d > p.w + 24) continue;
        if (o.laneW?.(x, z, p) && r() > 0.06) continue;
        if (o.blocked?.(x, z)) continue;
        if (fbm(x * 0.12, z * 0.12, 2, 31) < 0.42 && r() > 0.25) continue;
        tufts.push({ x, z, rot: r() * 6.28, scale: 0.7 + r() * 0.7, y: this.height(x, z) - 0.03 });
      }
      grass(game, tufts, { tint: o.tint });
    }
  }
}
