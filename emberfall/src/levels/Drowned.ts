// Chapter Two — The Drowned Shrine. Night, rain. A road through giant cedars opens onto a flooded shrine
// precinct: a wading causeway under a row of drowned torii, lanterns standing in the water, the island
// with its bell tower where Hisame, Hollowed by grief, keeps a dead Ember.
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import type { Enemy } from '../game/Enemy';
import { NPC } from '../game/NPC';
import { applyAtmosphere, paving, place, rand } from './common';
import { FOOTMAN, SPEARMAN, WRAITH, BRUTE, HISAME } from './enemies';
import { ribbon, waterMesh } from '../render/Water';
import { PlanarMirror } from '../render/Mirror';
import { G } from '../render/MaterialFX';
import { Valley, sstep } from './valley';
import { fbm } from './common';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const K = 'assets/env/village/';
const R = 'assets/env/rocks/';
const ISLAND = new THREE.Vector2(0, 88);
const ISLAND_Y = 1.2;
const WATER_Y = 0;

const valley = new Valley({
  seed: 21,
  hills: 18,
  path: [
    [0, -150, 6], [5, -130, 6.5], [-5, -108, 7], [3, -86, 6.5], [9, -64, 5.5], [3, -42, 4], [0, -24, 2.0], [0, -8, 0.6],
    [0, 4, -0.28], [-2, 24, -0.28], [2, 44, -0.28], [0, 60, -0.1], [0, 72, ISLAND_Y], [0, 100, ISLAND_Y],
  ],
  width: [8, 8, 7, 8, 8, 9, 11, 13, 3.2, 3.2, 3.2, 3.5, 12, 14],
  shape: (x, z, y, p) => {
    // the flooded basin: deep water either side of the causeway, an island plateau at the far end
    const basin = sstep(72, 56, Math.abs(x)) * sstep(-10, 2, z) * sstep(130, 116, z);
    if (basin > 0) {
      const floor = -2.4 + (fbm(x * 0.05, z * 0.05, 3, 4) - 0.5) * 1.2;
      const wade = z < 66 ? sstep(p.w + 1.2, p.w - 0.4, p.d) : 0;
      let lake = floor * (1 - wade) + -0.28 * wade;
      const di = Math.hypot(x - ISLAND.x, (z - ISLAND.y) * 0.85);
      const isl = sstep(21, 16, di);
      lake = lake * (1 - isl) + ISLAND_Y * isl + (isl > 0.99 ? (fbm(x * 0.3, z * 0.3, 2, 7) - 0.5) * 0.05 : 0);
      y = y * (1 - basin) + Math.min(y, lake) * basin;
    }
    return y;
  },
});
const H = (x: number, z: number) => valley.height(x, z);

export class Drowned implements Level {
  id = 'drowned';
  chapter = 2;
  title = 'The Drowned Shrine';
  checkpoints = ['start', 'cedars', 'mist', 'shore', 'causeway', 'island', 'end'];
  private game!: Game;
  private brazierPos = V(0, ISLAND_Y, 80);
  private brazierLight: ReturnType<Game['light']> | null = null;
  private lightningT = 6;
  private flash = 0;
  private thunderAt = -1;
  private moonIntensity = 0.55;
  private rainK = 1;

  async load(game: Game): Promise<void> {
    this.game = game;
    applyAtmosphere(game, {
      sun: V(0.35, 0.55, -0.6), night: true, sunPower: 0.9, lightIntensity: this.moonIntensity, mie: 2.6, rayleigh: 1.0,
      tint: new THREE.Color(0.75, 0.85, 1.0), clouds: 0.92, cloudDensity: 1.0, cloudTint: new THREE.Color(0.55, 0.6, 0.7), stars: 0.2, skyGain: 0.8, env: 0.55,
      fog: { density: 0.018, falloff: 0.09, baseHeight: -0.5, farDensity: 0.006, anisotropy: 0.45, noise: 0.7, tint: new THREE.Color(0.42, 0.5, 0.62), sunScatter: 0.6, skyFog: 0.7 },
      grade: { exposure: 1.25, temperature: -0.12, contrast: 1.1, saturation: 0.92, vignette: 0.5, shadowTint: new THREE.Color(0.38, 0.45, 0.62), highlightTint: new THREE.Color(0.58, 0.52, 0.45), splitBalance: -0.05, expMax: 3.2 },
      bloom: 0.9,
    });
    G.uWind.value.set(0.9, 0.4, 0.75, 0.2);
    G.uWetness.value = 1;
    G.uRain.value = 1;
    game.envFx = { wet: true };
    game.weather.setRain(9000, 0.42);

    const layers = [
      { name: 'mud_leaves', scale: 3.2, tint: new THREE.Color(0.75, 0.8, 0.72) },
      { name: 'forest_leaves', scale: 3.0, tint: new THREE.Color(0.6, 0.62, 0.55) },
      { name: 'mossy_cobblestone', scale: 2.6 },
      { name: 'rock_moss2', scale: 7, depth: 0.05, tint: new THREE.Color(0.7, 0.75, 0.72) },
    ];
    const farLayers = [
      { name: 'mud_leaves', scale: 6, tint: new THREE.Color(0.4, 0.45, 0.38) },
      { name: 'forest_leaves', scale: 6, tint: new THREE.Color(0.32, 0.34, 0.3) },
      { name: 'mossy_cobblestone', scale: 6 },
      { name: 'rock_moss2', scale: 14, tint: new THREE.Color(0.5, 0.55, 0.52) },
    ];
    valley.build(game, layers, farLayers, (x, z, h, slope) => {
      const p = valley.near(x, z);
      const road = z < -6 ? sstep(3.4, 1.4, p.d) : 0;
      const plaza = Math.hypot(x - ISLAND.x, z - ISLAND.y) < 15 ? 0.6 : 0;
      const rock = sstep(0.22, 0.42, slope) + (h < -0.6 ? 0.6 : 0);
      const leaves = sstep(1, 10, p.d - p.w) * 0.8 + sstep(0.5, 0.75, fbm(x * 0.09, z * 0.09, 3, 5)) * 0.5;
      const path = Math.min(1, road + plaza);
      const steep = sstep(0.22, 0.42, slope);
      return [Math.max(0, 1 - path - rock - leaves) * (1 - steep), leaves * (1 - path) * (1 - steep), path * (1 - steep), Math.min(1, rock)];
    }, new THREE.Vector2(0, -20), { wet: true });

    const jobs: Promise<unknown>[] = [];
    const r = rand(2);
    // ---------------------------------------------------------------- the cedar road: lanterns, a broken shrine gate
    for (let i = 0; i < 9; i++) {
      const z = -140 + i * 15;
      const p = valley.s.path.reduce((a, q) => (Math.abs(q[1] - z) < Math.abs(a[1] - z) ? q : a));
      for (const side of [-1, 1]) {
        if (r() < 0.25) continue;
        jobs.push(place(game, K + 'lantern_stone.glb', p[0] + side * 4.6, z, { rot: r() * 6, scale: 0.85, tilt: new THREE.Euler((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12) }));
      }
      if (i % 2 === 0) game.light({ position: V(p[0] + 4.6 * (i % 4 === 0 ? 1 : -1), H(p[0], z) + 1.6, z), color: new THREE.Color(1, 0.62, 0.3), intensity: 7, distance: 11, flicker: 0.25 });
    }
    jobs.push(place(game, K + 'torii.glb', -2, -100, { scale: 1.0, rot: 0.1, tilt: new THREE.Euler(0, 0, 0.08) }));
    jobs.push(place(game, K + 'minka_burnt_b.glb', 18, -60, { rot: -Math.PI / 2 + 0.3 }));

    // ---------------------------------------------------------------- the flooded precinct
    const mirror = new PlanarMirror(WATER_Y, game.pipe.quality.planarReflection);
    game.pipe.mirrors.push(mirror);
    const lake = waterMesh(game.pipe, ribbon([V(-80, WATER_Y, 58), V(80, WATER_Y, 58)], 150, V(0, 1, 0), 24), {
      speed: 0.25, scale: 0.7, strength: 0.28, bankFoam: 0.0, alpha: [0.78, 0.98], mirror,
      deep: new THREE.Color(0.01, 0.025, 0.035), shallow: new THREE.Color(0.03, 0.06, 0.07),
    });
    game.levelRoot.add(lake);
    mirror.hide.push(lake, game.particles.group, game.weather.group);
    // the drowned torii: a row along the causeway, sinking and leaning
    for (let i = 0; i < 6; i++) {
      const z = 8 + i * 8;
      const p = valley.near(0, z);
      const x = valley.s.path.reduce((a, q) => (Math.abs(q[1] - z) < Math.abs(a[1] - z) ? q : a))[0];
      void p;
      jobs.push(place(game, K + 'torii.glb', x * 0.6, z, { scale: 0.95 + i * 0.03, y: -0.35 - (i % 3) * 0.1, tilt: new THREE.Euler((r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.1) }));
    }
    // lanterns standing in the water, lit: their light runs across the surface
    for (let i = 0; i < 7; i++) {
      const z = 4 + i * 8.5;
      for (const side of [-1, 1]) {
        const x = side * (4.2 + r() * 1.5);
        jobs.push(place(game, K + 'lantern_stone.glb', x, z, { y: H(x, z) - 0.2, scale: 0.85, rot: r() * 6 }));
        if ((i + (side > 0 ? 1 : 0)) % 2 === 0) game.light({ position: V(x, 1.55, z), color: new THREE.Color(1, 0.6, 0.28), intensity: 9, distance: 13, flicker: 0.3 });
      }
    }
    // drowned houses and stones in the shallows
    jobs.push(place(game, K + 'minka_burnt_b.glb', -24, 30, { rot: 0.5, y: -1.3, tilt: new THREE.Euler(0.04, 0, -0.05) }));
    jobs.push(place(game, K + 'minka_thatch_small.glb', 26, 48, { rot: -0.4, y: -1.1, tilt: new THREE.Euler(-0.05, 0, 0.06) }));
    for (const [k, x, z, sc] of [['cliff_c', -32, 70, 1.2], ['boulder_c', 16, 18, 1.1], ['boulder_a', -12, 52, 1.0], ['cliff_a', 34, 92, 1.1], ['boulder_flat', 7, 30, 1.2]] as const) {
      jobs.push(place(game, R + k + '.glb', x, z, { scale: sc, rot: r() * 6, y: H(x, z) - 0.6 }));
    }
    // ---------------------------------------------------------------- the island
    jobs.push(place(game, K + 'torii.glb', 0, 67, { scale: 1.1, y: ISLAND_Y - 0.05 }));
    jobs.push(place(game, K + 'bell_tower.glb', 9, 92, { rot: -Math.PI / 2, y: ISLAND_Y }));
    jobs.push(place(game, K + 'shrine_hall.glb', -2, 108, { rot: Math.PI, y: ISLAND_Y - 0.6 }));
    jobs.push(place(game, K + 'brazier.glb', this.brazierPos.x, this.brazierPos.z, { y: ISLAND_Y }));
    for (const [x, z] of [[-6, 74], [6, 74], [-11, 86], [-9, 98], [12, 80]]) {
      jobs.push(place(game, K + 'lantern_stone.glb', x, z, { y: ISLAND_Y }));
      game.light({ position: V(x, ISLAND_Y + 1.55, z), color: new THREE.Color(1, 0.6, 0.28), intensity: 8, distance: 12, flicker: 0.3 });
    }
    await Promise.all(jobs);
    paving(game, -12, 70, 12, 100, ISLAND_Y + 0.02, 'stone_tiles', 2.2, new THREE.Color(0.55, 0.57, 0.58));

    const blocked = (x: number, z: number) => (z > -8 && Math.abs(x) < 74 && z < 130 && H(x, z) < 0.5) || Math.hypot(x - ISLAND.x, z - ISLAND.y) < 18;
    await valley.forest(game, {
      kinds: [['cedar', 0.62], ['pine', 0.14], ['maple', 0.1], ['bamboo', 0.14]], far: [['cedar', 0.75], ['pine', 0.25]],
      extent: [-110, 110, -165, 135], count: 460, blocked, scale: 1.15,
    });
    await valley.groundCover(game, { extent: [-90, 90, -160, 130], rocks: 130, tufts: 14000, tint: new THREE.Color(0.55, 0.7, 0.45), blocked });

    this.brazierLight = game.light({ position: this.brazierPos.clone().setY(ISLAND_Y + 1.8), color: new THREE.Color(1, 0.5, 0.2), intensity: 0, distance: 20, flicker: 0.4, priority: 2 });
    // playable area: the road and causeway, widening onto the island
    game.world.bounds = valley.bounds(1.5);
    game.music = { explore: 'c2_explore', combat: 'c2_combat', boss: 'c2_boss' };
    void game.audio.ambient('loop_rain', 0.6);
    void game.audio.ambient('loop_wind', 0.2);
  }

  update(dt: number): void {
    // lightning: a double flash of the moonlight, the sky brightening, thunder a moment later
    const g = this.game;
    this.lightningT -= dt;
    if (this.lightningT <= 0) {
      this.lightningT = 9 + Math.random() * 16;
      this.flash = 1;
      this.thunderAt = g.gameTime + 0.8 + Math.random() * 2.2;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const f = this.flash > 0.55 ? 1 : this.flash > 0.4 ? 0.2 : this.flash;
      g.pipe.setSun(g.pipe.sky.settings.lightDir, this.moonIntensity + f * 7);
      g.pipe.scene.environmentIntensity = 0.55 + f * 1.6;
    }
    if (this.thunderAt > 0 && g.gameTime > this.thunderAt) {
      this.thunderAt = -1;
      g.audio.sfx('thunder', null, 0.9);
      g.cam.addTrauma(0.06);
    }
    G.uRain.value = this.rainK;
  }

  // ==================================================================== story
  async run(game: Game, checkpoint: string | null): Promise<void> {
    const P = game.player;
    const cp = checkpoint ?? 'start';
    const idx = this.checkpoints.indexOf(cp);
    P.artsUnlocked = Math.max(P.artsUnlocked, 1);
    const at = (x: number, z: number) => V(x, H(x, z), z);
    const spawnAt = (def: typeof FOOTMAN, x: number, z: number, yaw = Math.PI, aware = true) => game.spawn(def, at(x, z), yaw, { aware });
    if (idx > 0) void game.hud.fade(0, 1.2);

    // ---------------------------------------------------------------- the cedar road
    if (idx <= 0) {
      P.teleport(at(0, -148), 0);
      game.cam.snapBehind(0);
      game.setCheckpoint('start', at(0, -148), 0);
      game.setCinematic(true);
      game.shot({ pos: V(3, H(0, -140) + 2.5, -138), look: V(0, H(0, -148) + 1.6, -149), fov: 40, focus: 9 });
      await game.hud.fade(0, 2.5);
      void game.hud.chapterCard('Chapter Two', 'The Drowned Shrine', 'Three days north, in the rain');
      await game.wait(3.5);
      game.shot({ pos: V(-1.8, H(0, -146) + 1.7, -146.2), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 36, blend: 3, focus: 2.4 });
      await game.say('Kaede', 'The ash road ends in the cedars. Oren said the second Ember burns in a shrine the river swallowed.', undefined, P.char, 'determined');
      await game.say('Kaede', 'Three days, Ren. They are three days ahead of me.', undefined, P.char, 'worried');
      game.setCinematic(false);
      game.hud.objective('Follow the road to the Drowned Shrine');
      game.hud.toast('Fighting fills your ember gauge. When it glows, press 1 / D-pad up: Ember Whirl', 6);
    }
    // ambush under the cedars
    if (idx <= 1) {
      if (idx === 1) { P.teleport(at(-4, -116), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -112);
      game.setCheckpoint('cedars', at(-4, -114), 0);
      const w = [await spawnAt(SPEARMAN, -6, -96), await spawnAt(SPEARMAN, 3, -94), await spawnAt(FOOTMAN, -1, -90)];
      await game.say('Kaede', 'Waiting for me. Good. Then he came this way.', 2.2, P.char, 'fierce');
      await game.waitDefeated(w);
    }
    // wraiths in the mist; a bell far off
    if (idx <= 2) {
      if (idx === 2) { P.teleport(at(3, -84), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -78);
      game.setCheckpoint('mist', at(5, -78), 0);
      game.audio.sfx('bell', null, 0.7);
      await game.say('Kaede', 'A bell... someone is still here.', 2, P.char, 'surprised');
      const w = [await spawnAt(WRAITH, 12, -58), await spawnAt(WRAITH, 2, -54), await spawnAt(WRAITH, 8, -50)];
      await game.waitDefeated(w);
    }
    // the forest edge: a brute and his footmen
    if (idx <= 3) {
      if (idx === 3) { P.teleport(at(3, -40), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -34);
      game.setCheckpoint('shore', at(2, -34), 0);
      const w = [await spawnAt(BRUTE, 0, -14), await spawnAt(FOOTMAN, -5, -18), await spawnAt(FOOTMAN, 5, -17)];
      await game.waitDefeated(w);
      // the shore: first sight of the drowned shrine
      game.setCinematic(true);
      P.teleport(at(0, -10), 0);
      game.shot({ pos: V(-4, 2.6, -14), look: V(0, 2.2, 40), fov: 42, blend: 1.5, focus: 30 });
      await game.wait(1.2);
      game.shot({ pos: V(2, 1.4, -6), look: V(0, 3.5, 88), fov: 32, blend: 6, focus: 60 });
      await game.say(null, '(a woman\'s voice, singing somewhere across the water)', 3.2);
      await game.say('Kaede', 'So this is the Drowned Shrine. The torii walk straight into the water.', undefined, P.char, 'calm');
      await game.say('Kaede', 'Whoever is singing is on that island.', undefined, P.char, 'determined');
      game.setCinematic(false);
      game.hud.objective('Wade the causeway to the island');
    }
    // the causeway: fights knee-deep in the water
    if (idx <= 4) {
      if (idx === 4) { P.teleport(at(0, 2), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('causeway', at(0, 0), 0);
      await game.waitUntil(() => P.body.pos.z > 12);
      const a = [await spawnAt(FOOTMAN, -1.5, 26), await spawnAt(SPEARMAN, 1.5, 30), await spawnAt(FOOTMAN, 0, 34)];
      await game.waitDefeated(a);
      await game.waitUntil(() => P.body.pos.z > 36);
      this.rainK = 1.4;
      const b = [await spawnAt(WRAITH, -1.5, 52), await spawnAt(WRAITH, 1.5, 55), await spawnAt(SPEARMAN, 0, 60)];
      await game.waitDefeated(b);
    }
    // the island: Hisame
    let hisame: Enemy | null = null;
    if (idx <= 5) {
      if (idx === 5) { P.teleport(at(0, 64), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('island', at(0, 63), 0);
      hisame = await game.spawn(HISAME, V(5.2, ISLAND_Y, 90.5), -Math.PI / 2, { aware: false });
      hisame.perform('w_idle', true);
      hisame.invulnerable = true;
      game.hud.objective('Climb onto the island');
      await game.waitUntil(() => P.body.pos.z > 72);
      game.setCinematic(true);
      P.teleport(V(0, ISLAND_Y, 74), 0);
      game.shot({ pos: V(-3, ISLAND_Y + 2.0, 78), look: V(6, ISLAND_Y + 2.6, 91), fov: 36, blend: 1.2, focus: 10 });
      game.audio.sfx('bell', V(9, 4, 92), 1);
      game.cam.addTrauma(0.1);
      await game.wait(1.4);
      hisame.yaw = Math.PI;
      game.shot({ pos: V(3.6, ISLAND_Y + 1.7, 87.4), look: hisame.center().add(V(0, 0.45, 0)), fov: 30, blend: 1.2, focus: 3.4 });
      await game.say('Hisame', 'Another pilgrim come to drown?', undefined, hisame.char, 'calm');
      await game.say('Hisame', 'The Ember is gone, girl. I let it go out. Grief is so much quieter in the dark.', undefined, hisame.char, 'sad');
      game.shot({ pos: V(1.2, ISLAND_Y + 1.6, 79.5), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 1.0, focus: 3 });
      await game.say('Kaede', 'You are the keeper. Please, help me. They took my brother.', undefined, P.char, 'worried');
      game.shot({ pos: V(3.0, ISLAND_Y + 1.4, 86.0), look: hisame.center().add(V(0, 0.5, 0)), fov: 28, blend: 0.8, focus: 3 });
      await game.say('Hisame', 'Then you will follow him into the ash.', 2.4, hisame.char, 'angry');
      hisame.perform('b_roar');
      game.audio.sfx('roar', hisame.body.pos, 1);
      game.cam.addTrauma(0.3);
      await game.wait(1.3);
      game.setCinematic(false);
      hisame.invulnerable = false;
      hisame.release();
      hisame.alert();
      game.hud.setBoss(hisame);
      game.hud.objective('Defeat Hisame of the Drowned Bell');
      // phase two: the bell
      await game.waitUntil(() => hisame!.dead || hisame!.hp < hisame!.maxHp * 0.5);
      if (!hisame.dead) {
        game.audio.sfx('bell', V(9, 4, 92), 1);
        hisame.roar();
        this.rainK = 2.2;
        this.lightningT = 0.2;
        game.cam.addTrauma(0.45);
        game.time.slowmo(0.4, 1.0);
        game.particles.burst('magic', hisame.center(), 60, undefined, 1.4);
        game.hud.toast('The bell tolls: the drowned answer', 2.5);
        const adds = [await game.spawn(WRAITH, V(-8, ISLAND_Y, 96), 0, { aware: true }), await game.spawn(WRAITH, V(8, ISLAND_Y, 76), 0, { aware: true })];
        void adds;
      }
      await game.waitDefeated([hisame]);
      for (const e of game.enemies) if (!e.dead) e.die();
      game.hud.setBoss(null);
    }
    await this.ending(game, hisame);
  }

  private async ending(game: Game, hollow: Enemy | null): Promise<void> {
    const P = game.player;
    game.setCheckpoint('end', V(0, ISLAND_Y, 84), 0);
    game.hud.objective(null);
    game.musicOverride = 'sorrow';
    this.rainK = 0.8;
    await game.wait(1.6);
    const where = hollow ? hollow.body.pos.clone() : V(2, ISLAND_Y, 88);
    // the ash falls away: Hisame as she was
    hollow?.vanish();
    game.particles.burst('ash', where.clone().setY(where.y + 1), 90, undefined, 1.2);
    game.particles.burst('magic', where.clone().setY(where.y + 1), 50, undefined, 1.0);
    game.audio.sfx('heal', where, 0.8);
    const hisame = await NPC.create(game, { name: 'Hisame', url: 'assets/chars/hisame.glb', pos: where, yaw: Math.PI, idle: 'stand_relaxed' });
    hisame.pose('kneel', { loop: true, fade: 0 });
    hisame.char.face.set('grief');
    game.setCinematic(true);
    P.setDrawn(false);
    P.teleport(where.clone().add(V(0.3, 0, -1.5)), 0);
    hisame.lookAt(P.char.root);
    game.shot({ pos: where.clone().add(V(2.6, 1.2, -2.2)), look: where.clone().add(V(0, 0.9, -0.4)), fov: 34, blend: 1.0, focus: 3 });
    await game.wait(1.0);
    await game.say('Hisame', 'I... remember the night they came. I hid the Ember in the bell, and then I hid myself in sorrow.', undefined, hisame.char, 'grief');
    await game.say('Kaede', 'My brother. A boy, fourteen. He can light fire with his hands.', undefined, P.char, 'worried');
    hisame.release();
    hisame.pose('stand_relaxed', { loop: true });
    await game.say('Hisame', 'Ember-blood. The King\'s riders crossed the water four nights ago with a boy in chains.', undefined, hisame.char, 'sad');
    await game.say('Hisame', 'They took the high road north, over the Frostwake pass, to the old monastery at the top.', undefined, hisame.char, 'determined');
    await game.say('Kaede', 'Then I go north.', 1.8, P.char, 'fierce');
    await game.say('Hisame', 'Relight it first. My hands are too cold to hold a flame.', undefined, hisame.char, 'warm');
    game.setCinematic(false);
    game.musicOverride = null;
    game.hud.objective('Relight the Ember');
    await new Promise<void>((res) => game.interact(this.brazierPos.clone().setY(ISLAND_Y + 0.5), 'Relight the Ember', () => res(), 2.6));
    game.setCinematic(true);
    P.char.animator.play('interact', { fade: 0.2 });
    game.shot({ pos: this.brazierPos.clone().add(V(-3.2, 2.2, -3.5)), look: this.brazierPos.clone().add(V(0, 1.3, 0)), fov: 38, blend: 1, focus: 5 });
    await game.wait(0.5);
    if (this.brazierLight) this.brazierLight.intensity = 60;
    game.particles.emitter('fire', this.brazierPos.clone().setY(ISLAND_Y + 1.3), 45, 0.55);
    game.particles.emitter('ember', this.brazierPos.clone().setY(ISLAND_Y + 1.6), 14, 0.6);
    game.particles.burst('flash', this.brazierPos.clone().setY(ISLAND_Y + 1.5), 1, undefined, 3);
    game.particles.burst('ember', this.brazierPos.clone().setY(ISLAND_Y + 1.5), 90, V(0, 1, 0), 1.4);
    game.audio.sfx('ignite', this.brazierPos, 1);
    this.rainK = 0.4;
    game.weather.setRain(3000, 0.3);
    game.musicOverride = 'title';
    await game.wait(1.4);
    P.artsUnlocked = Math.max(P.artsUnlocked, 2);
    game.hud.toast('Ember Art learned: Rising Flame — press 2 / D-pad right', 6);
    hisame.lookAt(P.char.root);
    game.shot({ pos: V(1.5, ISLAND_Y + 1.6, 77), look: hisame.head, fov: 34, blend: 1.5, focus: 6 });
    await game.say('Hisame', 'Two Embers burning. I will keep this one. Go, Kaede, and do not let the snow take you.', undefined, hisame.char, 'warm');
    await game.say('Kaede', 'Thank you, Hisame. Keep the bell quiet until I come back with him.', undefined, P.char, 'warm');
    await game.hud.fade(1, 2.5);
    game.setCinematic(false);
    game.musicOverride = null;
    game.onChapterComplete?.(this.id);
  }
}
