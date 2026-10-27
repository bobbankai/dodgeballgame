import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify } from '../core/Assets';
import type { Input } from '../core/Input';
import { Animator } from './Animator';
import type { Collision } from './Collision';

const RADIUS = 0.21;
const HEIGHT = 1.42;
const GRAVITY = 22;
const JUMP_HEIGHT = 1.15;
export const WALK_SPEED = 1.35;
export const RUN_SPEED = 3.4;
// speeds at which the clips' strides match the ground at normal playback
const WALK_NATURAL = 0.88;
const RUN_NATURAL = 2.7;
const WALK_CYCLE = 28 / 30;
const RUN_CYCLE = 18 / 30;

const _v = new THREE.Vector3();
const _seg = new THREE.Line3();
const _move = new THREE.Vector2();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _want = new THREE.Vector3();

function angleTo(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export type PlayerMode = 'free' | 'trace' | 'talk' | 'locked';

/** Ada: movement, collision and animation. */
export class Player {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly anim: Animator;
  readonly position = this.root.position;
  readonly velocity = new THREE.Vector3();
  yaw = 0;
  grounded = false;
  mode: PlayerMode = 'free';
  /** Freeze input (cutscenes) but keep physics and animation running. */
  inputEnabled = true;
  /** Optional scripted movement target (cutscenes): walk to this point. */
  goal: THREE.Vector3 | null = null;
  goalSpeed = WALK_SPEED;
  speaking = false;

  private hit = { grounded: false, groundNormal: new THREE.Vector3() };
  private coyote = 0;
  private jumpBuffer = 0;
  private jumping = false;
  private airTime = 0;
  private landTimer = 0;
  private phase = 0;
  private blinkIn = 2;
  private turnRate = 0;
  private lean = 0;
  private pencilEar: THREE.Object3D | null = null;
  private pencilHand: THREE.Object3D | null = null;
  private oneShot: { name: string; t: number } | null = null;
  onLand?: (impact: number) => void;
  onStep?: () => void;
  private lastStepPhase = 0;

  constructor(gltf: GLTF) {
    this.model = gltf.scene;
    inkify(this.model, (name) => ({
      alwaysColor: true,
      hatch: name === 'ada_skin' ? 0.25 : 0.55,
      soft: name === 'ada_skin' ? 0.16 : 0.1,
    }));
    this.model.traverse((o) => {
      if (o.name === 'ada_pencil_ear') this.pencilEar = o;
      if (o.name === 'ada_pencil_hand') this.pencilHand = o;
      o.frustumCulled = false;
    });
    if (this.pencilHand) this.pencilHand.visible = false;
    this.root.add(this.model);
    this.anim = new Animator(this.model, gltf.animations, ['jump', 'land', 'pickup']);
  }

  teleport(p: THREE.Vector3, yaw = this.yaw) {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
  }

  /** Play a one-shot body clip (pickup...), holding the player still while it runs. */
  perform(name: string) {
    this.oneShot = { name, t: 0 };
    this.anim.restart(name);
  }

  get busy() {
    return this.oneShot !== null;
  }

  update(dt: number, input: Input, camYaw: number, col: Collision) {
    // ---- intent
    _want.set(0, 0, 0);
    const free = this.inputEnabled && this.mode === 'free' && !this.oneShot;
    if (free) {
      input.move(_move);
      _fwd.set(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      _right.set(Math.cos(camYaw), 0, -Math.sin(camYaw));
      _want.addScaledVector(_right, _move.x).addScaledVector(_fwd, _move.y);
      const mag = Math.min(1, _want.length());
      if (mag > 0) _want.normalize();
      // a gentle push of the stick (or holding Shift) walks; full tilt runs
      const top = input.down('walk') ? WALK_SPEED : RUN_SPEED;
      _want.multiplyScalar(top * mag);
      if (input.justPressed('jump')) this.jumpBuffer = 0.14;
    } else if (this.goal) {
      _v.subVectors(this.goal, this.position).setY(0);
      const d = _v.length();
      if (d < 0.12) this.goal = null;
      else _want.copy(_v).multiplyScalar(Math.min(this.goalSpeed, d * 3) / d);
    }

    // ---- horizontal velocity: snappy on the ground, floaty in the air
    const accel = this.grounded ? (_want.lengthSq() > 0 ? 24 : 30) : 9;
    _v.set(this.velocity.x, 0, this.velocity.z);
    const dv = _want.sub(_v);
    const maxDv = accel * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.velocity.x += dv.x;
    this.velocity.z += dv.z;

    // ---- jumping
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velocity.y = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
      this.grounded = false;
      this.jumping = true;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.anim.restart('jump', 1.2);
    }
    // let go early for a shorter hop
    const g = this.jumping && this.velocity.y > 0 && !input.down('jump') ? GRAVITY * 2.2 : GRAVITY;

    // ---- integrate with sub-steps, colliding the capsule against the level
    const wasGrounded = this.grounded;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    let grounded = false;
    for (let i = 0; i < steps; i++) {
      this.velocity.y -= g * h;
      const before = _v.copy(this.position).addScaledVector(this.velocity, h);
      _seg.start.set(before.x, before.y + RADIUS, before.z);
      _seg.end.set(before.x, before.y + HEIGHT - RADIUS, before.z);
      col.capsule(_seg, RADIUS, this.hit);
      const nx = _seg.start.x, ny = _seg.start.y - RADIUS, nz = _seg.start.z;
      // remove velocity going into whatever pushed us
      const cx = nx - before.x, cz = nz - before.z, cy = ny - before.y;
      const cl = Math.hypot(cx, cz);
      if (cl > 1e-6) {
        const into = (this.velocity.x * cx + this.velocity.z * cz) / cl;
        if (into < 0) {
          this.velocity.x -= (into * cx) / cl;
          this.velocity.z -= (into * cz) / cl;
        }
      }
      if (cy < -1e-5 && this.velocity.y > 0) this.velocity.y = 0; // ceiling
      if (this.hit.grounded && this.velocity.y <= 0) {
        grounded = true;
        this.velocity.y = 0;
      }
      this.position.set(nx, ny, nz);
    }
    // stick to the ground walking down slopes and steps
    if (!grounded && wasGrounded && !this.jumping && this.velocity.y <= 0) {
      const gy = col.groundAt(this.position, 0.4);
      if (gy !== null && this.position.y - gy < 0.4 && this.position.y - gy > -0.05) {
        this.position.y = gy;
        grounded = true;
        this.velocity.y = 0;
      }
    }
    this.grounded = grounded;
    if (grounded) this.jumping = false;
    if (!grounded) this.airTime += dt;
    else {
      if (!wasGrounded && this.airTime > 0.3) {
        this.landTimer = this.anim.duration('land');
        this.anim.restart('land');
        this.onLand?.(Math.min(1, this.airTime / 1.2));
      }
      this.airTime = 0;
    }

    // ---- facing: turn towards travel, lean into turns
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    if (hs > 0.15 && (free || this.goal)) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      const d = angleTo(this.yaw, target);
      const turn = d * (1 - Math.exp(-dt * (this.grounded ? 14 : 6)));
      this.yaw += turn;
      this.turnRate = turn / Math.max(dt, 1e-4);
    } else this.turnRate *= Math.exp(-dt * 8);
    this.lean += (THREE.MathUtils.clamp(-this.turnRate * hs * 0.025, -0.22, 0.22) - this.lean) * (1 - Math.exp(-dt * 8));
    this.root.rotation.set(0, this.yaw, 0);
    this.model.rotation.z = this.lean;

    this.animate(dt, hs);
  }

  /** Face a point (for conversations and cutscenes). */
  face(p: THREE.Vector3, dt: number) {
    const target = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    this.yaw += angleTo(this.yaw, target) * (1 - Math.exp(-dt * 8));
    this.root.rotation.y = this.yaw;
  }

  private animate(dt: number, speed: number) {
    const a = this.anim;
    if (this.pencilEar && this.pencilHand) {
      this.pencilHand.visible = this.mode === 'trace';
      this.pencilEar.visible = this.mode !== 'trace';
    }
    if (this.oneShot) {
      this.oneShot.t += dt;
      a.target({ [this.oneShot.name]: 1 }, 14);
      if (this.oneShot.t >= a.duration(this.oneShot.name) - 0.1) this.oneShot = null;
    } else if (!this.grounded && this.airTime > 0.08) {
      const rising = this.jumping && a.time('jump') < a.duration('jump') * 0.95 && this.velocity.y > 0.5;
      a.target(rising ? { jump: 1 } : { fall: 1 }, rising ? 20 : 6);
    } else if (this.mode === 'trace') {
      a.target({ trace: 1 }, 8);
    } else {
      // locomotion: idle / walk / run blended by speed, walk and run kept in step
      const move = THREE.MathUtils.smoothstep(speed, 0.05, 0.45);
      const r = THREE.MathUtils.clamp((speed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1);
      const s = Math.max(speed, 0.3);
      const period = THREE.MathUtils.lerp((WALK_CYCLE * WALK_NATURAL) / s, (RUN_CYCLE * RUN_NATURAL) / s, r);
      this.phase = (this.phase + dt / period) % 1;
      a.setPhase('walk', this.phase);
      a.setPhase('run', this.phase);
      const still = this.mode === 'talk' ? 'talk' : 'idle';
      const want: Record<string, number> = { [still]: 1 - move, walk: move * (1 - r), run: move * r };
      if (this.landTimer > 0) {
        const k = speed > 0.6 ? 0.45 : 1.4;
        want.land = k;
      }
      a.target(want, 9);
      if (this.landTimer > 0) a.rate('land', 30);
      // footsteps at each contact (phase 0 and 0.5)
      const half = Math.floor(this.phase * 2);
      if (move > 0.5 && half !== this.lastStepPhase) this.onStep?.();
      this.lastStepPhase = half;
    }
    this.landTimer = Math.max(0, this.landTimer - dt);

    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      a.blink();
      this.blinkIn = 1.5 + Math.random() * 3.5;
      if (Math.random() < 0.15) this.blinkIn = 0.25; // a double blink now and then
    }
    a.overlay('speak', this.speaking);
    a.update(dt);
  }
}
