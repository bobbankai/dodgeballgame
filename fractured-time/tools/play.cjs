// Usage: xvfb-run -a node tools/play.cjs "<url>" <outDir> '<json steps>' [webgpu|webgl] [w] [h]
// Steps: [{ "do": "js run in page (has __game)", "step": ticks, "shot": "name", "log": "js expr to print" }, ...]
// The game runs in ?test mode: the loop is manual, so "step" advances the fixed simulation deterministically and renders one frame.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [url, outDir, stepsJson = '[]', mode = 'webgpu', w = '960', h = '540'] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const args = mode === 'webgpu'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  const b = await chromium.launch({ args, headless: mode !== 'webgpu' });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const logs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 600)));
  p.on('response', (r) => { if (r.status() >= 400) logs.push('http ' + r.status() + ' ' + r.url()); });
  await p.goto(url);
  await p.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
  const err = await p.evaluate(() => window.__error);
  if (err) { console.log('BOOT ERROR:', err); }
  else for (const [i, s] of JSON.parse(fs.existsSync(stepsJson) ? fs.readFileSync(stepsJson, 'utf8') : stepsJson).entries()) {
    if (s.do) { const r = await p.evaluate(async (code) => { try { return await (new Function('g', 'return (async()=>{' + code + '})()'))(window.__game); } catch (e) { return 'ERR ' + e; } }, s.do); if (r !== undefined && r !== null) console.log(`[${i}] do ->`, JSON.stringify(r)); }
    if (s.step) await p.evaluate((n) => window.__game.step(n), s.step);
    if (s.log) console.log(`[${i}] ${s.log} =`, JSON.stringify(await p.evaluate((c) => { try { return (new Function('g', 'return ' + c))(window.__game); } catch (e) { return 'ERR ' + e; } }, s.log)));
    if (s.shot) await p.screenshot({ path: `${outDir}/${s.shot}.png`, timeout: 300000 });
  }
  const uniq = [...new Set(logs)].filter((l) => !/GPU stall|ReadPixels|GL Driver|PCFSoftShadowMap/.test(l));
  if (uniq.length) console.log('console:\n  ' + uniq.slice(0, 14).join('\n  '));
  await b.close();
})();
