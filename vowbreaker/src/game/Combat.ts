import { Vector3 } from '@babylonjs/core';
import { Fighter, FighterHost } from './Fighter';
import type { Move } from './Moves';

export type HitResult = 'hit' | 'block' | 'perfect';

/** Presentation hooks: effects, sound, camera. Implemented by the fight layer. */
export interface CombatFx {
  hit(attacker: Fighter, target: Fighter, m: Move, at: Vector3, dmg: number, result: HitResult, spark: boolean, mark: boolean): void;
  technique(f: Fighter, m: Move, at: Vector3, dir: Vector3): void;
  areaFire(owner: Fighter, kind: string, at: Vector3, radius: number): void;
  projectileSpawn(p: Projectile): void;
  projectileUpdate(p: Projectile): void;
  projectileEnd(p: Projectile, hit: boolean): void;
  moveStart(f: Fighter, m: Move): void;
  dash(f: Fighter): void;
  land(f: Fighter, hard: boolean): void;
  vow(f: Fighter): void;
  ko(f: Fighter, by: Fighter | null): void;
  domainTick(f: Fighter, target: Fighter, dmg: number): void;
}

export interface Projectile {
  id: number;
  owner: Fighter;
  move: Move;
  pos: Vector3;
  vel: Vector3;
  radius: number;
  life: number;
  homing: number;
  ground: boolean;
  kind: string;
  hit: Set<string>;
  alive: boolean;
  /** opaque handle for the visual */
  visual?: unknown;
  age: number;
}

interface Area {
  owner: Fighter;
  move: Move;
  center: Vector3;
  dir: Vector3;
  radius: number;
  cone: number;
  delay: number;
  hits: number;
  interval: number;
  timer: number;
  kind: string;
  fired: number;
}

interface SlowField {
  owner: Fighter;
  center: Vector3;
  radius: number;
  time: number;
}

/** Damage after combo scaling: each hit in a combo is worth a little less (fighting-game standard). */
function scaling(hits: number): number {
  return Math.max(0.3, 1 - Math.max(0, hits - 2) * 0.08);
}

export class Combat implements FighterHost {
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  private areas: Area[] = [];
  private fields: SlowField[] = [];
  hitstop = 0;
  arenaRadius = 14;
  arenaCenter = new Vector3(0, 0, 0);
  private nextId = 1;
  /** a domain the director should play (the fight layer picks it up) */
  domainRequest: Fighter | null = null;
  domainTimer = 0;
  domainOwner: Fighter | null = null;
  private domainTick = 0;
  /** floor cracks: centre + radius + palette (the environment shader draws them) */
  cracks: { x: number; z: number; r: number; pal: number; t: number }[] = [];
  /** global time scale (slow motion on KO, domain intros) */
  slowmo = 1;
  paused = false;

  constructor(readonly fx: CombatFx) {}

  add(f: Fighter): void {
    this.fighters.push(f);
  }

  remove(f: Fighter): void {
    this.fighters = this.fighters.filter((x) => x !== f);
  }

  enemiesOf(f: Fighter): Fighter[] {
    return this.fighters.filter((o) => o.team !== f.team && o.alive);
  }

  // --- FighterHost ---------------------------------------------------------------------------------

  onMoveStart(f: Fighter, m: Move): void {
    this.fx.moveStart(f, m);
  }

  onDash(f: Fighter): void {
    this.fx.dash(f);
  }

  onLand(f: Fighter, hard: boolean): void {
    this.fx.land(f, hard);
  }

  requestDomain(f: Fighter): void {
    if (!this.domainRequest && !this.domainOwner) this.domainRequest = f;
  }

  onVow(f: Fighter): void {
    this.fx.vow(f);
  }

  spawnTechnique(f: Fighter, m: Move): void {
    const fwd = f.facing();
    const chest = f.ch.bonePos('chest');
    if (m.kind === 'projectile' && m.projectile) {
      const s = m.projectile;
      const n = s.count ?? 1;
      for (let i = 0; i < n; i++) {
        const a = n > 1 ? (i / (n - 1) - 0.5) * (s.spread ?? 0) * 2 : 0;
        const dir = new Vector3(fwd.x * Math.cos(a) - fwd.z * Math.sin(a), 0, fwd.x * Math.sin(a) + fwd.z * Math.cos(a));
        const start = s.ground ? f.pos.add(dir.scale(0.6)).add(new Vector3(0, 0.25, 0)) : chest.add(dir.scale(0.5));
        const p: Projectile = {
          id: this.nextId++, owner: f, move: m, pos: start, vel: dir.scale(s.speed), radius: s.radius, life: s.life,
          homing: s.homing ?? 0, ground: !!s.ground, kind: s.kind, hit: new Set(), alive: true, age: 0,
        };
        this.projectiles.push(p);
        this.fx.projectileSpawn(p);
      }
      this.fx.technique(f, m, chest, fwd);
    } else if (m.kind === 'area' && m.area) {
      const a = m.area;
      let center = f.pos.clone();
      if (a.at === 'front') center = f.pos.add(fwd.scale(a.radius * 0.55));
      if (a.at === 'target' && f.target) center = f.target.pos.clone();
      center.y = 0;
      const hits = m.hits ?? 1;
      this.areas.push({ owner: f, move: m, center, dir: fwd.clone(), radius: a.radius, cone: a.cone ?? 0, delay: a.delay ?? 0, hits,
        interval: hits > 1 ? m.active / hits : 0, timer: 0, kind: a.kind, fired: 0 });
      this.fx.technique(f, m, center, fwd);
    } else if (m.kind === 'buff' && m.buff) {
      const b = m.buff;
      if (b.kind === 'slow-field') {
        this.fields.push({ owner: f, center: f.pos.clone(), radius: b.radius, time: b.duration });
      } else if (b.kind === 'pull' && f.target) {
        const t = f.target;
        const d = f.pos.subtract(t.pos);
        d.y = 0;
        const dist = d.length();
        if (dist < b.radius && t.isVulnerable()) {
          d.normalize();
          t.vel.set(d.x * Math.min(14, dist * 3.2), 3, d.z * Math.min(14, dist * 3.2));
          t.grounded = false;
          t.setState('launched');
          t.play('launched', 0.03);
          t.move = null;
        }
      } else if (b.kind === 'armor') {
        f.armor = b.duration;
      }
      this.fx.technique(f, m, f.pos.clone(), fwd);
    }
  }

  // --- the frame ------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.paused) return;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      // the world holds still; fighters keep their pose (the anime "impact hold")
      for (const f of this.fighters) f.ch.update(dt, 0);
      return;
    }
    const sdt = dt * this.slowmo;
    // Still Point: slow everyone inside a field except its owner's team
    for (const fl of this.fields) {
      fl.time -= sdt;
      for (const f of this.fighters) {
        if (f.team === fl.owner.team) continue;
        const d = Vector3.Distance(new Vector3(f.pos.x, 0, f.pos.z), fl.center);
        if (d < fl.radius) {
          f.timeScale = 0.32;
          f.slowTimer = 0.1;
        }
      }
    }
    this.fields = this.fields.filter((f) => f.time > 0);
    for (const f of this.fighters) {
      // targets: nearest living enemy
      if (!f.target || !f.target.alive || Math.random() < 0.02) {
        let best: Fighter | null = null;
        let bd = 1e9;
        for (const o of this.enemiesOf(f)) {
          const d = f.distanceTo(o);
          if (d < bd) {
            bd = d;
            best = o;
          }
        }
        f.target = best;
      }
      f.update(sdt);
      if (f.armor > 0) f.armor -= sdt;
    }
    this.strikes();
    this.updateProjectiles(sdt);
    this.updateAreas(sdt);
    this.separate();
    this.bounds();
    this.updateDomain(sdt);
    for (const f of this.fighters) {
      f.ch.update(dt, sdt * f.timeScale);
    }
    for (const c of this.cracks) c.t -= sdt;
    this.cracks = this.cracks.filter((c) => c.t > 0);
  }

  private hurtCenter(f: Fighter, y: number): Vector3 {
    return new Vector3(f.pos.x, Math.min(Math.max(y, f.pos.y + f.radius), f.pos.y + f.height - f.radius), f.pos.z);
  }

  /** Sphere vs the target's vertical capsule. */
  private overlaps(c: Vector3, r: number, t: Fighter): boolean {
    const p = this.hurtCenter(t, c.y);
    return Vector3.DistanceSquared(c, p) <= (r + t.radius) * (r + t.radius);
  }

  private strikes(): void {
    for (const f of this.fighters) {
      const m = f.move;
      if (!m || (m.kind !== 'strike' && m.kind !== 'grab') || f.phase() !== 'active') continue;
      let c: Vector3;
      if (m.bone) c = f.ch.bonePos(m.bone);
      else c = f.ch.bonePos('chest').add(f.facing().scale(m.reach ?? 0.8));
      for (const t of this.enemiesOf(f)) {
        if (f.hitList.has(t.id) || !t.isVulnerable()) continue;
        if (m.kind === 'grab' && (!t.grounded || t.state === 'down')) continue;
        if (!this.overlaps(c, m.radius * (f.ch.root.scaling.y), t)) continue;
        f.hitList.add(t.id);
        this.applyHit(f, t, m, c);
      }
    }
  }

  applyHit(f: Fighter, t: Fighter, m: Move, at: Vector3, damageScale = 1): HitResult {
    const dir = t.pos.subtract(f.pos);
    dir.y = 0;
    if (dir.lengthSquared() < 1e-4) dir.copyFrom(f.facing());
    dir.normalize();
    const spark = f.blackSpark && (m.name === 'heavy' || m.name === 'heavy2');
    const sure = this.domainOwner === f;
    let dmg = m.damage * damageScale * scaling(t.comboTaken) * f.power * t.defense;
    if (spark) dmg *= 2.5;
    if (f.vowTime > 0) dmg *= 2;
    if (sure) dmg *= 1.3;
    let marked = false;
    if (m.mark && t.marks.has(m.mark)) {
      // a second strike on a seal "tolls" it
      dmg *= 1.6;
      marked = true;
      t.marks.delete(m.mark);
    } else if (m.mark) {
      t.marks.set(m.mark, 8);
    }
    const res = t.receive(f, m, dmg, dir, { blackSpark: spark, sureHit: sure });
    if (res === 'hit') {
      f.moveHit = true;
      f.energy = Math.min(100, f.energy + (m.gain ?? 3) + (spark ? 30 : 0));
      f.domainGauge = Math.min(100, f.domainGauge + dmg * 0.06 + (spark ? 25 : 0));
      if (m.name.startsWith('light') || m.name.startsWith('air_light')) f.lightHitAt = f.time;
      this.hitstop = Math.max(this.hitstop, spark ? 0.32 : 0.045 + Math.min(dmg, 160) / 1400 + (m.heavy ? 0.04 : 0));
      if (!t.alive) {
        this.hitstop = 0.25;
        this.fx.ko(t, f);
      }
    } else if (res === 'perfect') {
      f.staggerOpen();
      this.hitstop = 0.12;
    } else {
      f.moveHit = true;
      this.hitstop = Math.max(this.hitstop, 0.03);
    }
    this.fx.hit(f, t, m, at, dmg, res, spark, marked);
    return res;
  }

  private updateProjectiles(dt: number): void {
    for (const p of this.projectiles) {
      if (!p.alive) continue;
      p.age += dt;
      p.life -= dt;
      const tgt = p.owner.target;
      if (p.homing > 0 && tgt && tgt.alive) {
        const want = this.hurtCenter(tgt, tgt.pos.y + tgt.height * 0.55).subtract(p.pos);
        want.normalize();
        const sp = p.vel.length();
        const cur = p.vel.scale(1 / sp);
        const k = Math.min(1, p.homing * dt);
        const nd = cur.add(want.subtract(cur).scale(k)).normalize();
        p.vel.copyFrom(nd.scale(sp));
      }
      p.pos.addInPlace(p.vel.scale(dt));
      if (p.ground) p.pos.y = 0.3;
      this.fx.projectileUpdate(p);
      for (const t of this.enemiesOf(p.owner)) {
        if (p.hit.has(t.id) || !t.isVulnerable()) continue;
        if (this.overlaps(p.pos, p.radius, t)) {
          p.hit.add(t.id);
          this.applyHit(p.owner, t, p.move, p.pos.clone());
          p.alive = false;
          this.fx.projectileEnd(p, true);
          break;
        }
      }
      const out = Vector3.Distance(new Vector3(p.pos.x, 0, p.pos.z), this.arenaCenter) > this.arenaRadius + 6;
      if (p.alive && (p.life <= 0 || out)) {
        p.alive = false;
        this.fx.projectileEnd(p, false);
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private updateAreas(dt: number): void {
    for (const a of this.areas) {
      a.timer += dt;
      if (a.timer < a.delay) continue;
      const since = a.timer - a.delay;
      const want = a.interval > 0 ? Math.min(a.hits, 1 + Math.floor(since / a.interval)) : 1;
      while (a.fired < want) {
        a.fired++;
        {
          this.fx.areaFire(a.owner, a.kind, a.center, a.radius);
          if (a.fired === 1 && (a.radius > 2.5 || a.move.heavy)) {
            this.cracks.push({ x: a.center.x, z: a.center.z, r: a.radius * 0.8, pal: a.owner.kit.palette, t: 6 });
            if (this.cracks.length > 8) this.cracks.shift();
          }
          for (const t of this.enemiesOf(a.owner)) {
            if (!t.isVulnerable()) continue;
            const d = t.pos.subtract(a.center);
            d.y = 0;
            const dist = d.length();
            if (dist > a.radius + t.radius) continue;
            if (a.cone > 0 && dist > 0.6) {
              const ang = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(d.normalize(), a.dir))));
              if (ang > a.cone) continue;
            }
            const at = this.hurtCenter(t, t.pos.y + t.height * 0.5);
            this.applyHit(a.owner, t, a.move, at, 1);
          }
        }
      }
    }
    this.areas = this.areas.filter((a) => a.timer < a.delay + Math.max(a.interval * a.hits, 0.05) + 0.05);
  }

  /** Bodies don't overlap: push apart on the ground plane. */
  private separate(): void {
    const fs = this.fighters.filter((f) => f.alive || f.state !== 'down');
    for (let i = 0; i < fs.length; i++) {
      for (let j = i + 1; j < fs.length; j++) {
        const a = fs[i];
        const b = fs[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const min = (a.radius + b.radius) * 0.9;
        if (d < min && d > 1e-4 && Math.abs(a.pos.y - b.pos.y) < 1.2) {
          const push = (min - d) * 0.5;
          a.pos.x -= (dx / d) * push;
          a.pos.z -= (dz / d) * push;
          b.pos.x += (dx / d) * push;
          b.pos.z += (dz / d) * push;
        }
      }
    }
  }

  private bounds(): void {
    for (const f of this.fighters) {
      const dx = f.pos.x - this.arenaCenter.x;
      const dz = f.pos.z - this.arenaCenter.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > this.arenaRadius) {
        f.pos.x = this.arenaCenter.x + (dx / d) * this.arenaRadius;
        f.pos.z = this.arenaCenter.z + (dz / d) * this.arenaRadius;
        // wall splat: a launched fighter bounces off the edge
        const vn = (f.vel.x * dx + f.vel.z * dz) / d;
        if (vn > 0) {
          f.vel.x -= (dx / d) * vn * 1.6;
          f.vel.z -= (dz / d) * vn * 1.6;
        }
      }
    }
  }

  /** The domain: for its duration every tick lands on the caster's enemies (sure-hit). */
  startDomain(f: Fighter, duration = 12): void {
    this.domainOwner = f;
    this.domainTimer = duration;
    this.domainTick = 0.8;
    f.domainActive = true;
    f.domainGauge = 0;
    f.power *= 1.25;
  }

  endDomain(): void {
    if (this.domainOwner) {
      this.domainOwner.domainActive = false;
      this.domainOwner.power /= 1.25;
    }
    this.domainOwner = null;
    this.domainTimer = 0;
  }

  private updateDomain(dt: number): void {
    const f = this.domainOwner;
    if (!f) return;
    this.domainTimer -= dt;
    f.energy = 100;
    this.domainTick -= dt;
    const d = f.kit.domain;
    if (d && this.domainTick <= 0) {
      this.domainTick = d.tick;
      for (const t of this.enemiesOf(f)) {
        if (!t.isVulnerable()) continue;
        const m: Move = { name: 'domain', clip: '', startup: 0, active: 0, recovery: 0, damage: d.damage, hitstun: 0.5, push: 1.5, radius: 0, kind: 'area', unblockable: true };
        this.applyHit(f, t, m, this.hurtCenter(t, t.pos.y + t.height * 0.6));
        this.fx.domainTick(f, t, d.damage);
      }
    }
    if (this.domainTimer <= 0 || !f.alive) this.endDomain();
  }

  clear(): void {
    for (const p of this.projectiles) this.fx.projectileEnd(p, false);
    this.projectiles = [];
    this.areas = [];
    this.fields = [];
    this.cracks = [];
    this.hitstop = 0;
    this.endDomain();
    this.domainRequest = null;
  }
}
