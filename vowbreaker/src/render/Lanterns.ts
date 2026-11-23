import { Buffer, Mesh, MeshBuilder, Scene, ShaderLanguage, ShaderMaterial, Vector4, WebGPUEngine } from '@babylonjs/core';
import type { Materials } from './Materials';

/** A sky full of lanterns rising round a place (the night of the lanterns). */
export interface LanternsDef {
  count: number;
  /** the ring they rise in: inner and outer radius round the centre */
  ring: [number, number];
  centre?: [number, number];
  /** how high they climb before they fade away */
  climb?: number;
  /** 0..1 how many burn cursed red */
  cursed?: number;
}

/**
 * Rising lanterns: hundreds of paper lanterns drifting up past the fighters with real parallax,
 * each one instance of a small barrel mesh animated entirely in its vertex shader from its own seed
 * (lantern3d.vertex/fragment): rising, swaying, turning, swelling in and shrinking away, lit from
 * inside by a flickering flame; cursed ones red with a black sigil.
 */
export class Lanterns {
  private mesh: Mesh;
  private mat: ShaderMaterial;
  private buffer: Buffer;
  private off: () => void;
  private time = 0;

  constructor(engine: WebGPUEngine, scene: Scene, mats: Materials, def: LanternsDef) {
    this.mesh = MeshBuilder.CreateCylinder('lanterns3d', { height: 1, diameter: 1, tessellation: 10, cap: Mesh.NO_CAP }, scene);
    const n = def.count;
    const data = new Float32Array(n * 8);
    const [r0, r1] = def.ring;
    const c = def.centre ?? [0, 0];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(r0 * r0 + Math.random() * (r1 * r1 - r0 * r0));
      data.set([
        c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, Math.random() * 4, Math.random(),
        0.85 + Math.random() * 0.6, 0.35 + Math.random() * 0.5, def.climb ?? 45, Math.random() < (def.cursed ?? 0) ? 1 : 0,
      ], i * 8);
    }
    this.buffer = new Buffer(engine, data, false, 8, false, true);
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('l0', 0, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('l1', 4, 4));
    this.mesh.forcedInstanceCount = n;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mat = new ShaderMaterial('lantern3dMat', scene, { vertex: 'lantern3d', fragment: 'lantern3d' }, {
      attributes: ['position', 'l0', 'l1'], uniforms: ['viewProjection', 'cameraPosition', 'lanternParams'], shaderLanguage: ShaderLanguage.WGSL,
    });
    this.mat.backFaceCulling = false;
    this.mesh.material = this.mat;
    this.off = mats.onUpdate((l) => {
      this.mat.setVector4('lanternParams', new Vector4(this.time, l.windDir.x * l.windStrength * 0.3, l.windDir.z * l.windStrength * 0.3, 0));
      const cam = scene.activeCamera;
      if (cam) this.mat.setVector3('cameraPosition', cam.globalPosition);
    });
  }

  update(dt: number): void {
    this.time += dt;
  }

  dispose(): void {
    this.off();
    this.mesh.dispose();
    this.mat.dispose();
    this.buffer.dispose();
  }
}
