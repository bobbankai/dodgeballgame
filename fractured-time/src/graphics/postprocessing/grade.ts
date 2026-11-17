import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { AgxLook } from './tonemap';

const T = TSL as any;
const { uniform, vec3, float, dot, mix, max, pow, smoothstep, log2, exp2, clamp } = T;

/**
 * Colour grading in scene-linear light, after exposure and before tone mapping (as film grading works on the log/linear
 * negative, not on the display image): white balance (von Kries in CAT02 LMS), an ASC CDL, saturation, contrast in log
 * space around mid grey (so it never crushes shadows the way a linear pivot does), and split toning of shadows and
 * highlights. The AgX look (applied inside the tone mapper) is part of a grade too.
 *
 * Places carry a named grade; `Grader.to()` eases between them over ~2 s as the player walks from one to the next.
 */
export interface Grade {
  /** white balance: the temperature the camera is balanced for (K; 6500 neutral; higher = warmer image, lower = cooler) */
  temperature: number;
  /** green (-) / magenta (+) */
  tint: number;
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  saturation: number;
  /** log-space contrast around 0.18 (1 = none) */
  contrast: number;
  /** split toning: colour added to the shadows / highlights, and its strength */
  shadows: [number, number, number];
  highlights: [number, number, number];
  split: number;
  look: AgxLook;
  /** display-referred black point after the tone curve (0 = none): the deepest shadows close to black, per channel by
   *  `blackTint` (a channel with more tint closes sooner, so shadows fall to a coloured black: teal night, warm ruin) */
  black: number;
  blackTint: [number, number, number];
}

/**
 * The house look, under every place grade: AgX with Blender's Punchy power (1.35) and a slight black offset in AgX space, so
 * shadows fall to a deep, clean black through the curve's toe (the approved review renders and reference A have that depth;
 * AgX's base contrast reads grey and flat on a dark set).
 */
export const HOUSE_LOOK: AgxLook = { slope: [1, 1, 1], offset: [-0.012, -0.012, -0.012], power: [1.35, 1.35, 1.35], saturation: 1.12 };
const look = (power: number, saturation: number, offset = -0.012): AgxLook => ({ slope: [1, 1, 1], offset: [offset, offset, offset], power: [power, power, power], saturation });

/** A grade from a few changes on neutral. */
export const makeGrade = (g: Partial<Grade>): Grade => ({
  temperature: 6500, tint: 0, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1, contrast: 1.04,
  shadows: [0.5, 0.5, 0.5], highlights: [0.5, 0.5, 0.5], split: 0, look: HOUSE_LOOK, black: 0, blackTint: [1, 1, 1], ...g,
});

/** The look of each kind of place (the art direction's palette per chapter). */
export const GRADES = {
  neutral: makeGrade({}),
  // HELIX facility: clinical, cool whites, clean blacks with a cold cast
  facility: makeGrade({ temperature: 6100, slope: [0.98, 1.0, 1.03], saturation: 0.94, contrast: 1.06, shadows: [0.4, 0.5, 0.62], split: 0.25,
    black: 0.02, blackTint: [1.2, 1.0, 0.8], look: look(1.38, 1.1) }),
  // the Engine chamber: the chronal cyan carries the room
  engine: makeGrade({ temperature: 5900, slope: [0.95, 1.0, 1.05], contrast: 1.08, shadows: [0.36, 0.52, 0.64], split: 0.3,
    black: 0.025, blackTint: [1.25, 1.0, 0.8], look: look(1.42, 1.15) }),
  // the storm at nightfall: teal-black shadows that keep their detail, warm practical highlights, restrained saturation
  dusk_storm: makeGrade({ temperature: 6300, slope: [1.2, 1.15, 1.08], saturation: 0.92, contrast: 1.08, shadows: [0.3, 0.5, 0.75],
    highlights: [0.62, 0.5, 0.38], split: 0.55, black: 0.022, blackTint: [1.35, 1.0, 0.6], look: look(1.42, 1.18) }),
  // the arcology in 2089: high-key, cool glass and steel
  arcology: makeGrade({ temperature: 6200, slope: [0.99, 1.0, 1.02], saturation: 0.93, contrast: 1.03, shadows: [0.44, 0.5, 0.58], split: 0.15,
    black: 0.012, blackTint: [1.1, 1.0, 0.9], look: look(1.3, 1.05, -0.008) }),
  // the same rooms twenty years abandoned: warm dust, faded colour, brown-black shadows
  arcology_ruin: makeGrade({ temperature: 7000, slope: [1.04, 1.0, 0.92], saturation: 0.74, contrast: 1.03, highlights: [0.6, 0.52, 0.4], split: 0.25,
    black: 0.03, blackTint: [0.8, 0.95, 1.3], look: look(1.32, 0.95) }),
  // the Nexus: deep violet shadows, the Engine's white-gold in the highlights, strong separation
  nexus: makeGrade({ temperature: 6500, slope: [0.9, 0.86, 0.9], saturation: 1.05, contrast: 1.1, shadows: [0.56, 0.4, 0.66], split: 0.35,
    highlights: [0.62, 0.55, 0.4], black: 0.03, blackTint: [1.0, 1.25, 0.85], look: look(1.45, 1.15) }),
} as const;
export type GradeName = keyof typeof GRADES;

// --- white balance ---------------------------------------------------------------------------------------------------

/** CIE xy of a Planckian / daylight white at temperature K (Kang et al. 2002 fit), with tint along the isotherm. */
function whiteXY(K: number, tint: number): [number, number] {
  const t = THREE.MathUtils.clamp(K, 1667, 25000);
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y - tint * 0.02];
}

const SRGB_TO_XYZ = new THREE.Matrix3().set(0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.0721750, 0.0193339, 0.1191920, 0.9503041);
const CAT02 = new THREE.Matrix3().set(0.7328, 0.4296, -0.1624, -0.7036, 1.6975, 0.0061, 0.0030, 0.0136, 0.9834);

/** Matrix (linear sRGB -> linear sRGB) that balances an image shot at `K` for the D65 display white. */
export function whiteBalanceMatrix(K: number, tint: number): THREE.Matrix3 {
  const toLMS = CAT02.clone().multiply(SRGB_TO_XYZ);
  const fromLMS = toLMS.clone().invert();
  const lms = (x: number, y: number) => new THREE.Vector3(x / y, 1, (1 - x - y) / y).applyMatrix3(CAT02);
  // relative to the same locus at 6500 K (not to D65, which sits off the Planckian locus): neutral is exactly identity
  const src = lms(...whiteXY(K, tint));
  const dst = lms(...whiteXY(6500, 0));
  const gain = new THREE.Matrix3().set(dst.x / src.x, 0, 0, 0, dst.y / src.y, 0, 0, 0, dst.z / src.z);
  return fromLMS.multiply(gain).multiply(toLMS);
}

// --- the grader ------------------------------------------------------------------------------------------------------

export class Grader {
  readonly u = {
    wb: uniform(new THREE.Matrix3()),
    slope: uniform(new THREE.Vector3(1, 1, 1)), offset: uniform(new THREE.Vector3()), power: uniform(new THREE.Vector3(1, 1, 1)),
    saturation: uniform(1), contrast: uniform(1.04),
    shadows: uniform(new THREE.Vector3(0.5, 0.5, 0.5)), highlights: uniform(new THREE.Vector3(0.5, 0.5, 0.5)), split: uniform(0),
    black: uniform(new THREE.Vector3()),
    lookSlope: uniform(new THREE.Vector3(1, 1, 1)), lookOffset: uniform(new THREE.Vector3()), lookPower: uniform(new THREE.Vector3(1, 1, 1)),
    lookSaturation: uniform(1),
  };
  private cur: Grade = { ...GRADES.neutral };
  private target: Grade = GRADES.neutral;
  /** extra white balance on top of the grade (scripts: a fire's warmth, a blue flash), in K offset */
  temperatureShift = 0;

  /** Ease toward a named grade (or a grade object). */
  to(g: GradeName | Grade): void { this.target = typeof g === 'string' ? (GRADES[g] ?? GRADES.neutral) : g; }

  /** Jump to the target now (loads, cuts). */
  snap(): void { this.cur = JSON.parse(JSON.stringify(this.target)); this.push(); }

  update(dt: number): void {
    const k = Math.min(1, dt * 1.6);
    const c = this.cur as any, t = this.target as any;
    for (const key of ['temperature', 'tint', 'saturation', 'contrast', 'split', 'black'] as const) c[key] += (t[key] - c[key]) * k;
    for (const key of ['slope', 'offset', 'power', 'shadows', 'highlights', 'blackTint'] as const) c[key] = c[key].map((v: number, i: number) => v + (t[key][i] - v) * k);
    c.look = {
      slope: c.look.slope.map((v: number, i: number) => v + (t.look.slope[i] - v) * k),
      offset: c.look.offset.map((v: number, i: number) => v + (t.look.offset[i] - v) * k),
      power: c.look.power.map((v: number, i: number) => v + (t.look.power[i] - v) * k),
      saturation: c.look.saturation + (t.look.saturation - c.look.saturation) * k,
    };
    this.push();
  }

  private push(): void {
    const u = this.u as any, c = this.cur;
    u.wb.value.copy(whiteBalanceMatrix(c.temperature + this.temperatureShift, c.tint));
    u.slope.value.set(...c.slope); u.offset.value.set(...c.offset); u.power.value.set(...c.power);
    u.saturation.value = c.saturation; u.contrast.value = c.contrast;
    u.shadows.value.set(...c.shadows); u.highlights.value.set(...c.highlights); u.split.value = c.split;
    u.black.value.set(c.black * c.blackTint[0], c.black * c.blackTint[1], c.black * c.blackTint[2]);
    u.lookSlope.value.set(...c.look.slope); u.lookOffset.value.set(...c.look.offset); u.lookPower.value.set(...c.look.power);
    u.lookSaturation.value = c.look.saturation;
  }

  /** Display-referred finish after the tone curve: the black point per channel, set in gamma-2.2 space (perceptual: 0.03
   *  closes the last few percent of the shadows, as a colourist's lift does), then back to display-linear. */
  display(c: any): any {
    const u = this.u as any;
    const g = pow(max(c, 0.0), vec3(1 / 2.2));
    return pow(max(g.sub(u.black), 0.0).div(vec3(1.0).sub(u.black)), vec3(2.2));
  }

  /** The AgX look uniforms for the tone mapper. */
  get look(): { slope: any; offset: any; power: any; saturation: any } {
    const u = this.u as any;
    return { slope: u.lookSlope, offset: u.lookOffset, power: u.lookPower, saturation: u.lookSaturation };
  }

  /** Scene-linear grade of an exposed HDR colour (vec3 node). */
  apply(color: any): any {
    const u = this.u as any;
    let c: any = u.wb.mul(vec3(color));
    c = pow(max(c.mul(u.slope).add(u.offset), 0.0), u.power);
    const l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
    c = max(mix(vec3(l), c, u.saturation), 0.0);
    // log-space contrast around mid grey: every stop moves by the same factor, shadows keep their detail
    c = exp2(log2(max(c, 1e-6)).sub(log2(0.18)).mul(u.contrast).add(log2(0.18)));
    // split toning by the pixel's position in the stops (shadows below 0.05, highlights above 1)
    const ev = log2(l.div(0.18));
    const sh = smoothstep(0.0, -4.0, ev);
    const hi = smoothstep(0.0, 3.0, ev);
    const tone = (v: any) => v.sub(0.5).mul(2.0); // 0.5 = neutral
    c = c.mul(float(1).add(tone(u.shadows).mul(sh).add(tone(u.highlights).mul(hi)).mul(u.split)));
    return clamp(c, 0.0, 65000.0);
  }
}
