import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as any;
const {
  Fn, float, vec3, vec4, uniform, texture3D, Loop, If, exp, max, min, dot, length, mix, clamp, smoothstep, fract, time,
  getViewPosition, interleavedGradientNoise, screenCoordinate, PI,
} = T;

/**
 * Volumetric fog lit by baked light volumes.
 *
 * Every level section ships a light volume (`<section>_vol.bin`, baked by `envkit.bake_volume`): at each cell, the light arriving
 * from the section's fixtures, shadowed by the geometry (and outdoors the occluded sky, plus whether the sun is visible). The post
 * pass marches every pixel's view ray through height fog with drifting noise, scattering that light: beams fall from fixtures,
 * windows and gaps throw shafts, the sun scatters forward (Henyey-Greenstein) and alleys stay darker than the open street.
 * The march is jittered per pixel and per frame; TRAA resolves it into a smooth medium.
 */

export interface VolumeHeader { dims: [number, number, number]; min: [number, number, number]; max: [number, number, number]; scale: number;
  sun: { dir: [number, number, number]; color: [number, number, number] } | null }
export interface LightVolume { header: VolumeHeader; tex: THREE.Data3DTexture }

/** The fog look of a place. Outdoor values come from the section's sky marker; interiors use the defaults. */
export interface FogSettings {
  density: number;      // extinction at the base height (1/m)
  heightFalloff: number; // 1/m above baseY
  baseY: number;
  noise: number;        // 0..1 drifting density variation
  noiseScale: number;   // 1/m
  wind: THREE.Vector3;  // m/s drift of the noise
  anisotropy: number;   // HG g for sunlight
  albedo: THREE.Color;
  exposure: number;     // baked radiance -> scene units
  fallback: THREE.Vector4; // light outside the volume: rgb radiance, a = sun visibility
  maxDist: number;
}

// interiors: the light volumes carry bounce light since the bake added it (2-3x the in-scatter of direct light alone), so the air is
// thinner than before for the same look: a clear room, haze only where the light is strong
export const INTERIOR_FOG: FogSettings = {
  density: 0.0024, heightFalloff: 0.05, baseY: 0, noise: 0.55, noiseScale: 0.22, wind: new THREE.Vector3(0.12, 0.03, 0.05), anisotropy: 0.45,
  albedo: new THREE.Color(0.9, 0.92, 0.95), exposure: 1, fallback: new THREE.Vector4(0.004, 0.005, 0.006, 0), maxDist: 60,
};

export const EXTERIOR_FOG: FogSettings = {
  density: 0.006, heightFalloff: 0.035, baseY: 0, noise: 0.6, noiseScale: 0.05, wind: new THREE.Vector3(1.4, 0.05, 0.6), anisotropy: 0.6,
  albedo: new THREE.Color(0.92, 0.94, 0.97), exposure: 1, fallback: new THREE.Vector4(0.3, 0.34, 0.4, 1), maxDist: 110,
};

const cache = new Map<string, Promise<LightVolume | null>>();

/** Fetch + inflate a light volume; null if the section has none (the fog then uses its fallback light). */
export function loadVolume(url: string): Promise<LightVolume | null> {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (String.fromCharCode(...buf.subarray(0, 4)) !== 'FTV1') return null;
        const hl = new DataView(buf.buffer, buf.byteOffset + 4, 4).getUint32(0, true);
        const header = JSON.parse(new TextDecoder().decode(buf.subarray(8, 8 + hl))) as VolumeHeader;
        const z = new Blob([buf.subarray(8 + hl)]).stream().pipeThrough(new DecompressionStream('deflate'));
        const data = new Uint8Array(await new Response(z).arrayBuffer());
        const [w, h, d] = header.dims;
        if (data.length !== w * h * d * 4) return null;
        const tex = new THREE.Data3DTexture(data, w, h, d);
        tex.format = THREE.RGBAFormat;
        tex.type = THREE.UnsignedByteType;
        tex.minFilter = tex.magFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
        tex.unpackAlignment = 1;
        tex.needsUpdate = true;
        return { header, tex };
      } catch (e) {
        console.warn('[fog] light volume unavailable:', url, e);
        return null;
      }
    })();
    cache.set(url, p);
  }
  return p;
}

/** A tiling 3D fbm (value noise, periodic lattice): the drifting density of the fog. */
function noiseTexture(n = 32): THREE.Data3DTexture {
  const out = new Uint8Array(n * n * n);
  const acc = new Float32Array(n * n * n);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let norm = 0;
  for (const [f, amp] of [[4, 0.55], [8, 0.3], [16, 0.15]] as const) {
    const lat = new Float32Array(f * f * f).map(rnd);
    const L = (x: number, y: number, z: number) => lat[(x % f) + ((y % f) * f) + ((z % f) * f * f)];
    const s = (t: number) => t * t * (3 - 2 * t);
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i / n) * f, y = (j / n) * f, z = (k / n) * f;
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
      const tx = s(x - x0), ty = s(y - y0), tz = s(z - z0);
      const l = (a: number, b: number, t: number) => a + (b - a) * t;
      const v = l(l(l(L(x0, y0, z0), L(x0 + 1, y0, z0), tx), l(L(x0, y0 + 1, z0), L(x0 + 1, y0 + 1, z0), tx), ty),
        l(l(L(x0, y0, z0 + 1), L(x0 + 1, y0, z0 + 1), tx), l(L(x0, y0 + 1, z0 + 1), L(x0 + 1, y0 + 1, z0 + 1), tx), ty), tz);
      acc[i + j * n + k * n * n] += v * amp;
    }
    norm += amp;
  }
  for (let i = 0; i < acc.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, (acc[i] / norm - 0.5) * 1.8 + 0.5)) * 255);
  const t = new THREE.Data3DTexture(out, n, n, n);
  t.format = THREE.RedFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

function blank(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class VolumetricFog {
  readonly u = {
    on: uniform(0),
    volMin: uniform(new THREE.Vector3()), volSize: uniform(new THREE.Vector3(1, 1, 1)), volScale: uniform(1), hasVol: uniform(0),
    fallback: uniform(new THREE.Vector4(0, 0, 0, 0)),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)), sunCol: uniform(new THREE.Color(0, 0, 0)),
    density: uniform(0.02), heightFalloff: uniform(0.05), baseY: uniform(0), noise: uniform(0.5), noiseScale: uniform(0.2),
    wind: uniform(new THREE.Vector3()), g: uniform(0.5), albedo: uniform(new THREE.Color(0.9, 0.9, 0.9)), exposure: uniform(1),
    maxDist: uniform(60), boost: uniform(1),
    projInv: uniform(new THREE.Matrix4()), camWorld: uniform(new THREE.Matrix4()), camPos: uniform(new THREE.Vector3()),
    frame: uniform(0),
  };
  private volNode = texture3D(blank());
  private noiseNode = texture3D(noiseTexture());
  private current: LightVolume | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Light volume of the section the camera is in (null: fallback light only). */
  setVolume(v: LightVolume | null): void {
    if (v === this.current) return;
    this.current = v;
    const u = this.u as any;
    if (!v) { u.hasVol.value = 0; return; }
    const h = v.header;
    u.volMin.value.set(...h.min);
    u.volSize.value.set(h.max[0] - h.min[0], h.max[1] - h.min[1], h.max[2] - h.min[2]);
    u.volScale.value = h.scale;
    this.volNode.value = v.tex;
    u.hasVol.value = 1;
    if (h.sun) {
      u.sunDir.value.set(...h.sun.dir).normalize();
      u.sunCol.value.setRGB(...h.sun.color);
    } else u.sunCol.value.setRGB(0, 0, 0);
  }

  apply(s: FogSettings): void {
    const u = this.u as any;
    u.density.value = s.density;
    u.heightFalloff.value = s.heightFalloff;
    u.baseY.value = s.baseY;
    u.noise.value = s.noise;
    u.noiseScale.value = s.noiseScale;
    u.wind.value.copy(s.wind);
    u.g.value = s.anisotropy;
    u.albedo.value.copy(s.albedo);
    u.exposure.value = s.exposure;
    u.fallback.value.copy(s.fallback);
    u.maxDist.value = s.maxDist;
  }

  /** Per frame, before the pipeline renders. */
  update(): void {
    const u = this.u as any;
    this.camera.updateMatrixWorld();
    u.projInv.value.copy(this.camera.projectionMatrixInverse);
    u.camWorld.value.copy(this.camera.matrixWorld);
    u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.frame.value = (u.frame.value + 1) % 4096;
  }

  /** Light filling the air at world point p (baked volume, or the fallback outside it), for things in the air: rain, dust, sparks.
   *  `dir` (toward the eye) sets the sun's forward scattering. */
  /** The baked light at world point p, split for surfaces that are not lightmapped (foliage): `iso` = mean radiance arriving
   *  from all directions (fixtures + sky), `sunVis` = 0..1 sun visibility, plus the sun's direction and colour. */
  lightTerms(p: any): { iso: any; sunVis: any; sunDir: any; sunCol: any } {
    const u = this.u as any;
    const uvw = p.sub(u.volMin).div(u.volSize);
    const edge = min(min(uvw.x, uvw.y), min(uvw.z, min(float(1).sub(uvw.x), min(float(1).sub(uvw.y), float(1).sub(uvw.z)))));
    const w = smoothstep(0.0, 0.02, edge).mul(u.hasVol);
    const v = this.volNode.sample(clamp(uvw, 0.0, 1.0));
    const raw = v.rgb.mul(v.rgb).mul(u.volScale).mul(u.exposure);
    return { iso: mix(u.fallback.rgb, raw, w), sunVis: mix(u.fallback.a, v.a, w), sunDir: u.sunDir, sunCol: vec3(u.sunCol) };
  }

  lightAt(p: any, dir: any = null): any {
    const u = this.u as any;
    const uvw = p.sub(u.volMin).div(u.volSize);
    const edge = min(min(uvw.x, uvw.y), min(uvw.z, min(float(1).sub(uvw.x), min(float(1).sub(uvw.y), float(1).sub(uvw.z)))));
    const w = smoothstep(0.0, 0.02, edge).mul(u.hasVol);
    const v = this.volNode.sample(clamp(uvw, 0.0, 1.0));
    const iso = mix(u.fallback.rgb, v.rgb.mul(v.rgb).mul(u.volScale).mul(u.exposure), w);
    const sunVis = mix(u.fallback.a, v.a, w);
    const ph = dir ? dot(dir.negate(), u.sunDir).mul(0.5).add(0.5).pow(4.0).mul(2.0).add(0.15) : float(0.25);
    return iso.add(vec3(u.sunCol).mul(sunVis).mul(ph));
  }

  /** The fogged colour: `color` (HDR scene) seen through `steps` jittered samples of the medium along each pixel's ray. */
  node(color: any, depthTex: any, uvNode: any, steps: number): any {
    const u = this.u as any;
    const vol = this.volNode;
    const noise = this.noiseNode;
    return Fn(() => {
      const depth = depthTex.sample(uvNode).r;
      const viewPos = getViewPosition(uvNode, depth, u.projInv);
      const worldPos = u.camWorld.mul(vec4(viewPos, 1.0)).xyz;
      const ray = worldPos.sub(u.camPos);
      const sceneDist = length(ray);
      const dir = ray.div(max(sceneDist, 1e-4));
      const isSky = depth.greaterThanEqual(0.99999);
      const marchDist = min(sceneDist, u.maxDist);
      const jitter = fract(interleavedGradientNoise(screenCoordinate.xy).add(u.frame.mul(0.61803398)));
      // Henyey-Greenstein for the sun, normalised over the sphere
      const g = u.g;
      const cosT = dot(dir, u.sunDir);
      const hgDen = max(float(1).add(g.mul(g)).sub(g.mul(2).mul(cosT)), 1e-4);
      const phase = float(1).sub(g.mul(g)).div(hgDen.mul(hgDen.sqrt()).mul(PI.mul(4)));
      const sun = vec3(u.sunCol).mul(phase);
      const trans = float(1).toVar();
      const scat = vec3(0).toVar();
      const drift = u.wind.mul(time);
      Loop(steps, ({ i }: any) => {
        // quadratic spacing: dense near the eye (where shafts and halos are resolved), sparse far away
        const a0 = float(i).div(steps);
        const a1 = float(i).add(1.0).div(steps);
        const t0 = a0.mul(a0).mul(marchDist);
        const t1 = a1.mul(a1).mul(marchDist);
        const ds = t1.sub(t0);
        const t = t0.add(jitter.mul(ds));
        const p = u.camPos.add(dir.mul(t));
        // baked light here (blend to the fallback across the last cell of the volume's box)
        const uvw = p.sub(u.volMin).div(u.volSize);
        const edge = min(min(uvw.x, uvw.y), min(uvw.z, min(float(1).sub(uvw.x), min(float(1).sub(uvw.y), float(1).sub(uvw.z)))));
        const w = smoothstep(0.0, 0.02, edge).mul(u.hasVol);
        const v = vol.sample(clamp(uvw, 0.0, 1.0));
        const raw = v.rgb.mul(v.rgb).mul(u.volScale).mul(u.exposure);
        // soft shoulder: the air right at a very bright fixture glows without swamping the room
        const baked = raw.div(max(max(raw.r, raw.g), raw.b).mul(0.45).add(1.0));
        const iso = mix(u.fallback.rgb, baked, w);
        const sunVis = mix(u.fallback.a, v.a, w);
        // medium: height fog with drifting fbm
        const n = noise.sample(p.mul(u.noiseScale).add(drift.mul(u.noiseScale))).r;
        const sigma = u.density.mul(exp(max(p.y.sub(u.baseY), 0.0).negate().mul(u.heightFalloff)))
          .mul(mix(float(1), n.mul(2.0), u.noise)).mul(u.boost);
        const src = iso.add(sun.mul(sunVis)).mul(vec3(u.albedo)).mul(sigma);
        const tr = exp(sigma.mul(ds).negate());
        // energy-conserving step integration (Hillaire 2015)
        scat.addAssign(trans.mul(src.sub(src.mul(tr)).div(max(sigma, 1e-6))));
        trans.mulAssign(tr);
      });
      // beyond the march (distant geometry only; the sky keeps its own colour past maxDist): analytic haze with the fallback light
      If(isSky.not().and(sceneDist.greaterThan(u.maxDist)), () => {
        const tail = min(sceneDist, 2000.0).sub(u.maxDist);
        const yEnd = u.camPos.y.add(dir.y.mul(u.maxDist));
        const sigma = u.density.mul(exp(max(yEnd.sub(u.baseY), 0.0).negate().mul(u.heightFalloff))).mul(u.boost);
        const tr = exp(sigma.mul(tail).negate());
        const src = u.fallback.rgb.add(sun.mul(u.fallback.a)).mul(vec3(u.albedo));
        scat.addAssign(trans.mul(src).mul(tr.oneMinus()));
        trans.mulAssign(tr);
      });
      const on = u.on;
      return vec4(mix(color.rgb, color.rgb.mul(trans).add(scat), on), color.a);
    })();
  }
}
