// Small deterministic noise for level height functions (value noise + fbm) and shaping helpers.
function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function noise2(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi, seed), b = hash(xi + 1, zi, seed), c = hash(xi, zi + 1, seed), d = hash(xi + 1, zi + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x: number, z: number, oct = 4, seed = 0): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, z * f, seed + i * 17); a *= 0.5; f *= 2.03; }
  return s;
}

export const clamp = (x: number, a = 0, b = 1): number => Math.max(a, Math.min(b, x));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }

/** Distance from p to segment ab (2D) and the parameter t along it. */
export function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  return [Math.hypot(px - ax - dx * t, pz - az - dz * t), t];
}

/** Distance to a polyline and the arc-length fraction along it. */
export function pathDist(px: number, pz: number, pts: [number, number][]): [number, number] {
  let best = 1e9, bestT = 0, acc = 0;
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  for (let i = 0; i < pts.length - 1; i++) {
    const [d, t] = segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) { best = d; bestT = (acc + t * lens[i]) / total; }
    acc += lens[i];
  }
  return [best, bestT];
}

/** Flat-topped bump: `h` inside radius r0, falling to 0 at r1 (elliptical with sx, sz). */
export function plateau(x: number, z: number, cx: number, cz: number, r0: number, r1: number, h: number, sx = 1, sz = 1): number {
  const d = Math.hypot((x - cx) / sx, (z - cz) / sz);
  return h * (1 - smoothstep(r0, r1, d));
}
