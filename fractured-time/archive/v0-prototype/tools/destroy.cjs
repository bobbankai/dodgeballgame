const { chromium } = require('playwright');
(async () => {
  const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-webgpu-developer-features', '--ignore-gpu-blocklist'];
  const b = await chromium.launch({ args }); const p = await b.newPage({ viewport: { width: 320, height: 180 } });
  await p.addInitScript(() => {
    const d = GPUDevice.prototype.destroy;
    GPUDevice.prototype.destroy = function () { window.__destroyStack = new Error('destroy').stack; return d.apply(this, arguments); };
    window.__navs = [];
    addEventListener('beforeunload', () => window.__navs.push('beforeunload'));
  });
  const logs = []; p.on('console', (m) => logs.push(m.text().slice(0, 200)));
  p.on('framenavigated', (f) => logs.push('NAVIGATED ' + f.url()));
  await p.goto(process.argv[2]);
  await p.waitForTimeout(1500);
  console.log(await p.evaluate(() => JSON.stringify({ stack: window.__destroyStack, probe: window.__probe }, null, 1)));
  console.log(logs.filter((l) => /NAVIGATED|reload|vite|optimiz/i.test(l)).join('\n'));
  await b.close();
})();
