// Lava rivers and pools: crust plates of cooling basalt drift on the flow, cracking apart over incandescent
// rock. Built on three's PBR (the crust is lit and shadowed like stone; the melt is emissive HDR so it blooms
// and lights the fog), with:
//   - Voronoi crust plates advected along the ribbon's flow (two phases cross-faded, like the water),
//   - crack width that breathes over time, so seams open and close,
//   - temperature: thin seams burn yellow-white, wider melt deep orange, the crust edges glow dull red,
//   - crust relief in the normal (plates domed, cracks sunken) and a slow heave of the surface.
import * as THREE from 'three';
import { G } from './MaterialFX';
import type { Pipeline } from './Pipeline';

export interface LavaOptions {
  speed?: number;
  /** crust plates per metre */
  scale?: number;
  /** emissive strength of the melt */
  heat?: number;
  /** 0..1 how much of the surface is crusted */
  crust?: number;
}

export function lavaMaterial(pipe: Pipeline, o: LavaOptions = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.92, metalness: 0, emissive: 0xffffff });
  m.name = 'lava';
  const hook = pipe.lighting.setupMaterial(m);
  const U = {
    uLSpeed: { value: o.speed ?? 0.35 },
    uLScale: { value: o.scale ?? 0.55 },
    uLHeat: { value: o.heat ?? 7.0 },
    uLCrust: { value: o.crust ?? 0.62 },
  };
  m.onBeforeCompile = (sh) => {
    hook(sh);
    Object.assign(sh.uniforms, U, { uTime: G.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 flow;
uniform float uTime;
varying vec3 vLFlow;
varying vec3 vLPos;
varying vec2 vLUv;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  // slow heave of the molten surface
  vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
  transformed.y += sin(wp0.x * 0.7 + uTime * 0.6) * sin(wp0.z * 0.5 - uTime * 0.45) * 0.05;
}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vLFlow = normalize(mat3(modelMatrix) * flow);
vLPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vLUv = uv;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uLSpeed, uLScale, uLHeat, uLCrust, uTime;
varying vec3 vLFlow;
varying vec3 vLPos;
varying vec2 vLUv;
vec2 lHash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
float lNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = lHash2(i).x, b = lHash2(i + vec2(1, 0)).x, c = lHash2(i + vec2(0, 1)).x, d = lHash2(i + vec2(1, 1)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// distance to the nearest plate edge (F2 - F1) and the plate id
vec2 lVoronoi(vec2 p, float t) {
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 8.0, d2 = 8.0; float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 h = lHash2(ip + g);
    vec2 o = 0.5 + 0.38 * sin(t * 0.3 + 6.2831 * h);
    vec2 r = g + o - fp;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) { d2 = d; }
  }
  return vec2(sqrt(d2) - sqrt(d1), id);
}
float lEdge = 1.0;
float lHot = 0.0;
float lId = 0.0;
float lMelt = 0.0;
float lT = 0.0;
vec2 lQ = vec2(0.0);`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 fl = normalize(vec3(vLFlow.x, 0.0, vLFlow.z) + 1e-5);
  vec3 ac = vec3(-fl.z, 0.0, fl.x);
  vec2 q = vec2(dot(vLPos, ac), dot(vLPos, fl)) * uLScale;
  float t = uTime * uLSpeed;
  // two advected phases, cross-faded, so the plates travel without stretching
  float ph0 = fract(t * 0.12), ph1 = fract(t * 0.12 + 0.5);
  float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);
  vec2 v0 = lVoronoi(q - vec2(0.0, ph0 * 8.0 * uLScale) + 3.1, uTime);
  vec2 v1 = lVoronoi(q - vec2(0.0, ph1 * 8.0 * uLScale) + 9.7, uTime);
  float edge = mix(v1.x, v0.x, w0);
  lId = mix(v1.y, v0.y, w0);
  // seams breathe: plates part and close; some plates have melted away entirely
  float breathe = 0.08 + 0.05 * sin(uTime * 0.7 + lId * 12.0);
  // open melt: some plates have foundered (about a quarter at crust 0.62), with a soft shore
  float mn = lNoise(q * 0.35 + vec2(0.0, -t * 0.5)) * 0.8 + lId * 0.2;
  float melted = smoothstep(uLCrust, uLCrust + 0.08, mn);
  lEdge = smoothstep(0.0, breathe, edge);
  lHot = max(1.0 - lEdge, melted);
  lMelt = melted; lQ = q; lT = t;
  float crustTone = 0.75 + 0.5 * lNoise(q * 4.0 + lId * 7.0);
  diffuseColor.rgb = mix(vec3(0.05, 0.04, 0.035) * crustTone, vec3(0.12, 0.02, 0.004), lHot);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(0.92, 0.35, lHot);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  // domed plates, sunken cracks: tilt the normal by the screen-space gradient of the crust profile
  float h = lEdge * (1.0 - lHot);
  vec3 dpx = dFdx(vLPos), dpy = dFdy(vLPos);
  float hx = dFdx(h), hy = dFdy(h);
  vec3 gW = (cross(dpy, vec3(0.0, 1.0, 0.0)) * hx + cross(vec3(0.0, 1.0, 0.0), dpx) * hy) * 0.6;
  normal = normalize(normal + (viewMatrix * vec4(gW, 0.0)).xyz * 4.0);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // temperature: thin seams yellow-white, open melt orange, plate rims a dull red glow
  // the hottest light is in the thinnest seams; open melt is a deep orange skinned with darker swirls
  float seam = 1.0 - smoothstep(0.0, 0.6, lEdge);
  float swirl = lNoise(lQ * 2.3 + vec2(lT * 0.8, -lT)) * 0.6 + lNoise(lQ * 5.1 - vec2(0.0, lT * 1.6)) * 0.4;
  // (kept below ~2 in HDR: brighter orange desaturates to peach in the tone map)
  vec3 open = mix(vec3(0.4, 0.035, 0.002), vec3(0.95, 0.24, 0.02), smoothstep(0.25, 0.85, swirl)) * 0.4;
  vec3 thin = mix(vec3(0.95, 0.24, 0.025), vec3(1.0, 0.5, 0.12), seam);
  float pulse = 0.85 + 0.15 * sin(uTime * 1.3 + lId * 20.0);
  vec3 glow = mix(thin, open, step(1.0 - lEdge, lMelt * 0.999)) * lHot * uLHeat * pulse;
  glow += vec3(0.6, 0.08, 0.01) * (1.0 - lEdge) * 0.0 + vec3(0.5, 0.06, 0.01) * smoothstep(0.25, 0.0, lEdge) * (1.0 - lHot) * uLHeat * 0.12;
  totalEmissiveRadiance = glow;
}`);
  };
  m.customProgramCacheKey = () => 'lava';
  return m;
}

/** a lava mesh (a ribbon from Water.ribbon carries the flow attribute) */
export function lavaMesh(pipe: Pipeline, geo: THREE.BufferGeometry, o: LavaOptions = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, lavaMaterial(pipe, o));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noCollide = true;
  mesh.name = 'lava';
  return mesh;
}
