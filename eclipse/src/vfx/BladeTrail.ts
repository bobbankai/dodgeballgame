import { Constants, Mesh, ShaderMaterial, Vector3, Vector4, VertexData, type Scene } from '@babylonjs/core';
import { NOISE_GLSL, NOISE_WGSL, registerShader, shaderLanguage } from '../render/ShaderLib';

const VERT_GLSL = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 viewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAG_GLSL = /* glsl */ `
precision highp float;
varying vec2 vUV;
uniform vec4 uColor;
uniform vec4 uCore;
uniform float uTime;
uniform float uFade;
${NOISE_GLSL}
void main(void) {
  float age = vUV.x;                 // 0 = the blade now, 1 = oldest sample
  float along = vUV.y;               // 0 = hilt, 1 = tip
  float life = pow(1.0 - age, 3.0);
  // streaks travel along the arc and break the ribbon up like motion-smeared air
  float streak = ec_noise2(vec2(age * 7.0 - uTime * 9.0, along * 22.0));
  float edge = smoothstep(0.25, 0.85, along) * (1.0 - smoothstep(0.94, 1.0, along));
  float tipHot = smoothstep(0.82, 0.97, along) * (1.0 - smoothstep(0.0, 0.35, age));
  float a = life * edge * (0.25 + 0.75 * streak * streak) * uFade;
  vec3 c = uColor.rgb * uColor.a * a + uCore.rgb * uCore.a * tipHot * life * uFade;
  gl_FragColor = vec4(c, 0.0);
}`;

const VERT_WGSL = /* wgsl */ `
attribute position: vec3f;
attribute uv: vec2f;
uniform viewProjection: mat4x4f;
varying vUV: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.position = uniforms.viewProjection * vec4f(vertexInputs.position, 1.0);
}`;

const FRAG_WGSL = /* wgsl */ `
varying vUV: vec2f;
uniform uColor: vec4f;
uniform uCore: vec4f;
uniform uTime: f32;
uniform uFade: f32;
${NOISE_WGSL}
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let age = fragmentInputs.vUV.x;
  let along = fragmentInputs.vUV.y;
  let life = pow(1.0 - age, 3.0);
  let streak = ec_noise2(vec2f(age * 7.0 - uniforms.uTime * 9.0, along * 22.0));
  let edge = smoothstep(0.25, 0.85, along) * (1.0 - smoothstep(0.94, 1.0, along));
  let tipHot = smoothstep(0.82, 0.97, along) * (1.0 - smoothstep(0.0, 0.35, age));
  let a = life * edge * (0.25 + 0.75 * streak * streak) * uniforms.uFade;
  let c = uniforms.uColor.rgb * uniforms.uColor.a * a + uniforms.uCore.rgb * uniforms.uCore.a * tipHot * life * uniforms.uFade;
  fragmentOutputs.color = vec4f(c, 0.0);
}`;

registerShader({ name: 'ecTrail', glsl: { vertex: VERT_GLSL, fragment: FRAG_GLSL }, wgsl: { vertex: VERT_WGSL, fragment: FRAG_WGSL } });

interface Sample {
  base: Vector3;
  tip: Vector3;
  t: number;
}

const MAX_SAMPLES = 24;
const SUB = 4;
const COLS = (MAX_SAMPLES - 1) * SUB + 1;

/**
 * Weapon swing trail: the blade's base and tip are sampled every simulation step while the swing is
 * live; the ribbon between samples is subdivided with Catmull-Rom splines so fast arcs stay round
 * instead of faceting at 60 Hz. The shader fades it with age, brightens the tip and breaks it up with
 * travelling streaks. Additive HDR output, so bloom picks up the hot edge.
 */
export class BladeTrail {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private samples: Sample[] = [];
  private pos = new Float32Array(COLS * 2 * 3);
  private uvs = new Float32Array(COLS * 2 * 2);
  emitting = false;
  /** Seconds of history drawn. */
  duration = 0.14;
  private time = 0;
  private fade = 0;
  private v4a = new Vector4();
  private v4b = new Vector4();
  color: [number, number, number, number] = [1.0, 0.86, 0.62, 0.55];
  core: [number, number, number, number] = [1.0, 0.95, 0.85, 1.6];

  constructor(scene: Scene, name: string) {
    const idx: number[] = [];
    for (let i = 0; i < COLS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.uvs = this.uvs;
    vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mat = new ShaderMaterial(`${name}:mat`, scene, { vertex: 'ecTrail', fragment: 'ecTrail' }, {
      attributes: ['position', 'uv'],
      uniforms: ['viewProjection', 'uColor', 'uCore', 'uTime', 'uFade'],
      needAlphaBlending: true,
      shaderLanguage: shaderLanguage(scene.getEngine()),
    });
    this.mat.alphaMode = Constants.ALPHA_ONEONE;
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mesh.material = this.mat;
    this.mesh.setEnabled(false);
  }

  /** Called every simulation step with the blade's current world segment. */
  sample(base: Vector3, tip: Vector3, dt: number): void {
    this.time += dt;
    if (this.emitting) {
      this.samples.unshift({ base: base.clone(), tip: tip.clone(), t: this.time });
      if (this.samples.length > MAX_SAMPLES) this.samples.length = MAX_SAMPLES;
      this.fade = Math.min(1, this.fade + dt * 30);
    } else {
      this.fade = Math.max(0, this.fade - dt * 7);
    }
    // forget samples older than the trail
    while (this.samples.length && this.time - this.samples[this.samples.length - 1].t > this.duration + 0.05) this.samples.pop();
    if (this.fade <= 0 || this.samples.length < 2) {
      this.mesh.setEnabled(false);
      if (this.fade <= 0) this.samples.length = 0;
      return;
    }
    this.mesh.setEnabled(true);
    this.rebuild();
  }

  private rebuild(): void {
    const s = this.samples;
    const n = s.length;
    let col = 0;
    const p = this.pos;
    const uv = this.uvs;
    const cr = (a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number, k: 'x' | 'y' | 'z') => {
      const t2 = t * t;
      const t3 = t2 * t;
      return 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3);
    };
    for (let i = 0; i < n - 1 && col < COLS; i++) {
      const s0 = s[Math.max(0, i - 1)];
      const s1 = s[i];
      const s2 = s[i + 1];
      const s3 = s[Math.min(n - 1, i + 2)];
      const last = i === n - 2;
      for (let j = 0; j < (last ? SUB + 1 : SUB) && col < COLS; j++) {
        const t = j / SUB;
        const age = (this.time - (s1.t + (s2.t - s1.t) * t)) / this.duration;
        for (const [row, key] of [[0, 'base'], [1, 'tip']] as const) {
          const o = (col * 2 + row) * 3;
          for (const [ax, k] of [[0, 'x'], [1, 'y'], [2, 'z']] as const) p[o + ax] = cr(s0[key], s1[key], s2[key], s3[key], t, k);
          const u = (col * 2 + row) * 2;
          uv[u] = Math.min(1, Math.max(0, age));
          uv[u + 1] = row;
        }
        col++;
      }
    }
    // collapse unused columns onto the last one (zero-area triangles)
    for (let c = col; c < COLS; c++) {
      for (let r = 0; r < 2; r++) {
        const o = (c * 2 + r) * 3;
        const l = ((col - 1) * 2 + r) * 3;
        p[o] = p[l];
        p[o + 1] = p[l + 1];
        p[o + 2] = p[l + 2];
        uv[(c * 2 + r) * 2] = 1;
      }
    }
    this.mesh.updateVerticesData('position', p, false, false);
    this.mesh.updateVerticesData('uv', uv, false, false);
  }

  /** Per rendered frame: shader time and colours. */
  update(): void {
    this.mat.setFloat('uTime', this.time);
    this.mat.setFloat('uFade', this.fade);
    this.mat.setVector4('uColor', this.v4a.set(...this.color));
    this.mat.setVector4('uCore', this.v4b.set(...this.core));
  }

  dispose(): void {
    this.mesh.dispose();
    this.mat.dispose();
  }
}
