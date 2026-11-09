import { type Material, type UniformBuffer, type MaterialDefines, type AbstractMesh, type Scene } from '@babylonjs/core';
import { EcPlugin, MatEnv, type PluginCode } from './EcPlugin';

/**
 * Weather and ground layers for any PBR material, in world space so every asset reacts the same:
 *  - a top-down coverage layer (ash in the Ashen Kingdom, snow on the Shattered Sky, moss in the
 *    Sanctuary) on up-facing surfaces, broken up by noise, with its own colour, roughness and a
 *    flattened normal;
 *  - rain wetness: porous surfaces darken, roughness drops (sharp reflections that SSR picks up);
 *  - puddles on flat ground: near-mirror water with a flat normal.
 * Per-material: `porosity` (metal 0 .. cloth/earth 1), `allowCover`, `allowPuddles`.
 */
export const NOISE_FN_GLSL = /* glsl */ `
#ifndef EC_VNOISE
#define EC_VNOISE
float ecH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ecVN(vec2 x) { vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ecH(i), ecH(i + vec2(1.0, 0.0)), f.x), mix(ecH(i + vec2(0.0, 1.0)), ecH(i + vec2(1.0, 1.0)), f.x), f.y); }
float ecFbm(vec2 p) { return ecVN(p) * 0.55 + ecVN(p * 2.13 + 3.1) * 0.28 + ecVN(p * 4.7 + 7.7) * 0.17; }
#endif
`;

export const NOISE_FN_WGSL = /* wgsl */ `
#ifndef EC_VNOISE
#define EC_VNOISE
fn ecH(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn ecVN(x: vec2f) -> f32 { let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ecH(i), ecH(i + vec2f(1.0, 0.0)), f.x), mix(ecH(i + vec2f(0.0, 1.0)), ecH(i + vec2f(1.0, 1.0)), f.x), f.y); }
fn ecFbm(p: vec2f) -> f32 { return ecVN(p) * 0.55 + ecVN(p * 2.13 + 3.1) * 0.28 + ecVN(p * 4.7 + 7.7) * 0.17; }
#endif
`;

export class SurfaceLayerPlugin extends EcPlugin {
  porosity = 0.8;
  allowCover = true;
  allowPuddles = false;
  /** Multiplies the global coverage for this material (e.g. 0.5 on walls). */
  coverScale = 1;

  constructor(material: Material) {
    super(material, 'EcSurfaceLayers', 120, { EC_LAYERS: false });
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_LAYERS = this.isEnabled;
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'ecLayerA', size: 4, type: 'vec4' }, // wetness, coverAmount, coverRoughness, coverScale
        { name: 'ecLayerB', size: 4, type: 'vec4' }, // porosity, allowPuddles, threshold, time
        { name: 'ecCoverColor', size: 4, type: 'vec4' }, // cover colour, water level
      ],
      fragment: `#ifdef EC_LAYERS
uniform vec4 ecLayerA;
uniform vec4 ecLayerB;
uniform vec4 ecCoverColor;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: unknown, _subMesh: unknown): void {
    if (!this.isEnabled) return;
    const e = MatEnv;
    ubo.updateFloat4('ecLayerA', e.wetness, this.allowCover ? e.coverAmount * this.coverScale : 0, e.coverRoughness, e.coverScale, '');
    ubo.updateFloat4('ecLayerB', this.porosity, this.allowPuddles ? 1 : 0, e.coverThreshold, e.time, '');
    ubo.updateFloat4('ecCoverColor', e.coverColor.r, e.coverColor.g, e.coverColor.b, e.waterLevel, '');
  }

  override getClassName(): string {
    return 'EcSurfaceLayers';
  }

  protected code(): PluginCode {
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_GLSL,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `
#ifdef EC_LAYERS
float ecCover = 0.0; float ecWet = 0.0; float ecPuddle = 0.0;
{
  vec3 wp = vPositionW;
  float up = normalW.y;
  float n = ecFbm(wp.xz * ecLayerA.w + wp.y * 0.3);
  ecCover = ecLayerA.y * smoothstep(ecLayerB.z, ecLayerB.z + 0.3, up + (n - 0.5) * 0.55);
  ecCover = clamp(ecCover * (0.6 + 0.8 * n), 0.0, 1.0);
  surfaceAlbedo = mix(surfaceAlbedo, ecCoverColor.rgb * (0.82 + 0.36 * n), ecCover);
  ecWet = ecLayerA.x * ecLayerB.x * (1.0 - ecCover * 0.7);
  float pn = ecFbm(wp.xz * 0.23 + 11.0);
  float ecSub = 1.0 - smoothstep(ecCoverColor.w - 0.05, ecCoverColor.w + 0.05, wp.y);
  ecPuddle = ecLayerB.y * ecLayerA.x * smoothstep(0.93, 0.985, up) * smoothstep(0.52, 0.62, pn + (ecLayerA.x - 0.5) * 0.25) * (1.0 - ecSub);
  // soaked below the waterline (darker), but its gloss belongs to the water surface, not to it
  surfaceAlbedo *= mix(1.0, 0.55, max(ecWet, ecSub * ecLayerB.x));
  ecWet *= 1.0 - ecSub;
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * 0.35 + vec3(0.01, 0.012, 0.014), ecPuddle);
  vec3 flatN = vec3(0.0, 1.0, 0.0);
  normalW = normalize(mix(normalW, normalize(mix(normalW, flatN, 0.6)), ecCover * 0.7));
  normalW = normalize(mix(normalW, flatN, ecPuddle));
}
#endif`,
          '!(reflectivityOut=reflectivityBlock)(?=\\()': /* glsl */ `
#if defined(EC_LAYERS) && defined(REFLECTIVITY)
surfaceMetallicOrReflectivityColorMap.g = mix(surfaceMetallicOrReflectivityColorMap.g, ecLayerA.z, ecCover);
surfaceMetallicOrReflectivityColorMap.b *= 1.0 - ecCover;
surfaceMetallicOrReflectivityColorMap.g *= mix(1.0, 0.32, ecWet);
surfaceMetallicOrReflectivityColorMap.g = mix(surfaceMetallicOrReflectivityColorMap.g, 0.03, ecPuddle);
surfaceMetallicOrReflectivityColorMap.b *= 1.0 - ecPuddle;
#endif
$1`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_WGSL,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* wgsl */ `
#ifdef EC_LAYERS
var ecCover: f32 = 0.0; var ecWet: f32 = 0.0; var ecPuddle: f32 = 0.0;
{
  let wp = fragmentInputs.vPositionW;
  let up = normalW.y;
  let n = ecFbm(wp.xz * uniforms.ecLayerA.w + wp.y * 0.3);
  ecCover = uniforms.ecLayerA.y * smoothstep(uniforms.ecLayerB.z, uniforms.ecLayerB.z + 0.3, up + (n - 0.5) * 0.55);
  ecCover = clamp(ecCover * (0.6 + 0.8 * n), 0.0, 1.0);
  surfaceAlbedo = mix(surfaceAlbedo, uniforms.ecCoverColor.rgb * (0.82 + 0.36 * n), ecCover);
  ecWet = uniforms.ecLayerA.x * uniforms.ecLayerB.x * (1.0 - ecCover * 0.7);
  let pn = ecFbm(wp.xz * 0.23 + 11.0);
  let ecSub = 1.0 - smoothstep(uniforms.ecCoverColor.w - 0.05, uniforms.ecCoverColor.w + 0.05, wp.y);
  ecPuddle = uniforms.ecLayerB.y * uniforms.ecLayerA.x * smoothstep(0.93, 0.985, up) * smoothstep(0.52, 0.62, pn + (uniforms.ecLayerA.x - 0.5) * 0.25) * (1.0 - ecSub);
  surfaceAlbedo *= mix(1.0, 0.55, max(ecWet, ecSub * uniforms.ecLayerB.x));
  ecWet *= 1.0 - ecSub;
  surfaceAlbedo = mix(surfaceAlbedo, surfaceAlbedo * 0.35 + vec3f(0.01, 0.012, 0.014), ecPuddle);
  let flatN = vec3f(0.0, 1.0, 0.0);
  normalW = normalize(mix(normalW, normalize(mix(normalW, flatN, 0.6)), ecCover * 0.7));
  normalW = normalize(mix(normalW, flatN, ecPuddle));
}
#endif`,
          '!(reflectivityOut=reflectivityBlock)(?=\\()': /* wgsl */ `
#if defined(EC_LAYERS) && defined(REFLECTIVITY)
surfaceMetallicOrReflectivityColorMap.g = mix(surfaceMetallicOrReflectivityColorMap.g, uniforms.ecLayerA.z, ecCover);
surfaceMetallicOrReflectivityColorMap.b *= 1.0 - ecCover;
surfaceMetallicOrReflectivityColorMap.g *= mix(1.0, 0.32, ecWet);
surfaceMetallicOrReflectivityColorMap.g = mix(surfaceMetallicOrReflectivityColorMap.g, 0.03, ecPuddle);
surfaceMetallicOrReflectivityColorMap.b *= 1.0 - ecPuddle;
#endif
$1`,
        },
      },
    };
  }
}

/** Convenience: attach weather layers to a material. */
export function withLayers(m: Material, o: Partial<Pick<SurfaceLayerPlugin, 'porosity' | 'allowCover' | 'allowPuddles' | 'coverScale'>> = {}): SurfaceLayerPlugin {
  const p = new SurfaceLayerPlugin(m);
  Object.assign(p, o);
  return p;
}

export type { AbstractMesh };
