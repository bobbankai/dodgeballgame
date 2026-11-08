// The navigation service a level owns: the grid, the search, a per-frame budget for planning, and the
// queries agents use: "can I walk straight there?", "plan me a path", "the nearest walkable point".
import * as THREE from 'three';
import { AStar, pathLength, pullString, type SearchOptions } from './AStar';
import { DIRS, NavGrid, pointInPolygon, type NavSource } from './NavGrid';

export interface PlanResult {
  /** world-space waypoints, the agent's own position first */
  points: THREE.Vector3[];
  /** the path reaches the goal (otherwise it stops where the search got closest) */
  complete: boolean;
  length: number;
}

export interface NavigationOptions {
  cell?: number;
  margin?: number;
  /** settled-node budget for all searches in one frame */
  frameBudget?: number;
  step?: number;
  clearance?: number;
}

export class Navigation {
  readonly grid: NavGrid;
  private astar: AStar;
  private frameLeft: number;
  private readonly frameBudget: number;
  /** plans refused this frame (callers try again next frame) */
  deferred = 0;
  planned = 0;

  constructor(src: NavSource, area: { minX: number; minZ: number; maxX: number; maxZ: number }, inside: ((x: number, z: number) => boolean) | null, o: NavigationOptions = {}) {
    const m = o.margin ?? 2;
    this.grid = new NavGrid(src, {
      minX: area.minX - m, minZ: area.minZ - m, maxX: area.maxX + m, maxZ: area.maxZ + m,
      cell: o.cell ?? 0.5, step: o.step ?? 0.5, clearance: o.clearance ?? 1.7,
      inside: inside ?? undefined,
    });
    this.astar = new AStar(this.grid);
    this.frameBudget = o.frameBudget ?? 9000;
    this.frameLeft = this.frameBudget;
  }

  /** a navigation service fitted to the level: the bounds polygon's extent, or the collision mesh's */
  static forWorld(src: NavSource & { bounds: THREE.Vector2[] | null; mesh: THREE.Mesh | null }, o: NavigationOptions = {}): Navigation | null {
    let area: { minX: number; minZ: number; maxX: number; maxZ: number } | null = null;
    if (src.bounds && src.bounds.length > 2) {
      area = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (const p of src.bounds) {
        area.minX = Math.min(area.minX, p.x); area.maxX = Math.max(area.maxX, p.x);
        area.minZ = Math.min(area.minZ, p.y); area.maxZ = Math.max(area.maxZ, p.y);
      }
    } else if (src.mesh) {
      src.mesh.geometry.computeBoundingBox();
      const b = src.mesh.geometry.boundingBox!;
      // the collision mesh includes the far terrain: keep to a sensible play area round its centre
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
      const hx = Math.min(120, (b.max.x - b.min.x) / 2), hz = Math.min(120, (b.max.z - b.min.z) / 2);
      area = { minX: cx - hx, minZ: cz - hz, maxX: cx + hx, maxZ: cz + hz };
    }
    if (!area) return null;
    // the bounds are read live: a level may change them (a bridge falls), see invalidateAll()
    const inside = (x: number, z: number) => (src.bounds && src.bounds.length > 2 ? pointInPolygon(x, z, src.bounds) : true);
    return new Navigation(src, area, inside, o);
  }

  /** call once per frame: refills the planning budget and samples queued tiles */
  update(warmMs = 1.5): void {
    this.frameLeft = this.frameBudget;
    this.grid.warm(warmMs);
  }

  /** forget everything sampled (the level's shape or bounds changed) */
  invalidateAll(): void {
    const G = this.grid;
    G.invalidate(G.minX, G.minZ, G.minX + G.W * G.cell, G.minZ + G.H * G.cell);
  }

  /** prepare the ground around a point (an agent, a spawn) in the background */
  prepare(p: THREE.Vector3, radius = 14): void { this.grid.want(p, radius); }

  nodeAt(p: THREE.Vector3): number { return this.grid.nodeAt(p); }

  /** the nearest walkable point to p (p itself when nothing is walkable nearby) */
  snap(p: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    const n = this.grid.nodeAt(p, 6);
    if (n < 0) return out.copy(p);
    return this.grid.pos(n, out);
  }

  /**
   * can an agent at `from` walk in a straight line to `to`? The line starts at the agent's real position;
   * with a radius the two edges of the swept body are tested too, so corners are not clipped.
   */
  canWalk(from: THREE.Vector3, to: THREE.Vector3, radius = 0): boolean {
    if (!this.line(from.x, from.y, from.z, to)) return false;
    if (radius > 0) {
      const dx = to.x - from.x, dz = to.z - from.z;
      const L = Math.hypot(dx, dz);
      if (L > 1e-4) {
        const nx = (-dz / L) * radius, nz = (dx / L) * radius;
        for (const s of [1, -1]) {
          tmpTo.set(to.x + nx * s, to.y, to.z + nz * s);
          if (!this.line(from.x + nx * s, from.y, from.z + nz * s, tmpTo)) return false;
        }
      }
    }
    return true;
  }

  private line(x: number, y: number, z: number, to: THREE.Vector3): boolean {
    tmpFrom.set(x, y, z);
    const a = this.grid.nodeAt(tmpFrom, 0);
    if (a < 0) return false;
    const end = this.grid.walkLine(a, to.x, to.z, 512, x, z);
    if (end < 0) return false;
    return Math.abs(this.grid.pos(end, tmp).y - to.y) < 1.8;
  }

  /**
   * plan a path. Returns null when this frame's planning budget is spent (try again next frame) or when the
   * start is not on the grid at all.
   */
  plan(from: THREE.Vector3, to: THREE.Vector3, o: SearchOptions = {}): PlanResult | null {
    if (this.frameLeft <= 0) { this.deferred++; return null; }
    const a = this.grid.nodeAt(from);
    if (a < 0) return null;
    const b = this.grid.nodeAt(to, 8);
    if (b < 0) return { points: [from.clone(), to.clone()], complete: false, length: from.distanceTo(to) };
    const budget = Math.min(o.maxExpand ?? 6000, this.frameLeft);
    const r = this.astar.search(a, b, { ...o, maxExpand: budget });
    this.frameLeft -= Math.max(1, r.expanded);
    this.planned++;
    const nodes = pullString(this.grid, r.nodes);
    const points = [from.clone()];
    for (let i = 1; i < nodes.length; i++) points.push(this.grid.pos(nodes[i]));
    // corners: push each turning point away from the walls that make it a corner, by the agent's radius,
    // so a body following the path does not scrape the obstacle's edge
    for (let i = 1; i < points.length - 1; i++) this.clearCorner(nodes[i], points[i], points[i - 1], points[i + 1]);
    // end on the goal itself when it was reached (the last node is only its cell's centre)
    if (r.complete && points.length > 1) points[points.length - 1].set(to.x, points[points.length - 1].y, to.z);
    return { points, complete: r.complete, length: pathLength(this.grid, r.nodes) };
  }

  /** move a waypoint away from the blocked links around its node (keeping both legs walkable) */
  private clearCorner(node: number, p: THREE.Vector3, prev: THREE.Vector3, next: THREE.Vector3, radius = this.agentRadius): void {
    const G = this.grid;
    let ax = 0, az = 0;
    for (let d = 0; d < 8; d++) {
      if (G.neighbor(node, d) >= 0) continue;
      const [dx, dz] = DIRS[d];
      const L = Math.hypot(dx, dz);
      ax -= dx / L;
      az -= dz / L;
    }
    const L = Math.hypot(ax, az);
    if (L < 1e-3) return;
    for (const f of [1, 0.6, 0.3]) {
      tmpTo.set(p.x + (ax / L) * radius * f, p.y, p.z + (az / L) * radius * f);
      const n = G.nodeAt(tmpTo, 0);
      if (n < 0 || Math.abs(G.pos(n, tmp).y - p.y) > G.step) continue;
      const q = tmpTo.clone();
      q.y = tmp.y;
      if (this.canWalk(prev, q) && this.canWalk(q, next)) { p.copy(q); return; }
    }
  }

  /** the body radius corners are cleared by */
  agentRadius = 0.35;

  get stats(): { tiles: number; tilesTotal: number; rays: number; linkTests: number; buildMs: number; searches: number; expanded: number; deferred: number } {
    return { ...this.grid.stats, searches: this.astar.searches, expanded: this.astar.totalExpanded, deferred: this.deferred };
  }
}

const tmp = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
