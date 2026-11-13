import { ShaderStore } from '@babylonjs/core';
// Importing the shader module registers it now, so it can be corrected before first use (the
// engine's own lazy import later finds the corrected entry and leaves it alone).
import '@babylonjs/core/ShadersWGSL/geometry.fragment.js';
import { log } from '../core/Log';

/**
 * Fixes for engine bugs found while building the game. Each patch checks that the faulty code is
 * still present, so upgrading Babylon.js simply turns the patch into a no-op.
 */
export function applyEnginePatches(): void {
  // Babylon.js 9.35: the WGSL geometry-buffer shader (used by SSR/SSAO when they render their own
  // G-buffer) converts a vec3 albedo with toLinearSpaceVec4 whenever the albedo texture is sRGB,
  // which fails WGSL validation and blanks the frame on WebGPU.
  const key = 'geometryPixelShader';
  const src = ShaderStore.ShadersStoreWGSL[key];
  if (src && src.includes('color=toLinearSpaceVec4(color);')) {
    ShaderStore.ShadersStoreWGSL[key] = src.replace('color=toLinearSpaceVec4(color);', 'color=toLinearSpaceVec3(color);');
    log.debug('patched WGSL geometry shader (gamma albedo conversion)');
  }
}
