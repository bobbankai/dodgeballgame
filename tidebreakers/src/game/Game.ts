// The world: fighters, combat resolution, projectiles, camera, effects, time (hitstop / slow motion),
// encounters and the player's storm meter. Levels and the story director drive it.
import { CharacterModel } from './CharacterModel';
import { Vector3, Ray } from '@babylonjs/core';
import type { Mesh } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { Vfx } from '../render/Vfx';
import { Trails } from '../render/Trails';
import { Collision } from './Collision';
import { CameraRig } from './CameraRig';
import type { Input } from '../core/Input';
import { Fighter } from './Fighter';
import type { AttackDef, ProjectileDef } from '../combat/Attacks';
import type { AnimLibrary } from './Animator';

export interface Projectile { pos: Vector3; vel: Vector3; def: ProjectileDef; owner: Fighter; life: number; reflected: boolean }

export interface Hazard { pos: Vector3; radius: number; delay: number; damage: number; kind: 'blast' | 'spike' | 'fire'; team: string; done?: boolean }
export interface Ring { pos: Vector3; r: number; speed: number; maxR: number; damage: number; team: string; hit: Set<Fighter> }

export const sameSide = (a: string, b: string): boolean => a === b || (a !== 'enemy' && b !== 'enemy' && a !== 'neutral' && b !== 'neutral');

export interface GameHooks {
  sfx?: (name: string, pos?: Vector3, vol?: number) => void;
  hud?: () => void;
  combo?: (n: number) => void;
  bossBar?: (f: Fighter | null) => void;
  damage?: (pos: Vector3, amount: number, kind: string) => void;
}

export class Game {
  readonly collision = new Collision();
  readonly cam: CameraRig;
  readonly vfx: Vfx;
  readonly trails: Trails;
  fighters: Fighter[] = [];
  player: Fighter | null = null;
  projectiles: Projectile[] = [];
  time = 0;
  hitstop = 0;
  slowmo = 1;
  private slowT = 0;
  storm = 0;
  stormMax = 100;
  combo = 0;
  comboT = 0;
  combatActive = false;
  wind = new Vector3(0.4, 0, 0.2);
  hooks: GameHooks = {};
  paused = false;
  checkpoint = { pos: new Vector3(), yaw: 0 };
  onUpdate: ((dt: number) => void)[] = [];
  private impactT = 0;
  private speedT = 0;
  attackTokens = 2;   // how many enemies may attack the player at once
  hazards: Hazard[] = [];
  rings: Ring[] = [];
  /** delayed calls on game time (they pause with the game and are dropped by reset) */
  private timers: { t: number; fn: () => void }[] = [];
  /** storm aura on the player (decays), pulses gently when the storm meter is full */
  aura = 0;

  constructor(readonly r: Renderer, readonly input: Input, readonly lib: AnimLibrary) {
    this.cam = new CameraRig(r.scene, this.collision);
    // cutscene cameras step in front of any visible scenery between them and their subject (characters,
    // particles, sea, sky and grass don't count)
    this.cam.occlude = (from, to) => {
      const dir = to.subtract(from);
      const len = dir.length();
      if (len < 1e-3) return null;
      const nd = dir.scale(1 / len);
      const ray = new Ray(from, nd, len);
      const hits = r.scene.multiPickWithRay(ray, (m) => m.isPickable && m.isEnabled() && m.isVisible && !(m as Mesh).skeleton && m.getTotalVertices() > 0) ?? [];
      hits.sort((a, b) => a.distance - b.distance);
      // the first surface facing back toward the subject; one facing away is the inside of a shape the subject
      // stands in (a tower the shot looks up into), not something in front of the lens
      for (const h of hits) {
        const n = h.getNormal(true, true);
        if (!n || Vector3.Dot(n, nd) < 0) return h.distance;
      }
      return null;
    };
    this.vfx = new Vfx(r);
    this.trails = new Trails(r);
  }

  /** Clears everything level-specific; the player survives level changes. */
  reset(): void {
    for (const f of this.fighters) if (f !== this.player) f.model.dispose();
    this.fighters = this.player ? [this.player] : [];
    this.projectiles = [];
    this.hazards = [];
    this.rings = [];
    this.collision.reset();
    this.combatActive = false;
    this.slowmo = 1;
    this.slowT = 0;
    this.hitstop = 0;
    this.combo = 0;
    this.onUpdate = [];
    this.timers = [];
    this.trails.clear();
    this.hooks.bossBar?.(null);
    this.r.globals.lights = [];
  }

  sfx(name: string, pos?: Vector3, vol = 1): void { this.hooks.sfx?.(name, pos, vol); }

  /** Calls `fn` after `sec` seconds of game time. */
  after(sec: number, fn: () => void): void { this.timers.push({ t: this.time + sec, fn }); }
  shake(a: number): void { this.cam.shake(a); }

  addFighter(f: Fighter): Fighter {
    this.fighters.push(f);
    return f;
  }

  removeFighter(f: Fighter): void {
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    if (this.player === f) return;
    f.model.dispose();
  }

  enemies(): Fighter[] { return this.fighters.filter((f) => f.team === 'enemy' && f.alive); }

  impactFrame(dur = 0.07): void { this.impactT = Math.max(this.impactT, dur); }
  speedLines(dur = 0.4): void { this.speedT = Math.max(this.speedT, dur); }
  slow(scale: number, dur: number): void { this.slowmo = scale; this.slowT = dur; }

  onAttackStart(f: Fighter, def: AttackDef): void {
    this.sfx('whoosh', f.pos, 0.6);
    if (f.team === 'player') {
      if (def.cost) this.aura = Math.max(this.aura, def.id === 'hurricane' ? 1.6 : 1.1);
      if (def.id === 'tempest_dash') { this.speedLines(0.5); this.vfx.gale(f.center, f.forward, 1.2); }
      if (def.id === 'hurricane') { this.speedLines(1.6); this.slow(0.45, 0.5); this.sfx('super_start', f.pos); }
      if (def.id === 'gale_burst') this.sfx('charge', f.pos, 0.8);
    }
    if (def.projectile) {
      const dir = f.target ? f.target.center.subtract(f.center.add(new Vector3(0, 0.25, 0))).normalize() : f.forward;
      const origin = f.center.add(new Vector3(0, 0.3, 0)).add(f.forward.scale(0.6));
      this.projectiles.push({ pos: origin, vel: dir.scale(def.projectile.speed), def: def.projectile, owner: f, life: def.projectile.life, reflected: false });
      this.sfx('shot', f.pos);
      this.vfx.burst(origin, [3, 2, 0.8], 6, 4, 'star', 0.15, 0.12);
    }
  }

  /** Finds everything an attack hits at one of its hit frames. */
  resolveHit(att: Fighter, def: AttackDef, hitIndex: number): void {
    if (def.projectile) return;
    const fwd = att.forward;
    let any = false;
    for (const t of this.fighters) {
      if (t === att || !t.alive || t.team === att.team || t.team === 'neutral' || att.hitSet.has(t)) continue;
      if ((att.team === 'player' || att.team === 'ally') && t.team !== 'enemy') continue;
      const d = t.pos.subtract(att.pos);
      const dy = t.pos.y - att.pos.y;
      const band = def.height ?? [-0.8, 2.2];
      if (dy < band[0] - t.height || dy > band[1]) continue;
      const flat = new Vector3(d.x, 0, d.z);
      const dist = flat.length() - t.radius;
      if (dist > def.reach) continue;
      if (!def.aoe && dist > 0.2) {
        const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(flat.normalize(), fwd)))) * 180 / Math.PI;
        if (ang > def.arc) continue;
      }
      att.hitSet.add(t);
      const res = t.receive(att, def);
      if (res === 'immune') continue;
      any = true;
      const contact = Vector3.Lerp(att.center, t.center, 0.6).add(new Vector3(0, 0.15, 0));
      if (res === 'parry') {
        this.parried(t, att, contact);
        continue;
      }
      if (res === 'block') {
        this.vfx.burst(contact, [2.2, 2.0, 1.4], 8, 6, 'star', 0.14, 0.2);
        this.sfx('block', contact);
        this.hitstop = Math.max(this.hitstop, 0.04);
        continue;
      }
      // a hit
      const strength = Math.min(2.2, 0.7 + def.damage / 14);
      this.vfx.impact(contact, strength, att.team === 'player' ? [2.4, 2.0, 1.1] : [2.6, 0.9, 0.6]);
      if (def.vfx === 'gale' || def.vfx === 'uppercut' || def.vfx === 'uppercut_big' || def.vfx === 'burst' || def.vfx === 'dash' || def.vfx === 'hurricane') {
        this.vfx.gale(contact, fwd, strength);
      }
      this.hitstop = Math.max(this.hitstop, def.hitstop);
      this.shake(def.shake);
      this.sfx(def.sfx ?? 'punch', contact);
      if (def.impact && att.team === 'player') this.impactFrame(0.06);
      if (def.impact || def.damage >= 18) this.r.shockwave(contact, Math.min(1.5, 0.5 + def.damage / 25));
      this.hooks.damage?.(contact, Math.round(def.damage), att.team === 'player' ? 'deal' : 'take');
      if (att.team === 'player') {
        this.combo++;
        this.comboT = 2.2;
        this.hooks.combo?.(this.combo);
        if (!def.cost) this.storm = Math.min(this.stormMax, this.storm + (def.meter ?? 3) * (1 + Math.min(this.combo, 30) * 0.03));
        // the last enemy of a wave falls in slow motion
        if (!t.alive && this.enemies().length === 0 && this.combatActive) { this.slow(0.25, 0.9); this.impactFrame(0.08); }
      }
      if (t === this.player) { this.combo = 0; this.hooks.combo?.(0); }
    }
    if (any && att.team === 'player' && !att.onGround) { att.vel.y = Math.max(att.vel.y, 2.5); }
    void hitIndex;
  }

  parried(defender: Fighter, attacker: Fighter, at: Vector3): void {
    this.vfx.impact(at, 1.6, [1.2, 2.2, 2.8]);
    this.vfx.burst(at, [1.5, 2.5, 3], 16, 10, 'star', 0.16, 0.3);
    this.sfx('parry', at);
    this.slow(0.3, 0.45);
    this.impactFrame(0.05);
    this.shake(0.3);
    attacker.attack = null;
    attacker.setState('hit');
    attacker.stun = 1.1;
    attacker.play(attacker.anims.hit, false, 0.03);
    if (defender.team === 'player') this.storm = Math.min(this.stormMax, this.storm + 18);
  }

  onFall(f: Fighter): void {
    if (f === this.player) {
      f.hp = Math.max(1, f.hp - 10);
      f.place(this.checkpoint.pos, this.checkpoint.yaw);
      this.sfx('splash', f.pos);
    } else if (f.fallSafe || f.floorHp > 0) {
      // bosses and anyone the story is waiting on climb back out (a fall must never skip their scene)
      this.sfx('splash', f.pos);
      f.vel.setAll(0);
      f.place(f.lastSafe.lengthSquared() > 0 ? f.lastSafe : this.checkpoint.pos, f.yaw);
      f.hurt(Math.round(f.maxHp * 0.06));
    } else {
      f.hp = 0;
      f.die(new Vector3(), 0);
      f.dissolve = 1;
    }
  }

  // ------------------------------------------------------------------------------------------ step
  step(dt: number): void {
    if (this.paused) return;
    this.time += dt;
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.slowmo = 1; }
    const fx = this.r.fx;
    if (this.impactT > 0) { this.impactT -= dt; fx.impact = this.impactT > 0.03 ? 2 : 1; } else fx.impact = 0;
    if (this.speedT > 0) { this.speedT -= dt; fx.speedLines = Math.min(1, this.speedT * 3); } else fx.speedLines *= 0.8;
    fx.radialBlur = this.speedT > 0 ? 0.4 : fx.radialBlur * 0.85;
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.hooks.combo?.(0); } }
    let gdt = dt * this.slowmo;
    if (this.hitstop > 0) { this.hitstop -= dt; gdt = 0; }
    if (gdt > 0) {
      for (const f of [...this.fighters]) f.update(gdt);
      this.separate();
      this.updateProjectiles(gdt);
      this.updateHazards(gdt);
    }
    for (const u of this.onUpdate) u(dt);
    if (this.timers.length) {
      const due = this.timers.filter((x) => x.t <= this.time);
      if (due.length) { this.timers = this.timers.filter((x) => x.t > this.time); for (const x of due) x.fn(); }
    }
    this.vfx.update(dt * (this.hitstop > 0 ? 0.25 : this.slowmo));
    this.trails.update(gdt, this.fighters, this.cam.cam.position);
    this.cam.update(dt, this.input.takeLook());
    CharacterModel.lodAll(this.cam.cam.position);
    const p = this.player;
    if (p) {
      this.r.shadowCenter.copyFrom(p.pos);
      this.aura = Math.max(0, this.aura - dt * 1.4);
      const full = this.storm >= this.stormMax ? 0.22 + 0.12 * Math.sin(this.time * 5) : 0;
      p.model.setAura(0.55, 1.15, 2.3, Math.max(this.aura, full));
    }
    this.hooks.hud?.();
  }

  /** A telegraphed area attack: a warning circle, then damage to everyone not on `team`'s side. */
  hazard(pos: Vector3, radius: number, delay: number, damage: number, kind: Hazard['kind'] = 'blast', team = 'enemy'): void {
    const p = pos.clone();
    p.y = this.collision.groundAt(p.x, p.z, p.y + 2);
    this.hazards.push({ pos: p, radius, delay, damage, kind, team });
    this.vfx.warnCircle(p, radius, delay);
  }

  /** An expanding ground ring (jump over it). */
  ring(pos: Vector3, speed: number, maxR: number, damage: number, team = 'enemy'): void {
    this.rings.push({ pos: pos.clone(), r: 0.5, speed, maxR, damage, team, hit: new Set() });
    this.sfx('wind_blast', pos, 0.8);
  }

  private updateHazards(dt: number): void {
    for (const h of this.hazards) {
      h.delay -= dt;
      if (h.delay > 0) continue;
      h.done = true;
      const def: AttackDef = { id: 'hazard', clip: '', hit: [], damage: h.damage, reach: 0, arc: 0, knock: 7, launch: h.kind === 'spike' ? 9 : 5, stagger: 0.6, hitstop: 0.06, shake: 0.4, knockdown: true, unblockable: true };
      for (const t of this.fighters) {
        if (!t.alive || sameSide(t.team, h.team) || t.team === 'neutral') continue;
        if (Math.hypot(t.pos.x - h.pos.x, t.pos.z - h.pos.z) < h.radius + t.radius * 0.5 && t.pos.y < h.pos.y + 2.2) {
          // knocked away from the blast's centre
          t.receive({ pos: h.pos.add(new Vector3(0.01, 0, 0.01)) } as Fighter, def);
          this.hooks.damage?.(t.center, h.damage, t === this.player ? 'take' : 'deal');
        }
      }
      const col: [number, number, number] = h.kind === 'fire' ? [3, 1.2, 0.3] : h.kind === 'spike' ? [1.2, 2.2, 2.8] : [2.5, 1.6, 0.8];
      this.vfx.shock(h.pos, h.radius, col);
      this.r.shockwave(h.pos.add(new Vector3(0, 0.5, 0)), 0.9);
      this.vfx.burst(h.pos.add(new Vector3(0, 0.3, 0)), col, 18, 7, h.kind === 'spike' ? 'shard' : 'smoke', 0.4, 0.6, h.kind === 'spike' ? 0 : -2);
      this.shake(0.25);
      this.sfx(h.kind === 'fire' ? 'wind_blast' : 'slam', h.pos, 0.7);
    }
    this.hazards = this.hazards.filter((h) => !h.done);
    for (const g of this.rings) {
      g.r += g.speed * dt;
      if (Math.random() < 0.8) {
        const a = Math.random() * Math.PI * 2;
        this.vfx.burst(g.pos.add(new Vector3(Math.cos(a) * g.r, 0.2, Math.sin(a) * g.r)), [1.2, 2.0, 2.6], 1, 1, 'drop', 0.3, 0.4, -3);
      }
      for (const t of this.fighters) {
        if (!t.alive || g.hit.has(t) || sameSide(t.team, g.team) || t.team === 'neutral') continue;
        const d = Math.hypot(t.pos.x - g.pos.x, t.pos.z - g.pos.z);
        if (Math.abs(d - g.r) < 0.55 && t.pos.y - this.collision.groundAt(t.pos.x, t.pos.z, t.pos.y + 0.5) < 0.5) {
          g.hit.add(t);
          t.receive({ pos: g.pos.add(new Vector3(0.01, 0, 0.01)) } as Fighter, { id: 'ring', clip: '', hit: [], damage: g.damage, reach: 0, arc: 0, knock: 8, launch: 6, stagger: 0.6, hitstop: 0.05, shake: 0.3, knockdown: true, unblockable: true });
        }
      }
    }
    this.rings = this.rings.filter((g) => g.r < g.maxR);
  }

  private separate(): void {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i], b = fs[j];
        if (!a.alive || !b.alive || a.state === 'cine' || b.state === 'cine') continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const m = a.radius + b.radius;
        if (d < m && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1.2) {
          const push = (m - d) / d * 0.5;
          const wa = a.boss ? 0.2 : b.boss ? 1.8 : 1, wb = 2 - wa;
          a.pos.x -= dx * push * wa; a.pos.z -= dz * push * wa;
          b.pos.x += dx * push * wb; b.pos.z += dz * push * wb;
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.life -= dt;
      pr.vel.y -= (pr.def.gravity ?? 0) * dt;
      pr.pos.addInPlace(pr.vel.scale(dt));
      this.vfx.trail(pr.pos, pr.vel, pr.reflected ? [0.8, 2, 2.6] : [3, 1.8, 0.6], 0.22);
      let dead = pr.life <= 0 || pr.pos.y < this.collision.groundAt(pr.pos.x, pr.pos.z, pr.pos.y + 1);
      if (!dead) {
        for (const t of this.fighters) {
          if (!t.alive || t === pr.owner || t.team === 'neutral' || (sameSide(t.team, pr.owner.team) && !pr.reflected)) continue;
          if (pr.reflected && t.team !== 'enemy') continue;
          const c = t.center;
          const dxz = Math.hypot(c.x - pr.pos.x, c.z - pr.pos.z);
          if (dxz < t.radius + pr.def.radius && Math.abs(c.y - pr.pos.y) < t.height * 0.6) {
            const def: AttackDef = { id: 'proj', clip: '', hit: [], damage: pr.def.damage, reach: 0, arc: 0, knock: pr.def.knock ?? 3, stagger: 0.4, hitstop: 0.05, shake: 0.2 };
            const res = t.receive(pr.owner, def);
            if (res === 'parry' && pr.def.parryable) {
              // knock it back at the shooter
              pr.vel.scaleInPlace(-1.2);
              pr.reflected = true;
              pr.owner = t;
              pr.life = 1.5;
              this.vfx.impact(pr.pos, 1.2, [1.2, 2.2, 2.8]);
              this.sfx('parry', pr.pos);
              this.slow(0.4, 0.3);
              break;
            }
            if (res !== 'immune') {
              this.vfx.impact(pr.pos, 0.9, [3, 1.5, 0.6]);
              this.sfx(res === 'block' ? 'block' : 'punch', pr.pos);
              this.shake(0.2);
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) { if (pr.life > 0) this.vfx.burst(pr.pos, [2.6, 1.5, 0.6], 6, 3, 'star', 0.12, 0.2); continue; }
      keep.push(pr);
    }
    this.projectiles = keep;
  }
}
