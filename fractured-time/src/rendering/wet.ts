import type * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as any;
const {
  uniform, Fn, float, vec2, vec3, vec4, floor, fract, length, max, sin, exp, mix, smoothstep, clamp, time, hash, abs,
  positionWorld, normalWorldGeometry, normalViewGeometry, cameraViewMatrix, materialColor, materialRoughness, mx_fractal_noise_float, mx_noise_float,
} = T;

/**
 * Rain on the world. Outdoor static surfaces get a water layer (Lagarde, "Water drop" 2013, simplified):
 * - porous surfaces darken as they soak (rough ones far more than smooth),
 * - a clear-coat film of water sits on top: its own near-mirror roughness and normal, so the scan's roughness detail stays
 *   visible underneath while lamps and neon streak across the film,
 * - standing water collects on flat ground in low noise basins, flattening the surface's own bumps, with rain rings,
 * - rivulets run down walls.
 * The `weather` uniforms drive it all; a material without them is unaffected.
 */
export const weather = {
  /** water film over exposed surfaces (0 dry .. 1 soaked) */
  wet: uniform(0),
  /** standing water on flat ground (0 none .. 1 flooded) */
  puddles: uniform(0),
  /** rain intensity (ripples, rivulets) */
  rain: uniform(0),
  /** how soaked the characters are: rises out in the rain, dries slowly indoors (skin, hair, clothing) */
  soak: uniform(0),
};

/** Tangential (xz) displacement of the water surface by one layer of raindrop rings. */
export const ripples = (p: any, scale: number, seed: number, speed: number): any => {
  const q = p.mul(scale);
  const cell = floor(q);
  const f = fract(q).sub(0.5);
  const h1 = hash(cell.x.add(cell.y.mul(57.0)).add(seed));
  const h2 = hash(cell.x.mul(13.1).add(cell.y.mul(7.7)).add(seed + 3.0));
  const d = f.sub(vec2(h1, h2).sub(0.5).mul(0.5));
  const r = length(d);
  const ph = fract(time.mul(speed).add(h1.mul(9.17)));
  const x = r.sub(ph.mul(0.42)).mul(34.0);
  const ring = sin(clamp(x, -9.42, 9.42)).mul(exp(x.mul(x).mul(-0.05)));
  const fade = ph.oneMinus().mul(ph.oneMinus()).mul(smoothstep(0.5, 0.35, r));
  return d.div(max(r, 1e-3)).mul(ring.mul(fade));
};

const view = (n: any) => cameraViewMatrix.mul(vec4(n, 0.0)).xyz.normalize();

/** Give an outdoor static material the water layer. Returns false if it cannot take one (not a physical material). */
export function wetten(m: THREE.Material): boolean {
  const pm = m as THREE.MeshPhysicalNodeMaterial;
  if (!(pm as any).isMeshPhysicalNodeMaterial || (pm.userData as any).wet) return false;
  (pm.userData as any).wet = true;
  const baseColor = pm.colorNode ?? materialColor;
  const baseRough = pm.roughnessNode ?? materialRoughness;
  const baseNormal = pm.normalNode ?? normalViewGeometry;
  const p = positionWorld;
  const up = normalWorldGeometry.y;

  // standing water: flat ground, low basins of a broad noise field (with fine edges), grows with `puddles`
  const flat = smoothstep(0.88, 0.97, up);
  const basin = mx_fractal_noise_float(vec3(p.x, 0.0, p.z).mul(0.16), 3, 2.0, 0.5).mul(0.5).add(0.5)
    .add(mx_noise_float(vec3(p.x, 0.0, p.z).mul(2.3)).mul(0.04));
  const puddle = Fn(() => smoothstep(float(1.0).sub(weather.puddles.mul(0.55)), float(1.04).sub(weather.puddles.mul(0.55)), basin).mul(flat))();
  // rivulets: water running down vertical faces in thin wandering streaks
  const vertical = smoothstep(0.45, 0.15, abs(up));
  const streak = smoothstep(0.55, 0.85, mx_noise_float(vec3(p.x.add(p.z).mul(7.0), p.y.mul(0.45).add(time.mul(0.9)), 0.0)).mul(0.5).add(0.5))
    .mul(vertical).mul(weather.rain);
  // soak: rough (porous) surfaces darken most; puddles darken fully
  const rough = Fn(() => baseRough)();
  const porosity = smoothstep(0.3, 0.85, rough);
  const soak = weather.wet.mul(porosity.mul(0.6).add(0.4));
  const darken = mix(float(1), float(0.52), soak.max(puddle.mul(0.9)).max(streak.mul(0.5)));
  pm.colorNode = Fn(() => baseColor.rgb.mul(darken))();
  pm.roughnessNode = mix(rough, rough.mul(0.55).add(0.06), weather.wet.mul(0.6));
  // the surface's bumps drown under standing water
  pm.normalNode = Fn(() => mix(baseNormal, normalViewGeometry, puddle.mul(0.85)).normalize())();

  // the water film (clear coat): everywhere wet, thick in puddles and rivulets; rain rings disturb puddle surfaces
  pm.clearcoat = 1;
  pm.clearcoatNode = weather.wet.mul(0.75).max(puddle).max(streak);
  pm.clearcoatRoughnessNode = mix(mix(float(0.16), float(0.09), weather.wet), float(0.025), puddle.max(streak));
  pm.clearcoatNormalNode = Fn(() => {
    const xz = vec2(p.x, p.z);
    const rip = ripples(xz, 2.6, 0.0, 1.3).add(ripples(xz.add(vec2(0.37, 0.71)), 3.7, 11.0, 1.7)).mul(weather.rain).mul(0.35);
    const n = vec3(rip.x.negate(), 1.0, rip.y.negate()).normalize();
    return mix(baseNormal, view(n), puddle).normalize();
  })();
  pm.needsUpdate = true;
  return true;
}

/** Weather presets by place. */
export function setWeather(kind: Weather): void {
  const w = { dry: [0, 0, 0], storm: [0.8, 0.55, 0.6], downpour: [1, 0.85, 1] }[kind];
  weather.wet.value = w[0];
  weather.puddles.value = w[1];
  weather.rain.value = w[2];
}

export type Weather = 'dry' | 'storm' | 'downpour';
