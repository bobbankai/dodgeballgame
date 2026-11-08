import { type Camera, type PostProcess, type Scene } from '@babylonjs/core';
import { makePost, setTexel, POST_GLSL_HEAD, POST_WGSL_HEAD } from './PostUtil';

/**
 * Contrast-adaptive sharpening (after AMD FidelityFX CAS): sharpens more where local contrast is low,
 * less on edges that are already crisp, so TAA softness and upscaling blur are recovered without
 * halos. Runs last, on display-referred colour.
 */
const GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform vec2 texel;
uniform float sharpness;
void main(void) {
  vec3 b = texture2D(textureSampler, vUV + vec2(0.0, -texel.y)).rgb;
  vec3 d = texture2D(textureSampler, vUV + vec2(-texel.x, 0.0)).rgb;
  vec3 e = texture2D(textureSampler, vUV).rgb;
  vec3 f = texture2D(textureSampler, vUV + vec2(texel.x, 0.0)).rgb;
  vec3 h = texture2D(textureSampler, vUV + vec2(0.0, texel.y)).rgb;
  vec3 mn = min(min(min(d, e), min(f, b)), h);
  vec3 mx = max(max(max(d, e), max(f, b)), h);
  vec3 amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3(1e-4)), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 5.0, sharpness));
  vec3 col = (b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const WGSL = POST_WGSL_HEAD + /* wgsl */ `
uniform texel: vec2f;
uniform sharpness: f32;
fn t(uv: vec2f) -> vec3f { return textureSampleLevel(textureSampler, textureSamplerSampler, uv, 0.0).rgb; }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = input.vUV;
  let b = t(uv + vec2f(0.0, -uniforms.texel.y));
  let d = t(uv + vec2f(-uniforms.texel.x, 0.0));
  let e = t(uv);
  let f = t(uv + vec2f(uniforms.texel.x, 0.0));
  let h = t(uv + vec2f(0.0, uniforms.texel.y));
  let mn = min(min(min(d, e), min(f, b)), h);
  let mx = max(max(max(d, e), max(f, b)), h);
  let amp = sqrt(clamp(min(mn, 2.0 - mx) / max(mx, vec3f(1e-4)), vec3f(0.0), vec3f(1.0)));
  let w = amp * (-1.0 / mix(8.0, 5.0, uniforms.sharpness));
  let col = (b * w + d * w + f * w + h * w + e) / (1.0 + 4.0 * w);
  fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}`;

export class Sharpen {
  readonly post: PostProcess;
  sharpness = 0.4;
  constructor(scene: Scene, camera: Camera) {
    this.post = makePost({ name: 'ecCAS', glsl: GLSL, wgsl: WGSL, hdr: false, camera, engine: scene.getEngine(), uniforms: ['texel', 'sharpness'] });
    this.post.onApplyObservable.add((e) => {
      setTexel(e, this.post);
      e.setFloat('sharpness', this.sharpness);
    });
  }
  dispose(camera: Camera): void {
    this.post.dispose(camera);
  }
}
