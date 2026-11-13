import {
  Constants, EffectRenderer, EffectWrapper, RenderTargetTexture, Texture, type PostProcess, type Scene,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from '../ShaderLib';
import { POST_GLSL_HEAD, POST_WGSL_HEAD } from './PostUtil';

/**
 * Eye adaptation entirely on the GPU (no read-back): the HDR frame is metered into a 64x64
 * log-luminance target (centre-weighted), its mip chain averages it, and a 1x1 ping-pong pass eases
 * the adapted luminance towards it — faster when brightening than when darkening, like the eye.
 * The tone mapper samples the adapted value; it lags one frame, which is invisible.
 */
const METER_GLSL = POST_GLSL_HEAD + /* glsl */ `
uniform float centerWeight;
void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5);
  vec2 d = vUV - 0.5;
  float w = mix(1.0, exp(-dot(d, d) * 10.0) * 2.5, centerWeight);
  gl_FragColor = vec4(log2(l) * w, w, 0.0, 1.0);
}`;

const METER_WGSL = POST_WGSL_HEAD + /* wgsl */ `
uniform centerWeight: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let c = textureSampleLevel(textureSampler, textureSamplerSampler, input.vUV, 0.0).rgb;
  let l = max(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 1e-5);
  let d = input.vUV - 0.5;
  let w = mix(1.0, exp(-dot(d, d) * 10.0) * 2.5, uniforms.centerWeight);
  fragmentOutputs.color = vec4f(log2(l) * w, w, 0.0, 1.0);
}`;

const ADAPT_GLSL = /* glsl */ `precision highp float;
varying vec2 vUV;
uniform sampler2D meterSampler;
uniform sampler2D prevSampler;
uniform float dt, speedUp, speedDown, minLog, maxLog, reset;
void main(void) {
  vec2 m = texture2DLodEXT(meterSampler, vec2(0.5), 8.0).rg;
  float target = clamp(m.x / max(m.y, 1e-5), minLog, maxLog);
  float prev = texture2D(prevSampler, vec2(0.5)).r;
  float speed = target > prev ? speedUp : speedDown;
  float v = reset > 0.5 ? target : prev + (target - prev) * (1.0 - exp(-dt * speed));
  gl_FragColor = vec4(v, target, 0.0, 1.0);
}`;

const ADAPT_WGSL = /* wgsl */ `varying vUV: vec2f;
var meterSamplerSampler: sampler;
var meterSampler: texture_2d<f32>;
var prevSamplerSampler: sampler;
var prevSampler: texture_2d<f32>;
uniform dt: f32; uniform speedUp: f32; uniform speedDown: f32; uniform minLog: f32; uniform maxLog: f32; uniform reset: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let m = textureSampleLevel(meterSampler, meterSamplerSampler, vec2f(0.5), 8.0).rg;
  let goal = clamp(m.x / max(m.y, 1e-5), uniforms.minLog, uniforms.maxLog);
  let prev = textureSampleLevel(prevSampler, prevSamplerSampler, vec2f(0.5), 0.0).r;
  var speed = uniforms.speedDown;
  if (goal > prev) { speed = uniforms.speedUp; }
  var v = prev + (goal - prev) * (1.0 - exp(-uniforms.dt * speed));
  if (uniforms.reset > 0.5) { v = goal; }
  fragmentOutputs.color = vec4f(v, goal, 0.0, 1.0);
}`;

registerShader({ name: 'ecMeter', glsl: { fragment: METER_GLSL }, wgsl: { fragment: METER_WGSL } });
registerShader({ name: 'ecAdapt', glsl: { fragment: ADAPT_GLSL }, wgsl: { fragment: ADAPT_WGSL } });

export interface ExposureParams {
  /** Exposure compensation in stops (EV). */
  compensation: number;
  /** Allowed average-luminance range, in log2 units (like UE's min / max EV). */
  minLog: number;
  maxLog: number;
  speedUp: number;
  speedDown: number;
  /** Middle grey the average is mapped to. */
  key: number;
  centerWeight: number;
  enabled: boolean;
}

export class AutoExposure {
  params: ExposureParams = { compensation: -0.25, minLog: -5, maxLog: 4, speedUp: 3, speedDown: 1.2, key: 0.16, centerWeight: 0.6, enabled: true };
  private meter: RenderTargetTexture;
  private adapt: [RenderTargetTexture, RenderTargetTexture];
  private cur = 0;
  private renderer: EffectRenderer;
  private meterFx: EffectWrapper;
  private adaptFx: EffectWrapper;
  private resetFrames = 3;
  private lastDt = 1 / 60;
  private source?: PostProcess;

  constructor(scene: Scene) {
    const engine = scene.getEngine();
    const lang = shaderLanguage(engine);
    this.meter = new RenderTargetTexture('ecMeter', 64, scene, {
      generateMipMaps: true, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
      generateDepthBuffer: false,
    });
    const mk = (n: string) => new RenderTargetTexture(n, 1, scene, {
      generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Texture.NEAREST_SAMPLINGMODE,
      generateDepthBuffer: false,
    });
    this.adapt = [mk('ecAdaptA'), mk('ecAdaptB')];
    this.renderer = new EffectRenderer(engine);
    this.meterFx = new EffectWrapper({
      engine, name: 'ecMeter', useShaderStore: true, fragmentShader: 'ecMeter', uniformNames: ['centerWeight'],
      samplerNames: ['textureSampler'], shaderLanguage: lang,
    });
    this.adaptFx = new EffectWrapper({
      engine, name: 'ecAdapt', useShaderStore: true, fragmentShader: 'ecAdapt',
      uniformNames: ['dt', 'speedUp', 'speedDown', 'minLog', 'maxLog', 'reset'], samplerNames: ['meterSampler', 'prevSampler'],
      shaderLanguage: lang,
    });
    this.meterFx.onApplyObservable.add(() => {
      const e = this.meterFx.effect;
      if (this.source) e.setTextureFromPostProcess('textureSampler', this.source);
      e.setFloat('centerWeight', this.params.centerWeight);
    });
    this.adaptFx.onApplyObservable.add(() => {
      const e = this.adaptFx.effect;
      const p = this.params;
      e.setTexture('meterSampler', this.meter);
      e.setTexture('prevSampler', this.adapt[this.cur]);
      e.setFloat('dt', this.lastDt);
      e.setFloat('speedUp', p.speedUp);
      e.setFloat('speedDown', p.speedDown);
      e.setFloat('minLog', p.minLog);
      e.setFloat('maxLog', p.maxLog);
      e.setFloat('reset', this.resetFrames > 0 ? 1 : 0);
    });
  }

  /** The pass whose *input* is metered (the HDR image arriving at the tone mapper). */
  setSource(pp: PostProcess): void {
    this.source = pp;
    this.resetFrames = 3;
  }

  /** Snap to the current scene brightness (level loads, camera cuts). */
  reset(): void {
    this.resetFrames = 3;
  }

  /** Run after the frame has been rendered. */
  update(dt: number): void {
    if (!this.source || !this.params.enabled) return;
    if (!this.meterFx.isReady() || !this.adaptFx.isReady()) return;
    this.lastDt = dt;
    this.renderer.render(this.meterFx, this.meter);
    const next = 1 - this.cur;
    this.renderer.render(this.adaptFx, this.adapt[next]);
    this.cur = next;
    if (this.resetFrames > 0) this.resetFrames--;
  }

  /** 1x1 texture: r = adapted log2 luminance, g = this frame's target. */
  get adapted(): RenderTargetTexture {
    return this.adapt[this.cur];
  }

  dispose(): void {
    this.meter.dispose();
    this.adapt[0].dispose();
    this.adapt[1].dispose();
    this.meterFx.dispose();
    this.adaptFx.dispose();
    this.renderer.dispose();
  }
}
