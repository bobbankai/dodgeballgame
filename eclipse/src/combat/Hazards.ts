import { Color3, MeshBuilder, StandardMaterial, Vector3, type Mesh, type Scene } from '@babylonjs/core';
import type { CombatWorld, HitEvent } from './CombatWorld';
import type { Combatant, DamageInfo, Team } from './Types';
import type { Vfx, FxHandle } from '../vfx/Vfx';
import type { GroundFx } from '../vfx/GroundFx';

interface Timer {
  at: number;
  fn: () => void;
}

interface Wave {
  pos: Vector3;
  dir: Vector3;
  side: Vector3;
  half: number;
  height: number;
  speed: number;
  left: number;
  total: number;
  team: Team;
  owner: Combatant | null;
  hit: Set<number>;
  mesh: Mesh;
  spray: FxHandle[];
  make: (victim: Combatant) => DamageInfo;
}

interface Pull {
  center: Vector3;
  radius: number;
  strength: number;
  until: number;
}

interface Zone {
  center: Vector3;
  radius: number;
  until: number;
  team: Team;
  owner: Combatant | null;
  tick: number;
  next: Map<number, number>;
  make: (victim: Combatant) => DamageInfo;
}

/**
 * Area attacks that play out over time on the game clock: telegraphed eruptions (a warning circle,
 * then the strike), lingering damage zones (burning ground, tide pools, storm fields), and a small
 * scheduler for anything else that should happen "in N seconds" (it follows hit-stop and pauses).
 */
export class Hazards {
  private timers: Timer[] = [];
  private zones: Zone[] = [];
  private waves: Wave[] = [];
  private pulls: Pull[] = [];
  private waveMat: StandardMaterial | null = null;
  time = 0;
  onHit: ((h: HitEvent) => void) | null = null;
  /** Pushes the player (set by the game: the player's external velocity). */
  pushPlayer: ((v: Vector3) => void) | null = null;
  playerPos: (() => Vector3 | null) | null = null;

  constructor(private world: CombatWorld, private vfx: Vfx, private ground: GroundFx, private scene: Scene) {}

  /**
   * A wall of water rolling across the ground: hits everything of other teams it passes through,
   * unless they jump over its crest or dodge through it (i-frames).
   */
  wave(from: Vector3, dir: Vector3, width: number, height: number, speed: number, distance: number, owner: Combatant | null, team: Team,
    make: (victim: Combatant) => DamageInfo): void {
    const d = new Vector3(dir.x, 0, dir.z).normalize();
    const side = new Vector3(d.z, 0, -d.x);
    if (!this.waveMat) {
      const m = new StandardMaterial('waveMat', this.scene);
      m.diffuseColor = new Color3(0.08, 0.32, 0.36);
      m.emissiveColor = new Color3(0.02, 0.12, 0.15);
      m.specularColor = new Color3(0.9, 0.95, 1);
      m.specularPower = 96;
      m.alpha = 0.72;
      m.backFaceCulling = false;
      this.waveMat = m;
    }
    const mesh = MeshBuilder.CreateCylinder('wave', { height: width, diameter: height * 2, tessellation: 24, arc: 0.5, enclose: false }, this.scene);
    mesh.material = this.waveMat;
    mesh.rotation.set(0, Math.atan2(side.x, side.z), Math.PI / 2);
    mesh.isPickable = false;
    const spray: FxHandle[] = [];
    for (let i = -1; i <= 1; i++) spray.push(this.vfx.attach('waterTrail', from.add(side.scale(i * width * 0.35)), 2));
    this.waves.push({ pos: from.clone(), dir: d, side, half: width / 2, height, speed, left: distance, total: distance, team, owner, hit: new Set(), mesh, spray, make });
  }

  /** Drags the player toward a point (whirlpools, undertow). */
  pull(center: Vector3, radius: number, strength: number, duration: number): void {
    this.pulls.push({ center: center.clone(), radius, strength, until: this.time + duration });
  }

  after(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  /** Warning circle for `delay` seconds, then an eruption that hits everyone of other teams inside. */
  eruption(at: Vector3, radius: number, delay: number, vfx: string, owner: Combatant | null, team: Team,
    make: (victim: Combatant) => DamageInfo, opts: { color?: [number, number, number, number]; scorch?: boolean; zone?: number } = {}): void {
    const pos = at.clone();
    this.ground.telegraph(pos, radius, delay, opts.color);
    this.after(delay, () => {
      this.vfx.burst(vfx, pos, Vector3.Up(), radius / 2);
      this.ground.shockwave(pos, radius * 1.4, opts.color ? [opts.color[0], opts.color[1], opts.color[2], opts.color[3] * 1.3] : undefined);
      if (opts.scorch !== false) this.ground.scorch(pos, radius * 1.1);
      const hits = this.world.area(owner, team, pos, radius, null, make);
      for (const h of hits) this.onHit?.(h);
      if (opts.zone) this.zone(pos, radius * 0.9, opts.zone, owner, team, 0.5, (v) => {
        const i = make(v);
        return { ...i, amount: i.amount * 0.12, poise: 0, knockdown: false, knockback: 0, weight: 0.05 };
      });
    });
  }

  /** Damages anyone standing inside every `tick` seconds until it expires. */
  zone(center: Vector3, radius: number, duration: number, owner: Combatant | null, team: Team, tick: number, make: (victim: Combatant) => DamageInfo): void {
    this.zones.push({ center: center.clone(), radius, until: this.time + duration, team, owner, tick, next: new Map(), make });
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.waves) {
      const step = w.speed * dt;
      w.pos.addInPlace(w.dir.scale(step));
      w.left -= step;
      // the crest rises in and sinks out at the ends of its run
      const swell = Math.min(1, (w.total - w.left + 0.3) / 2.5, (w.left + 0.1) / 3);
      w.mesh.position.copyFrom(w.pos);
      w.mesh.scaling.set(Math.max(0.05, swell), 1, Math.max(0.05, swell));
      w.spray.forEach((sp, i) => sp.move(w.pos.add(w.side.scale((i - 1) * w.half * 0.7)).add(new Vector3(0, w.height * swell, 0))));
      for (const c of this.world.list) {
        if (!c.alive || c.team === w.team || w.hit.has(c.id)) continue;
        const rel = c.position.subtract(w.pos);
        const along = Vector3.Dot(rel, w.dir);
        const across = Math.abs(Vector3.Dot(rel, w.side));
        if (Math.abs(along) > 0.9 || across > w.half) continue;
        if (rel.y > w.height * 0.55 * swell) continue; // cleared it with a jump
        w.hit.add(c.id);
        const h = this.world.apply(w.owner, c, w.make(c), null);
        this.onHit?.(h);
        if (h.result !== 'dodged') this.vfx.burst('splash', c.position.add(new Vector3(0, 1, 0)), w.dir, 1.5);
      }
    }
    const done = this.waves.filter((w) => w.left <= 0);
    for (const w of done) {
      w.mesh.dispose();
      for (const sp of w.spray) sp.stop();
    }
    this.waves = this.waves.filter((w) => w.left > 0);
    const pp = this.playerPos?.();
    if (pp && this.pushPlayer) {
      for (const p of this.pulls) {
        const to = p.center.subtract(pp);
        to.y = 0;
        const d = to.length();
        if (d > p.radius || d < 0.2) continue;
        // stronger toward the eye, with a swirl round it
        const k = p.strength * (1 - d / p.radius * 0.6);
        const swirl = new Vector3(-to.z, 0, to.x).scale(0.6 / d);
        this.pushPlayer(to.scale(1 / d).add(swirl).scale(k));
      }
      this.pulls = this.pulls.filter((p) => p.until > this.time);
    }
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    for (const z of this.zones) {
      for (const c of this.world.list) {
        if (!c.alive || c.team === z.team) continue;
        const dx = c.position.x - z.center.x;
        const dz = c.position.z - z.center.z;
        if (dx * dx + dz * dz > z.radius * z.radius || Math.abs(c.position.y - z.center.y) > 1.5) continue;
        if ((z.next.get(c.id) ?? 0) > this.time) continue;
        z.next.set(c.id, this.time + z.tick);
        const h = this.world.apply(z.owner, c, z.make(c), null);
        this.onHit?.(h);
      }
    }
    this.zones = this.zones.filter((z) => z.until > this.time);
  }

  clear(): void {
    this.timers = [];
    this.zones = [];
    for (const w of this.waves) {
      w.mesh.dispose();
      for (const sp of w.spray) sp.stop();
    }
    this.waves = [];
    this.pulls = [];
  }
}
