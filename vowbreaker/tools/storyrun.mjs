// node vowbreaker/tools/storyrun.mjs <url> <outDir> [maxGameSeconds] [fromChapter]
// Plays the whole story headless (url should carry ?test&auto, no chapter): advances game time in
// chunks, screenshots every chunk group, prints chapter progress, fight times and every error.
// The software GPU the tests run on crashes now and then; when the browser goes down the run starts
// a fresh one at the chapter it was in (that chapter replays from its start), so one crash doesn't
// end the run. At the end it prints each chapter's length in game time and the total.
import { createRequire } from 'module';
import fs from 'fs';
import { spawn } from 'child_process';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, maxT = '6000', from = '0'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });

const lengths = {};     // chapter -> game seconds
const fights = [];      // [chapter, line]
let chapter = +from;
let shot = 0;
let total = 0;
let crashes = 0;
const t0 = Date.now();

async function session(startChapter) {
  const n = 600 + Math.floor(Math.random() * 300);
  const xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 600));
  const browser = await chromium.launch({ headless: false, logger: { isEnabled: () => false, log: () => {} }, env: { ...process.env, DISPLAY: `:${n}` },
    args: ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--disable-gpu-watchdog', '--window-size=960,540'] });
  let starts = {};
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('console', (m) => {
      const t = m.text();
      let g;
      if ((g = /^chapter (\d+) start at (\d+)s/.exec(t))) starts[+g[1]] = +g[2];
      if ((g = /^chapter (\d+) end at (\d+)s/.exec(t)) && starts[+g[1]] !== undefined) lengths[+g[1]] = +g[2] - starts[+g[1]];
      if (/^fight /.test(t)) fights.push([chapter, t]);
      if (/chapter|story|fight |error|Error|failed|warn/i.test(t) && !/BJS - .*Babylon/.test(t)) console.log(`[${m.type()}] ${t.slice(0, 300)}`);
    });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 6).join(' | ')));
    await page.goto(`${url}&chapter=${startChapter}`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
    let t = 0;
    while (total < +maxT) {
      const done = await page.evaluate(() => !!window.__storyDone);
      if (done) return true;
      await page.evaluate(async () => { await window.__advance(2, false); });
      t += 2;
      total += 2;
      chapter = await page.evaluate(() => window.__chapter ?? 0);
      if (t % 20 === 0) {
        await page.evaluate(async () => { await window.__advance(0.02, true); });
        await page.screenshot({ path: `${outDir}/s${String(shot++).padStart(3, '0')}_c${chapter}.png`, timeout: 600000 });
      }
    }
    return true;
  } catch (e) {
    crashes++;
    console.log(`[crash] ${String(e.message).split('\n')[0]} in chapter ${chapter}; restarting there`);
    return false;
  } finally {
    await browser.close().catch(() => {});
    xvfb.kill();
  }
}

while (!(await session(chapter))) {
  if (crashes > 12) { console.log('[giving up] too many crashes'); break; }
}
const sum = Object.values(lengths).reduce((a, b) => a + b, 0);
console.log(`ran ${total}s of game time in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${crashes} browser crash(es)`);
for (const [c, s] of Object.entries(lengths)) console.log(`  chapter ${c}: ${(s / 60).toFixed(1)} min`);
for (const [c, f] of fights) console.log(`  [ch ${c}] ${f}`);
console.log(`story length (auto-play): ${(sum / 60).toFixed(1)} min over ${Object.keys(lengths).length} chapters`);
