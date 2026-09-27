import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { REFLECT_LAYER } from '../rendering/FloorReflection';
import type { QualityProfile } from '../config/quality';
import type { GradeSettings } from '../rendering/PostEffects';
import { Crowd } from './Crowd';
import { Scoreboard } from './ArenaKit';
import type { Obstacle } from '../game/Court';

export interface ArenaLook {
  background: THREE.Color | THREE.Texture | null;
  fog: THREE.Fog | THREE.FogExp2 | null;
  grade: Partial<GradeSettings>;
  bloom: number;
  envIntensity: number;
  /** where to bake the environment probe from */
  probe: THREE.Vector3;
  /** anamorphic lens streaks from bright lights */
  lens?: { strength: number; tint?: THREE.Color };
  /** screen-space ambient occlusion */
  ao?: { strength: number; radius?: number };
}

export interface ArenaInfo {
  id: string;
  name: string;
  location: string;
  tagline: string;
  /** home/away short names for scoreboards */
  court: { halfWidth: number; halfLength: number };
}

/**
 * A built arena: meshes, lights, look (fog/grade/bloom), camera constraints and
 * animated elements (crowd, scoreboard, lights, props).
 */
export class Arena {
  readonly root = new THREE.Group();
  crowd: Crowd | null = null;
  scoreboards: Scoreboard[] = [];
  updaters: ((dt: number, t: number) => void)[] = [];
  /** Called on big plays: 0..1 intensity. */
  hypeHandlers: ((amount: number) => void)[] = [];
  keyLight: THREE.DirectionalLight | null = null;
  cameraBounds = new THREE.Box3(new THREE.Vector3(-14, 0.3, -18), new THREE.Vector3(14, 10, 18));
  blockers: THREE.Box3[] = [];
  /** In-court cover that blocks balls and athletes. */
  obstacles: Obstacle[] = [];
  /** Named points for cinematics (tunnel exits, spotlight marks...). */
  marks: Record<string, THREE.Vector3> = {};
  look: ArenaLook;
  envTexture: THREE.Texture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  /** true when the court floor wants planar reflections */
  reflective = false;
  /** Materials that expose a uTime uniform. */
  timeUniforms: { value: number }[] = [];
  /** Baked global illumination volume, once loaded (see LightBake). */
  bakedGI: THREE.Object3D | null = null;
  disposed = false;

  constructor(public info: ArenaInfo, public quality: QualityProfile) {
    this.look = {
      background: new THREE.Color(0x101216),
      fog: null,
      grade: {},
      bloom: 0.85,
      envIntensity: 1,
      probe: new THREE.Vector3(0, 2.5, 0),
    };
  }

  hype(amount: number) {
    this.crowd?.cheer(amount);
    for (const h of this.hypeHandlers) h(amount);
  }

  setScore(home: number, away: number, clock: string, round: number) {
    for (const s of this.scoreboards) s.set(home, away, clock, round);
  }

  update(dt: number, t: number) {
    this.crowd?.update(dt, t);
    for (const u of this.timeUniforms) u.value = t;
    for (const f of this.updaters) f(dt, t);
  }

  /**
   * Choose what the floor mirrors: lights (so the mirrored render is lit), emissive fixtures
   * and solid objects around the court (boards, benches, cover). Must run before batching.
   */
  prepareReflections() {
    const { halfWidth: hw, halfLength: hl } = this.info.court;
    const box = new THREE.Box3();
    let strength = 0;
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => {
      if ((o as THREE.Light).isLight) {
        o.layers.enable(REFLECT_LAYER);
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const fu = mats.map((x) => (x as any).floorUniforms).find(Boolean);
      if (fu) {
        strength = Math.max(strength, fu.uReflStrength.value);
        return;
      }
      if (mats.some((x) => x.transparent)) return;
      let hot = false;
      for (const mat of mats) {
        const sm = mat as THREE.MeshStandardMaterial;
        if (sm.isMeshStandardMaterial && (sm.emissive.r + sm.emissive.g + sm.emissive.b) * sm.emissiveIntensity > 1.2) hot = true;
        const bm = mat as THREE.MeshBasicMaterial;
        if (bm.isMeshBasicMaterial && bm.color.r + bm.color.g + bm.color.b > 1.8) hot = true;
      }
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      const flat = box.max.y < 0.12;
      const near = !flat && box.min.y < 2.4 && box.max.x > -hw - 3 && box.min.x < hw + 3 && box.max.z > -hl - 3 && box.min.z < hl + 3 && box.max.x - box.min.x < 70;
      // high ceiling lamps stay out: near the camera they would mirror as milky blobs
      if ((hot && box.min.y < 5) || near) m.layers.enable(REFLECT_LAYER);
    });
    this.reflective = strength > 0;
  }

  /**
   * Static batching: merge non-animated opaque meshes that share a material into one draw call
   * per material and spatial cell. Animated objects are discovered by ticking the updaters and
   * diffing world transforms/visibility, so arena code needs no manual annotations.
   * Returns [meshes before, meshes after].
   */
  batchStatic(cell = 40): [number, number] {
    const root = this.root;
    root.updateMatrixWorld(true);
    const materials = new Set<THREE.Material>();
    root.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) materials.add(m);
    });
    const snap = new Map<THREE.Object3D, { m: THREE.Matrix4; v: boolean }>();
    root.traverse((o) => snap.set(o, { m: o.matrixWorld.clone(), v: o.visible }));
    const matSnap = new Map<THREE.Material, string>();
    for (const m of materials) matSnap.set(m, materialSignature(m));
    // probe: fire the hype handlers and tick the updaters to see what they touch
    for (const h of this.hypeHandlers) h(1);
    for (const [dt, t] of [[0.37, 1.7], [0.21, 4.3], [0.5, 9.1]]) for (const f of this.updaters) f(dt, t);
    root.updateMatrixWorld(true);
    const moving = new Set<THREE.Object3D>();
    root.traverse((o) => {
      const s = snap.get(o);
      if (!s || o.userData.dynamic || s.v !== o.visible || !s.m.equals(o.matrixWorld)) moving.add(o);
    });
    const plainCompile = THREE.Material.prototype.onBeforeCompile;
    const mergeable = (mat: THREE.Material) =>
      !mat.transparent &&
      mat.onBeforeCompile === plainCompile &&
      (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial || mat instanceof THREE.MeshLambertMaterial) &&
      materialSignature(mat) === matSnap.get(mat);
    // de-duplicate identical static materials so their meshes can share draw calls
    const canon = new Map<string, THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material) || !mergeable(m.material)) return;
      const sig = matSnap.get(m.material)!;
      const c = canon.get(sig);
      if (!c) canon.set(sig, m.material);
      else if (c !== m.material) m.material = c;
    });
    const isDynamic = (o: THREE.Object3D | null): boolean => {
      for (let p = o; p && p !== root; p = p.parent) if (moving.has(p) || !p.visible) return true;
      return false;
    };
    const plainRender = THREE.Object3D.prototype.onBeforeRender;
    const groups = new Map<string, THREE.Mesh[]>();
    let before = 0;
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const center = new THREE.Vector3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      before++;
      if (m.constructor !== THREE.Mesh || m.children.length || Array.isArray(m.material) || !m.frustumCulled) return;
      const mat = m.material as THREE.Material;
      if (!mergeable(mat) || m.onBeforeRender !== plainRender) return;
      if (m.matrixWorld.determinant() < 0 || m.geometry.morphAttributes.position || isDynamic(m)) return;
      const g = m.geometry;
      const sig = Object.keys(g.attributes).sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(',') + (g.index ? 'i' : 'n');
      if (!g.boundingBox) g.computeBoundingBox();
      g.boundingBox!.getCenter(center).applyMatrix4(m.matrixWorld);
      const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}|${m.renderOrder}|${m.layers.mask}|${sig}|${Math.floor(center.x / cell)},${Math.floor(center.z / cell)}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(m);
    });
    let removed = 0;
    const rel = new THREE.Matrix4();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        rel.multiplyMatrices(inv, m.matrixWorld);
        return m.geometry.clone().applyMatrix4(rel);
      });
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const src = list[0];
      const batch = new THREE.Mesh(merged, src.material);
      batch.name = 'batch';
      batch.castShadow = src.castShadow;
      batch.receiveShadow = src.receiveShadow;
      batch.renderOrder = src.renderOrder;
      batch.layers.mask = src.layers.mask;
      root.add(batch);
      for (const m of list) m.removeFromParent();
      removed += list.length - 1;
    }
    return [before, before - removed];
  }

  /** Render the arena into a PMREM so reflections match its lighting. */
  bakeEnvironment(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tmp = new THREE.Scene();
    tmp.background = this.look.background instanceof THREE.Color ? this.look.background : new THREE.Color(0x202020);
    const parent = this.root.parent;
    tmp.add(this.root);
    // add a soft fill so the probe isn't pitch black in unlit areas
    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    tmp.add(amb);
    const rt = pmrem.fromScene(tmp, 0.035, 0.1, 200, { position: this.look.probe, size: 256 } as any);
    tmp.remove(amb);
    if (parent) parent.add(this.root);
    else tmp.remove(this.root);
    pmrem.dispose();
    this.envTarget?.dispose();
    this.envTarget = rt;
    this.envTexture = rt.texture;
    return rt.texture;
  }

  dispose() {
    this.disposed = true;
    this.root.traverse((o) => {
      // the baked GI texture is cached per arena and reused on the next visit
      if (o === this.bakedGI) return;
      if ((o as THREE.Light).isLight) (o as THREE.Light).dispose();
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const mm of mats) {
        for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
        for (const uniforms of [(mm as THREE.ShaderMaterial).uniforms, (mm as any).floorUniforms]) {
          if (uniforms) for (const u of Object.values(uniforms) as { value: unknown }[]) if (u && u.value instanceof THREE.Texture) u.value.dispose();
        }
        mm.dispose();
      }
    });
    if (this.look.background instanceof THREE.Texture) this.look.background.dispose();
    this.envTarget?.dispose();
    this.envTarget = null;
  }
}

/** Everything that affects how a material renders (used to find duplicates and runtime mutations). */
function materialSignature(m: THREE.Material): string {
  const a = m as any;
  const tex = (t: THREE.Texture | null | undefined) => (t ? t.uuid : '');
  const col = (c: THREE.Color | undefined) => (c ? c.getHexString() : '');
  return [
    m.type, col(a.color), col(a.emissive), a.emissiveIntensity, a.roughness, a.metalness, a.envMapIntensity,
    tex(a.map), tex(a.normalMap), tex(a.roughnessMap), tex(a.metalnessMap), tex(a.emissiveMap), tex(a.aoMap), tex(a.alphaMap), tex(a.envMap), tex(a.lightMap), tex(a.bumpMap),
    a.normalScale ? `${a.normalScale.x},${a.normalScale.y}` : '', m.side, a.flatShading, m.vertexColors, m.transparent, m.opacity, m.depthWrite, m.depthTest,
    m.blending, a.fog, m.toneMapped, a.wireframe, m.alphaTest, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.visible, m.colorWrite,
  ].join('|');
}
