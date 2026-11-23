import { ComputeShader, Constants, RawTexture, Scene, UniformBuffer, WebGPUEngine } from '@babylonjs/core';
import { computeSource } from './ShaderLib';

type Pass = 'splatVelocity' | 'splatDye' | 'curl' | 'vorticity' | 'divergence' | 'clearPressure' | 'jacobi' | 'gradient' | 'advectVelocity' | 'advectDye';
const PASSES: Pass[] = ['splatVelocity', 'splatDye', 'curl', 'vorticity', 'divergence', 'clearPressure', 'jacobi', 'gradient', 'advectVelocity', 'advectDye'];

/** A pour of dye and a push of the fluid, in screen uv (y up) and uv per second. */
export interface FluidSplat {
  x: number;
  y: number;
  dx: number;
  dy: number;
  color: [number, number, number];
  amount: number;
  radius: number;
}

const MAX_SPLATS = 6;

/**
 * Ink in water over the screen: a 2D stable-fluids solver (compute/fluid.wgsl) on a small grid.
 * Techniques, domains and the Vow pour dye and push it; the dye drifts, curls and fades; the post
 * chain lays it over the image as ink and lets the velocity bend the picture. It only runs while
 * something is in it.
 */
export class Fluid {
  readonly w = 192;
  readonly h = 108;
  readonly vel: RawTexture[];
  readonly dye: RawTexture[];
  private pressure: RawTexture[];
  private div: RawTexture;
  private curlT: RawTexture;
  private shaders = new Map<Pass, ComputeShader>();
  private ub: UniformBuffer;
  private splatUbs: UniformBuffer[] = [];
  private queue: FluidSplat[] = [];
  private time = 0;
  /** seconds of motion left before the solver goes to sleep */
  private awake = 0;
  velDissipation = 0.5;
  dyeDissipation = 0.4;
  vorticity = 38;
  iterations = 14;

  constructor(engine: WebGPUEngine, scene: Scene) {
    // zeroed half floats (a texture created without data never reports ready to the compute passes)
    const mk = () => RawTexture.CreateRGBAStorageTexture(new Uint16Array(this.w * this.h * 4), this.w, this.h, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.vel = [mk(), mk()];
    this.dye = [mk(), mk()];
    this.pressure = [mk(), mk()];
    this.div = mk();
    this.curlT = mk();
    const src = computeSource('fluid');
    (globalThis as unknown as { __fluidSrc?: string }).__fluidSrc = src;
    for (const pass of PASSES) {
      this.shaders.set(pass, new ComputeShader('fluid_' + pass, engine, { computeSource: src }, {
        bindingsMapping: { prm: { group: 0, binding: 0 }, srcA: { group: 0, binding: 1 }, srcB: { group: 0, binding: 2 }, dst: { group: 0, binding: 3 } },
        entryPoint: pass,
      }));
    }
    this.ub = this.makeParams(engine);
    for (let i = 0; i < MAX_SPLATS; i++) this.splatUbs.push(this.makeParams(engine));
    scene.onBeforeRenderObservable.add(() => this.flush());
  }

  private makeParams(engine: WebGPUEngine): UniformBuffer {
    const ub = new UniformBuffer(engine, undefined, false, 'fluidParams');
    ub.addUniform('texel', 2);
    ub.addUniform('size', 2);
    ub.addUniform('dt', 1);
    ub.addUniform('velDissipation', 1);
    ub.addUniform('dyeDissipation', 1);
    ub.addUniform('vorticity', 1);
    ub.addUniform('splatPos', 2);
    ub.addUniform('splatDir', 2);
    ub.addUniform('splatColor', 4);
    ub.addUniform('splatRadius', 1);
    ub.addUniform('time', 1);
    ub.addUniform('pad0', 1);
    ub.addUniform('pad1', 1);
    ub.create();
    return ub;
  }

  private fill(ub: UniformBuffer, dt: number, s?: FluidSplat): void {
    ub.updateFloat2('texel', 1 / this.w, 1 / this.h);
    ub.updateFloat2('size', this.w, this.h);
    ub.updateFloat('dt', dt);
    ub.updateFloat('velDissipation', this.velDissipation);
    ub.updateFloat('dyeDissipation', this.dyeDissipation);
    ub.updateFloat('vorticity', this.vorticity);
    ub.updateFloat2('splatPos', s ? s.x : 0, s ? s.y : 0);
    ub.updateFloat2('splatDir', s ? s.dx * this.w : 0, s ? s.dy * this.h : 0);
    ub.updateFloat4('splatColor', s ? s.color[0] : 0, s ? s.color[1] : 0, s ? s.color[2] : 0, s ? s.amount : 0);
    ub.updateFloat('splatRadius', s ? s.radius * s.radius : 0.001);
    ub.updateFloat('time', this.time);
    ub.updateFloat('pad0', 0);
    ub.updateFloat('pad1', 0);
    ub.update();
  }

  private run(pass: Pass, a: RawTexture, b: RawTexture, dst: RawTexture, ub: UniformBuffer = this.ub): void {
    const cs = this.shaders.get(pass)!;
    cs.setUniformBuffer('prm', ub);
    cs.setTexture('srcA', a, false);
    cs.setTexture('srcB', b, false);
    cs.setStorageTexture('dst', dst);
    cs.dispatch(Math.ceil(this.w / 8), Math.ceil(this.h / 8), 1);
  }

  private swap(pair: RawTexture[]): void {
    const t = pair[0];
    pair[0] = pair[1];
    pair[1] = t;
  }

  /** Pour dye (and push) into the fluid. */
  splat(s: FluidSplat): void {
    if (this.queue.length < MAX_SPLATS) this.queue.push(s);
    this.awake = Math.max(this.awake, 6);
  }

  /** A ring of splats bursting outward from a point (domains opening, the Vow). */
  /**
   * An ink splatter: a small dense core, streaks flung out round it at uneven lengths, and a few
   * droplets thrown further (not one disc: overlapping splats of the full radius read as a blot).
   */
  burst(x: number, y: number, color: [number, number, number], count = 8, speed = 1.4, radius = 0.035): void {
    const phase = Math.random() * Math.PI * 2;
    this.splat({ x, y, dx: 0, dy: 0, color, amount: 0.8, radius: radius * 0.55 });
    for (let i = 0; i < count; i++) {
      const a = phase + ((i + (Math.random() - 0.5) * 0.6) / count) * Math.PI * 2;
      const reach = radius * (0.8 + Math.random() * 1.1);
      const sp = speed * (0.8 + Math.random() * 0.9);
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.splat({ x: x + c * reach, y: y + s * reach, dx: c * sp, dy: s * sp, color, amount: 0.65, radius: radius * (0.22 + Math.random() * 0.18) });
    }
    for (let i = 0; i < Math.ceil(count / 2); i++) {
      const a = Math.random() * Math.PI * 2;
      const reach = radius * (2.0 + Math.random() * 1.6);
      this.splat({ x: x + Math.cos(a) * reach, y: y + Math.sin(a) * reach, dx: Math.cos(a) * speed * 0.5, dy: Math.sin(a) * speed * 0.5, color, amount: 0.6, radius: radius * (0.08 + Math.random() * 0.08) });
    }
  }

  get active(): boolean {
    return this.awake > 0;
  }

  private pending = 0;

  /** Advance the fluid; the dispatches run from the scene's before-render hook (inside a frame). */
  step(dt: number): void {
    this.time += dt;
    if (this.awake <= 0 && this.queue.length === 0) return;
    this.awake -= dt;
    this.pending += dt;
  }

  private flush(): void {
    if (this.pending <= 0) return;
    // until every pass has compiled, hold the splats rather than lose them
    let ready = true;
    for (const cs of this.shaders.values()) ready = cs.isReady() && ready;
    if (!ready) {
      this.pending = 0;
      this.awake = Math.max(this.awake, 1);
      return;
    }
    const steps = Math.min(3, Math.ceil(this.pending / (1 / 30)));
    const h = Math.min(this.pending / steps, 1 / 30);
    this.pending = 0;
    for (let i = 0; i < steps; i++) this.solve(h);
  }

  private solve(h: number): void {
    this.fill(this.ub, h);
    // splats, each with its own parameters (buffer writes land before the dispatches run)
    this.queue.forEach((s, k) => {
      const ub = this.splatUbs[k];
      this.fill(ub, h, s);
      this.run('splatVelocity', this.vel[0], this.vel[0], this.vel[1], ub);
      this.swap(this.vel);
      this.run('splatDye', this.dye[0], this.dye[0], this.dye[1], ub);
      this.swap(this.dye);
    });
    this.queue = [];
    // keep the eddies alive, make the field divergence free, then move everything along it
    this.run('curl', this.vel[0], this.vel[0], this.curlT);
    this.run('vorticity', this.vel[0], this.curlT, this.vel[1]);
    this.swap(this.vel);
    this.run('divergence', this.vel[0], this.vel[0], this.div);
    this.run('clearPressure', this.pressure[0], this.pressure[0], this.pressure[1]);
    this.swap(this.pressure);
    for (let i = 0; i < this.iterations; i++) {
      this.run('jacobi', this.pressure[0], this.div, this.pressure[1]);
      this.swap(this.pressure);
    }
    this.run('gradient', this.pressure[0], this.vel[0], this.vel[1]);
    this.swap(this.vel);
    this.run('advectVelocity', this.vel[0], this.vel[0], this.vel[1]);
    this.swap(this.vel);
    this.run('advectDye', this.vel[0], this.dye[0], this.dye[1]);
    this.swap(this.dye);
  }

  /** The current dye and velocity grids (for the post chain). */
  get dyeTexture(): RawTexture {
    return this.dye[0];
  }

  get velocityTexture(): RawTexture {
    return this.vel[0];
  }
}
