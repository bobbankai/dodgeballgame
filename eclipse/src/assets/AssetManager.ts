import {
  LoadAssetContainerAsync, type AssetContainer, type InstantiatedEntries, type Scene, type AbstractMesh,
  type TransformNode, type Skeleton, type AnimationGroup,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import { assetUrl } from './paths';
import { log } from '../core/Log';

/** One placed copy of a loaded model. */
export interface ModelInstance {
  root: TransformNode;
  meshes: AbstractMesh[];
  skeletons: Skeleton[];
  animationGroups: AnimationGroup[];
  dispose(): void;
}

/**
 * Loads GLB files into asset containers once and instantiates copies with their own skeletons
 * (characters) or as shared-geometry instances (props). Containers belong to a "scope" (a level or
 * the persistent game) so a level's assets can be released together when it unloads.
 */
export class AssetManager {
  private containers = new Map<string, Promise<AssetContainer>>();
  private scopes = new Map<string, Set<string>>();
  private json = new Map<string, Promise<unknown>>();

  constructor(private scene: Scene) {}

  container(path: string, scope = 'game'): Promise<AssetContainer> {
    let p = this.containers.get(path);
    if (!p) {
      const url = assetUrl(path);
      const t0 = performance.now();
      p = LoadAssetContainerAsync(url, this.scene, { pluginExtension: '.glb' }).then((c) => {
        log.debug(`loaded ${path} in ${(performance.now() - t0).toFixed(0)} ms (${c.meshes.length} meshes)`);
        // keep the container's own meshes out of the scene; instances are what get rendered
        return c;
      });
      p.catch((e) => {
        log.error(`failed to load ${path}`, e);
        this.containers.delete(path);
      });
      this.containers.set(path, p);
    }
    let set = this.scopes.get(scope);
    if (!set) {
      set = new Set();
      this.scopes.set(scope, set);
    }
    set.add(path);
    return p;
  }

  /** A full copy with cloned skeletons and animation groups (characters). */
  async instantiate(path: string, name: string, scope = 'game'): Promise<ModelInstance> {
    const c = await this.container(path, scope);
    const e: InstantiatedEntries = c.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: true });
    const root = e.rootNodes[0] as TransformNode;
    const meshes = root.getChildMeshes(false);
    // colour attributes in our assets carry baked AO or masks, never opacity: an RGBA accessor would
    // otherwise put the mesh in the alpha-blended queue (no depth, sorted, seen through by post)
    for (const m of meshes) m.hasVertexAlpha = false;
    return {
      root,
      meshes,
      skeletons: e.skeletons,
      animationGroups: e.animationGroups,
      dispose: () => e.dispose(),
    };
  }

  /** Shared-geometry copy (static props): meshes are Babylon instances of the container's meshes. */
  async instance(path: string, name: string, scope = 'game'): Promise<ModelInstance> {
    const c = await this.container(path, scope);
    const e = c.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: false });
    const root = e.rootNodes[0] as TransformNode;
    return { root, meshes: root.getChildMeshes(false), skeletons: e.skeletons, animationGroups: e.animationGroups, dispose: () => e.dispose() };
  }

  loadJson<T>(path: string): Promise<T> {
    let p = this.json.get(path);
    if (!p) {
      p = fetch(assetUrl(path)).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      });
      this.json.set(path, p);
    }
    return p as Promise<T>;
  }

  /** Releases every container loaded under a scope (level unload). */
  async releaseScope(scope: string): Promise<void> {
    const set = this.scopes.get(scope);
    if (!set) return;
    for (const path of set) {
      const inOther = [...this.scopes.entries()].some(([s, paths]) => s !== scope && paths.has(path));
      if (inOther) continue;
      const p = this.containers.get(path);
      this.containers.delete(path);
      if (p) (await p.catch(() => null))?.dispose();
    }
    this.scopes.delete(scope);
  }
}
