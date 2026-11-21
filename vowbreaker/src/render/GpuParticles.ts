import {
  ComputeShader, Constants, Mesh, Scene, ShaderLanguage, ShaderMaterial, StorageBuffer, UniformBuffer, Vector3, VertexBuffer, VertexData, WebGPUEngine,
} from '@babylonjs/core';
import { computeSource } from './ShaderLib';

export const PK = { spark: 0, ember: 1, debris: 2, petal: 3, paper: 4, smoke: 5, ash: 6, drop: 7, ink: 8, dust: 9 } as const;

export interface Burst {
  kind: number;
  pos: Vector3;
  count: number;
  speed: number;
  spread?: number;        // 1 = sphere, 0 = straight along dir
  dir?: Vector3;
  up?: number;            // added upward speed
  color: [number, number, number, number];
  size: [number, number];
  life: [number, number];
  drag?: number;
  jitter?: number;        // start position randomisation (m)
}

const STRIDE = 16; // floats per particle

/** One pool of compute-simulated particles drawn as instanced quads. */
class Pool {
  readonly buffer: StorageBuffer;
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  private head = 0;
  private scratch: Float32Array;

  constructor(engine: WebGPUEngine, scene: Scene, readonly max: number, readonly glow: boolean) {
    this.buffer = new StorageBuffer(engine, max * STRIDE * 4, Constants.BUFFER_CREATIONFLAG_VERTEX | Constants.BUFFER_CREATIONFLAG_READWRITE);
    this.buffer.update(new Float32Array(max * STRIDE));
    this.scratch = new Float32Array(256 * STRIDE);
    this.mesh = new Mesh(glow ? 'gpuGlow' : 'gpuMatter', scene);
    const vd = new VertexData();
    vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh);
    const raw = this.buffer.getBuffer();
    for (const [name, off] of [['p0', 0], ['p1', 4], ['p2', 8], ['p3', 12]] as const) {
      this.mesh.setVerticesBuffer(new VertexBuffer(engine, raw, name, false, false, STRIDE, true, off, 4));
    }
    this.mat = new ShaderMaterial('particleMat' + (glow ? 'G' : 'M'), scene, { vertex: 'particle', fragment: 'particle' }, {
      attributes: ['position', 'p0', 'p1', 'p2', 'p3'], uniforms: ['viewProjection', 'view', 'cameraPosition', 'time'],
      defines: glow ? ['GLOW'] : [], shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = glow ? Constants.ALPHA_ONEONE : Constants.ALPHA_COMBINE;
    this.mesh.material = this.mat;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.forcedInstanceCount = max;
    this.mesh.renderingGroupId = 1;
  }

  emit(b: Burst): void {
    const n = Math.min(b.count, 256);
    const d = this.scratch;
    const dir = b.dir ?? new Vector3(0, 1, 0);
    const spread = b.spread ?? 1;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      // random direction: blend of `dir` and a random unit vector
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const rx = r * Math.cos(th);
      const ry = u;
      const rz = r * Math.sin(th);
      let vx = dir.x * (1 - spread) + rx * spread;
      let vy = dir.y * (1 - spread) + ry * spread;
      let vz = dir.z * (1 - spread) + rz * spread;
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = b.speed * (0.4 + Math.random() * 0.8);
      vx = (vx / l) * sp;
      vy = (vy / l) * sp + (b.up ?? 0);
      vz = (vz / l) * sp;
      const j = b.jitter ?? 0;
      const life = b.life[0] + Math.random() * (b.life[1] - b.life[0]);
      d[o] = b.pos.x + (Math.random() - 0.5) * j;
      d[o + 1] = b.pos.y + (Math.random() - 0.5) * j;
      d[o + 2] = b.pos.z + (Math.random() - 0.5) * j;
      d[o + 3] = life;
      d[o + 4] = vx;
      d[o + 5] = vy;
      d[o + 6] = vz;
      d[o + 7] = life;
      d[o + 8] = b.color[0];
      d[o + 9] = b.color[1];
      d[o + 10] = b.color[2];
      d[o + 11] = b.color[3];
      d[o + 12] = b.size[0] + Math.random() * (b.size[1] - b.size[0]);
      d[o + 13] = b.kind;
      d[o + 14] = Math.random();
      d[o + 15] = b.drag ?? 1.5;
    }
    // write into the ring buffer (in up to two pieces)
    const first = Math.min(n, this.max - this.head);
    this.buffer.update(d.subarray(0, first * STRIDE), this.head * STRIDE * 4, first * STRIDE * 4);
    if (n > first) this.buffer.update(d.subarray(first * STRIDE, n * STRIDE), 0, (n - first) * STRIDE * 4);
    this.head = (this.head + n) % this.max;
  }

  clear(): void {
    this.buffer.update(new Float32Array(this.max * STRIDE));
  }
}

/** Compute-shader particles: a glow pool (additive) and a matter pool (alpha). */
export class GpuParticles {
  private glow: Pool;
  private matter: Pool;
  private cs: ComputeShader;
  private csMatter: ComputeShader;
  private params: UniformBuffer;
  private paramsMatter: UniformBuffer;
  time = 0;
  gravity = -9;
  turbulence = 1.2;
  attract = new Vector3();
  attractStrength = 0;
  wind = new Vector3();
  ground = 0;

  constructor(engine: WebGPUEngine, scene: Scene) {
    this.glow = new Pool(engine, scene, 8192, true);
    this.matter = new Pool(engine, scene, 4096, false);
    const src = computeSource('particles');
    const mk = (pool: Pool) => {
      const cs = new ComputeShader('particleSim', engine, { computeSource: src }, {
        bindingsMapping: { particles: { group: 0, binding: 0 }, params: { group: 0, binding: 1 } },
      });
      const ub = new UniformBuffer(engine, undefined, false, 'simParams');
      ub.addUniform('dt', 1);
      ub.addUniform('time', 1);
      ub.addUniform('gravity', 1);
      ub.addUniform('turbulence', 1);
      ub.addUniform('attract', 4);
      ub.addUniform('wind', 4);
      ub.addUniform('count', 1);
      ub.addUniform('pad0', 1);
      ub.addUniform('pad1', 1);
      ub.addUniform('pad2', 1);
      ub.create();
      cs.setStorageBuffer('particles', pool.buffer);
      cs.setUniformBuffer('params', ub);
      return { cs, ub };
    };
    const a = mk(this.glow);
    const b = mk(this.matter);
    this.cs = a.cs;
    this.params = a.ub;
    this.csMatter = b.cs;
    this.paramsMatter = b.ub;
  }

  burst(b: Burst): void {
    const glow = b.kind === PK.spark || b.kind === PK.ember || b.kind === PK.dust;
    (glow ? this.glow : this.matter).emit(b);
  }

  private fill(ub: UniformBuffer, dt: number, count: number): void {
    ub.updateFloat('dt', dt);
    ub.updateFloat('time', this.time);
    ub.updateFloat('gravity', this.gravity);
    ub.updateFloat('turbulence', this.turbulence);
    ub.updateFloat4('attract', this.attract.x, this.attract.y, this.attract.z, this.attractStrength);
    ub.updateFloat4('wind', this.wind.x, this.wind.y, this.wind.z, this.ground);
    ub.updateUInt('count', count);
    ub.update();
  }

  update(dt: number): void {
    this.time += dt;
    if (dt <= 0) return;
    this.fill(this.params, dt, this.glow.max);
    this.cs.dispatch(Math.ceil(this.glow.max / 64));
    this.fill(this.paramsMatter, dt, this.matter.max);
    this.csMatter.dispatch(Math.ceil(this.matter.max / 64));
    this.glow.mat.setFloat('time', this.time);
    this.matter.mat.setFloat('time', this.time);
  }

  clear(): void {
    this.glow.clear();
    this.matter.clear();
  }
}
