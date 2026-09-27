// Plays the campaign in order with an AI stand-in for the player, applying real rewards,
// spending attribute points and buying skills between matches. Reports attempts per match.
// Usage: node tools/career_sim.cjs [tier=3] [maxAttempts=4] [fromId]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [tier = '3', maxAttempts = '4'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`[console] ${m.text()}`); });
  await page.goto(process.env.SIM_URL || 'http://localhost:5173/?quality=low', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const ids = await page.evaluate(async () => {
    const c = await import('/src/data/campaign.ts');
    return c.MATCHES.map((m) => m.id);
  });
  await page.evaluate(() => {
    const d = window.__app.save.data;
    d.newGame = false;
    d.tutorialDone = true;
    d.campaign.completed['m1-1'] = { stars: 3, bestTime: 0, wins: 1 };
  });
  for (const id of ids) {
    if (id === 'm1-1') continue;
    let attempts = 0;
    let line = null;
    while (attempts < +maxAttempts) {
      attempts++;
      line = await page.evaluate(async ({ id, tier }) => {
        const app = window.__app;
        const g = window.__game;
        const prog = app.prog;
        const d = prog.d;
        const sk = await import('/src/data/skills.ts');
        const st = await import('/src/game/Stats.ts');
        // spend: attributes round-robin weighted to catching/power/evasion, skills cheapest first
        const order = ['catching', 'power', 'evasion', 'agility', 'release', 'accuracy', 'stamina', 'control', 'special'];
        let guard = 0;
        while (d.attrPoints > 0 && guard++ < 200) {
          const k = order.reduce((b, k) => (d.attributes[k] < d.attributes[b] ? k : b), order[0]);
          if (!prog.raise(k)) break;
        }
        for (let pass = 0; pass < 3; pass++) for (const s of [...sk.SKILLS].sort((a, b) => a.cost - b.cost)) if (prog.canBuy(s).ok) prog.buy(s);
        // the stand-in "improves" over the campaign like a human would: tier 3 -> 4 -> 5
        const ch = +id.slice(1, 2);
        if (!prog.__origProfile) prog.__origProfile = prog.playerProfile.bind(prog);
        prog.playerProfile = () => ({ ...prog.__origProfile(), tier: ch >= 6 ? 5 : ch >= 4 ? 4 : 3 });
        const m = window.__debugStart(id, true);
        const pl = g.world.athletes.find((a) => a.team === 0);
        if (pl && pl.controller && pl.controller.params) pl.controller.params = { ...pl.controller.params };
        let res = null;
        const prevEnd = m.onEnd;
        m.onEnd = (x) => { res = x; };
        g.simulate(600, 1 / 60);
        const cfg = m.config;
        let out = { id, won: res ? res.won : null, score: m.score.join('-'), t: Math.round(m.totalTime), lvl: d.level, cred: d.cred, attrs: Object.values(d.attributes).reduce((a, b) => a + b, 0), skills: d.skills.length };
        if (res) {
          const sum = prog.computeRewards(cfg, res);
          prog.applyRewards(cfg, res, sum);
          if (res.won && id === 'm4-3') d.ultimateUnlocked = true;
        }
        g.endMatch();
        return out;
      }, { id, tier: +tier });
      if (line.won) break;
    }
    console.log(JSON.stringify({ ...line, attempts }));
    if (!line.won) { console.log('STUCK at', id); break; }
  }
  console.log(errs.slice(0, 10).join('\n'));
  await browser.close();
})();
