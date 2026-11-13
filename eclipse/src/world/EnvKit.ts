import {
  Color3, Matrix, Mesh, PBRMaterial, Quaternion, Vector3, VertexBuffer, VertexData, type AbstractMesh, type Material, type Scene,
} from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import type { MaterialLibrary } from '../render/Materials';
import type { Lighting } from '../render/Lighting';
import { withLayers } from '../render/materials/SurfaceLayers';
import { log } from '../core/Log';
import { ShadingPlugin } from '../render/materials/Shading';

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
  /** Self-lit (glowing fungus, runes): emissive colour, scaled by the albedo texture's light. */
  emissive?: Color3;
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
  'cloth_rust#verdigris': { size: 0.8, tint: new Color3(0.42, 0.68, 0.58), porosity: 0.4 },
  'sun_marble#sea': { size: 2.2, tint: new Color3(0.62, 0.68, 0.66), porosity: 0.6 },
  'ash_wood#wet': { size: 1.6, tint: new Color3(0.4, 0.38, 0.34), porosity: 1 },
  sea_sandstone_blocks: { size: 2.6, porosity: 0.8 },
  sea_seaworn_brick: { size: 2.2, porosity: 0.8 },
  sea_mossy_wall: { size: 2.6, porosity: 0.9 },
  sea_mossy_cobble: { size: 2.6, porosity: 0.9 },
  sea_pitted_rock: { size: 3.5, porosity: 0.7 },
  sea_coral_wall: { size: 1.2, porosity: 0.6 },
  cloth_leather_red: { size: 1.0, tint: new Color3(0.55, 0.2, 0.15), porosity: 1 },
  sky_old_stone: { size: 2.4, porosity: 0.7 },
  sky_monastery_floor: { size: 2.2, porosity: 0.6 },
  sky_slate_tiles: { size: 1.8, porosity: 0.5 },
  sky_planks: { size: 1.6, porosity: 0.9 },
  sky_cliff_side: { size: 6, porosity: 0.6 },
  sky_grass_rock: { size: 4, porosity: 0.9 },
  sky_snow: { size: 4, porosity: 0.3 },
  sun_marble: { size: 2, porosity: 0.4 },
  cloth_denim: { size: 0.6, tint: new Color3(0.35, 0.45, 0.75), porosity: 0.9 },
  wood_bark: { size: 2.0, porosity: 0.9 },
  wood_root_bark: { size: 1.6, porosity: 0.9 },
  wood_moss_wood: { size: 2.0, porosity: 0.95 },
  wood_mossy_brick: { size: 2.4, porosity: 0.85 },
  wood_mossy_plaster: { size: 2.4, porosity: 0.9 },
  wood_mossy_rock: { size: 3.5, porosity: 0.8 },
  wood_forest_ground: { size: 4, porosity: 1 },
  wood_leaves: { size: 1.6, porosity: 0.8, tint: new Color3(0.75, 0.85, 0.7) },
  'wood_leaves#blight': { size: 1.6, porosity: 0.8, tint: new Color3(0.65, 0.5, 0.42) },
  'sun_marble#glow': { size: 1.0, tint: new Color3(0.55, 0.95, 0.75), porosity: 0.3, emissive: new Color3(0.45, 1.4, 0.95) },
  'sun_marble#moss': { size: 2.2, tint: new Color3(0.55, 0.62, 0.5), porosity: 0.7 },
  'sun_marble#sunglow': { size: 1.2, tint: new Color3(1.0, 0.82, 0.45), porosity: 0.1, emissive: new Color3(2.6, 1.6, 0.6) },
  'gen_forged_steel#gold': { size: 0.9, tint: new Color3(1.0, 0.74, 0.34), porosity: 0.05, metallic: 1, roughness: 0.3 },
  sun_white_blocks: { size: 2.6, porosity: 0.5 },
  sun_castle_white: { size: 2.6, porosity: 0.5 },
  sun_marble_tiles: { size: 2.4, porosity: 0.3 },
  sun_granite: { size: 2.4, porosity: 0.4 },
  sun_marble_cliff: { size: 6, porosity: 0.5 },
  cloth_jacquard: { size: 0.6, tint: new Color3(0.9, 0.75, 0.35), porosity: 0.9 },
};

interface Template {
  meshes: Mesh[];
  /** Each render mesh's transform relative to the piece origin. */
  locals: Matrix[];
  colPositions: Float32Array | null;
  colIndices: Uint32Array | null;
  placed: number;
  /** Placement matrices, kept for pieces with a level of detail (their buffers are rebuilt). */
  placements: Matrix[];
  /** Beyond `dist` from the camera, instances switch to `low` (or are culled when it is null). */
  lod: { low: string | null; dist: number } | null;
  /** This template is some other piece's distant version. */
  isLow: boolean;
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
  private lods = new Map<string, { low: string | null; dist: number }>();
  private lodFrom = new Vector3(1e9, 0, 0);

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
    const sh = ShadingPlugin.of(pm);
    if (sh) sh.macro = s.metallic ? 0.35 : 1;
    if (s.emissive) {
      pm.emissiveColor = s.emissive;
      pm.emissiveTexture = pm.albedoTexture;
    }
    m = pm;
    this.materials.set(name, m);
    this.owned.push(pm);
    return m;
  }

  /**
   * Gives a piece a level of detail: past `dist` metres from the camera its instances draw as `low`
   * (a lighter model), or not at all when `low` is null (ground cover). Call before placing.
   */
  setLod(piece: string, low: string | null, dist: number): void {
    this.lods.set(piece, { low, dist });
  }

  /** Re-sorts LOD'd instances into near and far sets when the camera has moved far enough. */
  updateLods(cam: Vector3): void {
    if (Vector3.DistanceSquared(cam, this.lodFrom) < 9) return;
    this.lodFrom.copyFrom(cam);
    for (const t of this.templates.values()) {
      if (!t.lod || !t.placed) continue;
      const near: Matrix[] = [];
      const far: Matrix[] = [];
      const d2 = t.lod.dist * t.lod.dist;
      const p = new Vector3();
      for (const m of t.placements) {
        m.getTranslationToRef(p);
        (Vector3.DistanceSquared(p, cam) < d2 ? near : far).push(m);
      }
      this.fill(t, near);
      const low = t.lod.low ? this.templates.get(t.lod.low) : null;
      if (low) this.fill(low, far);
    }
  }

  private fill(t: Template, list: Matrix[]): void {
    t.meshes.forEach((m, i) => {
      if (!list.length) {
        m.setEnabled(false);
        return;
      }
      const arr = new Float32Array(list.length * 16);
      list.forEach((pm, k) => t.locals[i].multiply(pm).copyToArray(arr, k * 16));
      m.thinInstanceSetBuffer('matrix', arr, 16, false);
      m.thinInstanceRefreshBoundingInfo(false);
      m.setEnabled(true);
    });
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
      const own = m.material?.name ?? '';
      if (own.startsWith('ph:') && m.material) {
        // a downloaded photoscan keeps its own textures (alpha-tested and two-sided as authored);
        // it still takes the weather (wetness, ash or snow cover)
        if (!this.materials.has(own)) {
          withLayers(m.material, { porosity: 0.9, allowCover: true });
          // Foliage cards arrive alpha-BLENDED (the Blender round trip turns the scan's cutout into a blend).
          // Blended leaves write no depth (so fog, AO and contact shadows cannot see them), sort badly
          // against each other and cost fill rate; as cutouts they look the same and do all of that
          // properly, and cast cutout shadows. They also let the sun through from behind.
          const pbr = m.material as PBRMaterial;
          if (pbr.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHABLEND && pbr.albedoTexture?.hasAlpha) {
            pbr.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
            pbr.alphaCutOff = 0.42;
            pbr.useAlphaFromAlbedoTexture = true;
          }
          const sh = ShadingPlugin.of(m.material);
          if (sh && pbr.transparencyMode === PBRMaterial.PBRMATERIAL_ALPHATEST) sh.leaf = 0.4;
          this.materials.set(own, m.material);
        }
        m.material = this.materials.get(own)!;
      } else {
        m.material = this.material(own || 'env:ash_castle_slate');
      }
      // the baked AO travels in an RGBA colour attribute: its alpha is not opacity. Left set, the
      // piece would be drawn as alpha-blended (no depth write, so fog, AO and SSR would see through it)
      m.hasVertexAlpha = false;
      m.receiveShadows = true;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = false;
      meshes.push(m);
      locals.push(world);
    }
    const lod = this.lods.get(piece) ?? null;
    t = { meshes, locals, colPositions, colIndices, placed: 0, placements: [], lod, isLow: false };
    if (lod?.low) {
      this.templates.set(piece, t);
      const low = await this.load(lod.low);
      low.isLow = true;
    }
    this.templates.set(piece, t);
    return t;
  }

  async place(p: Placement): Promise<void> {
    const t = await this.load(p.piece);
    const s = p.scale ?? 1;
    const placement = Matrix.Compose(new Vector3(s, s, s), Quaternion.RotationYawPitchRoll(p.yaw ?? 0, 0, 0), p.position);
    if (t.lod) {
      t.placements.push(placement);
    } else {
      t.meshes.forEach((m, i) => {
        m.thinInstanceAdd(t.locals[i].multiply(placement), false);
      });
    }
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
      if (t.lod || t.isLow) {
        // buffers are filled by updateLods; still register for shadows and disposal
        for (const m of t.meshes) {
          const r = m.getBoundingInfo().boundingSphere.radius;
          this.lighting.addStatic(m, (r > 1.2 || !name.startsWith('ph_')) && !t.isLow);
          this.owned.push(m);
          m.setEnabled(false);
        }
        continue;
      }
      for (const m of t.meshes) {
        if (t.placed === 0) {
          m.setEnabled(false);
          continue;
        }
        // small ground cover (ferns, moss, weeds) receives shadows but does not cast them
        const r = m.getBoundingInfo().boundingSphere.radius;
        m.thinInstanceBufferUpdated('matrix');
        m.thinInstanceRefreshBoundingInfo(false);
        this.lighting.addStatic(m, r > 1.2 || !name.startsWith('ph_'));
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
