// Chapter Three — Frostwake. A climb over the snow pass in a blizzard: pine woods, a ridge of dead trees,
// the avalanche gate held by the Hollow, and the frozen monastery where the Frost Warden waits.
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import type { Enemy } from '../game/Enemy';
import { applyAtmosphere, paving, place, rand } from './common';
import { FOOTMAN, SPEARMAN, WRAITH, BRUTE, FROST_WARDEN } from './enemies';
import { G } from '../render/MaterialFX';
import { Valley, sstep } from './valley';
import { fbm } from './common';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const K = 'assets/env/village/';
const R = 'assets/env/rocks/';
const TOP = 44; // monastery courtyard level

const valley = new Valley({
  seed: 33,
  hills: 26,
  path: [
    [0, -150, 8], [8, -128, 12], [2, -104, 17], [-8, -82, 22], [0, -60, 27], [10, -40, 31], [4, -18, 35], [0, 0, 38],
    [0, 20, 40.5], [0, 40, 43], [0, 56, TOP], [0, 80, TOP], [0, 98, TOP],
  ],
  width: [9, 8, 8, 9, 10, 9, 8, 4.5, 9, 12, 17, 18, 16],
  shape: (x, z, y) => {
    // the gate: a narrow cut between cliffs; the monastery terrace is flat
    if (z > 48 && z < 104) {
      const k = sstep(24, 19, Math.abs(x)) * sstep(48, 54, z);
      y = y * (1 - k) + TOP * k;
    }
    return y;
  },
});
const H = (x: number, z: number) => valley.height(x, z);

export class Frostwake implements Level {
  id = 'frostwake';
  chapter = 3;
  title = 'Frostwake';
  checkpoints = ['start', 'drifts', 'deadwood', 'ridge', 'gate', 'monastery', 'end'];
  private game!: Game;
  private brazierPos = V(0, TOP, 72);
  private brazierLight: ReturnType<Game['light']> | null = null;
  private storm = 0.6;

  async load(game: Game): Promise<void> {
    this.game = game;
    applyAtmosphere(game, {
      sun: V(0.3, 0.42, -0.55), sunPower: 14, lightIntensity: 1.9, mie: 3.2, rayleigh: 0.8,
      tint: new THREE.Color(0.92, 0.96, 1.05), zenith: new THREE.Color(0.85, 0.9, 1.0), clouds: 0.9, cloudDensity: 1.0, cloudTint: new THREE.Color(0.85, 0.88, 0.95), skyGain: 1.1, env: 1.25,
      fog: { density: 0.016, falloff: 0.05, baseHeight: 0, farDensity: 0.007, anisotropy: 0.55, noise: 0.85, tint: new THREE.Color(0.82, 0.86, 0.94), sunScatter: 0.8, skyFog: 0.8 },
      grade: { exposure: 1.0, temperature: -0.18, contrast: 1.06, saturation: 0.85, vignette: 0.38, shadowTint: new THREE.Color(0.4, 0.46, 0.6), highlightTint: new THREE.Color(0.55, 0.55, 0.58) },
      bloom: 0.6,
    });
    G.uWind.value.set(1.0, 0.25, 1.1, 0.4);
    G.uSnow.value = 1;
    game.envFx = { snow: 1 };
    game.weather.setSnow(9000);

    const layers = [
      { name: 'snow', scale: 4.0, tint: new THREE.Color(0.95, 0.97, 1.0) },
      { name: 'grass_withered', scale: 3.0, tint: new THREE.Color(0.75, 0.72, 0.66) },
      { name: 'rocky_trail', scale: 3.0, tint: new THREE.Color(0.8, 0.82, 0.86) },
      { name: 'rock_moss2', scale: 7, depth: 0.05, tint: new THREE.Color(0.62, 0.64, 0.66) },
    ];
    const farLayers = [
      { name: 'snow', scale: 8, tint: new THREE.Color(0.95, 0.97, 1.0) },
      { name: 'snow', scale: 8, tint: new THREE.Color(0.9, 0.93, 0.98) },
      { name: 'rocky_trail', scale: 8 },
      { name: 'rock_moss2', scale: 14, tint: new THREE.Color(0.5, 0.52, 0.55) },
    ];
    valley.build(game, layers, farLayers, (x, z, _h, slope) => {
      const p = valley.near(x, z);
      const trail = sstep(2.8, 1.0, p.d) * (z < 50 ? 1 : 0);
      const yard = z > 52 && z < 100 && Math.abs(x) < 18 ? 0.5 : 0;
      const steep = sstep(0.35, 0.6, slope);
      const tuft = sstep(0.62, 0.8, fbm(x * 0.08, z * 0.08, 3, 9)) * 0.7;
      const path = Math.min(1, trail * 0.7 + yard);
      return [Math.max(0, 1 - path - tuft) * (1 - steep), tuft * (1 - path) * (1 - steep), path * (1 - steep), steep];
    }, new THREE.Vector2(0, -20), { snow: 1 });

    const jobs: Promise<unknown>[] = [];
    void rand;
    // ---------------------------------------------------------------- along the climb
    for (const [k, x, z, sc, rot] of [
      ['cliff_b', -8.5, 0, 1.25, 0.2], ['cliff_a', 8.8, 2, 1.25, -0.25], ['cliff_c', -14, -6, 1.2, 0.5], ['cliff_c', 15, -4, 1.2, -0.4],
      ['cliff_a', -18, -44, 1.1, 0.8], ['cliff_b', 24, -70, 1.2, -0.6], ['boulder_c', -6, -120, 1.2, 0.3], ['boulder_c', 14, -96, 1.0, 1.2],
      ['cliff_c', -22, 30, 1.3, 0.2], ['cliff_c', 22, 26, 1.3, -0.2],
    ] as const) {
      jobs.push(place(game, R + k + '.glb', x, z, { scale: sc, rot, y: H(x, z) - 0.8 }));
    }
    // the avalanche gate: a timber gate under a weathered torii between the cliffs
    jobs.push(place(game, K + 'torii.glb', 0, 1.5, { scale: 1.25, y: H(0, 1.5) - 0.1 }));
    for (const x of [-3.6, 3.6]) jobs.push(place(game, K + 'fence_wood.glb', x, 3, { rot: 0, y: H(x, 3) - 0.1, scale: new THREE.Vector3(0.9, 1.9, 1) }));
    // a ruined waystation on the ridge
    jobs.push(place(game, K + 'minka_burnt_b.glb', -20, -34, { rot: 0.9, y: H(-20, -34) - 0.2 }));
    // ---------------------------------------------------------------- the monastery
    jobs.push(place(game, K + 'torii.glb', 0, 54, { scale: 1.15, y: TOP - 0.05 }));
    jobs.push(place(game, K + 'shrine_hall.glb', 0, 92, { rot: Math.PI, y: TOP - 0.6 }));
    jobs.push(place(game, K + 'bell_tower.glb', -13, 68, { rot: Math.PI / 2, y: TOP }));
    jobs.push(place(game, K + 'minka_tile.glb', 14.5, 64, { rot: -Math.PI / 2, y: TOP }));
    jobs.push(place(game, K + 'minka_tile_long.glb', 14.5, 80, { rot: -Math.PI / 2, y: TOP }));
    jobs.push(place(game, K + 'brazier.glb', this.brazierPos.x, this.brazierPos.z, { y: TOP }));
    for (const [x, z] of [[-6, 60], [6, 60], [-6, 82], [6, 82]]) jobs.push(place(game, K + 'lantern_stone.glb', x, z, { y: TOP }));
    await Promise.all(jobs);
    paving(game, -11, 56, 11, 86, TOP + 0.02, 'stone_tiles', 2.2, new THREE.Color(0.7, 0.72, 0.76));

    const blocked = (x: number, z: number) => z > 50 && z < 104 && Math.abs(x) < 22;
    await valley.forest(game, {
      kinds: [['pine', 0.55], ['dead', 0.3], ['cedar', 0.15]], far: [['pine', 0.6], ['cedar', 0.4]],
      extent: [-110, 110, -165, 120], count: 420, blocked,
    });
    await valley.groundCover(game, { extent: [-90, 90, -160, 110], rocks: 160, tufts: 6000, tint: new THREE.Color(0.85, 0.8, 0.66), blocked });

    this.brazierLight = game.light({ position: this.brazierPos.clone().setY(TOP + 1.8), color: new THREE.Color(1, 0.5, 0.2), intensity: 0, distance: 22, flicker: 0.4, priority: 2 });
    game.world.bounds = valley.bounds(1.5);
    game.music = { explore: 'c3_explore', combat: 'c3_combat', boss: 'c3_boss' };
    void game.audio.ambient('loop_wind', 0.75);
  }

  update(dt: number): void {
    // gusts: the blizzard comes and goes
    const t = this.game.gameTime;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.0);
    G.uWind.value.z = (0.7 + gust * 0.8) * this.storm * 1.6;
    this.game.pipe.fog.settings.density = 0.011 + 0.012 * gust * this.storm;
    void dt;
  }

  // ==================================================================== story
  async run(game: Game, checkpoint: string | null): Promise<void> {
    const P = game.player;
    const cp = checkpoint ?? 'start';
    const idx = this.checkpoints.indexOf(cp);
    P.artsUnlocked = Math.max(P.artsUnlocked, 2);
    const at = (x: number, z: number) => V(x, H(x, z), z);
    const spawnAt = (def: typeof FOOTMAN, x: number, z: number, yaw = Math.PI, aware = true) => game.spawn(def, at(x, z), yaw, { aware });
    if (idx > 0) void game.hud.fade(0, 1.2);

    if (idx <= 0) {
      P.teleport(at(0, -148), 0);
      game.cam.snapBehind(0);
      game.setCheckpoint('start', at(0, -148), 0);
      game.setCinematic(true);
      game.shot({ pos: V(6, H(0, -140) + 4, -136), look: V(0, H(0, -148) + 1.5, -149), fov: 42, focus: 14 });
      await game.hud.fade(0, 2.5);
      void game.hud.chapterCard('Chapter Three', 'Frostwake', 'The high road, in the first snow');
      await game.wait(3.5);
      game.shot({ pos: V(1.6, H(0, -146) + 1.7, -146.0), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 36, blend: 3, focus: 2.4 });
      await game.say('Kaede', 'Hisame said the monastery sits at the very top of the pass.', undefined, P.char, 'determined');
      await game.say('Kaede', 'Ren hates the cold. Every winter he stole my blanket and swore he had not.', undefined, P.char, 'warm');
      game.setCinematic(false);
      game.hud.objective('Climb the pass to the monastery');
      game.hud.toast('Rising Flame (2) launches enemies into the air — strike again before they land', 6);
    }
    if (idx <= 1) {
      if (idx === 1) { P.teleport(at(6, -132), 0.3); game.cam.snapBehind(0.3); }
      await game.waitUntil(() => P.body.pos.z > -126);
      game.setCheckpoint('drifts', at(7, -128), 0.3);
      const w = [await spawnAt(FOOTMAN, 4, -108), await spawnAt(FOOTMAN, -1, -104), await spawnAt(SPEARMAN, 3, -100)];
      await game.waitDefeated(w);
    }
    if (idx <= 2) {
      if (idx === 2) { P.teleport(at(-6, -86), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -84);
      game.setCheckpoint('deadwood', at(-7, -84), 0);
      this.storm = 0.85;
      game.weather.setSnow(13000);
      const w = [await spawnAt(BRUTE, -2, -64), await spawnAt(WRAITH, 6, -60), await spawnAt(WRAITH, -6, -58)];
      await game.waitDefeated(w);
    }
    // Ren's charm in the snow
    if (idx <= 3) {
      if (idx === 3) { P.teleport(at(8, -44), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('ridge', at(8, -44), 0);
      const charmPos = at(7, -28);
      game.particles.emitter('ember', charmPos.clone().setY(charmPos.y + 0.2), 3, 0.15);
      game.hud.objective('Something glows in the snow');
      await new Promise<void>((res) => game.interact(charmPos, 'Examine', () => res(), 2.2));
      game.setCinematic(true);
      P.setDrawn(false);
      P.char.animator.play('kneel', { loop: true, fade: 0.4 });
      game.shot({ pos: charmPos.clone().add(V(1.8, 1.0, 1.6)), look: charmPos.clone().add(V(0, 0.6, 0)), fov: 34, blend: 1.0, focus: 2.4 });
      await game.wait(1.0);
      await game.say('Kaede', 'Ren\'s charm. Mother\'s knot. He would never lose this.', undefined, P.char, 'surprised');
      await game.say('Kaede', 'He dropped it on purpose. He knows I am coming.', undefined, P.char, 'determined');
      P.char.animator.stop(0.4);
      game.setCinematic(false);
      game.hud.objective('Climb the pass to the monastery');
    }
    // the avalanche gate
    if (idx <= 4) {
      if (idx === 4) { P.teleport(at(4, -20), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -16);
      game.setCheckpoint('gate', at(4, -16), 0);
      game.hud.objective('Break through the avalanche gate');
      const a = [await spawnAt(FOOTMAN, -2, -4), await spawnAt(FOOTMAN, 2, -3), await spawnAt(FOOTMAN, 0, 6)];
      await game.waitDefeated(a);
      const b = [await spawnAt(SPEARMAN, -2, 12), await spawnAt(SPEARMAN, 2, 14), await spawnAt(BRUTE, 0, 20)];
      await game.say('Kaede', 'They are holding the gate for him. Then he is close.', 2.2, P.char, 'fierce');
      await game.waitDefeated(b);
    }
    // the monastery: the Frost Warden
    let warden: Enemy | null = null;
    if (idx <= 5) {
      if (idx === 5) { P.teleport(at(0, 30), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('monastery', at(0, 30), 0);
      game.hud.objective('Search the monastery');
      warden = await game.spawn(FROST_WARDEN, V(0, TOP, 80), Math.PI, { aware: false });
      warden.perform('down_hold', true);
      warden.invulnerable = true;
      await game.waitUntil(() => P.body.pos.z > 58);
      game.setCinematic(true);
      P.teleport(V(0, TOP, 62), 0);
      game.shot({ pos: V(-5, TOP + 2.2, 63), look: V(0, TOP + 0.8, 78), fov: 38, blend: 1.2, focus: 12 });
      await game.say('Kaede', 'Embers in the snow... a trail, leading to the hall. Ren?', undefined, P.char, 'worried');
      // the snow heaves: the Warden rises
      game.cam.addTrauma(0.35);
      game.particles.burst('dust', V(0, TOP + 0.4, 80), 80, V(0, 1, 0), 2.0);
      game.particles.burst('ice', V(0, TOP + 1, 80), 70, V(0, 1, 0), 1.2);
      warden.perform('getup', false);
      game.shot({ pos: V(3.5, TOP + 1.2, 70), look: V(0, TOP + 2.6, 80), fov: 34, blend: 1.0, focus: 10 });
      await game.wait(1.6);
      warden.perform('b_roar');
      game.audio.sfx('boss_roar', warden.body.pos, 1);
      game.cam.addTrauma(0.45);
      await game.wait(1.2);
      game.shot({ pos: V(0.6, TOP + 1.6, 63.5), look: P.body.pos.clone().setY(P.body.pos.y + 1.5), fov: 34, blend: 0.8, focus: 2.5 });
      await game.say('Kaede', 'Where is he? Where is my brother!', 2.2, P.char, 'shout');
      game.setCinematic(false);
      warden.invulnerable = false;
      warden.release();
      warden.alert();
      game.hud.setBoss(warden);
      game.hud.objective('Defeat the Frost Warden');
      await game.waitUntil(() => warden!.dead || warden!.hp < warden!.maxHp * 0.5);
      if (!warden.dead) {
        warden.roar();
        this.storm = 1.3;
        game.weather.setSnow(16000);
        game.particles.burst('ice', warden.center(), 90, undefined, 1.6);
        game.time.slowmo(0.4, 1.0);
        game.hud.toast('The storm answers the Warden', 2.5);
        await game.spawn(FOOTMAN, V(-8, TOP, 84), Math.PI, { aware: true });
        await game.spawn(FOOTMAN, V(8, TOP, 60), 0, { aware: true });
      }
      await game.waitDefeated([warden]);
      for (const e of game.enemies) if (!e.dead) e.die();
      game.hud.setBoss(null);
    }
    await this.ending(game);
  }

  private async ending(game: Game): Promise<void> {
    const P = game.player;
    game.setCheckpoint('end', V(0, TOP, 66), 0);
    game.hud.objective(null);
    this.storm = 0.4;
    game.weather.setSnow(5000);
    await game.wait(2.0);
    game.hud.objective('Relight the Ember');
    await new Promise<void>((res) => game.interact(this.brazierPos.clone().setY(TOP + 0.5), 'Relight the Ember', () => res(), 2.6));
    game.setCinematic(true);
    P.setDrawn(false);
    P.char.animator.play('interact', { fade: 0.2 });
    game.shot({ pos: this.brazierPos.clone().add(V(-3.2, 2.2, -3.5)), look: this.brazierPos.clone().add(V(0, 1.3, 0)), fov: 38, blend: 1, focus: 5 });
    await game.wait(0.5);
    if (this.brazierLight) this.brazierLight.intensity = 60;
    game.particles.emitter('fire', this.brazierPos.clone().setY(TOP + 1.3), 45, 0.55);
    game.pipe.haze.sources.push({ pos: this.brazierPos.clone().setY(TOP + 1.4), radius: 1.2, strength: 0.8 });
    game.particles.emitter('ember', this.brazierPos.clone().setY(TOP + 1.6), 14, 0.6);
    game.particles.burst('flash', this.brazierPos.clone().setY(TOP + 1.5), 1, undefined, 3);
    game.particles.burst('ember', this.brazierPos.clone().setY(TOP + 1.5), 90, V(0, 1, 0), 1.4);
    game.audio.sfx('ignite', this.brazierPos, 1);
    game.musicOverride = 'title';
    await game.wait(1.4);
    P.artsUnlocked = 3;
    game.hud.toast('Ember Art learned: Cinder Burst — press 3 / D-pad down', 6);
    // a vision in the flame
    game.shot({ pos: this.brazierPos.clone().add(V(0, 1.55, -1.6)), look: this.brazierPos.clone().add(V(0, 1.35, 0)), fov: 30, blend: 2.5, focus: 1.6 });
    game.pipe.grade.settings.saturation = 0.5;
    await game.wait(2.0);
    await game.say(null, '(in the flames: a boy in chains, a forge glowing inside a mountain, hammers falling)', 4.0);
    await game.say('Ren', 'Kaede... it is so hot here. They want me to light something. I won\'t. I won\'t...', undefined, null, 'fear');
    game.pipe.grade.settings.saturation = 0.85;
    game.shot({ pos: this.brazierPos.clone().add(V(2.5, 1.7, -2.2)), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 1.5, focus: 3 });
    await game.say('Kaede', 'The Heart Forge. Inside the mountain.', undefined, P.char, 'determined');
    await game.say('Kaede', 'Three Embers lit. Hold on, Ren. Do not light anything for them. I am coming.', undefined, P.char, 'fierce');
    await game.hud.fade(1, 2.5);
    game.setCinematic(false);
    game.musicOverride = null;
    game.onChapterComplete?.(this.id);
  }
}
