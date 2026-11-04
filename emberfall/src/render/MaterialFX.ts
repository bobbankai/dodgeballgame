// Shader features injected into three's PBR materials (MeshStandard / MeshPhysical), so every surface
// keeps the full physically based lighting, CSM shadows and IBL while gaining:
//   skin      wrapped, red-shifted subsurface diffuse + thin back-scatter (ears, fingers)
//   wind      tree / grass / cloth sway with gusts and leaf flutter
//   wet       rain wetness: darker albedo, lower roughness, puddles with animated ripples on flats
//   snow      snow accumulation on up-facing surfaces (with noise breakup, roughness and normal flattening)
//   dissolve  enemy death: burning edge eats the mesh in world-space noise
//   hit       hit flash
//   pulse     pulsing emissive (the Hollow's cracks, lava veins)
//   detail    secondary detail normal map at high tiling for close-up micro-surface
//   rim       subtle character rim light so silhouettes read against dark backdrops
//   foliage   leaf cards: canopy normals kept on both sides, wrapped diffuse + light transmitted through
//             the leaves when backlit, alpha kept stable under minification (no vanishing distant crowns)
import * as THREE from 'three';

/** global uniforms shared by every patched material */
export const G = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector4(1, 0, 0.5, 0) }, // dir.xz, strength, gust
  uWetness: { value: 0 },
  uRain: { value: 0 },
  uSnow: { value: 0 },
  uPlayerPos: { value: new THREE.Vector3(0, -999, 0) },
  uRimColor: { value: new THREE.Color(0.6, 0.65, 0.8) },
};

export interface FXOptions {
  skin?: { wrap?: THREE.Vector3; trans?: number };
  wind?: { mode: 'tree' | 'grass' | 'cloth' | 'leaves'; amount?: number; height?: number };
  wet?: boolean;
  snow?: number;
  dissolve?: boolean;
  hit?: boolean;
  pulse?: { speed: number; min: number };
  detail?: { map: THREE.Texture; scale: number; strength: number };
  rim?: number;
  /** Kajiya-Kay strand shading for hair cards (tangent from the strand UV direction) */
  hair?: { shift?: number; tint?: THREE.Color };
  /** glowing fissures (object space, follows skinning): colour + density */
  cracks?: { color: THREE.Color; scale: number; width?: number; /** world space (static props) instead of bind-pose object space */ world?: boolean; /** world space: the cracks fade out above this height (lava-lit ground) */ below?: number };
  /** break up tiling: a second, rotated lookup blended in by world noise (albedo, normal, roughness) plus
   * large-scale tonal variation; value = strength of the macro variation */
  antiTile?: number;
  /** thin translucent leaves (see header) */
  foliage?: { trans?: number; tint?: THREE.Color };
}

export interface FXUniforms {
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uHit: { value: number };
  uHitColor: { value: THREE.Color };
}

type Hook = (shader: THREE.WebGLProgramParametersWithUniforms) => void;

const NOISE = /* glsl */ `
float fxHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float fxNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash(i), fxHash(i + vec3(1,0,0)), f.x), mix(fxHash(i + vec3(0,1,0)), fxHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(fxHash(i + vec3(0,0,1)), fxHash(i + vec3(1,0,1)), f.x), mix(fxHash(i + vec3(0,1,1)), fxHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fxFbm(vec3 p) { return fxNoise(p) * 0.5 + fxNoise(p * 2.07 + 3.1) * 0.3 + fxNoise(p * 4.3 + 7.7) * 0.2; }
`;

/** vertex wind (shared with the shadow depth material so shadows sway with the leaves) */
const WIND_VS = /* glsl */ `
#if defined(FX_WIND_TREE) || defined(FX_WIND_GRASS) || defined(FX_WIND_CLOTH) || defined(FX_WIND_LEAVES)
{
  mat4 fxM = modelMatrix;
  #ifdef USE_INSTANCING
  fxM = modelMatrix * instanceMatrix;
  #endif
  vec3 wpos = (fxM * vec4(transformed, 1.0)).xyz;
  vec3 origin = (fxM * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // offsets in world metres from the object's origin (positions may be quantized by gltfpack, so
  // object space is not metres)
  vec3 lp = wpos - origin;
  float h = max(lp.y, 0.0) / uWindHeight;
  vec2 wdir = normalize(uWind.xy + 1e-4);
  float gust = uWind.z * (0.65 + 0.35 * sin(uTime * 0.6 + dot(origin.xz, vec2(0.05, 0.03)))) + uWind.w;
  float phase = dot(origin.xz, vec2(0.13, 0.17));
  vec3 off = vec3(0.0);
  #if defined(FX_WIND_TREE) || defined(FX_WIND_LEAVES)
    float sway = (sin(uTime * 0.9 + phase) * 0.6 + sin(uTime * 1.7 + phase * 1.3) * 0.25 + 0.7) * gust;
    off.xz += wdir * sway * h * h * 0.35;
    // branches: outer wood and leaves bob and swing on their own, faster than the trunk
    float br = min(length(lp.xz), 4.0);
    float bph = phase + dot(lp.xz, vec2(0.7, 0.9));
    float bs = (sin(uTime * 2.1 + bph) * 0.5 + sin(uTime * 3.4 + bph * 1.7) * 0.2) * gust;
    off.y += bs * br * 0.03;
    off.xz += wdir * bs * br * 0.02;
    #ifdef FX_WIND_LEAVES
      float fl = fxNoise(wpos * 1.7 + vec3(uTime * 2.2)) - 0.5;
      off += vec3(fl, fl * 0.6, -fl) * 0.07 * gust * smoothstep(0.15, 0.6, h);
    #endif
  #elif defined(FX_WIND_GRASS)
    float sway = sin(uTime * 2.3 + phase * 3.0 + wpos.x * 0.4) * 0.5 + 0.6;
    off.xz += wdir * sway * gust * h * h * 0.6;
    // the player pushes grass aside
    vec3 toP = wpos - uPlayerPos;
    float pd = length(toP.xz);
    off.xz += normalize(toP.xz + 1e-4) * smoothstep(1.1, 0.0, pd) * h * 0.55;
    off.y -= smoothstep(1.1, 0.0, pd) * h * 0.3;
  #elif defined(FX_WIND_CLOTH)
    float wav = sin(uTime * 3.1 + wpos.y * 2.0 + phase) * 0.5 + sin(uTime * 5.3 + wpos.x * 3.0) * 0.25;
    off.xz += wdir * (0.6 + wav) * gust * h * 0.15;
  #endif
  off *= uWindAmount;
  mat3 fxR = mat3(fxM);
  transformed += inverse(fxR) * off;
}
#endif`;

export function featureKey(o: FXOptions): string {
  return [
    o.skin ? 's' : '', o.wind ? 'w' + o.wind.mode : '', o.wet ? 'r' : '', o.snow ? 'n' : '', o.dissolve ? 'd' : '',
    o.hit ? 'h' : '', o.pulse ? 'p' : '', o.detail ? 'x' : '', o.rim ? 'm' : '', o.cracks ? (o.cracks.world ? 'K' : 'k') : '', o.hair ? 'y' : '', o.foliage ? 'f' : '', o.antiTile ? 't' : '',
  ].join('');
}

/** Patch a material. `csmHook` is the hook CSM.setupMaterial installed (chained first). */
export function applyFX(mat: THREE.Material, o: FXOptions, csmHook?: Hook): FXUniforms {
  const m = mat as THREE.MeshStandardMaterial;
  const fx: FXUniforms = (m.userData.fx as FXUniforms) ?? {
    uDissolve: { value: 0 }, uDissolveColor: { value: new THREE.Color(4.0, 1.4, 0.35) },
    uHit: { value: 0 }, uHitColor: { value: new THREE.Color(1.0, 0.85, 0.7) },
  };
  m.userData.fx = fx;
  m.userData.fxOptions = o;
  const key = featureKey(o);
  m.defines = m.defines ?? {};
  if (o.skin) m.defines.FX_SKIN = '';
  if (o.wind) m.defines['FX_WIND_' + o.wind.mode.toUpperCase()] = '';
  if (o.wet) m.defines.FX_WET = '';
  if (o.snow) m.defines.FX_SNOW = '';
  if (o.dissolve) m.defines.FX_DISSOLVE = '';
  if (o.hit) m.defines.FX_HIT = '';
  if (o.pulse) m.defines.FX_PULSE = '';
  if (o.detail) m.defines.FX_DETAIL = '';
  if (o.rim) m.defines.FX_RIM = '';
  if (o.cracks) m.defines.FX_CRACKS = '';
  if (o.cracks?.world) m.defines.FX_CRACKS_WORLD = '';
  if (o.hair) m.defines.FX_HAIR = '';
  if (o.foliage) m.defines.FX_FOLIAGE = '';
  if (o.antiTile) m.defines.FX_ANTITILE = '';
  const needsWorld = !!(o.wind || o.wet || o.snow || o.dissolve || o.pulse || o.rim || o.cracks?.world || o.antiTile);
  if (needsWorld) m.defines.FX_WORLD = '';

  m.onBeforeCompile = (shader) => {
    csmHook?.(shader);
    Object.assign(shader.uniforms, G);
    shader.uniforms.uDissolve = fx.uDissolve;
    shader.uniforms.uDissolveColor = fx.uDissolveColor;
    shader.uniforms.uHit = fx.uHit;
    shader.uniforms.uHitColor = fx.uHitColor;
    shader.uniforms.uSkinWrap = { value: o.skin?.wrap ?? new THREE.Vector3(0.55, 0.26, 0.16) };
    shader.uniforms.uSkinTrans = { value: o.skin?.trans ?? 0.35 };
    shader.uniforms.uWindAmount = { value: o.wind?.amount ?? 1 };
    shader.uniforms.uWindHeight = { value: o.wind?.height ?? 8 };
    shader.uniforms.uSnowAmount = { value: o.snow ?? 0 };
    shader.uniforms.uPulse = { value: new THREE.Vector2(o.pulse?.speed ?? 1, o.pulse?.min ?? 0.5) };
    shader.uniforms.uRim = { value: o.rim ?? 0 };
    shader.uniforms.uCrackColor = { value: o.cracks?.color ?? new THREE.Color(0, 0, 0) };
    shader.uniforms.uHairShift = { value: o.hair?.shift ?? 0.1 };
    shader.uniforms.uHairTint = { value: o.hair?.tint ?? new THREE.Color(1, 0.85, 0.7) };
    shader.uniforms.uCrack = { value: new THREE.Vector2(o.cracks?.scale ?? 8, o.cracks?.width ?? 0.06) };
    shader.uniforms.uCrackBelow = { value: o.cracks?.below ?? 1e5 };
    shader.uniforms.uFolTrans = { value: o.foliage?.trans ?? 1 };
    shader.uniforms.uMacro = { value: o.antiTile ?? 0 };
    shader.uniforms.uFolTint = { value: o.foliage?.tint ?? new THREE.Color(1.0, 0.95, 0.55) };
    if (o.detail) {
      shader.uniforms.uDetailMap = { value: o.detail.map };
      shader.uniforms.uDetail = { value: new THREE.Vector2(o.detail.scale, o.detail.strength) };
    }
    const uniDecl = /* glsl */ `
uniform float uTime, uWetness, uRain, uSnow, uDissolve, uHit, uSkinTrans, uWindAmount, uWindHeight, uSnowAmount, uRim;
uniform vec4 uWind;
uniform vec3 uPlayerPos, uDissolveColor, uHitColor, uSkinWrap, uRimColor;
uniform vec2 uPulse;
#ifdef FX_DETAIL
uniform sampler2D uDetailMap; uniform vec2 uDetail;
#endif
#ifdef FX_WORLD
varying vec3 vFxWorldPos;
varying vec3 vFxWorldNormal;
#endif
#ifdef FX_CRACKS
uniform vec3 uCrackColor; uniform vec2 uCrack; uniform float uCrackBelow;
varying vec3 vFxObjPos;
#endif
#ifdef FX_HAIR
varying vec3 vHairFlow;
uniform float uHairShift; uniform vec3 uHairTint;
vec3 fxHairT = vec3(0.0, 1.0, 0.0);
float fxHairNoise = 1.0;
vec3 fxHairCol = vec3(1.0);
#endif
#ifdef FX_SKIN
float fxCurv = 0.0;
#endif
#ifdef FX_FOLIAGE
uniform float uFolTrans; uniform vec3 uFolTint;
#endif
#ifdef FX_ANTITILE
uniform float uMacro;
float fxAT = 0.0;
vec2 fxATuv = vec2(0.0);
const mat2 fxATrot = mat2(0.4536, -0.8912, 0.8912, 0.4536); // ~63 degrees
#endif
${NOISE}`;

    // ---------------- vertex ----------------
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', '#include <common>\n' + uniDecl);
    vs = vs.replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
#ifdef FX_CRACKS
vFxObjPos = position;
#endif
#ifdef FX_HAIR
// combed-back hair flows from the hairline over the crown and down the back of the head
vHairFlow = normalize((modelViewMatrix * vec4(0.0, -0.45, -1.0, 0.0)).xyz);
#endif
${WIND_VS}`);
    if (needsWorld) {
      vs = vs.replace('#include <project_vertex>', /* glsl */ `#include <project_vertex>
{
  vec4 fxW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  fxW = instanceMatrix * fxW;
  #endif
  vFxWorldPos = (modelMatrix * fxW).xyz;
  vec3 fxN = objectNormal;
  #ifdef USE_INSTANCING
  fxN = mat3(instanceMatrix) * fxN;
  #endif
  vFxWorldNormal = normalize(mat3(modelMatrix) * fxN);
}`);
    }
    shader.vertexShader = vs;

    // ---------------- fragment ----------------
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <common>', '#include <common>\n' + uniDecl);
    fs = fs.replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
#ifdef FX_DISSOLVE
float fxDis = fxFbm(vFxWorldPos * 3.5) * 0.85 + fxNoise(vFxWorldPos * 18.0) * 0.15;
if (fxDis < uDissolve) discard;
float fxEdge = 1.0 - smoothstep(0.0, 0.06, fxDis - uDissolve);
#endif`);
    fs = fs.replace('#include <map_fragment>', /* glsl */ `
#if defined(FX_ANTITILE) && defined(USE_MAP)
{
  // two lookups of the same set: the second rotated, scaled and offset; a world-space noise picks between
  // them in soft patches, so no feature repeats on a grid. The blend keeps the texture's contrast by
  // favouring whichever sample dominates (height-blend style) instead of a flat 50/50 average.
  fxATuv = fxATrot * vMapUv * 0.87 + vec2(0.413, 0.271);
  float nz = fxNoise(vFxWorldPos * 0.42) * 0.7 + fxNoise(vFxWorldPos * 1.3) * 0.3;
  fxAT = smoothstep(0.38, 0.62, nz);
  vec4 tA = texture2D(map, vMapUv);
  vec4 tB = texture2D(map, fxATuv);
  vec4 sampledDiffuseColor = mix(tA, tB, fxAT);
  diffuseColor *= sampledDiffuseColor;
  // large-scale tonal variation (weathering, damp, sun-bleach)
  float macro = fxNoise(vFxWorldPos * 0.07) * 0.6 + fxNoise(vFxWorldPos * 0.21 + 5.0) * 0.4;
  diffuseColor.rgb *= 1.0 + (macro - 0.5) * uMacro;
}
#else
#include <map_fragment>
#endif
#if defined(FX_FOLIAGE) && defined(USE_MAP)
{
  // mip levels average alpha towards transparent and distant crowns dissolve: scale it back up per mip
  vec2 fxTs = vec2(textureSize(map, 0));
  vec2 fdx = dFdx(vMapUv * fxTs), fdy = dFdy(vMapUv * fxTs);
  float fxLod = max(0.0, 0.5 * log2(max(dot(fdx, fdx), dot(fdy, fdy))));
  diffuseColor.a *= 1.0 + fxLod * 0.28;
}
#endif
#ifdef FX_WORLD
float fxUp = normalize(vFxWorldNormal).y;
#endif
#ifdef FX_SNOW
float fxSnowN = fxFbm(vFxWorldPos * 0.9);
float fxSnowMask = smoothstep(0.45, 0.8, fxUp + (fxSnowN - 0.5) * 0.5) * clamp(uSnow * uSnowAmount, 0.0, 1.0);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96) * (0.92 + fxSnowN * 0.1), fxSnowMask);
#endif
#ifdef FX_WET
float fxPuddleN = fxFbm(vec3(vFxWorldPos.xz * 0.22, 1.7));
float fxPuddle = smoothstep(0.52, 0.6, fxPuddleN) * smoothstep(0.92, 0.98, fxUp) * smoothstep(0.35, 0.8, uWetness);
float fxWet = clamp(uWetness * (0.55 + 0.45 * fxUp), 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, 0.55, fxWet * 0.8) * mix(1.0, 0.7, fxPuddle);
#endif`);
    fs = fs.replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
#if defined(FX_ANTITILE) && defined(USE_ROUGHNESSMAP)
roughnessFactor = mix(roughnessFactor, roughness * texture2D(roughnessMap, fxATuv).g, fxAT);
#endif
#ifdef FX_WET
roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, fxWet);
roughnessFactor = mix(roughnessFactor, 0.035, fxPuddle);
#endif
#ifdef FX_SNOW
roughnessFactor = mix(roughnessFactor, 0.62, fxSnowMask);
#endif`);
    fs = fs.replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
#if defined(FX_ANTITILE) && defined(USE_NORMALMAP_TANGENTSPACE)
{
  // the second lookup's normal, rotated back into the surface's tangent frame
  vec3 nB = texture2D(normalMap, fxATuv).xyz * 2.0 - 1.0;
  nB.xy = transpose(fxATrot) * nB.xy * normalScale;
  vec3 nWB = normalize(tbn * nB);
  normal = normalize(mix(normal, nWB, fxAT));
}
#endif
#if defined(FX_FOLIAGE) && defined(DOUBLE_SIDED)
// canopy normals describe the crown, not the card: both faces of a leaf use them
normal *= faceDirection;
#endif
#ifdef FX_HAIR
{
  // strand direction: the screen-space gradient of the card's V coordinate
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  #ifdef USE_MAP
  vec2 duvx = dFdx(vMapUv), duvy = dFdy(vMapUv);
  #else
  vec2 duvx = vec2(1.0, 0.0), duvy = vec2(0.0, 1.0);
  #endif
  vec3 t = vHairFlow - normal * dot(normal, vHairFlow);
  fxHairT = length(t) > 1e-4 ? normalize(t) : normalize(dpx);
  #ifdef USE_MAP
  fxHairNoise = 0.6 + 0.8 * fract(sin(dot(floor(vMapUv * vec2(220.0, 12.0)), vec2(12.9898, 78.233))) * 43758.5453);
  #endif
  fxHairCol = diffuseColor.rgb;
}
#endif
#ifdef FX_SKIN
{
  // curvature: how fast the normal turns per unit of surface (ears, nose, lips scatter more)
  vec3 dn = fwidth(normal);
  vec3 dp = fwidth(vViewPosition);
  fxCurv = clamp(length(dn) / max(length(dp), 1e-5) * 0.012, 0.0, 1.0);
}
#endif
#if defined(FX_DETAIL) && defined(USE_NORMALMAP_TANGENTSPACE)
{
  vec3 dn = texture2D(uDetailMap, vNormalMapUv * uDetail.x).xyz * 2.0 - 1.0;
  dn.xy *= uDetail.y;
  normal = normalize(normal + tbn * vec3(dn.xy, 0.0));
}
#endif
#ifdef FX_SNOW
normal = normalize(mix(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz, fxSnowMask * 0.6));
#endif
#ifdef FX_WET
{
  // puddles: flat mirror with rain ripples
  vec3 upV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec2 rp = vFxWorldPos.xz * 2.2;
  vec2 rippleN = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 cell = floor(rp + float(k) * 0.37);
    vec2 f = fract(rp + float(k) * 0.37) - 0.5;
    float rnd = fxHash(vec3(cell, float(k)));
    float t = fract(uTime * 0.9 + rnd);
    vec2 c = (vec2(fxHash(vec3(cell, 3.0 + float(k))), fxHash(vec3(cell, 7.0 + float(k)))) - 0.5) * 0.5;
    vec2 d = f - c;
    float r = length(d);
    float ring = sin((r - t * 0.5) * 60.0) * smoothstep(0.08, 0.0, abs(r - t * 0.5)) * (1.0 - t);
    rippleN += normalize(d + 1e-4) * ring;
  }
  vec3 rippleW = normalize(vec3(rippleN.x * 0.35 * uRain, 1.0, rippleN.y * 0.35 * uRain));
  vec3 rippleV = (viewMatrix * vec4(rippleW, 0.0)).xyz;
  normal = normalize(mix(normal, rippleV, fxPuddle));
  normal = normalize(mix(normal, normalize(normal + (rippleV - upV) * uRain), fxWet * smoothstep(0.7, 0.95, fxUp) * 0.6));
}
#endif`);
    fs = fs.replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
#ifdef FX_PULSE
totalEmissiveRadiance *= uPulse.y + (1.0 - uPulse.y) * (0.5 + 0.5 * sin(uTime * uPulse.x + dot(vFxWorldPos, vec3(1.3, 2.1, 0.7))));
#endif
#ifdef FX_DISSOLVE
totalEmissiveRadiance += uDissolveColor * fxEdge * step(0.001, uDissolve) * 3.0;
diffuseColor.rgb *= 1.0 - fxEdge * step(0.001, uDissolve) * 0.85;
#endif
#ifdef FX_HIT
totalEmissiveRadiance += uHitColor * uHit * 2.5;
#endif
#ifdef FX_SNOW
{
  // snow crystals: tiny facets catch the light and twinkle as the view changes
  vec3 sc = floor(vFxWorldPos * 38.0);
  float tw = fxHash(sc + floor(cameraPosition * 2.5));
  float facing = pow(saturate(dot(normal, normalize(vViewPosition))), 2.0);
  totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * smoothstep(0.993, 1.0, tw) * fxSnowMask * facing * 3.0;
}
#endif
#ifdef FX_CRACKS
{
  // distorted voronoi edges in bind-pose object space (world space for static props)
  #ifdef FX_CRACKS_WORLD
  vec3 crP = vFxWorldPos;
  #else
  vec3 crP = vFxObjPos;
  #endif
  vec3 q = crP * uCrack.x + vec3(fxNoise(crP * 3.0) * 0.6);
  vec3 ip = floor(q), fp = fract(q);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = vec3(fxHash(ip + g), fxHash(ip + g + 17.3), fxHash(ip + g + 41.7));
    vec3 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float crack = 1.0 - smoothstep(0.0, uCrack.y, edge);
  float flick = 0.7 + 0.3 * sin(uTime * 2.3 + crP.y * 7.0) * sin(uTime * 1.3 + crP.x * 5.0);
  #ifdef FX_CRACKS_WORLD
  // smouldering char: embers breathe slowly and only in patches
  flick *= smoothstep(0.55, 0.85, fxNoise(crP * 0.55 + vec3(0.0, uTime * 0.05, 0.0))) * (0.6 + 0.4 * sin(uTime * 0.8 + crP.x));
  flick *= smoothstep(uCrackBelow + 5.0, uCrackBelow, crP.y);
  #endif
  totalEmissiveRadiance += uCrackColor * crack * flick;
  diffuseColor.rgb *= 1.0 - crack * 0.6;
}
#endif`);
    if (o.foliage) {
      // leaves are mostly matte: the broad IBL lobe of the canopy normals reads as grey sheen
      fs = fs.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.indirectSpecular *= 0.3;');
    }
    if (o.rim) {
      fs = fs.replace('#include <lights_fragment_end>', /* glsl */ `#include <lights_fragment_end>
{
  float nv = saturate(dot(normal, normalize(vViewPosition)));
  float rim = pow(1.0 - nv, 4.0) * uRim;
  reflectedLight.directDiffuse += uRimColor * rim * diffuseColor.rgb * 2.0;
}`);
    }
    if (o.skin || o.hair || o.foliage) {
      fs = fs.replace('#include <lights_physical_pars_fragment>', skinChunk());
    }
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'fx' + key + (csmHook ? 'c' : '');
  m.needsUpdate = true;
  return fx;
}

function skinChunk(): string {
  const src = THREE.ShaderChunk.lights_physical_pars_fragment;
  const diffuse = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  const spec = 'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;';
  if (!src.includes(diffuse) || !src.includes(spec)) {
    console.warn('skin shader hook not found: three changed RE_Direct_Physical');
    return src;
  }
  return src.replace(spec, /* glsl */ `
  #if defined(FX_SKIN)
  {
    // two-lobe skin specular: a tight oily lobe plus a broad one (pores, peach fuzz)
    PhysicalMaterial m2 = material;
    m2.roughness = min(1.0, material.roughness * 1.8 + 0.1);
    vec3 spec2 = BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, m2 );
    reflectedLight.directSpecular += irradiance * mix(specularBRDF, spec2, 0.38) * material.multiScatteringCompensation;
  }
  #elif defined(FX_HAIR)
  {
    // Kajiya-Kay with Marschner-style shifted lobes
    vec3 T = fxHairT;
    vec3 L = directLight.direction;
    vec3 V = geometryViewDir;
    vec3 H = normalize(L + V);
    vec3 t1 = normalize(T + geometryNormal * (uHairShift - 0.08));
    vec3 t2 = normalize(T + geometryNormal * (uHairShift + 0.16));
    float th1 = dot(t1, H), th2 = dot(t2, H);
    float s1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), 220.0) * smoothstep(-1.0, 0.0, th1);
    float s2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), 48.0) * smoothstep(-1.0, 0.0, th2);
    float nl = saturate(dot(geometryNormal, L) * 0.5 + 0.5);
    vec3 hs = (vec3(0.07) * s1 * fxHairNoise + uHairTint * (fxHairCol + 0.04) * 0.9 * s2 * fxHairNoise) * nl;
    reflectedLight.directSpecular += directLight.color * hs;
  }
  #elif defined(FX_FOLIAGE)
  reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation * 0.55;
  #else
  ${spec}
  #endif`).replace(diffuse, /* glsl */ `
  #if defined(FX_SKIN)
  {
    // wrapped diffuse with a wider wrap for red: light bleeds past the terminator like skin.
    // Curvature widens the wrap (pre-integrated skin, approximated).
    float nlRaw = dot( geometryNormal, directLight.direction );
    vec3 w = uSkinWrap * (0.7 + fxCurv * 0.9);
    vec3 sssNL = saturate( ( vec3( nlRaw ) + w ) / ( 1.0 + w ) ) / ( 1.0 + w * 0.5 );
    // thin back-scatter: light through ears / fingers when backlit
    vec3 bl = -directLight.direction + geometryNormal * 0.35;
    float back = pow( saturate( dot( geometryViewDir, normalize( bl ) ) ), 6.0 ) * uSkinTrans * (0.5 + fxCurv);
    vec3 sss = sssNL + back * vec3( 1.0, 0.32, 0.18 );
    reflectedLight.directDiffuse += sss * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  }
  #elif defined(FX_HAIR)
  {
    float nlw = saturate( ( dot( geometryNormal, directLight.direction ) + 0.4 ) / 1.4 );
    reflectedLight.directDiffuse += nlw * directLight.color * BRDF_Lambert( material.diffuseContribution );
  }
  #elif defined(FX_FOLIAGE)
  {
    // leaves: soft wrapped diffuse over the canopy volume plus light transmitted through thin blades,
    // strongest looking into the sun (the bright rim of a backlit crown)
    float nlRaw = dot( geometryNormal, directLight.direction );
    float wrapNL = saturate( ( nlRaw + 0.5 ) / 1.5 );
    float into = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 4.0 );
    float thru = ( saturate( -nlRaw ) * 0.35 + into * 1.1 ) * uFolTrans;
    reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( wrapNL + thru * uFolTint * 1.6 );
  }
  #else
  ${diffuse}
  #endif`);
}

/** shadow-casting depth material for an alpha-tested, wind-blown material (assign to mesh.customDepthMaterial) */
export function windDepthMaterial(src: THREE.MeshStandardMaterial, o: FXOptions): THREE.MeshDepthMaterial {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: src.map, alphaTest: src.alphaTest, side: src.side });
  d.defines = {};
  if (o.wind) d.defines['FX_WIND_' + o.wind.mode.toUpperCase()] = '';
  d.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, G);
    shader.uniforms.uWindAmount = { value: o.wind?.amount ?? 1 };
    shader.uniforms.uWindHeight = { value: o.wind?.height ?? 8 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime, uWindAmount, uWindHeight;
uniform vec4 uWind;
uniform vec3 uPlayerPos;
${NOISE}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VS);
  };
  d.customProgramCacheKey = () => 'wdepth' + featureKey(o);
  return d;
}

/** Set the hit flash / dissolve on every patched material of an object */
export function setFX(root: THREE.Object3D, key: 'uHit' | 'uDissolve', v: number): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const fx = m.userData.fx as FXUniforms | undefined;
      if (fx) fx[key].value = v;
    }
  });
}
