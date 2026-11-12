import {
  Constants, FxaaPostProcess, MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline,
  TAARenderingPipeline, Texture, type Camera, type DepthRenderer, type PostProcess, type Scene,
} from '@babylonjs/core';
import type { GraphicsSettings } from '../core/Settings';
import { Atmosphere, SunDepth, type FogParams } from './Atmosphere';
import { log } from '../core/Log';
import { probeCaps, type RenderCaps } from './Caps';
import { Bloom, type BloomParams } from './post/Bloom';
import { AutoExposure, type ExposureParams } from './post/AutoExposure';
import { Tonemap, type TonemapParams } from './post/Tonemap';
import { DepthOfField } from './post/DepthOfField';
import { Sharpen } from './post/Sharpen';
import { NEUTRAL_GRADE, type GradeSettings } from './post/Grading';
import { Shade, refreshShading } from './materials/Shading';

/** Everything a region (chapter area) sets about the look of the frame. */
export interface LookParams {
  fog: Partial<FogParams>;
  bloom: Partial<BloomParams>;
  exposure: Partial<ExposureParams>;
  tonemap: Partial<TonemapParams>;
  grade: GradeSettings;
}

/**
 * Owns the post-processing chain. Order (each stage optional by quality):
 *   TAA -> SSAO2 -> SSR -> volumetric atmosphere -> bokeh DoF -> motion blur -> PB bloom ->
 *   tone map / grade (auto exposure, CA, vignette, LUT, grain) -> FXAA -> CAS sharpening.
 * Materials output linear HDR (image processing is applied by our tone-mapping pass), and every
 * custom pass is written in both WGSL and GLSL. Changing a setting rebuilds the chain in order.
 */
export class Pipeline {
  private scene: Scene;
  private camera: Camera;
  readonly depth: DepthRenderer;
  readonly caps: RenderCaps;
  readonly exposure: AutoExposure;
  atmosphere?: Atmosphere;
  sunDepth?: SunDepth;
  ssao?: SSAO2RenderingPipeline;
  ssr?: SSRRenderingPipeline;
  taa?: TAARenderingPipeline;
  dof?: DepthOfField;
  motionBlur?: MotionBlurPostProcess;
  bloom?: Bloom;
  tonemap?: Tonemap;
  fxaa?: FxaaPostProcess;
  sharpen?: Sharpen;
  private settings!: GraphicsSettings;
  private look: LookParams = { fog: {}, bloom: {}, exposure: {}, tonemap: {}, grade: NEUTRAL_GRADE };
  private focus = { distance: 0, fStop: 2.8, focal: 50, strength: 0 };

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    this.caps = probeCaps(scene.getEngine());
    log.info(`render caps: ${this.caps.varyings} varyings${this.caps.separateGeometryPass ? ', separate geometry pass' : ''}`);
    this.depth = scene.enableDepthRenderer(camera, false, false, Texture.NEAREST_SAMPLINGMODE, true);
    this.excludeFromDepth(this.depth);
    const ip = scene.imageProcessingConfiguration;
    // Our tone-mapping pass does exposure, the filmic curve and grading for everything.
    ip.applyByPostProcess = true;
    ip.toneMappingEnabled = false;
    ip.vignetteEnabled = false;
    ip.colorCurvesEnabled = false;
    ip.exposure = 1;
    ip.contrast = 1;
    this.exposure = new AutoExposure(scene);
    scene.onAfterRenderObservable.add(() => this.exposure.update(scene.getEngine().getDeltaTime() / 1000 || 1 / 60));
  }

  /**
   * Depth maps render every opaque and alpha-tested mesh. The sky dome and effects stay out of them
   * by drawing in the transparent queue (depth renderers skip alpha-blended materials).
   */
  private excludeFromDepth(d: DepthRenderer): void {
    d.forceDepthWriteTransparentMeshes = false;
  }

  build(settings: GraphicsSettings): void {
    this.settings = settings;
    this.disposeChain();
    const { scene, camera } = this;
    const engine = scene.getEngine();
    const hdrType = engine.getCaps().textureHalfFloatRender ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE;
    const ultra = settings.preset === 'ultra';

    if (settings.antiAliasing === 'taa') {
      try {
        this.taa = new TAARenderingPipeline('taa', scene, [camera], hdrType);
        this.taa.samples = 8;
        this.taa.factor = 0.1;
        this.taa.disableOnCameraMove = false;
      } catch (e) {
        log.warn('TAA unavailable', e);
      }
    }
    if (settings.ambientOcclusion) {
      const ratio = ultra ? { ssaoRatio: 1, blurRatio: 1 } : { ssaoRatio: 0.5, blurRatio: 0.5 };
      this.ssao = new SSAO2RenderingPipeline('ssao', scene, ratio, [camera], this.caps.separateGeometryPass, hdrType);
      this.ssao.radius = 1.2;
      this.ssao.totalStrength = 1.1;
      this.ssao.base = 0.1;
      this.ssao.samples = ultra ? 24 : 16;
      this.ssao.maxZ = 120;
      this.ssao.minZAspect = 0.4;
      this.ssao.expensiveBlur = settings.preset !== 'medium';
      this.ssao.bilateralSamples = 12;
      this.ssao.bilateralSoften = 0.05;
      this.ssao.bilateralTolerance = 0.002;
    }
    if (settings.reflections) {
      this.ssr = new SSRRenderingPipeline('ssr', scene, [camera], this.caps.separateGeometryPass, hdrType);
      this.ssr.thickness = 0.25;
      this.ssr.maxDistance = 80;
      this.ssr.maxSteps = ultra ? 160 : 96;
      this.ssr.step = 0.6;
      this.ssr.strength = 0.9;
      this.ssr.reflectionSpecularFalloffExponent = 2.2;
      this.ssr.roughnessFactor = 0.15;
      this.ssr.reflectivityThreshold = 0.06;
      this.ssr.blurDispersionStrength = 0.025;
      this.ssr.ssrDownsample = ultra ? 0 : 1;
      this.ssr.blurDownsample = 1;
      this.ssr.enableSmoothReflections = true;
      this.ssr.attenuateScreenBorders = true;
      this.ssr.attenuateIntersectionDistance = true;
      this.ssr.attenuateFacingCamera = true;
      this.ssr.useFresnel = !this.caps.separateGeometryPass;
      this.ssr.enableAutomaticThicknessComputation = false;
    }
    if (settings.volumetrics) {
      this.sunDepth = new SunDepth(scene, ultra ? 2048 : 1024);
      this.excludeFromDepth(this.sunDepth.depth);
    }
    this.atmosphere = new Atmosphere(scene, camera, this.depth, this.look.fog, this.sunDepth);
    this.atmosphere.steps = settings.volumetrics ? (ultra ? 24 : 14) : 0;
    if (settings.depthOfField) {
      this.dof = new DepthOfField(scene, camera, this.depth);
    }
    if (settings.motionBlur) {
      this.motionBlur = new MotionBlurPostProcess('motionBlur', scene, 1, camera, Texture.BILINEAR_SAMPLINGMODE,
        engine, false, hdrType, false, this.caps.separateGeometryPass);
      this.motionBlur.motionStrength = 0.5;
      this.motionBlur.motionBlurSamples = 24;
      this.motionBlur.isObjectBased = false;
    }
    if (settings.bloom) this.bloom = new Bloom(scene, camera, settings.preset === 'low' ? 5 : 6);
    this.tonemap = new Tonemap(scene, camera, this.exposure, this.look.grade);
    if (settings.antiAliasing === 'fxaa') this.fxaa = new FxaaPostProcess('fxaa', 1, camera);
    if (settings.antiAliasing === 'taa' || settings.resolution < 0.95 || settings.preset === 'ultra' || settings.preset === 'high') {
      this.sharpen = new Sharpen(scene, camera);
      this.sharpen.sharpness = settings.antiAliasing === 'taa' ? 0.55 : 0.3;
    }
    // MSAA on the scene render target (first pass of the chain)
    const first = camera._postProcesses.find((p): p is PostProcess => !!p);
    if (first) first.samples = settings.antiAliasing === 'msaa' ? 4 : 1;
    // screen-space contact shadows on the sun, marched through the depth pre-pass in every material
    const contact = settings.shadows > 0 && settings.preset !== 'low';
    Shade.depth = contact ? this.depth.getDepthMap() : null;
    Shade.contact = contact ? 0.85 : 0;
    Shade.contactSteps = ultra ? 12 : settings.preset === 'high' ? 8 : 6;
    Shade.contactDistance = ultra ? 60 : 45;
    refreshShading(scene);
    this.applyLook();
    this.exposure.reset();
  }

  /** Region look: fog, bloom, exposure, tone curve and grade. */
  setLook(look: Partial<LookParams>): void {
    if (look.fog) Object.assign(this.look.fog, look.fog);
    if (look.bloom) Object.assign(this.look.bloom, look.bloom);
    if (look.exposure) Object.assign(this.look.exposure, look.exposure);
    if (look.tonemap) Object.assign(this.look.tonemap, look.tonemap);
    if (look.grade) this.look.grade = look.grade;
    this.applyLook();
  }

  setFog(params: Partial<FogParams>): void {
    this.setLook({ fog: params });
  }

  private applyLook(): void {
    const l = this.look;
    this.atmosphere?.set(l.fog);
    if (this.bloom) Object.assign(this.bloom.params, l.bloom);
    Object.assign(this.exposure.params, l.exposure);
    if (this.tonemap) {
      Object.assign(this.tonemap.params, l.tonemap);
      if (!this.settings.filmGrain) this.tonemap.params.grain = 0;
      if (!this.settings.chromaticAberration) this.tonemap.params.chroma = 0;
      this.tonemap.setGrade(l.grade);
    }
  }

  /** Cinematic depth of field; distance 0 eases it off. */
  setFocus(distance: number, fStop = 2.8, focalLength = 50): void {
    this.focus.distance = distance;
    this.focus.fStop = fStop;
    this.focus.focal = focalLength;
  }

  update(dt: number, sunFollow?: { center: import('@babylonjs/core').Vector3; toSun: import('@babylonjs/core').Vector3 }): void {
    Shade.frame++;
    this.atmosphere?.update(dt);
    this.tonemap?.update(dt);
    if (this.dof) {
      const want = this.focus.distance > 0 ? 1 : 0;
      this.focus.strength += (want - this.focus.strength) * Math.min(1, dt * 4);
      this.dof.strength = this.focus.strength;
      if (this.focus.distance > 0) {
        this.dof.focusDistance = this.focus.distance;
        this.dof.fStop = this.focus.fStop;
        this.dof.focalLength = this.focus.focal;
      }
    }
    if (this.sunDepth && sunFollow) this.sunDepth.follow(sunFollow.center, sunFollow.toSun);
  }

  private disposeChain(): void {
    const cam = this.camera;
    this.sharpen?.dispose(cam);
    this.fxaa?.dispose(cam);
    this.tonemap?.dispose(cam);
    this.bloom?.dispose(cam);
    this.motionBlur?.dispose(cam);
    this.dof?.dispose(cam);
    this.atmosphere?.dispose(cam);
    this.sunDepth?.dispose();
    this.ssr?.dispose();
    this.ssao?.dispose();
    this.taa?.dispose();
    this.sharpen = this.fxaa = this.tonemap = this.bloom = this.motionBlur = this.dof = this.atmosphere = undefined;
    this.sunDepth = this.ssr = this.ssao = this.taa = undefined;
  }

  dispose(): void {
    this.disposeChain();
    this.exposure.dispose();
  }
}
