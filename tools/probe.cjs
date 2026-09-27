// node tools/probe.cjs <matchId> <runs> <level> — win rate for a match with a progression-appropriate profile
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [id, runs = '6', level = '6'] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  await page.goto(process.env.SIM_URL || 'http://localhost:5173/?quality=low', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  await page.evaluate(async (level) => {
    const prog = window.__app.prog; const d = prog.d;
    const sk = await import('/src/data/skills.ts');
    d.level = level; d.attrPoints = (level - 1) * 2; d.cred = 250 * level;
    const order = ['catching', 'power', 'evasion', 'agility', 'release', 'accuracy', 'stamina', 'control', 'special'];
    let guard = 0;
    while (d.attrPoints > 0 && guard++ < 200) { const k = order.reduce((b, k) => (d.attributes[k] < d.attributes[b] ? k : b), order[0]); if (!prog.raise(k)) break; }
    for (let p = 0; p < 3; p++) for (const s of [...sk.SKILLS].sort((a, b) => a.cost - b.cost)) if (prog.canBuy(s).ok) prog.buy(s);
  }, +level);
  let wins = 0;
  for (let i = 0; i < +runs; i++) {
    const r = await page.evaluate((id) => {
      const g = window.__game; let res = null;
      const hits = [0, 0];
      const u = g.world.events.on('hit', (e) => hits[e.victim.team]++);
      const m = window.__debugStart(id, true); m.onEnd = (x) => (res = x);
      g.simulate(600); u();
      const out = { won: res && res.won, score: m.score.join('-'), t: Math.round(m.totalTime), hitsTaken: hits[0], hitsDealt: hits[1] };
      g.endMatch(); return out;
    }, id);
    if (r.won) wins++;
    console.log(JSON.stringify(r));
  }
  console.log(`${id} @L${level}: ${wins}/${runs}`);
  await browser.close();
})();
