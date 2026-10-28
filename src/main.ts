import '@fontsource/patrick-hand/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import * as THREE from 'three';
import { Flow } from './game/Flow';
import { Game } from './game/Game';
import { Attic } from './levels/Attic';
import { FoldedSea } from './levels/FoldedSea';
import { MarginVillage } from './levels/MarginVillage';
import { Playground } from './levels/Playground';
import { UnfinishedPage } from './levels/UnfinishedPage';

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('app')!);
const w = window as unknown as Record<string, unknown>;
w.__game = game;

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
