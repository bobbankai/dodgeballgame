import { Constants, MeshBuilder, ShaderMaterial, Vector4, type Mesh, type Scene, type Vector3 } from '@babylonjs/core';
import { NOISE_GLSL, NOISE_WGSL, registerShader, shaderLanguage } from '../render/ShaderLib';

/*
 * Ground-plane effects drawn on flat discs: danger telegraphs (an edge ring and a fill that grows to
 * the rim as the strike approaches, with crawling runes), shockwave rings, and scorch marks that cool
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
void main(void) {
  float r = length(vUV);
  if (r > 1.0) discard;
  float prog = uParams.x; float t = uParams.y; float mode = uParams.z; float alpha = uParams.w;
  float ang = atan(vUV.y, vUV.x);
  vec3 col; float a;
  if (mode < 0.5) {
    float rim = exp(-pow((r - 0.96) * 38.0, 2.0)) * (0.7 + 0.3 * sin(t * 18.0));
    float fillEdge = smoothstep(prog - 0.04, prog, r) * (1.0 - smoothstep(prog, prog + 0.015, r));
    float fill = (1.0 - smoothstep(prog - 0.02, prog, r)) * 0.22;
    float runes = step(0.62, ec_noise2(vec2(ang * 6.0 + t * 0.8, r * 9.0 - t * 2.0))) * smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.9, 0.95, r));
    a = (rim + fillEdge * 1.4 + fill + runes * 0.35) * alpha;
    col = uColor.rgb * uColor.a * a;
    gl_FragColor = vec4(col, 0.0);
  } else if (mode < 1.5) {
    float w = 0.08 + 0.1 * (1.0 - prog);
    float ring = exp(-pow((r - mix(0.15, 0.97, prog)) / w, 2.0));
    float broken = 0.6 + 0.4 * ec_noise2(vec2(ang * 5.0, prog * 4.0));
    a = ring * broken * (1.0 - prog) * alpha;
    gl_FragColor = vec4(uColor.rgb * uColor.a * a, 0.0);
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
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let uv = fragmentInputs.vUV;
  let r = length(uv);
  if (r > 1.0) { discard; }
  let prog = uniforms.uParams.x; let t = uniforms.uParams.y; let mode = uniforms.uParams.z; let alpha = uniforms.uParams.w;
  let ang = atan2(uv.y, uv.x);
  if (mode < 0.5) {
    let rim = exp(-pow((r - 0.96) * 38.0, 2.0)) * (0.7 + 0.3 * sin(t * 18.0));
    let fillEdge = smoothstep(prog - 0.04, prog, r) * (1.0 - smoothstep(prog, prog + 0.015, r));
    let fill = (1.0 - smoothstep(prog - 0.02, prog, r)) * 0.22;
    let runes = step(0.62, ec_noise2(vec2f(ang * 6.0 + t * 0.8, r * 9.0 - t * 2.0))) * smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.9, 0.95, r));
    let a = (rim + fillEdge * 1.4 + fill + runes * 0.35) * alpha;
    fragmentOutputs.color = vec4f(uniforms.uColor.rgb * uniforms.uColor.a * a, 0.0);
  } else if (mode < 1.5) {
    let w = 0.08 + 0.1 * (1.0 - prog);
    let ring = exp(-pow((r - mix(0.15, 0.97, prog)) / w, 2.0));
    let broken = 0.6 + 0.4 * ec_noise2(vec2f(ang * 5.0, prog * 4.0));
    let a = ring * broken * (1.0 - prog) * alpha;
    fragmentOutputs.color = vec4f(uniforms.uColor.rgb * uniforms.uColor.a * a, 0.0);
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
