import * as THREE from 'three';
import { Pipeline } from './render/Pipeline';
import { initialQuality, QUALITY } from './render/Quality';
import { Game, type Level } from './game/Game';
import { Menu, loadSettings, type Settings } from './ui/Menu';
import { LEVELS, CHAPTER_ORDER } from './levels';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');

const canvas = document.getElementById('game') as HTMLCanvasElement;
const settings = loadSettings(initialQuality());
if (params.get('quality')) settings.quality = initialQuality();
const pipe = new Pipeline(canvas, settings.quality);
const game = new Game(pipe, canvas, TEST);
window.addEventListener('resize', () => pipe.resize());

function applySettings(s: Settings): void {
  if (pipe.quality.name !== s.quality) {
    pipe.setQuality(s.quality);
    game.particles.scale = QUALITY[s.quality].particleScale;
  }
  game.audio.volumes.music = s.music;
  game.audio.volumes.sfx = s.sfx;
  game.audio.applyVolumes();
  game.cam.sensitivity = s.sensitivity;
  game.input.invertY = s.invertY;
  pipe.motionBlur.strength = s.motionBlur ? 0.5 : 0;
  game.hud.stats.style.display = s.stats ? 'block' : 'none';
}

async function startLevel(id: string, checkpoint: string | null): Promise<void> {
  menu.hide();
  await game.audio.start();
  const L = LEVELS[id];
  if (!L) throw new Error('no level ' + id);
  const level: Level = L();
  game.paused = false;
  await game.loadLevel(level, checkpoint);
}

const menu = new Menu({
  newGame: () => void startLevel(CHAPTER_ORDER[0], null),
  continueGame: () => { const s = Game.loadSave(); if (s) { game.player.artsUnlocked = s.arts; game.player.maxHp = s.maxHp ?? 100; game.player.maxHeals = s.heals ?? 3; void startLevel(s.level, s.checkpoint); } },
  hasSave: () => !!Game.loadSave(),
  chapters: () => {
    const s = Game.loadSave();
    const reached = s ? CHAPTER_ORDER.indexOf(s.level) : 0;
    return CHAPTER_ORDER.map((id, i) => ({ id, title: LEVELS[id]().title, unlocked: TEST || i <= Math.max(0, reached) }));
  },
  startChapter: (id) => {
    const i = CHAPTER_ORDER.indexOf(id);
    game.player.artsUnlocked = Math.min(3, Math.max(1, i + 1));
    // the Heart Forge's reward carries into the last chapter
    game.player.maxHp = i >= 4 ? 125 : 100;
    game.player.maxHeals = i >= 4 ? 4 : 3;
    void startLevel(id, null);
  },
  resume: () => { menu.hide(); game.paused = false; canvas.requestPointerLock?.(); },
  restartCheckpoint: () => { menu.hide(); game.paused = false; if (game.level) void game.loadLevel(game.level, game.checkpoint); },
  quitToTitle: () => { game.paused = false; game.unloadLevel(); game.level = null; void game.audio.playMusic('title', 2); menu.title(); },
  applySettings,
}, settings);
game.onChapterComplete = (id) => {
  const i = CHAPTER_ORDER.indexOf(id);
  const next = CHAPTER_ORDER[i + 1];
  if (next) { game.checkpoint = null; void startLevel(next, null); }
  else { game.unloadLevel(); game.level = null; menu.credits(() => menu.title()); }
};
game.onPause = () => {
  if (!game.level || menu.mode !== 'off') return;
  game.paused = true;
  document.exitPointerLock?.();
  menu.pause();
};

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShow = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  game.update(dt);
  const focus = game.player ? game.player.body.pos : pipe.camera.position;
  if (!game.level) titleCamera(dt);
  pipe.render(game.paused ? 0 : dt, focus);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsShow = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  if (settings.stats) {
    const r = pipe.renderer.info.render;
    game.hud.stats.textContent = `${fpsShow.toFixed(0)} fps  gpu ${pipe.gpu.supported ? pipe.gpu.ms.toFixed(1) + 'ms' : 'n/a'}\nscale ${(pipe.scale * 100).toFixed(0)}%  ${pipe.quality.name}\ncalls ${r.calls}  tris ${(r.triangles / 1000).toFixed(0)}k`;
  }
  requestAnimationFrame(frame);
}

let titleT = 0;
function titleCamera(dt: number): void {
  titleT += dt;
  const c = pipe.camera;
  c.position.set(Math.sin(titleT * 0.03) * 18, 4 + Math.sin(titleT * 0.05) * 0.6, Math.cos(titleT * 0.03) * 18);
  c.lookAt(0, 2, 0);
}

declare global {
  interface Window { __ready?: boolean; __advance?: (t: number, render?: boolean) => Promise<void>; __game?: Game; __pipe?: Pipeline; THREE?: typeof THREE }
}

async function boot(): Promise<void> {
  await game.createPlayer();
  applySettings(settings);
  if (TEST) {
    pipe.adaptive = false;
    window.__game = game;
    window.__pipe = pipe;
    window.THREE = THREE;
    const level = params.get('level') ?? CHAPTER_ORDER[0];
    const at = params.get('at');
    game.paused = false;
    const L = LEVELS[level]();
    let loaded = false;
    game.loadLevel(L, at).then(() => { loaded = true; }).catch((e) => console.error(e));
    // headless stepping: simulate every step, render only the last few (software GL is slow)
    window.__advance = async (t: number, render = true) => {
      const step = 1 / 30;
      const n = Math.max(1, Math.round(t / step));
      for (let i = 0; i < n; i++) {
        game.update(step);
        if (render && i >= n - 3) pipe.render(step, game.player.body.pos);
        else pipe.lighting.update(step, game.player.body.pos);
        // let story scripts (promise continuations) run between frames, as they do in the real loop
        if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
      }
    };
    // wait for the level to finish loading (fade-in starts once it has)
    const t0 = performance.now();
    while (!loaded) {
      await new Promise((r) => setTimeout(r, 200));
      if (performance.now() - t0 > 120000) break;
    }
    await new Promise((r) => setTimeout(r, 500));
    window.__ready = true;
    return;
  }
  menu.title();
  const start = () => { void game.audio.start().then(() => game.audio.playMusic('title', 3)); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
  void game.hud.fade(0, 2);
  requestAnimationFrame(frame);
}

void boot();
