// Single-scattering atmosphere (Rayleigh + Mie + ozone absorption), after Nishita / O'Neil and
// the "glsl-atmosphere" formulation. The same model runs on the GPU (sky bake) and here on the CPU
// so the sun colour, ambient tint and fog colour always agree with the sky the player sees.
import * as THREE from 'three';

export interface AtmosphereParams {
  /** direction TO the light (sun or moon), normalised */
  lightDir: THREE.Vector3;
  /** scattering source intensity (sun ~22, moon ~0.6) */
  lightPower: number;
  /** multiplies Rayleigh scattering (1 = clear Earth sky) */
  rayleigh: number;
  /** multiplies Mie scattering (haze, smoke) */
  mie: number;
  mieG: number;
  /** extra tint applied to the whole sky (smoke, storm) */
  tint: THREE.Color;
  /** ozone strength (deep blue twilight) */
  ozone: number;
}

export const ATMOS_GLSL = /* glsl */ `
const float R_PLANET = 6371e3;
const float R_ATMOS = 6471e3;
const vec3 K_RLH = vec3(5.5e-6, 13.0e-6, 22.4e-6);
const float K_MIE = 21e-6;
const vec3 K_OZONE = vec3(0.650e-6, 1.881e-6, 0.085e-6);
const float SH_RLH = 8e3;
const float SH_MIE = 1.2e3;

vec2 atmoRsi(vec3 r0, vec3 rd, float sr) {
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - sr * sr;
  float d = b * b - 4.0 * c;
  if (d < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(d);
  return vec2((-b - s) * 0.5, (-b + s) * 0.5);
}

// returns radiance arriving from direction r for an observer slightly above the ground
vec3 atmosphere(vec3 r, vec3 pSun, float iSun, float rlh, float mie, float g, float ozone) {
  vec3 r0 = vec3(0.0, R_PLANET + 120.0, 0.0);
  vec2 p = atmoRsi(r0, r, R_ATMOS);
  if (p.x > p.y) return vec3(0.0);
  p.y = min(p.y, atmoRsi(r0, r, R_PLANET).x);
  const int I_STEPS = 16;
  const int J_STEPS = 6;
  float iStepSize = (p.y - p.x) / float(I_STEPS);
  float iTime = 0.0;
  vec3 totalRlh = vec3(0.0);
  vec3 totalMie = vec3(0.0);
  float iOdRlh = 0.0;
  float iOdMie = 0.0;
  float mu = dot(r, pSun);
  float mumu = mu * mu;
  float gg = g * g;
  float pRlh = 3.0 / (16.0 * 3.14159265) * (1.0 + mumu);
  float pMie = 3.0 / (8.0 * 3.14159265) * ((1.0 - gg) * (mumu + 1.0)) / (pow(max(1.0 + gg - 2.0 * mu * g, 1e-4), 1.5) * (2.0 + gg));
  vec3 kR = K_RLH * rlh;
  float kM = K_MIE * mie;
  for (int i = 0; i < I_STEPS; i++) {
    vec3 iPos = r0 + r * (iTime + iStepSize * 0.5);
    float iHeight = length(iPos) - R_PLANET;
    float odStepRlh = exp(-iHeight / SH_RLH) * iStepSize;
    float odStepMie = exp(-iHeight / SH_MIE) * iStepSize;
    iOdRlh += odStepRlh;
    iOdMie += odStepMie;
    float jStepSize = atmoRsi(iPos, pSun, R_ATMOS).y / float(J_STEPS);
    float jTime = 0.0;
    float jOdRlh = 0.0;
    float jOdMie = 0.0;
    for (int j = 0; j < J_STEPS; j++) {
      vec3 jPos = iPos + pSun * (jTime + jStepSize * 0.5);
      float jHeight = length(jPos) - R_PLANET;
      jOdRlh += exp(-jHeight / SH_RLH) * jStepSize;
      jOdMie += exp(-jHeight / SH_MIE) * jStepSize;
      jTime += jStepSize;
    }
    vec3 attn = exp(-(kM * (iOdMie + jOdMie) + kR * (iOdRlh + jOdRlh) + K_OZONE * ozone * (iOdRlh + jOdRlh) * 0.6));
    totalRlh += odStepRlh * attn;
    totalMie += odStepMie * attn;
    iTime += iStepSize;
  }
  return iSun * (pRlh * kR * totalRlh + pMie * kM * totalMie);
}
`;

// ---- CPU mirror (used for light colour, fog and ambient uniforms) ----

const R_PLANET = 6371e3;
const R_ATMOS = 6471e3;
const K_RLH = [5.5e-6, 13.0e-6, 22.4e-6];
const K_MIE = 21e-6;
const K_OZONE = [0.65e-6, 1.881e-6, 0.085e-6];
const SH_RLH = 8e3;
const SH_MIE = 1.2e3;

function rsi(r0: number[], rd: number[], sr: number): [number, number] {
  const b = 2 * (rd[0] * r0[0] + rd[1] * r0[1] + rd[2] * r0[2]);
  const c = r0[0] * r0[0] + r0[1] * r0[1] + r0[2] * r0[2] - sr * sr;
  const d = b * b - 4 * c;
  if (d < 0) return [1e5, -1e5];
  const s = Math.sqrt(d);
  return [(-b - s) / 2, (-b + s) / 2];
}

/** colour transmitted along the direction to the light: what the sun looks like from the ground */
export function lightTransmittance(p: AtmosphereParams, out = new THREE.Color()): THREE.Color {
  const r0 = [0, R_PLANET + 120, 0];
  const d = [p.lightDir.x, Math.max(p.lightDir.y, -0.02), p.lightDir.z];
  const n = Math.hypot(d[0], d[1], d[2]);
  d[0] /= n; d[1] /= n; d[2] /= n;
  const tGround = rsi(r0, d, R_PLANET)[0];
  let tMax = rsi(r0, d, R_ATMOS)[1];
  if (tGround > 0) tMax = Math.min(tMax, tGround);
  const steps = 48;
  const ds = tMax / steps;
  let odR = 0;
  let odM = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * ds;
    const h = Math.hypot(r0[0] + d[0] * t, r0[1] + d[1] * t, r0[2] + d[2] * t) - R_PLANET;
    odR += Math.exp(-h / SH_RLH) * ds;
    odM += Math.exp(-h / SH_MIE) * ds;
  }
  const col = [0, 1, 2].map((k) => Math.exp(-(K_RLH[k] * p.rayleigh * odR + K_MIE * p.mie * 1.1 * odM + K_OZONE[k] * p.ozone * odR * 0.6)));
  return out.setRGB(col[0], col[1], col[2]);
}

/** CPU evaluation of the sky radiance in a direction (cheap: fewer steps than the shader) */
export function skyRadiance(p: AtmosphereParams, dir: THREE.Vector3, out = new THREE.Color()): THREE.Color {
  const r0 = [0, R_PLANET + 120, 0];
  const r = [dir.x, Math.max(dir.y, 0.0), dir.z];
  const n = Math.hypot(r[0], r[1], r[2]);
  r[0] /= n; r[1] /= n; r[2] /= n;
  const ps = [p.lightDir.x, p.lightDir.y, p.lightDir.z];
  const pa = rsi(r0, r, R_ATMOS);
  const tEnd = Math.min(pa[1], Math.max(rsi(r0, r, R_PLANET)[0], 0) || pa[1]);
  const I = 12;
  const J = 4;
  const ds = (tEnd - Math.max(pa[0], 0)) / I;
  let t = 0;
  const totR = [0, 0, 0];
  const totM = [0, 0, 0];
  let odR = 0;
  let odM = 0;
  const mu = r[0] * ps[0] + r[1] * ps[1] + r[2] * ps[2];
  const g = p.mieG;
  const pR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const pM = 3 / (8 * Math.PI) * ((1 - g * g) * (mu * mu + 1)) / (Math.pow(Math.max(1 + g * g - 2 * mu * g, 1e-4), 1.5) * (2 + g * g));
  for (let i = 0; i < I; i++) {
    const pos = [r0[0] + r[0] * (t + ds / 2), r0[1] + r[1] * (t + ds / 2), r0[2] + r[2] * (t + ds / 2)];
    const h = Math.hypot(pos[0], pos[1], pos[2]) - R_PLANET;
    const sR = Math.exp(-h / SH_RLH) * ds;
    const sM = Math.exp(-h / SH_MIE) * ds;
    odR += sR;
    odM += sM;
    const js = rsi(pos, ps, R_ATMOS)[1] / J;
    let jt = 0;
    let jR = 0;
    let jM = 0;
    for (let j = 0; j < J; j++) {
      const q = [pos[0] + ps[0] * (jt + js / 2), pos[1] + ps[1] * (jt + js / 2), pos[2] + ps[2] * (jt + js / 2)];
      const hh = Math.hypot(q[0], q[1], q[2]) - R_PLANET;
      jR += Math.exp(-hh / SH_RLH) * js;
      jM += Math.exp(-hh / SH_MIE) * js;
      jt += js;
    }
    for (let k = 0; k < 3; k++) {
      const att = Math.exp(-(K_MIE * p.mie * (odM + jM) + K_RLH[k] * p.rayleigh * (odR + jR) + K_OZONE[k] * p.ozone * (odR + jR) * 0.6));
      totR[k] += sR * att;
      totM[k] += sM * att;
    }
    t += ds;
  }
  const c = [0, 1, 2].map((k) => p.lightPower * (pR * K_RLH[k] * p.rayleigh * totR[k] + pM * K_MIE * p.mie * totM[k]));
  return out.setRGB(c[0] * p.tint.r, c[1] * p.tint.g, c[2] * p.tint.b);
}
