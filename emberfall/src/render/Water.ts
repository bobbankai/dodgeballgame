// Moving water: streams, pools and waterfalls built as ribbons along a path. The surface is three's PBR
// (sky IBL reflections, sun glints, CSM shadows) with:
//   - two layers of flowing noise normals advected along the stream (per-vertex flow direction),
//   - Fresnel opacity: you see the stream bed looking down, the sky at grazing angles,
//   - foam on the banks, on rapids (steep flow) and where a waterfall lands,
//   - a deep / shallow colour gradient across the channel.
import * as THREE from 'three';
import { G } from './MaterialFX';
import type { Pipeline } from './Pipeline';
import type { PlanarMirror } from './Mirror';

export interface WaterOptions {
  deep?: THREE.Color;
  shallow?: THREE.Color;
  /** flow speed m/s */
  speed?: number;
  /** noise frequency (1/m) */
  scale?: number;
  /** wave normal strength */
  strength?: number;
  /** bank foam width (fraction of the channel) */
  bankFoam?: number;
  /** extra foam everywhere (rapids, waterfall) */
  foam?: number;
  /** opacity looking straight down / at grazing angles */
  alpha?: [number, number];
  /** vertical sheet (waterfall): flow is down the ribbon */
  fall?: boolean;
  /** planar reflection to sample (large flat water) */
  mirror?: PlanarMirror;
}

/**
 * a ribbon along points (centre line) with per-point widths; uv.x = across (0..1), uv.y = along (metres);
 * attribute `flow` = the local downstream direction (world xyz)
 */
export function ribbon(points: THREE.Vector3[], widths: number[] | number, up = new THREE.Vector3(0, 1, 0), steps = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = Math.max(2, Math.round(curve.getLength() / 1.0));
  const pts = curve.getSpacedPoints(n);
  const pos: number[] = [], uv: number[] = [], flow: number[] = [], idx: number[] = [];
  let along = 0;
  const wAt = (t: number) => {
    if (typeof widths === 'number') return widths;
    const f = t * (widths.length - 1);
    const i = Math.min(widths.length - 2, Math.floor(f));
    return THREE.MathUtils.lerp(widths[i], widths[i + 1], f - i);
  };
  for (let i = 0; i <= n; i++) {
    const p = pts[i];
    const t = i / n;
    const tan = curve.getTangentAt(Math.min(t, 0.999)).normalize();
    const side = new THREE.Vector3().crossVectors(tan, up);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    if (i > 0) along += p.distanceTo(pts[i - 1]);
    const w = wAt(t);
    for (let j = 0; j <= steps; j++) {
      const s = j / steps - 0.5;
      pos.push(p.x + side.x * s * w, p.y + side.y * s * w, p.z + side.z * s * w);
      uv.push(j / steps, along);
      flow.push(tan.x, tan.y, tan.z);
    }
  }
  const row = steps + 1;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < steps; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the ribbon is wound so its normal faces `up`; flip if not
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  if (nrm.getY(0) * up.y + nrm.getX(0) * up.x + nrm.getZ(0) * up.z < 0) {
    for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    g.setIndex(idx);
    g.computeVertexNormals();
  }
  return g;
}

export function waterMaterial(pipe: Pipeline, o: WaterOptions = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.035, metalness: 0, transparent: true, depthWrite: true });
  m.name = 'water';
  const hook = pipe.lighting.setupMaterial(m);
  const U = {
    uDeep: { value: o.deep ?? new THREE.Color(0.012, 0.045, 0.05) },
    uShallow: { value: o.shallow ?? new THREE.Color(0.07, 0.15, 0.13) },
    uSpeed: { value: o.speed ?? 1.2 },
    uScale: { value: o.scale ?? 0.9 },
    uStrength: { value: o.strength ?? 0.35 },
    uBankFoam: { value: o.bankFoam ?? 0.1 },
    uFoam: { value: o.foam ?? 0 },
    uAlpha: { value: new THREE.Vector2(...(o.alpha ?? [0.72, 0.97])) },
    uMirror: { value: o.mirror?.target.texture ?? null },
    uMirrorM: { value: o.mirror?.textureMatrix ?? new THREE.Matrix4() },
  };
  m.userData.water = U;
  m.defines = { WATER_FALL: o.fall ? 1 : 0, WATER_MIRROR: o.mirror && pipe.quality.planarReflection > 0 ? 1 : 0 };
  m.onBeforeCompile = (sh) => {
    hook(sh);
    Object.assign(sh.uniforms, U, { uTime: G.uTime, uRain: G.uRain, uPlayerPos: G.uPlayerPos });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 flow;
varying vec3 vWFlow;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec2 vWUv;
#if WATER_MIRROR
uniform mat4 uMirrorM;
varying vec4 vMirrorUv;
#endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
#if WATER_MIRROR
vMirrorUv = uMirrorM * modelMatrix * vec4(transformed, 1.0);
#endif
vWFlow = normalize(mat3(modelMatrix) * flow);
vWNrm = normalize(mat3(modelMatrix) * objectNormal);
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uDeep, uShallow;
uniform float uSpeed, uScale, uStrength, uBankFoam, uFoam, uTime, uRain;
uniform vec3 uPlayerPos;
uniform vec2 uAlpha;
varying vec3 vWFlow;
varying vec3 vWPos;
varying vec3 vWNrm;
varying vec2 vWUv;
#if WATER_MIRROR
uniform sampler2D uMirror;
varying vec4 vMirrorUv;
#endif
float wHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
}
float wFbm(vec2 p) { return wNoise(p) * 0.55 + wNoise(p * 2.13 + 1.7) * 0.3 + wNoise(p * 4.37 + 3.1) * 0.15; }
// flow-space coordinates: (across, along) in metres, advected downstream; two phases cross-faded so the
// pattern never stretches (classic flow-map trick with a constant direction per vertex)
float wHeight(vec2 q, float t) {
  float ph0 = fract(t * 0.25), ph1 = fract(t * 0.25 + 0.5);
  float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);
  float h0 = wFbm(q - vec2(0.0, ph0 * 4.0 * uSpeed) + 1.3);
  float h1 = wFbm(q - vec2(0.0, ph1 * 4.0 * uSpeed) + 7.9);
  return mix(h1, h0, w0);
}
float wFoamN = 0.0;
float wFresnel = 0.0;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  #if WATER_FALL
  vec2 q = vec2(vWUv.x * 6.0, vWUv.y * 1.2) * uScale;
  #else
  vec3 fl = normalize(vec3(vWFlow.x, 0.0, vWFlow.z) + 1e-5);
  vec3 ac = vec3(-fl.z, 0.0, fl.x);
  vec2 q = vec2(dot(vWPos, ac), dot(vWPos, fl)) * uScale;
  #endif
  float t = uTime;
  float e = 0.06;
  float h = wHeight(q, t);
  float hx = wHeight(q + vec2(e, 0.0), t) - h;
  float hy = wHeight(q + vec2(0.0, e), t) - h;
  // small fast ripples on top (and rain rings when it rains)
  vec2 q2 = q * 3.1 + vec2(0.0, -t * uSpeed * 2.2);
  float r = wNoise(q2), rx = wNoise(q2 + vec2(e * 2.0, 0.0)) - r, ry = wNoise(q2 + vec2(0.0, e * 2.0)) - r;
  vec2 grad = vec2(hx, hy) / e * uStrength + vec2(rx, ry) / (e * 2.0) * uStrength * (0.25 + uRain * 0.5);
  #if !WATER_FALL
  {
    // whoever wades leaves expanding rings and a short wake
    vec2 dp = vWPos.xz - uPlayerPos.xz;
    float pd = length(dp);
    float near = exp(-pd * 0.9) * step(abs(vWPos.y - uPlayerPos.y), 1.2);
    float ring = cos(pd * 11.0 - uTime * 7.0) * near;
    vec2 dir = dp / max(pd, 1e-3);
    grad += dir * ring * 0.55;
  }
  #endif
  #if WATER_FALL
  vec3 wN = normalize(vWNrm);
  vec3 wA = normalize(cross(vWFlow, wN));
  vec3 nW = normalize(wN - wA * grad.x - vWFlow * grad.y * 0.3);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  #else
  vec3 nW = normalize(vec3(0.0, 1.0, 0.0) - ac * grad.x - fl * grad.y);
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
  #endif
  // foam: banks, rapids, global amount; broken up by moving noise
  float across = min(vWUv.x, 1.0 - vWUv.x);
  float bank = smoothstep(uBankFoam, 0.0, across);
  float streak = wFbm(q * vec2(2.5, 0.7) - vec2(0.0, t * uSpeed * 1.5));
  float steep = smoothstep(0.15, 0.45, abs(vWFlow.y));
  #if WATER_FALL
  // falling water: long vertical streaks of white water racing down, ragged see-through edges
  vec2 qs = vec2(vWUv.x * 9.0, vWUv.y * 0.35 + t * uSpeed * 0.55);
  float st = wFbm(qs) * 0.65 + wFbm(qs * vec2(2.3, 1.7) + 4.0) * 0.35;
  float edge = smoothstep(0.0, 0.22, across + (wNoise(vec2(vWUv.y * 1.5 - t * 2.0, 3.0)) - 0.5) * 0.12);
  wFoamN = clamp(smoothstep(0.38, 0.72, st) * 0.95 + 0.15, 0.0, 1.0) * edge;
  #else
  // thin, broken foam lines rather than a white blanket
  float lines = smoothstep(0.62, 0.78, streak + bank * 0.35 + uFoam * 0.25);
  wFoamN = clamp((bank * 0.8 + steep * 0.7 + uFoam) * lines, 0.0, 0.9);
  #endif
  wFresnel = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 4.0);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float across = min(vWUv.x, 1.0 - vWUv.x) * 2.0;
  diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(0.0, 0.8, across));
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.6, wFoamN);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if WATER_MIRROR
{
  // planar reflection, broken up by the ripple normals, weighted by Fresnel; foam stays matte
  vec2 ruv = vMirrorUv.xy / vMirrorUv.w + normal.xy * 0.045;
  vec3 refl = texture2D(uMirror, clamp(ruv, 0.002, 0.998)).rgb;
  float nv = saturate(dot(normal, normalize(vViewPosition)));
  float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, refl * F, 1.0 - wFoamN);
}
#endif`)
      .replace('#include <lights_fragment_begin>', `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.86), wFoamN);
#if WATER_FALL
{
  float across2 = min(vWUv.x, 1.0 - vWUv.x);
  float edgeA = smoothstep(0.0, 0.2, across2 + (wNoise(vec2(vWUv.y * 1.5 - uTime * 2.0, 7.0)) - 0.5) * 0.14);
  diffuseColor.a = clamp(0.35 + wFoamN * 0.75, 0.0, 1.0) * edgeA;
}
#else
diffuseColor.a = clamp(mix(uAlpha.x, uAlpha.y, wFresnel) + wFoamN, 0.0, 1.0);
#endif
#include <lights_fragment_begin>`);
  };
  m.customProgramCacheKey = () => 'water' + (o.fall ? 'f' : 's') + (m.defines?.WATER_MIRROR ? 'm' : '');
  return m;
}

/** a stream / waterfall mesh added to the scene (no shadows cast; receives them) */
export function waterMesh(pipe: Pipeline, geo: THREE.BufferGeometry, o: WaterOptions = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, waterMaterial(pipe, o));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = 2;
  mesh.userData.noCollide = true;
  mesh.name = o.fall ? 'waterfall' : 'water';
  return mesh;
}
