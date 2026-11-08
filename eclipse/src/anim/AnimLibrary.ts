import type { TransformNode } from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import { Clip, type ClipMeta } from './Clip';
import { ClipSet, type RigBinding } from './Animator';
import { log } from '../core/Log';

interface LibraryMeta {
  fps: number;
  clips: Record<string, ClipMeta>;
}

/**
 * An animation library (a GLB holding a skeleton and one animation per clip, plus a JSON sidecar
 * with clip metadata). Clips are retargeted by bone name onto any rig with the same skeleton
 * layout, so every human character shares one library.
 */
export class AnimLibrary {
  /** keyed by the rig's bone layout, so every instance of a character shares the sampled clips */
  private cache = new Map<string, ClipSet>();
  /** rest positions of the library's own skeleton, by bone name */
  private srcRest = new Map<string, [number, number, number]>();
  private constructor(private groups: import('@babylonjs/core').AnimationGroup[], private meta: LibraryMeta, nodes: TransformNode[]) {
    for (const n of nodes) this.srcRest.set(n.name.split(':').pop()!, [n.position.x, n.position.y, n.position.z]);
  }

  static async load(assets: AssetManager, name: string): Promise<AnimLibrary> {
    const [container, meta] = await Promise.all([
      assets.container(`anims/${name}.glb`),
      assets.loadJson<LibraryMeta>(`anims/${name}.json`),
    ]);
    // the container's own animation groups are never played; we only read their keys
    for (const g of container.animationGroups) g.stop();
    return new AnimLibrary(container.animationGroups, meta, container.transformNodes);
  }

  get names(): string[] {
    return this.groups.map((g) => g.name);
  }

  /** Clips bound to one rig layout (cached per binding). */
  bind(rig: RigBinding): ClipSet {
    const key = rig.names.join(',');
    let set = this.cache.get(key);
    if (set) return set;
    set = new ClipSet();
    for (const g of this.groups) {
      const map = new Map<TransformNode, number>();
      for (const ta of g.targetedAnimations) {
        const node = ta.target as TransformNode;
        if (map.has(node)) continue;
        const idx = rig.index.get(node.name.split(':').pop()!);
        if (idx !== undefined) map.set(node, idx);
      }
      const meta = this.meta.clips[g.name];
      if (!meta) log.warn(`clip ${g.name} has no metadata`);
      const clip = Clip.fromGroup(g, map, rig.nodes.length, meta, this.meta.fps);
      this.retargetPositions(clip, rig);
      set.clips.set(g.name, clip);
    }
    this.cache.set(key, set);
    return set;
  }

  /**
   * Only the Root (root motion) and the pelvis (bob, crouch) translate; every other bone keeps the
   * target rig's own rest offsets, so characters with other proportions are not stretched. The
   * translations are rescaled by the ratio of hip heights.
   */
  private retargetPositions(clip: Clip, rig: RigBinding): void {
    const pi = rig.index.get('pelvis');
    const srcP = this.srcRest.get('pelvis');
    const ratio = pi !== undefined && srcP && Math.abs(srcP[1]) > 1e-4 ? rig.rest.pos[pi * 3 + 1] / srcP[1] : 1;
    for (let b = 0; b < clip.pos.length; b++) {
      const arr = clip.pos[b];
      if (!arr) continue;
      const name = rig.names[b];
      if (name !== 'Root' && name !== 'pelvis') {
        clip.pos[b] = null;
        continue;
      }
      const src = this.srcRest.get(name) ?? [0, 0, 0];
      const tx = rig.rest.pos[b * 3], ty = rig.rest.pos[b * 3 + 1], tz = rig.rest.pos[b * 3 + 2];
      for (let f = 0; f < arr.length; f += 3) {
        arr[f] = tx + (arr[f] - src[0]) * ratio;
        arr[f + 1] = ty + (arr[f + 1] - src[1]) * ratio;
        arr[f + 2] = tz + (arr[f + 2] - src[2]) * ratio;
      }
    }
  }
}
