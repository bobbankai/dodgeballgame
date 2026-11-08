import { Color4, Scene, UniversalCamera, Vector3, type Camera } from '@babylonjs/core';
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
import { applyEnginePatches } from '../render/EnginePatches';
import { Color3 } from '@babylonjs/core';

/**
 * Top-level owner of every system. One scene for the whole game: levels stream their content into
 * it and dispose it again, while the engine, physics world, UI and audio persist.
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
  readonly params: URLSearchParams;
  /** In test mode the harness advances time explicitly (deterministic). */
  readonly manualTime: boolean;
  private lastTime = performance.now();
  private running = false;
  fps = 0;

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
    scene.activeCamera = this.camera;
    this.lighting = new Lighting(scene);
    this.sky = new Sky(scene);
    this.pipe = new Pipeline(scene, this.camera);
    this.mats = new MaterialLibrary(scene);
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
    this.lighting.apply({
      sunColor: new Color3(1.0, 0.86, 0.7),
      sunIntensity: 4.2,
      sunElevation: 0.42,
      sunAzimuth: 2.5,
      skyFill: new Color3(0.55, 0.62, 0.75),
      groundFill: new Color3(0.25, 0.2, 0.17),
      fillIntensity: 0.12,
      environmentIntensity: 0.9,
      exposure: 1,
      contrast: 1.1,
      shadowDarkness: 0,
    }, this.sky);
    this.lighting.setShadowQuality(g.shadows, this.camera);
    this.pipe.setSun(this.sky.mesh);
    await this.lighting.captureEnvironment(this.sky);
    this.pipe.build(g);
    const level = this.params.get('level') ?? 'sandbox';
    if (level === 'sandbox') buildSandbox(this.scene, this.mats, this.lighting, this.physics);
    this.camera.setTarget(new Vector3(0, 1.5, 0));
    await this.scene.whenReadyAsync();
    log.info(`ready (${this.host.backend})`);
    if (!this.manualTime) this.start();
    (window as unknown as { __ready: boolean }).__ready = true;
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
    const n = this.clock.accumulate(realDt);
    for (let i = 0; i < n; i++) this.step(Clock.STEP);
    this.fps = this.fps * 0.95 + (realDt > 0 ? 1 / realDt : 0) * 0.05;
    this.render(realDt);
  }

  private step(dt: number): void {
    this.clock.tick();
    this.physics.step(dt);
  }

  private render(dt: number): void {
    this.sky.update(dt, this.clock.time);
    if (this.pipe.atmosphere) {
      this.pipe.atmosphere.sunDir.copyFrom(this.lighting.toSun);
      this.pipe.atmosphere.sunColor.copyFrom(this.lighting.sun.diffuse.scale(this.lighting.sun.intensity * 0.1));
    }
    this.pipe.update(dt);
    this.scene.render();
  }

  /** Test hook: advance game time by `seconds` in fixed steps and render one frame. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / Clock.STEP);
    for (let i = 0; i < steps; i++) this.step(Clock.STEP);
    // Outside runRenderLoop the engine's frame must be opened and closed by hand (WebGPU submits
    // its command buffers in endFrame).
    const engine = this.host.engine;
    engine.beginFrame();
    this.render(seconds);
    engine.endFrame();
  }
}
