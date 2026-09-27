// Headless AI-vs-AI simulation: node tools/sim.cjs "<query>" <seconds>
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [query = 'auto=1', seconds = '240'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:5173/?${query}&quality=low`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const res = await page.evaluate((secs) => {
    const g = window.__game;
    const counts = {};
    const ev = g.world.events;
    for (const k of ['throw','hit','catch','fumble','block','dodge','perfectDodge','pickup','ko','revive','clash','roundEnd','matchEnd','pass']) ev.on(k, (e) => { counts[k] = (counts[k] || 0) + 1; if (k==='catch' && e.perfect) counts.perfectCatch = (counts.perfectCatch||0)+1; });
    let ended = null;
    g.match.onEnd = (r) => { ended = r; };
    const t0 = performance.now();
    g.simulate(secs, 1/60);
    const m = g.match;
    return { ai: window.__aiDebug, wall: ((performance.now()-t0)/1000).toFixed(1), phase: m.phase, round: m.round, score: m.score, total: m.totalTime.toFixed(1), counts, ended,
      athletes: g.world.athletes.map(a => ({ n: a.name, t: a.team, p: a.profile.personality, s: a.state, hp: a.hearts, st: a.stats_ })) };
  }, +seconds);
  console.log(JSON.stringify(res, null, 1));
  console.log(logs.slice(0, 30).join('\n'));
  await browser.close();
})();
