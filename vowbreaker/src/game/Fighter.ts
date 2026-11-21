import { Vector3 } from '@babylonjs/core';
import type { Character } from './Character';
import type { Kit, Move } from './Moves';

/** What a fighter wants this frame: from the player's input or from an AI. */
export interface Command {
  /** desired movement direction in world space (xz), length 0..1 */
  move: Vector3;
  light: boolean;
  heavy: boolean;
  guard: boolean;
  /** guard was pressed this frame (perfect guard timing) */
  guardPressed: boolean;
  dash: boolean;
  jump: boolean;
  tech: number;   // -1 none, 0..2
  domain: boolean;
  vow: boolean;
  run: boolean;
}

export function emptyCommand(): Command {
  return { move: new Vector3(), light: false, heavy: false, guard: false, guardPressed: false, dash: false, jump: false, tech: -1, domain: false, vow: false, run: false };
}

export type FState =
  | 'idle' | 'move' | 'dash' | 'air' | 'attack' | 'guard' | 'blockstun' | 'hitstun' | 'launched' | 'knockdown' | 'down'
  | 'getup' | 'stun' | 'dead' | 'victory' | 'scripted';

export const GRAVITY = -26;

/** Hooks the combat world gives a fighter for spawning technique payloads and effects. */
export interface FighterHost {
  spawnTechnique(f: Fighter, m: Move): void;
  onMoveStart(f: Fighter, m: Move): void;
  onDash(f: Fighter): void;
  onLand(f: Fighter, hard: boolean): void;
  requestDomain(f: Fighter): void;
  onVow(f: Fighter): void;
}

export class Fighter {
  state: FState = 'idle';
  stateTime = 0;
  vel = new Vector3();
  hp: number;
  maxHp: number;
  energy = 50;
  domainGauge = 0;
  grounded = true;
  move: Move | null = null;
  moveTime = 0;
  moveHit = false;
  /** ids of fighters already hit by the current move (per hit index) */
  hitList = new Set<string>();
  hitIndex = 0;
  stun = 0;
  invuln = 0;
  /** remembers when the guard button went down, for perfect guards */
  guardPressedAt = -10;
  lightHitAt = -10;
  blackSpark = false;
  /** combo the fighter is SUFFERING: hits and scaling */
  comboTaken = 0;
  juggle = 0;
  marks = new Map<string, number>();
  vowTime = 0;
  vowUsed = false;
  domainActive = false;
  /** local time scale (Still Point slows enemies, slow motion) */
  timeScale = 1;
  slowTimer = 0;
  armor = 0;
  target: Fighter | null = null;
  team: number;
  alive = true;
  /** hurtbox */
  radius: number;
  height: number;
  /** scripted control: the director moves this fighter */
  scripted = false;
  /** damage dealt multiplier (difficulty, domain) */
  power = 1;
  /** damage taken multiplier */
  defense = 1;
  stringStep = 0;
  airActions = 1;
  time = 0;
  readonly cmd = emptyCommand();
  lastHitBy: Fighter | null = null;
  techCooldown = [0, 0, 0];

  constructor(readonly ch: Character, readonly kit: Kit, team: number, readonly host: FighterHost) {
    this.team = team;
    this.maxHp = kit.health;
    this.hp = kit.health;
    const s = ch.root.scaling.y;
    this.height = ch.height * s;
    this.radius = Math.max(0.32, 0.2 * ch.height * s);
    ch.look.energy.y = kit.palette;
  }

  get id(): string {
    return this.ch.id;
  }

  get pos(): Vector3 {
    return this.ch.root.position;
  }

  get name(): string {
    return this.kit.name;
  }

  setState(s: FState): void {
    this.state = s;
    this.stateTime = 0;
  }

  facing(out = new Vector3()): Vector3 {
    return out.set(Math.sin(this.ch.yaw), 0, Math.cos(this.ch.yaw));
  }

  faceToward(p: Vector3, rate = 1): void {
    const d = p.subtract(this.pos);
    if (d.x * d.x + d.z * d.z < 1e-4) return;
    const want = Math.atan2(d.x, d.z);
    let diff = want - this.ch.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.ch.yaw += diff * Math.min(1, rate);
  }

  distanceTo(o: Fighter): number {
    const dx = o.pos.x - this.pos.x;
    const dz = o.pos.z - this.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  canAct(): boolean {
    return this.alive && !this.scripted && (this.state === 'idle' || this.state === 'move' || this.state === 'guard' || (this.state === 'air' && this.move === null));
  }

  isVulnerable(): boolean {
    return this.alive && this.invuln <= 0 && this.state !== 'getup' && this.state !== 'dead' && !(this.state === 'down' && this.stateTime < 0.5);
  }

  isBlocking(from: Vector3): boolean {
    if (this.state !== 'guard' && this.state !== 'blockstun') return false;
    if (this.vowTime > 0) return false;
    const f = this.facing();
    const d = from.subtract(this.pos);
    d.y = 0;
    d.normalize();
    return Vector3.Dot(f, d) > -0.2;
  }

  play(clip: string, fade = 0.08, speed = 1, keep = false): void {
    this.ch.anim.play(clip, fade, speed, keep);
  }

  /** Begin a move (attack or technique) if allowed. */
  startMove(name: string): boolean {
    const m = this.kit.moves[name];
    if (!m) return false;
    if (m.cost && this.energy < m.cost && !this.domainActive) return false;
    if (m.cost && !this.domainActive) this.energy -= m.cost;
    this.move = m;
    this.moveTime = 0;
    this.moveHit = false;
    this.hitList.clear();
    this.hitIndex = 0;
    this.spawned = false;
    this.setState('attack');
    const speed = m.speed ?? 1;
    // fit the clip to the move's timing so hits land on the contact pose
    const total = m.startup + m.active + m.recovery;
    const clipDur = this.ch.anim.duration(m.clip) / speed;
    this.play(m.clip, 0.05, clipDur > 0 ? Math.max(0.5, clipDur / total) * speed : speed);
    this.host.onMoveStart(this, m);
    return true;
  }

  private spawned = false;

  phase(): 'startup' | 'active' | 'recovery' | 'none' {
    const m = this.move;
    if (!m) return 'none';
    if (this.moveTime < m.startup) return 'startup';
    if (this.moveTime < m.startup + m.active) return 'active';
    return 'recovery';
  }

  /** Cancel into the next move if the current one allows it. */
  private tryCancel(next: string): boolean {
    const m = this.move;
    if (!m || !m.cancel || !m.cancel.includes(next)) return false;
    const late = this.moveTime > m.startup + m.active * 0.5;
    if (!(this.moveHit || this.moveTime > m.startup + m.active + m.recovery * 0.35) || !late) return false;
    return true;
  }

  update(dt: number): void {
    const sdt = dt * this.timeScale;
    this.time += sdt;
    this.stateTime += sdt;
    this.invuln = Math.max(0, this.invuln - sdt);
    this.slowTimer = Math.max(0, this.slowTimer - dt);
    if (this.slowTimer <= 0) this.timeScale = 1;
    for (let i = 0; i < 3; i++) this.techCooldown[i] = Math.max(0, this.techCooldown[i] - sdt);
    if (this.vowTime > 0) {
      this.vowTime -= sdt;
      this.ch.look.energy.z = Math.min(1, this.vowTime * 2);
      if (this.vowTime <= 0) this.ch.look.energy.z = 0;
    }
    for (const [k, v] of this.marks) {
      if (v - sdt <= 0) this.marks.delete(k);
      else this.marks.set(k, v - sdt);
    }
    if (!this.alive) {
      this.physics(sdt);
      return;
    }
    if (!this.scripted) this.think(sdt);
    this.physics(sdt);
  }

  private think(dt: number): void {
    const c = this.cmd;
    const t = this.target;
    if (c.guardPressed) this.guardPressedAt = this.time;

    // vow: once, below 30% health
    if (c.vow && !this.vowUsed && this.hp < this.maxHp * 0.3 && this.canAct()) {
      this.vowUsed = true;
      this.vowTime = 15;
      this.host.onVow(this);
    }
    if (c.domain && this.domainGauge >= 100 && this.kit.domain && this.canAct() && this.grounded) {
      this.host.requestDomain(this);
      return;
    }

    switch (this.state) {
      case 'idle':
      case 'move':
      case 'guard': {
        if (t && t.alive) this.faceToward(t.pos, dt * 10);
        if (c.guard && this.vowTime <= 0) {
          if (this.state !== 'guard') {
            this.setState('guard');
            this.play('guard', 0.06);
          }
          this.vel.x *= 0.7;
          this.vel.z *= 0.7;
          if (c.light) {
            // guard + light: throw
            this.startMove('throw');
          }
          return;
        }
        if (c.jump && this.grounded) {
          this.vel.y = 9.2;
          this.grounded = false;
          this.airActions = 1;
          this.setState('air');
          this.play('jump', 0.05);
          return;
        }
        if (c.dash) {
          this.startDash(c.move);
          return;
        }
        if (c.tech >= 0) {
          const name = this.kit.techs[c.tech];
          if (name && this.techCooldown[c.tech] <= 0 && this.startMove(name)) {
            this.techCooldown[c.tech] = 0.6;
            return;
          }
        }
        if (c.heavy) {
          const since = this.time - this.lightHitAt;
          this.blackSpark = since > 0.03 && since < 0.22;
          this.startMove(c.move.length() > 0.5 && t && Vector3.Dot(c.move, t.pos.subtract(this.pos).normalize()) > 0.5 ? 'heavy2' : 'heavy');
          return;
        }
        if (c.light) {
          this.stringStep = 1;
          this.startMove('light1');
          return;
        }
        // locomotion
        const mv = c.move;
        const speed = c.run || !t ? this.kit.run : this.kit.walk;
        const want = mv.scale(speed);
        const k = Math.min(1, dt * 12);
        this.vel.x += (want.x - this.vel.x) * k;
        this.vel.z += (want.z - this.vel.z) * k;
        const moving = mv.length() > 0.1;
        if (!moving) {
          if (this.state !== 'idle') {
            this.setState('idle');
          }
          this.play(t ? 'idle_fight' : 'idle_relaxed', 0.15, 1, true);
        } else {
          if (this.state !== 'move') this.setState('move');
          if (!t || c.run) {
            if (!t) this.faceToward(this.pos.add(mv), dt * 12);
            this.play('run', 0.12, 1, true);
          } else {
            const f = this.facing();
            const side = new Vector3(f.z, 0, -f.x);
            const fw = Vector3.Dot(mv, f);
            const sd = Vector3.Dot(mv, side);
            if (Math.abs(fw) >= Math.abs(sd)) this.play(fw > 0 ? 'walk_fwd' : 'walk_back', 0.12, 1.2, true);
            else this.play(sd > 0 ? 'strafe_L' : 'strafe_R', 0.12, 1.2, true);
          }
        }
        return;
      }
      case 'dash': {
        if (this.stateTime > 0.28) {
          this.setState('idle');
        } else if (c.light || c.heavy) {
          this.startMove('dash_attack');
        }
        return;
      }
      case 'air': {
        if (t && t.alive) this.faceToward(t.pos, dt * 6);
        if (this.move === null) {
          if (c.light && this.airActions > 0) {
            this.startMove('air_light');
            this.state = 'air';
            return;
          }
          if (c.heavy && this.airActions > 0) {
            this.startMove('air_heavy');
            this.state = 'air';
            return;
          }
          if (this.vel.y < 0 && this.ch.anim.current !== 'fall') this.play('fall', 0.15);
          // a little air control
          this.vel.x += (c.move.x * this.kit.walk - this.vel.x) * Math.min(1, dt * 2);
          this.vel.z += (c.move.z * this.kit.walk - this.vel.z) * Math.min(1, dt * 2);
        } else {
          this.stepMove(dt);
        }
        return;
      }
      case 'attack': {
        this.stepMove(dt);
        return;
      }
      case 'blockstun':
        if (this.stateTime > this.stun) {
          const g = this.cmd.guard;
          this.setState(g ? 'guard' : 'idle');
          if (g) this.play('guard', 0.05);
        }
        return;
      case 'hitstun':
      case 'stun':
        if (this.stateTime > this.stun) {
          this.setState('idle');
          this.comboTaken = 0;
          this.juggle = 0;
        }
        return;
      case 'knockdown':
        if (this.ch.anim.finished() && this.grounded) {
          this.setState('down');
          this.play('down', 0.1);
        }
        return;
      case 'down':
        if (this.stateTime > 0.55 && this.alive) {
          this.setState('getup');
          this.play('getup', 0.08);
          this.invuln = 0.6;
          this.comboTaken = 0;
          this.juggle = 0;
        }
        return;
      case 'getup':
        if (this.stateTime > this.ch.anim.duration('getup') * 0.9) {
          this.setState('idle');
          this.invuln = 0.15;
        }
        return;
      case 'launched':
        return;
      default:
        return;
    }
  }

  startDash(dir: Vector3): void {
    const t = this.target;
    let d = dir.clone();
    if (d.length() < 0.1) d = t ? this.pos.subtract(t.pos) : this.facing().scale(-1);
    d.y = 0;
    d.normalize();
    this.vel.x = d.x * 13;
    this.vel.z = d.z * 13;
    this.invuln = 0.14;
    this.setState('dash');
    const fwd = Vector3.Dot(d, this.facing()) > 0;
    this.play(fwd ? 'dash_fwd' : 'dash_back', 0.04, 1.3);
    this.host.onDash(this);
  }

  private stepMove(dt: number): void {
    const m = this.move!;
    this.moveTime += dt;
    const c = this.cmd;
    const t = this.target;
    const ph = this.phase();
    // track the target during startup so moves don't whiff on a sidestep by a hair
    if (ph === 'startup' && t && t.alive) this.faceToward(t.pos, dt * 8);
    // lunge
    if (ph !== 'recovery' && m.lunge) {
      const f = this.facing();
      const close = t ? this.distanceTo(t) < (this.radius + t.radius + 0.25) : false;
      const sp = close ? 0 : m.lunge * (ph === 'startup' ? 0.6 : 1);
      this.vel.x = f.x * sp;
      this.vel.z = f.z * sp;
    } else if (this.grounded) {
      this.vel.x *= 0.82;
      this.vel.z *= 0.82;
    }
    // technique payload at the start of the active window
    if (ph === 'active' && !this.spawned && (m.kind === 'projectile' || m.kind === 'area' || m.kind === 'buff')) {
      this.spawned = true;
      this.host.spawnTechnique(this, m);
    }
    // cancels
    if (c.light) {
      const next = m.air ? (m.name === 'air_light' ? 'air_light2' : '') : ['light2', 'light3', 'light4'][this.stringStep - 1];
      if (next && this.tryCancel(next)) {
        if (!m.air) this.stringStep++;
        this.startMove(next);
        if (m.air) this.state = 'air';
        return;
      }
    }
    if (c.heavy && !m.air) {
      const next = 'heavy';
      if (this.tryCancel(next)) {
        const since = this.time - this.lightHitAt;
        this.blackSpark = since > 0.03 && since < 0.22;
        this.startMove(next);
        return;
      }
    }
    if (c.heavy && m.air && m.name !== 'air_heavy' && this.tryCancel('air_heavy')) {
      this.startMove('air_heavy');
      this.state = 'air';
      return;
    }
    if (c.tech >= 0) {
      const name = this.kit.techs[c.tech];
      if (name && this.tryCancel(name) && this.techCooldown[c.tech] <= 0 && this.startMove(name)) {
        this.techCooldown[c.tech] = 0.6;
        return;
      }
    }
    if (c.dash && this.tryCancel('dash')) {
      this.move = null;
      this.startDash(c.move);
      return;
    }
    if (c.jump && m.name === 'heavy' && this.moveHit && this.tryCancel('jump')) {
      this.move = null;
      this.vel.y = 10.5;
      this.grounded = false;
      this.airActions = 2;
      this.setState('air');
      this.play('jump', 0.04);
      return;
    }
    if (this.moveTime >= m.startup + m.active + m.recovery) {
      this.move = null;
      this.blackSpark = false;
      if (m.air) {
        this.airActions--;
        if (!this.grounded) {
          this.setState('air');
          this.play('fall', 0.1);
          return;
        }
      }
      this.stringStep = 0;
      this.setState('idle');
    }
  }

  private physics(dt: number): void {
    const p = this.pos;
    if (!this.grounded || this.vel.y > 0) {
      const g = this.state === 'launched' ? GRAVITY * (0.72 + this.juggle * 0.05) : GRAVITY;
      this.vel.y += g * dt;
      // hang a moment at the top of air attacks (anime air combos)
      if (this.move && this.move.air && this.phase() !== 'recovery') this.vel.y = Math.max(this.vel.y, -1.5);
    }
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    p.z += this.vel.z * dt;
    if (p.y <= 0) {
      const wasAir = !this.grounded;
      p.y = 0;
      const vy = this.vel.y;
      this.vel.y = 0;
      this.grounded = true;
      if (wasAir) {
        if (this.state === 'launched') {
          this.setState('knockdown');
          this.play('knockdown', 0.05, 1.6);
          this.host.onLand(this, true);
          if (vy < -12 && this.alive) {
            // ground bounce off a spike
            this.vel.y = 4;
            this.grounded = false;
          }
        } else if (this.state === 'air' || (this.move && this.move.air)) {
          this.move = null;
          this.setState('idle');
          this.play('land', 0.04);
          this.host.onLand(this, false);
        }
      }
    } else {
      this.grounded = false;
    }
    if (this.grounded && (this.state === 'hitstun' || this.state === 'blockstun' || this.state === 'knockdown' || this.state === 'down' || this.state === 'dead' || this.state === 'stun')) {
      const fr = Math.exp(-dt * 7);
      this.vel.x *= fr;
      this.vel.z *= fr;
    }
    if (this.state === 'idle' && this.grounded) {
      const fr = Math.exp(-dt * 10);
      this.vel.x *= fr;
      this.vel.z *= fr;
    }
    this.ch.springs.wind.copyFrom(this.vel);
  }

  /** Take a hit. Returns true if it landed (not blocked). Called by the combat world. */
  receive(from: Fighter, m: Move, dmg: number, dir: Vector3, opts: { blackSpark: boolean; sureHit: boolean }): 'hit' | 'block' | 'perfect' {
    const blocked = !m.unblockable && !opts.sureHit && this.isBlocking(from.pos);
    if (blocked) {
      const perfect = this.time - this.guardPressedAt < 0.14;
      this.vel.x = dir.x * m.push * 0.5;
      this.vel.z = dir.z * m.push * 0.5;
      this.stun = m.blockstun ?? m.hitstun * 0.6;
      this.setState('blockstun');
      this.play('guard_hit', 0.02);
      if (perfect) {
        this.energy = Math.min(100, this.energy + 12);
        return 'perfect';
      }
      this.hp = Math.max(1, this.hp - dmg * 0.12);
      this.energy = Math.min(100, this.energy + 3);
      return 'block';
    }
    this.hp -= dmg;
    this.lastHitBy = from;
    this.comboTaken++;
    this.move = null;
    this.blackSpark = false;
    this.energy = Math.min(100, this.energy + (m.gain ?? 3) * 0.5);
    this.domainGauge = Math.min(100, this.domainGauge + dmg * 0.09);
    const armored = this.armor > 0 && !opts.blackSpark && !m.launch && !m.knockdown;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.vel.set(dir.x * Math.max(m.push, 6), 6, dir.z * Math.max(m.push, 6));
      this.grounded = false;
      this.setState('launched');
      this.play('launched', 0.02);
      return 'hit';
    }
    if (armored) {
      this.ch.look.flash.w = 0.5;
      return 'hit';
    }
    const airborne = !this.grounded || this.state === 'launched';
    if (m.launch || airborne || m.spike) {
      this.juggle++;
      let vy = m.launch ?? (airborne ? Math.max(3.5 - this.juggle * 0.35, 1.2) : 0);
      if (m.spike) vy = -16;
      this.vel.set(dir.x * m.push * 0.6, vy, dir.z * m.push * 0.6);
      this.grounded = vy <= 0 && this.pos.y <= 0.01 && !m.spike;
      if (!this.grounded) {
        this.setState('launched');
        this.play('launched', 0.03);
        return 'hit';
      }
    }
    if (m.knockdown) {
      this.vel.set(dir.x * m.push, 3.5, dir.z * m.push);
      this.grounded = false;
      this.setState('launched');
      this.play('launched', 0.03);
      return 'hit';
    }
    this.vel.x = dir.x * m.push;
    this.vel.z = dir.z * m.push;
    this.stun = m.hitstun;
    this.setState('hitstun');
    this.play(this.comboTaken % 2 ? 'hit_high' : 'hit_body', 0.02, 1.2);
    return 'hit';
  }

  /** Parried (perfect guard): staggered open. */
  staggerOpen(): void {
    this.move = null;
    this.stun = 0.55;
    this.setState('stun');
    this.play('stagger', 0.04);
  }
}
