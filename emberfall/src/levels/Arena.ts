// Dev arena: flat clearing for tuning combat (?level=arena).
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import { applyAtmosphere, buildTerrain, fbm, place, rand, scatter, type Xform } from './common';
import { FOOTMAN, BRUTE, withFallback } from './enemies';

export class Arena implements Level {
  id = 'arena';
  chapter = 0;
  title = 'Arena';
  checkpoints = ['start'];

  async load(game: Game): Promise<void> {
    applyAtmosphere(game, {
      sun: new THREE.Vector3(0.5, 0.42, -0.55), lightIntensity: 4.2, mie: 1.6, clouds: 0.45,
      fog: { density: 0.006, farDensity: 0.003, falloff: 0.1 },
      grade: { exposure: 1.0, contrast: 1.06, saturation: 1.05 },
    });
    buildTerrain(game, {
      size: 160, seg: 160,
      height: (x, z) => {
        const r = Math.hypot(x, z);
        return (fbm(x * 0.05, z * 0.05) - 0.5) * 1.2 * Math.min(1, r / 20) + Math.max(0, r - 30) * 0.35;
      },
      splat: (x, z, _h, slope) => {
        const n = fbm(x * 0.15, z * 0.15, 3, 5);
        return [Math.max(0, 1 - slope * 3) * (0.5 + n), 0.3 * (1 - n), 0.2, slope * 4];
      },
      layers: [{ name: 'grass_path_2', scale: 3.5 }, { name: 'muddy_tracks', scale: 4 }, { name: 'forest_ground_04', scale: 3 }, { name: 'rocks_ground_02', scale: 4 }],
    });
    await Promise.all([
      place(game, 'assets/env/rock_moss_set_01.glb', 10, -12, { rot: 0.4 }),
      place(game, 'assets/env/boulder_01.glb', -9, -14, { rot: 1.2, scale: 1.4 }),
      place(game, 'assets/env/stone_fire_pit.glb', 0, 6),
    ]);
    // a ring of trees (every kind, three variants) round the clearing
    const r = rand(7);
    const kinds = ['pine', 'maple', 'cedar', 'bamboo', 'dead'];
    const jobs: Promise<unknown>[] = [];
    for (const k of kinds) for (let v = 0; v < 3; v++) {
      const list: Xform[] = [];
      for (let i = 0; i < 6; i++) {
        const a = r() * Math.PI * 2, d = 18 + r() * 24;
        list.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, rot: r() * 6.28, scale: 0.85 + r() * 0.3 });
      }
      jobs.push(scatter(game, `assets/env/trees/${k}_${v}.glb`, list, { tree: true, trunk: k === 'bamboo' ? 0.4 : 0.3 }));
    }
    await Promise.all(jobs);
    game.light({ position: new THREE.Vector3(0, 0.8, 6), color: new THREE.Color(1, 0.55, 0.25), intensity: 18, distance: 14, flicker: 0.35 });
    game.particles.emitter('fire', new THREE.Vector3(0, 0.3, 6), 30, 0.25);
    game.particles.emitter('ember', new THREE.Vector3(0, 0.6, 6), 6, 0.3);
  }

  async run(game: Game): Promise<void> {
    game.player.teleport(new THREE.Vector3(0, 0, 3), Math.PI);
    game.cam.snapBehind(Math.PI);
    game.setCheckpoint('start', new THREE.Vector3(0, 0, 3), Math.PI);
    await game.hud.fade(0, 1.2);
    const lib = game.player.char.animator;
    const have = (c: string) => lib.has(c);
    const fm = await modelExists('assets/chars/hollow_footman.glb');
    const bm = await modelExists('assets/chars/hollow_brute.glb');
    for (let wave = 0; ; wave++) {
      const list = [];
      for (let i = 0; i < 3; i++) list.push(await game.spawn(withFallback(FOOTMAN, have, fm), new THREE.Vector3(-4 + i * 4, 0, -8), 0));
      if (wave % 2 === 1) list.push(await game.spawn(withFallback(BRUTE, have, bm), new THREE.Vector3(0, 0, -12), 0));
      game.hud.objective(`Wave ${wave + 1}: defeat the Hollow`);
      await game.waitDefeated(list);
      await game.wait(2);
    }
  }
}

const exists = new Map<string, Promise<boolean>>();
export function modelExists(url: string): Promise<boolean> {
  let p = exists.get(url);
  if (!p) {
    p = fetch(url, { method: 'HEAD' }).then((r) => r.ok && (r.headers.get('content-type') ?? '').indexOf('html') < 0).catch(() => false);
    exists.set(url, p);
  }
  return p;
}
