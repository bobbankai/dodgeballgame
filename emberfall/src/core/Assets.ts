// Asset loading: glTF (meshopt-compressed GLBs from the Blender pipeline), textures, audio.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export const manager = new THREE.LoadingManager();
export const texLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const cache = new Map<string, Promise<GLTF>>();

/** load once, return a fresh deep copy each call (skinned meshes cloned with their skeletons) */
export async function loadGLTF(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  let p = cache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url);
    cache.set(url, p);
  }
  const g = await p;
  return { scene: SkeletonUtils.clone(g.scene) as THREE.Group, animations: g.animations };
}

/** the shared (not cloned) glTF: for instancing geometry and materials */
export async function loadGLTFShared(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url);
    cache.set(url, p);
  }
  return p;
}

export function loadTexture(url: string, srgb = false, repeat = false): THREE.Texture {
  const t = texLoader.load(url);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** resolves when everything queued on the manager has finished */
let pending = 0;
manager.onStart = () => { pending++; };
const waiters: (() => void)[] = [];
manager.onLoad = () => { pending = 0; waiters.splice(0).forEach((w) => w()); };
export function allLoaded(): Promise<void> {
  return new Promise((res) => { if (pending === 0) res(); else waiters.push(res); });
}
