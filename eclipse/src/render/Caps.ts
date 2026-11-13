import type { AbstractEngine, WebGPUEngine } from '@babylonjs/core';

/** Device limits that change how the renderer is configured. */
export interface RenderCaps {
  /** Interpolated vertex outputs a fragment shader may read (WebGPU minimum is 16). */
  varyings: number;
  /** When true, SSAO/SSR use a separate geometry pass instead of the multi-target pre-pass, whose
   *  extra varyings push PBR + cascaded shadow shaders over the limit. */
  separateGeometryPass: boolean;
  maxTextureSize: number;
  halfFloatRender: boolean;
}

export function probeCaps(engine: AbstractEngine): RenderCaps {
  let varyings = 16;
  if (engine.isWebGPU) {
    varyings = (engine as WebGPUEngine).currentLimits?.maxInterStageShaderVariables ?? 16;
  } else {
    const gl = (engine as unknown as { _gl?: WebGL2RenderingContext })._gl;
    if (gl) varyings = gl.getParameter(gl.MAX_VARYING_VECTORS) as number;
  }
  const caps = engine.getCaps();
  return {
    varyings,
    separateGeometryPass: varyings < 20,
    maxTextureSize: caps.maxTextureSize,
    halfFloatRender: caps.textureHalfFloatRender,
  };
}
