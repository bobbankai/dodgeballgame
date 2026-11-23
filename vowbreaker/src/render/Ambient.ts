import { Buffer, Color3, Mesh, Scene, Vector3, ShaderLanguage, ShaderMaterial, Vector4, VertexData } from '@babylonjs/core';

export type AmbientKind = 'none' | 'rain' | 'petals' | 'ash' | 'snow' | 'embers' | 'motes' | 'fireflies' | 'leaves' | 'slips' | 'dust' | 'sleet';
const KIND_ID: Record<AmbientKind, number> = {
  none: -1, rain: 0, petals: 1, ash: 2, snow: 3, embers: 4, motes: 5, fireflies: 6, leaves: 7, slips: 8, dust: 9, sleet: 10,
};

/** Weather drawn entirely on the GPU: thousands of quads animated in the vertex shader. */
export class Ambient {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  kind: AmbientKind = 'none';
  density = 1;
  box = 30;
  color = new Vector4(0.75, 0.8, 0.95, 0.8);
  wind = new Vector4(1.2, 0, 0.4, 9);

  constructor(scene: Scene, count = 6000) {
    this.mesh = new Mesh('ambient', scene);
    const vd = new VertexData();
    vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh);
    const ids = new Float32Array(count);
    for (let i = 0; i < count; i++) ids[i] = i;
    const buf = new Buffer(scene.getEngine(), ids, false, 1, false, true);
    this.mesh.setVerticesBuffer(buf.createVertexBuffer('idx', 0, 1));
    this.mesh.forcedInstanceCount = count;
    this.mat = new ShaderMaterial('ambientMat', scene, { vertex: 'ambient', fragment: 'ambient' }, {
      attributes: ['position', 'idx'], uniforms: ['viewProjection', 'view', 'cameraPosition', 'ambientParams', 'ambientWind', 'ambientColor', 'ambientParams2', 'sunDir', 'sunColor'],
      shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mesh.material = this.mat;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    this.mesh.setEnabled(false);
  }

  set(kind: AmbientKind, density = 1): void {
    this.kind = kind;
    this.density = density;
    this.mesh.setEnabled(kind !== 'none');
    if (kind === 'rain') {
      this.color.set(0.7, 0.75, 0.9, 0.55);
      this.wind.set(1.5, 0, 0.6, 14);
    } else if (kind === 'petals') {
      this.color.set(1.0, 0.72, 0.8, 1);
      this.wind.set(0.8, 0, 0.3, 0.9);
    } else if (kind === 'ash') {
      this.color.set(0.35, 0.33, 0.33, 0.9);
      this.wind.set(0.4, 0, 0.2, 0.6);
    } else if (kind === 'snow') {
      this.color.set(0.95, 0.97, 1.0, 0.9);
      this.wind.set(0.3, 0, 0.1, 0.8);
    } else if (kind === 'embers') {
      this.color.set(1.0, 0.45, 0.12, 1);
      this.wind.set(0.3, 0, 0.2, 1.2);
    } else if (kind === 'motes') {
      this.color.set(1.0, 0.7, 0.35, 0.8);
      this.wind.set(0.1, 0, 0.1, 0.25);
    } else if (kind === 'fireflies') {
      this.color.set(0.7, 1.0, 0.5, 1);
      this.wind.set(0, 0, 0, 0);
    } else if (kind === 'leaves') {
      this.color.set(0.8, 0.45, 0.12, 1);
      this.wind.set(1.0, 0, 0.4, 1.1);
    } else if (kind === 'slips') {
      this.color.set(0.96, 0.94, 0.88, 1);
      this.wind.set(0.5, 0, 0.2, 0.8);
    } else if (kind === 'dust') {
      this.color.set(0.9, 0.85, 0.75, 0.6);
      this.wind.set(0.02, 0, 0.01, 0.05);
    } else if (kind === 'sleet') {
      this.color.set(0.85, 0.9, 1.0, 0.7);
      this.wind.set(2.4, 0, 0.8, 11);
    }
  }

  /** a lightning flash lighting the air (0..1) */
  flash = 0;
  ground = 0;
  sunDir = new Vector3(0.3, 0.8, 0.4);
  sunColor = new Color3(1, 1, 1);

  update(time: number): void {
    if (this.kind === 'none') return;
    this.mat.setVector4('ambientParams2', new Vector4(this.flash, this.ground, 0, 0));
    this.mat.setVector3('sunDir', this.sunDir);
    this.mat.setColor3('sunColor', this.sunColor);
    this.mat.setVector4('ambientParams', new Vector4(KIND_ID[this.kind], time, this.box, this.density));
    this.mat.setVector4('ambientWind', this.wind);
    this.mat.setVector4('ambientColor', this.color);
  }
}
