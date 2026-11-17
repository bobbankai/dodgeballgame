import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as any;
const {
  Fn, uniform, storage, texture, instanceIndex, float, uint, vec2, vec3, dot, log2, exp2, exp, max, min, clamp, pow, select, mix, Loop,
  atomicAdd, atomicLoad, atomicStore,
} = T;

/**
 * Eye adaptation.
 *
 * WebGPU: a log-luminance histogram of the previous frame's HDR image (a 96 x 54 grid of samples, centre-weighted) is
 * built by a compute pass with atomics; a second one-thread pass takes the mean log luminance between two percentiles (the
 * darkest 10 % and the brightest 10 % are ignored: a black doorway or a lamp in view must not swing the exposure), turns it
 * into a target exposure and eases toward it, all on the GPU (no read-back on the frame's critical path). The frame graph
 * reads the exposure from the same storage buffer.
 *
 * The response is partial on purpose, as the probe metering before it: exposure = (key / L) ^ k with k < 1, so a dark
 * place still reads darker than a bright one while most of the hundredfold range between them is taken up.
 *
 * WebGL2 (no compute atomics): the exposure is eased on the CPU toward a target the game meters itself (`meter()`, the baked
 * probes around the player).
 */
const BINS = 128;
const GX = 96;
const GY = 54;
const MIN_LOG = -14;
const MAX_LOG = 6;

export interface ExposureParams {
  /** scene luminance that shows as mid-grey at full adaptation */
  key: number;
  /** how much of a change in light the eye takes up (0 none .. 1 all) */
  response: number;
  min: number;
  max: number;
  /** adaptation rates (1/s) toward a brighter and a darker exposure */
  speedUp: number;
  speedDown: number;
  /** percentiles of the histogram that are averaged */
  lowPercent: number;
  highPercent: number;
}

/** key and response fitted to the probe metering the art was tuned with (six places, from a dim lab at 0.013 mean
 *  luminance to the daylit terrace at 0.39): exposure = (0.16 / L) ^ 0.36 lands within ~20 % of it everywhere */
export const DEFAULT_EXPOSURE: ExposureParams = {
  key: 0.16, response: 0.36, min: 0.5, max: 6, speedUp: 1.4, speedDown: 2.2, lowPercent: 0.1, highPercent: 0.9,
};

export class AutoExposure {
  readonly u = {
    key: uniform(DEFAULT_EXPOSURE.key), response: uniform(DEFAULT_EXPOSURE.response),
    min: uniform(DEFAULT_EXPOSURE.min), max: uniform(DEFAULT_EXPOSURE.max),
    speedUp: uniform(DEFAULT_EXPOSURE.speedUp), speedDown: uniform(DEFAULT_EXPOSURE.speedDown),
    low: uniform(DEFAULT_EXPOSURE.lowPercent), high: uniform(DEFAULT_EXPOSURE.highPercent),
    /** exposure compensation (EV), e.g. per place or per cinematic shot */
    compensation: uniform(0),
    /** > 0: hold this exposure (cinematics, photo stills, tests) */
    locked: uniform(0),
    dt: uniform(1 / 60),
    /** 1: jump straight to the target (a cut, a level load) */
    reset: uniform(1),
    /** the CPU-eased exposure (WebGL2 path, and the value shown before the GPU path has run) */
    cpu: uniform(1),
  };
  /** last exposure read back from the GPU (or the CPU value): for systems that scale their own lights by it */
  current = 1;
  /** mean scene luminance the meter saw (GPU path; diagnostics) */
  measured = 0;
  /** the GPU histogram can run on this device */
  readonly canGpu: boolean;
  /** histogram metering in use (else the CPU target from `meter()`) */
  gpu: boolean;
  private stateAttr = new THREE.StorageBufferAttribute(new Float32Array([1, 0, 0, 0]), 1);
  private histAttr = new THREE.StorageBufferAttribute(new Uint32Array(BINS), 1);
  private src = texture(new THREE.Texture());
  private histPass: any = null;
  private resolvePass: any = null;
  private cpuTarget = 1;
  private readIn = 0;
  private reading = false;
  private gpuNode: any = null;
  private cpuNode: any;

  constructor(private renderer: THREE.WebGPURenderer, compute: boolean) {
    this.canGpu = compute;
    this.gpu = compute;
    const u = this.u as any;
    if (compute) {
      this.build();
      const state = storage(this.stateAttr, 'float', 4).toReadOnly();
      this.gpuNode = select(u.locked.greaterThan(0.0), u.locked, state.element(0));
    }
    this.cpuNode = select(u.locked.greaterThan(0.0), u.locked, u.cpu.mul(exp2(u.compensation)));
  }

  /** Choose the metering (the frame graph reads `value` when it is built). */
  use(gpu: boolean): void { this.gpu = gpu && this.canGpu; }

  /** The exposure multiplier, for the frame graph. */
  get value(): any { return this.gpu ? this.gpuNode : this.cpuNode; }

  set(p: Partial<ExposureParams>): void {
    const u = this.u as any;
    if (p.key !== undefined) u.key.value = p.key;
    if (p.response !== undefined) u.response.value = p.response;
    if (p.min !== undefined) u.min.value = p.min;
    if (p.max !== undefined) u.max.value = p.max;
    if (p.speedUp !== undefined) u.speedUp.value = p.speedUp;
    if (p.speedDown !== undefined) u.speedDown.value = p.speedDown;
    if (p.lowPercent !== undefined) u.low.value = p.lowPercent;
    if (p.highPercent !== undefined) u.high.value = p.highPercent;
  }

  /** Hold a fixed exposure (null releases it). */
  lock(v: number | null): void { (this.u.locked as any).value = v ?? 0; }

  /** Jump to the target for the next few updates (camera cuts, loads: the first frames may still be streaming in). */
  snap(frames = 3): void { this.snapFrames = Math.max(this.snapFrames, frames); (this.u.reset as any).value = 1; }
  private snapFrames = 3;

  /** CPU metering (WebGL2 path): the exposure the game wants here; eased in `update`. */
  meter(target: number): void { this.cpuTarget = target; }

  private build(): void {
    const u = this.u as any;
    const hist = storage(this.histAttr, 'uint', BINS).toAtomic();
    const state = storage(this.stateAttr, 'float', 4);
    const src = this.src;
    this.histPass = Fn(() => {
      const i = instanceIndex;
      const x = i.mod(GX);
      const y = i.div(GX);
      const uv = vec2(float(x).add(0.5).div(GX), float(y).add(0.5).div(GY));
      const c = src.sample(uv).level(0).rgb;
      const lum = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-7);
      const t = clamp(log2(lum).sub(MIN_LOG).div(MAX_LOG - MIN_LOG), 0.0, 1.0);
      const bin = uint(t.mul(BINS - 1).add(0.5));
      // centre-weighted metering: the middle of the frame (where the player and the way ahead are) counts most
      const d = uv.sub(0.5).mul(vec2(1.0, 0.8));
      const w = uint(exp(dot(d, d).mul(-5.0)).mul(15.0).add(1.0));
      atomicAdd(hist.element(bin), w);
    })().compute(GX * GY, [64]);
    this.resolvePass = Fn(() => {
      const total = float(0).toVar();
      Loop(BINS, ({ i }: any) => { total.addAssign(float(atomicLoad(hist.element(i)))); });
      const lo = total.mul(u.low);
      const hi = total.mul(u.high);
      const acc = float(0).toVar();
      const sum = float(0).toVar();
      const wsum = float(0).toVar();
      Loop(BINS, ({ i }: any) => {
        const n = float(atomicLoad(hist.element(i)));
        const inside = max(min(acc.add(n), hi).sub(max(acc, lo)), 0.0);
        const binLog = float(i).add(0.5).div(BINS).mul(MAX_LOG - MIN_LOG).add(MIN_LOG);
        sum.addAssign(inside.mul(binLog));
        wsum.addAssign(inside);
        acc.addAssign(n);
        atomicStore(hist.element(i), uint(0));
      });
      const avg = exp2(select(wsum.greaterThan(0.0), sum.div(max(wsum, 1e-6)), log2(u.key)));
      const target = clamp(pow(u.key.div(avg), u.response), u.min, u.max).mul(exp2(u.compensation));
      const prev = max(state.element(0), 1e-4);
      const rate = select(target.greaterThan(prev), u.speedUp, u.speedDown);
      const k = float(1).sub(exp(u.dt.mul(rate).negate()));
      const next = exp2(mix(log2(prev), log2(target), k));
      state.element(0).assign(select(u.reset.greaterThan(0.5), target, next));
      state.element(1).assign(avg);
    })().compute(1, [1]);
  }

  /**
   * Per frame, before the frame graph renders. `source` is last frame's HDR scene image (null on the first frame).
   */
  update(dt: number, source: THREE.Texture | null): void {
    const u = this.u as any;
    u.dt.value = Math.min(dt, 0.1);
    if (this.gpu && source) {
      this.src.value = source;
      this.renderer.compute(this.histPass);
      this.renderer.compute(this.resolvePass);
      if (--this.snapFrames <= 0) u.reset.value = 0;
      this.readIn -= dt;
      if (this.readIn <= 0 && !this.reading) {
        this.readIn = 0.25;
        this.reading = true;
        void (this.renderer as any).getArrayBufferAsync(this.stateAttr).then((buf: ArrayBuffer) => {
          const f = new Float32Array(buf);
          if (Number.isFinite(f[0]) && f[0] > 0) this.current = f[0];
          this.measured = f[1];
        }).catch(() => {}).finally(() => { this.reading = false; });
      }
      return;
    }
    const k = u.reset.value > 0.5 ? 1 : 1 - Math.exp(-dt * (this.cpuTarget > u.cpu.value ? u.speedUp.value : u.speedDown.value));
    u.cpu.value = Math.exp(Math.log(Math.max(u.cpu.value, 1e-4)) + (Math.log(this.cpuTarget) - Math.log(Math.max(u.cpu.value, 1e-4))) * k);
    if (--this.snapFrames <= 0) u.reset.value = 0;
    this.current = u.locked.value > 0 ? u.locked.value : u.cpu.value * 2 ** u.compensation.value;
  }
}
