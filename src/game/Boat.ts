import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Particles } from '../render/Particles';
import type { Collision } from './Collision';
import { seaHeight } from './Sea';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _move = new THREE.Vector2();

/**
 * The little sailing boat Ada inks at the pier. W fills the sail, A/D steer; it rides the folded
 * waves, pitching and rolling with them, and bumps off rocks and the island shores.
 */
export class Boat {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  heading = 0;
  speed = 0;
  private rudder = 0;
  /** Where Ada sits (stern bench) and Pip (bow), in the boat's frame. */
  readonly seatAda = new THREE.Object3D();
  readonly seatPip = new THREE.Object3D();
  private spray = 0;
  /** Steering is off during cutscenes. */
  control = false;
  /** Sail setting while the player isn't steering (cutscenes sail the boat themselves). */
  autoThrottle = 0;
  /** Keep inside this circle (the edge of the page). */
  bounds = { center: new THREE.Vector2(0, -60), radius: 150 };
  maxSpeed = 7.5;

  constructor(readonly obj: THREE.Object3D) {
    obj.add(this.seatAda, this.seatPip);
    // the GLB boat faces +Z (bow) in three's axes
    this.seatAda.position.set(0, 0.33, -1.15);
    this.seatPip.position.set(0, 0.2, 1.55);
    this.seatPip.rotation.y = 0;
    this.position.copy(obj.position);
    this.heading = obj.rotation.y;
  }

  update(dt: number, input: Input | null, col: Collision, fx: Particles) {
    // steering: relative to the boat, so it handles like a boat rather than a cursor
    let throttle = this.autoThrottle, steer = 0;
    if (input && this.control) {
      input.move(_move);
      throttle = _move.y;
      steer = -_move.x;
    }
    const target = throttle > 0 ? this.maxSpeed * throttle : throttle < 0 ? -1.5 : 0;
    this.speed += (target - this.speed) * (1 - Math.exp(-dt * (throttle > 0 ? 0.6 : 0.9)));
    this.rudder += (steer - this.rudder) * (1 - Math.exp(-dt * 4));
    const turn = this.rudder * (0.35 + 0.55 * Math.min(1, Math.abs(this.speed) / 4));
    this.heading += turn * dt;

    // move, then push back off anything solid ahead (rocks, shores, the pier)
    const fwd = _a.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.position.addScaledVector(fwd, this.speed * dt);
    for (const side of [-0.7, 0, 0.7]) {
      const dir = _b.set(Math.sin(this.heading + side), 0, Math.cos(this.heading + side));
      const o = this.position.clone().add(new THREE.Vector3(0, 0.6, 0));
      const d = col.raycast(o, dir, 2.6, _hit);
      if (d !== null) {
        this.position.addScaledVector(dir, d - 2.6);
        if (side === 0 && this.speed > 0) this.speed *= -0.3;
        this.heading -= side * dt * 2;
      }
    }
    // the page ends: turn gently back
    const off = new THREE.Vector2(this.position.x - this.bounds.center.x, this.position.z - this.bounds.center.y);
    if (off.length() > this.bounds.radius) {
      off.setLength(this.bounds.radius);
      this.position.x = this.bounds.center.x + off.x;
      this.position.z = this.bounds.center.y + off.y;
      this.speed *= 0.9;
    }

    // float: height and tilt from the waves under bow, stern and both sides
    const h = seaHeight(this.position.x, this.position.z);
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading);
    const bow = seaHeight(this.position.x + fwd.x * 1.8, this.position.z + fwd.z * 1.8);
    const stern = seaHeight(this.position.x - fwd.x * 1.8, this.position.z - fwd.z * 1.8);
    const left = seaHeight(this.position.x + sx * 0.8, this.position.z + sz * 0.8);
    const right = seaHeight(this.position.x - sx * 0.8, this.position.z - sz * 0.8);
    this.position.y += (h + 0.05 - this.position.y) * (1 - Math.exp(-dt * 6));
    const pitch = Math.atan2(stern - bow, 3.6);
    const roll = Math.atan2(left - right, 1.6) - this.rudder * Math.min(1, this.speed / 5) * 0.12;
    _e.set(pitch, this.heading, roll, 'YXZ');
    _q.setFromEuler(_e);
    this.obj.position.copy(this.position);
    this.obj.quaternion.slerp(_q, 1 - Math.exp(-dt * 8));
    this.velocity.copy(fwd).multiplyScalar(this.speed);

    // spray off the bow and a wake behind
    this.spray -= dt * Math.abs(this.speed);
    if (this.spray <= 0 && Math.abs(this.speed) > 1) {
      this.spray = 0.9;
      const p = this.position.clone().addScaledVector(fwd, 2.1);
      fx.dust(p, 2, 0.22);
      fx.dust(this.position.clone().addScaledVector(fwd, -2.2), 1, 0.3);
    }
  }
}
