// node vowbreaker/tools/play.mjs <url> <outDir> '<script json>' [width] [height]
// Steps the game deterministically (url must include ?test) on WebGPU (SwiftShader) while holding
// keys and taking screenshots. script: [{ "keys": ["KeyW"], "t": 1.0, "shot": "name", "eval": "js" }]
import { createRequire } from 'module';
import fs from 'fs';
import { spawn } from 'child_process';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, script = '[]', w = '960', h = '540'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
// WebGPU canvases only present in a headed browser here: run it on a private virtual display, with
// SwiftShader's Vulkan backend behind WebGPU.
let xvfb = null;
let display = process.env.DISPLAY;
if (!display) {
  const n = 90 + Math.floor(Math.random() * 400);
  xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  display = `:${n}`;
  await new Promise((r) => setTimeout(r, 600));
}
const browser = await chromium.launch({
  headless: false,
  env: { ...process.env, DISPLAY: display },
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
    '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--disable-gpu-watchdog', '--ignore-gpu-blocklist', `--window-size=${w},${h}`],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 }).catch(() => logs.push('[timeout] not ready'));
logs.push(`[ready] ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
  if (step.shot) await page.screenshot({ path: `${outDir}/${step.shot}.png`, timeout: 600000 });
}
console.log(logs.slice(0, 80).join('\n'));
await browser.close();
if (xvfb) xvfb.kill();
