import { Constants, RawTexture3D, Texture, type Scene } from '@babylonjs/core';

/**
 * Colour grading baked into a 32x32x32 3D LUT (hardware trilinear filtering), applied after tone
 * mapping. Operations, in order, in scene-linear space: white balance (temperature / tint), ASC CDL
 * slope / offset / power per channel, contrast around middle grey (log space), split toning of
 * shadows and highlights, global and per-range saturation, then a final gain.
 */
export interface GradeSettings {
  /** -1 (cool) .. 1 (warm). */
  temperature: number;
  /** -1 (green) .. 1 (magenta). */
  tint: number;
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  contrast: number;
  saturation: number;
  shadowSaturation: number;
  highlightSaturation: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** 0..1 balance point of the split toning. */
  splitBalance: number;
  gain: number;
}

export const NEUTRAL_GRADE: GradeSettings = {
  temperature: 0, tint: 0,
  slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1],
  contrast: 1, saturation: 1, shadowSaturation: 1, highlightSaturation: 1,
  shadowTint: [0, 0, 0], highlightTint: [0, 0, 0], splitBalance: 0.5, gain: 1,
};

const N = 32;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** Approximate white-balance gains for a temperature/tint shift (Bradford-like, simplified). */
function whiteBalance(t: number, tint: number): [number, number, number] {
  const r = 1 + 0.18 * t - 0.03 * tint;
  const g = 1 - 0.09 * tint;
  const b = 1 - 0.22 * t - 0.03 * tint;
  const avg = (r * 0.2126 + g * 0.7152 + b * 0.0722);
  return [r / avg, g / avg, b / avg];
}

export function gradeColor(rgb: [number, number, number], s: GradeSettings): [number, number, number] {
  let [r, g, b] = rgb;
  const wb = whiteBalance(s.temperature, s.tint);
  r *= wb[0];
  g *= wb[1];
  b *= wb[2];
  // ASC CDL
  r = Math.pow(Math.max(0, r * s.slope[0] + s.offset[0]), s.power[0]);
  g = Math.pow(Math.max(0, g * s.slope[1] + s.offset[1]), s.power[1]);
  b = Math.pow(Math.max(0, b * s.slope[2] + s.offset[2]), s.power[2]);
  // contrast around middle grey in log space
  const mid = 0.18;
  const con = (x: number) => mid * Math.pow(Math.max(x, 1e-6) / mid, s.contrast);
  r = con(r);
  g = con(g);
  b = con(b);
  const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
  // split toning: weight by perceptual brightness
  const lv = linearToSrgb(luma);
  const wh = smooth(s.splitBalance - 0.25, s.splitBalance + 0.35, lv);
  const ws = 1 - wh;
  r += (s.shadowTint[0] * ws + s.highlightTint[0] * wh) * luma;
  g += (s.shadowTint[1] * ws + s.highlightTint[1] * wh) * luma;
  b += (s.shadowTint[2] * ws + s.highlightTint[2] * wh) * luma;
  // saturation (global x range)
  const sat = s.saturation * (s.shadowSaturation * ws + s.highlightSaturation * wh);
  const l2 = r * 0.2126 + g * 0.7152 + b * 0.0722;
  r = l2 + (r - l2) * sat;
  g = l2 + (g - l2) * sat;
  b = l2 + (b - l2) * sat;
  return [Math.max(0, r * s.gain), Math.max(0, g * s.gain), Math.max(0, b * s.gain)];
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Builds the 32^3 LUT data (sRGB in, sRGB out; x = red, y = green, z = blue). */
export function buildLutData(s: GradeSettings): Uint8Array {
  const data = new Uint8Array(N * N * N * 4);
  for (let bi = 0; bi < N; bi++) {
    for (let gi = 0; gi < N; gi++) {
      for (let ri = 0; ri < N; ri++) {
        const lin: [number, number, number] = [srgbToLinear(ri / (N - 1)), srgbToLinear(gi / (N - 1)), srgbToLinear(bi / (N - 1))];
        const o = gradeColor(lin, s);
        const i = ((bi * N + gi) * N + ri) * 4;
        data[i] = Math.round(linearToSrgb(o[0]) * 255);
        data[i + 1] = Math.round(linearToSrgb(o[1]) * 255);
        data[i + 2] = Math.round(linearToSrgb(o[2]) * 255);
        data[i + 3] = 255;
      }
    }
  }
  return data;
}

export class GradingLut {
  readonly texture: RawTexture3D;
  constructor(scene: Scene, s: GradeSettings = NEUTRAL_GRADE) {
    this.texture = new RawTexture3D(buildLutData(s), N, N, N, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
      Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.texture.wrapR = Texture.CLAMP_ADDRESSMODE;
  }

  set(s: GradeSettings): void {
    this.texture.update(buildLutData(s));
  }

  dispose(): void {
    this.texture.dispose();
  }
}
