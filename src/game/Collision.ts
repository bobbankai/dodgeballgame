import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';

export interface CapsuleHit {
  grounded: boolean;
  groundNormal: THREE.Vector3;
}

/** A group of static triangles that can be switched on and off (e.g. a bridge once it's drawn). */
export interface Body {
  bvh: MeshBVH;
  enabled: boolean;
  name: string;
  /** What each vertex is made of (for footsteps): see Surface. */
  surface: Uint8Array;
}

/** What the ground is made of, read from its painted colour. */
export const SURFACES = ['grass', 'wood', 'stone', 'sand', 'paper', 'water'] as const;
export type Surface = (typeof SURFACES)[number];

function classify(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
  if (mx > 0.82 && sat < 0.16) return 4; // paper
  if (sat < 0.16) return 2; // grey: stone
  if (g >= r && g > b) return 0; // green: grass
  if (b > r && b > g) return 5; // blue: water
  // warm: bright and pale is sand or a dirt path, darker and richer is wood
  return mx > 0.55 && sat < 0.5 ? 3 : 1;
}

const _box = new THREE.Box3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();
const _down = new THREE.Vector3(0, -1, 0);
const _o = new THREE.Vector3();

/** Bake every mesh under `roots` into one world-space triangle soup. */
function bake(roots: THREE.Object3D[]) {
  const parts: Float32Array[] = [];
  const kinds: Uint8Array[] = [];
  let total = 0;
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = g.attributes.position;
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        arr[i * 3] = v.x;
        arr[i * 3 + 1] = v.y;
        arr[i * 3 + 2] = v.z;
      }
      parts.push(arr);
      total += arr.length;
      // the surface of each vertex: its painted colour, or the material's
      const kind = new Uint8Array(pos.count);
      const col = g.attributes.color;
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.ShaderMaterial;
      const base = (mat?.uniforms?.uColor?.value as THREE.Color | undefined) ?? c.set(1, 1, 1);
      const k0 = classify(base.r, base.g, base.b);
      for (let i = 0; i < pos.count; i++) {
        kind[i] = col ? classify(col.getX(i) * base.r, col.getY(i) * base.g, col.getZ(i) * base.b) : k0;
      }
      kinds.push(kind);
    });
  }
  const all = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
  const surface = new Uint8Array(total / 3);
  let s = 0;
  for (const k of kinds) {
    surface.set(k, s);
    s += k.length;
  }
  return { geo, surface };
}

/** Level collision: bodies of static triangles, each with its own BVH. */
export class Collision {
  readonly bodies: Body[] = [];
  private pending: THREE.Object3D[] = [];
  /** Walkable if the surface normal's Y is at least this (about 55 degrees). */
  walkable = 0.57;

  /** Queue scenery for the main static body (built by build()). */
  add(root: THREE.Object3D) {
    this.pending.push(root);
  }

  build() {
    if (!this.pending.length) return;
    this.addBody('static', this.pending);
    this.pending = [];
  }

  addBody(name: string, roots: THREE.Object3D[], enabled = true): Body {
    const { geo, surface } = bake(roots);
    const body = { bvh: new MeshBVH(geo), enabled, name, surface };
    this.bodies.push(body);
    return body;
  }

  clear() {
    this.bodies.length = 0;
    this.pending = [];
  }

  /**
   * Push a capsule (segment start = bottom sphere centre, end = top sphere centre) out of the level.
   * Walkable surfaces push straight up so standing on a slope doesn't slide; walls push sideways.
   */
  capsule(seg: THREE.Line3, radius: number, out: CapsuleHit): CapsuleHit {
    out.grounded = false;
    out.groundNormal.set(0, 1, 0);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      _box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end);
      _box.min.addScalar(-radius);
      _box.max.addScalar(radius);
      for (const body of this.bodies) {
        if (!body.enabled) continue;
        body.bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(_box),
          intersectsTriangle: (tri: ExtendedTriangle) => {
            const d = tri.closestPointToSegment(seg, _tri, _cap);
            if (d >= radius) return false;
            const depth = radius - d;
            _dir.subVectors(_cap, _tri);
            if (_dir.lengthSq() < 1e-12) tri.getNormal(_dir);
            _dir.normalize();
            if (_dir.y >= this.walkable) {
              const up = Math.min(depth / _dir.y, radius);
              seg.start.y += up;
              seg.end.y += up;
              out.grounded = true;
              out.groundNormal.copy(_dir);
            } else {
              // walls and steep slopes push out sideways (ceilings push down)
              if (_dir.y > 0) {
                _dir.y = 0;
                _dir.normalize();
              }
              seg.start.addScaledVector(_dir, depth);
              seg.end.addScaledVector(_dir, depth);
            }
            moved = true;
            return false;
          },
        });
      }
      if (!moved) break;
    }
    return out;
  }

  /** Distance to the first hit along a ray (or null); fills `hit` and optionally `normal`. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, hit = new THREE.Vector3(), normal?: THREE.Vector3) {
    _ray.set(origin, dir);
    let best: number | null = null;
    for (const body of this.bodies) {
      if (!body.enabled) continue;
      const h = body.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
      if (h && (best === null || h.distance < best)) {
        best = h.distance;
        hit.copy(h.point);
        if (normal && h.face) normal.copy(h.face.normal);
      }
    }
    return best;
  }

  /** What the ground under a point is made of (for footsteps), or null if there is none close by. */
  surfaceBelow(p: THREE.Vector3): Surface | null {
    _ray.set(_o.set(p.x, p.y + 0.4, p.z), _down);
    let best: { d: number; s: number } | null = null;
    for (const body of this.bodies) {
      if (!body.enabled) continue;
      const h = body.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 1.2);
      if (h && h.faceIndex != null && (!best || h.distance < best.d)) {
        const idx = body.bvh.geometry.index;
        const vtx = idx ? idx.getX(h.faceIndex * 3) : h.faceIndex * 3;
        best = { d: h.distance, s: body.surface[vtx] };
      }
    }
    return best ? SURFACES[best.s] : null;
  }

  /** Ground height below a point (within `down` metres), or null. */
  groundAt(p: THREE.Vector3, down = 50, normal?: THREE.Vector3) {
    _o.set(p.x, p.y + 0.5, p.z);
    const d = this.raycast(_o, _down, down + 0.5, _tri, normal);
    return d === null ? null : _tri.y;
  }
}
