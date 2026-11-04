// Shared level helpers: heightfield terrain, prop placement, atmosphere presets.
import * as THREE from 'three';
import type { Game } from '../game/Game';
import { terrainMaterial, type TerrainLayer } from '../render/Terrain';
import { loadGLTF, loadGLTFShared } from '../core/Assets';
import type { FXOptions } from '../render/MaterialFX';
import { setupEnvMaterial, tilingSet } from '../game/Materials';
import { texLoader } from '../core/Assets';
import type { GradeSettings } from '../render/Effects';

export interface TerrainSpec {
  size: number;
  seg: number;
  height: (x: number, z: number) => number;
  splat: (x: number, z: number, h: number, slope: number) => [number, number, number, number];
  layers: TerrainLayer[];
  center?: THREE.Vector2;
  fx?: FXOptions;
  /** add to the collision world (default true); off for distant scenery rings */
  collide?: boolean;
  /** parallax steps override (0 for far terrain) */
  pom?: number;
}

export function buildTerrain(game: Game, s: TerrainSpec): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(s.size, s.size, s.seg, s.seg);
  geo.rotateX(-Math.PI / 2);
  if (s.center) geo.translate(s.center.x, 0, s.center.y);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, s.height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const w = s.splat(pos.getX(i), pos.getZ(i), pos.getY(i), 1 - nrm.getY(i));
    splat.set(w, i * 4);
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  const q = game.pipe.quality.name;
  const mat = terrainMaterial(s.layers, s.fx ?? {}, game.pipe.lighting.setupMaterial(new THREE.MeshStandardMaterial()), s.pom ?? (q === 'ultra' ? 16 : q === 'high' ? 10 : 0));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  game.levelRoot.add(mesh);
  if (s.collide !== false) game.world.add(mesh);
  return mesh;
}

let grassGeo: THREE.BufferGeometry | null = null;
/** one grass clump: three crossed cards, normals pointing up so the clump shades like a soft tuft */
function grassClump(): THREE.BufferGeometry {
  if (grassGeo) return grassGeo;
  const pos: number[] = [], uv: number[] = [], nrm: number[] = [], idx: number[] = [];
  const W = 0.55, H = 0.5;
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const cx = Math.cos(a) * W * 0.5, cz = Math.sin(a) * W * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, H, cz, -cx, H, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    for (let i = 0; i < 4; i++) nrm.push(0, 1, 0);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  grassGeo = g;
  return g;
}

/**
 * instanced grass tufts (bucketed into cells for culling): wind-blown, translucent, pushed aside by the
 * player; `tint` per level (autumn gold, rain green, frost)
 */
export function grass(game: Game, points: Xform[], o: { tint?: THREE.Color; cell?: number } = {}): THREE.Group {
  const group = new THREE.Group();
  const keep = points.filter((_, i) => (i * 0.618034) % 1 < game.pipe.quality.grassDensity);
  const m = new THREE.MeshStandardMaterial({ color: o.tint ?? new THREE.Color(0.95, 0.85, 0.6), roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  m.name = 'grass';
  m.userData.leaf = 'grass';
  const r = setupEnvMaterial(m, game.pipe.quality.msaa > 0, {}, { height: 0.5 });
  const fx = { ...r.fx, wind: { mode: 'grass' as const, height: 0.5, amount: 1 } };
  (r.mat as THREE.MeshStandardMaterial).color.copy(o.tint ?? new THREE.Color(0.95, 0.85, 0.6));
  game.pipe.patch(r.mat, fx);
  const cell = o.cell ?? 24;
  const buckets = new Map<string, Xform[]>();
  for (const t of keep) {
    const k = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(t);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const geo = grassClump();
  for (const list of buckets.values()) {
    const inst = new THREE.InstancedMesh(geo, r.mat, list.length);
    list.forEach((t, i) => {
      m4.compose(p.set(t.x, t.y ?? game.world.ground(t.x, 200, t.z) ?? 0, t.z), q.setFromEuler(e.set(0, t.rot, 0)), sc.set(t.scale, t.scale * (0.8 + ((i * 0.37) % 0.5)), t.scale));
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    inst.castShadow = false;
    inst.receiveShadow = true;
    group.add(inst);
  }
  game.levelRoot.add(group);
  return group;
}

export interface PlaceOpts { rot?: number; scale?: number | THREE.Vector3; fx?: FXOptions; collide?: boolean; ground?: boolean; y?: number; noShadow?: boolean; tilt?: THREE.Euler; tree?: boolean }

/** set up every material under an environment object (tiling sets, foliage, wind) and patch it */
export function prepareEnv(game: Game, root: THREE.Object3D, base: FXOptions = {}, tree?: { height: number }, shadow = true): void {
  const msaa = game.pipe.quality.msaa > 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((m) => {
      const r = setupEnvMaterial(m, msaa, base, tree);
      game.pipe.patch(r.mat, r.fx);
      if (r.depth) mesh.customDepthMaterial = r.depth;
      return r.mat;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
    mesh.castShadow = shadow && !mesh.userData.noShadow;
    mesh.receiveShadow = true;
  });
}

function heightOf(root: THREE.Object3D): number {
  const b = new THREE.Box3().setFromObject(root);
  return Math.max(1, b.max.y);
}

/** place a GLB (cloned) */
export async function place(game: Game, url: string, x: number, z: number, o: PlaceOpts = {}): Promise<THREE.Group> {
  const g = (await loadGLTF(url)).scene;
  const gy = o.y ?? (o.ground === false ? 0 : game.world.ground(x, 200, z) ?? 0);
  g.position.set(x, gy, z);
  g.rotation.y = o.rot ?? 0;
  if (o.tilt) { g.rotation.x = o.tilt.x; g.rotation.z = o.tilt.z; }
  if (o.scale !== undefined) typeof o.scale === 'number' ? g.scale.setScalar(o.scale) : g.scale.copy(o.scale);
  prepareEnv(game, g, o.fx ?? game.envFx, o.tree ? { height: heightOf(g) / g.scale.y } : undefined, !o.noShadow);
  game.levelRoot.add(g);
  if (o.collide !== false) game.world.add(g);
  return g;
}

export interface Xform { x: number; z: number; rot: number; scale: number; y?: number }

/**
 * many copies of one GLB as instanced meshes (trees, rocks, grass), bucketed into spatial cells so
 * frustum culling skips whole off-screen clumps
 */
export async function scatter(game: Game, url: string, transforms: Xform[], o: { fx?: FXOptions; collide?: boolean; shadow?: boolean; tree?: boolean; cell?: number; trunk?: number } = {}): Promise<THREE.Group> {
  const src = await loadGLTFShared(url);
  const group = new THREE.Group();
  if (!transforms.length) return group;
  const meshes: THREE.Mesh[] = [];
  src.scene.updateMatrixWorld(true);
  src.scene.traverse((c) => { if ((c as THREE.Mesh).isMesh) meshes.push(c as THREE.Mesh); });
  prepareEnv(game, src.scene, o.fx ?? game.envFx, o.tree ? { height: heightOf(src.scene) } : undefined, o.shadow !== false);
  const cell = o.cell ?? 40;
  const buckets = new Map<string, Xform[]>();
  for (const t of transforms) {
    const k = `${Math.floor(t.x / cell)},${Math.floor(t.z / cell)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(t);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3();
  for (const list of buckets.values()) {
    for (const mesh of meshes) {
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      list.forEach((t, i) => {
        const y = t.y ?? game.world.ground(t.x, 200, t.z) ?? 0;
        m4.compose(pos.set(t.x, y, t.z), q.setFromEuler(e.set(0, t.rot, 0)), scl.setScalar(t.scale));
        inst.setMatrixAt(i, m4.multiply(mesh.matrixWorld));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.castShadow = mesh.castShadow;
      inst.receiveShadow = true;
      if (mesh.customDepthMaterial) inst.customDepthMaterial = mesh.customDepthMaterial;
      group.add(inst);
    }
  }
  game.levelRoot.add(group);
  if (o.collide) game.world.add(group);
  if (o.trunk) {
    // trees collide as their trunks only (leaves and branches are walk-through)
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(o.trunk, o.trunk * 1.2, 4, 8));
    for (const t of transforms) {
      cyl.position.set(t.x, (t.y ?? game.world.ground(t.x, 200, t.z) ?? 0) + 1.6, t.z);
      cyl.scale.setScalar(t.scale);
      cyl.updateMatrixWorld(true);
      game.world.add(cyl);
    }
  }
  return group;
}

export interface Atmosphere {
  sun: THREE.Vector3;
  sunPower?: number;
  night?: boolean;
  lightIntensity: number;
  mie?: number;
  rayleigh?: number;
  ozone?: number;
  tint?: THREE.Color;
  zenith?: THREE.Color;
  clouds?: number;
  cloudDensity?: number;
  cloudTint?: THREE.Color;
  stars?: number;
  skyGain?: number;
  env?: number;
  fog: Partial<{ density: number; falloff: number; baseHeight: number; farDensity: number; anisotropy: number; noise: number; tint: THREE.Color; sunScatter: number; skyFog: number; maxDist: number }>;
  grade: Partial<GradeSettings>;
  bloom?: number;
}

export function applyAtmosphere(game: Game, a: Atmosphere): void {
  const p = game.pipe;
  const s = p.sky.settings;
  s.lightDir.copy(a.sun).normalize();
  s.lightPower = a.sunPower ?? (a.night ? 0.9 : 22);
  s.night = !!a.night;
  s.mie = a.mie ?? 1;
  s.rayleigh = a.rayleigh ?? 1;
  s.ozone = a.ozone ?? 1;
  s.tint.copy(a.tint ?? new THREE.Color(1, 1, 1));
  s.zenithTint.copy(a.zenith ?? new THREE.Color(1, 1, 1));
  s.cloudCover = a.clouds ?? 0.4;
  s.cloudDensity = a.cloudDensity ?? 0.8;
  s.cloudTint.copy(a.cloudTint ?? new THREE.Color(1, 1, 1));
  s.stars = a.stars ?? 0;
  s.skyGain = a.skyGain ?? 1;
  p.sky.invalidate();
  p.setSun(a.sun, a.lightIntensity);
  p.scene.environmentIntensity = a.env ?? 1;
  Object.assign(p.fog.settings, a.fog);
  if (a.fog.tint) p.fog.settings.tint = a.fog.tint.clone();
  const g = p.grade.settings;
  Object.assign(g, a.grade);
  p.bloom.intensity = a.bloom ?? 0.55;
}

export function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** smooth value noise for terrain */
export function noise2(x: number, z: number, seed = 0): number {
  const h = (i: number, j: number) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}

export function fbm(x: number, z: number, oct = 4, seed = 0): number {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, z * f, seed + i); a *= 0.5; f *= 2.03; }
  return s;
}

/** world size of each impostor sprite (the ortho frame it was rendered with, tools/blender/trees.py --impostors) */
const IMPOSTOR_SIZE: Record<string, number> = { pine: 7.15, cedar: 15.69, maple: 6.77, bamboo: 10.91, dead: 7.04 };

/**
 * distant trees as impostors: one camera-facing card per tree (cylindrical billboard in the vertex
 * shader), alpha-tested sprite rendered from the real model; thousands in one draw call
 */
export function impostors(game: Game, kind: string, points: Xform[], o: { tint?: THREE.Color } = {}): THREE.InstancedMesh {
  const tex = texLoader.load(`assets/tex/impostor_${kind}.png`);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, color: o.tint ?? new THREE.Color(1, 1, 1) });
  m.alphaToCoverage = game.pipe.quality.msaa > 0;
  m.name = 'impostor';
  const hook = game.pipe.lighting.setupMaterial(m);
  m.onBeforeCompile = (sh) => {
    hook(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', `
vec3 imCamR = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
vec3 imCamB = normalize(vec3(viewMatrix[0][2], 0.0, viewMatrix[2][2]));
// a soft, mostly-up normal tilted toward the viewer: the sprite shades like a rounded crown
vec3 objectNormal = normalize(imCamB * 0.55 + vec3(0.0, 0.85, 0.0));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = imCamR * position.x + vec3(0.0, position.y, 0.0);');
  };
  m.customProgramCacheKey = () => 'impostor';
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(geo, m, points.length);
  const size = IMPOSTOR_SIZE[kind] ?? 8;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  points.forEach((t, i) => {
    // sprites are bottom-anchored at the trunk base; sink slightly so slopes never show a gap
    m4.compose(p.set(t.x, (t.y ?? 0) - 0.3, t.z), q, sc.setScalar(size * t.scale));
    inst.setMatrixAt(i, m4);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.castShadow = false;
  inst.receiveShadow = true;
  inst.frustumCulled = false;
  game.levelRoot.add(inst);
  return inst;
}

/** a flat paved area (courtyards, plazas) using a shared tiling set */
export function paving(game: Game, x0: number, z0: number, x1: number, z1: number, y: number, tex: string, tile = 2.5, tint?: THREE.Color): THREE.Mesh {
  const w = x1 - x0, d = z1 - z0;
  const geo = new THREE.BoxGeometry(w, 0.3, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ny = Math.abs(nrm.getY(i)), nx = Math.abs(nrm.getX(i));
    const u = ny > 0.5 ? pos.getX(i) : nx > 0.5 ? pos.getZ(i) : pos.getX(i);
    const v = ny > 0.5 ? pos.getZ(i) : pos.getY(i);
    uv.setXY(i, u / tile, v / tile);
  }
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  m.userData = { tex, tint: tint ? [tint.r, tint.g, tint.b] : [1, 1, 1], scale: 1 };
  const r = setupEnvMaterial(m, game.pipe.quality.msaa > 0, game.envFx);
  game.pipe.patch(r.mat, r.fx);
  void tilingSet;
  const mesh = new THREE.Mesh(geo, r.mat);
  mesh.position.set((x0 + x1) / 2, y - 0.15, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  game.levelRoot.add(mesh);
  game.world.add(mesh);
  return mesh;
}
