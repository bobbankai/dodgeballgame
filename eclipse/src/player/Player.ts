import {
  CharacterSupportedState, PhysicsCharacterController, Quaternion, Vector3, type Scene,
} from '@babylonjs/core';
import type { Character } from '../character/Character';
import type { Input } from '../input/Input';
import type { CameraRig } from '../camera/CameraRig';
import type { CombatWorld, HitEvent } from '../combat/CombatWorld';
import type { Combatant, DamageInfo, HitResult, HurtCapsule, Team } from '../combat/Types';
import { Stats } from '../combat/Stats';
import { ATTACKS, type AttackDef } from '../combat/Attacks';
import type { Clock } from '../core/Clock';
import type { ClipEvent } from '../anim/Clip';
import { WEAPONS, type WeaponSpec } from '../character/Weapons';
import { EventBus } from '../core/Events';
import { measureReach, type Reach } from '../anim/Reach';

export type PlayerState =
  | 'move' | 'air' | 'land' | 'attack' | 'charge' | 'dodge' | 'block' | 'blockHit' | 'parry' | 'hitstun'
  | 'stagger' | 'knockdown' | 'getup' | 'cast' | 'heal' | 'interact' | 'dead' | 'cinematic';

export interface PlayerEvents {
  attackStart: { attack: AttackDef };
  swing: { attack: AttackDef };
  impact: { attack: AttackDef; point: Vector3; radius: number };
  hitLanded: HitEvent;
  hurt: { info: DamageInfo; result: HitResult };
  dodge: { dir: string };
  perfectDodge: Record<string, never>;
  parry: { attacker: Combatant | null };
  footstep: { side: string; position: Vector3 };
  land: { heavy: boolean };
  jump: Record<string, never>;
  ability: { name: string; phase: 'channel' | 'release' };
  death: Record<string, never>;
  heal: Record<string, never>;
  status: { status: 'burn' | 'soak' | 'shock' | 'root' };
  statusTick: { status: 'burn' };
  wardHit: { left: number };
}

/** Abilities register here (divine powers); the player calls them on input. */
export interface AbilitySlot {
  name: string;
  clip: string;
  cost: number;
  cooldown: number;
  ready: number;
  onRelease: (p: Player) => void;
  onChannel?: (p: Player) => void;
  /** Runs the moment the ability is used (dashes), in addition to the clip's events. */
  instant?: (p: Player) => void;
  upper?: boolean;
}

const UP = new Vector3(0, 1, 0);

/**
 * Kael: movement on a Havok character controller, camera-relative controls, root motion for
 * actions, and the combat state machine. Implements Combatant so enemies hit him through the same
 * system he hits them with.
 */
export class Player implements Combatant {
  readonly id: number;
  readonly team: Team = 'player';
  readonly name = 'Kael';
  readonly radius = 0.38;
  readonly height = 1.85;
  readonly heavy = false;
  readonly targetable = true;
  readonly stats = new Stats({ health: 260, stamina: 110, poise: 45, aether: 100 });
  readonly events = new EventBus<PlayerEvents>();
  readonly ctrl: PhysicsCharacterController;
  state: PlayerState = 'move';
  stateTime = 0;
  /** Current lock-on target. */
  target: Combatant | null = null;
  attack: AttackDef | null = null;
  abilities: (AbilitySlot | null)[] = [null, null, null, null];
  ultimate: AbilitySlot | null = null;
  flasks = 3;
  maxFlasks = 3;
  flaskHeal = 0.45;
  /** Multipliers from skills and equipment. */
  mods = { damage: 1, staminaCost: 1, parryWindow: 0.2, aetherGain: 1, poiseDamage: 1, flinchResist: 0, dodgeDistance: 1, executionHeal: 0, abilityCost: 1, abilityDamage: 1 };
  inputEnabled = true;
  /** Status build-up (0..100) and remaining seconds of each active status. */
  readonly statusBuild = { burn: 0, soak: 0, shock: 0, root: 0 };
  readonly statusTime = { burn: 0, soak: 0, shock: 0, root: 0 };
  private burnTick = 0;
  /** Scripted walking (cinematics / tests): when set and input is disabled the player walks here. */
  goal: Vector3 | null = null;
  private vel = new Vector3();
  private moveDir = new Vector3();
  private iframes = 0;
  private iframesStart = 0;
  private armour = false;
  private parryUntil = -1;
  private hitWindow = false;
  private swingHits = new Set<number>();
  private bladePrev: { base: Vector3; tip: Vector3 } | null = null;
  private comboOpen = false;
  private cancelOpen = false;
  private queued: string | null = null;
  private airTime = 0;
  private sprinting = false;
  private chargeT = 0;
  private lastAttackEnd = -10;
  private weapon: WeaponSpec = WEAPONS.oathkeeper;
  private hurt: HurtCapsule[] = [];
  private tmp = new Vector3();
  private time = 0;
  private lastFoot = 0;
  /** Attack magnetism (motion warping toward the chosen target through the wind-up). */
  private warpTarget: Combatant | null = null;
  private warpReach: Reach | null = null;
  private warpEnd = 0;

  constructor(readonly scene: Scene, readonly char: Character, private input: Input, private rig: CameraRig,
    private world: CombatWorld, private clock: Clock, start: Vector3) {
    this.id = world.newId();
    this.ctrl = new PhysicsCharacterController(start.add(new Vector3(0, this.height / 2, 0)), { capsuleHeight: this.height, capsuleRadius: this.radius }, scene);
    this.ctrl.maxSlopeCosine = Math.cos((50 * Math.PI) / 180);
    this.ctrl.maxStepHeight = 0.42;
    this.ctrl.keepDistance = 0.04;
    this.ctrl.acceleration = 1;
    this.char.root.position.copyFrom(start);
    this.hurt = [
      { a: new Vector3(), b: new Vector3(), radius: 0.3, mult: 1, part: 'body' },
      { a: new Vector3(), b: new Vector3(), radius: 0.17, mult: 1, part: 'legs' },
    ];
    this.setFreeLocomotion();
    world.add(this);
  }

  get position(): Vector3 {
    return this.char.root.position;
  }

  get alive(): boolean {
    return this.stats.alive;
  }

  get busy(): boolean {
    return this.state !== 'move' && this.state !== 'air';
  }

  aimPoint(out: Vector3): Vector3 {
    return out.copyFrom(this.position).addInPlaceFromFloats(0, 1.2, 0);
  }

  hurtboxes(): HurtCapsule[] {
    const c = this.char;
    c.bonePosition('pelvis', this.hurt[0].a);
    c.bonePosition('head', this.hurt[0].b);
    c.bonePosition('calf_l', this.hurt[1].a);
    c.bonePosition('calf_r', this.hurt[1].b);
    this.hurt[1].a.y = this.position.y + 0.2;
    this.hurt[1].b.y = this.position.y + 0.2;
    return this.hurt;
  }

  /** Teleport (checkpoints, level loads). */
  place(p: Vector3, yaw?: number): void {
    // settling onto the ground after a teleport is not "walking off a ledge"
    this.airGrace = 0.4;
    this.ctrl.setPosition(p.add(new Vector3(0, this.height / 2, 0)));
    this.ctrl.setVelocity(Vector3.Zero());
    this.char.root.position.copyFrom(p);
    if (yaw !== undefined) this.char.yaw = yaw;
  }

  private setFreeLocomotion(): void {
    const a = this.char.animator;
    a.strafing = false;
    a.setLocomotion([{ clip: 'idle', speed: 0 }, { clip: 'walk', speed: 1.6 }, { clip: 'run', speed: 5.0 }, { clip: 'sprint', speed: 7.6 }]);
  }

  private setCombatLocomotion(): void {
    const a = this.char.animator;
    a.setLocomotion([{ clip: 'idle_combat', speed: 0 }, { clip: 'guard_fwd', speed: 1.9 }]);
    a.setStrafe({ fwd: 'guard_fwd', back: 'guard_back', left: 'guard_left', right: 'guard_right' });
    a.strafing = true;
  }

  // -------------------------------------------------------------------------- main update
  update(dt: number): void {
    this.time += dt;
    this.stateTime += dt;
    if (this.iframes > 0) this.iframes -= dt;
    const blocking = this.state === 'block' || this.state === 'blockHit';
    this.updateStatus(dt);
    this.stats.update(dt, (blocking ? 0.35 : this.sprinting ? 0 : 1) * (this.statusTime.soak > 0 ? 0.5 : 1));
    if (this.alive && this.state !== 'cinematic') this.handleInput(dt);
    this.updateLockOn();
    this.physicsStep(dt);
    this.updateWeapon();
    this.char.update(dt);
    this.footsteps();
  }

  private handleInput(dt: number): void {
    const inp = this.input;
    const canAct = this.inputEnabled;
    // stick direction relative to the camera
    const f = this.rig.flatForward;
    const r = this.rig.flatRight;
    let mx = canAct ? inp.move.x : 0;
    let my = canAct ? inp.move.y : 0;
    if (!canAct && this.goal) {
      const d = this.goal.subtract(this.position);
      d.y = 0;
      const len = d.length();
      if (len > 0.3) {
        // express the goal direction in camera axes so the same code path drives it
        mx = Vector3.Dot(d, r) / len;
        my = Vector3.Dot(d, f) / len;
      } else {
        this.goal = null;
      }
    }
    this.moveDir.set(f.x * my + r.x * mx, 0, f.z * my + r.z * mx);
    const mag = Math.min(1, this.moveDir.length());
    if (mag > 1e-3) this.moveDir.scaleInPlace(1 / this.moveDir.length());
    if (!canAct) {
      this.locomote(dt, mag, false);
      return;
    }
    if (inp.pressed('lockOn')) this.toggleLock();
    switch (this.state) {
      case 'move':
        this.locomote(dt, mag, inp.held('sprint'));
        this.tryActions();
        break;
      case 'air':
        this.airControl(dt, mag);
        if (inp.pressed('light') && this.airTime > 0.15) this.startAttack('air');
        break;
      case 'attack':
        this.attackTick(dt);
        break;
      case 'charge':
        this.faceInput(dt, 6);
        this.chargeT += dt;
        if (!inp.held('heavy') || this.chargeT > 1.6) this.startAttack(this.chargeT > 0.45 ? 'charged' : 'heavy_1');
        break;
      case 'block':
      case 'blockHit':
        this.locomote(dt, mag * 0.45, false);
        if (!inp.held('block')) this.toMove();
        else if (inp.pressed('dodge')) this.dodge();
        break;
      case 'parry':
        if (this.time > this.parryUntil + 0.15) {
          if (inp.held('block')) {
            this.state = 'block';
            this.char.animator.play('block_idle', { fade: 0.1 });
          } else {
            this.toMove();
          }
        }
        break;
      case 'dodge':
        if (this.cancelOpen) {
          if (inp.buffered('light')) {
            inp.consume('light');
            this.startAttack(this.sprinting ? 'sprint' : 'light_1');
          } else if (inp.pressed('dodge')) this.dodge();
        }
        break;
      case 'land':
        if (!this.heavyLanding && this.stateTime > 0.12) this.toMove();
        else if (this.cancelOpen && inp.pressed('dodge')) this.dodge();
        break;
      case 'hitstun':
        if (this.cancelOpen && inp.pressed('dodge')) this.dodge();
        break;
      case 'cast':
      case 'heal':
        if (this.cancelOpen && inp.pressed('dodge')) this.dodge();
        break;
      default:
        break;
    }
  }

  private tryActions(): void {
    const inp = this.input;
    if (this.ripostePending && this.time < this.riposteUntil && inp.buffered('light', 0.3)) {
      this.tryRiposte();
      return;
    }
    if (inp.pressed('dodge')) return this.dodge();
    if (inp.pressed('jump') && this.grounded) return this.jump();
    if (inp.held('block')) {
      this.state = 'block';
      this.stateTime = 0;
      this.parryUntil = this.time + this.mods.parryWindow;
      this.char.animator.play('parry', { fade: 0.05, onEvent: (e) => this.onClipEvent(e) });
      this.state = 'parry';
      return;
    }
    if (inp.buffered('light', 0.2)) {
      inp.consume('light');
      const exec = this.findExecution();
      if (exec) return this.startAttack('execution', exec);
      if (this.sprinting && this.vel.length() > 5) return this.startAttack('sprint');
      return this.startAttack('light_1');
    }
    if (inp.pressed('heavy')) {
      if (!this.stats.spend(6)) return;
      this.state = 'charge';
      this.stateTime = 0;
      this.chargeT = 0;
      this.armour = true;
      this.char.animator.play('heavy_charge_start', { fade: 0.1, onEnd: () => { if (this.state === 'charge') this.char.animator.play('heavy_charge', { fade: 0.1 }); } });
      this.char.face.set('effort', 0.8);
      return;
    }
    if (inp.pressed('heal')) return this.drinkFlask();
    for (let i = 0; i < 4; i++) {
      if (inp.pressed(`ability${i + 1}` as 'ability1')) return this.useAbility(this.abilities[i]);
    }
    if (inp.pressed('ultimate')) return this.useAbility(this.ultimate);
  }

  // -------------------------------------------------------------------------- locomotion
  private locomote(dt: number, mag: number, sprint: boolean): void {
    const a = this.char.animator;
    const locked = !!this.target && this.state === 'move';
    this.sprinting = sprint && mag > 0.5 && !locked && this.stats.stamina > 1;
    if (this.sprinting) this.stats.drain(14 * dt * this.mods.staminaCost);
    let speed: number;
    if (locked) {
      speed = mag * (this.input.held('walk') ? 1.0 : 1.9);
    } else if (this.sprinting) {
      speed = 7.6;
    } else {
      speed = mag < 0.55 || this.input.held('walk') ? mag * 1.6 / 0.55 * (mag < 0.55 ? 1 : 0.55) : 5.0 * mag;
      speed = Math.min(speed, 5.0);
    }
    this.rig.fovKick = this.sprinting ? 0.08 : 0;
    // turning: face the movement direction, or the target when locked on
    if (locked && this.target) {
      const to = this.target.position.subtract(this.position);
      this.turnTowards(Math.atan2(to.x, to.z), dt, 10);
      const yaw = this.char.yaw;
      const mv = this.moveDir;
      const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const rgt = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      a.locoDir = Math.atan2(-Vector3.Dot(mv, rgt), Vector3.Dot(mv, fwd));
      if (!a.strafing) this.setCombatLocomotion();
    } else {
      if (a.strafing) this.setFreeLocomotion();
      if (mag > 0.05) this.turnTowards(Math.atan2(this.moveDir.x, this.moveDir.z), dt, this.sprinting ? 7 : 11);
    }
    // ease speed so blends and the camera feel weighty (quick start, a little slide to stop)
    const want = this.moveDir.scale(speed);
    const accel = speed > a.locoSpeed ? 14 : 10;
    this.vel.x += (want.x - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (want.z - this.vel.z) * Math.min(1, dt * accel);
    a.locoSpeed = Math.hypot(this.vel.x, this.vel.z);
  }

  private airControl(dt: number, mag: number): void {
    this.airTime += dt;
    const want = this.moveDir.scale(mag * 4.5);
    this.vel.x += (want.x - this.vel.x) * Math.min(1, dt * 2.5);
    this.vel.z += (want.z - this.vel.z) * Math.min(1, dt * 2.5);
    if (mag > 0.1) this.turnTowards(Math.atan2(this.moveDir.x, this.moveDir.z), dt, 4);
  }

  private turnTowards(yaw: number, dt: number, rate: number): void {
    const cur = this.char.yaw;
    let d = yaw - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    this.char.yaw = cur + step;
  }

  private faceInput(dt: number, rate: number): void {
    if (this.target) {
      const to = this.target.position.subtract(this.position);
      this.turnTowards(Math.atan2(to.x, to.z), dt, rate);
    } else if (this.moveDir.lengthSquared() > 0.01) {
      this.turnTowards(Math.atan2(this.moveDir.x, this.moveDir.z), dt, rate);
    }
  }

  get grounded(): boolean {
    return this.supported;
  }

  private supported = true;
  private airGrace = 0;
  /** Hit points of a protective ward (Tidal Ward); damage goes to it first. */
  wardHp = 0;
  /** Velocity added by the world this step (currents, whirlpools), cleared after use. */
  private external = new Vector3();

  push(v: Vector3): void {
    this.external.addInPlace(v);
  }

  /** A cinematic has the player: no input, no state changes, animations are the director's. */
  setCinematic(on: boolean): void {
    if (on) {
      this.state = 'cinematic';
      this.vel.setAll(0);
    } else if (this.state === 'cinematic') {
      this.state = 'move';
      this.toMove();
    }
  }

  private physicsStep(dt: number): void {
    const ctrl = this.ctrl;
    const down = new Vector3(0, -1, 0);
    const surface = ctrl.checkSupport(dt, down);
    const wasSupported = this.supported;
    this.supported = surface.supportedState === CharacterSupportedState.SUPPORTED;
    if (this.airGrace > 0) this.airGrace -= dt;
    const gravity = this.scene.getPhysicsEngine()?.gravity ?? new Vector3(0, -19.6, 0);
    let desired = new Vector3(this.vel.x, 0, this.vel.z);
    // actions move by root motion (authored lunges, dodges, knockbacks)
    const a = this.char.animator;
    if (a.actionActive && this.state !== 'move' && this.state !== 'air' && this.state !== 'block') {
      const rd = a.rootDelta;
      const q = this.char.root.rotationQuaternion ?? Quaternion.Identity();
      const world = rd.applyRotationQuaternion(q).scale(1 / Math.max(dt, 1e-4));
      // dodges cover more ground with the dodge-distance skill
      const k = this.state === 'dodge' ? this.mods.dodgeDistance : 1;
      desired = new Vector3(world.x * k, 0, world.z * k);
      // keep a little of the momentum the player had, then let root motion own the move
      this.vel.scaleInPlace(Math.exp(-dt * 10));
      desired.addInPlace(this.vel.scale(0.3));
      desired.addInPlace(this.attackWarp(dt));
    }
    desired.addInPlace(this.external);
    this.external.setAll(0);
    const cur = ctrl.getVelocity();
    let out: Vector3;
    if (this.supported) {
      out = ctrl.calculateMovement(dt, this.char.forward, surface.averageSurfaceNormal, cur, surface.averageSurfaceVelocity, desired, UP);
      if (this.state === 'air' && this.stateTime > 0.05) this.landed();
    } else {
      out = new Vector3(desired.x, cur.y, desired.z).addInPlace(gravity.scale(dt));
      if (wasSupported && this.state === 'move' && cur.y <= 0.5 && this.airGrace <= 0) {
        // walked off a ledge
        this.toAir(false);
      }
    }
    if (this.pendingJump > 0) {
      out.y = this.pendingJump;
      this.pendingJump = 0;
    }
    ctrl.setVelocity(out);
    ctrl.integrate(dt, surface, gravity);
    const p = ctrl.getPosition();
    this.char.root.position.set(p.x, p.y - this.height / 2, p.z);
    if (p.y < -60 && this.alive) this.kill();
  }

  private pendingJump = 0;

  private jump(): void {
    if (!this.stats.spend(12)) return;
    this.pendingJump = 7.2;
    this.toAir(true);
    this.events.emit('jump', {});
  }

  private toAir(jumped: boolean): void {
    this.state = 'air';
    this.stateTime = 0;
    this.airTime = 0;
    const a = this.char.animator;
    if (jumped) a.play('jump_start', { fade: 0.08, onEnd: () => { if (this.state === 'air') a.play('fall', { fade: 0.15 }); } });
    else a.play('fall', { fade: 0.2 });
  }

  private landed(): void {
    const heavy = this.airTime > 0.9;
    this.heavyLanding = heavy;
    this.events.emit('land', { heavy });
    this.state = 'land';
    this.stateTime = 0;
    this.cancelOpen = !heavy;
    if (heavy) this.rig.shake(0.25);
    this.char.animator.play(heavy ? 'land_heavy' : 'land', {
      fade: 0.06,
      onEvent: (e) => this.onClipEvent(e),
      onEnd: () => this.toMove(),
    });
  }

  private heavyLanding = false;

  // -------------------------------------------------------------------------- lock-on
  private toggleLock(): void {
    if (this.target) {
      this.target = null;
      this.rig.lock = null;
      return;
    }
    const cand = this.world.targets(this, 22, this.rig.flatForward, 0.2);
    this.target = cand[0] ?? null;
  }

  private updateLockOn(): void {
    if (this.target && (!this.target.alive || Vector3.Distance(this.target.position, this.position) > 30)) {
      // switch to the next enemy if one is close, else drop the lock
      const next = this.world.targets(this, 14, this.rig.flatForward, -0.2).find((c) => c !== this.target);
      this.target = next ?? null;
    }
    if (this.target) {
      this.rig.lock = { position: this.target.position, height: this.target.height, radius: this.target.radius };
      const lx = this.input.look.x;
      if (Math.abs(lx) > 0.06) {
        // flick to switch targets left / right
        const side = Math.sign(lx);
        const r = this.rig.flatRight;
        const others = this.world.targets(this, 22).filter((c) => c !== this.target);
        let best: Combatant | null = null;
        let bestScore = Infinity;
        for (const o of others) {
          const d = o.position.subtract(this.target.position);
          const s = Vector3.Dot(d, r) * side;
          if (s > 0.5 && s < bestScore) {
            bestScore = s;
            best = o;
          }
        }
        if (best) this.target = best;
      }
    } else {
      this.rig.lock = null;
    }
  }

  // -------------------------------------------------------------------------- attacks
  private findExecution(): Combatant | null {
    const ahead = this.world.targets(this, 2.6, this.char.forward, 0.5);
    for (const c of ahead) {
      const e = c as Combatant & { executable?: boolean };
      if (e.executable) return c;
    }
    return null;
  }

  startAttack(id: string, victim?: Combatant): void {
    const def = ATTACKS[id];
    if (!def) return;
    if (def.stamina > 0 && !this.stats.spend(def.stamina * this.mods.staminaCost)) return;
    this.attack = def;
    this.state = 'attack';
    this.stateTime = 0;
    this.hitWindow = false;
    this.comboOpen = false;
    this.cancelOpen = false;
    this.queued = null;
    this.swingHits.clear();
    this.armour = !!def.armour;
    // snap towards the target (or the stick) at the start: attacks go where the player means
    this.warpTarget = null;
    if (victim) {
      const to = victim.position.subtract(this.position);
      this.char.yaw = Math.atan2(to.x, to.z);
      (victim as Combatant & { beginExecution?: (by: Combatant) => void }).beginExecution?.(this);
      this.warpTarget = victim;
    } else if (this.target && Vector3.Distance(this.target.position, this.position) < 7) {
      const to = this.target.position.subtract(this.position);
      this.char.yaw = Math.atan2(to.x, to.z);
      this.warpTarget = this.target;
    } else {
      const near = this.world.targets(this, 4.5, this.moveDir.lengthSquared() > 0.01 ? this.moveDir : this.char.forward, 0.3)[0];
      if (near) {
        const to = near.position.subtract(this.position);
        this.char.yaw = Math.atan2(to.x, to.z);
        this.warpTarget = near;
      } else if (this.moveDir.lengthSquared() > 0.01) {
        this.char.yaw = Math.atan2(this.moveDir.x, this.moveDir.z);
      }
    }
    this.warpReach = measureReach(this.char, def.clip, { socket: 'weapon_r', base: this.weapon.base, tip: this.weapon.tip });
    this.warpEnd = this.warpReach ? this.warpReach.hitOn / (id === 'charged' ? 0.9 : 1) : 0;
    this.char.face.set(def.weight > 0.6 ? 'effort' : 'determined', 1);
    this.char.animator.play(def.clip, {
      fade: id === 'light_1' || id === 'execution' ? 0.08 : 0.05,
      speed: id === 'charged' ? 0.9 : 1,
      onEvent: (e) => this.onClipEvent(e),
      onEnd: () => { if (this.state === 'attack' && this.attack === def) this.endAttack(); },
    });
    this.events.emit('attackStart', { attack: def });
  }

  private attackTick(dt: number): void {
    const inp = this.input;
    const def = this.attack!;
    // early in the swing the attack still tracks the target
    if (this.stateTime < 0.12) this.faceInput(dt, def.track);
    if (inp.buffered('light', 0.4)) this.queued = 'light';
    if (inp.buffered('heavy', 0.4)) this.queued = 'heavy';
    if (this.comboOpen && this.queued) {
      const next = this.queued === 'light' ? def.nextLight : def.nextHeavy;
      inp.consume('light');
      inp.consume('heavy');
      this.queued = null;
      if (next) return this.startAttack(next);
    }
    // dodge cancels: before the swing connects (feint) or once the recovery begins
    if (inp.pressed('dodge') && (this.cancelOpen || this.stateTime < 0.08)) return this.dodge();
    if (this.cancelOpen && inp.held('block')) return this.toMove();
  }

  /**
   * Velocity that brings the chosen target to the distance this swing actually reaches by the time
   * it lands (limited, so it reads as commitment rather than sliding).
   */
  private attackWarp(dt: number): Vector3 {
    const t = this.warpTarget;
    const r = this.warpReach;
    if (this.state !== 'attack' || !t || !t.alive || !r || this.stateTime >= this.warpEnd) return Vector3.Zero();
    const to = t.position.subtract(this.position);
    to.y = 0;
    const d = to.length();
    if (d < 1e-3 || d > 4.5) return Vector3.Zero();
    const ideal = Math.max(this.radius + t.radius + 0.1, r.contact + t.radius * 0.5 - 0.1);
    const left = Math.max(dt, this.warpEnd - this.stateTime);
    const v = Math.max(-1.2, Math.min(4, (d - ideal) / left));
    return to.scaleInPlace(v / d);
  }

  private endAttack(): void {
    this.attack = null;
    this.armour = false;
    this.hitWindow = false;
    this.lastAttackEnd = this.time;
    this.toMove();
  }

  private onClipEvent(e: ClipEvent): void {
    switch (e.name) {
      case 'hit_on':
        this.hitWindow = true;
        this.bladePrev = null;
        if (this.attack) this.events.emit('swing', { attack: this.attack });
        break;
      case 'hit_off':
        this.hitWindow = false;
        break;
      case 'combo':
        this.comboOpen = true;
        break;
      case 'cancel':
        this.cancelOpen = true;
        break;
      case 'end':
        if (this.state === 'attack') this.endAttack();
        else if (this.state === 'dodge' || this.state === 'hitstun' || this.state === 'land' || this.state === 'cast' || this.state === 'heal' || this.state === 'getup') this.toMove();
        break;
      case 'iframes_on':
        this.iframes = 0.3;
        this.iframesStart = this.time;
        break;
      case 'iframes_off':
        this.iframes = 0;
        break;
      case 'impact':
        if (this.attack) {
          const radius = this.attack.impactRadius ?? 0;
          const tip = this.bladeWorld().tip;
          if (radius > 0) this.areaImpact(tip, radius);
          this.rig.shake(Number((e as { shake?: number }).shake ?? 0.3));
          this.events.emit('impact', { attack: this.attack, point: tip, radius });
        }
        break;
      case 'foot':
        break;
      case 'release':
      case 'channel': {
        const slot = this.currentAbility;
        if (slot) {
          if (e.name === 'release') slot.onRelease(this);
          else slot.onChannel?.(this);
          this.events.emit('ability', { name: slot.name, phase: e.name });
        }
        break;
      }
      case 'heal':
        this.stats.heal(this.stats.maxHealth * this.flaskHeal);
        this.events.emit('heal', {});
        break;
      case 'parry_on':
        this.parryUntil = this.time + this.mods.parryWindow;
        break;
      default:
        break;
    }
  }

  bladeWorld(): { base: Vector3; tip: Vector3 } {
    const s = this.char.socket('weapon_r');
    s.computeWorldMatrix(true);
    const m = s.getWorldMatrix();
    const base = Vector3.TransformCoordinates(new Vector3(0, this.weapon.base, 0), m);
    const tip = Vector3.TransformCoordinates(new Vector3(0, this.weapon.tip, 0), m);
    return { base, tip };
  }

  private updateWeapon(): void {
    if (!this.hitWindow || !this.attack) {
      this.bladePrev = null;
      return;
    }
    const now = this.bladeWorld();
    const prev = this.bladePrev ?? now;
    const def = this.attack;
    const hits = this.world.sweep(this, prev.base, prev.tip, now.base, now.tip, this.weapon.radius, this.swingHits, (victim, point) => this.makeDamage(def, victim, point));
    for (const h of hits) this.onHitLanded(h);
    this.bladePrev = { base: now.base.clone(), tip: now.tip.clone() };
  }

  private makeDamage(def: AttackDef, victim: Combatant, point: Vector3): DamageInfo {
    const dir = victim.position.subtract(this.position);
    dir.y = 0;
    dir.normalize();
    const charge = def.id === 'charged' ? 1 : 0;
    return {
      amount: def.damage * this.mods.damage * (0.9 + Math.random() * 0.2),
      poise: def.poise * this.mods.poiseDamage,
      element: def.element ?? 'physical',
      direction: dir,
      point,
      source: this,
      weight: def.weight,
      knockback: def.knockback,
      launch: def.launch,
      knockdown: def.knockdown || charge > 0,
      parryable: false,
      critical: def.id === 'riposte' || def.id === 'execution',
    };
  }

  private areaImpact(center: Vector3, radius: number): void {
    const def = this.attack!;
    const hits = this.world.area(this, this.team, center, radius, this.swingHits, (victim) => this.makeDamage({ ...def, damage: def.damage * 0.6 }, victim, victim.position));
    for (const h of hits) this.onHitLanded(h);
  }

  private onHitLanded(h: HitEvent): void {
    const def = this.attack;
    if (h.result === 'hit' || h.result === 'staggered' || h.result === 'killed' || h.result === 'guardbreak') {
      this.stats.gainAether((def?.aether ?? 4) * this.mods.aetherGain);
      if (h.info.critical && this.mods.executionHeal > 0) this.stats.heal(this.stats.maxHealth * this.mods.executionHeal);
      this.clock.hitStop(0.035 + 0.075 * h.info.weight);
      this.rig.shake(0.08 + 0.25 * h.info.weight);
      this.input.rumble(0.2 + 0.5 * h.info.weight, 0.4, 80 + 120 * h.info.weight);
    } else if (h.result === 'blocked') {
      this.clock.hitStop(0.05);
      this.rig.shake(0.1);
    }
    this.events.emit('hitLanded', h);
  }

  // -------------------------------------------------------------------------- defence and movement actions
  private dodge(): void {
    const roll = this.moveDir.lengthSquared() > 0.01 && this.target === null;
    if (!this.stats.spend((roll ? 22 : 18) * this.mods.staminaCost)) return;
    // direction relative to facing picks the clip; free-roaming turns into the stick
    let clip = 'dodge_b';
    let dir = 'back';
    if (this.moveDir.lengthSquared() > 0.01) {
      if (this.target) {
        const yaw = this.char.yaw;
        const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const rgt = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        const fx = Vector3.Dot(this.moveDir, fwd);
        const rx = Vector3.Dot(this.moveDir, rgt);
        if (Math.abs(fx) >= Math.abs(rx)) {
          clip = fx > 0 ? 'dodge_f' : 'dodge_b';
          dir = fx > 0 ? 'fwd' : 'back';
        } else {
          clip = rx > 0 ? 'dodge_r' : 'dodge_l';
          dir = rx > 0 ? 'right' : 'left';
        }
      } else {
        this.char.yaw = Math.atan2(this.moveDir.x, this.moveDir.z);
        clip = 'roll';
        dir = 'roll';
      }
    }
    this.state = 'dodge';
    this.stateTime = 0;
    this.cancelOpen = false;
    this.attack = null;
    this.hitWindow = false;
    this.armour = false;
    this.char.animator.play(clip, { fade: 0.05, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'dodge') this.toMove(); } });
    this.events.emit('dodge', { dir });
  }

  private drinkFlask(): void {
    if (this.flasks <= 0 || this.stats.health >= this.stats.maxHealth) return;
    this.flasks--;
    this.state = 'heal';
    this.stateTime = 0;
    this.cancelOpen = false;
    this.char.animator.play('drink', { fade: 0.1, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'heal') this.toMove(); } });
  }

  private currentAbility: AbilitySlot | null = null;

  /** Game time (cooldowns are measured against it). */
  get now(): number {
    return this.time;
  }

  private useAbility(slot: AbilitySlot | null): void {
    if (!slot || this.time < slot.ready) return;
    if (!this.stats.useAether(slot.cost * this.mods.abilityCost)) return;
    slot.ready = this.time + slot.cooldown;
    this.currentAbility = slot;
    this.state = 'cast';
    this.stateTime = 0;
    this.cancelOpen = false;
    this.char.face.set('effort', 1);
    if (this.target) {
      const to = this.target.position.subtract(this.position);
      this.char.yaw = Math.atan2(to.x, to.z);
    }
    this.char.animator.play(slot.clip, { fade: 0.08, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'cast') this.toMove(); } });
    slot.instant?.(this);
  }

  toMove(): void {
    if (!this.alive) return;
    this.state = this.grounded ? 'move' : 'air';
    this.stateTime = 0;
    this.attack = null;
    this.hitWindow = false;
    this.armour = false;
    this.cancelOpen = false;
    this.comboOpen = false;
    this.char.animator.stopAction(0.22);
    this.char.face.set('neutral');
    if (this.input.held('block') && this.state === 'move') {
      this.state = 'block';
      this.char.animator.play('block_idle', { fade: 0.12 });
    }
  }

  // -------------------------------------------------------------------------- statuses
  private updateStatus(dt: number): void {
    for (const k of ['burn', 'soak', 'shock', 'root'] as const) {
      this.statusBuild[k] = Math.max(0, this.statusBuild[k] - 12 * dt);
      if (this.statusTime[k] > 0) this.statusTime[k] = Math.max(0, this.statusTime[k] - dt);
    }
    if (this.statusTime.burn > 0 && this.alive) {
      this.stats.health = Math.max(1, this.stats.health - 6 * dt);
      this.burnTick -= dt;
      if (this.burnTick <= 0) {
        this.burnTick = 0.35;
        this.events.emit('statusTick', { status: 'burn' });
      }
    }
  }

  private buildStatus(st: NonNullable<DamageInfo['status']>): void {
    const dur = { burn: 4, soak: 7, shock: 1.2, root: 1.5 };
    for (const k of ['burn', 'soak', 'shock', 'root'] as const) {
      const v = st[k];
      if (!v) continue;
      // water puts fire out and fire dries you off
      if (k === 'soak') this.statusTime.burn = 0;
      if (k === 'burn' && this.statusTime.soak > 0) continue;
      this.statusBuild[k] += v;
      if (this.statusBuild[k] >= 100) {
        this.statusBuild[k] = 0;
        this.statusTime[k] = dur[k];
        this.events.emit('status', { status: k });
      }
    }
  }

  // -------------------------------------------------------------------------- being hit
  receive(hit: DamageInfo, _part: HurtCapsule | null): HitResult {
    if (!this.alive || this.state === 'cinematic') return 'immune';
    const fromFront = Vector3.Dot(hit.direction.scale(-1), this.char.forward) > 0.2;
    if (this.iframes > 0) {
      if (this.time - this.iframesStart < 0.12) {
        this.clock.slowMotion(0.6, 0.25);
        this.events.emit('perfectDodge', {});
        this.stats.gainAether(10 * this.mods.aetherGain);
      }
      return 'dodged';
    }
    if (this.state === 'parry' && this.time <= this.parryUntil && hit.parryable && fromFront && !hit.unblockable) {
      this.stats.gainAether(14 * this.mods.aetherGain);
      this.clock.hitStop(0.12);
      this.clock.slowMotion(0.35, 0.35);
      this.rig.shake(0.2);
      this.events.emit('parry', { attacker: hit.source });
      // open a riposte: the next light press within a moment counter-attacks
      this.state = 'move';
      this.input.consume('light');
      this.ripostePending = hit.source;
      this.riposteUntil = this.time + 0.9;
      return 'parried';
    }
    if ((this.state === 'block' || this.state === 'blockHit' || this.state === 'parry') && fromFront && !hit.unblockable) {
      this.stats.drain(hit.amount * 0.55 + hit.poise * 0.4);
      const chip = hit.element === 'physical' ? 0 : hit.amount * 0.15;
      this.stats.damage(chip);
      if (this.stats.stamina <= 0) {
        this.state = 'stagger';
        this.stateTime = 0;
        this.char.animator.play('guard_break', { fade: 0.05, onEnd: () => this.toMove() });
        this.events.emit('hurt', { info: hit, result: 'guardbreak' });
        return 'guardbreak';
      }
      this.state = 'blockHit';
      this.char.animator.play('block_hit', { fade: 0.04, onEnd: () => { if (this.state === 'blockHit') this.char.animator.play('block_idle', { fade: 0.1 }); this.state = 'block'; } });
      this.events.emit('hurt', { info: hit, result: 'blocked' });
      return 'blocked';
    }
    // a hit lands
    if (this.statusTime.soak > 0) {
      if (hit.element === 'fire') hit.amount *= 0.6;
      if (hit.element === 'lightning') hit.amount *= 1.5;
    }
    if (this.wardHp > 0) {
      const absorbed = Math.min(this.wardHp, hit.amount);
      this.wardHp -= absorbed;
      hit.amount -= absorbed;
      this.events.emit('wardHit', { left: this.wardHp });
      if (hit.amount <= 0) return 'blocked';
    }
    if (hit.status) this.buildStatus(hit.status);
    this.stats.damage(hit.amount);
    this.rig.shake(0.18 + hit.weight * 0.4);
    this.input.rumble(0.6, 0.6, 160);
    this.char.face.set('pain', 1);
    if (!this.stats.alive) {
      this.kill();
      this.events.emit('hurt', { info: hit, result: 'killed' });
      return 'killed';
    }
    const broke = this.stats.poiseDamage(hit.poise * (1 - this.mods.flinchResist));
    this.attack = null;
    this.hitWindow = false;
    if (hit.knockdown || hit.launch) {
      this.knockdown(hit.direction);
    } else if (broke) {
      this.state = 'stagger';
      this.stateTime = 0;
      this.char.yaw = Math.atan2(-hit.direction.x, -hit.direction.z);
      this.char.animator.play('stagger', { fade: 0.05, onEvent: (e) => this.onClipEvent(e), onEnd: () => this.toMove() });
      this.stats.resetPoise();
    } else if (!this.armour || hit.weight > 0.7) {
      const yaw = this.char.yaw;
      const local = new Vector3(Math.cos(yaw) * hit.direction.x - Math.sin(yaw) * hit.direction.z, 0, Math.sin(yaw) * hit.direction.x + Math.cos(yaw) * hit.direction.z);
      const clip = Math.abs(local.z) > Math.abs(local.x) ? (local.z > 0 ? 'hit_back' : 'hit_front') : (local.x > 0 ? 'hit_left' : 'hit_right');
      this.state = 'hitstun';
      this.stateTime = 0;
      this.cancelOpen = false;
      this.char.animator.play(clip, { fade: 0.04, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'hitstun') this.toMove(); } });
    }
    this.events.emit('hurt', { info: hit, result: broke ? 'staggered' : 'hit' });
    return broke ? 'staggered' : 'hit';
  }

  ripostePending: Combatant | null = null;
  private riposteUntil = 0;

  private knockdown(dir: Vector3): void {
    this.state = 'knockdown';
    this.stateTime = 0;
    this.char.yaw = Math.atan2(-dir.x, -dir.z);
    this.char.animator.play('knockdown', {
      fade: 0.05,
      onEnd: () => {
        if (!this.alive) return;
        this.state = 'getup';
        this.iframes = 0.9;
        this.char.animator.play('getup', { fade: 0.15, onEvent: (e) => this.onClipEvent(e), onEnd: () => this.toMove() });
      },
    });
  }

  kill(): void {
    if (this.state === 'dead') return;
    this.stats.health = 0;
    this.state = 'dead';
    this.target = null;
    this.rig.lock = null;
    this.char.face.set('dead');
    this.char.animator.play('death', { fade: 0.1 });
    this.events.emit('death', {});
  }

  /** Back on your feet at a checkpoint. */
  revive(): void {
    this.stats.health = this.stats.maxHealth;
    this.stats.stamina = this.stats.maxStamina;
    this.stats.resetPoise();
    this.flasks = this.maxFlasks;
    this.state = 'move';
    this.char.face.set('neutral');
    this.char.animator.stopAction(0);
  }

  private footsteps(): void {
    // footstep events come from the locomotion phase; emit on foot plants by speed
    const speed = this.char.animator.locoSpeed;
    if (this.state !== 'move' || speed < 0.4) return;
    const period = speed > 6 ? 0.3 : speed > 3 ? 0.34 : 0.5;
    if (this.time - this.lastFoot >= period) {
      this.lastFoot = this.time;
      this.events.emit('footstep', { side: 'l', position: this.position.clone() });
    }
  }

  /** Called when the parry window opens a riposte and the player presses light. */
  tryRiposte(): boolean {
    if (!this.ripostePending || !this.input.buffered('light', 0.3)) return false;
    this.input.consume('light');
    const v = this.ripostePending;
    this.ripostePending = null;
    this.startAttack('riposte', v);
    return true;
  }

  dispose(): void {
    this.world.remove(this);
    this.ctrl.dispose();
  }

  get lastAttackAgo(): number {
    return this.time - this.lastAttackEnd;
  }

  /** The blade is live (between an attack's hit_on and hit_off). */
  get swinging(): boolean {
    return this.hitWindow && this.state === 'attack';
  }

  /** Current planar velocity (AI leads its spells with it). */
  get velocity(): Vector3 {
    return this.vel;
  }

  get sprint(): boolean {
    return this.sprinting;
  }

  /** Stamina, health etc. for the HUD. */
  get vitals(): Stats {
    return this.stats;
  }

  /** Tmp accessor avoids unused warnings for helper vectors in some builds. */
  protected get scratch(): Vector3 {
    return this.tmp;
  }
}
