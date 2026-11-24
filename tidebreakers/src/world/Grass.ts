// A grass field that follows the camera (see tbGrass.vertex.wgsl). One clump mesh of curved blades is
// drawn as a fixed grid of thin instances; every frame the grid is wrapped around the camera and each
// clump gets its ground height (from the level's height function), its size (from a baked density
// field) and how hard the player is pushing it aside.
import { Mesh, VertexData, ShaderMaterial, ShaderLanguage, Matrix, Vector4 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import type { Terrain } from './World';
import { hex, ENV_ID } from '../render/materials';

export interface GrassLook { root: string; tip: string; dry: string; height?: number; width?: number; threshold?: number; translucency?: number }

const RES = 256;

export class Grass {
  mesh: Mesh;
  mat: ShaderMaterial;
  private n: number;
  private cells: Float32Array;
  private cells2: Float32Array;
  private rnd: Float32Array;
  private hgrid: Float32Array;
  private dgrid: Float32Array;
  private push = { x: 0, y: -100, z: 0, r: 1.2 };
  private lastKey = '';

  constructor(readonly r: Renderer, readonly terrain: Terrain, density: (x: number, z: number, h: number) => number, readonly look: GrassLook,
    readonly fieldSize = 44, readonly spacing = 0.5) {
    // one clump: curved blades rooted across a small disc (not one point, which reads as a cone), three
    // segments each. x: how far from the clump centre the blade's root is (0..1), z: its curve / identity
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const blades = 9, segs = 3;
    for (let b = 0; b < blades; b++) {
      const base = pos.length / 3;
      const curve = (b % 2 ? 1 : -1) * (0.3 + 0.5 * b / blades);
      const radial = Math.sqrt((b + 0.5) / blades);
      for (let s = 0; s <= segs; s++) {
        const t = s / segs;
        for (const side of [-1, 1]) { pos.push(radial, t, curve); uv.push(side, t); }
      }
      for (let s = 0; s < segs; s++) { const i = base + s * 2; idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uv;
    vd.indices = idx;
    this.mesh = new Mesh('grass', r.scene);
    vd.applyToMesh(this.mesh);
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.n = Math.floor(fieldSize / spacing);
    const count = this.n * this.n;
    this.cells = new Float32Array(count * 4);
    this.cells2 = new Float32Array(count * 4);
    this.rnd = new Float32Array(count);
    for (let k = 0; k < count; k++) this.rnd[k] = fract(Math.sin(k * 12.9898) * 43758.5453);
    const mats = new Float32Array(count * 16);
    const id = Matrix.Identity().toArray();
    for (let k = 0; k < count; k++) mats.set(id, k * 16);
    this.mesh.thinInstanceSetBuffer('matrix', mats, 16, true);
    this.mesh.thinInstanceSetBuffer('cell', this.cells, 4, false);
    this.mesh.thinInstanceSetBuffer('cell2', this.cells2, 4, false);
    // height and density grids over the terrain square
    this.hgrid = new Float32Array(RES * RES);
    this.dgrid = new Float32Array(RES * RES);
    for (let y = 0; y < RES; y++) {
      for (let x = 0; x < RES; x++) {
        const wx = terrain.x0 + (x / (RES - 1)) * terrain.size, wz = terrain.z0 + (y / (RES - 1)) * terrain.size;
        const h = terrain.height(wx, wz);
        this.hgrid[y * RES + x] = h;
        this.dgrid[y * RES + x] = Math.max(0, Math.min(1, density(wx, wz, h)));
      }
    }
    const m = new ShaderMaterial('grassMat', r.scene, { vertex: 'tbGrass', fragment: 'tbGrass' }, {
      attributes: ['position', 'uv', 'cell', 'cell2'], uniforms: ['viewProjection', 'view', 'grassA', 'grassB', 'grassC'],
      uniformBuffers: ['globals'], samplers: ['shadowTex0', 'shadowTex1'], shaderLanguage: ShaderLanguage.WGSL,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    const [s0, s1] = r.shadowTextures;
    m.setTexture('shadowTex0', s0 as any);
    m.setTexture('shadowTex1', s1 as any);
    const a = hex(look.root), b = hex(look.tip), c = hex(look.dry);
    m.setVector4('grassA', new Vector4(a.r, a.g, a.b, ENV_ID));
    m.setVector4('grassB', new Vector4(b.r, b.g, b.b, look.translucency ?? 0.6));
    m.setVector4('grassC', new Vector4(c.r, c.g, c.b, 0));
    m.backFaceCulling = false;
    this.mat = m;
    this.mesh.material = m;
  }

  private sample(grid: Float32Array, x: number, z: number): number {
    const t = this.terrain;
    const u = ((x - t.x0) / t.size) * (RES - 1), v = ((z - t.z0) / t.size) * (RES - 1);
    if (u < 0 || v < 0 || u > RES - 1 || v > RES - 1) return grid === this.hgrid ? -100 : 0;
    const i = Math.floor(u), j = Math.floor(v);
    const fu = u - i, fv = v - j;
    const i1 = Math.min(i + 1, RES - 1), j1 = Math.min(j + 1, RES - 1);
    const a = grid[j * RES + i], b = grid[j * RES + i1], c = grid[j1 * RES + i], d = grid[j1 * RES + i1];
    return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
  }

  /** The player (or anyone) pushes blades aside. */
  setPusher(x: number, y: number, z: number, radius = 1.2): void { this.push = { x, y, z, r: radius }; }

  /** Wraps the clump grid around the camera and refreshes the per-instance data. */
  update(camX: number, camZ: number): void {
    const n = this.n, sp = this.spacing, size = n * sp;
    const L = this.look;
    const H = L.height ?? 0.55, W = L.width ?? 0.06, th = L.threshold ?? 0.35;
    const P = this.push;
    const key = `${Math.floor(camX / sp)},${Math.floor(camZ / sp)}`;
    const moved = key !== this.lastKey;
    this.lastKey = key;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        let ox = (i + 0.5) * sp, oz = (j + 0.5) * sp;
        ox -= size * Math.floor((ox - camX) / size + 0.5);
        oz -= size * Math.floor((oz - camZ) / size + 0.5);
        const r = this.rnd[k];
        const x = ox + (fract(r * 7.13) - 0.5) * sp * 0.9, z = oz + (fract(r * 3.71) - 0.5) * sp * 0.9;
        if (moved) {
          const d = this.sample(this.dgrid, x, z);
          const dist = Math.hypot(x - camX, z - camZ);
          const edge = 1 - smooth(size * 0.34, size * 0.49, dist);
          const alive = d > th + (r - 0.5) * 0.25 ? edge : 0;
          this.cells[k * 4] = x;
          this.cells[k * 4 + 1] = this.sample(this.hgrid, x, z);
          this.cells[k * 4 + 2] = z;
          this.cells[k * 4 + 3] = H * (0.6 + 0.8 * fract(r * 17.31)) * (0.55 + 0.45 * d) * alive;
          this.cells2[k * 4] = r;
          this.cells2[k * 4 + 3] = W;
        }
        // push: away from the player, only for clumps near them
        const px = x - P.x, pz = z - P.z;
        const pd = Math.hypot(px, pz);
        let push = 0;
        if (pd < P.r && Math.abs(this.cells[k * 4 + 1] - P.y) < 1.5) push = 1 - smooth(P.r * 0.4, P.r, pd);
        this.cells2[k * 4 + 1] = pd > 1e-3 ? (px / pd) * push : 0;
        this.cells2[k * 4 + 2] = pd > 1e-3 ? (pz / pd) * push : 0;
      }
    }
    this.mesh.thinInstanceBufferUpdated('cell');
    this.mesh.thinInstanceBufferUpdated('cell2');
  }

  dispose(): void { this.mesh.dispose(); this.mat.dispose(); }
}

function fract(x: number): number { return x - Math.floor(x); }
function smooth(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
