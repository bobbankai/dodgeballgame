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
  /** hips translation per frame, relative to the reference rig's rest position (x, y, z) */
  hips: Float32Array | null;
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

/** The shared humanoid clips, read out of humanoid.glb into plain arrays. */
export function loadClips(scene: Scene): Promise<ClipLibrary> {
  if (library) return library;
  library = (async () => {
    const [container, meta] = await Promise.all([
      loadContainer(scene, 'anims/humanoid.glb'),
      fetch(BASE + 'anims/humanoid.json').then((r) => r.json()),
    ]);
    const clips = new Map<string, Clip>();
    let restHips: Vector3 | null = null;
    for (const n of container.transformNodes) {
      if (n.name === 'hips') restHips = n.position.clone();
    }
    for (const g of container.animationGroups) {
      const m = meta.clips[g.name];
      if (!m) continue;
      const frames = m.frames as number;
      const clip: Clip = { name: g.name, frames, fps: m.fps, loop: m.loop, rot: new Map(), hips: null, duration: frames / m.fps };
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
    return { clips, refHipHeight: meta.refHipHeight as number };
  })();
  return library;
}
