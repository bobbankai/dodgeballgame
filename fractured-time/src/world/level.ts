import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { loadGLTF } from '@/assets/loader';
import { pbr, emissive, tex, texturesReady, type Recipe } from '@/rendering/charmat';
import { assetUrl } from '@/rendering/charmat';
import type { Physics } from '@/physics/physics';
import type { LightDef } from './lightpool';

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
export interface LoadedLevel { root: THREE.Group; markers: Marker[]; staticMeshes: THREE.Mesh[]; dynamic: THREE.Object3D[]; lightDefs: LightDef[];
  lightmaps: THREE.Texture[] }

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
  const m = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: r.rough ?? 0.5, metalness: r.metal ?? 0 });
  if (r.stripes) {
    // painted hazard striping (world space diagonal), worn: scuffed toward the bottom, roughness broken up by noise
    const p = T.positionWorld;
    const n = T.mx_fractal_noise_float(p.mul(9.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const st = T.smoothstep(0.47, 0.53, T.fract(p.x.add(p.z).add(p.y.mul(0.5)).mul(float(r.stripes))));
    const scuff = T.smoothstep(0.62, 0.9, n);
    m.colorNode = T.mix(T.mix(T.vec3(c[0], c[1], c[2]), T.vec3(0.02, 0.02, 0.022), st), T.vec3(0.25, 0.25, 0.24), scuff.mul(0.6));
    m.roughnessNode = float(r.rough ?? 0.6).add(n.sub(0.5).mul(0.3));
  }
  return m;
}

/** Architectural glass: thin, faintly tinted, almost all reflection (from the section's probe and lights), no lightmap. */
function glass(r: Recipe): THREE.Material {
  const t = r.tint ?? [0.75, 0.85, 0.9];
  const m = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(t[0] * 0.08, t[1] * 0.08, t[2] * 0.08), roughness: Math.max(0.03, r.rough ?? 0.05),
    metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  m.specularIntensity = 1;
  return m;
}

export async function loadLevel(path: string, physics: Physics | null, scene: THREE.Scene | null, _unused: THREE.Light[] = []): Promise<LoadedLevel> {
  const g = await loadGLTF(path);
  const root = g.scene.clone(true) as THREE.Group;
  const markers: Marker[] = [];
  const staticMeshes: THREE.Mesh[] = [];
  const dynamic: THREE.Object3D[] = [];
  const lmLoads: Promise<void>[] = [];
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
  const lightmaps: THREE.Texture[] = [];
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
    const isDynamic = !!ud.dynamic;
    if (isDynamic) {
      // moving props (door leaves): not baked; lit by the real-time lights + probe like characters
      const holder = (o.parent && o.parent.userData?.dynamic) ? o.parent : o;
      if (!dynamic.includes(holder)) dynamic.push(holder);
    } else staticMeshes.push(mesh);
    mesh.receiveShadow = true;
    mesh.castShadow = isDynamic;
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
          lightmaps.push(t);
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
      else if (r.type === 'glass') m = glass(r);
      else m = old;
      m.name = old.name;
      if (raw) m.userData.ft = raw;
      return m;
    });
    const r0 = (m: THREE.Material) => { const raw = (m.userData as any)?.ft; return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw).type : ''; };
    const apply = (m: THREE.Material) => {
      if (isDynamic || r0(m) === 'glass') return;
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
  if (scene) scene.add(root);
  return { root, markers, staticMeshes, dynamic, lightDefs, lightmaps };
}

/** Light markers (Blender area/point lights exported as empties) -> pool definitions. Blender W converted with one exposure factor. */
export function toLightDefs(markers: Marker[], exposure = 0.06): LightDef[] {
  return markers.filter((m) => m.name === 'light').map((m) => {
    const d = typeof m.data.light === 'string' ? JSON.parse(m.data.light as string) : (m.data.light as any);
    const col = new THREE.Color(d.color[0], d.color[1], d.color[2]);
    if (d.kind === 'area') {
      const w = d.size[0], h = d.size[1];
      return { kind: 'area', pos: m.pos.clone(), size: [w, h], color: col, intensity: (d.power * exposure) / Math.max(w * h, 0.05) } as LightDef;
    }
    return { kind: 'point', pos: m.pos.clone(), size: [0, 0], color: col, intensity: d.power * exposure * 2 } as LightDef;
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

/** Capture the lit level into a PMREM environment (reflections on glossy surfaces, ambient for characters). */
export function captureProbe(renderer: THREE.WebGPURenderer, scene: THREE.Scene, at: THREE.Vector3): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = (pm as any).fromScene(scene, 0.02, 0.1, 60, { position: at }) as THREE.RenderTarget;
  return rt.texture;
}
