// Chapter Five — The Hollow Crown. The ruined capital on the night of the new moon: a burning bridge that
// falls behind Kaede, the burning town, the castle's outer gate, the outer bailey where possessed Ren waits,
// the great stair, and the inner bailey under the keep where the Hollow King feeds the black flame. Ending:
// the fifth Ember relit at dawn, Ren freed, Hisame and Mika come to bring them home.
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import type { Enemy } from '../game/Enemy';
import { NPC } from '../game/NPC';
import { applyAtmosphere, fbm, paving, place, rand, type Atmosphere } from './common';
import { FOOTMAN, SPEARMAN, WRAITH, BRUTE, SMITH, REN_HOLLOW, HOLLOW_KING, THROWER } from './enemies';
import { G } from '../render/MaterialFX';
import { Valley, sstep } from './valley';
import { ribbon, waterMesh } from '../render/Water';
import { PlanarMirror } from '../render/Mirror';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const K = 'assets/env/village/';
const R = 'assets/env/rocks/';
const TOWN = 3; // street level
const LOW = 4; // the outer bailey (ninomaru)
const UP = 10; // the inner bailey (honmaru)
const RIVER_Z = -140;
const WATER_Y = 1.5;
const BRIDGE_Z = RIVER_Z;

function riverDist(x: number, z: number): number {
  // the river meanders gently across the valley
  return Math.abs(z - riverZ(x)) * 0.993;
}
/** the river's centre line: it meanders, but crosses x = 0 exactly under the bridge */
function riverZ(x: number): number {
  return RIVER_Z + Math.sin(x * 0.03) * 4 + (Math.sin(x * 0.011 + 1.3) - Math.sin(1.3)) * 6;
}

const valley = new Valley({
  seed: 55,
  hills: 22,
  path: [
    [0, -162, TOWN], [0, -150, TOWN], [0, -146, TOWN], [0, -134, TOWN], [0, -130, TOWN], [2, -114, TOWN], [-2, -94, 3.3], [1, -74, 3.6], [0, -56, 3.8],
    [0, -42, LOW], [0, -37, LOW], [0, -31, LOW], [0, -26, LOW], [0, 0, LOW], [0, 20, LOW], [0, 24, LOW], [0, 36, UP], [0, 40, UP], [0, 70, UP], [0, 86, UP],
  ],
  width: [7, 7, 7, 7, 7, 10, 10, 10, 10, 10, 10, 10, 22, 24, 24, 2.4, 2.4, 22, 22, 16],
  shape: (x, z, y, near) => {
    // the river: a wide shallow cut across the valley below the town
    const rd = riverDist(x, z);
    const k = sstep(6.8, 3.6, rd);
    y = Math.min(y, y * (1 - k) + (WATER_Y - 0.9) * k);
    // the castle compound: the outer bailey, the great stair, the inner bailey on its stone platform
    const ax = Math.abs(x);
    if (z > -40 && z < 24) { const f = sstep(31, 27, ax); y = y * (1 - f) + LOW * f; }
    if (z >= 24 && z < 36 && ax < 3.6) y = LOW + (UP - LOW) * (z - 24) / 12;
    else if (z >= 24 && z < 36 && ax < 28) y = LOW;
    if (z >= 36 && z < 108 && ax < 28) y = UP;
    void near;
    return y;
  },
});
const H = (x: number, z: number) => valley.height(x, z);

/** the night of the new moon over a burning city */
const NIGHT: Atmosphere = {
  sun: V(0.35, 0.5, -0.6), night: true, sunPower: 0.9, lightIntensity: 0.5, mie: 2.4, rayleigh: 0.9,
  tint: new THREE.Color(0.78, 0.84, 1.0), zenith: new THREE.Color(0.45, 0.42, 0.5), clouds: 0.85, cloudDensity: 0.95, cloudTint: new THREE.Color(0.5, 0.42, 0.42), stars: 0.15, skyGain: 0.85, env: 0.6,
  groundGlow: new THREE.Color(0.32, 0.11, 0.03),
  fog: { density: 0.014, falloff: 0.08, baseHeight: 1, farDensity: 0.006, anisotropy: 0.45, noise: 0.8, tint: new THREE.Color(0.45, 0.42, 0.44), sunScatter: 0.5, skyFog: 0.7,
    glow: new THREE.Color(0.07, 0.022, 0.006), glowBase: TOWN, glowFalloff: 0.06 },
  grade: { exposure: 1.2, temperature: -0.04, contrast: 1.1, saturation: 0.95, vignette: 0.5, shadowTint: new THREE.Color(0.3, 0.34, 0.5), highlightTint: new THREE.Color(0.66, 0.5, 0.36), splitBalance: 0.0, expMax: 2.2 },
  bloom: 0.9,
};
/** the morning after: a low gold sun through thinning smoke */
const DAWN: Atmosphere = {
  sun: V(-0.75, 0.12, 0.62), sunPower: 16, lightIntensity: 2.4, mie: 3.2, rayleigh: 1.3,
  tint: new THREE.Color(1.05, 0.9, 0.78), zenith: new THREE.Color(0.85, 0.85, 1.0), clouds: 0.55, cloudDensity: 0.75, cloudTint: new THREE.Color(1.05, 0.82, 0.75), skyGain: 1.0, env: 1.0,
  fog: { density: 0.012, falloff: 0.1, baseHeight: 1, farDensity: 0.005, anisotropy: 0.7, noise: 0.6, tint: new THREE.Color(1.0, 0.86, 0.76), sunScatter: 1.2, skyFog: 0.5 },
  grade: { exposure: 1.0, temperature: 0.12, contrast: 1.05, saturation: 1.05, vignette: 0.35, shadowTint: new THREE.Color(0.42, 0.42, 0.55), highlightTint: new THREE.Color(0.62, 0.55, 0.45) },
  bloom: 0.6,
};

export class HollowCrown implements Level {
  id = 'hollowcrown';
  chapter = 5;
  title = 'The Hollow Crown';
  checkpoints = ['start', 'town', 'gate', 'bailey', 'stair', 'keep', 'end'];
  private game!: Game;
  private emberPos = V(0, UP, 72);
  private emberLight: ReturnType<Game['light']> | null = null;
  private blackFlame: { on: boolean; pos: THREE.Vector3 }[] = [];
  private bridge: THREE.Group | null = null;
  private bridgeFires: { on: boolean; pos: THREE.Vector3 }[] = [];
  private bridgeLights: ReturnType<Game['light']>[] = [];
  private kingAura: { e: { on: boolean; pos: THREE.Vector3 }; king: Enemy } | null = null;
  private kingGrow = 0;
  private kingScale = 1;
  private dawn = false;

  async load(game: Game): Promise<void> {
    this.game = game;
    game.envLight = 0.65;
    applyAtmosphere(game, NIGHT);
    G.uWind.value.set(0.8, 0.2, 0.5, 0.2);
    game.envFx = {};
    // ash and live embers drifting over the city
    game.weather.setSnow(4500, { color: new THREE.Color(0.14, 0.13, 0.13), speed: 0.4, size: 22, ember: 0.18 });

    const layers = [
      { name: 'dirt_path', scale: 3.0, tint: new THREE.Color(0.55, 0.5, 0.46) },
      { name: 'burned_ground_01', scale: 3.0, tint: new THREE.Color(0.6, 0.55, 0.5) },
      { name: 'stone_path', scale: 2.8, tint: new THREE.Color(0.62, 0.6, 0.58) },
      { name: 'rock_cliff', scale: 7, depth: 0.05, tint: new THREE.Color(0.5, 0.48, 0.46) },
    ];
    const farLayers = [
      { name: 'grass_withered', scale: 8, tint: new THREE.Color(0.35, 0.33, 0.3) },
      { name: 'burned_ground_01', scale: 8, tint: new THREE.Color(0.32, 0.3, 0.28) },
      { name: 'stone_path', scale: 8 },
      { name: 'rock_cliff', scale: 14, tint: new THREE.Color(0.4, 0.38, 0.36) },
    ];
    valley.build(game, layers, farLayers, (x, z, h, slope) => {
      const p = valley.near(x, z);
      const street = z < -36 && z > -132 ? sstep(6.5, 4.0, p.d) : 0;
      const bailey = z > -34 && z < 108 && Math.abs(x) < 27 ? 0.85 : 0;
      const steep = sstep(0.3, 0.55, slope);
      const burnt = sstep(0.5, 0.7, fbm(x * 0.06, z * 0.06, 3, 15)) * (z < -30 ? 1 : 0.3);
      const path = Math.min(1, street + bailey);
      void h;
      return [Math.max(0, 1 - path - burnt) * (1 - steep), burnt * (1 - path) * (1 - steep), path * (1 - steep), steep];
    }, new THREE.Vector2(0, -40), {});

    // ---------------------------------------------------------------- the river and the burning bridge
    const mirror = new PlanarMirror(WATER_Y, game.pipe.quality.planarReflection);
    game.pipe.mirrors.push(mirror);
    const pts: THREE.Vector3[] = [];
    for (let x = -150; x <= 150; x += 15) pts.push(V(x, WATER_Y, riverZ(x)));
    const river = waterMesh(game.pipe, ribbon(pts, 15, V(0, 1, 0), 10), {
      speed: 0.6, scale: 0.8, strength: 0.25, bankFoam: 0.04, alpha: [0.75, 0.97], mirror,
      deep: new THREE.Color(0.012, 0.018, 0.024), shallow: new THREE.Color(0.04, 0.05, 0.05),
    });
    game.levelRoot.add(river);
    mirror.hide.push(river, game.particles.group, game.weather.group);
    const jobs: Promise<unknown>[] = [];
    const r = rand(5);
    this.bridge = await place(game, K + 'bridge_arched.glb', 0, BRIDGE_Z, { rot: Math.PI / 2, scale: 1.5, y: TOWN - 0.9 });
    // the bridge burns: flames along both railings, heat shimmer, and light thrown on the water
    for (const dz of [-4.5, -1.5, 2.0, 4.8]) {
      for (const side of [-1, 1]) {
        if (r() < 0.3) continue;
        const p = V(side * 1.9, TOWN + 1.0 + 0.9 * (1 - (dz / 6.75) ** 2), BRIDGE_Z + dz);
        this.bridgeFires.push(game.particles.emitter('blaze', p, 18, 0.5));
        this.bridgeFires.push(game.particles.emitter('fire', p.clone().setY(p.y + 0.2), 14, 0.6));
        this.bridgeFires.push(game.particles.emitter('smoke', p.clone().setY(p.y + 1.6), 4, 0.6, V(0.2, 1, 0)));
        this.bridgeFires.push(game.particles.emitter('ember', p.clone().setY(p.y + 0.5), 4, 0.6));
        game.pipe.haze.sources.push({ pos: p.clone().setY(p.y + 0.6), radius: 1.2, strength: 0.8 });
      }
      this.bridgeLights.push(game.light({ position: V(0, TOWN + 2.4, BRIDGE_Z + dz), color: new THREE.Color(1, 0.48, 0.18), intensity: 20, distance: 16, flicker: 0.45, priority: 1 }));
    }
    // ---------------------------------------------------------------- the burning town
    const houses = ['minka_burnt_a', 'minka_tile', 'minka_burnt_b', 'minka_thatch', 'minka_tile_long', 'minka_burnt_a', 'minka_thatch_small', 'minka_burnt_b'];
    let hi = 0;
    for (let z = -122; z <= -48; z += 14) {
      for (const side of [-1, 1]) {
        const kind = houses[hi++ % houses.length];
        const x = side * (15 + r() * 2);
        jobs.push(place(game, K + kind + '.glb', x, z, { rot: -side * Math.PI / 2 + (r() - 0.5) * 0.15, y: H(x, z) - 0.15 }));
        if (kind.includes('burnt') || r() < 0.45) this.fire(V(x - side * 1.5 + (r() - 0.5) * 3, H(x, z) + (kind.includes('burnt') ? 1.0 : 3.6), z + (r() - 0.5) * 3), kind.includes('burnt') ? 0.7 : 1.0);
      }
      for (const side of [-1, 1]) {
        const lx = side * 8.5;
        jobs.push(place(game, K + 'lantern_stone.glb', lx, z + 7, { scale: 0.8, rot: r() * 6, y: H(lx, z + 7) - 0.05, tilt: new THREE.Euler((r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1) }));
      }
    }
    for (const [k, x, z, rot] of [['cart', -5, -104, 0.8], ['well', 6, -88, 0], ['hay_rack_burnt', -7, -70, 1.4], ['cart', 6.5, -60, -0.5], ['barrel', -6, -82, 0], ['barrel', 7, -96, 0]] as const) {
      jobs.push(place(game, K + k + '.glb', x, z, { rot, y: H(x, z) - 0.02 }));
    }
    // ---------------------------------------------------------------- the castle: outer gate and walls
    jobs.push(place(game, K + 'castle_gate.glb', 0, -34, { y: LOW - 0.05 }));
    for (const x of [10.7, 18.7, 26.7]) for (const s of [-1, 1]) jobs.push(place(game, K + 'castle_wall.glb', s * x, -34, { y: H(s * x, -34) - 0.3 }));
    for (let z = -26; z <= 18; z += 8) for (const s of [-1, 1]) jobs.push(place(game, K + 'castle_wall.glb', s * 28.5, z, { rot: Math.PI / 2, y: LOW - 0.2 }));
    // the outer bailey: pines, lanterns, the Hollow's watch fires
    for (const [x, z] of [[-19, -20], [20, -12], [-21, 8], [19, 14], [-12, 16]]) jobs.push(place(game, `assets/env/trees/pine_${Math.floor(r() * 3)}.glb`, x, z, { y: LOW - 0.05, tree: true, scale: 0.9 + r() * 0.3 }));
    for (const [x, z] of [[-9, -22], [9, -22], [-9, 12], [9, 12]]) {
      jobs.push(place(game, K + 'brazier.glb', x, z, { scale: 0.75, y: LOW }));
      game.particles.emitter('fire', V(x, LOW + 0.9, z), 12, 0.3);
      game.light({ position: V(x, LOW + 1.7, z), color: new THREE.Color(1, 0.5, 0.2), intensity: 12, distance: 13, flicker: 0.35 });
      game.pipe.haze.sources.push({ pos: V(x, LOW + 1.2, z), radius: 0.8, strength: 0.5 });
    }
    // ---------------------------------------------------------------- the great stair and the inner bailey
    for (const x of [-24, -18, -12, -6, 6, 12, 18, 24]) jobs.push(place(game, K + 'terrace_wall.glb', x, 36.2, { rot: Math.PI, y: LOW + 0.1, scale: new THREE.Vector3(1.0, 3.6, 1.2) }));
    for (let i = 0; i < 3; i++) jobs.push(place(game, K + 'stairs_stone.glb', 0, 24.1 + i * 4, { rot: Math.PI, y: LOW + i * 2 - 0.02, scale: new THREE.Vector3(1.5, 1.111, 1.05) }));
    for (const s of [-1, 1]) for (const z of [24, 36.5]) jobs.push(place(game, K + 'lantern_stone.glb', s * 4.4, z, { y: z < 30 ? LOW : UP, scale: 0.9 }));
    for (let z = 44; z <= 100; z += 8) for (const s of [-1, 1]) jobs.push(place(game, K + 'castle_wall.glb', s * 26, z, { rot: Math.PI / 2, y: UP - 0.2 }));
    for (const x of [-20, -12, 12, 20]) jobs.push(place(game, K + 'castle_wall.glb', x, 106, { y: UP - 0.2 }));
    jobs.push(place(game, K + 'tenshu.glb', 0, 97, { y: UP - 0.1 }));
    jobs.push(place(game, K + 'brazier.glb', this.emberPos.x, this.emberPos.z, { scale: 1.7, y: UP }));
    for (const [x, z] of [[-12, 48], [12, 48], [-12, 64], [12, 64], [-12, 80], [12, 80]]) {
      jobs.push(place(game, K + 'lantern_stone.glb', x, z, { y: UP }));
      if (z !== 64) {
        game.particles.emitter('fire', V(x, UP + 1.45, z), 7, 0.04);
        game.light({ position: V(x, UP + 1.55, z), color: new THREE.Color(1, 0.6, 0.28), intensity: 10, distance: 13, flicker: 0.3 });
      }
    }
    for (const [k, x, z, sc, rot] of [['cliff_b', -36, -40, 1.3, 0.4], ['cliff_a', 38, -46, 1.3, -0.3], ['cliff_c', -40, 60, 1.6, 1.2], ['cliff_c', 42, 70, 1.6, -1.0], ['cliff_a', -30, 116, 1.4, 0.2]] as const) {
      jobs.push(place(game, R + k + '.glb', x, z, { scale: sc, rot, y: H(x, z) - 0.8 }));
    }
    await Promise.all(jobs);
    paving(game, -22, 40, 22, 88, UP + 0.02, 'stone_tiles', 2.2, new THREE.Color(0.62, 0.6, 0.58));

    // the black flame in the fifth Ember's brazier
    const ep = this.emberPos;
    this.blackFlame.push(game.particles.emitter('hexfire', ep.clone().setY(UP + 1.9), 22, 0.8));
    this.blackFlame.push(game.particles.emitter('blackfire', ep.clone().setY(UP + 2.0), 30, 0.7));
    this.blackFlame.push(game.particles.emitter('smoke', ep.clone().setY(UP + 3.8), 5, 0.8, V(0, 1, 0)));
    this.emberLight = game.light({ position: ep.clone().setY(UP + 2.8), color: new THREE.Color(0.55, 0.1, 0.32), intensity: 10, distance: 18, flicker: 0.5, priority: 2 });
    // smoke columns over the city
    for (const [x, z] of [[-60, -90], [70, -60], [-40, 30], [55, 120], [-90, -20]]) game.particles.emitter('smoke', V(x, H(x, z) + 6, z), 3, 5, V(0.3, 1, 0.1));

    const blocked = (x: number, z: number) => (z > -40 && Math.abs(x) < 34) || riverDist(x, z) < 10;
    await valley.forest(game, { kinds: [['pine', 0.45], ['dead', 0.35], ['cedar', 0.2]], far: [['pine', 0.6], ['cedar', 0.4]], extent: [-120, 120, -170, 130], count: 260, blocked });
    await valley.groundCover(game, { extent: [-90, 90, -165, 120], rocks: 90, tufts: 3500, tint: new THREE.Color(0.55, 0.52, 0.42), blocked: (x, z) => blocked(x, z) || (z > -134 && z < -40 && Math.abs(x) < 12), laneW: (_x, _z, p) => p.d < p.w + 1 });

    this.setBounds(false);
    game.music = { explore: 'c5_explore', combat: 'c5_combat', boss: 'c5_boss' };
    void game.audio.ambient('loop_fire', 0.5);
    void game.audio.ambient('loop_wind', 0.3);
  }

  /** the corridor; before the bridge falls it narrows to the deck, afterwards the far bank is closed */
  private setBounds(fallen: boolean): void {
    const b = valley.bounds(1.5);
    for (const p of b) {
      if (p.y > -146.2 && p.y < -133.8) p.x = Math.sign(p.x) * Math.min(Math.abs(p.x), 1.3);
      if (p.y > -37.2 && p.y < -30.8) p.x = Math.sign(p.x) * Math.min(Math.abs(p.x), 2.0);
      if (fallen && p.y < -131) p.y = -131;
    }
    this.game.world.bounds = b;
  }

  /** a house fire: flames, smoke, embers, light and shimmer */
  private fire(pos: THREE.Vector3, k: number): void {
    const g = this.game;
    g.particles.emitter('blaze', pos, 26 * k, 1.0 * k);
    g.particles.emitter('fire', pos.clone().setY(pos.y + 0.2), 16 * k, 1.2 * k);
    g.particles.emitter('smoke', pos.clone().setY(pos.y + 1.8), 6 * k, 1.0 * k, V(0.2, 1, 0.05));
    g.particles.emitter('ember', pos.clone().setY(pos.y + 0.6), 5 * k, 0.8);
    g.light({ position: pos.clone().setY(pos.y + 0.8), color: new THREE.Color(1, 0.48, 0.18), intensity: 20 * k, distance: 16, flicker: 0.45, priority: 1 });
    g.pipe.haze.sources.push({ pos: pos.clone().setY(pos.y + 0.6), radius: 1.5 * k + 0.5, strength: 0.9 * k });
  }

  update(dt: number): void {
    const g = this.game;
    if (this.kingAura) {
      const k = this.kingAura.king;
      this.kingAura.e.pos.copy(k.body.pos).setY(k.body.pos.y + 1.4);
      if (k.dead) { this.kingAura.e.on = false; this.kingAura = null; }
      // the black flame swells him: grow smoothly to his second-phase size
      if (this.kingGrow > 0) {
        this.kingGrow = Math.max(0, this.kingGrow - dt);
        this.kingScale = THREE.MathUtils.lerp(1.18, 1, this.kingGrow / 1.2);
        k.char.root.scale.setScalar((HOLLOW_KING.scale ?? 1) * this.kingScale);
      }
    }
    if (this.emberLight && !this.dawn) this.emberLight.intensity = 10 + 4 * Math.sin(g.gameTime * 7.0) * Math.sin(g.gameTime * 2.3);
  }

  // ==================================================================== story
  async run(game: Game, checkpoint: string | null): Promise<void> {
    const P = game.player;
    const cp = checkpoint ?? 'start';
    const idx = this.checkpoints.indexOf(cp);
    P.artsUnlocked = Math.max(P.artsUnlocked, 3);
    const at = (x: number, z: number) => V(x, H(x, z), z);
    const spawnAt = (def: typeof FOOTMAN, x: number, z: number, yaw = Math.PI, aware = true) => game.spawn(def, at(x, z), yaw, { aware });
    if (idx > 0) void game.hud.fade(0, 1.2);
    if (idx > 1) this.collapseBridge(false);

    // ---------------------------------------------------------------- the burning bridge
    if (idx <= 0) {
      P.teleport(at(0, -158), 0);
      game.cam.snapBehind(0);
      game.setCheckpoint('start', at(0, -158), 0);
      game.setCinematic(true);
      game.shot({ pos: V(-9, TOWN + 4.5, -160), look: V(0, TOWN + 4, -120), fov: 44, focus: 30 });
      await game.hud.fade(0, 2.5);
      void game.hud.chapterCard('Chapter Five', 'The Hollow Crown', 'The ruined capital, on the night of the new moon');
      await game.wait(3.8);
      game.shot({ pos: V(1.5, H(0, -156) + 1.7, -156.2), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 36, blend: 3, focus: 2.4 });
      await game.say('Kaede', 'The capital. Mother brought us here once, for the lantern festival.', undefined, P.char, 'sad');
      await game.say('Kaede', 'Tonight the whole city is a lantern.', undefined, P.char, 'determined');
      game.setCinematic(false);
      game.hud.objective('Cross the burning bridge');
    }
    // ---------------------------------------------------------------- the town
    if (idx <= 1) {
      if (idx === 1) { P.teleport(at(0, -150), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -131);
      // the bridge gives way behind her
      this.collapseBridge(true);
      game.setCheckpoint('town', at(0, -126), 0);
      await game.say('Kaede', 'No way back, then. Good.', 1.8, P.char, 'fierce');
      game.hud.objective('Reach the castle');
      const a = [await spawnAt(FOOTMAN, -3, -112), await spawnAt(FOOTMAN, 4, -110), await spawnAt(SPEARMAN, 0, -104), await spawnAt(FOOTMAN, -6, -100)];
      await game.waitDefeated(a);
      await game.waitUntil(() => P.body.pos.z > -92);
      const b = [await spawnAt(WRAITH, 5, -76), await spawnAt(WRAITH, -6, -74), await spawnAt(BRUTE, 0, -70), await spawnAt(THROWER, -7, -62), await spawnAt(THROWER, 6, -60)];
      await game.waitDefeated(b);
    }
    // ---------------------------------------------------------------- the outer gate
    if (idx <= 2) {
      if (idx === 2) { P.teleport(at(0, -64), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -60);
      game.setCheckpoint('gate', at(0, -60), 0);
      game.hud.objective('Break through the castle gate');
      const g1 = [await spawnAt(SPEARMAN, -4, -46), await spawnAt(SPEARMAN, 4, -46), await spawnAt(SMITH, 0, -42)];
      await game.say('Kaede', 'The gate is open. They want me inside.', 2.2, P.char, 'determined');
      await game.waitDefeated(g1);
      const g2 = [await spawnAt(BRUTE, 0, -40), await spawnAt(FOOTMAN, -5, -48), await spawnAt(FOOTMAN, 5, -49), await spawnAt(THROWER, 0, -30)];
      await game.waitDefeated(g2);
    }
    // ---------------------------------------------------------------- the outer bailey: Ren
    let ren: Enemy | null = null;
    if (idx <= 3) {
      if (idx === 3) { P.teleport(at(0, -40), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('bailey', at(0, -40), 0);
      game.hud.objective('Find Ren');
      ren = await game.spawn(REN_HOLLOW, V(0, LOW, 8), Math.PI, { aware: false });
      ren.perform('w_idle', true);
      ren.invulnerable = true;
      const rh = game.particles.emitter('ember', V(0, LOW + 0.3, 8), 3, 0.6);
      await game.waitUntil(() => P.body.pos.z > -22);
      game.setCinematic(true);
      P.teleport(V(0, LOW, -18), 0);
      game.cam.snapBehind(0);
      game.shot({ pos: V(-5, LOW + 2.4, -16), look: V(0, LOW + 1.4, 8), fov: 40, blend: 1.2, focus: 22 });
      await game.wait(1.2);
      await game.say('Kaede', 'Ren!', 1.2, P.char, 'shout');
      game.shot({ pos: V(0.9, LOW + 1.55, 5.6), look: ren.center().add(V(0, 0.55, 0)), fov: 30, blend: 1.2, focus: 2.6 });
      await game.wait(0.6);
      await game.say('The Hollow King', '(a voice in the smoke) Your brother has chosen, Kaede of Hinoka. He kneels to the black flame now.', undefined, null, 'calm');
      await game.say('Ren', 'Go home, sister. There is nothing here for you.', undefined, ren.char, 'calm');
      game.shot({ pos: V(1.0, LOW + 1.65, -15.6), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 0.8, focus: 2.4 });
      await game.say('Kaede', 'I know that voice is not yours. Fight it, Ren. Fight it with me.', undefined, P.char, 'worried');
      rh.on = false;
      ren.perform('b_roar');
      game.audio.sfx('roar', ren.body.pos, 0.8);
      game.particles.burst('hexfire', ren.center(), 40, V(0, 1, 0), 1.2);
      game.cam.addTrauma(0.25);
      await game.wait(1.1);
      game.setCinematic(false);
      ren.invulnerable = false;
      ren.release();
      ren.alert();
      game.hud.setBoss(ren);
      game.hud.objective('Break Ren\'s guard. Do not kill him.');
      game.hint('Ren cannot be killed: wear him down and break his guard', 'Ren cannot be killed: wear him down and break his guard', 'Ren cannot be killed: wear him down and break his guard', 5);
      const rr = ren;
      await game.waitUntil(() => rr.yielded || rr.dead);
      for (const e of game.enemies) if (!e.dead && e !== rr) e.die();
      game.hud.setBoss(null);
    }
    // Ren, free for a moment
    if (idx <= 3) await this.renYields(game, ren);
    // ---------------------------------------------------------------- the great stair
    if (idx <= 4) {
      if (idx === 4) { P.teleport(at(0, 12), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('stair', at(0, 14), 0);
      game.hud.objective('Climb to the keep');
      await game.waitUntil(() => P.body.pos.z > 22);
      const w = [await game.spawn(WRAITH, V(-2, UP, 41), Math.PI, { aware: true }), await game.spawn(WRAITH, V(2, UP, 42), Math.PI, { aware: true }), await game.spawn(SPEARMAN, V(0, UP, 46), Math.PI, { aware: true })];
      await game.waitDefeated(w);
    }
    // ---------------------------------------------------------------- the keep: the Hollow King
    let king: Enemy | null = null;
    if (idx <= 5) {
      if (idx === 5) { P.teleport(V(0, UP, 42), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('keep', V(0, UP, 42), 0);
      king = await game.spawn(HOLLOW_KING, V(0, UP, 79), Math.PI, { aware: false });
      king.perform('stand_relaxed', true);
      king.invulnerable = true;
      await game.waitUntil(() => P.body.pos.z > 50);
      game.setCinematic(true);
      P.teleport(V(0, UP, 54), 0);
      game.cam.snapBehind(0);
      game.shot({ pos: V(-7, UP + 3.2, 52), look: V(0, UP + 5, 86), fov: 44, blend: 1.4, focus: 26 });
      await game.wait(1.5);
      game.shot({ pos: V(1.5, UP + 1.7, 75.2), look: king.center().add(V(0, 0.3, 0)), fov: 34, blend: 1.4, focus: 4.0 });
      await game.say('The Hollow King', 'I kept the first Ember for forty years, girl. Do you know what it is to burn that long?', undefined, king.char, 'calm');
      await game.say('The Hollow King', 'I will light a flame that never needs keeping. Your brother\'s hands will do it.', undefined, king.char, 'smirk');
      game.shot({ pos: V(1.0, UP + 1.65, 56.4), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 0.8, focus: 2.4 });
      await game.say('Kaede', 'You will light nothing. Not with his hands, and not with mine.', undefined, P.char, 'fierce');
      game.shot({ pos: V(-3.5, UP + 1.4, 70), look: king.center().add(V(0, 0.6, 0)), fov: 36, blend: 0.8, focus: 9 });
      king.perform('b_roar');
      game.audio.sfx('boss_roar', king.body.pos, 1);
      game.cam.addTrauma(0.45);
      await game.wait(1.3);
      game.setCinematic(false);
    }
    if (idx <= 5) {
      const k = king!;
      k.invulnerable = false;
      k.release();
      k.alert();
      game.hud.setBoss(k);
      game.hud.objective('Defeat the Hollow King');
      await game.waitUntil(() => k.dead || k.hp < k.maxHp * 0.5);
      if (!k.dead) {
        // phase two: he draws the black flame out of the Ember and into himself
        k.roar();
        game.time.slowmo(0.35, 1.2);
        game.cam.addTrauma(0.5);
        for (const f of this.blackFlame) f.on = false;
        game.particles.burst('blackfire', this.emberPos.clone().setY(UP + 2), 80, V(0, 1, 0), 1.8);
        game.particles.burst('hexfire', k.center(), 70, undefined, 1.6);
        this.kingAura = { e: game.particles.emitter('hexfire', k.body.pos, 14, 0.5), king: k };
        this.kingGrow = 1.2;
        if (this.emberLight) this.emberLight.intensity = 0;
        applyAtmosphere(game, { ...NIGHT, groundGlow: new THREE.Color(0.2, 0.04, 0.12), fog: { ...NIGHT.fog, tint: new THREE.Color(0.32, 0.28, 0.34), density: 0.018 } });
        game.hud.toast('The King drinks the black flame', 2.5);
        await game.say('The Hollow King', 'Then I will burn in his place!', 2.2, k.char, 'angry');
        await game.spawn(WRAITH, V(-10, UP, 70), Math.PI / 2, { aware: true });
        await game.spawn(WRAITH, V(10, UP, 58), -Math.PI / 2, { aware: true });
      }
      await game.waitDefeated([k]);
      for (const e of game.enemies) if (!e.dead) e.die();
      game.hud.setBoss(null);
    }
    await this.ending(game, king);
  }

  /** the bridge burns through and falls into the river behind Kaede */
  private collapseBridge(show: boolean): void {
    const g = this.game;
    if (!this.bridge || !this.bridge.visible) return;
    if (show) {
      const c = V(0, TOWN + 1, BRIDGE_Z);
      g.particles.burst('ember', c, 160, V(0, 1, 0), 1.8);
      g.particles.burst('spark', c, 80, V(0, 1, 0), 1.6);
      g.particles.burst('smoke', c, 14, V(0, 1, 0), 1.6);
      g.particles.burst('dust', c.clone().setY(WATER_Y + 0.3), 40, V(0, 1, 0), 2.0);
      g.audio.sfx('impact_heavy', c, 1);
      g.cam.addTrauma(0.35);
    }
    this.bridge.visible = false;
    for (const f of this.bridgeFires) f.on = false;
    for (const l of this.bridgeLights) l.intensity = 4;
    // the wreck still smoulders in the water
    g.particles.emitter('smoke', V(0, WATER_Y + 0.6, BRIDGE_Z), 4, 3, V(0.2, 1, 0));
    g.particles.emitter('fire', V(1.5, WATER_Y + 0.3, BRIDGE_Z + 2), 8, 1.2);
    this.setBounds(true);
  }

  /** Ren beaten to his knees: the voice lets go of him for a moment */
  private async renYields(game: Game, ren: Enemy | null): Promise<void> {
    const P = game.player;
    const where = ren ? ren.body.pos.clone() : V(0, LOW, 6);
    if (ren) { ren.vanish(); ren.char.root.visible = false; }
    game.particles.burst('hexfire', where.clone().setY(where.y + 1), 40, V(0, 1, 0), 1.2);
    game.particles.burst('ash', where.clone().setY(where.y + 1), 80, undefined, 1.0);
    const npc = await NPC.create(game, { name: 'Ren', url: 'assets/chars/ren.glb', pos: where, yaw: Math.PI, idle: 'stand_relaxed', mood: 'pain' });
    npc.pose('kneel', { loop: true, fade: 0 });
    game.setCinematic(true);
    P.setDrawn(false);
    P.teleport(where.clone().add(V(0.3, 0, -1.6)), 0);
    npc.lookAt(P.char.root);
    game.musicOverride = 'sorrow';
    game.shot({ pos: where.clone().add(V(2.4, 1.2, -2.2)), look: where.clone().add(V(0, 0.95, -0.5)), fov: 34, blend: 1.0, focus: 3.0 });
    await game.wait(1.0);
    await game.say('Ren', 'Kaede...? It is so loud in my head. He is in there with me.', undefined, npc.char, 'fear');
    P.char.animator.play('kneel', { loop: true, fade: 0.4 });
    await game.say('Kaede', 'I know. I am here now. I never stopped coming.', undefined, P.char, 'warm');
    await game.say('Ren', 'He is going to burn the last Ember black. He does not need me for that, only my fire. He took it.', undefined, npc.char, 'sad');
    await game.say('Kaede', 'Then I will go up and take it back. Stay here. Breathe.', undefined, P.char, 'determined');
    npc.pose('sit_wounded', { loop: true, fade: 0.8 });
    P.char.animator.stop(0.4);
    await game.say('The Hollow King', '(from the keep) Come up, then, little sister. Come and watch the black flame rise.', undefined, null, 'calm');
    game.setCinematic(false);
    game.musicOverride = null;
    P.setDrawn(true);
  }

  private async ending(game: Game, king: Enemy | null): Promise<void> {
    const P = game.player;
    game.setCheckpoint('end', V(0, UP, 60), 0);
    game.hud.objective(null);
    game.musicOverride = 'sorrow';
    this.kingAura = null;
    await game.wait(1.8);
    const where = king ? king.body.pos.clone() : V(0, UP, 76);
    game.setCinematic(true);
    P.setDrawn(false);
    P.teleport(where.clone().add(V(0.5, 0, -2.4)), 0);
    game.shot({ pos: where.clone().add(V(2.8, 1.0, -2.2)), look: where.clone().add(V(0, 0.5, 0)), fov: 34, blend: 1.0, focus: 3.2 });
    await game.wait(0.8);
    await game.say('The Hollow King', '(the ash cracking away from an old man\'s voice) Quiet... at last it is quiet. Keep them better than I did.', undefined, null, 'sad');
    if (king) { king.vanish(); king.char.root.visible = false; }
    game.particles.burst('ash', where.clone().setY(where.y + 1.2), 160, V(0, 1, 0), 1.6);
    game.particles.burst('ember', where.clone().setY(where.y + 1.2), 60, V(0, 1, 0), 1.2);
    await game.wait(1.2);
    game.setCinematic(false);
    game.musicOverride = null;
    game.hud.objective('Relight the fifth Ember');
    const ep = this.emberPos;
    await new Promise<void>((res) => game.interact(ep.clone().setY(UP + 0.5), 'Relight the Ember', () => res(), 3.0));
    game.setCinematic(true);
    P.char.animator.play('interact', { fade: 0.2 });
    game.shot({ pos: ep.clone().add(V(-3.6, 2.4, -4.0)), look: ep.clone().add(V(0, 1.8, 0)), fov: 40, blend: 1, focus: 5.5 });
    await game.wait(0.5);
    for (const f of this.blackFlame) f.on = false;
    this.dawn = true;
    if (this.emberLight) { this.emberLight.color.setRGB(1, 0.55, 0.2); this.emberLight.intensity = 80; }
    game.particles.emitter('blaze', ep.clone().setY(UP + 2.0), 32, 0.75);
    game.particles.emitter('fire', ep.clone().setY(UP + 2.1), 40, 0.9);
    game.particles.emitter('ember', ep.clone().setY(UP + 2.6), 14, 1.0);
    game.pipe.haze.sources.push({ pos: ep.clone().setY(UP + 2.6), radius: 2.0, strength: 1.0 });
    game.particles.burst('flash', ep.clone().setY(UP + 2.3), 1, undefined, 6);
    game.particles.burst('ember', ep.clone().setY(UP + 2.3), 200, V(0, 1, 0), 1.8);
    game.audio.sfx('ignite', ep, 1);
    game.cam.addTrauma(0.25);
    game.musicOverride = 'ending';
    await game.wait(1.6);
    // the light spreads: white, then the morning
    await game.hud.fade(1, 2.0);
    applyAtmosphere(game, DAWN);
    game.weather.setSnow(1200, { color: new THREE.Color(0.5, 0.48, 0.46), speed: 0.3, size: 18, ember: 0.05 });
    // morning: Ren comes up the stair, Hisame and Mika behind him
    P.teleport(V(-0.6, UP, 64), Math.PI);
    const ren = await NPC.create(game, { name: 'Ren', url: 'assets/chars/ren.glb', pos: V(0.8, UP, 44), yaw: 0, idle: 'stand_relaxed', mood: 'relief' });
    const hisame = await NPC.create(game, { name: 'Hisame', url: 'assets/chars/hisame.glb', pos: V(-1.4, UP, 40.5), yaw: 0, idle: 'stand_relaxed', mood: 'warm' });
    const mika = await NPC.create(game, { name: 'Mika', url: 'assets/chars/mika.glb', pos: V(2.2, UP, 39.5), yaw: 0, idle: 'stand_relaxed', mood: 'warm' });
    game.shot({ pos: V(-4.5, UP + 2.2, 66.5), look: V(0, UP + 1.3, 50), fov: 40, focus: 14 });
    void game.hud.fade(0, 2.5);
    await game.wait(1.0);
    void ren.walkTo(V(0.6, UP, 61.8), 1.3);
    void hisame.walkTo(V(-2.4, UP, 58.6), 1.1);
    void mika.walkTo(V(2.6, UP, 58.2), 1.0);
    await game.wait(6.5);
    ren.lookAt(P.char.root);
    hisame.lookAt(P.char.root);
    mika.lookAt(P.char.root);
    game.shot({ pos: V(2.8, UP + 1.6, 64.6), look: ren.head, fov: 32, blend: 1.5, focus: 3 });
    await game.say('Ren', 'Kaede? Is it morning?', undefined, ren.char, 'relief');
    game.shot({ pos: V(1.8, UP + 1.65, 60.6), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 1.0, focus: 3 });
    await game.say('Kaede', 'It is morning. All five Embers are burning.', undefined, P.char, 'smile');
    game.shot({ pos: V(-0.8, UP + 1.6, 62.2), look: hisame.head, fov: 32, blend: 1.0, focus: 4 });
    await game.say('Hisame', 'The bell rang by itself at dawn. Every bell in the country, I think. I knew it was you.', undefined, hisame.char, 'warm');
    game.shot({ pos: V(1.2, UP + 1.5, 61.9), look: mika.head, fov: 32, blend: 1.0, focus: 4 });
    await game.say('Mika', 'Hinoka is waiting for you both. We will rebuild. Oren would have scolded us for standing about.', undefined, mika.char, 'smile');
    game.shot({ pos: V(-3.6, UP + 1.9, 67.5), look: V(0, UP + 1.3, 60), fov: 38, blend: 2.0, focus: 7 });
    await game.say('Kaede', 'Let\'s go home, Ren.', undefined, P.char, 'warm');
    await game.say('Ren', 'Home. Yes.', undefined, ren.char, 'smile');
    await game.wait(1.0);
    game.shot({ pos: V(0, UP + 14, 30), look: V(0, UP + 6, 92), fov: 46, blend: 6, focus: 40 });
    await game.wait(4.5);
    await game.hud.fade(1, 3.0);
    game.setCinematic(false);
    game.musicOverride = null;
    game.onChapterComplete?.(this.id);
  }
}
