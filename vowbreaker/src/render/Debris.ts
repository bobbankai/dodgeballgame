import {
  Color3, ComputeShader, Constants, Mesh, Scene, ShaderLanguage, ShaderMaterial, StorageBuffer, UniformBuffer, Vector3, VertexBuffer, VertexData, WebGPUEngine,
} from '@babylonjs/core';
import { computeSource } from './ShaderLib';
import type { Materials } from './Materials';

/** Kinds of chunk (vb_debris DEBRIS_*). */
export const DK = { stone: 0, wood: 1, tile: 2, ice: 3, paper: 4, ink: 5 } as const;

export interface DebrisBurst {
  pos: Vector3;
  count: number;
  /** outward speed (m/s) */
  speed: number;
  /** added upward speed */
  up?: number;
  /** 1 = all round, 0 = straight along dir */
  spread?: number;
  dir?: Vector3;
  kind?: number;
  color: [number, number, number];
  size: [number, number];
  life?: [number, number];
  /** chunks thrown out of a technique's crater glow and cool (0..1) */
  heat?: number;
  /** start position randomisation (m) */
  jitter?: number;
}

const STRIDE = 24;

/**
 * Debris: chunks of floor, wood, tile, ice and paper thrown by heavy blows. A compute pass
 * (compute/debris.wgsl) simulates them as small rigid bodies (tumbling, bouncing, sliding to rest,
 * sinking away at the end); one irregular chunk mesh is instanced per chunk straight from the
 * storage buffer, twice: the faceted toon chunk and its ink hull (debris.vertex/fragment).
 */
export class Debris {
  readonly max: number;
  private buffer: StorageBuffer;
  private mesh: Mesh;
  private hull: Mesh;
  private mat: ShaderMaterial;
  private ink: ShaderMaterial;
  private cs: ComputeShader;
  private ub: UniformBuffer;
  private head = 0;
  private scratch: Float32Array;
  private pending = 0;
  private time = 0;
  /** seconds until nothing is moving any more (the pass idles after) */
  private busy = 0;
  gravity = -14;
  ground = 0;
  /** arena wall: centre x, z, radius (0 = none), bounce */
  arena: [number, number, number, number] = [0, 0, 0, 0.3];
  wind = new Vector3();
  /** up to four expanding shockwaves (centre, radius) that throw chunks again */
  shocks = new Float32Array(16);
  heatBody: [number, number, number] = [1.0, 0.35, 0.06];
  heatCore: [number, number, number] = [1.0, 0.85, 0.5];

  constructor(engine: WebGPUEngine, scene: Scene, mats: Materials, max = 768) {
    this.max = max;
    this.buffer = new StorageBuffer(engine, max * STRIDE * 4, Constants.BUFFER_CREATIONFLAG_VERTEX | Constants.BUFFER_CREATIONFLAG_READWRITE);
    this.buffer.update(new Float32Array(max * STRIDE));
    this.scratch = new Float32Array(256 * STRIDE);
    // the chunk: an icosphere with its vertices pushed in and out (a lump, not a ball)
    const vd = VertexData.CreateIcoSphere({ radius: 0.5, subdivisions: 1, flat: false });
    const pos = vd.positions as number[];
    for (let i = 0; i < pos.length; i += 3) {
      const k = 0.75 + 0.5 * Math.abs(Math.sin(pos[i] * 12.9 + pos[i + 1] * 78.2 + pos[i + 2] * 37.7) * 43758.5 % 1);
      pos[i] *= k;
      pos[i + 1] *= k;
      pos[i + 2] *= k;
    }
    VertexData.ComputeNormals(pos, vd.indices as number[], vd.normals as number[]);
    const raw = this.buffer.getBuffer();
    const make = (name: string, ink: boolean) => {
      const m = new Mesh(name, scene);
      vd.applyToMesh(m);
      for (let k = 0; k < 6; k++) {
        m.setVerticesBuffer(new VertexBuffer(engine, raw, 'c' + k, false, false, STRIDE, true, k * 4, 4));
      }
      const mat = new ShaderMaterial(name + 'Mat', scene, { vertex: 'debris', fragment: 'debris' }, {
        attributes: ['position', 'normal', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5'],
        uniforms: ['viewProjection', 'cameraPosition', 'sunDir', 'sunColor', 'skyColor', 'groundColor', 'shadowColor', 'heatBody', 'heatCore', 'inkColor'],
        defines: ink ? ['INK'] : [], shaderLanguage: ShaderLanguage.WGSL,
      });
      mat.backFaceCulling = true;
      if (ink) mat.cullBackFaces = false;
      m.material = mat;
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      m.forcedInstanceCount = max;
      return { m, mat };
    };
    const a = make('debris', false);
    const b = make('debrisInk', true);
    this.mesh = a.m;
    this.mat = a.mat;
    this.hull = b.m;
    this.ink = b.mat;
    this.ink.setColor3('inkColor', new Color3(0.05, 0.04, 0.05));
    mats.onUpdate((l) => {
      for (const m of [this.mat, this.ink]) {
        m.setVector3('cameraPosition', scene.activeCamera?.globalPosition ?? Vector3.Zero());
      }
      this.mat.setVector3('sunDir', l.sunDir);
      this.mat.setColor3('sunColor', l.sunColor);
      this.mat.setColor3('skyColor', l.skyColor);
      this.mat.setColor3('groundColor', l.groundColor);
      this.mat.setColor3('shadowColor', l.shadowColor);
      this.mat.setVector3('heatBody', new Vector3(...this.heatBody));
      this.mat.setVector3('heatCore', new Vector3(...this.heatCore));
    });
    this.cs = new ComputeShader('debrisSim', engine, { computeSource: computeSource('debris') }, {
      bindingsMapping: { chunks: { group: 0, binding: 0 }, sim: { group: 0, binding: 1 } },
    });
    this.ub = new UniformBuffer(engine, undefined, false, 'debrisSim');
    for (const [n, k] of [['dt', 1], ['time', 1], ['gravity', 1], ['ground', 1], ['arena', 4], ['wind', 4]] as const) this.ub.addUniform(n, k);
    this.ub.addUniform('shocks', 4, 4);
    for (const n of ['count', 'pad0', 'pad1', 'pad2']) this.ub.addUniform(n, 1);
    this.ub.create();
    this.cs.setStorageBuffer('chunks', this.buffer);
    this.cs.setUniformBuffer('sim', this.ub);
    scene.onBeforeRenderObservable.add(() => this.flush());
  }

  burst(b: DebrisBurst): void {
    const n = Math.min(b.count, 256);
    const d = this.scratch;
    const dir = b.dir ?? new Vector3(0, 1, 0);
    const spread = b.spread ?? 1;
    const life = b.life ?? [5, 8];
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE;
      // a random direction in the upper half, blended toward dir
      const th = Math.random() * Math.PI * 2;
      const u = Math.random();
      const r = Math.sqrt(1 - u * u);
      let vx = dir.x * (1 - spread) + r * Math.cos(th) * spread;
      let vy = dir.y * (1 - spread) + u * spread;
      let vz = dir.z * (1 - spread) + r * Math.sin(th) * spread;
      const l = Math.hypot(vx, vy, vz) || 1;
      const sp = b.speed * (0.4 + Math.random() * 0.9);
      vx = (vx / l) * sp;
      vy = (vy / l) * sp + (b.up ?? 0) * (0.6 + Math.random() * 0.8);
      vz = (vz / l) * sp;
      const j = b.jitter ?? 0.3;
      const lf = life[0] + Math.random() * (life[1] - life[0]);
      // a random orientation
      const ax = new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const ang = Math.random() * Math.PI * 2;
      const s = Math.sin(ang / 2);
      const kind = b.kind ?? DK.stone;
      const tone = 0.85 + Math.random() * 0.3;
      d.set([
        b.pos.x + (Math.random() - 0.5) * j, b.pos.y + Math.random() * j * 0.5, b.pos.z + (Math.random() - 0.5) * j, lf,
        vx, vy, vz, lf,
        ax.x * s, ax.y * s, ax.z * s, Math.cos(ang / 2),
        (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, (Math.random() - 0.5) * 18, b.size[0] + Math.random() * (b.size[1] - b.size[0]),
        b.color[0] * tone, b.color[1] * tone, b.color[2] * tone, kind,
        Math.random(), 0, (b.heat ?? 0) * (0.6 + Math.random() * 0.4), 0,
      ], o);
    }
    const first = Math.min(n, this.max - this.head);
    this.buffer.update(d.subarray(0, first * STRIDE), this.head * STRIDE * 4, first * STRIDE * 4);
    if (n > first) this.buffer.update(d.subarray(first * STRIDE, n * STRIDE), 0, (n - first) * STRIDE * 4);
    this.head = (this.head + n) % this.max;
    this.busy = Math.max(this.busy, life[1] + 1);
  }

  update(dt: number): void {
    this.time += dt;
    if (dt > 0) this.pending += dt;
  }

  private flush(): void {
    if (this.pending <= 0) return;
    if (this.busy <= 0) {
      this.pending = 0;
      return;
    }
    const steps = Math.min(4, Math.ceil(this.pending / (1 / 60)));
    const dt = Math.min(this.pending / steps, 1 / 30);
    this.busy -= this.pending;
    this.pending = 0;
    // one uniform buffer: every sub-step of a frame sees the same values, so sub-steps share dt
    const ub = this.ub;
    ub.updateFloat('dt', dt);
    ub.updateFloat('time', this.time);
    ub.updateFloat('gravity', this.gravity);
    ub.updateFloat('ground', this.ground);
    ub.updateFloat4('arena', ...this.arena);
    ub.updateFloat4('wind', this.wind.x, this.wind.y, this.wind.z, 0);
    ub.updateFloatArray('shocks', this.shocks);
    ub.updateUInt('count', this.max);
    ub.update();
    for (let i = 0; i < steps; i++) this.cs.dispatch(Math.ceil(this.max / 64));
  }

  clear(): void {
    this.buffer.update(new Float32Array(this.max * STRIDE));
    this.busy = 0;
  }

  setVisible(v: boolean): void {
    this.mesh.isVisible = v;
    this.hull.isVisible = v;
  }
}
