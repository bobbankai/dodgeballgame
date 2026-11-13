import {
  Constants, PostProcess, Texture, type AbstractEngine, type Camera, type Effect, type Nullable,
} from '@babylonjs/core';
import { registerShader, shaderLanguage } from '../ShaderLib';

export interface PostDef {
  name: string;
  glsl: string;
  wgsl: string;
  uniforms?: string[];
  samplers?: string[];
  /** Ratio of the render size, or a fixed size in pixels. */
  size?: number | { width: number; height: number };
  camera: Nullable<Camera>;
  engine: AbstractEngine;
  hdr?: boolean;
  sampling?: number;
  /** When true the pass binds `textureSampler` itself (side chains reading other passes). */
  externalInput?: boolean;
  defines?: string;
}

/** Creates a post-process from a dual WGSL/GLSL fragment shader. */
export function makePost(d: PostDef): PostProcess {
  registerShader({ name: d.name, glsl: { fragment: d.glsl }, wgsl: { fragment: d.wgsl } });
  const type = d.hdr === false ? Constants.TEXTURETYPE_UNSIGNED_BYTE : Constants.TEXTURETYPE_HALF_FLOAT;
  const size = d.size ?? 1;
  const pp = new PostProcess(d.name, d.name, d.uniforms ?? [], d.samplers ?? [], size, d.camera,
    d.sampling ?? Texture.BILINEAR_SAMPLINGMODE, d.engine, false, d.defines ?? null, type, undefined, undefined, false,
    undefined, shaderLanguage(d.engine));
  if (d.externalInput) pp.externalTextureSamplerBinding = true;
  return pp;
}

/** Binds 1/width, 1/height of a post-process's input as `texel`. */
export function setTexel(effect: Effect, pp: PostProcess, name = 'texel'): void {
  effect.setFloat2(name, 1 / Math.max(1, pp.width), 1 / Math.max(1, pp.height));
}

/** Shared GLSL / WGSL snippets for post shaders. */
export const POST_GLSL_HEAD = /* glsl */ `precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
`;

export const POST_WGSL_HEAD = /* wgsl */ `varying vUV: vec2f;
var textureSamplerSampler: sampler;
var textureSampler: texture_2d<f32>;
`;
