import * as THREE from 'three/webgpu';
import type { CharacterBody } from '@/physics/physics';
import type { CharacterInstance } from '@/assets/loader';
import { CharacterAnimator } from '@/animation/animator';
import { timeScale } from '@/core/loop';
import type { GameCtx } from './ctx';

export type Team = 'player' | 'enemy' | 'echo';
export type HitOutcome = 'hit' | 'blocked' | 'parried' | 'dodged' | 'ignored' | 'killed';

export interface HitInfo {
  attacker: Actor;
  damage: number;
  stagger: number;
  heavy: boolean;
  guardbreak: boolean;
  launch: number;
  point: THREE.Vector3;
  dir: THREE.Vector3;
  unblockable?: boolean;
  /** how the attack's clip was authored (used for hit-reaction choice) */
  clip: string;
}

/** Everything that has a body in the world: Ethan, his echoes, enemies and bosses. */
export abstract class Actor {
  abstract readonly team: Team;
  name = 'actor';
  anim: CharacterAnimator;
  body!: CharacterBody;
  /** feet position (simulation) and the previous tick's, for render interpolation */
  pos = new THREE.Vector3();
  prev = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  vel = new THREE.Vector3();
  grounded = true;
  maxHealth = 100;
  health = 100;
  alive = true;
  radius = 0.32;
  height = 1.85;
  /** damage multiplier while the actor is mid-combo etc. */
  invulnerable = false;
  readonly root = new THREE.Group();
  protected tmp = new THREE.Vector3();

  constructor(protected ctx: GameCtx, readonly inst: CharacterInstance) {
    this.anim = new CharacterAnimator(inst);
    this.root.add(inst.root);
  }

  /** dt scaled by the time group this actor lives in. */
  /** an actor's own time multiplier on top of its group's (a boss accelerating its own timeline) */
  timeMul = 1;
  protected scaledDt(dt: number): number {
    return dt * (this.team === 'enemy' ? timeScale.world : timeScale.player) * this.timeMul;
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  left(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** chest-height point (target framing, hit tests) */
  focusPoint(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.height * 0.62);
  }

  /** shortest distance from a point to this actor's hurt capsule */
  distanceToPoint(p: THREE.Vector3): number {
    const a = this.pos.y + this.radius;
    const b = this.pos.y + this.height - this.radius;
    const y = THREE.MathUtils.clamp(p.y, a, b);
    return Math.hypot(p.x - this.pos.x, p.y - y, p.z - this.pos.z) - this.radius;
  }

  bonePos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.inst.bones.get(name);
    if (!b) return out.copy(this.pos);
    return b.getWorldPosition(out);
  }

  beginTick(): void {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
  }

  /**
   * Put the model at the exact simulation pose and refresh its bone matrices. Hit detection reads bone positions, so it must not depend on
   * when the renderer last interpolated the visual (that would tie combat to frame timing). Called at the end of every tick.
   */
  protected refreshPose(): void {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  /** Place the visual model at the interpolated pose. */
  syncVisual(alpha: number): void {
    this.root.position.lerpVectors(this.prev, this.pos, alpha);
    let d = this.yaw - this.prevYaw;
    d = ((d + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    this.root.rotation.y = this.prevYaw + d * alpha;
  }

  syncFromBody(): void {
    const t = this.body.body.translation();
    this.pos.set(t.x, t.y - this.height / 2, t.z);
  }

  /** Called when this actor's attack was parried. */
  onParried(): void {}
  /** Force a stagger for `seconds` (parry rewards, guard breaks). */
  staggerFor(_seconds: number, _launch = 0): void {}

  /** Receive a hit. Concrete classes decide block/parry/dodge/damage. */
  abstract receiveHit(hit: HitInfo): HitOutcome;
  abstract tick(dt: number): void;

  dispose(): void {
    this.ctx.physics.removeCharacter(this.body);
    this.anim.dispose();
    this.root.removeFromParent();
  }
}
