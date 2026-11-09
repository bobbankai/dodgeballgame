import {
  Color3, Matrix, Mesh, Quaternion, Vector3, VertexBuffer, VertexData, type AbstractMesh, type Material, type PBRMaterial, type Scene,
} from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import type { MaterialLibrary } from '../render/Materials';
import type { Lighting } from '../render/Lighting';
import { withLayers } from '../render/materials/SurfaceLayers';
import { log } from '../core/Log';

/** How a texture set is used on environment pieces (UVs are in metres). */
interface EnvSet {
  /** Metres covered by one repeat of the texture. */
  size: number;
  tint?: Color3;
  roughness?: number;
  normal?: number;
  /** 0 metal .. 1 earth/cloth: how much wetness and ash the surface takes. */
  porosity?: number;
  metallic?: number;
}

const SETS: Record<string, EnvSet> = {
  ash_castle_slate: { size: 2.6, porosity: 0.7 },
  ash_castle_brick: { size: 2.2, porosity: 0.75 },
  ash_cobble: { size: 2.6, porosity: 0.8 },
  ash_plaster: { size: 2.5, porosity: 0.9 },
  ash_wood: { size: 1.6, porosity: 0.9 },
  'ash_wood#charred': { size: 1.4, tint: new Color3(0.32, 0.27, 0.24), porosity: 1 },
  ash_roof: { size: 2.4, porosity: 0.7 },
  ash_rock: { size: 4, porosity: 0.6 },
  ash_dark_rock: { size: 3, porosity: 0.6 },
  ash_burned_ground: { size: 4, porosity: 1 },
  ash_mud: { size: 4, porosity: 1 },
  'wood_bark#charred': { size: 1.5, tint: new Color3(0.2, 0.17, 0.15), porosity: 1 },
  'sun_marble#ash': { size: 2, tint: new Color3(0.34, 0.31, 0.29), porosity: 0.5 },
  cloth_rust: { size: 0.8, porosity: 0.4 },
  cloth_leather_red: { size: 1.0, tint: new Color3(0.55, 0.2, 0.15), porosity: 1 },
};

interface Template {
  meshes: Mesh[];
  /** Each render mesh's transform relative to the piece origin. */
  locals: Matrix[];
  colPositions: Float32Array | null;
  colIndices: Uint32Array | null;
  placed: number;
}

export interface Placement {
  piece: string;
  position: Vector3;
  /** Rotation about Y (radians). */
  yaw?: number;
  scale?: number;
}

/**
 * Modular environment pieces (tools/blender/*_kit.py): loads a kit's GLBs, swaps their `env:<set>`
 * materials for the game's tiled PBR surfaces (ash and wetness layers included), and places pieces
 * as thin instances - every placement of a piece mesh is one draw call together. The pieces'
 * collision proxies are transformed into one merged static mesh for physics and the navmesh.
 */
export class EnvKit {
  private templates = new Map<string, Template>();
  private materials = new Map<string, Material>();
  private colPos: number[] = [];
  private colIdx: number[] = [];
  readonly owned: { dispose(): void }[] = [];

  constructor(private scene: Scene, private assets: AssetManager, private mats: MaterialLibrary, private lighting: Lighting,
    private dir: string, private scope: string) {}

  private material(name: string): Material {
    let m = this.materials.get(name);
    if (m) return m;
    const key = name.replace(/^env:/, '');
    const [set] = key.split('#');
    const s = SETS[key] ?? SETS[set] ?? { size: 2 };
    const pm: PBRMaterial = this.mats.surface({ set, tile: 1 / s.size, tint: s.tint, roughness: s.roughness, normalStrength: s.normal, metallic: s.metallic }).clone(`env_${key}`);
    withLayers(pm, { porosity: s.porosity ?? 0.8, allowCover: true });
    m = pm;
    this.materials.set(name, m);
    this.owned.push(pm);
    return m;
  }

  /** Loads a piece (once). */
  async load(piece: string): Promise<Template> {
    let t = this.templates.get(piece);
    if (t) return t;
    const inst = await this.assets.instantiate(`${this.dir}/${piece}.glb`, `env:${piece}`, this.scope);
    inst.root.computeWorldMatrix(true);
    const meshes: Mesh[] = [];
    const locals: Matrix[] = [];
    let colPositions: Float32Array | null = null;
    let colIndices: Uint32Array | null = null;
    for (const m of inst.meshes as AbstractMesh[]) {
      if (!(m instanceof Mesh) || !m.getTotalVertices()) continue;
      m.computeWorldMatrix(true);
      const world = m.getWorldMatrix().clone();
      if (m.name.endsWith('_col')) {
        // bake the proxy into piece space once; placements transform it again
        const p = m.getVerticesData(VertexBuffer.PositionKind)!;
        const out = new Float32Array(p.length);
        const v = new Vector3();
        for (let i = 0; i < p.length; i += 3) {
          Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], world, v);
          out[i] = v.x;
          out[i + 1] = v.y;
          out[i + 2] = v.z;
        }
        colPositions = out;
        colIndices = Uint32Array.from(m.getIndices()!);
        m.setEnabled(false);
        continue;
      }
      m.setParent(null);
      m.position.setAll(0);
      m.rotationQuaternion = Quaternion.Identity();
      m.scaling.setAll(1);
      m.material = this.material(m.material?.name ?? 'env:ash_castle_slate');
      m.receiveShadows = true;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = false;
      meshes.push(m);
      locals.push(world);
    }
    t = { meshes, locals, colPositions, colIndices, placed: 0 };
    this.templates.set(piece, t);
    return t;
  }

  async place(p: Placement): Promise<void> {
    const t = await this.load(p.piece);
    const s = p.scale ?? 1;
    const placement = Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(p.yaw ?? 0, 0, 0), p.position);
    t.meshes.forEach((m, i) => {
      m.thinInstanceAdd(t.locals[i].multiply(placement), false);
    });
    t.placed++;
    if (t.colPositions && t.colIndices) {
      const base = this.colPos.length / 3;
      const v = new Vector3();
      const cp = t.colPositions;
      for (let i = 0; i < cp.length; i += 3) {
        Vector3.TransformCoordinatesFromFloatsToRef(cp[i], cp[i + 1], cp[i + 2], placement, v);
        this.colPos.push(v.x, v.y, v.z);
      }
      for (const i of t.colIndices) this.colIdx.push(base + i);
    }
  }

  async placeAll(list: Placement[]): Promise<void> {
    // load every piece first (in parallel), then place in order
    await Promise.all([...new Set(list.map((p) => p.piece))].map((n) => this.load(n)));
    for (const p of list) await this.place(p);
  }

  /**
   * Finalises instancing (bounds, shadows) and returns the merged collision mesh (invisible) for
   * physics and navigation.
   */
  finish(): Mesh | null {
    for (const [name, t] of this.templates) {
      for (const m of t.meshes) {
        if (t.placed === 0) {
          m.setEnabled(false);
          continue;
        }
        m.thinInstanceBufferUpdated('matrix');
        m.thinInstanceRefreshBoundingInfo(false);
        this.lighting.addStatic(m, true);
        this.owned.push(m);
      }
      if (t.placed === 0) log.info(`env piece ${name} loaded but never placed`);
    }
    if (!this.colIdx.length) return null;
    const col = new Mesh('envCollision', this.scene);
    const vd = new VertexData();
    vd.positions = this.colPos;
    vd.indices = this.colIdx;
    vd.applyToMesh(col, false);
    col.isVisible = false;
    col.isPickable = false;
    this.owned.push(col);
    this.colPos = [];
    this.colIdx = [];
    return col;
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
    this.templates.clear();
    this.materials.clear();
  }
}
