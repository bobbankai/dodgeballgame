import { ComputeShader, Constants, Mesh, MeshBuilder, RawTexture, ShaderLanguage, ShaderMaterial, UniformBuffer, Vector3, Vector4, WebGPUEngine } from '@babylonjs/core';
import { computeSource } from './ShaderLib';
import type { Renderer } from './Renderer';

/** The domain made visible: a raymarched dome and a floor, revealed outward from the caster. */
export class DomainScene {
  readonly dome: Mesh;
  readonly floor: Mesh;
  private domeMat: ShaderMaterial;
  private floorMat: ShaderMaterial;
  id = 0;
  reveal = 0;
  intensity = 1;
  center = new Vector3();
  active = false;
  private off: () => void;
  /** what grows across the floor while the domain is open (Gray-Scott, compute/curse_rot.wgsl) */
  private growth: RawTexture[];
  private growthCs: ComputeShader;
  private growthUb: UniformBuffer;
  private growthSeed = false;
  private readonly growthRes = 256;
  private readonly growthSize = 48;
  private growthObs: () => void;

  constructor(r: Renderer) {
    const scene = r.scene;
    this.dome = MeshBuilder.CreateSphere('domainDome', { diameter: 140, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    this.floor = MeshBuilder.CreateDisc('domainFloor', { radius: 70, tessellation: 64 }, scene);
    this.floor.rotation.x = Math.PI / 2;
    this.floor.position.y = 0.015;
    this.domeMat = new ShaderMaterial('domainMat', scene, { vertex: 'domain', fragment: 'domain' }, {
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'cameraPosition', 'domainParams', 'domainCenter'], shaderLanguage: ShaderLanguage.WGSL,
    });
    this.domeMat.backFaceCulling = false;
    this.floorMat = new ShaderMaterial('domainFloorMat', scene, { vertex: 'domain', fragment: 'domainFloor' }, {
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'cameraPosition', 'domainParams', 'domainCenter', 'lightViewProj', 'shadowParams', 'growthParams'],
      samplers: ['shadowMap', 'growth'], shaderLanguage: ShaderLanguage.WGSL,
    });
    this.floorMat.backFaceCulling = false;
    this.floorMat.setTexture('shadowMap', r.lighting.shadowMap ?? r.mats.dummy);
    this.dome.material = this.domeMat;
    this.floor.material = this.floorMat;
    for (const m of [this.dome, this.floor]) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
    }
    r.gbuffer.add(this.floor, undefined, 999);
    // the growth field (clean everywhere: A = 1, B = 0)
    const gr = this.growthRes;
    const clean = new Uint16Array(gr * gr * 4);
    for (let i = 0; i < gr * gr; i++) clean[i * 4] = 0x3c00;
    const mk = () => RawTexture.CreateRGBAStorageTexture(clean.slice(), gr, gr, scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
    this.growth = [mk(), mk()];
    const engine = scene.getEngine() as unknown as WebGPUEngine;
    this.growthCs = new ComputeShader('domainGrowth', engine, { computeSource: computeSource('curse_rot') }, {
      bindingsMapping: { prm: { group: 0, binding: 0 }, src: { group: 0, binding: 1 }, dst: { group: 0, binding: 2 } },
    });
    this.growthUb = new UniformBuffer(engine, undefined, false, 'growthParams');
    for (const [n, k] of [['grid', 2], ['centre', 2], ['worldSize', 1], ['dt', 1], ['feed', 1], ['kill', 1], ['diffA', 1], ['diffB', 1], ['count', 1], ['pad0', 1]] as const) {
      this.growthUb.addUniform(n, k);
    }
    this.growthUb.addUniform('seeds', 4, 8);
    this.growthUb.create();
    this.floorMat.setTexture('growth', this.growth[0]);
    const go = scene.onBeforeRenderObservable.add(() => this.grow());
    this.growthObs = () => scene.onBeforeRenderObservable.remove(go);
    this.off = r.mats.onUpdate((l) => {
      if (!this.active) return;
      const p = new Vector4(this.id, this.reveal, l.time, this.intensity);
      this.domeMat.setVector4('domainParams', p);
      this.domeMat.setVector3('domainCenter', this.center);
      this.floorMat.setVector4('domainParams', p);
      this.floorMat.setVector3('domainCenter', this.center);
      this.floorMat.setMatrix('lightViewProj', l.lightViewProj);
      this.floorMat.setTexture('growth', this.growth[0]);
      this.floorMat.setVector4('growthParams', new Vector4(this.center.x, this.center.z, 1 / this.growthSize, 1));
      this.floorMat.setVector4('shadowParams', new Vector4(l.shadowSize, l.shadowBias, 1.5, l.shadowMap ? 1 : 0));
      if (l.shadowMap) this.floorMat.setTexture('shadowMap', l.shadowMap);
    });
  }

  show(id: number, center: Vector3): void {
    this.id = id;
    this.center.copyFrom(center);
    this.reveal = 0;
    this.active = true;
    this.dome.position.copyFrom(center);
    this.dome.setEnabled(true);
    this.floor.setEnabled(true);
    // the growth starts over from the caster's feet
    this.growthSeed = true;
  }

  /** Grow the floor's pattern a few steps a frame while the domain is open. */
  private grow(): void {
    if (!this.active || !this.growthCs.isReady()) return;
    const rates: [number, number][] = [[0.030, 0.062], [0.055, 0.062], [0.0367, 0.0649], [0.029, 0.057], [0.039, 0.058]];
    const [feed, kill] = rates[Math.max(0, Math.min(4, Math.round(this.id)))];
    const seeds = new Float32Array(32);
    let count = 0;
    if (this.growthSeed) {
      // wipe the old pattern, then pour the new one in round the caster
      seeds.set([this.center.x, this.center.z, 1e4, -1], 0);
      seeds.set([this.center.x, this.center.z, 1.6, 1], 4);
      count = 2;
      this.growthSeed = false;
    }
    const ub = this.growthUb;
    ub.updateFloat2('grid', this.growthRes, this.growthRes);
    ub.updateFloat2('centre', this.center.x, this.center.z);
    ub.updateFloat('worldSize', this.growthSize);
    ub.updateFloat('dt', 1);
    ub.updateFloat('feed', feed);
    ub.updateFloat('kill', kill);
    ub.updateFloat('diffA', 1.0);
    ub.updateFloat('diffB', 0.5);
    ub.updateFloat('count', count);
    ub.updateFloat('pad0', 0);
    ub.updateFloatArray('seeds', seeds);
    ub.update();
    this.growthCs.setUniformBuffer('prm', ub);
    for (let i = 0; i < 4; i++) {
      this.growthCs.setTexture('src', this.growth[0], false);
      this.growthCs.setStorageTexture('dst', this.growth[1]);
      this.growthCs.dispatch(this.growthRes / 8, this.growthRes / 8, 1);
      this.growth.reverse();
    }
  }

  hide(): void {
    this.active = false;
    this.dome.setEnabled(false);
    this.floor.setEnabled(false);
  }

  dispose(): void {
    this.off();
    this.growthObs();
    for (const g of this.growth) g.dispose();
    this.growthUb.dispose();
    this.dome.dispose();
    this.floor.dispose();
  }
}
