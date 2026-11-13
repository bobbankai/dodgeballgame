import { type Camera, type DepthRenderer, type PostProcess, type Scene } from '@babylonjs/core';
import { makePost, setTexel, POST_GLSL_HEAD, POST_WGSL_HEAD } from './PostUtil';

/**
 * Cinematic depth of field with a physical thin-lens circle of confusion and bokeh:
 *  1. half-res prefilter: colour + signed CoC (near < 0 < far) from camera-space depth;
 *  2. half-res gather: 48-tap golden-angle disc, each tap only counts if its own CoC reaches this
 *     pixel (scatter-as-gather), which keeps sharp foreground edges and gives round bokeh;
 *  3. full-res composite against the sharp image.
 * Strength is 0 outside cinematics (the passes then cost almost nothing but stay in the chain).
 */
const COC_GLSL = /* glsl */ `
float coc(float z) {
  // thin lens: c = A * f * |z - s| / (z * (s - f)); expressed in pixels at half resolution
  float s = max(focusDist, 0.1);
  float f = focalLength * 0.001;
  float A = f / fStop;
  float c = A * f * (z - s) / (z * max(s - f, 1e-3));
  return clamp(c / sensor * resY * 0.5, -maxCoc, maxCoc) * strength;
}`;

const PRE_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform sampler2D depthSampler;
uniform float focusDist, focalLength, fStop, sensor, resY, maxCoc, strength;
` + COC_GLSL + `
void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  float z = abs(texture2D(depthSampler, vUV).r);
  float k = z < 1e-4 ? maxCoc * strength : coc(z);
  gl_FragColor = vec4(c, k);
}`;

const PRE_WGSL = POST_WGSL_HEAD + /* wgsl */ `
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
uniform focusDist: f32; uniform focalLength: f32; uniform fStop: f32; uniform sensor: f32; uniform resY: f32; uniform maxCoc: f32; uniform strength: f32;
fn coc(z: f32) -> f32 {
  let s = max(uniforms.focusDist, 0.1);
  let f = uniforms.focalLength * 0.001;
  let A = f / uniforms.fStop;
  let c = A * f * (z - s) / (z * max(s - f, 1e-3));
  return clamp(c / uniforms.sensor * uniforms.resY * 0.5, -uniforms.maxCoc, uniforms.maxCoc) * uniforms.strength;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;
  let z = abs(textureSampleLevel(depthSampler, depthSamplerSampler, input.vUV, 0.0).r);
  var k = uniforms.maxCoc * uniforms.strength;
  if (z >= 1e-4) { k = coc(z); }
  fragmentOutputs.color = vec4f(c, k);
}`;

const GATHER_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform vec2 texel;
uniform float maxCoc;
void main(void) {
  vec4 center = texture2D(textureSampler, vUV);
  float cr = abs(center.a);
  vec3 acc = center.rgb; float wsum = 1.0;
  if (maxCoc > 0.01) {
    for (int i = 0; i < 48; i++) {
      float fi = float(i) + 0.5;
      float r = sqrt(fi / 48.0) * maxCoc;
      float a = fi * 2.39996323;
      vec2 o = vec2(cos(a), sin(a)) * r;
      vec4 s = texture2D(textureSampler, vUV + o * texel);
      float sr = abs(s.a);
      // the tap contributes if its blur disc covers this pixel; far taps cannot bleed over a sharper near pixel
      float reach = clamp(sr - r + 1.0, 0.0, 1.0);
      float behind = s.a > center.a ? clamp(cr - r + 1.0, 0.0, 1.0) : 1.0;
      float w = reach * behind;
      acc += s.rgb * w; wsum += w;
    }
  }
  gl_FragColor = vec4(acc / wsum, center.a);
}`;

const GATHER_WGSL = POST_WGSL_HEAD + /* wgsl */ `
uniform texel: vec2f;
uniform maxCoc: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let center = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  let cr = abs(center.a);
  var acc = center.rgb;
  var wsum = 1.0;
  if (uniforms.maxCoc > 0.01) {
    for (var i = 0; i < 48; i++) {
      let fi = f32(i) + 0.5;
      let r = sqrt(fi / 48.0) * uniforms.maxCoc;
      let a = fi * 2.39996323;
      let o = vec2f(cos(a), sin(a)) * r;
      let s = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV + o * uniforms.texel, 0.0);
      let sr = abs(s.a);
      let reach = clamp(sr - r + 1.0, 0.0, 1.0);
      var behind = 1.0;
      if (s.a > center.a) { behind = clamp(cr - r + 1.0, 0.0, 1.0); }
      let w = reach * behind;
      acc += s.rgb * w;
      wsum += w;
    }
  }
  fragmentOutputs.color = vec4f(acc / wsum, center.a);
}`;

const COMP_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform sampler2D sceneSampler;
void main(void) {
  vec4 blur = texture2D(textureSampler, vUV);
  vec3 sharp = texture2D(sceneSampler, vUV).rgb;
  float f = smoothstep(0.6, 2.2, abs(blur.a));
  gl_FragColor = vec4(mix(sharp, blur.rgb, f), 1.0);
}`;

const COMP_WGSL = POST_WGSL_HEAD + /* wgsl */ `
var sceneSamplerSampler: sampler;
var sceneSampler: texture_2d<f32>;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let blur = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  let sharp = textureSampleLevel(sceneSampler, sceneSamplerSampler, input.vUV, 0.0).rgb;
  let f = smoothstep(0.6, 2.2, abs(blur.a));
  fragmentOutputs.color = vec4f(mix(sharp, blur.rgb, f), 1.0);
}`;

export class DepthOfField {
  readonly passes: PostProcess[];
  focusDistance = 5;
  focalLength = 50;
  fStop = 2.0;
  /** 0 = off, 1 = full. Eased by the director. */
  strength = 0;
  maxCoc = 14;

  constructor(scene: Scene, camera: Camera, depth: DepthRenderer) {
    const engine = scene.getEngine();
    const pre = makePost({
      name: 'ecDofPre', glsl: PRE_GLSL, wgsl: PRE_WGSL, size: 0.5, camera, engine,
      uniforms: ['focusDist', 'focalLength', 'fStop', 'sensor', 'resY', 'maxCoc', 'strength'], samplers: ['depthSampler'],
    });
    pre.onApplyObservable.add((e) => {
      e.setTexture('depthSampler', depth.getDepthMap());
      e.setFloat('focusDist', this.focusDistance);
      e.setFloat('focalLength', this.focalLength);
      e.setFloat('fStop', this.fStop);
      e.setFloat('sensor', 0.024);
      e.setFloat('resY', pre.height * 2);
      e.setFloat('maxCoc', this.maxCoc);
      e.setFloat('strength', this.strength);
    });
    const gather = makePost({ name: 'ecDofGather', glsl: GATHER_GLSL, wgsl: GATHER_WGSL, size: 0.5, camera, engine, uniforms: ['texel', 'maxCoc'] });
    gather.onApplyObservable.add((e) => {
      setTexel(e, gather);
      e.setFloat('maxCoc', this.maxCoc * this.strength);
    });
    const comp = makePost({ name: 'ecDofComp', glsl: COMP_GLSL, wgsl: COMP_WGSL, size: 1, camera, engine, samplers: ['sceneSampler'] });
    comp.onApplyObservable.add((e) => e.setTextureFromPostProcess('sceneSampler', pre));
    this.passes = [pre, gather, comp];
  }

  dispose(camera: Camera): void {
    for (const p of this.passes) p.dispose(camera);
  }
}
