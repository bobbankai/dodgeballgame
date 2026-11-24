// A character in the world that can move and fight: model + animator + secondary motion + face, ground
// movement with collision, gravity and jumps, attacks with hit windows, guarding and parrying, dodging
// with invulnerability, hit-stun, launches, knockdowns, get-ups and death (dissolve).
import { Vector3, TransformNode, Quaternion } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';
import type { CharacterModel } from './CharacterModel';
import { Animator, type AnimLibrary } from './Animator';
import { Procedural } from './Procedural';
import type { AttackDef } from '../combat/Attacks';
import type { Game } from './Game';

export type Team = 'player' | 'ally' | 'enemy' | 'neutral';
export type FState = 'idle' | 'attack' | 'dodge' | 'guard' | 'hit' | 'air' | 'knock' | 'down' | 'getup' | 'dead' | 'cine';

export interface AnimSet {
  idle: string; walk: string; run: string; hit: string; hitBack: string; knock: string; getup: string; death: string;
  block: string; air: string; land: string; jump: string; dodge: string; relaxed: string;
}

export const HERO_ANIMS: AnimSet = {
  idle: 'guard', walk: 'walk', run: 'run', hit: 'hit_front', hitBack: 'hit_back', knock: 'knockdown', getup: 'getup',
  death: 'death', block: 'block', air: 'air', land: 'land', jump: 'jump', dodge: 'dodge', relaxed: 'idle',
};

export interface Intent {
  move: Vector3;          // desired world-space move direction * magnitude (0..1)
  run: boolean;
  face?: number;          // desired yaw (radians); otherwise face movement
  guard: boolean;
}

export class Fighter {
  pos = new Vector3();
  vel = new Vector3();
  yaw = 0;
  onGround = true;
  state: FState = 'idle';
  stateT = 0;
  hp = 100;
  maxHp = 100;
  radius = 0.42;
  height = 1.75;
  walkSpeed = 1.7;
  runSpeed = 5.6;
  accel = 28;
  turnRate = 12;
  gravity = 24;
  team: Team = 'enemy';
  name: string;
  anims: AnimSet = HERO_ANIMS;
  animator: Animator;
  proc: Procedural;
  intent: Intent = { move: new Vector3(), run: true, guard: false };
  attack: AttackDef | null = null;
  attackT = 0;
  hitIndex = 0;
  hitSet = new Set<Fighter>();
  invuln = 0;
  guardSince = -1;
  stun = 0;
  armorUntil = 0;
  target: Fighter | null = null;
  lungeDir = new Vector3();
  dissolve = 0;
  removed = false;
  flash = 0;
  poise = 0;               // big enemies ignore stagger until poise breaks
  maxPoise = 0;
  telegraphing = 0;        // seconds of red warning left before an attack starts
  pendingAttack: AttackDef | null = null;
  comboStep = 0;
  airHits = 0;
  weapon: Mesh | TransformNode | null = null;
  boss = false;
  onDeath?: () => void;
  /** hp never drops below this (allies, scripted boss phases); onFloor fires once when it is reached */
  floorHp = 0;
  onFloor?: () => void;
  /** the story needs this one alive (bosses): a fall puts them back on solid ground instead of killing them */
  fallSafe = false;
  /** last place this fighter stood on solid ground */
  readonly lastSafe = new Vector3();
  onHit?: (dmg: number, from: Fighter | null) => void;
  speedScale = 1;
  lastHitBy: Fighter | null = null;
  /** extra visual spin applied on top of yaw (super / spinning attacks) */
  spin = 0;
  controllerTime = 0;

  constructor(readonly game: Game, readonly model: CharacterModel, lib: AnimLibrary, name: string) {
    this.name = name;
    this.animator = new Animator(model, lib);
    this.proc = new Procedural(model);
    this.animator.play(this.anims.idle, { loop: true, fade: 0 });
  }

  get alive(): boolean { return this.state !== 'dead'; }
  get busy(): boolean { return this.state === 'attack' || this.state === 'dodge' || this.state === 'hit' || this.state === 'knock' || this.state === 'down' || this.state === 'getup' || this.state === 'dead' || this.state === 'cine'; }
  get forward(): Vector3 { return new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  /** Where the fighter is turning to face (a pending faceTowards), else where it faces now: shots framed on a
   *  face use this, or an actor still turning toward someone is filmed from behind once the turn ends. */
  get facing(): Vector3 { const y = this.intent.face ?? this.yaw; return new Vector3(Math.sin(y), 0, Math.cos(y)); }
  get center(): Vector3 { return this.pos.add(new Vector3(0, this.height * 0.55, 0)); }

  setState(s: FState): void { this.state = s; this.stateT = 0; }

  place(p: Vector3, yaw = this.yaw): void {
    this.pos.copyFrom(p);
    this.pos.y = this.game.collision.groundAt(p.x, p.z, p.y + 1);
    this.yaw = yaw;
    this.vel.setAll(0);
    this.sync();
  }

  play(clip: string, loop = false, fade = 0.12, speed = 1): void {
    this.animator.play(clip, { loop, fade, speed, restart: !loop });
  }

  faceTowards(p: Vector3, instant = false): void {
    const d = p.subtract(this.pos);
    if (d.x * d.x + d.z * d.z < 1e-6) return;
    const y = Math.atan2(d.x, d.z);
    if (instant) { this.yaw = y; this.intent.face = undefined; } else this.intent.face = y;
  }

  // ------------------------------------------------------------------------------------------ actions
  canAct(): boolean { return this.alive && !this.busy && this.state !== 'air'; }

  startAttack(def: AttackDef): boolean {
    if (!this.alive) return false;
    if (def.cost && this.team === 'player' && this.game.storm < def.cost) return false;
    if (def.cost && this.team === 'player') this.game.storm -= def.cost;
    this.attack = def;
    this.attackT = 0;
    this.hitIndex = 0;
    this.hitSet.clear();
    this.setState('attack');
    if (this.target && this.target.alive) {
      // snap toward the target if roughly in front (soft lock)
      const d = this.target.pos.subtract(this.pos);
      const y = Math.atan2(d.x, d.z);
      const diff = Math.atan2(Math.sin(y - this.yaw), Math.cos(y - this.yaw));
      if (Math.abs(diff) < 1.4 || this.team !== 'player') this.yaw = y;
    }
    this.lungeDir = this.forward;
    this.play(def.clip, false, 0.06, def.speed ?? 1);
    if (def.armor) this.armorUntil = (def.end ?? 1) / (def.speed ?? 1);
    this.game.onAttackStart(this, def);
    return true;
  }

  telegraph(def: AttackDef): void {
    // enemies flash before attacking so the player can read and react
    this.pendingAttack = def;
    this.telegraphing = def.telegraph ?? 0.3;
    this.game.vfx.telegraph(this, def);
  }

  dodge(dir: Vector3): boolean {
    if (!this.canAct() && !(this.state === 'attack' && this.attackT > (this.attack?.combo ?? 99))) return false;
    this.attack = null;
    this.setState('dodge');
    const d = dir.lengthSquared() > 0.01 ? dir.normalizeToNew() : this.forward.scale(-1);
    this.lungeDir = d;
    if (dir.lengthSquared() > 0.01) this.yaw = Math.atan2(d.x, d.z);
    this.invuln = 0.34;
    this.play(this.anims.dodge, false, 0.04, 1.1);
    this.game.sfx('dodge', this.pos);
    this.game.vfx.dust(this.pos, 6);
    return true;
  }

  jump(): boolean {
    if (!this.canAct() || !this.onGround) return false;
    this.vel.y = 9.2;
    this.onGround = false;
    this.airHits = 0;
    this.setState('air');
    this.play(this.anims.jump, false, 0.05);
    this.game.sfx('jump', this.pos);
    return true;
  }

  // ------------------------------------------------------------------------------------------ damage
  /** Returns 'hit' | 'block' | 'parry' | 'immune'. */
  receive(from: Fighter, def: AttackDef, dmgScale = 1): 'hit' | 'block' | 'parry' | 'immune' {
    if (!this.alive || this.invuln > 0) return 'immune';
    const toAtt = from.pos.subtract(this.pos);
    const facing = Vector3.Dot(this.forward, new Vector3(toAtt.x, 0, toAtt.z).normalize()) > 0.25;
    const guarding = this.state === 'guard';
    if (guarding && facing && !def.unblockable) {
      const parryWindow = this.game.time - this.guardSince < 0.2;
      if (parryWindow) return 'parry';
      this.hp -= Math.max(1, Math.round(def.damage * 0.15 * dmgScale));
      this.checkFloor();
      this.vel.addInPlace(toAtt.normalize().scale(-def.knock * 0.4));
      this.stun = 0.2;
      return 'block';
    }
    const dmg = Math.round(def.damage * dmgScale);
    this.hp -= dmg;
    const floored = this.checkFloor();
    this.lastHitBy = from;
    this.flash = 1;
    this.onHit?.(dmg, from);
    const away = new Vector3(-toAtt.x, 0, -toAtt.z).normalize();
    const armored = this.game.time < this.armorUntil || (this.maxPoise > 0 && (this.poise -= dmg) > 0);
    if (this.hp <= 0) {
      this.hp = 0;
      this.die(away.scale(Math.max(def.knock, 4)), def.launch ?? 3);
      return 'hit';
    }
    if (floored) return 'hit';
    if (armored && !def.knockdown) {
      this.animator.addFlinch('chest', Quaternion.RotationAxis(new Vector3(1, 0, 0), -0.18), 0.2);
      return 'hit';
    }
    if (this.maxPoise > 0 && this.poise <= 0) this.poise = this.maxPoise;
    this.attack = null;
    this.pendingAttack = null;
    this.telegraphing = 0;
    this.vel.x = away.x * def.knock;
    this.vel.z = away.z * def.knock;
    if ((def.launch ?? 0) !== 0 || !this.onGround) {
      this.vel.y = def.launch ?? 2;
      if (def.launch && def.launch < 0 && !this.onGround) this.vel.y = def.launch; // spike down
      this.onGround = false;
      this.setState('knock');
      this.play(this.anims.knock, false, 0.05);
    } else if (def.knockdown) {
      this.vel.y = 4;
      this.onGround = false;
      this.setState('knock');
      this.play(this.anims.knock, false, 0.05);
    } else {
      this.setState('hit');
      this.stun = def.stagger;
      const front = Vector3.Dot(this.forward, toAtt) >= 0;
      this.play(front ? this.anims.hit : this.anims.hitBack, false, 0.03);
    }
    return 'hit';
  }

  /** Takes damage that can't kill (falls): stops at the story's health floor, or at 1. */
  hurt(amount: number): void {
    this.hp = Math.max(this.floorHp > 0 ? this.floorHp : 1, this.hp - amount);
    this.checkFloor();
  }

  private checkFloor(): boolean {
    if (this.floorHp <= 0 || this.hp > this.floorHp) return false;
    this.hp = this.floorHp;
    const cb = this.onFloor;
    this.onFloor = undefined;
    cb?.();
    return !!cb;
  }

  die(push: Vector3, up: number): void {
    this.setState('dead');
    this.attack = null;
    this.vel.copyFrom(push);
    this.vel.y = up;
    this.onGround = false;
    this.play(this.anims.knock, false, 0.05);
    this.onDeath?.();
  }

  // ------------------------------------------------------------------------------------------ update
  update(dt: number): void {
    const dts = dt * this.speedScale;
    this.stateT += dts;
    this.controllerTime += dts;
    if (this.invuln > 0) this.invuln -= dts;
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dts * 6);
    const col = this.game.collision;
    // telegraph countdown -> attack
    if (this.telegraphing > 0) {
      this.telegraphing -= dts;
      if (this.state === 'hit' || this.state === 'knock' || !this.alive) { this.telegraphing = 0; this.pendingAttack = null; }
      else if (this.telegraphing <= 0 && this.pendingAttack) { const a = this.pendingAttack; this.pendingAttack = null; this.startAttack(a); }
    }
    const it = this.intent;
    let wantVel = new Vector3();
    switch (this.state) {
      case 'idle':
      case 'guard': {
        const guard = it.guard && this.onGround;
        if (guard && this.state !== 'guard') { this.setState('guard'); this.guardSince = this.game.time; this.play(this.anims.block, true, 0.06); }
        if (!guard && this.state === 'guard') { this.setState('idle'); }
        const sp = this.state === 'guard' ? this.walkSpeed * 0.6 : (it.run ? this.runSpeed : this.walkSpeed);
        wantVel = it.move.scale(sp);
        if (this.state === 'idle') this.locomotionAnim(wantVel.length());
        break;
      }
      case 'attack': {
        const a = this.attack;
        // no move yet: the player is holding heavy to charge (the controller starts the attack on release)
        if (!a) { this.attackT += dts; break; }
        const spd = a.speed ?? 1;
        this.attackT += dts * spd;
        if (a.lunge && a.lungeTime) {
          const [t0, t1] = a.lungeTime;
          if (this.attackT >= t0 && this.attackT <= t1) {
            const v = a.lunge / (t1 - t0);
            // stop short of the target instead of passing through
            let ok = true;
            if (this.target && this.target.alive) {
              const d = Vector3.Distance(this.pos, this.target.pos);
              if (d < this.radius + this.target.radius + 0.35) ok = false;
            }
            if (ok) wantVel = this.lungeDir.scale(v);
          }
        }
        if (a.iframes) this.invuln = this.attackT >= a.iframes[0] && this.attackT <= a.iframes[1] ? 0.05 : this.invuln;
        while (this.hitIndex < a.hit.length && this.attackT >= a.hit[this.hitIndex]) {
          this.game.resolveHit(this, a, this.hitIndex);
          this.hitIndex++;
          this.hitSet.clear();
        }
        if (a.spin) this.spin = (a.spin * Math.PI / 180) * Math.min(1, this.attackT / ((a.end ?? 1) * 0.8));
        if (this.attackT >= (a.end ?? 0.8)) {
          this.attack = null;
          this.spin = 0;
          this.setState(this.onGround ? 'idle' : 'air');
          if (this.onGround) this.locomotionAnim(0, 0.18);
          else this.play(this.anims.air, true, 0.15);
        }
        if (!a.air) this.vel.y = Math.min(this.vel.y, 0);
        break;
      }
      case 'dodge': {
        const t = this.stateT;
        const sp = t < 0.28 ? 11 * (1 - t / 0.34) : 0;
        wantVel = this.lungeDir.scale(sp);
        if (t > 0.42) { this.setState('idle'); this.locomotionAnim(0, 0.12); }
        break;
      }
      case 'hit': {
        this.stun -= dts;
        if (this.stun <= 0) { this.setState('idle'); this.locomotionAnim(0, 0.15); }
        break;
      }
      case 'air': {
        wantVel = it.move.scale(this.runSpeed * 0.8);
        break;
      }
      case 'knock': {
        if (this.onGround && this.stateT > 0.15) { this.setState('down'); this.game.vfx.dust(this.pos, 10); this.game.sfx('thud', this.pos); }
        break;
      }
      case 'down': {
        if (this.stateT > (this.boss ? 0.6 : 0.9)) { this.setState('getup'); this.play(this.anims.getup, false, 0.15); this.invuln = 0.9; }
        break;
      }
      case 'getup': {
        if (this.stateT > 1.0) { this.setState('idle'); this.locomotionAnim(0, 0.2); }
        break;
      }
      case 'dead': {
        if (this.onGround && this.stateT > 1.4) this.dissolve = Math.min(1, this.dissolve + dts * 0.9);
        if (this.dissolve >= 1 && !this.removed) { this.removed = true; this.game.removeFighter(this); }
        break;
      }
      case 'cine': break;
    }
    // horizontal velocity: accelerate toward the wanted velocity (friction when knocked back)
    const grounded = this.onGround;
    if (this.state === 'knock' || this.state === 'dead' || (this.state === 'hit' && this.stateT < 0.12)) {
      const fr = grounded ? 8 : 0.5;
      this.vel.x -= this.vel.x * Math.min(1, fr * dts);
      this.vel.z -= this.vel.z * Math.min(1, fr * dts);
    } else if (this.state === 'down' || this.state === 'getup' || this.state === 'cine') {
      this.vel.x = 0; this.vel.z = 0;
    } else {
      const k = Math.min(1, (grounded ? this.accel : this.accel * 0.3) * dts / Math.max(this.runSpeed, 1));
      this.vel.x += (wantVel.x - this.vel.x) * (this.state === 'attack' || this.state === 'dodge' ? 1 : k * 3);
      this.vel.z += (wantVel.z - this.vel.z) * (this.state === 'attack' || this.state === 'dodge' ? 1 : k * 3);
    }
    // gravity / ground
    if (!grounded) this.vel.y -= this.gravity * dts * (this.state === 'knock' && this.vel.y < 0 ? 1.1 : 1);
    const next = this.pos.add(this.vel.scale(dts));
    if (this.state !== 'dead' && !col.passable(this.pos.x, this.pos.y, this.pos.z, next.x, next.z)) {
      // slide along cliffs and the shoreline
      if (col.passable(this.pos.x, this.pos.y, this.pos.z, next.x, this.pos.z)) next.z = this.pos.z;
      else if (col.passable(this.pos.x, this.pos.y, this.pos.z, this.pos.x, next.z)) next.x = this.pos.x;
      else { next.x = this.pos.x; next.z = this.pos.z; }
    }
    const g = col.groundAt(next.x, next.z, this.pos.y + 0.45);
    if (next.y <= g + 0.001 && this.vel.y <= 0) {
      if (!grounded) this.land();
      next.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (grounded && next.y - g < 0.45 && this.vel.y <= 0) {
      next.y = g; // stick to slopes / steps down
    } else {
      this.onGround = false;
      if (grounded && this.state === 'idle') { this.setState('air'); this.play(this.anims.air, true, 0.2); }
    }
    col.resolve(next, this.radius, this.height);
    this.pos.copyFrom(next);
    if (this.onGround && this.pos.y > col.minY + 0.5) this.lastSafe.copyFrom(this.pos);
    if (this.pos.y < col.minY) this.game.onFall(this);
    // facing
    // (actors held in a cutscene pose still turn when told to face someone)
    if (this.state === 'idle' || this.state === 'guard' || this.state === 'air' || (this.state === 'cine' && it.face !== undefined)) {
      let want = it.face;
      if (want === undefined && it.move.lengthSquared() > 0.01) want = Math.atan2(it.move.x, it.move.z);
      if (want !== undefined) {
        const d = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
        this.yaw += d * Math.min(1, this.turnRate * dts);
      }
    }
    this.animator.update(dts);
    this.sync();
    this.proc.wind.set(this.vel.x * -0.6 + this.game.wind.x, 0, this.vel.z * -0.6 + this.game.wind.z);
    this.proc.update(dts);
    this.model.setFx(this.dissolve, this.flash * 0.65);
  }

  private land(): void {
    this.airHits = 0;
    if (this.state === 'air') {
      this.setState('idle');
      this.play(this.anims.land, false, 0.05);
      this.game.vfx.dust(this.pos, 5);
      this.game.sfx('land', this.pos);
    } else if (this.state === 'knock' || this.state === 'dead') {
      this.game.vfx.dust(this.pos, 12);
      this.game.sfx('thud', this.pos);
      if (this.state === 'knock') { this.setState('down'); }
    } else if (this.state === 'attack' && this.attack?.air) {
      this.game.shake(0.3);
    }
  }

  locomotionAnim(speed: number, fade = 0.2): void {
    const a = this.animator;
    if (speed < 0.25) { a.play(this.game.combatActive || this.team === 'enemy' ? this.anims.idle : this.anims.relaxed, { loop: true, fade }); return; }
    const lib = a.lib;
    if (speed < this.walkSpeed * 1.4) { a.play(this.anims.walk, { loop: true, fade, speed: Math.max(0.5, speed / lib.speed(this.anims.walk, 1.7)) }); return; }
    // captured jog for ordinary runners, the sprint for the quick ones
    const run = speed < 5.0 && this.anims.run === 'run' && a.has('jog') ? 'jog' : this.anims.run;
    a.play(run, { loop: true, fade, speed: Math.max(0.6, speed / lib.speed(run, 5.6)) });
  }

  sync(): void {
    const n = this.model.anchor;
    n.position.copyFrom(this.pos);
    n.rotation.y = this.yaw + this.spin;
  }
}
