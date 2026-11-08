// Chapter Four — The Heart Forge. Inside the mountain: a caldera of black rock lit from below by rivers of
// lava. The switchback descent from the rim, the lava bridge, the smiths' quarter where the Hollow hammer
// blades at their anvils, and the Great Forge, where the Forgemother keeps the black Heart and Ren in chains.
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import type { Enemy } from '../game/Enemy';
import { NPC } from '../game/NPC';
import { applyAtmosphere, fbm, paving, place, rand } from './common';
import { FOOTMAN, SPEARMAN, WRAITH, BRUTE, SMITH, FORGEMOTHER } from './enemies';
import { G } from '../render/MaterialFX';
import { Valley, sstep } from './valley';
import { ribbon } from '../render/Water';
import { lavaMesh } from '../render/Lava';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const K = 'assets/env/village/';
const R = 'assets/env/rocks/';
const FLOOR = 6; // the crater floor
const YARD = 7; // the Great Forge courtyard
const LAVA_Y = 4.1; // the lava river

// the river of lava across the crater floor (the bridge crosses at x = 0); it pours out of the crater wall
// on the west and back into it on the east
const RIVER: [number, number][] = [[-82, -2], [-52, -10], [-26, -6], [-10, -9], [0, -8], [12, -7], [34, -12], [58, -5], [84, -9]];
// a channel running down from beside the Great Forge into the river: x, z, lava height
const CHANNEL: [number, number, number][] = [[25, 104, 6.1], [27, 76, 5.6], [23, 50, 5.1], [26, 26, 4.6], [21, 6, 4.3], [13, -7, 4.1]];
const POOL = new THREE.Vector2(-31, 78);
const POOL_Y = 5.9;

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return [Math.sqrt(x * x + z * z), t];
}
function nearRiver(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < RIVER.length - 1; i++) best = Math.min(best, segDist(x, z, RIVER[i][0], RIVER[i][1], RIVER[i + 1][0], RIVER[i + 1][1])[0]);
  return best;
}
function nearChannel(x: number, z: number): { d: number; h: number } {
  let best = { d: 1e9, h: LAVA_Y };
  for (let i = 0; i < CHANNEL.length - 1; i++) {
    const a = CHANNEL[i], b = CHANNEL[i + 1];
    const [d, t] = segDist(x, z, a[0], a[1], b[0], b[1]);
    if (d < best.d) best = { d, h: a[2] + (b[2] - a[2]) * t };
  }
  return best;
}

const valley = new Valley({
  seed: 44,
  hills: 34,
  path: [
    [0, -150, 40], [12, -134, 37], [-8, -118, 31], [12, -100, 25], [-6, -82, 19], [4, -62, 13], [0, -44, 8],
    [0, -28, FLOOR], [0, -14.5, FLOOR], [0, -13, FLOOR], [0, -3, FLOOR], [0, -1.5, FLOOR], [0, 12, FLOOR], [2, 30, 6.4],
    [0, 48, YARD], [0, 66, YARD], [0, 86, YARD], [0, 102, YARD],
  ],
  width: [8, 7, 7, 7, 7, 8, 11, 13, 13, 13, 13, 13, 14, 15, 15, 18, 18, 16],
  shape: (x, z, y, near) => {
    // the crater walls: broken into ridges and gullies of cooled flows instead of smooth slopes
    const out = Math.min(1, Math.max(0, near.d - near.w) / 12);
    y += ((1 - Math.abs(fbm(x * 0.06, z * 0.06, 3, 21) * 2 - 1)) * 8 - 3.5) * out;
    y += (fbm(x * 0.21, z * 0.21, 2, 22) - 0.5) * 2.2 * out;
    // the lava pool's terrace west of the Great Forge, then the pool itself
    const dp = Math.hypot(x - POOL.x, z - POOL.y);
    const shelf = sstep(17, 11, dp);
    y = y * (1 - shelf) + (YARD + 0.3) * shelf;
    const kp = sstep(8.6, 6.6, dp + (fbm(x * 0.15, z * 0.15, 2, 5) - 0.5) * 2.4);
    y = Math.min(y, y * (1 - kp) + (POOL_Y - 0.7) * kp);
    // the channel: an open shelf either side, then the bed
    const c = nearChannel(x, z);
    const cs = sstep(9, 4.5, c.d) * sstep(-12, -2, z);
    y = Math.min(y, y * (1 - cs) + (c.h + 1.6) * cs);
    const cb = sstep(2.4, 1.3, c.d);
    y = Math.min(y, y * (1 - cb) + (c.h - 0.6) * cb);
    // the river canyon: steep basalt banks, fading into the crater walls at both ends
    const r = nearRiver(x, z);
    const k = sstep(4.6, 2.7, r + (fbm(x * 0.2, z * 0.2, 2, 8) - 0.5) * 0.8) * sstep(86, 72, Math.abs(x));
    y = Math.min(y, y * (1 - k) + (LAVA_Y - 0.8) * k);
    return y;
  },
});
const H = (x: number, z: number) => valley.height(x, z);

export class HeartForge implements Level {
  id = 'heartforge';
  chapter = 4;
  title = 'The Heart Forge';
  checkpoints = ['start', 'descent', 'bridge', 'forges', 'gate', 'heart', 'end'];
  private game!: Game;
  private heartPos = V(0, YARD, 78);
  private heartLight: ReturnType<Game['light']> | null = null;
  private heartFire: { on: boolean; pos: THREE.Vector3 }[] = [];
  private lavaPts: THREE.Vector3[] = [];
  private bubbleT = 0;
  private anvils: { pos: THREE.Vector3; smith: Enemy | null; t: number }[] = [];
  private fury = 0;
  /** phase two: black fire clinging to the Forgemother */
  private aura: { e: { on: boolean; pos: THREE.Vector3 }; boss: Enemy } | null = null;

  async load(game: Game): Promise<void> {
    this.game = game;
    game.envLight = 0.8;
    applyAtmosphere(game, {
      // a cool, ash-veiled moon against the warm light of the lava: the two temperatures keep the crater legible
      sun: V(-0.3, 0.42, 0.6), night: true, sunPower: 1.0, lightIntensity: 0.6, mie: 3.0, rayleigh: 0.6,
      tint: new THREE.Color(0.82, 0.86, 1.0), zenith: new THREE.Color(0.5, 0.46, 0.5), clouds: 1.0, cloudDensity: 1.0, cloudTint: new THREE.Color(0.42, 0.34, 0.32), stars: 0, skyGain: 0.9, env: 0.7,
      // the lava lights everything from below: the IBL's lower hemisphere, the bellies of the smoke, the low haze
      groundGlow: new THREE.Color(0.42, 0.12, 0.025),
      fog: { density: 0.016, falloff: 0.07, baseHeight: 3, farDensity: 0.006, anisotropy: 0.35, noise: 0.85, tint: new THREE.Color(0.42, 0.37, 0.35), sunScatter: 0.3, skyFog: 0.75,
        glow: new THREE.Color(0.13, 0.032, 0.007), glowBase: LAVA_Y, glowFalloff: 0.1 },
      grade: { exposure: 1.15, temperature: 0.0, contrast: 1.12, saturation: 0.95, vignette: 0.5, shadowTint: new THREE.Color(0.24, 0.25, 0.33), highlightTint: new THREE.Color(0.7, 0.52, 0.34), splitBalance: 0.05, expMax: 1.7 },
      bloom: 0.95,
    });
    G.uWind.value.set(0.6, 0.15, 0.4, 0.15);
    game.envFx = {};
    // ash falling out of the dark: grey flakes, slower than snow
    game.weather.setSnow(5000, { color: new THREE.Color(0.16, 0.15, 0.14), speed: 0.45, size: 24, ember: 0.07 });

    const layers = [
      { name: 'rock_cracked', scale: 3.2, tint: new THREE.Color(0.26, 0.23, 0.21) },
      { name: 'burned_ground_01', scale: 3.0, tint: new THREE.Color(0.5, 0.45, 0.4) },
      { name: 'rocky_trail', scale: 3.0, tint: new THREE.Color(0.42, 0.38, 0.35) },
      { name: 'rock_cliff', scale: 7, depth: 0.05, tint: new THREE.Color(0.3, 0.28, 0.27) },
    ];
    const farLayers = [
      { name: 'rock_cracked', scale: 8, tint: new THREE.Color(0.2, 0.18, 0.17) },
      { name: 'burned_ground_01', scale: 8, tint: new THREE.Color(0.3, 0.28, 0.26) },
      { name: 'rocky_trail', scale: 8, tint: new THREE.Color(0.35, 0.32, 0.3) },
      { name: 'rock_cliff', scale: 14, tint: new THREE.Color(0.22, 0.2, 0.19) },
    ];
    valley.build(game, layers, farLayers, (x, z, h, slope) => {
      const p = valley.near(x, z);
      const trail = sstep(3.0, 1.0, p.d) * (z < -30 ? 1 : 0);
      const yard = z > 54 && Math.abs(x) < 17 ? 0.4 : 0;
      const steep = sstep(0.34, 0.58, slope);
      const ash = Math.min(1, sstep(4, 20, p.d - p.w) * 0.8 + sstep(0.58, 0.75, fbm(x * 0.07, z * 0.07, 3, 12)) * 0.6) * sstep(5, 9, nearRiver(x, z));
      const path = Math.min(1, trail * 0.75 + yard);
      void h;
      return [Math.max(0, 1 - path - ash) * (1 - steep), ash * (1 - path) * (1 - steep), path * (1 - steep), steep];
    }, new THREE.Vector2(0, -20), { cracks: { color: new THREE.Color(1.1, 0.22, 0.035), scale: 0.5, width: 0.012, world: true, below: FLOOR - 0.2 } });

    // ---------------------------------------------------------------- lava
    const lavaOpts = { speed: 0.35, scale: 0.55, heat: 3.2, crust: 0.66 };
    const riverPts = RIVER.map(([x, z]) => V(x, LAVA_Y, z));
    game.levelRoot.add(lavaMesh(game.pipe, ribbon(riverPts, 7.5, V(0, 1, 0), 8), lavaOpts));
    game.levelRoot.add(lavaMesh(game.pipe, ribbon(CHANNEL.map(([x, z, h]) => V(x, h, z)), 4.0, V(0, 1, 0), 6), { speed: 0.6, scale: 0.8, heat: 3.3, crust: 0.6 }));
    game.levelRoot.add(lavaMesh(game.pipe, ribbon([V(POOL.x, POOL_Y, POOL.y - 10), V(POOL.x, POOL_Y, POOL.y + 10)], 20, V(0, 1, 0), 12), { speed: 0.1, scale: 0.4, heat: 3.0, crust: 0.7 }));
    // light, heat shimmer and rising embers along every flow
    const along = (pts: THREE.Vector3[], step: number, fn: (p: THREE.Vector3, i: number) => void) => {
      const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      const n = Math.max(2, Math.round(c.getLength() / step));
      c.getSpacedPoints(n).forEach(fn);
    };
    const lavaLight = (p: THREE.Vector3, k = 1) => game.light({ position: p.clone().setY(p.y + 1.5), color: new THREE.Color(1, 0.3, 0.06), intensity: 16 * k, distance: 15, flicker: 0.12 });
    along(riverPts, 9, (p, i) => {
      if (Math.abs(p.x) > 74) return;
      this.lavaPts.push(p.clone());
      lavaLight(p);
      if (Math.abs(p.x) < 46) game.pipe.haze.sources.push({ pos: p.clone().setY(p.y + 0.8), radius: 2.6, strength: 0.55 });
      if (i % 2 === 0) game.particles.emitter('ember', p.clone().setY(p.y + 0.3), 3, 2.6);
    });
    along(CHANNEL.map(([x, z, h]) => V(x, h, z)), 11, (p, i) => {
      this.lavaPts.push(p.clone());
      lavaLight(p, 0.8);
      game.pipe.haze.sources.push({ pos: p.clone().setY(p.y + 0.6), radius: 1.6, strength: 0.45 });
      if (i % 2 === 1) game.particles.emitter('ember', p.clone().setY(p.y + 0.3), 2, 1.4);
    });
    for (const dz of [-4, 4]) {
      const p = V(POOL.x + 1, POOL_Y, POOL.y + dz);
      this.lavaPts.push(p);
      lavaLight(p, 1.4);
      game.pipe.haze.sources.push({ pos: p.clone().setY(p.y + 1.0), radius: 3.5, strength: 0.6 });
    }
    game.particles.emitter('smoke', V(POOL.x, POOL_Y + 1.5, POOL.y), 3, 4.5, V(0.15, 1, 0.05));
    game.particles.emitter('ember', V(POOL.x, POOL_Y + 0.4, POOL.y), 6, 5);

    const jobs: Promise<unknown>[] = [];
    const r = rand(4);
    // ---------------------------------------------------------------- the rim and the descent
    jobs.push(place(game, K + 'torii.glb', 0, -142, { scale: 1.05, y: H(0, -142) - 0.15, tilt: new THREE.Euler(0, 0, 0.05) }));
    for (const x of [-3.4, 3.4]) jobs.push(place(game, K + 'lantern_stone.glb', x, -139, { scale: 0.85, rot: r() * 6, y: H(x, -139) - 0.1 }));
    for (const [k, x, z, sc, rot] of [
      ['basalt_cliff_a', -19, -132, 1.15, 0.6], ['basalt_cliff_b', 26, -114, 1.2, -0.5], ['basalt_cliff_a', -22, -96, 1.2, 1.2], ['basalt_cliff_b', 25, -78, 1.15, -0.2],
      ['basalt_cliff_a', -20, -58, 1.3, 0.3], ['basalt_c', 13, -50, 1.1, 0.8], ['basalt_c', -11, -36, 1.0, 2.0],
      // the canyon mouths, where the river leaves the walls
      ['basalt_cliff_b', -40, -15, 1.3, 0.2], ['basalt_cliff_a', 42, 0, 1.3, 2.9], ['basalt_cliff_b', 30, -22, 1.1, -0.4], ['basalt_cliff_a', -34, 7, 1.1, 2.6],
      // around the Great Forge
      ['basalt_cliff_a', -24, 104, 1.4, 0.4], ['basalt_cliff_b', 18, 112, 1.3, -0.3], ['basalt_cliff_b', -42, 70, 1.4, 1.4],
    ] as const) {
      jobs.push(place(game, R + k + '.glb', x, z, { scale: sc, rot, y: H(x, z) - 0.9 }));
    }
    // basalt boulders along the river banks
    for (let i = 0; i < 26; i++) {
      const p = riverPts[1].clone().lerp(riverPts[riverPts.length - 2], r());
      const x = p.x;
      if (Math.abs(x) < 4) continue;
      const side = r() < 0.5 ? -1 : 1;
      let z = 0;
      for (let k = 0; k < RIVER.length - 1; k++) if (x >= RIVER[k][0] && x <= RIVER[k + 1][0]) { const t = (x - RIVER[k][0]) / (RIVER[k + 1][0] - RIVER[k][0]); z = RIVER[k][1] + (RIVER[k + 1][1] - RIVER[k][1]) * t; }
      z += side * (4.6 + r() * 1.5);
      jobs.push(place(game, R + (r() < 0.5 ? 'basalt_a' : 'basalt_c') + '.glb', x, z, { scale: 0.5 + r() * 0.6, rot: r() * 6, y: H(x, z) - 0.3 }));
    }
    // the lava bridge
    jobs.push(place(game, K + 'bridge_arched.glb', 0, -8, { rot: Math.PI / 2, y: FLOOR - 0.6 }));
    for (const [x, z] of [[-1.9, -14.2], [1.9, -14.2], [-1.9, -1.8], [1.9, -1.8]]) {
      jobs.push(place(game, K + 'lantern_stone.glb', x, z, { scale: 0.8, rot: r() * 6, y: FLOOR - 0.05 }));
    }
    // ---------------------------------------------------------------- the smiths' quarter
    for (const [x, z, side] of [[-11.5, 16, 1], [11.5, 28, -1], [-11.5, 40, 1]] as const) {
      jobs.push(place(game, K + 'forge_hearth.glb', x, z, { rot: side * Math.PI / 2, y: H(x, z) - 0.05 }));
      const ax = x + side * 2.7, az = z + 0.9;
      jobs.push(place(game, K + 'anvil.glb', ax, az, { rot: Math.PI / 2 + (r() - 0.5) * 0.3, y: H(ax, az) - 0.02 }));
      jobs.push(place(game, K + 'barrel.glb', x + side * 1.9, z - 1.9, { rot: r() * 6, y: H(x, z) - 0.02 }));
      this.anvils.push({ pos: V(ax + 0.05, H(ax, az) + 0.86, az), smith: null, t: r() });
      this.hearth(V(x, H(x, z), z), side);
    }
    jobs.push(place(game, K + 'minka_burnt_a.glb', -21, 22, { rot: Math.PI / 2, y: H(-21, 22) - 0.2 }));
    jobs.push(place(game, K + 'minka_burnt_b.glb', -21, 39, { rot: Math.PI / 2 + 0.1, y: H(-21, 39) - 0.2 }));
    jobs.push(place(game, K + 'cart.glb', 8, 12, { rot: 0.6, y: H(8, 12) }));
    jobs.push(place(game, K + 'hay_rack_burnt.glb', 13, 44, { rot: Math.PI / 2 - 0.2, y: H(13, 44) }));
    for (const [x, z] of [[6, 20], [-6, 33], [9, 41]]) jobs.push(place(game, K + 'barrel.glb', x, z, { rot: r() * 6, y: H(x, z) - 0.02 }));
    // ---------------------------------------------------------------- the Great Forge
    jobs.push(place(game, K + 'torii.glb', 0, 55, { scale: 1.35, y: YARD - 0.05 }));
    for (const x of [-1.7, 1.7]) jobs.push(place(game, K + 'chain_hang.glb', x, 55, { y: YARD + 5.3, rot: r() }));
    jobs.push(place(game, K + 'shrine_hall.glb', 0, 100, { rot: Math.PI, y: YARD - 0.6 }));
    jobs.push(place(game, K + 'brazier.glb', this.heartPos.x, this.heartPos.z, { scale: 2.2, y: YARD }));
    for (const [x, side] of [[-13.5, 1], [13.5, -1]] as const) {
      jobs.push(place(game, K + 'forge_hearth.glb', x, 90, { rot: side * Math.PI / 2, y: YARD - 0.05 }));
      jobs.push(place(game, K + 'anvil.glb', x + side * 2.8, 91, { rot: Math.PI / 2, y: YARD - 0.02 }));
      this.hearth(V(x, YARD, 90), side);
    }
    for (const [x, z] of [[-11, 62], [11, 62], [-11, 76], [11, 76]]) {
      jobs.push(place(game, K + 'brazier.glb', x, z, { scale: 0.8, y: YARD }));
      game.particles.emitter('fire', V(x, YARD + 0.95, z), 14, 0.3);
      game.particles.emitter('ember', V(x, YARD + 1.2, z), 2, 0.3);
      game.light({ position: V(x, YARD + 1.8, z), color: new THREE.Color(1, 0.5, 0.18), intensity: 14, distance: 13, flicker: 0.35 });
      game.pipe.haze.sources.push({ pos: V(x, YARD + 1.3, z), radius: 0.9, strength: 0.6 });
    }
    // Ren's post: a small gate before the Heart with chains hanging from the lintel
    jobs.push(place(game, K + 'torii.glb', 2.5, 72.4, { scale: 0.62, y: YARD - 0.02 }));
    for (const x of [2.5 - 0.55, 2.5 + 0.55]) jobs.push(place(game, K + 'chain_hang.glb', x, 72.4, { y: YARD + 2.7, scale: new THREE.Vector3(1, 0.62, 1), rot: r() }));
    await Promise.all(jobs);
    paving(game, -15, 58, 15, 98, YARD + 0.02, 'volcanic_tiles', 2.4, new THREE.Color(0.55, 0.5, 0.48));

    // the black Heart: dark fire roaring out of the great brazier
    const hp = this.heartPos;
    this.heartFire.push(game.particles.emitter('hexfire', hp.clone().setY(YARD + 2.35), 26, 1.0));
    this.heartFire.push(game.particles.emitter('blackfire', hp.clone().setY(YARD + 2.45), 34, 0.8));
    this.heartFire.push(game.particles.emitter('smoke', hp.clone().setY(YARD + 4.5), 6, 1.0, V(0, 1, 0)));
    this.heartLight = game.light({ position: hp.clone().setY(YARD + 3.4), color: new THREE.Color(0.55, 0.1, 0.3), intensity: 10, distance: 18, flicker: 0.5, priority: 2 });

    const blocked = (_x: number, z: number) => z > -46;
    await valley.forest(game, { kinds: [['dead', 1]], far: [['dead', 1]], extent: [-110, 110, -165, -40], count: 90, farCount: 2600, blocked });
    await valley.groundCover(game, { extent: [-90, 90, -160, 110], rocks: 150, tufts: 0, rockKinds: ['basalt_a', 'basalt_a', 'basalt_c'], blocked: (x, z) => nearRiver(x, z) < 6 || nearChannel(x, z).d < 4.5 || (z > 52 && Math.abs(x) < 20) });

    // playable area: the corridor, narrowed to the bridge over the river
    const b = valley.bounds(1.5);
    for (const p of b) if (p.y > -13.2 && p.y < -2.8) p.x = Math.sign(p.x) * Math.min(Math.abs(p.x), 0.85);
    game.world.bounds = b;
    game.music = { explore: 'c4_explore', combat: 'c4_combat', boss: 'c4_boss' };
    void game.audio.ambient('loop_fire', 0.45);
    void game.audio.ambient('loop_wind', 0.3);
  }

  /** a working forge: the coal bed burns, smoke from the flue, embers and a low red light */
  private hearth(base: THREE.Vector3, side: number): void {
    const g = this.game;
    const c = base.clone().setY(base.y + 1.0);
    g.particles.emitter('fire', c, 10, 0.5);
    g.particles.emitter('ember', c.clone().setY(c.y + 0.3), 2, 0.5);
    g.particles.emitter('smoke', V(base.x - side * 0.15, base.y + 5.2, base.z), 2, 0.3, V(0.1, 1, 0));
    g.light({ position: V(base.x + side * 0.8, base.y + 1.6, base.z), color: new THREE.Color(1, 0.42, 0.12), intensity: 12, distance: 10, flicker: 0.35 });
    g.pipe.haze.sources.push({ pos: c.clone().setY(c.y + 0.4), radius: 0.8, strength: 0.5 });
  }

  update(dt: number): void {
    const g = this.game;
    const P = g.player;
    // the lava spits: bursts of sparks and a gout of smoke near Kaede
    this.bubbleT -= dt;
    if (this.bubbleT <= 0 && this.lavaPts.length && P) {
      this.bubbleT = 0.5 + Math.random() * 1.2;
      const near = this.lavaPts.filter((p) => p.distanceTo(P.body.pos) < 40);
      if (near.length) {
        const p = near[Math.floor(Math.random() * near.length)].clone();
        p.x += (Math.random() - 0.5) * 3;
        p.z += (Math.random() - 0.5) * 2;
        g.particles.burst('spark', p.clone().setY(p.y + 0.15), 10, V(0, 1, 0), 1.2);
        g.particles.burst('ember', p.clone().setY(p.y + 0.3), 6, V(0, 1, 0));
        if (Math.random() < 0.35) g.particles.burst('smoke', p.clone().setY(p.y + 0.6), 2, V(0, 1, 0), 0.8);
      }
    }
    // the smiths' hammers: sparks fly off the anvils on each blow
    for (const a of this.anvils) {
      if (!a.smith || a.smith.dead || a.smith.aware) continue;
      a.t += dt;
      if (a.t > 1.35) {
        a.t -= 1.35;
        g.particles.burst('spark', a.pos, 16, V(0, 1, 0), 1.0);
        g.audio.sfx('clang', a.pos, 0.35);
      }
    }
    if (this.aura) {
      this.aura.e.pos.copy(this.aura.boss.body.pos).setY(this.aura.boss.body.pos.y + 1.3);
      if (this.aura.boss.dead) { this.aura.e.on = false; this.aura = null; }
    }
    // the Forgemother's fury makes the Heart roar
    if (this.heartLight && this.fury > 0) this.heartLight.intensity = 10 + this.fury * 8 * (0.7 + 0.3 * Math.sin(g.gameTime * 9));
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

    // ---------------------------------------------------------------- the rim
    if (idx <= 0) {
      P.teleport(at(0, -147), 0);
      game.cam.snapBehind(0);
      game.setCheckpoint('start', at(0, -147), 0);
      game.setCinematic(true);
      game.shot({ pos: V(0.3, H(0, -153) + 2.3, -153), look: V(0, 7, -40), fov: 48, focus: 40 });
      await game.hud.fade(0, 2.5);
      void game.hud.chapterCard('Chapter Four', 'The Heart Forge', 'Inside the mountain');
      await game.wait(3.8);
      game.shot({ pos: V(1.6, H(0, -145) + 1.7, -145.0), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 36, blend: 3, focus: 2.4 });
      await game.say('Kaede', 'The whole mountain is hollow. Hollow, and burning.', undefined, P.char, 'surprised');
      await game.say('Kaede', 'Ren is down there somewhere. Hold on. I am almost there.', undefined, P.char, 'determined');
      game.setCinematic(false);
      game.hud.objective('Descend into the Heart Forge');
      game.hint('Cinder Burst (3) blasts every enemy around you: save your Ember for crowds', 'Cinder Burst (D-pad down) blasts every enemy around you', 'BURST blasts every enemy around you: save your Ember for crowds', 6);
    }
    // ---------------------------------------------------------------- the switchbacks
    if (idx <= 1) {
      if (idx === 1) { P.teleport(at(10, -130), -0.4); game.cam.snapBehind(-0.4); }
      await game.waitUntil(() => P.body.pos.z > -126);
      game.setCheckpoint('descent', at(8, -126), -0.4);
      const a = [await spawnAt(FOOTMAN, -5, -110), await spawnAt(FOOTMAN, 1, -106), await spawnAt(SPEARMAN, -3, -100)];
      await game.waitDefeated(a);
      await game.waitUntil(() => P.body.pos.z > -90);
      const b = [await spawnAt(WRAITH, 2, -76), await spawnAt(WRAITH, -8, -74), await spawnAt(FOOTMAN, -2, -70)];
      await game.say('Kaede', 'They know I am here.', 1.8, P.char, 'fierce');
      await game.waitDefeated(b);
    }
    // ---------------------------------------------------------------- the lava bridge
    if (idx <= 2) {
      if (idx === 2) { P.teleport(at(2, -54), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -46);
      game.setCheckpoint('bridge', at(0, -44), 0);
      const g = [await spawnAt(BRUTE, 0, -22, Math.PI, false), await spawnAt(SPEARMAN, -5, -27, Math.PI, false), await spawnAt(SPEARMAN, 5, -28, Math.PI, false)];
      for (const e of g) e.perform(e.def.idle ?? 'e_idle', true);
      game.setCinematic(true);
      game.shot({ pos: V(-7, FLOOR + 3.6, -30), look: V(0, FLOOR + 0.4, -8), fov: 42, blend: 1.4, focus: 20 });
      await game.wait(1.6);
      await game.say('Kaede', 'A river of fire, and one bridge. Of course they are guarding it.', undefined, P.char, 'determined');
      game.setCinematic(false);
      for (const e of g) { e.release(); e.alert(); }
      game.hud.objective('Cross the lava bridge');
      await game.waitDefeated(g);
    }
    // ---------------------------------------------------------------- the smiths' quarter
    if (idx <= 3) {
      if (idx === 3) { P.teleport(at(0, -0.5), 0); game.cam.snapBehind(0); }
      await game.waitUntil(() => P.body.pos.z > -1);
      game.setCheckpoint('forges', at(0, -0.5), 0);
      game.hud.objective('Find Ren');
      const smiths: Enemy[] = [];
      for (const a of this.anvils) {
        const side = a.pos.x < 0 ? 1 : -1;
        const s = await game.spawn(SMITH, V(a.pos.x + side * 0.95, H(a.pos.x, a.pos.z), a.pos.z), side > 0 ? -Math.PI / 2 : Math.PI / 2, { aware: false });
        s.perform('b_slam', true);
        a.smith = s;
        a.t = Math.random();
        smiths.push(s);
      }
      await game.say('Kaede', 'Blades. They are forging blades for the King\'s army.', 2.4, P.char, 'angry');
      await game.waitUntil(() => P.body.pos.z > 11 || smiths.some((s) => s.hp < s.maxHp || s.dead));
      for (const s of smiths) if (!s.dead) { s.release(); s.alert(); }
      const extra = [await spawnAt(FOOTMAN, 4, 36), await spawnAt(FOOTMAN, -3, 40)];
      await game.waitDefeated([...smiths, ...extra]);
      await game.waitUntil(() => P.body.pos.z > 32);
      const b = [await spawnAt(SPEARMAN, -4, 48), await spawnAt(SPEARMAN, 4, 50), await spawnAt(BRUTE, 0, 53)];
      await game.waitDefeated(b);
    }
    // ---------------------------------------------------------------- the Great Forge: Ren in chains
    let boss: Enemy | null = null;
    if (idx <= 4) {
      if (idx === 4) { P.teleport(at(0, 44), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('gate', at(0, 44), 0);
      game.hud.objective('Enter the Great Forge');
      boss = await game.spawn(FORGEMOTHER, V(0, YARD, 82.5), Math.PI, { aware: false });
      boss.perform('b_idle', true);
      boss.invulnerable = true;
      const ren = await NPC.create(game, { name: 'Ren', url: 'assets/chars/ren.glb', pos: V(2.5, YARD, 72.2), yaw: 0, idle: 'stand_relaxed', mood: 'fear' });
      ren.pose('kneel', { loop: true, fade: 0 });
      ren.char.face.set('fear');
      const taker = await game.spawn(WRAITH, V(4.8, YARD, 71.2), -Math.PI / 2, { aware: false });
      taker.perform('w_idle', true);
      taker.invulnerable = true;
      await game.waitUntil(() => P.body.pos.z > 56);
      game.setCinematic(true);
      P.teleport(V(0, YARD, 60.5), 0);
      game.cam.snapBehind(0);
      game.shot({ pos: V(-6.5, YARD + 3.4, 60.5), look: V(0.5, YARD + 2.4, 78), fov: 42, blend: 1.4, focus: 18 });
      await game.wait(1.4);
      await game.say('The Forgemother', 'Light it, little ember. One touch of your hand, and the pain stops.', undefined, boss.char, 'calm');
      game.shot({ pos: V(1.7, YARD + 1.0, 74.3), look: ren.head, fov: 32, blend: 1.0, focus: 2.2 });
      await game.say('Ren', 'No. I will never light anything for him.', undefined, ren.char, 'fear');
      await game.say('Ren', 'My sister is coming. She will put out every one of you.', undefined, ren.char, 'determined');
      game.shot({ pos: V(-1.6, YARD + 1.4, 75.6), look: boss.center().add(V(0, 0.9, 0)), fov: 32, blend: 1.0, focus: 7 });
      await game.say('The Forgemother', 'Your sister is already here.', 2.0, boss.char, 'angry');
      ren.lookAt(P.char.root);
      game.shot({ pos: V(1.0, YARD + 1.65, 62.6), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 0.8, focus: 2.4 });
      await game.say('Kaede', 'Ren!', 1.2, P.char, 'shout');
      game.shot({ pos: V(1.7, YARD + 1.0, 74.3), look: ren.head, fov: 32, blend: 0.6, focus: 2.2 });
      await game.say('Ren', 'Kaede!', 1.2, ren.char, 'surprised');
      game.shot({ pos: V(-4.5, YARD + 2.2, 66), look: V(2, YARD + 1.6, 76), fov: 38, blend: 1.0, focus: 10 });
      await game.say('The Forgemother', 'Take him to the King. The new moon will not wait.', undefined, boss.char, 'smirk');
      // the wraith takes Ren up the shaft in a storm of ash
      taker.release();
      await Promise.race([taker.walkTo(V(3.3, YARD, 72.2), 2.4), game.wait(1.5)]);
      ren.carriedBy(taker.char, 'socket_back', new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0.3, 0.15, 0.1));
      ren.pose('carried', { loop: true, fade: 0.2 });
      await game.wait(0.9);
      const up = taker.center();
      game.particles.burst('ash', up, 120, V(0, 1, 0), 1.6);
      game.particles.burst('ember', up, 90, V(0, 1, 0), 1.6);
      game.particles.burst('smoke', up, 10, V(0, 1, 0), 1.2);
      game.audio.sfx('burst', up, 0.9);
      game.cam.addTrauma(0.25);
      taker.vanish();
      taker.char.root.visible = false;
      ren.char.root.visible = false;
      await game.wait(0.8);
      game.shot({ pos: V(1.0, YARD + 1.65, 62.6), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 0.6, focus: 2.4 });
      await game.say('Kaede', 'No!', 1.0, P.char, 'shout');
      game.shot({ pos: V(1.5, YARD + 1.0, 72), look: boss.center().add(V(0, 1.0, 0)), fov: 30, blend: 1.0, focus: 9 });
      boss.perform('b_roar');
      game.audio.sfx('boss_roar', boss.body.pos, 1);
      game.cam.addTrauma(0.45);
      await game.wait(1.0);
      await game.say('The Forgemother', 'You want him back? Then come and take him out of the fire.', undefined, boss.char, 'angry');
      game.setCinematic(false);
    }
    if (idx <= 5) {
      if (idx === 5) {
        P.teleport(V(0, YARD, 62), 0);
        game.cam.snapBehind(0);
        boss = await game.spawn(FORGEMOTHER, V(0, YARD, 80), Math.PI, { aware: true });
      }
      boss = boss!;
      game.setCheckpoint('heart', V(0, YARD, 62), 0);
      boss.invulnerable = false;
      boss.release();
      boss.alert();
      game.hud.setBoss(boss);
      game.hud.objective('Defeat the Forgemother');
      const fm = boss;
      await game.waitUntil(() => fm.dead || fm.hp < fm.maxHp * 0.5);
      if (!fm.dead) {
        // phase two: she feeds the black Heart into her armour, and the smiths answer
        fm.roar();
        this.fury = 1;
        game.particles.burst('blackfire', fm.center(), 60, V(0, 1, 0), 1.6);
        game.particles.burst('hexfire', fm.center(), 50, V(0, 1, 0), 1.4);
        this.aura = { e: game.particles.emitter('hexfire', fm.body.pos, 10, 0.45), boss: fm };
        this.heartFire.push(this.aura.e);
        game.particles.burst('ember', fm.center(), 80, undefined, 1.5);
        game.time.slowmo(0.4, 1.0);
        game.cam.addTrauma(0.4);
        game.hud.toast('The Forgemother drinks the black fire', 2.5);
        for (const f of this.heartFire) f.on = true;
        await game.spawn(SMITH, V(-12, YARD, 86), Math.PI / 2, { aware: true });
        await game.spawn(SMITH, V(12, YARD, 66), -Math.PI / 2, { aware: true });
      }
      await game.waitDefeated([fm]);
      for (const e of game.enemies) if (!e.dead) e.die();
      game.hud.setBoss(null);
      this.fury = 0;
    }
    await this.ending(game, boss);
  }

  private async ending(game: Game, boss: Enemy | null): Promise<void> {
    const P = game.player;
    game.setCheckpoint('end', V(0, YARD, 70), 0);
    game.hud.objective(null);
    game.musicOverride = 'sorrow';
    await game.wait(1.8);
    const where = boss ? boss.body.pos.clone() : V(0, YARD, 80);
    // the ash falls away from her: the smith she was
    boss?.vanish();
    if (boss) boss.char.root.visible = false;
    game.particles.burst('ash', where.clone().setY(where.y + 1.2), 120, undefined, 1.4);
    game.particles.burst('ember', where.clone().setY(where.y + 1.2), 60, undefined, 1.2);
    game.audio.sfx('heal', where, 0.8);
    const fm = await NPC.create(game, { name: 'The Forgemother', url: 'assets/chars/forgemother.glb', pos: where, yaw: Math.PI, idle: 'stand_relaxed', scale: 1.3, mood: 'pain' });
    fm.pose('kneel', { loop: true, fade: 0 });
    game.setCinematic(true);
    P.setDrawn(false);
    P.teleport(where.clone().add(V(0.4, 0, -2.4)), 0);
    fm.lookAt(P.char.root);
    game.shot({ pos: where.clone().add(V(2.9, 1.3, -2.8)), look: where.clone().add(V(0, 1.15, -0.4)), fov: 34, blend: 1.0, focus: 3.4 });
    await game.wait(1.0);
    await game.say('The Forgemother', 'The ash is leaving me... I remember my name now. I was a smith of Akari, before the King.', undefined, fm.char, 'sad');
    await game.say('Kaede', 'Where did they take my brother?', undefined, P.char, 'worried');
    await game.say('The Forgemother', 'To the Hollow Crown, the old capital. Soen will make him light the black flame at the new moon.', undefined, fm.char, 'worried');
    await game.say('The Forgemother', 'Tonight. Relight my Heart, girl. Its fire will carry you further than mine ever did.', undefined, fm.char, 'warm');
    game.particles.burst('ash', where.clone().setY(where.y + 1.0), 140, V(0, 1, 0), 1.5);
    game.particles.burst('ember', where.clone().setY(where.y + 1.0), 40, V(0, 1, 0), 1.0);
    fm.char.root.visible = false;
    await game.wait(1.0);
    await game.say('Kaede', 'Rest now. I will finish it.', undefined, P.char, 'sad');
    game.setCinematic(false);
    game.musicOverride = null;
    game.hud.objective('Relight the Heart of the Forge');
    const hp = this.heartPos;
    await new Promise<void>((res) => game.interact(hp.clone().setY(YARD + 0.5), 'Relight the Heart', () => res(), 3.4));
    game.setCinematic(true);
    P.char.animator.play('interact', { fade: 0.2 });
    game.shot({ pos: hp.clone().add(V(-4.2, 2.8, -4.6)), look: hp.clone().add(V(0, 2.2, 0)), fov: 40, blend: 1, focus: 6 });
    await game.wait(0.5);
    for (const f of this.heartFire) f.on = false;
    if (this.heartLight) { this.heartLight.color.setRGB(1, 0.5, 0.18); this.heartLight.intensity = 90; }
    game.particles.emitter('blaze', hp.clone().setY(YARD + 2.5), 40, 0.9);
    game.particles.emitter('fire', hp.clone().setY(YARD + 2.6), 50, 1.1);
    game.particles.emitter('ember', hp.clone().setY(YARD + 3.2), 18, 1.2);
    game.pipe.haze.sources.push({ pos: hp.clone().setY(YARD + 3.2), radius: 2.4, strength: 1.0 });
    game.particles.burst('flash', hp.clone().setY(YARD + 2.8), 1, undefined, 5);
    game.particles.burst('ember', hp.clone().setY(YARD + 2.8), 160, V(0, 1, 0), 1.6);
    game.audio.sfx('ignite', hp, 1);
    game.cam.addTrauma(0.2);
    game.musicOverride = 'title';
    await game.wait(1.4);
    // the fourth Ember: Kaede's strength grows with it
    P.maxHp += 25;
    P.hp = P.maxHp;
    P.maxHeals += 1;
    P.heals = P.maxHeals;
    game.hud.toast('The fourth Ember: maximum health and healing increased', 4);
    game.shot({ pos: hp.clone().add(V(2.6, 1.8, -3.4)), look: P.body.pos.clone().setY(P.body.pos.y + 1.55), fov: 34, blend: 1.5, focus: 3.2 });
    await game.say('Kaede', 'Four Embers.', 1.6, P.char, 'determined');
    await game.say('Kaede', 'One more, Ren. Then we go home.', undefined, P.char, 'fierce');
    await game.hud.fade(1, 2.5);
    game.setCinematic(false);
    game.musicOverride = null;
    game.onChapterComplete?.(this.id);
  }
}
