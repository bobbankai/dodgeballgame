import * as THREE from 'three/webgpu';
import { Actor, type HitInfo, type HitOutcome } from '@/gameplay/actor';
import type { GameCtx } from '@/gameplay/ctx';
import { G } from '@/physics/physics';
import { instantiateCharacter } from '@/assets/loader';
import { applyStrike, strikeTest } from '@/combat/strike';
import { timeScale } from '@/core/loop';

export type EState = 'idle' | 'patrol' | 'investigate' | 'chase' | 'circle' | 'attack' | 'recover' | 'block' | 'hurt' | 'dead';

export interface AttackDef {
  clip: string;
  /** preferred distance band to start this attack (m) */
  min: number;
  max: number;
  weight: number;
  cooldown: number;
  /** follow-up clip in the same string (combos) */
  then?: string;
  /** this attack cannot be blocked (must be dodged); used by heavy telegraphed moves */
  unblockable?: boolean;
}

export interface EnemyDef {
  id: string;
  display: string;
  model: string;
  health: number;
  poise: number;
  runSpeed: number;
  circleSpeed: number;
  aggroRange: number;
  fov: number;
  attacks: AttackDef[];
  /** chance to raise guard when the player starts an attack at close range */
  guardChance: number;
  /** takes no stagger from light hits */
  armored?: boolean;
  /** extra damage multiplier */
  power?: number;
  scale?: number;
  circleRange: [number, number];
  /** can dodge-step away from heavy attacks */
  evades?: boolean;
}

const approachAngle = (a: number, b: number, maxStep: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
};

export interface EnemySnapshot {
  pos: [number, number, number]; yaw: number; health: number; alive: boolean; poise: number;
  state: EState; stateT: number; clip: string | null; frame: number;
}

export class Enemy extends Actor {
  readonly team = 'enemy' as const;
  state: EState = 'idle';
  stateT = 0;
  poise: number;
  /** patrol route (world XZ points); empty = stand guard */
  patrol: THREE.Vector3[] = [];
  /** level-script hook */
  onDeath: ((e: Enemy) => void) | null = null;

  private patrolI = 0;
  private alert = 0;
  private lastKnown = new THREE.Vector3();
  private hasLastKnown = false;
  private cooldown = 1;
  private curAttack: AttackDef | null = null;
  private attackClip = '';
  private hitDone = new Set<Actor>();
  private circleDir = Math.random() < 0.5 ? 1 : -1;
  private circleSwitch = 1.5 + Math.random() * 2;
  private holdsToken = false;
  private guardT = 0;
  private deadT = 0;
  private hurtClip = 'hit_light';
  private stunUntil = 0;
  private want = new THREE.Vector3();
  private tmpA = new THREE.Vector3();
  private lungeVec = new THREE.Vector3();
  private lungeDist = 0;
  private noticed = false;

  static async create(ctx: GameCtx, def: EnemyDef, at: THREE.Vector3, yaw = 0): Promise<Enemy> {
    const inst = await instantiateCharacter(def.model, { scale: def.scale });
    const e = new Enemy(ctx, inst, def);
    e.height = 1.85 * (def.scale ?? 1);
    e.radius = 0.32 * (def.scale ?? 1);
    e.body = ctx.physics.createCharacter(at, e.radius, e.height, G.ENEMY);
    e.pos.copy(at); e.prev.copy(at); e.yaw = e.prevYaw = yaw;
    e.anim.play('idle_combat', { fade: 0 });
    e.syncVisual(1);
    return e;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Actor>[1], readonly def: EnemyDef) {
    super(ctx, inst);
    this.name = def.display;
    this.maxHealth = this.health = def.health;
    this.poise = def.poise;
  }

  // --- perception ----------------------------------------------------------------------------------------------

  private canSee(p: Actor): boolean {
    const to = this.tmpA.set(p.pos.x - this.pos.x, 0, p.pos.z - this.pos.z);
    const dist = to.length();
    if (dist > this.def.aggroRange) return false;
    to.divideScalar(Math.max(dist, 1e-4));
    const dot = this.forward(this.want).dot(to);
    if (dot < Math.cos(this.def.fov / 2) && dist > 3) return false;
    const eye = this.tmpA.set(this.pos.x, this.pos.y + 1.6, this.pos.z);
    return this.ctx.lineOfSight(eye, p.focusPoint(new THREE.Vector3()));
  }

  // --- tick ----------------------------------------------------------------------------------------------------

  tick(dt: number): void {
    this.beginTick();
    const d = this.scaledDt(dt);
    this.stateT += d;
    if (this.alive) this.think(d);
    else { this.deadT += d; this.vel.x *= 0.9; this.vel.z *= 0.9; }
    this.integrate(d);
    this.anim.update(d);
    this.refreshPose();
    this.cooldown = Math.max(0, this.cooldown - d);
    this.guardT = Math.max(0, this.guardT - d);
  }

  private think(d: number): void {
    const player = this.ctx.player;
    const pAlive = player.alive;
    const seen = pAlive && this.canSee(player);
    const dist = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
    if (seen) {
      this.alert = Math.min(1, this.alert + d * 2.8);
      this.lastKnown.copy(player.pos); this.hasLastKnown = true;
    } else this.alert = Math.max(0, this.alert - d * 0.35);
    // noise: combat nearby wakes idle enemies
    const p = player as Actor & { inCombat?: boolean };
    if (!seen && p.inCombat && dist < 12 && this.state !== 'hurt') { this.alert = Math.max(this.alert, 0.6); this.lastKnown.copy(player.pos); this.hasLastKnown = true; }

    const aware = this.alert >= 1 || (this.noticed && this.alert > 0.2);
    if (aware && !this.noticed) { this.noticed = true; this.ctx.sfx.play('alert', { at: this.pos }); }
    if (this.alert <= 0.02) this.noticed = false;

    switch (this.state) {
      case 'idle': case 'patrol': this.tickPatrol(d, aware); break;
      case 'investigate': this.tickInvestigate(d, aware); break;
      case 'chase': this.tickChase(d, dist, aware); break;
      case 'circle': this.tickCircle(d, dist, aware); break;
      case 'attack': this.tickAttack(d); break;
      case 'recover': this.tickRecover(d); break;
      case 'block': this.tickBlock(d); break;
      case 'hurt': this.tickHurt(d); break;
      default: break;
    }
  }

  private setState(s: EState): void { this.state = s; this.stateT = 0; }

  private steer(d: number, dir: THREE.Vector3, speed: number, turn = 9): void {
    // separation from other enemies so a group spreads out instead of stacking
    const sep = this.tmpA.set(0, 0, 0);
    for (const o of this.ctx.enemies) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const dd = Math.hypot(dx, dz);
      if (dd < 1.35 && dd > 1e-3) sep.x += (dx / dd) * (1.35 - dd), sep.z += (dz / dd) * (1.35 - dd);
    }
    const wx = dir.x * speed + sep.x * 2.2, wz = dir.z * speed + sep.z * 2.2;
    const k = Math.min(1, 26 * d);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;
    void turn;
  }

  private face(d: number, x: number, z: number, rate = 9): void {
    this.yaw = approachAngle(this.yaw, Math.atan2(x, z), rate * d);
  }

  private tickPatrol(d: number, aware: boolean): void {
    if (aware) { this.setState('chase'); return; }
    if (this.alert > 0.3 && this.hasLastKnown) { this.setState('investigate'); return; }
    if (this.patrol.length < 2) {
      this.steer(d, this.want.set(0, 0, 0), 0);
      this.anim.play('idle_combat', { fade: 0.25 });
      this.state = 'idle';
      return;
    }
    this.state = 'patrol';
    const tgt = this.patrol[this.patrolI];
    const to = this.want.set(tgt.x - this.pos.x, 0, tgt.z - this.pos.z);
    const dist = to.length();
    if (dist < 0.6) { this.patrolI = (this.patrolI + 1) % this.patrol.length; return; }
    to.divideScalar(dist);
    this.steer(d, to, 1.5);
    this.face(d, to.x, to.z, 5);
    this.anim.play('walk', { fade: 0.2, speed: 0.95 });
  }

  private tickInvestigate(d: number, aware: boolean): void {
    if (aware) { this.setState('chase'); return; }
    const to = this.want.set(this.lastKnown.x - this.pos.x, 0, this.lastKnown.z - this.pos.z);
    const dist = to.length();
    if (dist < 1.2 || this.stateT > 7) {
      this.steer(d, to.set(0, 0, 0), 0);
      this.anim.play('look_around', { fade: 0.3 });
      if (this.stateT > 9 || (dist < 1.2 && this.stateT > 3.5)) { this.hasLastKnown = false; this.setState(this.patrol.length > 1 ? 'patrol' : 'idle'); }
      return;
    }
    to.divideScalar(dist);
    this.steer(d, to, this.def.runSpeed * 0.55);
    this.face(d, to.x, to.z, 7);
    this.anim.play('walk', { fade: 0.2, speed: 1.2 });
  }

  private tickChase(d: number, dist: number, aware: boolean): void {
    const pl = this.ctx.player;
    if (!aware && this.alert < 0.15) { this.setState('investigate'); return; }
    if (!pl.alive) { this.setState('idle'); return; }
    const to = this.want.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z);
    to.divideScalar(Math.max(dist, 1e-4));
    if (dist <= this.def.circleRange[1]) { this.setState('circle'); return; }
    this.steer(d, to, this.def.runSpeed);
    this.face(d, to.x, to.z, 10);
    this.anim.play('run', { fade: 0.15, speed: THREE.MathUtils.clamp(this.def.runSpeed / 4.6, 0.7, 1.3) });
  }

  private tickCircle(d: number, dist: number, aware: boolean): void {
    const pl = this.ctx.player;
    if (!pl.alive) { this.setState('idle'); return; }
    if (!aware && this.alert < 0.15) { this.setState('investigate'); return; }
    const toP = this.want.set(pl.pos.x - this.pos.x, 0, pl.pos.z - this.pos.z);
    toP.divideScalar(Math.max(dist, 1e-4));
    const [lo, hi] = this.def.circleRange;
    if (dist > hi + 2.2) { this.releaseToken(); this.setState('chase'); return; }
    // spacing: back off if too close, close in if too far, otherwise strafe
    const tang = new THREE.Vector3(-toP.z * this.circleDir, 0, toP.x * this.circleDir);
    const radial = dist < lo ? -1 : dist > hi ? 1 : 0;
    const dir = new THREE.Vector3().copy(tang).multiplyScalar(0.9).addScaledVector(toP, radial * 0.9).normalize();
    this.circleSwitch -= d;
    if (this.circleSwitch <= 0) { this.circleDir *= -1; this.circleSwitch = 1.6 + Math.random() * 2.4; }
    this.steer(d, dir, this.def.circleSpeed);
    this.face(d, toP.x, toP.z, 12);
    const side = dir.dot(this.left(new THREE.Vector3()));
    const fwd = dir.dot(this.forward(new THREE.Vector3()));
    this.anim.play(Math.abs(side) > Math.abs(fwd) ? (side > 0 ? 'combat_strafe_L' : 'combat_strafe_R') : fwd >= 0 ? 'combat_walk_F' : 'combat_walk_B', { fade: 0.15, speed: 1 });

    // defensive read: the player is mid-swing right in front of us
    const pa = pl as Actor & { state?: string };
    if (pa.state === 'attack' && dist < 2.6 && this.guardT <= 0 && Math.random() < this.def.guardChance * d * 3) { this.guardT = 0.9 + Math.random() * 0.6; this.setState('block'); this.anim.play('block_hold', { fade: 0.06 }); return; }
    if (this.def.evades && pa.state === 'attack' && dist < 2.2 && this.cooldown <= 0 && Math.random() < 0.8 * d) { this.startSidestep(pl); return; }

    // pick an attack when the cooldown is up, we are in range, and the group gives us a token
    if (this.cooldown <= 0 && pl.alive) {
      const options = this.def.attacks.filter((a) => dist >= a.min && dist <= a.max);
      if (options.length && (this.holdsToken || this.ctx.tokens.request(this, 1))) {
        this.holdsToken = true;
        const total = options.reduce((s, a) => s + a.weight, 0);
        let r = Math.random() * total;
        let pick = options[0];
        for (const a of options) { r -= a.weight; if (r <= 0) { pick = a; break; } }
        this.startAttack(pick);
      }
    }
  }

  private startSidestep(pl: Actor): void {
    const away = new THREE.Vector3(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z).normalize();
    this.vel.x = away.x * 6; this.vel.z = away.z * 6;
    this.anim.play('dodge_B', { fade: 0.04, restart: true });
    this.cooldown = 0.4;
    this.setState('recover');
    this.attackClip = 'dodge_B';
  }

  private startAttack(a: AttackDef): void {
    this.curAttack = a;
    this.attackClip = a.clip;
    this.hitDone.clear();
    this.setState('attack');
    const pl = this.ctx.player;
    const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
    this.lungeVec.set(dx, 0, dz).normalize();
    const meta = this.anim.inst.meta[a.clip];
    this.lungeDist = Math.min(meta?.events.lunge ?? 0.4, Math.max(0, Math.hypot(dx, dz) - 0.85));
    this.anim.play(a.clip, { fade: 0.08, restart: true });
    this.ctx.sfx.play('whoosh', { at: this.pos, pitch: 0.9 });
  }

  private tickAttack(d: number): void {
    const meta = this.anim.meta(this.attackClip);
    if (!meta) { this.setState('circle'); return; }
    const ev = meta.events;
    const fr = this.anim.frame;
    const hit0 = ev.hit?.[0] ?? 8;
    const pl = this.ctx.player;
    if (fr < hit0) this.face(d, pl.pos.x - this.pos.x, pl.pos.z - this.pos.z, 7);
    if (fr >= 2 && fr < hit0 && this.lungeDist > 0) {
      const sp = this.lungeDist / Math.max(0.05, (hit0 - 2) / 30);
      this.vel.x = Math.sin(this.yaw) * sp; this.vel.z = Math.cos(this.yaw) * sp;
    } else { this.vel.x *= Math.exp(-14 * d); this.vel.z *= Math.exp(-14 * d); }
    if (ev.hit && fr >= ev.hit[0] && fr <= ev.hit[1]) {
      const targets = [this.ctx.player, ...this.ctx.echoes];
      for (const c of strikeTest(this, ev, targets, this.hitDone)) {
        this.hitDone.add(c.target);
        const out = applyStrike(this.ctx, this, this.attackClip, ev, c, this.def.power ?? 1);
        if (out === 'parried') return; // onParried() already moved us to hurt
        if (this.curAttack?.unblockable) { /* handled by HitInfo in the boss subclass */ }
      }
    }
    if (this.anim.finished || fr >= meta.frames - 0.6) {
      const next = this.curAttack?.then;
      if (next && Math.random() < 0.65 && this.ctx.player.alive) {
        this.startAttack({ ...this.curAttack!, clip: next, then: undefined });
        return;
      }
      this.cooldown = 0.8 + Math.random() * 1.1;
      this.releaseToken();
      this.setState('recover');
    }
  }

  private tickRecover(d: number): void {
    this.vel.x *= Math.exp(-8 * d); this.vel.z *= Math.exp(-8 * d);
    const pl = this.ctx.player;
    this.face(d, pl.pos.x - this.pos.x, pl.pos.z - this.pos.z, 6);
    if (this.stateT > 0.35) this.setState('circle');
  }

  private tickBlock(d: number): void {
    const pl = this.ctx.player;
    this.vel.x *= Math.exp(-10 * d); this.vel.z *= Math.exp(-10 * d);
    this.face(d, pl.pos.x - this.pos.x, pl.pos.z - this.pos.z, 10);
    if (this.guardT <= 0 || this.stateT > 1.8) { this.setState('circle'); this.cooldown = Math.min(this.cooldown, 0.3); }
  }

  private tickHurt(d: number): void {
    this.vel.x *= Math.exp(-6 * d); this.vel.z *= Math.exp(-6 * d);
    if (this.ctx.time < this.stunUntil && this.hurtClip === 'stagger') {
      // hold the staggered pose until the stun ends (parry rewards last longer than the clip)
      if (this.anim.finished) this.anim.play('stagger', { fade: 0.05, restart: true, from: 24 });
      return;
    }
    if (this.anim.finished) { this.cooldown = Math.max(this.cooldown, 0.25); this.setState('circle'); }
  }

  private releaseToken(): void {
    if (this.holdsToken) { this.ctx.tokens.release(this); this.holdsToken = false; }
  }

  // --- damage --------------------------------------------------------------------------------------------------

  onParried(): void {
    // our own attack was parried: we are exposed
    this.staggerFor(1.1);
  }

  staggerFor(seconds: number, launch = 0): void {
    if (!this.alive) return;
    this.releaseToken();
    this.hurtClip = 'stagger';
    this.stunUntil = this.ctx.time + seconds;
    this.poise = this.def.poise;
    this.setState('hurt');
    this.anim.play('stagger', { fade: 0.04, restart: true });
    if (launch > 0) this.vel.y = launch * 4;
  }

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive) return 'ignored';
    this.alert = 1; this.noticed = true;
    this.lastKnown.copy(hit.attacker.pos); this.hasLastKnown = true;
    const toAtk = this.tmpA.set(hit.attacker.pos.x - this.pos.x, 0, hit.attacker.pos.z - this.pos.z).normalize();
    const facing = this.forward(this.want).dot(toAtk) > 0.2;
    if (this.state === 'block' && facing && !hit.unblockable) {
      if (hit.guardbreak) { this.staggerFor(1.4); this.applyDamage(hit.damage * 0.6, hit); return this.alive ? 'hit' : 'killed'; }
      this.applyDamage(hit.damage * 0.12, hit);
      this.vel.x += hit.dir.x * 2.4; this.vel.z += hit.dir.z * 2.4;
      this.anim.play('block_hit', { fade: 0.03, restart: true });
      return this.alive ? 'blocked' : 'killed';
    }
    // attacks from behind do extra damage
    const behind = this.forward(this.want).dot(toAtk) < -0.3 ? 1.25 : 1;
    this.applyDamage(hit.damage * behind, hit);
    if (!this.alive) return 'killed';
    this.poise -= hit.stagger * (this.def.armored ? 0.35 : 1) * 6;
    const heavyReact = hit.heavy || hit.launch > 0 || this.poise <= 0;
    if (this.def.armored && !heavyReact) { /* armoured units shrug off light hits */ this.vel.x += hit.dir.x * 0.6; this.vel.z += hit.dir.z * 0.6; return 'hit'; }
    this.releaseToken();
    this.curAttack = null;
    this.hurtClip = hit.launch > 0 ? 'stagger' : heavyReact ? 'hit_heavy' : 'hit_light';
    if (this.poise <= 0) { this.poise = this.def.poise; this.hurtClip = 'stagger'; this.stunUntil = this.ctx.time + 1.0; }
    this.setState('hurt');
    this.anim.play(this.hurtClip, { fade: 0.03, restart: true });
    const k = heavyReact ? 4.2 : 2.2;
    this.vel.x = hit.dir.x * k; this.vel.z = hit.dir.z * k;
    if (hit.launch > 0) this.vel.y = hit.launch * 5.5;
    this.face(1, -hit.dir.x, -hit.dir.z, 1.4);
    return 'hit';
  }

  private applyDamage(n: number, hit: HitInfo): void {
    this.health -= n;
    if (this.health <= 0) this.die(hit);
  }

  private die(hit: HitInfo): void {
    this.alive = false;
    this.releaseToken();
    this.state = 'dead';
    this.deadT = 0;
    this.anim.play('defeat', { fade: 0.05, restart: true });
    this.vel.x = hit.dir.x * 3; this.vel.z = hit.dir.z * 3;
    this.onDeath?.(this);
  }

  get isCorpseExpired(): boolean { return !this.alive && this.deadT > 12; }

  // --- physics -------------------------------------------------------------------------------------------------

  private integrate(d: number): void {
    if (!this.grounded) this.vel.y = Math.max(-30, this.vel.y - 24 * d);
    else if (this.vel.y <= 0) this.vel.y = -2;
    const res = this.ctx.physics.move(this.body, new THREE.Vector3(this.vel.x * d, this.vel.y * d, this.vel.z * d));
    this.grounded = res.grounded;
    if (this.grounded && this.vel.y < 0) this.vel.y = -2;
    this.syncFromBody();
  }

  // --- rewind --------------------------------------------------------------------------------------------------

  snapshot(): EnemySnapshot {
    return { pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, health: this.health, alive: this.alive, poise: this.poise,
      state: this.state, stateT: this.stateT, clip: this.anim.current, frame: this.anim.frame };
  }

  restore(s: EnemySnapshot): void {
    this.pos.set(...s.pos); this.prev.copy(this.pos); this.yaw = this.prevYaw = s.yaw;
    this.health = s.health; this.alive = s.alive; this.poise = s.poise;
    this.state = s.state; this.stateT = s.stateT;
    this.vel.set(0, 0, 0);
    this.ctx.physics.teleport(this.body, this.pos);
    if (s.clip) this.anim.restore(s.clip, s.frame);
    if (this.alive) this.deadT = 0;
    this.releaseToken();
    this.curAttack = null;
  }

  dispose(): void {
    this.releaseToken();
    super.dispose();
  }
}

/** Archetypes. Visual identity comes from the model; the numbers and attack sets are what make them play differently. */
export const ENEMIES: Record<string, EnemyDef> = {
  trooper: {
    id: 'trooper', display: 'HELIX Security', model: 'characters/ethan.glb', health: 56, poise: 14, runSpeed: 4.0, circleSpeed: 1.7,
    aggroRange: 16, fov: Math.PI * 1.1, guardChance: 0.35, circleRange: [1.9, 3.2],
    attacks: [
      { clip: 'light1', min: 0.8, max: 2.4, weight: 3, cooldown: 1.2, then: 'light2' },
      { clip: 'light4', min: 1.2, max: 2.6, weight: 1.2, cooldown: 1.6 },
      { clip: 'heavy1', min: 1.0, max: 2.4, weight: 0.8, cooldown: 2.2 },
    ],
  },
  operative: {
    id: 'operative', display: 'Temporal Operative', model: 'characters/ethan.glb', health: 40, poise: 10, runSpeed: 6.0, circleSpeed: 2.6,
    aggroRange: 18, fov: Math.PI * 1.3, guardChance: 0.1, circleRange: [1.7, 3.0], evades: true, power: 0.85,
    attacks: [
      { clip: 'light1', min: 0.8, max: 3.2, weight: 3, cooldown: 0.7, then: 'light2' },
      { clip: 'light3', min: 0.8, max: 2.4, weight: 1.5, cooldown: 1.0 },
      { clip: 'light4', min: 1.2, max: 3.0, weight: 1.5, cooldown: 1.1 },
    ],
  },
  heavy: {
    id: 'heavy', display: 'Armored Guard', model: 'characters/ethan.glb', health: 130, poise: 40, runSpeed: 3.0, circleSpeed: 1.3, scale: 1.12,
    aggroRange: 14, fov: Math.PI, guardChance: 0.7, armored: true, power: 1.4, circleRange: [1.9, 3.0],
    attacks: [
      { clip: 'heavy1', min: 1.2, max: 2.6, weight: 2, cooldown: 2.6 },
      { clip: 'heavy2', min: 1.2, max: 2.8, weight: 1.5, cooldown: 3.0 },
      { clip: 'light1', min: 0.8, max: 2.2, weight: 1, cooldown: 1.8 },
    ],
  },
};

void timeScale;
