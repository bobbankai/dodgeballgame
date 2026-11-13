import { Constants, MeshBuilder, ShaderMaterial, Vector4, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { NOISE_GLSL, NOISE_WGSL, registerShader, shaderLanguage } from '../render/ShaderLib';

/*
 * Ground-plane effects drawn on flat discs: danger telegraphs (an edge ring and a fill that grows to
 * the rim as the strike approaches, inside a ring of glyphs that light in turn), shockwave rings, and scorch marks that cool
 * from glowing embers to soot. Mode 0/1 are additive; mode 2 is alpha blended.
 */
const VERT_GLSL = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv * 2.0 - 1.0;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}`;

const FRAG_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec4 uColor;
uniform vec4 uParams; // x progress, y time, z mode, w alpha
${NOISE_GLSL}
// one glyph per cell: a spine and up to seven more strokes picked by a hash of the cell
float ec_seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a; vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
float ec_glyph(vec2 p, float seed) {
  float bits = floor(fract(sin(seed * 91.7 + 13.1) * 43758.5453) * 256.0);
  float d = ec_seg(p, vec2(0.5, 0.12), vec2(0.5, 0.88));
  for (int i = 1; i < 8; i++) {
    if (mod(floor(bits / exp2(float(i))), 2.0) < 0.5) continue;
    vec2 a = vec2(0.22, 0.82); vec2 b = vec2(0.78, 0.82);
    if (i == 2) { a = vec2(0.22, 0.18); b = vec2(0.78, 0.18); }
    else if (i == 3) { a = vec2(0.22, 0.18); b = vec2(0.5, 0.5); }
    else if (i == 4) { a = vec2(0.5, 0.5); b = vec2(0.78, 0.82); }
    else if (i == 5) { a = vec2(0.28, 0.5); b = vec2(0.72, 0.5); }
    else if (i == 6) { a = vec2(0.22, 0.82); b = vec2(0.22, 0.45); }
    else if (i == 7) { a = vec2(0.78, 0.18); b = vec2(0.78, 0.55); }
    d = min(d, ec_seg(p, a, b));
  }
  return d;
}
void main(void) {
  float r = length(vUV);
  if (r > 1.0) discard;
  float prog = uParams.x; float t = uParams.y; float mode = uParams.z; float alpha = uParams.w;
  float ang = atan(vUV.y, vUV.x);
  vec3 col; float a;
  if (mode < 0.5) {
    // a sigil: thin bright rim, guide circles, a ring of glyphs that light in turn as the strike
    // nears, and a soft fill (capped, so it keeps its colour instead of burning to white)
    float rim = exp(-pow((r - 0.96) * 38.0, 2.0)) * (0.75 + 0.25 * sin(t * 18.0));
    float fillEdge = smoothstep(prog - 0.04, prog, r) * (1.0 - smoothstep(prog, prog + 0.015, r));
    float fill = (1.0 - smoothstep(prog - 0.02, prog, r)) * (0.07 + 0.1 * r * r);
    float circles = exp(-pow((r - 0.72) * 110.0, 2.0)) + exp(-pow((r - 0.9) * 110.0, 2.0));
    float a01 = fract((ang + t * 0.25) / 6.2831853) * 28.0;
    float cell = mod(floor(a01), 28.0);
    vec2 gp = vec2(fract(a01), (r - 0.745) / 0.13);
    float lit = smoothstep(cell / 28.0 - 0.02, cell / 28.0 + 0.04, prog * 1.15);
    float runes = (gp.y > 0.0 && gp.y < 1.0) ? smoothstep(0.1, 0.05, ec_glyph(gp, cell)) * (0.35 + 0.65 * lit) : 0.0;
    float lines = rim + fillEdge * 1.2 + runes * 0.85 + circles * 0.45;
    col = uColor.rgb * (uColor.a * lines + min(uColor.a, 1.6) * fill) * alpha;
    gl_FragColor = vec4(col, 0.0);
  } else if (mode < 1.5) {
    float w = 0.08 + 0.1 * (1.0 - prog);
    float ring = exp(-pow((r - mix(0.15, 0.97, prog)) / w, 2.0));
    float broken = 0.6 + 0.4 * ec_noise2(vec2(ang * 5.0, prog * 4.0));
    a = ring * broken * (1.0 - prog) * alpha;
    gl_FragColor = vec4(uColor.rgb * min(uColor.a, 2.5) * a, 0.0);
  } else {
    float n = ec_fbm2(vUV * 3.0 + 7.0);
    float shape = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6);
    float cracks = smoothstep(0.55, 0.6, ec_noise2(vUV * 9.0 + n * 2.0));
    float heat = (1.0 - prog) * (1.0 - prog);
    vec3 soot = vec3(0.02, 0.018, 0.016);
    vec3 glow = uColor.rgb * uColor.a * heat * cracks * shape;
    a = shape * 0.85 * alpha;
    gl_FragColor = vec4(soot + glow, a);
  }
}`;

const VERT_WGSL = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform world: mat4x4f;
uniform viewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv * 2.0 - 1.0;
  vertexOutputs.position = uniforms.viewProjection * uniforms.world * vec4f(vertexInputs.position, 1.0);
}`;

const FRAG_WGSL = /* wgsl */ `
varying vUV: vec2f;
uniform uColor: vec4f;
uniform uParams: vec4f;
${NOISE_WGSL}
fn ec_seg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a; let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
fn ec_glyph(p: vec2f, seed: f32) -> f32 {
  let bits = u32(floor(fract(sin(seed * 91.7 + 13.1) * 43758.5453) * 256.0));
  var d = ec_seg(p, vec2f(0.5, 0.12), vec2f(0.5, 0.88));
  for (var i = 1u; i < 8u; i++) {
    if (((bits >> i) & 1u) == 0u) { continue; }
    var a = vec2f(0.22, 0.82); var b = vec2f(0.78, 0.82);
    if (i == 2u) { a = vec2f(0.22, 0.18); b = vec2f(0.78, 0.18); }
    else if (i == 3u) { a = vec2f(0.22, 0.18); b = vec2f(0.5, 0.5); }
    else if (i == 4u) { a = vec2f(0.5, 0.5); b = vec2f(0.78, 0.82); }
    else if (i == 5u) { a = vec2f(0.28, 0.5); b = vec2f(0.72, 0.5); }
    else if (i == 6u) { a = vec2f(0.22, 0.82); b = vec2f(0.22, 0.45); }
    else if (i == 7u) { a = vec2f(0.78, 0.18); b = vec2f(0.78, 0.55); }
    d = min(d, ec_seg(p, a, b));
  }
  return d;
}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  let r = length(uv);
  if (r > 1.0) { discard; }
  let prog = uniforms.uParams.x; let t = uniforms.uParams.y; let mode = uniforms.uParams.z; let alpha = uniforms.uParams.w;
  let ang = atan2(uv.y, uv.x);
  if (mode < 0.5) {
    let rim = exp(-pow((r - 0.96) * 38.0, 2.0)) * (0.75 + 0.25 * sin(t * 18.0));
    let fillEdge = smoothstep(prog - 0.04, prog, r) * (1.0 - smoothstep(prog, prog + 0.015, r));
    let fill = (1.0 - smoothstep(prog - 0.02, prog, r)) * (0.07 + 0.1 * r * r);
    let circles = exp(-pow((r - 0.72) * 110.0, 2.0)) + exp(-pow((r - 0.9) * 110.0, 2.0));
    let a01 = fract((ang + t * 0.25) / 6.2831853) * 28.0;
    let cell = floor(a01) % 28.0;
    let gp = vec2f(fract(a01), (r - 0.745) / 0.13);
    let lit = smoothstep(cell / 28.0 - 0.02, cell / 28.0 + 0.04, prog * 1.15);
    var runes = 0.0;
    if (gp.y > 0.0 && gp.y < 1.0) { runes = smoothstep(0.1, 0.05, ec_glyph(gp, cell)) * (0.35 + 0.65 * lit); }
    let lines = rim + fillEdge * 1.2 + runes * 0.85 + circles * 0.45;
    fragmentOutputs.color = vec4f(uniforms.uColor.rgb * (uniforms.uColor.a * lines + min(uniforms.uColor.a, 1.6) * fill) * alpha, 0.0);
  } else if (mode < 1.5) {
    let w = 0.08 + 0.1 * (1.0 - prog);
    let ring = exp(-pow((r - mix(0.15, 0.97, prog)) / w, 2.0));
    let broken = 0.6 + 0.4 * ec_noise2(vec2f(ang * 5.0, prog * 4.0));
    let a = ring * broken * (1.0 - prog) * alpha;
    fragmentOutputs.color = vec4f(uniforms.uColor.rgb * min(uniforms.uColor.a, 2.5) * a, 0.0);
  } else {
    let n = ec_fbm2(uv * 3.0 + 7.0);
    let shape = 1.0 - smoothstep(0.35, 1.0, r + (n - 0.5) * 0.6);
    let cracks = smoothstep(0.55, 0.6, ec_noise2(uv * 9.0 + n * 2.0));
    let heat = (1.0 - prog) * (1.0 - prog);
    let soot = vec3f(0.02, 0.018, 0.016);
    let glow = uniforms.uColor.rgb * uniforms.uColor.a * heat * cracks * shape;
    fragmentOutputs.color = vec4f(soot + glow, shape * 0.85 * alpha);
  }
}`;

registerShader({ name: 'ecGround', glsl: { vertex: VERT_GLSL, fragment: FRAG_GLSL }, wgsl: { vertex: VERT_WGSL, fragment: FRAG_WGSL } });

export type GroundKind = 'telegraph' | 'shockwave' | 'scorch';

interface Decal {
  mesh: Mesh;
  mat: ShaderMaterial;
  kind: GroundKind;
  t: number;
  dur: number;
  /** Telegraphs and shockwaves fill/expand over `dur`; scorches cool over it then fade. */
  fadeOut: number;
  color: Vector4;
  params: Vector4;
  free: boolean;
}

/** Pooled ground discs. */
export class GroundFx {
  private pool: Decal[] = [];
  private time = 0;

  constructor(private scene: Scene) {}

  private get(kind: GroundKind): Decal {
    let d = this.pool.find((x) => x.free && x.kind === kind);
    if (!d) {
      const mesh = MeshBuilder.CreateGround(`ground_${kind}`, { width: 2, height: 2, subdivisions: 1 }, this.scene);
      mesh.isPickable = false;
      mesh.doNotSyncBoundingInfo = true;
      const mat = new ShaderMaterial(`ground_${kind}:mat`, this.scene, { vertex: 'ecGround', fragment: 'ecGround' }, {
        attributes: ['position', 'uv'],
        uniforms: ['world', 'viewProjection', 'uColor', 'uParams'],
        needAlphaBlending: true,
        shaderLanguage: shaderLanguage(this.scene.getEngine()),
      });
      mat.alphaMode = kind === 'scorch' ? Constants.ALPHA_COMBINE : Constants.ALPHA_ONEONE;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = false;
      mat.zOffset = -4;
      mesh.material = mat;
      d = { mesh, mat, kind, t: 0, dur: 1, fadeOut: 0.2, color: new Vector4(), params: new Vector4(), free: true };
      this.pool.push(d);
    }
    d.free = false;
    d.t = 0;
    d.mesh.setEnabled(true);
    return d;
  }

  /** A danger zone that fills over `time` seconds; returns a cancel function. */
  telegraph(at: Vector3, radius: number, time: number, color: [number, number, number, number] = [1, 0.35, 0.08, 3]): () => void {
    const d = this.get('telegraph');
    this.place(d, at, radius);
    d.dur = time;
    d.fadeOut = 0.12;
    d.color.set(...color);
    return () => {
      d.t = Math.max(d.t, d.dur);
    };
  }

  shockwave(at: Vector3, radius: number, color: [number, number, number, number] = [1, 0.55, 0.2, 4], time = 0.45): void {
    const d = this.get('shockwave');
    this.place(d, at, radius);
    d.dur = time;
    d.fadeOut = 0;
    d.color.set(...color);
  }

  scorch(at: Vector3, radius: number, color: [number, number, number, number] = [1, 0.35, 0.06, 6], cool = 3, linger = 8): void {
    const d = this.get('scorch');
    this.place(d, at, radius);
    d.mesh.rotation.y = Math.random() * Math.PI * 2;
    d.dur = cool;
    d.fadeOut = linger;
    d.color.set(...color);
  }

  private place(d: Decal, at: Vector3, radius: number): void {
    d.mesh.position.set(at.x, at.y + 0.03, at.z);
    d.mesh.scaling.set(radius, 1, radius);
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.pool) {
      if (d.free) continue;
      d.t += dt;
      const prog = Math.min(1, d.t / d.dur);
      const over = d.t - d.dur;
      let alpha = 1;
      if (over > 0) {
        if (d.fadeOut <= 0 || over >= d.fadeOut) {
          d.free = true;
          d.mesh.setEnabled(false);
          continue;
        }
        alpha = 1 - over / d.fadeOut;
      }
      if (d.kind === 'telegraph') alpha *= Math.min(1, d.t * 8);
      d.params.set(prog, this.time, d.kind === 'telegraph' ? 0 : d.kind === 'shockwave' ? 1 : 2, alpha);
      d.mat.setVector4('uColor', d.color);
      d.mat.setVector4('uParams', d.params);
    }
  }

  clear(): void {
    for (const d of this.pool) {
      d.free = true;
      d.mesh.setEnabled(false);
    }
  }
}
