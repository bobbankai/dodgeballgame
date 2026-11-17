import * as TSL from 'three/tsl';
import { weather } from '../atmosphere/weather';
import { fbm, noise } from './common';

/**
 * Layers that sit on top of any base material, as functions of nodes:
 *
 * Weather (after Lagarde, "Water drop" 2013): porous surfaces darken as they soak (rough ones far more than smooth), a
 * water film rides on top as a clear coat with its own near-mirror roughness and normal (the base roughness detail stays
 * visible under it while lamps streak across the film), standing water gathers in low basins of flat ground and drowns the
 * surface's own bumps, rain rings disturb it, rivulets run down walls, and a damp rim darkens the ground round each puddle.
 *
 * Wear: edge wear from a convexity/edge mask, grime in occlusion and toward the floor, dust on up-facing surfaces.
 */
const T = TSL as any;
const { vec2, vec3, vec4, float, floor, fract, length, max, sin, exp, mix, smoothstep, clamp, abs, time, hash, Fn, cameraViewMatrix } = T;

/** Tangential (xz) displacement of a water surface by one layer of raindrop rings. */
export const rainRings = (p: any, scale: number, seed: number, speed: number) => {
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

/** Two layers of rings, scaled by the rain. */
export const rainRipples = (xz: any, strength = 0.35) =>
  rainRings(xz, 2.6, 0.0, 1.3).add(rainRings(xz.add(vec2(0.37, 0.71)), 3.7, 11.0, 1.7)).mul(weather.rain as any).mul(strength);

const toView = (n: any) => cameraViewMatrix.mul(vec4(n, 0.0)).xyz.normalize();

export interface WetInputs {
  /** base albedo (vec3), roughness (float), view-space normal (vec3) */
  color: any; roughness: any; normal: any;
  /** world position and world geometric normal */
  pos: any; up: any; // up = geometric normal's world y
  /** geometric view-space normal (puddles flatten toward it) */
  flatNormal: any;
}

export interface WetOutputs { color: any; roughness: any; normal: any; coat: any; coatRoughness: any; coatNormal: any }

/** The weather layer for an exposed static surface. */
export function wetSurface(i: WetInputs): WetOutputs {
  const w = weather as any;
  const p = i.pos;
  // standing water: flat ground, low basins of a broad noise field (fine-edged), growing with `puddles`
  const flat = smoothstep(0.88, 0.97, i.up);
  const basin = fbm(vec3(p.x, 0.0, p.z), 0.16, 3).add(noise(vec3(p.x, 0.0, p.z), 2.3).sub(0.5).mul(0.08));
  const level = float(1.0).sub(w.puddles.mul(0.55));
  const puddle = smoothstep(level, level.add(0.04), basin).mul(flat);
  // the damp rim: ground round a puddle holds more water than the rest
  const rim = smoothstep(level.sub(0.08), level, basin).mul(flat).mul(w.puddles);
  // rivulets: thin wandering streaks running down vertical faces
  const vertical = smoothstep(0.45, 0.15, abs(i.up));
  const streak = smoothstep(0.55, 0.85, noise(vec3(p.x.add(p.z).mul(7.0), p.y.mul(0.45).add(time.mul(0.9)), 0.0), 1.0))
    .mul(vertical).mul(w.rain);
  // soak: porous (rough) surfaces darken most; puddles and their rims darken fully
  const porosity = smoothstep(0.3, 0.85, i.roughness);
  const soak = w.wet.mul(porosity.mul(0.6).add(0.4)).max(rim.mul(0.85));
  const darken = mix(float(1), float(0.5), soak.max(puddle.mul(0.9)).max(streak.mul(0.5)));
  const color = i.color.mul(darken);
  const roughness = mix(i.roughness, i.roughness.mul(0.55).add(0.06), w.wet.mul(0.6));
  const normal = Fn(() => mix(i.normal, i.flatNormal, puddle.mul(0.85)).normalize())();
  const coat = w.wet.mul(0.75).max(puddle).max(streak);
  const coatRoughness = mix(mix(float(0.16), float(0.09), w.wet), float(0.025), puddle.max(streak));
  const coatNormal = Fn(() => {
    const rip = rainRipples(vec2(p.x, p.z));
    const n = vec3(rip.x.negate(), 1.0, rip.y.negate()).normalize();
    return mix(i.normal, toView(n), puddle).normalize();
  })();
  return { color, roughness, normal, coat, coatRoughness, coatNormal };
}

/** Clothing and kit in the rain: fabric darkens and loses its sheen to a wet gloss; hard plates bead and shine. */
export function soakedCloth(color: any, roughness: any): { color: any; roughness: any } {
  const s = (weather as any).soak;
  const porous = smoothstep(0.35, 0.8, roughness);
  return { color: color.mul(mix(float(1), float(0.62), s.mul(porous))), roughness: mix(roughness, roughness.mul(0.5).add(0.08), s) };
}

/** Edge wear, grime and dust masks. `edge` 0..1 convexity, `ao` 0..1 occlusion, `p` position (m), `up` normal y. */
export function wearMasks(edge: any, ao: any, p: any, up: any, amount = 0.5) {
  const n = fbm(p, 120.0, 3);
  const big = fbm(p, 3.0, 3);
  const wear = clamp(edge.mul(n.mul(0.7).add(0.3)).mul(amount * 1.6), 0.0, 1.0);
  const grime = clamp(float(1).sub(ao).mul(big.mul(0.6).add(0.7)), 0.0, 1.0);
  const dust = smoothstep(0.6, 0.95, up).mul(big.mul(0.5).add(0.5));
  return { wear, grime, dust, breakup: n, variation: big };
}


