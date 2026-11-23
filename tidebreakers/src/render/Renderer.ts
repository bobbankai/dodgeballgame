// The frame: sun shadow cascades -> scene into an HDR multi-render-target (colour + normal/depth/id) ->
// post chain (bloom, final grade) -> canvas. Everything is WGSL; see src/shaders.
import {
  WebGPUEngine, Scene, Color4, Constants, MultiRenderTarget, RenderTargetTexture, EffectRenderer, EffectWrapper,
  ShaderLanguage, ShaderMaterial, FreeCamera, Camera, Vector3, Vector4, Matrix, ThinTexture, MeshBuilder, Mesh,
} from '@babylonjs/core';
import type { AbstractMesh, RenderTargetWrapper, InternalTexture, BaseTexture } from '@babylonjs/core';
import { Globals } from './Globals';
import { registerShaders } from './shaderRegistry';
import './babylonFixes';

export type Quality = 'low' | 'medium' | 'high';

interface Target { rt: RenderTargetWrapper; tex: ThinTexture; w: number; h: number }

export interface PostFx {
  vignette: number; aberration: number; grain: number; letterbox: number;
  fade: number; impact: number; speedLines: number; radialBlur: number;
  radialCenter: [number, number]; bloom: number; memory: number; sepia: number;
  lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
  bloomThreshold: number;
  ink: number; inkWidth: number;
  /** ambient occlusion strength (0 off) and world radius */
  ao: number; aoRadius: number;
  /** depth of field: focus distance, focus range, amount (0 off) */
  dof: [number, number, number];
  /** sun shafts strength */
  shafts: number;
  /** rain on the lens (0..1) */
  rain: number;
}

export class Renderer {
  engine!: WebGPUEngine;
  scene!: Scene;
  globals!: Globals;
  mrt!: MultiRenderTarget;
  quality: Quality = 'high';
  fx: PostFx = {
    vignette: 0.28, aberration: 0, grain: 0.15, letterbox: 0, fade: 0, impact: 0, speedLines: 0, radialBlur: 0,
    radialCenter: [0.5, 0.5], bloom: 0.3, memory: 0, sepia: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    bloomThreshold: 1.35, ink: 0.85, inkWidth: 1.0, ao: 0.85, aoRadius: 0.9, dof: [5, 4, 0], shafts: 0.35, rain: 0,
  };
  readonly casters: AbstractMesh[] = [];
  shadowCenter = new Vector3();
  shadowRadius = [14, 60];
  private shadowRT: RenderTargetTexture[] = [];
  private shadowCams: FreeCamera[] = [];
  private depthMat!: ShaderMaterial;
  private fxr!: EffectRenderer;
  private finalFx!: EffectWrapper;
  private bloomDown!: EffectWrapper;
  private bloomUp!: EffectWrapper;
  private bloomChain: Target[] = [];
  private bloomUpChain: Target[] = [];
  private aoFx!: EffectWrapper;
  private blurFx!: EffectWrapper;
  private dofFx!: EffectWrapper;
  private shaftFx!: EffectWrapper;
  private aoA: Target | null = null;
  private aoB: Target | null = null;
  private dofT: Target | null = null;
  private shaftT: Target | null = null;
  private mrtTex0!: BaseTexture;
  private frameNo = 0;
  private skyMesh: Mesh | null = null;

  constructor(readonly canvas: HTMLCanvasElement, readonly test = false) {}

  async init(quality: Quality = 'high'): Promise<void> {
    registerShaders();
    this.quality = quality;
    this.engine = new WebGPUEngine(this.canvas, { antialias: false, adaptToDeviceRatio: !this.test, stencil: false, powerPreference: 'high-performance' });
    await this.engine.initAsync();
    if (!this.test) this.engine.setHardwareScalingLevel(quality === 'low' ? 1.5 : quality === 'medium' ? 1.15 : 1 / Math.min(window.devicePixelRatio, 1.5));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);
    this.scene.skipPointerMovePicking = true;
    this.scene.autoClear = true;
    this.globals = new Globals(this.engine);
    this.createTargets();
    this.createShadows();
    this.fxr = new EffectRenderer(this.engine);
    const common = { engine: this.engine, useShaderStore: true, shaderLanguage: ShaderLanguage.WGSL, uniformBuffers: ['globals'] };
    this.finalFx = new EffectWrapper({ ...common, name: 'final', fragmentShader: 'tbFinal', samplerNames: ['colorTex', 'bloomTex', 'gbufTex', 'aoTex', 'dofTex', 'shaftTex'],
      uniformNames: ['fxA', 'fxB', 'fxC', 'liftC', 'gammaC', 'gainC', 'inkC', 'postC', 'aoTint'] });
    this.aoFx = new EffectWrapper({ ...common, name: 'ao', fragmentShader: 'tbAO', samplerNames: ['gbufTex'], uniformNames: ['proj', 'texel'] });
    this.blurFx = new EffectWrapper({ ...common, name: 'bilateral', fragmentShader: 'tbBilateral', samplerNames: ['src'], uniformNames: ['dir'], uniformBuffers: [] });
    this.dofFx = new EffectWrapper({ ...common, name: 'dof', fragmentShader: 'tbDof', samplerNames: ['colorTex', 'gbufTex'], uniformNames: ['dof', 'texel'] });
    this.shaftFx = new EffectWrapper({ ...common, name: 'shafts', fragmentShader: 'tbShafts', samplerNames: ['colorTex', 'gbufTex'], uniformNames: ['sun', 'shaftC'] });
    this.bloomDown = new EffectWrapper({ ...common, name: 'bloomDown', fragmentShader: 'tbBloomDown', samplerNames: ['src'], uniformNames: ['texel', 'knee'], uniformBuffers: [] });
    this.bloomUp = new EffectWrapper({ ...common, name: 'bloomUp', fragmentShader: 'tbBloomUp', samplerNames: ['low', 'cur'], uniformNames: ['texel'], uniformBuffers: [] });
    this.engine.onResizeObservable.add(() => this.createTargets());
    window.addEventListener('resize', () => this.engine.resize());
  }

  // ------------------------------------------------------------------------------------------ targets
  private createTargets(): void {
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    this.mrt?.dispose();
    this.mrt = new MultiRenderTarget('main', { width: w, height: h }, 2, this.scene, {
      types: [Constants.TEXTURETYPE_HALF_FLOAT, Constants.TEXTURETYPE_HALF_FLOAT],
      samplingModes: [Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURE_NEAREST_SAMPLINGMODE],
      samples: this.quality === 'low' ? 1 : 4,
      generateDepthBuffer: true,
      doNotChangeAspectRatio: true,
    }, ['color', 'gbuf']);
    this.mrt.renderList = null;
    this.mrtTex0 = this.mrt.textures[0];
    if (this.scene.activeCamera) this.scene.activeCamera.outputRenderTarget = this.mrt;
    for (const t of [...this.bloomChain, ...this.bloomUpChain]) t.rt.dispose();
    this.bloomChain = [];
    this.bloomUpChain = [];
    let bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    const levels = this.quality === 'low' ? 4 : 6;
    for (let i = 0; i < levels; i++) {
      this.bloomChain.push(this.target(bw, bh));
      if (i < levels - 1) this.bloomUpChain.push(this.target(bw, bh));
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
    }
    for (const t of [this.aoA, this.aoB, this.dofT, this.shaftT]) t?.rt.dispose();
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.aoA = this.target(hw, hh);
    this.aoB = this.target(hw, hh);
    this.dofT = this.target(hw, hh);
    this.shaftT = this.target(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.globals?.set('viewport', w, h, 1 / w, 1 / h);
  }

  private target(w: number, h: number): Target {
    const rt = this.engine.createRenderTargetTexture({ width: w, height: h }, {
      type: Constants.TEXTURETYPE_HALF_FLOAT, generateMipMaps: false, generateDepthBuffer: false, generateStencilBuffer: false,
      samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE, format: Constants.TEXTUREFORMAT_RGBA,
    });
    const tex = new ThinTexture(rt.texture as InternalTexture);
    tex.wrapU = tex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    return { rt, tex, w, h };
  }

  // ------------------------------------------------------------------------------------------ shadows
  private createShadows(): void {
    const sizes = this.quality === 'low' ? [1024, 512] : this.quality === 'medium' ? [2048, 1024] : [2048, 2048];
    this.depthMat = new ShaderMaterial('shadowDepth', this.scene, { vertex: 'tbShadowDepth', fragment: 'tbShadowDepth' }, {
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'sway'], uniformBuffers: ['globals'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.depthMat.setUniformBuffer('globals', this.globals.ubo);
    this.depthMat.setVector4('sway', new Vector4(0, 0, 0, 0));
    this.depthMat.alphaMode = Constants.ALPHA_DISABLE;
    for (let i = 0; i < 2; i++) {
      const rtt = new RenderTargetTexture(`shadow${i}`, sizes[i], this.scene, {
        generateMipMaps: false, type: Constants.TEXTURETYPE_FLOAT, format: Constants.TEXTUREFORMAT_R,
        samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE, generateDepthBuffer: true,
      });
      rtt.clearColor = new Color4(1, 1, 1, 1);
      rtt.wrapU = rtt.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
      const cam = new FreeCamera(`shadowCam${i}`, new Vector3(0, 50, 0), this.scene, false);
      cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
      cam.minZ = 0.5;
      cam.maxZ = 400;
      rtt.activeCamera = cam;
      rtt.renderList = this.casters;
      rtt.refreshRate = 1;
      this.scene.customRenderTargets.push(rtt);
      this.shadowRT.push(rtt);
      this.shadowCams.push(cam);
    }
    this.scene.activeCameras = null;
    this.globals.set('shadowParams', 1 / sizes[0], 0.0008, 0.012, 1);
  }

  get shadowTextures(): [BaseTexture, BaseTexture] { return [this.shadowRT[0], this.shadowRT[1]]; }

  /** Registers a mesh as a sun shadow caster (sway > 0 for wind-swayed foliage). */
  addCaster(mesh: AbstractMesh, sway = 0, swayHeight = 3): void {
    if (this.casters.includes(mesh)) return;
    this.casters.push(mesh);
    let mat = this.depthMat;
    if (sway > 0) {
      mat = this.depthMat.clone(`shadowDepthSway${sway}`) as ShaderMaterial;
      mat.setUniformBuffer('globals', this.globals.ubo);
      mat.alphaMode = Constants.ALPHA_DISABLE;
      mat.setVector4('sway', new Vector4(sway, swayHeight, 0, 0));
    }
    for (const rtt of this.shadowRT) rtt.setMaterialForRendering(mesh, mat);
  }

  removeCaster(mesh: AbstractMesh): void {
    const i = this.casters.indexOf(mesh);
    if (i >= 0) this.casters.splice(i, 1);
  }

  private updateShadowCams(): void {
    const sun = new Vector3(...(this.globals.get('sunDir').slice(0, 3) as [number, number, number])).normalize();
    for (let i = 0; i < 2; i++) {
      const cam = this.shadowCams[i];
      const r = this.shadowRadius[i];
      // snap the centre to shadow texels so edges don't crawl when the camera moves
      const size = this.shadowRT[i].getSize().width;
      const texel = (2 * r) / size;
      const c = this.shadowCenter.clone();
      const dist = 150;
      const up = Math.abs(sun.y) > 0.95 ? new Vector3(0, 0, 1) : Vector3.Up();
      const view = Matrix.LookAtLH(c.add(sun.scale(dist)), c, up);
      const lc = Vector3.TransformCoordinates(c, view);
      lc.x = Math.round(lc.x / texel) * texel;
      lc.y = Math.round(lc.y / texel) * texel;
      const inv = view.clone().invert();
      const snapped = Vector3.TransformCoordinates(lc, inv);
      cam.position = snapped.add(sun.scale(dist));
      cam.setTarget(snapped);
      cam.upVector = up;
      cam.orthoLeft = -r; cam.orthoRight = r; cam.orthoTop = r; cam.orthoBottom = -r;
      cam.minZ = 1; cam.maxZ = dist * 2;
      cam.getViewMatrix(true);
      const vp = cam.getViewMatrix().multiply(cam.getProjectionMatrix(true));
      this.globals.setMatrix(i === 0 ? 'shadowMat' : 'shadowMat1', vp);
    }
    this.globals.set('shadowParams', 1 / this.shadowRT[0].getSize().width, this.globals.get('shadowParams')[1], this.globals.get('shadowParams')[2], this.globals.get('shadowParams')[3]);
  }

  // ------------------------------------------------------------------------------------------ sky
  /** Resolution scale changes now; MSAA and shadow sizes follow on the next load (remembered). */
  setQuality(q: Quality): void {
    this.quality = q;
    if (!this.test) this.engine.setHardwareScalingLevel(q === 'low' ? 1.5 : q === 'medium' ? 1.15 : 1 / Math.min(window.devicePixelRatio, 1.5));
    this.globals.set('counts', this.globals.get('counts')[0], this.globals.get('counts')[1], q === 'low' ? 0 : q === 'medium' ? 1 : 2, 0);
    try { localStorage.setItem('tidebreakers.quality', q); } catch { /* */ }
  }

  setSky(mat: ShaderMaterial): Mesh {
    if (!this.skyMesh) {
      this.skyMesh = MeshBuilder.CreateSphere('sky', { diameter: 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, this.scene);
      this.skyMesh.infiniteDistance = false;
      this.skyMesh.isPickable = false;
      this.skyMesh.alwaysSelectAsActiveMesh = true;
    }
    this.skyMesh.material = mat;
    return this.skyMesh;
  }

  // ------------------------------------------------------------------------------------------ frame
  render(time: number, dt: number): void {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    cam.outputRenderTarget = this.mrt;
    const g = this.globals;
    g.set('time', time, dt, this.frameNo++, time);
    g.set('camPos', cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z, 1);
    const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
    g.set('viewport', w, h, 1 / w, 1 / h);
    this.updateShadowCams();
    g.upload();
    this.engine.beginFrame();
    this.scene.render();
    this.post();
    this.engine.endFrame();
  }

  private ready(...e: EffectWrapper[]): boolean { return e.every((x) => x.isReady()); }

  // per-pass inputs read by persistent onApply observers (Babylon's own observer sets the UV scale, so
  // observers must never be cleared)
  private pass: { src: BaseTexture | ThinTexture | null; sw: number; sh: number; first: boolean; low: Target | null; cur: Target | null; bloomOn: boolean;
    blurSrc: Target | null; blurDir: [number, number]; aoOn: boolean; dofOn: boolean; shaftsOn: boolean; sun: [number, number, number] } =
    { src: null, sw: 1, sh: 1, first: true, low: null, cur: null, bloomOn: false, blurSrc: null, blurDir: [1, 0], aoOn: false, dofOn: false, shaftsOn: false, sun: [0.5, 0.5, 0] };
  private observersReady = false;

  private setupObservers(): void {
    if (this.observersReady) return;
    this.observersReady = true;
    const P = this.pass;
    this.bloomDown.onApplyObservable.add(() => {
      const e = this.bloomDown.effect;
      e.setTexture('src', P.src as any);
      e.setFloat4('texel', 1 / P.sw, 1 / P.sh, P.first ? 1 : 0, this.fx.bloomThreshold);
      e.setFloat4('knee', 0.5, 40, 0, 0);
    });
    this.bloomUp.onApplyObservable.add(() => {
      const e = this.bloomUp.effect;
      e.setTexture('low', P.low!.tex as any);
      e.setTexture('cur', P.cur!.tex as any);
      e.setFloat4('texel', 1 / P.low!.w, 1 / P.low!.h, 1.0, 1.0);
    });
    this.aoFx.onApplyObservable.add(() => {
      const e = this.aoFx.effect;
      const cam = this.scene.activeCamera!;
      const th = Math.tan(cam.fov / 2);
      const asp = this.engine.getRenderWidth() / Math.max(1, this.engine.getRenderHeight());
      e.setTexture('gbufTex', this.mrt.textures[1]);
      e.bindUniformBuffer(this.globals.ubo.getBuffer()!, 'globals');
      e.setFloat4('proj', th * asp, th, this.fx.aoRadius, 1.0);
      e.setFloat4('texel', 1 / this.engine.getRenderWidth(), 1 / this.engine.getRenderHeight(), this.frameNo % 64, 90);
    });
    this.blurFx.onApplyObservable.add(() => {
      const e = this.blurFx.effect;
      const t = P.blurSrc!;
      e.setTexture('src', t.tex as any);
      e.setFloat4('dir', P.blurDir[0] / t.w, P.blurDir[1] / t.h, 60, 0);
    });
    this.dofFx.onApplyObservable.add(() => {
      const e = this.dofFx.effect;
      const d = this.fx.dof;
      e.setTexture('colorTex', this.mrtTex0);
      e.setTexture('gbufTex', this.mrt.textures[1]);
      e.bindUniformBuffer(this.globals.ubo.getBuffer()!, 'globals');
      e.setFloat4('dof', d[0], Math.max(0.2, d[1]), 9 * d[2] * (this.engine.getRenderHeight() / 720), 0.6);
      e.setFloat4('texel', 1 / this.dofT!.w, 1 / this.dofT!.h, 0, 0);
    });
    this.shaftFx.onApplyObservable.add(() => {
      const e = this.shaftFx.effect;
      e.setTexture('colorTex', this.mrtTex0);
      e.setTexture('gbufTex', this.mrt.textures[1]);
      e.bindUniformBuffer(this.globals.ubo.getBuffer()!, 'globals');
      const sc = this.globals.get('sunColor');
      e.setFloat4('sun', P.sun[0], P.sun[1], P.sun[2], this.fx.shafts * this.globals.get('sunDir')[3]);
      e.setFloat4('shaftC', sc[0] * 1.2, sc[1] * 1.05, sc[2] * 0.85, 0.975);
    });
    this.finalFx.onApplyObservable.add(() => {
      const e = this.finalFx.effect;
      const fx = this.fx;
      e.setTexture('aoTex', this.aoA!.tex as any);
      e.setTexture('dofTex', this.dofT!.tex as any);
      e.setTexture('shaftTex', this.shaftT!.tex as any);
      e.setFloat4('postC', P.aoOn ? fx.ao : 0, P.dofOn ? 1 : 0, P.shaftsOn ? 1 : 0, fx.rain);
      const st = this.globals.get('shadowTint');
      e.setFloat4('aoTint', st[0] * 0.55, st[1] * 0.55, st[2] * 0.7, 0);
      e.setTexture('colorTex', this.mrtTex0);
      e.setTexture('gbufTex', this.mrt.textures[1]);
      e.setTexture('bloomTex', (P.bloomOn ? this.bloomUpChain[0].tex : this.bloomChain[0].tex) as any);
      e.bindUniformBuffer(this.globals.ubo.getBuffer()!, 'globals');
      e.setFloat4('fxA', fx.vignette, fx.aberration, fx.grain, fx.letterbox);
      e.setFloat4('fxB', fx.fade, fx.impact, fx.speedLines, fx.radialBlur);
      e.setFloat4('fxC', fx.radialCenter[0], fx.radialCenter[1], P.bloomOn ? fx.bloom : 0, fx.memory);
      e.setFloat4('liftC', fx.lift[0], fx.lift[1], fx.lift[2], 0);
      e.setFloat4('gammaC', fx.gamma[0], fx.gamma[1], fx.gamma[2], 0);
      e.setFloat4('gainC', fx.gain[0], fx.gain[1], fx.gain[2], fx.sepia);
      e.setFloat4('inkC', fx.ink, fx.inkWidth, 0, 0);
    });
  }

  private post(): void {
    const fx = this.fx;
    const P = this.pass;
    this.setupObservers();
    P.bloomOn = fx.bloom > 0 && this.ready(this.bloomDown, this.bloomUp);
    if (P.bloomOn) {
      P.src = this.mrtTex0;
      P.sw = this.engine.getRenderWidth();
      P.sh = this.engine.getRenderHeight();
      this.bloomChain.forEach((t, i) => {
        P.first = i === 0;
        this.fxr.render(this.bloomDown, t.rt);
        P.src = t.tex; P.sw = t.w; P.sh = t.h;
      });
      let low: Target = this.bloomChain[this.bloomChain.length - 1];
      for (let i = this.bloomUpChain.length - 1; i >= 0; i--) {
        P.low = low;
        P.cur = this.bloomChain[i];
        this.fxr.render(this.bloomUp, this.bloomUpChain[i].rt);
        low = this.bloomUpChain[i];
      }
    }
    // ambient occlusion: half res, then a separable depth-aware blur
    P.aoOn = fx.ao > 0 && this.quality !== 'low' && this.ready(this.aoFx, this.blurFx);
    if (P.aoOn) {
      this.fxr.render(this.aoFx, this.aoA!.rt);
      P.blurSrc = this.aoA; P.blurDir = [1, 0];
      this.fxr.render(this.blurFx, this.aoB!.rt);
      P.blurSrc = this.aoB; P.blurDir = [0, 1];
      this.fxr.render(this.blurFx, this.aoA!.rt);
    }
    // depth of field (cutscenes)
    P.dofOn = fx.dof[2] > 0.01 && this.ready(this.dofFx);
    if (P.dofOn) this.fxr.render(this.dofFx, this.dofT!.rt);
    // sun shafts when the sun is on screen
    P.shaftsOn = false;
    const cam = this.scene.activeCamera;
    if (fx.shafts > 0 && cam && this.ready(this.shaftFx)) {
      const sd = this.globals.get('sunDir');
      const dir = new Vector3(sd[0], sd[1], sd[2]);
      const fwd = cam.getDirection(Vector3.Forward());
      const facing = Vector3.Dot(fwd, dir);
      if (facing > 0.05) {
        const w = this.engine.getRenderWidth(), h = this.engine.getRenderHeight();
        const p = Vector3.Project(cam.globalPosition.add(dir.scale(1000)), Matrix.Identity(), this.scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
        const u = p.x / w, v = 1 - p.y / h;   // post uv origin is bottom-left
        const onScreen = 1 - Math.min(1, Math.max(0, Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) - 0.5) / 0.5);
        P.sun = [u, v, onScreen * Math.min(1, facing * 3)];
        if (P.sun[2] > 0.01) { P.shaftsOn = true; this.fxr.render(this.shaftFx, this.shaftT!.rt); }
      }
    }
    if (!this.finalFx.isReady()) return;
    this.engine.restoreDefaultFramebuffer();
    this.fxr.render(this.finalFx);
  }
}
