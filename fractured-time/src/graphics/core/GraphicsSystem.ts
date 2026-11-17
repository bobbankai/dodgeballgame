import * as THREE from 'three/webgpu';
import { probeCapabilities, suggestPreset, type Capabilities } from './capabilities';
import { createDevice } from './device';
import { FrameTiming } from './timing';
import { Resolution } from './resolution';
import { resources, type ResourceManager } from './resources';
import { PRESETS, loadSettings, saveSettings, urlOverrides, normalisePreset, type GraphicsSettings, type PresetName } from '../config/presets';
import { FrameGraph, type DebugView, type FogStage } from '../postprocessing/FrameGraph';
import { AutoExposure } from '../postprocessing/exposure';
import { Grader, type GradeName } from '../postprocessing/grade';
import { createLook, type LookUniforms } from '../postprocessing/look';
import { PerfOverlay } from '../debugging/overlay';

/**
 * The renderer as the game sees it. Owns the device, the settings, the frame graph and everything per frame (eye adaptation,
 * grading, timing, dynamic resolution, the overlay). The game hands it a scene and a camera, sets looks and grades, and
 * calls `render(dt)` once per displayed frame.
 */
export class GraphicsSystem {
  readonly renderer: THREE.WebGPURenderer;
  caps: Capabilities;
  settings: GraphicsSettings;
  /** the preset the settings were derived from (custom settings are saved as overrides on it) */
  presetBase: PresetName;
  readonly timing: FrameTiming;
  readonly resolution: Resolution;
  readonly resources: ResourceManager = resources;
  readonly exposure: AutoExposure;
  readonly grader = new Grader();
  readonly look: LookUniforms = createLook();
  readonly graph: FrameGraph;
  readonly pmrem: THREE.PMREMGenerator;
  readonly test: boolean;
  debugView: DebugView = 'final';
  private overlay: PerfOverlay;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private fog: FogStage | null = null;
  private listeners: ((s: GraphicsSettings, changed: (keyof GraphicsSettings)[]) => void)[] = [];
  private lastFrame = 0;
  private dirty = true;

  private constructor(renderer: THREE.WebGPURenderer, caps: Capabilities, settings: GraphicsSettings, base: PresetName, test: boolean) {
    this.renderer = renderer;
    this.caps = caps;
    this.settings = settings;
    this.presetBase = base;
    this.test = test;
    this.timing = new FrameTiming(renderer);
    this.resolution = new Resolution(caps.touch);
    this.exposure = new AutoExposure(renderer, caps.compute);
    this.graph = new FrameGraph(renderer);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.overlay = new PerfOverlay(this);
    resources.anisotropy = settings.anisotropy;
  }

  /** Detect the device, pick the settings (saved, `?quality=`, `?gfx.*=` overrides) and create the renderer. */
  static async create(canvas: HTMLCanvasElement, opts: { preset?: string | null; test?: boolean } = {}): Promise<GraphicsSystem> {
    const qs = new URLSearchParams(location.search);
    const caps0 = await probeCapabilities();
    const asked = normalisePreset(qs.get('quality')) ?? normalisePreset(opts.preset);
    const base: PresetName = asked ?? suggestPreset(caps0);
    const settings: GraphicsSettings = asked ? { ...PRESETS[asked] } : loadSettings(base);
    const ov = urlOverrides(qs);
    Object.assign(settings, ov);
    if (Object.keys(ov).length) settings.preset = 'custom';
    if (opts.test) settings.dynamicResolution = false;
    const { renderer, caps } = await createDevice(canvas, caps0, { timing: qs.has('perf') || !opts.test });
    const g = new GraphicsSystem(renderer, caps, settings, base, !!opts.test);
    g.resize();
    addEventListener('resize', () => g.resize());
    return g;
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }
  get backend(): 'webgpu' | 'webgl2' { return this.caps.backend; }

  /** The scene and camera the frame graph draws. */
  attach(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.dirty = true;
  }

  /** The atmosphere's volumetric stage (null: none). */
  setFog(fog: FogStage | null): void {
    this.fog = fog;
    this.dirty = true;
  }

  /** Work that renders before the frame graph each frame (shadow maps, mirrors). */
  private passes: ((r: THREE.WebGPURenderer, dt: number) => void)[] = [];
  addPass(f: (r: THREE.WebGPURenderer, dt: number) => void): void { this.passes.push(f); }

  /** Whether the volumetric fog stage is live in the current graph. */
  get volumetric(): boolean {
    if (this.dirty && this.scene) this.rebuild();
    return this.graph.fogLive;
  }

  setDebugView(v: DebugView): void {
    this.debugView = v;
    this.dirty = true;
  }

  /** Switch preset (saved on this device). */
  setPreset(name: PresetName): void {
    const prev = this.settings;
    this.presetBase = name;
    this.apply({ ...PRESETS[name], dynamicResolution: this.test ? false : PRESETS[name].dynamicResolution }, prev);
  }

  /** Change individual settings (the preset becomes 'custom'). */
  set(patch: Partial<GraphicsSettings>): void {
    const prev = this.settings;
    this.apply({ ...prev, ...patch, preset: 'custom' }, prev);
  }

  /** Called with the new settings and the keys that changed (materials rebuild on the ones they use). */
  onChange(fn: (s: GraphicsSettings, changed: (keyof GraphicsSettings)[]) => void): void { this.listeners.push(fn); }

  private apply(next: GraphicsSettings, prev: GraphicsSettings): void {
    this.settings = next;
    const changed = (Object.keys(next) as (keyof GraphicsSettings)[]).filter((k) => next[k] !== prev[k]);
    if (!this.test) saveSettings(next, this.presetBase);
    if (changed.includes('anisotropy')) resources.setAnisotropy(next.anisotropy);
    this.resize();
    this.dirty = true;
    for (const f of this.listeners) f(next, changed);
  }

  /** Place grade (eased over ~2 s). */
  grade(name: GradeName): void { this.grader.to(name); }

  resize(): void {
    const c = this.canvas;
    const w = c.clientWidth || innerWidth;
    const h = c.clientHeight || innerHeight;
    this.renderer.setPixelRatio(this.resolution.pixelRatio(this.settings, h));
    this.renderer.setSize(w, h, false);
  }

  /** Draw one frame. `dt` in seconds (real time: the eye adapts in real time even when the world is slowed). */
  render(dt?: number): void {
    if (!this.scene || !this.camera) return;
    const now = performance.now();
    const step = dt ?? (this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 1 / 60);
    this.lastFrame = now;
    if (this.dirty) this.rebuild();
    this.fog?.update?.();
    for (const f of this.passes) f(this.renderer, step);
    this.exposure.update(step, this.graph.sceneTexture);
    this.grader.update(step);
    this.graph.render();
    this.timing.frame();
    if (!this.test && this.resolution.adapt(this.settings, this.timing.gpuMs ?? this.timing.frameMs)) this.resize();
    this.overlay.update();
  }

  /** Render n frames so temporal effects converge (stills, after a cut). */
  settle(n = 12): void {
    this.exposure.snap(n);
    for (let i = 0; i < n; i++) this.render(1 / 60);
  }

  /** A camera cut or a teleport: the eye takes the new place at once. */
  cut(): void { this.exposure.snap(); }

  private rebuild(): void {
    this.dirty = false;
    this.exposure.use(this.settings.autoExposure);
    this.graph.build({
      scene: this.scene!, camera: this.camera!, settings: this.settings, caps: this.caps, look: this.look, grader: this.grader,
      exposure: this.exposure, fog: this.fog, debug: this.debugView,
    });
  }

  /** What is live (tests and the overlay). */
  describe(): string {
    if (this.dirty) this.rebuild();
    return this.graph.features.join(', ') || 'none';
  }

  set onDeviceLost(fn: () => void) { (this.renderer as any).onDeviceLost = fn; }

  dispose(): void {
    this.graph.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}
