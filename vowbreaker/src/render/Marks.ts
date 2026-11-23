import { ComputeShader, Constants, RawTexture, Scene, UniformBuffer, Vector4, WebGPUEngine } from '@babylonjs/core';
import { computeSource } from './ShaderLib';
import type { Materials } from './Materials';

/** Kinds of ground mark (vb_ground_marks MARK_*). */
export const MK = {
  crater: 0, scorch: 1, splatter: 2, skid: 3, footprint: 4, frost: 5, slash: 6, seal: 7, clear: 8, scatter: 9,
} as const;

export interface MarkStamp {
  kind: number;
  x: number;
  z: number;
  /** metres (crater / scorch / splatter / frost / seal / scatter radius, a footprint's length) */
  radius?: number;
  /** direction on the floor (radians about +y, 0 = +x toward +z) */
  angle?: number;
  strength?: number;
  palette?: number;
  /** skids and slashes: length and width in metres */
  len?: number;
  width?: number;
  /** footprint side (0 left, 1 right); a slash's curve */
  extra?: number;
}

const MAX_STAMPS = 16;

/**
 * Ground marks: the scars of a fight kept on the arena floor for the whole round (craters with
 * glowing cracks, scorch, ink, skids, footprints in snow, frost, slashes, burnt-in seals). Two
 * rgba16f textures over a square of the floor, updated by a compute pass (compute/marks.wgsl)
 * that ages them and folds in the stamps queued this frame; the environment shader paints them
 * (vb_ground_marks marksSurface).
 */
export class GroundMarks {
  readonly res: number;
  private a: RawTexture[];
  private b: RawTexture[];
  private cs: ComputeShader;
  private ub: UniformBuffer;
  private queue: MarkStamp[] = [];
  private pending = 0;
  private time = 0;
  /** seconds of heat left to cool (the pass keeps running while anything glows) */
  private warm = 0;
  private obs: () => void;
  readonly params: Vector4;
  /** curse rot (compute/curse_rot.wgsl): Gray-Scott growth over the same square */
  private rot: RawTexture[];
  private rotCs: ComputeShader;
  private rotUb: UniformBuffer;
  private rotSeeds: [number, number, number, number][] = [];
  private rotOn = false;
  readonly rotRes = 256;
  /** how soft the ground is (snow, ash, sand: footprints show), 0..1 */
  soft = 0;

  constructor(scene: Scene, private mats: Materials, centre: [number, number], readonly worldSize = 40, res = 512) {
    this.res = res;
    const engine = scene.getEngine() as unknown as WebGPUEngine;
    const mk = () => RawTexture.CreateRGBAStorageTexture(new Uint16Array(res * res * 4), res, res, scene, false, false,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.a = [mk(), mk()];
    this.b = [mk(), mk()];
    for (const t of [...this.a, ...this.b]) {
      t.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
      t.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    }
    this.cs = new ComputeShader('groundMarks', engine, { computeSource: computeSource('marks') }, {
      bindingsMapping: {
        prm: { group: 0, binding: 0 }, srcA: { group: 0, binding: 1 }, srcB: { group: 0, binding: 2 },
        dstA: { group: 0, binding: 3 }, dstB: { group: 0, binding: 4 },
      },
    });
    this.ub = new UniformBuffer(engine, undefined, false, 'marksParams');
    this.ub.addUniform('grid', 2);
    this.ub.addUniform('centre', 2);
    this.ub.addUniform('worldSize', 1);
    this.ub.addUniform('dt', 1);
    this.ub.addUniform('time', 1);
    this.ub.addUniform('count', 1);
    this.ub.addUniform('stamps', 4, MAX_STAMPS * 3);
    this.ub.create();
    this.params = new Vector4(centre[0], centre[1], 1 / worldSize, 1);
    // the rot starts as clean floor everywhere (A = 1, B = 0)
    const rr = this.rotRes;
    const clean = new Uint16Array(rr * rr * 4);
    for (let i = 0; i < rr * rr; i++) clean[i * 4] = 0x3c00;
    const mkRot = () => RawTexture.CreateRGBAStorageTexture(clean.slice(), rr, rr, scene, false, false,
      Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.rot = [mkRot(), mkRot()];
    this.rotCs = new ComputeShader('curseRot', engine, { computeSource: computeSource('curse_rot') }, {
      bindingsMapping: { prm: { group: 0, binding: 0 }, src: { group: 0, binding: 1 }, dst: { group: 0, binding: 2 } },
    });
    this.rotUb = new UniformBuffer(engine, undefined, false, 'rotParams');
    for (const [n, k] of [['grid', 2], ['centre', 2], ['worldSize', 1], ['dt', 1], ['feed', 1], ['kill', 1], ['diffA', 1], ['diffB', 1], ['count', 1], ['pad0', 1]] as const) {
      this.rotUb.addUniform(n, k);
    }
    this.rotUb.addUniform('seeds', 4, 8);
    this.rotUb.create();
    mats.marks = this;
    const o = scene.onBeforeRenderObservable.add(() => this.flush());
    this.obs = () => scene.onBeforeRenderObservable.remove(o);
  }

  /** The textures the floor reads this frame. */
  get texA(): RawTexture {
    return this.a[0];
  }

  get texB(): RawTexture {
    return this.b[0];
  }

  /** The curse rot the floor reads this frame. */
  get texRot(): RawTexture {
    return this.rot[0];
  }

  /** Seed curse rot (it grows from here for the rest of the round). */
  rotSeed(x: number, z: number, radius: number, strength = 1): void {
    this.rotSeeds.push([x, z, radius, strength]);
    this.rotOn = true;
  }

  /** Burn the rot away round a point (a curse exorcised). */
  cleanse(x: number, z: number, radius: number): void {
    this.rotSeeds.push([x, z, radius, -1]);
  }

  stamp(s: MarkStamp): void {
    // outside the marked square: nothing to draw
    const half = this.worldSize / 2;
    if (Math.abs(s.x - this.params.x) > half + 4 || Math.abs(s.z - this.params.y) > half + 4) return;
    this.queue.push(s);
    if (this.queue.length > 64) this.queue.shift();
  }

  /** Wipe the floor clean (a new round). */
  clear(): void {
    this.queue = [{ kind: MK.clear, x: this.params.x, z: this.params.y, radius: -1 }];
    if (this.rotOn) this.rotSeeds = [[this.params.x, this.params.y, 1e4, -1]];
    this.warm = 0;
  }

  update(dt: number): void {
    this.pending += dt;
    this.time += dt;
  }

  private flush(): void {
    this.flushRot();
    if (!this.cs.isReady()) return;
    if (this.queue.length === 0 && this.warm <= 0) {
      this.pending = 0;
      return;
    }
    const batch = this.queue.splice(0, MAX_STAMPS);
    const data = new Float32Array(MAX_STAMPS * 12);
    batch.forEach((s, i) => {
      data.set([
        s.x, s.z, s.radius ?? 1, s.angle ?? 0,
        s.kind, s.strength ?? 1, Math.random(), s.palette ?? 0,
        s.len ?? 1, s.width ?? 0.3, s.extra ?? 0, 0,
      ], i * 12);
      if (s.kind === MK.crater || s.kind === MK.scorch || s.kind === MK.slash || s.kind === MK.seal) this.warm = 10;
    });
    const dt = Math.min(this.pending, 0.25);
    this.pending = 0;
    this.warm -= dt;
    const ub = this.ub;
    ub.updateFloat2('grid', this.res, this.res);
    ub.updateFloat2('centre', this.params.x, this.params.y);
    ub.updateFloat('worldSize', this.worldSize);
    ub.updateFloat('dt', dt);
    ub.updateFloat('time', this.time);
    ub.updateFloat('count', batch.length);
    ub.updateFloatArray('stamps', data);
    ub.update();
    this.cs.setUniformBuffer('prm', ub);
    this.cs.setTexture('srcA', this.a[0], false);
    this.cs.setTexture('srcB', this.b[0], false);
    this.cs.setStorageTexture('dstA', this.a[1]);
    this.cs.setStorageTexture('dstB', this.b[1]);
    this.cs.dispatch(Math.ceil(this.res / 8), Math.ceil(this.res / 8), 1);
    this.a.reverse();
    this.b.reverse();
  }

  /** Grow the rot: a few Gray-Scott steps per frame, seeds and cleanses folded in. */
  private flushRot(): void {
    if (!this.rotOn || !this.rotCs.isReady()) return;
    const seeds = this.rotSeeds.splice(0, 8);
    const data = new Float32Array(32);
    seeds.forEach((s, i) => data.set(s, i * 4));
    const ub = this.rotUb;
    ub.updateFloat2('grid', this.rotRes, this.rotRes);
    ub.updateFloat2('centre', this.params.x, this.params.y);
    ub.updateFloat('worldSize', this.worldSize);
    ub.updateFloat('dt', 1);
    ub.updateFloat('feed', 0.055);
    ub.updateFloat('kill', 0.062);
    ub.updateFloat('diffA', 1.0);
    ub.updateFloat('diffB', 0.5);
    ub.updateFloat('count', seeds.length);
    ub.updateFloat('pad0', 0);
    ub.updateFloatArray('seeds', data);
    ub.update();
    this.rotCs.setUniformBuffer('prm', ub);
    for (let i = 0; i < 6; i++) {
      this.rotCs.setTexture('src', this.rot[0], false);
      this.rotCs.setStorageTexture('dst', this.rot[1]);
      this.rotCs.dispatch(Math.ceil(this.rotRes / 8), Math.ceil(this.rotRes / 8), 1);
      this.rot.reverse();
    }
  }

  dispose(): void {
    this.obs();
    for (const t of this.rot) t.dispose();
    this.rotUb.dispose();
    if (this.mats.marks === this) this.mats.marks = null;
    for (const t of [...this.a, ...this.b]) t.dispose();
    this.ub.dispose();
  }
}
