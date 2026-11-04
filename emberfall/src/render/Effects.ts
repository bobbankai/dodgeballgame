// Custom post effects (postprocessing Effect API).
import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// --------------------------------------------------------------------------------------------
// Grade: exposure -> white balance -> AgX (with an AgX-domain look) -> split toning -> lift /
// gamma / gain -> contrast & saturation -> vignette -> grain. One pass, all in linear light until
// the AgX curve, then in display-referred space (the final pass encodes to sRGB).
// --------------------------------------------------------------------------------------------
const GRADE_FRAG = /* glsl */ `
uniform float exposure, contrast, saturation, vignette, vignetteRound, grain, time, temperature, tint;
uniform float lookSlope, lookPower, lookSat, chroma, damage, desaturate, flash;
uniform vec3 lift, gammaV, gain, shadowTint, highlightTint, flashColor;
uniform float splitBalance;
uniform sampler2D tAdapt;
uniform float autoExp, expMin, expMax, expKey;

const mat3 LIN_SRGB_TO_REC2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
const mat3 LIN_REC2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));

vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
    vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
    vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = LIN_SRGB_TO_REC2020 * color;
  color = inset * color;
  color = max(color, 1e-10);
  color = clamp((log2(color) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  // look (ASC CDL in AgX space)
  color = pow(max(color * lookSlope, 0.0), vec3(lookPower));
  float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = l + lookSat * (color - l);
  color = outset * color;
  color = pow(max(vec3(0.0), color), vec3(2.2));
  color = LIN_REC2020_TO_SRGB * color;
  return clamp(color, 0.0, 1.0);
}

vec3 whiteBalance(vec3 c, float temp, float tnt) {
  // approximate: warm/cool along blue-orange, tint along green-magenta
  vec3 w = vec3(1.0 + temp * 0.10, 1.0 - tnt * 0.06, 1.0 - temp * 0.12);
  return c * w;
}

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (chroma > 0.0) {
    vec2 d = (uv - 0.5) * chroma * 0.012;
    c.r = texture2D(inputBuffer, uv - d).r;
    c.b = texture2D(inputBuffer, uv + d).b;
  }
  float adapted = texture2D(tAdapt, vec2(0.5)).r;
  float auto = adapted > 0.0 ? clamp(expKey / adapted, expMin, expMax) : 1.0;
  c = whiteBalance(c * exposure * mix(1.0, auto, autoExp), temperature, tint);
  c = agx(c);
  // display-referred grading (in a gamma-ish space for perceptual controls)
  vec3 g = pow(c, vec3(1.0 / 2.2));
  float luma = dot(g, vec3(0.299, 0.587, 0.114));
  // split toning
  float sh = smoothstep(0.55 + splitBalance, 0.0, luma);
  float hi = smoothstep(0.35 + splitBalance, 1.0, luma);
  g += (shadowTint - 0.5) * sh * 0.25 + (highlightTint - 0.5) * hi * 0.2;
  // lift / gamma / gain
  g = gain * (g + lift * (1.0 - g));
  g = pow(max(g, 0.0), 1.0 / max(gammaV, vec3(0.01)));
  // contrast around mid grey, saturation
  g = (g - 0.5) * contrast + 0.5;
  luma = dot(g, vec3(0.299, 0.587, 0.114));
  g = mix(vec3(luma), g, saturation * (1.0 - desaturate));
  // damage: red-edged vignette pulse
  vec2 vq = (uv - 0.5) * vec2(1.0 + vignetteRound * 0.0, 1.0);
  float r = length(vq * vec2(1.0, 0.85));
  float v = smoothstep(0.85, 0.25, r);
  g *= mix(1.0, v, vignette);
  g = mix(g, vec3(0.55, 0.03, 0.02), damage * smoothstep(0.3, 0.75, r) * 0.6);
  g = mix(g, flashColor, flash);
  // grain (luminance weighted: stronger in mid-tones, invisible in highlights)
  float n = hash(uv * 1733.0 + fract(time * 13.7) * 91.0) - 0.5;
  g += n * grain * (1.0 - abs(luma - 0.5) * 1.2);
  outputColor = vec4(pow(max(g, 0.0), vec3(2.2)), inputColor.a);
}`;

export interface GradeSettings {
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
  lift: THREE.Vector3;
  gamma: THREE.Vector3;
  gain: THREE.Vector3;
  shadowTint: THREE.Color;
  highlightTint: THREE.Color;
  splitBalance: number;
  vignette: number;
  grain: number;
  lookSlope: number;
  lookPower: number;
  lookSat: number;
  /** eye adaptation: weight (0 = fixed exposure), clamp range, target mid-grey */
  autoExposure: number;
  expMin: number;
  expMax: number;
  expKey: number;
}

export function defaultGrade(): GradeSettings {
  return {
    exposure: 1, temperature: 0, tint: 0, contrast: 1.04, saturation: 1.05,
    lift: new THREE.Vector3(0, 0, 0), gamma: new THREE.Vector3(1, 1, 1), gain: new THREE.Vector3(1, 1, 1),
    shadowTint: new THREE.Color(0.5, 0.5, 0.5), highlightTint: new THREE.Color(0.5, 0.5, 0.5), splitBalance: 0,
    vignette: 0.35, grain: 0.028, lookSlope: 1.0, lookPower: 1.08, lookSat: 1.12,
    autoExposure: 0.75, expMin: 0.55, expMax: 2.4, expKey: 0.16,
  };
}

export class GradeEffect extends Effect {
  readonly settings = defaultGrade();
  /** transient gameplay overlays */
  chroma = 0;
  damage = 0;
  desaturate = 0;
  flash = 0;
  readonly flashColor = new THREE.Color(1, 1, 1);

  constructor() {
    super('GradeEffect', GRADE_FRAG, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)], ['contrast', new THREE.Uniform(1)], ['saturation', new THREE.Uniform(1)],
        ['vignette', new THREE.Uniform(0.3)], ['vignetteRound', new THREE.Uniform(0)], ['grain', new THREE.Uniform(0.03)],
        ['time', new THREE.Uniform(0)], ['temperature', new THREE.Uniform(0)], ['tint', new THREE.Uniform(0)],
        ['lookSlope', new THREE.Uniform(1)], ['lookPower', new THREE.Uniform(1)], ['lookSat', new THREE.Uniform(1)],
        ['chroma', new THREE.Uniform(0)], ['damage', new THREE.Uniform(0)], ['desaturate', new THREE.Uniform(0)], ['flash', new THREE.Uniform(0)],
        ['lift', new THREE.Uniform(new THREE.Vector3())], ['gammaV', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['gain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['shadowTint', new THREE.Uniform(new THREE.Color())],
        ['highlightTint', new THREE.Uniform(new THREE.Color())], ['splitBalance', new THREE.Uniform(0)],
        ['flashColor', new THREE.Uniform(new THREE.Color())],
        ['tAdapt', new THREE.Uniform(null)], ['autoExp', new THREE.Uniform(0)], ['expMin', new THREE.Uniform(0.5)],
        ['expMax', new THREE.Uniform(2)], ['expKey', new THREE.Uniform(0.16)],
      ]),
    });
  }

  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number): void {
    const s = this.settings;
    const u = this.uniforms;
    u.get('exposure')!.value = s.exposure;
    u.get('contrast')!.value = s.contrast;
    u.get('saturation')!.value = s.saturation;
    u.get('vignette')!.value = s.vignette;
    u.get('grain')!.value = s.grain;
    u.get('time')!.value += dt ?? 0.016;
    u.get('temperature')!.value = s.temperature;
    u.get('tint')!.value = s.tint;
    u.get('lookSlope')!.value = s.lookSlope;
    u.get('lookPower')!.value = s.lookPower;
    u.get('lookSat')!.value = s.lookSat;
    u.get('lift')!.value.copy(s.lift);
    u.get('gammaV')!.value.copy(s.gamma);
    u.get('gain')!.value.copy(s.gain);
    u.get('shadowTint')!.value.copy(s.shadowTint);
    u.get('highlightTint')!.value.copy(s.highlightTint);
    u.get('splitBalance')!.value = s.splitBalance;
    u.get('chroma')!.value = this.chroma;
    u.get('damage')!.value = this.damage;
    u.get('desaturate')!.value = this.desaturate;
    u.get('flash')!.value = this.flash;
    u.get('flashColor')!.value.copy(this.flashColor);
    u.get('autoExp')!.value = this.adapt ? s.autoExposure : 0;
    u.get('expMin')!.value = s.expMin;
    u.get('expMax')!.value = s.expMax;
    u.get('expKey')!.value = s.expKey;
    u.get('tAdapt')!.value = this.adapt;
  }
  /** set by the pipeline every frame (the adaptation target ping-pongs) */
  adapt: THREE.Texture | null = null;
}

// --------------------------------------------------------------------------------------------
// Camera motion blur: per-pixel velocity from reprojecting the depth-reconstructed world position
// into the previous frame; samples along the velocity with jitter. Scaled by shutter (dt-aware) and
// clamped so it only shows on fast turns, dodges and heavy hits.
// --------------------------------------------------------------------------------------------
const MB_FRAG = /* glsl */ `
uniform mat4 uProjInv, uCamWorld, uPrevViewProj;
uniform float uStrength, uMaxLen;
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * clip; vp.xyz /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 vel = (uv - puv) * uStrength;
  float len = length(vel);
  if (len > uMaxLen) vel *= uMaxLen / len;
  if (len < 0.0008) { outputColor = inputColor; return; }
  vec3 acc = inputColor.rgb;
  float j = ign(gl_FragCoord.xy);
  const int N = 8;
  for (int i = 1; i < N; i++) {
    float t = (float(i) + j) / float(N) - 0.5;
    acc += texture2D(inputBuffer, uv + vel * t).rgb;
  }
  outputColor = vec4(acc / float(N), inputColor.a);
}`;

export class MotionBlurEffect extends Effect {
  private prev = new THREE.Matrix4();
  private first = true;
  strength = 0.5;

  constructor(private cam: THREE.PerspectiveCamera) {
    super('MotionBlurEffect', MB_FRAG, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())], ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uPrevViewProj', new THREE.Uniform(new THREE.Matrix4())], ['uStrength', new THREE.Uniform(0.5)],
        ['uMaxLen', new THREE.Uniform(0.04)],
      ]),
    });
  }

  reset(): void { this.first = true; }

  override update(_r: THREE.WebGLRenderer, _i: THREE.WebGLRenderTarget, dt?: number): void {
    const u = this.uniforms;
    const cam = this.cam;
    u.get('uProjInv')!.value.copy(cam.projectionMatrixInverse);
    u.get('uCamWorld')!.value.copy(cam.matrixWorld);
    if (this.first) this.prev.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    u.get('uPrevViewProj')!.value.copy(this.prev);
    // shutter: 1/2 of a 60 Hz frame regardless of real frame time
    const k = dt && dt > 0 ? (1 / 120) / dt : 0.5;
    u.get('uStrength')!.value = this.strength * Math.min(k * 2, 2);
    this.prev.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.first = false;
  }
}
