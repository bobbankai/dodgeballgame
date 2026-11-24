// The whole game from the title screen to the credits: chapter order, loading and tearing down levels,
// saves and checkpoints (localStorage), death and retry, the pause menu, chapter select.
import { Vector3 } from '@babylonjs/core';
import type { Renderer } from './render/Renderer';
import type { Game } from './game/Game';
import type { UI } from './ui/UI';
import type { Audio } from './audio/Audio';
import type { Input } from './core/Input';
import type { PlayerController } from './game/Player';
import { EnvKit } from './world/World';
import { brains } from './game/Spawn';
import type { Level, Ctx, FlowApi } from './levels/Level';
import { Prologue } from './levels/Prologue';
import { GullsRest } from './levels/GullsRest';
import { Ashport } from './levels/Ashport';
import { DrownedMarket } from './levels/DrownedMarket';
import { WeepingShoals } from './levels/WeepingShoals';
import { SunkenCrown } from './levels/SunkenCrown';
import { Epilogue } from './levels/Epilogue';

export const ORDER = ['prologue', 'gulls', 'ashport', 'market', 'shoals', 'crown', 'epilogue'] as const;
export type LevelId = typeof ORDER[number];

const MAKE: Record<LevelId, (c: Ctx) => Level> = {
  prologue: (c) => new Prologue(c),
  gulls: (c) => new GullsRest(c),
  ashport: (c) => new Ashport(c),
  market: (c) => new DrownedMarket(c),
  shoals: (c) => new WeepingShoals(c),
  crown: (c) => new SunkenCrown(c),
  epilogue: (c) => new Epilogue(c),
};

export const TITLES: Record<LevelId, string> = {
  prologue: 'Prologue — The Lantern', gulls: '1 — Gull\'s Rest', ashport: '2 — Ashport', market: '3 — The Drowned Market',
  shoals: '4 — The Weeping Shoals', crown: '5 — The Sunken Crown', epilogue: 'Epilogue — The Wake',
};

interface SaveData { level: LevelId; at: string; reached: number; flags: Record<string, boolean> }
const KEY = 'tidebreakers.save.v1';

export class Flow implements FlowApi {
  level: Level | null = null;
  levelId: LevelId | null = null;
  flags: Record<string, boolean> = {};
  props: EnvKit;
  private lastAt = '';
  private deathT = 0;
  private loading = false;
  paused = false;
  test = false;
  inCredits = false;
  finished = false;

  constructor(readonly r: Renderer, readonly game: Game, readonly ui: UI, readonly audio: Audio, readonly input: Input, readonly pc: PlayerController) {
    this.props = new EnvKit(r);
  }

  get isLoading(): boolean { return this.loading; }
  /** the checkpoint (beat) the current level was last saved at */
  get at(): string { return this.lastAt; }

  async init(): Promise<void> {
    await this.props.load('assets/env/props.glb');
  }

  // ------------------------------------------------------------------------------------------ saves
  private read(): SaveData | null {
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) as SaveData : null; } catch { return null; }
  }

  save(level: string, at: string): void {
    this.lastAt = at;
    const prev = this.read();
    const idx = ORDER.indexOf(level as LevelId);
    const data: SaveData = { level: level as LevelId, at, reached: Math.max(prev?.reached ?? 0, idx), flags: this.flags };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode */ }
  }

  // ------------------------------------------------------------------------------------------ menus
  title(): void {
    this.unload();
    this.audio.play('title');
    this.ui.showHud(false);
    const s = this.read();
    this.ui.title(
      () => { this.flags = {}; void this.start('prologue', ''); },
      s ? () => { this.flags = s.flags ?? {}; void this.start(s.level, s.at); } : null,
      () => this.chapters(),
    );
  }

  chapters(): void {
    const s = this.read();
    const reached = s?.reached ?? 0;
    this.ui.menu('Chapters', [
      ...ORDER.map((id, i) => ({ label: TITLES[id], disabled: i > reached && !this.test, action: () => { this.ui.closeMenu(); void this.start(id, ''); } })),
      { label: 'Back', action: () => this.title() },
    ]);
  }

  pause(on: boolean): void {
    if (!this.level || this.loading) return;
    this.paused = on;
    this.game.paused = on;
    if (!on) { this.ui.closeMenu(); return; }
    this.ui.menu('Paused', [
      { label: 'Resume', action: () => this.pause(false) },
      { label: 'Restart from checkpoint', action: () => { this.pause(false); void this.retry(); } },
      { label: `Quality: ${this.r.quality}`, action: () => { const q = this.r.quality === 'high' ? 'medium' : this.r.quality === 'medium' ? 'low' : 'high'; this.r.setQuality(q); this.pause(true); } },
      { label: `Music ${this.audio.volume.music > 0 ? 'on' : 'off'}`, action: () => { this.audio.volume.music = this.audio.volume.music > 0 ? 0 : 0.5; this.audio.setVolumes(); this.pause(true); } },
      { label: 'Quit to title', action: () => { this.pause(false); this.title(); } },
    ]);
  }

  // ------------------------------------------------------------------------------------------ levels
  private unload(): void {
    if (this.level) this.level.dispose();
    this.level = null;
    this.ui.reset();
    this.game.reset();
    brains.clear();
  }

  async start(id: LevelId, at: string): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.paused = false;
    this.game.paused = false;
    this.ui.closeMenu();
    await this.ui.fade(1, 0.4);
    this.unload();
    // Kai: whole again
    const k = this.pc.f;
    k.hp = k.maxHp;
    k.dissolve = 0;
    k.removed = false;
    k.setState('idle');
    k.attack = null;
    k.floorHp = 0;
    k.model.setFx(0, 0);
    k.model.root.setEnabled(true);
    this.pc.enabled = true;
    this.pc.locked = null;
    const level = MAKE[id]({ r: this.r, game: this.game, ui: this.ui, audio: this.audio, input: this.input, pc: this.pc, flow: this });
    this.level = level;
    this.levelId = id;
    await level.load(at);
    this.lastAt = level.startedAt;
    this.save(id, level.startedAt);
    this.loading = false;
    this.deathT = 0;
    void this.ui.fade(0, 0.8);
    const run = level.script(level.startedAt);
    run.then(() => { if (this.level === level) void this.next(); }).catch((e) => console.error(e));
  }

  private async next(): Promise<void> {
    const i = ORDER.indexOf(this.levelId!);
    if (i < ORDER.length - 1) { await this.start(ORDER[i + 1], ''); return; }
    // the end
    this.unload();
    this.ui.showHud(false);
    this.audio.play('lullaby');
    try { const s = this.read(); if (s) localStorage.setItem(KEY, JSON.stringify({ ...s, level: 'epilogue', at: '', reached: ORDER.length - 1 })); } catch { /* */ }
    this.inCredits = true;
    await this.ui.credits(CREDITS);
    this.inCredits = false;
    this.finished = true;
    this.title();
  }

  async retry(): Promise<void> {
    if (!this.levelId) return;
    await this.start(this.levelId, this.lastAt);
  }

  // ------------------------------------------------------------------------------------------ frame
  update(dt: number): void {
    if (this.input.consume('pause')) this.pause(!this.paused);
    if (this.paused || this.loading || !this.level) return;
    if (this.input.consume('confirm') && this.level.dir.cineActive) this.ui.advance();
    this.level.update(dt);
    // Kai down: offer a retry
    const k = this.pc.f;
    if (!k.alive) {
      this.deathT += dt;
      if (this.deathT > 2.2 && this.deathT - dt <= 2.2) {
        this.ui.showHud(false);
        if (this.test) { void this.retry(); return; }
        this.ui.menu('', [
          { label: 'Get back up', action: () => { this.ui.closeMenu(); void this.retry(); } },
          { label: 'Quit to title', action: () => { this.ui.closeMenu(); this.title(); } },
        ], '<div class="defeat">The tide took you</div>');
      }
    }
  }
}

export const CREDITS = [
  '#TIDEBREAKERS', 'The Song Beneath the Sea', '',
  '#Story, design, code, models, animation, shaders, music', 'Built from code: Babylon.js on WebGPU, WGSL, Blender Python', '',
  '#The crew', 'Kai Marlowe', 'Mira Sorrel', 'Bram Oakhart', 'Nell Finch', '',
  '#Remembered', 'Grandma Ines, navigator of the Merry Albatross', 'Seren Marlowe, keeper of the Gull\'s Rest light', 'Teo Sorrel', 'Elias Finch', 'Lissa Vale',
  'and the thirteen of the Merry Albatross', '',
  '#Thank you for sailing with us', 'Find a crew. Don\'t sail alone.',
];

export function v3(x: number, y: number, z: number): Vector3 { return new Vector3(x, y, z); }
