import '@fontsource/patrick-hand/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import * as THREE from 'three';
import { isTouchDevice, TouchControls } from './core/Touch';
import { Flow } from './game/Flow';
import { Game } from './game/Game';
import { audio } from './audio/Audio';
import { speech } from './audio/Speech';
import { G } from './render/Globals';
import { Attic } from './levels/Attic';
import { FoldedSea } from './levels/FoldedSea';
import { MarginVillage } from './levels/MarginVillage';
import { Playground } from './levels/Playground';
import { UnfinishedPage } from './levels/UnfinishedPage';

// if anything stops the game starting, say so on the page (a blank screen tells nobody anything)
function showError(msg: string) {
  let el = document.getElementById('boot-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-error';
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;padding:10px 12px;background:#2a2428;color:#f4eedc;font:13px/1.4 sans-serif;border-radius:8px;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = `Something went wrong starting the game:\n${msg}`;
}
window.addEventListener('error', (e) => showError(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => showError(String((e.reason as Error)?.message ?? e.reason)));

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('app')!);
if (isTouchDevice()) {
  try {
    new TouchControls(game.input);
  } catch (e) {
    console.error('touch controls', e);
  }
}
const w = window as unknown as Record<string, unknown>;
w.__game = game;
w.__G = G;
w.__audio = audio;
w.__speech = speech;

await game.init();
const flow = new Flow(game);
// ?level=... and ?at=... jump straight in (development and testing)
const level = params.get('level');
if (level === 'playground') await game.loadLevel(new Playground());
else if (level === 'sea') await game.loadLevel(new FoldedSea(params.get('at') ?? 'arrival'));
else if (level === 'page') await game.loadLevel(new UnfinishedPage(params.get('at') ?? 'arrival'));
else if (level === 'epilogue') void flow.play('epilogue', 'start');
else if (level === 'attic') {
  const a = new Attic();
  await game.loadLevel(a);
  a.begin();
} else if (params.has('at')) await game.loadLevel(new MarginVillage(params.get('at')!));
else flow.title();

// ?test: no frame loop; tools/play.mjs steps the game itself at a fixed rate
if (params.has('test')) {
  w.THREE = THREE;
  // recorded voices pace the words in real time; tests step game time, so they babble unless asked
  speech.enabled = false;
  w.__advance = async (seconds: number, fps = 30) => {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) {
      game.step(1 / fps, i === n - 1);
      // let story scripts (promises) run between frames, as they would in the real loop
      await new Promise((r) => setTimeout(r, 0));
    }
  };
} else game.start();
w.__ready = true;
