// node tidebreakers/tools/cutscenes.mjs <url> <outDir> [maxGameSeconds] [width] [height]
// Cutscene review: plays a level with the test autoplay (it walks to objectives and ends fights) and takes one
// screenshot partway through every dialogue line, so each shot of every conversation can be checked on a
// contact sheet. Writes <outDir>/NNN.png and <outDir>/lines.json ([file, speaker line, level, game time]).
// The url should include ?test&level=<id> (and &at=<beat> to start later in the chapter).
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, outDir, maxT = '900', w = '480', h = '270'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
// lines advance on their own after 2 s; a shot is taken 0.9 s into each line (after its cut has settled)
await page.evaluate(() => { window.__autoplay = true; window.__flow.ui.autoAdvance = 2.0; });
const startLevel = await page.evaluate(() => window.__flow.level?.id ?? null);
const out = [];
let t = 0, last = '', since = 0, shot = true, n = 0;
const STEP = 0.3;
while (t < +maxT) {
  await page.evaluate(async (s) => { await window.__advance(s, false); }, STEP);
  t += STEP;
  const st = await page.evaluate(() => ({ line: window.__flow.ui.line?.text ?? '', level: window.__flow.level?.id ?? null, credits: !!window.__flow.inCredits }));
  if (st.level !== startLevel || st.credits) break;
  if (st.line && st.line !== last) { last = st.line; since = 0; shot = false; }
  since += STEP;
  if (st.line && !shot && since >= 0.9) {
    shot = true;
    const file = String(n++).padStart(3, '0') + '.png';
    await page.evaluate(() => window.__frame && window.__frame());
    await page.screenshot({ path: `${outDir}/${file}` });
    out.push([file, st.line.slice(0, 90), st.level, +t.toFixed(1)]);
    fs.writeFileSync(`${outDir}/lines.json`, JSON.stringify(out, null, 1));
  }
}
console.log(`${n} lines captured in ${t.toFixed(0)} game s; errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
await browser.close();
