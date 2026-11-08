import { Color3, Color4, Scene, UniversalCamera, Vector3, type Camera } from '@babylonjs/core';
import { EngineHost, type Backend } from '../core/EngineHost';
import { Clock } from '../core/Clock';
import { Settings } from '../core/Settings';
import { log } from '../core/Log';
import { Lighting } from '../render/Lighting';
import { Sky } from '../render/Sky';
import { Pipeline } from '../render/Pipeline';
import { MaterialLibrary } from '../render/Materials';
import { Physics } from '../physics/Physics';
import { buildSandbox } from '../dev/Sandbox';
import { buildViewer } from '../dev/Viewer';
import { AssetManager } from '../assets/AssetManager';
import { applyEnginePatches } from '../render/EnginePatches';
import { MatEnv } from '../render/materials/EcPlugin';
import { Input } from '../input/Input';
import { CameraRig } from '../camera/CameraRig';
import { CombatWorld } from '../combat/CombatWorld';
import { Player } from '../player/Player';
import { Character } from '../character/Character';
import { CharacterMaterials } from '../character/CharacterMaterials';
import { AnimLibrary } from '../anim/AnimLibrary';
import { attachWeapon } from '../character/Weapons';
import type { Level, Atmos } from '../world/Level';
import { createLevel } from '../levels/registry';
import { HUD } from '../ui/HUD';
import { Audio, type LoopHandle } from '../audio/Audio';
import type { Enemy } from '../ai/Enemy';
import { Vfx } from '../vfx/Vfx';
import { LocalLights } from '../render/LocalLights';
import { GroundFx } from '../vfx/GroundFx';
import { BladeTrail } from '../vfx/BladeTrail';
import { Projectiles } from '../combat/Projectiles';
import { Hazards } from '../combat/Hazards';
import { AiDirector } from '../ai/AiDirector';
import type { Navigation } from '../ai/Navigation';
import type { AiContext } from '../ai/Enemy';
import { Enemies } from '../ai/Enemies';
import type { HitEvent } from '../combat/CombatWorld';

/**
 * Top-level owner of every system. One scene for the whole game: levels stream their content into
 * it and dispose it again, while the engine, physics world, player, UI and audio persist.
 */
export class Game {
  readonly host: EngineHost;
  readonly scene: Scene;
  readonly camera: UniversalCamera;
  readonly clock = new Clock();
  readonly settings: Settings;
  readonly lighting: Lighting;
  readonly sky: Sky;
  readonly pipe: Pipeline;
  readonly mats: MaterialLibrary;
  readonly physics: Physics;
  readonly assets: AssetManager;
  readonly params: URLSearchParams;
  readonly input: Input;
  readonly rig: CameraRig;
  readonly combat = new CombatWorld();
  readonly charMats: CharacterMaterials;
  readonly hud: HUD;
  readonly vfx: Vfx;
  readonly lights: LocalLights;
  readonly audio: Audio;
  private ambience: LoopHandle | null = null;
  private musicCheck = 0;
  readonly ground: GroundFx;
  readonly projectiles: Projectiles;
  readonly hazards: Hazards;
  readonly director = new AiDirector();
  readonly ai: AiContext;
  /** The current level's navmesh and crowd (null in levels without enemies). */
  nav: Navigation | null = null;
  enemies!: Enemies;
  private trail: BladeTrail | null = null;
  humanAnims!: AnimLibrary;
  player: Player | null = null;
  level: Level | null = null;
  /** In test mode the harness advances time explicitly (deterministic). */
  readonly manualTime: boolean;
  private lastTime = performance.now();
  private running = false;
  fps = 0;
  /** Per-step updates registered by levels and systems (fixed timestep). */
  readonly updaters: ((dt: number) => void)[] = [];
  paused = false;

  private constructor(host: EngineHost, scene: Scene, physics: Physics, settings: Settings, params: URLSearchParams) {
    this.host = host;
    this.scene = scene;
    this.physics = physics;
    this.settings = settings;
    this.params = params;
    this.manualTime = params.has('test');
    this.camera = new UniversalCamera('main', new Vector3(0, 3, 10), scene);
    this.camera.minZ = 0.08;
    this.camera.maxZ = 2500;
    this.camera.fov = 0.9;
    this.camera.setTarget(new Vector3(0, 1.5, 0));
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
    this.lighting = new Lighting(scene);
    this.sky = new Sky(scene);
    this.pipe = new Pipeline(scene, this.camera);
    this.mats = new MaterialLibrary(scene);
    this.assets = new AssetManager(scene);
    this.charMats = new CharacterMaterials(scene);
    this.input = new Input(host.canvas, settings);
    this.rig = new CameraRig(this.camera, physics);
    this.rig.shakeScale = settings.data.access.cameraShake;
    this.hud = new HUD(scene, document.getElementById('ui')!);
    this.lights = new LocalLights(scene);
    this.vfx = new Vfx(scene, this.lights);
    this.audio = new Audio(settings.data.audio);
    if (params.has('test')) this.audio.enabled = false;
    this.vfx.onBurst = (name, at, k) => this.burstSound(name, at, k);
    this.ground = new GroundFx(scene);
    this.projectiles = new Projectiles(scene, this.combat, physics, this.vfx);
    this.hazards = new Hazards(this.combat, this.vfx, this.ground);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    this.ai = {
      scene, world: this.combat, director: this.director, physics, vfx: this.vfx, ground: this.ground,
      projectiles: this.projectiles, hazards: this.hazards,
      get nav() { return game.nav; },
      player: () => game.player,
      shake: (k: number) => game.rig.shake(k),
    };
    this.combat.events.on('hit', (h) => this.hitFx(h));
  }

  private burstSound(name: string, at: Vector3, k: number): void {
    const a = this.audio;
    switch (name) {
      case 'fireBurst': a.play('fire_burst', { at, volume: Math.min(1, 0.6 + 0.2 * k) }); break;
      case 'firePillar': a.play('fire_burst', { at, pitch: -5, volume: 1 }); break;
      case 'emberSlam': a.play('slam', { at, volume: Math.min(1, 0.5 + 0.25 * k) }); break;
      case 'aether': a.play('aether', { at }); break;
      case 'tellRed': a.play('fire_cast', { at, pitch: -6, volume: 0.6 }); break;
      default: break;
    }
  }

  /** Sounds for a resolved hit. */
  private hitSound(h: HitEvent): void {
    const a = this.audio;
    const at = h.info.point;
    const burnt = (h.victim as { def?: { glow?: number[] } }).def?.glow !== undefined && !h.victim.heavy;
    switch (h.result) {
      case 'hit': case 'staggered': case 'killed':
        if (h.info.tag === 'lava' || h.info.ranged) break;
        a.play(burnt ? 'hit_ash' : 'hit_metal', { at, volume: 0.7 + 0.3 * h.info.weight, pitch: -3 * h.info.weight });
        if (h.victim === this.player) a.play('kael_hurt', { at });
        if (h.result === 'killed' && h.victim !== this.player) {
          this.hazards.after(0.9, () => a.play('bodyfall', { at: h.victim.position.clone() }));
          this.hazards.after(2.3, () => a.play('ash_dissolve', { at: h.victim.position.clone() }));
        }
        break;
      case 'blocked': a.play('block', { at }); break;
      case 'parried': case 'guardbreak': a.play('parry', { at }); break;
      default: break;
    }
  }

  /** Voices and swings of enemies (hooked when each one spawns). */
  watchEnemy(e: Enemy): void {
    const a = this.audio;
    const big = e.def.scale > 1.5;
    e.events.on('attack', ({ attack }) => {
      const heavy = attack.weight >= 0.7 || e.heavy;
      a.play(big ? 'swing_great' : heavy ? 'swing_heavy' : 'swing_light', { at: e.position, delay: 0.25 / (attack.speed ?? 1), pitch: big ? -4 : 0 });
      if (e.heavy && !big && Math.random() < 0.5) a.play('knight_effort', { at: e.position });
    });
    e.events.on('alerted', () => a.play(big ? 'roar_giant' : e.heavy ? 'knight_effort' : 'thrall_groan', { at: e.position }));
    e.events.on('hurt', ({ result }) => {
      if (result === 'staggered') a.play(big ? 'roar_giant' : e.heavy ? 'knight_effort' : 'thrall_groan', { at: e.position, pitch: big ? 3 : 0, volume: 0.8 });
    });
  }

  /** Impact effects for every resolved hit (sparks on armour, ash from the burnt, parry flashes). */
  private hitFx(h: HitEvent): void {
    this.hitSound(h);
    const back = h.info.direction.scale(-1);
    const victim = h.victim as typeof h.victim & { def?: { id: string; glow?: number[] } };
    switch (h.result) {
      case 'hit':
      case 'staggered':
      case 'killed': {
        if (h.info.ranged) break;
        const burnt = victim.def?.glow !== undefined && !victim.heavy;
        this.vfx.burst(burnt ? 'ash' : 'sparks', h.info.point, back, h.result === 'hit' ? 1 : 1.4);
        if (h.result === 'staggered') this.vfx.burst('sparks', h.info.point, back, 1.6);
        break;
      }
      case 'blocked':
        this.vfx.burst('blocked', h.info.point, back);
        break;
      case 'parried':
      case 'guardbreak':
        this.vfx.burst('parry', h.info.point, back);
        break;
      default:
        break;
    }
  }

  static async create(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<Game> {
    applyEnginePatches();
    const settings = new Settings();
    const gl = params.get('gl') as Backend | null;
    const host = await EngineHost.create(canvas, { prefer: gl ?? undefined, antialias: false });
    host.renderScale = settings.data.graphics.resolution;
    const scene = new Scene(host.engine);
    scene.useRightHandedSystem = true;
    scene.clearColor = new Color4(0, 0, 0, 1);
    scene.ambientColor = new Color3(0, 0, 0);
    // Gameplay drives skeletons and physics itself on a fixed step.
    scene.animationsEnabled = false;
    scene.skipPointerMovePicking = true;
    scene.constantlyUpdateMeshUnderPointer = false;
    const physics = await Physics.create(scene);
    const game = new Game(host, scene, physics, settings, params);
    await game.init();
    return game;
  }

  private async init(): Promise<void> {
    const g = this.settings.data.graphics;
    this.lighting.setShadowQuality(g.shadows, this.camera, this.pipe.caps.varyings);
    this.sky.cloudSteps = { low: 0, medium: 14, high: 24, ultra: 40 }[g.preset];
    this.pipe.build(g);
    this.humanAnims = await AnimLibrary.load(this.assets, 'human');
    this.enemies = new Enemies(this.ai, this.assets, this.charMats, this.humanAnims, this.lighting);
    this.enemies.onSpawn = (e) => this.watchEnemy(e);
    await this.audio.load();
    const level = this.params.get('level') ?? 'playground';
    if (level === 'sandbox' || level === 'viewer') {
      await this.applyAtmos(DEV_ATMOS);
      if (level === 'sandbox') await buildSandbox(this.scene, this.mats, this.lighting, this.physics);
      else {
        const c = await buildViewer(this.scene, this.assets, this.mats, this.lighting, this.camera, this.params.get('char') ?? 'kael', this.params.get('anim'));
        this.updaters.push((dt) => c.update(dt));
        (window as unknown as { __char: unknown }).__char = c;
      }
      if (level === 'sandbox') this.camera.setTarget(new Vector3(0, 1.5, 0));
    } else {
      await this.loadLevel(level, this.params.get('at') ?? undefined);
    }
    await this.scene.whenReadyAsync();
    log.info(`ready (${this.host.backend})`);
    if (!this.manualTime) this.start();
    this.host.canvas.addEventListener('click', () => this.input.requestPointerLock());
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  /** Applies a level's lighting, sky, fog, grade and weather, and re-captures the environment. */
  async applyAtmos(a: Atmos): Promise<void> {
    this.sky.set(a.sky);
    this.lighting.apply(a.lighting, this.sky);
    this.pipe.setLook(a.look);
    const w = a.weather ?? {};
    MatEnv.wetness = w.wetness ?? 0;
    MatEnv.coverAmount = w.cover ?? 0;
    if (w.coverColor) MatEnv.coverColor = w.coverColor;
    MatEnv.windStrength = w.wind ?? 0.25;
    if (w.windDir) {
      MatEnv.wind.set(w.windDir[0], 0, w.windDir[1]);
      this.sky.setWind(w.windDir[0], w.windDir[1]);
    }
    await this.lighting.captureEnvironment(this.sky);
    this.pipe.exposure.reset();
    if (a.music) {
      void this.audio.music(a.music);
      this.audio.setState('explore');
    }
    this.ambience?.stop(2);
    this.ambience = a.ambience ? this.audio.loop(a.ambience) : null;
  }

  async loadLevel(id: string, checkpoint?: string): Promise<void> {
    if (this.level) {
      this.enemies.clear();
      this.projectiles.clear();
      this.hazards.clear();
      this.ground.clear();
      this.director.clear();
      this.nav?.dispose();
      this.nav = null;
      this.level.dispose();
      await this.assets.releaseScope(this.level.scope);
      this.physics.clearLevel();
    }
    const level = createLevel(this, id);
    this.level = level;
    await this.applyAtmos(level.atmosphere());
    await level.load(checkpoint);
    if (!this.player) await this.spawnPlayer();
    const s = level.spawn(checkpoint);
    this.player!.place(s.position, s.yaw);
    this.rig.snapBehind(s.yaw);
    (window as unknown as { __level: unknown }).__level = level;
  }

  private async spawnPlayer(): Promise<void> {
    const c = await Character.create(this.scene, this.assets, this.charMats, this.humanAnims, 'kael', 'kael');
    for (const m of c.meshes) this.lighting.addCaster(m, false);
    await attachWeapon(this.scene, this.assets, c, 'oathkeeper', 'weapon_r', this.lighting);
    this.player = new Player(this.scene, c, this.input, this.rig, this.combat, this.clock, Vector3.Zero());
    const player = this.player;
    player.events.on('attackStart', ({ attack }) => {
      this.enemies.threatened(player);
      if (attack.weight >= 0.65) this.audio.play('kael_effort', { at: player.position });
    });
    player.events.on('swing', ({ attack }) => this.audio.play(attack.weight >= 0.65 ? 'swing_heavy' : 'swing_light', { at: player.bladeWorld().tip }));
    player.events.on('footstep', ({ position }) => this.audio.play(this.level?.surface(position) === 'stone' ? 'step_stone' : 'step_ash', { at: position }));
    player.events.on('dodge', () => this.audio.play('dodge', { at: player.position }));
    player.events.on('land', ({ heavy }) => this.audio.play('land', { at: player.position, volume: heavy ? 1 : 0.6 }));
    player.events.on('heal', () => {
      this.audio.play('heal', { at: player.position });
      this.vfx.burst('heal', player.position);
    });
    player.events.on('perfectDodge', () => this.vfx.burst('aether', player.aimPoint(new Vector3())));
    this.trail = new BladeTrail(this.scene, 'kaelTrail');
    this.combat.events.on('hit', (h) => {
      if (h.attacker === this.player && (h.result === 'hit' || h.result === 'staggered' || h.result === 'killed')) {
        this.hud.damageNumber(h.info.point, h.info.amount, !!h.info.critical);
      }
    });
  }

  /** Explore / combat / boss music from what the enemies are doing. */
  private updateMusic(dt: number): void {
    this.musicCheck -= dt;
    if (this.musicCheck > 0) return;
    this.musicCheck = 0.5;
    const engaged = this.enemies?.list.filter((e) => e.alive && e.engaged) ?? [];
    if (engaged.some((e) => e.boss)) this.audio.setState('boss');
    else if (engaged.length) {
      this.audio.setState('combat');
      this.audio.updateIntensity(Math.min(1, engaged.reduce((s, e) => s + (e.heavy ? 2 : 1), 0) / 5));
    } else this.audio.setState('explore');
  }

  get activeCamera(): Camera {
    return this.scene.activeCamera ?? this.camera;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.host.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.frame(dt);
    });
  }

  /** One real frame: run the fixed steps that fit, then render once. */
  frame(realDt: number): void {
    const n = this.paused ? 0 : this.clock.accumulate(realDt);
    for (let i = 0; i < n; i++) this.step(Clock.STEP);
    this.fps = this.fps * 0.95 + (realDt > 0 ? 1 / realDt : 0) * 0.05;
    this.render(realDt, n * Clock.STEP);
  }

  private step(dt: number): void {
    this.clock.tick();
    this.input.update(this.clock.time);
    this.physics.step(dt);
    if (this.player) {
      this.player.update(dt);
      this.rig.update(dt, { pivot: this.player.position.add(new Vector3(0, 1.45, 0)) }, this.input.look);
      if (this.trail) {
        this.trail.emitting = this.player.swinging;
        const b = this.player.bladeWorld();
        this.trail.sample(b.base, b.tip, dt);
      }
    }
    this.nav?.update(dt);
    this.enemies?.update(dt);
    this.projectiles.update(dt);
    this.hazards.update(dt);
    this.director.update(dt);
    this.updateMusic(dt);
    this.level?.update(dt);
    for (const u of this.updaters) u(dt);
  }

  /** `dt`: real seconds since the last frame; `gameDt`: game seconds simulated for it. */
  private render(dt: number, gameDt: number): void {
    const cam = this.activeCamera;
    this.audio.setListener(cam.globalPosition, cam.getDirection(Vector3.Forward(this.scene.useRightHandedSystem)), cam.upVector);
    this.vfx.update(gameDt);
    this.lights.update(gameDt);
    this.ground.update(gameDt);
    this.trail?.update();
    MatEnv.time = this.clock.time;
    MatEnv.sunDir.copyFrom(this.lighting.toSun);
    this.lighting.sun.diffuse.scaleToRef(this.lighting.sun.intensity, MatEnv.sunColor);
    this.sky.camY = this.activeCamera.globalPosition.y;
    this.sky.update(dt, this.clock.time);
    if (this.pipe.atmosphere) {
      this.pipe.atmosphere.sunDir.copyFrom(this.lighting.toSun);
      this.pipe.atmosphere.sunColor.copyFrom(this.lighting.sun.diffuse.scale(this.lighting.sun.intensity * 0.1));
    }
    const focus = this.player ? this.player.position : this.camera.position;
    this.pipe.update(dt, { center: focus, toSun: this.lighting.toSun });
    this.scene.render();
    this.hud.update(this.player);
  }

  /** Test hook: advance game time by `seconds` in fixed steps and render one frame. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / Clock.STEP);
    for (let i = 0; i < steps; i++) this.step(Clock.STEP);
    // Outside runRenderLoop the engine's frame must be opened and closed by hand (WebGPU submits
    // its command buffers in endFrame).
    const engine = this.host.engine;
    engine.beginFrame();
    this.render(seconds, steps * Clock.STEP);
    engine.endFrame();
  }
}

const DEV_ATMOS: Atmos = {
  lighting: {
    sunColor: new Color3(1.0, 0.86, 0.7), sunIntensity: 4.2, sunElevation: 0.42, sunAzimuth: 2.5,
    skyFill: new Color3(0.55, 0.62, 0.75), groundFill: new Color3(0.25, 0.2, 0.17), fillIntensity: 0.12,
    environmentIntensity: 0.9, exposure: 1, contrast: 1.1, shadowDarkness: 0,
  },
  sky: {},
  look: {},
};
