import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { buildCharacter, CharacterRig } from '../character/CharacterBuilder';
import { Animator, AnimInput, defaultAnimInput } from '../character/Animator';
import { Appearance } from '../character/Appearance';
import { ClipName, CLIP_TIMING } from '../character/Clips';
import { angleDiff, approachAngle, clamp, clamp01, damp, dampAngle, lerp, rng, solveBallisticLow } from '../core/math';
import { blobTexture, ringTexture } from '../rendering/Textures';
import type { Ball } from './Ball';
import { Attributes, DerivedStats, deriveStats, Perks } from './Stats';
import type { TeamId, ThrowInfo, ThrowKind } from './types';
import type { World } from './World';

export type AthleteState =
  | 'free'
  | 'charging'
  | 'throwing'
  | 'catching'
  | 'catchRecover'
  | 'whiff'
  | 'blocking'
  | 'dodging'
  | 'hitstun'
  | 'stagger'
  | 'knockdown'
  | 'out'
  | 'passing'
  | 'fake'
  | 'power'
  | 'ultimate'
  | 'celebrate'
  | 'scripted';

export type PersonalityId = 'aggressor' | 'defender' | 'sniper' | 'speedster' | 'powerhouse' | 'tactician' | 'balanced' | 'boss' | 'dummy';

export interface AthleteProfile {
  id: string;
  name: string;
  title?: string;
  number?: number;
  appearance: Appearance;
  attributes: Attributes;
  perks: Perks;
  baseHearts: number;
  personality: PersonalityId;
  /** 0 (dummy) .. 6 (boss) — drives AI reaction/decision quality. */
  tier: number;
  boss?: boolean;
  /** Ability the athlete can trigger (AI or player loadout). */
  ability?: string | null;
  ultimate?: string | null;
}

export interface Controller {
  update(dt: number): void;
  onEvent?(type: string, data: unknown): void;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A dodgeball player (human or AI). Controllers only set intents and call
 * the action methods; all rules/timings are enforced here so AI and player are
 * bound by exactly the same mechanics.
 */
export class Athlete {
  private static nextId = 1;
  readonly id = Athlete.nextId++;
  readonly profile: AthleteProfile;
  readonly team: TeamId;
  isPlayer = false;
  stats: DerivedStats;
  perks: Perks;
  readonly rig: CharacterRig;
  readonly anim: Animator;
  controller: Controller | null = null;
  world!: World;

  // kinematics
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  yaw = 0;
  y = 0; // vertical offset (jumps)
  vy = 0;

  // intents
  readonly move = new THREE.Vector3();
  wantSprint = false;
  faceYaw: number | null = null;
  readonly aimPoint = new THREE.Vector3();
  aimTarget: Athlete | null = null;
  aimPitch = 0;
  curveInput = 0;

  // state
  state: AthleteState = 'free';
  stateTime = 0;
  hearts = 2;
  maxHearts = 2;
  ball: Ball | null = null;
  charge = 0;
  chargeHeld = 0;
  fullTime = -1;
  private releaseAt = -1;
  private releaseKind: ThrowKind = 'charged';
  private recoverAt = 0;
  catchStart = 0;
  catchCooldown = 0;
  dodgeCharges = 2;
  dodgeRecharge = 0;
  readonly dodgeDir = new THREE.Vector3();
  private dodgeSpeed0 = 0;
  perfectDodgeUsed = false;
  stamina = 100;
  staminaDelay = 0;
  sprinting = false;
  energy = 0;
  ult = 0;
  invuln = 0;
  counterTimer = 0;
  /** Power shot armed via ability. */
  powerArmed = false;
  phantomArmed = false;
  passTarget: Athlete | null = null;
  pickupFlash = 0;
  private pickupLerp = 1;
  private readonly pickupFrom = new THREE.Vector3();
  dissolve = 0;
  private dissolveTarget = 0;
  private dissolveSpeed = 1.5;
  private dissolveDone: (() => void) | null = null;
  benchSpot: THREE.Vector3 | null = null;
  benchYaw = 0;
  hitFlash = 0;
  lastHitBy: Athlete | null = null;
  lastThrowTime = -10;
  /** Seconds since a threat was visible — used by HUD & AI. */
  readonly animIn: AnimInput = defaultAnimInput();
  private accLocal = new THREE.Vector2();
  readonly ring: THREE.Mesh;
  readonly blob: THREE.Mesh;
  stats_: { hits: number; catches: number; perfectCatches: number; throws: number; kos: number; dodges: number; perfectDodges: number; timesHit: number } = {
    hits: 0, catches: 0, perfectCatches: 0, throws: 0, kos: 0, dodges: 0, perfectDodges: 0, timesHit: 0,
  };
  isOut = false;
  /** Controllers can opt out of auto-pickup (e.g. AI deliberately leaving a ball). */
  wantsPickup = true;

  constructor(profile: AthleteProfile, team: TeamId) {
    this.profile = profile;
    this.team = team;
    this.perks = { ...profile.perks };
    this.stats = deriveStats(profile.attributes, this.perks, profile.baseHearts);
    this.rig = buildCharacter(profile.appearance);
    this.anim = new Animator(this.rig);
    this.anim.onFootstep = (_side, intensity) => this.world?.events.emit('footstep', { athlete: this, intensity });
    this.maxHearts = this.hearts = this.stats.maxHearts;
    this.dodgeCharges = this.stats.dodgeCharges;
    this.stamina = this.stats.staminaMax;

    this.blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0x000000 }),
    );
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.renderOrder = 1;
    this.ring = new THREE.Mesh(
      new THREE.PlaneGeometry(1.25, 1.25),
      new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, opacity: 0.55, color: 0xffffff, blending: THREE.AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 2;
  }

  get name() {
    return this.profile.name;
  }

  setAttributes(a: Attributes, perks: Perks) {
    this.perks = { ...perks };
    this.stats = deriveStats(a, this.perks, this.profile.baseHearts);
    this.maxHearts = this.stats.maxHearts;
  }

  addToScene(scene: THREE.Scene) {
    scene.add(this.rig.root);
    scene.add(this.blob);
    scene.add(this.ring);
  }

  removeFromScene(scene: THREE.Scene) {
    scene.remove(this.rig.root);
    scene.remove(this.blob);
    scene.remove(this.ring);
  }

  // ------------------------------------------------------------------ queries
  get active() {
    return !this.isOut && this.state !== 'knockdown' && this.state !== 'out';
  }
  get canAct() {
    return this.active && this.state !== 'hitstun' && this.state !== 'stagger' && this.state !== 'ultimate' && this.state !== 'scripted' && this.state !== 'celebrate';
  }
  get forward() {
    return _v2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  forwardVec(out: THREE.Vector3) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  chestPos(out: THREE.Vector3) {
    return out.set(this.pos.x, this.pos.y + this.y + TUNING.athlete.chestHeight * this.rig.height - (this.state === 'dodging' ? 0.18 : 0), this.pos.z);
  }
  handPos(out: THREE.Vector3) {
    return this.rig.sockets.handR.getWorldPosition(out);
  }
  get isIFrame() {
    if (this.invuln > 0 && this.state !== 'hitstun') return false;
    if (this.state !== 'dodging') return false;
    return this.stateTime >= TUNING.dodge.iframeStart && this.stateTime <= this.stats.iframeEnd;
  }
  /** Visible "threat" signal that opponents can read (winding up). */
  get isWindingUp() {
    return this.state === 'charging' || this.state === 'power' || (this.state === 'throwing' && this.releaseAt >= 0) || this.state === 'fake' || this.state === 'ultimate';
  }
  get vulnerable() {
    return this.state === 'throwing' || this.state === 'whiff' || this.state === 'hitstun' || this.state === 'passing' || this.state === 'stagger';
  }

  private setState(s: AthleteState) {
    this.state = s;
    this.stateTime = 0;
  }

  // ------------------------------------------------------------------ actions
  startCharge(): boolean {
    if (!this.ball || !this.canAct) return false;
    if (!(this.state === 'free' || this.state === 'catchRecover' || (this.state === 'dodging' && this.perks.slideThrow))) return false;
    if (this.pickupLerp < 0.6) return false;
    const fromDodge = this.state === 'dodging';
    this.setState(this.powerArmed ? 'power' : 'charging');
    this.charge = this.counterTimer > 0 ? 1 : 0;
    this.chargeHeld = 0;
    this.fullTime = this.counterTimer > 0 ? 0 : -1;
    this.anim.play(this.powerArmed ? 'powerCharge' : 'charge', { fade: fromDodge ? 0.05 : 0.1, manual: true, hold: true, legs: 0.35 });
    this.world.events.emit('chargeStart', { athlete: this });
    return true;
  }

  /** Release the throw toward aimPoint. */
  releaseCharge(): boolean {
    if (this.state !== 'charging' && this.state !== 'power') return false;
    const power = this.state === 'power';
    if (power && this.stateTime < 0.3) {
      // power shots need their gather time; queue release
      this.releaseQueued = true;
      return true;
    }
    const quick = !power && this.chargeHeld < TUNING.throw.quickThreshold && this.counterTimer <= 0;
    this.releaseKind = power ? 'power' : quick ? 'quick' : 'charged';
    this.setState('throwing');
    const clip: ClipName = power ? 'powerThrow' : 'throw';
    this.anim.play(clip, { fade: quick ? 0.06 : 0.04, legs: this.vel.lengthSq() > 1 ? 0.2 : 0.85, speed: quick ? 1.25 : 1 });
    this.releaseAt = (power ? CLIP_TIMING.powerThrowRelease : CLIP_TIMING.throwRelease) / (quick ? 1.25 : 1);
    this.recoverAt = this.releaseAt + TUNING.throw.recover * (quick ? 0.8 : 1);
    return true;
  }
  private releaseQueued = false;

  cancelCharge(asFake: boolean) {
    if (this.state !== 'charging') return;
    if (asFake && this.perks.fake) {
      this.setState('fake');
      this.anim.play('fake', { fade: 0.06, time: 0.12, legs: 0.3 });
      this.world.events.emit('fake', { athlete: this });
    } else {
      this.setState('free');
      this.anim.stop(0.15);
    }
    this.charge = 0;
  }

  startCatch(): boolean {
    if (!this.canAct || this.catchCooldown > 0) return false;
    if (this.ball) return this.startBlock();
    if (!(this.state === 'free' || this.state === 'dodging' && this.stateTime > 0.18)) return false;
    this.setState('catching');
    this.catchStart = this.world.time.gameTime;
    this.anim.play('catchReady', { fade: 0.05, hold: true, legs: 0.5 });
    return true;
  }

  startBlock(): boolean {
    if (!this.ball || !this.perks.deflect) return false;
    if (this.state !== 'free' && this.state !== 'charging') return false;
    this.setState('blocking');
    this.catchStart = this.world.time.gameTime;
    this.charge = 0;
    this.anim.play('block', { fade: 0.05, hold: true, legs: 0.4 });
    return true;
  }

  endBlock() {
    if (this.state === 'blocking') {
      this.setState('free');
      this.anim.stop(0.12);
      this.catchCooldown = 0.25;
    }
  }

  dodge(dirWorld: THREE.Vector3): boolean {
    if (!this.canAct || this.dodgeCharges < 1) return false;
    const ok = this.state === 'free' || this.state === 'charging' || this.state === 'catching' || this.state === 'catchRecover' || this.state === 'blocking' || this.state === 'fake' ||
      (this.state === 'throwing' && this.releaseAt < 0) || this.state === 'whiff' && this.stateTime > 0.15 || (this.state === 'dodging' && this.stateTime > 0.2);
    if (!ok) return false;
    if (this.state === 'charging') this.charge = 0;
    this.dodgeCharges -= 1;
    if (this.dodgeRecharge <= 0) this.dodgeRecharge = this.stats.dodgeRecharge;
    const d = _v.copy(dirWorld).setY(0);
    if (d.lengthSq() < 0.01) {
      // default: sidestep to the right of facing
      d.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    }
    d.normalize();
    this.dodgeDir.copy(d);
    const k = 1.35;
    this.dodgeSpeed0 = (this.stats.dodgeDistance * (k + 1)) / TUNING.dodge.duration;
    this.setState('dodging');
    this.perfectDodgeUsed = false;
    // choose clip from local direction
    const lx = d.x * Math.cos(this.yaw) - d.z * Math.sin(this.yaw);
    const lz = d.x * Math.sin(this.yaw) + d.z * Math.cos(this.yaw);
    let clip: ClipName;
    if (Math.abs(lx) > Math.abs(lz) * 0.8) clip = lx > 0 ? 'dodgeL' : 'dodgeR';
    else clip = lz > 0 ? 'dodgeForward' : 'dodgeBack';
    this.anim.play(clip, { fade: 0.05, legs: 1 });
    this.stats_.dodges++;
    this.world.events.emit('dodge', { athlete: this, dir: d.clone() });
    return true;
  }

  passTo(mate: Athlete): boolean {
    if (!this.ball || !this.canAct || !mate.active || mate.ball) return false;
    if (this.state !== 'free' && this.state !== 'catchRecover' && this.state !== 'charging') return false;
    this.passTarget = mate;
    this.setState('passing');
    this.anim.play('pass', { fade: 0.08, legs: 0.3 });
    this.releaseAt = CLIP_TIMING.passRelease;
    this.releaseKind = 'pass';
    this.recoverAt = 0.38;
    return true;
  }

  /** Upgrade an in-progress charge into a Power Shot wind-up. */
  convertToPower() {
    if (this.state !== 'charging') return;
    this.setState('power');
    this.anim.play('powerCharge', { fade: 0.08, manual: true, hold: true, legs: 0.35 });
  }

  beginUltimate() {
    if (this.state === 'charging' || this.state === 'power') this.charge = 0;
    this.setState('ultimate');
    this.vel.set(0, 0, 0);
    this.invuln = 4;
  }

  endUltimate() {
    if (this.state === 'ultimate') {
      this.setState('free');
      this.invuln = 0.4;
    }
  }

  /** Instant reposition used by Blink Step. */
  blinkTo(p: THREE.Vector3) {
    this.pos.copy(p);
    this.world.court.clampAthlete(this.pos, this.team);
    this.invuln = Math.max(this.invuln, 0.35);
  }

  addEnergy(v: number) {
    this.energy = clamp(this.energy + v * this.stats.energyGain, 0, TUNING.energy.max);
  }
  addUlt(v: number) {
    if (!this.profile.ultimate) return;
    this.ult = clamp(this.ult + v * (this.perks.overcharge ? 1.25 : 1), 0, TUNING.ult.max);
  }

  // ------------------------------------------------------------------ ball events
  grabBall(ball: Ball, fromFloor: boolean) {
    this.ball = ball;
    ball.state = 'held';
    ball.holder = this;
    ball.live = false;
    ball.info = null;
    ball.thrower = null;
    ball.ignore.clear();
    ball.lastTeam = this.team;
    ball.vel.set(0, 0, 0);
    ball.angVel.set(0, 0, 0);
    this.pickupFrom.copy(ball.pos);
    this.pickupLerp = fromFloor ? 0 : 0.7;
    if (fromFloor && this.state === 'free') this.anim.play('pickup', { fade: 0.06, legs: this.vel.lengthSq() > 4 ? 0.15 : 0.7, speed: 1.3 });
    this.pickupFlash = 1;
    this.world.events.emit('pickup', { athlete: this, ball });
  }

  dropBall(pop = 2.5) {
    const b = this.ball;
    if (!b) return;
    this.ball = null;
    b.setLoose();
    b.holder = null;
    b.vel.set(rng.range(-1, 1), pop, rng.range(-1, 1));
    b.noPickupTimer = 0.25;
    b.grounded = false;
  }

  /** Called by BallSystem when a live ball reaches this athlete's catch zone. */
  resolveCatch(ball: Ball): 'catch' | 'perfect' | 'fumble' | 'none' {
    if (this.state !== 'catching') return 'none';
    const dtIn = this.world.time.gameTime - this.catchStart;
    if (dtIn > this.stats.catchWindow) return 'none';
    const inc = _v.copy(ball.vel).setY(0).normalize().negate();
    const f = this.forwardVec(_v2);
    if (inc.dot(f) < TUNING.catch.frontDot) return 'none';
    const perfect = this.perks.perfectCatch && dtIn <= this.stats.perfectWindow;
    const info = ball.info;
    const kind = info?.kind;
    if (kind === 'ultimate' && !perfect) return 'none';
    const heavy = info ? info.power > this.stats.catchStrength || (info.heavy && !this.perks.ironHands) : false;
    if (heavy && !perfect) return 'fumble';
    return perfect ? 'perfect' : 'catch';
  }

  onCaught(ball: Ball, perfect: boolean) {
    this.grabBall(ball, false);
    this.pickupLerp = 1;
    this.setState('catchRecover');
    this.anim.play(perfect ? 'catchPerfect' : 'catch', { fade: 0.03, legs: 0.6 });
    this.anim.flinch(0, 1, perfect ? 0.25 : 0.4);
    this.catchCooldown = 0.2;
    this.stats_.catches++;
    if (perfect) {
      this.stats_.perfectCatches++;
      this.addEnergy(TUNING.energy.perfectCatch);
      this.addUlt(TUNING.ult.perfectCatch);
      this.stamina = this.stats.staminaMax;
      if (this.perks.counterThrow) this.counterTimer = TUNING.catch.counterDuration;
    } else {
      this.addEnergy(TUNING.energy.catch);
      this.addUlt(TUNING.ult.catch);
    }
    // catching absorbs momentum
    const push = _v.copy(ball.vel).setY(0).normalize().multiplyScalar(perfect ? 0.8 : 1.6);
    this.vel.add(push);
  }

  onFumble(ball: Ball) {
    this.setState('stagger');
    this.anim.play('stagger', { fade: 0.05 });
    const push = _v.copy(ball.vel).setY(0).normalize().multiplyScalar(3);
    this.vel.add(push);
    this.catchCooldown = 0.5;
  }

  onWhiff() {
    this.setState('whiff');
    this.anim.stop(0.2);
    this.catchCooldown = TUNING.catch.whiffRecover;
    this.world.events.emit('whiff', { athlete: this });
  }

  /** Called by BallSystem for a damaging contact. Returns true if damage applied. */
  takeHit(ball: Ball, point: THREE.Vector3): boolean {
    const info = ball.info;
    const dir = _v.copy(ball.vel).setY(0);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, this.team === 0 ? 1 : -1);
    dir.normalize();
    const thrower = ball.thrower;
    if (this.invuln > 0) {
      this.world.events.emit('bounce', { ball, surface: 'athlete', speed: ball.speed, point: point.clone(), normal: dir.clone().negate() });
      return false;
    }
    const damage = info?.damage ?? 1;
    this.hearts = Math.max(0, this.hearts - damage);
    this.lastHitBy = thrower;
    this.stats_.timesHit++;
    this.hitFlash = 1;
    this.invuln = TUNING.damage.invulnAfterHit;
    this.addEnergy(TUNING.energy.gotHit);
    this.addUlt(TUNING.ult.gotHit);
    if (this.ball) this.dropBall(3);
    if (this.state === 'charging' || this.state === 'power') this.charge = 0;
    this.powerArmed = false;
    const ko = this.hearts <= 0;
    const kb = (info && info.power >= 1.4 ? TUNING.damage.powerKnockback : TUNING.damage.knockback) * (ko ? 1.2 : 1);
    this.vel.copy(dir).multiplyScalar(kb);
    // local direction the ball came from
    const lx = -dir.x * Math.cos(this.yaw) + dir.z * Math.sin(this.yaw);
    const lz = -(dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw));
    this.anim.flinch(lx, lz, 1.2);
    this.world.events.emit('hit', { victim: this, thrower, ball, damage, ko, point: point.clone(), dir: dir.clone(), power: info?.power ?? 1 });
    if (thrower) {
      thrower.stats_.hits++;
      thrower.addEnergy(TUNING.energy.hit);
      thrower.addUlt(TUNING.ult.hit);
    }
    if (ko) this.knockOut(thrower);
    else {
      this.setState('hitstun');
      this.anim.play(lz > 0 ? 'hitFront' : 'hitBack', { fade: 0.04 });
    }
    return true;
  }

  knockOut(by: Athlete | null) {
    this.hearts = 0;
    this.setState('knockdown');
    this.anim.play('knockdown', { fade: 0.06, hold: true });
    this.counterTimer = 0;
    if (by) {
      by.stats_.kos++;
      by.addUlt(TUNING.ult.ko);
    }
    this.world.events.emit('ko', { athlete: this, by });
  }

  stagger(dir: THREE.Vector3, strength = 1) {
    if (!this.active || this.state === 'dodging' || this.state === 'ultimate') return;
    if (this.state === 'charging' || this.state === 'power') this.charge = 0;
    this.setState('stagger');
    this.anim.play('stagger', { fade: 0.05 });
    this.vel.copy(dir).setY(0).normalize().multiplyScalar(3.5 * strength);
    if (this.ball && strength > 0.8) this.dropBall(3);
  }

  onPerfectDodge(ball: Ball) {
    if (this.perfectDodgeUsed || !this.perks.perfectDodge) return;
    this.perfectDodgeUsed = true;
    this.stats_.perfectDodges++;
    this.dodgeCharges = Math.min(this.stats.dodgeCharges, this.dodgeCharges + 1);
    this.addEnergy(TUNING.energy.perfectDodge);
    this.addUlt(TUNING.ult.perfectDodge);
    this.world.events.emit('perfectDodge', { athlete: this, ball });
  }

  // ------------------------------------------------------------------ bench/revive
  sendToBench(spot: THREE.Vector3, yaw: number) {
    this.benchSpot = spot.clone();
    this.benchYaw = yaw;
    this.fadeOut(1.6, () => {
      this.isOut = true;
      this.setState('out');
      this.pos.copy(spot);
      this.vel.set(0, 0, 0);
      this.yaw = yaw;
      this.anim.play('sit', { fade: 0 });
      this.fadeIn(2);
    });
  }

  revive(at: THREE.Vector3, yawFacing: number) {
    this.fadeOut(3, () => {
      this.isOut = false;
      this.hearts = 1;
      this.pos.copy(at);
      this.vel.set(0, 0, 0);
      this.yaw = yawFacing;
      this.setState('free');
      this.anim.stop(0);
      this.invuln = 1.2;
      this.fadeIn(2.5);
      this.world.events.emit('revive', { athlete: this });
    });
  }

  fadeOut(speed: number, done: () => void) {
    this.dissolveTarget = 1;
    this.dissolveSpeed = speed;
    this.dissolveDone = done;
  }
  fadeIn(speed: number) {
    this.dissolveTarget = 0;
    this.dissolveSpeed = speed;
    this.dissolveDone = null;
  }

  /** Full reset for a new round. */
  resetForRound(at: THREE.Vector3, yaw: number) {
    this.isOut = false;
    this.hearts = this.maxHearts = this.stats.maxHearts;
    this.pos.copy(at);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.y = 0;
    this.vy = 0;
    this.ball = null;
    this.charge = 0;
    this.state = 'free';
    this.stateTime = 0;
    this.dodgeCharges = this.stats.dodgeCharges;
    this.dodgeRecharge = 0;
    this.stamina = this.stats.staminaMax;
    this.invuln = 0;
    this.counterTimer = 0;
    this.powerArmed = false;
    this.phantomArmed = false;
    this.dissolve = 0;
    this.dissolveTarget = 0;
    this.dissolveDone = null;
    this.catchCooldown = 0;
    this.anim.stop(0);
    this.anim.snapLocomotion();
    this.move.set(0, 0, 0);
    this.faceYaw = null;
  }

  playScripted(clip: ClipName, opts: { hold?: boolean; fade?: number; speed?: number } = {}) {
    this.setState('scripted');
    this.anim.play(clip, { fade: opts.fade ?? 0.2, hold: opts.hold, speed: opts.speed });
  }

  releaseScripted() {
    if (this.state === 'scripted' || this.state === 'celebrate') {
      this.setState('free');
      this.anim.stop(0.25);
    }
  }

  celebrate(win: boolean) {
    if (this.isOut) return;
    this.setState('celebrate');
    if (this.ball) this.dropBall(1);
    this.anim.play(win ? (rng.chance(0.5) ? 'victory' : 'fistPump') : 'defeat', { fade: 0.3, hold: true });
  }

  // ------------------------------------------------------------------ throwing
  /** Builds the throw and launches the held ball. */
  private launch(kind: ThrowKind) {
    const ball = this.ball;
    if (!ball) return;
    const w = this.world;
    const T = TUNING.throw;
    const from = this.handPos(new THREE.Vector3());
    // keep the ball in our own airspace at release
    let speed: number;
    let gravityScale: number = T.liveGravity;
    let power: number;
    let perfect = false;
    let damage = 1;
    const chargeCurve = Math.pow(this.charge, 0.8);
    if (kind === 'pass') {
      speed = 13;
      gravityScale = 1;
      power = 0.3;
      damage = 0;
    } else if (kind === 'power') {
      speed = this.stats.maxSpeed * 1.45 * (0.95 + 0.05 * this.stats.abilityPower);
      gravityScale = 0.22;
      power = speed / TUNING.throw.chargedSpeed;
      damage = 2;
    } else {
      speed = lerp(this.stats.quickSpeed, this.stats.maxSpeed, kind === 'quick' ? 0 : chargeCurve);
      if (kind === 'charged' && this.fullTime >= 0 && this.fullTime <= this.stats.perfectReleaseWindow) {
        perfect = true;
        speed *= T.perfectBonus;
      }
      if (this.counterTimer > 0) {
        speed *= 1.18;
        perfect = true;
        this.counterTimer = 0;
      }
      gravityScale = lerp(0.62, 0.42, clamp01((speed - 16) / 14));
      power = speed / TUNING.throw.chargedSpeed;
    }

    // target / aim
    const target = this.aimTarget && this.aimTarget.active ? this.aimTarget : null;
    const aim = _v.copy(this.aimPoint);
    if (kind === 'pass' && this.passTarget) this.passTarget.chestPos(aim);
    const dir = new THREE.Vector3();
    const g = TUNING.gravity * gravityScale;
    solveBallisticLow(from, aim, speed, g, dir);

    // curve: lateral acceleration with pre-compensated launch direction
    let curve: THREE.Vector3 | null = null;
    if (this.perks.curve && Math.abs(this.curveInput) > 0.3 && kind !== 'pass') {
      // curveInput > 0 bends the ball to the thrower's right: launch rotated left, accelerate right.
      const dist = Math.hypot(aim.x - from.x, aim.z - from.z);
      const tFlight = dist / speed;
      const left = new THREE.Vector3().crossVectors(UP, dir).setY(0).normalize();
      const sign = Math.sign(this.curveInput);
      const accMag = this.stats.curveStrength * (0.6 + 0.4 * Math.abs(this.curveInput));
      const lateral = 0.5 * accMag * tFlight * tFlight;
      const ang = Math.atan2(lateral, dist);
      dir.applyAxisAngle(UP, sign * ang);
      curve = left.multiplyScalar(-sign * accMag);
    }

    // accuracy error cone
    if (kind !== 'pass') {
      let err = this.stats.aimErrorDeg;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      err *= 1 + sp * 0.09;
      if (this.sprinting) err *= 1.4;
      if (kind === 'charged') err *= lerp(1, 0.55, this.charge);
      if (perfect) err *= 0.4;
      if (kind === 'power') err *= 0.5;
      const e = (err * Math.PI) / 180;
      const yawErr = rng.gauss(0, e * 0.6);
      const pitchErr = rng.gauss(0, e * 0.35);
      dir.applyAxisAngle(UP, yawErr);
      const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
      dir.applyAxisAngle(right, pitchErr);
    }

    // homing assist for bank shots / abilities
    const info: ThrowInfo = {
      kind,
      power,
      damage,
      perfect,
      heavy: kind === 'power' || (this.perks.guardBreak && kind === 'charged' && this.charge >= 1),
      curve,
      homing: null,
      homingStrength: 0,
      gravityScale,
      target,
      shockwave: kind === 'power' && this.perks.shockwave || (perfect && this.perks.shockwave && power > 1.1),
      ricochet: this.perks.ricochet,
      chain: 0,
      time: 0,
      wallBounces: 0,
      speed,
      receiver: kind === 'pass' ? this.passTarget : null,
    };

    ball.state = 'thrown';
    ball.live = kind !== 'pass';
    ball.holder = null;
    ball.thrower = this;
    ball.info = info;
    ball.ignore.clear();
    ball.ignore.add(this);
    ball.pos.copy(from);
    ball.vel.copy(dir).multiplyScalar(speed);
    // carry some body momentum
    const along = this.vel.dot(dir);
    if (along > 0) ball.vel.addScaledVector(dir, along * T.momentumCarry);
    const spinAxis = new THREE.Vector3().crossVectors(dir, UP).normalize();
    ball.angVel.copy(spinAxis).multiplyScalar((-speed / ball.radius) * 0.35);
    if (curve) ball.angVel.addScaledVector(UP, Math.sign(curve.dot(new THREE.Vector3().crossVectors(UP, dir))) * 40);
    ball.airTime = 0;
    ball.grounded = false;
    ball.lastTeam = this.team;
    ball.energyTarget = kind === 'power' ? 1 : perfect ? 0.6 : kind === 'charged' ? 0.18 * this.charge : 0;
    this.ball = null;
    this.charge = 0;
    this.powerArmed = false;
    this.lastThrowTime = w.time.gameTime;
    if (kind !== 'pass') this.stats_.throws++;
    if (perfect) {
      this.addEnergy(TUNING.energy.perfectRelease);
    }
    // recoil
    this.vel.addScaledVector(_v2.copy(dir).setY(0).normalize(), -0.6 * power);
    w.events.emit('throw', { athlete: this, ball, info });
    if (kind === 'pass' && this.passTarget) w.events.emit('pass', { from: this, to: this.passTarget, ball });
    this.passTarget = null;
  }

  /** Launch a held ball with explicit parameters (abilities, ultimates, relays). */
  launchCustom(kind: ThrowKind, velocity: THREE.Vector3, info: Partial<ThrowInfo>) {
    const ball = this.ball;
    if (!ball) return null;
    const from = this.handPos(new THREE.Vector3());
    const full: ThrowInfo = {
      kind, power: 1, damage: 1, perfect: false, heavy: false, curve: null, homing: null, homingStrength: 0,
      gravityScale: 0.4, target: null, shockwave: false, ricochet: false, chain: 0, time: 0, wallBounces: 0,
      speed: velocity.length(), receiver: null, ...info,
    };
    ball.state = 'thrown';
    ball.live = true;
    ball.holder = null;
    ball.thrower = this;
    ball.info = full;
    ball.ignore.clear();
    ball.ignore.add(this);
    ball.pos.copy(from);
    ball.vel.copy(velocity);
    const spinAxis = new THREE.Vector3().crossVectors(velocity, UP).normalize();
    ball.angVel.copy(spinAxis).multiplyScalar(-velocity.length() / ball.radius * 0.35);
    ball.airTime = 0;
    ball.grounded = false;
    ball.lastTeam = this.team;
    this.ball = null;
    this.charge = 0;
    this.lastThrowTime = this.world.time.gameTime;
    this.stats_.throws++;
    this.world.events.emit('throw', { athlete: this, ball, info: full });
    return ball;
  }

  // ------------------------------------------------------------------ update
  update(dt: number) {
    const w = this.world;
    this.stateTime += dt;
    this.catchCooldown = Math.max(0, this.catchCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.counterTimer = Math.max(0, this.counterTimer - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    this.pickupFlash = Math.max(0, this.pickupFlash - dt * 3);
    if (this.dodgeCharges < this.stats.dodgeCharges) {
      this.dodgeRecharge -= dt;
      if (this.dodgeRecharge <= 0) {
        this.dodgeCharges++;
        this.dodgeRecharge = this.dodgeCharges < this.stats.dodgeCharges ? this.stats.dodgeRecharge : 0;
      }
    }
    if (this.active && w.match?.playing) this.energy = Math.min(TUNING.energy.max, this.energy + TUNING.energy.passive * dt * this.stats.energyGain);

    const controlsOn = w.match ? w.match.controlsEnabled : true;
    if (this.controller && this.active && controlsOn) this.controller.update(dt);
    else if (!controlsOn && this.state !== 'scripted') {
      this.move.set(0, 0, 0);
      this.wantSprint = false;
      if (this.state === 'charging' || this.state === 'catching') this.setState('free');
    }

    this.updateState(dt);
    this.updateMovement(dt);
    this.updateFacing(dt);
    this.updateAnimation(dt);
    this.updateVisuals(dt);
  }

  private updateState(dt: number) {
    const s = this.state;
    const T = TUNING;
    switch (s) {
      case 'charging':
      case 'power': {
        this.chargeHeld += dt;
        const ct = this.stats.chargeTime * (s === 'power' ? 0.7 : 1);
        const before = this.charge;
        this.charge = Math.min(1, this.charge + dt / ct);
        if (this.charge >= 1) {
          if (before < 1) {
            this.fullTime = 0;
            this.world.events.emit('chargeFull', { athlete: this });
          } else this.fullTime += dt;
        }
        const cock = s === 'power' ? Math.min(0.35, this.stateTime * 1.1) : Math.min(0.22, (this.chargeHeld / 0.17) * 0.22);
        this.anim.setTime(s === 'power' ? 'powerCharge' : 'charge', cock);
        if (this.ball) this.ball.energyTarget = s === 'power' ? 0.6 + this.charge * 0.4 : this.charge >= 1 ? 0.35 : this.charge * 0.2;
        if (s === 'power' && this.releaseQueued && this.stateTime >= 0.3) {
          this.releaseQueued = false;
          this.releaseCharge();
        }
        break;
      }
      case 'throwing':
      case 'passing': {
        if (this.releaseAt >= 0 && this.stateTime >= this.releaseAt) {
          this.releaseAt = -1;
          this.launch(this.releaseKind);
        }
        if (this.stateTime >= this.recoverAt) this.setState('free');
        break;
      }
      case 'fake':
        if (this.stateTime > 0.32) this.setState('free');
        break;
      case 'catching':
        if (this.stateTime > this.stats.catchWindow + 0.03) this.onWhiff();
        break;
      case 'blocking':
        if (this.stateTime > 0.9) this.endBlock();
        break;
      case 'catchRecover':
        if (this.stateTime > 0.3) this.setState('free');
        break;
      case 'whiff':
        if (this.stateTime > T.catch.whiffRecover) this.setState('free');
        break;
      case 'dodging':
        if (this.stateTime > T.dodge.duration + T.dodge.recover) this.setState('free');
        break;
      case 'hitstun':
        if (this.stateTime > T.damage.hitstun) this.setState('free');
        break;
      case 'stagger':
        if (this.stateTime > 0.55) this.setState('free');
        break;
      case 'knockdown':
        break;
    }
  }

  private updateMovement(dt: number) {
    const T = TUNING;
    const st = this.stats;
    this.prevVel.copy(this.vel);
    const s = this.state;
    if (s === 'out' || s === 'scripted' && !this.scriptedMove) {
      this.vel.multiplyScalar(Math.exp(-10 * dt));
      return;
    }
    if (s === 'dodging') {
      const t = Math.min(1, this.stateTime / T.dodge.duration);
      const sp = this.dodgeSpeed0 * Math.pow(1 - t, 1.35);
      this.vel.set(this.dodgeDir.x * sp, 0, this.dodgeDir.z * sp);
    } else if (s === 'knockdown' || s === 'hitstun' || s === 'stagger' || s === 'celebrate' || s === 'ultimate') {
      this.vel.multiplyScalar(Math.exp(-6 * dt));
    } else {
      // sprint + stamina
      const moving = this.move.lengthSq() > 0.04;
      const wantSprint = this.wantSprint && moving && s === 'free';
      if (wantSprint && (this.sprinting ? this.stamina > 0 : this.stamina > T.stamina.minToSprint)) {
        this.sprinting = true;
        this.stamina = Math.max(0, this.stamina - T.stamina.sprintDrain * dt);
        this.staminaDelay = T.stamina.regenDelay;
      } else {
        this.sprinting = false;
        this.staminaDelay -= dt;
        if (this.staminaDelay <= 0) this.stamina = Math.min(st.staminaMax, this.stamina + st.staminaRegen * dt);
      }
      let maxSp = this.sprinting ? st.sprint : st.jog;
      if (s === 'charging' || s === 'power') maxSp = T.move.chargeWalk * (s === 'power' ? 0.6 : 1);
      else if (s === 'catching' || s === 'blocking') maxSp = T.move.catchWalk;
      else if (s === 'throwing' || s === 'passing' || s === 'fake') maxSp = T.move.throwWalk;
      else if (s === 'whiff' || s === 'catchRecover') maxSp = T.move.throwWalk;
      const desired = _v.copy(this.move).setY(0);
      if (desired.lengthSq() > 1) desired.normalize();
      desired.multiplyScalar(maxSp);
      const diff = desired.sub(this.vel.setY(0));
      const accel = desired.lengthSq() + 0.01 >= this.vel.lengthSq() ? (this.sprinting ? T.move.sprintAccel + st.accel * 0.2 : st.accel) : T.move.decel;
      const maxDv = accel * dt;
      if (diff.lengthSq() > maxDv * maxDv) diff.setLength(maxDv);
      this.vel.add(diff);
    }
    // integrate + clamp to half
    const px = this.pos.x, pz = this.pos.z;
    this.pos.addScaledVector(this.vel, dt);
    if (this.state !== 'out' && this.state !== 'scripted') {
      this.world.court.clampAthlete(this.pos, this.team);
      if (dt > 0) {
        const realVx = (this.pos.x - px) / dt, realVz = (this.pos.z - pz) / dt;
        // remove velocity into walls
        if (Math.abs(realVx - this.vel.x) > 0.01) this.vel.x = realVx;
        if (Math.abs(realVz - this.vel.z) > 0.01) this.vel.z = realVz;
      }
    }
    // vertical (jumps from abilities)
    if (this.y > 0 || this.vy !== 0) {
      this.vy -= T.gravity * 1.6 * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }
  }
  /** Allow scripted state with movement (cinematic walk-ins). */
  scriptedMove = false;

  private updateFacing(dt: number) {
    const s = this.state;
    if (s === 'out' || s === 'knockdown') return;
    let target: number | null = this.faceYaw;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.sprinting && sp > 1 && s === 'free') target = Math.atan2(this.vel.x, this.vel.z);
    if (s === 'dodging' || s === 'hitstun' || s === 'stagger' || s === 'celebrate') return;
    if (target === null) {
      if (sp > 0.8) target = Math.atan2(this.vel.x, this.vel.z);
      else return;
    }
    const sharp = this.sprinting ? TUNING.move.sprintTurnSharpness : s === 'charging' || s === 'power' ? 22 : TUNING.move.turnSharpness;
    this.yaw = dampAngle(this.yaw, target, sharp, dt);
  }

  private updateAnimation(dt: number) {
    const inp = this.animIn;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    // world → local (x left, z forward)
    inp.velX = this.vel.x * c - this.vel.z * s;
    inp.velZ = this.vel.x * s + this.vel.z * c;
    const ax = (this.vel.x - this.prevVel.x) / Math.max(dt, 1e-4);
    const az = (this.vel.z - this.prevVel.z) / Math.max(dt, 1e-4);
    this.accLocal.set(ax * c - az * s, ax * s + az * c);
    inp.accX = this.state === 'dodging' ? 0 : this.accLocal.x;
    inp.accZ = this.state === 'dodging' ? 0 : this.accLocal.y;
    inp.holding = !!this.ball && (this.state === 'free' || this.state === 'catchRecover' || this.state === 'dodging' || this.state === 'hitstun');
    inp.grounded = this.y <= 0.01;
    inp.alert = this.state === 'celebrate' || this.state === 'scripted' ? 0.4 : 1;
    inp.crouch = this.state === 'catching' ? 0.3 : 0;
    inp.chargeShake = this.state === 'charging' || this.state === 'power' ? clamp01((this.charge - 0.5) * 2) * (this.state === 'power' ? 1.5 : 1) : 0;
    // aim offset: face toward aim point
    const aimW = this.state === 'charging' || this.state === 'power' || this.state === 'catching' || this.state === 'blocking' ? 1 : this.state === 'free' ? 0.6 : this.state === 'throwing' ? 0.5 : 0;
    inp.aimWeight = aimW;
    if (aimW > 0) {
      const dx = this.aimPoint.x - this.pos.x, dz = this.aimPoint.z - this.pos.z;
      const aimYaw = Math.atan2(dx, dz);
      inp.aimYaw = angleDiff(this.yaw, aimYaw);
      inp.aimPitch = this.aimPitch;
    } else {
      inp.aimYaw = 0;
      inp.aimPitch = 0;
    }
    this.anim.update(dt, inp);
  }

  private updateVisuals(dt: number) {
    const root = this.rig.root;
    root.position.set(this.pos.x, this.pos.y + this.y, this.pos.z);
    root.rotation.y = this.yaw;
    root.updateMatrixWorld(true);

    // held ball follows hand socket
    if (this.ball) {
      const b = this.ball;
      this.handPos(_v);
      if (this.pickupLerp < 1) {
        this.pickupLerp = Math.min(1, this.pickupLerp + dt / 0.14);
        const k = this.pickupLerp * this.pickupLerp * (3 - 2 * this.pickupLerp);
        b.pos.lerpVectors(this.pickupFrom, _v, k);
      } else b.pos.copy(_v);
      b.prev.copy(b.pos);
    }

    // dissolve
    if (this.dissolve !== this.dissolveTarget) {
      const dir = Math.sign(this.dissolveTarget - this.dissolve);
      this.dissolve = clamp01(this.dissolve + dir * this.dissolveSpeed * dt);
      if (this.dissolve === this.dissolveTarget && this.dissolveDone) {
        const f = this.dissolveDone;
        this.dissolveDone = null;
        f();
      }
    }
    const m = this.rig.material;
    m.u.uDissolve.value = this.dissolve;
    m.u.uFlash.value = this.hitFlash * 0.9 + (this.invuln > 0 && this.state !== 'hitstun' ? (Math.sin(this.world.time.realTime * 30) > 0 ? 0.25 : 0) : 0);
    m.u.uTime.value = this.world.time.realTime;
    const energized = this.state === 'ultimate' ? 1 : this.powerArmed || this.state === 'power' ? 0.45 : this.counterTimer > 0 ? 0.35 : 0;
    m.u.uEnergy.value += (energized - m.u.uEnergy.value) * damp(8, dt);
    this.rig.mesh.castShadow = this.dissolve < 0.5;

    // ground decals
    const hideDecals = this.isOut || this.dissolve > 0.6;
    this.blob.visible = !hideDecals || this.state === 'out';
    this.blob.position.set(this.pos.x, 0.011, this.pos.z);
    const bs = 1.05 - Math.min(0.5, this.y * 0.3);
    this.blob.scale.setScalar(bs);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - this.dissolve);
    this.ring.visible = !hideDecals && this.state !== 'out';
    this.ring.position.set(this.pos.x, 0.015, this.pos.z);
    this.ring.rotation.z += dt * 0.6;
  }
}
