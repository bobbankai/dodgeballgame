#!/usr/bin/env node
/**
 * Headless play harness. Steps the game deterministically in software rendering while holding keys,
 * evaluating JS and taking screenshots.
 *
 *   node eclipse/tools/play.mjs <url> <outDir> '<json steps>' [width] [height] [--gl webgl2|webgpu]
 *
 * <url> should include `?test` (manual time). Each step: {"keys":["KeyW"], "t":1.0, "dt":0.1,
 * "shot":"name", "eval":"js"}. `eval` runs first, then keys are held while `t` seconds pass in
 * chunks of `dt` (one rendered frame per chunk), then the screenshot is taken.
 * Console errors, page errors and failed requests are written to <outDir>/log.txt.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
let backend = 'webgpu';
const gi = args.indexOf('--gl');
if (gi >= 0) {
  backend = args[gi + 1];
  args.splice(gi, 2);
}
const [url, outDir, script = '[]', w = '1280', h = '720'] = args;
if (!url || !outDir) {
  console.error('usage: play.mjs <url> <outDir> <steps-json> [w] [h] [--gl webgl2|webgpu]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const steps = JSON.parse(script.startsWith('@') ? fs.readFileSync(script.slice(1), 'utf8') : script);
const logLines = [];
const logf = (s) => {
  logLines.push(s);
  if (/error|fail/i.test(s)) console.log(s);
};

const flags = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ args: flags });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
page.on('console', (m) => logf(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logf(`[pageerror] ${e.stack || e.message}`));
page.on('requestfailed', (r) => logf(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) logf(`[http ${r.status()}] ${r.url()}`); });

const sep = url.includes('?') ? '&' : '?';
const full = backend === 'webgl2' ? `${url}${sep}gl=webgl2` : url;
const t0 = Date.now();
await page.goto(full, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => window.__ready === true || document.getElementById('fatal')?.style.display === 'flex', null, { timeout: 600000, polling: 500 });
} catch (e) {
  logf('[harness] timed out waiting for __ready');
}
logf(`[harness] ready after ${((Date.now() - t0) / 1000).toFixed(1)}s (${backend})`);

for (const [i, s] of steps.entries()) {
  if (s.eval) {
    try {
      const r = await page.evaluate(s.eval);
      if (r !== undefined) logf(`[eval ${i}] ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    } catch (e) {
      logf(`[eval ${i} error] ${e.message}`);
    }
  }
  for (const k of s.keys ?? []) await page.keyboard.down(k);
  const t = s.t ?? 0;
  const dt = s.dt ?? Math.min(0.1, t || 0.1);
  let left = t;
  while (left > 1e-6) {
    const d = Math.min(dt, left);
    try {
      await page.evaluate((x) => window.__game?.advance(x), d);
    } catch (e) {
      logf(`[advance error] ${e.message.split('\n')[0]}`);
      break;
    }
    left -= d;
  }
  if (!t && s.shot) await page.evaluate(() => window.__game?.advance(1 / 60));
  for (const k of s.keys ?? []) await page.keyboard.up(k);
  if (s.shot) {
    const file = path.join(outDir, `${s.shot}.png`);
    await page.screenshot({ path: file });
    logf(`[shot] ${file}`);
  }
}
const errs = await page.evaluate(() => window.__errors ?? []);
for (const e of errs) logf(`[game error] ${e}`);
fs.writeFileSync(path.join(outDir, 'log.txt'), logLines.join('\n') + '\n');
await browser.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${logLines.length} log lines -> ${outDir}/log.txt`);
