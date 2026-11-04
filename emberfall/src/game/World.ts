// Static collision world: level colliders merged into one BVH (three-mesh-bvh). Capsules slide along
// walls (shapecast), feet snap to the ground with step-up and a slope limit, the camera ray casts.
import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpBox = new THREE.Box3();
const tmpSeg = new THREE.Line3();
const triPoint = new THREE.Vector3();
const capPoint = new THREE.Vector3();
const ray = new THREE.Ray();
const down = new THREE.Vector3(0, -1, 0);

export interface Body {
  pos: THREE.Vector3; // feet
  vel: THREE.Vector3;
  radius: number;
  height: number;
  grounded: boolean;
  groundNormal: THREE.Vector3;
  /** allowed step height */
  step: number;
}

export function makeBody(pos: THREE.Vector3, radius = 0.32, height = 1.7): Body {
  return { pos: pos.clone(), vel: new THREE.Vector3(), radius, height, grounded: false, groundNormal: new THREE.Vector3(0, 1, 0), step: 0.45 };
}

export class World {
  bvh: MeshBVH | null = null;
  mesh: THREE.Mesh | null = null;
  /** soft bounds (circle or polygon) the player can't leave */
  bounds: THREE.Vector2[] | null = null;
  killY = -30;
  private geos: THREE.BufferGeometry[] = [];

  /** add every mesh under root (world transforms baked) */
  add(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.noCollide) return;
      // positions only, as float32 (meshopt / gltfpack geometry is quantized to int16, terrain is float)
      const src = m.geometry.attributes.position as THREE.BufferAttribute;
      const f = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) { f[i * 3] = src.getX(i); f[i * 3 + 1] = src.getY(i); f[i * 3 + 2] = src.getZ(i); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(f, 3));
      if (m.geometry.index) g.setIndex(m.geometry.index.clone());
      const ng = g.index ? g.toNonIndexed() : g;
      if (m instanceof THREE.InstancedMesh) {
        const im = new THREE.Matrix4();
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, im);
          const c = ng.clone();
          c.applyMatrix4(new THREE.Matrix4().multiplyMatrices(m.matrixWorld, im));
          this.geos.push(c);
        }
      } else {
        ng.applyMatrix4(m.matrixWorld);
        this.geos.push(ng);
      }
    });
  }

  build(): void {
    if (!this.geos.length) return;
    const merged = mergeGeometries(this.geos, false);
    this.geos = [];
    this.bvh = new MeshBVH(merged, { maxLeafSize: 12 } as never);
    this.mesh = new THREE.Mesh(merged);
    this.mesh.geometry.boundsTree = this.bvh;
  }

  clear(): void {
    this.bvh = null;
    this.mesh = null;
    this.geos = [];
    this.bounds = null;
  }

  /** ground height below (x, y, z) within maxDrop; returns null when no ground */
  ground(x: number, y: number, z: number, maxDrop = 50, normal?: THREE.Vector3): number | null {
    if (!this.bvh) return 0;
    ray.origin.set(x, y, z);
    ray.direction.copy(down);
    const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide);
    if (!hit || hit.distance > maxDrop) return null;
    if (normal && hit.face) normal.copy(hit.face.normal);
    return hit.point.y;
  }

  /** distance along a ray to the first hit (camera collision) */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number): number {
    if (!this.bvh) return far;
    ray.origin.copy(origin);
    ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(ray, THREE.DoubleSide);
    return hit && hit.distance < far ? hit.distance : far;
  }

  /** move a body by a horizontal displacement (and gravity), resolving collisions */
  move(b: Body, disp: THREE.Vector3, dt: number, gravity = true): void {
    const p = b.pos;
    // horizontal + vertical velocity
    if (gravity && !b.grounded) b.vel.y -= 22 * dt;
    if (b.grounded && b.vel.y < 0) b.vel.y = 0;
    p.x += disp.x;
    p.z += disp.z;
    p.y += disp.y + b.vel.y * dt;
    if (this.bvh) {
      // capsule vs walls (the lower part above the step height so steps don't block)
      const r = b.radius;
      tmpSeg.start.set(p.x, p.y + b.step + r, p.z);
      tmpSeg.end.set(p.x, p.y + b.height - r, p.z);
      for (let iter = 0; iter < 2; iter++) {
        tmpBox.makeEmpty();
        tmpBox.expandByPoint(tmpSeg.start);
        tmpBox.expandByPoint(tmpSeg.end);
        tmpBox.min.addScalar(-r);
        tmpBox.max.addScalar(r);
        this.bvh.shapecast({
          intersectsBounds: (box) => box.intersectsBox(tmpBox),
          intersectsTriangle: (tri: ExtendedTriangle) => {
            const d = tri.closestPointToSegment(tmpSeg, triPoint, capPoint);
            if (d < r) {
              const depth = r - d;
              const dir = capPoint.sub(triPoint);
              dir.y = 0; // walls push horizontally; the floor is handled by the ground snap
              if (dir.lengthSq() < 1e-8) return false;
              dir.normalize();
              tmpSeg.start.addScaledVector(dir, depth);
              tmpSeg.end.addScaledVector(dir, depth);
            }
            return false;
          },
        });
      }
      p.x = tmpSeg.start.x;
      p.z = tmpSeg.start.z;
      // ground snap with step-up
      const gy = this.ground(p.x, p.y + b.step + 0.05, p.z, b.step + 0.6, b.groundNormal);
      if (gy !== null && p.y <= gy + 0.06 && b.vel.y <= 0.01) {
        // too steep: slide back down, not walkable
        if (b.groundNormal.y < 0.55 && gy > p.y + 0.05) {
          p.x -= disp.x;
          p.z -= disp.z;
        } else {
          p.y = gy;
          b.grounded = true;
          b.vel.y = 0;
        }
      } else if (gy !== null && b.grounded && p.y - gy < 0.35 && b.vel.y <= 0) {
        // walking down slopes / steps: stay glued
        p.y = gy;
      } else {
        b.grounded = gy !== null && Math.abs(p.y - gy) < 0.02;
      }
    } else {
      if (p.y <= 0) { p.y = 0; b.grounded = true; b.vel.y = 0; }
    }
    if (this.bounds) this.clampToBounds(p);
  }

  private clampToBounds(p: THREE.Vector3): void {
    const poly = this.bounds!;
    const pt = new THREE.Vector2(p.x, p.z);
    if (pointInPoly(pt, poly)) return;
    // project onto the nearest edge
    let best = pt.clone();
    let bd = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, pt.clone().sub(a).dot(ab) / ab.lengthSq()));
      const c = a.clone().addScaledVector(ab, t);
      const d = c.distanceToSquared(pt);
      if (d < bd) { bd = d; best = c; }
    }
    p.x = best.x;
    p.z = best.y;
  }
}

export function pointInPoly(p: THREE.Vector2, poly: THREE.Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** push overlapping bodies apart (characters never interpenetrate) */
export function separate(bodies: Body[], fixed: Set<Body> = new Set()): void {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j];
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const min = a.radius + b.radius;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min || Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
    const d = Math.sqrt(d2) || 1e-4;
    const push = (min - d) / d;
    const af = fixed.has(a), bf = fixed.has(b);
    const ka = af ? 0 : bf ? 1 : 0.5, kb = bf ? 0 : af ? 1 : 0.5;
    a.pos.x -= dx * push * ka; a.pos.z -= dz * push * ka;
    b.pos.x += dx * push * kb; b.pos.z += dz * push * kb;
  }
}
