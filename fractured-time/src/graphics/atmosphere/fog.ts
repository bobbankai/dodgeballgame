import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { FogStage } from '../postprocessing/FrameGraph';

/**
 * Volumetric fog lit by the baked light volumes.
 *
 * Every level section ships a light volume (`<section>_vol.bin`, envkit.bake_volume): per cell, the light arriving from the
 * section's fixtures and sky, shadowed by the geometry (rgb, stored as sqrt for precision), plus whether the sun is visible
 * there (a). The frame graph marches each pixel's view ray through height fog with drifting density, scattering that light:
 * beams fall from fixtures, windows and breaches throw shafts, the sun scatters forward, alleys stay darker than the street.
 *
 * - Samples are spaced quadratically (dense near the eye, where shafts resolve) and jittered per pixel and frame
 *   (interleaved gradient noise + the golden ratio); the temporal resolve turns the noise into a smooth medium.
 * - Scattering uses a two-lobe Henyey-Greenstein phase for the sun (a strong forward lobe and a weak back lobe: haze glows
 *   round the sun and still reads when the sun is behind the viewer); baked light is isotropic in-scatter.
 * - Integration is energy conserving per step (Hillaire 2015).
 * - Past the march distance the remaining height fog is integrated analytically (exact for exponential height density),
 *   lit by the fallback light, so far geometry hazes without a seam.
 */
const T = TSL as any;
const { Fn, float, vec3, vec4, uniform, texture3D, Loop, If, exp, max, min, dot, length, mix, clamp, smoothstep, fract, time, abs, select,
  getViewPosition, interleavedGradientNoise, screenCoordinate, PI } = T;

export interface VolumeHeader {
  dims: [number, number, number]; min: [number, number, number]; max: [number, number, number]; scale: number;
  sun: { dir: [number, number, number]; color: [number, number, number] } | null;
}
export interface LightVolume {
  header: VolumeHeader; tex: THREE.Data3DTexture;
  /** mean light of the top layer (outdoors the air above the box is lit about as much, or the lid shows across the sky) */
  top: [number, number, number];
}

/** The look of the air in a place. */
export interface FogSettings {
  density: number;       // extinction at the base height (1/m)
  heightFalloff: number; // 1/m above baseY
  baseY: number;
  noise: number;         // 0..1 drifting density variation
  noiseScale: number;    // 1/m
  wind: THREE.Vector3;   // m/s drift of the noise
  anisotropy: number;    // forward lobe g for sunlight
  albedo: THREE.Color;
  exposure: number;      // baked radiance -> scene units
  fallback: THREE.Vector4; // light outside the volume: rgb radiance, a = sun visibility
  maxDist: number;
}

export const INTERIOR_FOG: FogSettings = {
  density: 0.0024, heightFalloff: 0.05, baseY: 0, noise: 0.55, noiseScale: 0.22, wind: new THREE.Vector3(0.12, 0.03, 0.05), anisotropy: 0.45,
  albedo: new THREE.Color(0.9, 0.92, 0.95), exposure: 1, fallback: new THREE.Vector4(0.004, 0.005, 0.006, 0), maxDist: 60,
};

export const EXTERIOR_FOG: FogSettings = {
  density: 0.006, heightFalloff: 0.035, baseY: 0, noise: 0.6, noiseScale: 0.05, wind: new THREE.Vector3(1.4, 0.05, 0.6), anisotropy: 0.6,
  albedo: new THREE.Color(0.92, 0.94, 0.97), exposure: 1, fallback: new THREE.Vector4(0.3, 0.34, 0.4, 1), maxDist: 110,
};

const cache = new Map<string, Promise<LightVolume | null>>();

/** Fetch + inflate a light volume (FTV1: magic, header length, JSON header, deflated RGBA8 cells); null if absent. */
export function loadVolume(url: string): Promise<LightVolume | null> {
  let p = cache.get(url);
  if (p) return p;
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
      const top: [number, number, number] = [0, 0, 0];
      for (let zi = 0; zi < d; zi++) for (let xi = 0; xi < w; xi++) {
        const o = ((zi * h + (h - 1)) * w + xi) * 4;
        const c = [0, 1, 2].map((k) => (data[o + k] / 255) ** 2 * header.scale);
        const sh = Math.max(c[0], c[1], c[2]) * 0.45 + 1;
        for (let k = 0; k < 3; k++) top[k] += c[k] / sh;
      }
      for (let k = 0; k < 3; k++) top[k] /= w * d;
      return { header, tex, top };
    } catch (e) {
      console.warn('[fog] light volume unavailable:', url, e);
      return null;
    }
  })();
  cache.set(url, p);
  return p;
}

/** A tiling 3D fBm (value noise on a periodic lattice): the drifting density of the air. */
function densityNoise(n = 32): THREE.Data3DTexture {
  const out = new Uint8Array(n * n * n);
  const acc = new Float32Array(n * n * n);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let norm = 0;
  for (const [f, amp] of [[4, 0.55], [8, 0.3], [16, 0.15]] as const) {
    const lat = new Float32Array(f * f * f).map(rnd);
    const L = (x: number, y: number, z: number) => lat[(x % f) + ((y % f) * f) + ((z % f) * f * f)];
    const s = (t: number) => t * t * (3 - 2 * t);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i / n) * f, y = (j / n) * f, z = (k / n) * f;
      const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
      const tx = s(x - x0), ty = s(y - y0), tz = s(z - z0);
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

function emptyVolume(): THREE.Data3DTexture {
  const t = new THREE.Data3DTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, 1);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Two-lobe Henyey-Greenstein, normalised over the sphere: forward lobe g, back lobe -0.3, mixed 85/15. */
const phase2 = (cosT: any, g: any) => {
  const hg = (gg: any) => {
    const den = max(float(1).add(gg.mul(gg)).sub(gg.mul(2).mul(cosT)), 1e-4);
    return float(1).sub(gg.mul(gg)).div(den.mul(den.sqrt()).mul(PI.mul(4)));
  };
  return hg(g).mul(0.85).add(hg(float(-0.3)).mul(0.15));
};

export class VolumetricFog implements FogStage {
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
  private vol = texture3D(emptyVolume());
  private noiseTex = texture3D(densityNoise());
  private current: LightVolume | null = null;

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** The light volume of the section the camera is in (null: fallback light only). */
  setVolume(v: LightVolume | null): void {
    if (v === this.current) return;
    this.current = v;
    const u = this.u as any;
    if (!v) { u.hasVol.value = 0; return; }
    const h = v.header;
    u.volMin.value.set(...h.min);
    u.volSize.value.set(h.max[0] - h.min[0], h.max[1] - h.min[1], h.max[2] - h.min[2]);
    u.volScale.value = h.scale;
    this.vol.value = v.tex;
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

  /** Per frame, before the frame graph renders. */
  update(): void {
    const u = this.u as any;
    this.camera.updateMatrixWorld();
    u.projInv.value.copy(this.camera.projectionMatrixInverse);
    u.camWorld.value.copy(this.camera.matrixWorld);
    u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
    u.frame.value = (u.frame.value + 1) % 4096;
  }

  /** How much the baked volume (vs the fallback) lights the air at volume coordinate uvw: thin margins at the walls and
   *  floor, the upper 8 m (at most a third) at the lid, so the box's top never shows as a lit dome on the sky. */
  private inside(uvw: any): any {
    const u = this.u as any;
    const edge = min(min(uvw.x, uvw.y), min(uvw.z, min(float(1).sub(uvw.x), float(1).sub(uvw.z))));
    const lid = min(float(8.0).div(max(u.volSize.y, 1.0)), float(0.33));
    return smoothstep(0.0, 0.02, edge).mul(smoothstep(0.0, lid, float(1).sub(uvw.y))).mul(u.hasVol);
  }

  private bakedAt(p: any): { light: any; sun: any } {
    const u = this.u as any;
    const uvw = p.sub(u.volMin).div(u.volSize);
    const w = this.inside(uvw);
    const v = this.vol.sample(clamp(uvw, 0.0, 1.0));
    const raw = v.rgb.mul(v.rgb).mul(u.volScale).mul(u.exposure);
    return { light: mix(u.fallback.rgb, raw, w), sun: mix(u.fallback.a, v.a, w) };
  }

  /** Baked light at p split for surfaces that are not lightmapped (foliage): isotropic light, sun visibility, sun. */
  lightTerms(p: any): { iso: any; sunVis: any; sunDir: any; sunCol: any } {
    const u = this.u as any;
    const b = this.bakedAt(p);
    return { iso: b.light, sunVis: b.sun, sunDir: u.sunDir, sunCol: vec3(u.sunCol) };
  }

  /** Light filling the air at p, for things in it (rain, dust, sparks); `dir` (toward the eye) sets the sun's forward glow. */
  lightAt(p: any, dir: any = null): any {
    const u = this.u as any;
    const b = this.bakedAt(p);
    const ph = dir ? phase2(dot(dir.negate(), u.sunDir), u.g).mul(PI.mul(4)) : float(1);
    return b.light.add(vec3(u.sunCol).mul(b.sun).mul(ph.mul(0.25)));
  }

  /** The fogged colour: `color` (HDR scene) seen through `steps` jittered samples of the medium along each pixel's ray. */
  node(color: any, depthTex: any, uvNode: any, steps: number): any {
    const u = this.u as any;
    const vol = this.vol;
    const noise = this.noiseTex;
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
      const sun = vec3(u.sunCol).mul(phase2(dot(dir, u.sunDir), u.g));
      const trans = float(1).toVar();
      const scat = vec3(0).toVar();
      const drift = u.wind.mul(time);
      Loop(steps, ({ i }: any) => {
        const a0 = float(i).div(steps);
        const a1 = float(i).add(1.0).div(steps);
        const t0 = a0.mul(a0).mul(marchDist);
        const ds = a1.mul(a1).mul(marchDist).sub(t0);
        const p = u.camPos.add(dir.mul(t0.add(jitter.mul(ds))));
        const uvw = p.sub(u.volMin).div(u.volSize);
        const w = this.inside(uvw);
        const v = vol.sample(clamp(uvw, 0.0, 1.0));
        const raw = v.rgb.mul(v.rgb).mul(u.volScale).mul(u.exposure);
        // soft shoulder: the air right at a very bright fixture glows without swamping the room
        const baked = raw.div(max(max(raw.r, raw.g), raw.b).mul(0.45).add(1.0));
        const iso = mix(u.fallback.rgb, baked, w);
        const sunVis = mix(u.fallback.a, v.a, w);
        const n = noise.sample(p.mul(u.noiseScale).add(drift.mul(u.noiseScale))).r;
        const sigma = u.density.mul(exp(max(p.y.sub(u.baseY), 0.0).negate().mul(u.heightFalloff))).mul(mix(float(1), n.mul(2.0), u.noise)).mul(u.boost);
        const src = iso.add(sun.mul(sunVis)).mul(vec3(u.albedo)).mul(sigma);
        const tr = exp(sigma.mul(ds).negate());
        scat.addAssign(trans.mul(src.sub(src.mul(tr)).div(max(sigma, 1e-6))));
        trans.mulAssign(tr);
      });
      // beyond the march: exact optical depth of exponential height fog from maxDist to the surface (2 km at most)
      If(isSky.not().and(sceneDist.greaterThan(u.maxDist)), () => {
        const L = min(sceneDist, 2000.0).sub(u.maxDist);
        const y0 = u.camPos.y.add(dir.y.mul(u.maxDist)).sub(u.baseY);
        const k = u.heightFalloff;
        const dy = dir.y.mul(k);
        const startD = exp(max(y0, 0.0).negate().mul(k));
        // integral of exp(-k (y0 + dir.y s)) ds over [0, L]; for a level ray the limit is L
        const integral = select(abs(dy).lessThan(1e-4), L, startD.mul(float(1).sub(exp(dy.mul(L).negate()))).div(dy));
        const od = u.density.mul(u.boost).mul(select(abs(dy).lessThan(1e-4), startD.mul(L), integral));
        const tr = exp(od.negate());
        const src = u.fallback.rgb.add(sun.mul(u.fallback.a)).mul(vec3(u.albedo));
        scat.addAssign(trans.mul(src).mul(tr.oneMinus()));
        trans.mulAssign(tr);
      });
      return vec4(mix(color.rgb, color.rgb.mul(trans).add(scat), u.on), color.a);
    })();
  }
}
