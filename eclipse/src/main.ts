import { Game } from './game/Game';
import { log, recentErrors } from './core/Log';
import './ui/styles.css';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;

window.addEventListener('error', (e) => log.error('uncaught', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => log.error('unhandled rejection', e.reason));

Game.create(canvas, params)
  .then((game) => {
    if (params.has('test')) {
      Object.assign(window, { __game: game, __errors: recentErrors });
    }
  })
  .catch((err) => {
    log.error('startup failed', err);
    const box = document.getElementById('fatal');
    if (box) {
      box.textContent = `Eclipse: Fallen Gods could not start. ${err instanceof Error ? err.message : String(err)}`;
      box.style.display = 'flex';
    }
  });
