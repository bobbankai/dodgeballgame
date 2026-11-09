import { Color3, CreateGround, Vector3 } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { withLayers } from '../render/materials/SurfaceLayers';

/** Every piece of each environment kit (tools/blender/*_kit.py). */
const KITS: Record<string, string[]> = {
  ashen: ['house_a', 'house_b', 'house_c', 'chapel', 'wall', 'wall_breach', 'tower', 'gatehouse', 'rampart', 'rampart_stairs', 'well',
    'statue_broken', 'brazier', 'cart', 'barrel', 'crate', 'beams', 'banner', 'rubble_a', 'rubble_b', 'rubble_c', 'tree_a', 'tree_b', 'throne'],
  drowned: ['column', 'column_broken', 'colonnade', 'arch', 'aqueduct', 'temple', 'insula', 'bridge', 'steps_wide', 'tier', 'statue_emperor',
    'rocks_a', 'rocks_b', 'coral_a', 'coral_b', 'boat', 'lamp', 'stele'],
  forest: ['tree_giant', 'tree_a', 'tree_b', 'tree_dead', 'roots_arch', 'root_wall', 'shrine', 'gate', 'log', 'mushrooms', 'mushroom_giant',
    'rocks_a', 'rocks_b', 'bush_a', 'bush_b', 'statue_sylvaris', 'stones'],
  photoscans: ['ph_fern_02', 'ph_shrub_02', 'ph_shrub_03', 'ph_shrub_04', 'ph_tree_stump_01', 'ph_tree_stump_02', 'ph_root_cluster_02',
    'ph_single_root', 'ph_dead_tree_trunk', 'ph_dead_tree_trunk_02', 'ph_moss_01', 'ph_boulder_01', 'ph_stone_01', 'ph_nettle_plant',
    'ph_weed_plant_02', 'ph_dry_branches_medium_01', 'ph_pine_roots'],
  sky: ['island_a', 'island_b', 'island_c', 'arena', 'tower', 'hall', 'cloister', 'shrine', 'bridge', 'stairs', 'wall_ruin', 'pillar_flags',
    'bell', 'spire', 'statue_vaeltris', 'debris_a', 'debris_b'],
};

/**
 * Dev stage (`?level=kitview&kit=sky`): one environment kit laid out on a grid on a flat yard with the
 * game's materials and lighting, to check pieces as the game draws them. Pieces sit in a row along +X
 * at `spacing` metres; `__level.spots` lists where each one stands.
 */
export class KitView extends Level {
  readonly id = 'kitview';
  readonly title = 'Kit View';
  spots: Record<string, Vector3> = {};

  async load(): Promise<void> {
    const g = this.game;
    const kit = g.params.get('kit') ?? 'sky';
    const names = KITS[kit] ?? [];
    const ground = this.own(CreateGround('kvGround', { width: 600, height: 200, subdivisions: 2 }, g.scene));
    ground.position.y = -0.02;
    const gm = this.own(g.mats.surface({ set: 'ash_cobble', tile: 1 / 3 }).clone('kvGroundMat'));
    withLayers(gm, { porosity: 0.8 });
    ground.material = gm;
    g.lighting.addStatic(ground, false);
    g.physics.addStaticMesh(ground);
    const env = new EnvKit(g.scene, g.assets, g.mats, g.lighting, `env/${kit === 'photoscans' ? 'forest' : kit}`, this.scope);
    const P: Placement[] = [];
    const spacing = Number(g.params.get('spacing') ?? 34);
    names.forEach((n, i) => {
      const at = new Vector3(i * spacing, n.startsWith('island') || n === 'arena' || n.startsWith('debris') ? 12 : 0, 0);
      this.spots[n] = at;
      P.push({ piece: n, position: at, yaw: Math.PI });
    });
    await env.placeAll(P);
    const col = env.finish();
    if (col) g.physics.addStaticMesh(col);
    this.own(env);
  }

  spawn(): { position: Vector3; yaw: number } {
    return { position: new Vector3(0, 0, -20), yaw: 0 };
  }

  atmosphere(): Atmos {
    // neutral daylight, so materials read as they are
    return {
      lighting: {
        sunColor: new Color3(1.0, 0.92, 0.82), sunIntensity: 4.2, sunElevation: 0.6, sunAzimuth: 2.4,
        skyFill: new Color3(0.55, 0.62, 0.75), groundFill: new Color3(0.25, 0.22, 0.2), fillIntensity: 0.12,
        environmentIntensity: 0.9, exposure: 1, contrast: 1, shadowDarkness: 0,
      },
      sky: { cloudCover: 0.35 },
      look: { fog: { density: 0.0006, volumeDensity: 0.002 } },
    };
  }
}
