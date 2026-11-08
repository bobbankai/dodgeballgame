// Path following for one agent. Each frame the agent asks for a direction towards a goal; the follower
// decides how to get it:
//   - straight at the goal when the grid says the line is walkable (most of a fight in open ground),
//   - otherwise along a planned path, re-planned when the goal has moved far from the path's end, when the
//     path is old, or when the agent has stopped making progress,
//   - skipping ahead to any later waypoint it can already walk to (paths straighten as the agent moves),
//   - and, when stuck against something, a short sidestep before trying again.
import * as THREE from 'three';
import type { Navigation } from './Navigation';

export type FollowMode = 'direct' | 'path' | 'arrived' | 'waiting' | 'lost';

export interface FollowOptions {
  /** close enough to the goal (m) */
  arrive?: number;
  /** re-plan when the goal is this far (m) from where the current path ends */
  drift?: number;
  /** re-plan at least this often (s) */
  maxAge?: number;
  /** how often (s) to re-check the direct line */
  directEvery?: number;
  /** the agent's body radius for straight-line tests */
  radius?: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class PathFollower {
  mode: FollowMode = 'lost';
  points: THREE.Vector3[] = [];
  index = 1;
  /** where the current path was planned to */
  private planGoal = new THREE.Vector3(Infinity, 0, Infinity);
  private planT = -Infinity;
  private directT = -Infinity;
  private directOk = false;
  private lastProgressT = 0;
  private progressPos = new THREE.Vector3();
  private sidestepT = 0;
  private sidestep = new THREE.Vector3();
  private stuckCount = 0;
  /** total re-plans, for profiling */
  plans = 0;

  constructor(private nav: Navigation, private o: FollowOptions = {}) {}

  /** body radius used when testing straight lines (corners are not clipped) */
  get radius(): number { return this.o.radius ?? 0.3; }

  reset(): void {
    this.mode = 'lost';
    this.points = [];
    this.index = 1;
    this.planGoal.set(Infinity, 0, Infinity);
    this.planT = -Infinity;
    this.directT = -Infinity;
    this.stuckCount = 0;
  }

  /** the next point the agent is heading for (or the goal when going direct) */
  get next(): THREE.Vector3 | null {
    return this.mode === 'path' ? this.points[Math.min(this.index, this.points.length - 1)] ?? null : null;
  }

  /**
   * the planar direction to move in this frame (unit length, or zero when arrived / waiting).
   * `time` is the agent's clock in seconds; `moving` says whether the agent intends to move this frame
   * (progress is only judged while it does).
   */
  steer(pos: THREE.Vector3, goal: THREE.Vector3, time: number, out: THREE.Vector3, moving = true): FollowMode {
    const arrive = this.o.arrive ?? 0.5;
    const dGoal = Math.hypot(goal.x - pos.x, goal.z - pos.z);
    if (dGoal <= arrive) { out.set(0, 0, 0); this.mode = 'arrived'; return this.mode; }

    // a sidestep in progress (unsticking) overrides everything briefly
    if (this.sidestepT > time) { out.copy(this.sidestep); return this.mode; }

    // stuck? no progress for a while although we meant to move
    if (moving) {
      if (pos.distanceToSquared(this.progressPos) > 0.09) {
        this.progressPos.copy(pos);
        this.lastProgressT = time;
        this.stuckCount = 0;
      } else if (time - this.lastProgressT > 1.1) {
        this.lastProgressT = time;
        this.stuckCount++;
        this.planT = -Infinity;
        this.directOk = false;
        this.directT = time + 0.8;
        // sidestep at right angles to the way we were trying to go, alternating sides
        const way = this.mode === 'path' && this.next ? _a.copy(this.next).sub(pos) : _a.copy(goal).sub(pos);
        way.y = 0;
        if (way.lengthSq() < 1e-6) way.set(1, 0, 0);
        way.normalize();
        const side = this.stuckCount % 2 ? 1 : -1;
        this.sidestep.set(-way.z * side, 0, way.x * side);
        this.sidestepT = time + 0.45;
        out.copy(this.sidestep);
        return this.mode;
      }
    } else {
      this.progressPos.copy(pos);
      this.lastProgressT = time;
    }

    // the direct line (re-checked a few times a second)
    if (time - this.directT >= (this.o.directEvery ?? 0.25)) {
      this.directT = time;
      this.directOk = this.nav.canWalk(pos, goal, this.radius);
    }
    if (this.directOk) {
      this.mode = 'direct';
      out.set(goal.x - pos.x, 0, goal.z - pos.z).normalize();
      return this.mode;
    }

    // follow (or plan) a path
    const drift = this.o.drift ?? 1.5;
    const stale = time - this.planT > (this.o.maxAge ?? 2.5) || this.planGoal.distanceTo(goal) > drift || this.points.length < 2;
    if (stale) {
      const r = this.nav.plan(pos, goal, { reach: arrive * 0.8 });
      if (r) {
        this.plans++;
        this.points = r.points;
        this.index = 1;
        this.planGoal.copy(goal);
        this.planT = time;
      } else if (this.points.length < 2) {
        // the budget is spent this frame: hold still rather than walk into a wall
        out.set(0, 0, 0);
        this.mode = 'waiting';
        return this.mode;
      }
    }
    if (this.points.length < 2) { out.set(0, 0, 0); this.mode = 'lost'; return this.mode; }

    // advance past waypoints we have reached, and skip ahead to any we can already walk to directly
    const P = this.points;
    // a waypoint counts as reached when we are on it, or near it with the next leg already walkable from
    // here (switching early without that check cuts the corner it marks)
    while (this.index < P.length - 1) {
      const d = Math.hypot(P[this.index].x - pos.x, P[this.index].z - pos.z);
      if (d < 0.15 || (d < 0.6 && this.nav.canWalk(pos, P[this.index + 1], this.radius))) this.index++;
      else break;
    }
    if (this.index < P.length - 1 && this.nav.canWalk(pos, P[this.index + 1], this.radius)) this.index++;
    const t = P[this.index];
    out.set(t.x - pos.x, 0, t.z - pos.z);
    const L = out.length();
    if (L < 1e-4) { out.set(0, 0, 0); this.mode = 'arrived'; return this.mode; }
    out.divideScalar(L);
    this.mode = 'path';
    return this.mode;
  }

  /** remaining distance along the path (or straight, when going direct) */
  remaining(pos: THREE.Vector3, goal: THREE.Vector3): number {
    if (this.mode !== 'path') return Math.hypot(goal.x - pos.x, goal.z - pos.z);
    let L = 0;
    _b.copy(pos);
    for (let i = this.index; i < this.points.length; i++) {
      L += Math.hypot(this.points[i].x - _b.x, this.points[i].z - _b.z);
      _b.copy(this.points[i]);
    }
    return L;
  }
}
