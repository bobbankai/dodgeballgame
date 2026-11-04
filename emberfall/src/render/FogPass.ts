// Volumetric height fog with sun shafts.
//  1. half-res ray march: exponential height fog modulated by drifting 3D noise; at every step the sun
//     is tested against the cascaded shadow maps (sampler2DShadow), so light shafts come from real
//     geometry. Past the march range the fog is integrated analytically and coloured by the baked
//     atmosphere (aerial perspective). Energy-conserving integration (Hillaire 2015).
//  2. temporal accumulation with reprojection (kills the jitter noise of a low step count)
//  3. full-res composite: depth-aware upsample, colour * transmittance + inscatter.
import * as THREE from 'three';
import { Pass } from 'postprocessing';

const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`;

function marchFrag(cascades: number, steps: number): string {
  let shadowDecl = '';
  let shadowFn = 'float sunVisibility(vec3 wp, float viewZ) { return 1.0; }';
  if (cascades > 0) {
    for (let i = 0; i < cascades; i++) shadowDecl += `uniform sampler2DShadow uShadow${i}; uniform mat4 uShadowMat${i};\n`;
    shadowDecl += `uniform float uCascadeFar[${cascades}];\n`;
    let body = '';
    for (let i = 0; i < cascades; i++) {
      body += `  ${i ? 'else ' : ''}if (viewZ < uCascadeFar[${i}]) { vec4 sc = uShadowMat${i} * vec4(wp, 1.0); sc.xyz /= sc.w;
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) return texture(uShadow${i}, vec3(sc.xy, sc.z - 0.0015)); return 1.0; }\n`;
    }
    shadowFn = `float sunVisibility(vec3 wp, float viewZ) {\n${body}  return 1.0;\n}`;
  }
  return /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2DShadow;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform sampler3D tNoise;
uniform samplerCube uAtmos;
uniform mat4 uProjInv, uCamWorld, uPrevViewProj;
uniform vec3 uCamPos, uSunDir, uSunColor, uAmbientTop, uAmbientLow, uFogTint, uWind;
uniform float uDensity, uFalloff, uBaseHeight, uMaxDist, uAniso, uNoiseAmt, uNoiseScale, uTime, uFrame, uSunScatter, uHistoryBlend, uFarDensity, uSkyFog;
uniform vec2 uResolution;
${shadowDecl}
${shadowFn}

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float hgPhase(float c, float g) { float gg = g * g; return (1.0 - gg) / (12.566371 * pow(max(1.0 + gg - 2.0 * g * c, 1e-4), 1.5)); }

float densityAt(vec3 p) {
  float h = exp(-max(p.y - uBaseHeight, -20.0) * uFalloff);
  float n = texture(tNoise, p * uNoiseScale + uWind * uTime).r;
  float n2 = texture(tNoise, p * uNoiseScale * 2.7 - uWind * uTime * 1.6).r;
  float noise = mix(1.0, clamp((n * 0.7 + n2 * 0.3) * 2.0 - 0.25, 0.0, 2.0), uNoiseAmt);
  return uDensity * h * noise;
}

// analytic optical depth of the exponential height fog between t0 and t1 along a ray
float heightFogOD(vec3 ro, vec3 rd, float t0, float t1) {
  float f = uFalloff;
  float y0 = ro.y - uBaseHeight;
  float k = f * rd.y;
  float base = uFarDensity * exp(-f * y0);
  if (abs(k) < 1e-4) return base * (t1 - t0);
  return base * (exp(-k * t0) - exp(-k * t1)) / k;
}

void main() {
  float depth = texture(tDepth, vUv).r;
  vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * clip;
  vp.xyz /= vp.w;
  bool sky = depth >= 0.99999;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
  vec3 rd = normalize(wp - uCamPos);
  float dist = sky ? 2000.0 : length(wp - uCamPos);
  float viewZScale = -vp.z / max(length(vp.xyz), 1e-4); // view depth per unit of ray length

  float cosT = dot(rd, uSunDir);
  float phase = mix(hgPhase(cosT, uAniso), hgPhase(cosT, -0.25), 0.25);
  vec3 sunL = uSunColor * phase * uSunScatter;
  vec3 ambient = mix(uAmbientLow, uAmbientTop, 0.5 + 0.5 * rd.y) * 0.32;

  float T = 1.0;
  vec3 L = vec3(0.0);
  float marchEnd = min(dist, uMaxDist);
  const int STEPS = ${steps};
  if (STEPS > 0) {
    float dt = marchEnd / float(STEPS);
    float j = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);
    for (int i = 0; i < STEPS; i++) {
      float t = (float(i) + j) * dt;
      vec3 p = uCamPos + rd * t;
      float sigma = densityAt(p);
      float od = sigma * dt;
      if (od > 1e-5) {
        float vis = sunVisibility(p, t * viewZScale);
        vec3 S = (sunL * vis + ambient) * uFogTint;
        float a = 1.0 - exp(-od);
        L += T * S * a;
        T *= 1.0 - a;
      }
      if (T < 0.01) break;
    }
  } else {
    marchEnd = 0.0;
  }
  // beyond the march: analytic fog, lit without shadows, coloured by the sky (aerial perspective)
  if (dist > marchEnd) {
    float od = heightFogOD(uCamPos, rd, marchEnd, dist);
    if (sky) od *= uSkyFog;
    vec3 dir = normalize(vec3(rd.x, max(rd.y, 0.02), rd.z));
    vec3 atmos = textureLod(uAtmos, dir, 3.0).rgb;
    vec3 S = (atmos * 0.9 + sunL * 0.6 + ambient) * uFogTint;
    float a = 1.0 - exp(-od);
    L += T * S * a;
    T *= 1.0 - a;
  }
  vec4 cur = vec4(L, T);

  // temporal accumulation: reproject the surface (or a far point for the sky) into last frame
  vec3 rp = sky ? uCamPos + rd * 1000.0 : wp;
  vec4 pc = uPrevViewProj * vec4(rp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (uHistoryBlend > 0.0 && pc.w > 0.0 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
    vec4 hist = texture(tHistory, puv);
    // clamp history to this frame's neighbourhood-ish range to limit ghosting
    vec4 lo = cur * 0.55 - 0.002, hi = cur * 1.6 + 0.002;
    hist = clamp(hist, lo, hi);
    cur = mix(cur, hist, uHistoryBlend);
  }
  gl_FragColor = cur;
}`;
}

const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D inputBuffer;
uniform sampler2D tFog;
uniform sampler2D tDepth;
uniform vec2 uFogTexel;
uniform float uNear, uFar;
float linDepth(float d) { float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
void main() {
  vec4 col = texture(inputBuffer, vUv);
  float d0 = linDepth(texture(tDepth, vUv).r);
  // depth-aware upsample from the half-res fog
  vec2 base = (floor(vUv / uFogTexel - 0.5) + 0.5) * uFogTexel;
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    vec2 uv = base + vec2(float(x), float(y)) * uFogTexel;
    float d = linDepth(texture(tDepth, uv).r);
    vec2 f = 1.0 - abs(vUv - uv) / uFogTexel;
    float w = max(f.x * f.y, 1e-3) / (1e-3 + abs(d - d0) / max(d0, 1e-3));
    acc += texture(tFog, uv) * w;
    wsum += w;
  }
  vec4 fog = acc / wsum;
  gl_FragColor = vec4(col.rgb * fog.a + fog.rgb, col.a);
}`;

export interface FogSettings {
  density: number;
  falloff: number;
  baseHeight: number;
  /** density used by the analytic far fog (usually lower than near density: haze, not mist) */
  farDensity: number;
  anisotropy: number;
  noise: number;
  noiseScale: number;
  wind: THREE.Vector3;
  tint: THREE.Color;
  sunScatter: number;
  /** how much fog veils the sky at the horizon */
  skyFog: number;
  maxDist: number;
}

export function defaultFog(): FogSettings {
  return {
    density: 0.012, falloff: 0.09, baseHeight: 0, farDensity: 0.004, anisotropy: 0.65, noise: 0.6, noiseScale: 0.035,
    wind: new THREE.Vector3(0.004, 0.0005, 0.002), tint: new THREE.Color(1, 1, 1), sunScatter: 1, skyFog: 0.35, maxDist: 90,
  };
}

function makeNoise3D(size = 32): THREE.Data3DTexture {
  // tileable value-noise fbm (periodic lattice)
  const data = new Uint8Array(size * size * size);
  const rnd = (x: number, y: number, z: number, p: number) => {
    x = ((x % p) + p) % p; y = ((y % p) + p) % p; z = ((z % p) + p) % p;
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  const vn = (x: number, y: number, z: number, p: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = sm(x - xi), yf = sm(y - yi), zf = sm(z - zi);
    let s = 0;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const w = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
      s += w * rnd(xi + dx, yi + dy, zi + dz, p);
    }
    return s;
  };
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, a = 0.5, f = 4;
    for (let o = 0; o < 4; o++) { v += a * vn((x / size) * f, (y / size) * f, (z / size) * f, f); a *= 0.5; f *= 2; }
    data[x + y * size + z * size * size] = Math.min(255, Math.max(0, Math.round(v / 0.9375 * 255)));
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// a 1x1 depth-compare texture bound to unused shadow samplers (a plain texture would be a GL error)
let dummyShadow: THREE.DepthTexture | null = null;
function emptyShadow(): THREE.DepthTexture {
  if (!dummyShadow) {
    dummyShadow = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    dummyShadow.format = THREE.DepthFormat;
    dummyShadow.compareFunction = THREE.LessEqualCompare;
    dummyShadow.minFilter = dummyShadow.magFilter = THREE.LinearFilter;
  }
  return dummyShadow;
}
const dummyRT = new THREE.WebGLRenderTarget(1, 1);

export interface ShadowCascade { map: THREE.Texture; matrix: THREE.Matrix4; far: number }

export class FogPass extends Pass {
  readonly settings = defaultFog();
  private marchMat!: THREE.ShaderMaterial;
  private compositeMat: THREE.ShaderMaterial;
  private rtA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private rtB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private noise = makeNoise3D();
  private frame = 0;
  private prevViewProj = new THREE.Matrix4();
  private hasHistory = false;
  private cascades = -1;
  private steps = -1;
  private depthTex: THREE.Texture | null = null;
  sunDir = new THREE.Vector3(0, 1, 0);
  sunColor = new THREE.Color(1, 1, 1);
  ambientTop = new THREE.Color(0.3, 0.4, 0.6);
  ambientLow = new THREE.Color(0.2, 0.2, 0.2);
  atmos: THREE.Texture | null = null;
  shadows: ShadowCascade[] = [];
  time = 0;

  constructor(private cam: THREE.PerspectiveCamera, steps: number, cascades: number) {
    super('FogPass');
    this.needsSwap = true;
    this.needsDepthTexture = true;
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        inputBuffer: { value: null }, tFog: { value: null }, tDepth: { value: null }, uFogTexel: { value: new THREE.Vector2() },
        uNear: { value: 0.1 }, uFar: { value: 1000 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.configure(steps, cascades);
  }

  configure(steps: number, cascades: number): void {
    if (steps === this.steps && cascades === this.cascades) return;
    this.steps = steps;
    this.cascades = cascades;
    this.marchMat?.dispose();
    const uniforms: Record<string, THREE.IUniform> = {
      tDepth: { value: this.depthTex }, tHistory: { value: null }, tNoise: { value: this.noise }, uAtmos: { value: null },
      uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
      uAmbientTop: { value: new THREE.Color() }, uAmbientLow: { value: new THREE.Color() }, uFogTint: { value: new THREE.Color() },
      uWind: { value: new THREE.Vector3() }, uDensity: { value: 0 }, uFalloff: { value: 0 }, uBaseHeight: { value: 0 },
      uMaxDist: { value: 0 }, uAniso: { value: 0 }, uNoiseAmt: { value: 0 }, uNoiseScale: { value: 0 }, uTime: { value: 0 },
      uFrame: { value: 0 }, uSunScatter: { value: 1 }, uHistoryBlend: { value: 0 }, uFarDensity: { value: 0 }, uSkyFog: { value: 0 },
      uResolution: { value: new THREE.Vector2() },
    };
    if (cascades > 0) {
      for (let i = 0; i < cascades; i++) {
        uniforms[`uShadow${i}`] = { value: emptyShadow() };
        uniforms[`uShadowMat${i}`] = { value: new THREE.Matrix4() };
      }
      uniforms.uCascadeFar = { value: new Array(cascades).fill(1e9) };
    }
    this.marchMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: marchFrag(cascades, steps),
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.hasHistory = false;
    this.fullscreenMaterial = this.compositeMat;
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.depthTex = depthTexture;
    this.marchMat.uniforms.tDepth.value = depthTexture;
    this.compositeMat.uniforms.tDepth.value = depthTexture;
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.ceil(width / 2));
    const h = Math.max(1, Math.ceil(height / 2));
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.compositeMat.uniforms.uFogTexel.value.set(1 / w, 1 / h);
    this.marchMat.uniforms.uResolution.value.set(w, h);
    this.hasHistory = false;
  }

  resetHistory(): void { this.hasHistory = false; }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget, outputBuffer: THREE.WebGLRenderTarget): void {
    if (!dummyRT.depthTexture) {
      // allocate the dummy depth texture on the GPU once (render to it)
      dummyRT.depthTexture = emptyShadow();
      renderer.setRenderTarget(dummyRT);
      renderer.clear();
    }
    const s = this.settings;
    const u = this.marchMat.uniforms;
    const cam = this.cam;
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(this.sunColor);
    u.uAmbientTop.value.copy(this.ambientTop);
    u.uAmbientLow.value.copy(this.ambientLow);
    u.uFogTint.value.copy(s.tint);
    u.uWind.value.copy(s.wind);
    u.uDensity.value = s.density;
    u.uFarDensity.value = s.farDensity;
    u.uFalloff.value = s.falloff;
    u.uBaseHeight.value = s.baseHeight;
    u.uMaxDist.value = s.maxDist;
    u.uAniso.value = s.anisotropy;
    u.uNoiseAmt.value = s.noise;
    u.uNoiseScale.value = s.noiseScale;
    u.uSunScatter.value = s.sunScatter;
    u.uSkyFog.value = s.skyFog;
    u.uTime.value = this.time;
    u.uFrame.value = this.frame++ % 64;
    u.uAtmos.value = this.atmos;
    u.uHistoryBlend.value = this.hasHistory ? 0.82 : 0;
    if (this.cascades > 0) {
      for (let i = 0; i < this.cascades; i++) {
        const c = this.shadows[i];
        u[`uShadow${i}`].value = c ? c.map : emptyShadow();
        if (c) {
          u[`uShadowMat${i}`].value.copy(c.matrix);
          u.uCascadeFar.value[i] = c.far;
        } else u.uCascadeFar.value[i] = -1;
      }
    }
    // march into rtA reading history from rtB
    u.tHistory.value = this.rtB.texture;
    this.fullscreenMaterial = this.marchMat;
    renderer.setRenderTarget(this.rtA);
    renderer.render(this.scene, this.camera);
    // composite
    const c = this.compositeMat.uniforms;
    c.inputBuffer.value = inputBuffer.texture;
    c.tFog.value = this.rtA.texture;
    c.uNear.value = cam.near;
    c.uFar.value = cam.far;
    this.fullscreenMaterial = this.compositeMat;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    // swap history
    const t = this.rtA; this.rtA = this.rtB; this.rtB = t;
    this.prevViewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.hasHistory = true;
  }

  override dispose(): void {
    super.dispose();
    this.rtA.dispose();
    this.rtB.dispose();
    this.noise.dispose();
    this.marchMat.dispose();
    this.compositeMat.dispose();
  }
}
