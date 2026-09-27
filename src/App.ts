import * as THREE from 'three';
import { Game } from './core/Game';
import { time } from './core/Time';
import { SaveSystem, Settings } from './progression/SaveSystem';
import { Progression } from './progression/Progression';
import { MainMenu } from './ui/screens/MainMenu';
import { CareerScreen } from './ui/screens/CareerScreen';
import { SkillsScreen } from './ui/screens/SkillsScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { PauseMenu } from './ui/screens/PauseMenu';
import { ResultsScreen } from './ui/screens/ResultsScreen';
import { CreateScreen } from './ui/screens/CreateScreen';
import { QuickMatchScreen, QuickOptions, DIFF_NAMES } from './ui/screens/QuickMatchScreen';
import { Screen } from './ui/screens/Screen';
import { CampaignMatch, CHAPTERS, MATCHES, MATCH_BY_ID, chapterUnlocked } from './data/campaign';
import { filler, KITS } from './data/roster';
import type { MatchConfig, MatchResult } from './game/Match';
import { matchIntroShots, matchOutroShots, playStory } from './cinematics/Story';
import { Tutorial } from './game/Tutorial';
import { Stage } from './cinematics/Stage';
import { h } from './ui/dom';

type Mode = 'boot' | 'menu' | 'career' | 'match' | 'cinematic' | 'results' | 'skills' | 'settings' | 'quick' | 'create' | 'credits';

/**
 * Application flow: title (attract mode) → menus → career → cinematics → match →
 * results → story beats. Owns persistence and applies settings to the runtime.
 */
export class App {
  readonly game: Game;
  readonly save = new SaveSystem();
  readonly prog = new Progression(this.save);
  mode: Mode = 'boot';
  private menu: MainMenu;
  private career: CareerScreen;
  private skills: SkillsScreen;
  private settings: SettingsScreen;
  private pause: PauseMenu;
  private results: ResultsScreen;
  private create: CreateScreen;
  private quick: QuickMatchScreen;
  private credits: Screen;
  private screens: Screen[];
  private currentMatch: { campaign: CampaignMatch | null; config: MatchConfig; quick?: QuickOptions } | null = null;
  private tutorial: Tutorial | null = null;
  private previewStage: Stage | null = null;
  private settingsReturn: Mode = 'menu';
  private matchStarting = false;

  constructor(container: HTMLElement) {
    const s = this.save.data.settings;
    this.game = new Game(container, s.quality);
    this.game.progression = this.prog;
    const root = this.game.uiRoot;
    const audio = this.game.audio;
    this.menu = new MainMenu(root, audio, this.prog, {
      continueCareer: () => this.openCareer(),
      newCareer: () => this.openCreate(),
      quickMatch: () => this.openQuick(),
      skills: () => this.openSkills('menu'),
      settings: () => this.openSettings('menu'),
      credits: () => this.openCredits(),
    });
    this.career = new CareerScreen(root, audio, this.prog);
    this.career.onBack = () => this.openMenu();
    this.career.onPlay = (m) => this.playCampaign(m);
    this.career.onSkills = () => this.openSkills('career');
    this.career.onChapterPreview = (arena) => this.previewArena(arena);
    this.skills = new SkillsScreen(root, audio, this.prog);
    this.skills.onBack = () => (this.settingsReturn === 'career' ? this.openCareer() : this.openMenu());
    this.settings = new SettingsScreen(root, audio);
    this.settings.onChange = (st) => this.applySettings(st, false);
    this.settings.onBack = () => {
      this.applySettings(this.save.data.settings, true);
      this.save.save();
      if (this.settingsReturn === 'match') {
        this.hideAll();
        this.pause.open(this.currentMatch?.config.title ?? '');
        this.mode = 'match';
      } else this.openMenu();
    };
    this.pause = new PauseMenu(root, audio);
    this.pause.onResume = () => this.resume();
    this.pause.onRestart = () => {
      this.pause.hide();
      if (this.currentMatch) this.startMatch(this.currentMatch.config, this.currentMatch.campaign, this.currentMatch.quick, true);
    };
    this.pause.onSettings = () => {
      this.pause.hide();
      this.openSettings('match');
    };
    this.pause.onQuit = () => this.quitToMenu();
    this.results = new ResultsScreen(root, audio);
    this.create = new CreateScreen(root, audio);
    this.create.onBack = () => this.openMenu();
    this.create.onChange = (name, look) => this.updateCreatePreview(name, look);
    this.create.onDone = (name, look) => this.beginNewCareer(name, look);
    this.quick = new QuickMatchScreen(root, audio);
    this.quick.onBack = () => this.openMenu();
    this.quick.onPlay = (o) => this.playQuick(o);
    this.credits = new Screen(root, audio);
    this.screens = [this.menu, this.career, this.skills, this.settings, this.pause, this.results, this.create, this.quick, this.credits];

    this.applySettings(s, true);
    this.bindGlobalInput();
    window.addEventListener('beforeunload', () => this.save.flush());
    (window as any).__app = this;
    (window as any).__debugStart = (id: string, auto = true) => debugStart(this, id, auto);
  }

  // ------------------------------------------------------------------ settings
  applySettings(s: Settings, full: boolean) {
    const g = this.game;
    g.input.settings.mouseSensitivity = s.mouseSensitivity;
    g.input.settings.padSensitivity = s.padSensitivity;
    g.input.settings.invertY = s.invertY;
    g.audio.volumes.master = s.masterVolume;
    g.audio.volumes.music = s.musicVolume;
    g.audio.volumes.sfx = s.sfxVolume;
    g.audio.applyVolumes();
    g.cam.shakeScale = s.cameraShake;
    g.hud.showFps = s.showFps;
    g.renderer.autoQuality = s.autoQuality;
    if (full || s.quality !== g.quality) {
      if (s.quality !== g.quality) g.setQuality(s.quality);
    }
    this.save.save();
  }

  private bindGlobalInput() {
    const g = this.game;
    g.input.onPointerLockChange = (locked) => {
      if (!locked && this.mode === 'match' && !g.paused && g.match && g.match.phase !== 'matchEnd' && g.match.phase !== 'done' && !this.matchStarting && !g.director.playing) this.openPause();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' && e.code !== 'KeyP') return;
      if (this.mode === 'match') {
        if (g.director.playing) {
          g.director.skip();
          return;
        }
        if (g.paused) this.resume();
        else this.openPause();
      }
    });
    // clicking the canvas during a match (re)captures the mouse
    g.renderer.canvas.addEventListener('click', () => {
      if (this.mode === 'match' && !g.paused) g.input.requestLock();
    });
  }

  private hideAll() {
    for (const s of this.screens) if (s.visible) s.hide();
  }

  // ------------------------------------------------------------------ boot / title
  async boot(onProgress: (p: number, msg: string) => void) {
    onProgress(0.2, 'Building arena');
    await nextFrame();
    const arena = this.currentChapterArena();
    this.startAttract(arena);
    onProgress(0.7, 'Warming up shaders');
    await nextFrame();
    this.game.start();
    onProgress(1, 'Ready');
    if (this.save.status === 'recovered') this.toast('Save restored from backup');
    else if (this.save.status === 'corrupt') this.toast('Save data was unreadable — starting fresh');
    else if (this.save.status === 'unavailable') this.toast('Storage unavailable — progress will not be saved');
    this.openMenu();
  }

  private currentChapterArena() {
    const done = this.save.data.campaign.completed;
    let arena = 'rec';
    for (const c of CHAPTERS) if (chapterUnlocked(c, done)) arena = c.arena;
    return arena;
  }

  /** AI-vs-AI exhibition behind the menus. */
  startAttract(arena: string) {
    const g = this.game;
    this.clearPreview();
    const n = 3;
    const home = Array.from({ length: n }, (_, i) => filler(KITS.player, i, 4, (['aggressor', 'tactician', 'defender'] as const)[i], 77));
    const away = Array.from({ length: n }, (_, i) => filler(KITS[['harbor', 'vipers', 'titans', 'royals'][Math.floor(Math.random() * 4)]], i, 4, (['sniper', 'speedster', 'powerhouse'] as const)[i], 78));
    const cfg: MatchConfig = { id: 'attract', title: 'Exhibition', mode: 'exhibition', arena, home, away, roundsToWin: 99, ballCount: 4, timeLimit: 0, tier: 4, reward: { xp: 0, cred: 0 }, playerControlled: false };
    g.feedback.subtle = true;
    g.startMatch(cfg);
    g.match!.onEnd = null;
    g.match!.begin();
    g.match!.skipCountdown();
    g.cam.mode = 'orbit';
    g.cam.orbitCenter.set(0, 0.8, 0);
    g.cam.orbitRadius = 15;
    g.cam.orbitHeight = 5.5;
    g.cam.orbitSpeed = 0.05;
    g.audio.crowdEnabled = true;
    g.audio.setCrowdLevel(0.06);
    g.audio.setSfxDuck(0.25);
    g.audio.playMusic('menu');
    g.hud.show(false);
    this.game.paused = false;
  }

  private previewArena(arena: string) {
    if (this.game.arenaId !== arena && (this.mode === 'career' || this.mode === 'menu')) this.startAttract(arena);
  }

  private clearPreview() {
    if (this.previewStage) {
      this.previewStage.dispose();
      this.previewStage = null;
    }
  }

  // ------------------------------------------------------------------ screens
  openMenu() {
    this.hideAll();
    this.mode = 'menu';
    this.game.input.releaseLock();
    if (!this.game.match || this.game.match.config.id !== 'attract') this.startAttract(this.currentChapterArena());
    this.menu.show();
  }

  openCareer() {
    this.hideAll();
    this.mode = 'career';
    if (!this.game.match || this.game.match.config.id !== 'attract') this.startAttract(this.currentChapterArena());
    this.career.show();
  }

  openSkills(from: Mode) {
    this.hideAll();
    this.settingsReturn = from;
    this.mode = 'skills';
    this.skills.show();
  }

  openSettings(from: Mode) {
    this.hideAll();
    this.settingsReturn = from;
    this.mode = from === 'match' ? 'match' : 'settings';
    this.settings.open(this.save.data.settings);
  }

  openQuick() {
    this.hideAll();
    this.mode = 'quick';
    const done = this.save.data.campaign.completed;
    this.quick.unlockedArenas = CHAPTERS.filter((c) => chapterUnlocked(c, done)).map((c) => c.arena);
    if (!this.quick.unlockedArenas.includes('rec')) this.quick.unlockedArenas.unshift('rec');
    this.quick.show();
  }

  openCredits() {
    this.hideAll();
    this.mode = 'credits';
    const c = this.credits;
    c.el.innerHTML = '';
    c.el.append(
      h('div', { class: 'screen-dim solid' }),
      h(
        'div',
        { class: 'pause-card panel', style: 'text-align:center' },
        h('div', { class: 'logo' }, h('div', { class: 'l1', style: 'font-size:90px' }, 'Overthrow')),
        h('div', { class: 'bs', style: 'line-height:1.8;color:var(--text)' }, 'A dodgeball game built entirely with web technology.', h('br'), 'Rendering: three.js · Post-processing: pmndrs/postprocessing', h('br'), 'Characters, animation, arenas, audio and music are procedurally generated at runtime.'),
        h('div', { class: 'bs', style: 'color:var(--muted)' }, `Career: ${this.save.data.stats.matches} matches · ${this.save.data.stats.wins} wins · ${this.save.data.stats.perfectCatches} perfect catches`),
        h('div', { class: 'btn-row', style: 'justify-content:center' }, h('button', { class: 'btn primary', onclick: () => this.openMenu() }, h('span', {}, 'Back'))),
      ),
    );
    c.show();
  }

  openCreate() {
    this.hideAll();
    this.mode = 'create';
    const g = this.game;
    // showcase stage: the player model on the court
    g.endMatch();
    g.loadArena('rec');
    this.clearPreview();
    this.previewStage = new Stage(g);
    g.cinematicActive = true;
    g.cam.mode = 'cinematic';
    const cam = g.world.camera;
    // frame the player in the left half of the screen (panel sits on the right)
    cam.position.set(1.2, 1.35, 2.2);
    cam.fov = 36;
    cam.updateProjectionMatrix();
    cam.lookAt(1.35, 1.1, -1.2);
    this.create.name = this.save.hasProgress ? 'ACE' : this.save.data.name;
    this.create.show();
  }

  private updateCreatePreview(name: string, look: import('./progression/SaveSystem').Look) {
    const st = this.previewStage;
    if (!st) return;
    st.dispose();
    this.previewStage = new Stage(this.game);
    const d = this.save.data;
    const saved = { name: d.name, look: d.look };
    d.name = name || 'ACE';
    d.look = { ...look };
    const p = this.prog.playerProfile();
    d.name = saved.name;
    d.look = saved.look;
    const a = this.previewStage.spawn(p, 0, new THREE.Vector3(0, 0, -1.2), -0.35);
    this.previewStage.giveBall(a);
    this.previewStage.play(a, 'ballSpin', { fade: 0 });
  }

  private beginNewCareer(name: string, look: import('./progression/SaveSystem').Look) {
    this.save.reset();
    this.save.data.name = name || 'ACE';
    this.save.data.look = { ...look };
    this.save.data.newGame = false;
    this.save.save(true);
    this.clearPreview();
    this.game.cinematicActive = false;
    this.hideAll();
    this.playCampaign(MATCH_BY_ID['m1-1']);
  }

  private toast(msg: string) {
    const t = h('div', { class: 'toast panel' }, msg);
    this.game.uiRoot.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ------------------------------------------------------------------ matches
  private async playCampaign(m: CampaignMatch) {
    const d = this.save.data;
    const ch = CHAPTERS.find((c) => c.id === m.chapter)!;
    // standalone story openers
    if (ch.intro === 'intro' && m.id === 'm1-1' && !d.campaign.seenCinematics.includes('intro')) {
      this.hideAll();
      this.mode = 'cinematic';
      this.game.endMatch();
      this.game.audio.playMusic('menu');
      await playStory('intro', this.game, { player: this.prog.playerProfile() });
      d.campaign.seenCinematics.push('intro');
      this.save.save();
    }
    const b = m.build();
    const config: MatchConfig = { ...b, home: [this.prog.playerProfile(), ...b.homeMates] };
    this.startMatch(config, m);
  }

  private playQuick(o: QuickOptions) {
    const kit = KITS[o.kit];
    const tier = o.difficulty;
    const pers = ['aggressor', 'sniper', 'defender', 'speedster', 'tactician', 'powerhouse'] as const;
    const away = Array.from({ length: o.size }, (_, i) => filler(kit, i, tier, pers[(i + o.difficulty) % pers.length], 90 + o.difficulty));
    const mates = Array.from({ length: o.size - 1 }, (_, i) => filler(KITS.player, i, Math.max(1, tier - 1), (['defender', 'aggressor'] as const)[i % 2], 91));
    const court = o.size === 1 ? { halfWidth: 5.2, halfLength: 8 } : o.size === 2 ? { halfWidth: 6, halfLength: 9.2 } : undefined;
    const config: MatchConfig = {
      id: `quick-${o.arena}`,
      title: 'Quick Match',
      subtitle: kit.short,
      mode: 'elimination',
      arena: o.arena,
      home: [this.prog.playerProfile(), ...mates],
      away,
      roundsToWin: 2,
      ballCount: o.size + 1,
      timeLimit: 100,
      tier,
      court,
      reward: { xp: 60 + tier * 25, cred: 30 + tier * 15 },
    };
    this.startMatch(config, null, o);
  }

  private async startMatch(config: MatchConfig, campaign: CampaignMatch | null, quick?: QuickOptions, restart = false) {
    const g = this.game;
    this.hideAll();
    this.clearPreview();
    this.tutorial?.dispose();
    this.tutorial = null;
    this.currentMatch = { campaign, config, quick };
    this.mode = 'match';
    this.matchStarting = true;
    g.paused = false;
    g.feedback.subtle = config.mode === 'tutorial';
    g.audio.setSfxDuck(1);
    g.cinematicActive = false;
    time.clearEffects();
    const match = g.startMatch(config, config.home[0]);
    match.onEnd = (r) => this.onMatchEnd(config, campaign, r, quick);
    g.audio.setCrowdLevel(config.arena === 'stadium' ? 0.2 : config.arena === 'school' ? 0.16 : config.arena === 'rec' ? 0.05 : 0.1);
    g.audio.playMusic(campaign?.boss ? (config.id === 'm7-2' ? 'final' : 'boss') : 'match');
    g.hud.show(false);
    // pre-match presentation
    if (!restart && config.mode !== 'tutorial') {
      const story = campaign?.introCinematic;
      const seen = this.save.data.campaign.seenCinematics;
      if (story && !seen.includes(story)) {
        await playStory(story, g, { player: config.home[0] });
        seen.push(story);
        this.save.save();
      }
      const ch = campaign ? CHAPTERS.find((c) => c.id === campaign.chapter) : null;
      if (ch?.intro && ch.intro !== 'intro' && campaign && campaign.id === MATCHES.find((mm) => mm.chapter === ch.id)?.id && !seen.includes(ch.intro)) {
        await playStory(ch.intro, g, { player: config.home[0] });
        seen.push(ch.intro);
        this.save.save();
      }
      if (this.mode !== 'match' || g.match !== match) return;
      await g.director.play(matchIntroShots(g, config), { skippable: true, returnBlend: 0.6, hideHud: true });
    }
    if (this.mode !== 'match' || g.match !== match) return;
    g.cinematicActive = false;
    g.cam.mode = 'follow';
    g.hud.show(true);
    this.matchStarting = false;
    match.begin();
    g.input.requestLock();
    if (config.mode === 'tutorial') {
      match.skipCountdown();
      this.tutorial = new Tutorial(g);
      this.tutorial.onComplete = () => {
        this.save.data.tutorialDone = true;
        setTimeout(() => g.match?.forceEnd(true), 600);
      };
      this.tutorial.start();
    }
  }

  private openPause() {
    const g = this.game;
    if (this.mode !== 'match' || g.paused) return;
    g.paused = true;
    g.input.releaseLock();
    this.pause.canRestart = this.currentMatch?.config.mode !== 'tutorial';
    this.pause.open(this.currentMatch?.config.title ?? '');
    g.audio.setMusicIntensity(0.2);
  }

  private resume() {
    const g = this.game;
    this.pause.hide();
    this.settings.hide();
    g.paused = false;
    time.resetClock();
    g.input.requestLock();
    g.audio.setMusicIntensity(0.6);
  }

  private quitToMenu() {
    const g = this.game;
    this.tutorial?.dispose();
    this.tutorial = null;
    g.paused = false;
    if (g.director.playing) g.director.skip();
    g.cinematicActive = false;
    g.endMatch();
    this.currentMatch = null;
    this.openMenu();
  }

  private async onMatchEnd(config: MatchConfig, campaign: CampaignMatch | null, r: MatchResult, quick?: QuickOptions) {
    const g = this.game;
    g.input.releaseLock();
    this.tutorial?.dispose();
    this.tutorial = null;
    this.mode = 'results';
    g.audio.stinger(r.won ? 'victory' : 'defeat');
    g.audio.crowd(r.won ? 1.5 : 0.4);
    if (config.mode !== 'tutorial' && g.match) {
      const shots = matchOutroShots(g, r.won);
      if (shots.length) await g.director.play(shots, { skippable: true, restore: false, hideHud: true });
    }
    // rewards
    let sum = null;
    const unlocks: string[] = [];
    if (config.id !== 'attract') {
      const cfgForRewards = quick ? { ...config, reward: { xp: Math.round(config.reward.xp * 0.6), cred: Math.round(config.reward.cred * 0.6) } } : config;
      sum = this.prog.computeRewards(cfgForRewards, r);
      if (!campaign) sum.firstClear = false;
      const firstClear = !!campaign && r.won && !(campaign.id in this.save.data.campaign.completed);
      sum = this.prog.applyRewards(campaign ? config : { ...config, id: `quick` }, r, sum);
      if (!campaign) delete this.save.data.campaign.completed['quick'];
      if (firstClear && campaign?.unlocks) {
        const u = campaign.unlocks;
        if (u.cred) {
          this.save.data.cred += u.cred;
          unlocks.push(`Bonus: ₵${u.cred}`);
        }
        if (u.points) {
          this.save.data.attrPoints += u.points;
          unlocks.push(`Bonus: +${u.points} attribute points`);
        }
        if (u.ultimate) {
          this.save.data.ultimateUnlocked = true;
          unlocks.push('ULTIMATE UNLOCKED — OVERTHROW (press R when the meter is full)');
        }
      }
      if (firstClear && campaign) {
        const idx = MATCHES.indexOf(campaign);
        const next = MATCHES[idx + 1];
        if (next && next.chapter !== campaign.chapter) {
          const ch = CHAPTERS.find((c) => c.id === next.chapter);
          if (ch) unlocks.push(`New chapter: ${ch.name} — ${ch.location}`);
        }
      }
      this.save.save(true);
    }
    const title = campaign ? campaign.title : quick ? `Quick Match · ${DIFF_NAMES[quick.difficulty - 1]}` : config.title;
    this.results.onContinue = async () => {
      this.results.hide();
      if (campaign && r.won && campaign.outroCinematic && !this.save.data.campaign.seenCinematics.includes(campaign.outroCinematic)) {
        g.endMatch();
        this.mode = 'cinematic';
        await playStory(campaign.outroCinematic, g, { player: this.prog.playerProfile() });
        this.save.data.campaign.seenCinematics.push(campaign.outroCinematic);
        this.save.save();
      }
      g.cinematicActive = false;
      g.endMatch();
      this.currentMatch = null;
      if (campaign && campaign.id === 'm7-2' && r.won) this.openCredits();
      else if (campaign) {
        this.career.focusNext();
        this.openCareer();
      } else this.openMenu();
    };
    this.results.onRetry = config.mode === 'tutorial' ? null : () => {
      this.results.hide();
      this.startMatch(config, campaign, quick, true);
    };
    this.results.open(title, r, sum, unlocks);
  }
}

/** Developer hook: start a campaign match immediately (optionally AI-controlled). */
export function debugStart(app: App, id: string, auto: boolean) {
  const m = MATCH_BY_ID[id];
  const b = m.build();
  const config: MatchConfig = { ...b, home: [app.prog.playerProfile(), ...b.homeMates], playerControlled: !auto };
  const g = app.game;
  g.feedback.subtle = true;
  const match = g.startMatch(config, auto ? undefined : config.home[0]);
  match.begin();
  return match;
}

function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}
