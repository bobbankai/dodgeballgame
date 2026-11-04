// Eye adaptation: centre-weighted average log luminance of the HDR frame (64x64 + mip chain to 1x1),
// smoothed over time in a 1x1 ping-pong target. Never touches the image; GradeEffect reads the result.
import * as THREE from 'three';
import { Pass } from 'postprocessing';

const VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }';

const LUM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D inputBuffer;
void main() {
  vec3 c = texture2D(inputBuffer, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // centre weighting (what the player looks at matters most), ignore the extreme highlights
  vec2 d = (vUv - 0.5) * vec2(1.6, 2.0);
  float w = exp(-dot(d, d) * 2.0) + 0.15;
  float lg = log2(clamp(l, 1e-4, 64.0));
  gl_FragColor = vec4(lg * w, w, 0.0, 1.0);
}`;

const ADAPT_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tLum;
uniform sampler2D tPrev;
uniform float uDt, uSpeedUp, uSpeedDown, uLevel, uReset;
void main() {
  vec2 s = textureLod(tLum, vec2(0.5), uLevel).rg;
  float avg = exp2(s.r / max(s.g, 1e-4));
  float prev = texture2D(tPrev, vec2(0.5)).r;
  if (uReset > 0.5 || prev <= 0.0) { gl_FragColor = vec4(avg, 0.0, 0.0, 1.0); return; }
  float speed = avg > prev ? uSpeedUp : uSpeedDown; // eyes adjust to bright faster than to dark
  float k = 1.0 - exp(-uDt * speed);
  gl_FragColor = vec4(prev + (avg - prev) * k, 0.0, 0.0, 1.0);
}`;

export class AdaptPass extends Pass {
  private lumRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
  private a = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private b = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private lumMat: THREE.ShaderMaterial;
  private adaptMat: THREE.ShaderMaterial;
  private dt = 1 / 60;
  private resetNext = true;

  constructor() {
    super('AdaptPass');
    this.needsSwap = false;
    this.lumMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LUM_FRAG, uniforms: { inputBuffer: { value: null } }, depthTest: false, depthWrite: false });
    this.adaptMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: ADAPT_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, uDt: { value: 0.016 }, uSpeedUp: { value: 2.2 }, uSpeedDown: { value: 0.9 }, uLevel: { value: 6 }, uReset: { value: 1 } },
    });
    this.fullscreenMaterial = this.lumMat;
  }

  /** the adapted average luminance (1x1, R channel) */
  get texture(): THREE.Texture { return this.a.texture; }

  reset(): void { this.resetNext = true; }

  setDelta(dt: number): void { this.dt = Math.max(0, Math.min(0.1, dt)); }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget): void {
    this.lumMat.uniforms.inputBuffer.value = inputBuffer.texture;
    this.fullscreenMaterial = this.lumMat;
    renderer.setRenderTarget(this.lumRT);
    renderer.render(this.scene, this.camera);
    // swap: write b from a, then make b the current
    const u = this.adaptMat.uniforms;
    u.tPrev.value = this.a.texture;
    u.uDt.value = this.dt;
    u.uReset.value = this.resetNext ? 1 : 0;
    this.resetNext = false;
    this.fullscreenMaterial = this.adaptMat;
    renderer.setRenderTarget(this.b);
    renderer.render(this.scene, this.camera);
    const t = this.a; this.a = this.b; this.b = t;
  }

  override dispose(): void {
    super.dispose();
    this.lumRT.dispose(); this.a.dispose(); this.b.dispose();
    this.lumMat.dispose(); this.adaptMat.dispose();
  }
}
