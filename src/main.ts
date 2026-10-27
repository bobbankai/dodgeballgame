import '@fontsource/patrick-hand/400.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/700.css';
import { Game } from './game/Game';
import { MarginVillage } from './levels/MarginVillage';
import { Playground } from './levels/Playground';

const params = new URLSearchParams(location.search);
const game = new Game(document.getElementById('app')!);
const w = window as unknown as Record<string, unknown>;
w.__game = game;

await game.init();
await game.loadLevel(params.get('level') === 'playground' ? new Playground() : new MarginVillage(params.get('at') ?? 'arrival'));
// ?test: no frame loop; tools/play.mjs steps the game itself at a fixed rate
if (params.has('test')) {
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
