import { Color3, Vector3, type Light } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { buildTerrain, type BuiltTerrain } from '../world/TerrainBuilder';
import { Encounters } from '../world/Encounters';
import { Navigation } from '../ai/Navigation';
import { SYLVARIS } from '../ai/bosses/Sylvaris';
import type { Boss } from '../ai/Boss';
import type { FxHandle } from '../vfx/Vfx';
import type { LoopHandle } from '../audio/Audio';
import {
  opening, gateArrival, groveArrival, ravineArrival, blightArrival, heartArrival, bossIntro, bossDeath, PHASE_LINES,
} from '../story/chapter4';

/** The path's centreline (XZ): from the forest edge through the gate, the grove, the ravine and the blight. */
const PATH: [number, number][] = [[0, -8], [2, 14], [0, 30], [-3, 48], [2, 66], [0, 84], [0, 100], [-4, 118], [3, 136], [0, 156], [0, 178]];
const GATE_Z = 30;
const SHRINE = new Vector3(8, 0, 56);
const RAVINE_Z = 92;
const GLADE = new Vector3(0, 0, 182);
const GLADE_R = 22;

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

function pathDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i];
    const [bx, bz] = PATH[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Chapter Four: the Forgotten Sanctuary. Sylvaris's temple-forest, overgrown past all keeping: trees
 * that never stop growing, roots that swallow stone, blossom on the rot. The path runs through the
 * root-swallowed gate and the keepers' grove, over the ravine on a fallen giant, through the blight
 * to the Heartwood, a glade ringed with roots under the greatest tree, where the goddess waits.
 */
export class Sanctuary extends Level {
  readonly id = 'forest';
  readonly title = 'The Forgotten Sanctuary';
  private kit!: EnvKit;
  private terrain!: BuiltTerrain;
  private encounters!: Encounters;
  private fx: FxHandle[] = [];
  private lamps: Light[] = [];
  private loops: LoopHandle[] = [];
  private pollen: FxHandle | null = null;
  boss: Boss | null = null;
  private bossKey: Light | null = null;
  private bossStarted = false;
  private beats = new Set<string>();
  private safe = new Vector3();
  private safeTimer = 0;
  private falling = false;

  async load(checkpoint?: string): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    this.terrain = await buildTerrain(scene, 'forestGround', {
      origin: [-90, -40], size: [180, 270], density: 1.4, splatDensity: 3,
      height: (x, z) => this.height(x, z),
      splat: (x, z, h, slope) => {
        const d = pathDist(x, z);
        const path = 1 - smooth(1.8, 3.4, d + (fbm(x * 0.4, z * 0.4) - 0.5) * 1.6);
        const glade = 1 - smooth(GLADE_R - 4, GLADE_R + 1, Math.hypot(x - GLADE.x, z - GLADE.z));
        const grass = smooth(0.45, 0.7, fbm(x * 0.07 + 5, z * 0.07)) * (1 - path) * (1 - glade * 0.7);
        const rock = Math.max(smooth(0.35, 0.55, slope), smooth(-2.5, -5, h));
        return [Math.max(0, 1 - path - grass) + 0.05 + glade * 0.4, path * 0.9, grass, rock];
      },
    }, ['wood_forest_ground', 'sea_mossy_cobble', 'sky_grass_rock', 'wood_mossy_rock'], [4, 2.6, 4, 5], { heightBlend: 0.6, macro: 0.5 });
    this.own(this.terrain.mesh);
    this.own(this.terrain.material);
    g.lighting.addStatic(this.terrain.mesh, false);

    this.kit = new EnvKit(scene, g.assets, g.mats, g.lighting, 'env/forest', this.scope);
    // levels of detail: lighter trees and shrubs past a distance, ground cover culled
    for (const [piece, low, dist] of [
      ['ph_tree_small_02', 'ph_tree_small_02_lod1', 34], ['ph_island_tree_02', 'ph_island_tree_02_lod1', 30],
      ['ph_jacaranda_tree', 'ph_jacaranda_tree_lod1', 45], ['ph_shrub_02', 'ph_shrub_02_lod1', 25], ['ph_shrub_04', 'ph_shrub_04_lod1', 25],
      ['ph_nettle_plant', 'ph_nettle_plant_lod1', 20], ['ph_dead_tree_trunk', 'ph_dead_tree_trunk_lod1', 35],
      ['ph_fern_02', null, 32], ['ph_moss_01', null, 30], ['ph_weed_plant_02', null, 24], ['ph_dry_branches_medium_01', null, 24], ['ph_shrub_03', null, 30],
    ] as [string, string | null, number][]) this.kit.setLod(piece, low, dist);
    await this.kit.placeAll(this.layout());
    const col = this.kit.finish();
    this.own(this.kit);
    g.physics.addStaticMesh(this.terrain.mesh);
    if (col) g.physics.addStaticMesh(col);
    g.nav = await Navigation.build(col ? [this.terrain.mesh, col] : [this.terrain.mesh]);

    // light: glowing caps, the shrine's seed-bowl, sap-light in the gate's glyph
    const glow = (at: Vector3, k = 1) => {
      const l = g.lights.add(at, { color: [0.55, 1, 0.6], intensity: 14 * k, range: 6 * k, flicker: 0.15, speed: 0.4 });
      if (l) this.lamps.push(l);
    };
    for (const [x, z, s] of this.mushroomSpots()) glow(new Vector3(x, this.height(x, z) + 1.2 * s, z), s);
    glow(SHRINE.add(new Vector3(0, this.height(SHRINE.x, SHRINE.z) + 2.0, -1.0)), 1.6);
    glow(new Vector3(0, this.height(0, GATE_Z) + 9.6, GATE_Z - 1.2), 2);
    this.pollen = g.vfx.attach('pollen', new Vector3(0, 2, 0));
    for (const [x, z] of [[0, 10], [-4, 60], [4, 120], [0, 170]]) this.loops.push(g.audio.loop('forest_loop', new Vector3(x, 2, z), 0.8));

    // fights
    this.encounters = new Encounters(g.enemies);
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z), z);
    this.encounters.add({ id: 'gate', at: at(0, GATE_Z + 4), spawnRange: 26, spawns: [
      { id: 'thornbound', at: at(-2, GATE_Z + 6), yaw: Math.PI }, { id: 'thornbound', at: at(3, GATE_Z + 9), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'grove', at: at(0, 62), spawnRange: 30, onClear: () => g.flow.checkpoint(this.id, 'grove', 'grove'), spawns: [
      { id: 'bloomcaller', at: at(-6, 68), yaw: Math.PI }, { id: 'bloomcaller', at: at(6, 72), yaw: Math.PI },
      { id: 'thornbound', at: at(1, 62), yaw: Math.PI },
      { id: 'thornbound', at: at(-3, 74), patrol: [at(-4, 74), at(4, 74)] },
    ] });
    this.encounters.add({ id: 'blight', at: at(0, 124), spawnRange: 30, onClear: () => g.flow.checkpoint(this.id, 'heart', 'blight'), spawns: [
      { id: 'thornbound', at: at(-3, 120), yaw: Math.PI }, { id: 'thornbound', at: at(4, 128), yaw: Math.PI },
      { id: 'bloomcaller', at: at(-6, 134), yaw: Math.PI }, { id: 'bloomcaller', at: at(7, 138), yaw: Math.PI },
    ] });
    const order = ['gate', 'grove', 'blight'];
    const upTo: Record<string, number> = { grove: 2, heart: 3 };
    for (const id of order.slice(0, upTo[checkpoint ?? ''] ?? 0)) this.encounters.skip(id);
    if (checkpoint === 'grove') ['gate', 'grove'].forEach((b) => this.beats.add(b));
    if (checkpoint === 'heart') ['gate', 'grove', 'ravine', 'blight'].forEach((b) => this.beats.add(b));
  }

  /** Ground height: a forest valley along the path, a ravine, the level glade at the end. */
  height(x: number, z: number): number {
    const d = pathDist(x, z);
    let h = (fbm(x * 0.05, z * 0.05) - 0.5) * 3;
    h += smooth(8, 30, d) * (5 + 9 * fbm(x * 0.03 + 3, z * 0.03));
    h += smooth(28, 55, d) * 14;
    h -= (1 - smooth(1.5, 3.5, d)) * 0.12;
    // the ravine, crossed by the fallen log
    const rav = 1 - smooth(4.5, 7.5, Math.abs(z - RAVINE_Z) + (fbm(x * 0.2, 3) - 0.5) * 1.5);
    h = h * (1 - rav) - 9 * rav;
    // the Heartwood glade and the grove are levelled
    const glade = 1 - smooth(GLADE_R + 2, GLADE_R + 10, Math.hypot(x - GLADE.x, z - GLADE.z));
    const grove = 1 - smooth(10, 16, Math.hypot(x - 1, z - 62));
    h *= 1 - Math.max(glade, grove * 0.7);
    return h;
  }

  private mushroomSpots(): [number, number, number][] {
    return [[-5, 18, 1], [6, 40, 0.8], [-8, 58, 1.2], [9, 78, 1], [-6, 104, 0.9], [7, 112, 1.3], [-9, 132, 1.1], [8, 146, 1], [-12, 166, 1.4], [13, 170, 1.2]];
  }

  private layout(): Placement[] {
    const P: Placement[] = [];
    const put = (piece: string, x: number, z: number, yaw = 0, scale = 1, dy = 0) => {
      P.push({ piece, position: new Vector3(x, this.height(x, z) + dy, z), yaw, scale });
    };
    const rnd = (i: number, k: number) => hash(i * 7.31 + k, k * 3.17 + i * 0.37);
    // ------------------------------------------------ trees, scattered off the path (jittered grid)
    const blocked = (x: number, z: number, r: number) => pathDist(x, z) < 4.5 + r
      || Math.hypot(x - GLADE.x, z - GLADE.z) < GLADE_R + 4 + r || Math.abs(z - RAVINE_Z) < 8
      || Math.hypot(x - SHRINE.x, z - SHRINE.z) < 7 || Math.abs(z - GATE_Z) < 4 && Math.abs(x) < 9;
    let n = 0;
    for (let gz = -30; gz < 220; gz += 8.5) {
      for (let gx = -64; gx <= 64; gx += 8.5) {
        n++;
        const x = gx + (rnd(n, 1) - 0.5) * 7;
        const z = gz + (rnd(n, 2) - 0.5) * 7;
        const d = pathDist(x, z);
        if (d > 44 || rnd(n, 3) < 0.15) continue;
        const blight = z > 105 && z < 160;
        const r = rnd(n, 4);
        // photoscanned trees: slender ones for the canopy, broad jacarandas further out, low island
        // trees under them; the blight is bare wood
        let piece: string;
        let scale: number;
        if (blight && r < 0.55) {
          piece = r < 0.35 ? 'tree_dead' : 'ph_dead_tree_trunk';
          scale = 0.9 + rnd(n, 6) * 0.5;
        } else if (d > 13 && r < 0.22) {
          piece = 'ph_jacaranda_tree';
          scale = 0.8 + rnd(n, 6) * 0.4;
        } else if (r < 0.32) {
          piece = 'ph_island_tree_02';
          scale = 1.3 + rnd(n, 6) * 0.6;
        } else {
          piece = 'ph_tree_small_02';
          scale = 2.6 + rnd(n, 6) * 1.0;
        }
        const size = piece === 'ph_jacaranda_tree' ? 8 * scale : 2;
        if (blocked(x, z, size)) continue;
        put(piece, x, z, rnd(n, 5) * 6.28, scale, -0.15);
      }
    }
    // ------------------------------------------------ undergrowth: photoscanned ferns, shrubs, nettles, moss
    const cover: [string, number, number][] = [['ph_fern_02', 70, 1.2], ['ph_shrub_03', 26, 1], ['ph_shrub_02', 10, 1], ['ph_nettle_plant', 20, 1],
      ['ph_weed_plant_02', 18, 1], ['ph_moss_01', 40, 1.6], ['ph_dry_branches_medium_01', 12, 1], ['ph_shrub_04', 16, 1.4], ['ph_shrub_02', 10, 1.2], ['ph_tree_stump_02', 6, 1.1]];
    let k = 1000;
    for (const [piece, count, sc] of cover) {
      for (let i = 0; i < count; i++) {
        k++;
        const z = -10 + rnd(k, 1) * 190;
        const side = rnd(k, 2) < 0.5 ? -1 : 1;
        const along = PATH.reduce((best, p) => (Math.abs(p[1] - z) < Math.abs(best[1] - z) ? p : best), PATH[0])[0];
        const x = along + side * (2.8 + rnd(k, 3) * 14);
        if (Math.abs(z - RAVINE_Z) < 7 || Math.hypot(x - GLADE.x, z - GLADE.z) < GLADE_R - 2) continue;
        put(piece, x, z, rnd(k, 4) * 6.28, sc * (0.8 + rnd(k, 5) * 0.6), -0.05);
      }
    }
    for (const [x, z, s] of this.mushroomSpots()) put(s > 1.15 ? 'mushroom_giant' : 'mushrooms', x, z, x * 0.3, s > 1.15 ? 0.9 : s * 1.3);
    // stumps, roots, logs and stones by the path
    const solids: [string, number, number, number, number][] = [['ph_tree_stump_01', -5, 6, 0.3, 1], ['ph_tree_stump_02', 6, 22, 2.1, 1.2], ['ph_root_cluster_02', -6, 36, 1.2, 1.3],
      ['ph_dead_tree_trunk', 7, 44, 1.7, 1], ['ph_single_root', -4, 52, 0.4, 1.4], ['ph_boulder_01', 10, 64, 0.9, 1.3], ['ph_stone_01', -7, 80, 2.4, 1.6],
      ['ph_pine_roots', 5, 104, 0.6, 1.4], ['ph_dead_tree_trunk_02', -8, 112, 2.9, 1], ['ph_tree_stump_01', 6, 128, 1.1, 1.3], ['ph_root_cluster_02', -6, 146, 0.2, 1.5],
      ['ph_boulder_01', 9, 152, 2.2, 1.1], ['rocks_a', -12, 24, 0.5, 1], ['rocks_b', 11, 34, 1.9, 1], ['rocks_a', 13, 96, 2.8, 1.3], ['rocks_b', -11, 88, 0.2, 1.2]];
    for (const [piece, x, z, yaw, sc] of solids) put(piece, x, z, yaw, sc, -0.1);
    // ------------------------------------------------ the way: gate, grove, ravine, blight, glade
    put('gate', 0, GATE_Z, 0);
    put('stones', 0, GATE_Z + 2, Math.PI, 1);
    put('statue_sylvaris', -7, GATE_Z + 7, Math.PI / 2 + 0.4, 0.9);
    put('shrine', SHRINE.x, SHRINE.z, -Math.PI / 2 - 0.2);
    put('stones', 1, 50, Math.PI + 0.15);
    put('roots_arch', 1, 72, 0.1);
    // the fallen giant across the ravine (along +Z), sunk into both banks
    P.push({ piece: 'log', position: new Vector3(0, -1.75, RAVINE_Z), yaw: Math.PI / 2, scale: 1 });
    put('roots_arch', -2, 140, -0.2, 1.15);
    // the Heartwood: a ring of roots, open to the south, the great tree beyond it
    for (let i = 0; i < 12; i++) {
      if (i === 3) continue;
      P.push({ piece: 'root_wall', position: new Vector3(GLADE.x, this.height(GLADE.x, GLADE.z) - 0.2, GLADE.z), yaw: (i * Math.PI) / 6, scale: 1 });
    }
    // the Heartwood itself: a colossal flowering tree over the glade's far side, two more flanking
    put('ph_jacaranda_tree', 0, GLADE.z + GLADE_R + 14, 0.4, 2.2, -0.4);
    put('ph_jacaranda_tree', -34, GLADE.z + 4, 2.1, 1.5, -0.4);
    put('ph_jacaranda_tree', 36, GLADE.z - 6, 4.0, 1.6, -0.4);
    put('mushroom_giant', -14, GLADE.z + 12, 1.1, 1.2);
    put('mushroom_giant', 15, GLADE.z + 10, 2.6, 1.0);
    return P;
  }

  spawn(checkpoint?: string): { position: Vector3; yaw: number } {
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z) + 0.05, z);
    switch (checkpoint) {
      case 'grove': return { position: at(4, 58), yaw: 0 };
      case 'heart': return { position: at(1, 150), yaw: 0 };
      case 'title': return { position: at(0, -6), yaw: 0 };
      default: return { position: at(0, -4), yaw: 0 };
    }
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        // late light falling through the canopy in shafts; green bounce from the forest floor
        sunColor: new Color3(1.0, 0.82, 0.55), sunIntensity: 3.6, sunElevation: 0.42, sunAzimuth: 2.2,
        skyFill: new Color3(0.42, 0.52, 0.45), groundFill: new Color3(0.16, 0.2, 0.1), fillIntensity: 0.14,
        environmentIntensity: 0.8, exposure: 1.0, contrast: 1.12, shadowDarkness: 0.1,
      },
      sky: {
        zenith: new Color3(0.14, 0.18, 0.2), horizon: new Color3(0.7, 0.62, 0.45), ground: new Color3(0.1, 0.12, 0.08),
        gradient: 0.55, sunColor: new Color3(1.0, 0.75, 0.45), sunIntensity: 14, eclipse: 0.82, coronaColor: new Color3(0.95, 0.85, 0.55),
        cloudCover: 0.5, cloudDensity: 1.1, cloudColor: new Color3(0.7, 0.65, 0.55), cloudShadow: new Color3(0.2, 0.2, 0.16),
        horizonGlow: new Color3(0.45, 0.35, 0.2),
      },
      look: {
        fog: { color: new Color3(0.36, 0.42, 0.3), density: 0.0026, heightFalloff: 0.05, sunScatter: 0.9, skyAmount: 0.35, volumeDensity: 0.009,
          volumeColor: new Color3(0.62, 0.7, 0.5), volumeHeight: 7, maxDistance: 90, shaftDensity: 0.006 },
        grade: {
          temperature: 0.08, tint: -0.03, slope: [1.0, 1.02, 0.96], offset: [0, 0.002, -0.004], power: [1, 1, 1.02],
          contrast: 1.14, saturation: 1.0, shadowSaturation: 0.9, highlightSaturation: 1.05,
          shadowTint: [-0.01, 0.01, 0.01], highlightTint: [0.03, 0.02, -0.02], splitBalance: 0.5, gain: 1,
        },
        exposure: { compensation: -0.3 },
      },
      weather: { wetness: 0.25, cover: 0.0, wind: 0.3, windDir: [0.4, 0.9] },
      music: 'forest',
      ambience: 'wind_loop',
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
    if (Math.abs(at.z - RAVINE_Z) < 7.5 && at.y > -1) return 'wood';
    return pathDist(at.x, at.z) < 2.6 ? 'stone' : 'ash';
  }

  override update(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.pollen?.move(p.position.add(new Vector3(0, 1.5, 0)));
    this.kit.updateLods(g.activeCamera.globalPosition);
    this.encounters.update(p.position);
    this.falls(dt);
    if (this.bossKey && this.boss) {
      const bp = this.boss.position;
      (this.bossKey as unknown as { position: Vector3 }).position.set(bp.x, bp.y + 8, bp.z - 3);
    }
    if (!g.cine.running) {
      const beat = (id: string, cond: boolean, fn: () => Promise<void>) => {
        if (cond && !this.beats.has(id)) {
          this.beats.add(id);
          void fn();
        }
      };
      const z = p.position.z;
      beat('gate', z > GATE_Z - 10, () => gateArrival(g.cine));
      beat('grove', z > 48, () => groveArrival(g.cine));
      beat('ravine', z > RAVINE_Z - 14, () => ravineArrival(g.cine));
      beat('blight', z > 108, () => blightArrival(g.cine));
      beat('heart', z > GLADE.z - GLADE_R - 8, () => heartArrival(g.cine));
    }
    if (!this.bossStarted && Vector3.Distance(new Vector3(p.position.x, 0, p.position.z), new Vector3(GLADE.x, 0, GLADE.z)) < GLADE_R - 6) void this.startBoss();
  }

  /** Into the ravine: the forest returns Kael to the path (a little hurt). */
  private falls(dt: number): void {
    const g = this.game;
    const p = g.player!;
    this.safeTimer -= dt;
    if (p.grounded && this.safeTimer <= 0 && !this.falling && p.position.y > -2) {
      this.safe.copyFrom(p.position);
      this.safeTimer = 0.4;
    }
    if (this.falling || !p.alive || p.position.y > -5) return;
    this.falling = true;
    g.hud.fade(true);
    g.hazards.after(0.8, () => {
      p.place(this.safe.clone());
      p.stats.damage(p.stats.maxHealth * 0.1);
      g.rig.snapBehind(p.char.yaw);
      g.hud.fade(false);
      this.falling = false;
    });
  }

  private async startBoss(): Promise<void> {
    this.bossStarted = true;
    const g = this.game;
    const at = new Vector3(GLADE.x, this.height(GLADE.x, GLADE.z + 6), GLADE.z + 6);
    const b = await g.enemies.spawnBoss(SYLVARIS, at, Math.PI);
    this.boss = b;
    this.bossKey = g.lights.add(at.add(new Vector3(0, 8, -3)), { color: [1, 0.92, 0.75], intensity: 45, range: 18 });
    b.dormant = true;
    void g.audio.music('sylvaris');
    if (!g.params.has('nointro')) await g.cine.play((d) => bossIntro(d, g, b));
    b.char.model.root.position.y = 0;
    b.hidden = false;
    b.dormant = false;
    g.audio.play('banner_boom');
    g.hud.showBanner('Sylvaris', 'The Rot and the Bloom');
    g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
    const p = g.player;
    if (p) b.alert(b.position, p);
    b.onPhase = (i) => void g.cine.barks(PHASE_LINES[i] ?? []);
    b.spawnAdds = (from, n) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = from.x + Math.sin(a) * 7;
        const z = from.z + Math.cos(a) * 7;
        const spot = new Vector3(x, this.height(x, z), z);
        g.vfx.burst('rootBurst', spot, Vector3.Up(), 1);
        void g.enemies.spawn(i % 3 === 2 ? 'bloomcaller' : 'thornbound', spot, { aggro: true });
      }
    };
    b.events.on('died', () => {
      b.holdBody(); // the body lies there while the scene speaks over it
      g.hud.showBoss(null);
      void g.audio.music('forest');
      if (this.bossKey) g.lights.remove(this.bossKey);
      this.bossKey = null;
      g.hazards.after(2.4, () => void g.cine.play((d) => bossDeath(d, g, b)).finally(() => b.releaseBody()).then(() => {
        g.flow.claimSpark('sylvaris');
        g.flow.checkpoint(this.id, 'heart', 'sylvaris');
        g.flow.chapterComplete(this.id);
      }));
    });
    g.hazards.after(3.5, () => g.hud.showBanner(null));
  }

  override dispose(): void {
    for (const f of this.fx) f.stop();
    this.pollen?.stop();
    for (const l of this.lamps) this.game.lights.remove(l);
    if (this.bossKey) this.game.lights.remove(this.bossKey);
    for (const l of this.loops) l.stop(1);
    super.dispose();
  }
}
