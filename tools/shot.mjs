// node tools/shot.mjs <url> <out.png> [width] [height] [waitMs] — screenshot the game with software WebGL
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const [url, out, w = '1280', h = '720', wait = '1500'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => logs.push('[timeout] not ready'));
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 300000 });
console.log(logs.slice(0, 20).join('\n'));
await browser.close();
