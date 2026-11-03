import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkMaterial, type InkOptions } from '../render/InkMaterial';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

/**
 * Load a glTF once; every call gets its own copy of the scene (sharing geometry and the clips), since
 * levels repaint, move and rescale what they load and a model is used again in later chapters.
 */
export async function loadGLTF(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  const g = await p;
  const scene = cloneSkinned(g.scene) as THREE.Group;
  return { ...g, scene, scenes: [scene] };
}

/** Free what a level put on the GPU (geometry and materials; shared ones re-upload if used again). */
export function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

const ids = new Map<string, number>();
let nextId = 1;
/** One ink-line id per material name, so parts sharing a material never get a line between them. */
export function lineIdFor(name: string) {
  let id = ids.get(name);
  if (id === undefined) {
    // 200+ so they never clash with ids baked into scenery vertex colours (10..199)
    id = 200 + (nextId++ % 54);
    ids.set(name, id);
  }
  return id;
}

/**
 * Swap every glTF material under `root` for the ink-and-wash material, keeping its colour and
 * name. `opts` can tune each material by name (hatching, always-in-colour, emissive...).
 */
export function inkify(root: THREE.Object3D, opts: (name: string) => InkOptions = () => ({}), shadows = true) {
  const made = new Map<THREE.Material, THREE.ShaderMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material) => {
      let ink = made.get(m);
      if (!ink) {
        const std = m as THREE.MeshStandardMaterial;
        const name = std.name || 'unnamed';
        ink = inkMaterial({
          color: std.color ?? 0xffffff,
          vertexColors: !!mesh.geometry.attributes.color,
          lineId: lineIdFor(name),
          ...opts(name),
        });
        ink.name = name;
        made.set(m, ink);
      }
      return ink;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
  });
  return made;
}
