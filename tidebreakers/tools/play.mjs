// node tidebreakers/tools/play.mjs <url> <outDir> '<script json>' [width] [height]
// Runs the game in headless Chromium with a software WebGPU adapter (SwiftShader) and steps it
// deterministically. The url should include ?test so the game exposes window.__advance.
// script: [{ "keys": ["KeyW"], "t": 1.0, "shot": "name", "eval": "js" }, ...]
//   keys  held during the step (released when a later step omits them)
//   eval  JS evaluated in the page before the step's wait (result logged)
//   t     game seconds to advance (fixed 1/60 steps)
//   shot  screenshot name written to <outDir>/<shot>.png after the step
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, outDir, script = '[]', w = '960', h = '540'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 }).catch(() => logs.push('[timeout] not ready'));
const held = new Set();
for (const step of JSON.parse(script)) {
  const keys = new Set(step.keys ?? []);
  for (const k of held) if (!keys.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  if (step.eval) {
    try { logs.push('[eval] ' + JSON.stringify(await page.evaluate(step.eval))); } catch (e) { logs.push('[eval error] ' + e.message); }
  }
  if (step.t) {
    const err = await page.evaluate(async ([t, r]) => { try { await window.__advance(t, r); } catch (e) { return String(e.stack || e); } return null; }, [step.t, step.render ?? !!step.shot]);
    if (err) logs.push('[error] ' + err);
  }
  if (step.shot) {
    await page.evaluate(() => window.__frame && window.__frame());
    await page.screenshot({ path: `${outDir}/${step.shot}.png`, timeout: 600000 });
  }
}
console.log(logs.slice(0, 80).join('\n'));
await browser.close();
