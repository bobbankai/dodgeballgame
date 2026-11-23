import { Color4, FreeCamera, Scene, Vector3, WebGPUEngine } from '@babylonjs/core';
import { registerShaders } from './ShaderLib';
import { Lighting, Materials } from './Materials';
import { GBufferPass, ShadowPass } from './Passes';
import { PostChain } from './PostChain';
import { Sky } from './Sky';

/** What the device can afford (core/Device.ts graphicsFor): render scale, shadow map, MSAA. */
export interface RenderOptions {
  /** the render scale to start at (the device pixel ratio, capped to this) */
  dprCap?: number;
  /** the sharpest scale the adaptive scaler may climb to when the device has room */
  maxScale?: number;
  shadowSize?: number;
  msaa?: 1 | 4;
}

/** Engine, scene, camera and every render pass, created once for the whole game. */
export class Renderer {
  readonly scene: Scene;
  readonly camera: FreeCamera;
  readonly lighting = new Lighting();
  readonly mats: Materials;
  readonly shadow: ShadowPass;
  readonly gbuffer: GBufferPass;
  readonly post: PostChain;
  readonly sky: Sky;

  /** the render scale the device starts at (1 / hardware scaling) */
  baseScale = 1;
  /** the sharpest render scale the adaptive scaler may climb to */
  bestScale = 1;

  private constructor(readonly engine: WebGPUEngine, opts: RenderOptions = {}) {
    registerShaders();
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0, 0, 0, 1);
    scene.skipPointerMovePicking = true;
    scene.autoClear = true;
    this.camera = new FreeCamera('cam', new Vector3(0, 2, -6), scene, true);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 600;
    this.camera.fov = 0.8;
    this.mats = new Materials(scene, this.lighting);
    this.mats.screenW = engine.getRenderWidth();
    this.mats.screenH = engine.getRenderHeight();
    this.shadow = new ShadowPass(scene, this.mats, this.lighting, opts.shadowSize ?? 2048);
    this.gbuffer = new GBufferPass(scene, this.mats, this.camera, 1);
    this.post = new PostChain(engine, scene, this.camera, this.gbuffer, this.lighting, opts.msaa ?? 4);
    this.sky = new Sky(scene, this.lighting);
    // effects (rendering group 1) are depth-tested against the scene: keep its depth between groups
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    // the sky last among the opaque meshes (the rest grouped by material, as Babylon does): it sits at
    // the far plane, so the depth test skips its clouds wherever the place already covers the screen
    const skyMesh = scene.getMeshByName('sky');
    scene.setRenderingOrder(0, (a, b) => {
      const ma = a.getMesh();
      const mb = b.getMesh();
      const sa = ma === skyMesh ? 1 : 0;
      const sb = mb === skyMesh ? 1 : 0;
      if (sa !== sb) return sa - sb;
      if (ma.material && mb.material) return ma.material.uniqueId - mb.material.uniqueId;
      return ma.uniqueId - mb.uniqueId;
    });
  }

  static async create(canvas: HTMLCanvasElement, opts: RenderOptions = {}): Promise<Renderer> {
    const engine = new WebGPUEngine(canvas, { antialias: false, stencil: true, adaptToDeviceRatio: false, powerPreference: 'high-performance' });
    await engine.initAsync();
    const dpr = Math.min(window.devicePixelRatio || 1, opts.dprCap ?? 1.5);
    engine.setHardwareScalingLevel(1 / dpr);
    const r = new Renderer(engine, opts);
    r.baseScale = dpr;
    r.bestScale = Math.max(dpr, Math.min(window.devicePixelRatio || 1, opts.maxScale ?? dpr));
    return r;
  }

  async ready(): Promise<void> {
    await this.scene.whenReadyAsync();
    for (let i = 0; i < 400 && !this.post.isReady(); i++) await new Promise((r) => setTimeout(r, 30));
  }

  resize(): void {
    this.engine.resize();
    this.mats.screenW = this.engine.getRenderWidth();
    this.mats.screenH = this.engine.getRenderHeight();
    this.post.resize();
  }

  /** Per-frame: shared uniforms, the sun's shadow camera, then scene and post. */
  render(dt: number): void {
    this.shadow.update();
    this.sky.update();
    this.mats.update();
    this.scene.render();
    this.post.render(dt);
  }
}
