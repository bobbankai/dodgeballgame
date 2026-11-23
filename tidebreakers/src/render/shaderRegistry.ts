// Registers every .wgsl file under src/shaders with Babylon's WGSL shader store.
//
//   shaders/lib/<name>.wgsl, shaders/**/inc/<name>.wgsl  -> include `#include<name>`
//   shaders/**/<name>.vertex.wgsl                         -> vertex shader "<name>"
//   shaders/**/<name>.fragment.wgsl                       -> fragment shader "<name>"
//
// Includes are plain text pasted by Babylon's preprocessor, so they may declare uniforms, functions and
// constants; #ifdef/#define work as in Babylon's own shaders.
import { ShaderStore } from '@babylonjs/core';

const files = import.meta.glob('../shaders/**/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

let registered = false;
export const shaderStats = { files: 0, lines: 0 };

export function registerShaders(): void {
  if (registered) return;
  registered = true;
  for (const [path, src] of Object.entries(files)) {
    const file = path.split('/').pop()!.replace(/\.wgsl$/, '');
    shaderStats.files++;
    shaderStats.lines += src.split('\n').length;
    if (file.endsWith('.vertex')) {
      ShaderStore.ShadersStoreWGSL[file.slice(0, -7) + 'VertexShader'] = src;
    } else if (file.endsWith('.fragment')) {
      ShaderStore.ShadersStoreWGSL[file.slice(0, -9) + 'FragmentShader'] = src;
    } else {
      ShaderStore.IncludesShadersStoreWGSL[file] = src;
    }
  }
}
