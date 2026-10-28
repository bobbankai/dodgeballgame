import * as THREE from 'three';
import { G, MAX_BLOOMS, MAX_ERASE } from './Globals';
import { NOISE, WAVES_GLSL } from './glsl';

export interface InkOptions {
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  vertexColors?: boolean;
  /** Pencil hatching strength in shadow (0..1). */
  hatch?: number;
  /** Characters and important props keep their colour even in graphite areas. */
  alwaysColor?: boolean;
  /** Softness of the light/shadow wash edge: larger = softer, more painterly. */
  soft?: number;
  /** Self-lit amount (lanterns, glowing pigment). */
  emissive?: number;
  /** Id written for the ink-line pass: different ids always get a line between them. */
  lineId?: number;
  side?: THREE.Side;
  /** Drawn water: rippling pencil lines over the surface. */
  water?: boolean;
  /** Displace by the sea's waves (vertices in world space) and shade facet by facet. */
  waves?: boolean;
  /** One normal per triangle (folded paper look). */
  flat?: boolean;
  transparent?: boolean;
  opacity?: number;
}

const VERT = /* glsl */ `
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vViewPos;
#ifdef WAVES
uniform float uTime;
uniform float uStorm;
${WAVES_GLSL}
#endif
void main() {
  #include <uv_vertex>
  #include <color_vertex>
  #include <morphinstance_vertex>
  #include <morphcolor_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #ifdef WAVES
    // folded paper sea: the same waves the boat floats on (src/game/Sea.ts)
    transformed.y += seaWaves(transformed.xz, uTime, uStorm);
  #endif
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_BATCHING
    wp = batchingMatrix * wp;
    wn = mat3(batchingMatrix) * wn;
  #endif
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vec4 worldPosition = wp;
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * wn);
  vViewNormal = normalize(transformedNormal);
  vViewPos = mvPosition.xyz;
  #include <shadowmap_vertex>
}
`;

const FRAG = /* glsl */ `
layout(location = 0) out highp vec4 outColor;
layout(location = 1) out highp vec4 outNormal;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <color_pars_fragment>
#include <map_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
${NOISE}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uHatch;
uniform float uAlwaysColor;
uniform float uSoft;
uniform float uEmissive;
uniform float uLineId;
uniform float uTime;
uniform float uStorm;
uniform float uBoil;
uniform vec4 uBlooms[${MAX_BLOOMS}];
uniform int uBloomCount;
uniform vec3 uBloomTint[${MAX_BLOOMS}];
uniform vec4 uErase[${MAX_ERASE}];
uniform int uEraseCount;
uniform vec3 uPigment;
uniform vec3 uPaper;
uniform vec3 uGraphite;
uniform vec3 uShadowTint;
uniform vec3 uAmbient;
uniform vec3 uFog;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vViewNormal;
varying vec3 vViewPos;

// Pencil strokes laid along the surface (triplanar), jittered per animation frame.
float strokes(vec3 p, vec3 n, float freq, float angle) {
  vec3 an = abs(n);
  vec2 uv = an.y > max(an.x, an.z) ? p.xz : (an.x > an.z ? p.zy : p.xy);
  float c = cos(angle), s = sin(angle);
  vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  float jit = ibHash2(vec2(floor(r.y * freq * 0.5), uBoil)) * 0.3;
  float w = ibNoise(vec3(r * vec2(0.8, freq * 0.12), uBoil * 0.37));
  float line = abs(fract(r.x * freq + jit + w * 0.22) * 2.0 - 1.0);
  // stroke pressure varies along its length; gaps between strokes
  float press = smoothstep(0.25, 0.75, ibNoise(vec3(r * vec2(0.6, freq * 0.05), 3.1)));
  return smoothstep(0.7, 0.93, line) * mix(0.5, 1.0, press);
}

// which pigment a colour is made of: green, blue, or the warm family (everything else)
vec3 family(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 1e-4) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
  }
  h *= 60.0;
  float sat = d / max(mx, 1e-4);
  float g = smoothstep(62.0, 82.0, h) * (1.0 - smoothstep(158.0, 178.0, h));
  float b = smoothstep(158.0, 178.0, h) * (1.0 - smoothstep(262.0, 282.0, h));
  // near-greys belong to the paper's warm family
  g *= smoothstep(0.08, 0.2, sat);
  b *= smoothstep(0.08, 0.2, sat);
  return vec3(g, b, max(0.0, 1.0 - g - b));
}

// how much of each pigment family is back here: the restored baseline, then each bloom spreading
// its own pigments outward with a ragged watercolour edge
vec3 colorMask(vec3 p) {
  vec3 m = uPigment;
  if (uBloomCount == 0) return m;
  float edge = ibFbm(p * 0.45) * 1.6 + ibFbm(p * 2.1) * 0.5;
  for (int i = 0; i < ${MAX_BLOOMS}; i++) {
    if (i >= uBloomCount) break;
    vec4 b = uBlooms[i];
    float d = length(p - b.xyz) + (edge - 1.05) * (1.0 + b.w * 0.12);
    m = max(m, smoothstep(b.w, b.w - 1.2 - b.w * 0.08, d) * uBloomTint[i]);
  }
  return clamp(m, 0.0, 1.0);
}

void main() {
  vec3 base = uColor;
  #ifdef USE_MAP
    base *= texture2D(map, vMapUv).rgb;
  #endif
  #ifdef USE_COLOR
    base *= vColor.rgb;
  #endif
  vec3 N = normalize(vWorldNormal);
  vec3 VN = normalize(vViewNormal);
  #ifdef FLAT
    // folded facets: each triangle gets one normal, so creases catch the light (and the ink)
    N = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
    if (N.y < 0.0) N = -N;
    VN = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  #endif
  if (!gl_FrontFacing) { N = -N; VN = -VN; }

  vec3 L = vec3(0.0, 1.0, 0.0);
  vec3 sunCol = vec3(1.0);
  float shadow = 1.0;
  #if NUM_SUN_LIGHTS > 0
    L = inverseTransformDirection(sunLights[0].direction, viewMatrix);
    sunCol = sunLights[0].color;
    #if defined(USE_SHADOWMAP) && NUM_SUN_LIGHT_SHADOWS > 0
      shadow = receiveShadow ? getSunShadow(sunShadowMap[0], sunLightShadows[0], 0) : 1.0;
    #endif
  #endif

  // one confident wash of light and one of shadow, with a ragged, brushy boundary
  float ndl = dot(N, L);
  float wob = (ibFbm(vWorldPos * 2.6) - 0.5) * 0.5;
  float lit = smoothstep(-uSoft, uSoft, ndl + wob * 0.35 - 0.02) * smoothstep(0.25, 0.75, shadow + wob * 0.25);
  vec3 litCol = base * (uAmbient * 0.42 + sunCol * mix(0.8, 1.0, smoothstep(0.1, 0.8, ndl)));
  // shadow is a second, cooler wash of the same pigment rather than a darkening
  vec3 shadCol = base * uShadowTint;
  vec3 col = mix(shadCol, litCol, lit);
  #ifdef FLAT
    // folded paper: facets tipped toward the sun lift a tone, those tipped away drop one
    float fold = clamp((ndl - L.y) * 5.0, -1.0, 1.0);
    col *= 1.0 + fold * 0.3;
  #endif
  // lamps: warm pools of light with the same soft-edged wash
  #if NUM_POINT_LIGHTS > 0
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      vec3 lv = pointLights[i].position - vViewPos;
      float ld = length(lv);
      float att = getDistanceAttenuation(ld, pointLights[i].distance, pointLights[i].decay);
      float pl = min(smoothstep(-uSoft, uSoft, dot(VN, lv / ld) + wob * 0.3) * att, 1.1);
      col += base * pointLights[i].color * pl;
      lit = max(lit, clamp(pl * 1.5, 0.0, 1.0));
    }
  #endif
  // soft rim from the sky on edges facing away from the camera
  vec3 V = normalize(-vViewPos);
  float rim = pow(1.0 - clamp(dot(VN, V), 0.0, 1.0), 3.0);
  col += base * rim * 0.12 * (0.4 + 0.6 * lit);
  col += base * uEmissive;

  // hatching in shadow: one direction for shade, a cross layer only where it's deep
  // hatching thins into a flat tone with distance, so it never shimmers
  float hfade = 1.0 - smoothstep(14.0, 38.0, length(vViewPos));
  float h1 = mix(0.3, strokes(vWorldPos, N, 8.0, 0.7), hfade);
  float h2 = mix(0.25, strokes(vWorldPos + 3.3, N, 10.5, -0.8), hfade);
  float dark = 1.0 - lit;
  float deep = smoothstep(0.55, 1.0, dark) * smoothstep(0.6, 0.2, shadow + max(ndl, 0.0));
  col *= 1.0 - uHatch * dark * (h1 * 0.22 + h2 * 0.16 * deep);

  // graphite version: the paper stays white; value comes from a light tonal rub and strokes
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 graphite = uPaper * (1.0 - 0.16 * (1.0 - smoothstep(0.05, 0.8, lum)));
  graphite *= 1.0 - dark * 0.1;
  float pencil = dark * (h1 * 0.6 + h2 * 0.45 * deep) * mix(0.55, 1.0, uHatch);
  graphite = mix(graphite, uGraphite, clamp(pencil, 0.0, 1.0) * 0.7);
  #ifdef FLAT
    graphite *= 1.0 + fold * 0.16;
  #endif

  float m = max(dot(family(base), colorMask(vWorldPos)), uAlwaysColor);
  vec3 fin = mix(graphite, col, m);
  #ifdef WATER
    // water drawn the way you'd sketch it: short wavy strokes drifting downstream
    vec2 wp = vWorldPos.xz;
    float wave = sin(wp.x * 1.7 + uTime * 0.8 + sin(wp.y * 0.9) * 1.5) * 0.18;
    float row = wp.y * 2.2 + wave;
    float dash = smoothstep(0.35, 0.6, ibNoise(vec3(wp.x * 0.9 - uTime * 0.6, floor(row) * 3.1, uBoil * 0.2)));
    float wl = smoothstep(0.86, 0.97, abs(fract(row) * 2.0 - 1.0)) * dash;
    fin = mix(fin, mix(uGraphite, col * 0.55, m), wl * 0.7);
    fin = mix(fin, uPaper, 0.12 * (1.0 - m));
  #endif
  // pigment pools at the drying edge of a wash
  float ring = smoothstep(0.05, 0.5, m) * smoothstep(0.98, 0.5, m);
  fin *= 1.0 - ring * 0.22;

  // distance fades into the page
  float d = length(vViewPos);
  fin = mix(fin, uPaper, smoothstep(uFog.x, uFog.y, d) * uFog.z);

  // rubbed out: bare paper with a few eraser crumbs of graphite left behind
  float er = 0.0;
  for (int i = 0; i < ${MAX_ERASE}; i++) {
    if (i >= uEraseCount) break;
    vec4 e = uErase[i];
    float ragged = (ibFbm(vWorldPos * 1.3 + float(i)) - 0.5) * 0.9;
    er = max(er, smoothstep(e.w, e.w * 0.55, length(vWorldPos - e.xyz) + ragged));
  }
  er *= 1.0 - uAlwaysColor;
  fin = mix(fin, uPaper * (1.0 - 0.05 * step(0.93, ibHash(floor(vWorldPos * 14.0)))), er);
  vec3 outN = mix(VN, vec3(0.0, 0.0, 1.0), step(0.5, er));

  outColor = vec4(fin, uOpacity);
  // baked scenery carries its ink line id in the vertex colour's alpha
  float lid = uLineId / 255.0;
  #ifdef USE_COLOR_ALPHA
    if (vColor.a < 0.999) lid = vColor.a;
  #endif
  outNormal = vec4(outN * 0.5 + 0.5, er > 0.5 ? 0.0 : lid);
}
`;

let ids = 1;

/** The game's single surface shader: graphite or watercolour ink-and-wash, lit by the sun. */
export function inkMaterial(o: InkOptions = {}): THREE.ShaderMaterial {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.lights]) as Record<string, THREE.IUniform>;
  Object.assign(uniforms, {
    uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
    uOpacity: { value: o.opacity ?? 1 },
    uHatch: { value: o.hatch ?? 0.7 },
    uAlwaysColor: { value: o.alwaysColor ? 1 : 0 },
    uSoft: { value: o.soft ?? 0.1 },
    uEmissive: { value: o.emissive ?? 0 },
    uLineId: { value: o.lineId ?? 200 + (ids++ % 54) },
    map: { value: o.map ?? null },
    mapTransform: { value: new THREE.Matrix3() },
    ...G,
  });
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    lights: true,
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
  });
  if (o.water) mat.defines = { ...mat.defines, WATER: '' };
  if (o.waves) mat.defines = { ...mat.defines, WAVES: '' };
  if (o.flat || o.waves) mat.defines = { ...mat.defines, FLAT: '' };
  if (o.map) (mat as unknown as { map: THREE.Texture }).map = o.map;
  return mat;
}
