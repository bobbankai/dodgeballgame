import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

/**
 * Exposure + filmic tonemapping + artistic grade in a single effect.
 * Keeping this custom means grading presets per arena are easy to author.
 */
const gradeFrag = /* glsl */ `
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uTint;
uniform float uDesat;
uniform vec3 uFlashColor;
uniform float uFlash;

// AgX-inspired, punchy filmic curve (ACES fitted by Stephen Hill)
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 color) {
  const mat3 ACESInputMat = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777
  );
  const mat3 ACESOutputMat = mat3(
     1.60475, -0.10208, -0.00327,
    -0.53108,  1.10813, -0.07276,
    -0.07367, -0.00605,  1.07602
  );
  color = ACESInputMat * color;
  color = RRTAndODTFit(color);
  color = ACESOutputMat * color;
  return clamp(color, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uExposure * uTint;
  c = acesFitted(c);
  // perceptual space for grading
  vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
  g = (g - 0.5) * uContrast + 0.5;
  g = g * uGain + uLift * (1.0 - g);
  g = pow(max(g, 0.0), 1.0 / max(uGamma, vec3(0.01)));
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = mix(vec3(l), g, uSaturation * (1.0 - uDesat));
  g = mix(g, uFlashColor, uFlash);
  c = pow(max(g, 0.0), vec3(2.2));
  outputColor = vec4(c, inputColor.a);
}
`;

export interface GradeSettings {
  exposure: number;
  contrast: number;
  saturation: number;
  lift: THREE.Color;
  gamma: THREE.Color;
  gain: THREE.Color;
  tint: THREE.Color;
}

export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(1)],
        ['uContrast', new THREE.Uniform(1.05)],
        ['uSaturation', new THREE.Uniform(1.08)],
        ['uLift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['uGamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uDesat', new THREE.Uniform(0)],
        ['uFlashColor', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['uFlash', new THREE.Uniform(0)],
      ]),
    });
  }
  u(name: string) {
    return this.uniforms.get(name)!;
  }
  apply(s: Partial<GradeSettings>) {
    if (s.exposure !== undefined) this.u('uExposure').value = s.exposure;
    if (s.contrast !== undefined) this.u('uContrast').value = s.contrast;
    if (s.saturation !== undefined) this.u('uSaturation').value = s.saturation;
    const setV = (n: string, c?: THREE.Color) => c && (this.u(n).value as THREE.Vector3).set(c.r, c.g, c.b);
    setV('uLift', s.lift);
    setV('uGamma', s.gamma);
    setV('uGain', s.gain);
    setV('uTint', s.tint);
  }
}

/** Up to 4 simultaneous screen-space shock waves (UV distortion). */
const distortFrag = /* glsl */ `
uniform vec4 uWaves[4]; // xy = uv center, z = radius (uv units, aspect-corrected), w = strength
uniform float uAspect2;
void mainUv(inout vec2 uv) {
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    if (w.w <= 0.0) continue;
    vec2 d = uv - w.xy;
    d.x *= uAspect2;
    float dist = length(d);
    float band = 0.06 + w.z * 0.12;
    float x = (dist - w.z) / band;
    if (abs(x) < 1.0) {
      float k = cos(x * 1.5707963) * w.w;
      vec2 dir = normalize(d + 1e-5);
      dir.x /= uAspect2;
      uv -= dir * k * 0.035;
    }
  }
}
`;

export class DistortionEffect extends Effect {
  waves: { uv: THREE.Vector2; radius: number; strength: number; speed: number; maxRadius: number; world: THREE.Vector3 | null; age: number }[] = [];
  private arr: THREE.Vector4[];
  constructor() {
    const arr = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
    super('DistortionEffect', distortFrag, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['uWaves', new THREE.Uniform(arr)],
        ['uAspect2', new THREE.Uniform(1)],
      ]),
    });
    this.arr = arr;
  }

  spawn(world: THREE.Vector3, strength = 1, speed = 1.2, maxRadius = 0.45) {
    if (this.waves.length >= 4) this.waves.shift();
    this.waves.push({ uv: new THREE.Vector2(), radius: 0, strength, speed, maxRadius, world: world.clone(), age: 0 });
  }

  tick(dt: number, camera: THREE.Camera, aspect: number) {
    this.uniforms.get('uAspect2')!.value = aspect;
    const v = new THREE.Vector3();
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.age += dt;
      w.radius += w.speed * dt * (1 - w.radius / (w.maxRadius * 1.15));
      if (w.radius >= w.maxRadius || w.age > 1.2) {
        this.waves.splice(i, 1);
        continue;
      }
      if (w.world) {
        v.copy(w.world).project(camera);
        w.uv.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
        if (v.z > 1) w.strength = 0;
      }
    }
    for (let i = 0; i < 4; i++) {
      const w = this.waves[i];
      if (w) {
        const fade = 1 - w.radius / w.maxRadius;
        this.arr[i].set(w.uv.x, w.uv.y, w.radius, w.strength * fade * fade);
      } else this.arr[i].set(0, 0, 0, 0);
    }
  }
}

/**
 * Screen-space feedback: radial zoom blur, chromatic aberration, speed lines and
 * vignette pulse. All driven by a few scalar intensities from gameplay.
 */
const screenFxFrag = /* glsl */ `
uniform float uRadial;     // zoom blur strength
uniform float uAberration; // chromatic aberration strength
uniform float uSpeedLines; // speed-line intensity
uniform float uVignette;   // base vignette darkness
uniform float uVigPulse;   // colored vignette pulse
uniform vec3 uVigColor;
uniform float uTime;
uniform float uLetterbox;  // 0..1 cinematic bars
uniform vec2 uCenter;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 dir = uv - uCenter;
  float r = length(dir * vec2(aspect, 1.0));
  vec3 col = inputColor.rgb;

  if (uRadial > 0.001) {
    vec3 acc = col;
    float tot = 1.0;
    for (int i = 1; i < 8; i++) {
      float s = 1.0 - float(i) * uRadial * 0.018 * smoothstep(0.05, 0.6, r);
      acc += texture2D(inputBuffer, uCenter + dir * s).rgb;
      tot += 1.0;
    }
    col = acc / tot;
  }
  if (uAberration > 0.001) {
    vec2 off = dir * uAberration * 0.006 * r * r;
    float rr = texture2D(inputBuffer, uv + off).r;
    float bb = texture2D(inputBuffer, uv - off).b;
    col.r = mix(col.r, rr, 0.85);
    col.b = mix(col.b, bb, 0.85);
  }
  if (uSpeedLines > 0.001) {
    float ang = atan(dir.y, dir.x);
    float seg = floor(ang * 38.0 / 3.14159);
    float n = hash(seg + floor(uTime * 14.0) * 13.1);
    float line = step(0.72, n) * smoothstep(0.32, 0.75, r);
    float thin = 1.0 - abs(fract(ang * 38.0 / 3.14159) - 0.5) * 2.0;
    line *= smoothstep(0.55, 1.0, thin);
    col = mix(col, vec3(1.0), line * uSpeedLines * 0.35);
  }
  // Vignette
  float v = smoothstep(0.35, 1.05, r);
  col *= 1.0 - v * uVignette;
  col = mix(col, uVigColor, v * v * uVigPulse);
  // Letterbox
  if (uLetterbox > 0.0) {
    float bar = 0.12 * uLetterbox;
    if (uv.y < bar || uv.y > 1.0 - bar) col = vec3(0.0);
  }
  outputColor = vec4(col, inputColor.a);
}
`;

export class ScreenFxEffect extends Effect {
  constructor() {
    super('ScreenFxEffect', screenFxFrag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uRadial', new THREE.Uniform(0)],
        ['uAberration', new THREE.Uniform(0)],
        ['uSpeedLines', new THREE.Uniform(0)],
        ['uVignette', new THREE.Uniform(0.38)],
        ['uVigPulse', new THREE.Uniform(0)],
        ['uVigColor', new THREE.Uniform(new THREE.Vector3(1, 0.2, 0.1))],
        ['uTime', new THREE.Uniform(0)],
        ['uLetterbox', new THREE.Uniform(0)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
      ]),
    });
  }
  set(name: string, v: number) {
    this.uniforms.get(name)!.value = v;
  }
  get(name: string): number {
    return this.uniforms.get(name)!.value as number;
  }
}
