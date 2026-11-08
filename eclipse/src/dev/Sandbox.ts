import { Color3, CreateBox, CreateGround, CreateSphere, CreateTorusKnot, Vector3, type Scene } from '@babylonjs/core';
import type { MaterialLibrary } from '../render/Materials';
import type { Lighting } from '../render/Lighting';
import type { Physics } from '../physics/Physics';

/** A lighting and material test bench (`?level=sandbox`). Not part of the game. */
export function buildSandbox(scene: Scene, mats: MaterialLibrary, lighting: Lighting, physics: Physics): void {
  const ground = CreateGround('ground', { width: 120, height: 120, subdivisions: 4 }, scene);
  ground.material = mats.surface({ set: 'ash_cobble', tile: 24 });
  lighting.addStatic(ground, false);
  physics.addStaticMesh(ground);
  const sets = ['ash_castle_brick', 'sea_mossy_wall', 'sky_cliff', 'wood_mossy_rock', 'sun_marble', 'cloth_metal_plate'];
  sets.forEach((set, i) => {
    const b = CreateBox(`wall_${set}`, { width: 3, height: 4, depth: 3 }, scene);
    b.position.set(-12 + i * 5, 2, -6);
    b.material = mats.surface({ set, tile: 1.5 });
    lighting.addStatic(b);
    physics.addStaticMesh(b);
  });
  const metals: [string, Color3, number, number][] = [
    ['gold', new Color3(1.0, 0.78, 0.34), 0.25, 1],
    ['steel', new Color3(0.8, 0.8, 0.82), 0.35, 1],
    ['skinish', new Color3(0.8, 0.55, 0.45), 0.55, 0],
    ['black', new Color3(0.03, 0.03, 0.035), 0.15, 0],
  ];
  metals.forEach(([name, c, r, m], i) => {
    const s = CreateSphere(`ball_${name}`, { diameter: 1.6, segments: 48 }, scene);
    s.position.set(-6 + i * 4, 0.8, 2);
    s.material = mats.plain(name, c, r, m);
    lighting.addCaster(s);
    s.receiveShadows = true;
  });
  const knot = CreateTorusKnot('knot', { radius: 1.1, tube: 0.35, radialSegments: 128, tubularSegments: 32 }, scene);
  knot.position.set(8, 2.2, 3);
  knot.material = mats.surface({ set: 'cloth_rust', tile: 2 });
  lighting.addCaster(knot);
  knot.receiveShadows = true;
  scene.onBeforeRenderObservable.add(() => {
    knot.rotation.y += 0.004;
  });
  scene.activeCamera!.position = new Vector3(0, 4.5, 16);
}
