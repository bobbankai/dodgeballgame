// node tools/scenario.cjs <url> <scenario.json>  — steps: [{js, shot?, wait?}]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [url, file, w = '1280', h = '720'] = process.argv.slice(2);
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[T]')) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  for (const s of steps) {
    if (s.js) { try { const r = await page.evaluate(s.js); if (r !== undefined && r !== null) logs.push('[js] ' + JSON.stringify(r)); } catch (e) { logs.push('[jserr] ' + e.message); } }
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.shot) await page.screenshot({ path: s.shot });
  }
  console.log(logs.join('\n'));
  await browser.close();
})();
