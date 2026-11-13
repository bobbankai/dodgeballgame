import {
  CascadedShadowGenerator, Color3, DirectionalLight, HemisphericLight, ReflectionProbe, Vector3, HDRFiltering,
  type AbstractMesh, type Camera, type Scene, ShadowGenerator, RenderTargetTexture, CubeMapToSphericalPolynomialTools,
  SphericalPolynomial, type BaseTexture,
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
  /**
   * Local light probe: the surroundings near the player captured into the environment cube, so
   * ambient light and reflections come from the place itself (ground bounce, walls, a roof overhead)
   * and not from an open sky everywhere. `blend` mixes the local diffuse light with the sky's (a
   * single probe is only right at its own position); `size` 0 turns it off.
   */
  localProbe = { size: 96, distance: 9, interval: 14, height: 2.2, blend: 0.7, filterSamples: 256 };
  private statics = new Set<AbstractMesh>();
  private sky?: Sky;
  private skyEnv?: BaseTexture;
  private skySH?: SphericalPolynomial;
  private local: { probe?: ReflectionProbe; at?: Vector3; age: number; busy: boolean; token: number } = { age: 0, busy: false, token: 0 };
  private localFilter?: HDRFiltering;
  private sh: { from?: SphericalPolynomial; to?: SphericalPolynomial; t: number } = { t: 1 };

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
    // static scenery is what the local light probe sees
    for (const m of [mesh, ...mesh.getChildMeshes(false)]) {
      if (this.statics.has(m)) continue;
      this.statics.add(m);
      m.onDisposeObservable.addOnce(() => this.statics.delete(m));
    }
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
    // the sky is the base the local probe blends with; a new sky starts the local capture afresh
    this.sky = sky;
    this.skyEnv = tex;
    this.skySH = tex.sphericalPolynomial ?? undefined;
    this.local.token++;
    this.local.probe?.dispose();
    this.local = { age: 0, busy: false, token: this.local.token };
    this.sh = { t: 1 };
  }

  /**
   * Keeps the local light probe current: call every frame with the point the view is about (the
   * player). A new capture starts when that point has moved `distance` metres or `interval` seconds
   * have passed; the scene's static scenery and the sky are rendered into a fresh cube from just
   * above it, prefiltered for roughness, and swapped in. Diffuse light (spherical harmonics) is
   * eased from the old probe to the new one, so the ambient never pops. `now` waits for the capture
   * (level loads call it once before the fade in).
   */
  async updateLocal(dt: number, center: Vector3, now = false): Promise<void> {
    const cfg = this.localProbe;
    const env = this.scene.environmentTexture;
    // ease the diffuse light toward the latest probe
    if (this.sh.t < 1 && this.sh.from && this.sh.to && env) {
      this.sh.t = Math.min(1, this.sh.t + dt / 1.5);
      const k = this.sh.t * this.sh.t * (3 - 2 * this.sh.t);
      env.sphericalPolynomial = lerpSH(this.sh.from, this.sh.to, k);
    }
    if (!cfg.size || !this.sky || !this.skyEnv || !this.skySH || this.local.busy) return;
    this.local.age += dt;
    const moved = this.local.at ? Vector3.Distance(this.local.at, center) : Infinity;
    if (!now && moved < cfg.distance && this.local.age < cfg.interval) return;
    this.local.busy = true;
    const token = this.local.token;
    const scene = this.scene;
    const at = center.clone();
    const probe = new ReflectionProbe('localProbe', cfg.size, scene, true, true);
    try {
      probe.position = at.add(new Vector3(0, cfg.height, 0));
      probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;
      const list = probe.renderList!;
      list.push(this.sky.mesh);
      for (const m of this.statics) if (m.isEnabled() && m.isVisible && !m.isDisposed() && m.getTotalVertices() > 0) list.push(m);
      const tex = probe.cubeTexture;
      const sky = this.sky;
      await new Promise<void>((resolve) => {
        tex.onAfterRenderObservable.addOnce(() => resolve());
        if (now) sky.withSteps(Math.min(sky.cloudSteps, 12), () => tex.render(false));
      });
      probe.renderList!.length = 0; // rendered once: release the scenery so nothing keeps a reference to a mesh that is later disposed
      const localSH = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(tex);
      this.localFilter ??= new HDRFiltering(scene.getEngine(), { hdrScale: 1, quality: cfg.filterSamples });
      await this.localFilter.prefilter(tex);
      if (token !== this.local.token || !localSH) {
        probe.dispose(); // the level changed while this was rendering
        return;
      }
      tex.lodGenerationScale = 0.8;
      const current = scene.environmentTexture?.sphericalPolynomial ?? this.skySH;
      const target = lerpSH(this.skySH!, localSH, cfg.blend);
      tex.sphericalPolynomial = now ? target : current;
      this.sh = now ? { t: 1 } : { from: current, to: target, t: 0 };
      const old = this.local.probe;
      scene.environmentTexture = tex;
      this.local.probe = probe;
      this.local.at = at;
      this.local.age = 0;
      old?.dispose();
    } catch (e) {
      log.warn('local light probe failed; keeping the previous environment', e);
      probe.dispose();
      this.local.at = at;
      this.local.age = 0;
    } finally {
      if (token === this.local.token) this.local.busy = false;
    }
  }

  dispose(): void {
    this.shadows?.dispose();
    this.probe?.dispose();
    this.sun.dispose();
    this.fill.dispose();
  }
}


const SH_TERMS = ['x', 'y', 'z', 'xx', 'yy', 'zz', 'xy', 'yz', 'zx'] as const;

/** Blend of two sets of diffuse-light coefficients (they are linear in the light they describe). */
function lerpSH(a: SphericalPolynomial, b: SphericalPolynomial, t: number): SphericalPolynomial {
  const o = new SphericalPolynomial();
  for (const k of SH_TERMS) Vector3.LerpToRef(a[k], b[k], t, o[k]);
  return o;
}
