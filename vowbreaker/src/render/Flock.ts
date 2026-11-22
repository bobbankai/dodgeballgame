import {
  ComputeShader, Constants, Mesh, Scene, ShaderLanguage, ShaderMaterial, StorageBuffer, UniformBuffer, Vector3, VertexBuffer, VertexData, WebGPUEngine,
} from '@babylonjs/core';
import { computeSource } from './ShaderLib';
import type { Materials } from './Materials';

/** What flies over a place: paper cranes, butterflies, crows, small birds (vb_flock kinds). */
export interface FlockDef {
  kind: 'cranes' | 'butterflies' | 'crows' | 'birds';
  count: number;
  /** the ring they circle: centre, radius, their height (and how much it varies) */
  centre: [number, number, number];
  radius: number;
  height: number;
  spread?: number;
}

const KIND = { cranes: 0, butterflies: 1, crows: 2, birds: 3 } as const;
const STRIDE = 12;

/** The template bird: a body, two wings, a neck and a tail (uv: part, distance out along it). */
function birdTemplate(): VertexData {
  const p: number[] = [];
  const uv: number[] = [];
  const tri = (a: number[], b: number[], c: number[], part: number, ua: number, ub: number, uc: number) => {
    p.push(...a, ...b, ...c);
    uv.push(part, ua, part, ub, part, uc);
  };
  // body: a thin diamond in the vertical plane, head toward +z
  tri([0, 0, 0.55], [0, 0.07, 0], [0, 0, -0.5], 0, 0, 0.5, 1);
  tri([0, 0, 0.55], [0, 0, -0.5], [0, -0.06, 0], 0, 0, 1, 0.5);
  // wings: two triangles each, the tip swept back
  for (const s of [-1, 1]) {
    const part = s < 0 ? 1 : 2;
    tri([0, 0, 0.28], [s * 1.0, 0, -0.05], [0, 0, -0.2], part, 0, 1, 0);
    tri([0, 0, 0.28], [s * 0.65, 0, 0.3], [s * 1.0, 0, -0.05], part, 0, 0.65, 1);
  }
  // neck and tail
  tri([0, 0.02, 0.45], [0, 0.22, 0.8], [0, -0.02, 0.5], 3, 0, 1, 0);
  tri([0, 0.0, -0.45], [0.12, 0.02, -0.8], [-0.12, 0.02, -0.8], 3, 0, 1, 1);
  const vd = new VertexData();
  vd.positions = p;
  vd.uvs = uv;
  vd.indices = p.map((_, i) => i).slice(0, p.length / 3);
  return vd;
}

/**
 * Flocks: living things in the air over a place, simulated as boids in a compute pass
 * (compute/flock.wgsl: cohesion, alignment, separation among their own kind, circling the place,
 * wandering, keeping out of the fight, scattered by blasts) and drawn as an instanced template
 * bird straight from the storage buffer (flock.vertex/fragment), each kind with its own wingbeat,
 * shape and colours.
 */
export class Flock {
  private buffer: StorageBuffer;
  private mesh: Mesh;
  private mat: ShaderMaterial;
  private cs: ComputeShader;
  private ub: UniformBuffer;
  private pending = 0;
  private time = 0;
  private obs: () => void;
  private scareAt = new Vector3();
  private scareT = 0;
  readonly count: number;
  /** where the fight is (the flock keeps out of it) */
  avoid = new Vector3();
  avoidRadius = 5;

  constructor(engine: WebGPUEngine, scene: Scene, private mats: Materials, private def: FlockDef) {
    this.count = def.count;
    const n = def.count;
    this.buffer = new StorageBuffer(engine, n * STRIDE * 4, Constants.BUFFER_CREATIONFLAG_VERTEX | Constants.BUFFER_CREATIONFLAG_READWRITE);
    const d = new Float32Array(n * STRIDE);
    const kind = KIND[def.kind];
    const spread = def.spread ?? def.height * 0.3;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = def.radius * (0.7 + Math.random() * 0.5);
      const y = def.centre[1] + def.height + (Math.random() - 0.5) * spread * 2;
      const x = def.centre[0] + Math.cos(a) * r;
      const z = def.centre[2] + Math.sin(a) * r;
      d.set([x, y, z, Math.random(), -Math.sin(a) * 2, 0, Math.cos(a) * 2, kind, x, y, z, Math.random()], i * STRIDE);
    }
    this.buffer.update(d);
    this.mesh = new Mesh('flock_' + def.kind, scene);
    birdTemplate().applyToMesh(this.mesh);
    const raw = this.buffer.getBuffer();
    for (const [name, off] of [['b0', 0], ['b1', 4], ['b2', 8]] as const) {
      this.mesh.setVerticesBuffer(new VertexBuffer(engine, raw, name, false, false, STRIDE, true, off, 4));
    }
    this.mat = new ShaderMaterial('flockMat', scene, { vertex: 'flock', fragment: 'flock' }, {
      attributes: ['position', 'uv', 'b0', 'b1', 'b2'], uniforms: ['viewProjection', 'cameraPosition', 'sunDir', 'sunColor', 'skyColor'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.mat.backFaceCulling = false;
    this.mesh.material = this.mat;
    this.mesh.forcedInstanceCount = n;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    const off = mats.onUpdate((l) => {
      this.mat.setVector3('cameraPosition', scene.activeCamera?.globalPosition ?? Vector3.Zero());
      this.mat.setVector3('sunDir', l.sunDir);
      this.mat.setColor3('sunColor', l.sunColor);
      this.mat.setColor3('skyColor', l.skyColor);
    });
    this.cs = new ComputeShader('flockSim', engine, { computeSource: computeSource('flock') }, {
      bindingsMapping: { birds: { group: 0, binding: 0 }, sim: { group: 0, binding: 1 } },
    });
    this.ub = new UniformBuffer(engine, undefined, false, 'flockSim');
    for (const [nm, k] of [['dt', 1], ['time', 1], ['count', 1], ['pad0', 1], ['centre', 4], ['avoid', 4], ['wind', 4], ['scare', 4]] as const) this.ub.addUniform(nm, k);
    this.ub.create();
    this.cs.setStorageBuffer('birds', this.buffer);
    this.cs.setUniformBuffer('sim', this.ub);
    const o = scene.onBeforeRenderObservable.add(() => this.flush());
    this.obs = () => {
      scene.onBeforeRenderObservable.remove(o);
      off();
    };
    mats.flock = this;
  }

  /** A blast scatters them. */
  scare(at: Vector3, strength = 1): void {
    this.scareAt.copyFrom(at);
    this.scareT = Math.max(this.scareT, strength);
  }

  update(dt: number): void {
    this.time += dt;
    if (dt > 0) this.pending += dt;
    this.scareT = Math.max(0, this.scareT - dt * 1.5);
  }

  private flush(): void {
    // (dispatch itself waits for the pipeline: checking isReady first can stall it in some browsers)
    if (this.pending <= 0) return;
    const dt = Math.min(this.pending, 1 / 20);
    this.pending = 0;
    const ub = this.ub;
    const c = this.def.centre;
    ub.updateFloat('dt', dt);
    ub.updateFloat('time', this.time);
    ub.updateUInt('count', this.count);
    ub.updateUInt('pad0', 0);
    ub.updateFloat4('centre', c[0], c[1], c[2], this.def.radius);
    ub.updateFloat4('avoid', this.avoid.x, this.avoid.y, this.avoid.z, this.avoidRadius);
    ub.updateFloat4('wind', 0.4, 0, 0.1, 0);
    ub.updateFloat4('scare', this.scareAt.x, this.scareAt.y, this.scareAt.z, this.scareT);
    ub.update();
    this.cs.dispatch(Math.ceil(this.count / 64));
  }

  dispose(): void {
    this.obs();
    if (this.mats.flock === this) this.mats.flock = null;
    this.mesh.dispose();
    this.mat.dispose();
    this.buffer.dispose();
  }
}
