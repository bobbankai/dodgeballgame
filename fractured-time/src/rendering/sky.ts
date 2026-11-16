import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as any;
const { Fn, vec2, vec3, float, uniform, texture, equirectUV, normalWorldGeometry, mix, smoothstep, max, pow, time, mx_fractal_noise_float } = T;

/**
 * The sky behind every exterior, drawn as the scene's `backgroundNode` (three draws it on a camera-centred sphere at the far
 * plane, before the opaque pass, and in the sea's mirror).
 *
 * - `image`: an HDRI sampled directly (no cube conversion), turned half a revolution to match Blender's world mapping so the
 *   sun in the sky sits where the baked shadows say it is; the band at the horizon melts into the place's haze.
 * - `storm`: the storm at nightfall, procedural: a low, heavy deck of cloud (domain-warped fbm on a plane overhead, drifting
 *   and slowly changing shape), lit from below by the city's sodium glow, darker gaps toward the zenith, and a rain haze along
 *   the horizon in the fog colour so far towers dissolve into it. The HDRI the bakes used for this weather is a sunny meadow
 *   under cumulus: dimmed, it read as day with trees on the skyline.
 *
 * Values are scene-linear radiance (the grade and eye adaptation do the rest). Lightning flashes scale the scene's
 * `backgroundIntensity`.
 */
export interface SkyLook {
  /** the place's fog in-scatter colour: the horizon haze */
  haze: THREE.Color;
  /** the city's light on the underside of the clouds (0 = no one left to switch it on) */
  glow?: number;
}

export class Sky {
  readonly haze = uniform(new THREE.Color(0.06, 0.07, 0.09));
  readonly glow = uniform(new THREE.Color(1.0, 0.52, 0.24).multiplyScalar(0.05));
  /** horizon band for image skies (fraction of the half sphere blended into the haze) */
  readonly band = uniform(0.06);
  private imageNodes = new Map<THREE.Texture, any>();
  private stormNode: any = null;

  /** The background node for an HDRI sky. */
  image(tex: THREE.Texture, look: SkyLook): any {
    this.haze.value.copy(look.haze);
    let n = this.imageNodes.get(tex);
    if (!n) {
      n = Fn(() => {
        const dir = normalWorldGeometry.normalize();
        const uv = equirectUV(dir);
        const sky = texture(tex, vec2(uv.x.add(0.5).fract(), uv.y)).rgb;
        // the horizon: the sky's own colour there, pulled toward the haze (the sea covers what lies below)
        const k = smoothstep(this.band, float(-0.02), dir.y);
        return mix(sky, mix(sky, this.haze.mul(1.6), 0.55), k);
      })();
      this.imageNodes.set(tex, n);
    }
    return n;
  }

  /** The background node for the storm at nightfall. */
  storm(look: SkyLook): any {
    this.haze.value.copy(look.haze);
    this.glow.value.setRGB(1.0, 0.52, 0.24).multiplyScalar(0.05 * (look.glow ?? 1));
    if (this.stormNode) return this.stormNode;
    this.stormNode = Fn(() => {
      const dir = normalWorldGeometry.normalize();
      const h = dir.y;
      const up = max(h, float(0));
      // the cloud deck: a plane overhead, seen ever more obliquely toward the horizon
      const q = dir.xz.div(up.add(0.09)).mul(0.55);
      const t = time;
      const drift = vec2(t.mul(0.011), t.mul(0.004));
      const warp = vec2(
        mx_fractal_noise_float(vec3(q.mul(0.42).add(drift.mul(0.6)), t.mul(0.006)), 3, 2.0, 0.5),
        mx_fractal_noise_float(vec3(q.mul(0.42).add(drift.mul(0.6)).add(vec2(5.2, 1.3)), t.mul(0.006)), 3, 2.0, 0.5),
      );
      const p = q.add(warp.mul(0.85)).add(drift);
      const body = mx_fractal_noise_float(vec3(p.mul(0.9), t.mul(0.012)), 5, 2.0, 0.5);
      // an almost closed deck: darker rifts open between the masses
      const cover = smoothstep(float(-0.3), float(0.18), body);
      // the masses' undersides: thick cores swallow the light, thin edges and the rolls between them catch it
      const thick = mx_fractal_noise_float(vec3(p.mul(2.3).add(vec2(11.0, 3.0)), t.mul(0.02)), 4, 2.0, 0.55).mul(0.5).add(0.5);
      const roll = smoothstep(float(0.05), float(0.6), body).oneMinus(); // the lit lower edge of each mass
      // one continuous gradient, zenith to horizon, that the clouds modulate: the horizon is the fog colour lifted a little by
      // the city's glow on the low cloud, so far buildings and the sky meet without a seam
      const lowness = pow(float(1).sub(up), 3.0);
      const horizon = this.haze.mul(1.05).add(this.glow.mul(0.45));
      const base = mix(this.haze.mul(0.32), horizon, lowness);
      const lit = roll.mul(0.5).add(thick.oneMinus().mul(0.6)).add(0.2); // 0.2 .. 1.3
      const cloud = base.mul(lit.mul(0.55).add(0.6)).add(this.glow.mul(lit).mul(lowness.mul(0.9).add(0.15)));
      const gap = base.mul(0.55);
      const detail = smoothstep(float(0.0), float(0.22), up);
      let col = mix(base, mix(gap, cloud, cover), detail);
      const below = smoothstep(float(0.0), float(-0.06), h);
      col = mix(col, horizon, below);
      return col;
    })();
    return this.stormNode;
  }
}
