// node tidebreakers/tools/playtime.mjs <url> <outDir> [maxGameMinutes]
// Plays the whole story with the play-bot (src/test/PlayBot.ts: real controls, human reading pace, deaths
// and retries) in headless Chromium and reports how long each level and checkpoint took in game time.
// The url should start the story, e.g. http://localhost:5190/?test&level=prologue. Progress is printed
// every 30 game seconds; a screenshot is saved every few minutes and the final report goes to
// <outDir>/playtime.json. Use a static build (the dev server reloads the page when sources change).
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, outDir, maxMin = '150'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.evaluate(() => { window.__playbot = true; });
const t0 = Date.now();
let step = 0;
for (;;) {
  const err = await page.evaluate(async () => { try { await window.__advance(30); } catch (e) { return String(e.stack || e); } return null; });
  if (err) errors.push(err);
  step++;
  const s = await page.evaluate(() => {
    const f = window.__flow, k = window.__kai, b = window.__bot, g = window.__game;
    const r = b ? b.report() : null;
    return { level: f.levelId, at: f.at, playMin: r ? r.totalMin : 0, hp: Math.round(k.hp), state: k.state, fight: g.combatActive,
      enemies: g.enemies().length, finished: f.finished, credits: f.inCredits, line: window.__ui.line ? window.__ui.line.text.slice(0, 40) : null };
  });
  console.log(`${step} wall ${((Date.now() - t0) / 60000).toFixed(1)}m ` + JSON.stringify(s));
  if (step % 8 === 0) {
    await page.evaluate(() => window.__frame && window.__frame());
    await page.screenshot({ path: `${outDir}/s${String(step).padStart(3, '0')}.png`, timeout: 600000 }).catch(() => {});
  }
  if (s.finished || step * 0.5 > +maxMin) break;
}
const report = await page.evaluate(() => window.__bot.report());
report.errors = errors.slice(0, 50);
fs.writeFileSync(`${outDir}/playtime.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
