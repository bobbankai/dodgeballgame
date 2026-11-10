// The material library. Models carry no cloth, leather or hair textures: each of their materials names what
// it is in a 'tb' tag (written by the Blender tools) and is built here from the shared texture sets, then
// every material gets the surface plugin.
import { AssetContainer, Color3, Material, PBRMaterial, Scene, Texture } from '@babylonjs/core';
import { SurfaceKind, SurfacePlugin } from './surface';

interface Tag { k: string; t?: string; c?: string; s?: number; r?: number; sheen?: number; k2?: string; curl?: number; d?: number; m?: number; e?: string; ei?: number }

const cache = new Map<string, Texture>();
export function libTexture(scene: Scene, file: string, scale = 1): Texture {
  const key = `${file}@${scale}`;
  let t = cache.get(key);
  if (!t || t.getScene() !== scene) {
    t = new Texture(`assets/tex/${file}`, scene, false, false);
    t.uScale = t.vScale = scale;
    t.anisotropicFilteringLevel = 8;
    cache.set(key, t);
  }
  return t;
}

export const hex = (h: string) => Color3.FromHexString(h).toLinearSpace();
export const plugin = (m: Material) => m.pluginManager?.getPlugin<SurfacePlugin>('TbSurface') ?? null;

function surface(m: PBRMaterial, kind: SurfaceKind, porous: number, sheen: number, rim = 1) {
  const p = new SurfacePlugin(m, kind);
  p.porous = porous; p.sheen = sheen; p.rim = rim;
  return p;
}

/** Texture set from the library on a material: colour (tinted), normal, occlusion/roughness/metal. */
export function useSet(m: PBRMaterial, scene: Scene, set: string, tiles: number, tint: Color3, rough = 1, metal = 0) {
  m.albedoTexture = libTexture(scene, `${set}_d.webp`, tiles);
  m.albedoColor = tint;
  m.bumpTexture = libTexture(scene, `${set}_n.webp`, tiles);
  m.metallicTexture = libTexture(scene, `${set}_r.webp`, tiles);
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useRoughnessFromMetallicTextureAlpha = false;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.roughness = rough;
  m.metallic = metal;
  m.invertNormalMapX = false;
  m.invertNormalMapY = true; // OpenGL normal maps in a right-handed scene, as the glTF loader sets them
}

/** Build every tagged material of a loaded model. */
export function applyLibrary(c: AssetContainer, scene: Scene) {
  for (const mat of c.materials) {
    if (!(mat instanceof PBRMaterial) || plugin(mat)) continue;
    const raw = mat.metadata?.gltf?.extras?.tb;
    const tag: Tag = raw ? JSON.parse(raw) : { k: 'pbr' };
    const tint = tag.c ? hex(tag.c) : mat.albedoColor;
    switch (tag.k) {
      case 'skin': {
        mat.detailMap.texture = libTexture(scene, 'pores.png', 30);
        mat.detailMap.isEnabled = true;
        mat.detailMap.diffuseBlendLevel = 0.22;
        mat.detailMap.bumpLevel = 0.55;
        mat.detailMap.roughnessBlendLevel = 0.35;
        mat.subSurface.isTranslucencyEnabled = true;   // light bleeding through ears, nostrils, fingers
        mat.subSurface.translucencyIntensity = 0.3;
        mat.subSurface.tintColor = new Color3(0.9, 0.32, 0.22);
        mat.subSurface.minimumThickness = 0.2;
        mat.subSurface.maximumThickness = 2.5;
        mat.subSurface.useAlbedoToTintTranslucency = true;
        surface(mat, 'skin', 0, 1, 1).bruises = mat.name.endsWith('_head') ? 1 : 0;
        break;
      }
      case 'cloth': {
        useSet(mat, scene, tag.t!, tag.s ?? 14, tint, tag.r ?? 1);
        const leather = tag.k2 === 'leather';
        if (tag.sheen) { mat.sheen.isEnabled = true; mat.sheen.intensity = tag.sheen; mat.sheen.roughness = 0.35; mat.sheen.color = tint.scale(1.6).add(new Color3(0.15, 0.15, 0.15)); }
        if (leather) { mat.clearCoat.isEnabled = true; mat.clearCoat.intensity = 0.35; mat.clearCoat.roughness = 0.3; }
        surface(mat, 'cloth', leather ? 0.3 : 1, leather ? 1 : 0.7);
        break;
      }
      case 'shell': {
        mat.albedoTexture = libTexture(scene, 'shell.png', 1);
        mat.albedoColor = tint;
        mat.useAlphaFromAlbedoTexture = true;
        mat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST;
        mat.alphaCutOff = 0.42;
        mat.backFaceCulling = false;
        mat.roughness = 0.62;
        mat.metallic = 0;
        mat.sheen.isEnabled = true;
        mat.sheen.intensity = 0.4;
        mat.sheen.color = tint.scale(3).add(new Color3(0.12, 0.1, 0.08));
        surface(mat, tag.d && tag.d < 1 ? 'fuzz' : 'hair', 0.5, 0.6).erode = 0.42;
        break;
      }
      case 'hair': {
        mat.albedoColor = tint;
        mat.bumpTexture = libTexture(scene, tag.curl ? 'coils_n.webp' : 'strands_n.webp', 1);
        mat.bumpTexture.level = tag.curl ? 1.4 : 0.9;
        mat.invertNormalMapX = false; mat.invertNormalMapY = true;
        mat.roughness = tag.curl ? 0.72 : 0.36;
        mat.metallic = 0;
        if (!tag.curl) { mat.anisotropy.isEnabled = true; mat.anisotropy.intensity = 0.75; mat.anisotropy.direction.set(0, 1); }
        mat.sheen.isEnabled = true;
        mat.sheen.intensity = 0.35;
        mat.sheen.color = tint.scale(3).add(new Color3(0.12, 0.1, 0.08));
        surface(mat, tag.curl ? 'fuzz' : 'hair', 0.4, 0.8).erode = 0.26;
        break;
      }
      default: {
        if (tag.c) mat.albedoColor = tint;
        if (tag.r !== undefined) mat.roughness = tag.r;
        if (tag.m !== undefined) mat.metallic = tag.m;
        const eye = mat.name.startsWith('eye_');
        if (eye) { mat.clearCoat.isEnabled = true; mat.clearCoat.intensity = 1; mat.clearCoat.roughness = 0.02; mat.clearCoat.indexOfRefraction = 1.38; mat.roughness = 0.3; }
        if (mat.name === 'teeth') { mat.clearCoat.isEnabled = true; mat.clearCoat.intensity = 0.6; mat.clearCoat.roughness = 0.12; }
        surface(mat, 'hard', 0, eye ? 0 : 1, eye ? 0 : 1);
      }
    }
  }
}
