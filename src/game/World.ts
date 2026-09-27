import * as THREE from 'three';
import { EventBus } from '../core/Events';
import { Time } from '../core/Time';
import { Athlete } from './Athlete';
import { BallSystem } from './BallSystem';
import { Court } from './Court';
import type { GameEvents, TeamId } from './types';
import type { Match } from './Match';

/**
 * Everything that exists in the 3D play space for the current session:
 * court, athletes, balls and the event bus that presentation systems listen to.
 */
export class World {
  readonly scene = new THREE.Scene();
  readonly events = new EventBus<GameEvents>();
  court = new Court();
  athletes: Athlete[] = [];
  readonly balls: BallSystem;
  match: Match | null = null;
  camera: THREE.PerspectiveCamera;
  /** Blink-step afterimages that AI can mistake for the real athlete. */
  decoys: { owner: Athlete; pos: THREE.Vector3; until: number; id: number }[] = [];

  decoyFor(a: Athlete) {
    const now = this.time.gameTime;
    return this.decoys.find((d) => d.owner === a && d.until > now) ?? null;
  }

  constructor(public time: Time) {
    this.balls = new BallSystem(this);
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 400);
  }

  addAthlete(a: Athlete) {
    a.world = this;
    this.athletes.push(a);
    a.addToScene(this.scene);
  }

  removeAthletes() {
    for (const a of this.athletes) a.destroy(this.scene);
    this.athletes = [];
  }

  team(t: TeamId) {
    return this.athletes.filter((a) => a.team === t);
  }
  activeTeam(t: TeamId) {
    return this.athletes.filter((a) => a.team === t && a.active);
  }
  opponentsOf(a: Athlete) {
    return this.athletes.filter((o) => o.team !== a.team && o.active);
  }
  teammatesOf(a: Athlete) {
    return this.athletes.filter((o) => o.team === a.team && o !== a && o.active);
  }

  /** Nearest active opponent; with minDist, targets closer than that are only used as a fallback. */
  nearestOpponent(of: Athlete, from: THREE.Vector3, exclude?: Athlete, minDist = 0): Athlete | null {
    let best: Athlete | null = null;
    let bd = Infinity;
    const min2 = minDist * minDist;
    for (const o of this.athletes) {
      if (o.team === of.team || !o.active || o === exclude) continue;
      let d = o.pos.distanceToSquared(from);
      if (d < min2) d += 1e4; // too close to react: only if nobody else is available
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  update(dt: number) {
    for (const a of this.athletes) a.update(dt);
    this.separate();
    this.balls.update(dt);
  }

  /** Soft circle separation between teammates. */
  private separate() {
    const as = this.athletes;
    const R = 0.72;
    for (let i = 0; i < as.length; i++) {
      const a = as[i];
      if (!a.active) continue;
      for (let j = i + 1; j < as.length; j++) {
        const b = as[j];
        if (!b.active || a.team !== b.team) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < R * R && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (R - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
          this.court.clampAthlete(a.pos, a.team);
          this.court.clampAthlete(b.pos, b.team);
        }
      }
    }
  }
}
