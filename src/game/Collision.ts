import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';

export interface CapsuleHit {
  grounded: boolean;
  groundNormal: THREE.Vector3;
}

const _box = new THREE.Box3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ray = new THREE.Ray();

/** Static level collision: all collider meshes merged into one BVH. */
export class Collision {
  private bvh: MeshBVH | null = null;
  private colliders: THREE.Mesh[] = [];
  /** Walkable if the surface normal's Y is at least this (about 55 degrees). */
  walkable = 0.57;

  add(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh) this.colliders.push(m);
    });
  }

  build() {
    if (!this.colliders.length) return;
    // bake every collider into one world-space triangle soup
    const parts: Float32Array[] = [];
    let total = 0;
    for (const m of this.colliders) {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const pos = g.attributes.position;
      const arr = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        arr.set([v.x, v.y, v.z], i * 3);
      }
      parts.push(arr);
      total += arr.length;
    }
    const all = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(all, 3));
    this.bvh = new MeshBVH(geo);
  }

  clear() {
    this.colliders = [];
    this.bvh = null;
  }

  /**
   * Push a capsule (segment start = bottom sphere centre, end = top sphere centre) out of the level.
   * Walkable surfaces push straight up so standing on a slope doesn't slide; walls push sideways.
   * Returns the corrected segment in place.
   */
  capsule(seg: THREE.Line3, radius: number, out: CapsuleHit): CapsuleHit {
    out.grounded = false;
    out.groundNormal.set(0, 1, 0);
    if (!this.bvh) return out;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      _box.makeEmpty().expandByPoint(seg.start).expandByPoint(seg.end);
      _box.min.addScalar(-radius);
      _box.max.addScalar(radius);
      this.bvh.shapecast({
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
            // walls and steep slopes: push out horizontally (and down from ceilings)
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
      if (!moved) break;
    }
    return out;
  }

  /** First hit along a ray, or null. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, hit = new THREE.Vector3(), normal?: THREE.Vector3) {
    if (!this.bvh) return null;
    _ray.set(origin, dir);
    const h = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (!h) return null;
    hit.copy(h.point);
    if (normal && h.face) normal.copy(h.face.normal);
    return h.distance;
  }

  /** Ground height below a point (within `down` metres), or null. */
  groundAt(p: THREE.Vector3, down = 50, normal?: THREE.Vector3) {
    const o = new THREE.Vector3(p.x, p.y + 0.5, p.z);
    const d = this.raycast(o, new THREE.Vector3(0, -1, 0), down + 0.5, _tri, normal);
    return d === null ? null : _tri.y;
  }
}
