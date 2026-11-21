// node vowbreaker/tools/storyrun.mjs <url> <outDir> [maxGameSeconds]
// Plays the whole story headless (url should carry ?test&auto&chapter=0): advances game time in
// chunks, screenshots every chunk group, prints chapter progress and every error.
import { createRequire } from 'module';
import fs from 'fs';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, maxT = '5000'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const n = 600 + Math.floor(Math.random() * 300);
const xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch({ headless: false, logger: { isEnabled: () => false, log: () => {} }, env: { ...process.env, DISPLAY: `:${n}` },
  args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--window-size=960,540'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => { const t = m.text(); if (/chapter|story|error|Error|failed|warn/i.test(t) && !/BJS - .*Babylon/.test(t)) console.log(`[${m.type()}] ${t.slice(0, 300)}`); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 6).join(' | ')));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
let t = 0;
let shot = 0;
const t0 = Date.now();
while (t < +maxT) {
  const done = await page.evaluate(() => !!window.__storyDone);
  if (done) break;
  await page.evaluate(async () => { await window.__advance(2, false); });
  t += 2;
  if (t % 20 === 0) {
    await page.evaluate(async () => { await window.__advance(0.02, true); });
    const ch = await page.evaluate(() => window.__chapter);
    await page.screenshot({ path: `${outDir}/s${String(shot++).padStart(3, '0')}_c${ch}.png`, timeout: 600000 });
  }
}
console.log(`ran ${t}s of game time in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();
xvfb.kill();
