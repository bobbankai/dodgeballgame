import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { loadGLTF } from '@/assets/loader';
import { pbr, emissive, tex, texturesReady, type Recipe } from '@/rendering/charmat';
import { assetUrl } from '@/rendering/charmat';
import type { Physics } from '@/physics/physics';

const T = TSL as any;
const { texture, uv, float } = T;

/**
 * A baked level section (blender/environments/*.py): one static mesh per section with its photoscanned materials rebuilt from their
 * recipes, the Cycles lightmap (diffuse direct + indirect, on UV1) multiplied into the albedo, a reflection probe captured from the
 * level itself for glossy surfaces, collision boxes for Rapier and gameplay markers.
 * Static surfaces take no real-time lights (everything they receive is baked); characters and effects are lit by the level's
 * real-time light rig + the probe.
 */
export interface Marker { name: string; pos: THREE.Vector3; yaw: number; data: Record<string, unknown> }
export interface LoadedLevel { root: THREE.Group; markers: Marker[]; staticMeshes: THREE.Mesh[] }

const hdr = new HDRLoader();

/**
 * Lighting model for baked static surfaces: their diffuse light is entirely in the lightmap, so real-time lights add specular only
 * (the long highlights of the strip lights on metal and polished concrete); the diffuse term goes to a sink that is never used.
 */
class BakedSpecularLightingModel extends (THREE as any).PhysicalLightingModel {
  direct(input: any, builder: any) {
    const sink = T.vec3(0).toVar();
    super.direct({ ...input, reflectedLight: { ...input.reflectedLight, directDiffuse: sink } }, builder);
  }
  directRectArea(input: any, builder: any) {
    const sink = T.vec3(0).toVar();
    super.directRectArea({ ...input, reflectedLight: { ...input.reflectedLight, directDiffuse: sink } }, builder);
  }
}

function screen(r: Recipe): THREE.Material {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.08 });
  const t = tex(r.tex, true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const c = texture(t, uv()).rgb;
  m.colorNode = c.mul(0.05);
  // subtle scanline flicker so screens feel alive
  m.emissiveNode = c.mul(float(r.strength ?? 3).mul(T.sin(T.time.mul(37.0).add(uv().y.mul(420.0))).mul(0.04).add(0.96)));
  return m;
}

function plain(r: Recipe): THREE.Material {
  const c = r.color ?? [0.5, 0.5, 0.5];
  return new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: r.rough ?? 0.5, metalness: r.metal ?? 0 });
}

export async function loadLevel(path: string, physics: Physics | null, scene: THREE.Scene, lights: THREE.Light[] = []): Promise<LoadedLevel> {
  const g = await loadGLTF(path);
  const root = g.scene.clone(true) as THREE.Group;
  const markers: Marker[] = [];
  const staticMeshes: THREE.Mesh[] = [];
  const lmLoads: Promise<void>[] = [];
  const rtLights = (T.lights as (l: THREE.Light[]) => unknown)(lights);
  root.updateMatrixWorld(true);
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
      if (physics) physics.addTrimesh(mesh.geometry, mesh.matrixWorld);
      return;
    }
    staticMeshes.push(mesh);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    let lightMap: THREE.Texture | null = null;
    if (ud.lightmap) {
      const key = String(ud.lightmap);
      if (!lmCache.has(key)) {
        lmCache.set(key, hdr.loadAsync(assetUrl(key)).then((t) => {
          t.channel = 1;
          t.flipY = false;
          t.colorSpace = THREE.LinearSRGBColorSpace;
          t.minFilter = THREE.LinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.generateMipmaps = false;
          return t;
        }));
      }
      lmLoads.push(lmCache.get(key)!.then((t) => { lightMap = t; for (const m of mats) apply(m); }));
    }
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mats = src.map((old) => {
      const raw = (old.userData as any)?.ft;
      const r: Recipe | null = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
      let m: THREE.Material;
      if (!r) m = old;
      else if (r.type === 'pbr') m = pbr(r);
      else if (r.type === 'emissive') m = emissive(r);
      else if (r.type === 'screen') m = screen(r);
      else if (r.type === 'plain') m = plain(r);
      else m = old;
      m.name = old.name;
      if (raw) m.userData.ft = raw;
      return m;
    });
    const r0 = (m: THREE.Material) => { const raw = (m.userData as any)?.ft; return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw).type : ''; };
    const apply = (m: THREE.Material) => {
      const sm = m as THREE.MeshStandardNodeMaterial;
      if (lightMap && 'lightMap' in sm) {
        sm.lightMap = lightMap;
        sm.lightMapIntensity = Math.PI; // Cycles' diffuse bake is irradiance without the 1/pi of the Lambert BRDF
      }
      (sm as any).lightsNode = rtLights; // the level's real-time lights: specular only on baked surfaces
      const phys = sm as any;
      if (phys.isMeshStandardNodeMaterial && !(r0(m) === 'emissive' || r0(m) === 'screen')) {
        phys.setupLightingModel = () => new (BakedSpecularLightingModel as any)(false, false, false, false, false, false);
      }
      sm.needsUpdate = true;
    };
    for (const m of mats) apply(m);
    mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
  });
  await Promise.all(lmLoads);
  await texturesReady();
  scene.add(root);
  return { root, markers, staticMeshes };
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

/** Capture the lit level into a PMREM environment (reflections on glossy surfaces, ambient for characters). */
export function captureProbe(renderer: THREE.WebGPURenderer, scene: THREE.Scene, at: THREE.Vector3): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = (pm as any).fromScene(scene, 0.02, 0.1, 60, { position: at }) as THREE.RenderTarget;
  return rt.texture;
}
