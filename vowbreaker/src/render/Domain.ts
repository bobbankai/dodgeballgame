import { Mesh, MeshBuilder, ShaderLanguage, ShaderMaterial, Vector3, Vector4 } from '@babylonjs/core';
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
      attributes: ['position'], uniforms: ['world', 'viewProjection', 'cameraPosition', 'domainParams', 'domainCenter', 'lightViewProj', 'shadowParams'],
      samplers: ['shadowMap'], shaderLanguage: ShaderLanguage.WGSL,
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
    this.off = r.mats.onUpdate((l) => {
      if (!this.active) return;
      const p = new Vector4(this.id, this.reveal, l.time, this.intensity);
      this.domeMat.setVector4('domainParams', p);
      this.domeMat.setVector3('domainCenter', this.center);
      this.floorMat.setVector4('domainParams', p);
      this.floorMat.setVector3('domainCenter', this.center);
      this.floorMat.setMatrix('lightViewProj', l.lightViewProj);
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
  }

  hide(): void {
    this.active = false;
    this.dome.setEnabled(false);
    this.floor.setEnabled(false);
  }

  dispose(): void {
    this.off();
    this.dome.dispose();
    this.floor.dispose();
  }
}
