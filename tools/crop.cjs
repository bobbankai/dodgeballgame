// node tools/crop.cjs <in.png> <out.png> x y w h [scale=2] — zoomed crop for close inspection
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [inp, out, x, y, w, h, scale = '2'] = process.argv.slice(2);
  const s = +scale;
  const b64 = fs.readFileSync(inp).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: Math.round(+w * s), height: Math.round(+h * s) } });
  await page.setContent(`<body style="margin:0;overflow:hidden"><img src="data:image/png;base64,${b64}" style="position:absolute;left:${-x * s}px;top:${-y * s}px;transform-origin:0 0;transform:scale(${s})"></body>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: out });
  await browser.close();
})();
