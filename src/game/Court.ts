import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import type { TeamId } from './types';

export interface Obstacle {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

/**
 * The playable enclosure. Team 0 (home) owns z > 0, team 1 owns z < 0.
 * Walls sit exactly on the boundary lines; balls ricochet off them.
 */
export class Court {
  halfWidth: number;
  halfLength: number;
  /** Visual board height (balls above it still bounce off the invisible cage). */
  wallHeight = 1.15;
  ceiling = 11;
  obstacles: Obstacle[] = [];
  /** Extra camera blockers supplied by the arena (outer walls, stands). */
  cameraBlockers: THREE.Box3[] = [];

  constructor(halfWidth = 6.5, halfLength = 10) {
    this.halfWidth = halfWidth;
    this.halfLength = halfLength;
  }

  side(team: TeamId): 1 | -1 {
    return team === 0 ? 1 : -1;
  }

  /** Keep an athlete (xz circle) inside its half and out of obstacles. */
  clampAthlete(pos: THREE.Vector3, team: TeamId, radius = TUNING.athlete.radius) {
    const hw = this.halfWidth - TUNING.athlete.wallMargin;
    const hl = this.halfLength - TUNING.athlete.wallMargin;
    pos.x = Math.max(-hw, Math.min(hw, pos.x));
    const m = TUNING.athlete.centerMargin;
    if (team === 0) pos.z = Math.max(m, Math.min(hl, pos.z));
    else pos.z = Math.min(-m, Math.max(-hl, pos.z));
    for (const o of this.obstacles) {
      // circle vs AABB push-out in XZ
      const cx = Math.max(o.min.x, Math.min(o.max.x, pos.x));
      const cz = Math.max(o.min.z, Math.min(o.max.z, pos.z));
      const dx = pos.x - cx, dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * radius;
          pos.z = cz + (dz / d) * radius;
        } else {
          // inside: push along the smallest axis
          const pushes = [pos.x - o.min.x, o.max.x - pos.x, pos.z - o.min.z, o.max.z - pos.z];
          const i = pushes.indexOf(Math.min(...pushes));
          if (i === 0) pos.x = o.min.x - radius;
          else if (i === 1) pos.x = o.max.x + radius;
          else if (i === 2) pos.z = o.min.z - radius;
          else pos.z = o.max.z + radius;
        }
      }
    }
  }

  inHalf(pos: THREE.Vector3, team: TeamId, margin = 0) {
    return team === 0 ? pos.z > -margin : pos.z < margin;
  }

  /** Is the XZ point inside the court enclosure? */
  inside(pos: THREE.Vector3) {
    return Math.abs(pos.x) <= this.halfWidth && Math.abs(pos.z) <= this.halfLength;
  }

  /** Spawn slots along a team's back area. */
  spawnPoint(team: TeamId, index: number, count: number, out: THREE.Vector3) {
    const s = this.side(team);
    const spread = Math.min(this.halfWidth * 1.3, 2.6 * (count - 1));
    const x = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
    out.set(x, 0, s * this.halfLength * 0.72);
    return out;
  }

  /** Line segment of sight blocked by obstacles? (XZ, at chest height) */
  blocked(a: THREE.Vector3, b: THREE.Vector3): boolean {
    if (this.obstacles.length === 0) return false;
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.divideScalar(len || 1);
    const ray = new THREE.Ray(a, dir);
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    for (const o of this.obstacles) {
      box.set(o.min, o.max);
      if (ray.intersectBox(box, hit) && hit.distanceTo(a) < len) return true;
    }
    return false;
  }
}
