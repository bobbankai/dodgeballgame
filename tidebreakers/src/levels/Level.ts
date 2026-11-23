// A level: its world (terrain, sea, scenery kit, lights, sky and grade), its cast, and its story script.
// Scripts are split into named beats; every beat is a checkpoint, and `script(at)` starts from any of
// them (death and Continue restart at the last one; `?at=` jumps there for testing).
import { Vector3, ShaderMaterial } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { Renderer, PostFx } from '../render/Renderer';
import type { Game } from '../game/Game';
import type { UI } from '../ui/UI';
import type { Audio } from '../audio/Audio';
import type { Input } from '../core/Input';
import type { PlayerController } from '../game/Player';
import type { Fighter } from '../game/Fighter';
import { Director } from '../story/Director';
import { Terrain, Sea, EnvKit, type HeightFn, type MaskFn, type TerrainPalette } from '../world/World';
import { skyMaterial, type SkyLook } from '../render/materials';
import { spawn, brains, type Kind } from '../game/Spawn';
import { CrewBrain, type CrewKind } from '../ai/Crew';
import { BossBrain, type BossKind } from '../ai/Bosses';
import { equip } from '../game/Props';
import { Grass, type GrassLook } from '../world/Grass';
import { bolt } from '../render/Vfx';

export type Mood = Parameters<Audio['play']>[0];

export interface FlowApi {
  save(level: string, at: string): void;
  flags: Record<string, boolean>;
  props: EnvKit;
}

export interface Ctx { r: Renderer; game: Game; ui: UI; audio: Audio; input: Input; pc: PlayerController; flow: FlowApi }

export interface LookDef {
  sun: [number, number, number];
  sunIntensity: number;
  sunColor: [number, number, number];
  sky: SkyLook;
  skyColor: [number, number, number];
  groundColor: [number, number, number];
  shadowTint: [number, number, number, number];
  rim?: [number, number, number, number];
  fog: [number, number, number, number];
  fogParams?: [number, number, number, number];
  sea?: { color: [number, number, number, number]; shallow: [number, number, number, number]; level?: number; amp?: number; chop?: number; storm?: number };
  grade?: [number, number, number, number];
  fx?: Partial<PostFx>;
  wind?: [number, number, number];
}

export type Wave = [string, number, number, number?][];

export interface FightSpec {
  center: Vector3;
  radius: number;
  waves: Wave[];
  music?: Mood;
  after?: Mood;
  objective?: string;
  hint?: string;
  tokens?: number;
  onWave?: (i: number) => void;
  /** don't drop the arena wall when done (boss phases) */
  keepArena?: boolean;
}

export abstract class Level {
  abstract readonly id: string;
  abstract readonly beats: string[];
  readonly dir: Director;
  terrain: Terrain | null = null;
  sea: Sea | null = null;
  grass: Grass | null = null;
  kit: EnvKit;
  readonly meshes: AbstractMesh[] = [];
  readonly mats: ShaderMaterial[] = [];
  crew = new Map<CrewKind, { f: Fighter; brain: CrewBrain }>();
  boss: { f: Fighter; brain?: BossBrain } | null = null;
  private arenaT = 0;
  done = false;
  startedAt = '';

  constructor(readonly ctx: Ctx) {
    this.dir = new Director(ctx.game, ctx.ui, ctx.audio, ctx.pc);
    this.kit = new EnvKit(ctx.r);
  }

  get game(): Game { return this.ctx.game; }
  get r(): Renderer { return this.ctx.r; }
  get kai(): Fighter { return this.ctx.pc.f; }

  /** Build the world. */
  abstract build(): Promise<void>;
  /** The story from beat `at` on. Resolves when the level is complete. */
  abstract script(at: string): Promise<void>;
  /** Per-frame level logic (ambient life, hazards). */
  tick(_dt: number): void { /* optional */ }

  async load(at: string): Promise<void> {
    this.startedAt = at || this.beats[0];
    await this.build();
  }

  /** True when the script should run this beat (it is the start beat or comes after it). */
  from(beat: string): boolean {
    return this.beats.indexOf(beat) >= this.beats.indexOf(this.startedAt);
  }

  /** True only for the beat the level was started at (to place the cast for a mid-level start). */
  starting(beat: string): boolean { return beat === this.startedAt; }

  checkpoint(beat: string, pos?: Vector3, yaw?: number): void {
    this.ctx.flow.save(this.id, beat);
    if (pos) this.game.checkpoint = { pos: pos.clone(), yaw: yaw ?? this.kai.yaw };
  }

  // ------------------------------------------------------------------------------------------ world
  setLook(L: LookDef): void {
    const g = this.r.globals;
    g.setSunDir(new Vector3(...L.sun), L.sunIntensity);
    const cnt = g.get('counts');
    g.set('counts', cnt[0], cnt[1], cnt[2], 0);   // dry at the start of a level
    g.set('sunColor', ...L.sunColor, g.get('sunColor')[3]);
    g.set('skyColor', ...L.skyColor, 1);
    g.set('groundColor', ...L.groundColor, 1);
    g.set('shadowTint', ...L.shadowTint);
    if (L.rim) g.set('rimColor', ...L.rim);
    g.set('fogColor', ...L.fog);
    if (L.fogParams) g.set('fogParams', ...L.fogParams);
    if (L.grade) g.set('grade', ...L.grade);
    if (L.sea) {
      g.set('seaColor', ...L.sea.color);
      g.set('seaShallow', ...L.sea.shallow);
      g.set('sea', L.sea.level ?? 0, L.sea.amp ?? 1, L.sea.chop ?? 1, L.sea.storm ?? 0);
    }
    if (L.wind) this.game.wind.set(...L.wind);
    const sky = skyMaterial(this.r, L.sky);
    this.mats.push(sky);
    this.r.setSky(sky);
    Object.assign(this.r.fx, {
      vignette: 0.28, aberration: 0, grain: 0.15, letterbox: 0, fade: 0, impact: 0, speedLines: 0, radialBlur: 0, bloom: 0.3, memory: 0, sepia: 0,
      lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], bloomThreshold: 1.35, ink: 0.85, inkWidth: 1.0, ao: 0.85, aoRadius: 0.9,
      dof: [5, 4, 0], shafts: 0.35, rain: 0,
    } satisfies Partial<PostFx>, L.fx ?? {});
  }

  makeTerrain(h: HeightFn, x0: number, z0: number, size: number, res: number, pal: TerrainPalette, mask?: MaskFn): Terrain {
    this.terrain = new Terrain(this.r, h, x0, z0, size, res, pal, mask);
    this.game.collision.terrain = h;
    return this.terrain;
  }

  makeGrass(density: (x: number, z: number, h: number) => number, look: GrassLook): Grass | null {
    if (!this.terrain || this.r.quality === 'low') return null;
    this.grass = new Grass(this.r, this.terrain, density, look);
    return this.grass;
  }

  makeSea(): Sea {
    this.sea = new Sea(this.r, this.terrain);
    return this.sea;
  }

  async loadKits(...names: string[]): Promise<void> {
    for (const n of names) await this.kit.load(`assets/env/${n}.glb`);
  }

  /** place(name, x, z, rotY, scale, collide) on the ground. */
  put(name: string, x: number, z: number, rot = 0, scale: number | [number, number, number] = 1, collide: 'box' | 'circle' | 'none' | 'platform' = 'box', yOff = 0): void {
    const y = (this.terrain ? this.terrain.height(x, z) : 0) + yOff;
    this.kit.place(name, x, y, z, rot, scale, this.game.collision, collide);
  }

  putAt(name: string, x: number, y: number, z: number, rot = 0, scale: number | [number, number, number] = 1, collide: 'box' | 'circle' | 'none' | 'platform' = 'box'): void {
    this.kit.place(name, x, y, z, rot, scale, this.game.collision, collide);
  }

  light(pos: Vector3, radius: number, color: [number, number, number], intensity = 1): void {
    this.r.globals.lights.push({ pos, radius, color, intensity });
  }

  // ------------------------------------------------------------------------------------------ cast
  async npc(kind: string, key: string, pos: Vector3, yaw = 0, over: Partial<Kind> = {}): Promise<Fighter> {
    const f = await spawn(this.game, kind, pos, yaw, { team: 'neutral', ...over });
    brains.delete(f);
    equip(this.ctx.flow.props, f, kind);
    this.dir.add(key, f);
    return f;
  }

  async addCrew(kind: CrewKind, pos: Vector3, yaw = 0): Promise<Fighter> {
    const f = await spawn(this.game, kind, pos, yaw);
    brains.delete(f);
    const brain = new CrewBrain(f, this.game, kind);
    brains.set(f, brain);
    equip(this.ctx.flow.props, f, kind);
    this.crew.set(kind, { f, brain });
    this.dir.add(kind, f);
    return f;
  }

  async addBoss(kind: BossKind, pos: Vector3, yaw = 0, hp?: number): Promise<{ f: Fighter; brain: BossBrain }> {
    const f = await spawn(this.game, kind, pos, yaw);
    brains.delete(f);
    if (hp) f.hp = f.maxHp = hp;
    const brain = new BossBrain(f, this.game, kind);
    brain.center = pos.clone();
    brains.set(f, brain);
    equip(this.ctx.flow.props, f, kind);
    this.dir.add(kind, f);
    const b = { f, brain };
    this.boss = b;
    return b;
  }

  async enemy(kind: string, x: number, z: number, yaw?: number, over: Partial<Kind> = {}): Promise<Fighter> {
    const p = new Vector3(x, 0, z);
    const f = await spawn(this.game, kind, p, yaw ?? Math.atan2(this.kai.pos.x - x, this.kai.pos.z - z), over);
    equip(this.ctx.flow.props, f, kind);
    return f;
  }

  // ------------------------------------------------------------------------------------------ fights
  async fight(s: FightSpec): Promise<void> {
    const g = this.game, ui = this.ctx.ui;
    g.collision.arena = { x: s.center.x, z: s.center.z, r: s.radius };
    g.combatActive = true;
    g.attackTokens = s.tokens ?? 2;
    this.ctx.audio.play(s.music ?? 'battle');
    if (s.objective) ui.setObjective(s.objective);
    if (s.hint) ui.showHint(s.hint, 7);
    // pull Kai inside the wall if he's outside
    const k = this.kai;
    const dk = Math.hypot(k.pos.x - s.center.x, k.pos.z - s.center.z);
    if (dk > s.radius - 1) k.place(Vector3.Lerp(s.center, k.pos, (s.radius - 2) / dk), k.yaw);
    for (const c of this.crew.values()) {
      const dc = Math.hypot(c.f.pos.x - s.center.x, c.f.pos.z - s.center.z);
      if (dc > s.radius - 1) c.f.place(Vector3.Lerp(s.center, c.f.pos, (s.radius - 2.5) / dc), c.f.yaw);
    }
    for (let i = 0; i < s.waves.length; i++) {
      s.onWave?.(i);
      const spawned: Fighter[] = [];
      for (const [kind, x, z, yaw] of s.waves[i]) {
        const f = await this.enemy(kind, x, z, yaw);
        g.vfx.burst(f.center, [0.4, 0.4, 0.55], 10, 3, 'smoke', 0.6, 0.6);
        spawned.push(f);
      }
      await this.dir.until(() => spawned.every((f) => !f.alive));
      await this.dir.wait(i === s.waves.length - 1 ? 1.2 : 0.8);
    }
    if (!s.keepArena) g.collision.arena = null;
    g.combatActive = false;
    if (s.objective) ui.setObjective(null);
    this.ctx.audio.play(s.after ?? 'island');
  }

  /** Waits until Kai is within `r` of `p` (exploration goals). Shows an objective while waiting. */
  async reach(p: Vector3, r: number, objective?: string): Promise<void> {
    if (objective) this.ctx.ui.setObjective(objective);
    this.marker = p;
    await this.dir.until(() => Math.hypot(this.kai.pos.x - p.x, this.kai.pos.z - p.z) < r);
    this.marker = null;
    if (objective) this.ctx.ui.setObjective(null);
  }

  marker: Vector3 | null = null;
  private markerT = 0;
  /** burning points (flames, smoke, flickering light) */
  fires: { pos: Vector3; size: number; light: number }[] = [];
  /** 0..1 rain around the camera */
  rain = 0;
  /** seconds until the next lightning flash (storms) */
  lightningT = -1;
  private flash = 0;

  addFire(pos: Vector3, size = 1): void {
    const light = this.r.globals.lights.length;
    this.r.globals.lights.push({ pos: pos.add(new Vector3(0, 0.8 * size, 0)), radius: 7 * size, color: [1.0, 0.55, 0.2], intensity: 2.2 });
    this.fires.push({ pos: pos.clone(), size, light });
  }

  private weather(dt: number): void {
    const g = this.game, vfx = g.vfx;
    for (const f of this.fires) {
      const L = this.r.globals.lights[f.light];
      if (L) L.intensity = 1.8 + Math.sin(g.time * 13 + f.pos.x) * 0.35 + Math.sin(g.time * 7.3) * 0.25;
      if (Math.random() < dt * 14 * f.size) {
        vfx.spawn({ x: f.pos.x + (Math.random() - 0.5) * f.size * 0.9, y: f.pos.y + 0.35 * f.size, z: f.pos.z + (Math.random() - 0.5) * f.size * 0.9, vx: g.wind.x * 0.3, vy: 0.8 + Math.random() * 0.6, vz: g.wind.z * 0.3,
          size: (0.9 + Math.random() * 0.5) * f.size, grow: -0.2 * f.size, life: 0.6 + Math.random() * 0.35, r: 1, g: 1, b: 1, a: 0.95, rot: Math.random() * 100 }, 'flame');
      }
      if (Math.random() < dt * 5 * f.size) {
        vfx.spawn({ x: f.pos.x + (Math.random() - 0.5) * f.size, y: f.pos.y + 0.6 * f.size, z: f.pos.z + (Math.random() - 0.5) * f.size, vx: g.wind.x + (Math.random() - 0.5) * 1.5, vy: 2.5 + Math.random() * 2.5, vz: g.wind.z + (Math.random() - 0.5) * 1.5,
          size: 0.06, life: 1.4 + Math.random(), r: 1, g: 1, b: 1, a: 1, drag: 0.4 }, 'ember');
      }
      if (Math.random() < dt * 8 * f.size) {
        vfx.spawn({ x: f.pos.x, y: f.pos.y + 1.4 * f.size, z: f.pos.z, vx: g.wind.x * 1.5, vy: 1.6, vz: g.wind.z * 1.5, size: 0.9 * f.size, grow: 1.4, life: 3, r: 0.22, g: 0.2, b: 0.2, a: 0.5, drag: 0.2, rot: Math.random() * 6 }, 'smoke');
      }
    }
    this.r.fx.rain = this.rain * 0.75;
    // surfaces get wet over a few seconds of rain and dry more slowly
    const cnt = this.r.globals.get('counts');
    const wet = cnt[3] + (Math.min(1, this.rain) - cnt[3]) * Math.min(1, dt * (this.rain > cnt[3] ? 0.5 : 0.15));
    this.r.globals.set('counts', cnt[0], cnt[1], cnt[2], wet);
    if (this.rain > 0) {
      const c = g.cam.cam.position;
      const n = Math.floor(this.rain * 90 * dt * 60 / 60 * 2.2);
      for (let i = 0; i < n; i++) {
        const x = c.x + (Math.random() - 0.5) * 28, z = c.z + (Math.random() - 0.5) * 28;
        vfx.spawn({ x, y: c.y + 6 + Math.random() * 6, z, vx: g.wind.x * 2, vy: -24, vz: g.wind.z * 2, size: 0.05, life: 0.6, r: 0.7, g: 0.8, b: 1.0, a: 0.35, stretch: 7 }, 'drop');
      }
    }
    if (this.lightningT > 0) {
      this.lightningT -= dt;
      if (this.lightningT <= 0) {
        this.flash = 1;
        this.lightningT = 4 + Math.random() * 7;
        // a forked bolt somewhere in front of the camera
        const cam = g.cam.cam;
        const fwd = cam.getDirection(new Vector3(0, 0, 1));
        const side = new Vector3(fwd.z, 0, -fwd.x).scale((Math.random() - 0.5) * 120);
        const top = cam.position.add(fwd.scale(90 + Math.random() * 60)).add(side).add(new Vector3(0, 70, 0));
        const bottom = top.add(new Vector3((Math.random() - 0.5) * 30, -70 - cam.position.y, (Math.random() - 0.5) * 30));
        bolt(vfx, top, bottom, 0.35, 1.6, 6, 4);
        setTimeout(() => g.sfx('thunder', undefined, 0.8), 300 + Math.random() * 900);
      }
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      const f = this.flash > 0.7 || (this.flash > 0.3 && this.flash < 0.45) ? this.flash : this.flash * 0.3;
      this.r.globals.set('flash', 0.8 * f, 0.85 * f, 1.0 * f, f);
    }
  }

  update(dt: number): void {
    const g = this.game;
    // crew call
    if (this.ctx.input.consume('assist')) {
      let used = false;
      for (const c of this.crew.values()) if (!used && c.brain.assist()) used = true;
      if (!used && this.crew.size) g.sfx('denied');
    }
    // the arena wall: a ring of wind streaks
    const a = g.collision.arena;
    if (a) {
      this.arenaT += dt;
      for (let i = 0; i < 3; i++) {
        const th = Math.random() * Math.PI * 2;
        const x = a.x + Math.cos(th) * a.r, z = a.z + Math.sin(th) * a.r;
        const y = g.collision.groundAt(x, z, 100);
        g.vfx.spawn({ x, y: y + 0.2 + Math.random() * 0.6, z, vx: -Math.sin(th) * 2.5, vy: 1.2 + Math.random(), vz: Math.cos(th) * 2.5, size: 0.5, grow: 0.8, life: 0.9,
          r: 0.9, g: 1.4, b: 1.8, a: 0.55, drag: 1, rot: th, stretch: 2 }, 'wind');
      }
    }
    // objective marker: a gold glow column
    if (this.marker) {
      this.markerT += dt;
      if (this.markerT > 0.05) {
        this.markerT = 0;
        const m = this.marker;
        const y = g.collision.groundAt(m.x, m.z, 1000);
        g.vfx.spawn({ x: m.x + (Math.random() - 0.5) * 0.6, y: y + 0.1, z: m.z + (Math.random() - 0.5) * 0.6, vy: 2.2, size: 0.28, grow: -0.1, life: 1.4, r: 2.6, g: 1.9, b: 0.6, a: 0.8 }, 'glow');
      }
    }
    this.weather(dt);
    if (this.grass) {
      this.grass.setPusher(this.kai.pos.x, this.kai.pos.y, this.kai.pos.z, 1.1);
      const c = g.cam.cam.position;
      this.grass.update(c.x, c.z);
    }
    this.tick(dt);
    this.dir.step(dt);
  }

  dispose(): void {
    this.dir.stop();
    this.terrain?.dispose();
    this.sea?.dispose();
    this.grass?.dispose();
    this.kit.dispose();
    for (const m of this.meshes) m.dispose();
    for (const m of this.mats) m.dispose();
    for (const f of [...brains.keys()]) if (f !== this.kai) brains.delete(f);
  }
}

export const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
