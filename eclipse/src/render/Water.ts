import { Color3, Constants, Matrix, MeshBuilder, ShaderMaterial, Vector2, Vector3, Vector4, type Mesh, type Scene } from '@babylonjs/core';
import { NOISE_GLSL, NOISE_WGSL, registerShader, shaderLanguage } from './ShaderLib';
import type { Pipeline } from './Pipeline';

/*
 * Water surface. Rendered after the opaque scene (alpha blended, kept out of the depth pre-pass), it
 * reads the scene depth under each pixel to know how much water the eye looks through:
 *   - Beer-Lambert absorption from a shallow to a deep colour, and opacity, by that thickness;
 *   - foam where the water meets geometry (thin water), broken up by noise;
 *   - two scrolling layers of procedural ripple normals plus rain rings (expanding, fading rings in a
 *     jittered cell grid) when it rains;
 *   - Fresnel-weighted reflection of the environment cube (the captured sky) and a sharp sun glint;
 *   - gentle Gerstner swell in the vertex shader.
 */
const VERT_GLSL = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
uniform mat4 view;
uniform vec4 uWave; // amplitude, wavelength, speed, time
varying vec3 vPos;
varying float vViewZ;
vec3 gerstner(vec3 p, vec2 dir, float amp, float len, float spd, float t) {
  float k = 6.2831 / len;
  float f = k * (dot(dir, p.xz) - spd * t);
  return vec3(dir.x * amp * cos(f), amp * sin(f), dir.y * amp * cos(f));
}
void main(void) {
  vec4 wp = world * vec4(position, 1.0);
  float t = uWave.w;
  vec3 d = gerstner(wp.xyz, normalize(vec2(1.0, 0.3)), uWave.x, uWave.y, uWave.z, t)
         + gerstner(wp.xyz, normalize(vec2(-0.4, 1.0)), uWave.x * 0.6, uWave.y * 0.63, uWave.z * 0.8, t)
         + gerstner(wp.xyz, normalize(vec2(0.7, -0.8)), uWave.x * 0.35, uWave.y * 0.37, uWave.z * 1.2, t);
  wp.xyz += d;
  vPos = wp.xyz;
  vViewZ = abs((view * wp).z);
  gl_Position = viewProjection * wp;
}`;

const FRAG_GLSL = /* glsl */ `
precision highp float;
varying vec3 vPos;
varying float vViewZ;
uniform samplerCube envSampler;
uniform sampler2D depthSampler;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform vec4 uParams;  // absorption, foam, rain, envIntensity
uniform vec4 uParams2; // time, flow x, flow z, ripple scale
uniform vec2 uScreen;
${NOISE_GLSL}
float hgt(vec2 p, float t) {
  return ec_fbm2(p * 0.55 + vec2(t * 0.05, t * 0.03)) * 0.6 + ec_fbm2(p * 1.7 - vec2(t * 0.07, -t * 0.05)) * 0.4;
}
// rain: rings expanding from random points in a cell grid
float rain(vec2 p, float t) {
  float s = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (1.6 + float(k) * 0.9) + float(k) * 7.3;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = ec_hash12(cell + float(k) * 13.1);
    vec2 c = vec2(ec_hash12(cell + 3.1), ec_hash12(cell + 5.7)) - 0.5;
    float life = fract(t * (0.7 + 0.6 * h) + h);
    float r = length(f - c * 0.6);
    float ring = exp(-pow((r - life * 0.45) * 28.0, 2.0)) * (1.0 - life);
    s += ring;
  }
  return s;
}
void main(void) {
  float t = uParams2.x;
  vec2 p = vPos.xz * uParams2.w + uParams2.yz * t;
  float e = 0.08;
  float h0 = hgt(p, t);
  float hx = hgt(p + vec2(e, 0.0), t);
  float hz = hgt(p + vec2(0.0, e), t);
  vec3 n = normalize(vec3(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
  if (uParams.z > 0.0) {
    float r0 = rain(vPos.xz, t);
    float rx = rain(vPos.xz + vec2(0.02, 0.0), t);
    float rz = rain(vPos.xz + vec2(0.0, 0.02), t);
    n = normalize(n + vec3(-(rx - r0), 0.0, -(rz - r0)) * 2.5 * uParams.z);
  }
  vec3 v = normalize(uCam - vPos);
  float nv = clamp(dot(n, v), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 refl = textureCube(envSampler, reflect(-v, n)).rgb * uParams.w;
  vec3 hlf = normalize(v + uSunDir);
  float spec = pow(max(dot(n, hlf), 0.0), 900.0) * 6.0 + pow(max(dot(n, hlf), 0.0), 60.0) * 0.08;
  // how much water lies under this pixel
  vec2 suv = gl_FragCoord.xy / uScreen;
  float sceneZ = abs(texture2D(depthSampler, suv).r);
  float thick = sceneZ < 1e-4 ? 50.0 : max(0.0, sceneZ - vViewZ);
  float absorb = 1.0 - exp(-thick * uParams.x);
  vec3 body = mix(uShallow, uDeep, absorb);
  // light scattered in the water body from the sun
  body *= 0.35 + 0.65 * clamp(uSunDir.y, 0.0, 1.0) * uSunColor * 0.3;
  float foamN = ec_fbm2(vPos.xz * 3.0 + vec2(t * 0.3, 0.0));
  float foam = (1.0 - smoothstep(0.0, 0.35 * uParams.y, thick)) * smoothstep(0.35, 0.65, foamN);
  vec3 col = mix(body, refl, fres) + uSunColor * spec;
  col = mix(col, vec3(0.85, 0.9, 0.92) * (0.4 + 0.6 * clamp(uSunDir.y, 0.2, 1.0)), foam * 0.85);
  float alpha = clamp(max(absorb * 0.92 + 0.08, fres) + foam, 0.0, 1.0);
  // fade the edge where it meets the shore so there is no hard line
  alpha *= smoothstep(0.0, 0.06, thick);
  gl_FragColor = vec4(col, alpha);
}`;

const VERT_WGSL = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform uWave: vec4f;
varying vPos: vec3f;
varying vViewZ: f32;
fn gerstner(p: vec3f, dir: vec2f, amp: f32, len: f32, spd: f32, t: f32) -> vec3f {
  let k = 6.2831 / len;
  let f = k * (dot(dir, p.xz) - spd * t);
  return vec3f(dir.x * amp * cos(f), amp * sin(f), dir.y * amp * cos(f));
}
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  var wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
  let w = uniforms.uWave;
  let d = gerstner(wp.xyz, normalize(vec2f(1.0, 0.3)), w.x, w.y, w.z, w.w)
        + gerstner(wp.xyz, normalize(vec2f(-0.4, 1.0)), w.x * 0.6, w.y * 0.63, w.z * 0.8, w.w)
        + gerstner(wp.xyz, normalize(vec2f(0.7, -0.8)), w.x * 0.35, w.y * 0.37, w.z * 1.2, w.w);
  wp = vec4f(wp.xyz + d, 1.0);
  vertexOutputs.vPos = wp.xyz;
  vertexOutputs.vViewZ = abs((uniforms.view * wp).z);
  vertexOutputs.position = uniforms.viewProjection * wp;
}`;

const FRAG_WGSL = /* wgsl */ `
varying vPos: vec3f;
varying vViewZ: f32;
var envSamplerSampler: sampler;
var envSampler: texture_cube<f32>;
var depthSamplerSampler: sampler;
var depthSampler: texture_2d<f32>;
uniform uCam: vec3f;
uniform uSunDir: vec3f;
uniform uSunColor: vec3f;
uniform uShallow: vec3f;
uniform uDeep: vec3f;
uniform uParams: vec4f;
uniform uParams2: vec4f;
uniform uScreen: vec2f;
${NOISE_WGSL}
fn hgt(p: vec2f, t: f32) -> f32 {
  return ec_fbm2(p * 0.55 + vec2f(t * 0.05, t * 0.03)) * 0.6 + ec_fbm2(p * 1.7 - vec2f(t * 0.07, -t * 0.05)) * 0.4;
}
fn rain(p: vec2f, t: f32) -> f32 {
  var s = 0.0;
  for (var k = 0; k < 2; k++) {
    let fk = f32(k);
    let q = p * (1.6 + fk * 0.9) + fk * 7.3;
    let cell = floor(q);
    let f = fract(q) - 0.5;
    let h = ec_hash12(cell + fk * 13.1);
    let c = vec2f(ec_hash12(cell + 3.1), ec_hash12(cell + 5.7)) - 0.5;
    let life = fract(t * (0.7 + 0.6 * h) + h);
    let r = length(f - c * 0.6);
    s += exp(-pow((r - life * 0.45) * 28.0, 2.0)) * (1.0 - life);
  }
  return s;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let t = uniforms.uParams2.x;
  let vp = fragmentInputs.vPos;
  let p = vp.xz * uniforms.uParams2.w + uniforms.uParams2.yz * t;
  let e = 0.08;
  let h0 = hgt(p, t);
  let hx = hgt(p + vec2f(e, 0.0), t);
  let hz = hgt(p + vec2f(0.0, e), t);
  var n = normalize(vec3f(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
  if (uniforms.uParams.z > 0.0) {
    let r0 = rain(vp.xz, t);
    let rx = rain(vp.xz + vec2f(0.02, 0.0), t);
    let rz = rain(vp.xz + vec2f(0.0, 0.02), t);
    n = normalize(n + vec3f(-(rx - r0), 0.0, -(rz - r0)) * 2.5 * uniforms.uParams.z);
  }
  let v = normalize(uniforms.uCam - vp);
  let nv = clamp(dot(n, v), 0.0, 1.0);
  let fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let refl = textureSample(envSampler, envSamplerSampler, reflect(-v, n)).rgb * uniforms.uParams.w;
  let hlf = normalize(v + uniforms.uSunDir);
  let spec = pow(max(dot(n, hlf), 0.0), 900.0) * 6.0 + pow(max(dot(n, hlf), 0.0), 60.0) * 0.08;
  let suv = fragmentInputs.position.xy / uniforms.uScreen;
  let sceneZ = abs(textureSampleLevel(depthSampler, depthSamplerSampler, suv, 0.0).r);
  var thick = 50.0;
  if (sceneZ >= 1e-4) { thick = max(0.0, sceneZ - fragmentInputs.vViewZ); }
  let absorb = 1.0 - exp(-thick * uniforms.uParams.x);
  var body = mix(uniforms.uShallow, uniforms.uDeep, absorb);
  body *= 0.35 + 0.65 * clamp(uniforms.uSunDir.y, 0.0, 1.0) * uniforms.uSunColor * 0.3;
  let foamN = ec_fbm2(vp.xz * 3.0 + vec2f(t * 0.3, 0.0));
  let foam = (1.0 - smoothstep(0.0, 0.35 * uniforms.uParams.y, thick)) * smoothstep(0.35, 0.65, foamN);
  var col = mix(body, refl, fres) + uniforms.uSunColor * spec;
  col = mix(col, vec3f(0.85, 0.9, 0.92) * (0.4 + 0.6 * clamp(uniforms.uSunDir.y, 0.2, 1.0)), foam * 0.85);
  var alpha = clamp(max(absorb * 0.92 + 0.08, fres) + foam, 0.0, 1.0);
  alpha *= smoothstep(0.0, 0.06, thick);
  fragmentOutputs.color = vec4f(col, alpha);
}`;

registerShader({ name: 'ecWater', glsl: { vertex: VERT_GLSL, fragment: FRAG_GLSL }, wgsl: { vertex: VERT_WGSL, fragment: FRAG_WGSL } });

export interface WaterOptions {
  shallow?: Color3;
  deep?: Color3;
  /** 1/m: how quickly light is absorbed (murky water is high). */
  absorption?: number;
  /** Foam band width in metres. */
  foam?: number;
  /** Swell: amplitude (m), wavelength (m), speed (m/s). */
  wave?: [number, number, number];
  flow?: [number, number];
  rain?: number;
  envIntensity?: number;
}

/** A water plane (subdivided for the swell) at a height, covering a rectangle. */
export class Water {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private o: Required<WaterOptions>;
  private time = 0;
  rain = 0;

  constructor(private scene: Scene, private pipe: Pipeline, center: Vector3, size: [number, number], o: WaterOptions = {}) {
    this.o = {
      shallow: o.shallow ?? new Color3(0.12, 0.32, 0.3), deep: o.deep ?? new Color3(0.01, 0.05, 0.06),
      absorption: o.absorption ?? 0.45, foam: o.foam ?? 1, wave: o.wave ?? [0.06, 7, 1.2], flow: o.flow ?? [0.05, 0.02],
      rain: o.rain ?? 0, envIntensity: o.envIntensity ?? 1,
    };
    this.rain = this.o.rain;
    const sub = Math.min(256, Math.round(Math.max(size[0], size[1]) / 0.6));
    this.mesh = MeshBuilder.CreateGround('water', { width: size[0], height: size[1], subdivisions: sub }, scene);
    this.mesh.position.copyFrom(center);
    this.mesh.isPickable = false;
    this.material = new ShaderMaterial('water', scene, { vertex: 'ecWater', fragment: 'ecWater' }, {
      attributes: ['position'],
      uniforms: ['world', 'viewProjection', 'view', 'uWave', 'uCam', 'uSunDir', 'uSunColor', 'uShallow', 'uDeep', 'uParams', 'uParams2', 'uScreen'],
      samplers: ['envSampler', 'depthSampler'],
      needAlphaBlending: true,
      shaderLanguage: shaderLanguage(scene.getEngine()),
    });
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.material.backFaceCulling = false;
    this.mesh.material = this.material;
    this.mesh.receiveShadows = false;
  }

  /** Per rendered frame. */
  update(dt: number, sunDir: Vector3, sunColor: Color3): void {
    this.time += dt;
    const m = this.material;
    const scene = this.scene;
    const cam = scene.activeCamera!;
    const eng = scene.getEngine();
    if (scene.environmentTexture) m.setTexture('envSampler', scene.environmentTexture);
    m.setTexture('depthSampler', this.pipe.depth.getDepthMap());
    m.setMatrix('view', cam.getViewMatrix() ?? Matrix.Identity());
    m.setVector4('uWave', new Vector4(this.o.wave[0], this.o.wave[1], this.o.wave[2], this.time));
    m.setVector3('uCam', cam.globalPosition);
    m.setVector3('uSunDir', sunDir);
    m.setColor3('uSunColor', sunColor);
    m.setColor3('uShallow', this.o.shallow);
    m.setColor3('uDeep', this.o.deep);
    m.setVector4('uParams', new Vector4(this.o.absorption, this.o.foam, this.rain, this.o.envIntensity));
    m.setVector4('uParams2', new Vector4(this.time, this.o.flow[0], this.o.flow[1], 1));
    m.setVector2('uScreen', new Vector2(eng.getRenderWidth(), eng.getRenderHeight()));
  }

  /** Water height at a point (the swell, for buoyancy and wading). */
  heightAt(x: number, z: number): number {
    const [amp, len, spd] = this.o.wave;
    const t = this.time;
    const g = (dx: number, dz: number, a: number, l: number, s: number) => {
      const n = Math.hypot(dx, dz);
      return a * Math.sin((6.2831 / l) * ((dx * x + dz * z) / n - s * t));
    };
    return this.mesh.position.y + g(1, 0.3, amp, len, spd) + g(-0.4, 1, amp * 0.6, len * 0.63, spd * 0.8) + g(0.7, -0.8, amp * 0.35, len * 0.37, spd * 1.2);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
