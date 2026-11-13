import { Constants, RawTexture3D, Texture, type Scene } from '@babylonjs/core';

const cache = new WeakMap<Scene, RawTexture3D>();

/** The scene's shared tileable 64^3 noise volume (fog, clouds, effects). */
export function sharedNoise3D(scene: Scene): RawTexture3D {
  let t = cache.get(scene);
  if (!t) {
    t = createNoise3D(scene);
    cache.set(scene, t);
  }
  return t;
}

/**
 * Tileable 3D noise volume (64^3, RGBA8), generated once at start-up:
 *  R = value-noise fbm (fog, smoke), G = inverted Worley fbm (cloud erosion, cells),
 *  B = Perlin-Worley (value fbm remapped by Worley: billowy cloud shapes), A = 1.
 */
export function createNoise3D(scene: Scene, size = 64): RawTexture3D {
  const n = size;
  const rng = (seed: number) => {
    let s = (seed * 2654435761) >>> 0 || 1;
    return () => {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return (s & 0xffffff) / 0x1000000;
    };
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = new Float32Array(n * n * n);
  const octaves = [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]] as const;
  octaves.forEach(([p, w], k) => {
    const r = rng(17 + k * 31);
    const g = new Float32Array(p * p * p);
    for (let i = 0; i < g.length; i++) g[i] = r();
    const at = (a: number, b: number, c: number) => g[((c % p) * p + (b % p)) * p + (a % p)];
    for (let z = 0; z < n; z++) {
      const fz = (z / n) * p, z0 = Math.floor(fz), tz = smooth(fz - z0);
      for (let y = 0; y < n; y++) {
        const fy = (y / n) * p, y0 = Math.floor(fy), ty = smooth(fy - y0);
        for (let x = 0; x < n; x++) {
          const fx = (x / n) * p, x0 = Math.floor(fx), tx = smooth(fx - x0);
          const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx;
          const c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
          const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx;
          const c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
          value[(z * n + y) * n + x] += w * ((c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz);
        }
      }
    }
  });
  // Worley: distance to the nearest feature point in a tiling grid of cells
  const worley = new Float32Array(n * n * n);
  const wOct = [[4, 0.625], [8, 0.25], [16, 0.125]] as const;
  wOct.forEach(([cells, w], k) => {
    const r = rng(101 + k * 53);
    const pts = new Float32Array(cells * cells * cells * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = r();
    const cs = n / cells;
    for (let z = 0; z < n; z++) {
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const cx = Math.floor(x / cs), cy = Math.floor(y / cs), cz = Math.floor(z / cs);
          let best = 1e9;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const ix = cx + dx, iy = cy + dy, iz = cz + dz;
                const wx = ((ix % cells) + cells) % cells, wy = ((iy % cells) + cells) % cells, wz = ((iz % cells) + cells) % cells;
                const pi = ((wz * cells + wy) * cells + wx) * 3;
                const px = (ix + pts[pi]) * cs, py = (iy + pts[pi + 1]) * cs, pz = (iz + pts[pi + 2]) * cs;
                const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
                if (d < best) best = d;
              }
            }
          }
          worley[(z * n + y) * n + x] += w * (1 - Math.min(1, Math.sqrt(best) / cs));
        }
      }
    }
  });
  const data = new Uint8Array(n * n * n * 4);
  for (let i = 0; i < n * n * n; i++) {
    const v = Math.min(1, value[i]);
    const wv = Math.min(1, worley[i]);
    // Perlin-Worley: remap value noise into the Worley range (Schneider, "The Real-time Volumetric Cloudscapes of Horizon Zero Dawn")
    const pw = Math.max(0, Math.min(1, (v - (wv - 1)) / (1 - (wv - 1)) * 1.6 - 0.45));
    data[i * 4] = Math.round(v * 255);
    data[i * 4 + 1] = Math.round(wv * 255);
    data[i * 4 + 2] = Math.round(pw * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new RawTexture3D(data, n, n, n, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
    Texture.TRILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.wrapR = Texture.WRAP_ADDRESSMODE;
  return tex;
}
