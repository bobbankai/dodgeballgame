import { ShaderStore } from '@babylonjs/core';

// Every .wgsl file under src/shaders is registered with Babylon's WGSL shader store:
//   lib/<name>.wgsl                 -> include  `#include<vb_<name>>`
//   materials|post/<name>.<stage>.wgsl -> shader `<name>VertexShader` / `<name>FragmentShader`
const libs = import.meta.glob('../shaders/lib/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const stages = import.meta.glob(['../shaders/materials/*.wgsl', '../shaders/post/*.wgsl'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const computes = import.meta.glob('../shaders/compute/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

let done = false;

export function registerShaders(): void {
  if (done) return;
  done = true;
  for (const [path, src] of Object.entries(libs)) {
    const name = path.split('/').pop()!.replace('.wgsl', '');
    ShaderStore.IncludesShadersStoreWGSL['vb_' + name] = src;
  }
  for (const [path, src] of Object.entries(stages)) {
    const file = path.split('/').pop()!;
    const [name, stage] = file.split('.');
    const key = name + (stage === 'vertex' ? 'VertexShader' : 'FragmentShader');
    ShaderStore.ShadersStoreWGSL[key] = src;
  }
}

/** Raw source of a compute shader (src/shaders/compute/<name>.wgsl), with library includes inlined. */
export function computeSource(name: string): string {
  const src = computes[`../shaders/compute/${name}.wgsl`];
  if (!src) throw new Error('no compute shader ' + name);
  return src.replace(/#include<vb_(\w+)>/g, (_, n) => {
    const lib = libs[`../shaders/lib/${n}.wgsl`];
    if (!lib) throw new Error('no shader library ' + n);
    return lib;
  });
}

/** Line counts, for the debug overlay. */
export function shaderStats(): { files: number; lines: number } {
  const all = [...Object.values(libs), ...Object.values(stages), ...Object.values(computes)];
  return { files: all.length, lines: all.reduce((n, s) => n + s.split('\n').length, 0) };
}
