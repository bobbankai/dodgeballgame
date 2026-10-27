import * as THREE from 'three';

let tex: THREE.DataTexture | null = null;

/**
 * A tileable 512² sheet of cold-press watercolour paper: soft tooth (low-frequency
 * bumps), long fibres and fine grain. RGB is a multiplier around 1, G alone is the grain.
 */
export function paperTexture(): THREE.DataTexture {
  if (tex) return tex;
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  const tooth = periodicNoise(N, 24, 7);
  const fine = periodicNoise(N, 160, 3);
  const fibre = new Float32Array(N * N);
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 900; k++) {
    let x = rnd() * N, y = rnd() * N;
    let a = rnd() * Math.PI * 2;
    const len = 20 + rnd() * 60;
    const dark = rnd() < 0.5 ? -1 : 1;
    for (let t = 0; t < len; t++) {
      a += (rnd() - 0.5) * 0.25;
      x += Math.cos(a);
      y += Math.sin(a);
      const i = ((Math.floor(y) % N + N) % N) * N + ((Math.floor(x) % N + N) % N);
      fibre[i] += dark * 0.5;
    }
  }
  for (let i = 0; i < N * N; i++) {
    const t = tooth[i], f = fine[i], fb = fibre[i];
    const v = 0.93 + 0.05 * t + 0.03 * f + 0.02 * fb;
    data[i * 4] = Math.round(255 * Math.min(1, v));
    data[i * 4 + 1] = Math.round(255 * Math.min(1, 0.5 + 0.5 * f));
    data[i * 4 + 2] = Math.round(255 * Math.min(1, 0.85 + 0.15 * t));
    data[i * 4 + 3] = 255;
  }
  tex = new THREE.DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise in [-1, 1] with `cells` lattice cells across the tile. */
function periodicNoise(n: number, cells: number, seed: number): Float32Array {
  const lat = new Float32Array(cells * cells);
  let s = seed * 9973;
  for (let i = 0; i < lat.length; i++) lat[i] = ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const L = (i: number, j: number) => lat[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const a = L(x0, y0) + (L(x0 + 1, y0) - L(x0, y0)) * sx;
      const b = L(x0, y0 + 1) + (L(x0 + 1, y0 + 1) - L(x0, y0 + 1)) * sx;
      out[y * n + x] = a + (b - a) * sy;
    }
  return out;
}
