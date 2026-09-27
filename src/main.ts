import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './ui/styles.css';
import { App } from './App';
import { detailTexturesReady } from './character/DetailTextures';
import { propKitReady } from './levels/PropKit';
import { KITS, filler, makeProfile } from './data/roster';
import type { MatchConfig } from './game/Match';
import { h } from './ui/dom';

const params = new URLSearchParams(location.search);
const container = document.getElementById('app')!;

function loadingScreen() {
  const bar = h('div');
  const msg = h('div', { class: 'msg' }, 'Loading');
  const el = h('div', { class: 'loading' }, h('div', { class: 'logo' }, h('div', { class: 'l1', style: 'font-size:84px' }, 'Overthrow')), h('div', { class: 'bar' }, bar), msg);
  document.body.appendChild(el);
  return {
    set(p: number, m: string) {
      bar.style.width = `${Math.round(p * 100)}%`;
      msg.textContent = m;
    },
    done() {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 700);
    },
  };
}

async function boot() {
  const ld = loadingScreen();
  await document.fonts.ready.catch(() => {});
  ld.set(0.1, 'Starting engine');
  await new Promise((r) => setTimeout(r, 30));
  const app = new App(container);
  const debug = params.get('debug');
  if (debug === 'match') {
    // Direct-to-match developer entry: ?debug=match&tier=3&n=3&arena=rec&auto=1
    await Promise.all([detailTexturesReady(), propKitReady()]);
    const g = app.game;
    const tier = Number(params.get('tier') ?? 2);
    const n = Number(params.get('n') ?? 3);
    const player = makeProfile({ id: 'player', name: 'Ace', kit: KITS.player, personality: 'balanced', tier: 3, hair: 'swept', number: 7, perks: { perfectCatch: true, curve: true, fake: true, perfectDodge: true, counterThrow: true } });
    const home = [player, ...Array.from({ length: n - 1 }, (_, i) => filler(KITS.player, i, tier, i % 2 ? 'defender' : 'aggressor', 3))];
    const away = Array.from({ length: n }, (_, i) => filler(KITS.harbor, i, tier, (['aggressor', 'sniper', 'defender', 'speedster'] as const)[i % 4], 1));
    const config: MatchConfig = {
      id: 'debug', title: 'Debug Match', subtitle: 'HARBOR', mode: 'elimination', arena: params.get('arena') ?? 'rec', home, away,
      roundsToWin: 2, ballCount: n + 1, timeLimit: 100, tier, reward: { xp: 0, cred: 0 }, playerControlled: params.get('auto') !== '1',
    };
    g.startMatch(config);
    g.beginMatch();
    g.start();
    app.mode = 'match';
    ld.done();
  } else {
    await app.boot((p, m) => ld.set(p, m));
    ld.done();
  }
  (window as any).__ready = true;
}

boot();
