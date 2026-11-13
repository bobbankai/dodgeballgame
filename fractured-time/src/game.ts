import * as THREE from 'three/webgpu';
import { createGfx, type Gfx } from '@/rendering/gfx';
import { PostFX } from '@/rendering/postfx';
import { Vfx } from '@/rendering/vfx';
import { QUALITY, detectQuality, type QualityName } from '@/rendering/quality';
import { Physics } from '@/physics/physics';
import { Input } from '@/input/input';
import { CameraRig } from '@/camera/rig';
import { GameLoop, STEP, timeScale, type Simulation } from '@/core/loop';
import { Player } from '@/player/player';
import { LiveControls, type Controls } from '@/player/controls';
import { Enemy, ENEMIES } from '@/ai/enemy';
import { Sfx } from '@/audio/sfx';
import { Hud } from '@/ui/hud';
import type { Actor } from '@/gameplay/actor';
import type { GameCtx } from '@/gameplay/ctx';
import { hostileTo } from '@/combat/strike';
import { bus } from '@/core/events';
import { buildArena } from '@/world/arena';
import { Temporal } from '@/temporal/temporal';

export interface SpawnDef {
  def: string;
  pos: THREE.Vector3;
  yaw?: number;
  patrol?: THREE.Vector3[];
}

export interface LevelBuild {
  spawn: THREE.Vector3;
  yaw: number;
  enemies: SpawnDef[];
  objective?: string;
}

/**
 * The game: owns every system and implements the services (GameCtx) the actors use. Per fixed tick: input, player, enemies, temporal
 * systems, physics, effects. Per rendered frame: interpolate, camera, post uniforms, HUD, render.
 */
export class Game implements Simulation, GameCtx {
  gfx!: Gfx;
  physics!: Physics;
  scene = new THREE.Scene();
  input!: Input;
  camera!: CameraRig;
  post!: PostFX;
  vfx = new Vfx();
  fx = this.vfx;
  sfx = new Sfx();
  hud = new Hud();
  loop!: GameLoop;
  player!: Player;
  enemies: Actor[] = [];
  flags = new Map<string, unknown>();
  get echoes(): Actor[] { return this.temporal ? this.temporal.echoes.map((e) => e.actor) : []; }
  time = 0;
  controls!: Controls;
  live!: LiveControls;
  temporal!: Temporal;
  level!: LevelBuild;
  paused = false;
  testMode = false;
  private tokensHeld = new Set<Actor>();
  private lastCheckpoint = { pos: new THREE.Vector3(), yaw: 0 };
  private resizeObs: (() => void) | null = null;

  tokens = {
    request: (a: Actor): boolean => {
      if (this.tokensHeld.has(a)) return true;
      const alive = this.enemies.filter((e) => e.alive).length;
      const max = alive >= 5 ? 3 : 2;
      if (this.tokensHeld.size >= max) return false;
      this.tokensHeld.add(a);
      return true;
    },
    release: (a: Actor): void => { this.tokensHeld.delete(a); },
  };

  static async create(canvas: HTMLCanvasElement, opts: { quality?: QualityName; test?: boolean } = {}): Promise<Game> {
    const g = new Game();
    g.testMode = !!opts.test;
    const q = opts.quality ?? detectQuality();
    g.gfx = await createGfx(canvas, q);
    g.physics = await Physics.create();
    g.input = new Input(canvas);
    g.camera = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight), g.physics);
    g.live = new LiveControls(g.input, g.camera);
    g.controls = g.live;
    g.scene.add(g.vfx.group);
    g.vfx.density = QUALITY[q].particles;
    g.temporal = new Temporal(g);

    g.level = await buildArena(g);
    g.post = new PostFX(g.gfx, g.scene, g.camera.camera, QUALITY[q]);
    g.player = await Player.create(g, g.live, g.level.spawn, g.level.yaw);
    g.player.onAbility = (name) => g.temporal.activate(name);
    g.scene.add(g.player.root);
    g.camera.reset(g.level.yaw, g.level.spawn);
    g.lastCheckpoint.pos.copy(g.level.spawn); g.lastCheckpoint.yaw = g.level.yaw;
    if (!new URLSearchParams(location.search).has('noenemies')) for (const s of g.level.enemies) await g.spawnEnemy(s);
    g.hud.setObjective(g.level.objective ?? '');
    g.loop = new GameLoop(g);
    g.onResize();
    addEventListener('resize', () => g.onResize());
    bus.on('checkpoint', () => { g.lastCheckpoint.pos.copy(g.player.pos); g.lastCheckpoint.yaw = g.player.yaw; });
    return g;
  }

  async spawnEnemy(s: SpawnDef): Promise<Enemy> {
    const def = ENEMIES[s.def];
    const e = await Enemy.create(this, def, s.pos, s.yaw ?? 0);
    if (s.patrol) e.patrol = s.patrol;
    this.enemies.push(e);
    this.scene.add(e.root);
    return e;
  }

  setQuality(name: QualityName): void {
    this.gfx.setQuality(name);
    this.post.build(QUALITY[name]);
    this.vfx.density = QUALITY[name].particles;
  }

  private onResize(): void {
    const w = this.gfx.canvas.clientWidth || innerWidth, h = this.gfx.canvas.clientHeight || innerHeight;
    this.camera.resize(w / Math.max(1, h));
    this.gfx.resize();
  }

  // --- GameCtx services ----------------------------------------------------------------------------------------

  findTarget(from: THREE.Vector3, facing: THREE.Vector3, range: number, cone: number, exclude: Actor | null = null): Actor | null {
    let best: Actor | null = null;
    let bestScore = Infinity;
    const f = facing.clone().setY(0);
    if (f.lengthSq() > 1e-6) f.normalize();
    for (const e of this.enemies) {
      if (!e.alive || e === exclude || !hostileTo(this.player, e)) continue;
      const dx = e.pos.x - from.x, dz = e.pos.z - from.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      const ang = dist > 1e-4 ? Math.acos(THREE.MathUtils.clamp((dx * f.x + dz * f.z) / dist, -1, 1)) : 0;
      if (ang > cone / 2) continue;
      const score = dist + ang * 2.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    if (len < 0.01) return true;
    d.divideScalar(len);
    const hit = this.physics.raycast(a, d, len, 1 /* STATIC */);
    return hit === null;
  }

  // --- simulation ----------------------------------------------------------------------------------------------

  tick(dt: number): void {
    if (this.paused) return;
    this.time += dt;
    this.input.now = this.time;
    this.input.poll(dt);
    if (this.input.justPressed('pause')) { this.input.takePressed(); }

    this.updateTimeScales(dt);
    const rewinding = this.temporal.tick(dt);
    if (!rewinding) {
      this.player.tick(dt);
      this.temporal.tickEcho(dt);
      for (const e of this.enemies) e.tick(dt);
      this.enemies = this.enemies.filter((e) => {
        const en = e as Enemy;
        if (en.isCorpseExpired) { en.dispose(); return false; }
        return true;
      });
      this.physics.step();
      this.physics.updateSensors(this.player.pos);
      this.temporal.record(dt);
    }
    this.vfx.step(dt * (timeScale.world * 0.5 + 0.5));
    if (!this.player.alive && this.player.stateT > 2.4) this.respawn();
  }

  private updateTimeScales(dt: number): void {
    const opening = this.player.openingActive ? 0.16 : 1;
    const target = this.temporal.worldScaleTarget() * opening;
    timeScale.world += (target - timeScale.world) * Math.min(1, dt * (target < timeScale.world ? 22 : 7));
    timeScale.player = 1;
  }

  respawn(): void {
    this.player.respawn(this.lastCheckpoint.pos, this.lastCheckpoint.yaw);
    this.camera.reset(this.lastCheckpoint.yaw, this.lastCheckpoint.pos);
    this.post.u.hurt.value = 0;
  }

  frame(alpha: number, realDt: number): void {
    this.player.syncVisual(alpha);
    for (const e of this.enemies) e.syncVisual(alpha);
    this.temporal.syncVisual(alpha);
    const feet = new THREE.Vector3().lerpVectors(this.player.prev, this.player.pos, alpha);
    const look = this.input.takeLook();
    this.camera.lock = this.player.lockTarget;
    this.camera.update(realDt, feet, this.player.yaw, look, { sprinting: this.player.speed > 5.6 });
    // post uniforms: transient effects decay
    const u = this.post.u;
    u.flash.value = Math.max(0, u.flash.value - realDt * 3.5);
    u.hurt.value = Math.max(0, u.hurt.value - realDt * 1.1);
    const toCam = this.camera.camera.position.distanceTo(this.player.pos);
    const tgt = this.player.lockTarget ? this.camera.camera.position.distanceTo(this.player.lockTarget.pos) : toCam;
    u.focus.value += (Math.min(tgt, toCam + 3) - u.focus.value) * Math.min(1, realDt * 6);
    this.temporal.updateLook(realDt);
    this.vfx.update(this.camera.camera);
    const boss = this.enemies.find((e) => (e as Enemy).def.id.startsWith('boss')) as Enemy | undefined;
    this.hud.setBoss(boss ?? null);
    this.hud.update(realDt, this.player, this.camera.camera, innerWidth, innerHeight, this.temporal.readiness());
    if (this.testMode) this.hud.setDebug(`${this.gfx.backend}  state ${this.player.state}  ${this.player.anim.current}\nfps ${this.loop?.fps.toFixed(0)}  worldscale ${timeScale.world.toFixed(2)}`);
    this.post.render();
  }

  start(): void {
    this.loop.start();
  }

  /** Test helper: advance n ticks then render one frame. */
  step(n = 1): void {
    this.loop.step(n);
    this.frame(1, STEP);
  }
}
