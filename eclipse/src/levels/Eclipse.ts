import { Color3, Vector3, type Light } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { buildTerrain, type BuiltTerrain } from '../world/TerrainBuilder';
import { Encounters } from '../world/Encounters';
import { Navigation } from '../ai/Navigation';
import { buildCloudSea } from '../world/CloudSea';
import { AURELION } from '../ai/bosses/Aurelion';
import type { Boss } from '../ai/Boss';
import type { FxHandle } from '../vfx/Vfx';
import type { LoopHandle } from '../audio/Audio';
import {
  opening, terraceArrival, processionArrival, summitArrival, bossIntro, bossDeath, ending, PHASE_LINES,
} from '../story/chapter5';

/** Terrace levels (z ranges and heights) and the stairs that join them (6 m rises over 11.4 m). */
const T1 = { z0: -20, z1: 62, y: 0 };
const T2 = { z0: 73.4, z1: 116, y: 6 };
const T3 = { z0: 127.4, z1: 150, y: 12 };
const STAIR_RUN = 11.4;
const DAIS = new Vector3(0, 18, 186);
const DAIS_R = 24;
const SEA_Y = -60;

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
 * Chapter Five: the Eternal Eclipse. Solmara, Aurelion's citadel on the summit of the world, white
 * marble and gold under the black sun. Three terraces climb toward the Eclipse Dais: the gate and the
 * court of mirrors, the processional of the five, the last approach. On the dais, under the great
 * ring, the god who swallowed the sun waits for his sparks.
 */
export class Eclipse extends Level {
  readonly id = 'eclipse';
  readonly title = 'The Eternal Eclipse';
  private kit!: EnvKit;
  private terrain!: BuiltTerrain;
  private encounters!: Encounters;
  private fx: FxHandle[] = [];
  private lamps: Light[] = [];
  private loops: LoopHandle[] = [];
  private motes: FxHandle | null = null;
  boss: Boss | null = null;
  private bossKey: Light | null = null;
  private bossStarted = false;
  private beats = new Set<string>();
  private safe = new Vector3();
  private safeTimer = 0;
  private falling = false;
  /** The Black Sun phase dims the world; the ending brings the morning back (0 dark .. 1 day). */
  private darkTarget = 0;
  private dark = 0;

  async load(checkpoint?: string): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    this.terrain = await buildTerrain(scene, 'eclipseGround', {
      origin: [-80, -40], size: [160, 270], density: 1.2, splatDensity: 3,
      height: (x, z) => this.height(x, z),
      splat: (x, z, _h, slope) => {
        const paved = 1 - smooth(26, 30, Math.abs(x) + (fbm(x * 0.3, z * 0.3) - 0.5) * 2);
        const walk = 1 - smooth(4.5, 6, Math.abs(x));
        const cliff = smooth(0.3, 0.5, slope);
        return [paved * (1 - walk) + 0.05, walk * paved, (1 - paved) * 0.6, Math.max(cliff, (1 - paved) * 0.6)];
      },
    }, ['sun_white_blocks', 'sun_marble_tiles', 'sun_granite', 'sun_marble_cliff'], [2.6, 2.4, 3, 6], { heightBlend: 0.5, macro: 0.4 });
    this.own(this.terrain.mesh);
    this.own(this.terrain.material);
    g.lighting.addStatic(this.terrain.mesh, false);
    this.kit = new EnvKit(scene, g.assets, g.mats, g.lighting, 'env/sun', this.scope);
    await this.kit.placeAll(this.layout());
    const col = this.kit.finish();
    this.own(this.kit);
    g.physics.addStaticMesh(this.terrain.mesh);
    if (col) g.physics.addStaticMesh(col);
    g.nav = await Navigation.build(col ? [this.terrain.mesh, col] : [this.terrain.mesh]);
    const sea = this.own(buildCloudSea(scene, [0, 90], SEA_Y, 1500, 16));
    this.own(sea.material!);
    g.lighting.addStatic(sea, false);

    // sun-bowls burning on the terraces
    const fire = (at: Vector3, k = 1) => {
      this.fx.push(g.vfx.attach('brazier', at, 1.3 * k));
      const l = g.lights.add(at.add(new Vector3(0, 0.6, 0)), { color: [1, 0.72, 0.38], intensity: 34 * k, range: 10 * k, flicker: 0.4, speed: 1 });
      if (l) this.lamps.push(l);
      this.loops.push(g.audio.loop('fire_loop', at, 0.4));
    };
    for (const [x, z] of this.braziers()) fire(new Vector3(x, this.height(x, z) + 2.2, z));
    this.motes = g.vfx.attach('sunMotes', new Vector3(0, 2, 0));

    this.encounters = new Encounters(g.enemies);
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z), z);
    this.encounters.add({ id: 'court', at: at(0, 40), spawnRange: 30, spawns: [
      { id: 'sentinel', at: at(-3, 44), yaw: Math.PI }, { id: 'sentinel', at: at(3, 47), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'procession', at: at(0, 96), spawnRange: 30, onClear: () => g.flow.checkpoint(this.id, 'terrace', 'procession'), spawns: [
      { id: 'sentinel', at: at(-2, 92), yaw: Math.PI }, { id: 'priest', at: at(-7, 104), yaw: Math.PI }, { id: 'priest', at: at(7, 106), yaw: Math.PI },
      { id: 'sentinel', at: at(3, 100), patrol: [at(-4, 100), at(4, 100)] },
    ] });
    this.encounters.add({ id: 'approach', at: at(0, 140), spawnRange: 26, onClear: () => g.flow.checkpoint(this.id, 'summit', 'approach'), spawns: [
      { id: 'sentinel', at: at(-3, 138), yaw: Math.PI }, { id: 'sentinel', at: at(3, 141), yaw: Math.PI },
      { id: 'priest', at: at(-8, 147), yaw: Math.PI }, { id: 'priest', at: at(8, 147), yaw: Math.PI },
    ] });
    const order = ['court', 'procession', 'approach'];
    const upTo: Record<string, number> = { terrace: 2, summit: 3 };
    for (const id of order.slice(0, upTo[checkpoint ?? ''] ?? 0)) this.encounters.skip(id);
    if (checkpoint === 'terrace') ['terrace', 'procession'].forEach((b) => this.beats.add(b));
    if (checkpoint === 'summit') ['terrace', 'procession', 'summit'].forEach((b) => this.beats.add(b));
  }

  /** Terraces stepped up the summit, a broad walk down the middle, marble cliffs falling away. */
  height(x: number, z: number): number {
    let base: number;
    if (z < T1.z1) base = T1.y;
    else if (z < T2.z0) base = T1.y + (T2.y - T1.y) * smooth(T2.z0 - 1.6, T2.z0, z);
    else if (z < T2.z1) base = T2.y;
    else if (z < T3.z0) base = T2.y + (T3.y - T2.y) * smooth(T3.z0 - 1.6, T3.z0, z);
    else if (z < T3.z1) base = T3.y;
    else base = T3.y + (DAIS.y - T3.y) * smooth(T3.z1 + STAIR_RUN - 1.6, T3.z1 + STAIR_RUN, z);
    // the summit falls away either side and behind
    const edge = smooth(30, 44, Math.abs(x) + (fbm(x * 0.05, z * 0.05) - 0.5) * 10);
    const back = smooth(-12, -34, z);
    const drop = Math.max(edge, back) * (40 + 14 * fbm(x * 0.03, z * 0.03));
    const crag = edge * (fbm(x * 0.12, z * 0.12) - 0.5) * 6;
    return base - drop + crag;
  }

  private braziers(): [number, number][] {
    return [[-5.5, 26], [5.5, 26], [-5.5, 54], [5.5, 54], [-5.5, 80], [5.5, 80], [-5.5, 112], [5.5, 112], [-5.5, 132], [5.5, 132], [-6, 148], [6, 148]];
  }

  private layout(): Placement[] {
    const P: Placement[] = [];
    const put = (piece: string, x: number, z: number, yaw = 0, scale = 1, dy = 0) => P.push({ piece, position: new Vector3(x, this.height(x, z) + dy, z), yaw, scale });
    const putY = (piece: string, x: number, y: number, z: number, yaw = 0, scale = 1) => P.push({ piece, position: new Vector3(x, y, z), yaw, scale });
    // ------------------------------------------------ terrace one: the gate and the court of mirrors
    put('gate', 0, 18, 0);
    for (const z of [34, 50]) {
      put('colonnade', -11, z, Math.PI / 2);
      put('colonnade', 11, z, Math.PI / 2);
    }
    for (const [x, z] of this.braziers()) put('brazier', x, z);
    put('mirror', -8, 42, Math.PI / 2 + 0.3);
    put('mirror', 8, 42, -Math.PI / 2 - 0.3);
    put('obelisk', -18, 8, 0.2);
    put('obelisk', 18, 8, -0.2);
    put('pillar_broken', -14, 58, 0.8);
    for (const x of [-20, -8, 8, 20]) put('wall', x, T1.z1 + 1.0, 0);
    // ------------------------------------------------ the stairs and terrace two: the processional of the five
    putY('stairs', 0, T1.y, T1.z1, Math.PI);
    for (const x of [-22, -10, 10, 22]) put('wall', x, T2.z1 + 1.0, 0);
    const statues: [number, number, number][] = [[-7, 86, Math.PI / 2], [7, 86, -Math.PI / 2], [-7, 98, Math.PI / 2], [7, 98, -Math.PI / 2], [0, 113, Math.PI]];
    for (const [x, z, yaw] of statues) put('statue_pentarch', x, z, yaw, 1.15);
    put('obelisk', -16, 92, 0.4);
    put('obelisk', 16, 92, -0.4);
    put('mirror', -12, 106, Math.PI / 2);
    put('mirror', 12, 106, -Math.PI / 2);
    put('pillar_broken', 15, 80, 2.2);
    put('plinth_block', -15, 112, 0.0);
    // ------------------------------------------------ terrace three: the last approach
    putY('stairs', 0, T2.y, T2.z1, Math.PI);
    put('colonnade', -11, 138, Math.PI / 2);
    put('colonnade', 11, 138, Math.PI / 2);
    put('plinth_block', -16, 146, 0.3);
    put('plinth_block', 16, 146, -0.3);
    putY('stairs', 0, T3.y, T3.z1, Math.PI);
    // ------------------------------------------------ the Eclipse Dais and its ring
    put('dais', DAIS.x, DAIS.z, Math.PI);
    putY('halo', DAIS.x, DAIS.y + 26, DAIS.z, 0.2);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      if (Math.cos(a) < -0.8) continue;
      putY('obelisk', DAIS.x + Math.sin(a) * (DAIS_R + 2.6), DAIS.y - 3, DAIS.z + Math.cos(a) * (DAIS_R + 2.6), a, 1.1);
    }
    // gold shards drifting round the summit
    for (let i = 0; i < 22; i++) {
      const s = Math.sin(i * 91.7) * 43758.5453;
      const r = s - Math.floor(s);
      const side = i % 2 ? 1 : -1;
      putY('shards', side * (36 + r * 60), -10 + ((i * 37) % 50), -10 + ((i * 53) % 220), r * 6, 0.8 + r * 1.8);
    }
    return P;
  }

  spawn(checkpoint?: string): { position: Vector3; yaw: number } {
    const at = (x: number, z: number) => new Vector3(x, this.height(x, z) + 0.05, z);
    switch (checkpoint) {
      case 'terrace': return { position: at(0, 78), yaw: 0 };
      case 'summit': return { position: at(0, 130), yaw: 0 };
      case 'title': return { position: at(0, -6), yaw: 0 };
      default: return { position: at(0, -4), yaw: 0 };
    }
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        // the black sun hangs ahead over the summit: a cold rim of corona light, gold bounce off marble
        // (azimuth 0 is +Z, the way the climb faces: every story camera looks up the terraces at it)
        sunColor: new Color3(1.0, 0.72, 0.45), sunIntensity: 2.6, sunElevation: 0.3, sunAzimuth: 0,
        skyFill: new Color3(0.42, 0.38, 0.56), groundFill: new Color3(0.42, 0.36, 0.3), fillIntensity: 0.22,
        environmentIntensity: 0.95, exposure: 1.0, contrast: 1.14, shadowDarkness: 0.08,
      },
      sky: {
        zenith: new Color3(0.06, 0.05, 0.12), horizon: new Color3(0.78, 0.5, 0.38), ground: new Color3(0.5, 0.45, 0.45),
        gradient: 0.5, sunColor: new Color3(1.0, 0.7, 0.4), sunSize: 0.085, sunIntensity: 10, eclipse: 0.94, coronaColor: new Color3(1.0, 0.78, 0.45),
        cloudCover: 0.45, cloudDensity: 1.0, cloudColor: new Color3(0.7, 0.55, 0.5), cloudShadow: new Color3(0.15, 0.1, 0.14),
        horizonGlow: new Color3(0.7, 0.35, 0.2), stars: 0.4,
      },
      look: {
        fog: { color: new Color3(0.5, 0.42, 0.42), density: 0.0012, heightFalloff: 0.015, sunScatter: 1.0, skyAmount: 0.3, volumeDensity: 0.004,
          volumeColor: new Color3(0.75, 0.62, 0.55), volumeHeight: 8, maxDistance: 120, shaftDensity: 0.005 },
        grade: {
          temperature: 0.12, tint: 0.03, slope: [1.04, 1.0, 0.96], offset: [0.002, 0, -0.002], power: [1, 1, 1.02],
          contrast: 1.16, saturation: 1.0, shadowSaturation: 0.85, highlightSaturation: 1.08,
          shadowTint: [0.0, -0.005, 0.02], highlightTint: [0.04, 0.015, -0.03], splitBalance: 0.5, gain: 1,
        },
        exposure: { compensation: -0.4 },
      },
      weather: { wetness: 0, cover: 0, wind: 0.4, windDir: [0.2, 1] },
      music: 'eclipse',
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

  override surface(): 'stone' | 'ash' | 'wood' | 'water' {
    return 'stone';
  }

  override update(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.motes?.move(p.position.add(new Vector3(0, 2, 0)));
    this.encounters.update(p.position);
    this.falls(dt);
    this.light(dt);
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
      beat('terrace', z > 22, () => terraceArrival(g.cine));
      beat('procession', z > 80, () => processionArrival(g.cine));
      beat('summit', z > T3.z1 + 2, () => summitArrival(g.cine));
    }
    if (!this.bossStarted && Vector3.Distance(new Vector3(p.position.x, 0, p.position.z), new Vector3(DAIS.x, 0, DAIS.z)) < DAIS_R - 6) void this.startBoss();
  }

  /** The Black Sun phase darkens the summit; eased so it never snaps. */
  private light(dt: number): void {
    const g = this.game;
    if (Math.abs(this.dark - this.darkTarget) < 1e-3) return;
    this.dark += (this.darkTarget - this.dark) * Math.min(1, dt * 0.8);
    const k = this.dark;
    g.sky.set({ eclipse: 0.94 + 0.06 * k, sunIntensity: 10 * (1 - 0.6 * k) });
    g.lighting.sun.intensity = 2.6 * (1 - 0.7 * k);
  }

  /** Off the summit's edge: Kael is returned to the terrace (a little hurt). */
  private falls(dt: number): void {
    const g = this.game;
    const p = g.player!;
    this.safeTimer -= dt;
    if (p.grounded && this.safeTimer <= 0 && !this.falling) {
      this.safe.copyFrom(p.position);
      this.safeTimer = 0.4;
    }
    if (this.falling || !p.alive || p.position.y > this.safe.y - 12) return;
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
    const at = new Vector3(DAIS.x, DAIS.y, DAIS.z + 6);
    const b = await g.enemies.spawnBoss(AURELION, at, Math.PI);
    this.boss = b;
    this.bossKey = g.lights.add(at.add(new Vector3(0, 8, -3)), { color: [1, 0.85, 0.6], intensity: 55, range: 18 });
    b.dormant = true;
    void g.audio.music('aurelion');
    if (!g.params.has('nointro')) await g.cine.play((d) => bossIntro(d, g, b));
    b.dormant = false;
    g.audio.play('banner_boom');
    g.hud.showBanner('Aurelion', 'The Sun Swallowed');
    g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
    const p = g.player;
    if (p) b.alert(b.position, p);
    b.onPhase = (i) => {
      void g.cine.barks(PHASE_LINES[i] ?? []);
      if (i === 2) this.darkTarget = 1;
    };
    b.spawnAdds = (from, n) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const spot = new Vector3(from.x + Math.sin(a) * 7, DAIS.y, from.z + Math.cos(a) * 7);
        g.vfx.burst('sunPillar', spot, Vector3.Up(), 0.8);
        void g.enemies.spawn(i % 3 === 2 ? 'priest' : 'sentinel', spot, { aggro: true });
      }
    };
    b.events.on('died', () => {
      g.hud.showBoss(null);
      if (this.bossKey) g.lights.remove(this.bossKey);
      this.bossKey = null;
      g.hazards.after(2.4, () => void g.cine.play((d) => bossDeath(d, g, b)).then(() => {
        g.flow.claimSpark('aurelion');
        g.flow.checkpoint(this.id, 'summit', 'aurelion');
        void g.audio.music('ending');
        return g.cine.play((d) => ending(d, g));
      }).then(() => g.flow.chapterComplete(this.id)));
    });
    g.hazards.after(3.5, () => g.hud.showBanner(null));
  }

  override dispose(): void {
    for (const f of this.fx) f.stop();
    this.motes?.stop();
    for (const l of this.lamps) this.game.lights.remove(l);
    if (this.bossKey) this.game.lights.remove(this.bossKey);
    for (const l of this.loops) l.stop(1);
    super.dispose();
  }
}
