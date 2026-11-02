import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';
import { paperTexture } from './Paper';

/** Graphics quality: high = 4x MSAA, AO, contact shadows, reflections; low = none of those. */
export type Quality = 'high' | 'medium' | 'low';

const FULLSCREEN_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

/** Shared helpers: view-space position from the depth buffer, interleaved gradient noise. */
const VIEW = /* glsl */ `
uniform mat4 uProj;
uniform mat4 uProjInv;
vec3 viewPos(sampler2D depth, vec2 uv) {
  float d = texture2D(depth, uv).x;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return v.xyz / v.w;
}
vec2 project(vec3 p) {
  vec4 c = uProj * vec4(p, 1.0);
  return c.xy / c.w * 0.5 + 0.5;
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

/**
 * Ambient occlusion and contact shadows, at half resolution. AO: twelve normal-oriented hemisphere
 * samples (cosine weighted, spun per pixel) with a range check, so only nearby geometry occludes.
 * Contact shadows: a short march toward the sun through the depth buffer, catching the small
 * shadows the shadow map is too coarse for (feet on the ground, a cup on a table, a hand on a rail).
 */
const AO_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform vec3 uSunView;
uniform float uRadius;
uniform float uContactOn;
uniform float uFrame;
varying vec2 vUv;
${VIEW}
void main() {
  if (texture2D(tDepth, vUv).x >= 0.99999) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
  vec3 P = viewPos(tDepth, vUv);
  vec4 nb = texture2D(tNormal, vUv);
  vec3 N = normalize(nb.xyz * 2.0 - 1.0);
  float dist = -P.z;
  float rnd = ign(gl_FragCoord.xy + uFrame * 5.588);
  // a wider reach in the distance, so whole buildings settle into the ground, not just their seams
  float r = uRadius * mix(1.0, 3.0, smoothstep(6.0, 60.0, dist));
  vec3 t = normalize(cross(N, abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(N, t);
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float u = (float(i) + 0.5) / 12.0;
    float phi = float(i) * 2.39996 + rnd * 6.2831;
    float sinT = sqrt(u), cosT = sqrt(1.0 - u);
    vec3 dir = t * cos(phi) * sinT + b * sin(phi) * sinT + N * cosT;
    float s = mix(0.15, 1.0, fract(u * 7.0 + rnd) * fract(u * 7.0 + rnd));
    vec3 S = P + N * 0.02 * r + dir * r * s;
    vec2 suv = project(S);
    float sz = viewPos(tDepth, suv).z;
    float range = smoothstep(0.0, 1.0, r / max(abs(P.z - sz), 1e-3));
    occ += step(S.z + 0.025 * r, sz) * range;
  }
  float ao = pow(1.0 - occ / 12.0, 1.8);

  float cs = 0.0;
  float ndl = dot(N, uSunView);
  if (uContactOn > 0.5 && ndl > 0.02 && dist < 45.0) {
    float len = 0.3 + 0.015 * dist;
    vec3 stepv = uSunView * (len / 14.0);
    vec3 Q = P + N * (0.006 + 0.0015 * dist) + stepv * rnd;
    for (int i = 0; i < 14; i++) {
      Q += stepv;
      vec2 q = project(Q);
      if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break;
      float dz = viewPos(tDepth, q).z - Q.z;
      if (dz > 0.012 + 0.0008 * dist && dz < 0.35 + 0.01 * dist) {
        cs = 1.0 - float(i) / 20.0;
        break;
      }
    }
    cs *= (1.0 - smoothstep(30.0, 45.0, dist)) * smoothstep(0.02, 0.2, ndl);
  }
  gl_FragColor = vec4(ao, cs, 0.0, 1.0);
}
`;

/** Depth-aware 4x4 blur of the AO target: smooths the per-pixel noise without leaking across edges. */
const AO_BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tAO;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
float lin(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}
void main() {
  float z0 = lin(vUv);
  vec2 sum = vec2(0.0);
  float wsum = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 o = (vec2(float(x), float(y)) - 1.5) * uTexel;
      float z = lin(vUv + o);
      float w = exp(-abs(z - z0) / (0.04 * z0 + 0.02));
      sum += texture2D(tAO, vUv + o).rg * w;
      wsum += w;
    }
  }
  gl_FragColor = vec4(sum / max(wsum, 1e-4), 0.0, 1.0);
}
`;

/** Bloom: keep what is brighter than the paper, and only where it isn't dark pigment. */
const BRIGHT = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = (vec2(float(i - (i / 2) * 2), float(i / 2)) - 0.5) * uTexel;
    vec3 s = texture2D(tDepth, vUv + o).x >= 0.99999 ? vec3(0.0) : texture2D(tColor, vUv + o).rgb;
    c += max(s - uThreshold, 0.0);
  }
  gl_FragColor = vec4(c * 0.25, 1.0);
}
`;

const BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  // 9-tap gaussian folded into 5 linear taps
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}
`;

const COMPOSITE = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform sampler2D tPaper;
uniform sampler2D tAO;
uniform sampler2D tBloomA;
uniform sampler2D tBloomB;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uLine;
uniform float uBoil;
uniform float uTime;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uSkyTop;
uniform vec3 uShadowTint;
uniform vec3 uFog;
uniform float uFade;
uniform float uContrast;
uniform float uBloom;
uniform vec3 uTint;
uniform float uInkWeight;
uniform float uFocus;
uniform float uAperture;
uniform float uVignette;
uniform float uAO;
uniform float uContact;
uniform float uReflect;
uniform float uExposure;
uniform vec3 uUpView;
uniform float uDebug;
varying vec2 vUv;
${NOISE}
${VIEW}

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

// the scene colour, with the painted sky where nothing was drawn (blurs mustn't pull in black)
vec3 tap(vec2 uv) {
  return texture2D(tDepth, uv).x >= 0.99999 ? sky(uv) : texture2D(tColor, uv).rgb;
}

// water reflects what stands over it: march the reflected ray through the depth buffer, and where it
// leaves the frame, the painted sky. Ripples smear the reflection like wet-in-wet paint.
vec3 reflection(vec2 uv, vec3 Nv, out float fres) {
  vec3 P = viewPos(tDepth, uv);
  vec3 N = normalize(mix(uUpView, Nv, 0.3));
  vec3 V = normalize(P);
  vec3 R = reflect(V, N);
  fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  float t = 0.25;
  float prevT = 0.0;
  vec2 hit = vec2(-1.0);
  for (int i = 0; i < 28; i++) {
    vec3 Q = P + R * t;
    vec2 q = project(Q);
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0 || Q.z > -0.05) break;
    float sz = viewPos(tDepth, q).z;
    if (sz > Q.z && sz - Q.z < 0.6 + t * 0.25) {
      // refine between the last two steps
      float a = prevT, b = t;
      for (int k = 0; k < 4; k++) {
        float m = 0.5 * (a + b);
        vec3 M = P + R * m;
        vec2 mq = project(M);
        if (viewPos(tDepth, mq).z > M.z) b = m; else a = m;
      }
      hit = project(P + R * b);
      break;
    }
    prevT = t;
    t *= 1.21;
  }
  float up = clamp(dot(R, uUpView), 0.0, 1.0);
  vec3 skyCol = sky(vec2(uv.x, 0.42 + 0.58 * up)) * 0.85;
  if (hit.x < 0.0) return skyCol;
  hit.x += sin(hit.y * 140.0 + uTime * 1.7) * 0.0025;
  vec3 c = mix(tap(hit), tap(hit + vec2(0.0, 0.004)), 0.5);
  float edgeFade = smoothstep(0.0, 0.08, min(min(hit.x, 1.0 - hit.x), min(hit.y, 1.0 - hit.y)));
  return mix(skyCol, c, edgeFade);
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
    blur += tap(vUv + warp + vec2(cos(a), sin(a)) * px * 2.2);
  }
  blur *= 0.25;
  vec3 col = mix(c0, blur, 0.3);
  if (isSky) col = sky(vUv);
  vec4 nraw = texture2D(tNormal, vUv);

  if (!isSky) {
    // pigment pools in creases and where things meet the ground (ambient occlusion), cool like a
    // second wash; small contact shadows where the sun is blocked close by
    vec2 ao = texture2D(tAO, vUv).rg;
    float occ = (1.0 - ao.r) * uAO;
    col *= mix(vec3(1.0), uShadowTint * 0.86, clamp(occ * 1.6, 0.0, 0.85));
    col *= mix(vec3(1.0), uShadowTint * 1.08, ao.g * uContact * 0.8 * texture2D(tColor, vUv).a);
    // water: reflections
    if (uReflect > 0.0 && abs(nraw.a * 255.0 - 3.0) < 0.5) {
      float fres;
      vec3 refl = reflection(vUv, normalize(nraw.xyz * 2.0 - 1.0), fres);
      // a reflection in water is a darker glaze of the water's own colour, never a mirror
      float wl = max(dot(col, vec3(0.299, 0.587, 0.114)), 0.05);
      vec3 tinted = refl * mix(vec3(1.0), col / wl, 0.6) * 0.78;
      col = mix(col, tinted, clamp(fres * 0.7 + 0.12, 0.0, 0.42) * uReflect);
    }
  }

  // glow: bright washes bleed light into their surroundings, like wet paint under a lamp; dark
  // pigment (pupils, ink) keeps it out
  vec3 glow = texture2D(tBloomA, vUv).rgb * 0.6 + texture2D(tBloomB, vUv).rgb * 0.8;
  col += glow * uBloom * mix(0.25, 1.0, smoothstep(0.08, 0.4, dot(c0, vec3(0.333))));

  // depth of field for cinematics: the wash softens away from the focal plane
  float coc = 0.0;
  if (uAperture > 0.0 && !isSky) coc = clamp(abs(viewZ(vUv) - uFocus) / max(uFocus, 0.1) * uAperture, 0.0, 1.0);
  if (coc > 0.02) {
    vec3 acc = col;
    float wsum = 1.0;
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float r = sqrt((float(i) + 0.5) / 16.0) * coc * 9.0;
      vec2 o = vec2(cos(a), sin(a)) * r * px;
      acc += tap(vUv + o);
      wsum += 1.0;
    }
    col = mix(col, acc / wsum, smoothstep(0.02, 0.3, coc));
  }

  // ink wash: tone steps into a few soft, uneven bands like a brush pass per value
  float tl = dot(col, vec3(0.299, 0.587, 0.114));
  float band = floor(tl * 5.0 + ibNoise(vec3(vUv * 18.0, 2.0)) * 0.5) / 5.0;
  col *= mix(1.0, clamp(band / max(tl, 0.05), 0.82, 1.12), 0.35);

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
    // id 0 marks rubbed-out paper: it never gets a line of its own
    bool ia = na.a > 0.002 && abs(na.a - n0.a) > 0.002, ib = nb.a > 0.002 && abs(nb.a - n0.a) > 0.002;
    iEdge = max(iEdge, (ia || ib) ? 1.0 : 0.0);
  }
  float edge = max(dEdge, max(nEdge * 0.8, iEdge * 0.9));
  if (n0.a < 0.002) edge = 0.0;
  float z0 = 1.0 / w0;
  // lines thin out and fade into the distance like a pen lifting off the page
  float dist = abs(z0);
  float fade = 1.0 - smoothstep(uFog.x * 0.6, uFog.y * 0.8, dist);
  float grain = texture2D(tPaper, vUv * uRes / (512.0 * uLine / 1.15)).g;
  // dry-brush: the line starves of ink in places and swells in others
  float brush = ibNoise(vec3(vUv * uRes / 14.0, 4.0 + uBoil * 0.15)) * 0.6 + ibNoise(vec3(vUv * uRes / 3.5, 9.0)) * 0.4;
  edge = smoothstep(0.12, 0.55, edge * (0.55 + 0.9 * brush)) * uInkWeight * (1.0 - coc * 0.85);
  edge *= fade * mix(0.7, 1.0, grain);
  if (isSky) edge = 0.0;
  col = mix(col, uInk, edge * 0.92);

  // paper: fibres and tooth, and pigment granulating into it
  vec3 pt = texture2D(tPaper, vUv * uRes / (512.0 * uLine / 1.15)).rgb;
  float sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  // r: tooth + fibres (a multiplier near 1); g: fine grain; b: low-frequency tooth
  col *= mix(1.0, pt.r, 0.8);
  // pigment settles into the grain, so saturated washes look granular
  col *= 1.0 - sat * 0.18 * (1.0 - pt.g) * (0.6 + 0.4 * pt.b);

  // vignette like the edge of a page under a lamp
  vec2 vc = vUv - 0.5;
  col *= 1.0 - (0.22 + uVignette) * smoothstep(0.35, 0.95, length(vc * vec2(1.1, 1.0)) * 1.25);
  // grade: crush the shadows toward ink, lift the lights, and tint the mid-tones
  // contrast on value only, so the cream paper keeps its hue
  col *= uExposure;
  float l0 = max(dot(col, vec3(0.299, 0.587, 0.114)), 1e-3);
  col *= pow(l0, uContrast) / l0;
  col = mix(col, col * uTint, 0.55);
  float vl = dot(col, vec3(0.299, 0.587, 0.114));
  float csat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
  col = mix(vec3(vl), col, 1.0 + 0.14 * smoothstep(0.08, 0.3, csat));
  // filmic shoulder: anything brighter than the paper rolls off softly (on value, so hues hold)
  // instead of clipping into flat white
  float hl = max(dot(col, vec3(0.299, 0.587, 0.114)), 1e-4);
  float sh = hl < 0.82 ? hl : 0.82 + 0.18 * (1.0 - exp(-(hl - 0.82) / 0.18));
  col *= sh / hl;
  col = col / (1.0 + max(col - 1.0, 0.0));
  col *= uFade;

  // a whisper of dither so gradients (sky, fog) never band
  col += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
  // hand the scene depth on, so overlay strokes and particles are hidden behind scenery
  gl_FragDepthEXT = texture2D(tDepth, vUv).x;
  // debug views: 1 ambient occlusion, 2 contact shadows, 3 bloom
  if (uDebug > 0.5) {
    vec2 a = texture2D(tAO, vUv).rg;
    gl_FragColor = vec4(uDebug < 1.5 ? vec3(a.r) : uDebug < 2.5 ? vec3(1.0 - a.g) : glow * 4.0, 1.0);
  }
}
`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  }));
  m.frustumCulled = false;
  const s = new THREE.Scene();
  s.add(m);
  return { scene: s, mat: m.material as THREE.ShaderMaterial };
}

function rt(w: number, h: number, type: THREE.TextureDataType = THREE.HalfFloatType) {
  return new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
}

/**
 * Renders the scene into colour + view-normal/id targets with a depth texture (multisampled at high
 * quality), works out ambient occlusion and contact shadows at half resolution, a two-level bloom,
 * then composites ink lines, watercolour bleed, reflections on water, paper and the sky.
 */
export class Pipeline {
  readonly renderer: THREE.WebGLRenderer;
  private target!: THREE.WebGLRenderTarget;
  private ao = rt(1, 1, THREE.UnsignedByteType);
  private aoBlur = rt(1, 1, THREE.UnsignedByteType);
  private bloomA = rt(1, 1);
  private bloomA2 = rt(1, 1);
  private bloomB = rt(1, 1);
  private bloomB2 = rt(1, 1);
  private quad: THREE.Mesh;
  private postScene = new THREE.Scene();
  private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private aoPass: ReturnType<typeof pass>;
  private aoBlurPass: ReturnType<typeof pass>;
  private brightPass: ReturnType<typeof pass>;
  private blurPass: ReturnType<typeof pass>;
  readonly uniforms: Record<string, THREE.IUniform>;
  /** Drawn straight onto the finished page after compositing (sketch strokes, particles, glows):
   * depth-tested against the scene but never outlined. Shaders output display-ready colour. */
  readonly overlay = new THREE.Scene();
  private scale = 1;
  private size = new THREE.Vector2(1, 1);
  private frame = 0;
  quality: Quality = 'high';

  constructor(container: HTMLElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(r.domElement);
    G.tPaper.value = paperTexture();
    const proj = { value: new THREE.Matrix4() }, projInv = { value: new THREE.Matrix4() };
    this.uniforms = {
      tColor: { value: null },
      tNormal: { value: null },
      tDepth: { value: null },
      tPaper: G.tPaper,
      tAO: { value: this.aoBlur.texture },
      tBloomA: { value: this.bloomA.texture },
      tBloomB: { value: this.bloomB.texture },
      uRes: G.uRes,
      uNear: { value: 0.1 },
      uFar: { value: 400 },
      uLine: { value: 1.4 },
      uInk: { value: new THREE.Color(0.1, 0.085, 0.1) },
      uSkyTop: G.uSkyTop,
      uShadowTint: G.uShadowTint,
      uFade: { value: 1 },
      uContrast: { value: 1.18 },
      uBloom: { value: 0.9 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uInkWeight: { value: 1.0 },
      uFocus: { value: 5 },
      uAperture: { value: 0 },
      uVignette: { value: 0 },
      uAO: { value: 0.85 },
      uContact: { value: 1 },
      uReflect: { value: 1 },
      uExposure: { value: 1 },
      uUpView: { value: new THREE.Vector3(0, 1, 0) },
      uDebug: { value: 0 },
      uProj: proj,
      uProjInv: projInv,
      uBoil: G.uBoil,
      uTime: G.uTime,
      uPaper: G.uPaper,
      uFog: G.uFog,
    };
    this.aoPass = pass(AO_FRAG, {
      tDepth: this.uniforms.tDepth, tNormal: this.uniforms.tNormal, uProj: proj, uProjInv: projInv,
      uSunView: { value: new THREE.Vector3() }, uRadius: { value: 0.75 }, uContactOn: { value: 1 }, uFrame: { value: 0 },
    });
    this.aoBlurPass = pass(AO_BLUR, {
      tAO: { value: this.ao.texture }, tDepth: this.uniforms.tDepth, uTexel: { value: new THREE.Vector2() },
      uNear: this.uniforms.uNear, uFar: this.uniforms.uFar,
    });
    this.brightPass = pass(BRIGHT, { tColor: this.uniforms.tColor, tDepth: this.uniforms.tDepth, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 0.72 } });
    this.blurPass = pass(BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: COMPOSITE,
        uniforms: this.uniforms,
        depthTest: true,
        depthFunc: THREE.AlwaysDepth,
        depthWrite: true,
      }),
    );
    this.quad.frustumCulled = false;
    this.postScene.add(this.quad);
    let q = new URLSearchParams(location.search).get('quality');
    try {
      q ??= localStorage.getItem('inkbound.quality');
    } catch {
      // storage blocked: fall back to the default
    }
    this.setQuality(q === 'low' || q === 'medium' || q === 'high' ? q : 'high');
  }

  /** Swap the scene target (multisampling on or off) and switch the screen-space effects. */
  setQuality(q: Quality) {
    this.quality = q;
    this.target?.dispose();
    const samples = q === 'high' ? 4 : 0;
    this.target = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      count: 2, type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(this.size.x, this.size.y),
    });
    this.target.textures[1].type = THREE.UnsignedByteType;
    this.uniforms.tColor.value = this.target.textures[0];
    this.uniforms.tNormal.value = this.target.textures[1];
    this.uniforms.tDepth.value = this.target.depthTexture;
    const fx = q !== 'low';
    this.uniforms.uAO.value = fx ? 0.85 : 0;
    this.uniforms.uContact.value = fx ? 1 : 0;
    this.uniforms.uReflect.value = fx ? 1 : 0;
    this.aoPass.mat.uniforms.uContactOn.value = fx ? 1 : 0;
  }

  setSize(w: number, h: number, pixelRatio = Math.min(window.devicePixelRatio, 2)) {
    this.scale = pixelRatio;
    const W = Math.round(w * pixelRatio), H = Math.round(h * pixelRatio);
    this.size.set(W, H);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.target.setSize(W, H);
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    this.ao.setSize(hw, hh);
    this.aoBlur.setSize(hw, hh);
    this.bloomA.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.bloomA2.setSize(Math.max(1, W >> 2), Math.max(1, H >> 2));
    this.bloomB.setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    this.bloomB2.setSize(Math.max(1, W >> 3), Math.max(1, H >> 3));
    (this.uniforms.uRes.value as THREE.Vector2).set(W, H);
    this.uniforms.uLine.value = 1.15 * pixelRatio;
  }

  private blur(src: THREE.WebGLRenderTarget, tmp: THREE.WebGLRenderTarget, spread: number) {
    const r = this.renderer;
    const u = this.blurPass.mat.uniforms;
    u.tSrc.value = src.texture;
    (u.uDir.value as THREE.Vector2).set(spread / src.width, 0);
    r.setRenderTarget(tmp);
    r.render(this.blurPass.scene, this.postCam);
    u.tSrc.value = tmp.texture;
    (u.uDir.value as THREE.Vector2).set(0, spread / src.height);
    r.setRenderTarget(src);
    r.render(this.blurPass.scene, this.postCam);
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    (this.uniforms.uProj.value as THREE.Matrix4).copy(camera.projectionMatrix);
    (this.uniforms.uProjInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    const view = camera.matrixWorldInverse;
    (this.uniforms.uUpView.value as THREE.Vector3).set(0, 1, 0).transformDirection(view);
    (this.aoPass.mat.uniforms.uSunView.value as THREE.Vector3).copy(G.uSunDir.value).transformDirection(view);
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(scene, camera);
    if (this.quality !== 'low') {
      this.aoPass.mat.uniforms.uFrame.value = this.frame++ % 64;
      r.setRenderTarget(this.ao);
      r.render(this.aoPass.scene, this.postCam);
      (this.aoBlurPass.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.ao.width, 1 / this.ao.height);
      r.setRenderTarget(this.aoBlur);
      r.render(this.aoBlurPass.scene, this.postCam);
    }
    // bloom: bright pass to quarter size, blurred; then an eighth-size copy blurred wider
    (this.brightPass.mat.uniforms.uTexel.value as THREE.Vector2).set(1 / this.size.x, 1 / this.size.y);
    r.setRenderTarget(this.bloomA);
    r.render(this.brightPass.scene, this.postCam);
    this.blur(this.bloomA, this.bloomA2, 1.0);
    this.blurPass.mat.uniforms.tSrc.value = this.bloomA.texture;
    (this.blurPass.mat.uniforms.uDir.value as THREE.Vector2).set(0, 0);
    r.setRenderTarget(this.bloomB);
    r.render(this.blurPass.scene, this.postCam);
    this.blur(this.bloomB, this.bloomB2, 1.5);
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCam);
    if (this.overlay.children.length) {
      r.autoClear = false;
      r.render(this.overlay, camera);
      r.autoClear = true;
    }
  }

  get pixelScale() {
    return this.scale;
  }
}
