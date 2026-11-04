// Chapter One — Cinders. Hinoka village at autumn dusk, burning.
// Waterfall shrine (start) -> terrace path -> lower village -> stream bridge -> village square (Gorran takes
// Ren) -> shrine stairs -> courtyard (boss: Gorran the Ashen) -> Oren's last words, the Ember relit.
import * as THREE from 'three';
import type { Game, Level } from '../game/Game';
import type { Enemy } from '../game/Enemy';
import { NPC } from '../game/NPC';
import { paperGlow } from '../game/Materials';
import { applyAtmosphere, buildTerrain, fbm, grass, impostors, paving, place, rand, scatter, type Xform } from './common';
import { FOOTMAN, SPEARMAN, WRAITH, BRUTE, GORRAN } from './enemies';
import { ribbon, waterMesh } from '../render/Water';
import { G } from '../render/MaterialFX';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const K = 'assets/env/village/';
const R = 'assets/env/rocks/';
const T = 'assets/env/trees/';

// the walking route: (x, z, ground height)
const PATH: [number, number, number][] = [
  [0, -152, 24], [4, -138, 23], [10, -124, 20], [14, -108, 15.5], [9, -92, 11.5], [-2, -76, 7.5], [-4, -60, 3.5],
  [-2, -44, 1.2], [0, -24, 0.5], [1, -4, 0.3], [0, 18, 0.3], [0, 40, 0.3], [0, 58, 0.5],
];
// half-width of the walkable valley along the path (narrow trail above, wide village below)
const WIDTH = [9, 7, 6, 7, 7, 8, 12, 22, 24, 24, 20, 24, 16];
// the stream: from the waterfall pool, down the east side, under the bridge, away to the west
const STREAM: [number, number][] = [
  [0, -157], [12, -150], [24, -136], [30, -112], [30, -86], [26, -60], [24, -30], [22, 0], [12, 16], [0, 18], [-14, 20], [-34, 26], [-70, 34],
];
const SHRINE_Y = 5.9; // courtyard level
const STAIRS_Z0 = 63;

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): [number, number] {
  const dx = bx - ax, dz = bz - az;
  const L = dx * dx + dz * dz;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L)) : 0;
  const x = ax + dx * t - px, z = az + dz * t - pz;
  return [Math.sqrt(x * x + z * z), t];
}

/** nearest point on the route: distance, ground height there, half-width there */
function nearPath(x: number, z: number): { d: number; h: number; w: number } {
  let best = { d: 1e9, h: 0, w: 10 };
  for (let i = 0; i < PATH.length - 1; i++) {
    const a = PATH[i], b = PATH[i + 1];
    const [d, t] = segDist(x, z, a[0], a[1], b[0], b[1]);
    if (d < best.d) best = { d, h: a[2] + (b[2] - a[2]) * t, w: WIDTH[i] + (WIDTH[i + 1] - WIDTH[i]) * t };
  }
  return best;
}

function nearStream(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i < STREAM.length - 1; i++) {
    const a = STREAM[i], b = STREAM[i + 1];
    best = Math.min(best, segDist(x, z, a[0], a[1], b[0], b[1])[0]);
  }
  return best;
}

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** ground before the stream is cut in */
function baseHeight(x: number, z: number): number {
  const p = nearPath(x, z);
  const out = Math.max(0, p.d - p.w);
  // gentle wooded hills either side of the valley, then the mountains beyond the playable area
  let y = p.h + 14 * (1 - Math.exp(-out / 26)) + Math.max(0, out - 50) * 0.12;
  y += (fbm(x * 0.025, z * 0.025, 4, 3) - 0.5) * Math.min(9, 0.4 + out * 0.16);
  y += sstep(50, 160, out) * 22 * fbm(x * 0.012 + 3, z * 0.012, 3, 11);
  // the far ranges: ridged, well beyond the valley so they read as silhouettes against the sky
  const rn = 1 - Math.abs(fbm(x * 0.003 + 7, z * 0.003, 4, 13) * 2 - 1);
  y += sstep(220, 560, out) * 190 * rn * rn;
  y += (fbm(x * 0.2, z * 0.2, 2, 9) - 0.5) * 0.22; // small bumps everywhere
  // the cliff behind the waterfall
  y += sstep(-161.5, -166.5, z) * 19 * sstep(28, 9, Math.abs(x));
  // shrine hill: the stair ramp, then the flat courtyard, then the hill behind it
  if (z > 56 && z < 175 && Math.abs(x) < 60) {
    // a wooded knoll: the stair ramp, the flat courtyard, a rise behind the hall
    const target = z < 62 ? 0.5 : z < 80 ? 0.5 + (SHRINE_Y - 0.5) * sstep(62, 80, z) : z < 122 ? SHRINE_Y : SHRINE_Y + 9 * sstep(122, 150, z);
    const k = sstep(23, 19, Math.abs(x));
    y = y * (1 - k) + target * k;
    const fade = sstep(60, 40, Math.abs(x)) * sstep(175, 150, z);
    if (Math.abs(x) >= 19) y = Math.max(y, target + Math.min(10, (Math.abs(x) - 19) * 0.5) * fade);
  }
  return y;
}

/** the stream's water level: always just below the valley floor at that point */
function streamLevel(x: number, z: number): number {
  return nearPath(x, z).h - 0.55;
}

function height(x: number, z: number): number {
  const y = baseHeight(x, z);
  const ds = nearStream(x, z);
  // the bed is cut relative to the valley floor, so the stream runs level through any rise in the bank
  const bed = streamLevel(x, z) - 0.75;
  const k = sstep(4.8, 1.3, ds);
  return Math.min(y, y * (1 - k) + bed * k + sstep(1.3, 3.0, ds) * 0.3 * k);
}

export class Cinders implements Level {
  id = 'cinders';
  chapter = 1;
  title = 'Cinders';
  checkpoints = ['start', 'terraces', 'village', 'bridge', 'square', 'stairs', 'boss', 'end'];
  private fires: { light: ReturnType<Game['light']>; pos: THREE.Vector3 }[] = [];
  private game!: Game;
  private brazierLight: ReturnType<Game['light']> | null = null;
  private brazierPos = V(0, SHRINE_Y, 92);

  async load(game: Game): Promise<void> {
    this.game = game;
    // dusk: the sun just above the western ridge, smoke over everything
    applyAtmosphere(game, {
      sun: V(-0.8, 0.24, 0.45), sunPower: 20, lightIntensity: 3.6, mie: 1.8, rayleigh: 1.15, ozone: 1.1,
      tint: new THREE.Color(1.0, 0.86, 0.72), zenith: new THREE.Color(0.72, 0.74, 0.95), clouds: 0.55, cloudDensity: 0.9,
      cloudTint: new THREE.Color(1.0, 0.75, 0.6), skyGain: 1.0, env: 1.15,
      fog: { density: 0.0042, falloff: 0.06, baseHeight: 0, farDensity: 0.0016, anisotropy: 0.7, noise: 0.55, tint: new THREE.Color(0.86, 0.74, 0.66), sunScatter: 1.1, skyFog: 0.45 },
      grade: { exposure: 1.05, temperature: 0.12, contrast: 1.08, saturation: 1.02, vignette: 0.42, shadowTint: new THREE.Color(0.42, 0.46, 0.58), highlightTint: new THREE.Color(0.6, 0.52, 0.42), splitBalance: 0.05 },
      bloom: 0.75,
    });
    G.uWind.value.set(0.8, 0.3, 0.55, 0.1);
    paperGlow.setRGB(0, 0, 0);

    const layers = [
      { name: 'grass_ground', scale: 3.4, tint: new THREE.Color(0.78, 0.74, 0.52) },
      { name: 'forest_leaves', scale: 3.0, tint: new THREE.Color(0.8, 0.7, 0.6) },
      { name: 'dirt_path', scale: 2.8 },
      { name: 'rock_moss2', scale: 7, depth: 0.05, tint: new THREE.Color(0.85, 0.82, 0.78) },
    ];
    const splat = (x: number, z: number, _h: number, slope: number): [number, number, number, number] => {
      const p = nearPath(x, z);
      const lane = z > -50 && z < 62 ? sstep(p.w * 0.45, p.w * 0.12, p.d) : sstep(3.0, 1.1, p.d);
      const yard = z > -50 && z < 62 ? sstep(p.w + 2, p.w - 5, p.d) * 0.45 : 0;
      const steepR = sstep(0.22, 0.42, slope);
      const rock = Math.min(1, steepR + sstep(1.4, 0.3, nearStream(x, z)) * 0.7);
      const leaves = sstep(2, 12, p.d - p.w) * (0.6 + 0.4 * fbm(x * 0.05, z * 0.05, 2, 21)) + sstep(0.55, 0.75, fbm(x * 0.09, z * 0.09, 3, 5)) * 0.6;
      const path = Math.min(1, lane + yard);
      const grassW = Math.max(0, 1 - path - rock - leaves * 0.8) * (1 - steepR);
      return [grassW, leaves * (1 - path) * (1 - steepR), path * (1 - steepR), rock];
    };
    buildTerrain(game, { size: 420, seg: 300, center: new THREE.Vector2(0, -40), height, splat, layers });
    // the far ring: mountains to the horizon (no collision, sits under the playable terrain)
    buildTerrain(game, {
      size: 1600, seg: 160, center: new THREE.Vector2(0, -40), collide: false, pom: 0,
      layers: [
        { name: 'grass_ground', scale: 6, tint: new THREE.Color(0.5, 0.47, 0.32) },
        { name: 'forest_leaves', scale: 6, tint: new THREE.Color(0.42, 0.36, 0.28) },
        { name: 'dirt_path', scale: 6 },
        { name: 'rock_moss2', scale: 14, tint: new THREE.Color(0.6, 0.58, 0.55) },
      ],
      height: (x, z) => height(x, z) - (Math.abs(x) < 205 && Math.abs(z + 40) < 205 ? 2.0 : 0),
      splat: (x, z, h, slope) => { const w = splat(x, z, h, slope); return [w[0] * 0.3, w[1] + w[0] * 0.7, 0, w[3]]; },
    });

    const jobs: Promise<unknown>[] = [];
    const r = rand(1);
    const gy = (x: number, z: number) => height(x, z);

    // ---------------------------------------------------------------- the waterfall shrine
    jobs.push(place(game, K + 'torii.glb', 2, -140, { scale: 0.75, rot: 0.15 }));
    for (const [x, z] of [[-3, -144], [7, -142]]) jobs.push(place(game, K + 'lantern_stone.glb', x, z, { rot: r() * 6 }));
    jobs.push(place(game, K + 'dummy.glb', -6, -150, { rot: 0.4 }));
    jobs.push(place(game, K + 'dummy.glb', 6, -149, { rot: -0.5 }));
    // waterfall sheet + pool + stream
    const poolY = gy(0, -157) + 0.55;
    const fall = ribbon([V(0.3, poolY + 17.2, -165.6), V(0.2, poolY + 15.8, -164.6), V(0, poolY + 10, -163.4), V(0, poolY + 4.5, -161.8), V(0, poolY - 0.3, -159.9)], [3.4, 3.8, 4.6, 5.4, 6.4], V(0, 0, 1), 12);
    // a thinner second strand off the lip
    const fall2 = ribbon([V(-3.4, poolY + 14.5, -165.0), V(-3.5, poolY + 8, -163.6), V(-3.3, poolY - 0.3, -160.4)], [0.8, 1.2, 1.8], V(0, 0, 1), 6);
    game.levelRoot.add(waterMesh(game.pipe, fall2, { fall: true, speed: 4.2, foam: 0.8, scale: 0.8, strength: 0.6, shallow: new THREE.Color(0.5, 0.58, 0.58), deep: new THREE.Color(0.2, 0.28, 0.3) }));
    game.particles.emitter('smoke', V(0, poolY + 0.4, -160.4), 4, 1.8, V(0, 0.35, 0.5));
    game.levelRoot.add(waterMesh(game.pipe, fall, { fall: true, speed: 4.5, foam: 0.75, scale: 0.6, strength: 0.6, alpha: [0.85, 0.98], shallow: new THREE.Color(0.5, 0.58, 0.58), deep: new THREE.Color(0.2, 0.28, 0.3) }));
    const pool = ribbon([V(-6, poolY, -158.0), V(6, poolY, -158.0)], 9.5, V(0, 1, 0), 8);
    game.levelRoot.add(waterMesh(game.pipe, pool, { speed: 0.3, bankFoam: 0.05, strength: 0.1, scale: 1.7 }));
    const sPts = STREAM.map(([x, z]) => V(x, streamLevel(x, z), z));
    sPts[0].y = poolY - 0.02;
    game.levelRoot.add(waterMesh(game.pipe, ribbon(sPts, 3.4, V(0, 1, 0), 6), { speed: 1.6, bankFoam: 0.07, strength: 0.2, scale: 1.3 }));

    // ---------------------------------------------------------------- terraces on the descent
    for (let i = 0; i < 6; i++) {
      const z = -118 + i * 9;
      for (const side of [-1, 1]) {
        const p = nearPath(0, z);
        const x = PATH.reduce((acc, q) => (Math.abs(q[1] - z) < Math.abs(acc[1] - z) ? q : acc))[0] + side * (p.w + 3 + r() * 2);
        jobs.push(place(game, K + 'terrace_wall.glb', x, z, { rot: (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 0.3, y: gy(x, z) - 1.0 }));
      }
    }
    for (const [x, z, rot, burnt] of [[20, -100, 0.3, 1], [-10, -84, -0.4, 0], [16, -72, 1.4, 1], [-14, -66, 0.2, 1]] as const) {
      jobs.push(place(game, K + (burnt ? 'hay_rack_burnt.glb' : 'hay_rack.glb'), x, z, { rot }));
      if (burnt) this.fire(V(x, gy(x, z) + 1.2, z), 0.8);
    }

    // ---------------------------------------------------------------- the village
    const houses: [string, number, number, number, number][] = [
      // kind, x, z, rotation (front faces +z at 0), fire intensity (0 = not burning)
      ['minka_thatch', -15, -40, Math.PI / 2, 0], ['minka_burnt_a', 16, -36, -Math.PI / 2, 1.2], ['minka_tile', -16, -22, Math.PI / 2, 0.8],
      ['minka_thatch_small', 15, -18, -Math.PI / 2, 0], ['minka_burnt_b', -17, -4, Math.PI / 2, 1.0], ['minka_tile_long', 17, -1, -Math.PI / 2, 0],
      ['minka_thatch', -18, 34, Math.PI / 2, 1.0], ['minka_tile', 18, 30, -Math.PI / 2, 0], ['minka_burnt_a', -17, 50, Math.PI / 2, 1.1],
      ['minka_thatch_small', 17, 48, -Math.PI / 2, 0.7], ['minka_tile_long', -30, -30, Math.PI / 2, 0], ['minka_thatch', 30, -48, -Math.PI / 2 + 0.2, 0],
      ['minka_burnt_b', 31, 40, -Math.PI / 2, 0.9], ['minka_thatch_small', -32, 44, Math.PI / 2, 0],
    ];
    for (const [kind, x, z, rot, fire] of houses) {
      jobs.push(place(game, K + kind + '.glb', x, z, { rot, y: gy(x, z) - 0.05 }));
      if (fire > 0) {
        const n = kind.includes('burnt') ? 2 : 1;
        for (let i = 0; i < n; i++) this.fire(V(x + (r() - 0.5) * 4, gy(x, z) + (kind.includes('burnt') ? 0.8 : 3.4), z + (r() - 0.5) * 4), fire);
      }
    }
    // fences along the lanes, a well and a cart in the square, barrels and crates
    for (const [x, z, rot] of [[-9, -30, Math.PI / 2], [-9, -26, Math.PI / 2], [9.5, -27, -Math.PI / 2], [9.5, -8, -Math.PI / 2], [-10, 6, Math.PI / 2], [10, 26, -Math.PI / 2], [-10, 28, Math.PI / 2]] as const) {
      jobs.push(place(game, K + 'fence_wood.glb', x, z, { rot }));
    }
    jobs.push(place(game, K + 'well.glb', 6, 38, { rot: 0.3 }));
    jobs.push(place(game, K + 'cart.glb', -7, 44, { rot: 2.2 }));
    jobs.push(place(game, K + 'cart.glb', 7, -30, { rot: -0.7, tilt: new THREE.Euler(0, 0, 0.25) }));
    for (let i = 0; i < 10; i++) {
      const x = (r() < 0.5 ? -1 : 1) * (8 + r() * 3), z = -40 + r() * 90;
      jobs.push(place(game, r() < 0.5 ? 'assets/env/Barrel_01.glb' : 'assets/env/wooden_crate_01.glb', x, z, { rot: r() * 6, scale: 0.9 }));
    }
    // the bridge over the stream
    jobs.push(place(game, K + 'bridge_arched.glb', 0, 18, { rot: Math.PI / 2, y: 0.3 - 0.6 }));
    // lanterns along the lane
    for (const z of [-34, -14, 8, 30, 46]) {
      for (const side of [-1, 1]) jobs.push(place(game, K + 'lantern_stone.glb', side * 6.5, z, { rot: r() * 6, scale: 0.8 }));
    }

    // ---------------------------------------------------------------- the shrine
    jobs.push(place(game, K + 'torii.glb', 0, 59.5, { scale: 1.15 }));
    const flights: [number, number][] = [[STAIRS_Z0, 0.45], [STAIRS_Z0 + 5.8, 2.25], [STAIRS_Z0 + 11.6, 4.05]];
    for (const [z, y] of flights) jobs.push(place(game, K + 'stairs_stone.glb', 0, z, { rot: Math.PI, y: y - 0.02 }));
    for (const [z, y] of flights) for (const side of [-1, 1]) jobs.push(place(game, K + 'lantern_stone.glb', side * 3.4, z - 0.6, { y, scale: 0.85 }));
    jobs.push(place(game, K + 'shrine_hall.glb', 0, 110, { rot: Math.PI, y: SHRINE_Y - 0.02 }));
    jobs.push(place(game, K + 'brazier.glb', this.brazierPos.x, this.brazierPos.z, { y: SHRINE_Y }));
    for (const [x, z] of [[-10, 86], [10, 86], [-12, 100], [12, 100], [-6, 82], [6, 82]]) jobs.push(place(game, K + 'lantern_stone.glb', x, z, { y: SHRINE_Y }));
    jobs.push(place(game, K + 'torii.glb', 0, 81.5, { scale: 0.9, y: SHRINE_Y }));

    await Promise.all(jobs);

    // ---------------------------------------------------------------- trees (after the ground and buildings exist)
    const blocked = (x: number, z: number) => {
      const p = nearPath(x, z);
      if (p.d < p.w * 0.75 + 2) return true;
      for (const [, hx, hz] of houses) if (Math.abs(x - hx) < 7 && Math.abs(z - hz) < 7) return true;
      if (z > 60 && Math.abs(x) < 20 && z < 125) return true;
      if (nearStream(x, z) < 3.2) return true;
      return Math.abs(x) < 12 && z < -140;
    };
    const lists: Record<string, Xform[]> = {};
    const add = (kind: string, x: number, z: number, s = 1) => {
      const v = Math.floor(r() * 3);
      (lists[`${kind}_${v}`] ??= []).push({ x, z, rot: r() * 6.28, scale: s * (0.85 + r() * 0.35), y: height(x, z) - 0.05 });
    };
    for (let i = 0; i < 1400 && Object.values(lists).reduce((a, l) => a + l.length, 0) < 420; i++) {
      const x = (r() - 0.5) * 190, z = -170 + r() * 300;
      if (blocked(x, z)) continue;
      const p = nearPath(x, z);
      const far = p.d - p.w;
      if (far > 70) continue;
      const village = z > -55 && z < 60;
      const k = r();
      if (village) add(k < 0.35 ? 'maple' : k < 0.6 ? 'bamboo' : k < 0.8 ? 'pine' : 'dead', x, z);
      else if (far < 14) add(k < 0.55 ? 'maple' : k < 0.85 ? 'pine' : 'cedar', x, z);
      else add(k < 0.65 ? 'cedar' : 'pine', x, z, 1.1);
    }
    // a pair of old pines framing the waterfall and maples by the shrine
    add('pine', -9, -147, 1.2); add('pine', 10, -153, 1.1);
    add('maple', -14, 92, 1.1); add('maple', 15, 96, 1.0); add('maple', -16, 112, 1.2);
    await Promise.all(Object.entries(lists).map(([k, list]) => scatter(game, T + k + '.glb', list, { tree: true, trunk: k.startsWith('bamboo') ? 0.45 : 0.32 })));
    // rock: outcrops framing the waterfall, stones along the stream, boulders in the woods
    const rr = rand(13);
    const rockJobs: Promise<unknown>[] = [];
    for (const [kind, x, z, sc, rot, dy] of [
      // the cliff the fall drops from: two rows of outcrops either side, a lip over the water
      ['cliff_b', -7.6, -163.6, 1.0, 0.12, -1.2], ['cliff_a', 8.2, -163.4, 0.9, -0.1, -1.2], ['cliff_c', -19, -162.2, 1.1, 0.55, -1.0],
      ['cliff_b', 19.5, -162.0, 1.0, -0.45, -1.2], ['cliff_c', -9, -166.5, 1.0, 0.1, 9.0], ['cliff_c', 10, -166.2, 1.0, -0.12, 8.5],
      ['cliff_c', 0.5, -167.6, 0.85, 0.0, 13.2], ['boulder_c', -5.5, -158.5, 1.0, 0.4, -0.3],
      ['boulder_a', 5.2, -158.2, 0.9, 1.2, -0.2], ['boulder_flat', 3.0, -155.6, 1.0, 0.3, -0.1],
    ] as const) {
      rockJobs.push(place(game, R + kind + '.glb', x, z, { scale: sc, rot, y: gy(x, z) + dy }));
    }
    const banks: Record<string, Xform[]> = { boulder_flat: [], stones: [], stones_b: [], boulder_b: [] };
    for (let i = 0; i < STREAM.length - 1; i++) {
      const [ax, az] = STREAM[i], [bx, bz] = STREAM[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let d = 0; d < L; d += 3.5 + rr() * 3) {
        const side = rr() < 0.5 ? -1 : 1;
        const x = ax + (bx - ax) * d / L + nx * side * (2.0 + rr() * 0.8), z = az + (bz - az) * d / L + nz * side * (2.0 + rr() * 0.8);
        if (Math.abs(z - 18) < 4 && Math.abs(x) < 4) continue; // keep the bridge clear
        const k = rr();
        const kind = k < 0.3 ? 'boulder_flat' : k < 0.6 ? 'stones' : k < 0.85 ? 'stones_b' : 'boulder_b';
        banks[kind].push({ x, z, rot: rr() * 6.28, scale: 0.7 + rr() * 0.5, y: height(x, z) - 0.15 });
      }
    }
    for (const [k, list] of Object.entries(banks)) rockJobs.push(scatter(game, R + k + '.glb', list, { collide: k === 'boulder_b' }));
    const woods: Record<string, Xform[]> = { boulder_a: [], boulder_b: [], boulder_c: [] };
    for (let i = 0; i < 3000 && woods.boulder_a.length + woods.boulder_b.length + woods.boulder_c.length < 140; i++) {
      const x = (rr() - 0.5) * 160, z = -165 + rr() * 290;
      const p = nearPath(x, z);
      const o = p.d - p.w;
      if (o < 1.5 || o > 45 || nearStream(x, z) < 3) continue;
      if (z > 56 && z < 125 && Math.abs(x) < 24) continue;
      const k = rr();
      woods[k < 0.45 ? 'boulder_b' : k < 0.8 ? 'boulder_a' : 'boulder_c'].push({ x, z, rot: rr() * 6.28, scale: 0.6 + rr() * 0.9, y: height(x, z) - 0.25 });
    }
    for (const [k, list] of Object.entries(woods)) rockJobs.push(scatter(game, R + k + '.glb', list, { collide: true }));
    await Promise.all(rockJobs);
    // grass tufts: thick on the meadows and verges, sparse in the lanes, none on rock or in the water
    const tufts: Xform[] = [];
    const rg = rand(77);
    for (let i = 0; i < 60000 && tufts.length < 26000; i++) {
      const x = (rg() - 0.5) * 120, z = -165 + rg() * 290;
      const p = nearPath(x, z);
      if (p.d > p.w + 26) continue;
      const lane = z > -50 && z < 62 ? p.d < p.w * 0.45 : p.d < 2.6;
      if (lane && rg() > 0.06) continue;
      if (nearStream(x, z) < 2.4) continue;
      if (z > 60 && Math.abs(x) < 19 && z < 122 && (Math.abs(x) < 15.5 && z > 80 || rg() > 0.15)) continue;
      let inHouse = false;
      for (const [, hx, hz] of houses) if (Math.abs(x - hx) < 5 && Math.abs(z - hz) < 4.5) inHouse = true;
      if (inHouse) continue;
      const clump = fbm(x * 0.12, z * 0.12, 2, 31);
      if (clump < 0.42 && rg() > 0.25) continue;
      tufts.push({ x, z, rot: rg() * 6.28, scale: 0.7 + rg() * 0.7, y: height(x, z) - 0.03 });
    }
    grass(game, tufts, { tint: new THREE.Color(0.95, 0.82, 0.52) });
    // the forests on every hillside, as impostors (real trees near the path, sprites beyond)
    const far: Record<string, Xform[]> = { pine: [], cedar: [], maple: [] };
    const ri = rand(5);
    for (let i = 0; i < 90000 && far.pine.length + far.cedar.length + far.maple.length < 16000; i++) {
      const x = (ri() - 0.5) * 1000, z = -560 + ri() * 1040;
      const p = nearPath(x, z);
      const o = p.d - p.w;
      if (o < 16 || o > 480) continue;
      if (z > 56 && z < 125 && Math.abs(x) < 26) continue;
      if (z < -158 && Math.abs(x) < 26) continue;
      const patch = fbm(x * 0.02, z * 0.02, 3, 41);
      if (patch < 0.33) continue;
      const y = height(x, z);
      const k = ri();
      const kind = o > 120 ? (k < 0.75 ? 'cedar' : 'pine') : k < 0.45 ? 'cedar' : k < 0.75 ? 'pine' : 'maple';
      far[kind].push({ x, z, rot: 0, scale: 0.75 + ri() * 0.5, y });
    }
    for (const [k, list] of Object.entries(far)) impostors(game, k, list);
    // the shrine courtyard is paved
    paving(game, -15, 80.5, 15, 121, SHRINE_Y + 0.02, 'stone_path', 3.2, new THREE.Color(0.72, 0.68, 0.64));

    // ---------------------------------------------------------------- light
    this.brazierLight = game.light({ position: this.brazierPos.clone().setY(SHRINE_Y + 1.8), color: new THREE.Color(1, 0.5, 0.2), intensity: 0, distance: 18, flicker: 0.4, priority: 2 });
    // the playable corridor
    const left: THREE.Vector2[] = [], right: THREE.Vector2[] = [];
    for (let i = 0; i < PATH.length; i++) {
      const [x, z] = PATH[i];
      const w = WIDTH[i] + 2;
      left.push(new THREE.Vector2(x - w, z));
      right.push(new THREE.Vector2(x + w, z));
    }
    game.world.bounds = [
      new THREE.Vector2(-12, -166), ...left, new THREE.Vector2(-18, 60), new THREE.Vector2(-18, 120), new THREE.Vector2(18, 120),
      new THREE.Vector2(18, 60), ...right.reverse(), new THREE.Vector2(12, -166),
    ];
    game.music = { explore: 'c1_explore', combat: 'c1_combat', boss: 'c1_boss' };
    void game.audio.ambient('loop_wind', 0.35);
    void game.audio.ambient('loop_fire', 0.5);
  }

  /** a burning spot: flames, smoke, embers and a flickering light */
  private fire(pos: THREE.Vector3, k: number): void {
    const g = this.game;
    g.particles.emitter('blaze', pos, 34 * k, 1.1 * k);
    g.particles.emitter('fire', pos.clone().setY(pos.y + 0.2), 22 * k, 1.4 * k);
    g.particles.emitter('smoke', pos.clone().setY(pos.y + 1.8), 9 * k, 1.0 * k, V(0.2, 1, 0.05));
    g.particles.emitter('ember', pos.clone().setY(pos.y + 0.6), 6 * k, 0.8);
    const light = g.light({ position: pos.clone().setY(pos.y + 0.8), color: new THREE.Color(1, 0.48, 0.18), intensity: 22 * k, distance: 16, flicker: 0.45, priority: 1 });
    g.pipe.haze.sources.push({ pos: pos.clone().setY(pos.y + 0.6), radius: 1.6 * k + 0.6, strength: 1.0 * k });
    this.fires.push({ light, pos });
  }

  update(): void {
    // rice paper glows where fire burns nearby (one shared colour; flickers with the fires)
    const t = this.game.gameTime;
    const f = 0.55 + 0.25 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.0);
    paperGlow.setRGB(0.9 * f, 0.38 * f, 0.12 * f);
  }

  // ==================================================================== story
  async run(game: Game, checkpoint: string | null): Promise<void> {
    const P = game.player;
    const cp = checkpoint ?? 'start';
    const idx = this.checkpoints.indexOf(cp);
    if (idx <= this.checkpoints.indexOf('boss')) P.artsUnlocked = 0;
    const at = (x: number, z: number) => V(x, height(x, z), z);
    const spawnAt = async (def: typeof FOOTMAN, x: number, z: number, yaw = 0, aware = false) => game.spawn(def, at(x, z), yaw, { aware });

    // NPCs that exist from the start of the relevant section
    const oren = idx <= this.checkpoints.indexOf('square')
      ? await NPC.create(game, { name: 'Oren', url: 'assets/chars/oren.glb', pos: at(-3, 46), yaw: Math.PI, weapon: 'katana', mood: 'determined' })
      : await NPC.create(game, { name: 'Oren', url: 'assets/chars/oren.glb', pos: at(-3, 46), yaw: Math.PI, mood: 'pain' });

    // resuming at a checkpoint: fade in straight away (the opening fades in its own time)
    if (idx > 0) void game.hud.fade(0, 1.2);

    // ---------------------------------------------------------------- start
    if (idx <= 0) {
      P.teleport(at(0, -151), 0);
      game.cam.snapBehind(0);
      game.setCheckpoint('start', at(0, -151), 0);
      game.setCinematic(true);
      game.shot({ pos: V(5, 27.5, -146), look: V(0, 25.5, -156), fov: 42, focus: 8 });
      await game.hud.fade(0, 2.5);
      void game.hud.chapterCard('Chapter One', 'Cinders', 'Hinoka, at the end of autumn');
      await game.wait(3.5);
      game.shot({ pos: V(-2.5, 25.5, -146.5), look: P.body.pos.clone().setY(P.body.pos.y + 1.5), fov: 38, blend: 3, focus: 4.6 });
      await game.say('Kaede', 'Again. Until the blade stops thinking and only moves.', undefined, P.char, 'determined');
      await game.wait(0.5);
      // the smoke
      game.shot({ pos: V(1, 26.4, -144), look: V(-4, 14, -60), fov: 34, blend: 4, focus: 60 });
      await game.wait(2.5);
      await game.say('Kaede', 'Smoke... over Hinoka. That is too much smoke for cooking fires.', undefined, P.char, 'worried');
      await game.say('Kaede', 'Ren!', 1.4, P.char, 'fear');
      game.setCinematic(false);
      game.hud.objective('Get back to Hinoka');
      game.hud.toast('Move: WASD / left stick · Camera: mouse / right stick', 5);
      await game.waitUntil(() => P.body.pos.z > -138);
      game.hud.toast('Sprint: hold Shift / L3', 3.5);
    }

    // ---------------------------------------------------------------- terraces: first Hollow
    if (idx <= 1) {
      if (idx === 1) { P.teleport(at(10, -124), 0.2); game.cam.snapBehind(0.2); }
      const a = await spawnAt(FOOTMAN, 13, -100, Math.PI);
      const b = await spawnAt(FOOTMAN, 17, -103, Math.PI * 0.8);
      a.perform('e_idle', true);
      b.perform('e_idle', true);
      await game.waitUntil(() => P.body.pos.z > -116);
      game.setCheckpoint('terraces', at(12, -118), 0.2);
      game.setCinematic(true);
      game.shot({ pos: V(8, 19.5, -110), look: V(15, 16, -100), fov: 40, blend: 1.5, focus: 10 });
      await game.say('Kaede', 'Hollow. Here...?', 1.8, P.char, 'surprised');
      a.release(); b.release(); a.alert(); b.alert();
      game.setCinematic(false);
      game.hud.toast('Attack: Left mouse / J / ☐ · Heavy: hold Right mouse / K', 5);
      await game.wait(3);
      game.hud.toast('Dodge: Space / ◯ (through an attack) · Lock on: Q / R3', 5);
      await game.waitDefeated([a, b]);
      game.hud.toast('Block: hold F / L1 — block just before a hit lands to parry', 5);
      await game.wait(1.0);
      await game.say('Kaede', 'They are coming from the north road. Hold on, Ren.', undefined, P.char, 'determined');
    }

    // ---------------------------------------------------------------- village outskirts: Mika
    if (idx <= 2) {
      if (idx === 2) { P.teleport(at(-3, -64), 0); game.cam.snapBehind(0); }
      const mika = await NPC.create(game, { name: 'Mika', url: 'assets/chars/mika.glb', pos: at(-6, -42), yaw: 0.6, idle: 'cower' });
      mika.pose('cower', { loop: true, fade: 0 });
      const f1 = await spawnAt(FOOTMAN, -3, -45, -2.4);
      const s1 = await spawnAt(SPEARMAN, 3, -40, Math.PI);
      f1.perform('e_slash', true);
      await game.waitUntil(() => P.body.pos.z > -58);
      game.setCheckpoint('village', at(-3, -60), 0);
      f1.release(); f1.alert(); s1.alert();
      game.hud.objective('Protect Mika');
      mika.lookAt(f1.char.root);
      await game.waitDefeated([f1, s1]);
      // Mika
      game.setCinematic(true);
      mika.release();
      mika.lookAt(P.char.root);
      mika.face(P.body.pos);
      const mid = mika.pos.clone().lerp(P.body.pos, 0.5);
      game.shot({ pos: mid.clone().add(V(3.2, 1.7, 1.5)), look: mid.clone().setY(mid.y + 1.4), fov: 38, blend: 1.2, focus: 3.5 });
      P.teleport(mika.pos.clone().add(V(0.9, 0, 1.4)), Math.atan2(mika.pos.x - (mika.pos.x + 0.9), mika.pos.z - (mika.pos.z + 1.4)));
      await game.say('Mika', 'Kaede! Oh, child, you came down the mountain...', undefined, mika.char, 'relief');
      await game.say('Kaede', 'Grandmother Mika. Where is Ren?', undefined, P.char, 'worried');
      await game.say('Mika', 'They came out of the ash, out of nowhere. One of them, a giant, he was looking for someone.', undefined, mika.char, 'fear');
      await game.say('Mika', 'Oren took the boy toward the shrine. Go! I will hide in the cellars with the others.', undefined, mika.char, 'worried');
      game.setCinematic(false);
      game.hud.objective('Find Oren and Ren — the shrine is across the stream');
      void mika.walkTo(at(-24, -38), 2.6).then(() => mika.dispose());
      // the lanes
      await game.waitUntil(() => P.body.pos.z > -32);
      const w1 = [await spawnAt(FOOTMAN, -4, -16, Math.PI, true), await spawnAt(FOOTMAN, 5, -12, Math.PI, true), await spawnAt(SPEARMAN, 1, -6, Math.PI, true)];
      await game.waitDefeated(w1);
      await game.waitUntil(() => P.body.pos.z > -8);
      const w2 = [await spawnAt(SPEARMAN, -5, 6, Math.PI, true), await spawnAt(FOOTMAN, 6, 4, Math.PI, true), await spawnAt(BRUTE, 0, 10, Math.PI, true)];
      game.hud.toast('Heal: R / △ (three gourds per checkpoint)', 4);
      await game.waitDefeated(w2);
    }

    // ---------------------------------------------------------------- the bridge: wraiths
    if (idx <= 3) {
      if (idx === 3) { P.teleport(at(0, 6), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('bridge', at(0, 7), 0);
      await game.waitUntil(() => P.body.pos.z > 16);
      const wr = [await spawnAt(WRAITH, -6, 30, Math.PI, true), await spawnAt(WRAITH, 6, 31, Math.PI, true)];
      game.cam.addTrauma(0.15);
      await game.say('Kaede', 'Fast ones...', 1.4, P.char, 'fierce');
      await game.waitDefeated(wr);
    }

    // ---------------------------------------------------------------- the square: Gorran takes Ren
    const SQ = this.checkpoints.indexOf('square');
    const ren = await NPC.create(game, { name: 'Ren', url: 'assets/chars/ren.glb', pos: at(0, 54), yaw: Math.PI, idle: 'stand_relaxed' });
    let gorran: Enemy | null = null;
    if (idx <= SQ) {
      if (idx === SQ) { P.teleport(at(0, 24), 0); game.cam.snapBehind(0); }
      game.setCheckpoint('square', at(0, 24), 0);
      gorran = await spawnAt(GORRAN, 1, 53, Math.PI);
      gorran.perform('b_idle', true);
      gorran.invulnerable = true;
      ren.carriedBy(gorran.char, 'socket_back', new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0.3, 0.15, 0.1));
      ren.pose('carried', { loop: true, fade: 0 });
      oren.teleport(at(-1.5, 47.5), Math.PI * 0.95);
      oren.pose('stand_relaxed', { loop: true, fade: 0 });
      oren.lookAt(gorran.char.root);
      await game.waitUntil(() => P.body.pos.z > 34);
      game.setCinematic(true);
      P.teleport(at(0, 38), 0);
      game.shot({ pos: V(-6, 2.2, 44), look: V(0, 2.4, 52), fov: 36, blend: 1.4, focus: 8 });
      await game.say('Oren', 'Put the boy down, ash-thing. He is not yours to take.', undefined, oren.char, 'angry');
      gorran.perform('b_roar');
      game.audio.sfx('boss_roar', gorran.body.pos, 1);
      game.cam.addTrauma(0.35);
      await game.wait(1.6);
      gorran.perform('b_sweep');
      await game.wait(0.45);
      oren.pose('knockdown', { fade: 0.08 });
      game.audio.sfx('impact_heavy', oren.pos, 1);
      game.particles.burst('spark', oren.head, 18);
      game.time.slowmo(0.3, 0.8);
      await game.wait(1.0);
      oren.pose('sit_wounded', { loop: true, fade: 0.6 });
      oren.char.face.set('pain');
      game.shot({ pos: V(3, 1.6, 42), look: V(0.5, 2.2, 56), fov: 32, blend: 1.0, focus: 13 });
      await game.say('Kaede', 'Oren!', 1.2, P.char, 'shout');
      // Gorran climbs to the shrine with Ren
      gorran.perform('b_idle', true);
      void gorran.walkTo(at(0, 62), 1.6);
      await game.wait(1.6);
      game.shot({ pos: V(0, 2.0, 41), look: V(0, 4, 64), fov: 40, blend: 2.5, focus: 18 });
      await game.wait(2.4);
      gorran.char.root.visible = false;
      ren.char.root.visible = false;
      // Oren
      oren.lookAt(P.char.root);
      P.teleport(oren.pos.clone().add(V(0.4, 0, -1.2)), 0);
      game.shot({ pos: oren.pos.clone().add(V(2.4, 1.2, -1.6)), look: oren.pos.clone().add(V(0, 0.9, 0)), fov: 36, blend: 1.0, focus: 2.8 });
      await game.say('Oren', 'Do not fuss over me. It is only a scratch... a large scratch.', undefined, oren.char, 'pain');
      await game.say('Oren', "He is taking Ren to the Ember. They want the boy's blood for something. Go, Kaede!", undefined, oren.char, 'determined');
      await game.say('Kaede', 'I will bring him back. Stay here.', undefined, P.char, 'fierce');
      game.setCinematic(false);
      gorran.char.root.visible = true;
    } else {
      // resuming later: Oren is already down in the square
      oren.teleport(at(-1.5, 47.5), Math.PI * 0.95);
      oren.pose('sit_wounded', { loop: true, fade: 0 });
    }
    // Gorran waits by the brazier with Ren at his feet
    ren.carriedBy(null);
    ren.teleport(V(-3.5, SHRINE_Y, 99), Math.PI * 0.8);
    ren.pose('cower', { loop: true, fade: 0 });
    ren.char.root.visible = idx < this.checkpoints.indexOf('end');
    if (idx < this.checkpoints.indexOf('end')) {
      if (!gorran) gorran = await game.spawn(GORRAN, V(0, SHRINE_Y, 98), Math.PI);
      gorran.teleport(V(0, SHRINE_Y, 98), Math.PI);
      gorran.perform('b_idle', true);
      if (idx <= this.checkpoints.indexOf('stairs')) {
        if (idx === this.checkpoints.indexOf('stairs')) { P.teleport(at(0, 50), 0); game.cam.snapBehind(0); }
        game.hud.objective('Climb to the shrine');
        game.setCheckpoint('stairs', at(0, 50), 0);
        await this.stairs(game, at);
      } else {
        P.teleport(V(0, SHRINE_Y, 83), 0);
        game.cam.snapBehind(0);
      }
      await this.boss(game, gorran, ren, oren);
    }
    await this.ending(game, oren, ren);
  }

  private async stairs(game: Game, at: (x: number, z: number) => THREE.Vector3): Promise<void> {
    const P = game.player;
    await game.waitUntil(() => P.body.pos.z > 58);
    const a = [await game.spawn(FOOTMAN, V(-1.5, 2.25, STAIRS_Z0 + 5.4), Math.PI, { aware: true }), await game.spawn(FOOTMAN, V(1.5, 2.25, STAIRS_Z0 + 5.5), Math.PI, { aware: true })];
    await game.waitDefeated(a);
    await game.waitUntil(() => P.body.pos.z > STAIRS_Z0 + 6);
    const b = [await game.spawn(SPEARMAN, V(0, 4.05, STAIRS_Z0 + 11.2), Math.PI, { aware: true }), await game.spawn(WRAITH, V(2, SHRINE_Y, 82), Math.PI, { aware: true }),
      await game.spawn(FOOTMAN, V(-2, SHRINE_Y, 83), Math.PI, { aware: true })];
    await game.waitDefeated(b);
    void at;
  }

  private async boss(game: Game, gorran: Enemy, ren: NPC, oren: NPC): Promise<void> {
    const P = game.player;
    gorran.perform('b_idle', true);
    gorran.invulnerable = true;
    gorran.yaw = Math.PI;
    await game.waitUntil(() => P.body.pos.z > 82 && P.body.pos.y > SHRINE_Y - 0.5);
    game.setCheckpoint('boss', V(0, SHRINE_Y, 84), 0);
    game.setCinematic(true);
    P.teleport(V(0, SHRINE_Y, 85), 0);
    ren.lookAt(P.char.root);
    game.shot({ pos: V(-4, SHRINE_Y + 1.6, 88), look: V(-2, SHRINE_Y + 1.0, 99), fov: 36, blend: 1.2, focus: 11 });
    await game.say('Ren', 'Kaede! Behind the fire, it wants the fire!', undefined, ren.char, 'fear');
    game.shot({ pos: V(2.5, SHRINE_Y + 1.2, 90), look: gorran.center().add(V(0, 0.8, 0)), fov: 30, blend: 1.4, focus: 8 });
    gorran.perform('b_roar');
    game.audio.sfx('boss_roar', gorran.body.pos, 1);
    game.cam.addTrauma(0.4);
    await game.wait(1.8);
    game.setCinematic(false);
    gorran.invulnerable = false;
    gorran.release();
    gorran.alert();
    game.hud.setBoss(gorran);
    game.hud.objective('Defeat Gorran the Ashen');
    // phase two at half health: two wraiths snatch Ren while Gorran rages
    await game.waitUntil(() => gorran.dead || gorran.hp < gorran.maxHp * 0.5);
    let snatch: Promise<void> = Promise.resolve();
    if (!gorran.dead) {
      gorran.roar();
      game.time.slowmo(0.4, 1.2);
      game.particles.burst('ember', gorran.center(), 60, undefined, 1.6);
      game.hud.toast('Gorran is enraged', 2.5);
      const w = [await game.spawn(WRAITH, V(-8, SHRINE_Y, 104), 0, { aware: false }), await game.spawn(WRAITH, V(-6, SHRINE_Y, 106), 0, { aware: false })];
      for (const e of w) e.invulnerable = true;
      snatch = w[0].walkTo(V(-4, SHRINE_Y, 100), 5).then(async () => {
        ren.carriedBy(w[0].char, 'socket_back', new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0.3, 0.1, 0.1));
        ren.pose('carried', { loop: true });
        await game.say('Ren', 'Kaede!', 1.2, ren.char, 'fear');
        await w[0].walkTo(V(-14, SHRINE_Y, 118), 5);
        for (const e of w) e.vanish();
        ren.char.root.visible = false;
      });
      void w[1].walkTo(V(-14, SHRINE_Y, 118), 5);
    }
    await game.waitDefeated([gorran]);
    game.hud.setBoss(null);
    await snatch;
    void oren;
  }

  private async ending(game: Game, oren: NPC, ren: NPC): Promise<void> {
    const P = game.player;
    game.setCheckpoint('end', V(0, SHRINE_Y, 88), 0);
    game.hud.objective(null);
    game.musicOverride = 'sorrow';
    await game.wait(2.0);
    ren.char.root.visible = false;
    for (const e of game.enemies) e.vanish();
    // Oren has dragged himself up the steps to the brazier
    oren.release();
    oren.teleport(V(3.4, SHRINE_Y, 94.6), Math.PI * 1.15);
    oren.pose('sit_wounded', { loop: true, fade: 0 });
    oren.char.face.set('pain');
    game.setCinematic(true);
    P.teleport(V(3.0, SHRINE_Y, 93.5), 0.35);
    P.setDrawn(false);
    P.char.animator.play('kneel_hold', { loop: true, fade: 0.5 });
    oren.lookAt(P.char.root);
    game.shot({ pos: V(6.0, SHRINE_Y + 1.15, 92.6), look: V(3.2, SHRINE_Y + 0.75, 94.2), fov: 34, blend: 1.5, focus: 3.2 });
    await game.wait(1.5);
    await game.say('Kaede', 'They took him. Two of them, into the ash. I could not reach him.', undefined, P.char, 'grief');
    await game.say('Oren', 'Then you will reach him tomorrow. Listen to me, girl. I do not have many words left.', undefined, oren.char, 'pain');
    await game.say('Oren', 'The Hollow serve a king who was a man once. He wants the Embers dark... and a child who can light a flame with his hands.', undefined, oren.char, 'sad');
    await game.say('Kaede', 'Ren. Ren lit the forge with his palm when he was six. You told him never to show anyone.', undefined, P.char, 'surprised');
    await game.say('Oren', 'Take Kagaribi. I forged her for this night and prayed it would never come.', undefined, oren.char, 'warm');
    game.shot({ pos: V(4.6, SHRINE_Y + 0.75, 92.4), look: V(3.3, SHRINE_Y + 0.85, 94.4), fov: 28, blend: 2, focus: 2.4 });
    await game.say('Oren', 'Relight the Ember. Then follow the ash road north, to the Drowned Shrine. Bring him home...', undefined, oren.char, 'warm');
    oren.char.face.set('calm');
    oren.lookAt(null);
    oren.char.face.blinkNow();
    await game.wait(2.0);
    await game.say('Kaede', 'Master...', 2.2, P.char, 'grief');
    await game.wait(1.0);
    P.char.animator.stop(0.6);
    game.setCinematic(false);
    game.hud.objective('Relight the Ember');
    await new Promise<void>((res) => game.interact(this.brazierPos.clone().setY(SHRINE_Y + 0.5), 'Relight the Ember', () => res(), 2.6));
    game.setCinematic(true);
    P.char.animator.play('interact', { fade: 0.2 });
    game.shot({ pos: V(-3.5, SHRINE_Y + 2.2, 88), look: V(0, SHRINE_Y + 1.4, 92), fov: 38, blend: 1, focus: 5 });
    await game.wait(0.5);
    // the Ember catches
    if (this.brazierLight) this.brazierLight.intensity = 60;
    game.particles.emitter('fire', this.brazierPos.clone().setY(SHRINE_Y + 1.3), 45, 0.55);
    game.pipe.haze.sources.push({ pos: this.brazierPos.clone().setY(SHRINE_Y + 1.4), radius: 1.2, strength: 0.8 });
    game.particles.emitter('ember', this.brazierPos.clone().setY(SHRINE_Y + 1.6), 14, 0.6);
    game.particles.burst('flash', this.brazierPos.clone().setY(SHRINE_Y + 1.5), 1, undefined, 3);
    game.particles.burst('ember', this.brazierPos.clone().setY(SHRINE_Y + 1.5), 90, V(0, 1, 0), 1.4);
    game.audio.sfx('ignite', this.brazierPos, 1);
    game.cam.addTrauma(0.2);
    await game.wait(1.5);
    game.musicOverride = 'title';
    P.artsUnlocked = Math.max(P.artsUnlocked, 1);
    game.hud.toast('Ember Art learned: Ember Whirl — press 1 / D-pad up when the ember gauge is full', 6);
    await game.say('Kaede', 'One Ember lit. Four to go. Hold on, Ren. I am coming.', undefined, P.char, 'determined');
    await game.hud.fade(1, 2.5);
    game.setCinematic(false);
    game.onChapterComplete?.(this.id);
  }
}
