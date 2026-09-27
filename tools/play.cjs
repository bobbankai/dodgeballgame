// Usage: node tools/play.cjs <url> <outPrefix> <shots> <intervalMs> [w] [h] [evalScript]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [url, prefix, shots = '3', interval = '2000', w = '1280', h = '720', evalJs = ''] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(url, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }); } catch { logs.push('[timeout] not ready'); }
  if (evalJs) { try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerr] ' + e.message); } }
  for (let i = 0; i < +shots; i++) {
    await page.waitForTimeout(+interval);
    await page.screenshot({ path: `${prefix}${i}.png` });
    const st = await page.evaluate(() => { const g = window.__game; if (!g) return null; const m = g.match; return { fps: g.renderer ? Math.round(window.__game.hud ? 0 : 0) : 0, phase: m?.phase, round: m?.round, score: m?.score, t: m?.roundTime?.toFixed(1), ath: g.world.athletes.map(a => `${a.name}:${a.state}:${a.hearts}${a.ball ? '*' : ''}`).join(' ') }; }).catch(e => 'err ' + e.message);
    logs.push(`[state ${i}] ` + JSON.stringify(st));
  }
  console.log(logs.join('\n'));
  await browser.close();
})();
