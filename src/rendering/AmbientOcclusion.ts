import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

const fsVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/**
 * Scalable-AO style estimator from the depth buffer alone: view-space positions are rebuilt
 * from depth, normals from the flatter of each pair of neighbours (clean at silhouettes),
 * and occlusion is gathered along a per-pixel rotated spiral. Runs at half resolution.
 */
const aoFrag = /* glsl */ `
#include <packing>
uniform highp sampler2D tDepth;
uniform mat4 uProjInv;
uniform mat4 uProj;
uniform vec2 uTexel;       // 1 / depth-buffer size
uniform float uRadius;     // world units
uniform float uBias;
uniform float uIntensity;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;

#define SAMPLES 12
#define TURNS 7.0

// snap to depth texel centres so the fetched depth and the unprojected uv always agree
// (otherwise flat floors at grazing angles reconstruct as a dotted, self-occluding surface)
vec3 viewPos(vec2 uv) {
  uv = (floor(uv / uTexel) + 0.5) * uTexel;
  float d = texture2D(tDepth, uv).x;
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

// interleaved gradient noise: decorrelated per pixel, cancels out under a small blur
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

void main() {
  vec2 cUv = (floor(vUv / uTexel) + 0.5) * uTexel;
  float d = texture2D(tDepth, cUv).x;
  if (d >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = viewPos(cUv);
  vec3 pr = viewPos(cUv + vec2(uTexel.x, 0.0)) - P;
  vec3 pl = P - viewPos(cUv - vec2(uTexel.x, 0.0));
  vec3 pu = viewPos(cUv + vec2(0.0, uTexel.y)) - P;
  vec3 pd = P - viewPos(cUv - vec2(0.0, uTexel.y));
  vec3 dx = abs(pr.z) < abs(pl.z) ? pr : pl;
  vec3 dy = abs(pu.z) < abs(pd.z) ? pu : pd;
  vec3 N = normalize(cross(dx, dy));

  // projected radius in uv units
  float rUv = uRadius * uProj[1][1] * 0.5 / max(-P.z, 0.1);
  rUv = min(rUv, 0.12);
  float aspect = uTexel.y / uTexel.x;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  float r2 = uRadius * uRadius;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float t = (float(i) + 0.5) / float(SAMPLES);
    float a = ang + t * TURNS * 6.2831853;
    vec2 off = vec2(cos(a) / aspect, sin(a)) * (t * rUv);
    vec3 v = viewPos(cUv + off) - P;
    float vv = dot(v, v);
    float vn = dot(v, N);
    float f = max(r2 - vv, 0.0) / r2;
    sum += f * f * max(vn - uBias * -P.z, 0.0) / (vv + 0.01);
  }
  float ao = clamp(1.0 - sum * uIntensity / float(SAMPLES), 0.0, 1.0);
  // distant pixels (crowd far away) keep less occlusion
  ao = mix(ao, 1.0, smoothstep(40.0, 90.0, -P.z));
  gl_FragColor = vec4(ao, -P.z, 0.0, 1.0);
}
`;

/** Depth-aware blur so the noisy estimate smooths without bleeding across silhouettes. */
const blurFrag = /* glsl */ `
uniform sampler2D tAO;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec2 c = texture2D(tAO, vUv).xy;
  float sum = c.x;
  float w = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 s = texture2D(tAO, vUv + uDir * float(i)).xy;
    float k = exp(-abs(s.y - c.y) / (0.04 * c.y + 0.02)) * (1.0 - abs(float(i)) / 4.0);
    sum += s.x * k;
    w += k;
  }
  gl_FragColor = vec4(sum / w, c.y, 0.0, 1.0);
}
`;

const compositeFrag = /* glsl */ `
uniform sampler2D tAOResult;
uniform float uAOStrength;
uniform float uAODebug;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float ao = texture2D(tAOResult, uv).x;
  ao = mix(1.0, ao, uAOStrength);
  outputColor = vec4(inputColor.rgb * ao, inputColor.a);
  if (uAODebug > 0.5) outputColor = vec4(vec3(ao * 0.8), 1.0);
}
`;

export class AmbientOcclusionEffect extends Effect {
  private rtA: THREE.WebGLRenderTarget;
  private rtB: THREE.WebGLRenderTarget;
  private aoMat: THREE.ShaderMaterial;
  private blurMat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private camera: THREE.PerspectiveCamera;
  private depthTex: THREE.Texture | null = null;
  enabled = true;
  resolutionScale = 0.5;

  constructor(camera: THREE.PerspectiveCamera) {
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const rtA = new THREE.WebGLRenderTarget(4, 4, opts);
    const rtB = new THREE.WebGLRenderTarget(4, 4, opts);
    super('AmbientOcclusionEffect', compositeFrag, {
      blendFunction: BlendFunction.SET,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['tAOResult', new THREE.Uniform(rtA.texture)],
        ['uAOStrength', new THREE.Uniform(0.85)],
        ['uAODebug', new THREE.Uniform(0)],
      ]),
    });
    this.camera = camera;
    this.rtA = rtA;
    this.rtB = rtB;
    this.aoMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: aoFrag,
      uniforms: {
        tDepth: { value: null },
        uProjInv: { value: new THREE.Matrix4() },
        uProj: { value: new THREE.Matrix4() },
        uTexel: { value: new THREE.Vector2() },
        uRadius: { value: 0.55 },
        uBias: { value: 0.012 },
        uIntensity: { value: 4.0 },
        uNear: { value: 0.1 },
        uFar: { value: 100 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: fsVert,
      fragmentShader: blurFrag,
      uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.aoMat);
    this.quad.frustumCulled = false;
  }

  override set mainCamera(c: THREE.Camera) {
    if ((c as THREE.PerspectiveCamera).isPerspectiveCamera) this.camera = c as THREE.PerspectiveCamera;
  }

  get strength() {
    return this.uniforms.get('uAOStrength')!.value as number;
  }
  set strength(v: number) {
    this.uniforms.get('uAOStrength')!.value = v;
  }
  set radius(v: number) {
    this.aoMat.uniforms.uRadius.value = v;
  }

  override setDepthTexture(depthTexture: THREE.Texture) {
    this.depthTex = depthTexture;
  }

  override setSize(width: number, height: number) {
    const w = Math.max(8, Math.round(width * this.resolutionScale));
    const h = Math.max(8, Math.round(height * this.resolutionScale));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    (this.aoMat.uniforms.uTexel.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  override update(renderer: THREE.WebGLRenderer) {
    if (!this.enabled || this.strength <= 0.001 || !this.depthTex) return;
    const u = this.aoMat.uniforms;
    u.tDepth.value = this.depthTex;
    (u.uProj.value as THREE.Matrix4).copy(this.camera.projectionMatrix);
    (u.uProjInv.value as THREE.Matrix4).copy(this.camera.projectionMatrixInverse);
    const prev = renderer.getRenderTarget();
    this.quad.material = this.aoMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    const b = this.blurMat.uniforms;
    this.quad.material = this.blurMat;
    b.tAO.value = this.rtA.texture;
    (b.uDir.value as THREE.Vector2).set(1 / this.rtA.width, 0);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.quad, this.cam);
    b.tAO.value = this.rtB.texture;
    (b.uDir.value as THREE.Vector2).set(0, 1 / this.rtA.height);
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.quad, this.cam);
    renderer.setRenderTarget(prev);
  }

  override dispose() {
    super.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.aoMat.dispose();
    this.blurMat.dispose();
  }
}
