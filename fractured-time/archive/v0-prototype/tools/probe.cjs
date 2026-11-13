const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2]; const flags = (process.argv[3] || '').split(' ').filter(Boolean);
  const b = await chromium.launch({ args: flags });
  const p = await b.newPage(); const logs = [];
  p.on('console', m => { if (['error','warning'].includes(m.type())) logs.push(m.text().slice(0,160)); });
  await p.goto(url); await p.waitForFunction(() => window.__probe, null, { timeout: 30000 }).catch(() => {});
  console.log(JSON.stringify(await p.evaluate(() => window.__probe)), '\nlogs:', logs.slice(0,4));
  await b.close();
})();
