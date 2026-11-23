import { Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { Input } from '../core/Input';
import { Audio } from '../audio/Audio';
import { DialogueBox, HUD, makeUIRoot } from '../ui/UI';
import { Menu, type MenuItem } from '../ui/Menu';
import { TouchControls, type TouchScene } from '../ui/TouchControls';
import { loadPrefs, savePrefs } from '../core/Device';
import { Director } from '../story/Director';
import { CHAPTERS } from '../story/chapters';
import { KITS } from './Moves';

interface Save {
  chapter: number;
  unlocked: number;
}

const SAVE_KEY = 'vowbreaker.save.v1';

function loadSave(): Save {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
    if (s && typeof s.chapter === 'number') return s;
  } catch {
    /* private mode */
  }
  return { chapter: 0, unlocked: 0 };
}

function writeSave(s: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const FIGHTERS: { id: string; model: string; name: string }[] = [
  { id: 'itsuki', model: 'itsuki', name: 'Itsuki Kagari' }, { id: 'sayo', model: 'sayo', name: 'Sayo Tachibana' },
  { id: 'mikami', model: 'mikami', name: 'Genjirō Mikami' }, { id: 'ryoga', model: 'ryoga', name: 'Ryōga Hoshino' },
  { id: 'sojin', model: 'sojin', name: 'Sōjin Amagiri' },
];

/** The whole game: title, the story in order, free battles, pause, saves. */
export class Game {
  readonly input = new Input();
  readonly audio = new Audio();
  readonly ui: HTMLElement;
  readonly hud: HUD;
  readonly dialogue: DialogueBox;
  readonly director: Director;
  readonly menu: Menu;
  readonly touch: TouchControls;
  private paused = false;
  /** the page went to the background or the phone was turned upright: open the pause menu when we can */
  private wantPause = false;
  private save = loadSave();
  private titleSpin = false;
  private mode: 'title' | 'story' | 'battle' = 'title';
  readonly test: boolean;

  constructor(readonly r: Renderer, readonly params: URLSearchParams) {
    this.ui = makeUIRoot();
    this.hud = new HUD(this.ui);
    this.dialogue = new DialogueBox(this.ui);
    this.menu = new Menu(this.ui, this.audio);
    this.touch = new TouchControls(this.ui, this.input);
    const prefs = loadPrefs();
    if (prefs.music !== undefined || prefs.sfx !== undefined) this.audio.setVolumes(prefs.music ?? this.audio.musicVolume, prefs.sfx ?? this.audio.sfxVolume);
    this.director = new Director(r, this.input, this.ui, this.hud, this.dialogue, this.audio);
    this.test = params.has('test');
    if (this.test) {
      this.audio.enabled = false;
      this.dialogue.auto = 0.6;
      this.director.autoTest = params.has('auto');
      // ?auto=fair plays at a person's pace: fights at normal strength, lines held long enough to read
      this.director.autoFair = params.get('auto') === 'fair';
      if (this.director.autoFair) {
        this.dialogue.auto = 1.0;
        this.dialogue.autoPerChar = 1 / 16 - 1 / 45;
      }
    }
    this.director.onLose = () => this.retryPrompt();
    window.addEventListener('pointerdown', () => this.audio.unlock(), { once: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { once: true });
    // iOS only starts audio from the end of a touch or a click
    window.addEventListener('touchend', () => this.audio.unlock(), { once: true });
    window.addEventListener('click', () => this.audio.unlock(), { once: true });
    // a phone's home button or a tab switch: stop the sound and hold the game at its pause menu
    document.addEventListener('visibilitychange', () => {
      this.audio.setHidden(document.hidden);
      if (document.hidden) this.wantPause = true;
    });
  }

  async start(): Promise<void> {
    const p = this.params;
    // ?debug=normals|depth|ids|ao|contact|gi|aura|bloom: look at the renderer's buffers
    const dbg = ['', 'normals', 'depth', 'ids', 'ao', 'contact', 'gi', 'aura', 'bloom'].indexOf(p.get('debug') ?? '');
    if (dbg > 0) this.r.post.settings.debugView = dbg;
    // ?quality=high|medium|low picks the graphics quality from the start
    const q = p.get('quality');
    if (q === 'high' || q === 'medium' || q === 'low') this.r.post.settings.quality = q;
    if (p.get('vfx') !== null) {
      const { vfxGallery } = await import('./VfxGallery');
      await vfxGallery(this.director, p.get('vfx') || 'void', p.get('only') ?? undefined);
      return;
    }
    if (p.get('duel')) {
      const [a, b] = p.get('duel')!.split(',');
      void this.freeBattle(a, b ?? 'sayo', p.get('stage') ?? 'void');
      return;
    }
    if (p.get('chapter') !== null) {
      void this.story(+p.get('chapter')!);
      return;
    }
    await this.title();
  }

  // --- title -------------------------------------------------------------------------------------------

  private async title(): Promise<void> {
    this.mode = 'title';
    const d = this.director;
    d.clearCast();
    d.letterbox(false);
    d.flashback(false);
    await d.setStage('alley');
    const it = await d.actor('itsuki');
    d.place('itsuki', 0.5, 2.5, Math.PI * 0.85);
    it.anim.play('look_down', 0);
    it.face.set('sad');
    d.music('title');
    d.cam.orbit(new Vector3(0.5, 0.4, 2.5), 4.2, 1.2, 2.4, 0.06);
    this.r.post.settings.dofAmount = 0;
    this.titleSpin = true;
    // the title's brushwork draws itself in behind the logo
    const ps = this.r.post.settings;
    ps.callMode = 1;
    ps.callProgress = 0;
    ps.callSeed = 0.37;
    const hasSave = this.save.chapter > 0;
    this.menu.title([
      { label: hasSave ? `Continue — ${CHAPTERS[Math.min(this.save.chapter, CHAPTERS.length - 1)].title}` : 'Begin the Story', action: () => void this.story(this.save.chapter) },
      { label: 'New Story', disabled: !hasSave, action: () => void this.story(0) },
      { label: 'Chapters', action: () => this.chapterSelect() },
      { label: 'Free Battle', action: () => this.battleSelect() },
      { label: 'Settings', action: () => this.settings(() => void this.title()) },
      { label: 'Credits', action: () => this.credits(() => void this.title()) },
    ]);
  }

  private chapterSelect(): void {
    this.menu.list('Chapters', CHAPTERS.map((c, i) => ({
      label: `${c.num}  ${c.title}`, sub: c.sub, disabled: i > this.save.unlocked && !this.test, action: () => void this.story(i),
    })), () => void this.title());
  }

  private battleSelect(): void {
    this.menu.list('Free Battle — choose your fighter', FIGHTERS.map((f) => ({
      label: f.name, sub: KITS[f.id]().domain?.name ?? 'technique: Gravebrand',
      action: () => this.menu.list('Choose an opponent', FIGHTERS.filter((o) => o.id !== f.id).map((o) => ({
        label: o.name, action: () => void this.freeBattle(f.id, o.id, ['academy', 'chapel', 'subway', 'crossing', 'estate'][Math.floor(Math.random() * 5)]),
      })), () => this.battleSelect()),
    })), () => void this.title());
  }

  private settings(back: () => void): void {
    const s = this.r.post.settings;
    const items: MenuItem[] = [
      { label: `Quality: ${s.quality}`, action: () => {
        s.quality = s.quality === 'high' ? 'medium' : s.quality === 'medium' ? 'low' : 'high';
        savePrefs({ quality: s.quality });
        this.settings(back);
      } },
    ];
    if (document.fullscreenEnabled) {
      items.push({ label: `Fullscreen: ${document.fullscreenElement ? 'on' : 'off'}`, action: () => {
        const on = !document.fullscreenElement;
        savePrefs({ fullscreen: on });
        const done = on ? document.documentElement.requestFullscreen({ navigationUI: 'hide' }) : document.exitFullscreen();
        void done.catch(() => {}).finally(() => this.settings(back));
      } });
    }
    items.push({ label: 'Back', action: back });
    this.menu.settings(this.audio, items, back, (music, sfx) => savePrefs({ music, sfx }));
  }

  // --- story ----------------------------------------------------------------------------------------------

  private async story(from: number): Promise<void> {
    this.menu.close();
    this.titleSpin = false;
    this.mode = 'story';
    const d = this.director;
    d.quit = false;
    for (let i = from; i < CHAPTERS.length; i++) {
      this.save.chapter = i;
      this.save.unlocked = Math.max(this.save.unlocked, i);
      writeSave(this.save);
      d.skipping = false;
      d.clearCast();
      this.r.post.settings.flashback = 0;
      d.flashback(false);
      d.letterbox(true);
      console.log(`chapter ${i} start at ${d.time.toFixed(0)}s: ${CHAPTERS[i].title}`);
      (window as unknown as { __chapter: number }).__chapter = i;
      await CHAPTERS[i].run(d);
      console.log(`chapter ${i} end at ${d.time.toFixed(0)}s`);
      if (d.quit) {
        d.quit = false;
        await d.fade(true, 0.4);
        await d.fade(false, 0.1);
        await this.title();
        return;
      }
    }
    this.save.chapter = 0;
    this.save.unlocked = CHAPTERS.length - 1;
    writeSave(this.save);
    d.letterbox(false);
    console.log('story complete');
    (window as unknown as { __storyDone: boolean }).__storyDone = true;
    this.credits(() => void this.title());
  }

  /** The credits roll over an ink handscroll of the story's places (vbStylize calligraphy mode 3). */
  private credits(onDone: () => void): void {
    const ps = this.r.post.settings;
    ps.callMode = 3;
    ps.callProgress = 0;
    ps.callAmount = 1;
    ps.callSeed = 0.37;
    this.menu.credits(() => {
      ps.callMode = 0;
      onDone();
    });
  }

  private async freeBattle(a: string, b: string, stage: string): Promise<void> {
    this.menu.close();
    this.titleSpin = false;
    this.mode = 'battle';
    const d = this.director;
    d.clearCast();
    d.letterbox(false);
    d.flashback(false);
    await d.setStage(stage);
    d.music(d.stage!.def.music === 'calm' ? 'battle' : d.stage!.def.music);
    const res = await d.battle({
      player: 'p1', intro: 'FIGHT', introSub: '決',
      fighters: [
        { id: 'p1', model: a, kit: a, team: 0, pos: [0, -4], energy: 60, domain: 40 },
        { id: 'p2', model: b, kit: b, team: 1, pos: [0, 4], ai: 'rival', energy: 60, domain: 30 },
      ],
    });
    void res;
    await d.fade(true, 0.6);
    await d.fade(false, 0.1);
    if (!this.test) await this.title();
  }

  private retryPrompt(): Promise<'retry' | 'quit'> {
    if (this.test) return Promise.resolve('retry');
    return new Promise((resolve) => {
      this.menu.list('Defeated', [
        { label: 'Try again', action: () => {
          this.menu.close();
          resolve('retry');
        } },
        { label: 'Quit to title', action: () => {
          this.menu.close();
          resolve('quit');
        } },
      ], () => {
        this.menu.close();
        resolve('retry');
      }, false);
    });
  }

  // --- frame ---------------------------------------------------------------------------------------------------

  update(dt: number): void {
    this.input.update(dt);
    // the on-screen controls: sticks and buttons in a fight, tap-to-advance in a cutscene, nothing in a menu
    const fight = this.director.fight;
    const scene: TouchScene = this.menu.open || this.paused || this.mode === 'title' ? 'none' : fight && !fight.result ? 'fight' : 'cutscene';
    this.touch.sync(dt, scene, fight?.player ?? null);
    if (this.touch.enabled && this.touch.portrait && scene !== 'none') this.wantPause = true;
    // (nothing to pause at a menu or the title: forget the request rather than pausing the story that starts next)
    if (this.menu.open || this.mode === 'title') this.wantPause = false;
    const ps = this.r.post.settings;
    if (this.titleSpin && ps.callMode === 1) ps.callProgress = Math.min(1, ps.callProgress + dt / 2.6);
    else if (ps.callMode === 1) ps.callMode = 0;
    // the credits' handscroll unrolls over seventy seconds
    if (ps.callMode === 3) ps.callProgress = Math.min(1, ps.callProgress + dt / 70);
    if (this.menu.open) {
      this.menu.nav(this.input.wasPressed('up', 0.01), this.input.wasPressed('down', 0.01), this.input.wasPressed('confirm', 0.01) && !this.titleSpin ? true : this.input.wasPressed('confirm', 0.01),
        this.input.wasPressed('back', 0.01));
      for (const a of ['up', 'down', 'confirm', 'back'] as const) this.input.consume(a);
    } else if ((this.input.wasPressed('pause', 0.01) || this.wantPause) && this.mode !== 'title') {
      this.input.consume('pause');
      this.wantPause = false;
      this.paused = true;
      this.menu.pause([
        { label: 'Resume', action: () => this.resume() },
        { label: 'Skip scene', disabled: !!this.director.fight, action: () => {
          this.director.skipping = true;
          this.resume();
        } },
        { label: 'Settings', action: () => this.settings(() => this.resume()) },
        { label: 'Quit to title', action: () => {
          this.resume();
          this.director.quit = true;
          this.director.skipping = true;
          if (this.director.fight) this.director.fight.result = 'lose';
        } },
      ], () => this.resume());
    }
    // the frame behind the pause menu softens into an ink wash (real time: the game is stopped)
    ps.pause += ((this.paused ? 1 : 0) - ps.pause) * Math.min(1, dt * 6);
    if (this.paused) return;
    this.director.update(dt);
    this.director.domainUpdate();
  }

  private resume(): void {
    this.menu.close();
    this.paused = false;
    this.input.clear();
  }
}
