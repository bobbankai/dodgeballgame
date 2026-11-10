// The shader system's language layer: shaders are written once in a small neutral dialect and emitted as
// WGSL (WebGPU) or GLSL (WebGL2). Used by the surface plugin (code injected into the PBR shader), by the
// effect materials (sky, rain, light shafts, crowd) and by the post-process.
//
//   types / constructors   F V2 V3 V4 M3 M4 I
//   locals                 let x: F = ...;   var v: V3 = ...;      (always typed)
//   functions              fn name(a: V3, b: F) -> F { ... }
//   uniforms, inputs       U.name   IN.name (fragment varyings)   A.name (attributes)   OUT.name (vertex outputs)
//   outputs                OUT.position (clip position)   COLOR (fragment colour)
//   textures               TEX(name, uv)
//   stage shaders          attribute n: T;  varying n: T;  uniform n: T;  sampler n;  @vertex { }  @fragment { }
// Not available in both targets, so not used: swizzle assignment, ?:, mod() (use fract / floor).

const TYPES: Record<string, [string, string]> = {
  F: ['f32', 'float'], V2: ['vec2f', 'vec2'], V3: ['vec3f', 'vec3'], V4: ['vec4f', 'vec4'],
  M3: ['mat3x3f', 'mat3'], M4: ['mat4x4f', 'mat4'], I: ['i32', 'int'],
};

export function sl(src: string, wgsl: boolean): string {
  const ty = (t: string) => TYPES[t]?.[wgsl ? 0 : 1] ?? t;
  let s = src;
  if (wgsl) {
    s = s.replace(/^\s*sampler (\w+);/gm, 'var $1: texture_2d<f32>;\nvar $1Sampler: sampler;')
      .replace(/@vertex\s*\{/, '@vertex\nfn main(input: VertexInputs) -> FragmentInputs {')
      .replace(/@fragment\s*\{/, '@fragment\nfn main(input: FragmentInputs) -> FragmentOutputs {')
      .replace(/\bTEX\((\w+),/g, 'textureSample($1, $1Sampler,')
      .replace(/\bU\./g, 'uniforms.').replace(/\bIN\./g, 'fragmentInputs.').replace(/\bA\./g, 'vertexInputs.')
      .replace(/\bOUT\./g, 'vertexOutputs.').replace(/\bCOLOR\b/g, 'fragmentOutputs.color');
  } else {
    s = s.replace(/^\s*sampler (\w+);/gm, 'uniform sampler2D $1;')
      .replace(/^(\s*)(attribute|varying|uniform|const) (\w+): (\w+)/gm, '$1$2 $4 $3')
      .replace(/@(vertex|fragment)\s*\{/, 'void main(void) {')
      .replace(/\bfn (\w+)\(([^)]*)\)\s*(?:->\s*(\w+))?\s*\{/g, (_m, name: string, params: string, ret?: string) =>
        `${ret ?? 'void'} ${name}(${params.split(',').filter((p) => p.trim()).map((p) => p.trim().split(/\s*:\s*/).reverse().join(' ')).join(', ')}) {`)
      .replace(/\b(?:let|var) (\w+): (\w+) =/g, '$2 $1 =')
      .replace(/\bTEX\(/g, 'texture2D(').replace(/\batan2\(/g, 'atan(').replace(/\bdpd([xy])\(/g, 'dFd$1(')
      .replace(/\bOUT\.position\b/g, 'gl_Position').replace(/\bCOLOR\b/g, 'gl_FragColor')
      .replace(/\b(?:U|IN|A|OUT)\./g, '');
  }
  return s.replace(/\b(F|V2|V3|V4|M3|M4|I)\b/g, (m) => ty(m));
}

/** Helpers shared by every shader: hashes and value noise, written in the neutral dialect. */
export const NOISE = `
fn tbHash(p: V2) -> F { let q: V3 = fract(V3(p.x, p.y, p.x) * 0.1031); let d: F = dot(q, V3(q.y, q.z, q.x) + 33.33); return fract((q.x + q.y + d) * (q.z + d)); }
fn tbNoise(p: V2) -> F {
  let i: V2 = floor(p); let f: V2 = fract(p); let u: V2 = f * f * (3.0 - 2.0 * f);
  return mix(mix(tbHash(i), tbHash(i + V2(1.0, 0.0)), u.x), mix(tbHash(i + V2(0.0, 1.0)), tbHash(i + V2(1.0, 1.0)), u.x), u.y);
}
fn tbFbm(p: V2) -> F { return tbNoise(p) * 0.5 + tbNoise(p * 2.03 + 17.0) * 0.3 + tbNoise(p * 4.1 + 51.0) * 0.2; }
`;
