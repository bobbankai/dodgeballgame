// The frame: scene (PBR + CSM + IBL) -> N8AO ambient occlusion -> volumetric fog / sun shafts ->
// camera motion blur -> depth of field (cinematics) -> HDR mip-chain bloom -> grade (AgX + look) ->
// SMAA. Adaptive resolution keeps the frame rate; three presets trade cost (see Quality.ts).
import * as THREE from 'three';
import { PlanarMirror } from './Mirror';
import {
  BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, EdgeDetectionMode,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { QUALITY, Quality, QualityName } from './Quality';
import { Sky } from './Sky';
import { FogPass } from './FogPass';
import { Lighting } from './Lighting';
import { GradeEffect, MotionBlurEffect } from './Effects';
import { applyFX, FXOptions, G } from './MaterialFX';
import { GpuTimer } from './GpuTimer';
import { AdaptPass } from './AdaptPass';

export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  quality: Quality;
  readonly sky: Sky;
  lighting: Lighting;
  readonly fog: FogPass;
  readonly grade = new GradeEffect();
  bloom: BloomEffect;
  readonly motionBlur: MotionBlurEffect;
  readonly eye = new AdaptPass();
  dof!: DepthOfFieldEffect;
  private composer!: EffectComposer;
  ao: N8AOPostPass | null = null;
  private dofPass!: EffectPass;
  private mbPass: EffectPass | null = null;
  private patched = new Set<THREE.Material>();
  private envTex: THREE.Texture | null = null;
  readonly gpu: GpuTimer;
  /** adaptive resolution */
  scale = 1;
  private slowTime = 0;
  private fastTime = 0;
  private frameAvg = 1 / 60;
  adaptive = true;
  /** cinematic depth of field (0 = off) */
  dofAmount = 0;
  /** planar reflections rendered before each frame (levels with large still water) */
  mirrors: PlanarMirror[] = [];
  private framesRendered = 0;
  time = 0;

  constructor(canvas: HTMLCanvasElement, q: QualityName) {
    this.quality = QUALITY[q];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.gpu = new GpuTimer(r);
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 2500);
    this.sky = new Sky(r, 128);
    this.scene.add(this.sky.mesh);
    this.sky.mesh.renderOrder = 10000; // last among opaques: the depth test rejects most of it
    this.lighting = new Lighting(this.scene, this.camera, this.quality);
    this.fog = new FogPass(this.camera, this.quality.volumetric ? this.quality.volSteps : 0, this.quality.volumetric ? this.quality.cascades : 0);
    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.05, luminanceSmoothing: 0.35, intensity: 0.55, radius: 0.72, levels: 8 });
    this.motionBlur = new MotionBlurEffect(this.camera);
    this.buildComposer();
    this.resize();
  }

  private buildComposer(): void {
    const q = this.quality;
    this.composer?.dispose();
    const r = this.renderer;
    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: q.msaa });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (q.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      ao.configuration.aoSamples = q.aoSamples;
      ao.configuration.denoiseSamples = q.name === 'ultra' ? 8 : 4;
      ao.configuration.denoiseRadius = 10;
      ao.configuration.halfRes = q.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new THREE.Color(0.02, 0.025, 0.035);
      this.ao = ao;
      this.composer.addPass(ao);
    }
    this.fog.configure(q.volumetric ? q.volSteps : 0, q.volumetric ? q.cascades : 0);
    this.composer.addPass(this.fog);
    this.mbPass = null;
    if (q.motionBlur) {
      this.mbPass = new EffectPass(this.camera, this.motionBlur);
      this.composer.addPass(this.mbPass);
    }
    this.dof?.dispose();
    this.dof = new DepthOfFieldEffect(this.camera, { worldFocusDistance: 4, worldFocusRange: 3, bokehScale: 3.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);
    this.composer.addPass(this.eye);
    this.composer.addPass(new EffectPass(this.camera, this.bloom, this.grade));
    if (q.smaa) {
      const smaa = new SMAAEffect({ preset: q.name === 'ultra' ? SMAAPreset.ULTRA : SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
      this.composer.addPass(new EffectPass(this.camera, smaa));
    }
  }

  setQuality(name: QualityName): void {
    if (name === this.quality.name) return;
    this.quality = QUALITY[name];
    try { localStorage.setItem('emberfall.quality', name); } catch { /* ignore */ }
    const mats = [...this.patched];
    this.patched.clear();
    this.lighting.rebuild(this.quality, [], () => undefined);
    for (const m of mats) this.patch(m, (m.userData.fxOptions as FXOptions) ?? {});
    this.buildComposer();
    this.scale = 1;
    this.resize();
  }

  /** Patch a material for CSM + shader features (idempotent) */
  patch(m: THREE.Material, fx: FXOptions = {}): void {
    if (this.patched.has(m)) return;
    const std = m as THREE.MeshStandardMaterial;
    if (!std.isMeshStandardMaterial) return;
    const hook = this.lighting.setupMaterial(m);
    applyFX(m, fx, hook);
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const) {
      const t = std[k];
      if (t) t.anisotropy = this.quality.anisotropy;
    }
    this.patched.add(m);
  }

  /** Patch every material under an object; `fxFor` chooses features per material */
  prepare(root: THREE.Object3D, fxFor?: (m: THREE.Material, mesh: THREE.Mesh) => FXOptions | undefined): void {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = mesh.userData.noShadow ? false : true;
      mesh.receiveShadow = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) this.patch(m, fxFor?.(m, mesh) ?? {});
    });
  }

  forget(m: THREE.Material): void { this.patched.delete(m); }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h, false);
    for (const m of this.mirrors) m.resize(w * dpr, h * dpr);
    this.lighting.csm.updateFrustums();
    this.fog.resetHistory();
  }

  render(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    G.uTime.value = this.time;
    this.renderer.info.reset();
    const env = this.sky.update(this.time);
    if (env) {
      this.envTex = env;
      this.scene.environment = env;
    }
    this.lighting.setSun(this.sky.settings.lightDir, this.sky.lightColor, this.lightIntensity);
    this.lighting.update(dt, focus);
    const f = this.fog;
    f.time = this.time;
    f.sunDir.copy(this.lighting.sunDir);
    f.sunColor.copy(this.lighting.sunColor).multiplyScalar(this.lightingIntensity());
    f.ambientTop.copy(this.sky.ambientTop);
    f.ambientLow.copy(this.sky.ambientHorizon);
    f.atmos = this.sky.atmosCube.texture;
    f.shadows = this.quality.volumetric ? this.lighting.cascades() : [];
    this.dofPass.enabled = this.quality.dof && this.dofAmount > 0.01;
    if (this.dofPass.enabled) this.dof.bokehScale = 2.2 * this.dofAmount;
    this.eye.setDelta(dt);
    this.grade.adapt = this.eye.texture;
    this.gpu.begin();
    // mirrors reuse this frame's shadow maps, so they start once a main frame has created them
    if (this.quality.planarReflection > 0 && this.framesRendered > 0) {
      const sz = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      for (const m of this.mirrors) {
        if (m.target.width < 8) m.resize(sz.x, sz.y);
        m.update(this.renderer, this.scene, this.camera);
      }
    }
    this.composer.render(dt);
    this.framesRendered++;
    this.gpu.end();
    if (this.adaptive) this.adapt(dt);
  }

  private lightIntensity = 3;
  lightingIntensity(): number { return this.lightIntensity; }
  setSun(dirToLight: THREE.Vector3, intensity: number): void {
    this.lightIntensity = intensity;
    this.lighting.setSun(dirToLight, this.sky.lightColor, intensity);
  }

  private adapt(dt: number): void {
    if (dt <= 0 || dt > 0.25) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    const target = 1 / 58;
    if (this.frameAvg > target * 1.12) { this.slowTime += dt; this.fastTime = 0; } else if (this.frameAvg < target * 0.8) { this.fastTime += dt; this.slowTime = 0; } else { this.slowTime = 0; this.fastTime = 0; }
    if (this.slowTime > 1.0 && this.scale > this.quality.minScale) {
      this.scale = Math.max(this.quality.minScale, this.scale - 0.08);
      this.slowTime = 0;
      this.resize();
    } else if (this.fastTime > 3.0 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.fastTime = 0;
      this.resize();
    }
  }

  get environment(): THREE.Texture | null { return this.envTex; }
}
