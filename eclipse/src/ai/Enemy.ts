import { Quaternion, Vector3, type Scene } from '@babylonjs/core';
import type { CrowdAgent } from '@recast-navigation/core';
import type { Character } from '../character/Character';
import type { CombatWorld, HitEvent } from '../combat/CombatWorld';
import type { Combatant, DamageInfo, HitResult, HurtCapsule, Team } from '../combat/Types';
import { Stats } from '../combat/Stats';
import { MeleeSweep, type Segment } from '../combat/MeleeSweep';
import type { Projectiles } from '../combat/Projectiles';
import type { Hazards } from '../combat/Hazards';
import { WEAPONS, type WeaponSpec } from '../character/Weapons';
import type { ClipEvent } from '../anim/Clip';
import { measureReach, type Reach } from '../anim/Reach';
import type { Physics } from '../physics/Physics';
import { Layer } from '../physics/Physics';
import type { Vfx, FxHandle } from '../vfx/Vfx';
import type { GroundFx } from '../vfx/GroundFx';
import type { Navigation } from './Navigation';
import type { AiDirector, Tactical } from './AiDirector';
import type { EnemyArchetype, EnemyAttack } from './Archetypes';
import { EventBus } from '../core/Events';

/** Everything an enemy needs from the world around it. */
export interface AiContext {
  scene: Scene;
  world: CombatWorld;
  nav: Navigation | null;
  director: AiDirector;
  physics: Physics;
  vfx: Vfx;
  ground: GroundFx;
  projectiles: Projectiles;
  hazards: Hazards;
  player(): (Combatant & { busy?: boolean; sprint?: boolean }) | null;
  /** Camera shake for big impacts near the player (0..1). */
  shake(amount: number): void;
}

export type EnemyState =
  | 'idle' | 'patrol' | 'search' | 'return' | 'combat' | 'attack' | 'block' | 'blockHit' | 'dodge' | 'hit'
  | 'stun' | 'knockdown' | 'getup' | 'executed' | 'dead' | 'taunt';

export interface EnemyEvents {
  alerted: { target: Combatant };
  attack: { attack: EnemyAttack };
  hurt: { info: DamageInfo; result: HitResult };
  died: { killer: Combatant | null };
  removed: Record<string, never>;
}

type Tactic = 'approach' | 'circle' | 'retreat' | 'hold';

const DEFAULT_WEAPON: WeaponSpec = WEAPONS.oathkeeper;

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * A data-driven enemy (see Archetypes). It perceives the player by sight (view cone + line of sight)
 * and hearing, alerts its group, and fights through the AI director: it takes an attack token before
 * pressing in, otherwise circles in a slot round the player or backs off; attacks are chosen by
 * utility (range, angle, cooldowns, a little randomness) and can chain. It reads the player's swings
 * to block or sidestep, flinches unless armoured (and breaks out of hit-lock with armour), staggers
 * into an executable stun when its poise breaks, and dissolves into ash when it dies.
 *
 * Walking uses a Detour crowd agent (paths, avoidance, separation); authored actions move it by
 * their root motion, kept on the navmesh.
 */
export class Enemy implements Combatant, Tactical {
  readonly id: number;
  readonly team: Team = 'enemy';
  readonly name: string;
  readonly radius: number;
  readonly height: number;
  readonly heavy: boolean;
  readonly targetable = true;
  readonly boss: boolean;
  readonly ranged: boolean;
  readonly stats: Stats;
  readonly events = new EventBus<EnemyEvents>();
  state: EnemyState = 'idle';
  stateTime = 0;
  target: Combatant | null = null;
  attack: EnemyAttack | null = null;
  executable = false;
  /** Patrol route (walked in a loop with pauses); empty = guard the spawn point. */
  patrol: Vector3[] = [];
  removed = false;
  /** Ignores the player until woken (bosses waiting through their introduction). */
  dormant = false;
  protected tactic: Tactic = 'approach';
  private agent: CrowdAgent | null = null;
  protected cooldowns = new Map<string, number>();
  protected time = 0;
  protected thinkAt = 0;
  private perceiveAt = Math.random() * 0.2;
  private lastSeen = -99;
  private readonly lastKnown = new Vector3();
  private readonly home: Vector3;
  private readonly homeYaw: number;
  private patrolIdx = 0;
  private waitUntil = 0;
  protected sweep = new MeleeSweep();
  private hurt: HurtCapsule[];
  private weapon: WeaponSpec;
  private flinchTimes: number[] = [];
  protected armourUntil = 0;
  private blockUntil = 0;
  private reactAt = -1;
  private reaction: 'block' | 'dodge' | null = null;
  protected iframesUntil = 0;
  private locoMode: 'free' | 'combat' | '' = '';
  private deathAt = 0;
  private deathFx: FxHandle | null = null;
  private executioner: Combatant | null = null;
  private moveTarget = new Vector3();
  private hasMoveTarget = false;
  private noTokenSince = 0;
  /** Motion warping for the current attack: measured reach and this step's correction. */
  protected reach: Reach | null = null;
  protected warpEnd = 0;
  protected readonly warp = new Vector3();
  protected readonly scale: number;
  protected tmp = new Vector3();

  constructor(readonly ctx: AiContext, readonly def: EnemyArchetype, readonly char: Character, at: Vector3, yaw: number, name?: string, boss = false) {
    this.id = ctx.world.newId();
    this.boss = boss;
    this.name = name ?? def.name;
    this.scale = def.scale;
    this.radius = def.radius * def.scale;
    this.height = def.height * def.scale;
    this.heavy = def.heavy;
    this.ranged = !!def.ranged;
    this.stats = new Stats({ health: def.health, stamina: def.stamina, poise: def.poise });
    this.stats.poiseDelay = def.heavy ? 3.2 : 2.4;
    if (def.resist) this.stats.resist = { ...def.resist };
    this.weapon = (def.weapon && WEAPONS[def.weapon]) || DEFAULT_WEAPON;
    char.root.scaling.setAll(def.scale);
    char.root.position.copyFrom(at);
    char.yaw = yaw;
    this.home = at.clone();
    this.homeYaw = yaw;
    const r = 0.28 * def.scale;
    this.hurt = [
      { a: new Vector3(), b: new Vector3(), radius: r, mult: 1, part: 'body' },
      { a: new Vector3(), b: new Vector3(), radius: r * 0.62, mult: 1.25, part: 'head' },
      { a: new Vector3(), b: new Vector3(), radius: r * 0.6, mult: 0.9, part: 'legs' },
    ];
    if (ctx.nav) {
      this.agent = ctx.nav.addAgent(at, { radius: this.radius + 0.1, height: this.height, maxSpeed: def.run, maxAcceleration: 16, separation: 2.5 });
      const p = this.agent.position();
      char.root.position.set(p.x, p.y, p.z);
    }
    this.setLoco('free');
    ctx.world.add(this);
    ctx.director.add(this);
  }

  // ------------------------------------------------------------------ Combatant
  get position(): Vector3 {
    return this.char.root.position;
  }

  get alive(): boolean {
    return this.stats.alive;
  }

  get engaged(): boolean {
    return this.alive && this.target !== null && this.state !== 'idle' && this.state !== 'patrol' && this.state !== 'return' && this.state !== 'search';
  }

  aimPoint(out: Vector3): Vector3 {
    return out.copyFrom(this.position).addInPlaceFromFloats(0, this.height * 0.62, 0);
  }

  hurtboxes(): HurtCapsule[] {
    const c = this.char;
    const [body, head, legs] = this.hurt;
    c.bonePosition('pelvis', body.a);
    c.bonePosition('neck_01', body.b);
    head.a.copyFrom(body.b);
    c.bonePosition('head', head.b);
    head.b.y += 0.1 * this.scale;
    c.bonePosition('calf_l', legs.a);
    c.bonePosition('calf_r', legs.b);
    legs.a.y = legs.b.y = this.position.y + 0.25 * this.scale;
    return this.hurt;
  }

  // ------------------------------------------------------------------ helpers
  protected clip(name: string, fallback?: string): string {
    const clips = this.char.animator.clips;
    if (clips.has(name)) return name;
    if (fallback && clips.has(fallback)) return fallback;
    return 'idle';
  }

  protected setLoco(mode: 'free' | 'combat'): void {
    if (this.locoMode === mode) return;
    this.locoMode = mode;
    const a = this.char.animator;
    const l = this.def.loco ?? {};
    if (mode === 'free') {
      a.strafing = false;
      a.setLocomotion([
        { clip: this.clip(l.idle ?? 'idle'), speed: 0 },
        { clip: this.clip(l.walk ?? 'walk', 'walk'), speed: 1.6 * this.scale },
        { clip: this.clip(l.run ?? 'run', 'run'), speed: 5.0 * this.scale },
      ]);
    } else {
      a.setLocomotion([{ clip: this.clip(l.combatIdle ?? 'idle_combat', 'idle'), speed: 0 }, { clip: 'guard_fwd', speed: 1.9 * this.scale }]);
      a.setStrafe({ fwd: 'guard_fwd', back: 'guard_back', left: 'guard_left', right: 'guard_right' });
      a.strafing = true;
    }
  }

  protected dist(c: Combatant): number {
    const dx = c.position.x - this.position.x;
    const dz = c.position.z - this.position.z;
    return Math.max(0, Math.sqrt(dx * dx + dz * dz) - this.radius - c.radius);
  }

  protected angleTo(p: Vector3): number {
    const want = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    return Math.abs(wrapAngle(want - this.char.yaw));
  }

  protected turnTowards(yaw: number, dt: number, rate: number): void {
    const cur = this.char.yaw;
    const d = wrapAngle(yaw - cur);
    this.char.yaw = cur + Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }

  protected face(p: Vector3, dt: number, rate: number): void {
    this.turnTowards(Math.atan2(p.x - this.position.x, p.z - this.position.z), dt, rate);
  }

  protected setState(s: EnemyState): void {
    this.state = s;
    this.stateTime = 0;
  }

  protected moveTo(p: Vector3, speed: number): void {
    this.hasMoveTarget = true;
    this.moveTarget.copyFrom(p);
    if (this.agent) {
      this.agent.updateParameters({ maxSpeed: speed });
      this.agent.requestMoveTarget(p);
    } else {
      this.directSpeed = speed;
    }
  }

  private directSpeed = 0;

  protected stop(): void {
    this.hasMoveTarget = false;
    this.agent?.resetMoveTarget();
    this.agent?.updateParameters({ maxSpeed: 0.01 });
    this.directSpeed = 0;
  }

  private get inAction(): boolean {
    return this.state === 'attack' || this.state === 'dodge' || this.state === 'hit' || this.state === 'stun' || this.state === 'knockdown' ||
      this.state === 'getup' || this.state === 'executed' || this.state === 'dead' || this.state === 'blockHit' || this.state === 'taunt';
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    if (this.removed) return;
    this.time += dt;
    this.stateTime += dt;
    this.stats.update(dt, this.state === 'block' ? 0.4 : 1);
    if (this.state === 'dead') {
      this.deathTick();
    } else {
      this.perceive();
      this.behave(dt);
    }
    this.move(dt);
    this.updateWeapon();
    this.char.update(dt);
  }

  // ------------------------------------------------------------------ perception
  private canSee(t: Combatant): boolean {
    const d = Vector3.Distance(t.position, this.position);
    if (d > this.def.sight) return false;
    if (d > 2.5 && this.angleTo(t.position) > this.def.fov / 2) return false;
    const eye = this.position.add(new Vector3(0, this.height * 0.9, 0));
    const at = t.aimPoint(this.tmp);
    const ray = this.ctx.physics.raycast(eye, at, Layer.World);
    // the ray may end on the target's own collider: only something well before it blocks the view
    return !ray.hit || ray.distance > Vector3.Distance(eye, at) - t.radius - 0.6;
  }

  private perceive(): void {
    if (this.dormant || this.time < this.perceiveAt) return;
    this.perceiveAt = this.time + 0.15 + Math.random() * 0.1;
    const p = this.ctx.player();
    if (!p || !p.alive) {
      if (this.engaged) this.disengage();
      return;
    }
    const passive = this.state === 'idle' || this.state === 'patrol' || this.state === 'return' || this.state === 'search';
    if (passive) {
      const d = Vector3.Distance(p.position, this.position);
      if (this.canSee(p)) return this.engage(p, true);
      const loud = p.sprint || p.busy;
      if (d < this.def.hearing * (loud ? 1 : 0.4)) {
        // heard something: turn and go look
        this.lastKnown.copyFrom(p.position);
        if (this.state !== 'search') this.setState('search');
      }
      return;
    }
    if (this.target && this.canSee(this.target)) {
      this.lastSeen = this.time;
      this.lastKnown.copyFrom(this.target.position);
    } else if (this.target && this.time - this.lastSeen > 7) {
      this.ctx.director.release(this);
      this.target = null;
      this.setState('search');
    }
    if (this.target && Vector3.Distance(this.target.position, this.home) > 60) this.disengage();
  }

  /** Called by the director when a nearby ally spots the player. */
  alert(_source: Vector3, target: Combatant): void {
    if (!this.alive || this.engaged) return;
    this.engage(target, false);
  }

  private engage(t: Combatant, spotted: boolean): void {
    this.target = t;
    this.lastSeen = this.time;
    this.lastKnown.copyFrom(t.position);
    this.thinkAt = this.time + 0.3 + Math.random() * 0.4;
    this.tactic = 'approach';
    this.events.emit('alerted', { target: t });
    if (spotted) this.ctx.director.alertAround(this.position, 16, t);
    // a moment of recognition: face the threat before charging
    if (spotted && this.char.animator.clips.has('e_alert')) {
      this.setState('taunt');
      this.stop();
      this.char.animator.play('e_alert', { fade: 0.15, onEnd: () => this.toCombat() });
    } else {
      this.toCombat();
    }
  }

  private disengage(): void {
    this.ctx.director.release(this);
    this.target = null;
    this.setState('return');
  }

  // ------------------------------------------------------------------ behaviour
  private behave(dt: number): void {
    switch (this.state) {
      case 'idle':
        this.setLoco('free');
        if (this.patrol.length && this.time > this.waitUntil) this.setState('patrol');
        else this.turnTowards(this.homeYaw, dt, 2);
        break;
      case 'patrol': {
        this.setLoco('free');
        const goal = this.patrol[this.patrolIdx % this.patrol.length];
        if (Vector3.Distance(goal, this.position) < 0.6) {
          this.patrolIdx++;
          this.waitUntil = this.time + 1.5 + Math.random() * 2.5;
          this.stop();
          this.setState('idle');
        } else {
          this.moveTo(goal, this.def.walk);
        }
        break;
      }
      case 'search':
        this.setLoco('free');
        if (Vector3.Distance(this.lastKnown, this.position) < 1.2 || this.stateTime > 10) {
          this.stop();
          if (this.stateTime > 3) this.setState('return');
        } else {
          this.moveTo(this.lastKnown, this.stateTime < 4 ? this.def.run * 0.7 : this.def.walk);
        }
        break;
      case 'return':
        this.setLoco('free');
        if (Vector3.Distance(this.home, this.position) < 0.8) {
          this.stop();
          this.stats.heal(this.stats.maxHealth);
          this.setState('idle');
        } else {
          this.moveTo(this.home, this.def.walk * 1.3);
        }
        break;
      case 'combat':
        this.combat(dt);
        break;
      case 'attack':
        this.attackTick(dt);
        break;
      case 'block':
        if (this.target) this.face(this.target.position, dt, 8);
        this.stop();
        if (this.time > this.blockUntil) this.toCombat();
        break;
      default:
        break;
    }
    // queued defensive reaction (after a human-like reaction delay)
    if (this.reaction && this.time >= this.reactAt) {
      const r = this.reaction;
      this.reaction = null;
      if (this.state === 'combat') {
        if (r === 'block') this.startBlock();
        else this.dodge();
      }
    }
  }

  protected combat(dt: number): void {
    const t = this.target;
    if (!t || !t.alive) return this.disengage();
    const d = this.dist(t);
    const close = d < 6;
    this.setLoco(close ? 'combat' : 'free');
    if (this.time >= this.thinkAt) {
      this.thinkAt = this.time + 0.22 + Math.random() * 0.25;
      this.decide(t, d);
      if (this.state !== 'combat') return;
    }
    // execute the current tactic
    switch (this.tactic) {
      case 'approach': {
        const run = d > 5;
        this.moveTo(t.position, run ? this.def.run : 1.9 * this.scale);
        break;
      }
      case 'circle': {
        const slot = this.ctx.director.slot(this, t, this.def.holdRange + this.radius + t.radius, this.tmp);
        if (this.ctx.nav) this.ctx.nav.closest(slot, slot);
        this.moveTo(slot, Vector3.Distance(slot, this.position) > 4 ? this.def.run * 0.8 : this.def.strafe * this.scale);
        break;
      }
      case 'retreat': {
        const away = this.position.subtract(t.position);
        away.y = 0;
        away.normalize().scaleInPlace(3);
        const dest = this.position.add(away);
        if (this.ctx.nav) this.ctx.nav.closest(dest, dest);
        this.moveTo(dest, 1.9 * this.scale);
        break;
      }
      case 'hold':
        this.stop();
        break;
    }
    // face the target while fighting at close range; face the path when running in
    if (close || this.tactic !== 'approach') this.face(t.position, dt, 6);
  }

  protected decide(t: Combatant, d: number): void {
    const dir = this.ctx.director;
    const atk = this.pickAttack(t, d);
    if (atk) {
      if (dir.request(this, t)) {
        this.noTokenSince = this.time;
        if (this.inRange(atk, t, d)) return this.startAttack(atk);
        this.tactic = 'approach';
        return;
      }
    } else if (dir.holds(this)) {
      // holding a token without anything usable at this range: close the distance (or back off)
      this.tactic = this.ranged && d < 3 ? 'retreat' : 'approach';
      return;
    }
    // waiting for a turn
    if (this.ranged) {
      this.tactic = d < this.def.holdRange * 0.5 ? 'retreat' : d > this.def.holdRange * 1.4 ? 'approach' : 'circle';
      return;
    }
    const waited = this.time - this.noTokenSince;
    if (d < this.def.holdRange - 1) this.tactic = 'retreat';
    else if (waited > 5 && Math.random() < this.def.aggression * 0.3) this.tactic = 'approach';
    else this.tactic = Math.random() < 0.15 ? 'hold' : 'circle';
  }

  protected inRange(a: EnemyAttack, t: Combatant, d: number): boolean {
    return d >= a.range[0] && d <= a.range[1] && this.angleTo(t.position) <= (a.angle ?? 1.2);
  }

  protected pickAttack(t: Combatant, d: number): EnemyAttack | null {
    let best: EnemyAttack | null = null;
    let bestScore = 0;
    for (const a of this.def.attacks) {
      if (a.score <= 0) continue;
      if ((this.cooldowns.get(a.id) ?? 0) > this.time) continue;
      // rate how well the current distance fits: inside the band is best, a little outside still ok
      const [lo, hi] = a.range;
      const miss = d < lo ? lo - d : d > hi ? d - hi : 0;
      if (miss > 2.5) continue;
      let s = a.score * (miss > 0 ? 0.5 / (1 + miss) : 1);
      // a target far off to the side needs turning first: prefer moves that track well
      if (this.angleTo(t.position) > (a.angle ?? 1.2)) s *= Math.min(1, a.track / 10);
      // armoured, heavy moves are favoured when being hit a lot
      if (a.armour && this.recentFlinches() >= 2) s *= 2;
      s *= 0.75 + Math.random() * 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    // occasionally hold back even when an attack is ready (less aggressive enemies)
    if (best && Math.random() > 0.35 + this.def.aggression * 0.65) return null;
    return best;
  }

  // ------------------------------------------------------------------ attacking
  protected startAttack(a: EnemyAttack): void {
    const t = this.target;
    this.attack = a;
    this.setState('attack');
    this.stop();
    this.sweep.reset();
    this.cooldowns.set(a.id, this.time + a.cooldown);
    if (t) {
      const to = t.position.subtract(this.position);
      // snap most of the way to the target: enemies commit to where the player is
      const want = Math.atan2(to.x, to.z);
      this.char.yaw = this.char.yaw + wrapAngle(want - this.char.yaw) * 0.6;
    }
    const clip = this.clip(a.clip, a.fallback);
    const c = this.char.animator.clips.get(clip);
    const hitOn = c.events.find((e) => e.name === 'hit_on' || e.name === 'release' || e.name === 'impact');
    const speed = a.speed ?? 1;
    const seg = a.hit?.kind === 'bones' ? { bones: a.hit.pairs[0] } : { socket: 'weapon_r', base: this.weapon.base, tip: this.weapon.tip };
    this.reach = a.hit?.kind === 'none' ? null : measureReach(this.char, clip, seg);
    this.warpEnd = this.reach ? this.reach.hitOn / speed : 0;
    if (a.tell && hitOn) {
      // the tell flashes ~0.35 s before the blow lands (scaled by the swing speed)
      const at = Math.max(0, hitOn.t / speed - 0.38);
      this.ctx.hazards.after(at, () => {
        if (this.state === 'attack' && this.attack === a) this.ctx.vfx.burst(a.tell === 'red' ? 'tellRed' : 'tellGlint', this.blade()[0].b);
      });
    }
    this.char.animator.play(clip, {
      fade: 0.12,
      speed,
      onEvent: (e) => this.onClipEvent(e),
      onEnd: () => { if (this.state === 'attack' && this.attack === a) this.endAttack(); },
    });
    this.events.emit('attack', { attack: a });
  }

  protected attackTick(dt: number): void {
    const a = this.attack;
    this.warp.setAll(0);
    if (!a || !this.target) return;
    const t = this.target;
    if (this.stateTime < a.trackTime) this.face(t.position, dt, a.track);
    // motion warping: through the wind-up, close (or open) the gap so the blow lands at the
    // distance the clip actually reaches, the way the animation was meant to connect
    if (this.reach && this.stateTime < this.warpEnd && this.angleTo(t.position) < 1.0) {
      const to = t.position.subtract(this.position);
      to.y = 0;
      const d = to.length();
      const lunge = a.lunge ?? 1;
      // contact includes the clip's own travel, which lunges stretch
      const reach = (this.reach.contact + Math.max(0, this.reach.travel) * (lunge - 1)) * this.scale;
      const ideal = Math.max(this.radius + t.radius + 0.15, reach - 0.1);
      const left = Math.max(dt, this.warpEnd - this.stateTime);
      const maxV = lunge > 1 ? 7 : 3.2;
      const v = Math.max(-1.5, Math.min(maxV, (d - ideal) / left));
      if (d > 1e-3) this.warp.copyFrom(to.scaleInPlace((v * dt) / d));
    }
  }

  protected endAttack(): void {
    const a = this.attack;
    this.attack = null;
    this.sweep.end();
    const t = this.target;
    if (a?.next && t && t.alive && Math.random() < (a.chain ?? 0)) {
      const d = this.dist(t);
      const options = a.next.map((id) => this.def.attacks.find((x) => x.id === id)).filter((x): x is EnemyAttack => !!x && d <= x.range[1] + 0.5);
      if (options.length) return this.startAttack(options[Math.floor(Math.random() * options.length)]);
    }
    this.ctx.director.release(this);
    this.toCombat();
    // after a committed attack, a short pause before thinking again (an opening for the player)
    this.thinkAt = this.time + 0.35 + (1 - this.def.aggression) * 0.6;
  }

  protected onClipEvent(e: ClipEvent): void {
    const a = this.attack;
    switch (e.name) {
      case 'hit_on':
        if (a && a.hit?.kind !== 'none') this.sweep.begin();
        break;
      case 'hit_off':
        this.sweep.end();
        break;
      case 'impact':
        if (a?.impact) this.impact(a);
        break;
      case 'release':
        if (a?.projectile) this.fireProjectile(a);
        if (a?.eruption) this.erupt(a);
        break;
      case 'iframes_on':
        this.iframesUntil = this.time + 0.3;
        break;
      case 'iframes_off':
        this.iframesUntil = 0;
        break;
      case 'end':
        if (this.state === 'attack') this.endAttack();
        else if (this.state === 'dodge' || this.state === 'hit' || this.state === 'getup' || this.state === 'blockHit') this.toCombat();
        break;
      default:
        break;
    }
  }

  protected makeDamage(a: EnemyAttack, victim: Combatant, point: Vector3, scale = 1): DamageInfo {
    const dir = victim.position.subtract(this.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2),
      poise: a.poise * scale,
      element: a.element ?? 'physical',
      direction: dir,
      point,
      source: this,
      weight: a.weight,
      knockback: a.knockback,
      knockdown: a.knockdown,
      unblockable: a.unblockable,
      parryable: a.parryable,
      ranged: !!a.projectile || !!a.eruption,
      status: a.status,
      tag: a.id,
    };
  }

  /** Blade (or limb) segments in world space for the current attack. */
  protected blade(): Segment[] {
    const a = this.attack;
    if (a?.hit?.kind === 'bones') {
      return a.hit.pairs.map(([p, q]) => ({ a: this.char.bonePosition(p), b: this.char.bonePosition(q) }));
    }
    const s = this.char.socket('weapon_r');
    s.computeWorldMatrix(true);
    const m = s.getWorldMatrix();
    return [{
      a: Vector3.TransformCoordinates(new Vector3(0, this.weapon.base, 0), m),
      b: Vector3.TransformCoordinates(new Vector3(0, this.weapon.tip, 0), m),
    }];
  }

  private updateWeapon(): void {
    const a = this.attack;
    if (!a || !this.sweep.active || this.state !== 'attack') return;
    const r = a.hit?.kind === 'bones' ? a.hit.radius * this.scale : this.weapon.radius * this.scale;
    const hits = this.sweep.step(this.ctx.world, this, this.blade(), r, (v, p) => this.makeDamage(a, v, p));
    for (const h of hits) this.onHitLanded(h);
  }

  private onHitLanded(h: HitEvent): void {
    if (h.result === 'parried') {
      // the player parried: reel back, wide open for a riposte
      this.parried();
    } else if (h.result === 'blocked') {
      this.ctx.vfx.burst('blocked', h.info.point, h.info.direction.scale(-1));
    }
  }

  protected impact(a: EnemyAttack): void {
    const imp = a.impact!;
    const f = this.char.forward;
    const c = this.position.add(f.scale(imp.ahead * this.scale));
    c.y = this.position.y;
    if (imp.vfx) this.ctx.vfx.burst(imp.vfx, c, Vector3.Up(), Math.max(0.8, imp.radius / 1.8));
    this.ctx.ground.shockwave(c, imp.radius * 1.5);
    this.ctx.ground.scorch(c, imp.radius * 0.9);
    const hits = this.ctx.world.area(this, this.team, c, imp.radius * this.scale, this.sweep.hits, (v) => {
      const info = this.makeDamage(a, v, v.position, 1);
      return { ...info, amount: imp.damage ?? info.amount * 0.6, parryable: false, ranged: true };
    });
    for (const h of hits) this.onHitLanded(h);
  }

  private fireProjectile(a: EnemyAttack): void {
    const t = this.target;
    const s = this.char.socket('weapon_l');
    s.computeWorldMatrix(true);
    const from = s.getAbsolutePosition().clone();
    if (from.y < this.position.y + 0.8) from.copyFrom(this.position).addInPlaceFromFloats(0, this.height * 0.75, 0).addInPlace(this.char.forward.scale(0.6));
    const aim = t ? t.aimPoint(new Vector3()).subtract(from) : this.char.forward;
    this.ctx.projectiles.fire(a.projectile!, from, aim, this, this.team, (v, p) => this.makeDamage(a, v, p), t);
  }

  private erupt(a: EnemyAttack): void {
    const t = this.target;
    if (!t) return;
    const e = a.eruption!;
    // aim at where the player is heading, not where they stand
    const lead = (t as Combatant & { velocity?: Vector3 }).velocity;
    const at = t.position.clone();
    if (lead) at.addInPlace(lead.scale(e.delay * 0.5));
    if (this.ctx.nav) this.ctx.nav.closest(at, at);
    this.ctx.hazards.eruption(at, e.radius, e.delay, e.vfx, this, this.team, (v) => this.makeDamage(a, v, v.position), { zone: 3 });
  }

  // ------------------------------------------------------------------ defence
  /** The player started a swing; maybe react (called for every enemy in range). */
  threatened(by: Combatant): void {
    if (this.state !== 'combat' || this.reaction || this.target !== by) return;
    const d = this.dist(by);
    if (d > 3.5 || this.angleTo(by.position) > 0.9) return;
    const roll = Math.random();
    if (roll < this.def.block && this.stats.stamina > 15) this.reaction = 'block';
    else if (roll < this.def.block + this.def.dodge) this.reaction = 'dodge';
    else return;
    this.reactAt = this.time + 0.1 + Math.random() * 0.15;
  }

  private startBlock(): void {
    this.setState('block');
    this.stop();
    this.blockUntil = this.time + 0.8 + Math.random() * 0.8;
    this.char.animator.play('block_idle', { fade: 0.08 });
  }

  private dodge(): void {
    const t = this.target;
    const r = Math.random();
    const clip = r < 0.4 ? 'dodge_b' : r < 0.7 ? 'dodge_l' : 'dodge_r';
    this.setState('dodge');
    this.stop();
    if (t) this.char.yaw = Math.atan2(t.position.x - this.position.x, t.position.z - this.position.z);
    this.char.animator.play(clip, { fade: 0.06, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'dodge') this.toCombat(); } });
  }

  private parried(): void {
    this.attack = null;
    this.sweep.end();
    this.ctx.director.release(this);
    this.setState('stun');
    this.executable = false;
    this.char.animator.play('guard_break', { fade: 0.05, onEnd: () => { if (this.state === 'stun') this.recover(); } });
  }

  // ------------------------------------------------------------------ being hit
  receive(hit: DamageInfo, part: HurtCapsule | null): HitResult {
    if (!this.alive || this.removed) return 'immune';
    if (this.state === 'executed' && hit.source !== this.executioner) return 'immune';
    if (this.time < this.iframesUntil) return 'dodged';
    if (!this.target && hit.source && hit.source.team !== this.team) this.engage(hit.source, true);
    const toSource = hit.direction.scale(-1);
    const fromFront = Vector3.Dot(toSource, this.char.forward) > 0.2;
    if (this.state === 'block' && fromFront && !hit.unblockable) {
      this.stats.drain(hit.amount * 0.6 + hit.poise * 0.5);
      if (this.stats.stamina <= 0) {
        // guard broken: a short, executable stagger
        this.stun(1.6);
        return 'guardbreak';
      }
      this.setState('blockHit');
      this.char.animator.play('block_hit', { fade: 0.04, onEnd: () => { if (this.state === 'blockHit') this.startBlock(); } });
      this.ctx.vfx.burst('blocked', hit.point, hit.direction.scale(-1));
      return 'blocked';
    }
    const mult = (part?.mult ?? 1) * (this.stats.resist[hit.element] ?? 1);
    // hits from behind and on stunned enemies hurt more
    const back = fromFront ? 1 : 1.2;
    const amount = hit.amount * mult * back * (this.state === 'stun' ? 1.3 : 1);
    this.stats.damage(amount);
    hit.amount = amount;
    if (!this.stats.alive) {
      this.die(hit);
      this.events.emit('hurt', { info: hit, result: 'killed' });
      return 'killed';
    }
    if (this.state === 'executed') return 'hit';
    const broke = this.state !== 'stun' && this.stats.poiseDamage(hit.poise);
    if (broke && this.def.executable) {
      this.stun(2.6);
      this.events.emit('hurt', { info: hit, result: 'staggered' });
      return 'staggered';
    }
    if (this.state === 'stun') return 'hit';
    const armoured = this.time < this.armourUntil || (this.state === 'attack' && this.attack?.armour);
    if (hit.knockdown && !this.heavy && !armoured) {
      this.knockdown(hit.direction);
    } else if (!armoured && !(this.heavy && hit.weight < 0.55)) {
      this.flinch(hit);
    }
    this.events.emit('hurt', { info: hit, result: 'hit' });
    return 'hit';
  }

  protected recentFlinches(): number {
    this.flinchTimes = this.flinchTimes.filter((t) => this.time - t < 2.5);
    return this.flinchTimes.length;
  }

  protected flinch(hit: DamageInfo): void {
    this.flinchTimes.push(this.time);
    if (this.attack) this.ctx.director.release(this);
    this.attack = null;
    this.sweep.end();
    this.reaction = null;
    // stun-lock breaker: after a few flinches in a row it powers through the next hits
    if (this.recentFlinches() >= 3) {
      this.armourUntil = this.time + 1.6;
      this.thinkAt = this.time + 0.25;
      this.flinchTimes = [];
    }
    const yaw = this.char.yaw;
    const d = hit.direction;
    const lx = Math.cos(yaw) * d.x - Math.sin(yaw) * d.z;
    const lz = Math.sin(yaw) * d.x + Math.cos(yaw) * d.z;
    const clip = Math.abs(lz) > Math.abs(lx) ? (lz > 0 ? 'hit_back' : 'hit_front') : (lx > 0 ? 'hit_left' : 'hit_right');
    this.setState('hit');
    this.stop();
    this.char.animator.play(clip, { fade: 0.04, speed: 1.15, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'hit') this.toCombat(); } });
  }

  protected stun(seconds: number): void {
    this.attack = null;
    this.sweep.end();
    this.reaction = null;
    this.ctx.director.release(this);
    this.setState('stun');
    this.stop();
    this.executable = this.def.executable;
    const a = this.char.animator;
    a.play('stagger', {
      fade: 0.05,
      onEnd: () => {
        if (this.state !== 'stun') return;
        a.play(this.clip('e_stun', 'kneel'), { fade: 0.2 });
      },
    });
    this.ctx.hazards.after(seconds, () => {
      if (this.state === 'stun') this.recover();
    });
  }

  protected recover(): void {
    this.executable = false;
    this.stats.resetPoise();
    this.setState('getup');
    this.char.animator.play('getup', { fade: 0.2, speed: 1.2, onEvent: (e) => this.onClipEvent(e), onEnd: () => { if (this.state === 'getup') this.toCombat(); } });
  }

  protected knockdown(dir: Vector3): void {
    this.attack = null;
    this.sweep.end();
    this.ctx.director.release(this);
    this.setState('knockdown');
    this.stop();
    this.char.yaw = Math.atan2(-dir.x, -dir.z);
    this.char.animator.play('knockdown', {
      fade: 0.05,
      onEnd: () => {
        if (this.state !== 'knockdown') return;
        this.ctx.hazards.after(0.4 + Math.random() * 0.5, () => { if (this.state === 'knockdown') this.recover(); });
      },
    });
  }

  /** The player's riposte / execution has begun on this enemy. */
  beginExecution(by: Combatant): void {
    this.executioner = by;
    this.executable = false;
    this.setState('executed');
    this.stop();
    this.char.yaw = Math.atan2(by.position.x - this.position.x, by.position.z - this.position.z);
    this.char.animator.play(this.clip('e_executed', 'knockdown'), {
      fade: 0.1,
      onEnd: () => {
        this.executioner = null;
        if (this.alive && this.state === 'executed') this.recover();
      },
    });
  }

  protected die(hit: DamageInfo): void {
    this.ctx.director.release(this);
    this.attack = null;
    this.sweep.end();
    this.executable = false;
    this.setState('dead');
    this.deathAt = this.time;
    this.stop();
    if (this.agent && this.ctx.nav) {
      this.ctx.nav.removeAgent(this.agent);
      this.agent = null;
    }
    this.char.yaw = Math.atan2(-hit.direction.x, -hit.direction.z);
    this.char.animator.play('death', { fade: 0.08 });
    this.char.face.set('dead');
    this.events.emit('died', { killer: hit.source });
  }

  private deathTick(): void {
    const t = this.time - this.deathAt;
    if (t > 2.2 && !this.deathFx) this.deathFx = this.ctx.vfx.attach('deathAsh', this.position.clone(), this.scale);
    if (t > 2.2) this.char.setDissolve(Math.min(1, (t - 2.2) / 1.8));
    if (t > 4.2 && !this.removed) this.remove();
  }

  /** Takes the enemy out of the world (after death or when its level unloads). */
  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.deathFx?.stop();
    this.ctx.world.remove(this);
    this.ctx.director.remove(this);
    if (this.agent && this.ctx.nav) this.ctx.nav.removeAgent(this.agent);
    this.agent = null;
    this.char.dispose();
    this.events.emit('removed', {});
  }

  protected toCombat(): void {
    if (!this.alive) return;
    if (!this.target) {
      this.setState('return');
      this.char.animator.stopAction(0.25);
      return;
    }
    this.setState('combat');
    this.char.animator.stopAction(0.25);
  }

  // ------------------------------------------------------------------ movement
  /** The navmesh floats a voxel above the floor; put the feet on the real surface. */
  private snapToGround(pos: Vector3): void {
    const from = this.tmp.set(pos.x, pos.y + 0.6, pos.z);
    const ray = this.ctx.physics.raycast(from, new Vector3(pos.x, pos.y - 0.9, pos.z), Layer.World);
    if (ray.hit) pos.y = ray.point.y;
  }

  private move(dt: number): void {
    const a = this.char.animator;
    const pos = this.position;
    if (this.state !== 'attack') this.warp.setAll(0);
    if (this.inAction || this.state === 'block') {
      // authored motion moves the body; stay on the navmesh
      const rd = a.rootDelta;
      if (rd.lengthSquared() > 1e-10 || this.warp.lengthSquared() > 1e-10) {
        const q = this.char.root.rotationQuaternion ?? Quaternion.Identity();
        const lunge = this.state === 'attack' ? (this.attack?.lunge ?? 1) : 1;
        const w = rd.applyRotationQuaternion(q).scale(this.scale * lunge);
        const dest = pos.add(new Vector3(w.x + this.warp.x, 0, w.z + this.warp.z));
        const p = this.ctx.nav ? this.ctx.nav.slide(pos, dest) : dest;
        pos.copyFrom(p);
        this.snapToGround(pos);
      }
      this.agent?.teleport(pos);
      a.locoSpeed = 0;
      return;
    }
    if (this.agent) {
      const p = this.agent.position();
      pos.set(p.x, p.y, p.z);
      this.snapToGround(pos);
      const v = this.agent.velocity();
      const speed = Math.hypot(v.x, v.z);
      a.locoSpeed = speed;
      if (speed > 0.15) {
        const moveYaw = Math.atan2(v.x, v.z);
        if (a.strafing) {
          a.locoDir = wrapAngle(moveYaw - this.char.yaw);
        } else {
          this.turnTowards(moveYaw, dt, 8);
        }
      }
    } else if (this.hasMoveTarget && this.directSpeed > 0) {
      const to = this.moveTarget.subtract(pos);
      to.y = 0;
      const len = to.length();
      const step = Math.min(len, this.directSpeed * dt);
      if (len > 0.05) {
        pos.addInPlace(to.scale(step / len));
        const ray = this.ctx.physics.raycast(pos.add(new Vector3(0, 1, 0)), pos.add(new Vector3(0, -2, 0)));
        if (ray.hit) pos.y = ray.point.y;
        if (!a.strafing) this.turnTowards(Math.atan2(to.x, to.z), dt, 8);
        else a.locoDir = wrapAngle(Math.atan2(to.x, to.z) - this.char.yaw);
      }
      a.locoSpeed = len > 0.05 ? this.directSpeed : 0;
    } else {
      a.locoSpeed = 0;
    }
  }
}
