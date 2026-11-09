import { Color3, MeshBuilder, Vector3, type PBRMaterial } from '@babylonjs/core';
import { LavaPlugin } from '../render/materials/FxPlugins';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { buildTerrain, type BuiltTerrain } from '../world/TerrainBuilder';
import { Encounters } from '../world/Encounters';
import { Navigation } from '../ai/Navigation';
import { IGNAROTH } from '../ai/bosses/Ignaroth';
import type { Boss } from '../ai/Boss';
import type { FxHandle } from '../vfx/Vfx';
import { opening, HINTS, villageArrival, gateArrival, bossIntro, bossDeath, PHASE_LINES } from '../story/chapter1';

/** The road through the chapter (XZ), from where Kael wakes to the castle bailey. */
const ROAD: [number, number][] = [[0, -6], [3, 20], [-3, 45], [0, 72], [0, 100], [2, 138], [0, 156], [0, 175], [0, 212]];
const SQUARE = new Vector3(0, 0, 104);
const ARENA = new Vector3(0, 0, 214);
const ARENA_R = 21;

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

/** Distance from a point to the road polyline. */
function roadDist(x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [ax, az] = ROAD[i];
    const [bx, bz] = ROAD[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/**
 * Chapter One: the Ashen Kingdom. Ash falls from a bruised orange sky over the burnt castle-town of
 * Varn Keld. The Cinder Road leads past dead orchards to the burned village and its chapel, then to
 * the town wall, whose gate is choked with rubble: Kael climbs to the wall-walk and drops into the
 * castle bailey, where Ignaroth sits on the Crucible Throne.
 */
export class AshenKingdom extends Level {
  readonly id = 'ashen';
  readonly title = 'The Ashen Kingdom';
  private kit!: EnvKit;
  private terrain!: BuiltTerrain;
  private encounters!: Encounters;
  private ash: FxHandle | null = null;
  private embers: FxHandle | null = null;
  private fires: FxHandle[] = [];
  private lamps: import('@babylonjs/core').Light[] = [];
  private loops: import('../audio/Audio').LoopHandle[] = [];
  boss: Boss | null = null;
  private bossStarted = false;
  private hint = 0;
  private beats = new Set<string>();

  async load(checkpoint?: string): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    // ------------------------------------------------------------------ terrain
    this.terrain = await buildTerrain(scene, 'ashenGround', {
      origin: [-90, -40], size: [180, 300], density: 1.5, splatDensity: 3,
      height: (x, z) => this.height(x, z),
      splat: (x, z, _h, slope) => {
        const road = 1 - smooth(2.2, 3.6, roadDist(x, z) + (fbm(x * 0.4, z * 0.4) - 0.5) * 1.5);
        const square = 1 - smooth(14, 17, Math.hypot(x - SQUARE.x, z - SQUARE.z));
        const arena = 1 - smooth(ARENA_R - 1, ARENA_R + 1, Math.hypot(x - ARENA.x, z - ARENA.z));
        const paved = Math.max(road, square, arena);
        const mud = smooth(0.45, 0.7, fbm(x * 0.09 + 3, z * 0.09)) * (1 - paved);
        return [Math.max(0, 1 - paved - mud) + 0.05, paved, mud, smooth(0.25, 0.45, slope)];
      },
    }, ['ash_burned_ground', 'ash_cobble', 'ash_mud', 'ash_rock'], [4, 2.6, 4, 6], { heightBlend: 0.6, macro: 0.5 });
    this.own(this.terrain.mesh);
    this.own(this.terrain.material);
    g.lighting.addStatic(this.terrain.mesh, false);

    // ------------------------------------------------------------------ scenery
    this.kit = new EnvKit(scene, g.assets, g.mats, g.lighting, 'env/ashen', this.scope);
    await this.kit.placeAll(this.layout());
    const col = this.kit.finish();
    this.own(this.kit);
    g.physics.addStaticMesh(this.terrain.mesh);
    if (col) g.physics.addStaticMesh(col);
    g.nav = await Navigation.build(col ? [this.terrain.mesh, col] : [this.terrain.mesh]);

    // ------------------------------------------------------------------ fire, ash and smoke
    this.ash = g.vfx.attach('ashfall', new Vector3(0, 10, 0));
    this.embers = g.vfx.attach('emberDrift', new Vector3(0, 2, 0));
    const fire = (x: number, y: number, z: number, big = 1) => {
      const at = new Vector3(x, this.height(x, z) + y, z);
      this.fires.push(g.vfx.attach(big > 1.5 ? 'bonfire' : 'fireTrail', at, big));
      const l = g.lights.add(at.add(new Vector3(0, 0.6, 0)), { color: [1, 0.48, 0.16], intensity: 30 * big, range: 7 + 4 * big, flicker: 0.6, speed: 1 });
      if (l) this.lamps.push(l);
      this.loops.push(g.audio.loop('fire_loop', at, Math.min(1, 0.5 + 0.25 * big)));
    };
    // burning houses, braziers round the square and on the wall, the arena's fire bowls
    fire(13, 3.4, 88, 2.2);
    fire(-14, 6.5, 118, 2.4);
    fire(-27, 3.0, 76, 2);
    for (const [x, z] of [[-6, 98], [6, 98], [-6, 111], [6, 111]]) fire(x, 1.38, z, 1);
    for (let i = 0; i < 8; i++) {
      if (i === 4) continue;
      const a = (i / 8) * Math.PI * 2;
      fire(ARENA.x + Math.sin(a) * (ARENA_R - 2.5), 1.38, ARENA.z + Math.cos(a) * (ARENA_R - 2.5), 1.2);
    }
    // the fire bowls on the throne's pillars
    for (const sx of [-7, 7]) fire(ARENA.x + sx, 9.0, ARENA.z + ARENA_R - 4, 2.2);
    // lava welling up through the bailey's broken flagstones
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * 0.25 + (i / 7) * Math.PI * 1.5;
      this.lava(ARENA.x + Math.sin(a) * (ARENA_R + 2.5), ARENA.z + Math.cos(a) * (ARENA_R + 2.5), 2.4 + (i % 3) * 0.6);
    }
    this.lava(ARENA.x, ARENA.z + ARENA_R + 7, 5);
    for (const [x, z] of [[-40, 150], [35, 60], [60, 120], [-55, 200]]) {
      this.fires.push(g.vfx.attach('smokeColumn', new Vector3(x, this.height(x, z) + 2, z)));
    }

    // ------------------------------------------------------------------ fights
    this.encounters = new Encounters(g.enemies);
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z), z);
    this.encounters.add({ id: 'road1', at: at(2, 30), spawns: [
      { id: 'thrall', at: at(4, 32), yaw: Math.PI }, { id: 'thrall', at: at(-2, 36), yaw: Math.PI * 0.9 },
    ] });
    this.encounters.add({ id: 'road2', at: at(-2, 58), spawns: [
      { id: 'thrall', at: at(-4, 60), yaw: Math.PI }, { id: 'thrall', at: at(3, 63), yaw: Math.PI },
      { id: 'thrall', at: at(-8, 55), patrol: [at(-8, 55), at(6, 55), at(6, 64), at(-8, 64)] },
    ] });
    this.encounters.add({ id: 'square', at: SQUARE, spawnRange: 50, onClear: () => g.flow.checkpoint(this.id, 'village', 'square'), spawns: [
      { id: 'thrall', at: at(-5, 102), yaw: Math.PI }, { id: 'thrall', at: at(5, 104), yaw: Math.PI },
      { id: 'thrall', at: at(-2, 110), yaw: Math.PI }, { id: 'pyre_acolyte', at: at(0, 116), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'knight', at: at(1, 140), onClear: () => g.flow.checkpoint(this.id, 'gate', 'knight'), spawns: [{ id: 'cinder_knight', at: at(1, 142), yaw: Math.PI }] });
    this.encounters.add({ id: 'wall', at: at(-20, 162), onClear: () => g.flow.checkpoint(this.id, 'throne', 'wall'), spawns: [
      { id: 'pyre_acolyte', at: new Vector3(-12, 6.12, 163.4), yaw: Math.PI }, { id: 'thrall', at: new Vector3(-30, 6.12, 163.4), yaw: Math.PI / 2 },
      { id: 'pyre_acolyte', at: new Vector3(14, 6.12, 163.4), yaw: Math.PI },
    ] });
    const order = ['road1', 'road2', 'square', 'knight', 'wall'];
    const upTo: Record<string, number> = { village: 2, gate: 4, throne: 5 };
    for (const id of order.slice(0, upTo[checkpoint ?? ''] ?? 0)) this.encounters.skip(id);
  }

  /** A pool of molten rock: lava surface, its glow, and a burn zone. */
  private lava(x: number, z: number, r: number): void {
    const g = this.game;
    if (!this.lavaMat) {
      const m = g.mats.surface({ set: 'ash_dark_rock', tile: 1 / 3 }).clone('lava') as PBRMaterial;
      m.roughness = 0.9;
      const lava = new LavaPlugin(m);
      lava.molten = 0.16;
      lava.intensity = 2.6;
      this.lavaMat = this.own(m);
    }
    const y = this.height(x, z);
    const disc = this.own(MeshBuilder.CreateDisc('lavaPool', { radius: r, tessellation: 40 }, g.scene));
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, y + 0.06, z);
    disc.material = this.lavaMat;
    disc.receiveShadows = false;
    disc.isPickable = false;
    const l = g.lights.add(new Vector3(x, y + 1.2, z), { color: [1, 0.4, 0.1], intensity: 20 * r, range: r * 3 + 4, flicker: 0.25, speed: 0.4 });
    if (l) this.lamps.push(l);
    this.loops.push(g.audio.loop('lava_loop', new Vector3(x, y, z), 0.8));
    g.hazards.zone(new Vector3(x, y, z), r * 0.9, 1e9, null, 'neutral', 0.5, (v) => {
      const dir = v.position.subtract(new Vector3(x, y, z));
      dir.y = 0;
      dir.normalize();
      return { amount: 18, poise: 12, element: 'fire', direction: dir, point: v.position.clone(), source: null, weight: 0.3, knockback: 1, parryable: false, unblockable: true, ranged: true, status: { burn: 30 }, tag: 'lava' };
    });
  }

  private lavaMat: PBRMaterial | null = null;

  /** Ground height: low hills closing in either side of the road, flat plots for the town. */
  height(x: number, z: number): number {
    const d = roadDist(x, z);
    let h = (fbm(x * 0.035, z * 0.035) - 0.5) * 3.5;
    h += smooth(12, 42, d) * (6 + 8 * fbm(x * 0.02 + 7, z * 0.02));
    h += smooth(40, 70, d) * 10;
    // the road itself sits a little low; plots are levelled
    h -= (1 - smooth(1.5, 3.5, d)) * 0.08;
    const flat = (cx: number, cz: number, r0: number, r1: number) => 1 - smooth(r0, r1, Math.hypot(x - cx, z - cz));
    const f = Math.max(flat(SQUARE.x, SQUARE.z, 26, 34), flat(ARENA.x, ARENA.z, ARENA_R + 6, ARENA_R + 14), flat(0, 163, 46, 52) * (Math.abs(z - 163) < 14 ? 1 : 0));
    h *= 1 - f;
    // the bailey sits a step below the wall-walk drop
    return h;
  }

  private layout(): Placement[] {
    const P: Placement[] = [];
    const put = (piece: string, x: number, z: number, yaw = 0, scale = 1, dy = 0) => {
      P.push({ piece, position: new Vector3(x, this.height(x, z) + dy, z), yaw, scale });
    };
    // Cinder Road: dead orchards, wrecks and rubble
    const trees: [number, number][] = [[-9, 4], [10, 9], [-14, 18], [12, 26], [-11, 33], [15, 40], [-16, 48], [10, 55], [-12, 64], [14, 68], [-20, 28], [22, 50]];
    trees.forEach(([x, z], i) => put(i % 2 ? 'tree_a' : 'tree_b', x, z, i * 1.7, 0.85 + (i % 3) * 0.12));
    put('banner', 3.5, 2, -0.4);
    put('cart', 6.5, 17, 0.9);
    put('rubble_a', -6.5, 24, 0.4);
    put('barrel', 7.5, 19.5, 0.2);
    put('crate', 8.2, 15.4, 0.6);
    put('beams', -7, 40, 1.1);
    put('rubble_b', 6, 47, 2.2);
    put('wall_breach', -10, 60, Math.PI / 2 + 0.1);
    put('wall', -10.6, 66, Math.PI / 2 + 0.1);
    put('banner', -3.8, 70, 0.3);
    // the burned village round the square
    put('well', SQUARE.x + 0.5, SQUARE.z - 2);
    put('statue_broken', SQUARE.x - 3.5, SQUARE.z + 6, 0.3);
    for (const [x, z] of [[-6, 98], [6, 98], [-6, 111], [6, 111]]) put('brazier', x, z);
    put('house_a', -13, 90, Math.PI / 2);
    put('house_b', 13.5, 88, -Math.PI / 2);
    put('house_c', -14, 118, Math.PI / 2);
    put('house_a', 14, 124, -Math.PI / 2 + 0.05);
    put('house_b', -26, 76, Math.PI / 2 - 0.2);
    put('house_c', 17, 72, -Math.PI / 2 - 0.15);
    put('chapel', 30, 104, -Math.PI / 2);
    put('rubble_c', 12, 112, 0.8);
    put('beams', -9, 126, 0.3);
    put('cart', -8, 84, 2.4);
    put('barrel', 9, 96, 0);
    put('barrel', 9.6, 96.9, 0.7);
    put('crate', -9, 113, 0.2);
    put('rubble_a', 3, 132, 1.7);
    // the town wall, its gate choked with rubble, ramparts either side
    put('gatehouse', 0, 165);
    put('rubble_c', 0, 163, 0.5, 1.3);
    put('rubble_c', 0.5, 167, 2.0, 1.1);
    for (const x of [-12, -20, -28, -36, -44]) put('rampart', x, 165);
    for (const x of [12, 20, 28, 36, 44]) put('rampart', x, 165);
    put('tower', -50, 165);
    put('tower', 50, 165);
    // the way up: a stair raised against the outside of the wall where scaffolding burned away
    put('rampart_stairs', -31.5, 162.1, 0);
    put('rubble_b', -26, 158.5, 1.2);
    put('beams', -33, 159, 2.3);
    // the bailey and the Crucible Throne
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
      if (Math.abs(Math.sin(a)) < 0.3 && Math.cos(a) < 0) continue; // the way in from the wall
      put('tower', ARENA.x + Math.sin(a) * (ARENA_R + 7), ARENA.z + Math.cos(a) * (ARENA_R + 7), a, 0.9);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      if (Math.cos(a) < -0.85) continue;
      put(i % 3 === 0 ? 'wall_breach' : 'wall', ARENA.x + Math.sin(a) * (ARENA_R + 6), ARENA.z + Math.cos(a) * (ARENA_R + 6), a + Math.PI / 2, 1.1);
    }
    for (let i = 0; i < 8; i++) {
      if (i === 4) continue; // the way in
      const a = (i / 8) * Math.PI * 2;
      put('brazier', ARENA.x + Math.sin(a) * (ARENA_R - 2.5), ARENA.z + Math.cos(a) * (ARENA_R - 2.5));
    }
    put('throne', ARENA.x, ARENA.z + ARENA_R - 2, Math.PI);
    put('rubble_a', ARENA.x - 12, ARENA.z + 8, 0.9);
    put('rubble_b', ARENA.x + 13, ARENA.z - 6, 2.9);
    return P;
  }

  spawn(checkpoint?: string): { position: Vector3; yaw: number } {
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z) + 0.05, z);
    switch (checkpoint) {
      case 'village': return { position: at(0, 80), yaw: 0 };
      case 'gate': return { position: at(-2, 145), yaw: 0 };
      case 'throne': return { position: at(0, 185), yaw: 0 };
      case 'title': return { position: at(0, -30), yaw: 0 };
      default: return { position: at(0, -2), yaw: 0 };
    }
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        // the eclipsed sun gives a low, dim, orange-red key; the sky itself carries the light
        sunColor: new Color3(1.0, 0.58, 0.32), sunIntensity: 3.8, sunElevation: 0.36, sunAzimuth: 2.6,
        skyFill: new Color3(0.5, 0.36, 0.3), groundFill: new Color3(0.18, 0.1, 0.07), fillIntensity: 0.12,
        environmentIntensity: 0.7, exposure: 1.0, contrast: 1.15, shadowDarkness: 0.05,
      },
      sky: {
        zenith: new Color3(0.16, 0.09, 0.08), horizon: new Color3(0.75, 0.38, 0.2), ground: new Color3(0.12, 0.08, 0.06),
        gradient: 0.55, sunColor: new Color3(1.0, 0.5, 0.25), sunIntensity: 18, eclipse: 0.82, coronaColor: new Color3(1.0, 0.55, 0.25),
        cloudCover: 0.62, cloudDensity: 1.2, cloudColor: new Color3(0.75, 0.5, 0.38), cloudShadow: new Color3(0.2, 0.12, 0.1),
        horizonGlow: new Color3(0.5, 0.18, 0.06),
      },
      look: {
        fog: { color: new Color3(0.42, 0.28, 0.2), density: 0.0016, heightFalloff: 0.06, sunScatter: 0.7, skyAmount: 0.3, volumeDensity: 0.007,
          volumeColor: new Color3(0.5, 0.4, 0.35), volumeHeight: 6, maxDistance: 80, shaftDensity: 0.0025 },
        grade: {
          temperature: 0.25, tint: 0.05, slope: [1.04, 0.98, 0.92], offset: [0.004, 0, -0.004], power: [1, 1, 1.04],
          contrast: 1.12, saturation: 0.9, shadowSaturation: 0.8, highlightSaturation: 1.05,
          shadowTint: [0.02, 0.0, -0.01], highlightTint: [0.04, 0.015, -0.02], splitBalance: 0.45, gain: 1,
        },
      },
      weather: { cover: 0.42, coverColor: new Color3(0.42, 0.4, 0.38), wind: 0.35, windDir: [0.6, 0.8] },
      music: 'ashen',
      ambience: 'wind_loop',
    };
  }

  override start(checkpoint?: string): void {
    const g = this.game;
    if (checkpoint === 'title') return;
    if (!checkpoint && !g.params.has('nointro')) void g.cine.play((d) => opening(d, g));
    if (checkpoint) this.hint = HINTS.length;
    g.flow.checkpoint(this.id, checkpoint ?? '');
  }

  override surface(at: Vector3): 'stone' | 'ash' | 'wood' | 'water' {
    const paved = roadDist(at.x, at.z) < 2.8 || Math.hypot(at.x - SQUARE.x, at.z - SQUARE.z) < 15 || Math.hypot(at.x - ARENA.x, at.z - ARENA.z) < ARENA_R;
    return paved || at.y > 3 ? 'stone' : 'ash';
  }

  override update(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    const cam = g.activeCamera.globalPosition;
    this.ash?.move(new Vector3(cam.x, cam.y + 6, cam.z));
    this.embers?.move(new Vector3(cam.x, cam.y - 1, cam.z));
    this.encounters.update(p.position);
    if (!g.cine.running) {
      // tutorial hints along the road, one after another
      const h = HINTS[this.hint];
      if (h && p.position.z > h.z) {
        g.hud.showHint(h.title, h.body);
        this.hint++;
        const shown = this.hint;
        g.hazards.after(9, () => { if (this.hint === shown) g.hud.showHint(null); });
      }
      const beat = (id: string, cond: boolean, fn: () => Promise<void>) => {
        if (cond && !this.beats.has(id)) {
          this.beats.add(id);
          void fn();
        }
      };
      beat('village', p.position.z > 78, () => villageArrival(g.cine));
      beat('gate', p.position.z > 150, () => gateArrival(g.cine));
    }
    if (!this.bossStarted && Vector3.Distance(p.position, ARENA) < ARENA_R - 3) void this.startBoss();
    void dt;
  }

  private async startBoss(): Promise<void> {
    this.bossStarted = true;
    const g = this.game;
    const b = await g.enemies.spawnBoss(IGNAROTH, new Vector3(ARENA.x, this.height(ARENA.x, ARENA.z + 12), ARENA.z + 12), Math.PI);
    this.boss = b;
    b.dormant = true;
    void g.audio.music('ignaroth');
    if (!g.params.has('nointro')) await g.cine.play((d) => bossIntro(d, g, b));
    b.dormant = false;
    g.audio.play('banner_boom');
    g.hud.showBanner('Ignaroth', 'The Burning King');
    g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
    const p = g.player;
    if (p) b.alert(b.position, p);
    b.onPhase = (i) => void g.cine.barks(PHASE_LINES[i] ?? []);
    b.spawnAdds = (at, n) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = at.x + Math.sin(a) * 5;
        const z = at.z + Math.cos(a) * 5;
        void g.enemies.spawn('thrall', new Vector3(x, this.height(x, z), z), { aggro: true });
      }
    };
    b.events.on('died', () => {
      g.hud.showBoss(null);
      void g.audio.music('ashen');
      g.hazards.after(2.4, () => void g.cine.play((d) => bossDeath(d, g, b)).then(() => {
        g.flow.claimSpark('ignaroth');
        g.flow.checkpoint(this.id, 'throne', 'ignaroth');
        g.flow.chapterComplete(this.id);
      }));
    });
    g.hazards.after(3.5, () => g.hud.showBanner(null));
  }

  override dispose(): void {
    this.ash?.stop();
    this.embers?.stop();
    for (const f of this.fires) f.stop();
    for (const l of this.lamps) this.game.lights.remove(l);
    for (const l of this.loops) l.stop(1);
    super.dispose();
  }
}
