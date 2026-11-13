// Usage: node tools/shot.cjs "<url>" <out.png> [webgpu|webgl] [width] [height] [waitMs]
// Chromium (webgpu: headful under Xvfb): "webgpu" uses SwiftShader's software Vulkan adapter, "webgl" lets WebGPURenderer fall back to WebGL2.
const { chromium } = require('playwright');
(async () => {
  const [url, out, mode = 'webgpu', w = '960', h = '540', wait = '1500'] = process.argv.slice(2);
  const args = mode === 'webgpu'
    ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist']
    : ['--use-angle=swiftshader', '--ignore-gpu-blocklist'];
  // WebGPU presentation needs a real compositor: run headful under Xvfb (xvfb-run -a node tools/shot.cjs ...).
  const b = await chromium.launch({ args, headless: mode !== 'webgpu' });
  const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
  const logs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 900)); });
  p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 400)));
  await p.goto(url);
  const t0 = Date.now();
  await p.waitForFunction(() => window.__probe && (window.__probe.rendered || window.__probe.error), null, { timeout: 120000 }).catch(() => {});
  await p.waitForTimeout(+wait);
  await p.screenshot({ path: out });
  const probe = await p.evaluate(() => JSON.stringify(window.__probe || {}));
  console.log(probe, '\nelapsed ms:', Date.now() - t0);
  const uniq = [...new Set(logs)].filter((l) => !/GPU stall|ReadPixels|GL Driver/.test(l));
  if (uniq.length) console.log('console:\n  ' + uniq.slice(0, 30).join('\n  '));
  await b.close();
})();
