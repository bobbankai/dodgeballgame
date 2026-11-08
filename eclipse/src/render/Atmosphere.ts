import {
  Color3, Matrix, PostProcess, Texture, Vector3, type Camera, type DepthRenderer, type Scene, Constants,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from './ShaderLib';

/**
 * Atmosphere post-process (runs in HDR, before tone mapping):
 *  - analytic exponential height fog with sun in-scattering (Henyey-Greenstein phase), which gives
 *    aerial perspective and the bright haze towards the sun;
 *  - a ray-marched noise layer for drifting smoke, mist and ash banks ("volumetric fog"), jittered
 *    per pixel and per frame so few samples are enough.
 * Depth comes from a camera-space depth map (0 where nothing was drawn, i.e. the sky).
 */
export interface FogParams {
  color: Color3;
  /** Density at `baseHeight` (per metre). */
  density: number;
  heightFalloff: number;
  baseHeight: number;
  /** Scales the sun's in-scattering. */
  sunScatter: number;
  /** Henyey-Greenstein asymmetry (0 = isotropic, 0.8 = strong forward glow). */
  anisotropy: number;
  /** How much of the fog covers the sky near the horizon. */
  skyAmount: number;
  /** Noise layer. */
  volumeDensity: number;
  volumeScale: number;
  volumeHeight: number;
  volumeColor: Color3;
  wind: Vector3;
  maxDistance: number;
}

export const DEFAULT_FOG: FogParams = {
  color: new Color3(0.5, 0.55, 0.62),
  density: 0.012,
  heightFalloff: 0.06,
  baseHeight: 0,
  sunScatter: 1,
  anisotropy: 0.6,
  skyAmount: 0.5,
  volumeDensity: 0.03,
  volumeScale: 0.07,
  volumeHeight: 8,
  volumeColor: new Color3(0.6, 0.6, 0.65),
  wind: new Vector3(1.2, 0.1, 0.4),
  maxDistance: 60,
};

const PARAMS = [
  'uInvViewProj', 'uCamPos', 'uCamFwd', 'uFogColor', 'uSunColor', 'uSunDir', 'uDensity', 'uFalloff', 'uBase', 'uSunScatter',
  'uAniso', 'uSkyAmount', 'uVolDensity', 'uVolScale', 'uVolHeight', 'uVolColor', 'uWind', 'uMaxDist', 'uTime', 'uSteps', 'uFrame',
];

const FRAG_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uCamFwd, uFogColor, uSunColor, uSunDir, uVolColor, uWind;
uniform float uDensity, uFalloff, uBase, uSunScatter, uAniso, uSkyAmount, uVolDensity, uVolScale, uVolHeight, uMaxDist, uTime, uSteps, uFrame;
#include<ecNoise>
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);
  float vz = abs(texture2D(depthSampler, vUV).r);
  vec4 far = uInvViewProj * vec4(vUV * 2.0 - 1.0, 0.5, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  bool sky = vz < 1e-4;
  float dist = sky ? 3000.0 : vz / max(dot(dir, uCamFwd), 1e-3);
  float cosT = dot(dir, uSunDir);
  vec3 inscatter = uFogColor + uSunColor * uSunScatter * hg(cosT, uAniso) * 6.0;
  // analytic height fog
  float h0 = uCamPos.y - uBase;
  float bdy = uFalloff * dir.y * dist;
  float od = uDensity * exp(-uFalloff * h0) * dist * (abs(bdy) > 1e-4 ? (1.0 - exp(-bdy)) / bdy : 1.0);
  if (sky) od *= uSkyAmount * smoothstep(0.35, 0.0, dir.y);
  float T = exp(-od);
  vec3 col = scene.rgb * T + inscatter * (1.0 - T);
  // ray-marched noise layer
  if (uSteps > 0.5 && uVolDensity > 0.0) {
    float len = min(dist, uMaxDist);
    float stepLen = len / uSteps;
    float t = stepLen * (ign(gl_FragCoord.xy + uFrame * 5.588) );
    float trans = 1.0; vec3 acc = vec3(0.0);
    vec3 vin = uVolColor + uSunColor * uSunScatter * hg(cosT, uAniso) * 4.0;
    for (int i = 0; i < 24; i++) {
      if (float(i) >= uSteps) break;
      vec3 p = uCamPos + dir * t;
      float hf = exp(-max(p.y - uBase, 0.0) / uVolHeight);
      float n = ec_fbm3(p * uVolScale + uWind * uTime * uVolScale);
      float d = max(n - 0.42, 0.0) * 2.2 * hf * uVolDensity;
      float a = 1.0 - exp(-d * stepLen);
      acc += trans * a * vin;
      trans *= 1.0 - a;
      t += stepLen;
    }
    col = col * trans + acc;
  }
  gl_FragColor = vec4(col, scene.a);
}`;

const FRAG_WGSL = /* wgsl */ `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
uniform uInvViewProj: mat4x4f;
uniform uCamPos: vec3f; uniform uCamFwd: vec3f; uniform uFogColor: vec3f; uniform uSunColor: vec3f; uniform uSunDir: vec3f;
uniform uVolColor: vec3f; uniform uWind: vec3f;
uniform uDensity: f32; uniform uFalloff: f32; uniform uBase: f32; uniform uSunScatter: f32; uniform uAniso: f32; uniform uSkyAmount: f32;
uniform uVolDensity: f32; uniform uVolScale: f32; uniform uVolHeight: f32; uniform uMaxDist: f32; uniform uTime: f32; uniform uSteps: f32; uniform uFrame: f32;
#include<ecNoise>
fn hg(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let scene = textureSample(textureSampler, textureSamplerSampler, input.vUV);
  let vz = abs(textureSampleLevel(depthSampler, depthSamplerSampler, input.vUV, 0.0).r);
  let far = uniforms.uInvViewProj * vec4f(input.vUV * 2.0 - 1.0, 0.5, 1.0);
  let dir = normalize(far.xyz / far.w - uniforms.uCamPos);
  let sky = vz < 1e-4;
  var dist = 3000.0;
  if (!sky) { dist = vz / max(dot(dir, uniforms.uCamFwd), 1e-3); }
  let cosT = dot(dir, uniforms.uSunDir);
  let inscatter = uniforms.uFogColor + uniforms.uSunColor * uniforms.uSunScatter * hg(cosT, uniforms.uAniso) * 6.0;
  let h0 = uniforms.uCamPos.y - uniforms.uBase;
  let bdy = uniforms.uFalloff * dir.y * dist;
  var shape = 1.0;
  if (abs(bdy) > 1e-4) { shape = (1.0 - exp(-bdy)) / bdy; }
  var od = uniforms.uDensity * exp(-uniforms.uFalloff * h0) * dist * shape;
  if (sky) { od *= uniforms.uSkyAmount * smoothstep(0.35, 0.0, dir.y); }
  let T = exp(-od);
  var col = scene.rgb * T + inscatter * (1.0 - T);
  if (uniforms.uSteps > 0.5 && uniforms.uVolDensity > 0.0) {
    let len = min(dist, uniforms.uMaxDist);
    let stepLen = len / uniforms.uSteps;
    var t = stepLen * ign(input.position.xy + uniforms.uFrame * 5.588);
    var trans = 1.0;
    var acc = vec3f(0.0);
    let vin = uniforms.uVolColor + uniforms.uSunColor * uniforms.uSunScatter * hg(cosT, uniforms.uAniso) * 4.0;
    for (var i = 0; i < 24; i++) {
      if (f32(i) >= uniforms.uSteps) { break; }
      let p = uniforms.uCamPos + dir * t;
      let hf = exp(-max(p.y - uniforms.uBase, 0.0) / uniforms.uVolHeight);
      let n = ec_fbm3(p * uniforms.uVolScale + uniforms.uWind * uniforms.uTime * uniforms.uVolScale);
      let d = max(n - 0.42, 0.0) * 2.2 * hf * uniforms.uVolDensity;
      let a = 1.0 - exp(-d * stepLen);
      acc += trans * a * vin;
      trans *= 1.0 - a;
      t += stepLen;
    }
    col = col * trans + acc;
  }
  fragmentOutputs.color = vec4f(col, scene.a);
}`;

registerShader({ name: 'ecAtmosphere', glsl: { fragment: FRAG_GLSL }, wgsl: { fragment: FRAG_WGSL } });

export class Atmosphere {
  readonly post: PostProcess;
  params: FogParams;
  sunDir = new Vector3(0, 1, 0);
  sunColor = new Color3(1, 1, 1);
  steps = 12;
  enabled = true;
  private time = 0;
  private frame = 0;
  private invVP = new Matrix();
  private fwd = new Vector3();

  constructor(scene: Scene, camera: Camera, depth: DepthRenderer, params: Partial<FogParams> = {}) {
    this.params = { ...DEFAULT_FOG, ...params };
    const engine = scene.getEngine();
    this.post = new PostProcess('atmosphere', 'ecAtmosphere', PARAMS, ['depthSampler'], 1, camera,
      Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT, undefined, undefined, false,
      undefined, shaderLanguage(engine));
    this.post.onApplyObservable.add((effect) => {
      const p = this.params;
      effect.setTexture('depthSampler', depth.getDepthMap());
      scene.getTransformMatrix().invertToRef(this.invVP);
      effect.setMatrix('uInvViewProj', this.invVP);
      effect.setVector3('uCamPos', camera.globalPosition);
      camera.getDirectionToRef(Vector3.Forward(scene.useRightHandedSystem), this.fwd);
      effect.setVector3('uCamFwd', this.fwd);
      effect.setColor3('uFogColor', p.color);
      effect.setColor3('uSunColor', this.sunColor);
      effect.setVector3('uSunDir', this.sunDir);
      effect.setFloat('uDensity', this.enabled ? p.density : 0);
      effect.setFloat('uFalloff', p.heightFalloff);
      effect.setFloat('uBase', p.baseHeight);
      effect.setFloat('uSunScatter', p.sunScatter);
      effect.setFloat('uAniso', p.anisotropy);
      effect.setFloat('uSkyAmount', p.skyAmount);
      effect.setFloat('uVolDensity', this.enabled ? p.volumeDensity : 0);
      effect.setFloat('uVolScale', p.volumeScale);
      effect.setFloat('uVolHeight', p.volumeHeight);
      effect.setColor3('uVolColor', p.volumeColor);
      effect.setVector3('uWind', p.wind);
      effect.setFloat('uMaxDist', p.maxDistance);
      effect.setFloat('uTime', this.time);
      effect.setFloat('uSteps', this.steps);
      effect.setFloat('uFrame', this.frame % 64);
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.frame++;
  }

  set(params: Partial<FogParams>): void {
    Object.assign(this.params, params);
  }

  dispose(camera: Camera): void {
    this.post.dispose(camera);
  }
}
