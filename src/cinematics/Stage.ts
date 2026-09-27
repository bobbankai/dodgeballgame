import * as THREE from 'three';
import type { Game } from '../core/Game';
import { Athlete, AthleteProfile } from '../game/Athlete';
import type { ClipName } from '../character/Clips';
import type { Ball } from '../game/Ball';
import type { TeamId } from '../game/types';

/**
 * Actors for real-time cutscenes outside of matches: spawn athletes, place them,
 * walk them along paths with the locomotion system, and trigger clips.
 */
export class Stage {
  actors: Athlete[] = [];
  props: Ball[] = [];
  private walkers = new Map<Athlete, { to: THREE.Vector3; speed: number; face?: number; done?: () => void }>();
  private tick = (dt: number) => this.update(dt);

  constructor(private game: Game) {
    game.tickers.add(this.tick);
  }

  spawn(p: AthleteProfile, team: TeamId, pos: THREE.Vector3, yaw: number): Athlete {
    const a = new Athlete(p, team);
    this.game.world.addAthlete(a);
    a.resetForRound(pos, yaw);
    a.state = 'scripted';
    a.scriptedMove = true;
    this.actors.push(a);
    return a;
  }

  /** Adopt existing athletes (e.g. match rosters) as actors. */
  adopt(a: Athlete) {
    a.state = 'scripted';
    a.scriptedMove = true;
    if (!this.actors.includes(a)) this.actors.push(a);
  }

  giveBall(a: Athlete) {
    const b = this.game.world.balls.spawn(a.handPos(new THREE.Vector3()));
    a.grabBall(b, false);
    this.props.push(b);
    return b;
  }

  place(a: Athlete, pos: THREE.Vector3, yaw: number) {
    a.pos.copy(pos);
    a.vel.set(0, 0, 0);
    a.yaw = yaw;
    a.faceYaw = yaw;
  }

  play(a: Athlete, clip: ClipName, opts: { hold?: boolean; fade?: number; speed?: number } = {}) {
    a.state = 'scripted';
    a.anim.play(clip, { fade: opts.fade ?? 0.25, hold: opts.hold, speed: opts.speed });
  }

  stopClip(a: Athlete) {
    a.anim.stop(0.3);
  }

  walk(a: Athlete, to: THREE.Vector3, speed = 0.35, faceWhenDone?: number, done?: () => void) {
    a.anim.stop(0.3);
    this.walkers.set(a, { to: to.clone(), speed, face: faceWhenDone, done });
  }

  update(_dt: number) {
    for (const [a, w] of this.walkers) {
      const dx = w.to.x - a.pos.x, dz = w.to.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.15) {
        a.move.set(0, 0, 0);
        if (w.face !== undefined) a.faceYaw = w.face;
        this.walkers.delete(a);
        w.done?.();
        continue;
      }
      const k = Math.min(1, d / 0.6) * w.speed;
      a.move.set((dx / d) * k, 0, (dz / d) * k);
      a.faceYaw = Math.atan2(dx, dz);
    }
  }

  /** Release adopted athletes back to gameplay and remove spawned ones. */
  dispose(removeSpawned = true) {
    this.game.tickers.delete(this.tick);
    this.walkers.clear();
    for (const a of this.actors) {
      a.move.set(0, 0, 0);
      a.scriptedMove = false;
    }
    if (removeSpawned) {
      const w = this.game.world;
      for (const a of this.actors) {
        if (!w.match || (!w.match.home.includes(a) && !w.match.away.includes(a))) {
          a.removeFromScene(w.scene);
          const i = w.athletes.indexOf(a);
          if (i >= 0) w.athletes.splice(i, 1);
          this.game.abilities.ghosts.forget(a);
        } else a.releaseScripted();
      }
      for (const b of this.props) {
        const i = w.balls.balls.indexOf(b);
        if (i >= 0) w.balls.balls.splice(i, 1);
        b.removeFrom(w.scene);
      }
    }
    this.actors = [];
    this.props = [];
  }
}
