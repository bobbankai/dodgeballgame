import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { clamp, segmentSegmentClosest } from '../core/math';
import { Ball } from './Ball';
import type { Athlete } from './Athlete';
import type { World } from './World';

const _seg = { s: 0, t: 0, c1: new THREE.Vector3(), c2: new THREE.Vector3() };
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _next = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Distance from point p to segment ab (and closest param). */
function pointSegDist(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): { d: number; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y, z = a.z + abz * t - p.z;
  return { d: Math.sqrt(x * x + y * y + z * z), t };
}

export class BallSystem {
  balls: Ball[] = [];

  constructor(private world: World) {}

  clear() {
    for (const b of this.balls) b.removeFrom(this.world.scene);
    this.balls = [];
  }

  spawn(pos: THREE.Vector3): Ball {
    const b = new Ball();
    b.pos.copy(pos);
    b.prev.copy(pos);
    b.quat.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, 0));
    b.addTo(this.world.scene);
    this.balls.push(b);
    return b;
  }

  /** Reset all balls to the centre line for a new round. */
  layoutCenter(count: number) {
    while (this.balls.length < count) this.spawn(new THREE.Vector3());
    while (this.balls.length > count) this.balls.pop()!.removeFrom(this.world.scene);
    const hw = this.world.court.halfWidth;
    const spread = Math.min(hw * 1.5, 1.8 * (count - 1));
    this.balls.forEach((b, i) => {
      const x = count === 1 ? 0 : -spread / 2 + (spread * i) / (count - 1);
      b.setLoose();
      b.thrower = null;
      b.pos.set(x, b.radius, 0);
      b.prev.copy(b.pos);
      b.vel.set(0, 0, 0);
      b.angVel.set(0, 0, 0);
      b.grounded = true;
      b.hiddenTimer = 0;
      b.noPickupTimer = 0;
      b.energy = b.energyTarget = 0;
      b.lastTeam = -1;
    });
  }

  update(dt: number) {
    let maxSpeed = 0;
    for (const b of this.balls) if (b.state !== 'held') maxSpeed = Math.max(maxSpeed, b.speed);
    const steps = Math.max(1, Math.min(12, Math.ceil((dt * maxSpeed) / 0.12)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      for (const b of this.balls) if (b.state !== 'held') this.step(b, h);
      this.ballBall();
    }
    this.pickups();
    const t = this.world.time.realTime;
    for (const b of this.balls) b.syncVisual(this.world.time.dt, t);
  }

  private step(b: Ball, h: number) {
    const T = TUNING.ball;
    const w = this.world;
    b.noPickupTimer = Math.max(0, b.noPickupTimer - h);
    b.hiddenTimer = Math.max(0, b.hiddenTimer - h);
    const info = b.info;
    if (b.state === 'thrown') {
      b.airTime += h;
      if (info) info.time += h;
      if (b.airTime > 4) this.kill(b);
    }
    const live = b.live && info;
    const g = TUNING.gravity * (live ? info.gravityScale : 1);

    if (!b.grounded) b.vel.y -= g * h;
    if (live && info.curve) b.vel.addScaledVector(info.curve, h);
    if (live && info.homing && info.homing.active) {
      info.homing.chestPos(_a);
      const desired = _a.sub(b.pos).normalize();
      const sp = b.vel.length();
      const cur = _b.copy(b.vel).divideScalar(sp || 1);
      const ang = cur.angleTo(desired);
      const maxTurn = info.homingStrength * h;
      if (ang > 1e-4) {
        const k = Math.min(1, maxTurn / ang);
        cur.lerp(desired, k).normalize();
        b.vel.copy(cur).multiplyScalar(sp);
      }
    }
    b.vel.multiplyScalar(Math.exp(-(live ? 0.02 : 0.12) * h));

    b.prev.copy(b.pos);
    _next.copy(b.pos).addScaledVector(b.vel, h);

    if (b.state === 'thrown' && !b.decoy) {
      if (this.collideAthletes(b, b.prev, _next)) return;
    }

    // floor
    const r = b.radius;
    if (_next.y <= r) {
      _next.y = r;
      if (b.vel.y < -1.0) {
        const impact = -b.vel.y;
        b.vel.y = impact * T.floorRestitution;
        b.vel.x *= T.floorFriction;
        b.vel.z *= T.floorFriction;
        // bounce adds rolling spin
        b.angVel.crossVectors(UP, b.vel).divideScalar(r).multiplyScalar(0.8);
        if (impact > 1.6) w.events.emit('bounce', { ball: b, surface: 'floor', speed: impact, point: _next.clone(), normal: UP.clone() });
        if (b.live) this.kill(b);
        b.grounded = false;
      } else {
        b.vel.y = 0;
        b.grounded = true;
        const hs = Math.hypot(b.vel.x, b.vel.z);
        if (hs > 0) {
          const ns = Math.max(0, hs - T.rollDecel * h);
          b.vel.x *= ns / hs;
          b.vel.z *= ns / hs;
        }
        b.angVel.set(b.vel.z, 0, -b.vel.x).divideScalar(r);
        if (b.live) this.kill(b);
      }
    } else if (b.grounded && _next.y > r + 0.01) b.grounded = false;

    // walls
    const hw = w.court.halfWidth - r;
    const hl = w.court.halfLength - r;
    if (Math.abs(_next.x) > hw) {
      const s = Math.sign(_next.x);
      _next.x = s * hw;
      if (b.vel.x * s > 0) this.wallBounce(b, _n.set(-s, 0, 0), _next);
    }
    if (Math.abs(_next.z) > hl) {
      const s = Math.sign(_next.z);
      _next.z = s * hl;
      if (b.vel.z * s > 0) this.wallBounce(b, _n.set(0, 0, -s), _next);
    }
    if (_next.y > w.court.ceiling) {
      _next.y = w.court.ceiling;
      if (b.vel.y > 0) b.vel.y *= -0.5;
    }
    // obstacles
    for (const o of w.court.obstacles) {
      const cx = clamp(_next.x, o.min.x, o.max.x);
      const cy = clamp(_next.y, o.min.y, o.max.y);
      const cz = clamp(_next.z, o.min.z, o.max.z);
      const dx = _next.x - cx, dy = _next.y - cy, dz = _next.z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 1e-4;
        _n.set(dx / d, dy / d, dz / d);
        if (d2 < 1e-8) _n.set(0, 1, 0);
        _next.set(cx + _n.x * r, cy + _n.y * r, cz + _n.z * r);
        const vn = b.vel.dot(_n);
        if (vn < 0) {
          b.vel.addScaledVector(_n, -vn * (1 + T.wallRestitution));
          w.events.emit('bounce', { ball: b, surface: 'obstacle', speed: -vn, point: _next.clone(), normal: _n.clone() });
          if (b.live && b.info) {
            b.info.wallBounces++;
            if (b.info.wallBounces > T.maxWallBouncesLive) this.kill(b);
          }
        }
      }
    }
    b.pos.copy(_next);
  }

  private wallBounce(b: Ball, n: THREE.Vector3, at: THREE.Vector3) {
    const T = TUNING.ball;
    const vn = b.vel.dot(n);
    const speed = b.vel.length();
    const rest = b.live && b.info?.ricochet ? 0.95 : T.wallRestitution;
    b.vel.addScaledVector(n, -vn * (1 + rest));
    // tangential damping
    b.vel.multiplyScalar(b.live && b.info?.ricochet ? 1 : 0.92);
    b.angVel.multiplyScalar(-0.6);
    this.world.events.emit('bounce', { ball: b, surface: 'wall', speed: Math.abs(vn), point: at.clone(), normal: n.clone() });
    if (b.live && b.info) {
      b.info.wallBounces++;
      if (b.info.wallBounces > TUNING.ball.maxWallBouncesLive) this.kill(b);
      else if (b.info.ricochet && b.thrower) {
        // bank-shot assist: steer toward an exposed opponent, but never one so close to the wall
        // (or so fast) that the redirected ball arrives before anyone could react to the bounce
        const target = this.world.nearestOpponent(b.thrower, at, undefined, 4.5);
        if (target) {
          target.chestPos(_a);
          const dist = _a.distanceTo(at);
          const dir = _a.sub(at).normalize();
          const reactable = dist / 0.34;
          b.vel.copy(dir).multiplyScalar(THREE.MathUtils.clamp(speed * 0.9, 13, Math.max(13, Math.min(20, reactable))));
          b.info.homing = target;
          b.info.homingStrength = 2.2;
          b.info.gravityScale = 0.3;
        }
      }
    }
  }

  kill(b: Ball) {
    if (!b.live && b.state !== 'thrown') return;
    b.live = false;
    b.state = 'loose';
    b.energyTarget = 0;
    b.hiddenTimer = 0;
  }

  /** Swept collision of a thrown ball against athletes. Returns true if the ball was consumed/redirected. */
  private collideAthletes(b: Ball, p0: THREE.Vector3, p1: THREE.Vector3): boolean {
    const w = this.world;
    const info = b.info;
    const r = b.radius;
    for (const a of w.athletes) {
      if (!a.active || a.isOut || b.ignore.has(a)) continue;
      const chest = a.chestPos(_c);
      // pass reception
      if (info?.kind === 'pass') {
        if (a === info.receiver && !a.ball) {
          const { d } = pointSegDist(chest, p0, p1);
          if (d < 1.15) {
            a.grabBall(b, false);
            w.events.emit('catch', { catcher: a, thrower: b.thrower, ball: b, perfect: false, point: chest.clone() });
            return true;
          }
        }
        // interception: an opponent in catch stance snatches the pass out of the air
        if (b.thrower && a.team !== b.thrower.team && a.state === 'catching' && !a.ball) {
          const center = _a.copy(chest).addScaledVector(a.forwardVec(_n), 0.3);
          const { d } = pointSegDist(center, p0, p1);
          if (d < TUNING.catch.reach + 0.15) {
            a.grabBall(b, false);
            a.addEnergy(TUNING.energy.catch);
            a.addUlt(TUNING.ult.catch);
            a.stats_.catches++;
            w.events.emit('intercept', { athlete: a, from: b.thrower, ball: b, point: center.clone() });
            return true;
          }
        }
        continue;
      }
      if (!b.live) continue;
      if (b.thrower && b.thrower.team === a.team) continue;

      const fwd = a.forwardVec(_n);
      // catch zone
      if (a.state === 'catching') {
        const center = _a.copy(chest).addScaledVector(fwd, 0.3);
        const { d } = pointSegDist(center, p0, p1);
        if (d < TUNING.catch.reach) {
          const res = a.resolveCatch(b);
          if (res === 'catch' || res === 'perfect') {
            const thrower = b.thrower;
            b.live = false;
            a.onCaught(b, res === 'perfect');
            w.events.emit('catch', { catcher: a, thrower, ball: b, perfect: res === 'perfect', point: center.clone() });
            return true;
          }
          if (res === 'fumble') {
            a.onFumble(b);
            this.deflect(b, fwd, 0.3);
            w.events.emit('fumble', { athlete: a, ball: b, point: center.clone() });
            b.ignore.add(a);
            return true;
          }
        }
      }
      // block with held ball
      if (a.state === 'blocking') {
        const center = _a.copy(chest).addScaledVector(fwd, 0.35);
        const { d } = pointSegDist(center, p0, p1);
        const inc = _b.copy(b.vel).setY(0).normalize().negate();
        if (d < 0.7 && inc.dot(fwd) > 0.1) {
          const perfect = w.time.gameTime - a.catchStart < 0.16;
          const thrower = b.thrower;
          if (perfect && a.perks.reflect && thrower && thrower.active) {
            thrower.chestPos(_c);
            const v = _c.sub(center).normalize().multiplyScalar(Math.max(22, b.speed * 0.9));
            b.thrower = a;
            b.ignore.clear();
            b.ignore.add(a);
            b.pos.copy(center);
            b.vel.copy(v);
            if (b.info) {
              b.info.kind = 'reflect';
              b.info.target = thrower;
              b.info.homing = thrower;
              b.info.homingStrength = 1.5;
              b.info.gravityScale = 0.3;
              b.info.wallBounces = 0;
              b.info.time = 0;
            }
            b.airTime = 0;
            w.events.emit('block', { athlete: a, ball: b, reflect: true, point: center.clone() });
          } else {
            this.deflect(b, fwd, 0.45);
            b.ignore.add(a);
            w.events.emit('block', { athlete: a, ball: b, reflect: false, point: center.clone() });
          }
          a.anim.flinch(0, 1, 0.5);
          return true;
        }
      }

      // body capsule
      const baseY = a.pos.y + a.y;
      const hgt = a.rig.height;
      _a.set(a.pos.x, baseY + 0.3 * hgt, a.pos.z);
      _b.set(a.pos.x, baseY + (a.state === 'dodging' ? 1.35 : 1.62) * hgt, a.pos.z);
      const d2 = segmentSegmentClosest(p0, p1, _a, _b, _seg);
      const R = TUNING.athlete.radius + r;
      if (a.state === 'dodging' && a.isIFrame) {
        if (Math.sqrt(d2) < TUNING.dodge.perfectRadius) a.onPerfectDodge(b);
        continue;
      }
      if (d2 < R * R) {
        const point = _seg.c1.clone();
        const normal = point.clone().sub(_seg.c2).setY(0);
        if (normal.lengthSq() < 1e-6) normal.copy(b.vel).negate().setY(0);
        normal.normalize();
        b.ignore.add(a);
        const thrower = b.thrower;
        const shock = !!info?.shockwave;
        const applied = a.takeHit(b, point);
        // rebound
        b.pos.copy(point).addScaledVector(normal, R - r + 0.02);
        const sp = b.speed;
        b.vel.reflect(normal).multiplyScalar(TUNING.ball.hitRebound);
        b.vel.y = Math.max(b.vel.y, 2 + sp * 0.06);
        b.angVel.multiplyScalar(-0.5);
        const chain = info && info.chain > 0 && applied;
        if (chain && thrower) {
          // ultimate chain: redirect to the next opponent
          info!.chain--;
          const next = this.world.nearestOpponent(thrower, point, a);
          if (next) {
            next.chestPos(_c);
            b.vel.copy(_c.sub(b.pos).normalize().multiplyScalar(Math.max(24, sp * 0.8)));
            info!.homing = next;
            info!.homingStrength = 4;
            info!.gravityScale = 0.1;
            b.airTime = 0;
            if (shock) w.events.emit('shockwave', { point: point.clone(), radius: 3.2, source: thrower });
            return true;
          }
        }
        this.kill(b);
        if (shock) w.events.emit('shockwave', { point: point.clone(), radius: info!.kind === 'ultimate' ? 4.2 : 3, source: thrower });
        return true;
      }
    }
    return false;
  }

  private deflect(b: Ball, fwd: THREE.Vector3, keep: number) {
    const sp = b.speed;
    b.vel.reflect(_c.copy(fwd).setY(0).normalize()).multiplyScalar(keep);
    b.vel.y = Math.max(b.vel.y, 3 + sp * 0.05);
    b.vel.x += (Math.random() - 0.5) * 3;
    b.live = false;
    b.state = 'loose';
    b.energyTarget = 0;
    b.noPickupTimer = 0.2;
  }

  private ballBall() {
    const bs = this.balls;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (a.state === 'held' || a.decoy) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.state === 'held' || b.decoy) continue;
        if (!a.live && !b.live && a.grounded && b.grounded && a.speed < 0.5 && b.speed < 0.5) {
          // resting balls: soft separation only
        }
        const d = a.pos.distanceTo(b.pos);
        const R = a.radius + b.radius;
        if (d >= R || d < 1e-6) continue;
        _n.subVectors(b.pos, a.pos).divideScalar(d);
        const overlap = R - d;
        a.pos.addScaledVector(_n, -overlap / 2);
        b.pos.addScaledVector(_n, overlap / 2);
        const rel = _a.subVectors(b.vel, a.vel).dot(_n);
        if (rel < 0) {
          const imp = -rel * 0.9;
          a.vel.addScaledVector(_n, -imp);
          b.vel.addScaledVector(_n, imp);
          if (a.live && b.live) {
            this.kill(a);
            this.kill(b);
            a.vel.y += 3;
            b.vel.y += 3;
            this.world.events.emit('clash', { a, b, point: _a.addVectors(a.pos, b.pos).multiplyScalar(0.5).clone() });
          }
          if (a.grounded) a.grounded = false;
          if (b.grounded) b.grounded = false;
        }
      }
    }
  }

  private pickups() {
    const w = this.world;
    if (!w.match || !w.match.allowPickups) return;
    for (const b of this.balls) {
      if (b.state !== 'loose' || b.live || b.noPickupTimer > 0 || b.decoy) continue;
      if (b.pos.y > TUNING.ball.pickupMaxHeight || b.speed > TUNING.ball.pickupMaxSpeed) continue;
      let best: Athlete | null = null;
      let bestD: number = TUNING.ball.pickupRadius;
      for (const a of w.athletes) {
        if (a.ball || !a.canAct) continue;
        if (!(a.state === 'free' || a.state === 'catchRecover' || a.state === 'whiff' || (a.state === 'dodging' && a.stateTime > 0.2))) continue;
        if (!w.court.inHalf(b.pos, a.team, 0.55)) continue;
        const d = Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
        if (d < bestD && (a.wantsPickup ?? true)) {
          best = a;
          bestD = d;
        }
      }
      if (best) best.grabBall(b, b.pos.y < 0.55);
    }
  }
}
