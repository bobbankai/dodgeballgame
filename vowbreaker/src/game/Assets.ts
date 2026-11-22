import { AssetContainer, LoadAssetContainerAsync, Quaternion, Scene, TransformNode, Vector3 } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

const BASE = './assets/';

/** One animation clip baked into per-bone key arrays (sampled every frame at 30 fps by Blender). */
export interface Clip {
  name: string;
  frames: number;
  fps: number;
  loop: boolean;
  /** bone name -> quaternions (x, y, z, w per frame) */
  rot: Map<string, Float32Array>;
  /** hips translation per frame, relative to the authoring rig's rest position (x, y, z) */
  hips: Float32Array | null;
  /** hip height of the rig the clip was authored on (hips motion scales by target / this) */
  hipRef: number;
  duration: number;
}

export interface ClipLibrary {
  clips: Map<string, Clip>;
  refHipHeight: number;
}

const containers = new Map<string, Promise<AssetContainer>>();

export function loadContainer(scene: Scene, path: string): Promise<AssetContainer> {
  let p = containers.get(path);
  if (!p) {
    p = LoadAssetContainerAsync(BASE + path, scene);
    containers.set(path, p);
  }
  return p;
}

let library: Promise<ClipLibrary> | null = null;
const perModel = new Map<string, Promise<ClipLibrary>>();
let manifest: Promise<{ models: Record<string, string[]> }> | null = null;

/** Read every animation group of a container into plain per-bone arrays. */
function readClips(container: AssetContainer, meta: { clips: Record<string, { frames: number; fps: number; loop: boolean }>; refHipHeight: number }): Map<string, Clip> {
  const clips = new Map<string, Clip>();
  let restHips: Vector3 | null = null;
  for (const n of container.transformNodes) {
    if (n.name === 'hips') restHips = n.position.clone();
  }
  for (const g of container.animationGroups) {
    const m = meta.clips[g.name];
    if (!m) continue;
    const frames = m.frames as number;
    const clip: Clip = { name: g.name, frames, fps: m.fps, loop: m.loop, rot: new Map(), hips: null, hipRef: meta.refHipHeight, duration: frames / m.fps };
    for (const ta of g.targetedAnimations) {
      const target = ta.target as TransformNode;
      const a = ta.animation;
      const keys = a.getKeys();
      if (a.targetProperty === 'rotationQuaternion') {
        const arr = new Float32Array((frames + 1) * 4);
        for (let f = 0; f <= frames; f++) {
          const q = a.evaluate(keys[0].frame + f * ((keys[keys.length - 1].frame - keys[0].frame) / Math.max(frames, 1))) as Quaternion;
          arr.set([q.x, q.y, q.z, q.w], f * 4);
        }
        clip.rot.set(target.name, arr);
      } else if (a.targetProperty === 'position' && target.name === 'hips' && restHips) {
        const arr = new Float32Array((frames + 1) * 3);
        for (let f = 0; f <= frames; f++) {
          const p = a.evaluate(keys[0].frame + f * ((keys[keys.length - 1].frame - keys[0].frame) / Math.max(frames, 1))) as Vector3;
          arr.set([p.x - restHips.x, p.y - restHips.y, p.z - restHips.z], f * 3);
        }
        clip.hips = arr;
      }
    }
    clips.set(g.name, clip);
    g.stop();
  }
  return clips;
}

async function loadLibrary(scene: Scene, name: string): Promise<ClipLibrary> {
  const [container, meta] = await Promise.all([
    loadContainer(scene, `anims/${name}.glb`),
    fetch(BASE + `anims/${name}.json`).then((r) => r.json()),
  ]);
  return { clips: readClips(container, meta), refHipHeight: meta.refHipHeight as number };
}

/**
 * The clips a character plays: the shared humanoid library, with that character's own clips
 * (anims/<model>.glb: their stance, strings, techniques, walk, acting) laid over it by name.
 */
export function loadClips(scene: Scene, model?: string): Promise<ClipLibrary> {
  if (!library) library = loadLibrary(scene, 'humanoid');
  if (!model) return library;
  let p = perModel.get(model);
  if (!p) {
    p = (async () => {
      const base = await library!;
      if (!manifest) manifest = fetch(BASE + 'anims/manifest.json').then((r) => (r.ok ? r.json() : { models: {} })).catch(() => ({ models: {} }));
      const man = await manifest;
      if (!man.models[model]) return base;
      try {
        const own = await loadLibrary(scene, model);
        const clips = new Map(base.clips);
        for (const [k, v] of own.clips) clips.set(k, v);
        return { clips, refHipHeight: base.refHipHeight };
      } catch (e) {
        console.warn('clips for', model, 'missing, using the shared library', e);
        return base;
      }
    })();
    perModel.set(model, p);
  }
  return p;
}
