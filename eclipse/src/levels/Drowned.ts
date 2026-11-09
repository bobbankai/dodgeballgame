import { Color3, MeshBuilder, Vector3, type Light, type Mesh } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { buildTerrain, type BuiltTerrain } from '../world/TerrainBuilder';
import { Encounters } from '../world/Encounters';
import { Navigation } from '../ai/Navigation';
import { Water } from '../render/Water';
import { THALORYN } from '../ai/bosses/Thaloryn';
import type { Boss } from '../ai/Boss';
import type { FxHandle } from '../vfx/Vfx';
import type { LoopHandle } from '../audio/Audio';
import {
  opening, forumArrival, aqueductArrival, bridgeArrival, templeLore, arenaApproach, bossIntro, bossDeath, PHASE_LINES,
} from '../story/chapter2';

/** Street level: the flooded city lies about knee-deep under the water. */
const STREET = -0.45;
const WATER = 0;
const FORUM = new Vector3(0, 0, 58);
const AQUEDUCT_Z = 100;
const CANAL_Z = 120;
const TEMPLE = new Vector3(0, 0, 165);
const ARENA = new Vector3(0, 0, 228);
/** Inner radius of the amphitheatre's seating (the fighting floor) and its outer edge. */
const ARENA_R = 24;
const ARENA_OUT = 31;
/** Bridge deck height over the canal (the stairs either side rise 3 m from the street). */
const DECK = STREET + 3;

function hash(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, z: number): number {
  return noise(x, z) * 0.5 + noise(x * 2.1, z * 2.1) * 0.25 + noise(x * 4.3, z * 4.3) * 0.125;
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Chapter Two: the Drowned Empire. Rain over Vael Maris, the imperial city its god flooded to keep
 * it from the Eclipse. Kael lands on the old harbour quay, passes the triumphal arch into the
 * knee-deep Forum, walks under the aqueducts (still pouring), crosses the canal bridge, passes the
 * Temple of Tides and reaches the flooded amphitheatre where Thaloryn waits beneath the water.
 */
export class Drowned extends Level {
  readonly id = 'drowned';
  readonly title = 'The Drowned Empire';
  private kit!: EnvKit;
  private terrain!: BuiltTerrain;
  private water!: Water;
  private encounters!: Encounters;
  private rain: FxHandle | null = null;
  private fx: FxHandle[] = [];
  private lamps: Light[] = [];
  private loops: LoopHandle[] = [];
  private walls: Mesh[] = [];
  boss: Boss | null = null;
  private bossStarted = false;
  private beats = new Set<string>();
  /** Last place Kael stood on firm, shallow ground (the canal's current carries him back here). */
  private safe = new Vector3(0, 0, 0);
  private safeTimer = 0;
  private sweeping = false;

  async load(checkpoint?: string): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    // ------------------------------------------------------------------ terrain
    this.terrain = await buildTerrain(scene, 'drownedGround', {
      origin: [-110, -60], size: [220, 350], density: 1.25, splatDensity: 3,
      height: (x, z) => this.height(x, z),
      splat: (x, z, h, slope) => {
        const paved = this.paved(x, z);
        const dry = smooth(-0.15, 0.15, h) * (z < 30 ? 1 : 0) * (1 - paved);
        const rock = Math.max(smooth(0.3, 0.5, slope), smooth(2.5, 5, h) * smooth(0.12, 0.3, slope + fbm(x * 0.2, z * 0.2) * 0.2));
        return [Math.max(0, 1 - paved - dry) + 0.05, paved, dry, rock];
      },
    }, ['sea_damp_sand', 'sea_mossy_cobble', 'sea_sand', 'sea_low_tide_rocks'], [4, 2.6, 4, 5], { heightBlend: 0.6, macro: 0.55 });
    this.own(this.terrain.mesh);
    this.own(this.terrain.material);
    g.lighting.addStatic(this.terrain.mesh, false);

    // ------------------------------------------------------------------ scenery
    this.kit = new EnvKit(scene, g.assets, g.mats, g.lighting, 'env/drowned', this.scope);
    await this.kit.placeAll(this.layout());
    const col = this.kit.finish();
    this.own(this.kit);
    g.physics.addStaticMesh(this.terrain.mesh);
    if (col) g.physics.addStaticMesh(col);
    // the open sea beyond the bay and the hills: invisible walls keep Kael in the city
    for (const [x, z, w, d] of [[0, -46, 160, 2], [-62, 110, 2, 340], [62, 110, 2, 340], [0, 282, 160, 2]] as const) {
      const wall = MeshBuilder.CreateBox('bound', { width: w, depth: d, height: 30 }, scene);
      wall.position.set(x, 10, z);
      wall.isVisible = false;
      wall.isPickable = false;
      g.physics.addStaticMesh(wall);
      this.walls.push(this.own(wall));
    }
    // quay walls along the canal (either side of the bridge stairs): nobody wades into the deep
    const banks: Mesh[] = [];
    for (const z of [CANAL_Z - 8.6, CANAL_Z + 8.6]) {
      for (const sx of [-1, 1]) {
        const wall = MeshBuilder.CreateBox('canalBank', { width: 55, depth: 0.6, height: 1.6 }, scene);
        wall.position.set(sx * (5.4 + 27.5), STREET + 0.8, z);
        wall.isVisible = false;
        wall.isPickable = false;
        g.physics.addStaticMesh(wall);
        banks.push(this.own(wall));
      }
    }
    g.nav = await Navigation.build([this.terrain.mesh, ...(col ? [col] : []), ...banks]);
    // the bay's floor beyond the terrain, so the far water has depth under it (fog and absorption)
    const bed = this.own(MeshBuilder.CreateGround('seabed', { width: 1600, height: 1600 }, scene));
    bed.position.set(0, -4.8, 100);
    bed.material = this.own(g.mats.surface({ set: 'sea_damp_sand', tile: 1 / 8 }).clone('seabedMat'));
    bed.isPickable = false;

    // ------------------------------------------------------------------ the water over everything
    // one plane to the horizon: its swell is kept small (the ripples are in the normals) so the
    // coarse far tessellation never shows
    this.water = this.own(new Water(scene, g.pipe, new Vector3(0, WATER, 100), [1600, 1600], {
      shallow: new Color3(0.2, 0.3, 0.27), deep: new Color3(0.035, 0.08, 0.085), absorption: 0.55, foam: 0.8,
      wave: [0.02, 12, 0.8], flow: [0.03, 0.05], rain: 1, envIntensity: 1.25, brightness: 1.9, glint: 0.12, normalFade: 60,
    }));
    g.rig.waterLevel = WATER;

    // ------------------------------------------------------------------ rain, mist, lamps, falls
    this.rain = g.vfx.attach('rain', new Vector3(0, 10, 0));
    const lamp = (x: number, z: number, yaw: number, y?: number) => {
      // the cage hangs 0.8 m out on the arm at 2.95 m (Blender x -> world, turned by yaw)
      const base = y ?? this.height(x, z);
      const at = new Vector3(x + Math.cos(yaw) * 0.8, base + 2.95, z - Math.sin(yaw) * 0.8);
      const l = g.lights.add(at, { color: [0.35, 0.95, 0.85], intensity: 22, range: 10, flicker: 0.35, speed: 0.7 });
      if (l) this.lamps.push(l);
      this.fx.push(g.vfx.attach('waterTrail', at, 0.6));
    };
    for (const [x, z, yaw, y] of this.lampSpots()) lamp(x, z, yaw, y);
    // water pouring from the broken ends of the aqueduct's channel
    for (const sx of [-1, 1]) {
      const top = new Vector3(sx * 18.4, 14.9, AQUEDUCT_Z);
      this.fx.push(g.vfx.attach('pour', top));
      this.fx.push(g.vfx.attach('falls', new Vector3(top.x, WATER, top.z)));
      this.loops.push(g.audio.loop('falls_loop', new Vector3(top.x, 1, top.z), 1));
    }
    // water lapping at stone along the streets
    for (const [x, z] of [[-6, 34], [7, 50], [-8, 78], [6, 92], [-4, 140], [9, 186], [0, 214]]) {
      this.loops.push(g.audio.loop('lap_loop', new Vector3(x, WATER, z), 0.7));
    }

    // ------------------------------------------------------------------ fights
    this.encounters = new Encounters(g.enemies);
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z), z);
    this.encounters.add({ id: 'quay', at: at(0, 36), spawns: [
      { id: 'reaver', at: at(3, 38), yaw: Math.PI }, { id: 'reaver', at: at(-4, 42), yaw: Math.PI * 0.9 },
    ] });
    this.encounters.add({ id: 'forum', at: FORUM, spawnRange: 40, onClear: () => g.flow.checkpoint(this.id, 'forum', 'forum'), spawns: [
      { id: 'reaver', at: at(-6, 60), yaw: Math.PI }, { id: 'reaver', at: at(6, 63), yaw: Math.PI },
      { id: 'tidecaller', at: at(0, 74), yaw: Math.PI },
      { id: 'reaver', at: at(-6, 70), patrol: [at(-6, 70), at(6, 70), at(6, 78), at(-6, 78)] },
    ] });
    this.encounters.add({ id: 'aqueduct', at: at(0, 98), spawns: [
      { id: 'tidecaller', at: at(-7, 106), yaw: Math.PI }, { id: 'tidecaller', at: at(8, 105), yaw: Math.PI },
      { id: 'reaver', at: at(0, 96), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'bridge', at: new Vector3(0, DECK, CANAL_Z), spawnRange: 26, spawns: [
      { id: 'reaver', at: new Vector3(0, DECK, CANAL_Z + 4), yaw: Math.PI }, { id: 'reaver', at: new Vector3(0, DECK, CANAL_Z - 3), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'temple', at: at(0, 148), onClear: () => g.flow.checkpoint(this.id, 'temple', 'temple'), spawns: [
      { id: 'reaver', at: at(-5, 148), yaw: Math.PI }, { id: 'reaver', at: at(5, 149), yaw: Math.PI },
      { id: 'tidecaller', at: new Vector3(-4.6, STREET + 1.35, 156.2), yaw: Math.PI }, { id: 'tidecaller', at: new Vector3(4.6, STREET + 1.35, 156.2), yaw: Math.PI },
    ] });
    const order = ['quay', 'forum', 'aqueduct', 'bridge', 'temple'];
    const upTo: Record<string, number> = { forum: 2, temple: 5, arena: 5 };
    for (const id of order.slice(0, upTo[checkpoint ?? ''] ?? 0)) this.encounters.skip(id);
    if (checkpoint === 'temple' || checkpoint === 'arena') ['forum', 'aqueduct', 'bridge', 'temple'].forEach((b) => this.beats.add(b));
    if (checkpoint === 'forum') this.beats.add('forum');
  }

  /** Where the city is paved: the streets, the Forum, the temple court and the arena floor. */
  private paved(x: number, z: number): number {
    const street = 1 - smooth(5.5, 7.5, Math.abs(x) + (fbm(x * 0.3, z * 0.3) - 0.5) * 2);
    const forum = (1 - smooth(14, 17, Math.abs(x))) * smooth(30, 34, z) * (1 - smooth(88, 92, z));
    const court = (1 - smooth(16, 19, Math.abs(x))) * smooth(138, 142, z) * (1 - smooth(190, 194, z));
    const arena = 1 - smooth(ARENA_R - 0.5, ARENA_R + 0.5, Math.hypot(x - ARENA.x, z - ARENA.z));
    const canal = 1 - smooth(6.5, 8, Math.abs(z - CANAL_Z));
    return Math.max(street * smooth(24, 28, z), forum, court, arena) * (1 - canal) * (z < 260 ? 1 : 0);
  }

  /** Ground height: a dry quay on the bay, the flooded city behind it, hills closing round both. */
  height(x: number, z: number): number {
    const n = fbm(x * 0.08, z * 0.08);
    // the city floor, under the water: uneven paving and silt
    let h = STREET + (n - 0.5) * 0.16;
    // the harbour quay is dry and drops into the bay behind it
    const quay = (1 - smooth(25, 28.5, z)) * 0.8;
    h += quay;
    h -= smooth(-12, -38, z) * (4 + 2 * n);
    // the forum's raised centre round the Emperor's statue
    h = Math.max(h, (1 - smooth(5, 6.5, Math.hypot(x - FORUM.x, z - FORUM.z))) * 0.65 + STREET);
    // the canal under the bridge
    const canal = 1 - smooth(6.5, 8.5, Math.abs(z - CANAL_Z) + (fbm(x * 0.2, z) - 0.5));
    h = h * (1 - canal) + -3.2 * canal;
    // the amphitheatre: a flat floor, an embankment behind the seating (open at the way in)
    const r = Math.hypot(x - ARENA.x, z - ARENA.z);
    if (r < ARENA_OUT + 20) {
      const floor = STREET + (n - 0.5) * 0.05;
      const inner = 1 - smooth(ARENA_R - 2, ARENA_R, r);
      h = h * (1 - inner) + floor * inner;
      const corridor = (1 - smooth(5.5, 7.5, Math.abs(x - ARENA.x))) * (1 - smooth(ARENA.z - 20, ARENA.z - 16, z));
      h += smooth(ARENA_OUT - 1, ARENA_OUT + 1.5, r) * 3.8 * (1 - corridor);
    }
    // hills closing in either side, opening out to the sea at the bay
    const half = z < 30 ? 44 : 34;
    const side = smooth(half, half + 24, Math.abs(x) + (fbm(x * 0.03 + 4, z * 0.03) - 0.5) * 14);
    const hills = side * (8 + 9 * fbm(x * 0.025, z * 0.025 + 3)) * smooth(-32, -6, z);
    const north = smooth(ARENA.z + ARENA_OUT + 6, ARENA.z + ARENA_OUT + 30, z) * (10 + 6 * fbm(x * 0.04, 9));
    return h + Math.max(hills, north) + side * (n - 0.5) * 2;
  }

  private lampSpots(): [number, number, number, number?][] {
    const L: [number, number, number, number?][] = [];
    // the quay steps, the statue, along the colonnades, the bridge stairs, the temple front
    L.push([-3.5, 19, 0], [3.5, 19, Math.PI]);
    for (const [x, z] of [[-4.5, 53], [4.5, 53], [-4.5, 63], [4.5, 63]] as const) L.push([x, z, x < 0 ? 0 : Math.PI]);
    L.push([-5.5, 105, 0], [5.5, 105, Math.PI]);
    L.push([-6, 151, 0], [6, 151, Math.PI]);
    L.push([0, 170, Math.PI / 2, STREET + 1.35]);
    L.push([-6, 197, 0], [6, 197, Math.PI]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (Math.cos(a) < -0.85) continue;
      L.push([ARENA.x + Math.sin(a) * (ARENA_R - 1.5), ARENA.z + Math.cos(a) * (ARENA_R - 1.5), a + Math.PI / 2]);
    }
    return L;
  }

  private layout(): Placement[] {
    const P: Placement[] = [];
    const put = (piece: string, x: number, z: number, yaw = 0, scale = 1, dy = 0) => {
      P.push({ piece, position: new Vector3(x, this.height(x, z) + dy, z), yaw, scale });
    };
    const putY = (piece: string, x: number, y: number, z: number, yaw = 0, scale = 1) => {
      P.push({ piece, position: new Vector3(x, y, z), yaw, scale });
    };
    // ------------------------------------------------ the harbour quay
    put('boat', -9, -7, 0.7, 1, -0.9);
    put('rocks_a', 13, 3, 0.3);
    put('rocks_a', -18, 12, 2.1, 1.2);
    put('rocks_b', 9, -9, 1.1);
    put('rocks_b', -6, 13, 0.4);
    put('rocks_b', 20, 15, 2.5, 1.3);
    put('coral_a', -3, -15, 0.2);
    put('coral_b', 6, -17, 1.7);
    put('coral_a', 16, -6, 2.9, 1.3);
    put('stele', 3.5, 9, Math.PI + 0.15);
    put('column_broken', -7, 18, 0.5);
    for (const [x, z, yaw] of this.lampSpots()) if (z < 20) put('lamp', x, z, yaw);
    // the triumphal arch and the blocks either side of it
    put('arch', 0, 24);
    put('insula', -10.2, 26, Math.PI / 2);
    put('insula', 10.2, 26, -Math.PI / 2);
    // ------------------------------------------------ the Forum
    for (const z of [45, 67]) {
      put('colonnade', -10.5, z, Math.PI / 2);
      put('colonnade', 10.5, z, Math.PI / 2);
    }
    put('statue_emperor', FORUM.x, FORUM.z, Math.PI);
    for (const [x, z] of [[-4.5, 53], [4.5, 53], [-4.5, 63], [4.5, 63]] as const) put('lamp', x, z, x < 0 ? 0 : Math.PI);
    for (const [x, z] of [[-22, 40], [-22, 58], [-22, 76], [22, 42], [22, 60], [22, 78]] as const) put('insula', x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
    put('column_broken', -5, 38, 1.0);
    put('column_broken', 6.5, 72, 2.2);
    put('column_broken', -6, 84, 0.4);
    put('column', 5.5, 86, 0.2);
    put('rocks_b', -13, 56, 0.9, 0.8);
    put('coral_b', 13, 55, 0.3);
    put('coral_a', -14, 80, 1.9, 0.9);
    put('stele', 13.5, 84, -Math.PI / 2);
    // ------------------------------------------------ the aqueduct, pouring at both broken ends
    put('aqueduct', -9, AQUEDUCT_Z);
    put('aqueduct', 9, AQUEDUCT_Z);
    put('lamp', -5.5, 105, 0);
    put('lamp', 5.5, 105, Math.PI);
    put('insula', -24, 94, Math.PI / 2);
    put('insula', 24, 106, -Math.PI / 2);
    put('rocks_a', -18.4, AQUEDUCT_Z + 3, 0.6, 0.7);
    put('rocks_a', 18.4, AQUEDUCT_Z - 3, 2.6, 0.7);
    // ------------------------------------------------ the canal bridge and its stairs
    putY('steps_wide', 0, STREET, CANAL_Z - 13.04, Math.PI);
    putY('bridge', 0, DECK - 6, CANAL_Z, Math.PI / 2);
    putY('steps_wide', 0, STREET, CANAL_Z + 13.04, 0);
    put('boat', -16, CANAL_Z + 1, 2.3, 0.9, -1.4);
    put('rocks_b', 14, CANAL_Z + 6.5, 0.8);
    put('rocks_b', -12, CANAL_Z - 7, 2.2, 0.9);
    // ------------------------------------------------ the Temple of Tides
    put('temple', TEMPLE.x, TEMPLE.z, Math.PI);
    putY('stele', 0, STREET + 1.35, TEMPLE.z + 5.5, Math.PI);
    put('lamp', -6, 151, 0);
    put('lamp', 6, 151, Math.PI);
    putY('lamp', 0, STREET + 1.35, 170, Math.PI / 2);
    for (const [x, z] of [[-26, 150], [26, 154], [-26, 176], [26, 180]] as const) put('insula', x, z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
    put('colonnade', -15, 166, Math.PI / 2, 0.9);
    put('colonnade', 15, 166, Math.PI / 2, 0.9);
    // the causeway to the amphitheatre, lined with broken columns
    for (const [x, z, yaw] of [[-7, 186, 0.3], [7, 188, 2.6], [-7.5, 196, 1.4], [7.5, 195, 0.2]] as const) put('column_broken', x, z, yaw);
    put('lamp', -6, 197, 0);
    put('lamp', 6, 197, Math.PI);
    // ------------------------------------------------ the flooded amphitheatre
    for (let k = 0; k < 12; k++) {
      if (k === 3) continue; // the way in, from the south
      putY('tier', ARENA.x, STREET, ARENA.z, (k * Math.PI) / 6);
    }
    for (const [x, z, yaw] of this.lampSpots()) if (Math.hypot(x - ARENA.x, z - ARENA.z) < ARENA_R) put('lamp', x, z, yaw);
    put('column_broken', ARENA.x - 15, ARENA.z + 10, 1.2);
    put('column_broken', ARENA.x + 16, ARENA.z - 6, 2.7);
    put('statue_emperor', ARENA.x, ARENA.z + ARENA_OUT + 3, Math.PI, 1.6);
    // ------------------------------------------------ silhouettes on the hills
    put('aqueduct', -52, 70, Math.PI / 2, 1.2);
    put('aqueduct', -52, 92, Math.PI / 2, 1.2);
    put('aqueduct', 54, 140, Math.PI / 2 + 0.1, 1.3);
    put('temple', 46, 238, -Math.PI / 2 - 0.4, 1.5);
    put('arch', -40, 205, 0.6, 1.4);
    put('colonnade', -44, 165, 1.2, 1.1);
    put('rocks_a', -38, 30, 1.4, 2.2);
    put('rocks_a', 40, 24, 0.2, 2.6);
    put('rocks_a', 44, 205, 2.2, 2.4);
    put('rocks_a', -44, 120, 0.9, 2.2);
    return P;
  }

  spawn(checkpoint?: string): { position: Vector3; yaw: number } {
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z) + 0.05, z);
    switch (checkpoint) {
      case 'forum': return { position: at(0, 86), yaw: 0 };
      case 'temple': return { position: at(-12, 178), yaw: 0.3 };
      case 'arena': return { position: at(0, 196), yaw: 0 };
      case 'title': return { position: at(0, -6), yaw: 0 };
      default: return { position: at(0, 4), yaw: 0 };
    }
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        // storm light: the eclipsed sun is a pale smear behind the clouds; the sky does the lighting
        sunColor: new Color3(0.72, 0.82, 0.9), sunIntensity: 2.0, sunElevation: 0.55, sunAzimuth: 3.6,
        skyFill: new Color3(0.38, 0.46, 0.5), groundFill: new Color3(0.08, 0.1, 0.1), fillIntensity: 0.16,
        environmentIntensity: 0.85, exposure: 1.05, contrast: 1.1, shadowDarkness: 0.15,
      },
      sky: {
        zenith: new Color3(0.1, 0.13, 0.15), horizon: new Color3(0.4, 0.46, 0.48), ground: new Color3(0.06, 0.08, 0.09),
        gradient: 0.6, sunColor: new Color3(0.75, 0.85, 0.9), sunIntensity: 6, eclipse: 0.82, coronaColor: new Color3(0.6, 0.85, 0.95),
        cloudCover: 0.86, cloudDensity: 1.5, cloudColor: new Color3(0.46, 0.52, 0.55), cloudShadow: new Color3(0.12, 0.14, 0.16),
        horizonGlow: new Color3(0.12, 0.18, 0.2),
      },
      look: {
        fog: { color: new Color3(0.25, 0.3, 0.32), density: 0.0024, heightFalloff: 0.05, sunScatter: 0.3, skyAmount: 0.45, volumeDensity: 0.006,
          volumeColor: new Color3(0.42, 0.48, 0.5), volumeHeight: 3, maxDistance: 90, shaftDensity: 0.001 },
        exposure: { compensation: -0.65, minLog: -2.4 },
        grade: {
          temperature: -0.28, tint: -0.03, slope: [0.96, 1.0, 1.03], offset: [-0.003, 0.002, 0.004], power: [1.02, 1, 0.98],
          contrast: 1.1, saturation: 0.8, shadowSaturation: 0.7, highlightSaturation: 0.95,
          shadowTint: [-0.01, 0.01, 0.02], highlightTint: [0.0, 0.01, 0.015], splitBalance: 0.5, gain: 1,
        },
      },
      weather: { wetness: 0.72, cover: 0, wind: 0.55, windDir: [0.35, 0.94], waterLevel: WATER },
      music: 'drowned',
      ambience: 'rain_loop',
    };
  }

  override start(checkpoint?: string): void {
    const g = this.game;
    this.safe.copyFrom(g.player?.position ?? Vector3.Zero());
    if (checkpoint === 'title') return;
    if (!checkpoint && !g.params.has('nointro')) void g.cine.play((d) => opening(d, g));
    g.flow.checkpoint(this.id, checkpoint ?? '');
  }

  override surface(at: Vector3): 'stone' | 'ash' | 'wood' | 'water' {
    if (WATER - at.y > 0.08) return 'water';
    return 'stone';
  }

  override waterHeight(at: Vector3): number | null {
    return this.water ? this.water.heightAt(at.x, at.z) : WATER;
  }

  override update(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.water.update(dt, g.lighting.toSun, g.lighting.sun.diffuse.scale(g.lighting.sun.intensity));
    const cam = g.activeCamera.globalPosition;
    this.rain?.move(new Vector3(cam.x, cam.y + 9, cam.z));
    // wading: knee-deep slows him a little, waist-deep a lot
    const depth = WATER - p.position.y;
    p.wade = Math.min(1, Math.max(0, (depth - 0.15) / 0.85));
    this.currents(dt);
    this.encounters.update(p.position);
    if (!g.cine.running) {
      const beat = (id: string, cond: boolean, fn: () => Promise<void>) => {
        if (cond && !this.beats.has(id)) {
          this.beats.add(id);
          void fn();
        }
      };
      const z = p.position.z;
      beat('forum', z > 38, () => forumArrival(g.cine));
      beat('aqueduct', z > 92, () => aqueductArrival(g.cine));
      beat('bridge', z > CANAL_Z - 16, () => bridgeArrival(g.cine));
      beat('templeIn', Math.abs(p.position.x) < 4 && z > TEMPLE.z - 1 && z < TEMPLE.z + 9 && p.position.y > STREET + 1, () => templeLore(g.cine));
      beat('arena', z > ARENA.z - ARENA_R - 12, () => arenaApproach(g.cine));
    }
    if (!this.bossStarted && Vector3.Distance(new Vector3(p.position.x, 0, p.position.z), ARENA) < ARENA_R - 6) void this.startBoss();
  }

  /**
   * The canal's current: falling into deep water sweeps Kael away; he is washed back to the last
   * firm ground he stood on (a fade, a little damage), as the drowned city will not let him swim.
   */
  private currents(dt: number): void {
    const g = this.game;
    const p = g.player!;
    this.safeTimer -= dt;
    if (p.grounded && WATER - p.position.y < 0.9 && this.safeTimer <= 0 && !this.sweeping) {
      this.safe.copyFrom(p.position);
      this.safeTimer = 0.5;
    }
    if (this.sweeping || !p.alive || p.position.y > WATER - 1.3) return;
    this.sweeping = true;
    g.vfx.burst('splash', new Vector3(p.position.x, WATER, p.position.z), Vector3.Up(), 2);
    g.audio.play('splash', { at: p.position });
    g.hud.fade(true);
    g.hazards.after(0.8, () => {
      p.place(this.safe.clone());
      p.stats.damage(p.stats.maxHealth * 0.08);
      g.rig.snapBehind(p.char.yaw);
      g.hud.fade(false);
      this.sweeping = false;
    });
  }

  private async startBoss(): Promise<void> {
    this.bossStarted = true;
    const g = this.game;
    const at = new Vector3(ARENA.x, this.height(ARENA.x, ARENA.z + 4), ARENA.z + 4);
    const b = await g.enemies.spawnBoss(THALORYN, at, Math.PI);
    this.boss = b;
    b.dormant = true;
    void g.audio.music('thaloryn');
    if (!g.params.has('nointro')) await g.cine.play((d) => bossIntro(d, g, b));
    b.char.model.root.position.y = 0;
    b.hidden = false;
    b.dormant = false;
    g.audio.play('banner_boom');
    g.hud.showBanner('Thaloryn', 'The Drowned King');
    g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
    const p = g.player;
    if (p) b.alert(b.position, p);
    b.onPhase = (i) => void g.cine.barks(PHASE_LINES[i] ?? []);
    b.spawnAdds = (from, n) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = from.x + Math.sin(a) * 6;
        const z = from.z + Math.cos(a) * 6;
        const spot = new Vector3(x, this.height(x, z), z);
        g.vfx.burst('geyser', spot, Vector3.Up(), 0.8);
        void g.enemies.spawn(i % 3 === 2 ? 'tidecaller' : 'reaver', spot, { aggro: true });
      }
    };
    b.events.on('died', () => {
      g.hud.showBoss(null);
      void g.audio.music('drowned');
      g.hazards.after(2.4, () => void g.cine.play((d) => bossDeath(d, g, b)).then(() => {
        g.flow.claimSpark('thaloryn');
        g.flow.checkpoint(this.id, 'arena', 'thaloryn');
        g.flow.chapterComplete(this.id);
      }));
    });
    g.hazards.after(3.5, () => g.hud.showBanner(null));
  }

  override dispose(): void {
    this.rain?.stop();
    for (const f of this.fx) f.stop();
    for (const l of this.lamps) this.game.lights.remove(l);
    for (const l of this.loops) l.stop(1);
    this.game.rig.waterLevel = null;
    super.dispose();
  }
}
