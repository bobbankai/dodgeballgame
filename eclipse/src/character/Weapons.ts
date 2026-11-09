import { Color3, PBRMaterial, Texture, type AbstractMesh, type Scene, type TransformNode } from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import type { Character } from './Character';
import type { Lighting } from '../render/Lighting';
import { assetUrl } from '../assets/paths';
import { DissolvePlugin } from '../render/materials/FxPlugins';

/** Weapon geometry info used by combat (blade segment in the weapon's local space, metres). */
export interface WeaponSpec {
  id: string;
  /** blade base and tip along local +Y */
  base: number;
  tip: number;
  radius: number;
  /** Glow strength of the weapon's emissive map (0 = none). */
  emissive?: number;
}

export const WEAPONS: Record<string, WeaponSpec> = {
  oathkeeper: { id: 'oathkeeper', base: 0.06, tip: 0.98, radius: 0.06 },
  ashblade: { id: 'ashblade', base: 0.05, tip: 0.83, radius: 0.05 },
  cinder_greatsword: { id: 'cinder_greatsword', base: 0.12, tip: 1.46, radius: 0.07, emissive: 2.6 },
  cinderfall: { id: 'cinderfall', base: 0.12, tip: 1.46, radius: 0.07, emissive: 4 },
  reaver_spear: { id: 'reaver_spear', base: 0.9, tip: 1.78, radius: 0.05 },
  trident: { id: 'trident', base: 1.1, tip: 2.2, radius: 0.1, emissive: 2.5 },
};

const matCache = new Map<string, PBRMaterial>();

function weaponMaterial(scene: Scene, id: string): PBRMaterial {
  let m = matCache.get(id);
  if (m && m.getScene() === scene) return m;
  m = new PBRMaterial(`weapon_${id}`, scene);
  const t = (s: string, srgb: boolean) => {
    const tx = new Texture(assetUrl(`weapons/${id}_${s}.webp`), scene, { invertY: false });
    tx.gammaSpace = srgb;
    tx.anisotropicFilteringLevel = 8;
    return tx;
  };
  m.albedoTexture = t('c', true);
  m.bumpTexture = t('n', false);
  m.invertNormalMapX = !scene.useRightHandedSystem;
  m.invertNormalMapY = scene.useRightHandedSystem;
  m.metallicTexture = t('orm', false);
  m.useAmbientOcclusionFromMetallicTextureRed = true;
  m.useRoughnessFromMetallicTextureGreen = true;
  m.useMetallnessFromMetallicTextureBlue = true;
  m.metallic = 1;
  m.roughness = 1;
  const glow = WEAPONS[id]?.emissive ?? 0;
  if (glow > 0) {
    m.emissiveTexture = t('e', true);
    m.emissiveColor = new Color3(glow, glow, glow);
  }
  new DissolvePlugin(m);
  matCache.set(id, m);
  return m;
}

/** Instantiates a weapon model and parents it to a character socket (grip at the socket origin). */
export async function attachWeapon(scene: Scene, assets: AssetManager, c: Character, id: string, socket: string, lighting?: Lighting): Promise<TransformNode> {
  const inst = await assets.instantiate(`weapons/${id}.glb`, `${c.root.name}:${id}`);
  const node = c.socket(socket);
  inst.root.parent = node;
  inst.root.position.setAll(0);
  // the glTF root carries the handedness conversion; keep it, the sword's +Y is the blade
  const mat = weaponMaterial(scene, id);
  for (const m of inst.meshes as AbstractMesh[]) {
    m.material = mat;
    m.receiveShadows = true;
    lighting?.addCaster(m, false);
  }
  return inst.root;
}
