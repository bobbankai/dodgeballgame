import {
  Color3, CreateSphere, Mesh, ShaderMaterial, Vector2, Vector3, type Scene, Constants,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from './ShaderLib';

/**
 * Procedural sky dome: gradient atmosphere, sun disc and halo, the Eternal Eclipse (a black moon
 * with a streaming corona), fbm cloud layer lit from the sun, stars and lightning flashes. The same
 * sky is captured into the environment cube for image-based lighting, so reflections and ambient
 * light always match what the player sees.
 */
export interface SkyParams {
  zenith: Color3;
  horizon: Color3;
  ground: Color3;
  /** Exponent of the horizon-to-zenith gradient (higher = thinner horizon band). */
  gradient: number;
  sunColor: Color3;
  /** Angular radius in radians. */
  sunSize: number;
  sunIntensity: number;
  /** 0 = sun, 1 = sun fully eclipsed (corona only). */
  eclipse: number;
  coronaColor: Color3;
  cloudCover: number;
  cloudDensity: number;
  cloudColor: Color3;
  cloudShadow: Color3;
  cloudScale: number;
  cloudSpeed: number;
  stars: number;
  /** Additive horizon glow (fires on the horizon, city glow). */
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
  cloudDensity: 0.8,
  cloudColor: new Color3(1, 1, 1),
  cloudShadow: new Color3(0.35, 0.37, 0.42),
  cloudScale: 1,
  cloudSpeed: 0.01,
  stars: 0,
  horizonGlow: new Color3(0, 0, 0),
  exposure: 1,
};

const UNIFORMS = [
  'world', 'viewProjection', 'uZenith', 'uHorizon', 'uGround', 'uGradient', 'uSunDir', 'uSunColor', 'uSunSize',
  'uSunIntensity', 'uEclipse', 'uCorona', 'uCloudCover', 'uCloudDensity', 'uCloudColor', 'uCloudShadow',
  'uCloudScale', 'uCloudOffset', 'uStars', 'uFlash', 'uHorizonGlow', 'uExposure', 'uTime',
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
  gl_Position = p.xyww; // depth at the far plane
}`;

const FRAG_GLSL = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCorona, uCloudColor, uCloudShadow, uHorizonGlow;
uniform float uGradient, uSunSize, uSunIntensity, uEclipse, uCloudCover, uCloudDensity, uCloudScale, uStars, uFlash, uExposure, uTime;
uniform vec2 uCloudOffset;
#include<ecNoise>
void main(void) {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uGradient));
  col = mix(col, uGround, smoothstep(0.0, -0.25, h));
  float mu = dot(d, uSunDir);
  float ang = acos(clamp(mu, -1.0, 1.0));
  // atmospheric halo around the sun (Mie forward scattering), weakened while eclipsed
  float halo = pow(max(mu, 0.0), 6.0) * 0.25 + pow(max(mu, 0.0), 64.0) * 0.6;
  col += uSunColor * halo * (1.0 - 0.75 * uEclipse);
  col += uHorizonGlow * exp(-abs(h) * 9.0);
  // sun disc
  float disc = smoothstep(uSunSize * 1.04, uSunSize * 0.96, ang);
  vec3 sun = uSunColor * uSunIntensity * disc * (1.0 - uEclipse);
  // eclipse: black moon slightly offset, a corona with streamers made from angular noise
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
  // clouds: a curved layer above the camera
  vec3 cloud = vec3(0.0); float cover = 0.0;
  if (h > -0.02 && uCloudCover > 0.0) {
    vec2 uv = d.xz / (h + 0.18) * 0.6 * uCloudScale + uCloudOffset;
    float n = ec_fbm2(uv * 1.3);
    float n2 = ec_fbm2(uv * 3.1 + 7.0);
    float shape = n * 0.75 + n2 * 0.25;
    cover = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.32, shape) * uCloudDensity;
    cover *= smoothstep(-0.02, 0.12, h);
    // light the cloud: brighter on the sun side, silver lining near the sun
    float thick = smoothstep(0.3, 1.0, cover);
    float lit = 0.5 + 0.5 * max(dot(normalize(vec3(d.x, 0.35, d.z)), uSunDir), 0.0);
    vec3 cc = mix(uCloudColor, uCloudShadow, thick * 0.85) * (0.55 + 0.6 * lit);
    cc += uSunColor * pow(max(mu, 0.0), 12.0) * (1.0 - thick) * 1.4 * (1.0 - 0.7 * uEclipse);
    cloud = cc;
  }
  col = mix(col, cloud, clamp(cover, 0.0, 1.0));
  sun *= 1.0 - clamp(cover * 1.3, 0.0, 1.0);
  // stars above the horizon, hidden by clouds
  if (uStars > 0.0 && h > 0.0) {
    vec3 sd = d * 220.0;
    vec3 cell = floor(sd);
    float s = ec_hash13(cell);
    float tw = 0.6 + 0.4 * sin(uTime * (1.5 + s * 3.0) + s * 40.0);
    float star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sd) - 0.5)) * tw;
    col += vec3(0.85, 0.9, 1.0) * star * uStars * 3.0 * (1.0 - cover) * smoothstep(0.0, 0.2, h);
  }
  col += vec3(0.7, 0.8, 1.0) * uFlash * (0.4 + cover * 1.6);
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
uniform uZenith: vec3f; uniform uHorizon: vec3f; uniform uGround: vec3f; uniform uSunDir: vec3f; uniform uSunColor: vec3f;
uniform uCorona: vec3f; uniform uCloudColor: vec3f; uniform uCloudShadow: vec3f; uniform uHorizonGlow: vec3f;
uniform uGradient: f32; uniform uSunSize: f32; uniform uSunIntensity: f32; uniform uEclipse: f32; uniform uCloudCover: f32;
uniform uCloudDensity: f32; uniform uCloudScale: f32; uniform uStars: f32; uniform uFlash: f32; uniform uExposure: f32; uniform uTime: f32;
uniform uCloudOffset: vec2f;
#include<ecNoise>
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
  var cloud = vec3f(0.0);
  var cover = 0.0;
  if (h > -0.02 && uniforms.uCloudCover > 0.0) {
    let uv = d.xz / (h + 0.18) * 0.6 * uniforms.uCloudScale + uniforms.uCloudOffset;
    let n = ec_fbm2(uv * 1.3);
    let n2 = ec_fbm2(uv * 3.1 + 7.0);
    let shape = n * 0.75 + n2 * 0.25;
    cover = smoothstep(1.0 - uniforms.uCloudCover, 1.0 - uniforms.uCloudCover + 0.32, shape) * uniforms.uCloudDensity;
    cover *= smoothstep(-0.02, 0.12, h);
    let thick = smoothstep(0.3, 1.0, cover);
    let lit = 0.5 + 0.5 * max(dot(normalize(vec3f(d.x, 0.35, d.z)), uniforms.uSunDir), 0.0);
    var cc = mix(uniforms.uCloudColor, uniforms.uCloudShadow, thick * 0.85) * (0.55 + 0.6 * lit);
    cc += uniforms.uSunColor * pow(max(mu, 0.0), 12.0) * (1.0 - thick) * 1.4 * (1.0 - 0.7 * uniforms.uEclipse);
    cloud = cc;
  }
  col = mix(col, cloud, clamp(cover, 0.0, 1.0));
  sun *= 1.0 - clamp(cover * 1.3, 0.0, 1.0);
  if (uniforms.uStars > 0.0 && h > 0.0) {
    let sd = d * 220.0;
    let cell = floor(sd);
    let s = ec_hash13(cell);
    let tw = 0.6 + 0.4 * sin(uniforms.uTime * (1.5 + s * 3.0) + s * 40.0);
    let star = step(0.9965, s) * smoothstep(0.5, 0.0, length(fract(sd) - 0.5)) * tw;
    col += vec3f(0.85, 0.9, 1.0) * star * uniforms.uStars * 3.0 * (1.0 - cover) * smoothstep(0.0, 0.2, h);
  }
  col += vec3f(0.7, 0.8, 1.0) * uniforms.uFlash * (0.4 + cover * 1.6);
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
  private cloudOffset = { x: 0, y: 0 };
  private windDir = { x: 1, y: 0.3 };
  private offsetVec = new Vector2(0, 0);

  constructor(scene: Scene, params: Partial<SkyParams> = {}) {
    this.params = { ...DEFAULT_SKY, ...params };
    this.material = new ShaderMaterial('sky', scene, { vertex: 'ecSky', fragment: 'ecSky' }, {
      attributes: ['position'],
      uniforms: UNIFORMS,
      shaderLanguage: shaderLanguage(scene.getEngine()),
    });
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
    this.mesh.doNotSyncBoundingInfo = true;
    // The sky is drawn first and at the far plane; scale keeps it inside the frustum's far distance.
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
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose();
  }
}
