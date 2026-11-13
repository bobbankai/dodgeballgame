import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { dressCharacter, texturesReady } from '@/rendering/charmat';

export interface ClipEvents {
  hit?: [number, number];
  cancel?: number;
  striker?: string;
  damage?: number;
  stagger?: number;
  reach?: number;
  lunge?: number;
  guardbreak?: boolean;
  launch?: number;
  window?: [number, number];
  iframes?: [number, number];
  travel?: [number, number, number];
  activate?: number;
  use?: number;
  impact?: number;
}
export interface ClipMeta {
  frames: number;
  fps: number;
  loop: boolean;
  speed?: number;
  kind?: string;
  events: ClipEvents;
}
export type ClipTable = Record<string, ClipMeta>;

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>>();
let clipTable: Promise<ClipTable> | null = null;

export const asset = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`.replace(/\/\/+/g, '/');

export function loadGLTF(path: string) {
  let p = gltfCache.get(path);
  if (!p) {
    p = loader.loadAsync(asset(path)).then((g) => ({ scene: g.scene, animations: g.animations }));
    gltfCache.set(path, p);
  }
  return p;
}

export function loadClipTable(): Promise<ClipTable> {
  if (!clipTable) clipTable = fetch(asset('animations/humanoid_clips.json')).then((r) => r.json());
  return clipTable;
}

export interface CharacterInstance {
  root: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  bones: Map<string, THREE.Bone>;
  meta: ClipTable;
}

let sharedClips: Promise<Map<string, THREE.AnimationClip>> | null = null;

/** The shared humanoid clip library (every human uses the MPFB game rig): bone rotations + the pelvis position only, so a character's
 * own bone lengths are never overwritten. */
export function loadSharedClips(): Promise<Map<string, THREE.AnimationClip>> {
  if (!sharedClips) {
    sharedClips = loadGLTF('animations/humanoid.glb').then((g) => new Map(g.animations.map((c) => {
      const k = c.clone();
      k.tracks = k.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
      return [k.name, k] as [string, THREE.AnimationClip];
    })));
  }
  return sharedClips;
}

/** A fresh, independently animatable copy of a skinned character, dressed with the game's materials. */
export async function instantiateCharacter(path: string, opts: { tint?: number; scale?: number } = {}): Promise<CharacterInstance> {
  const [g, meta, shared] = await Promise.all([loadGLTF(path), loadClipTable(), loadSharedClips()]);
  const root = cloneSkinned(g.scene) as THREE.Group;
  dressCharacter(root);
  await texturesReady();
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  const clips = new Map(shared);
  for (const c of g.animations) clips.set(c.name, c);
  if (opts.scale) root.scale.setScalar(opts.scale);
  return { root, clips, bones, meta };
}
