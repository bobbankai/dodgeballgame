import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '@/rendering/charmat';

/**
 * The shared humanoid clip library (blender/animations/humanoid_anims.py): every human in the game uses the MPFB game_engine rig,
 * so one set of clips drives them all. Only bone rotations and the pelvis position are kept (a character's own bone lengths are never
 * overwritten); the pelvis track is scaled to the character's hip height. Clip metadata (loop, root speed, gameplay events) comes
 * from humanoid_clips.json.
 */
export interface ClipEvents {
  hit?: [number, number];
  striker?: string;
  cancel?: [number, number];
  combo_window?: [number, number];
  parry?: [number, number];
  iframes?: [number, number];
  vulnerable?: [number, number];
  cast?: number;
}
export interface ClipMeta { duration: number; loop?: boolean; speed: number; events?: ClipEvents; source?: string }

export class ClipLibrary {
  clips = new Map<string, THREE.AnimationClip>();
  meta: Record<string, ClipMeta> = {};
  hipHeight = 1.066;

  static async load(): Promise<ClipLibrary> {
    const lib = new ClipLibrary();
    const [gltf, meta] = await Promise.all([
      new GLTFLoader().loadAsync(assetUrl('animations/humanoid.glb')),
      fetch(assetUrl('animations/humanoid_clips.json')).then((r) => r.json()),
    ]);
    lib.meta = meta.clips;
    gltf.scene.traverse((o) => { if (o.name === 'pelvis') lib.hipHeight = o.getWorldPosition(new THREE.Vector3()).y; });
    for (const c of gltf.animations) {
      c.tracks = c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
      lib.clips.set(c.name, c);
    }
    return lib;
  }

  /** A copy of the clip for a character whose hips are at `hipHeight` metres (pelvis track scaled). */
  forCharacter(name: string, hipHeight: number): THREE.AnimationClip {
    const src = this.clips.get(name);
    if (!src) throw new Error(`clip ${name} missing`);
    const c = src.clone();
    const k = hipHeight / this.hipHeight;
    if (Math.abs(k - 1) > 1e-3) {
      for (const t of c.tracks) if (t.name === 'pelvis.position') for (let i = 0; i < t.values.length; i++) t.values[i] *= k;
    }
    return c;
  }
}
