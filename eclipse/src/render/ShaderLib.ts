import { ShaderStore, ShaderLanguage, type AbstractEngine } from '@babylonjs/core';

/**
 * Every custom shader in the game is written twice: WGSL for the WebGPU engine (so no GLSL
 * transpiler is ever downloaded) and GLSL ES 3 for the WebGL 2 fallback. This registers both
 * versions under one name and picks the right language for the running engine.
 */
export interface DualShader {
  name: string;
  /** GLSL sources, Babylon post-process / ShaderMaterial conventions. */
  glsl: { vertex?: string; fragment: string };
  /** WGSL sources, Babylon conventions (`uniforms.x`, `fragmentOutputs.color`, `input.vUV`). */
  wgsl: { vertex?: string; fragment: string };
}

const registered = new Set<string>();

export function registerShader(s: DualShader): void {
  if (registered.has(s.name)) return;
  registered.add(s.name);
  if (s.glsl.vertex) ShaderStore.ShadersStore[`${s.name}VertexShader`] = s.glsl.vertex;
  ShaderStore.ShadersStore[`${s.name}PixelShader`] = s.glsl.fragment;
  ShaderStore.ShadersStore[`${s.name}FragmentShader`] = s.glsl.fragment;
  if (s.wgsl.vertex) ShaderStore.ShadersStoreWGSL[`${s.name}VertexShader`] = s.wgsl.vertex;
  ShaderStore.ShadersStoreWGSL[`${s.name}PixelShader`] = s.wgsl.fragment;
  ShaderStore.ShadersStoreWGSL[`${s.name}FragmentShader`] = s.wgsl.fragment;
}

export function registerInclude(name: string, glsl: string, wgsl: string): void {
  ShaderStore.IncludesShadersStore[name] = glsl;
  ShaderStore.IncludesShadersStoreWGSL[name] = wgsl;
}

export function shaderLanguage(engine: AbstractEngine): ShaderLanguage {
  return engine.isWebGPU ? ShaderLanguage.WGSL : ShaderLanguage.GLSL;
}

/** Shared noise helpers (value noise / fbm) in both languages. */
export const NOISE_GLSL = /* glsl */ `
float ec_hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float ec_hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ec_noise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ec_hash13(i), ec_hash13(i + vec3(1,0,0)), f.x), mix(ec_hash13(i + vec3(0,1,0)), ec_hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ec_hash13(i + vec3(0,0,1)), ec_hash13(i + vec3(1,0,1)), f.x), mix(ec_hash13(i + vec3(0,1,1)), ec_hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float ec_noise2(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ec_hash12(i), ec_hash12(i + vec2(1,0)), f.x), mix(ec_hash12(i + vec2(0,1)), ec_hash12(i + vec2(1,1)), f.x), f.y);
}
float ec_fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 4; k++) { s += a * ec_noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
float ec_fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * ec_noise2(p); p = p * 2.02 + vec2(5.3, 1.9); a *= 0.5; } return s; }
`;

export const NOISE_WGSL = /* wgsl */ `
fn ec_hash13(q: vec3f) -> f32 { var p = fract(q * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
fn ec_hash12(q: vec2f) -> f32 { var p3 = fract(vec3f(q.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
fn ec_noise3(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ec_hash13(i), ec_hash13(i + vec3f(1.,0.,0.)), f.x), mix(ec_hash13(i + vec3f(0.,1.,0.)), ec_hash13(i + vec3f(1.,1.,0.)), f.x), f.y),
             mix(mix(ec_hash13(i + vec3f(0.,0.,1.)), ec_hash13(i + vec3f(1.,0.,1.)), f.x), mix(ec_hash13(i + vec3f(0.,1.,1.)), ec_hash13(i + vec3f(1.,1.,1.)), f.x), f.y), f.z);
}
fn ec_noise2(x: vec2f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ec_hash12(i), ec_hash12(i + vec2f(1.,0.)), f.x), mix(ec_hash12(i + vec2f(0.,1.)), ec_hash12(i + vec2f(1.,1.)), f.x), f.y);
}
fn ec_fbm3(q: vec3f) -> f32 { var p = q; var a = 0.5; var s = 0.0; for (var k = 0; k < 4; k++) { s += a * ec_noise3(p); p = p * 2.03 + vec3f(1.7, 9.2, 3.1); a *= 0.5; } return s; }
fn ec_fbm2(q: vec2f) -> f32 { var p = q; var a = 0.5; var s = 0.0; for (var k = 0; k < 5; k++) { s += a * ec_noise2(p); p = p * 2.02 + vec2f(5.3, 1.9); a *= 0.5; } return s; }
`;

registerInclude('ecNoise', NOISE_GLSL, NOISE_WGSL);
