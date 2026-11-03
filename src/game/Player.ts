import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify, lineIdFor } from '../core/Assets';
import type { Input } from '../core/Input';
import { Animator } from './Animator';
import { Face } from './Face';
import { Procedural } from './Procedural';
import type { Collision } from './Collision';

const RADIUS = 0.21;
/** Tallest ledge Ada walks up without jumping. */
const STEP = 0.36;
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
const _hitP = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _probe = new THREE.Vector3();
const _stepN = new THREE.Vector3();

function angleTo(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export type PlayerMode = 'free' | 'trace' | 'talk' | 'locked';

const _rideEuler = new THREE.Euler();

/** Ada: movement, collision and animation. */
export class Player {
  readonly root = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly anim: Animator;
  /** Her expressions and the mouth moving as she talks. */
  readonly expression: Face;
  /** Looking at things, the scarf and satchel swinging. */
  readonly life: Procedural;
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
  private lastMode = '';
  private turnRate = 0;
  private lean = 0;
  /** Leaning forward to speed up, back to stop. */
  private pitchLean = 0;
  private lastFwd = 0;
  /** The way her body is drawn facing: follows `yaw` closely, but never snaps round in one frame. */
  private shownYaw = 0;
  private turnShuffle = 0;
  private pencilEar: THREE.Object3D | null = null;
  private pencilHand: THREE.Object3D | null = null;
  private oneShot: { name: string; t: number } | null = null;
  /** A held acting pose (cutscenes): overrides locomotion until cleared. */
  private poseName: string | null = null;
  onLand?: (impact: number) => void;
  onStep?: () => void;
  private lastStepPhase = 0;

  constructor(gltf: GLTF) {
    this.model = gltf.scene;
    // the eyes are drawn like a picture-book face: an ink line round the white and the iris, none
    // round the pupil or the glints, no hatching, and the glints stay bright in shadow
    const eye = ['ada_eye_white', 'ada_iris', 'ada_eye_hi'];
    // what shines: the rubber boots and the raincoat most, then buttons, leather and a little hair
    const shine: Record<string, [number, number, number]> = {
      ada_boots: [0.75, 0.045, 1], ada_coat: [0.45, 0.04, 0.85], ada_coat_dark: [0.35, 0.04, 0.7], ada_button: [0.8, 0.05, 1],
      ada_bag: [0.4, 0.06, 0.3], ada_strap: [0.3, 0.05, 0.3], ada_hair: [0.32, 0.08, 0.05], ada_sole: [0.3, 0.06, 0.4],
      ada_skin: [0.18, 0.05, 0.25],
    };
    inkify(this.model, (name) => ({
      alwaysColor: true,
      hatch: eye.includes(name) ? 0 : name === 'ada_skin' ? 0.25 : 0.55,
      soft: name === 'ada_skin' ? 0.18 : eye.includes(name) ? 0.3 : 0.1,
      skin: name === 'ada_skin',
      ...(name === 'ada_scarf' || name === 'ada_leggings' ? { sheen: 0.3 } : {}),
      ...(name === 'ada_eye_hi' ? { lineId: lineIdFor('ada_iris'), emissive: 0.7 } : {}),
      ...(name === 'ada_eye_white' ? { emissive: 0.18 } : {}),
      ...(shine[name] ? { gloss: shine[name][0], glossSize: shine[name][1], glossWhite: shine[name][2] } : {}),
    }));
    this.model.traverse((o) => {
      if (o.name === 'ada_pencil_ear') this.pencilEar = o;
      if (o.name === 'ada_pencil_hand') this.pencilHand = o;
      o.frustumCulled = false;
    });
    if (this.pencilHand) this.pencilHand.visible = false;
    this.root.add(this.model);
    this.anim = new Animator(this.model, gltf.animations, ['jump', 'land', 'pickup', 'point', 'surprise']);
    this.expression = new Face(this.model, gltf.animations, 1);
    this.life = new Procedural(this.model, {
      look: [['chest', 0.15, 0.1], ['neck', 0.3, 0.35], ['head', 0.55, 0.55]],
      loose: [
        { bone: 'scarf1', gain: 1.0, stiff: 80, damp: 8, max: 28 },
        { bone: 'scarf2', gain: 1.3, stiff: 55, damp: 5.5, max: 32 },
        { bone: 'bag', gain: 0.8, stiff: 60, damp: 6, max: 22 },
      ],
    });
    this.anim.layers.push(this.life);
  }

  teleport(p: THREE.Vector3, yaw = this.yaw) {
    this.position.copy(p);
    this.velocity.set(0, 0, 0);
    this.yaw = this.shownYaw = yaw;
    this.root.rotation.y = yaw;
    this.life.reset();
  }

  /** A fresh start for a new level: on her feet, visible, in control, nothing held over. */
  reset() {
    this.ride(null);
    this.setPose(null);
    this.oneShot = null;
    this.goal = null;
    this.mode = 'free';
    this.inputEnabled = true;
    this.speaking = false;
    this.root.visible = true;
    this.velocity.set(0, 0, 0);
    this.landTimer = 0;
    this.airTime = 0;
    this.jumping = false;
    this.expression.setBase('neutral');
    this.expression.set('neutral');
    this.life.look = null;
    this.life.reset();
    this.pitchLean = this.lean = 0;
    this.model.rotation.set(0, 0, 0);
  }

  /** Play a one-shot body clip (pickup...), holding the player still while it runs. */
  perform(name: string) {
    this.oneShot = { name, t: 0 };
    this.anim.restart(name);
  }

  /** Hold an acting clip (sit, point, hug...) until called again with null. */
  setPose(name: string | null) {
    if (name && name !== this.poseName) this.anim.restart(name);
    this.poseName = name;
  }

  get busy() {
    return this.oneShot !== null;
  }

  /** Sit on something that moves (the boat): follow `seat` exactly, physics off. */
  ride(seat: THREE.Object3D | null, pose = 'tiller') {
    this.riding = seat;
    this.setPose(seat ? pose : null);
    if (!seat) {
      this.root.quaternion.identity();
      this.root.rotation.set(0, this.yaw, 0);
      this.shownYaw = this.yaw;
      this.velocity.set(0, 0, 0);
    }
  }

  riding: THREE.Object3D | null = null;
  /** While riding, the velocity of what Ada rides (for the camera). */
  readonly rideVelocity = new THREE.Vector3();

  /** Snap to the seat (call again after moving what she rides, so she never lags it a frame). */
  syncRide() {
    if (!this.riding) return;
    this.riding.updateWorldMatrix(true, false);
    this.riding.getWorldPosition(this.position);
    this.riding.getWorldQuaternion(this.root.quaternion);
    this.yaw = _rideEuler.setFromQuaternion(this.root.quaternion, 'YXZ').y;
    this.velocity.copy(this.rideVelocity);
  }

  update(dt: number, input: Input, camYaw: number, col: Collision) {
    if (this.riding) {
      this.syncRide();
      this.grounded = true;
      this.model.rotation.set(0, 0, 0);
      this.animate(dt, 0);
      return;
    }
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

    // ---- integrate with sub-steps. The capsule floats a step's height above Ada's feet and
    // handles walls and ceilings; a ray down from it finds the ground, so steps and slopes just work.
    const wasGrounded = this.grounded;
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    let grounded = wasGrounded;
    for (let i = 0; i < steps; i++) {
      if (!grounded || this.velocity.y > 0) this.velocity.y -= g * h;
      const before = _v.copy(this.position).addScaledVector(this.velocity, h);
      _seg.start.set(before.x, before.y + STEP + RADIUS, before.z);
      _seg.end.set(before.x, before.y + HEIGHT - RADIUS, before.z);
      col.capsule(_seg, RADIUS, this.hit);
      const nx = _seg.start.x, nz = _seg.start.z;
      let ny = _seg.start.y - RADIUS - STEP;
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
      // feet: find the ground under the capsule (snap down a little when already walking)
      grounded = false;
      if (this.velocity.y <= 0) {
        const extra = wasGrounded && !this.jumping ? 0.3 : 0.02;
        _probe.set(nx, ny + STEP + 0.02, nz);
        const d = col.raycast(_probe, _down, STEP + 0.02 + extra, _hitP, _stepN);
        if (d !== null && Math.abs(_stepN.y) >= col.walkable) {
          ny = _hitP.y;
          grounded = true;
          this.velocity.y = 0;
        } else if (this.hit.grounded) {
          // the capsule itself came down on something walkable
          grounded = true;
          this.velocity.y = 0;
        }
      }
      this.position.set(nx, ny, nz);
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
    // speeding up tips her forward a little, pulling up tips her back (on the ground only)
    const fwd = this.velocity.x * Math.sin(this.yaw) + this.velocity.z * Math.cos(this.yaw);
    const fa = (fwd - this.lastFwd) / Math.max(dt, 1e-4);
    this.lastFwd = fwd;
    const pl = this.grounded ? THREE.MathUtils.clamp(fa * 0.006, -0.09, 0.11) : 0;
    this.pitchLean += (pl - this.pitchLean) * (1 - Math.exp(-dt * 7));
    this.model.rotation.z = this.lean;
    this.model.rotation.x = this.pitchLean;

    this.animate(dt, hs);
  }

  /** Face a point (for conversations and cutscenes). Her body turns round to it over a moment. */
  face(p: THREE.Vector3, dt: number) {
    const target = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    this.yaw += angleTo(this.yaw, target) * (1 - Math.exp(-dt * 8));
  }

  private animate(dt: number, speed: number) {
    const a = this.anim;
    if (!this.riding) {
      // the body follows the facing quickly but never pops round; a big turn on the spot takes a few steps
      const turn = angleTo(this.shownYaw, this.yaw);
      const step = turn * (1 - Math.exp(-dt * 16));
      this.shownYaw += Math.abs(turn) < 1e-4 ? turn : step;
      const spin = Math.abs(step) / Math.max(dt, 1e-4);
      this.turnShuffle += ((this.grounded && speed < 0.4 && spin > 1.2 ? 1 : 0) - this.turnShuffle) * (1 - Math.exp(-dt * 10));
      if (this.turnShuffle > 0.01) speed = Math.max(speed, 0.5 * this.turnShuffle);
      this.root.rotation.set(0, this.shownYaw, 0);
    } else this.shownYaw = this.yaw;
    // where she looks: less while running or acting; not at all while busy with her hands or a hug
    const busy = this.oneShot || this.mode === 'trace' || this.poseName === 'hug' || this.poseName === 'kneel_draw';
    this.life.lookWeight = busy ? 0 : !this.grounded ? 0.3 : this.poseName ? 0.7 : 1 - 0.5 * THREE.MathUtils.smoothstep(speed, 1.5, 3.4);
    if (this.pencilEar && this.pencilHand) {
      this.pencilHand.visible = this.mode === 'trace';
      this.pencilEar.visible = this.mode !== 'trace';
    }
    if (this.poseName) {
      a.target({ [this.poseName]: 1 }, 6);
    } else if (this.oneShot) {
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

    if (this.mode !== this.lastMode) {
      // drawing takes concentration
      if (this.mode === 'trace') this.expression.setBase('determined');
      else if (this.lastMode === 'trace') this.expression.setBase('neutral');
      this.lastMode = this.mode;
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && !this.expression.has) {
      a.blink();
      this.blinkIn = 1.5 + Math.random() * 3.5;
      if (Math.random() < 0.15) this.blinkIn = 0.25; // a double blink now and then
    }
    a.overlay('speak', this.speaking && !this.expression.has);
    a.update(dt);
    this.expression.update(dt);
  }
}
