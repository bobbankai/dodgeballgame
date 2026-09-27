const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const ids = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
  await page.goto('http://localhost:5173/?quality=low', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  for (const id of ids) {
    const r = await page.evaluate((id) => {
      try {
        const g = window.__game;
        const counts = {};
        const unsub = [];
        for (const k of ['throw','hit','catch','ko','ultimateStart','ability','revive','shockwave']) unsub.push(g.world.events.on(k, () => counts[k] = (counts[k]||0)+1));
        const m = window.__debugStart(id, true);
        let res = null; m.onEnd = (x) => res = x;
        g.simulate(420, 1/60);
        unsub.forEach(u => u());
        const out = { id, phase: m.phase, score: m.score, rounds: m.round, t: m.totalTime.toFixed(0), won: res && res.won, waves: m.wavesCleared, counts };
        g.endMatch();
        return out;
      } catch (e) { return { id, error: e.message + '\n' + e.stack }; }
    }, id);
    console.log(JSON.stringify(r));
  }
  console.log(errs.slice(0, 10).join('\n'));
  await browser.close();
})();
