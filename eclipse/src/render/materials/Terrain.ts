import {
  Color3, Constants, PBRMaterial, RawTexture, Texture, Vector4, type AbstractEngine, type BaseTexture, type Material,
  type MaterialDefines, type Scene, type SubMesh, type UniformBuffer,
} from '@babylonjs/core';
import { EcPlugin, type PluginCode } from './EcPlugin';
import { NOISE_FN_GLSL, NOISE_FN_WGSL } from './SurfaceLayers';
import { loadLayerArrays, type LayerArrays } from './TextureArrays';
import { SurfaceLayerPlugin } from './SurfaceLayers';

/**
 * Terrain surface: four texture-array layers blended by a splat map *and* by height (the ambient
 * occlusion channel stands in for height, so grass sinks between cobbles and sand fills cracks),
 * a rock layer forced onto steep slopes with biplanar projection (no stretching on cliffs),
 * anti-tiling by mixing two rotated scales with noise, macro colour variation, and per-pixel
 * roughness / AO written into the PBR reflectivity inputs. Lighting, shadows, IBL, SSR and the
 * weather layers all still come from Babylon's PBR.
 */
export interface TerrainOptions {
  /** Four texture sets, layer 3 should be the cliff rock. */
  layers: [string, string, string, string];
  /** Tile size in metres per layer. */
  tiles: [number, number, number, number];
  /** Splat weights (RGBA = layers 0..3), covering origin..origin+size in XZ. */
  splat: BaseTexture;
  origin: [number, number];
  size: [number, number];
  normalStrength?: number;
  heightBlend?: number;
  /** 1 - normal.y where cliffs start. */
  cliffStart?: number;
  macro?: number;
  tint?: Color3;
}

const FRAG_GLSL_DEF = /* glsl */ `
#ifdef EC_TERRAIN
precision highp sampler2DArray;
uniform sampler2D ecSplat;
uniform sampler2DArray ecAlb;
uniform sampler2DArray ecNrm;
uniform sampler2DArray ecOrm;
vec2 ecRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void ecLayer(vec2 uv, float i, float mixB, out vec3 a, out vec3 n, out vec3 o) {
  vec2 uv2 = ecRot(uv * 0.37, 1.1) + 0.31;
  a = mix(texture(ecAlb, vec3(uv, i)).rgb, texture(ecAlb, vec3(uv2, i)).rgb, mixB);
  n = mix(texture(ecNrm, vec3(uv, i)).rgb, texture(ecNrm, vec3(uv2, i)).rgb, mixB) * 2.0 - 1.0;
  o = mix(texture(ecOrm, vec3(uv, i)).rgb, texture(ecOrm, vec3(uv2, i)).rgb, mixB);
}
#endif
`;

const FRAG_GLSL_MAIN = /* glsl */ `
#ifdef EC_TERRAIN
vec3 ecTOrm = vec3(1.0, 0.8, 0.0);
{
  vec3 wp = vPositionW;
  vec3 gN = normalize(vNormalW);
  vec4 w = texture(ecSplat, (wp.xz - ecTerrA.xy) / ecTerrA.zw);
  float slope = 1.0 - gN.y;
  float cliff = smoothstep(ecTerrB.z, ecTerrB.z + 0.18, slope);
  w = mix(w, vec4(0.0, 0.0, 0.0, 1.0), cliff);
  float dist = length(vEyePosition.xyz - wp);
  float mixB = clamp(0.08 + 0.3 * ecFbm(wp.xz * 0.11) + smoothstep(12.0, 70.0, dist) * 0.55, 0.0, 0.85);
  vec3 a0, n0, o0, a1, n1, o1, a2, n2, o2, a3, n3, o3;
  ecLayer(wp.xz / ecTiles.x, 0.0, mixB, a0, n0, o0);
  ecLayer(wp.xz / ecTiles.y, 1.0, mixB, a1, n1, o1);
  ecLayer(wp.xz / ecTiles.z, 2.0, mixB, a2, n2, o2);
  // rock: biplanar (the two dominant side projections), plus top
  vec3 an = abs(gN);
  vec3 ax, nx, ox, az, nz, oz, ay, ny, oy;
  ecLayer(wp.zy / ecTiles.w, 3.0, mixB * 0.5, ax, nx, ox);
  ecLayer(wp.xy / ecTiles.w, 3.0, mixB * 0.5, az, nz, oz);
  ecLayer(wp.xz / ecTiles.w, 3.0, mixB * 0.5, ay, ny, oy);
  vec3 bw = pow(an, vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  a3 = ax * bw.x + ay * bw.y + az * bw.z;
  o3 = ox * bw.x + oy * bw.y + oz * bw.z;
  // world-space rock normal by whiteout-style projection blending
  vec3 rnx = vec3(0.0, nx.y, nx.x) * sign(gN.x);
  vec3 rny = vec3(ny.x, 0.0, ny.y);
  vec3 rnz = vec3(nz.x, nz.y, 0.0) * sign(gN.z);
  vec3 rockN = rnx * bw.x + rny * bw.y + rnz * bw.z;
  // height blend (AO as height proxy)
  float hb = ecTerrB.y;
  vec4 h = vec4(o0.r, o1.r, o2.r, o3.r) + w * 1.5;
  float hm = max(max(h.x, h.y), max(h.z, h.w)) - hb;
  vec4 bwt = max(h - hm, 0.0) * step(0.001, w);
  bwt /= max(bwt.x + bwt.y + bwt.z + bwt.w, 1e-4);
  vec3 alb = toLinearSpace(a0) * bwt.x + toLinearSpace(a1) * bwt.y + toLinearSpace(a2) * bwt.z + toLinearSpace(a3) * bwt.w;
  alb *= mix(1.0 - ecTerrB.w, 1.0 + ecTerrB.w, ecFbm(wp.xz * 0.018 + 5.0));
  surfaceAlbedo = alb * vAlbedoColor.rgb;
  vec3 tn = vec3(n0.x, 0.0, n0.y) * bwt.x + vec3(n1.x, 0.0, n1.y) * bwt.y + vec3(n2.x, 0.0, n2.y) * bwt.z + rockN * bwt.w;
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x);
  vec3 B = normalize(vec3(0.0, 0.0, 1.0) - gN * gN.z);
  vec3 flatPart = T * tn.x + B * tn.z;
  vec3 rockPart = rockN * bwt.w;
  normalW = normalize(gN + (flatPart * (1.0 - bwt.w) + rockPart) * ecTerrB.x);
  ecTOrm = o0 * bwt.x + o1 * bwt.y + o2 * bwt.z + o3 * bwt.w;
}
#endif
`;

const FRAG_WGSL_DEF = /* wgsl */ `
#ifdef EC_TERRAIN
var ecSplatSampler: sampler;
var ecSplat: texture_2d<f32>;
var ecAlbSampler: sampler;
var ecAlb: texture_2d_array<f32>;
var ecNrmSampler: sampler;
var ecNrm: texture_2d_array<f32>;
var ecOrmSampler: sampler;
var ecOrm: texture_2d_array<f32>;
fn ecRot(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }
struct EcLayerOut { a: vec3f, n: vec3f, o: vec3f, };
fn ecLayer(uv: vec2f, i: i32, mixB: f32) -> EcLayerOut {
  let uv2 = ecRot(uv * 0.37, 1.1) + 0.31;
  var r: EcLayerOut;
  r.a = mix(textureSample(ecAlb, ecAlbSampler, uv, i).rgb, textureSample(ecAlb, ecAlbSampler, uv2, i).rgb, mixB);
  r.n = mix(textureSample(ecNrm, ecNrmSampler, uv, i).rgb, textureSample(ecNrm, ecNrmSampler, uv2, i).rgb, mixB) * 2.0 - 1.0;
  r.o = mix(textureSample(ecOrm, ecOrmSampler, uv, i).rgb, textureSample(ecOrm, ecOrmSampler, uv2, i).rgb, mixB);
  return r;
}
#endif
`;

const FRAG_WGSL_MAIN = /* wgsl */ `
#ifdef EC_TERRAIN
var ecTOrm = vec3f(1.0, 0.8, 0.0);
{
  let wp = fragmentInputs.vPositionW;
  let gN = normalize(fragmentInputs.vNormalW);
  var w = textureSample(ecSplat, ecSplatSampler, (wp.xz - uniforms.ecTerrA.xy) / uniforms.ecTerrA.zw);
  let slope = 1.0 - gN.y;
  let cliff = smoothstep(uniforms.ecTerrB.z, uniforms.ecTerrB.z + 0.18, slope);
  w = mix(w, vec4f(0.0, 0.0, 0.0, 1.0), cliff);
  let dist = length(scene.vEyePosition.xyz - wp);
  let mixB = clamp(0.08 + 0.3 * ecFbm(wp.xz * 0.11) + smoothstep(12.0, 70.0, dist) * 0.55, 0.0, 0.85);
  let l0 = ecLayer(wp.xz / uniforms.ecTiles.x, 0, mixB);
  let l1 = ecLayer(wp.xz / uniforms.ecTiles.y, 1, mixB);
  let l2 = ecLayer(wp.xz / uniforms.ecTiles.z, 2, mixB);
  let an = abs(gN);
  let lx = ecLayer(wp.zy / uniforms.ecTiles.w, 3, mixB * 0.5);
  let lz = ecLayer(wp.xy / uniforms.ecTiles.w, 3, mixB * 0.5);
  let ly = ecLayer(wp.xz / uniforms.ecTiles.w, 3, mixB * 0.5);
  var bw = pow(an, vec3f(4.0)); bw /= (bw.x + bw.y + bw.z);
  let a3 = lx.a * bw.x + ly.a * bw.y + lz.a * bw.z;
  let o3 = lx.o * bw.x + ly.o * bw.y + lz.o * bw.z;
  let rnx = vec3f(0.0, lx.n.y, lx.n.x) * sign(gN.x);
  let rny = vec3f(ly.n.x, 0.0, ly.n.y);
  let rnz = vec3f(lz.n.x, lz.n.y, 0.0) * sign(gN.z);
  let rockN = rnx * bw.x + rny * bw.y + rnz * bw.z;
  let hb = uniforms.ecTerrB.y;
  let h = vec4f(l0.o.r, l1.o.r, l2.o.r, o3.r) + w * 1.5;
  let hm = max(max(h.x, h.y), max(h.z, h.w)) - hb;
  var bwt = max(h - hm, vec4f(0.0)) * step(vec4f(0.001), w);
  bwt /= max(bwt.x + bwt.y + bwt.z + bwt.w, 1e-4);
  var alb = toLinearSpaceVec3(l0.a) * bwt.x + toLinearSpaceVec3(l1.a) * bwt.y + toLinearSpaceVec3(l2.a) * bwt.z + toLinearSpaceVec3(a3) * bwt.w;
  alb *= mix(1.0 - uniforms.ecTerrB.w, 1.0 + uniforms.ecTerrB.w, ecFbm(wp.xz * 0.018 + 5.0));
  surfaceAlbedo = alb * uniforms.vAlbedoColor.rgb;
  let tn = vec3f(l0.n.x, 0.0, l0.n.y) * bwt.x + vec3f(l1.n.x, 0.0, l1.n.y) * bwt.y + vec3f(l2.n.x, 0.0, l2.n.y) * bwt.z;
  let T = normalize(vec3f(1.0, 0.0, 0.0) - gN * gN.x);
  let B = normalize(vec3f(0.0, 0.0, 1.0) - gN * gN.z);
  let flatPart = T * tn.x + B * tn.z;
  normalW = normalize(gN + (flatPart * (1.0 - bwt.w) + rockN * bwt.w) * uniforms.ecTerrB.x);
  ecTOrm = l0.o * bwt.x + l1.o * bwt.y + l2.o * bwt.z + o3 * bwt.w;
}
#endif
`;

export class TerrainPlugin extends EcPlugin {
  arrays?: LayerArrays;
  opts: TerrainOptions;
  private terrA = new Vector4();
  private tiles = new Vector4();
  private terrB = new Vector4();

  constructor(material: Material, opts: TerrainOptions) {
    super(material, 'EcTerrain', 100, { EC_TERRAIN: false });
    this.opts = opts;
  }

  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_TERRAIN = this.isEnabled && !!this.arrays;
  }

  override isReadyForSubMesh(): boolean {
    if (!this.arrays) return true;
    return this.arrays.albedo.isReady() && this.arrays.normal.isReady() && this.arrays.orm.isReady() && this.opts.splat.isReady();
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('ecSplat', 'ecAlb', 'ecNrm', 'ecOrm');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'ecTerrA', size: 4, type: 'vec4' },
        { name: 'ecTiles', size: 4, type: 'vec4' },
        { name: 'ecTerrB', size: 4, type: 'vec4' },
      ],
      fragment: `#ifdef EC_TERRAIN
uniform vec4 ecTerrA;
uniform vec4 ecTiles;
uniform vec4 ecTerrB;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    if (!this.isEnabled || !this.arrays) return;
    const o = this.opts;
    this.terrA.set(o.origin[0], o.origin[1], o.size[0], o.size[1]);
    this.tiles.set(...o.tiles);
    this.terrB.set(o.normalStrength ?? 1, o.heightBlend ?? 0.25, o.cliffStart ?? 0.38, o.macro ?? 0.12);
    ubo.updateVector4('ecTerrA', this.terrA);
    ubo.updateVector4('ecTiles', this.tiles);
    ubo.updateVector4('ecTerrB', this.terrB);
    ubo.setTexture('ecSplat', o.splat);
    ubo.setTexture('ecAlb', this.arrays.albedo);
    ubo.setTexture('ecNrm', this.arrays.normal);
    ubo.setTexture('ecOrm', this.arrays.orm);
  }

  override getActiveTextures(active: BaseTexture[]): void {
    if (this.arrays) active.push(this.arrays.albedo, this.arrays.normal, this.arrays.orm, this.opts.splat);
  }

  override getClassName(): string {
    return 'EcTerrain';
  }

  protected code(): PluginCode {
    // runs right after Babylon samples the metallic/roughness map, before anything uses it
    const reflect = (pre: string) => `$1
#if defined(EC_TERRAIN) && defined(REFLECTIVITY)
surfaceMetallicOrReflectivityColorMap = vec4${pre}(ecTOrm.r, ecTOrm.g, 0.0, 1.0);
#endif
`;
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_GLSL + FRAG_GLSL_DEF,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: FRAG_GLSL_MAIN,
          '!(surfaceMetallicOrReflectivityColorMap=TEXRD\\([^;]*;)': reflect(''),
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_WGSL + FRAG_WGSL_DEF,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: FRAG_WGSL_MAIN,
          '!(surfaceMetallicOrReflectivityColorMap: vec4f=TEXRD\\([^;]*;)': reflect('f'),
        },
      },
    };
  }
}

let dummyOrm: RawTexture | undefined;

/**
 * Creates a terrain material. A 1x1 white metallic texture enables Babylon's per-pixel
 * reflectivity path, whose inputs the plugin overwrites with the blended layers' AO / roughness.
 */
export async function createTerrainMaterial(scene: Scene, name: string, o: TerrainOptions): Promise<PBRMaterial> {
  const m = new PBRMaterial(name, scene);
  if (!dummyOrm || dummyOrm.getScene() !== scene) {
    dummyOrm = new RawTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  }
  m.metallicTexture = dummyOrm;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = 1;
  m.albedoColor = o.tint ?? new Color3(1, 1, 1);
  const plugin = new TerrainPlugin(m, o);
  const layers = new SurfaceLayerPlugin(m);
  layers.allowPuddles = true;
  layers.porosity = 0.9;
  plugin.arrays = await loadLayerArrays(scene, [...o.layers]);
  plugin.markAllDefinesAsDirty();
  return m;
}
