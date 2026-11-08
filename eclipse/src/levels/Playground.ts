import { Color3, CreateBox, CreateGround, Vector3 } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { TrainingDummy } from '../combat/Dummy';
import { withLayers } from '../render/materials/SurfaceLayers';
import { Navigation } from '../ai/Navigation';
import { IGNAROTH } from '../ai/bosses/Ignaroth';
import type { BossDef } from '../ai/Boss';
import type { AbstractMesh } from '@babylonjs/core';

/** Combat test arena (`?level=playground`): flat stone yard, walls, steps and training posts. */
export class Playground extends Level {
  readonly id = 'playground';
  readonly title = 'Training Yard';
  dummies: TrainingDummy[] = [];

  async load(): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    const walk: AbstractMesh[] = [];
    const ground = CreateGround('yard', { width: 80, height: 80, subdivisions: 2 }, scene);
    const gm = g.mats.surface({ set: 'ash_cobble', tile: 30 }).clone('yardMat');
    withLayers(gm, { porosity: 0.8, allowPuddles: true });
    ground.material = gm;
    g.lighting.addStatic(ground, false);
    g.physics.addStaticMesh(ground);
    walk.push(ground);
    const wallMat = g.mats.surface({ set: 'ash_castle_brick', tile: 2 });
    for (const [x, z, w, d] of [[0, -20, 40, 1.5], [0, 20, 40, 1.5], [-20, 0, 1.5, 40], [20, 0, 1.5, 40]] as const) {
      const wall = CreateBox('wall', { width: w, depth: d, height: 4 }, scene);
      wall.position.set(x, 2, z);
      wall.material = wallMat;
      g.lighting.addStatic(wall);
      g.physics.addStaticMesh(wall);
      walk.push(wall);
    }
    // steps and a raised platform for jumps and landings
    for (let i = 0; i < 6; i++) {
      const step = CreateBox('step', { width: 4, depth: 0.6, height: 0.3 * (i + 1) }, scene);
      step.position.set(10, 0.15 * (i + 1), -8 + i * 0.6);
      step.material = wallMat;
      g.lighting.addStatic(step);
      g.physics.addStaticMesh(step);
      walk.push(step);
    }
    const plat = CreateBox('platform', { width: 6, depth: 6, height: 1.8 }, scene);
    plat.position.set(10, 0.9, -1.4);
    plat.material = wallMat;
    g.lighting.addStatic(plat);
    g.physics.addStaticMesh(plat);
    walk.push(plat);
    for (const p of [new Vector3(0, 0, 6), new Vector3(-3, 0, 8), new Vector3(3, 0, 8)]) {
      const d = new TrainingDummy(scene, g.combat, g.mats, p);
      g.lighting.addStatic(d.mesh);
      this.dummies.push(d);
    }
    for (const m of walk) this.own(m);
    // `?enemies=thrall,thrall,cinder_knight` spawns a test group across the yard
    const list = g.params.get('enemies');
    const bossId = g.params.get('boss');
    if (list || bossId) g.nav = await Navigation.build(walk);
    const BOSSES: Record<string, BossDef> = { ignaroth: IGNAROTH };
    if (bossId && BOSSES[bossId]) {
      const b = await g.enemies.spawnBoss(BOSSES[bossId], new Vector3(0, 0, 13), Math.PI);
      g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
      b.spawnAdds = (at, n) => {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          void g.enemies.spawn('thrall', at.add(new Vector3(Math.sin(a) * 4, 0, Math.cos(a) * 4)), { aggro: true });
        }
      };
      b.events.on('died', () => g.hud.showBoss(null));
    }
    if (list) {
      const ids = list.split(',').filter(Boolean);
      for (let i = 0; i < ids.length; i++) {
        const a = (i / ids.length) * Math.PI - Math.PI / 2;
        const at = new Vector3(Math.sin(a) * 7, 0, 12 + Math.cos(a) * 3);
        await g.enemies.spawn(ids[i], at, { yaw: Math.PI });
      }
    }
  }

  spawn(): { position: Vector3; yaw: number } {
    return { position: new Vector3(0, 0, 0), yaw: 0 };
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        sunColor: new Color3(1.0, 0.88, 0.72), sunIntensity: 4.5, sunElevation: 0.62, sunAzimuth: 2.3,
        skyFill: new Color3(0.55, 0.62, 0.75), groundFill: new Color3(0.25, 0.2, 0.17), fillIntensity: 0.1,
        environmentIntensity: 0.9, exposure: 1, contrast: 1, shadowDarkness: 0,
      },
      sky: { cloudCover: 0.45 },
      look: { fog: { density: 0.0012, volumeDensity: 0.006 } },
    };
  }

  override update(dt: number): void {
    for (const d of this.dummies) d.update(dt);
  }
}
