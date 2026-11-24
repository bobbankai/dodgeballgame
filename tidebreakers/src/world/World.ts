// Terrain, sea and environment kit. The terrain height function is the single source of truth for the
// ground: it builds the mesh, answers collision queries and bakes the heightmap the ocean shader uses
// to tint shallow water and draw shore foam.
import {
  Mesh, VertexData, ShaderMaterial, ShaderLanguage, RawTexture, Constants, Vector3, Vector4, MeshBuilder, TransformNode, Matrix,
  Quaternion,
} from '@babylonjs/core';
import type { AbstractMesh, InstancedMesh } from '@babylonjs/core';
import { SEA_ID, type Renderer } from '../render/Renderer';
import { hex, c4, v4, ENV_ID } from '../render/materials';
import { loadContainer } from '../game/CharacterModel';
import type { Collision } from '../game/Collision';

export type HeightFn = (x: number, z: number) => number;
export type MaskFn = (x: number, z: number, h: number) => [number, number, number, number];

export interface TerrainPalette { grassLight: string; grassDark: string; sand: string; rock: string; dirt: string; sandHeight: number; beach: number; rockSlope: number; path: number }

function bindShadow(m: ShaderMaterial, r: Renderer): void {
  const [s0, s1] = r.shadowTextures;
  m.setTexture('shadowTex0', s0 as any);
  m.setTexture('shadowTex1', s1 as any);
}

// ------------------------------------------------------------------------------------------ terrain
export class Terrain {
  mesh: Mesh;
  heightTex: RawTexture;
  constructor(readonly r: Renderer, readonly height: HeightFn, readonly x0: number, readonly z0: number, readonly size: number, res: number,
    pal: TerrainPalette, mask?: MaskFn) {
    const n = res + 1;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 4);
    const step = size / res;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step, z = z0 + j * step;
        const h = height(x, z);
        const k = j * n + i;
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        const m = mask ? mask(x, z, h) : [0, 1, 0, 0];
        col.set(m, k * 4);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        // skip quads fully under deep water (saves triangles)
        if (pos[a * 3 + 1] < -6 && pos[b * 3 + 1] < -6 && pos[c * 3 + 1] < -6 && pos[d * 3 + 1] < -6) continue;
        idx.push(a, b, c, b, d, c);
      }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.colors = col;
    const normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    vd.normals = normals;
    this.mesh = new Mesh('terrain', r.scene);
    vd.applyToMesh(this.mesh);
    this.mesh.hasVertexAlpha = false;
    const m = new ShaderMaterial('terrainMat', r.scene, { vertex: 'tbTerrain', fragment: 'tbTerrain' }, {
      attributes: ['position', 'normal', 'color'], uniforms: ['world', 'viewProjection', 'view', 'palA', 'palB', 'palC', 'palD', 'palE'],
      uniformBuffers: ['globals'], samplers: ['shadowTex0', 'shadowTex1'], shaderLanguage: ShaderLanguage.WGSL,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    bindShadow(m, r);
    m.setVector4('palA', c4(hex(pal.grassLight), pal.sandHeight));
    m.setVector4('palB', c4(hex(pal.grassDark), pal.beach));
    m.setVector4('palC', c4(hex(pal.sand), pal.rockSlope));
    m.setVector4('palD', c4(hex(pal.rock), pal.path));
    m.setVector4('palE', c4(hex(pal.dirt), ENV_ID));
    this.mesh.material = m;
    r.addCaster(this.mesh);
    // heightmap for the ocean (256^2 covering the terrain square)
    const hr = 256;
    // 8-bit, offset by half: (h / 40 + 0.5). Float32 textures aren't filterable on every WebGPU adapter.
    const hd = new Uint8Array(hr * hr);
    for (let j = 0; j < hr; j++) for (let i = 0; i < hr; i++) {
      const h = height(x0 + (i / (hr - 1)) * size, z0 + (j / (hr - 1)) * size);
      hd[j * hr + i] = Math.max(0, Math.min(255, Math.round((h / 40 + 0.5) * 255)));
    }
    this.heightTex = RawTexture.CreateRTexture(hd, hr, hr, r.scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.heightTex.wrapU = this.heightTex.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
  }

  dispose(): void { this.mesh.dispose(); this.heightTex.dispose(); }
}

// ------------------------------------------------------------------------------------------ sea
const WAVES = [[0.3, 24, 0.28, 1.0], [1.4, 13, 0.17, 1.1], [-0.7, 8.5, 0.1, 1.0], [2.3, 5.2, 0.06, 1.2], [0.9, 3.4, 0.035, 1.3], [-1.9, 2.1, 0.02, 1.4]];

export class Sea {
  mesh: Mesh;
  mat: ShaderMaterial;
  constructor(readonly r: Renderer, terrain: Terrain | null) {
    this.mesh = MeshBuilder.CreateGround('sea', { width: 2, height: 2, subdivisions: 220 }, r.scene);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    const m = new ShaderMaterial('seaMat', r.scene, { vertex: 'tbOcean', fragment: 'tbOcean' }, {
      attributes: ['position'], uniforms: ['viewProjection', 'view', 'seabed', 'seaFx'], uniformBuffers: ['globals'], samplers: ['heightTex'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    m.backFaceCulling = false;
    if (terrain) {
      m.setTexture('heightTex', terrain.heightTex);
      m.setVector4('seabed', v4(terrain.x0, terrain.z0, terrain.size, 40));
    } else {
      const t = RawTexture.CreateRTexture(new Uint8Array([0]), 1, 1, r.scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_UNSIGNED_BYTE);
      m.setTexture('heightTex', t);
      m.setVector4('seabed', v4(-1e5, -1e5, 2e5, 40));
    }
    m.setVector4('seaFx', v4(1, 1, 0.5, SEA_ID));
    this.mat = m;
    this.mesh.material = m;
  }

  /** CPU mirror of tbWaves (sea height at x, z). */
  heightAt(x: number, z: number, t: number): number {
    const g = this.r.globals.get('sea');
    const amp = g[1] * (1 + g[3] * 2.2);
    let y = g[0];
    // one fixed-point pass to account for horizontal displacement
    for (const [ang, wl, a0, sp] of WAVES) {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const k = (Math.PI * 2) / wl;
      const c = Math.sqrt(9.8 / k) * sp;
      y += a0 * amp * Math.sin(k * (dx * x + dz * z - c * t));
    }
    return y;
  }

  dispose(): void { this.mesh.dispose(); }
}

// ------------------------------------------------------------------------------------------ env kit
export class EnvKit {
  private protos = new Map<string, Mesh>();
  private mats = new Map<string, ShaderMaterial>();
  root: TransformNode;
  placed: (AbstractMesh | InstancedMesh)[] = [];

  constructor(readonly r: Renderer) {
    this.root = new TransformNode('env', r.scene);
  }

  static material(r: Renderer, name: string, sway = 0, tint = '#ffffff'): ShaderMaterial {
    const m = new ShaderMaterial(name, r.scene, { vertex: 'tbEnv', fragment: 'tbEnv' }, {
      attributes: ['position', 'normal', 'uv2'], uniforms: ['world', 'viewProjection', 'view', 'envFx', 'envTint'], uniformBuffers: ['globals'],
      samplers: ['shadowTex0', 'shadowTex1'], shaderLanguage: ShaderLanguage.WGSL,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    bindShadow(m, r);
    m.setVector4('envFx', v4(sway, 3, 0, ENV_ID));
    const c = hex(tint);
    m.setVector4('envTint', v4(c.r, c.g, c.b, 0));
    m.backFaceCulling = false;
    return m;
  }

  async load(url: string): Promise<void> {
    const cont = await loadContainer(url, this.r.scene);
    const mat = this.mats.get('base') ?? EnvKit.material(this.r, 'envBase', 1.0);
    this.mats.set('base', mat);
    for (const m of cont.meshes) {
      if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
      const name = m.name.replace(/\.\d+$/, '');
      if (this.protos.has(name)) continue;
      // bake the node transform (glTF root conversion) into a fresh prototype mesh
      const proto = m.clone(`kit:${name}`, null, true, false) as Mesh;
      proto.setParent(null);
      proto.makeGeometryUnique();
      proto.bakeCurrentTransformIntoVertices();
      proto.position.setAll(0); proto.rotationQuaternion = null; proto.rotation.setAll(0); proto.scaling.setAll(1);
      proto.material = mat;
      proto.hasVertexAlpha = false;
      proto.isVisible = false;
      proto.setEnabled(true);
      this.r.scene.addMesh(proto);
      this.protos.set(name, proto);
    }
  }

  has(name: string): boolean { return this.protos.has(name); }

  /** A bare instance (no collision, not parented to the level root). */
  instance(name: string): InstancedMesh | null {
    const p = this.protos.get(name);
    if (!p) return null;
    const inst = p.createInstance(`${name}#i${this.placed.length}`);
    this.placed.push(inst);
    return inst;
  }
  names(): string[] { return [...this.protos.keys()]; }

  /** Places an instance of a kit piece. Returns the instance. */
  place(name: string, x: number, y: number, z: number, rotY = 0, scale: number | [number, number, number] = 1, col?: Collision, collide: 'box' | 'circle' | 'none' | 'platform' = 'box'): InstancedMesh | null {
    const p = this.protos.get(name);
    if (!p) { console.warn('kit piece missing', name); return null; }
    const inst = p.createInstance(`${name}#${this.placed.length}`);
    inst.position.set(x, y, z);
    inst.rotation.y = rotY;
    const s = Array.isArray(scale) ? scale : [scale, scale, scale];
    inst.scaling.set(s[0], s[1], s[2]);
    inst.parent = this.root;
    this.placed.push(inst);
    this.r.addCaster(inst);
    if (col && collide !== 'none') {
      const bb = p.getBoundingInfo().boundingBox;
      const hx = (bb.extendSize.x) * s[0], hz = (bb.extendSize.z) * s[2];
      const cx = bb.center.x * s[0], cz = bb.center.z * s[2];
      const c = Math.cos(rotY), sn = Math.sin(rotY);
      const wx = x + cx * c + cz * sn, wz = z - cx * sn + cz * c;
      const top = y + bb.maximum.y * s[1];
      if (collide === 'circle') col.addCircle(wx, wz, Math.max(hx, hz) * 0.8, y - 1, top);
      else if (collide === 'platform') col.addPlatform(wx, wz, hx, hz, top, -rotY);
      else col.addBox(wx, wz, hx, hz, -rotY, y - 1, top);
    }
    return inst;
  }

  dispose(): void {
    for (const p of this.placed) p.dispose();
    for (const p of this.protos.values()) p.dispose();
    this.placed = [];
    this.protos.clear();
    this.root.dispose();
  }
}

export function v3(x: number, y: number, z: number): Vector3 { return new Vector3(x, y, z); }
void Matrix; void Quaternion; void Vector4;
