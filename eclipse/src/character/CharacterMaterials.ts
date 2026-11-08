import {
  Color3, Constants, PBRMaterial, Texture, type AbstractMesh, type Scene,
} from '@babylonjs/core';
import { assetUrl } from '../assets/paths';
import { SkinPlugin, HairPlugin, EmissiveFxPlugin, DissolvePlugin } from '../render/materials/FxPlugins';

/** Per-part settings written by the Blender build script into <char>.json. */
export interface PartSpec {
  kind: 'skin' | 'gear' | 'hair' | 'eye' | 'teeth' | 'cloth' | 'emissive';
  tex?: string;
  clearcoat?: number;
  emissive?: number;
}

export interface CharacterManifest {
  name: string;
  height: number;
  parts: Record<string, PartSpec>;
  sockets: Record<string, string>;
  morphs: string[];
}

export interface CharacterMaterialSet {
  materials: PBRMaterial[];
  dissolve: DissolvePlugin[];
  emissive: EmissiveFxPlugin[];
}

/**
 * Builds the PBR materials for a character from its texture sets: skin (pre-integrated scattering +
 * an oily clear-coat lobe + thin-part translucency), gear (metal/leather/cloth atlas, emissive
 * godspark seams that pulse), hair (alpha-tested cards, Kajiya-Kay dual specular), eyes (wet
 * clear-coat), teeth. Every material also gets a dissolve plugin for deaths and visions.
 */
export class CharacterMaterials {
  private cache = new Map<string, PBRMaterial>();
  constructor(private scene: Scene) {}

  private tex(dir: string, name: string, srgb: boolean): Texture {
    const t = new Texture(assetUrl(`chars/${dir}/${name}.webp`), this.scene, { invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE });
    t.gammaSpace = srgb;
    t.anisotropicFilteringLevel = 8;
    return t;
  }

  /** Material for one part; cached per character + part so instances share it. */
  build(dir: string, part: string, spec: PartSpec, set: CharacterMaterialSet): PBRMaterial {
    const key = `${dir}/${part}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const m = new PBRMaterial(`${dir}_${part}`, this.scene);
    const rh = this.scene.useRightHandedSystem;
    const withMaps = (t: string, orm = true) => {
      m.albedoTexture = this.tex(dir, `${t}_c`, true);
      const n = this.tex(dir, `${t}_n`, false);
      m.bumpTexture = n;
      m.invertNormalMapX = !rh;
      m.invertNormalMapY = rh;
      if (orm) {
        m.metallicTexture = this.tex(dir, `${t}_orm`, false);
        m.useAmbientOcclusionFromMetallicTextureRed = true;
        m.useRoughnessFromMetallicTextureGreen = true;
        m.useMetallnessFromMetallicTextureBlue = true;
        m.metallic = 1;
        m.roughness = 1;
      }
    };
    switch (spec.kind) {
      case 'skin': {
        withMaps(spec.tex ?? 'skin');
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = spec.clearcoat ?? 0.12;
        m.clearCoat.roughness = 0.32;
        m.subSurface.isTranslucencyEnabled = true;
        m.subSurface.translucencyIntensity = 0.35;
        m.subSurface.tintColor = new Color3(1.0, 0.35, 0.25);
        m.subSurface.maximumThickness = 0.6;
        new SkinPlugin(m);
        break;
      }
      case 'gear': {
        withMaps(spec.tex ?? 'gear');
        m.emissiveTexture = this.tex(dir, `${spec.tex ?? 'gear'}_e`, true);
        m.emissiveColor = new Color3(1, 1, 1).scale(spec.emissive ?? 1.5);
        const fx = new EmissiveFxPlugin(m);
        fx.pulseSpeed = 1.6;
        fx.pulseAmount = 0.35;
        fx.flowAmount = 0.4;
        fx.flowScale = 8;
        set.emissive.push(fx);
        break;
      }
      case 'cloth': {
        withMaps(spec.tex ?? 'cloth');
        m.backFaceCulling = false;
        m.sheen.isEnabled = true;
        m.sheen.intensity = 0.4;
        m.sheen.color = new Color3(0.9, 0.85, 0.8);
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        m.alphaCutOff = 0.5;
        m.useAlphaFromAlbedoTexture = true;
        break;
      }
      case 'hair': {
        m.albedoTexture = this.tex(dir, `${spec.tex ?? 'hair'}_c`, true);
        m.albedoTexture.hasAlpha = true;
        m.useAlphaFromAlbedoTexture = true;
        m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        m.alphaCutOff = 0.38;
        m.backFaceCulling = false;
        m.metallic = 0;
        m.roughness = 0.55;
        m.metallicF0Factor = 0.25;
        new HairPlugin(m);
        break;
      }
      case 'eye': {
        m.albedoTexture = this.tex(dir, `${spec.tex ?? 'eye'}_c`, true);
        m.metallic = 0;
        m.roughness = 0.35;
        m.clearCoat.isEnabled = true;
        m.clearCoat.intensity = 1;
        m.clearCoat.roughness = 0.02;
        break;
      }
      case 'teeth': {
        m.albedoColor = new Color3(0.78, 0.74, 0.66);
        m.metallic = 0;
        m.roughness = 0.35;
        break;
      }
      case 'emissive': {
        m.emissiveColor = new Color3(1, 0.8, 0.5).scale(spec.emissive ?? 3);
        m.albedoColor = new Color3(0.05, 0.04, 0.03);
        m.disableLighting = false;
        break;
      }
    }
    m.environmentIntensity = 1;
    const dis = new DissolvePlugin(m);
    set.dissolve.push(dis);
    set.materials.push(m);
    this.cache.set(key, m);
    return m;
  }

  /** Applies materials to an instantiated character by mesh name (`<prefix>:<part>`). */
  apply(meshes: AbstractMesh[], dir: string, manifest: CharacterManifest): CharacterMaterialSet {
    const set: CharacterMaterialSet = { materials: [], dissolve: [], emissive: [] };
    for (const mesh of meshes) {
      const base = mesh.name.split(':').pop()!.replace(/_primitive\d+$/, '');
      const spec = manifest.parts[base];
      if (!spec) continue;
      mesh.material = this.build(dir, base, spec, set);
      mesh.receiveShadows = true;
      if (spec.kind === 'hair') mesh.alphaIndex = 1;
    }
    return set;
  }
}

export const ALPHA_TEST = Constants.ALPHA_DISABLE;
