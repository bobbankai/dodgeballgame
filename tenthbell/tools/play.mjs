// node tenthbell/tools/play.mjs <url> <outDir> '<script json>' [width] [height]
// Steps the game deterministically (url must include ?test) on headless WebGPU (SwiftShader), holding keys
// and taking screenshots. script: [{ "keys": ["KeyD"], "t": 1.0, "shot": "name", "eval": "js" }, ...]
// A step's eval runs before its wait. Add &gl to the url to test the WebGL2 fallback.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, outDir, script, w = '960', h = '540'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=SkiaGraphite', '--enable-skia-graphite', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.addInitScript(() => {
  if (!globalThis.GPUAdapter) return;
  const rd = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (d) {
    const dev = await rd.call(this, d);
    dev.lost.then((i) => console.error('GPU device lost: ' + i.reason + ' ' + i.message));
    dev.addEventListener('uncapturederror', (e) => console.error('GPU error: ' + e.error.message.slice(0, 700)));
    return dev;
  };
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: +(process.env.READY_MS ?? 240000) }).catch(() => logs.push('[timeout] not ready'));
const held = new Set();
try {
for (const step of JSON.parse(script)) {
  const keys = new Set(step.keys ?? []);
  for (const k of held) if (!keys.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of keys) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  if (step.eval) logs.push('[eval] ' + JSON.stringify(await page.evaluate(step.eval)));
  if (step.t) {
    const err = await page.evaluate(async ([t]) => { try { await window.__advance(t); } catch (e) { return String(e.stack || e); } return null; }, [step.t]);
    if (err) logs.push('[error] ' + err);
  }
  if (step.shot) { await page.evaluate(() => window.__settle()); await page.screenshot({ path: `${outDir}/${step.shot}.png`, timeout: 300000 }); }
}
} catch (e) { logs.push('[runner] ' + String(e).split('\n')[0]); }
console.log(logs.slice(0, 80).join('\n'));
await browser.close();
