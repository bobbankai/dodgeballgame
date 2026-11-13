import { type Camera, type PostProcess, type Scene } from '@babylonjs/core';
import { makePost, POST_GLSL_HEAD, POST_WGSL_HEAD } from './PostUtil';
import type { AutoExposure } from './AutoExposure';
import { GradingLut, NEUTRAL_GRADE, type GradeSettings } from './Grading';

/**
 * Final HDR -> display pass: auto exposure, lateral chromatic aberration, barrel lens distortion,
 * filmic tone curve (ACES fitted, close to UE's default, or AgX), 3D LUT grading, natural vignette,
 * luminance-weighted film grain, sRGB encode and dithering.
 */
const COMMON_GLSL = /* glsl */ `
const mat3 ACES_IN = mat3(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
vec3 rrtOdt(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) { c = c * ACES_IN; c = rrtOdt(c); c = c * ACES_OUT; return clamp(c, 0.0, 1.0); }
const mat3 AGX = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_INV = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
vec3 agxCurve(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 c) {
  c = AGX * c; c = clamp(log2(max(c, vec3(1e-10))), -12.47393, 4.026069); c = (c + 12.47393) / 16.499999;
  c = agxCurve(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = l + 1.12 * (c - l); c = pow(max(c, 0.0), vec3(1.12));
  c = AGX_INV * c; return clamp(pow(max(c, 0.0), vec3(2.2)), 0.0, 1.0);
}
float toSrgb1(float c) { return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
vec3 toSrgb(vec3 c) { return vec3(toSrgb1(c.r), toSrgb1(c.g), toSrgb1(c.b)); }
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const FRAG_GLSL = POST_GLSL_HEAD + COMMON_GLSL + /* glsl */ `
precision highp sampler3D;
uniform sampler2D adaptSampler;
uniform sampler3D lutSampler;
uniform float compensation, key, autoExposure, manualExposure, chroma, distortion, vignette, vignetteRound, grain, time, aspect, tmOp, lutAmount;
vec3 lut(vec3 c) { return texture(lutSampler, clamp(c, 0.0, 1.0) * (31.0 / 32.0) + 0.5 / 32.0).rgb; }
void main(void) {
  vec2 d = vUV - 0.5;
  vec2 da = d * vec2(aspect, 1.0);
  float r2 = dot(da, da);
  vec2 uv = 0.5 + d * (1.0 + distortion * r2);
  vec2 dir = d * chroma * r2;
  vec3 col;
  col.r = texture2D(textureSampler, uv + dir).r;
  col.g = texture2D(textureSampler, uv).g;
  col.b = texture2D(textureSampler, uv - dir).b;
  float avgLog = texture2D(adaptSampler, vec2(0.5)).r;
  float exposure = autoExposure > 0.5 ? key / exp2(avgLog) : manualExposure;
  exposure *= exp2(compensation);
  col *= exposure;
  // natural vignette (cos^4 falloff of the lens), applied in light, before the curve
  float v = 1.0 - vignette * smoothstep(0.15, 1.1, length(da) * vignetteRound);
  col *= v;
  vec3 mapped = tmOp > 0.5 ? agx(col) : aces(col);
  vec3 srgb = toSrgb(mapped);
  srgb = mix(srgb, lut(srgb), lutAmount);
  // grain strongest in the mid-tones, like film
  float lum = dot(srgb, vec3(0.299, 0.587, 0.114));
  float n = h12(gl_FragCoord.xy + fract(time * 13.7) * 311.0) - 0.5;
  srgb += n * grain * 4.0 * lum * (1.0 - lum);
  // triangular dither to hide 8-bit banding in skies and fog
  srgb += (h12(gl_FragCoord.xy * 1.37 + time) + h12(gl_FragCoord.yx * 0.71 - time) - 1.0) / 255.0;
  gl_FragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);
}`;

const COMMON_WGSL = /* wgsl */ `
const ACES_IN = mat3x3f(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
const ACES_OUT = mat3x3f(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
fn rrtOdt(v: vec3f) -> vec3f { let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
fn aces(c0: vec3f) -> vec3f { var c = c0 * ACES_IN; c = rrtOdt(c); c = c * ACES_OUT; return clamp(c, vec3f(0.0), vec3f(1.0)); }
const AGX = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const AGX_INV = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
fn agxCurve(x: vec3f) -> vec3f { let x2 = x * x; let x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
fn agx(c0: vec3f) -> vec3f {
  var c = AGX * c0; c = clamp(log2(max(c, vec3f(1e-10))), vec3f(-12.47393), vec3f(4.026069)); c = (c + 12.47393) / 16.499999;
  c = agxCurve(c);
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722)); c = l + 1.12 * (c - l); c = pow(max(c, vec3f(0.0)), vec3f(1.12));
  c = AGX_INV * c; return clamp(pow(max(c, vec3f(0.0)), vec3f(2.2)), vec3f(0.0), vec3f(1.0));
}
fn toSrgb1(c: f32) -> f32 { if (c <= 0.0031308) { return c * 12.92; } return 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
fn toSrgb(c: vec3f) -> vec3f { return vec3f(toSrgb1(c.r), toSrgb1(c.g), toSrgb1(c.b)); }
fn h12(p: vec2f) -> f32 { var p3 = fract(vec3f(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const FRAG_WGSL = POST_WGSL_HEAD + COMMON_WGSL + /* wgsl */ `
var adaptSamplerSampler: sampler;
var adaptSampler: texture_2d<f32>;
var lutSamplerSampler: sampler;
var lutSampler: texture_3d<f32>;
uniform compensation: f32; uniform key: f32; uniform autoExposure: f32; uniform manualExposure: f32; uniform chroma: f32;
uniform distortion: f32; uniform vignette: f32; uniform vignetteRound: f32; uniform grain: f32; uniform time: f32; uniform aspect: f32;
uniform tmOp: f32; uniform lutAmount: f32;
fn lut(c: vec3f) -> vec3f { return textureSampleLevel(lutSampler, lutSamplerSampler, clamp(c, vec3f(0.0), vec3f(1.0)) * (31.0 / 32.0) + 0.5 / 32.0, 0.0).rgb; }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = input.vUV - 0.5;
  let da = d * vec2f(uniforms.aspect, 1.0);
  let r2 = dot(da, da);
  let uv = 0.5 + d * (1.0 + uniforms.distortion * r2);
  let dir = d * uniforms.chroma * r2;
  var col = vec3f(textureSampleLevel(textureSampler, textureSamplerSampler, uv + dir, 0.0).r,
                  textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).g,
                  textureSampleLevel(textureSampler, textureSamplerSampler, uv - dir, 0.0).b);
  let avgLog = textureSampleLevel(adaptSampler, adaptSamplerSampler, vec2f(0.5), 0.0).r;
  var exposure = uniforms.manualExposure;
  if (uniforms.autoExposure > 0.5) { exposure = uniforms.key / exp2(avgLog); }
  exposure *= exp2(uniforms.compensation);
  col *= exposure;
  let v = 1.0 - uniforms.vignette * smoothstep(0.15, 1.1, length(da) * uniforms.vignetteRound);
  col *= v;
  var mapped = aces(col);
  if (uniforms.tmOp > 0.5) { mapped = agx(col); }
  var srgb = toSrgb(mapped);
  srgb = mix(srgb, lut(srgb), uniforms.lutAmount);
  let lum = dot(srgb, vec3f(0.299, 0.587, 0.114));
  let n = h12(input.position.xy + fract(uniforms.time * 13.7) * 311.0) - 0.5;
  srgb += n * uniforms.grain * 4.0 * lum * (1.0 - lum);
  srgb += (h12(input.position.xy * 1.37 + uniforms.time) + h12(input.position.yx * 0.71 - uniforms.time) - 1.0) / 255.0;
  fragmentOutputs.color = vec4f(clamp(srgb, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

export interface TonemapParams {
  operator: 'aces' | 'agx';
  /** Stops of exposure compensation on top of auto exposure. */
  compensation: number;
  manualExposure: number;
  chroma: number;
  distortion: number;
  vignette: number;
  grain: number;
  lutAmount: number;
}

export class Tonemap {
  readonly post: PostProcess;
  readonly lut: GradingLut;
  params: TonemapParams = { operator: 'aces', compensation: 0, manualExposure: 1, chroma: 0.006, distortion: 0, vignette: 0.2, grain: 0.018, lutAmount: 1 };
  private time = 0;

  constructor(scene: Scene, camera: Camera, private exposure: AutoExposure, grade: GradeSettings = NEUTRAL_GRADE) {
    const engine = scene.getEngine();
    this.lut = new GradingLut(scene, grade);
    this.post = makePost({
      name: 'ecTonemap', glsl: FRAG_GLSL, wgsl: FRAG_WGSL, hdr: false, camera, engine,
      uniforms: ['compensation', 'key', 'autoExposure', 'manualExposure', 'chroma', 'distortion', 'vignette', 'vignetteRound',
        'grain', 'time', 'aspect', 'tmOp', 'lutAmount'],
      samplers: ['adaptSampler', 'lutSampler'],
    });
    this.post.onApplyObservable.add((e) => {
      const p = this.params;
      const ex = this.exposure.params;
      e.setTexture('adaptSampler', this.exposure.adapted);
      e.setTexture('lutSampler', this.lut.texture);
      e.setFloat('compensation', p.compensation + ex.compensation);
      e.setFloat('key', ex.key);
      e.setFloat('autoExposure', ex.enabled ? 1 : 0);
      e.setFloat('manualExposure', p.manualExposure);
      e.setFloat('chroma', p.chroma);
      e.setFloat('distortion', p.distortion);
      e.setFloat('vignette', p.vignette);
      e.setFloat('vignetteRound', 1.0);
      e.setFloat('grain', p.grain);
      e.setFloat('time', this.time);
      e.setFloat('aspect', this.post.width / Math.max(1, this.post.height));
      e.setFloat('tmOp', p.operator === 'agx' ? 1 : 0);
      e.setFloat('lutAmount', p.lutAmount);
    });
    exposure.setSource(this.post);
  }

  update(dt: number): void {
    this.time += dt;
  }

  setGrade(g: GradeSettings): void {
    this.lut.set(g);
  }

  dispose(camera: Camera): void {
    this.post.dispose(camera);
    this.lut.dispose();
  }
}
