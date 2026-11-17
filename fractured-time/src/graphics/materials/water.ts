import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { rainRipples } from '../shaders/surfaceLayers';
import { noise } from '../shaders/common';

/**
 * Water as a medium (basins, fountains, flooded floors), from a 'water' recipe:
 * - a transmissive dielectric (IOR 1.333): the scene behind is refracted through the surface and absorbed along the real
 *   depth of water at each pixel (scene depth minus surface depth): shallows show the bed, deep water goes to its colour;
 * - the surface: four directional swells plus two octaves of noise ripples and the rain's rings; each layer fades to flat
 *   once its wavelength nears the pixel footprint, so distant water does not shimmer;
 * - foam where the water is shallow against geometry (edges, walls, objects standing in it);
 * - `flow` 0 freezes the surface where time has stopped (scaled live by `waterTime.scale`).
 */
const T = TSL as any;
const { Fn, float, vec2, vec3, uniform, cos, mix, smoothstep, normalize, max, time, positionWorld, positionView, screenUV, viewportDepthTexture,
  perspectiveDepthToViewZ, cameraNear, cameraFar, transformNormalToView, fwidth, length, mx_fractal_noise_float } = T;

/** 1 = moving, 0 = stopped in time; temporal abilities may scale it. */
export const waterTime = { scale: uniform(1) };

export interface WaterRecipe {
  type: 'water';
  /** colour light keeps after `dist` metres of water */
  tint?: [number, number, number];
  dist?: number;
  /** wave height (0 calm .. 1 choppy) and wavelength scale (m) */
  waves?: number; scale?: number;
  /** 1 flowing, 0 frozen */
  flow?: number;
}

export function water(r: WaterRecipe): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const tint = r.tint ?? [0.36, 0.6, 0.58];
  const amp = float(r.waves ?? 0.4);
  const sc = float(r.scale ?? 1.0);
  const t = time.mul(waterTime.scale).mul(float(r.flow ?? 1));
  const p = positionWorld.xz;
  // metres per pixel here: a wave shorter than ~4 pixels only aliases
  const footprint = max(fwidth(p.x), fwidth(p.y));

  const slope = Fn(() => {
    const s = vec2(0).toVar();
    // direction, wavelength (m), speed factor, steepness
    const swells: [number, number, number, number, number][] = [[1.0, 0.25, 2.3, 0.9, 0.12], [-0.6, 1.0, 1.4, 0.7, 0.10], [0.3, -1.0, 0.8, 0.55, 0.07],
      [-1.0, -0.4, 0.45, 0.4, 0.05]];
    for (const [dx, dz, L, c, k] of swells) {
      const len = Math.hypot(dx, dz);
      const d = vec2(dx / len, dz / len);
      const w = (2 * Math.PI) / L;
      const ph = d.x.mul(p.x).add(d.y.mul(p.y)).div(sc).mul(w).sub(t.mul(c * w));
      const keep = smoothstep(float(L * 0.25), float(L * 0.08), footprint.mul(sc));
      s.addAssign(d.mul(cos(ph).mul(k)).mul(keep));
    }
    const q = vec3(p.x, t.mul(0.35), p.y).div(sc);
    const e = 0.05;
    const n0 = mx_fractal_noise_float(q.mul(3.0), 2, 2.0, 0.5);
    const nx = mx_fractal_noise_float(q.add(vec3(e, 0, 0)).mul(3.0), 2, 2.0, 0.5);
    const nz = mx_fractal_noise_float(q.add(vec3(0, 0, e)).mul(3.0), 2, 2.0, 0.5);
    const rippleKeep = smoothstep(0.06, 0.015, footprint);
    s.addAssign(vec2(nx.sub(n0), nz.sub(n0)).div(e).mul(0.035).mul(rippleKeep));
    return s.mul(amp);
  })();
  const rain = rainRipples(p, 0.45);
  m.normalNode = transformNormalToView(normalize(vec3(slope.x.add(rain.x).negate(), 1.0, slope.y.add(rain.y).negate())));

  // water column behind this pixel (view-axis metres from the surface to whatever lies behind it)
  const behind = perspectiveDepthToViewZ(viewportDepthTexture(screenUV), cameraNear, cameraFar);
  const depth = max(positionView.z.sub(behind), 0.0);
  const foamN = noise(vec3(p.x.mul(6.0), t.mul(0.6), p.y.mul(6.0)), 1.0);
  const foam = smoothstep(0.18, 0.0, depth.sub(foamN.mul(0.06))).mul(smoothstep(0.25, 0.6, foamN)).mul(0.85);

  m.colorNode = mix(vec3(0.0), vec3(0.75, 0.78, 0.8), foam);
  m.transmission = 1;
  m.transmissionNode = float(1).sub(foam);
  m.thicknessNode = depth;
  m.attenuationColor = new THREE.Color(tint[0], tint[1], tint[2]);
  m.attenuationDistance = r.dist ?? 1.2;
  m.ior = 1.333;
  m.roughnessNode = mix(float(0.025), float(0.5), foam).add(smoothstep(0.02, 0.2, footprint).mul(0.06));
  m.metalness = 0;
  m.specularIntensity = 1;
  m.side = THREE.FrontSide;
  return m;
}

void length;
