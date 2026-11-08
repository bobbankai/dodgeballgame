import { Color3, PBRMaterial, Texture, type Scene, type BaseTexture } from '@babylonjs/core';
import { assetUrl } from '../assets/paths';

/** Options for a tiled PBR surface built from a texture set in public/assets/tex. */
export interface SurfaceOptions {
  /** Texture set id (textures.json), e.g. 'ash_castle_brick'. */
  set: string;
  /** Tiles per UV unit. */
  tile?: number;
  tint?: Color3;
  roughness?: number;
  metallic?: number;
  normalStrength?: number;
  /** Use the height map (if built) for parallax occlusion. */
  parallax?: number;
  emissive?: Color3;
  twoSided?: boolean;
}

/**
 * Texture and material cache. Texture sets are shared between every material that uses them, and a
 * material with the same options is created once per scene.
 */
export class MaterialLibrary {
  private textures = new Map<string, Texture>();
  private materials = new Map<string, PBRMaterial>();
  constructor(private scene: Scene) {}

  texture(name: string, srgb: boolean, tile = 1): Texture {
    const key = `${name}|${tile}`;
    let t = this.textures.get(key);
    if (!t) {
      t = new Texture(assetUrl(`tex/${name}.webp`), this.scene, { noMipmap: false, invertY: true, samplingMode: Texture.TRILINEAR_SAMPLINGMODE });
      t.anisotropicFilteringLevel = 8;
      t.gammaSpace = srgb;
      t.uScale = tile;
      t.vScale = tile;
      t.wrapU = Texture.WRAP_ADDRESSMODE;
      t.wrapV = Texture.WRAP_ADDRESSMODE;
      this.textures.set(key, t);
    }
    return t;
  }

  surface(o: SurfaceOptions): PBRMaterial {
    const key = JSON.stringify(o);
    const cached = this.materials.get(key);
    if (cached) return cached;
    const tile = o.tile ?? 1;
    const m = new PBRMaterial(`surf_${o.set}`, this.scene);
    m.albedoTexture = this.texture(`${o.set}_c`, true, tile);
    if (o.tint) m.albedoColor = o.tint;
    const n = this.texture(`${o.set}_n`, false, tile);
    n.level = o.normalStrength ?? 1;
    m.bumpTexture = n;
    // Poly Haven normals are OpenGL style; Babylon's glTF loader uses the same inversion in a
    // right-handed scene.
    m.invertNormalMapX = !this.scene.useRightHandedSystem;
    m.invertNormalMapY = this.scene.useRightHandedSystem;
    const orm = this.texture(`${o.set}_orm`, false, tile);
    m.metallicTexture = orm;
    m.useAmbientOcclusionFromMetallicTextureRed = true;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
    m.metallic = o.metallic ?? 1;
    m.roughness = o.roughness ?? 1;
    if (o.parallax) {
      m.useParallax = true;
      m.useParallaxOcclusion = true;
      m.parallaxScaleBias = o.parallax;
    }
    if (o.emissive) m.emissiveColor = o.emissive;
    m.backFaceCulling = !o.twoSided;
    m.environmentIntensity = 1;
    this.materials.set(key, m);
    return m;
  }

  /** Untextured PBR, for effects geometry and debugging. */
  plain(name: string, color: Color3, roughness = 0.7, metallic = 0): PBRMaterial {
    const key = `plain|${name}|${color.toHexString()}|${roughness}|${metallic}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const m = new PBRMaterial(name, this.scene);
    m.albedoColor = color;
    m.roughness = roughness;
    m.metallic = metallic;
    this.materials.set(key, m);
    return m;
  }

  allTextures(): BaseTexture[] {
    return [...this.textures.values()];
  }

  dispose(): void {
    for (const m of this.materials.values()) m.dispose(false, false);
    for (const t of this.textures.values()) t.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
