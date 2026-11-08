import {
  CascadedShadowGenerator, Color3, DirectionalLight, HemisphericLight, ReflectionProbe, Vector3, HDRFiltering,
  type AbstractMesh, type Camera, type Scene, ShadowGenerator, RenderTargetTexture, CubeMapToSphericalPolynomialTools,
} from '@babylonjs/core';
import { log } from '../core/Log';
import type { Sky } from './Sky';

/** Per-region lighting look. Colours are linear; intensities are in Babylon's physical-ish units. */
export interface LightingProfile {
  sunColor: Color3;
  sunIntensity: number;
  /** Elevation above the horizon and azimuth (radians, 0 = +Z, clockwise from above). */
  sunElevation: number;
  sunAzimuth: number;
  /** Fill from the sky dome (hemispheric) on top of the IBL, for tuning contrast. */
  skyFill: Color3;
  groundFill: Color3;
  fillIntensity: number;
  /** Image-based lighting strength (environment cube captured from the sky). */
  environmentIntensity: number;
  exposure: number;
  contrast: number;
  shadowDarkness: number;
}

export interface ShadowQuality {
  cascades: number;
  mapSize: number;
  /** Percentage-closer soft shadows (contact-hardening) vs plain PCF. */
  pcss: boolean;
  maxDistance: number;
}

export const SHADOW_LEVELS: ShadowQuality[] = [
  { cascades: 1, mapSize: 1024, pcss: false, maxDistance: 40 },
  { cascades: 2, mapSize: 1024, pcss: false, maxDistance: 70 },
  { cascades: 3, mapSize: 2048, pcss: false, maxDistance: 110 },
  { cascades: 4, mapSize: 2048, pcss: true, maxDistance: 160 },
];

export class Lighting {
  readonly sun: DirectionalLight;
  readonly fill: HemisphericLight;
  shadows?: CascadedShadowGenerator;
  private probe?: ReflectionProbe;
  private filtering?: HDRFiltering;
  private casters = new Set<AbstractMesh>();
  profile!: LightingProfile;
  private scene: Scene;

  constructor(scene: Scene) {
    this.scene = scene;
    this.sun = new DirectionalLight('sun', new Vector3(-0.3, -0.7, -0.4), scene);
    this.sun.intensity = 3;
    this.sun.shadowMinZ = -200;
    this.sun.shadowMaxZ = 260;
    this.fill = new HemisphericLight('skyFill', new Vector3(0, 1, 0), scene);
    this.fill.intensity = 0.15;
    // The fill never casts shadows; specular from a hemisphere looks plastic on armour.
    this.fill.specular = Color3.Black();
  }

  /** Direction *towards* the sun (for the sky and the atmosphere shader). */
  get toSun(): Vector3 {
    return this.sun.direction.scale(-1).normalize();
  }

  apply(p: LightingProfile, sky?: Sky): void {
    this.profile = p;
    const ce = Math.cos(p.sunElevation);
    const toSun = new Vector3(Math.sin(p.sunAzimuth) * ce, Math.sin(p.sunElevation), Math.cos(p.sunAzimuth) * ce);
    this.sun.direction = toSun.scale(-1);
    this.sun.diffuse = p.sunColor.clone();
    this.sun.specular = p.sunColor.clone();
    this.sun.intensity = p.sunIntensity;
    this.fill.diffuse = p.skyFill.clone();
    this.fill.groundColor = p.groundFill.clone();
    this.fill.intensity = p.fillIntensity;
    this.scene.environmentIntensity = p.environmentIntensity;
    const ip = this.scene.imageProcessingConfiguration;
    ip.exposure = p.exposure;
    ip.contrast = p.contrast;
    if (this.shadows) this.shadows.darkness = p.shadowDarkness;
    if (sky) sky.sunDir.copyFrom(toSun);
  }

  /** (Re)creates the cascaded shadow map for a quality level; casters are kept. */
  setShadowQuality(level: number, camera: Camera, maxVaryings = 32): void {
    const q = { ...SHADOW_LEVELS[Math.max(0, Math.min(SHADOW_LEVELS.length - 1, level))] };
    // Each cascade costs two interpolated varyings in every lit shader; devices limited to the
    // WebGPU minimum (16) can only afford two cascades alongside two-sided lighting and effects.
    if (maxVaryings < 20) q.cascades = Math.min(q.cascades, 2);
    this.shadows?.dispose();
    const csm = new CascadedShadowGenerator(q.mapSize, this.sun, true, camera);
    csm.numCascades = q.cascades;
    csm.shadowMaxZ = q.maxDistance;
    csm.lambda = 0.82;
    csm.cascadeBlendPercentage = 0.12;
    csm.stabilizeCascades = true; // no shimmering when the camera moves
    csm.autoCalcDepthBounds = false;
    csm.depthClamp = true;
    csm.bias = 0.0016;
    csm.normalBias = 0.012;
    csm.freezeShadowCastersBoundingInfo = false;
    if (q.pcss) {
      csm.usePercentageCloserFiltering = false;
      csm.useContactHardeningShadow = true;
      csm.contactHardeningLightSizeUVRatio = 0.035;
      csm.filteringQuality = ShadowGenerator.QUALITY_HIGH;
    } else {
      csm.usePercentageCloserFiltering = true;
      csm.filteringQuality = level >= 2 ? ShadowGenerator.QUALITY_HIGH : ShadowGenerator.QUALITY_MEDIUM;
    }
    csm.darkness = this.profile?.shadowDarkness ?? 0;
    csm.transparencyShadow = true;
    csm.enableSoftTransparentShadow = true;
    this.shadows = csm;
    for (const m of this.casters) csm.addShadowCaster(m, false);
    log.debug(`shadows: ${q.cascades} cascades @ ${q.mapSize}, ${q.pcss ? 'PCSS' : 'PCF'}`);
  }

  addCaster(mesh: AbstractMesh, includeDescendants = true): void {
    const list = includeDescendants ? [mesh, ...mesh.getChildMeshes(false)] : [mesh];
    for (const m of list) {
      if (this.casters.has(m)) continue;
      this.casters.add(m);
      this.shadows?.addShadowCaster(m, false);
      m.onDisposeObservable.addOnce(() => this.removeCaster(m));
    }
  }

  removeCaster(mesh: AbstractMesh): void {
    this.casters.delete(mesh);
    this.shadows?.removeShadowCaster(mesh, false);
  }

  /** Static scenery: receives shadows and casts them; frozen bounding info avoids per-frame work. */
  addStatic(mesh: AbstractMesh, cast = true): void {
    mesh.receiveShadows = true;
    for (const c of mesh.getChildMeshes(false)) c.receiveShadows = true;
    if (cast) this.addCaster(mesh, true);
  }

  /**
   * Captures the sky into a cube map, prefilters it for roughness (GGX importance sampling) and uses
   * it as the scene's environment for reflections and diffuse irradiance (spherical harmonics).
   */
  async captureEnvironment(sky: Sky, size = 128): Promise<void> {
    const scene = this.scene;
    if (!this.probe) {
      this.probe = new ReflectionProbe('skyProbe', size, scene, true, true);
      this.probe.renderList!.push(sky.mesh);
      this.probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      this.probe.position = Vector3.Zero();
      this.filtering = new HDRFiltering(scene.getEngine(), { hdrScale: 1, quality: 4096 });
    } else {
      this.probe.cubeTexture.resetRefreshCounter();
    }
    const tex = this.probe.cubeTexture;
    await new Promise<void>((resolve) => {
      tex.onAfterRenderObservable.addOnce(() => resolve());
      // Make sure it renders even when the main loop is not running (loading screens).
      scene.customRenderTargets.includes(tex) || scene.customRenderTargets.push(tex);
      sky.withSteps(Math.min(sky.cloudSteps, 12), () => tex.render(false));
    });
    try {
      tex.sphericalPolynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(tex);
      await this.filtering!.prefilter(tex);
      tex.lodGenerationScale = 0.8;
      scene.environmentTexture = tex;
    } catch (e) {
      log.warn('environment prefiltering failed; using unfiltered cube', e);
      scene.environmentTexture = tex;
    }
  }

  dispose(): void {
    this.shadows?.dispose();
    this.probe?.dispose();
    this.sun.dispose();
    this.fill.dispose();
  }
}
