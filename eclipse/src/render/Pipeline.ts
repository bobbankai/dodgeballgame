import {
  ColorCurves, Constants, DefaultRenderingPipeline, DepthOfFieldEffectBlurLevel, ImageProcessingConfiguration,
  MotionBlurPostProcess, SSAO2RenderingPipeline, SSRRenderingPipeline, TAARenderingPipeline, Texture,
  VolumetricLightScatteringPostProcess, type Camera, type DepthRenderer, type Mesh, type Scene, Color4,
} from '@babylonjs/core';
import type { GraphicsSettings } from '../core/Settings';
import { Atmosphere, type FogParams } from './Atmosphere';
import { log } from '../core/Log';
import { probeCaps, type RenderCaps } from './Caps';

/** Per-region grading on top of the shared filmic tone map. */
export interface GradeParams {
  exposure: number;
  contrast: number;
  saturation: number;
  /** Hue (degrees) / density (-100..100) for shadows and highlights split toning. */
  shadowsHue: number;
  shadowsDensity: number;
  highlightsHue: number;
  highlightsDensity: number;
  vignette: number;
  vignetteColor: Color4;
  bloomWeight: number;
  bloomThreshold: number;
  grain: number;
  chromatic: number;
}

export const DEFAULT_GRADE: GradeParams = {
  exposure: 1,
  contrast: 1.15,
  saturation: 0,
  shadowsHue: 220,
  shadowsDensity: 12,
  highlightsHue: 40,
  highlightsDensity: 8,
  vignette: 2.2,
  vignetteColor: new Color4(0.02, 0.01, 0.02, 0),
  bloomWeight: 0.32,
  bloomThreshold: 0.85,
  grain: 7,
  chromatic: 16,
};

/**
 * Owns the post-processing chain and its order:
 *   TAA (ultra) -> SSAO2 -> SSR -> atmosphere -> god rays -> motion blur -> default pipeline
 *   (bloom, filmic tone map + grading, depth of field, FXAA, chromatic aberration, grain, sharpen).
 * Changing a setting rebuilds the whole chain so the order is always preserved.
 */
export class Pipeline {
  private scene: Scene;
  private camera: Camera;
  readonly depth: DepthRenderer;
  atmosphere?: Atmosphere;
  default?: DefaultRenderingPipeline;
  ssao?: SSAO2RenderingPipeline;
  ssr?: SSRRenderingPipeline;
  taa?: TAARenderingPipeline;
  godRays?: VolumetricLightScatteringPostProcess;
  motionBlur?: MotionBlurPostProcess;
  grade: GradeParams = { ...DEFAULT_GRADE };
  private fogParams: Partial<FogParams> = {};
  private sunMesh?: Mesh;
  private settings!: GraphicsSettings;
  /** Cinematic focus: distance in metres and aperture (f-stop); 0 disables. */
  private focus = { distance: 0, fStop: 2.8 };
  readonly caps: RenderCaps;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
    this.caps = probeCaps(scene.getEngine());
    log.info(`render caps: ${this.caps.varyings} varyings${this.caps.separateGeometryPass ? ', separate geometry pass' : ''}`);
    this.depth = scene.enableDepthRenderer(camera, false, false, Texture.NEAREST_SAMPLINGMODE, true);
    const ip = scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.vignetteEnabled = true;
    ip.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    ip.colorCurvesEnabled = true;
    ip.colorCurves = new ColorCurves();
    ip.ditheringEnabled = true;
    ip.ditheringIntensity = 1 / 255;
  }

  setSun(mesh: Mesh): void {
    this.sunMesh = mesh;
  }

  build(settings: GraphicsSettings): void {
    this.settings = settings;
    this.disposeChain();
    const { scene, camera } = this;
    const engine = scene.getEngine();
    const hdrType = engine.getCaps().textureHalfFloatRender ? Constants.TEXTURETYPE_HALF_FLOAT : Constants.TEXTURETYPE_UNSIGNED_BYTE;

    if (settings.antiAliasing === 'taa') {
      try {
        this.taa = new TAARenderingPipeline('taa', scene, [camera], hdrType);
        this.taa.samples = 8;
        this.taa.factor = 0.08;
        this.taa.disableOnCameraMove = false;
      } catch (e) {
        log.warn('TAA unavailable', e);
      }
    }
    if (settings.ambientOcclusion) {
      const ratio = settings.preset === 'ultra' ? { ssaoRatio: 1, blurRatio: 1 } : { ssaoRatio: 0.5, blurRatio: 0.5 };
      this.ssao = new SSAO2RenderingPipeline('ssao', scene, ratio, [camera], this.caps.separateGeometryPass, hdrType);
      this.ssao.radius = 1.4;
      this.ssao.totalStrength = 1.15;
      this.ssao.base = 0.12;
      this.ssao.samples = settings.preset === 'ultra' ? 24 : 16;
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
      this.ssr.maxSteps = settings.preset === 'ultra' ? 160 : 96;
      this.ssr.step = 0.6;
      this.ssr.strength = 0.9;
      this.ssr.reflectionSpecularFalloffExponent = 2.2;
      this.ssr.roughnessFactor = 0.15;
      this.ssr.reflectivityThreshold = 0.06;
      this.ssr.blurDispersionStrength = 0.025;
      this.ssr.ssrDownsample = settings.preset === 'ultra' ? 0 : 1;
      this.ssr.blurDownsample = 1;
      this.ssr.enableSmoothReflections = true;
      this.ssr.attenuateScreenBorders = true;
      this.ssr.attenuateIntersectionDistance = true;
      this.ssr.attenuateFacingCamera = true;
      this.ssr.useFresnel = !this.caps.separateGeometryPass;
      this.ssr.enableAutomaticThicknessComputation = false;
      this.ssr.environmentTexture = (scene.environmentTexture as never) ?? null;
    }
    this.atmosphere = new Atmosphere(scene, camera, this.depth, this.fogParams);
    this.atmosphere.steps = settings.volumetrics ? (settings.preset === 'ultra' ? 16 : 10) : 0;
    if (settings.volumetrics && this.sunMesh) {
      this.godRays = new VolumetricLightScatteringPostProcess('godrays', 1, camera, this.sunMesh,
        settings.preset === 'ultra' ? 90 : 60, Texture.BILINEAR_SAMPLINGMODE, engine, false, scene, hdrType);
      this.godRays.exposure = 0.14;
      this.godRays.decay = 0.965;
      this.godRays.weight = 0.55;
      this.godRays.density = 0.92;
      this.godRays.excludedMeshes = [];
    }
    if (settings.motionBlur) {
      this.motionBlur = new MotionBlurPostProcess('motionBlur', scene, 1, camera, Texture.BILINEAR_SAMPLINGMODE,
        engine, false, hdrType, false, this.caps.separateGeometryPass);
      this.motionBlur.motionStrength = 0.6;
      this.motionBlur.motionBlurSamples = 24;
      this.motionBlur.isObjectBased = false;
    }

    const dp = new DefaultRenderingPipeline('default', true, scene, [camera], false);
    dp.samples = settings.antiAliasing === 'msaa' ? 4 : 1;
    dp.fxaaEnabled = settings.antiAliasing === 'fxaa';
    dp.imageProcessingEnabled = true;
    dp.bloomEnabled = settings.bloom;
    dp.bloomKernel = 64;
    dp.bloomScale = 0.5;
    dp.depthOfFieldEnabled = settings.depthOfField && this.focus.distance > 0;
    dp.depthOfFieldBlurLevel = settings.preset === 'ultra' ? DepthOfFieldEffectBlurLevel.High : DepthOfFieldEffectBlurLevel.Medium;
    dp.chromaticAberrationEnabled = settings.chromaticAberration;
    dp.grainEnabled = settings.filmGrain;
    dp.sharpenEnabled = settings.antiAliasing === 'taa' || settings.resolution < 0.95;
    if (dp.sharpenEnabled) {
      dp.sharpen.edgeAmount = 0.25;
      dp.sharpen.colorAmount = 1;
    }
    dp.automaticBuild = true;
    this.default = dp;
    this.applyGrade();
    this.applyFocus();
  }

  setFog(params: Partial<FogParams>): void {
    Object.assign(this.fogParams, params);
    this.atmosphere?.set(params);
  }

  setGrade(g: Partial<GradeParams>): void {
    Object.assign(this.grade, g);
    this.applyGrade();
  }

  private applyGrade(): void {
    const g = this.grade;
    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = g.exposure;
    ip.contrast = g.contrast;
    ip.vignetteWeight = g.vignette;
    ip.vignetteColor = g.vignetteColor;
    ip.vignetteStretch = 0.4;
    ip.vignetteCameraFov = 0.6;
    const c = ip.colorCurves!;
    c.globalSaturation = g.saturation;
    c.shadowsHue = g.shadowsHue;
    c.shadowsDensity = g.shadowsDensity;
    c.highlightsHue = g.highlightsHue;
    c.highlightsDensity = g.highlightsDensity;
    const dp = this.default;
    if (dp) {
      dp.bloomWeight = g.bloomWeight;
      dp.bloomThreshold = g.bloomThreshold;
      if (dp.grainEnabled) {
        dp.grain.intensity = g.grain;
        dp.grain.animated = true;
      }
      if (dp.chromaticAberrationEnabled) {
        dp.chromaticAberration.aberrationAmount = g.chromatic;
        dp.chromaticAberration.radialIntensity = 0.8;
      }
    }
  }

  /** Cinematic depth of field; distance 0 switches it off. */
  setFocus(distance: number, fStop = 2.8, focalLength = 50): void {
    this.focus = { distance, fStop };
    const dp = this.default;
    if (!dp) return;
    const want = this.settings.depthOfField && distance > 0;
    if (dp.depthOfFieldEnabled !== want) dp.depthOfFieldEnabled = want;
    if (want) {
      dp.depthOfField.focusDistance = distance * 1000; // millimetres
      dp.depthOfField.fStop = fStop;
      dp.depthOfField.focalLength = focalLength;
    }
  }

  private applyFocus(): void {
    this.setFocus(this.focus.distance, this.focus.fStop);
  }

  update(dt: number): void {
    this.atmosphere?.update(dt);
  }

  private disposeChain(): void {
    const cam = this.camera;
    this.default?.dispose();
    this.default = undefined;
    this.motionBlur?.dispose(cam);
    this.motionBlur = undefined;
    this.godRays?.dispose(cam);
    this.godRays = undefined;
    this.atmosphere?.dispose(cam);
    this.atmosphere = undefined;
    this.ssr?.dispose();
    this.ssr = undefined;
    this.ssao?.dispose();
    this.ssao = undefined;
    this.taa?.dispose();
    this.taa = undefined;
  }

  dispose(): void {
    this.disposeChain();
  }
}
