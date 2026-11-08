import {
  Color3, CreateSphere, Mesh, ShaderMaterial, Vector2, Vector3, type Scene, Constants,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from './ShaderLib';
import { sharedNoise3D } from './Noise';

/**
 * Sky dome: gradient atmosphere with sun halo, the Eternal Eclipse (black moon with a streaming
 * corona), stars and lightning flashes, and **ray-marched volumetric clouds**: a cloud slab shaped
 * by a coverage map and a height gradient, Perlin-Worley base noise eroded by Worley detail, lit by
 * a short light march towards the sun (Beer-Lambert + "powder" darkening) with a two-lobe
 * Henyey-Greenstein phase and an ambient term from the sky, then faded by aerial perspective.
 * When `cloudSteps` is 0 (low preset) a cheap 2D layer is drawn instead. The same sky is captured
 * into the environment cube, so ambient light and reflections match it.
 */
export interface SkyParams {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  gradient: number;
  sunColor: Color3;
  /** Angular radius in radians. */
  sunSize: number;
  sunIntensity: number;
  /** 0 = sun, 1 = fully eclipsed (corona only). */
  eclipse: number;
  coronaColor: Color3;
  cloudCover: number;
  cloudDensity: number;
  cloudColor: Color3;
  cloudShadow: Color3;
  cloudScale: number;
  /** Wind speed of the cloud layer in m/s. */
  cloudSpeed: number;
  /** Cloud slab, metres above the camera's ground. */
  cloudBottom: number;
  cloudTop: number;
  stars: number;
  horizonGlow: Color3;
  exposure: number;
}

export const DEFAULT_SKY: SkyParams = {
  zenith: new Color3(0.12, 0.2, 0.4),
  horizon: new Color3(0.6, 0.62, 0.66),
  ground: new Color3(0.18, 0.16, 0.15),
  gradient: 0.45,
  sunColor: new Color3(1.0, 0.9, 0.75),
  sunSize: 0.02,
  sunIntensity: 30,
  eclipse: 0,
  coronaColor: new Color3(1.0, 0.75, 0.45),
  cloudCover: 0.45,
  cloudDensity: 1,
  cloudColor: new Color3(1, 1, 1),
  cloudShadow: new Color3(0.35, 0.37, 0.42),
  cloudScale: 1,
  cloudSpeed: 12,
  cloudBottom: 1400,
  cloudTop: 3200,
  stars: 0,
  horizonGlow: new Color3(0, 0, 0),
  exposure: 1,
};

const UNIFORMS = [
  'world', 'viewProjection', 'uZenith', 'uHorizon', 'uGround', 'uGradient', 'uSunDir', 'uSunColor', 'uSunSize',
  'uSunIntensity', 'uEclipse', 'uCorona', 'uCloudCover', 'uCloudDensity', 'uCloudColor', 'uCloudShadow',
  'uCloudScale', 'uCloudOffset', 'uStars', 'uFlash', 'uHorizonGlow', 'uExposure', 'uTime', 'uCloudSteps',
  'uCloudBottom', 'uCloudTop', 'uCamY',
];

const VERT_GLSL = /* glsl */ `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main(void) {
  vec4 wp = world * vec4(position, 1.0);
  vDir = position;
  vec4 p = viewProjection * wp;
  gl_Position = p.xyww;
}`;

const FRAG_GLSL = /* glsl */ `
precision highp float;
precision highp sampler3D;
varying vec3 vDir;
uniform sampler3D noiseSampler;
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCorona, uCloudColor, uCloudShadow, uHorizonGlow;
uniform float uGradient, uSunSize, uSunIntensity, uEclipse, uCloudCover, uCloudDensity, uCloudScale, uStars, uFlash, uExposure, uTime;
uniform float uCloudSteps, uCloudBottom, uCloudTop, uCamY;
uniform vec2 uCloudOffset;
#include<ecNoise>
float hgp(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float cloudDensity(vec3 p, float detail) {
  float h = (p.y - uCloudBottom) / (uCloudTop - uCloudBottom);
  if (h <= 0.0 || h >= 1.0) return 0.0;
  vec3 q = p * uCloudScale + vec3(uCloudOffset.x, 0.0, uCloudOffset.y);
  float weather = texture(noiseSampler, vec3(q.xz * 0.000045, 0.37)).r;
  float cov = clamp((weather - (1.0 - uCloudCover)) / 0.3, 0.0, 1.0);
  float shape = smoothstep(0.0, 0.08, h) * smoothstep(1.0, 0.25 + 0.5 * weather, h);
  float base = texture(noiseSampler, q * 0.00021).b;
  float d = clamp((base - (1.0 - cov * shape)) * 3.0, 0.0, 1.0);
  if (d > 0.0 && detail > 0.5) {
    float det = texture(noiseSampler, q * 0.0013 + vec3(0.0, uTime * 0.004, 0.0)).g;
    d = clamp(d - (1.0 - det) * 0.45 * (1.0 - d), 0.0, 1.0);
  }
  return d * uCloudDensity;
}
vec4 marchClouds(vec3 dir, vec3 skyCol) {
  if (dir.y < 0.01) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = (uCloudBottom - uCamY) / dir.y;
  float t1 = min((uCloudTop - uCamY) / dir.y, t0 + 9000.0);
  float n = uCloudSteps;
  float dt = (t1 - t0) / n;
  float t = t0 + dt * ec_hash13(dir * 911.0 + uTime);
  float T = 1.0; vec3 L = vec3(0.0);
  float mu = dot(dir, uSunDir);
  float phase = mix(hgp(mu, 0.7), hgp(mu, -0.2), 0.35);
  vec3 sunC = uSunColor * (1.0 - 0.85 * uEclipse);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= n || T < 0.02) break;
    vec3 p = vec3(0.0, uCamY, 0.0) + dir * t;
    float d = cloudDensity(p, 1.0);
    if (d > 0.002) {
      float od = 0.0;
      for (int j = 0; j < 4; j++) od += cloudDensity(p + uSunDir * (80.0 + 220.0 * float(j)), 0.0) * 220.0;
      float beer = exp(-od * 0.006);
      float powder = 1.0 - exp(-d * 6.0);
      float h = (p.y - uCloudBottom) / (uCloudTop - uCloudBottom);
      vec3 S = sunC * beer * mix(0.5, 1.0, powder) * phase * 10.0 + mix(uCloudShadow, uCloudColor, h) * skyCol * 1.4;
      float a = 1.0 - exp(-d * 0.008 * dt);
      L += T * a * S;
      T *= 1.0 - a;
    }
    t += dt;
  }
  float fade = exp(-t0 * 0.00008);
  return vec4(L * fade + skyCol * (1.0 - T) * (1.0 - fade), mix(1.0, T, fade * 0.9 + 0.1));
}
void main(void) {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uGradient));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float mu = dot(d, uSunDir);
  float ang = acos(clamp(mu, -1.0, 1.0));
  float halo = pow(max(mu, 0.0), 6.0) * 0.25 + pow(max(mu, 0.0), 64.0) * 0.6;
  col += uSunColor * halo * (1.0 - 0.75 * uEclipse);
  col += uHorizonGlow * exp(-abs(h) * 9.0);
  float disc = smoothstep(uSunSize * 1.04, uSunSize * 0.96, ang);
  vec3 sun = uSunColor * uSunIntensity * disc * (1.0 - uEclipse);
  if (uEclipse > 0.0) {
    vec3 up = abs(uSunDir.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 tx = normalize(cross(up, uSunDir));
    vec3 ty = cross(uSunDir, tx);
    vec2 pl = vec2(dot(d, tx), dot(d, ty));
    float polar = atan(pl.y, pl.x);
    float r = ang / uSunSize;
    float streak = 0.55 + 0.45 * ec_fbm2(vec2(polar * 3.0, uTime * 0.05)) + 0.35 * ec_noise2(vec2(polar * 11.0, uTime * 0.11));
    float corona = exp(-max(r - 1.0, 0.0) * (2.2 / streak)) * smoothstep(0.97, 1.03, r);
    float ring = exp(-pow((r - 1.02) * 18.0, 2.0)) * 3.0;
    vec3 cor = uCorona * (corona * 4.0 + ring) * uEclipse;
    float moon = smoothstep(1.0, 0.985, r);
    sun = mix(sun, vec3(0.0), moon * uEclipse) + cor * (1.0 - moon);
    col = mix(col, col * 0.15, moon * uEclipse);
  }
  if (uStars > 0.0 && h > 0.0) {
    vec3 sd = d * 220.0;
    vec3 cell = floor(sd);
    float s = ec_hash13(cell);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 3.0) + s * 40.0);
    float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sd) - 0.5)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * 3.0 * smoothstep(0.0, 0.2, h);
  }
  vec3 skyCol = col;
  if (uCloudSteps > 0.5) {
    vec4 cl = marchClouds(d, mix(uHorizon, uZenith, 0.5));
    col = col * cl.a + cl.rgb;
    sun *= cl.a;
  } else if (h > -0.02 && uCloudCover > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 0.6 + uCloudOffset * 0.0003;
    float n = ec_fbm2(uv * 1.3) * 0.75 + ec_fbm2(uv * 3.1 + 7.0) * 0.25;
    float cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, n) * uCloudDensity * smoothstep(-0.02, 0.12, h);
    float thick = smoothstep(0.3, 1.0, cover);
    float lit = 0.5 + 0.5 * max(dot(normalize(vec3(d.x, 0.35, d.z)), uSunDir), 0.0);
    vec3 cc = mix(uCloudColor, uCloudShadow, thick * 0.85) * (0.55 + 0.6 * lit) * skyCol * 1.6;
    cc += uSunColor * pow(max(mu, 0.0), 12.0) * (1.0 - thick) * 1.4 * (1.0 - 0.7 * uEclipse);
    col = mix(col, cc, clamp(cover, 0.0, 1.0));
    sun *= 1.0 - clamp(cover * 1.3, 0.0, 1.0);
  }
  col += vec3(0.7, 0.8, 1.0) * uFlash * 1.2;
  gl_FragColor = vec4((col + sun) * uExposure, 1.0);
}`;

const VERT_WGSL = /* wgsl */ `
attribute position: vec3f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vDir = vertexInputs.position;
  let p = uniforms.viewProjection * wp;
  vertexOutputs.position = vec4f(p.x, p.y, p.w, p.w);
}`;

const FRAG_WGSL = /* wgsl */ `
varying vDir: vec3f;
var noiseSamplerSampler: sampler;
var noiseSampler: texture_3d<f32>;
uniform uZenith: vec3f; uniform uHorizon: vec3f; uniform uGround: vec3f; uniform uSunDir: vec3f; uniform uSunColor: vec3f;
uniform uCorona: vec3f; uniform uCloudColor: vec3f; uniform uCloudShadow: vec3f; uniform uHorizonGlow: vec3f;
uniform uGradient: f32; uniform uSunSize: f32; uniform uSunIntensity: f32; uniform uEclipse: f32; uniform uCloudCover: f32;
uniform uCloudDensity: f32; uniform uCloudScale: f32; uniform uStars: f32; uniform uFlash: f32; uniform uExposure: f32; uniform uTime: f32;
uniform uCloudSteps: f32; uniform uCloudBottom: f32; uniform uCloudTop: f32; uniform uCamY: f32;
uniform uCloudOffset: vec2f;
#include<ecNoise>
fn hgp(c: f32, g: f32) -> f32 { let g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
fn nz(p: vec3f) -> vec4f { return textureSampleLevel(noiseSampler, noiseSamplerSampler, p, 0.0); }
fn cloudDensity(p: vec3f, detail: f32) -> f32 {
  let h = (p.y - uniforms.uCloudBottom) / (uniforms.uCloudTop - uniforms.uCloudBottom);
  if (h <= 0.0 || h >= 1.0) { return 0.0; }
  let q = p * uniforms.uCloudScale + vec3f(uniforms.uCloudOffset.x, 0.0, uniforms.uCloudOffset.y);
  let weather = nz(vec3f(q.xz * 0.000045, 0.37)).r;
  let cov = clamp((weather - (1.0 - uniforms.uCloudCover)) / 0.3, 0.0, 1.0);
  let shape = smoothstep(0.0, 0.08, h) * smoothstep(1.0, 0.25 + 0.5 * weather, h);
  let base = nz(q * 0.00021).b;
  var d = clamp((base - (1.0 - cov * shape)) * 3.0, 0.0, 1.0);
  if (d > 0.0 && detail > 0.5) {
    let det = nz(q * 0.0013 + vec3f(0.0, uniforms.uTime * 0.004, 0.0)).g;
    d = clamp(d - (1.0 - det) * 0.45 * (1.0 - d), 0.0, 1.0);
  }
  return d * uniforms.uCloudDensity;
}
fn marchClouds(dir: vec3f, skyCol: vec3f) -> vec4f {
  if (dir.y < 0.01) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let t0 = (uniforms.uCloudBottom - uniforms.uCamY) / dir.y;
  let t1 = min((uniforms.uCloudTop - uniforms.uCamY) / dir.y, t0 + 9000.0);
  let n = uniforms.uCloudSteps;
  let dt = (t1 - t0) / n;
  var t = t0 + dt * ec_hash13(dir * 911.0 + uniforms.uTime);
  var T = 1.0;
  var L = vec3f(0.0);
  let mu = dot(dir, uniforms.uSunDir);
  let phase = mix(hgp(mu, 0.7), hgp(mu, -0.2), 0.35);
  let sunC = uniforms.uSunColor * (1.0 - 0.85 * uniforms.uEclipse);
  for (var i = 0; i < 64; i++) {
    if (f32(i) >= n || T < 0.02) { break; }
    let p = vec3f(0.0, uniforms.uCamY, 0.0) + dir * t;
    let d = cloudDensity(p, 1.0);
    if (d > 0.002) {
      var od = 0.0;
      for (var j = 0; j < 4; j++) { od += cloudDensity(p + uniforms.uSunDir * (80.0 + 220.0 * f32(j)), 0.0) * 220.0; }
      let beer = exp(-od * 0.006);
      let powder = 1.0 - exp(-d * 6.0);
      let h = (p.y - uniforms.uCloudBottom) / (uniforms.uCloudTop - uniforms.uCloudBottom);
      let S = sunC * beer * mix(0.5, 1.0, powder) * phase * 10.0 + mix(uniforms.uCloudShadow, uniforms.uCloudColor, h) * skyCol * 1.4;
      let a = 1.0 - exp(-d * 0.008 * dt);
      L += T * a * S;
      T *= 1.0 - a;
    }
    t += dt;
  }
  let fade = exp(-t0 * 0.00008);
  return vec4f(L * fade + skyCol * (1.0 - T) * (1.0 - fade), mix(1.0, T, fade * 0.9 + 0.1));
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let d = normalize(input.vDir);
  let h = d.y;
  var col = mix(uniforms.uHorizon, uniforms.uZenith, pow(clamp(h, 0.0, 1.0), uniforms.uGradient));
  col = mix(col, uniforms.uGround, smoothstep(0.0, -0.25, h));
  let mu = dot(d, uniforms.uSunDir);
  let ang = acos(clamp(mu, -1.0, 1.0));
  let halo = pow(max(mu, 0.0), 6.0) * 0.25 + pow(max(mu, 0.0), 64.0) * 0.6;
  col += uniforms.uSunColor * halo * (1.0 - 0.75 * uniforms.uEclipse);
  col += uniforms.uHorizonGlow * exp(-abs(h) * 9.0);
  let disc = smoothstep(uniforms.uSunSize * 1.04, uniforms.uSunSize * 0.96, ang);
  var sun = uniforms.uSunColor * uniforms.uSunIntensity * disc * (1.0 - uniforms.uEclipse);
  if (uniforms.uEclipse > 0.0) {
    var up = vec3f(0.0, 1.0, 0.0);
    if (abs(uniforms.uSunDir.y) > 0.9) { up = vec3f(1.0, 0.0, 0.0); }
    let tx = normalize(cross(up, uniforms.uSunDir));
    let ty = cross(uniforms.uSunDir, tx);
    let pl = vec2f(dot(d, tx), dot(d, ty));
    let polar = atan2(pl.y, pl.x);
    let r = ang / uniforms.uSunSize;
    let streak = 0.55 + 0.45 * ec_fbm2(vec2f(polar * 3.0, uniforms.uTime * 0.05)) + 0.35 * ec_noise2(vec2f(polar * 11.0, uniforms.uTime * 0.11));
    let corona = exp(-max(r - 1.0, 0.0) * (2.2 / streak)) * smoothstep(0.97, 1.03, r);
    let ring = exp(-pow((r - 1.02) * 18.0, 2.0)) * 3.0;
    let cor = uniforms.uCorona * (corona * 4.0 + ring) * uniforms.uEclipse;
    let moon = smoothstep(1.0, 0.985, r);
    sun = mix(sun, vec3f(0.0), moon * uniforms.uEclipse) + cor * (1.0 - moon);
    col = mix(col, col * 0.15, moon * uniforms.uEclipse);
  }
  if (uniforms.uStars > 0.0 && h > 0.0) {
    let sd = d * 220.0;
    let cell = floor(sd);
    let s = ec_hash13(cell);
    let tw = 0.6 + 0.4 * sin(uniforms.uTime * (1.5 + s * 3.0) + s * 40.0);
    let star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sd) - 0.5)) * tw;
    col += vec3f(0.85, 0.9, 1.0) * star * uniforms.uStars * 3.0 * smoothstep(0.0, 0.2, h);
  }
  let skyCol = col;
  if (uniforms.uCloudSteps > 0.5) {
    let cl = marchClouds(d, mix(uniforms.uHorizon, uniforms.uZenith, 0.5));
    col = col * cl.a + cl.rgb;
    sun *= cl.a;
  } else if (h > -0.02 && uniforms.uCloudCover > 0.0) {
    let uv = d.xz / (h + 0.18) * 0.6 + uniforms.uCloudOffset * 0.0003;
    let n = ec_fbm2(uv * 1.3) * 0.75 + ec_fbm2(uv * 3.1 + 7.0) * 0.25;
    let cover = smoothstep(1.0 - uniforms.uCloudCover, 1.0 - uniforms.uCloudCover + 0.32, n) * uniforms.uCloudDensity * smoothstep(-0.02, 0.12, h);
    let thick = smoothstep(0.3, 1.0, cover);
    let lit = 0.5 + 0.5 * max(dot(normalize(vec3f(d.x, 0.35, d.z)), uniforms.uSunDir), 0.0);
    var cc = mix(uniforms.uCloudColor, uniforms.uCloudShadow, thick * 0.85) * (0.55 + 0.6 * lit) * skyCol * 1.6;
    cc += uniforms.uSunColor * pow(max(mu, 0.0), 12.0) * (1.0 - thick) * 1.4 * (1.0 - 0.7 * uniforms.uEclipse);
    col = mix(col, cc, clamp(cover, 0.0, 1.0));
    sun *= 1.0 - clamp(cover * 1.3, 0.0, 1.0);
  }
  col += vec3f(0.7, 0.8, 1.0) * uniforms.uFlash * 1.2;
  fragmentOutputs.color = vec4f((col + sun) * uniforms.uExposure, 1.0);
}`;

registerShader({ name: 'ecSky', glsl: { vertex: VERT_GLSL, fragment: FRAG_GLSL }, wgsl: { vertex: VERT_WGSL, fragment: FRAG_WGSL } });

export class Sky {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  params: SkyParams;
  sunDir = new Vector3(0.3, 0.6, 0.4).normalize();
  /** Lightning flash brightness, decays automatically. */
  flash = 0;
  /** Ray-march steps for volumetric clouds (0 = 2D cloud layer). Set by quality. */
  cloudSteps = 24;
  /** Camera height, so the cloud slab sits above the player wherever the level is. */
  camY = 0;
  private cloudOffset = { x: 0, y: 0 };
  private windDir = { x: 1, y: 0.3 };
  private offsetVec = new Vector2(0, 0);

  constructor(scene: Scene, params: Partial<SkyParams> = {}) {
    this.params = { ...DEFAULT_SKY, ...params };
    this.material = new ShaderMaterial('sky', scene, { vertex: 'ecSky', fragment: 'ecSky' }, {
      attributes: ['position'],
      uniforms: UNIFORMS,
      samplers: ['noiseSampler'],
      shaderLanguage: shaderLanguage(scene.getEngine()),
    });
    this.material.setTexture('noiseSampler', sharedNoise3D(scene));
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.depthFunction = Constants.LEQUAL;
    this.mesh = CreateSphere('skyDome', { diameter: 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.material = this.material;
    this.mesh.infiniteDistance = true;
    this.mesh.isPickable = false;
    this.mesh.applyFog = false;
    this.mesh.renderingGroupId = 0;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { noDepth: true };
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.scaling.setAll(1000);
    this.apply(0);
  }

  set(params: Partial<SkyParams>): void {
    Object.assign(this.params, params);
  }

  setWind(x: number, z: number): void {
    const l = Math.hypot(x, z) || 1;
    this.windDir = { x: x / l, y: z / l };
  }

  update(dt: number, time: number): void {
    this.cloudOffset.x += this.windDir.x * this.params.cloudSpeed * dt;
    this.cloudOffset.y += this.windDir.y * this.params.cloudSpeed * dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    this.apply(time);
  }

  /** Fewer steps while capturing the environment cube (six faces). */
  withSteps<T>(steps: number, fn: () => T): T {
    const prev = this.cloudSteps;
    this.cloudSteps = steps;
    this.apply(0);
    try {
      return fn();
    } finally {
      this.cloudSteps = prev;
    }
  }

  private apply(time: number): void {
    const p = this.params;
    const m = this.material;
    m.setColor3('uZenith', p.zenith);
    m.setColor3('uHorizon', p.horizon);
    m.setColor3('uGround', p.ground);
    m.setFloat('uGradient', p.gradient);
    m.setVector3('uSunDir', this.sunDir);
    m.setColor3('uSunColor', p.sunColor);
    m.setFloat('uSunSize', p.sunSize);
    m.setFloat('uSunIntensity', p.sunIntensity);
    m.setFloat('uEclipse', p.eclipse);
    m.setColor3('uCorona', p.coronaColor);
    m.setFloat('uCloudCover', p.cloudCover);
    m.setFloat('uCloudDensity', p.cloudDensity);
    m.setColor3('uCloudColor', p.cloudColor);
    m.setColor3('uCloudShadow', p.cloudShadow);
    m.setFloat('uCloudScale', p.cloudScale);
    this.offsetVec.set(this.cloudOffset.x, this.cloudOffset.y);
    m.setVector2('uCloudOffset', this.offsetVec);
    m.setFloat('uStars', p.stars);
    m.setFloat('uFlash', this.flash);
    m.setColor3('uHorizonGlow', p.horizonGlow);
    m.setFloat('uExposure', p.exposure);
    m.setFloat('uTime', time);
    m.setFloat('uCloudSteps', this.cloudSteps);
    m.setFloat('uCloudBottom', p.cloudBottom);
    m.setFloat('uCloudTop', p.cloudTop);
    m.setFloat('uCamY', this.camY);
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
