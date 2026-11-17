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

/**
 * The shared clips re-expressed on a character whose bones rest differently from the rig's. A glTF clip sets each bone's absolute
 * local rotation, i.e. the rig's rest with the motion in it; on a body built with other rest rotations (Imani's, Nyx's and the
 * operatives' toes rest ~80 degrees from the rig's: a different roll; a dozen more bones 5-12 degrees) that put the rig's rest in
 * place of its own: bent toes, shifted knees. Retargeted in world space with rest offsets: with O = (rig rest, world)^-1 * (body
 * rest, world) per bone, a track becomes q' = O_parent^-1 * q * O_bone, which keeps every bone's world motion relative to its own
 * rest (roll or direction alike) and leaves bones without motion at the body's rest. Cached per model.
 */
const restCorrected = new Map<string, Map<string, THREE.AnimationClip>>();
async function clipsForBody(path: string, root: THREE.Object3D, bones: Map<string, THREE.Bone>): Promise<Map<string, THREE.AnimationClip>> {
  const shared = await loadSharedClips();
  const cached = restCorrected.get(path);
  if (cached) return cached;
  const rig = (await loadGLTF('animations/humanoid.glb')).scene;
  rig.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  const worldQ = (o: THREE.Object3D | null) => (o ? o.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion());
  const offset = (rigObj: THREE.Object3D | null, bodyObj: THREE.Object3D | null) => worldQ(rigObj).invert().multiply(worldQ(bodyObj));
  const near = (q: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w))) < 0.25 * Math.PI / 180;
  const fix = new Map<string, { pInv: THREE.Quaternion; o: THREE.Quaternion }>();
  for (const [name, bone] of bones) {
    const r = rig.getObjectByName(name);
    if (!r) continue;
    const o = offset(r, bone);
    const op = offset(r.parent, bone.parent);
    if (near(o) && near(op)) continue;
    fix.set(name, { pInv: op.invert(), o });
  }
  if (!fix.size) { restCorrected.set(path, shared); return shared; }
  const out = new Map<string, THREE.AnimationClip>();
  const q = new THREE.Quaternion();
  for (const [key, clip] of shared) {
    const c = clip.clone();
    for (const t of c.tracks) {
      if (!t.name.endsWith('.quaternion')) continue;
      const f = fix.get(t.name.slice(0, -'.quaternion'.length));
      if (!f) continue;
      const v = t.values;
      for (let i = 0; i < v.length; i += 4) {
        q.set(v[i], v[i + 1], v[i + 2], v[i + 3]).premultiply(f.pInv).multiply(f.o);
        v[i] = q.x; v[i + 1] = q.y; v[i + 2] = q.z; v[i + 3] = q.w;
      }
    }
    out.set(key, c);
  }
  restCorrected.set(path, out);
  return out;
}

/** A fresh, independently animatable copy of a skinned character, dressed with the game's materials. */
export async function instantiateCharacter(path: string, opts: { tint?: number; scale?: number } = {}): Promise<CharacterInstance> {
  const [g, meta] = await Promise.all([loadGLTF(path), loadClipTable(), loadSharedClips()]);
  const root = cloneSkinned(g.scene) as THREE.Group;
  dressCharacter(root);
  await texturesReady();
  const bones = new Map<string, THREE.Bone>();
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.set(o.name, o as THREE.Bone);
  });
  // (bones read before any animation has run: their quaternions are the body's rest)
  const clips = new Map(await clipsForBody(path, root, bones));
  for (const c of g.animations) clips.set(c.name, c);
  if (opts.scale) root.scale.setScalar(opts.scale);
  return { root, clips, bones, meta };
}
