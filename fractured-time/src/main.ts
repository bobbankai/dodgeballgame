import '@/ui/hud.css';
import { Game } from '@/game';
import type { QualityName } from '@/rendering/quality';
import { ScriptedControls } from '@/player/controls';
import { timeScale } from '@/core/loop';

declare global {
  interface Window { __game?: Game; __ready?: boolean; __error?: string; __sc?: ScriptedControls; __ts?: typeof timeScale }
}

async function boot() {
  const qs = new URLSearchParams(location.search);
  const test = qs.has('test');
  const canvas = document.createElement('canvas');
  canvas.id = 'game';
  document.body.appendChild(canvas);
  const q = (qs.get('quality') as QualityName | null) ?? undefined;
  const game = await Game.create(canvas, { quality: q, test });
  window.__game = game;

  if (test) {
    // tests drive the player through scripted controls (deterministic, no keyboard)
    const sc = new ScriptedControls();
    game.player.controls = sc;
    window.__sc = sc;
    window.__ts = timeScale;
    game.loop.manual = true;
    game.loop.start();
    game.runScript();
    window.__ready = true;
    return;
  }
  const start = document.createElement('div');
  start.className = 'start';
  start.innerHTML = '<div><h1>FRACTURED TIME</h1><p>CLICK TO BEGIN</p></div>';
  start.addEventListener('click', () => {
    start.remove();
    game.input.lock();
    game.start();
  });
  document.body.appendChild(start);
  game.frame(1, 1 / 60);
  window.__ready = true;
}

boot().catch((e) => {
  window.__error = String((e && (e.stack || e)) || e);
  console.error(e);
});
