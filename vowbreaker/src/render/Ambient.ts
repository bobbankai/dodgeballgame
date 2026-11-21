import { Buffer, Mesh, Scene, ShaderLanguage, ShaderMaterial, Vector4, VertexData } from '@babylonjs/core';

export type AmbientKind = 'none' | 'rain' | 'petals' | 'ash' | 'snow' | 'embers' | 'motes';
const KIND_ID: Record<AmbientKind, number> = { none: -1, rain: 0, petals: 1, ash: 2, snow: 3, embers: 4, motes: 5 };

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
      attributes: ['position', 'idx'], uniforms: ['viewProjection', 'view', 'cameraPosition', 'ambientParams', 'ambientWind', 'ambientColor'],
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
    }
  }

  update(time: number): void {
    if (this.kind === 'none') return;
    this.mat.setVector4('ambientParams', new Vector4(KIND_ID[this.kind], time, this.box, this.density));
    this.mat.setVector4('ambientWind', this.wind);
    this.mat.setVector4('ambientColor', this.color);
  }
}
