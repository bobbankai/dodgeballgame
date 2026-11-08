import {
  Camera, Color3, Constants, FreeCamera, Matrix, PostProcess, Texture, Vector3, type RawTexture3D,
  type DepthRenderer, type Scene,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from './ShaderLib';
import { sharedNoise3D } from './Noise';

/**
 * Volumetric atmosphere (runs in HDR before the bloom and tone mapping):
 *  - ray-marched participating media from the camera up to `maxDistance`: exponential height fog plus
 *    a drifting 3D-noise layer (smoke, mist, ash banks), lit by an ambient term and the sun with a
 *    Henyey-Greenstein phase function. The sun term is *shadowed* by a sun-space depth map, so trees,
 *    ruins and characters cast real light shafts ("god rays") through the fog;
 *  - beyond the march, analytic height fog (aerial perspective) out to the scene depth or the sky;
 *  - per-pixel interleaved-gradient jitter (resolved by TAA when enabled).
 */
export interface FogParams {
  color: Color3;
  density: number;
  heightFalloff: number;
  baseHeight: number;
  sunScatter: number;
  anisotropy: number;
  skyAmount: number;
  volumeDensity: number;
  volumeScale: number;
  volumeHeight: number;
  volumeColor: Color3;
  wind: Vector3;
  maxDistance: number;
  /** Extra density inside the march that makes light shafts visible (0 = none). */
  shaftDensity: number;
}

export const DEFAULT_FOG: FogParams = {
  color: new Color3(0.36, 0.4, 0.46),
  density: 0.0018,
  heightFalloff: 0.06,
  baseHeight: 0,
  sunScatter: 0.6,
  anisotropy: 0.6,
  skyAmount: 0.35,
  volumeDensity: 0.012,
  volumeScale: 0.07,
  volumeHeight: 8,
  volumeColor: new Color3(0.6, 0.6, 0.65),
  wind: new Vector3(1.2, 0.1, 0.4),
  maxDistance: 60,
  shaftDensity: 0.002,
};

const PARAMS = [
  'uInvViewProj', 'uCamPos', 'uCamFwd', 'uFogColor', 'uSunColor', 'uSunDir', 'uDensity', 'uFalloff', 'uBase', 'uSunScatter',
  'uAniso', 'uSkyAmount', 'uVolDensity', 'uVolScale', 'uVolHeight', 'uVolColor', 'uWind', 'uMaxDist', 'uTime', 'uSteps', 'uFrame',
  'uSunViewProj', 'uSunView', 'uShadowOn', 'uShaft',
];

const FRAG_GLSL = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D depthSampler;
uniform sampler2D sunDepthSampler;
uniform sampler3D noiseSampler;
uniform mat4 uInvViewProj, uSunViewProj, uSunView;
uniform vec3 uCamPos, uCamFwd, uFogColor, uSunColor, uSunDir, uVolColor, uWind;
uniform float uDensity, uFalloff, uBase, uSunScatter, uAniso, uSkyAmount, uVolDensity, uVolScale, uVolHeight, uMaxDist, uTime, uSteps, uFrame, uShadowOn, uShaft;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float noise(vec3 p) { return texture(noiseSampler, p).r * 0.65 + texture(noiseSampler, p * 2.73 + 0.31).r * 0.35; }
float sunVis(vec3 p) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 c = uSunViewProj * vec4(p, 1.0);
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) return 1.0;
  float stored = abs(texture2D(sunDepthSampler, uv).r);
  float z = abs((uSunView * vec4(p, 1.0)).z);
  return (stored < 1e-4 || z < stored + 0.15) ? 1.0 : 0.0;
}
// optical depth of exponential height fog between t0 and t1 along dir
float heightOD(float t0, float t1, vec3 dir) {
  float h0 = uCamPos.y - uBase;
  float k = uFalloff * dir.y;
  float a = uDensity * exp(-uFalloff * h0);
  if (abs(k) < 1e-5) return a * (t1 - t0);
  return a * (exp(-k * t0) - exp(-k * t1)) / k;
}
void main(void) {
  vec4 scene = texture2D(textureSampler, vUV);
  float vz = abs(texture2D(depthSampler, vUV).r);
  vec4 far = uInvViewProj * vec4(vUV * 2.0 - 1.0, 0.5, 1.0);
  vec3 dir = normalize(far.xyz / far.w - uCamPos);
  bool sky = vz < 1e-4;
  float dist = sky ? 4000.0 : vz / max(dot(dir, uCamFwd), 1e-3);
  float cosT = dot(dir, uSunDir);
  float phase = hg(cosT, uAniso);
  vec3 sunIn = uSunColor * uSunScatter * phase * 8.0;
  float T = 1.0; vec3 acc = vec3(0.0);
  float march = min(dist, uMaxDist);
  if (uSteps > 0.5) {
    float stepLen = march / uSteps;
    float t = stepLen * ign(gl_FragCoord.xy + uFrame * 5.588);
    for (int i = 0; i < 32; i++) {
      if (float(i) >= uSteps) break;
      vec3 p = uCamPos + dir * t;
      float hy = max(p.y - uBase, 0.0);
      float base = uDensity * exp(-uFalloff * hy) + uShaft * exp(-hy / max(uVolHeight * 2.0, 1.0));
      float n = noise(p * uVolScale * 0.25 + uWind * uTime * uVolScale * 0.25);
      float vol = max(n - 0.45, 0.0) * 3.0 * exp(-hy / uVolHeight) * uVolDensity;
      float sigma = base + vol;
      float vis = sunVis(p);
      vec3 L = uFogColor * (base / max(sigma, 1e-6)) + uVolColor * (vol / max(sigma, 1e-6)) + sunIn * vis;
      float a = 1.0 - exp(-sigma * stepLen);
      acc += T * a * L;
      T *= 1.0 - a;
      t += stepLen;
    }
  }
  // analytic remainder (aerial perspective) from the end of the march to the surface
  float od = heightOD(march, dist, dir);
  if (sky) od *= uSkyAmount * smoothstep(0.35, 0.0, dir.y);
  float T2 = exp(-od);
  vec3 haze = uFogColor + uSunColor * uSunScatter * phase * 4.0;
  acc += T * (1.0 - T2) * haze;
  T *= T2;
  gl_FragColor = vec4(scene.rgb * T + acc, scene.a);
}`;

const FRAG_WGSL = /* wgsl */ `
varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
var sunDepthSamplerSampler: sampler;
var sunDepthSampler: texture_2d<f32>;
var noiseSamplerSampler: sampler;
var noiseSampler: texture_3d<f32>;
uniform uInvViewProj: mat4x4f; uniform uSunViewProj: mat4x4f; uniform uSunView: mat4x4f;
uniform uCamPos: vec3f; uniform uCamFwd: vec3f; uniform uFogColor: vec3f; uniform uSunColor: vec3f; uniform uSunDir: vec3f;
uniform uVolColor: vec3f; uniform uWind: vec3f;
uniform uDensity: f32; uniform uFalloff: f32; uniform uBase: f32; uniform uSunScatter: f32; uniform uAniso: f32; uniform uSkyAmount: f32;
uniform uVolDensity: f32; uniform uVolScale: f32; uniform uVolHeight: f32; uniform uMaxDist: f32; uniform uTime: f32; uniform uSteps: f32;
uniform uFrame: f32; uniform uShadowOn: f32; uniform uShaft: f32;
fn hg(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn noise(p: vec3f) -> f32 {
  return textureSampleLevel(noiseSampler, noiseSamplerSampler, p, 0.0).r * 0.65 + textureSampleLevel(noiseSampler, noiseSamplerSampler, p * 2.73 + 0.31, 0.0).r * 0.35;
}
fn sunVis(p: vec3f) -> f32 {
  if (uniforms.uShadowOn < 0.5) { return 1.0; }
  let c = uniforms.uSunViewProj * vec4f(p, 1.0);
  let uv = c.xy / c.w * 0.5 + 0.5;
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) { return 1.0; }
  let stored = abs(textureSampleLevel(sunDepthSampler, sunDepthSamplerSampler, uv, 0.0).r);
  let z = abs((uniforms.uSunView * vec4f(p, 1.0)).z);
  if (stored < 1e-4 || z < stored + 0.15) { return 1.0; }
  return 0.0;
}
fn heightOD(t0: f32, t1: f32, dir: vec3f) -> f32 {
  let h0 = uniforms.uCamPos.y - uniforms.uBase;
  let k = uniforms.uFalloff * dir.y;
  let a = uniforms.uDensity * exp(-uniforms.uFalloff * h0);
  if (abs(k) < 1e-5) { return a * (t1 - t0); }
  return a * (exp(-k * t0) - exp(-k * t1)) / k;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let scene = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0);
  let vz = abs(textureSampleLevel(depthSampler, depthSamplerSampler, input.vUV, 0.0).r);
  let far = uniforms.uInvViewProj * vec4f(input.vUV * 2.0 - 1.0, 0.5, 1.0);
  let dir = normalize(far.xyz / far.w - uniforms.uCamPos);
  let sky = vz < 1e-4;
  var dist = 4000.0;
  if (!sky) { dist = vz / max(dot(dir, uniforms.uCamFwd), 1e-3); }
  let cosT = dot(dir, uniforms.uSunDir);
  let phase = hg(cosT, uniforms.uAniso);
  let sunIn = uniforms.uSunColor * uniforms.uSunScatter * phase * 8.0;
  var T = 1.0;
  var acc = vec3f(0.0);
  let march = min(dist, uniforms.uMaxDist);
  if (uniforms.uSteps > 0.5) {
    let stepLen = march / uniforms.uSteps;
    var t = stepLen * ign(input.position.xy + uniforms.uFrame * 5.588);
    for (var i = 0; i < 32; i++) {
      if (f32(i) >= uniforms.uSteps) { break; }
      let p = uniforms.uCamPos + dir * t;
      let hy = max(p.y - uniforms.uBase, 0.0);
      let base = uniforms.uDensity * exp(-uniforms.uFalloff * hy) + uniforms.uShaft * exp(-hy / max(uniforms.uVolHeight * 2.0, 1.0));
      let n = noise(p * uniforms.uVolScale * 0.25 + uniforms.uWind * uniforms.uTime * uniforms.uVolScale * 0.25);
      let vol = max(n - 0.45, 0.0) * 3.0 * exp(-hy / uniforms.uVolHeight) * uniforms.uVolDensity;
      let sigma = base + vol;
      let vis = sunVis(p);
      let L = uniforms.uFogColor * (base / max(sigma, 1e-6)) + uniforms.uVolColor * (vol / max(sigma, 1e-6)) + sunIn * vis;
      let a = 1.0 - exp(-sigma * stepLen);
      acc += T * a * L;
      T *= 1.0 - a;
      t += stepLen;
    }
  }
  var od = heightOD(march, dist, dir);
  if (sky) { od *= uniforms.uSkyAmount * smoothstep(0.35, 0.0, dir.y); }
  let T2 = exp(-od);
  let haze = uniforms.uFogColor + uniforms.uSunColor * uniforms.uSunScatter * phase * 4.0;
  acc += T * (1.0 - T2) * haze;
  T *= T2;
  fragmentOutputs.color = vec4f(scene.rgb * T + acc, scene.a);
}`;

registerShader({ name: 'ecAtmosphere', glsl: { fragment: FRAG_GLSL }, wgsl: { fragment: FRAG_WGSL } });

/**
 * Sun-space depth for volumetric shadows: an orthographic camera looking down the sun direction,
 * following the player, rendered by a camera-space depth renderer at a modest resolution.
 */
export class SunDepth {
  readonly camera: FreeCamera;
  readonly depth: DepthRenderer;
  extent = 45;
  constructor(scene: Scene, size = 1024) {
    this.camera = new FreeCamera('sunDepthCam', new Vector3(0, 100, 0), scene, false);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = 400;
    this.depth = scene.enableDepthRenderer(this.camera, false, false, Texture.NEAREST_SAMPLINGMODE, true);
    const map = this.depth.getDepthMap();
    map.resize(size);
    map.refreshRate = 1;
  }

  /** Centre the sun view on a point (the player); snaps to texels to keep shafts from shimmering. */
  follow(center: Vector3, toSun: Vector3): void {
    const e = this.extent;
    const texel = (2 * e) / this.depth.getDepthMap().getSize().width;
    const c = new Vector3(Math.round(center.x / texel) * texel, Math.round(center.y / texel) * texel, Math.round(center.z / texel) * texel);
    this.camera.position.copyFrom(c.add(toSun.scale(180)));
    this.camera.setTarget(c);
    this.camera.orthoLeft = -e;
    this.camera.orthoRight = e;
    this.camera.orthoTop = e;
    this.camera.orthoBottom = -e;
  }

  dispose(): void {
    this.camera.dispose();
  }
}

export class Atmosphere {
  readonly post: PostProcess;
  params: FogParams;
  sunDir = new Vector3(0, 1, 0);
  sunColor = new Color3(1, 1, 1);
  steps = 12;
  enabled = true;
  sun?: SunDepth;
  private time = 0;
  private frame = 0;
  private invVP = new Matrix();
  private sunVP = new Matrix();
  private fwd = new Vector3();
  private noise: RawTexture3D;

  constructor(scene: Scene, camera: Camera, depth: DepthRenderer, params: Partial<FogParams> = {}, sun?: SunDepth) {
    this.params = { ...DEFAULT_FOG, ...params };
    this.sun = sun;
    this.noise = sharedNoise3D(scene);
    const engine = scene.getEngine();
    this.post = new PostProcess('atmosphere', 'ecAtmosphere', PARAMS, ['depthSampler', 'sunDepthSampler', 'noiseSampler'], 1, camera,
      Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT, undefined, undefined, false,
      undefined, shaderLanguage(engine));
    this.post.onApplyObservable.add((effect) => {
      const p = this.params;
      effect.setTexture('depthSampler', depth.getDepthMap());
      effect.setTexture('noiseSampler', this.noise);
      const sd = this.sun;
      if (sd) {
        const cam = sd.camera;
        effect.setTexture('sunDepthSampler', sd.depth.getDepthMap());
        cam.getViewMatrix().multiplyToRef(cam.getProjectionMatrix(), this.sunVP);
        effect.setMatrix('uSunViewProj', this.sunVP);
        effect.setMatrix('uSunView', cam.getViewMatrix());
        effect.setFloat('uShadowOn', 1);
      } else {
        effect.setTexture('sunDepthSampler', depth.getDepthMap());
        effect.setMatrix('uSunViewProj', Matrix.IdentityReadOnly);
        effect.setMatrix('uSunView', Matrix.IdentityReadOnly);
        effect.setFloat('uShadowOn', 0);
      }
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
      effect.setFloat('uSteps', this.enabled ? this.steps : 0);
      effect.setFloat('uFrame', this.frame % 64);
      effect.setFloat('uShaft', this.enabled ? p.shaftDensity : 0);
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
