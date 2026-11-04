// Terrain material: up to 4 PBR layers (colour / normal / ORM / height) blended by a splat source
// (vertex colour RGBA = layer weights) with height-based blending so stones poke through mud
// instead of cross-fading. Every layer is sampled at two scales and the pair is blended by distance
// (macro variation) which hides tiling; steep faces switch to triplanar projection so cliffs never
// stretch. Lighting, shadows and IBL are three's MeshStandardMaterial.
import * as THREE from 'three';
import { applyFX, FXOptions } from './MaterialFX';
import { texLoader } from '../core/Assets';

export interface TerrainLayer {
  name: string; // assets/tex/<name>_{c,n,orm,h}.webp
  scale: number; // metres per tile
  tint?: THREE.Color;
  roughness?: number; // multiplier
  /** parallax depth in metres (0 = flat) */
  depth?: number;
}

export function loadLayer(name: string): { c: THREE.Texture; n: THREE.Texture; orm: THREE.Texture; h: THREE.Texture } {
  const base = `assets/tex/${name}`;
  const c = texLoader.load(`${base}_c.webp`);
  c.colorSpace = THREE.SRGBColorSpace;
  const n = texLoader.load(`${base}_n.webp`);
  const orm = texLoader.load(`${base}_orm.webp`);
  const h = texLoader.load(`${base}_h.webp`);
  for (const t of [c, n, orm, h]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { c, n, orm, h };
}

export function terrainMaterial(layers: TerrainLayer[], fx: FXOptions = {}, csmHook?: (s: THREE.WebGLProgramParametersWithUniforms) => void, pomSteps = 10): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: false });
  const L = layers.slice(0, 4);
  while (L.length < 4) L.push(L[L.length - 1]);
  const tex = L.map((l) => loadLayer(l.name));
  mat.userData.terrain = true;
  const prev = applyFX(mat, fx, csmHook);
  void prev;
  const fxHook = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    fxHook.call(mat, shader, r);
    for (let i = 0; i < 4; i++) {
      shader.uniforms[`tC${i}`] = { value: tex[i].c };
      shader.uniforms[`tN${i}`] = { value: tex[i].n };
      shader.uniforms[`tO${i}`] = { value: tex[i].orm };
      shader.uniforms[`tH${i}`] = { value: tex[i].h };
    }
    shader.uniforms.uScales = { value: new THREE.Vector4(...L.map((l) => 1 / l.scale)) };
    shader.uniforms.uRough = { value: new THREE.Vector4(...L.map((l) => l.roughness ?? 1)) };
    shader.uniforms.uTints = { value: L.map((l) => l.tint ?? new THREE.Color(1, 1, 1)) };
    shader.uniforms.uDepth = { value: new THREE.Vector4(...L.map((l) => l.depth ?? 0.03)) };
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vTWorld;\nvarying vec3 vTNormal;');
    vs = vs.replace('#include <project_vertex>', '#include <project_vertex>\nvSplat = splat;\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', /* glsl */ `#include <common>
varying vec4 vSplat;
varying vec3 vTWorld;
varying vec3 vTNormal;
uniform sampler2D tC0, tC1, tC2, tC3, tN0, tN1, tN2, tN3, tO0, tO1, tO2, tO3, tH0, tH1, tH2, tH3;
uniform vec4 uScales, uRough, uDepth;
uniform vec3 uTints[4];
#define POM_STEPS ${pomSteps}
// parallax occlusion: march the height field along the view ray (world xz = texture uv / scale)
vec2 tPom(sampler2D th, float s, float depth, vec3 wp, vec3 V) {
  #if POM_STEPS > 0
  vec2 dir = -V.xz / max(V.y, 0.25) * depth;   // full-depth offset in metres
  float layer = 1.0 / float(POM_STEPS);
  float h = 1.0, prevH = 1.0, surf = texture2D(th, wp.xz * s).r, prevS = surf;
  vec2 off = vec2(0.0);
  for (int i = 0; i < POM_STEPS; i++) {
    if (h <= surf) break;
    prevH = h; prevS = surf;
    h -= layer;
    off = dir * (1.0 - h);
    surf = texture2D(th, (wp.xz + off) * s).r;
  }
  // refine between the last two samples
  float a = prevH - prevS, b = surf - h;
  float t = clamp(a / max(a + b, 1e-4), 0.0, 1.0);
  return dir * (1.0 - mix(prevH, h, t));
  #else
  return vec2(0.0);
  #endif
}
struct TSample { vec3 c; vec3 n; vec3 orm; float h; };
// sample a layer with planar (xz) projection at two scales blended by distance; triplanar on steep slopes
TSample tLayer(sampler2D tc, sampler2D tn, sampler2D to, sampler2D th, float s, vec3 wp, vec3 wn, float dist) {
  TSample r;
  float steep = smoothstep(0.55, 0.8, 1.0 - abs(wn.y));
  float macroK = smoothstep(14.0, 60.0, dist);
  vec2 uvA = wp.xz * s;
  vec2 uvB = wp.xz * s * 0.23 + 0.37;
  vec3 c = mix(texture2D(tc, uvA).rgb, texture2D(tc, uvB).rgb, macroK * 0.6);
  vec3 n = texture2D(tn, uvA).xyz * 2.0 - 1.0;
  vec3 o = mix(texture2D(to, uvA).rgb, texture2D(to, uvB).rgb, macroK * 0.6);
  float h = texture2D(th, uvA).r;
  // large-scale tonal variation (breaks repetition)
  float var = texture2D(tc, wp.xz * s * 0.031).g;
  c *= 0.82 + var * 0.36;
  if (steep > 0.01) {
    vec3 bw = pow(abs(wn), vec3(4.0)); bw /= dot(bw, vec3(1.0));
    vec3 cx = texture2D(tc, wp.zy * s).rgb, cz = texture2D(tc, wp.xy * s).rgb;
    vec3 ox = texture2D(to, wp.zy * s).rgb, oz = texture2D(to, wp.xy * s).rgb;
    vec3 ctri = cx * bw.x + c * bw.y + cz * bw.z;
    vec3 otri = ox * bw.x + o * bw.y + oz * bw.z;
    c = mix(c, ctri, steep);
    o = mix(o, otri, steep);
    n = mix(n, vec3(0.0, 0.0, 1.0), steep * 0.6);
  }
  r.c = c; r.n = n; r.orm = o; r.h = h;
  return r;
}`);
    fs = fs.replace('#include <map_fragment>', /* glsl */ `
float tDist = length(vTWorld - cameraPosition);
vec3 tWN = normalize(vTNormal);
vec3 tWP = vTWorld;
#if POM_STEPS > 0
{
  // parallax from the dominant layer, faded out with distance and on slopes
  float fade = (1.0 - smoothstep(6.0, 16.0, tDist)) * smoothstep(0.75, 0.9, tWN.y);
  if (fade > 0.01) {
    vec3 V = normalize(cameraPosition - vTWorld);
    vec4 sw = vSplat;
    vec2 off;
    if (sw.x >= sw.y && sw.x >= sw.z && sw.x >= sw.w) off = tPom(tH0, uScales.x, uDepth.x, vTWorld, V);
    else if (sw.y >= sw.z && sw.y >= sw.w) off = tPom(tH1, uScales.y, uDepth.y, vTWorld, V);
    else if (sw.z >= sw.w) off = tPom(tH2, uScales.z, uDepth.z, vTWorld, V);
    else off = tPom(tH3, uScales.w, uDepth.w, vTWorld, V);
    tWP.xz += off * fade;
  }
}
#endif
TSample s0 = tLayer(tC0, tN0, tO0, tH0, uScales.x, tWP, tWN, tDist);
TSample s1 = tLayer(tC1, tN1, tO1, tH1, uScales.y, tWP, tWN, tDist);
TSample s2 = tLayer(tC2, tN2, tO2, tH2, uScales.z, tWP, tWN, tDist);
TSample s3 = tLayer(tC3, tN3, tO3, tH3, uScales.w, tWP, tWN, tDist);
// height blend
vec4 w = max(vSplat, 0.0) + 1e-4;
vec4 hb = vec4(s0.h, s1.h, s2.h, s3.h) * 0.6 + w;
float hmax = max(max(hb.x, hb.y), max(hb.z, hb.w)) - 0.18;
vec4 bw = max(hb - hmax, 0.0) * step(0.002, w);
bw /= max(dot(bw, vec4(1.0)), 1e-4);
vec3 tCol = s0.c * uTints[0] * bw.x + s1.c * uTints[1] * bw.y + s2.c * uTints[2] * bw.z + s3.c * uTints[3] * bw.w;
vec3 tN = normalize(s0.n * bw.x + s1.n * bw.y + s2.n * bw.z + s3.n * bw.w);
vec3 tO = s0.orm * bw.x + s1.orm * bw.y + s2.orm * bw.z + s3.orm * bw.w;
float tR = dot(bw, uRough);
diffuseColor.rgb *= tCol;
`);
    fs = fs.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tO.g * tR;');
    fs = fs.replace('#include <metalnessmap_fragment>', 'float metalnessFactor = metalness * tO.b;');
    fs = fs.replace('#include <normal_fragment_maps>', /* glsl */ `
{
  // world-aligned tangent frame: texture u = +X, v = +Z (planar projection)
  vec3 tT = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 tB = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  tT = normalize(tT - normal * dot(normal, tT));
  tB = normalize(tB - normal * dot(normal, tB));
  normal = normalize(tT * tN.x + tB * tN.y + normal * max(tN.z, 0.2));
}`);
    fs = fs.replace('#include <aomap_fragment>', /* glsl */ `
{
  float ambientOcclusion = mix(1.0, tO.r, 0.9);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
}`);
    shader.fragmentShader = fs;
  };
  const key = mat.customProgramCacheKey();
  mat.customProgramCacheKey = () => 'terrain' + pomSteps + key;
  return mat;
}
