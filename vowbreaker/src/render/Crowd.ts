import { Buffer, Color3, Matrix, Mesh, ShaderLanguage, ShaderMaterial, Vector3, Vector4, VertexData } from '@babylonjs/core';
import type { Renderer } from './Renderer';

/** A crowd of background people round a square (vb_crowd). */
export interface CrowdDef {
  center: [number, number, number];
  /** the ring they occupy: inner and outer radius (keep clear of the arena) */
  ring: [number, number];
  count: number;
  /** weights of stroll, idle, cheer, flee */
  behaviours?: [number, number, number, number];
  /** weights of no prop, lantern, fan, child on the shoulders, umbrella */
  props?: [number, number, number, number, number];
  fogDensity?: number;
}

function pick(w: number[]): number {
  const sum = w.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
}

/** Build the jointed body: every vertex knows its part (uv2.x) for the vertex-shader rig. */
function bodyData(): VertexData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const uv2: number[] = [];
  const idx: number[] = [];
  const add = (vd: VertexData, part: number, m: Matrix) => {
    const base = pos.length / 3;
    const p = vd.positions!;
    const n = vd.normals!;
    for (let i = 0; i < p.length; i += 3) {
      const v = Vector3.TransformCoordinates(new Vector3(p[i], p[i + 1], p[i + 2]), m);
      const vn = Vector3.TransformNormal(new Vector3(n[i], n[i + 1], n[i + 2]), m).normalize();
      pos.push(v.x, v.y, v.z);
      nrm.push(vn.x, vn.y, vn.z);
      uv2.push(part, 0);
    }
    const u = vd.uvs!;
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (const k of vd.indices!) idx.push(base + k);
  };
  const T = (x: number, y: number, z: number) => Matrix.Translation(x, y, z);
  // robe (torso), flared toward the hem
  add(VertexData.CreateCylinder({ height: 0.7, diameterTop: 0.26, diameterBottom: 0.34, tessellation: 10 }), 0, T(0, 0.47, 0));
  add(VertexData.CreateSphere({ diameter: 0.17, segments: 6 }), 1, T(0, 0.9, 0));
  add(VertexData.CreateCylinder({ height: 0.48, diameterTop: 0.09, diameterBottom: 0.07, tessellation: 6 }), 2, T(0.06, 0.24, 0));
  add(VertexData.CreateCylinder({ height: 0.48, diameterTop: 0.09, diameterBottom: 0.07, tessellation: 6 }), 3, T(-0.06, 0.24, 0));
  // wide yukata sleeves hanging from the shoulders
  add(VertexData.CreateCylinder({ height: 0.32, diameterTop: 0.08, diameterBottom: 0.13, tessellation: 6 }), 4, T(0.16, 0.65, 0));
  add(VertexData.CreateCylinder({ height: 0.32, diameterTop: 0.08, diameterBottom: 0.13, tessellation: 6 }), 5, T(-0.16, 0.65, 0));
  // props: a lantern on a stick, a fan, a child on the shoulders, an umbrella
  add(VertexData.CreateSphere({ diameter: 0.16, segments: 6 }), 6, Matrix.Scaling(1, 1.3, 1).multiply(T(-0.2, 1.02, 0.18)));
  add(VertexData.CreateCylinder({ height: 0.4, diameter: 0.015, tessellation: 4 }), 6, T(-0.19, 0.78, 0.16));
  add(VertexData.CreateCylinder({ height: 0.01, diameter: 0.2, tessellation: 10 }), 7, Matrix.RotationX(Math.PI / 2).multiply(T(-0.18, 0.62, 0.14)));
  add(VertexData.CreateCylinder({ height: 0.26, diameterTop: 0.14, diameterBottom: 0.18, tessellation: 8 }), 8, T(0, 1.08, -0.02));
  add(VertexData.CreateSphere({ diameter: 0.12, segments: 6 }), 8, T(0, 1.27, -0.02));
  add(VertexData.CreateCylinder({ height: 0.16, diameterTop: 0.02, diameterBottom: 0.62, tessellation: 12 }), 9, T(-0.1, 1.2, 0.05));
  add(VertexData.CreateCylinder({ height: 0.6, diameter: 0.015, tessellation: 4 }), 9, T(-0.12, 0.95, 0.05));
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nrm;
  vd.uvs = uv;
  vd.uvs2 = uv2;
  vd.indices = idx;
  return vd;
}

/** Instanced background people animated in the vertex shader: strolling, idling, cheering, fleeing. */
export class Crowd {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private buffer: Buffer;
  private off: () => void;

  constructor(r: Renderer, def: CrowdDef, glow: () => Color3, fog: () => Color3) {
    const scene = r.scene;
    this.mesh = new Mesh('crowd', scene);
    bodyData().applyToMesh(this.mesh);
    const data = new Float32Array(def.count * 12);
    const bw = def.behaviours ?? [0.55, 0.3, 0.15, 0];
    const pw = def.props ?? [0.47, 0.25, 0.15, 0.08, 0.05];
    for (let i = 0; i < def.count; i++) {
      const o = i * 12;
      const a = Math.random() * Math.PI * 2;
      const rad = def.ring[0] + Math.random() * (def.ring[1] - def.ring[0]);
      const behaviour = pick(bw);
      const child = Math.random() < 0.15;
      data[o] = def.center[0] + Math.cos(a) * rad;
      data[o + 1] = def.center[2] + Math.sin(a) * rad;
      // standing people face the middle of the square (where the fight is)
      data[o + 2] = Math.atan2(def.center[0] - data[o], def.center[2] - data[o + 1]) + (Math.random() - 0.5) * 0.8;
      data[o + 3] = child ? 1.05 + Math.random() * 0.2 : 1.5 + Math.random() * 0.35;
      data[o + 4] = behaviour;
      data[o + 5] = a;
      data[o + 6] = behaviour === 3 ? 4 + Math.random() * 2 : 0.9 + Math.random() * 0.5;
      data[o + 7] = rad;
      data[o + 8] = Math.floor(Math.random() * 8);
      data[o + 9] = Math.floor(Math.random() * 5);
      data[o + 10] = child ? 0 : pick(pw);
      data[o + 11] = Math.random();
    }
    const engine = scene.getEngine();
    this.buffer = new Buffer(engine, data, false, 12, false, true);
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('c0', 0, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('c1', 4, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('c2', 8, 4));
    this.mesh.forcedInstanceCount = def.count;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mat = new ShaderMaterial('crowdMat', scene, { vertex: 'crowd', fragment: 'crowd' }, {
      attributes: ['position', 'normal', 'uv', 'uv2', 'c0', 'c1', 'c2'],
      uniforms: ['viewProjection', 'view', 'cameraPosition', 'crowdParams', 'sunDir', 'sunColor', 'skyColor', 'glowColor', 'crowdFog'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.mesh.material = this.mat;
    this.off = r.mats.onUpdate((l) => {
      const m = this.mat;
      m.setVector3('cameraPosition', r.camera.globalPosition);
      m.setVector4('crowdParams', new Vector4(l.time, def.center[0], def.center[2], def.center[1]));
      m.setVector3('sunDir', l.sunDir);
      m.setColor3('sunColor', l.sunColor);
      m.setColor3('skyColor', l.skyColor);
      m.setColor3('glowColor', glow());
      const f = fog();
      m.setVector4('crowdFog', new Vector4(f.r, f.g, f.b, def.fogDensity ?? 0.02));
    });
  }

  dispose(): void {
    this.off();
    this.buffer.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
