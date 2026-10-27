import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';
import { paperTexture } from './Paper';

const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tPaper;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uLine;
uniform float uBoil;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uSkyTop;
uniform vec3 uFog;
uniform float uFade;
varying vec2 vUv;
${NOISE}

float viewZ(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -((uNear * uFar) / ((uFar - uNear) * d - uFar));
}

vec3 sky(vec2 uv) {
  // a loose wash across the top of the page, a few dry-brush clouds
  float t = smoothstep(0.35, 1.0, uv.y);
  vec3 c = mix(uPaper, uSkyTop, t * 0.85);
  vec2 q = uv * vec2(uRes.x / uRes.y, 1.0);
  float cl = ibFbm(vec3(q * vec2(2.2, 5.0) + vec2(uTime * 0.004, 0.0), 1.7));
  c = mix(c, uPaper * 1.02, smoothstep(0.55, 0.75, cl) * smoothstep(0.5, 0.85, uv.y) * 0.75);
  return c;
}

void main() {
  vec2 px = 1.0 / uRes;
  bool isSky = texture2D(tDepth, vUv).x >= 0.99999;

  // watercolour: slight bleed through a noise-warped neighbourhood
  vec2 warp = (vec2(ibNoise(vec3(vUv * 90.0, 1.0)), ibNoise(vec3(vUv * 90.0, 7.0))) - 0.5) * px * 3.0;
  vec3 c0 = texture2D(tColor, vUv + warp).rgb;
  vec3 blur = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.5708 + 0.6;
    blur += texture2D(tColor, vUv + warp + vec2(cos(a), sin(a)) * px * 2.2).rgb;
  }
  blur *= 0.25;
  vec3 col = mix(c0, blur, 0.3);
  if (isSky) col = sky(vUv);

  // darker pigment where washes meet (wet edges)
  float lc = dot(c0, vec3(0.333));
  float lb = dot(blur, vec3(0.333));
  col *= 1.0 - clamp(abs(lc - lb) * 3.0, 0.0, 0.22);

  // ink lines. Depth: the second difference of 1/z is zero across any plane, however steep, so it
  // only fires on real silhouettes; and only on the nearer side, so lines stay one stroke wide.
  // Normal and object-id breaks catch creases and where one part meets another.
  float boilA = ibHash2(vec2(uBoil, 1.3)) * 6.2831;
  float w = uLine * (0.85 + 0.3 * ibNoise(vec3(vUv * vec2(40.0, 25.0), uBoil * 0.5)));
  vec2 j = vec2(cos(boilA), sin(boilA)) * px * 0.6;
  vec2 uvj = vUv + j;
  float w0 = 1.0 / viewZ(uvj);
  vec4 n0 = texture2D(tNormal, uvj);
  float dEdge = 0.0, nEdge = 0.0, iEdge = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = (i == 0 ? vec2(1.0, 1.0) : i == 1 ? vec2(1.0, -1.0) : i == 2 ? vec2(1.4, 0.0) : vec2(0.0, 1.4)) * px * w;
    float wa = 1.0 / viewZ(uvj + o), wb = 1.0 / viewZ(uvj - o);
    float lap = (wa + wb - 2.0 * w0) / w0;
    dEdge = max(dEdge, smoothstep(0.03, 0.09, -lap));
    vec4 na = texture2D(tNormal, uvj + o * 0.75), nb = texture2D(tNormal, uvj - o * 0.75);
    float da = 1.0 - dot(n0.xyz * 2.0 - 1.0, na.xyz * 2.0 - 1.0);
    float db = 1.0 - dot(n0.xyz * 2.0 - 1.0, nb.xyz * 2.0 - 1.0);
    nEdge = max(nEdge, smoothstep(0.25, 0.5, max(da, db)));
    iEdge = max(iEdge, (abs(na.a - n0.a) > 0.002 || abs(nb.a - n0.a) > 0.002) ? 1.0 : 0.0);
  }
  float edge = max(dEdge, max(nEdge * 0.8, iEdge * 0.9));
  float z0 = 1.0 / w0;
  // lines thin out and fade into the distance like a pen lifting off the page
  float dist = abs(z0);
  float fade = 1.0 - smoothstep(uFog.x * 0.6, uFog.y * 0.8, dist);
  float grain = texture2D(tPaper, vUv * uRes / 512.0).g;
  edge *= fade * mix(0.7, 1.0, grain);
  if (isSky) edge = 0.0;
  col = mix(col, uInk, edge * 0.92);

  // paper: fibres and tooth, and pigment granulating into it
  vec3 pt = texture2D(tPaper, vUv * uRes / 512.0).rgb;
  float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  // r: tooth + fibres (a multiplier near 1); g: fine grain; b: low-frequency tooth
  col *= mix(1.0, pt.r, 0.8);
  // pigment settles into the grain, so saturated washes look granular
  col *= 1.0 - sat * 0.18 * (1.0 - pt.g) * (0.6 + 0.4 * pt.b);

  // vignette like the edge of a page under a lamp
  vec2 vc = vUv - 0.5;
  col *= 1.0 - 0.22 * smoothstep(0.35, 0.95, length(vc * vec2(1.1, 1.0)) * 1.25);
  col *= uFade;

  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}
`;

/**
 * Renders the scene into colour + view-normal/id targets with a depth texture, then
 * composites ink lines, watercolour bleed, paper and the sky onto the screen.
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly uniforms: Record<string, THREE.IUniform>;
  private scale = 1;

  constructor(container: HTMLElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    this.target = new THREE.WebGLRenderTarget(1, 1, { count: 2, type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) });
    this.target.textures[1].type = THREE.UnsignedByteType;
    this.uniforms = {
      tColor: { value: this.target.textures[0] },
      tNormal: { value: this.target.textures[1] },
      tDepth: { value: this.target.depthTexture },
      tPaper: { value: paperTexture() },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uLine: { value: 1.4 },
      uInk: { value: new THREE.Color(0.1, 0.085, 0.1) },
      uSkyTop: { value: new THREE.Color(0.62, 0.75, 0.86) },
      uFade: { value: 1 },
      uBoil: G.uBoil,
      uTime: G.uTime,
      uPaper: G.uPaper,
      uFog: G.uFog,
    };
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: COMPOSITE,
        uniforms: this.uniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
  }

  setSize(w: number, h: number, pixelRatio = Math.min(window.devicePixelRatio, 2)) {
    this.scale = pixelRatio;
    const W = Math.round(w * pixelRatio), H = Math.round(h * pixelRatio);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.target.setSize(W, H);
    (this.uniforms.uRes.value as THREE.Vector2).set(W, H);
    this.uniforms.uLine.value = 1.15 * pixelRatio;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
  }

  get pixelScale() {
    return this.scale;
  }
}
