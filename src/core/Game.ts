import * as THREE from 'three';
import { QualityLevel } from '../config/quality';
import { Input } from './Input';
import { time } from './Time';
import { Renderer } from '../rendering/Renderer';
import { World } from '../game/World';
import { GameCamera } from '../camera/GameCamera';
import { VFX } from '../vfx/VFX';
import { AudioEngine } from '../audio/AudioEngine';
import { Feedback } from '../game/Feedback';
import { HUD } from '../ui/HUD';
import { Arena } from '../levels/Arena';
import { buildArena } from '../levels/arenas';
import { Match, MatchConfig, MatchResult } from '../game/Match';
import { Athlete, AthleteProfile } from '../game/Athlete';
import { PlayerController } from '../game/PlayerController';
import { AIController, AI_DEBUG } from '../ai/AIController';
import { TeamBrain } from '../ai/TeamBrain';
import { aiParams } from '../ai/AIProfile';
import type { TeamId } from '../game/types';
import { h } from '../ui/dom';
import { CinematicDirector } from '../cinematics/CinematicDirector';
import { AbilitySystem } from '../abilities/AbilitySystem';
import { ABILITIES } from '../data/skills';
import type { Progression } from '../progression/Progression';
import { BossDirector } from '../game/BossDirector';

export interface GameHooks {
  onMatchEnd?: (config: MatchConfig, result: MatchResult) => void;
  onFrame?: (dt: number, realDt: number) => void;
  abilities?: { useAbility(a: Athlete): boolean; useUltimate(a: Athlete): boolean; abilityCost(a: Athlete): number; update(dt: number): void; bind(): void; unbind(): void } | null;
}

/**
 * Top-level runtime: owns renderer, world, camera, input, audio and presentation
 * systems, and runs the frame loop. Screens/campaign logic sit above this.
 */
export class Game {
  readonly input: Input;
  readonly renderer: Renderer;
  readonly world: World;
  readonly cam: GameCamera;
  readonly vfx: VFX;
  readonly audio: AudioEngine;
  readonly feedback: Feedback;
  readonly hud: HUD;
  readonly uiRoot: HTMLElement;
  arena: Arena | null = null;
  arenaId = '';
  match: Match | null = null;
  player: Athlete | null = null;
  pc: PlayerController | null = null;
  brains: TeamBrain[] = [];
  paused = false;
  hooks: GameHooks = {};
  quality: QualityLevel;
  /** Extra per-frame callbacks (cinematics, tutorial). */
  tickers = new Set<(dt: number, realDt: number) => void>();
  /** When set, the gameplay camera is not updated (cinematic in control). */
  cinematicActive = false;
  private raf = 0;
  playerProfile: AthleteProfile | null = null;
  readonly director: CinematicDirector;
  readonly abilities: AbilitySystem;
  progression: Progression | null = null;
  readonly boss: BossDirector;

  constructor(container: HTMLElement, quality: QualityLevel) {
    this.quality = quality;
    this.world = new World(time);
    this.renderer = new Renderer(container, this.world.scene, this.world.camera, quality);
    this.uiRoot = h('div', { id: 'ui-root' });
    container.appendChild(this.uiRoot);
    this.input = new Input(this.renderer.canvas);
    this.cam = new GameCamera(this.world.camera);
    this.vfx = new VFX(this.renderer.quality.particles, 3);
    this.world.scene.add(this.vfx.root);
    this.audio = new AudioEngine();
    this.feedback = new Feedback(this.world, time, this.cam, this.renderer, this.vfx, this.audio);
    this.feedback.bind();
    this.hud = new HUD(this.uiRoot);
    this.world.events.on('announce', (e) => this.hud.announce(e.text, e.sub, e.style));
    this.director = new CinematicDirector(this);
    this.abilities = new AbilitySystem(this, this.director);
    this.hooks.abilities = this.abilities;
    this.boss = new BossDirector(this);
    (window as any).__game = this;
    (window as any).__aiDebug = AI_DEBUG;
  }

  setQuality(level: QualityLevel) {
    this.quality = level;
    this.renderer.applyQuality(level);
    this.vfx.setScale(this.renderer.quality.particles);
    // rebuild arena so density/detail follow the preset
    if (this.arenaId) {
      const [id, size] = this.arenaId.split(':');
      this.arenaId = '';
      const court = size ? { halfWidth: Number(size.split('x')[0]), halfLength: Number(size.split('x')[1]) } : null;
      this.loadArena(id, court);
    }
  }

  loadArena(id: string, court: { halfWidth: number; halfLength: number } | null = null) {
    const key = court ? `${id}:${court.halfWidth}x${court.halfLength}` : id;
    if (this.arenaId === key && this.arena) return this.arena;
    if (this.arena) {
      this.world.scene.remove(this.arena.root);
      this.arena.dispose();
    }
    const arena = buildArena(id, this.renderer.quality, court);
    this.arena = arena;
    this.arenaId = key;
    this.world.scene.add(arena.root);
    const look = arena.look;
    this.world.scene.background = look.background;
    this.world.scene.fog = look.fog;
    const env = arena.bakeEnvironment(this.renderer.renderer);
    this.world.scene.environment = env;
    this.world.scene.environmentIntensity = look.envIntensity;
    this.renderer.setGrade(look.grade, look.bloom);
    this.cam.bounds.copy(arena.cameraBounds);
    this.cam.blockers = arena.blockers;
    this.world.court.halfWidth = arena.info.court.halfWidth;
    this.world.court.halfLength = arena.info.court.halfLength;
    this.world.court.obstacles = arena.obstacles;
    this.feedback.arena = arena;
    // shadow-casting lights get the preset's map size
    this.renderer.applyQuality(this.quality);
    return arena;
  }

  /** Create athletes + controllers and begin a match. */
  startMatch(config: MatchConfig, playerProfile?: AthleteProfile) {
    this.endMatch();
    const arena = this.loadArena(config.arena, config.court ?? null);
    if (config.court) {
      this.world.court.halfWidth = config.court.halfWidth;
      this.world.court.halfLength = config.court.halfLength;
    } else {
      this.world.court.halfWidth = arena.info.court.halfWidth;
      this.world.court.halfLength = arena.info.court.halfLength;
    }
    const brains: [TeamBrain, TeamBrain] = [new TeamBrain(0, this.world), new TeamBrain(1, this.world)];
    this.brains = brains;
    const playerControlled = config.playerControlled !== false;
    const home = playerProfile && playerControlled ? [playerProfile, ...config.home.slice(1)] : config.home;
    const cfg: MatchConfig = { ...config, home };
    let first = true;
    const factory = (p: AthleteProfile, team: TeamId) => {
      const a = new Athlete(p, team);
      a.world = this.world;
      if (team === 0 && first && playerControlled) {
        first = false;
        this.player = a;
        a.isPlayer = true;
        this.pc = new PlayerController(a, this.input, this.cam, this.world);
        if (this.hooks.abilities) this.pc.abilities = this.hooks.abilities;
        a.controller = this.pc;
      } else {
        if (team === 0) first = false;
        const ai = new AIController(a, aiParams(p.personality, p.tier), this.world, brains[team]);
        if (this.hooks.abilities) ai.abilities = this.hooks.abilities;
        brains[team].add(ai);
        a.controller = ai;
      }
      if (cfg.rules?.ricochet) a.perks.ricochet = true;
      return a;
    };
    const match = new Match(this.world, cfg, factory);
    this.match = match;
    match.onEnd = (r) => this.hooks.onMatchEnd?.(cfg, r);
    // team colours for feedback
    const homeCol = new THREE.Color(0x27e0d0);
    const awayCol = new THREE.Color(match.away[0]?.profile.appearance.jersey ?? 0xff4a3a);
    const hsl = { h: 0, s: 0, l: 0 };
    awayCol.getHSL(hsl);
    if (hsl.l < 0.35 || hsl.s < 0.25) awayCol.setHSL(hsl.h, Math.max(0.7, hsl.s), 0.55);
    if (match.away[0]?.profile.appearance.glow) awayCol.set(match.away[0].profile.appearance.glow);
    this.feedback.setTeamColors(homeCol.getHex(), awayCol.getHex());
    for (const a of this.world.athletes) {
      const ringMat = a.ring.material as THREE.MeshBasicMaterial;
      ringMat.color.copy(a.team === 0 ? homeCol : awayCol);
      ringMat.opacity = a.isPlayer ? 0.85 : 0.4;
      if (a.isPlayer) a.ring.scale.setScalar(1.15);
    }
    this.hud.setTeams('YOU', (cfg.away[0] && cfg.subtitle) || 'AWAY');
    this.hud.buildTags(this.world);
    this.hud.setObjective(cfg.objective ?? '');
    if (this.player) {
      this.cam.mode = 'follow';
      this.cam.setTarget(this.player, true);
      this.cam.yaw = Math.PI;
      this.cam.pitch = -0.1;
    } else {
      this.cam.mode = 'orbit';
      this.cam.orbitCenter.set(0, 1, 0);
    }
    this.hooks.abilities?.bind();
    this.boss.bind();
    this.input.gameplayMouse = playerControlled;
    this.hud.show(playerControlled);
    const pa = this.player?.profile.ability;
    this.hud.abilityInfo = pa && ABILITIES[pa] ? { name: ABILITIES[pa].name, cost: ABILITIES[pa].cost, icon: ABILITIES[pa].icon } : null;
    this.hud.ultInfo = this.player?.profile.ultimate ? { name: 'OVERTHROW' } : null;
    for (const a of this.world.athletes) a.rig.material.u.uDissolveColor.value.copy(a.team === 0 ? homeCol : awayCol);
    return match;
  }

  beginMatch() {
    this.match?.begin();
  }

  endMatch() {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this.hooks.abilities?.unbind();
    this.boss.unbind();
    this.world.removeAthletes();
    this.world.balls.clear();
    this.vfx.clear();
    this.player = null;
    this.pc = null;
    this.brains = [];
    this.input.gameplayMouse = false;
    this.hud.show(false);
    time.clearEffects();
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    time.resetClock();
    loop();
  }

  /** Run the simulation headlessly (no rendering) — used by automated balance tests. */
  simulate(seconds: number, step = 1 / 60) {
    const n = Math.round(seconds / step);
    time.baseScale = 1;
    for (let i = 0; i < n; i++) {
      time.manualStep(step);
      this.input.update(step, time.realTime);
      if (this.pc && !this.cinematicActive) this.pc.updateLook();
      this.step(time.dt, time.realDt);
      this.feedback.update(time.dt);
      this.vfx.update(time.dt, this.world.camera);
      if (!this.cinematicActive) this.cam.update(step);
      for (const t of this.tickers) t(time.dt, step);
      if (this.match && this.match.phase === 'done') break;
    }
  }

  private step(dt: number, realDt: number) {
    this.world.update(dt);
    for (const b of this.brains) b.update(dt);
    this.hooks.abilities?.update(dt);
    this.boss.update(dt);
    this.match?.update(dt, realDt);
  }

  private frame() {
    time.baseScale = this.paused ? 0 : 1;
    time.tick();
    const dt = time.dt;
    const realDt = time.realDt;
    this.input.update(realDt, time.realTime);
    this.audio.update(realDt);

    if (!this.paused) {
      if (this.pc && !this.cinematicActive) this.pc.updateLook();
      this.step(dt, realDt);
      this.feedback.update(dt);
    }
    if (!this.paused) for (const t of this.tickers) t(dt, realDt);
    this.hooks.onFrame?.(dt, realDt);
    this.vfx.update(this.paused ? 0 : dt, this.world.camera);
    if (!this.cinematicActive) {
      // spectate a teammate when the player is out
      if (this.player && this.match && (this.player.isOut || this.player.state === 'knockdown') && this.cam.mode === 'follow') {
        const mate = this.world.teammatesOf(this.player)[0];
        if (mate) {
          this.cam.mode = 'spectate';
          this.cam.setTarget(mate);
        }
      } else if (this.player && this.cam.mode === 'spectate' && this.player.active) {
        this.cam.mode = 'follow';
        this.cam.setTarget(this.player);
      } else if (this.cam.mode === 'spectate' && this.cam.target && !this.cam.target.active) {
        const mate = this.player ? this.world.teammatesOf(this.player)[0] : null;
        if (mate) this.cam.setTarget(mate);
      }
      this.cam.update(realDt);
    }
    if (this.arena) {
      this.arena.update(dt, time.gameTime);
      const m = this.match;
      if (m) {
        const tl = m.config.timeLimit > 0 ? m.timeRemaining : 0;
        const mm = Math.floor(tl / 60);
        const ss = Math.floor(tl % 60);
        this.arena.setScore(m.score[0], m.score[1], `${mm}:${ss.toString().padStart(2, '0')}`, Math.max(1, m.round));
        if (this.arena.crowd) this.arena.crowd.setBase(m.phase === 'playing' ? 0.18 + (m.suddenDeath ? 0.3 : 0) : 0.08);
      }
    }
    this.audio.setListener(this.world.camera);
    this.hud.update(this.world, this.player, this.pc, this.world.camera, time.fps);
    this.renderer.render(realDt, time.fps);
  }
}
