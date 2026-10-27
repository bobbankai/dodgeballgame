import { Game } from './game/Game';
import { Playground } from './levels/Playground';

const game = new Game(document.getElementById('app')!);
const w = window as unknown as Record<string, unknown>;
w.__game = game;

await game.init();
await game.loadLevel(new Playground());
// ?test: no frame loop; tools/play.mjs steps the game itself at a fixed rate
if (new URLSearchParams(location.search).has('test')) {
  w.__advance = (seconds: number, fps = 30) => {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) game.step(1 / fps, i === n - 1);
  };
} else game.start();
w.__ready = true;
