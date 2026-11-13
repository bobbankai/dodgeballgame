import {
  Color3, Constants, CreateBox, CreateGround, CreatePlane, CreateSphere, CreateTorusKnot, RawTexture, Texture,
  Vector3, VertexBuffer, type Mesh, type Scene,
} from '@babylonjs/core';
import type { MaterialLibrary } from '../render/Materials';
import type { Lighting } from '../render/Lighting';
import type { Physics } from '../physics/Physics';
import { createTerrainMaterial } from '../render/materials/Terrain';
import { withLayers } from '../render/materials/SurfaceLayers';
import { DissolvePlugin, EmissiveFxPlugin, WindPlugin } from '../render/materials/FxPlugins';
import { MatEnv } from '../render/materials/EcPlugin';

/** A lighting and material test bench (`?level=sandbox`). Not part of the game. */
export async function buildSandbox(scene: Scene, mats: MaterialLibrary, lighting: Lighting, physics: Physics): Promise<void> {
  // terrain: noise hills with a cliff, height-blended layers
  const ground = CreateGround('terrain', { width: 140, height: 140, subdivisions: 160, updatable: true }, scene);
  const pos = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const hgt = (x: number, z: number) => {
    const ridge = Math.max(0, 1 - Math.abs(z + 26) / 10) * 9;
    return Math.sin(x * 0.07) * 1.4 + Math.cos(z * 0.09 + x * 0.03) * 1.1 + ridge * (0.6 + 0.4 * Math.sin(x * 0.11));
  };
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = hgt(pos[i], pos[i + 2]);
  ground.updateVerticesData(VertexBuffer.PositionKind, pos);
  ground.createNormals(true);
  const S = 128;
  const splat = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const wx = (x / S - 0.5) * 140;
      const wz = (y / S - 0.5) * 140;
      const n = 0.5 + 0.5 * Math.sin(wx * 0.11 + Math.cos(wz * 0.07) * 2);
      const path = Math.max(0, 1 - Math.abs(wx - Math.sin(wz * 0.05) * 6) / 3);
      const i = (y * S + x) * 4;
      splat[i] = Math.round(255 * Math.max(0, 1 - path) * n);
      splat[i + 1] = Math.round(255 * Math.max(0, 1 - path) * (1 - n));
      splat[i + 2] = Math.round(255 * path);
      splat[i + 3] = 0;
    }
  }
  const splatTex = new RawTexture(splat, S, S, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  splatTex.wrapU = splatTex.wrapV = Texture.CLAMP_ADDRESSMODE;
  ground.material = await createTerrainMaterial(scene, 'sandboxTerrain', {
    layers: ['ash_burned_ground', 'ash_mud', 'ash_cobble', 'ash_rock'],
    tiles: [4, 5, 2.5, 6],
    splat: splatTex,
    origin: [-70, -70],
    size: [140, 140],
  });
  lighting.addStatic(ground, false);
  physics.addStaticMesh(ground);

  const sets = ['ash_castle_brick', 'sea_mossy_wall', 'sky_cliff', 'wood_mossy_rock', 'sun_marble', 'cloth_metal_plate'];
  sets.forEach((set, i) => {
    const b = CreateBox(`wall_${set}`, { width: 3, height: 4, depth: 3 }, scene);
    b.position.set(-12 + i * 5, hgt(-12 + i * 5, -6) + 2, -6);
    const m = mats.surface({ set, tile: 1.5 }).clone(`wallmat_${set}`);
    withLayers(m, { porosity: set.includes('metal') ? 0.1 : 0.85 });
    b.material = m;
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
    s.position.set(-6 + i * 4, hgt(-6 + i * 4, 2) + 0.8, 2);
    s.material = mats.plain(name, c, r, m);
    lighting.addCaster(s);
    s.receiveShadows = true;
  });
  // lava knot: emissive flow
  const knot = CreateTorusKnot('knot', { radius: 1.1, tube: 0.35, radialSegments: 128, tubularSegments: 32 }, scene);
  knot.position.set(9, hgt(9, 3) + 2.2, 3);
  const lava = mats.surface({ set: 'ash_dark_rock', tile: 2 }).clone('lava');
  lava.emissiveColor = new Color3(3.5, 0.9, 0.15);
  lava.emissiveTexture = lava.albedoTexture;
  const fx = new EmissiveFxPlugin(lava);
  fx.flowSpeed = 0.35;
  fx.flowScale = 1.2;
  knot.material = lava;
  lighting.addCaster(knot);
  knot.receiveShadows = true;
  // dissolving and energy spheres
  const dis = CreateSphere('dissolve', { diameter: 2, segments: 48 }, scene);
  dis.position.set(-10, hgt(-10, 4) + 1.2, 4);
  const dm = mats.surface({ set: 'cloth_metal_plate', tile: 1 }).clone('dissolveMat');
  const dp = new DissolvePlugin(dm);
  dp.setAmount(0.42);
  dis.material = dm;
  lighting.addCaster(dis);
  const orb = CreateSphere('energy', { diameter: 1.4, segments: 48 }, scene);
  orb.position.set(13, hgt(13, 0) + 1.2, 0);
  const om = mats.plain('energyMat', new Color3(0.05, 0.08, 0.15), 0.2, 0).clone('energyMat2');
  om.emissiveColor = new Color3(0.2, 0.5, 1.4);
  const ofx = new EmissiveFxPlugin(om);
  ofx.rimStrength = 4;
  ofx.rimColor = new Color3(0.4, 0.8, 2.5);
  ofx.pulseAmount = 0.35;
  orb.material = om;
  // banner in the wind
  const banner = CreatePlane('banner', { width: 1.6, height: 4, sideOrientation: 2 }, scene) as Mesh;
  banner.position.set(4, hgt(4, -1) + 2.5, -1);
  const bm = mats.surface({ set: 'cloth_jacquard', tile: 1, twoSided: true }).clone('bannerMat');
  bm.albedoColor = new Color3(0.6, 0.12, 0.1);
  const wind = new WindPlugin(bm);
  wind.bendHeight = 2;
  wind.flutter = 0.06;
  bm.backFaceCulling = false;
  banner.material = bm;
  banner.bakeTransformIntoVertices(banner.getWorldMatrix());
  banner.position.set(4, hgt(4, -1) + 0.5, -1);
  lighting.addCaster(banner);

  MatEnv.coverAmount = 0.55;
  MatEnv.coverColor = new Color3(0.36, 0.35, 0.34);
  MatEnv.wetness = 0.45;
  MatEnv.windStrength = 0.35;
  scene.onBeforeRenderObservable.add(() => {
    knot.rotation.y += 0.004;
  });
  scene.activeCamera!.position = new Vector3(0, hgt(0, 16) + 4.5, 16);
  void Vector3;
}
