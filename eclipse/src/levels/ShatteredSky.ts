import { Color3, Vector3, type Light, type Mesh } from '@babylonjs/core';
import { Level, type Atmos } from '../world/Level';
import { EnvKit, type Placement } from '../world/EnvKit';
import { Encounters } from '../world/Encounters';
import { Navigation } from '../ai/Navigation';
import { buildCloudSea } from '../world/CloudSea';
import { VAELTRIS } from '../ai/bosses/Vaeltris';
import type { Boss } from '../ai/Boss';
import type { FxHandle } from '../vfx/Vfx';
import type { LoopHandle } from '../audio/Audio';
import {
  opening, courtArrival, ruinsArrival, stonesArrival, crownArrival, bossIntro, bossDeath, PHASE_LINES,
} from '../story/chapter3';

/** Island centres and the heights of their walkable tops. */
const S = new Vector3(0, 0, 0);
const A = new Vector3(0, 0, 26.5);
const C = new Vector3(0, 4, 48);
const D = new Vector3(0, 4, 74.5);
const STONES = [new Vector3(1.5, 4, 86), new Vector3(-1.5, 4, 92.5), new Vector3(1, 4, 99)];
const E = new Vector3(0, 4, 119.5);
const CROWN = new Vector3(0, 8, 148.5);
const CROWN_R = 22;
const SEA_Y = -55;

/**
 * Chapter Three: the Shattered Sky. Aethel Spire, the storm-monastery, was torn into islands when
 * Vaeltris went mad; they hang over a sea of cloud under the eclipse. Rope bridges, stairs and
 * stepping stones climb from the wayside shrine through the monastery court and the ruined cloister
 * to the Stormcrown, where the goddess waits. Falling is not death by design: the wind returns
 * Kael to the last stone he stood on (a little hurt).
 */
export class ShatteredSky extends Level {
  readonly id = 'sky';
  readonly title = 'The Shattered Sky';
  private kit!: EnvKit;
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
  private stormTimer = 3;

  async load(checkpoint?: string): Promise<void> {
    const g = this.game;
    const scene = g.scene;
    this.kit = new EnvKit(scene, g.assets, g.mats, g.lighting, 'env/sky', this.scope);
    await this.kit.placeAll(this.layout());
    const col = this.kit.finish();
    this.own(this.kit);
    if (col) g.physics.addStaticMesh(col);
    g.nav = await Navigation.build(col ? [col] : []);
    const sea: Mesh = this.own(buildCloudSea(scene, [0, 80], SEA_Y, 1400));
    this.own(sea.material!);
    g.lighting.addStatic(sea, false);

    // shrine fires and lanterns: warm points against the cold storm light
    const fire = (at: Vector3, k = 1) => {
      this.fx.push(g.vfx.attach('brazier', at, k));
      const l = g.lights.add(at.add(new Vector3(0, 0.5, 0)), { color: [1, 0.55, 0.22], intensity: 26 * k, range: 8 * k, flicker: 0.5, speed: 1 });
      if (l) this.lamps.push(l);
      this.loops.push(g.audio.loop('fire_loop', at, 0.45));
    };
    for (const [p, yaw] of this.shrines()) {
      const off = new Vector3(Math.sin(yaw) * 0.4, 1.62, Math.cos(yaw) * 0.4);
      fire(p.add(off), 0.8);
    }
    this.motes = g.vfx.attach('stormMotes', S.clone());

    // fights
    this.encounters = new Encounters(g.enemies);
    const on = (c: Vector3, x: number, z: number) => new Vector3(c.x + x, c.y, c.z + z);
    this.encounters.add({ id: 'court', at: A, spawnRange: 30, spawns: [
      { id: 'monk', at: on(A, 2, 3), yaw: Math.PI }, { id: 'monk', at: on(A, -3, 6), yaw: Math.PI },
      { id: 'warden', at: on(A, 3, 9), yaw: Math.PI },
    ] });
    this.encounters.add({ id: 'ruins', at: D, spawnRange: 30, onClear: () => g.flow.checkpoint(this.id, 'ruins', 'ruins'), spawns: [
      { id: 'monk', at: on(D, -3, -1), yaw: Math.PI }, { id: 'monk', at: on(D, 3, 1), yaw: Math.PI },
      { id: 'warden', at: on(D, -4, 7), yaw: Math.PI }, { id: 'warden', at: on(D, 5, 8), yaw: Math.PI },
      { id: 'monk', at: on(D, 0, 4), patrol: [on(D, -4, 4), on(D, 4, 4)] },
    ] });
    this.encounters.add({ id: 'stones', at: STONES[1], spawnRange: 26, spawns: [{ id: 'warden', at: STONES[2].clone(), yaw: Math.PI }] });
    this.encounters.add({ id: 'gate', at: E, spawnRange: 24, onClear: () => g.flow.checkpoint(this.id, 'crown', 'gate'), spawns: [
      { id: 'monk', at: on(E, -2, 2), yaw: Math.PI }, { id: 'monk', at: on(E, 2.5, 3), yaw: Math.PI },
    ] });
    const order = ['court', 'ruins', 'stones', 'gate'];
    const upTo: Record<string, number> = { ruins: 2, crown: 4 };
    for (const id of order.slice(0, upTo[checkpoint ?? ''] ?? 0)) this.encounters.skip(id);
    if (checkpoint === 'ruins') ['court', 'ruins'].forEach((b) => this.beats.add(b));
    if (checkpoint === 'crown') ['court', 'ruins', 'stones'].forEach((b) => this.beats.add(b));
  }

  /** Shrines (position, facing): checkpoints and their fire bowls. */
  private shrines(): [Vector3, number][] {
    return [[new Vector3(3.5, 0, 2.5), -Math.PI / 2], [new Vector3(5.5, 4, 70), -Math.PI / 2], [new Vector3(-4, 4, 117), Math.PI / 2]];
  }

  private layout(): Placement[] {
    const P: Placement[] = [];
    const put = (piece: string, p: Vector3, yaw = 0, scale = 1) => P.push({ piece, position: p.clone(), yaw, scale });
    const at = (c: Vector3, x: number, z: number, dy = 0) => new Vector3(c.x + x, c.y + dy, c.z + z);
    // the walk: islands, bridges, stairs and stepping stones
    put('island_b', S, 0.4);
    put('bridge', at(S, 0, 5.5), Math.PI);
    put('island_a', A, 1.3);
    put('stairs', at(A, 0, 8), Math.PI);
    put('island_b', C, 2.2);
    put('bridge', at(C, 0, 5.5), Math.PI);
    put('island_a', D, 4.1);
    STONES.forEach((p, i) => put('island_c', p, i * 2.1));
    put('bridge', at(STONES[2], 0, 3), Math.PI);
    put('island_b', E, 5.0);
    put('stairs', at(E, 0, 1), Math.PI);
    put('arena', CROWN, Math.PI);
    // the wayside shrine where Kael wakes
    for (const [p, yaw] of this.shrines()) put('shrine', p, yaw);
    put('pillar_flags', at(S, -4, -1), 0.6);
    // the monastery court: cloister, tower, bell
    put('cloister', at(A, -7.5, -1), Math.PI / 2);
    put('tower', at(A, 7.5, 4), -Math.PI / 2);
    put('bell', at(A, 5.5, -6), Math.PI / 2);
    put('pillar_flags', at(A, -5, 7), 2.4);
    put('wall_ruin', at(A, -6, 9.5), 0.3);
    // the ruined cloister on the second climb
    put('wall_ruin', at(C, -4.5, 2), Math.PI / 2 + 0.2);
    put('pillar_flags', at(C, 4, -1), 1.1);
    put('wall_ruin', at(D, -7, 2), Math.PI / 2);
    put('wall_ruin', at(D, 7.5, -4), -Math.PI / 2 + 0.2);
    put('spire', at(D, -6, 9));
    put('cloister', at(D, 7.5, 8), -Math.PI / 2);
    put('pillar_flags', at(E, 3.5, -2), 2.9);
    put('bell', at(E, 4.5, 3), -Math.PI / 2);
    // the Stormcrown: her statue at the far rim, lightning spires round it
    put('statue_vaeltris', at(CROWN, 0, 17), Math.PI, 1.2);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      put('spire', at(CROWN, Math.sin(a) * 23.5, Math.cos(a) * 23.5), a);
    }
    // the rest of the shattered monastery, out of reach
    put('island_a', new Vector3(-32, 7, 68), 2.0, 1.1);
    put('hall', new Vector3(-32, 7, 68), Math.PI / 2 + 0.3);
    put('island_a', new Vector3(-95, 18, 40), 0.7, 2.4);
    put('tower', new Vector3(-95, 18, 40), 0.2, 2.2);
    put('island_a', new Vector3(110, -4, 130), 2.6, 2.6);
    put('tower', new Vector3(104, -4, 126), 1.0, 2.4);
    put('hall', new Vector3(118, -4, 136), 2.2, 1.6);
    put('island_b', new Vector3(55, 22, 210), 0.3, 2.5);
    put('spire', new Vector3(55, 22, 210), 0, 2.4);
    put('island_a', new Vector3(-70, -12, 190), 1.7, 2.0);
    put('statue_vaeltris', new Vector3(-70, -12, 190), 1.0, 2.5);
    put('island_b', new Vector3(40, 10, 20), 4.0, 1.3);
    put('wall_ruin', new Vector3(40, 10, 20), 0.8, 1.2);
    // torn earth drifting round the path
    const rng = (i: number) => {
      const s = Math.sin(i * 91.7) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * (22 + rng(i) * 70);
      const z = -20 + rng(i + 50) * 220;
      const y = -18 + rng(i + 100) * 40;
      put(i % 3 ? 'debris_b' : 'debris_a', new Vector3(x, y, z), rng(i + 7) * 6, 0.7 + rng(i + 9) * 1.6);
    }
    return P;
  }

  spawn(checkpoint?: string): { position: Vector3; yaw: number } {
    switch (checkpoint) {
      case 'ruins': return { position: new Vector3(2, 4.05, 68), yaw: 0 };
      case 'crown': return { position: new Vector3(-1, 4.05, 114.5), yaw: 0 };
      case 'title': return { position: new Vector3(0, 0.05, -3), yaw: 0 };
      default: return { position: new Vector3(0, 0.05, -2.5), yaw: 0 };
    }
  }

  atmosphere(): Atmos {
    return {
      lighting: {
        // a low sun breaking in under the storm; the cloud sea below throws light back up
        sunColor: new Color3(1.0, 0.8, 0.6), sunIntensity: 3.4, sunElevation: 0.24, sunAzimuth: 1.15,
        skyFill: new Color3(0.45, 0.5, 0.68), groundFill: new Color3(0.42, 0.44, 0.52), fillIntensity: 0.18,
        environmentIntensity: 1.0, exposure: 1.0, contrast: 1.12, shadowDarkness: 0.08,
      },
      sky: {
        zenith: new Color3(0.1, 0.1, 0.2), horizon: new Color3(0.82, 0.6, 0.5), ground: new Color3(0.55, 0.57, 0.62),
        gradient: 0.5, sunColor: new Color3(1.0, 0.75, 0.55), sunIntensity: 14, eclipse: 0.82, coronaColor: new Color3(0.85, 0.75, 1.0),
        cloudCover: 0.74, cloudDensity: 1.35, cloudColor: new Color3(0.56, 0.55, 0.66), cloudShadow: new Color3(0.12, 0.12, 0.2),
        horizonGlow: new Color3(0.55, 0.32, 0.25),
      },
      look: {
        fog: { color: new Color3(0.52, 0.53, 0.64), density: 0.0011, heightFalloff: 0.015, sunScatter: 0.85, skyAmount: 0.3, volumeDensity: 0.004,
          volumeColor: new Color3(0.72, 0.72, 0.82), volumeHeight: 6, maxDistance: 120, shaftDensity: 0.004 },
        grade: {
          temperature: 0.05, tint: 0.04, slope: [1.02, 0.99, 1.0], offset: [0, -0.002, 0.004], power: [1, 1, 1],
          contrast: 1.14, saturation: 0.96, shadowSaturation: 0.85, highlightSaturation: 1.05,
          shadowTint: [0.0, -0.005, 0.02], highlightTint: [0.03, 0.01, -0.02], splitBalance: 0.5, gain: 1,
        },
        exposure: { compensation: -0.35 },
      },
      weather: { wetness: 0.15, cover: 0, wind: 0.85, windDir: [1, 0.25] },
      music: 'sky',
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
    // the rope bridges are wood; everything else here is stone or turf
    const onBridge = Math.abs(at.x) < 1.6 && [S.z + 5.5, C.z + 5.5, STONES[2].z + 3].some((z0) => at.z > z0 + 0.5 && at.z < z0 + 11.5);
    return onBridge ? 'wood' : 'stone';
  }

  override update(dt: number): void {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.motes?.move(p.position.add(new Vector3(0, 2, 0)));
    this.encounters.update(p.position);
    this.falls(dt);
    this.storm(dt);
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
      beat('court', z > A.z - 10, () => courtArrival(g.cine));
      beat('ruins', z > D.z - 10, () => ruinsArrival(g.cine));
      beat('stones', z > STONES[0].z - 4, () => stonesArrival(g.cine));
      beat('crown', z > E.z + 2, () => crownArrival(g.cine));
    }
    if (!this.bossStarted && Vector3.Distance(p.position, CROWN) < CROWN_R - 6) void this.startBoss();
  }

  /** Distant strikes on the far islands and in the cloud sea: a bolt, a flash, thunder a while later. */
  private storm(dt: number): void {
    const g = this.game;
    this.stormTimer -= dt;
    if (this.stormTimer > 0) return;
    this.stormTimer = 3 + Math.random() * 6;
    const a = Math.random() * Math.PI * 2;
    const r = 140 + Math.random() * 200;
    const at = new Vector3(Math.sin(a) * r, SEA_Y + 10 + Math.random() * 30, 80 + Math.cos(a) * r);
    g.lightning.strike(at, 90 + Math.random() * 60, true);
  }

  /** Falling off an island: the wind carries Kael back to firm stone. */
  private falls(dt: number): void {
    const g = this.game;
    const p = g.player!;
    this.safeTimer -= dt;
    if (p.grounded && this.safeTimer <= 0 && !this.falling) {
      this.safe.copyFrom(p.position);
      this.safeTimer = 0.4;
    }
    if (this.falling || !p.alive || p.position.y > this.safe.y - 14) return;
    this.falling = true;
    g.hud.fade(true);
    g.vfx.burst('gust', p.position, Vector3.Up(), 2);
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
    const at = new Vector3(CROWN.x, CROWN.y, CROWN.z + 6);
    const b = await g.enemies.spawnBoss(VAELTRIS, at, Math.PI);
    this.boss = b;
    this.bossKey = g.lights.add(at.add(new Vector3(0, 8, -3)), { color: [0.85, 0.85, 1], intensity: 50, range: 18 });
    b.dormant = true;
    void g.audio.music('vaeltris');
    if (!g.params.has('nointro')) await g.cine.play((d) => bossIntro(d, g, b));
    b.hidden = false;
    b.dormant = false;
    g.audio.play('banner_boom');
    g.hud.showBanner('Vaeltris', 'The Storm Unbound');
    g.hud.showBoss({ name: b.name, title: b.title, stats: b.stats, phases: b.phases });
    const p = g.player;
    if (p) b.alert(b.position, p);
    b.onPhase = (i) => void g.cine.barks(PHASE_LINES[i] ?? []);
    b.spawnAdds = (from, n) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const spot = new Vector3(from.x + Math.sin(a) * 7, CROWN.y, from.z + Math.cos(a) * 7);
        g.vfx.burst('lightningStrike', spot, Vector3.Up(), 0.8);
        void g.enemies.spawn(i % 3 === 2 ? 'warden' : 'monk', spot, { aggro: true });
      }
    };
    b.events.on('died', () => {
      g.hud.showBoss(null);
      void g.audio.music('sky');
      if (this.bossKey) g.lights.remove(this.bossKey);
      this.bossKey = null;
      g.hazards.after(2.4, () => void g.cine.play((d) => bossDeath(d, g, b)).then(() => {
        g.flow.claimSpark('vaeltris');
        g.flow.checkpoint(this.id, 'crown', 'vaeltris');
        g.flow.chapterComplete(this.id);
      }));
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
