// node tools/drive.cjs <url> <script.js> [outDir]: run a test script against the game (helpers: p, adv(t), hold(keys, t), ev(fn, arg), shot(name), log).
// Story regression: node tools/drive.cjs 'http://localhost:4180/?test' tools/storybot.js (serve a separate build: editing sources reloads the dev server).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const [url, scriptPath, outDir = 'story-out'] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const logs = [];
  p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  p.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && logs.push('CONSOLE ' + m.type() + ' ' + m.text()));
  const pre = process.env.PRE;
  if (pre) {
    await p.goto(url.split('?')[0]);
    await p.evaluate(pre);
  }
  await p.goto(url);
  await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const adv = (t) => p.evaluate(async (t) => { try { await window.__advance(t); } catch (e) { return String(e.stack || e); } }, t).then((e) => e && logs.push('ADVERR ' + e));
  const hold = async (keys, t) => { for (const k of keys) await p.keyboard.down(k); await adv(t); for (const k of keys) await p.keyboard.up(k); };
  const ev = (f, a) => p.evaluate(f, a);
  const shot = (n) => p.screenshot({ path: `${outDir}/${n}.png`, timeout: 300000 });
  const log = (...a) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
  const body = fs.readFileSync(scriptPath, 'utf8');
  try {
    await new Function('p', 'adv', 'hold', 'ev', 'shot', 'log', `return (async () => { ${body} })()`)(p, adv, hold, ev, shot, log);
  } catch (e) {
    logs.push('SCRIPT ' + (e.stack || e));
  }
  console.log(logs.slice(0, 40).join('\n'));
  await b.close();
})();
