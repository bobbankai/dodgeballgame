// Usage: node tools/shot.cjs <url> <out.png> [width] [height] [waitMs]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const [url, out, w = '1280', h = '720', wait = '0'] = process.argv.slice(2);
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  } catch (e) {
    logs.push('[timeout] __ready not set');
  }
  if (+wait) await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  console.log(logs.join('\n'));
  await browser.close();
})();
