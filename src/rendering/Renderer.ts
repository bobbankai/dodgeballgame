import * as THREE from 'three';
import {
  BloomEffect,
  DepthOfFieldEffect,
  EdgeDetectionMode,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
} from 'postprocessing';
import { QUALITY_PRESETS, QualityLevel, QualityProfile } from '../config/quality';
import { DistortionEffect, GradeEffect, GradeSettings, ScreenFxEffect } from './PostEffects';
import { dampTo } from '../core/math';

/**
 * Owns the WebGL renderer and the post-processing chain.
 * Gameplay code only talks to the high level "feedback" API (flash, aberration, shock waves...).
 */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly canvas: HTMLCanvasElement;
  quality: QualityProfile;
  private renderPass: RenderPass;
  private mainPass!: EffectPass;
  private fxPass!: EffectPass;
  private aaPass!: EffectPass;
  private dofPass!: EffectPass;
  readonly bloom: BloomEffect;
  readonly grade: GradeEffect;
  readonly distortion: DistortionEffect;
  readonly screenFx: ScreenFxEffect;
  readonly dof: DepthOfFieldEffect;
  private smaa: SMAAEffect;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  /** Dynamic resolution scale (adaptive quality). */
  resolutionScale = 1;
  autoQuality = true;
  private fpsLowTimer = 0;
  private fpsHighTimer = 0;

  // Feedback targets (decay each frame)
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private aberration = 0;
  private radial = 0;
  private vigPulse = 0;
  speedLines = 0;
  letterbox = 0;
  private letterboxTarget = 0;
  desaturate = 0;
  bloomBoost = 0;
  private baseBloom = 0.85;
  dofEnabled = false;

  constructor(container: HTMLElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera, level: QualityLevel) {
    this.scene = scene;
    this.camera = camera;
    this.quality = QUALITY_PRESETS[level];
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: this.quality.msaa,
    });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 6, focusRange: 3, bokehScale: 2.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = false;
    this.composer.addPass(this.dofPass);

    this.distortion = new DistortionEffect();
    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.92,
      luminanceSmoothing: 0.22,
      intensity: this.baseBloom,
      radius: 0.72,
    });
    this.grade = new GradeEffect();
    this.mainPass = new EffectPass(camera, this.distortion, this.bloom, this.grade);
    this.composer.addPass(this.mainPass);

    this.screenFx = new ScreenFxEffect();
    this.fxPass = new EffectPass(camera, this.screenFx);
    this.composer.addPass(this.fxPass);

    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH, edgeDetectionMode: EdgeDetectionMode.COLOR });
    this.aaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.aaPass);

    this.applyQuality(level);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.renderPass.mainCamera = camera;
    for (const p of [this.mainPass, this.fxPass, this.aaPass, this.dofPass]) p.mainCamera = camera;
  }

  applyQuality(level: QualityLevel) {
    const q = (this.quality = QUALITY_PRESETS[level]);
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.bloom.intensity = q.bloom ? this.baseBloom : 0;
    (this.bloom as any).blendMode.opacity.value = q.bloom ? 1 : 0;
    this.fxPass.enabled = q.screenFx;
    this.aaPass.enabled = q.smaa;
    this.composer.multisampling = q.msaa;
    this.resolutionScale = 1;
    this.resize();
    // Force shadow-casting lights to rebuild maps at the new size.
    this.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if ((l as any).isLight && l.shadow) {
        l.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        l.shadow.radius = q.softShadows ? 4 : 1.5;
        l.shadow.map?.dispose();
        (l.shadow as any).map = null;
      }
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) * this.resolutionScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- gameplay feedback API ----------
  flashScreen(intensity: number, color: THREE.ColorRepresentation = 0xffffff) {
    this.flash = Math.max(this.flash, intensity);
    this.flashColor.set(color);
  }
  pulseAberration(v: number) {
    this.aberration = Math.max(this.aberration, v);
  }
  pulseRadial(v: number) {
    this.radial = Math.max(this.radial, v);
  }
  pulseVignette(v: number, color: THREE.ColorRepresentation) {
    this.vigPulse = Math.max(this.vigPulse, v);
    const c = new THREE.Color(color);
    (this.screenFx.uniforms.get('uVigColor')!.value as THREE.Vector3).set(c.r, c.g, c.b);
  }
  shockwave(world: THREE.Vector3, strength = 1, maxRadius = 0.45) {
    if (!this.quality.screenFx) return;
    this.distortion.spawn(world, strength, 1.3, maxRadius);
  }
  setLetterbox(on: boolean) {
    this.letterboxTarget = on ? 1 : 0;
  }
  setGrade(s: Partial<GradeSettings>, bloom?: number) {
    this.grade.apply(s);
    if (bloom !== undefined) this.baseBloom = bloom;
  }
  setDof(enabled: boolean, focusDistance?: number, range?: number, bokeh?: number) {
    this.dofEnabled = enabled && this.quality.dof;
    this.dofPass.enabled = this.dofEnabled;
    const coc = (this.dof as any).cocMaterial;
    if (focusDistance !== undefined && coc) coc.focusDistance = focusDistance;
    if (range !== undefined && coc) coc.focusRange = range;
    if (bokeh !== undefined) this.dof.bokehScale = bokeh;
  }

  render(realDt: number, fps: number) {
    // decay feedback
    const k = (s: number) => Math.exp(-s * realDt);
    this.flash *= k(9);
    this.aberration *= k(6);
    this.radial *= k(5);
    this.vigPulse *= k(3);
    this.letterbox = dampTo(this.letterbox, this.letterboxTarget, 6, realDt);
    const g = this.grade;
    g.u('uFlash').value = Math.min(0.85, this.flash);
    (g.u('uFlashColor').value as THREE.Vector3).set(this.flashColor.r, this.flashColor.g, this.flashColor.b);
    g.u('uDesat').value = this.desaturate;
    if (this.quality.bloom) this.bloom.intensity = this.baseBloom + this.bloomBoost;
    const fx = this.screenFx;
    fx.set('uAberration', 0.04 + this.aberration * 0.6);
    fx.set('uRadial', this.radial);
    fx.set('uSpeedLines', this.speedLines);
    fx.set('uVigPulse', this.vigPulse);
    fx.set('uLetterbox', this.letterbox);
    fx.set('uTime', performance.now() / 1000);
    this.distortion.tick(realDt, this.camera, this.camera.aspect);

    if (!this.quality.screenFx && this.letterbox > 0.01) {
      // Keep letterbox visible even on low quality.
      this.fxPass.enabled = true;
    } else if (!this.quality.screenFx) this.fxPass.enabled = false;

    this.composer.render(realDt);
    this.adaptResolution(realDt, fps);
  }

  private adaptResolution(dt: number, fps: number) {
    if (!this.autoQuality) return;
    if (fps < 42) {
      this.fpsLowTimer += dt;
      this.fpsHighTimer = 0;
    } else if (fps > 57) {
      this.fpsHighTimer += dt;
      this.fpsLowTimer = 0;
    } else {
      this.fpsLowTimer = this.fpsHighTimer = 0;
    }
    if (this.fpsLowTimer > 2.5 && this.resolutionScale > 0.6) {
      this.resolutionScale = Math.max(0.6, this.resolutionScale - 0.1);
      this.fpsLowTimer = 0;
      this.resize();
    } else if (this.fpsHighTimer > 5 && this.resolutionScale < 1) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      this.fpsHighTimer = 0;
      this.resize();
    }
  }
}
