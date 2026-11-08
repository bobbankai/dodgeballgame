import { Constants, RawTexture, Texture, type Scene } from '@babylonjs/core';

/**
 * Particle sprites generated at start-up (no image files): a soft round blob, a hot spark streak, a
 * billowing smoke puff, a flame tongue and a thin ring. All premultiplied-friendly RGBA with the
 * shape in alpha and a white-hot core in colour.
 */
const cache = new WeakMap<Scene, Record<string, Texture>>();

function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const p = (v: number) => ((v % period) + period) % period;
  const a = hash(p(xi), p(yi), seed);
  const b = hash(p(xi + 1), p(yi), seed);
  const c = hash(p(xi), p(yi + 1), seed);
  const d = hash(p(xi + 1), p(yi + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed: number): number {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < 5; i++) {
    s += a * vnoise(x * f, y * f, 64 * f, seed + i);
    f *= 2;
    a *= 0.5;
  }
  return s;
}

function make(scene: Scene, n: number, fn: (u: number, v: number) => [number, number, number, number]): Texture {
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [r, g, b, a] = fn((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1);
      const i = (y * n + x) * 4;
      data[i] = Math.round(Math.min(1, Math.max(0, r)) * 255);
      data[i + 1] = Math.round(Math.min(1, Math.max(0, g)) * 255);
      data[i + 2] = Math.round(Math.min(1, Math.max(0, b)) * 255);
      data[i + 3] = Math.round(Math.min(1, Math.max(0, a)) * 255);
    }
  }
  const t = RawTexture.CreateRGBATexture(data, n, n, scene, true, false, Constants.TEXTURE_TRILINEAR_SAMPLINGMODE);
  t.wrapU = Texture.CLAMP_ADDRESSMODE;
  t.wrapV = Texture.CLAMP_ADDRESSMODE;
  return t;
}

export function fxTextures(scene: Scene): Record<string, Texture> {
  let t = cache.get(scene);
  if (t) return t;
  t = {
    soft: make(scene, 64, (u, v) => {
      const r2 = u * u + v * v;
      const a = Math.exp(-r2 * 4.5) * (1 - Math.min(1, r2));
      return [1, 1, 1, a];
    }),
    spark: make(scene, 64, (u, v) => {
      // a streak along v with a hot core (stretched billboards align v with velocity)
      const a = Math.exp(-u * u * 40) * Math.exp(-v * v * 2.5);
      const core = Math.exp(-u * u * 160) * Math.exp(-v * v * 6);
      return [1, 1, 1, Math.min(1, a + core)];
    }),
    smoke: make(scene, 128, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const n = fbm(u * 3 + 7, v * 3 + 3, 11);
      const edge = 1 - smooth(0.35, 1.0, r + (n - 0.5) * 0.7);
      const shade = 0.75 + 0.25 * fbm(u * 5, v * 5, 17) - v * 0.12;
      return [shade, shade, shade, edge * (0.55 + 0.45 * n)];
    }),
    flame: make(scene, 128, (u, v) => {
      // teardrop: wide at the base (v = 1), pointed at the top
      const w = 0.25 + 0.55 * smooth(-1, 0.9, v);
      const n = fbm(u * 4 + 1, v * 2.5 + 5, 23);
      const d = Math.abs(u) / w + (n - 0.5) * 0.6;
      const a = (1 - smooth(0.5, 1, d)) * smooth(-1, -0.4, -Math.abs(v) + 0.2 + n * 0.4);
      const hot = 1 - smooth(0, 0.7, d);
      return [1, 0.6 + 0.4 * hot, 0.25 + 0.75 * hot * hot, a];
    }),
    ring: make(scene, 128, (u, v) => {
      const r = Math.sqrt(u * u + v * v);
      const a = Math.exp(-((r - 0.82) ** 2) * 260) + 0.25 * Math.exp(-((r - 0.82) ** 2) * 30) * (r < 0.82 ? 1 : 0);
      return [1, 1, 1, a];
    }),
  };
  cache.set(scene, t);
  return t;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
