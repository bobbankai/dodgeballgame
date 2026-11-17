import * as THREE from 'three/webgpu';

/**
 * GPU resources with an owner and a lifetime. Textures loaded from files are cached by path and colour space and tracked
 * until loaded (the loader awaits them before the first frame); resources a system creates are registered under its owner
 * and released together (`release(owner)`), so a level section or a quality rebuild frees exactly what it made.
 */
export const assetUrl = (p: string): string => `${import.meta.env.BASE_URL}assets/${p}`.replace(/\/\/+/g, '/');

type Disposable = { dispose(): void };

interface Owned { res: Disposable; bytes: number }

export class ResourceManager {
  private loader = new THREE.TextureLoader();
  private cache = new Map<string, THREE.Texture>();
  private pending = new Set<Promise<void>>();
  private owned = new Map<string, Owned[]>();
  /** which owners (level sections; 'global' for characters and the UI) use each cached texture */
  private users = new Map<string, Set<string>>();
  /** owners currently on screen; a texture none of whose owners is resident leaves the GPU (it re-uploads when used again) */
  private resident = new Set<string>(['global']);
  anisotropy = 8;

  /** A texture from `public/assets/<path>`. sRGB for colour maps, linear for data (normals, roughness, heights, masks). */
  texture(path: string, srgb: boolean, flipY = true, owner = 'global'): THREE.Texture {
    const key = `${path}|${srgb ? 's' : 'l'}|${flipY ? 'y' : 'n'}`;
    let u = this.users.get(key);
    if (!u) this.users.set(key, (u = new Set()));
    u.add(owner);
    if (owner !== 'global' && !this.resident.has(owner)) this.resident.add(owner);
    let t = this.cache.get(key);
    if (t) return t;
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    this.pending.add(p);
    const finish = () => { this.pending.delete(p); done(); };
    t = this.loader.load(assetUrl(path), finish, undefined, (e) => { console.warn('[gfx] texture failed', path, e); finish(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = flipY; // maps baked on glTF UVs (v already flipped by the exporter) load unflipped
    t.anisotropy = this.anisotropy;
    this.cache.set(key, t);
    return t;
  }

  /** Resolves when every texture requested so far has loaded or failed. */
  async ready(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /**
   * An owner (a level section) shown or hidden. Hiding frees the GPU copy of every texture that no shown owner uses; the
   * decoded image stays, so showing it again only re-uploads.
   */
  setResident(owner: string, on: boolean): number {
    if (on) { this.resident.add(owner); return 0; }
    this.resident.delete(owner);
    let freed = 0;
    for (const [key, u] of this.users) {
      if (!u.has(owner)) continue;
      if ([...u].some((o) => this.resident.has(o))) continue;
      const t = this.cache.get(key);
      if (t) { t.dispose(); freed++; }
    }
    return freed;
  }

  /** Register a resource under an owner (a section, a system); `bytes` feeds the memory overlay. */
  own<T extends Disposable>(owner: string, res: T, bytes = 0): T {
    let list = this.owned.get(owner);
    if (!list) this.owned.set(owner, (list = []));
    list.push({ res, bytes });
    return res;
  }

  /** Dispose everything an owner registered. */
  release(owner: string): void {
    for (const o of this.owned.get(owner) ?? []) o.res.dispose();
    this.owned.delete(owner);
  }

  /** Apply a new anisotropy to every cached texture (a settings change). */
  setAnisotropy(n: number): void {
    this.anisotropy = n;
    for (const t of this.cache.values()) { t.anisotropy = n; t.needsUpdate = !!t.image; }
  }

  /** Bytes registered per owner, plus an estimate for the cached file textures (RGBA8 + mips). */
  memory(): { owned: Record<string, number>; textures: number } {
    const owned: Record<string, number> = {};
    for (const [k, list] of this.owned) owned[k] = list.reduce((a, o) => a + o.bytes, 0);
    let textures = 0;
    for (const t of this.cache.values()) {
      const img = t.image as { width?: number; height?: number } | undefined;
      if (img?.width && img.height) textures += img.width * img.height * 4 * 1.33;
    }
    return { owned, textures };
  }
}

export const resources = new ResourceManager();
