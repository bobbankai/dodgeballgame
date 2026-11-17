import * as TSL from 'three/tsl';
import type { ToneMapper } from '../config/presets';

const T = TSL as any;
const { Fn, vec3, float, mat3, max, min, log2, pow, clamp, dot, mix, select } = T;

/**
 * Tone mapping: scene-linear HDR (already exposed) -> display-linear [0, 1] (the sRGB encode follows at the very end).
 *
 * `agx` is our own implementation of Troy Sobotka's AgX (the transform the Cycles look-dev uses), with the AgX "look" exposed:
 * an ASC CDL applied in AgX's log-encoded space before the outset, which is how Blender's Punchy / Golden looks work. It
 * keeps hue paths to white for over-exposed lights (neon, the Engine) instead of the skew of per-channel curves.
 * `aces` is Hill's fitted ACES RRT+ODT, `neutral` Khronos PBR Neutral, `filmic` Hable's curve; all hand-written here.
 */
export interface AgxLook {
  /** CDL in AgX space: out = (in * slope + offset) ^ power, then saturation around the luminance */
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  saturation: number;
}
export const AGX_LOOKS: Record<'base' | 'punchy' | 'golden', AgxLook> = {
  base: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1 },
  punchy: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1.35, 1.35, 1.35], saturation: 1.4 },
  golden: { slope: [1, 0.9, 0.5], offset: [0, 0, 0], power: [0.8, 0.8, 0.8], saturation: 0.8 },
};

// Rec.709 <-> Rec.2020 primaries (AgX's inset/outset are defined in Rec.2020)
const SRGB_TO_2020 = () => mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const R2020_TO_SRGB = () => mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
const INSET = () => mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
  vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
const OUTSET = () => mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
  vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
const MIN_EV = -12.47393;
const MAX_EV = 4.026069;

/** AgX's sigmoid, a 6th order polynomial fit (Sobotka / Benjamin Wrensch). */
const agxCurve = (x: any) => {
  const x2 = x.mul(x);
  const x4 = x2.mul(x2);
  return x4.mul(x2).mul(15.5).sub(x4.mul(x).mul(40.14)).add(x4.mul(31.96)).sub(x2.mul(x).mul(6.868)).add(x2.mul(0.4298)).add(x.mul(0.1191)).sub(0.00232);
};

/** `look` uniforms: { slope: vec3, offset: vec3, power: vec3, saturation: float } nodes. */
export const agx = (color: any, look: { slope: any; offset: any; power: any; saturation: any }) => Fn(() => {
  const c = vec3(color).toVar();
  c.assign(SRGB_TO_2020().mul(c));
  c.assign(INSET().mul(c));
  c.assign(max(c, 1e-10));
  c.assign(clamp(log2(c).sub(MIN_EV).div(MAX_EV - MIN_EV), 0.0, 1.0));
  c.assign(agxCurve(c));
  // the look, in AgX's display-encoded space
  c.assign(pow(max(c.mul(look.slope).add(look.offset), 0.0), look.power));
  const l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c.assign(mix(vec3(l), c, look.saturation));
  c.assign(OUTSET().mul(c));
  c.assign(pow(max(vec3(0.0), c), vec3(2.2)));
  c.assign(R2020_TO_SRGB().mul(c));
  return clamp(c, 0.0, 1.0);
})();

/** Stephen Hill's fit of the ACES RRT + sRGB ODT (input in linear sRGB, scaled by 1/0.6 as in the reference). */
export const aces = (color: any) => Fn(() => {
  const ACESIn = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const ACESOut = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  const v = ACESIn.mul(vec3(color).div(0.6)).toVar();
  const a = v.mul(v.add(0.0245786)).sub(0.000090537);
  const b = v.mul(v.mul(0.983729).add(0.4329510)).add(0.238081);
  return clamp(ACESOut.mul(a.div(b)), 0.0, 1.0);
})();

/** Khronos PBR Neutral: hue- and colour-preserving below its shoulder (product shots, UI-matched colours). */
export const neutral = (color: any) => Fn(() => {
  const start = float(0.8 - 0.04);
  const desat = float(0.15);
  const c = vec3(color).toVar();
  const x = min(c.r, min(c.g, c.b));
  const off = select(x.lessThan(0.08), x.sub(x.mul(x).mul(6.25)), float(0.04));
  c.subAssign(off);
  const peak = max(c.r, max(c.g, c.b));
  const d = float(1).sub(start);
  const newPeak = float(1).sub(d.mul(d).div(peak.add(d).sub(start)));
  const compressed = c.mul(newPeak.div(peak));
  const g = float(1).sub(float(1).div(desat.mul(peak.sub(newPeak)).add(1)));
  const out = mix(compressed, vec3(newPeak), g);
  return clamp(select(peak.lessThan(start), c, out), 0.0, 1.0);
})();

/** John Hable's filmic curve (Uncharted 2), white point 11.2. */
export const filmic = (color: any) => Fn(() => {
  const curve = (x: any) => {
    const A = 0.15, B = 0.5, C = 0.1, D = 0.2, E = 0.02, F = 0.3;
    return x.mul(x.mul(A).add(C * B)).add(D * E).div(x.mul(x.mul(A).add(B)).add(D * F)).sub(E / F);
  };
  const w = 11.2;
  const white = (w * (w * 0.15 + 0.05) + 0.004) / (w * (w * 0.15 + 0.5) + 0.06) - 0.02 / 0.3;
  return clamp(curve(vec3(color).mul(2.0)).div(white), 0.0, 1.0);
})();

export function toneMap(kind: ToneMapper, color: any, look: { slope: any; offset: any; power: any; saturation: any }): any {
  if (kind === 'aces') return aces(color);
  if (kind === 'neutral') return neutral(color);
  if (kind === 'filmic') return filmic(color);
  return agx(color, look);
}
