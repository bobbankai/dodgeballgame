import { audio } from '../audio/Audio';
import { Attic } from '../levels/Attic';
import { FoldedSea } from '../levels/FoldedSea';
import { MarginVillage } from '../levels/MarginVillage';
import { UnfinishedPage } from '../levels/UnfinishedPage';
import type { Game, Level } from './Game';

export type Chapter = 'prologue' | 'village' | 'sea' | 'page' | 'epilogue';

interface Save {
  chapter: Chapter;
  at: string;
}

const KEY = 'inkbound.save.v1';

const CREDITS: [string, string][] = [
  ['', 'Inkbound'],
  ['A story drawn in pencil', ''],
  ['Ada', 'who finished it'],
  ['Pip', 'the best bit'],
  ['The Keeper', 'who waited'],
  ['Mum', 'who drew all of it'],
  ['', ''],
  ['Made with', 'three.js and Blender'],
  ['Every model, rig, animation and level', 'built from code'],
  ['', ''],
  ['', 'For everyone with a page they keep putting off.'],
];

function readSave(): Save | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return s && typeof s.chapter === 'string' ? s : null;
  } catch {
    return null;
  }
}

function writeSave(s: Save) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode: no saving, the game still plays */
  }
}

/** Title screen, chapters in order, saving at checkpoints, and the pause menu. */
export class Flow {
  private chapter: Chapter = 'prologue';
  private busy = false;

  constructor(private game: Game) {
    game.onCheckpoint = (at) => writeSave({ chapter: this.chapter, at });
    game.onPause = () => this.pause();
    window.addEventListener('chapter-complete', (e) => this.chapterComplete((e as CustomEvent<number>).detail));
  }

  /** Show the title over the attic, then start or continue. */
  async title() {
    const g = this.game;
    const attic = new Attic();
    attic.titleMode = true;
    await g.loadLevel(attic);
    g.director.begin(false);
    g.ui.fade(1, 0.01, '#120f14');
    g.ui.fade(0, 2.0);
    const save = readSave();
    const items = [{ id: 'begin', label: save ? 'Begin again' : 'Begin' }];
    if (save) items.unshift({ id: 'continue', label: 'Continue' });
    const choice = await g.ui.menu('Inkbound', 'a story drawn in pencil', items, 'Best with sound. Click the page to look around with the mouse.');
    audio.unlock();
    if (choice === 'continue' && save) {
      await g.ui.fade(1, 0.8);
      await this.play(save.chapter, save.at);
      return;
    }
    attic.titleMode = false;
    g.director.end();
    this.chapter = 'prologue';
    writeSave({ chapter: 'prologue', at: 'start' });
    await attic.begin();
    await attic.finished;
    await this.play('village', 'arrival');
  }

  async play(chapter: Chapter, at: string): Promise<void> {
    const g = this.game;
    this.chapter = chapter;
    let level: Level;
    if (chapter === 'prologue') {
      const a = new Attic();
      level = a;
      await g.loadLevel(level);
      g.ui.fade(0, 1);
      a.begin();
      await a.finished;
      return this.play('village', 'arrival');
    }
    if (chapter === 'epilogue') {
      writeSave({ chapter, at: 'start' });
      return this.epilogue();
    }
    level = chapter === 'sea' ? new FoldedSea(at) : chapter === 'page' ? new UnfinishedPage(at) : new MarginVillage(at);
    writeSave({ chapter, at });
    await g.loadLevel(level);
    if (at !== 'arrival') g.ui.fade(0, 1.2);
  }

  private async chapterComplete(chapter: number) {
    const g = this.game;
    // each chapter runs straight on into the next; the last page leads out of the book
    if (chapter === 1) return this.play('sea', 'arrival');
    if (chapter === 2) return this.play('page', 'arrival');
    if (chapter === 3) return this.play('epilogue', 'start');
    await g.ui.fade(1, 1);
    await this.title();
  }

  /** Morning in the attic, and then the credits. Back to the title after. */
  private async epilogue() {
    const g = this.game;
    this.chapter = 'epilogue';
    const attic = new Attic();
    attic.morning = true;
    await g.loadLevel(attic);
    await attic.epilogue();
    await g.ui.credits(CREDITS);
    writeSave({ chapter: 'epilogue', at: 'done' });
    await g.ui.fade(1, 1.5, '#120f14');
    await this.title();
  }

  private async pause() {
    const g = this.game;
    if (this.busy || g.paused || g.ui.inMenu || !g.level || g.level.name === 'attic' && g.director.cutscene) return;
    this.busy = true;
    g.paused = true;
    g.input.releaseLock();
    const c = await g.ui.menu('', 'Paused', [
      { id: 'resume', label: 'Resume' },
      { id: 'title', label: 'Quit to title' },
    ]);
    g.paused = false;
    this.busy = false;
    if (c === 'title') {
      await g.ui.fade(1, 0.6);
      await this.title();
    }
  }
}
