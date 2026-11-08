import { CreateGround, Vector3, type Scene, type UniversalCamera } from '@babylonjs/core';
import type { AssetManager } from '../assets/AssetManager';
import { CharacterMaterials } from '../character/CharacterMaterials';
import { Character } from '../character/Character';
import { AnimLibrary } from '../anim/AnimLibrary';
import type { MaterialLibrary } from '../render/Materials';
import type { Lighting } from '../render/Lighting';
import { withLayers } from '../render/materials/SurfaceLayers';
import { attachWeapon } from '../character/Weapons';

/** Character inspection stage (`?level=viewer&char=kael&anim=walk`). Not part of the game. */
export async function buildViewer(scene: Scene, assets: AssetManager, mats: MaterialLibrary, lighting: Lighting,
  camera: UniversalCamera, char: string, anim: string | null): Promise<Character> {
  const ground = CreateGround('stage', { width: 30, height: 30 }, scene);
  const gm = mats.surface({ set: 'ash_cobble', tile: 10 }).clone('stageMat');
  withLayers(gm, { porosity: 0.8 });
  ground.material = gm;
  lighting.addStatic(ground, false);
  const lib = await AnimLibrary.load(assets, 'human');
  const c = await Character.create(scene, assets, new CharacterMaterials(scene), lib, char, char);
  for (const m of c.meshes) lighting.addCaster(m, false);
  await attachWeapon(scene, assets, c, 'oathkeeper', 'weapon_r', lighting);
  if (anim && c.animator.clips.has(anim)) {
    const clip = c.animator.clips.get(anim);
    if (clip.loop) {
      c.animator.setLocomotion([{ clip: anim, speed: 0 }]);
    } else {
      c.animator.setLocomotion([{ clip: c.animator.clips.has('idle_combat') ? 'idle_combat' : 'idle', speed: 0 }]);
      const replay = () => c.animator.play(anim, { fade: 0.1, onEnd: () => setTimeout(replay, 300) });
      replay();
    }
  } else {
    c.animator.setLocomotion([{ clip: 'idle', speed: 0 }]);
  }
  const h = c.manifest.height || 1.85;
  camera.position = new Vector3(1.6, h * 0.75, 3.4);
  camera.setTarget(new Vector3(0, h * 0.5, 0));
  return c;
}
