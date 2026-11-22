import { Buffer, ComputeShader, Constants, Mesh, RawTexture, Scene, ShaderLanguage, ShaderMaterial, UniformBuffer, Vector2, VertexData, WebGPUEngine } from '@babylonjs/core';
import { computeSource } from './ShaderLib';
import type { Renderer } from './Renderer';

/** One burning thing: where the flames stand, how wide and tall. */
export interface FireSite {
  at: [number, number, number];
  w: number;
  h: number;
  intensity?: number;
}

/**
 * Fire: a small 2D compute simulation (compute/fire.wgsl) of heat, smoke and velocity, drawn on
 * instanced cards standing on burning things (firecard.vertex/fragment), each showing its own
 * slice of it. The simulation runs inside the frame (the scene's before-render hook).
 */
export class Fire {
  readonly gw = 96;
  readonly gh = 192;
  private grid: RawTexture[];
  private cs: ComputeShader;
  private ub: UniformBuffer;
  private mesh: Mesh;
  private mat: ShaderMaterial;
  private buffer: Buffer;
  private pending = 0;
  private time = 0;
  private obs: () => void;
  /** how hard the fires burn (0 = dying down) */
  fuel = 1;
  wind = 4;

  constructor(r: Renderer, sites: FireSite[]) {
    const scene: Scene = r.scene;
    const engine = scene.getEngine() as unknown as WebGPUEngine;
    const mk = () => RawTexture.CreateRGBAStorageTexture(new Uint16Array(this.gw * this.gh * 4), this.gw, this.gh, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.grid = [mk(), mk()];
    this.cs = new ComputeShader('fireSim', engine, { computeSource: computeSource('fire') }, {
      bindingsMapping: { prm: { group: 0, binding: 0 }, src: { group: 0, binding: 1 }, dst: { group: 0, binding: 2 } },
    });
    this.ub = new UniformBuffer(engine, undefined, false, 'fireParams');
    for (const [n, k] of [['size', 2], ['dt', 1], ['time', 1], ['buoyancy', 1], ['cooling', 1], ['turbulence', 1], ['smokeRate', 1], ['fuel', 1], ['wind', 1], ['pad0', 1], ['pad1', 1]] as const) {
      this.ub.addUniform(n, k);
    }
    this.ub.create();
    // the cards
    this.mesh = new Mesh('fireCards', scene);
    const vd = new VertexData();
    vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh);
    const data = new Float32Array(sites.length * 8);
    sites.forEach((s, i) => {
      data.set([s.at[0], s.at[1], s.at[2], s.w, s.h, Math.random(), Math.random() > 0.5 ? 1 : 0, s.intensity ?? 1], i * 8);
    });
    this.buffer = new Buffer(engine, data, false, 8, false, true);
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('f0', 0, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('f1', 4, 4));
    this.mesh.forcedInstanceCount = sites.length;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    this.mat = new ShaderMaterial('fireCard', scene, { vertex: 'firecard', fragment: 'firecard' }, {
      attributes: ['position', 'f0', 'f1'], uniforms: ['viewProjection', 'view', 'cameraPosition', 'screenSize', 'time'], samplers: ['fireTex', 'gbuffer'],
      shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    this.mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    this.mat.disableDepthWrite = true;
    this.mat.backFaceCulling = false;
    this.mat.setTexture('gbuffer', r.gbuffer.rtt);
    this.mesh.material = this.mat;
    const o = scene.onBeforeRenderObservable.add(() => this.flush());
    this.obs = () => scene.onBeforeRenderObservable.remove(o);
    const off = r.mats.onUpdate(() => {
      this.mat.setVector3('cameraPosition', r.camera.globalPosition);
      this.mat.setVector2('screenSize', new Vector2(engine.getRenderWidth(), engine.getRenderHeight()));
      this.mat.setTexture('fireTex', this.grid[0]);
      this.mat.setFloat('time', this.time);
    });
    const prevObs = this.obs;
    this.obs = () => {
      prevObs();
      off();
    };
  }

  update(dt: number): void {
    this.pending += dt;
  }

  private flush(): void {
    if (this.pending <= 0 || !this.cs.isReady()) {
      this.pending = Math.min(this.pending, 0.1);
      return;
    }
    const steps = Math.min(3, Math.ceil(this.pending / (1 / 40)));
    const h = Math.min(this.pending / steps, 1 / 30);
    this.pending = 0;
    for (let i = 0; i < steps; i++) {
      this.time += h;
      const ub = this.ub;
      ub.updateFloat2('size', this.gw, this.gh);
      ub.updateFloat('dt', h);
      ub.updateFloat('time', this.time);
      ub.updateFloat('buoyancy', 120);
      ub.updateFloat('cooling', 0.7);
      ub.updateFloat('turbulence', 14);
      ub.updateFloat('smokeRate', 0.8);
      ub.updateFloat('fuel', this.fuel);
      ub.updateFloat('wind', this.wind);
      ub.updateFloat('pad0', 0);
      ub.updateFloat('pad1', 0);
      ub.update();
      this.cs.setUniformBuffer('prm', ub);
      this.cs.setTexture('src', this.grid[0], false);
      this.cs.setStorageTexture('dst', this.grid[1]);
      this.cs.dispatch(Math.ceil(this.gw / 8), Math.ceil(this.gh / 8), 1);
      this.grid.reverse();
    }
  }

  dispose(): void {
    this.obs();
    this.buffer.dispose();
    this.mat.dispose();
    this.mesh.dispose();
    for (const g of this.grid) g.dispose();
  }
}
