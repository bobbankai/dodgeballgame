import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { weather, ripples } from './wet';

const T = TSL as any;
const {
  Fn, float, vec2, vec3, uniform, sin, cos, mix, smoothstep, normalize, max, time, positionWorld, positionView, screenUV,
  viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, transformNormalToView, mx_noise_float, mx_fractal_noise_float,
} = T;

/** Water flow: 1 = moving, 0 = stopped in time (the plaza fountain); temporal abilities may scale it. */
export const waterTime = { scale: uniform(1) };

export interface WaterRecipe {
  type: 'water';
  /** colour light keeps after a metre of water */
  tint?: [number, number, number];
  /** metres for that colour (attenuation distance) */
  dist?: number;
  /** wave height scale (0 calm .. 1 choppy), wavelength scale (m) */
  waves?: number; scale?: number;
  /** 1 flowing, 0 frozen by an anomaly */
  flow?: number;
}

/**
 * Water as a medium, not a blue plane (physically based, rebuilt from a 'water' recipe):
 * - a transmissive dielectric (IOR 1.33): the scene behind is refracted through the surface (three's transmission backdrop, blurred
 *   by roughness), and absorbed along the real depth of water at each pixel (scene depth minus surface depth), so shallows show
 *   the bed and deep water goes to its own colour;
 * - a surface of layered directional swells plus noise ripples (and rain rings when it rains) for normals: highlights of every
 *   light and the sky break into glints, screen-space reflections pick up the surroundings;
 * - foam where the water is shallow against geometry (edges, the basin wall, around objects);
 * - `flow` 0 freezes the surface where time has stopped.
 */
export function water(r: WaterRecipe): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const tint = r.tint ?? [0.36, 0.6, 0.58];
  const amp = float(r.waves ?? 0.4);
  const sc = float(r.scale ?? 1.0);
  const t = time.mul(waterTime.scale).mul(float(r.flow ?? 1));
  const p = positionWorld.xz;

  // surface slope: four swells (direction, wavelength m, speed m/s, steepness) + two octaves of noise ripples
  const slope = Fn(() => {
    const s = vec2(0).toVar();
    const waves: [number, number, number, number, number][] = [[1.0, 0.25, 2.3, 0.9, 0.12], [-0.6, 1.0, 1.4, 0.7, 0.10], [0.3, -1.0, 0.8, 0.55, 0.07],
      [-1.0, -0.4, 0.45, 0.4, 0.05]];
    for (const [dx, dz, L, c, k] of waves) {
      const len = Math.hypot(dx, dz);
      const d = vec2(dx / len, dz / len);
      const w = (2 * Math.PI) / L;
      const ph = d.x.mul(p.x).add(d.y.mul(p.y)).div(sc).mul(w).sub(t.mul(c * w));
      s.addAssign(d.mul(cos(ph).mul(k)));
    }
    const q = vec3(p.x, t.mul(0.35), p.y).div(sc);
    const e = 0.05;
    const n0 = mx_fractal_noise_float(q.mul(3.0), 2, 2.0, 0.5);
    const nx = mx_fractal_noise_float(q.add(vec3(e, 0, 0)).mul(3.0), 2, 2.0, 0.5);
    const nz = mx_fractal_noise_float(q.add(vec3(0, 0, e)).mul(3.0), 2, 2.0, 0.5);
    s.addAssign(vec2(nx.sub(n0), nz.sub(n0)).div(e).mul(0.035));
    return s.mul(amp);
  })();
  const rain = ripples(p, 3.1, 4.0, 1.4).add(ripples(p.add(vec2(0.31, 0.77)), 4.3, 9.0, 1.9)).mul(weather.rain).mul(0.45);
  const nWorld = normalize(vec3(slope.x.add(rain.x).negate(), 1.0, slope.y.add(rain.y).negate()));
  m.normalNode = transformNormalToView(nWorld);

  // how much water lies behind this pixel (view-axis metres from the surface to the scene behind it)
  const behind = perspectiveDepthToViewZ(viewportDepthTexture(screenUV), cameraNear, cameraFar);
  const depth = max(positionView.z.sub(behind), 0.0);
  const foamN = mx_noise_float(vec3(p.x.mul(6.0), t.mul(0.6), p.y.mul(6.0))).mul(0.5).add(0.5);
  const foam = smoothstep(0.18, 0.0, depth.sub(foamN.mul(0.06))).mul(smoothstep(0.25, 0.6, foamN)).mul(0.85);

  m.colorNode = mix(vec3(0.0), vec3(0.75, 0.78, 0.8), foam);
  m.transmission = 1;
  m.transmissionNode = float(1).sub(foam);
  m.thicknessNode = depth;
  m.attenuationColor = new THREE.Color(tint[0], tint[1], tint[2]);
  m.attenuationDistance = r.dist ?? 1.2;
  m.ior = 1.333;
  m.roughnessNode = mix(float(0.025), float(0.5), foam);
  m.metalness = 0;
  m.specularIntensity = 1;
  m.side = THREE.FrontSide;
  return m;
}
