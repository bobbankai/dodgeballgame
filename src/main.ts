import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import './ui/styles.css';
import { Game } from './core/Game';
import { KITS, filler, makeProfile } from './data/roster';
import type { MatchConfig } from './game/Match';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const quality = (params.get('quality') as any) || 'high';
const game = new Game(app, quality);

async function boot() {
  await document.fonts.ready.catch(() => {});
  const debug = params.get('debug');
  if (debug === 'match' || !debug) {
    const tier = Number(params.get('tier') ?? 2);
    const n = Number(params.get('n') ?? 3);
    const player = makeProfile({ id: 'player', name: 'Ace', kit: KITS.player, personality: 'balanced', tier: 3, hair: 'swept', number: 7, perks: { perfectCatch: true, curve: true, fake: true, perfectDodge: true, counterThrow: true } });
    const home = [player, ...Array.from({ length: n - 1 }, (_, i) => filler(KITS.player, i, tier, i % 2 ? 'defender' : 'aggressor', 3))];
    const away = Array.from({ length: n }, (_, i) => filler(KITS.harbor, i, tier, (['aggressor', 'sniper', 'defender', 'speedster'] as const)[i % 4], 1));
    const config: MatchConfig = {
      id: 'debug',
      title: 'Debug Match',
      subtitle: 'HARBOR',
      mode: 'elimination',
      arena: params.get('arena') ?? 'rec',
      home,
      away,
      roundsToWin: 2,
      ballCount: n + 1,
      timeLimit: 100,
      tier,
      reward: { xp: 0, cred: 0 },
      playerControlled: params.get('auto') !== '1',
    };
    game.startMatch(config);
    game.beginMatch();
  }
  game.start();
  (window as any).__ready = true;
}

boot();
