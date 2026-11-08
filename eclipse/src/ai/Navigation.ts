import { Vector3, VertexBuffer, type AbstractMesh } from '@babylonjs/core';
import { init as recastInit, Crowd, NavMeshQuery, type CrowdAgent, type NavMesh } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';
import { log } from '../core/Log';

let ready: Promise<void> | null = null;

/** Loads the Recast/Detour WebAssembly module once. */
export function initNavigation(): Promise<void> {
  ready ??= recastInit();
  return ready;
}

export interface NavAgentParams {
  radius: number;
  height: number;
  maxSpeed: number;
  maxAcceleration?: number;
  separation?: number;
}

type V3 = { x: number; y: number; z: number };

/**
 * A level's navigation: a Recast navmesh baked from its walkable geometry when it loads, a Detour
 * query for path and surface questions, and a crowd that steers every enemy around each other
 * (local avoidance and separation, so groups spread out instead of stacking).
 *
 * Enemies are moved by the crowd while they walk; during authored actions (lunges, knockbacks) the
 * animation's root motion moves them and `slide` keeps that motion on the navmesh.
 */
export class Navigation {
  readonly mesh: NavMesh;
  readonly query: NavMeshQuery;
  readonly crowd: Crowd;
  private readonly ext = { x: 2, y: 4, z: 2 };

  private constructor(mesh: NavMesh) {
    this.mesh = mesh;
    this.query = new NavMeshQuery(mesh);
    this.crowd = new Crowd(mesh, { maxAgents: 64, maxAgentRadius: 2.5 });
  }

  /**
   * Bakes a navmesh from meshes. `agent` is the smallest walker the mesh must fit; large bosses walk
   * on the same mesh with a bigger radius in the crowd (arenas are open).
   */
  static async build(meshes: AbstractMesh[], agent = { radius: 0.4, height: 1.9, climb: 0.45, slope: 42 }): Promise<Navigation | null> {
    await initNavigation();
    const pos: number[] = [];
    const idx: number[] = [];
    for (const m of meshes) {
      const p = m.getVerticesData(VertexBuffer.PositionKind);
      const ind = m.getIndices();
      if (!p || !ind) continue;
      m.computeWorldMatrix(true);
      const wm = m.getWorldMatrix();
      const base = pos.length / 3;
      const v = new Vector3();
      for (let i = 0; i < p.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], wm, v);
        pos.push(v.x, v.y, v.z);
      }
      // Babylon's mesh builders and glTF import keep Babylon's clockwise front-face convention in the
      // index buffer (right-handed scenes flip culling at draw time, not the data); Recast computes a
      // triangle's normal from counter-clockwise winding, so floors would read as ceilings. Flip,
      // unless the world matrix mirrors the mesh (which flips it already).
      const flip = wm.determinant() > 0;
      for (let i = 0; i < ind.length; i += 3) {
        if (flip) idx.push(base + ind[i], base + ind[i + 2], base + ind[i + 1]);
        else idx.push(base + ind[i], base + ind[i + 1], base + ind[i + 2]);
      }
    }
    if (!idx.length) return null;
    const cs = 0.2;
    const ch = 0.1;
    const res = generateSoloNavMesh(pos, idx, {
      cs,
      ch,
      walkableSlopeAngle: agent.slope,
      walkableHeight: Math.ceil(agent.height / ch),
      walkableClimb: Math.floor(agent.climb / ch),
      walkableRadius: Math.ceil(agent.radius / cs),
      maxEdgeLen: 12 / cs,
      maxSimplificationError: 1.3,
      minRegionArea: 8,
      mergeRegionArea: 20,
      maxVertsPerPoly: 6,
      detailSampleDist: 6 * cs,
      detailSampleMaxError: ch,
    });
    if (!res.success) {
      log.warn('navmesh failed', res.error);
      return null;
    }
    log.info(`navmesh: ${idx.length / 3} tris in`);
    return new Navigation(res.navMesh);
  }

  addAgent(at: Vector3, p: NavAgentParams): CrowdAgent {
    const s = this.closest(at) ?? at;
    return this.crowd.addAgent(s, {
      radius: p.radius,
      height: p.height,
      maxSpeed: p.maxSpeed,
      maxAcceleration: p.maxAcceleration ?? 14,
      collisionQueryRange: p.radius * 8,
      pathOptimizationRange: p.radius * 30,
      separationWeight: p.separation ?? 2,
      // anticipate turns | obstacle avoidance | separation | optimise visibility | optimise topology
      updateFlags: 1 | 2 | 4 | 8 | 16,
      obstacleAvoidanceType: 3,
    });
  }

  removeAgent(a: CrowdAgent): void {
    this.crowd.removeAgent(a);
  }

  update(dt: number): void {
    this.crowd.update(dt);
  }

  /** Nearest point on the navmesh, or null when there is none within reach. */
  closest(p: V3, out = new Vector3()): Vector3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents: this.ext });
    if (!r.success || !r.polyRef) return null;
    return out.set(r.point.x, r.point.y, r.point.z);
  }

  /** Moves from `from` toward `to` along the navmesh surface (stops at walls and ledges). */
  slide(from: V3, to: V3, out = new Vector3()): Vector3 {
    const start = this.query.findClosestPoint(from, { halfExtents: this.ext });
    if (!start.success || !start.polyRef) return out.set(to.x, to.y, to.z);
    const r = this.query.moveAlongSurface(start.polyRef, start.point, to);
    if (!r.success) return out.set(from.x, from.y, from.z);
    const h = this.query.getPolyHeight(r.visited[r.visited.length - 1] ?? start.polyRef, r.resultPosition);
    return out.set(r.resultPosition.x, h.success ? h.height : r.resultPosition.y, r.resultPosition.z);
  }

  /** Is there an unobstructed straight walk between two points (no wall or ledge in between)? */
  walkable(from: V3, to: V3): boolean {
    const start = this.query.findClosestPoint(from, { halfExtents: this.ext });
    if (!start.success || !start.polyRef) return false;
    const r = this.query.raycast(start.polyRef, start.point, to);
    return r.success && r.t >= 0.999;
  }

  /** A path as corner points (for patrols, scripted walks and debug drawing). */
  path(from: V3, to: V3): Vector3[] {
    const r = this.query.computePath(from, to, { halfExtents: this.ext });
    if (!r.success) return [];
    return r.path.map((p) => new Vector3(p.x, p.y, p.z));
  }

  randomPointAround(c: V3, radius: number): Vector3 | null {
    const r = this.query.findRandomPointAroundCircle(c, radius, { halfExtents: this.ext });
    if (!r.success) return null;
    return new Vector3(r.randomPoint.x, r.randomPoint.y, r.randomPoint.z);
  }

  dispose(): void {
    this.crowd.destroy();
    this.query.destroy();
    this.mesh.destroy();
  }
}
