import { Buffer, Color3, Mesh, ShaderLanguage, ShaderMaterial, Vector4, VertexData } from '@babylonjs/core';
import type { Renderer } from './Renderer';

type RGB = [number, number, number];

/** A field of grass on a stage (vb_grass). */
export interface GrassDef {
  center: [number, number, number];
  radius: number;
  /** blades per square metre (on average; they grow in tufts) */
  density: number;
  height: [number, number];
  ground: RGB;
  blade: RGB;
  tip: RGB;
  /** chance of a wildflower on a tuft (0..1) */
  flowers?: number;
  /** rectangles (x0, z0, x1, z1) kept clear (paths) */
  clear?: [number, number, number, number][];
}

const MAX_BLADES = 60000;

/** Instanced grass blades: wind gusts, fighters pushing through, cel shading to a pale tip. */
export class Grass {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private buffer: Buffer;
  private off: () => void;
  /** up to four things pushing the grass aside (x, y, z, radius) */
  readonly pushers = new Float32Array(16);
  windStrength = 0.6;
  windDir: [number, number] = [1, 0.3];

  constructor(r: Renderer, def: GrassDef) {
    const scene = r.scene;
    this.mesh = new Mesh('grass', scene);
    const pos: number[] = [];
    const idx: number[] = [];
    const rows = 5;
    for (let j = 0; j <= rows; j++) {
      const t = j / rows;
      pos.push(-0.5, t, 0, 0.5, t, 0);
    }
    for (let j = 0; j < rows; j++) {
      const a = j * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(this.mesh);
    // the blades, grown in tufts
    const data = new Float32Array(MAX_BLADES * 8);
    let n = 0;
    const area = Math.PI * def.radius * def.radius;
    const tufts = Math.floor((area * def.density) / 9);
    const clear = def.clear ?? [];
    for (let k = 0; k < tufts && n < MAX_BLADES; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * def.radius;
      const cx = def.center[0] + Math.cos(a) * rr;
      const cz = def.center[2] + Math.sin(a) * rr;
      if (clear.some(([x0, z0, x1, z1]) => cx > x0 && cx < x1 && cz > z0 && cz < z1)) continue;
      const tuftH = def.height[0] + Math.random() * (def.height[1] - def.height[0]);
      const leanA = Math.random() * Math.PI * 2;
      const leanK = 0.1 + Math.random() * 0.35;
      const flower = Math.random() < (def.flowers ?? 0) ? 1 + Math.floor(Math.random() * 3) : 0;
      const blades = 6 + Math.floor(Math.random() * 9);
      for (let b = 0; b < blades && n < MAX_BLADES; b++) {
        const o = n * 8;
        const ra = Math.random() * Math.PI * 2;
        const rd = Math.random() * 0.22;
        data[o] = cx + Math.cos(ra) * rd;
        data[o + 1] = def.center[1];
        data[o + 2] = cz + Math.sin(ra) * rd;
        data[o + 3] = tuftH * (0.6 + Math.random() * 0.5);
        data[o + 4] = Math.random() * Math.PI;
        data[o + 5] = leanA + (Math.random() - 0.5) * 0.8;
        data[o + 6] = leanK * (0.7 + Math.random() * 0.6);
        // seed in the fraction, a flower kind on one blade of a flowering tuft
        data[o + 7] = Math.random() * 0.999 + (b === 0 ? flower : 0);
        n++;
      }
    }
    const engine = scene.getEngine();
    this.buffer = new Buffer(engine, data.subarray(0, n * 8), false, 8, false, true);
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('g0', 0, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('g1', 4, 4));
    this.mesh.forcedInstanceCount = n;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mat = new ShaderMaterial('grassMat', scene, { vertex: 'grass', fragment: 'grass' }, {
      attributes: ['position', 'g0', 'g1'],
      uniforms: ['viewProjection', 'view', 'cameraPosition', 'grassParams', 'grassParams2', 'pushers', 'sunDir', 'sunColor', 'skyColor',
        'groundColor', 'bladeColor', 'tipColor', 'lightViewProj', 'shadowParams', 'marksParams'],
      samplers: ['shadowMap', 'marksA', 'marksB'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.mat.backFaceCulling = false;
    this.mat.setTexture('shadowMap', r.lighting.shadowMap ?? r.mats.dummy);
    this.mesh.material = this.mat;
    const c3 = (c: RGB) => new Color3(c[0], c[1], c[2]);
    this.off = r.mats.onUpdate((l) => {
      const m = this.mat;
      m.setVector3('cameraPosition', r.camera.globalPosition);
      m.setVector4('grassParams', new Vector4(l.time, this.windStrength, this.windDir[0], this.windDir[1]));
      m.setVector4('grassParams2', new Vector4(0.06, 22, 45, 0));
      m.setArray4('pushers', Array.from(this.pushers));
      m.setVector3('sunDir', l.sunDir);
      m.setColor3('sunColor', l.sunColor);
      m.setColor3('skyColor', l.skyColor);
      m.setColor3('groundColor', c3(def.ground));
      m.setColor3('bladeColor', c3(def.blade));
      m.setColor3('tipColor', c3(def.tip));
      m.setMatrix('lightViewProj', l.lightViewProj);
      m.setVector4('shadowParams', new Vector4(l.shadowSize, l.shadowBias, 1, l.shadowMap ? l.shadowsOn : 0));
      if (l.shadowMap) m.setTexture('shadowMap', l.shadowMap);
      // the fight's ground marks burn, cut, flatten and freeze the blades
      const mk = r.mats.marks;
      m.setTexture('marksA', mk ? mk.texA : r.mats.dummy);
      m.setTexture('marksB', mk ? mk.texB : r.mats.dummy);
      m.setVector4('marksParams', mk ? mk.params : new Vector4(0, 0, 0, 0));
    });
  }

  /** Who is pushing the grass aside this frame (world positions, radius). */
  setPushers(list: { x: number; y: number; z: number; r: number }[]): void {
    this.pushers.fill(0);
    list.slice(0, 4).forEach((p, k) => this.pushers.set([p.x, p.y, p.z, p.r], k * 4));
  }

  dispose(): void {
    this.off();
    this.buffer.dispose();
    this.mat.dispose();
    this.mesh.dispose();
  }
}
