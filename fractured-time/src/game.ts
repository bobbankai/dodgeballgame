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
import { loadLevel, addCharacterLights, captureProbe } from '@/world/level';
import { loadGLTF } from '@/assets/loader';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
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
  /** test hook: use the nearest interactable this tick */
  forceInteract = false;
  private playerSlowUntil = 0;
  slowPlayer(seconds: number): void { this.playerSlowUntil = this.time + seconds; this.post.u.slow.value = 0.6; }
  chapter: { tick(dt: number): void } | null = null;
  startScript: (() => Promise<void>) | null = null;

  private timers: { at: number; resolve: () => void }[] = [];

  /** Resolve after `seconds` of game time (scripts run on game time so tests and pauses stay deterministic). */
  wait(seconds: number): Promise<void> {
    return new Promise((resolve) => this.timers.push({ at: this.time + seconds, resolve }));
  }

  setCheckpoint(pos: THREE.Vector3, yaw: number): void {
    this.lastCheckpoint.pos.copy(pos);
    this.lastCheckpoint.yaw = yaw;
  }
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

    const qsp = new URLSearchParams(location.search);
    const chapterN = qsp.get('chapter');
    const levelPath = qsp.get('level');
    if (chapterN) {
      (THREE as any).RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
      const { ChapterRuntime } = await import('@/chapters/runtime');
      const { CH1_SECTIONS, chapter1 } = await import('@/chapters/ch1');
      const ch = new ChapterRuntime(g);
      g.chapter = ch;
      for (const path of CH1_SECTIONS) await ch.loadSection(path);
      const sp = ch.markers.find((m) => m.name === 'spawn');
      g.level = { spawn: sp ? sp.pos.clone() : new THREE.Vector3(), yaw: sp ? sp.yaw : 0, enemies: [], objective: '' };
      g.scene.background = new THREE.Color(0x000000);
      ch.stream(g.level.spawn);
      g.startScript = () => chapter1(g, ch);
    } else if (levelPath) {
      // a baked level section: static surfaces lit by their lightmap, characters by real-time copies of the lights + a probe
      (THREE as any).RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
      // real-time copies of the baked lights (characters: full; static surfaces: specular only), created before materials compile
      const pre = await loadGLTF(`environments/${levelPath}.glb`);
      const lightMarkers: { name: string; pos: THREE.Vector3; yaw: number; data: Record<string, unknown> }[] = [];
      pre.scene.updateMatrixWorld(true);
      pre.scene.traverse((o) => { if (o.userData?.marker === 'light') lightMarkers.push({ name: 'light', pos: o.getWorldPosition(new THREE.Vector3()), yaw: 0, data: o.userData }); });
      const rt = addCharacterLights(lightMarkers, g.scene);
      const lv = await loadLevel(`environments/${levelPath}.glb`, g.physics, g.scene, rt);
      const sp = lv.markers.find((m) => m.name === 'spawn');
      g.level = { spawn: sp ? sp.pos.clone() : new THREE.Vector3(), yaw: sp ? sp.yaw : 0, enemies: [], objective: '' };
      g.scene.background = new THREE.Color(0x000000);
      g.scene.environment = captureProbe(g.gfx.renderer, g.scene, g.level.spawn.clone().setY(1.6));
      g.scene.environmentIntensity = 1.0;
    } else {
      g.level = await buildArena(g);
    }
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
    this.chapter?.tick(dt);

    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.resolve();
    }
    this.vfx.step(dt * (timeScale.world * 0.5 + 0.5));
    if (!this.player.alive && this.player.stateT > 2.4) this.respawn();
  }

  private updateTimeScales(dt: number): void {
    const opening = this.player.openingActive ? 0.16 : 1;
    const target = this.temporal.worldScaleTarget() * opening;
    timeScale.world += (target - timeScale.world) * Math.min(1, dt * (target < timeScale.world ? 22 : 7));
    timeScale.player = this.time < this.playerSlowUntil ? 0.55 : 1;
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
    // test override: ?cam=x,y,z,yawDeg,pitchDeg,fovDeg (three space) to match a Cycles reference camera exactly
    const co = this.testMode ? new URLSearchParams(location.search).get('cam') : null;
    if (co) {
      const [x, y, z, yaw, pitch, fov] = co.split(',').map(Number);
      const c = this.camera.camera;
      c.position.set(x, y, z);
      c.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
      c.fov = fov;
      c.updateProjectionMatrix();
    }
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
    this.runScript();
  }

  /** Start the chapter script once (test mode starts it explicitly after setting up scripted controls). */
  runScript(): void {
    if (!this.startScript) return;
    const s = this.startScript;
    this.startScript = null;
    s().catch((e) => console.error('[chapter]', e));
  }

  /** Test helper: advance n ticks then render one frame. */
  step(n = 1): void {
    this.loop.step(n);
    this.frame(1, STEP);
  }
}
