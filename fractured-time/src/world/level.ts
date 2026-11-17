import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { loadGLTF } from '@/assets/loader';
import { resources, levelMaterial, finishStatic } from '@/graphics';
import { loadLightmap } from '@/graphics/lighting/lightmaps';
import type { Physics } from '@/physics/physics';
import type { LightDef } from '@/graphics/lighting/lightPool';

const T = TSL as any;

/**
 * A baked level section (blender/environments/*.py): one static mesh per section with its photoscanned materials rebuilt from their
 * recipes, the Cycles lightmap (diffuse direct + indirect, on UV1) multiplied into the albedo, a reflection probe captured from the
 * level itself for glossy surfaces, collision boxes for Rapier and gameplay markers.
 * Static surfaces take no real-time lights (everything they receive is baked); characters and effects are lit by the level's
 * real-time light rig + the probe.
 */
export interface Marker { name: string; pos: THREE.Vector3; yaw: number; data: Record<string, unknown> }
export interface LoadedLevel { root: THREE.Group; markers: Marker[]; staticMeshes: THREE.Mesh[]; dynamic: THREE.Object3D[]; lightDefs: LightDef[];
  lightmaps: THREE.Texture[];
  /** shared structure baked once per reality: lightmaps to swap on a Timeline Shift */
  lmSwap: { m: THREE.Material; a: THREE.Texture; b: THREE.Texture }[];
  /** the section's specular-only lights on its static surfaces, with the reality each belongs to */
  ownLights: { light: THREE.Light; timeline?: 'a' | 'b'; intensity: number }[];
  /** Timeline Shift: objects and colliders that exist only in timeline 'a' or 'b' (Chapter 3's arcology) */
  timeline: { a: { meshes: THREE.Object3D[]; colliders: unknown[] }; b: { meshes: THREE.Object3D[]; colliders: unknown[] } } }

export async function loadLevel(path: string, physics: Physics | null, scene: THREE.Scene | null, _unused: THREE.Light[] = []): Promise<LoadedLevel> {
  const g = await loadGLTF(path);
  const root = g.scene.clone(true) as THREE.Group;
  const markers: Marker[] = [];
  const staticMeshes: THREE.Mesh[] = [];
  const dynamic: THREE.Object3D[] = [];
  const lmLoads: Promise<void>[] = [];
  const timeline: LoadedLevel['timeline'] = { a: { meshes: [], colliders: [] }, b: { meshes: [], colliders: [] } };
  // this section's fixtures as real-time lights for the SPECULAR of its baked surfaces (kept out of the scene graph: characters use
  // the light pool instead), plus their definitions for the pool
  root.updateMatrixWorld(true);
  const lightMarkers: Marker[] = [];
  root.traverse((o) => { if (o.userData?.marker === 'light') lightMarkers.push({ name: 'light', pos: o.getWorldPosition(new THREE.Vector3()), yaw: 0, data: o.userData }); });
  const lightDefs = toLightDefs(lightMarkers);
  const ownLights = lightDefs.map((d) => {
    let l: THREE.Light;
    if (d.kind === 'area') {
      const ra = new THREE.RectAreaLight(d.color, d.intensity, d.size[0], d.size[1]);
      ra.position.copy(d.pos);
      ra.lookAt(d.pos.x, d.pos.y - 1, d.pos.z);
      l = ra;
    } else {
      l = new THREE.PointLight(d.color, d.intensity, 8, 2);
      l.position.copy(d.pos);
    }
    l.updateMatrixWorld(true);
    return l;
  });
  const rtLights = (T.lights as (l: THREE.Light[]) => unknown)(ownLights);
  const ownTagged = ownLights.map((light, i) => ({ light, timeline: lightDefs[i].timeline, intensity: light.intensity }));
  const lmSwap: LoadedLevel['lmSwap'] = [];
  const lightmaps: THREE.Texture[] = [];
  root.updateMatrixWorld(true);
  // outdoor sections (a sky marker) carry the rain layer on their static surfaces
  let outdoors = false;
  root.traverse((o) => { if (o.userData?.marker === 'sky') outdoors = true; });
  // one lightmap per section: multi-material meshes arrive as a group of primitives with the node extras on the group
  const lmCache = new Map<string, Promise<THREE.Texture>>();
  root.traverse((o) => {
    const ud = { ...((o as THREE.Mesh).isMesh ? (o.parent?.userData ?? {}) : {}), ...(o.userData ?? {}) };
    if (ud.marker) {
      markers.push({ name: String(ud.marker), pos: o.getWorldPosition(new THREE.Vector3()), yaw: Number(ud.yaw ?? 0), data: ud });
      return;
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (ud.collision) {
      mesh.visible = false;
      if (physics) {
        const col = physics.addTrimesh(mesh.geometry, mesh.matrixWorld);
        const tl = ud.timeline as 'a' | 'b' | undefined;
        if (tl === 'a' || tl === 'b') timeline[tl].colliders.push(col);
      }
      return;
    }
    const isDynamic = !!ud.dynamic;
    if (isDynamic) {
      // moving props (door leaves): not baked; lit by the real-time lights + probe like characters
      const holder = (o.parent && o.parent.userData?.dynamic) ? o.parent : o;
      if (!dynamic.includes(holder)) dynamic.push(holder);
    } else staticMeshes.push(mesh);
    const tlm = ud.timeline as 'a' | 'b' | undefined;
    if (tlm === 'a' || tlm === 'b') timeline[tlm].meshes.push(mesh);
    mesh.receiveShadow = true;
    mesh.castShadow = isDynamic;
    if (!mesh.geometry.getAttribute('uv')) boxUV(mesh.geometry);
    let lightMap: THREE.Texture | null = null;
    if (ud.lightmap) {
      const key = String(ud.lightmap);
      if (!lmCache.has(key)) {
        lmCache.set(key, loadLightmap(key).then((t) => {
          t.channel = 1;
          t.flipY = false;
          t.colorSpace = THREE.LinearSRGBColorSpace;
          t.minFilter = THREE.LinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.generateMipmaps = false;
          lightmaps.push(t);
          return t;
        }));
      }
      lmLoads.push(lmCache.get(key)!.then((t) => { lightMap = t; for (const m of mats) apply(m); }));
      if (ud.lightmap_b) {
        // the shared structure's lightmap in the other reality
        const kb = String(ud.lightmap_b);
        if (!lmCache.has(kb)) {
          lmCache.set(kb, loadLightmap(kb).then((t) => {
            t.channel = 1; t.flipY = false; t.colorSpace = THREE.LinearSRGBColorSpace;
            t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
            lightmaps.push(t);
            return t;
          }));
        }
        lmLoads.push(Promise.all([lmCache.get(key)!, lmCache.get(kb)!]).then(([a, b]) => {
          for (const m of mats) if ((m as any).lightMap) lmSwap.push({ m, a, b });
        }));
      }
    }
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mats = src.map((old) => levelMaterial(old));
    const apply = (m: THREE.Material) => {
      if (isDynamic) return;
      finishStatic(m, { lightMap, lights: rtLights, outdoors });
    };
    for (const m of mats) apply(m);
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  await Promise.all(lmLoads);
  await resources.ready();
  if (scene) scene.add(root);
  return { root, markers, staticMeshes, dynamic, lightDefs, lightmaps, timeline, lmSwap, ownLights: ownTagged };
}

/** Light markers (Blender area/point lights exported as empties) -> pool definitions. Blender W converted with one exposure factor. */
export function toLightDefs(markers: Marker[], exposure = 0.06): LightDef[] {
  return markers.filter((m) => m.name === 'light').map((m) => {
    const d = typeof m.data.light === 'string' ? JSON.parse(m.data.light as string) : (m.data.light as any);
    const col = new THREE.Color(d.color[0], d.color[1], d.color[2]);
    const timeline = (m.data.timeline === 'a' || m.data.timeline === 'b') ? m.data.timeline : undefined;
    if (d.kind === 'area') {
      const w = d.size[0], h = d.size[1];
      return { kind: 'area', pos: m.pos.clone(), size: [w, h], color: col, intensity: (d.power * exposure) / Math.max(w * h, 0.05), timeline } as LightDef;
    }
    return { kind: 'point', pos: m.pos.clone(), size: [0, 0], color: col, intensity: d.power * exposure * 2, timeline } as LightDef;
  });
}

/**
 * Real-time copies of the baked lights, for characters and effects only (static surfaces already have them in the lightmap):
 * rectangle area lights for fixtures, point lights for small emitters. Blender light power (W) is converted with one exposure factor.
 */
export function addCharacterLights(markers: Marker[], scene: THREE.Scene, exposure = 0.06): THREE.Light[] {
  return makeLights(markers, scene, exposure);
}

export function makeLights(markers: Marker[], scene: THREE.Scene, exposure = 0.06): THREE.Light[] {
  const lights: THREE.Light[] = [];
  for (const m of markers) {
    if (m.name !== 'light') continue;
    const d = typeof m.data.light === 'string' ? JSON.parse(m.data.light as string) : (m.data.light as any);
    const col = new THREE.Color(d.color[0], d.color[1], d.color[2]);
    let l: THREE.Light;
    if (d.kind === 'area') {
      const w = d.size[0], h = d.size[1];
      const ra = new THREE.RectAreaLight(col, (d.power * exposure) / Math.max(w * h, 0.05), w, h);
      ra.position.copy(m.pos);
      ra.lookAt(m.pos.x, m.pos.y - 1, m.pos.z); // fixtures face down
      l = ra;
    } else {
      l = new THREE.PointLight(col, d.power * exposure * 2, 8, 2);
      l.position.copy(m.pos);
    }
    scene.add(l);
    lights.push(l);
  }
  return lights;
}

/** Metric UVs (1 unit = 1 m) projected along each vertex's dominant normal axis, for meshes exported without a UV set (door
 *  leaves exported before `envkit.sliding_door` unwrapped them): their tiled materials sampled one texel and read as flat paint. */
function boxUV(g: THREE.BufferGeometry): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  if (!p || !n) return;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ax >= ay && ax >= az) { uv[2 * i] = z; uv[2 * i + 1] = y; }
    else if (ay >= az) { uv[2 * i] = x; uv[2 * i + 1] = z; }
    else { uv[2 * i] = x; uv[2 * i + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

