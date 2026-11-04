// The game: owns every system and runs the frame.
import * as THREE from 'three';
import type { FXOptions } from '../render/MaterialFX';
import type { Pipeline } from '../render/Pipeline';
import { Input } from '../core/Input';
import { CameraRig, type Shot } from './CameraRig';
import { World, separate } from './World';
import { Player, ARTS } from './Player';
import { Enemy, type EnemyDef } from './Enemy';
import { Character, inferEmotion } from './Character';
import { TimeFX, type Combatant, type Hit, type HitResult } from './Combat';
import { SwordTrail } from '../render/Trails';
import { Particles, Weather } from '../render/Particles';
import { HUD } from '../ui/HUD';
import { Touch } from '../ui/Touch';
import { Audio } from '../audio/Audio';
import { G } from '../render/MaterialFX';
import type { LightSource } from '../render/Lighting';
import { Squad } from './AI';
import type { NPC } from './NPC';

export interface Level {
  id: string;
  chapter: number;
  title: string;
  load(game: Game): Promise<void>;
  /** run the level's story from a checkpoint */
  run(game: Game, checkpoint: string | null): Promise<void>;
  update?(dt: number): void;
  dispose?(): void;
  checkpoints: string[];
}

export interface SaveData { level: string; checkpoint: string | null; arts: number; heals: number; maxHp: number; time: number; difficulty: number }

const SAVE_KEY = 'emberfall.save';

export class Game {
  input: Input;
  cam: CameraRig;
  world = new World();
  player!: Player;
  enemies: Enemy[] = [];
  /** story characters of the current level */
  npcs: NPC[] = [];
  time = new TimeFX();
  trail = new SwordTrail();
  particles: Particles;
  weather = new Weather();
  hud: HUD;
  touch: Touch;
  audio = new Audio();
  level: Level | null = null;
  levelRoot = new THREE.Group();
  /** weather features every environment material of the current level gets (wet, snow) */
  envFx: FXOptions = {};
  paused = false;
  /** the level's music set: exploration, combat and boss cues (crossfaded by the fight state) */
  music: { explore: string; combat: string; boss?: string } | null = null;
  /** a scripted cue overrides the adaptive choice (cutscenes: 'sorrow', 'title'...) */
  musicOverride: string | null = null;
  private musicCalm = 0;
  private musicReq: string | null = null;
  /** called by a level when its chapter is finished (main.ts moves on to the next one) */
  onChapterComplete: ((id: string) => void) | null = null;
  readonly squad: Squad;
  difficultyDamage = 1;
  checkpoint: string | null = null;
  checkpointPos = new THREE.Vector3();
  checkpointYaw = 0;
  /** lights belonging to the level (cleared on unload) */
  levelLights: LightSource[] = [];
  interactables: { pos: THREE.Vector3; radius: number; label: string; on: () => void; enabled: boolean }[] = [];
  private respawning = false;
  playTime = 0;
  private lookTmp = new THREE.Vector2();
  onFrame: ((dt: number) => void)[] = [];
  /** cinematic: player input off, HUD hidden, letterbox */
  cinematic = false;
  readonly test: boolean;
  private timers: { t: number; res: () => void }[] = [];
  gameTime = 0;
  skipRequested = false;

  constructor(public pipe: Pipeline, canvas: HTMLCanvasElement, test = false) {
    this.test = test;
    this.input = new Input(canvas);
    this.cam = new CameraRig(pipe.camera, this.world);
    this.particles = new Particles(pipe.quality.particleScale);
    this.hud = new HUD();
    this.touch = new Touch(this.input);
    pipe.scene.add(this.trail.mesh, this.particles.group, this.weather.group, this.levelRoot);
    this.hud.artNames = ['Ember Whirl', 'Rising Flame', 'Cinder Burst'];
    this.squad = new Squad(this);
  }

  async createPlayer(): Promise<void> {
    const ch = await Character.load(this.pipe, { url: 'assets/chars/kaede.glb', weapon: 'katana', sheathed: true });
    this.pipe.scene.add(ch.root);
    this.player = new Player(ch, this);
  }

  // ------------------------------------------------------------------ level lifecycle
  async loadLevel(level: Level, checkpoint: string | null): Promise<void> {
    await this.hud.fade(1, 0.8);
    this.unloadLevel();
    this.level = level;
    this.checkpoint = checkpoint;
    await level.load(this);
    this.world.build();
    this.save();
    void level.run(this, checkpoint).catch((e) => console.error(e));
  }

  unloadLevel(): void {
    this.level?.dispose?.();
    for (const e of this.enemies) e.char.root.removeFromParent();
    this.enemies = [];
    for (const n of this.npcs) n.dispose();
    this.npcs = [];
    this.squad.reset();
    this.levelRoot.clear();
    this.envFx = {};
    this.pipe.haze.sources = [];
    for (const m of this.pipe.mirrors) m.dispose();
    this.pipe.mirrors = [];
    this.music = null;
    this.musicOverride = null;
    this.world.clear();
    this.particles.clearEmitters();
    for (const l of this.levelLights) this.pipe.lighting.remove(l);
    this.levelLights = [];
    this.interactables = [];
    this.weather.setRain(0);
    this.weather.setSnow(0);
    this.audio.stopAmbience();
    G.uWetness.value = 0;
    G.uRain.value = 0;
    G.uSnow.value = 0;
    this.hud.setBoss(null);
    this.hud.objective(null);
    this.hud.say(null, null);
    this.player?.revive();
    this.timers = [];
  }

  light(s: LightSource): LightSource {
    this.pipe.lighting.add(s);
    this.levelLights.push(s);
    return s;
  }

  setCheckpoint(id: string, pos: THREE.Vector3, yaw: number): void {
    this.checkpoint = id;
    this.checkpointPos.copy(pos);
    this.checkpointYaw = yaw;
    this.player.heals = this.player.maxHeals;
    this.save();
  }

  save(): void {
    if (!this.level) return;
    const d: SaveData = { level: this.level.id, checkpoint: this.checkpoint, arts: this.player?.artsUnlocked ?? 1, heals: this.player?.maxHeals ?? 3, maxHp: this.player?.maxHp ?? 100, time: this.playTime, difficulty: this.difficultyDamage };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch { /* storage blocked */ }
  }

  static loadSave(): SaveData | null {
    try {
      const s = localStorage.getItem(SAVE_KEY);
      return s ? (JSON.parse(s) as SaveData) : null;
    } catch { return null; }
  }

  // ------------------------------------------------------------------ enemies
  async spawn(def: EnemyDef, pos: THREE.Vector3, yaw = 0, opts: { aware?: boolean } = {}): Promise<Enemy> {
    const ch = await Character.load(this.pipe, { url: def.model, weapon: def.weapon ?? null, scale: def.scale });
    if (def.offhand) await ch.equipOffhand(this.pipe, def.offhand);
    if (def.glow) {
      const [r, g, b] = def.glow;
      ch.model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[]) {
          const fx = mat.userData.fxOptions as { cracks?: { color: THREE.Color } } | undefined;
          if (fx?.cracks) fx.cracks.color.setRGB(r, g, b);
          if (mat.userData.glow && mat.name === 'skin') mat.emissive.setRGB(r, g, b);
          if (mat.userData.glow && mat.name === 'eyes') mat.emissive.setRGB(r * 2, g * 2, b * 2);
        }
      });
    }
    this.pipe.scene.add(ch.root);
    const g = new THREE.Vector3(pos.x, (this.world.ground(pos.x, pos.y + 3, pos.z) ?? pos.y), pos.z);
    const e = new Enemy(ch, def, this, g, yaw);
    this.enemies.push(e);
    if (opts.aware) e.alert();
    return e;
  }

  takeToken(e: Enemy): boolean { return this.squad.takeToken(e); }
  releaseToken(e: Enemy): void { this.squad.releaseToken(e); }

  alive(): Enemy[] { return this.enemies.filter((e) => !e.dead); }

  /** resolves when every listed enemy is dead */
  async waitDefeated(list: Enemy[]): Promise<void> {
    while (list.some((e) => !e.dead)) await this.wait(0.25);
  }

  finisherTarget(): Enemy | null {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.dead || !e.staggered) continue;
      const d = e.body.pos.distanceTo(p.body.pos);
      if (d > 2.6) continue;
      return e;
    }
    return null;
  }

  // ------------------------------------------------------------------ combat feedback
  onHit(from: Combatant, to: Combatant, hit: Hit, res: HitResult): void {
    const pt = hit.point;
    const toPlayer = to === this.player;
    const chars = [from.char, to.char];
    const heavy = hit.heavy;
    const pipe = this.pipe;
    switch (res) {
      case 'hit':
      case 'killed':
      case 'armor': {
        if (toPlayer) {
          this.particles.burst('spark', pt, 10, hit.dir);
          this.time.hitStop(chars, heavy ? 0.1 : 0.06);
          this.cam.addTrauma(heavy ? 0.55 : 0.35);
          pipe.grade.damage = Math.min(1, pipe.grade.damage + 0.7);
          pipe.grade.chroma = 1.2;
          this.audio.sfx(heavy ? 'impact_heavy' : 'cut', pt, 0.9);
          this.audio.sfx('kaede_hurt', pt, 0.7, { minGap: 0.4 });
        } else {
          this.particles.burst('blood', pt, heavy ? 26 : 14, hit.dir);
          this.particles.burst('ember', pt, heavy ? 14 : 6, hit.dir);
          this.particles.burst('spark', pt, heavy ? 12 : 5, hit.dir);
          if (hit.kind === 'fire') this.particles.burst('fire', pt, 8);
          this.particles.burst('flash', pt, 1);
          this.time.hitStop(chars, res === 'killed' ? 0.11 : heavy ? 0.09 : 0.055);
          this.cam.addTrauma(heavy ? 0.32 : 0.16);
          if (heavy) this.cam.punch(-2.5);
          this.audio.sfx('cut', pt, heavy ? 1 : 0.85);
          if (heavy) this.audio.sfx('impact_heavy', pt, 0.6);
          if (res === 'armor') this.audio.sfx('clang', pt, 0.5);
          else this.audio.sfx('hollow_hurt', pt, 0.45, { minGap: 0.25 });
          const flash = this.light({ position: pt.clone(), color: new THREE.Color(1, 0.6, 0.3), intensity: heavy ? 30 : 14, distance: 6, priority: 1 });
          window.setTimeout(() => { this.pipe.lighting.remove(flash); }, 70);
          if (res === 'killed' && this.alive().length === 0) {
            this.time.slowmo(0.28, 0.55);
            pipe.grade.chroma = 0.8;
          }
        }
        break;
      }
      case 'blocked':
        this.particles.burst('spark', pt, 16, hit.dir.clone().negate());
        this.time.hitStop(chars, 0.05);
        this.cam.addTrauma(0.18);
        this.audio.sfx('block', pt, 0.9);
        break;
      case 'parried':
        this.particles.burst('spark', pt, 40, hit.dir.clone().negate());
        this.particles.burst('flash', pt, 1, undefined, 1.6);
        this.time.hitStop(chars, 0.12);
        this.time.slowmo(0.3, 0.3);
        this.cam.addTrauma(0.3);
        pipe.grade.chroma = 1.5;
        this.audio.sfx('parry', pt, 1);
        {
          const flash = this.light({ position: pt.clone(), color: new THREE.Color(1, 0.75, 0.45), intensity: 40, distance: 8, priority: 1 });
          window.setTimeout(() => { this.pipe.lighting.remove(flash); }, 90);
        }
        break;
      default:
        break;
    }
  }

  /** perilous attack warning: a star glint on the weapon */
  glint(e: Enemy): void {
    const p = e.char.bladeTip ? e.char.bladeTip.getWorldPosition(new THREE.Vector3()) : e.center();
    this.particles.burst('flash', p, 1, undefined, 1.2);
    this.particles.burst('magic', p, 10);
    this.audio.sfx('glint', p, 0.9);
    this.hud.toast('Perilous attack: dodge', 1);
  }

  /** Cinder Burst: fire ring damaging nearby enemies */
  burst(from: Combatant, pos: THREE.Vector3): void {
    this.cam.addTrauma(0.6);
    this.pipe.grade.chroma = 1.4;
    this.audio.sfx('burst', pos, 1);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * 1.6, 0.2, Math.sin(a) * 1.6));
      this.particles.burst('fire', p, 4, new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a)));
    }
    this.particles.burst('ember', pos, 60);
    const fl = this.light({ position: pos.clone().add(new THREE.Vector3(0, 0.6, 0)), color: new THREE.Color(1, 0.5, 0.2), intensity: 80, distance: 12, priority: 1 });
    window.setTimeout(() => this.pipe.lighting.remove(fl), 260);
    for (const e of this.enemies) {
      if (e.dead || e.body.pos.distanceTo(pos) > 3.6) continue;
      const dir = e.body.pos.clone().sub(pos).setY(0).normalize();
      const hit: Hit = { from, damage: 40, poise: 70, heavy: true, art: true, knock: 1, point: e.center(), dir, kind: 'fire' };
      this.onHit(from, e, hit, e.receive(hit));
    }
  }

  async onPlayerDeath(): Promise<void> {
    if (this.respawning) return;
    this.respawning = true;
    this.squad.onPlayerDeath();
    this.time.slowmo(0.35, 1.2);
    this.audio.sfx('heartbeat', null, 0.9);
    await this.wait(1.4);
    this.hud.showDeath(true);
    await this.wait(2.6);
    await this.hud.fade(1, 1.2);
    this.hud.showDeath(false);
    // reload the level at the last checkpoint (enemies and story restart from there)
    if (this.level) await this.loadLevel(this.level, this.checkpoint);
    this.respawning = false;
  }

  /** adaptive score: explore <-> combat <-> boss, with a few seconds of calm before leaving a fight */
  private updateMusic(dt: number): void {
    const m = this.music;
    let want: string | null = null;
    if (this.musicOverride) want = this.musicOverride;
    else if (m) {
      const fighting = this.enemies.some((e) => e.inCombat);
      const boss = this.enemies.some((e) => e.def.boss && e.inCombat && !e.dead);
      this.musicCalm = fighting ? 0 : this.musicCalm + dt;
      want = boss && m.boss ? m.boss : fighting || (this.musicCalm < 4 && this.musicReq === m.combat) ? m.combat : m.explore;
    }
    // ask once per change (the track decodes asynchronously)
    if (want !== this.musicReq) {
      this.musicReq = want;
      void this.audio.playMusic(want, want === m?.combat || want === m?.boss ? 1.2 : 3.0);
    }
  }

  /** a tutorial hint worded for the device being used */
  hint(kbm: string, pad: string, touch: string, dur = 5): void {
    const d = this.touch.enabled ? 'touch' : this.input.lastDevice;
    this.hud.toast(d === 'touch' ? touch : d === 'pad' ? pad : kbm, dur);
  }

  // ------------------------------------------------------------------ story helpers
  /** wait in game time (pauses with the game) */
  wait(t: number): Promise<void> {
    return new Promise((res) => this.timers.push({ t, res }));
  }

  async waitUntil(pred: () => boolean, step = 0.1): Promise<void> {
    while (!pred()) await this.wait(step);
  }

  /** subtitle line; duration from text length unless given */
  async say(who: string | null, text: string, dur?: number, speaker?: Character | null, expr?: string): Promise<void> {
    const d = dur ?? Math.max(2.2, 1.0 + text.length * 0.055);
    this.hud.say(who, text);
    if (speaker) { speaker.face.talk = 1; speaker.face.set(expr ?? inferEmotion(text)); }
    this.audio.setDuck(0.55);
    const t0 = this.gameTime;
    this.skipRequested = false;
    while (this.gameTime - t0 < d && !this.skipRequested) await this.wait(0.05);
    this.skipRequested = false;
    if (speaker) speaker.face.talk = 0;
    this.hud.say(null, null);
    this.audio.setDuck(1);
    await this.wait(0.25);
  }

  setCinematic(on: boolean): void {
    this.cinematic = on;
    this.player.controllable = !on;
    this.hud.letterbox(on);
    this.hud.setVisible(!on);
    this.pipe.dofAmount = 0;
    this.touch.root.style.visibility = on ? 'hidden' : 'visible';
    if (!on) this.cam.setShot(null);
  }

  shot(s: Shot | null): void {
    this.cam.setShot(s);
    // depth of field only where a shot asks for a focus distance
    if (s && s.focus !== undefined) {
      // a lens-like depth of field: the in-focus band widens with distance
      this.pipe.dof.cocMaterial.worldFocusDistance = s.focus;
      this.pipe.dof.cocMaterial.worldFocusRange = Math.max(2.5, s.focus * 0.8);
      this.pipe.dofAmount = 1;
    } else if (this.cinematic) this.pipe.dofAmount = 0;
  }

  interact(pos: THREE.Vector3, label: string, on: () => void, radius = 2): { enabled: boolean } {
    const it = { pos, radius, label, on, enabled: true };
    this.interactables.push(it);
    return it;
  }

  // ------------------------------------------------------------------ frame
  update(dtReal: number): void {
    const input = this.input;
    input.update(dtReal);
    if (input.pressed('pause', 0.1) && !this.test) this.onPause?.();
    if (this.paused) return;
    if (input.pressed('skip', 0.1) || (this.cinematic && input.pressed('attack', 0.1))) this.skipRequested = true;
    this.time.update(dtReal);
    const dt = dtReal * this.time.scale;
    this.gameTime += dt;
    this.playTime += dtReal;
    // timers
    for (const t of this.timers) t.t -= dt;
    const done = this.timers.filter((t) => t.t <= 0);
    this.timers = this.timers.filter((t) => t.t > 0);
    for (const t of done) t.res();

    const p = this.player;
    // interactables
    let near: (typeof this.interactables)[number] | null = null;
    if (!this.cinematic && p && !p.dead && !p.act) {
      let bd = 1e9;
      for (const it of this.interactables) {
        if (!it.enabled) continue;
        const d = it.pos.distanceTo(p.body.pos);
        if (d < it.radius && d < bd) { bd = d; near = it; }
      }
    }
    this.hud.setPrompt(near ? near.label : null, this.touch.enabled ? 'Use' : input.lastDevice === 'pad' ? 'B' : 'E');
    this.touch.showInteract(!!near, 'Use');
    if (p && this.touch.enabled) this.touch.setArts(p.artsUnlocked, p.ember, ARTS.map((a) => a.cost));
    if (near && input.pressed('interact')) { near.enabled = false; near.on(); }
    // finisher
    if (p && p.canFinish && !this.cinematic && input.peek('attack', 0.1)) {
      const f = this.finisherTarget();
      if (f) {
        input.pressed('attack');
        p.finisher(f);
        f.invulnerable = false;
        this.time.slowmo(0.45, 0.5);
        this.cam.addTrauma(0.2);
      }
    }
    if (p) {
      const pdt = dt * this.time.charScale(p.char);
      p.update(pdt, input, this.cam, this.world);
      p.char.update(pdt);
    }
    if (p) this.squad.update(dt);
    for (const e of this.enemies) {
      const edt = dt * this.time.charScale(e.char);
      e.update(edt, this.world);
      e.char.update(edt);
    }
    for (const e of this.enemies.filter((x) => x.removed)) e.char.root.removeFromParent();
    this.enemies = this.enemies.filter((x) => !x.removed);
    if (p) separate([p.body, ...this.enemies.filter((e) => !e.dead).map((e) => e.body)], new Set());
    if (p) {
      for (const e of this.enemies) e.char.root.position.copy(e.body.pos);
      p.char.root.position.copy(p.body.pos);
    }
    // story characters last: one carried by an enemy follows its final position this frame
    for (const n of this.npcs) n.update(dt);
    this.updateMusic(dtReal);
    // camera
    const look = input.takeLook(this.lookTmp);
    if (this.cinematic) look.set(0, 0);
    if (p) {
      this.cam.lockTarget = p.lock ? p.lock.center() : null;
      this.cam.update(dtReal, p.body.pos, p.yaw, look, p.speed > 0.3);
      G.uPlayerPos.value.copy(p.body.pos);
    }
    const cam = this.pipe.camera;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, right);
    // effects
    if (p?.char.bladeBase && p.char.bladeTip) {
      this.trail.update(dt, p.char.bladeBase.getWorldPosition(new THREE.Vector3()), p.char.bladeTip.getWorldPosition(new THREE.Vector3()));
    }
    this.particles.update(dt, this.pipe.renderer.domElement.height, cam.fov);
    this.weather.update(dt, cam, this.particles.wind);
    const gr = this.pipe.grade;
    gr.damage = Math.max(0, gr.damage - dtReal * 1.8);
    gr.chroma = Math.max(0, gr.chroma - dtReal * 4);
    gr.desaturate = p && !p.dead ? THREE.MathUtils.clamp((0.3 - p.hp / p.maxHp) * 2, 0, 0.5) : 0.6;
    this.pipe.motionBlur.strength = 0.5;
    this.level?.update?.(dt);
    for (const f of this.onFrame) f(dt);
    if (p) {
      const lock = p.lock as Enemy | null;
      this.hud.update(dtReal, p, cam, this.enemies, lock, window.innerWidth, window.innerHeight);
    }
  }

  onPause: (() => void) | null = null;
}
