import * as TSL from 'three/tsl';

/**
 * Small building blocks every material uses: colour helpers, noise wrappers, normal blending, hashes.
 * All functions take and return TSL nodes. (TSL's static types are too strict for node arithmetic; nodes are `any` here.)
 */
const T = TSL as any;
const { vec2, vec3, float, dot, mix, normalize, fract, sin, floor, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, smoothstep, max } = T;

export const LUMA = () => vec3(0.2126, 0.7152, 0.0722);

/** Rec.709 luminance. */
export const luminance = (c: any) => dot(c, LUMA());

/** Saturation around the luminance (0 grey .. 1 unchanged .. >1 boosted). */
export const saturate = (c: any, s: any) => mix(vec3(luminance(c)), c, s);

/** A 0..1 hash of a 2D cell (sine-free: stable on every GPU at large coordinates within a level). */
export const hash21 = (p: any) => {
  const q = fract(p.mul(vec2(0.1031, 0.1030)));
  const d = dot(vec3(q.x, q.y, q.x), vec3(q.y, q.x, q.y).add(33.33));
  return fract(q.x.add(q.y).add(d).mul(q.x.add(d)));
};

/** A 0..1 hash of a 3D cell. */
export const hash31 = (p: any) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.zyx.add(31.32)));
  return fract(q.x.add(q.y).mul(q.z));
};

/** fBm in [0, 1] (MaterialX Perlin fractal), `freq` per metre. */
export const fbm = (p: any, freq: number | any, octaves = 3, lacunarity = 2.0, gain = 0.5) =>
  mx_fractal_noise_float(p.mul(freq), octaves, lacunarity, gain).mul(0.5).add(0.5);

/** Perlin noise in [0, 1]. */
export const noise = (p: any, freq: number | any) => mx_noise_float(p.mul(freq)).mul(0.5).add(0.5);

/** Worley (cellular) distance to the nearest feature, ~0..1. */
export const cells = (p: any, freq: number | any, jitter = 1.0) => mx_worley_noise_float(p.mul(freq), jitter);

/** Domain warp: p moved by a smooth vector field. */
export const warp = (p: any, freq: number, amount: number) => p.add(vec3(
  mx_fractal_noise_float(p.mul(freq), 2, 2.0, 0.5),
  mx_fractal_noise_float(p.mul(freq).add(vec3(5.2, 1.3, 7.1)), 2, 2.0, 0.5),
  mx_fractal_noise_float(p.mul(freq).add(vec3(1.7, 9.2, 3.4)), 2, 2.0, 0.5),
).mul(amount));

/** Tangent-space normal from a [0,1] sample (OpenGL convention). */
export const unpackNormal = (s: any, strength: any = 1) => {
  const n = s.xyz.mul(2.0).sub(1.0);
  return normalize(vec3(n.xy.mul(strength), n.z));
};

/** Whiteout blend of two tangent-space normals (detail on top of base). */
export const blendNormals = (a: any, b: any) => normalize(vec3(a.xy.add(b.xy), a.z.mul(b.z)));

/** Reoriented normal mapping (Barré-Brisebois & Hill): detail `d` follows the base `b` exactly. */
export const reorientNormals = (b: any, d: any) => {
  const t = b.add(vec3(0, 0, 1));
  const u = d.mul(vec3(-1, -1, 1));
  return normalize(t.mul(dot(t, u)).div(t.z).sub(u));
};

/** Soft threshold of a 0..1 field: `edge` +- `soft`. */
export const threshold = (v: any, edge: any, soft: any) => smoothstep(float(edge).sub(soft), float(edge).add(soft), v);

/** Old-style sine hash (only for small, bounded inputs such as integer ids). */
export const hashId = (n: any) => fract(sin(n.mul(12.9898)).mul(43758.5453));

/** Integer cell of a coordinate. */
export const cellOf = (p: any, size: any) => floor(p.div(size));

export const clamp01 = (v: any) => max(float(0), v).min(1.0);
