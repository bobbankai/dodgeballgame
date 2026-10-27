// node tools/play.mjs <url> <outDir> '<script json>' [width] [height]
// Steps the game deterministically (url must include ?test) while holding keys, taking screenshots.
// script: [{ "keys": ["KeyW"], "t": 1.0, "shot": "name", "eval": "js" }, ...]
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, outDir, script, w = '960', h = '540'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }).catch(() => logs.push('[timeout] not ready'));
const held = new Set();
for (const step of JSON.parse(script)) {
  const keys = new Set(step.keys ?? []);
  for (const k of held) if (!keys.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  if (step.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(step.eval)));
  if (step.t) await page.evaluate((t) => window.__advance(t), step.t);
  if (step.shot) await page.screenshot({ path: `${outDir}/${step.shot}.png`, timeout: 300000 });
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
