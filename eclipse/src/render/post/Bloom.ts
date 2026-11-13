import { Texture, type Camera, type PostProcess, type Scene } from '@babylonjs/core';
import { makePost, setTexel, POST_GLSL_HEAD, POST_WGSL_HEAD } from './PostUtil';
import { assetUrl } from '../../assets/paths';

/**
 * Physically based bloom (the "Call of Duty: Advanced Warfare" filter, as used by UE and Unity HDRP):
 * a 6-level downsample chain with a 13-tap filter (Karis-weighted on the first level so single bright
 * pixels do not flicker), then a tent-filtered upsample chain that accumulates every level. The
 * result is *blended* with the scene (energy-conserving) rather than added, so bright skies glow
 * softly without washing out, plus a lens-dirt texture lit by the bloom.
 */
const DOWN_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform vec2 texel;
uniform float karis;
uniform float threshold;
uniform float knee;
vec3 s(vec2 o) { return texture2D(textureSampler, vUV + o * texel).rgb; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kw(vec3 c) { return c / (1.0 + luma(c)); }
void main(void) {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
  vec3 col;
  if (karis > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    col = kw(g0) * 0.125 + kw(g1) * 0.125 + kw(g2) * 0.125 + kw(g3) * 0.125 + kw(g4) * 0.5;
    col = col / max(1.0 - luma(col), 1e-4);
    // soft-knee threshold (0 = physically based, everything blooms a little)
    float br = max(col.r, max(col.g, col.b));
    float rq = clamp(br - threshold + knee, 0.0, 2.0 * knee);
    rq = rq * rq / (4.0 * knee + 1e-5);
    col *= max(rq, br - threshold) / max(br, 1e-5);
    col = min(col, vec3(64000.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const DOWN_WGSL = POST_WGSL_HEAD + /* wgsl */ `
uniform texel: vec2f;
uniform karis: f32;
uniform threshold: f32;
uniform knee: f32;
fn smp(uv: vec2f, o: vec2f) -> vec3f { return textureSampleLevel(textureSampler, textureSamplerSampler, uv + o * uniforms.texel, 0.0).rgb; }
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
fn kw(c: vec3f) -> vec3f { return c / (1.0 + luma(c)); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let a = smp(uv, vec2f(-2.0, 2.0)); let b = smp(uv, vec2f(0.0, 2.0)); let c = smp(uv, vec2f(2.0, 2.0));
  let d = smp(uv, vec2f(-2.0, 0.0)); let e = smp(uv, vec2f(0.0, 0.0)); let f = smp(uv, vec2f(2.0, 0.0));
  let g = smp(uv, vec2f(-2.0, -2.0)); let h = smp(uv, vec2f(0.0, -2.0)); let i = smp(uv, vec2f(2.0, -2.0));
  let j = smp(uv, vec2f(-1.0, 1.0)); let k = smp(uv, vec2f(1.0, 1.0)); let l = smp(uv, vec2f(-1.0, -1.0)); let m = smp(uv, vec2f(1.0, -1.0));
  var col: vec3f;
  if (uniforms.karis > 0.5) {
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + i) * 0.25; let g4 = (j + k + l + m) * 0.25;
    col = kw(g0) * 0.125 + kw(g1) * 0.125 + kw(g2) * 0.125 + kw(g3) * 0.125 + kw(g4) * 0.5;
    col = col / max(1.0 - luma(col), 1e-4);
    let br = max(col.r, max(col.g, col.b));
    var rq = clamp(br - uniforms.threshold + uniforms.knee, 0.0, 2.0 * uniforms.knee);
    rq = rq * rq / (4.0 * uniforms.knee + 1e-5);
    col *= max(rq, br - uniforms.threshold) / max(br, 1e-5);
    col = min(col, vec3f(64000.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  fragmentOutputs.color = vec4f(max(col, vec3f(0.0)), 1.0);
}`;

const UP_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform sampler2D baseSampler;
uniform vec2 texel;
uniform float radius;
void main(void) {
  vec2 o = texel * radius;
  vec3 s = texture2D(textureSampler, vUV).rgb * 4.0;
  s += (texture2D(textureSampler, vUV + vec2(-o.x, 0.0)).rgb + texture2D(textureSampler, vUV + vec2(o.x, 0.0)).rgb +
        texture2D(textureSampler, vUV + vec2(0.0, -o.y)).rgb + texture2D(textureSampler, vUV + vec2(0.0, o.y)).rgb) * 2.0;
  s += texture2D(textureSampler, vUV + vec2(-o.x, -o.y)).rgb + texture2D(textureSampler, vUV + vec2(o.x, -o.y)).rgb +
       texture2D(textureSampler, vUV + vec2(-o.x, o.y)).rgb + texture2D(textureSampler, vUV + vec2(o.x, o.y)).rgb;
  gl_FragColor = vec4(texture2D(baseSampler, vUV).rgb + s / 16.0, 1.0);
}`;

const UP_WGSL = POST_WGSL_HEAD + /* wgsl */ `
var baseSamplerSampler: sampler;
var baseSampler: texture_2d<f32>;
uniform texel: vec2f;
uniform radius: f32;
fn t(uv: vec2f) -> vec3f { return textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).rgb; }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let o = uniforms.texel * uniforms.radius;
  var s = t(uv) * 4.0;
  s += (t(uv + vec2f(-o.x, 0.0)) + t(uv + vec2f(o.x, 0.0)) + t(uv + vec2f(0.0, -o.y)) + t(uv + vec2f(0.0, o.y))) * 2.0;
  s += t(uv + vec2f(-o.x, -o.y)) + t(uv + vec2f(o.x, -o.y)) + t(uv + vec2f(-o.x, o.y)) + t(uv + vec2f(o.x, o.y));
  fragmentOutputs.color = vec4f(textureSampleLevel(baseSampler, baseSamplerSampler, uv, 0.0).rgb + s / 16.0, 1.0);
}`;

const MIX_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform sampler2D sceneSampler;
uniform sampler2D dirtSampler;
uniform float intensity;
uniform float dirt;
uniform float levels;
uniform float aspect;
void main(void) {
  vec3 bloom = texture2D(textureSampler, vUV).rgb / levels;
  vec3 scene = texture2D(sceneSampler, vUV).rgb;
  vec2 duv = (vUV - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0) + 0.5;
  vec3 lens = texture2D(dirtSampler, duv).rgb;
  vec3 col = mix(scene, bloom, intensity) + bloom * lens * dirt;
  gl_FragColor = vec4(col, 1.0);
}`;

const MIX_WGSL = POST_WGSL_HEAD + /* wgsl */ `
var sceneSamplerSampler: sampler;
var sceneSampler: texture_2d<f32>;
var dirtSamplerSampler: sampler;
var dirtSampler: texture_2d<f32>;
uniform intensity: f32;
uniform dirt: f32;
uniform levels: f32;
uniform aspect: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let bloom = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb / uniforms.levels;
  let scene = textureSampleLevel(sceneSampler, sceneSamplerSampler, input.vUV, 0.0).rgb;
  let duv = (input.vUV - 0.5) * vec2f(uniforms.aspect, 1.0) / max(uniforms.aspect, 1.0) + 0.5;
  let lens = textureSampleLevel(dirtSampler, dirtSamplerSampler, duv, 0.0).rgb;
  let col = mix(scene, bloom, uniforms.intensity) + bloom * lens * uniforms.dirt;
  fragmentOutputs.color = vec4f(col, 1.0);
}`;

export interface BloomParams {
  /** Blend amount of the bloom (0.02 - 0.15 is natural). */
  intensity: number;
  /** Lens dirt strength. */
  dirt: number;
  /** 0 = physically based (no threshold); raise for a stylised look. */
  threshold: number;
  /** Upsample filter radius in texels (wider = softer). */
  radius: number;
}

export class Bloom {
  readonly passes: PostProcess[] = [];
  params: BloomParams = { intensity: 0.06, dirt: 0.6, threshold: 0, radius: 1.0 };
  private dirtTex: Texture;

  constructor(scene: Scene, camera: Camera, levels = 6) {
    const engine = scene.getEngine();
    this.dirtTex = new Texture(assetUrl('tex/fx_lens_dirt.webp'), scene, false, true, Texture.BILINEAR_SAMPLINGMODE);
    const downs: PostProcess[] = [];
    for (let i = 0; i < levels; i++) {
      const pp = makePost({
        name: 'ecBloomDown', glsl: DOWN_GLSL, wgsl: DOWN_WGSL, uniforms: ['texel', 'karis', 'threshold', 'knee'],
        size: 1 / 2 ** (i + 1), camera, engine,
      });
      const first = i === 0;
      pp.onApplyObservable.add((e) => {
        setTexel(e, pp);
        e.setFloat('karis', first ? 1 : 0);
        e.setFloat('threshold', this.params.threshold);
        e.setFloat('knee', Math.max(0.05, this.params.threshold * 0.5));
      });
      downs.push(pp);
      this.passes.push(pp);
    }
    // up chain: U_k = D_k + tent(U_{k+1}); D_k's output is the input of D_{k+1}
    for (let k = levels - 2; k >= 0; k--) {
      const pp = makePost({
        name: 'ecBloomUp', glsl: UP_GLSL, wgsl: UP_WGSL, uniforms: ['texel', 'radius'], samplers: ['baseSampler'],
        size: 1 / 2 ** (k + 1), camera, engine,
      });
      const baseOf = downs[k + 1];
      pp.onApplyObservable.add((e) => {
        setTexel(e, pp);
        e.setFloat('radius', this.params.radius);
        e.setTextureFromPostProcess('baseSampler', baseOf);
      });
      this.passes.push(pp);
    }
    const mix = makePost({
      name: 'ecBloomMix', glsl: MIX_GLSL, wgsl: MIX_WGSL, uniforms: ['intensity', 'dirt', 'levels', 'aspect'],
      samplers: ['sceneSampler', 'dirtSampler'], size: 1, camera, engine,
    });
    mix.onApplyObservable.add((e) => {
      e.setTextureFromPostProcess('sceneSampler', downs[0]);
      e.setTexture('dirtSampler', this.dirtTex);
      e.setFloat('intensity', this.params.intensity);
      e.setFloat('dirt', this.params.dirt * this.params.intensity);
      e.setFloat('levels', levels);
      e.setFloat('aspect', mix.width / Math.max(1, mix.height));
    });
    this.passes.push(mix);
  }

  dispose(camera: Camera): void {
    for (const p of this.passes) p.dispose(camera);
    this.dirtTex.dispose();
  }
}
