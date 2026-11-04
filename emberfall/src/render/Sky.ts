// Sky: physically based atmosphere baked into a cubemap whenever the light moves, then drawn by a
// dome shader that adds what changes every frame (sun / moon disc, drifting clouds, stars, lightning).
// The baked cube also feeds the image based lighting (PMREM) so ambient light matches the sky.
import * as THREE from 'three';
import { ATMOS_GLSL, AtmosphereParams, lightTransmittance, skyRadiance } from './Atmosphere';

export interface SkySettings extends AtmosphereParams {
  /** true when the scattering light is the moon (night): adds stars and a moon disc */
  night: boolean;
  /** cloud coverage 0..1, density, colour bias */
  cloudCover: number;
  cloudDensity: number;
  cloudScale: number;
  cloudSpeed: number;
  cloudTint: THREE.Color;
  /** exposure-independent multiplier of the sky's brightness */
  skyGain: number;
  /** smoky / stormy colour graded into the upper sky */
  zenithTint: THREE.Color;
  /** star brightness (night) */
  stars: number;
}

export function defaultSky(): SkySettings {
  return {
    lightDir: new THREE.Vector3(0.3, 0.35, -0.6).normalize(),
    lightPower: 22,
    rayleigh: 1,
    mie: 1,
    mieG: 0.76,
    tint: new THREE.Color(1, 1, 1),
    ozone: 1,
    night: false,
    cloudCover: 0.45,
    cloudDensity: 0.8,
    cloudScale: 1,
    cloudSpeed: 1,
    cloudTint: new THREE.Color(1, 1, 1),
    skyGain: 1,
    zenithTint: new THREE.Color(1, 1, 1),
    stars: 0,
  };
}

const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uLightDir;
uniform float uLightPower, uRayleigh, uMie, uMieG, uOzone, uGain;
uniform vec3 uTint, uZenithTint;
${ATMOS_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 dd = d;
  // below the horizon: reflect the horizon colour off a dim ground so the IBL never goes black
  float below = smoothstep(0.0, -0.08, d.y);
  dd.y = max(d.y, 0.002);
  dd = normalize(dd);
  vec3 c = atmosphere(dd, uLightDir, uLightPower, uRayleigh, uMie, uMieG, uOzone);
  c *= uTint * mix(vec3(1.0), uZenithTint, smoothstep(0.05, 0.7, d.y));
  c = mix(c, c * vec3(0.32, 0.30, 0.28), below);
  gl_FragColor = vec4(c * uGain, 1.0);
}`;

const DOME_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww; // on the far plane
}`;

const DOME_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform samplerCube uAtmos;
uniform vec3 uLightDir, uLightColor;
uniform float uTime, uNight, uStars, uCloudCover, uCloudDensity, uCloudScale, uCloudSpeed, uFlash, uGain;
uniform vec3 uCloudTint, uAmbientTop, uAmbientHorizon;
uniform float uSunSize, uForBake;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
  return s;
}
// cloud density on a curved layer
float cloudAt(vec2 p, float cover) {
  float base = fbm(p);
  float detail = fbm(p * 3.1 + vec2(uTime * 0.01, 0.0));
  float d = base - (1.0 - cover) * 0.85 + (detail - 0.5) * 0.28;
  return smoothstep(0.0, 0.38, d);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = textureCube(uAtmos, d).rgb;
  float up = max(d.y, 0.0);

  // stars + moon (night)
  if (uNight > 0.5) {
    vec3 sd = d * 420.0;
    vec3 cell = floor(sd);
    float h = hash13(cell);
    if (h > 0.9965) {
      vec3 sp = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.6;
      float dist = length(sd - sp);
      float tw = 0.75 + 0.25 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
      float star = exp(-dist * dist * 9.0) * (h - 0.9965) / 0.0035 * tw;
      vec3 sc = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.7), hash13(cell + 9.1));
      col += sc * star * uStars * smoothstep(0.0, 0.25, up);
    }
    // faint milky band
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, 0.78))) * 3.5, 2.0));
    col += vec3(0.05, 0.06, 0.09) * band * fbm(d.xz * 9.0 / max(0.25, up + 0.2)) * uStars * up;
  }

  // light disc (sun with limb darkening, or moon with soft halo)
  float cosA = dot(d, uLightDir);
  float disc = smoothstep(cos(uSunSize), cos(uSunSize * 0.85), cosA);
  vec3 discCol;
  if (uNight > 0.5) {
    float mvn = vnoise(vec2(atan(d.x, d.z), d.y) * 900.0);
    discCol = vec3(0.9, 0.93, 1.0) * (2.0 + mvn * 0.8);
    col += uLightColor * pow(max(cosA, 0.0), 900.0) * 0.6;
  } else {
    float limb = sqrt(max(0.0, 1.0 - pow((1.0 - cosA) / (1.0 - cos(uSunSize)), 1.0)));
    discCol = uLightColor * 60.0 * (0.45 + 0.55 * limb);
  }
  col += discCol * disc * (1.0 - uForBake);

  // clouds: a curved slab above the camera, lit with a two-tap light march
  if (d.y > 0.0 && uCloudCover > 0.01) {
    float t = 1.0 / (d.y + 0.08);
    vec2 p = d.xz * t * 1.6 * uCloudScale + vec2(uTime * 0.012, uTime * 0.004) * uCloudSpeed;
    float c = cloudAt(p, uCloudCover);
    if (c > 0.001) {
      vec2 ls = normalize(uLightDir.xz + 1e-4) * 0.09;
      float c1 = cloudAt(p + ls, uCloudCover);
      float c2 = cloudAt(p + ls * 2.4, uCloudCover);
      float shadow = exp(-(c1 + c2 * 0.7) * 2.2 * uCloudDensity);
      float g = 0.6;
      float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosA, 1.5) / 12.566;
      vec3 amb = mix(uAmbientHorizon, uAmbientTop, 0.6) * 0.9;
      vec3 lit = uLightColor * (shadow * (0.55 + hg * 3.5)) * (uNight > 0.5 ? 0.35 : 1.0);
      vec3 cc = (amb + lit) * uCloudTint;
      // silver lining at thin edges facing the light
      cc += uLightColor * pow(max(cosA, 0.0), 8.0) * (1.0 - c) * 1.5 * shadow;
      float alpha = c * smoothstep(0.0, 0.18, d.y) * uCloudDensity;
      // distant clouds melt into the haze
      cc = mix(cc, col, smoothstep(0.35, 0.0, d.y) * 0.65);
      col = mix(col, cc, clamp(alpha, 0.0, 1.0));
    }
  }
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + 0.6 * up);
  gl_FragColor = vec4(col * uGain, 1.0);
}`;

export class Sky {
  readonly settings: SkySettings = defaultSky();
  readonly mesh: THREE.Mesh;
  readonly lightColor = new THREE.Color();
  readonly ambientTop = new THREE.Color();
  readonly ambientHorizon = new THREE.Color();
  /** atmosphere only, used by the dome and by the fog for aerial perspective */
  readonly atmosCube: THREE.WebGLCubeRenderTarget;
  /** sky including clouds, used for the environment lighting */
  private envCube: THREE.WebGLCubeRenderTarget;
  private bakeScene = new THREE.Scene();
  private bakeCam: THREE.CubeCamera;
  private envCam: THREE.CubeCamera;
  private envScene = new THREE.Scene();
  private bakeMat: THREE.ShaderMaterial;
  private domeMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private dirty = true;
  /** set by Lighting: lightning flashes, etc */
  flash = 0;

  constructor(private renderer: THREE.WebGLRenderer, size = 128) {
    this.atmosCube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.envCube = new THREE.WebGLCubeRenderTarget(size * 2, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.bakeCam = new THREE.CubeCamera(0.1, 10, this.atmosCube);
    this.envCam = new THREE.CubeCamera(0.1, 10, this.envCube);
    this.bakeMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: BAKE_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uLightDir: { value: new THREE.Vector3() }, uLightPower: { value: 22 }, uRayleigh: { value: 1 }, uMie: { value: 1 },
        uMieG: { value: 0.76 }, uOzone: { value: 1 }, uTint: { value: new THREE.Color() }, uZenithTint: { value: new THREE.Color() }, uGain: { value: 1 },
      },
    });
    this.bakeScene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.bakeMat));
    this.domeMat = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      uniforms: {
        uAtmos: { value: this.atmosCube.texture }, uLightDir: { value: new THREE.Vector3() }, uLightColor: { value: this.lightColor },
        uTime: { value: 0 }, uNight: { value: 0 }, uStars: { value: 0 }, uCloudCover: { value: 0.4 }, uCloudDensity: { value: 0.8 },
        uCloudScale: { value: 1 }, uCloudSpeed: { value: 1 }, uCloudTint: { value: new THREE.Color(1, 1, 1) }, uFlash: { value: 0 },
        uAmbientTop: { value: this.ambientTop }, uAmbientHorizon: { value: this.ambientHorizon }, uSunSize: { value: 0.0095 },
        uForBake: { value: 0 }, uGain: { value: 1 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.domeMat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    const envDome = new THREE.Mesh(this.mesh.geometry, this.domeMat);
    this.envScene.add(envDome);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  invalidate(): void { this.dirty = true; }

  /** Re-bake atmosphere + environment if the settings changed. Returns the PMREM env texture. */
  update(time: number): THREE.Texture | null {
    const s = this.settings;
    const u = this.domeMat.uniforms;
    u.uTime.value = time;
    u.uFlash.value = this.flash;
    if (!this.dirty) return null;
    this.dirty = false;
    s.lightDir.normalize();
    // light colour reaching the ground through the atmosphere
    lightTransmittance(s, this.lightColor);
    if (s.night) this.lightColor.multiply(new THREE.Color(0.62, 0.74, 1.0));
    skyRadiance(s, new THREE.Vector3(0, 1, 0), this.ambientTop).multiplyScalar(s.skyGain);
    skyRadiance(s, new THREE.Vector3(-s.lightDir.x, 0.05, -s.lightDir.z).normalize(), this.ambientHorizon).multiplyScalar(s.skyGain);
    const b = this.bakeMat.uniforms;
    b.uLightDir.value.copy(s.lightDir);
    b.uLightPower.value = s.lightPower;
    b.uRayleigh.value = s.rayleigh;
    b.uMie.value = s.mie;
    b.uMieG.value = s.mieG;
    b.uOzone.value = s.ozone;
    b.uTint.value.copy(s.tint);
    b.uZenithTint.value.copy(s.zenithTint);
    b.uGain.value = s.skyGain;
    u.uLightDir.value.copy(s.lightDir);
    u.uNight.value = s.night ? 1 : 0;
    u.uStars.value = s.stars;
    u.uCloudCover.value = s.cloudCover;
    u.uCloudDensity.value = s.cloudDensity;
    u.uCloudScale.value = s.cloudScale;
    u.uCloudSpeed.value = s.cloudSpeed;
    u.uCloudTint.value.copy(s.cloudTint);
    u.uSunSize.value = s.night ? 0.016 : 0.0095;
    this.bakeCam.update(this.renderer, this.bakeScene);
    // environment: the full sky (clouds, no disc: a 60x disc would make fireflies in the IBL)
    u.uForBake.value = 1;
    this.envCam.update(this.renderer, this.envScene);
    u.uForBake.value = 0;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromCubemap(this.envCube.texture);
    return this.envRT.texture;
  }

  dispose(): void {
    this.atmosCube.dispose();
    this.envCube.dispose();
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}
