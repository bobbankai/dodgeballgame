import * as TSL from 'three/tsl';
import { hash21, unpackNormal } from './common';

/**
 * Texture sampling beyond plain UVs:
 * - `triplanar`: three planar projections blended by the surface normal (no UVs needed, no stretching on any face);
 *   `triplanarNormal` swizzles each projection's tangent-space normal into world space (Golus's whiteout form).
 * - `untiled`: anti-tiling for scanned materials on large surfaces (Quilez's "texture repetition", technique 3): a low
 *   frequency noise picks a random offset per region and the two nearest offsets are blended, with the gradients of the
 *   original UV so mip selection stays stable. Repetition of a 1-2 m scan across a 30 m floor stops being visible.
 * - `parallax`: parallax occlusion mapping, ray-marched in tangent space with a linear refinement step.
 */
const T = TSL as any;
const { texture, vec2, vec3, float, abs, pow, normalize, dot, mix, fract, floor, dFdx, dFdy, Fn, Loop, If, Break, parallaxDirection, max } = T;

/** Blend weights of the three projections (sharpness ~4-8). */
export const triplanarWeights = (n: any, sharpness = 6) => {
  const w = pow(abs(n), vec3(sharpness));
  return w.div(w.x.add(w.y).add(w.z));
};

/** Colour/scalar triplanar sample. `p` position (m), `n` normal (same space), `scale` repeats per metre. */
export const triplanar = (tex: any, p: any, n: any, scale: any, sharpness = 6) => {
  const w = triplanarWeights(n, sharpness);
  const q = p.mul(scale);
  const x = texture(tex, q.zy);
  const y = texture(tex, q.xz);
  const z = texture(tex, q.xy);
  return x.mul(w.x).add(y.mul(w.y)).add(z.mul(w.z));
};

/** World/object-space normal from triplanar-projected tangent-space normal maps (Golus's whiteout blend: each
 *  projection's normal is combined with the surface normal swizzled into that projection, then swizzled back). */
export const triplanarNormal = (tex: any, p: any, n: any, scale: any, strength: any = 1, sharpness = 6) => {
  const w = triplanarWeights(n, sharpness);
  const q = p.mul(scale);
  const tx = unpackNormal(texture(tex, q.zy), strength);
  const ty = unpackNormal(texture(tex, q.xz), strength);
  const tz = unpackNormal(texture(tex, q.xy), strength);
  const bx = vec3(tx.xy.add(n.zy), abs(tx.z).mul(n.x));
  const by = vec3(ty.xy.add(n.xz), abs(ty.z).mul(n.y));
  const bz = vec3(tz.xy.add(n.xy), abs(tz.z).mul(n.z));
  return normalize(bx.zyx.mul(w.x).add(by.xzy.mul(w.y)).add(bz.xyz.mul(w.z)));
};

/**
 * Anti-tiling sample. `regions` = noise frequency in UV units (0.1-0.25: one random offset per 4-10 repeats).
 * Returns the same type the texture returns (vec4).
 */
export const untiled = (tex: any, uv: any, regions = 0.15) => Fn(() => {
  const gx = dFdx(uv);
  const gy = dFdy(uv);
  // a smooth index field over the surface
  const k = T.mx_noise_float(uv.mul(regions)).mul(0.5).add(0.5).mul(8.0);
  const i = floor(k);
  const f = fract(k);
  const offA = vec2(hash21(vec2(i, 1.7)), hash21(vec2(i, 9.3))).mul(7.0);
  const offB = vec2(hash21(vec2(i.add(1.0), 1.7)), hash21(vec2(i.add(1.0), 9.3))).mul(7.0);
  const a = texture(tex, uv.add(offA)).grad(gx, gy);
  const b = texture(tex, uv.add(offB)).grad(gx, gy);
  // blend over a narrow band, weighted by the colour difference so the seam hides in similar texels
  const diff = dot(a.rgb.sub(b.rgb), vec3(1.0)).abs();
  const t = T.smoothstep(0.2, 0.8, f.sub(diff.mul(0.1)));
  return mix(a, b, t);
})();

/**
 * Parallax occlusion: returns displaced UVs. `depth` metres of relief, `tile` repeats per metre (relief in UV units =
 * depth * tile), `steps` layers (fixed count: WGSL loops need static bounds, and gradients come from the undisplaced UV).
 */
export const parallax = (uv: any, heightTex: any, depth: number, tile: number, steps: number) => Fn(() => {
  const V = parallaxDirection.normalize().toVar();
  const gx = dFdx(uv);
  const gy = dFdy(uv);
  const layer = float(1 / steps);
  const shift = V.xy.div(max(V.z, 0.2)).mul(depth * tile).div(steps);
  const cur = uv.toVar();
  const prev = uv.toVar();
  const curD = float(0).toVar();
  const prevD = float(0).toVar();
  const mapD = float(1).sub(texture(heightTex, uv).grad(gx, gy).r).toVar();
  const prevMap = mapD.toVar();
  Loop(steps, () => {
    If(curD.greaterThanEqual(mapD), () => { Break(); });
    prev.assign(cur);
    prevD.assign(curD);
    prevMap.assign(mapD);
    cur.subAssign(shift);
    curD.addAssign(layer);
    mapD.assign(float(1).sub(texture(heightTex, cur).grad(gx, gy).r));
  });
  const after = mapD.sub(curD);
  const before = prevMap.sub(prevD);
  const w = after.div(after.sub(before).min(-1e-4)).clamp(0, 1);
  return mix(cur, prev, w);
})();
