import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * The sky behind every exterior, as the scene's `backgroundNode` (drawn on a camera-centred sphere at the far plane before
 * the opaque pass, and in mirrors). Values are scene-linear radiance; eye adaptation and grading do the rest.
 *
 * - `image(tex)`: an HDRI sampled directly (no cube conversion), turned half a revolution to match Blender's world mapping so
 *   the sun in the sky sits where the baked shadows say it is; the horizon band melts into the place's haze.
 * - `storm()`: the storm at nightfall: a low, heavy, drifting cloud deck (domain-warped fBm on a plane overhead), lit from
 *   below by the city's sodium glow, darker rifts toward the zenith, rain haze at the horizon in the fog colour.
 * - `physical()`: single-scattering atmosphere (Rayleigh + Mie with an ozone tint), ray-marched through a spherical shell
 *   of air with the sun's transmittance per sample, for places lit by an analytic sun (and as the fallback when an image
 *   is missing). Moves with `sunDir`: day, golden hour, dusk.
 */
const T = TSL as any;
const { Fn, vec2, vec3, float, uniform, texture, equirectUV, normalWorldGeometry, mix, smoothstep, max, min, pow, time, exp, sqrt, dot, Loop,
  mx_fractal_noise_float, PI } = T;
void min;

export interface SkyLook {
  /** the place's fog in-scatter colour: the horizon haze */
  haze: THREE.Color;
  /** the city's light on the underside of the clouds (0 = no one left to switch it on) */
  glow?: number;
}

// Earth's atmosphere (m): planet radius, shell top, scale heights; scattering coefficients (1/m) at sea level
const R_PLANET = 6360e3;
const R_ATMO = 6420e3;
const H_R = 8000;
const H_M = 1200;
const BETA_R = [5.8e-6, 13.5e-6, 33.1e-6];
const BETA_M = 21e-6;
const OZONE = [0.65e-6, 1.88e-6, 0.085e-6];

export class Sky {
  readonly haze = uniform(new THREE.Color(0.06, 0.07, 0.09));
  readonly glow = uniform(new THREE.Color(1.0, 0.52, 0.24).multiplyScalar(0.05));
  /** horizon band for image skies (fraction of the half sphere blended into the haze) */
  readonly band = uniform(0.06);
  /** physical sky: direction to the sun, its illuminance scale, Mie anisotropy */
  readonly sunDir = uniform(new THREE.Vector3(0.3, 0.5, -0.8).normalize());
  readonly sunIntensity = uniform(20);
  readonly mieG = uniform(0.76);
  private imageNodes = new Map<THREE.Texture, any>();
  private details = new Map<THREE.Texture, { tex: THREE.Texture; scale: number }>();

  /** An 8K display image of the HDR's upper hemisphere (tools/assets/sky_detail.py): sharp clouds; the HDR keeps the sun. */
  setDetail(hdr: THREE.Texture, detail: THREE.Texture, scale: number): void {
    this.details.set(hdr, { tex: detail, scale });
    this.imageNodes.delete(hdr);
  }
  private stormNode: any = null;
  private physicalNode: any = null;

  image(tex: THREE.Texture, look: SkyLook): any {
    this.haze.value.copy(look.haze);
    let n = this.imageNodes.get(tex);
    if (!n) {
      n = Fn(() => {
        const dir = normalWorldGeometry.normalize();
        const uv = equirectUV(dir);
        const u0 = vec2(uv.x.add(0.5).fract(), uv.y);
        let sky: any = texture(tex, u0).rgb;
        const det = this.details.get(tex);
        if (det) {
          // above the horizon the detail image (linear = decoded x scale); the HDR wherever the image saturates (the sun,
          // its rim) and below the horizon
          const vD = uv.y.sub(0.5).mul(2.0);
          const d = texture(det.tex, vec2(u0.x, vD.clamp(0.001, 0.999))).rgb;
          const sat = smoothstep(0.78, 0.92, max(max(d.r, d.g), d.b));
          const above = smoothstep(0.0, 0.03, vD);
          sky = mix(sky, d.mul(det.scale), above.mul(sat.oneMinus()));
        }
        const k = smoothstep(this.band, float(-0.02), dir.y);
        return mix(sky, mix(sky, this.haze.mul(1.6), 0.55), k);
      })();
      this.imageNodes.set(tex, n);
    }
    return n;
  }

  storm(look: SkyLook): any {
    this.haze.value.copy(look.haze);
    this.glow.value.setRGB(1.0, 0.52, 0.24).multiplyScalar(0.05 * (look.glow ?? 1));
    if (this.stormNode) return this.stormNode;
    this.stormNode = Fn(() => {
      const dir = normalWorldGeometry.normalize();
      const h = dir.y;
      const up = max(h, float(0));
      const q = dir.xz.div(up.add(0.09)).mul(0.55); // a plane overhead, ever more oblique toward the horizon
      const t = time;
      const drift = vec2(t.mul(0.011), t.mul(0.004));
      const warp = vec2(
        mx_fractal_noise_float(vec3(q.mul(0.42).add(drift.mul(0.6)), t.mul(0.006)), 3, 2.0, 0.5),
        mx_fractal_noise_float(vec3(q.mul(0.42).add(drift.mul(0.6)).add(vec2(5.2, 1.3)), t.mul(0.006)), 3, 2.0, 0.5),
      );
      const p = q.add(warp.mul(0.85)).add(drift);
      const body = mx_fractal_noise_float(vec3(p.mul(0.9), t.mul(0.012)), 5, 2.0, 0.5);
      const cover = smoothstep(float(-0.3), float(0.18), body);
      const thick = mx_fractal_noise_float(vec3(p.mul(2.3).add(vec2(11.0, 3.0)), t.mul(0.02)), 4, 2.0, 0.55).mul(0.5).add(0.5);
      const roll = smoothstep(float(0.05), float(0.6), body).oneMinus();
      const lowness = pow(float(1).sub(up), 3.0);
      const horizon = this.haze.mul(1.05).add(this.glow.mul(0.45));
      const base = mix(this.haze.mul(0.32), horizon, lowness);
      const lit = roll.mul(0.5).add(thick.oneMinus().mul(0.6)).add(0.2);
      const cloud = base.mul(lit.mul(0.55).add(0.6)).add(this.glow.mul(lit).mul(lowness.mul(0.9).add(0.15)));
      const gap = base.mul(0.55);
      const detail = smoothstep(float(0.0), float(0.22), up);
      const col = mix(base, mix(gap, cloud, cover), detail);
      return mix(col, horizon, smoothstep(float(0.0), float(-0.06), h));
    })();
    return this.stormNode;
  }

  /** Physical sky (single scattering, 12 view samples x 4 sun samples). */
  physical(): any {
    if (this.physicalNode) return this.physicalNode;
    const betaR = vec3(...BETA_R);
    const betaO = vec3(...OZONE);
    this.physicalNode = Fn(() => {
      const dir = normalWorldGeometry.normalize();
      const sd = vec3(this.sunDir).normalize();
      const origin = vec3(0.0, R_PLANET + 2.0, 0.0);
      // distance to the top of the shell along a ray from p (inside it)
      const exitDist = (p: any, d: any) => {
        const b = dot(p, d);
        const c = dot(p, p).sub(R_ATMO * R_ATMO);
        return b.negate().add(sqrt(max(b.mul(b).sub(c), 0.0)));
      };
      const viewLen = exitDist(origin, dir);
      const steps = 12;
      const ds = viewLen.div(steps);
      const odR = float(0).toVar();
      const odM = float(0).toVar();
      const sumR = vec3(0).toVar();
      const sumM = vec3(0).toVar();
      Loop(steps, ({ i }: any) => {
        const p = origin.add(dir.mul(float(i).add(0.5).mul(ds)));
        const hgt = max(p.length().sub(R_PLANET), 0.0);
        const dR = exp(hgt.negate().div(H_R)).mul(ds);
        const dM = exp(hgt.negate().div(H_M)).mul(ds);
        odR.addAssign(dR);
        odM.addAssign(dM);
        // light reaching p from the sun (4 samples to the shell top)
        const sl = exitDist(p, sd);
        const sds = sl.div(4);
        const sR = float(0).toVar();
        const sM = float(0).toVar();
        Loop(4, ({ i: j }: any) => {
          const q = p.add(sd.mul(float(j).add(0.5).mul(sds)));
          const qh = max(q.length().sub(R_PLANET), 0.0);
          sR.addAssign(exp(qh.negate().div(H_R)).mul(sds));
          sM.addAssign(exp(qh.negate().div(H_M)).mul(sds));
        });
        const tau = betaR.mul(odR.add(sR)).add(betaO.mul(odR.add(sR))).add(vec3(BETA_M * 1.1).mul(odM.add(sM)));
        const att = exp(tau.negate());
        sumR.addAssign(att.mul(dR));
        sumM.addAssign(att.mul(dM));
      });
      const mu = dot(dir, sd);
      const phaseR = float(3.0).div(PI.mul(16.0)).mul(mu.mul(mu).add(1.0));
      const g = this.mieG;
      const phaseM = float(3.0).div(PI.mul(8.0)).mul(float(1).sub(g.mul(g)).mul(mu.mul(mu).add(1.0)))
        .div(float(2).add(g.mul(g)).mul(pow(max(float(1).add(g.mul(g)).sub(g.mul(2.0).mul(mu)), 1e-4), 1.5)));
      const sky = sumR.mul(betaR).mul(phaseR).add(sumM.mul(BETA_M).mul(phaseM)).mul(this.sunIntensity);
      // the sun's disc, dimmed by the air it crosses toward the horizon
      const disc = smoothstep(0.99985, 0.99995, mu).mul(exp(betaR.mul(odR).add(vec3(BETA_M * 1.1).mul(odM)).negate())).mul(this.sunIntensity.mul(400.0));
      // below the horizon: the haze, darkening toward the ground
      const ground = this.haze.mul(smoothstep(-0.3, 0.0, dir.y).mul(0.6).add(0.2));
      return mix(sky.add(disc), ground, smoothstep(0.0, -0.02, dir.y)).max(0.0);
    })();
    return this.physicalNode;
  }
}


