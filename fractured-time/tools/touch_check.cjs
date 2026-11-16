// Touch controls check on an emulated phone (Chromium, landscape, coarse pointer, multi-touch through the DevTools protocol: the
// same path a finger takes, pointer events included).
// Usage: node tools/touch_check.cjs <baseUrl> <outDir>   (baseUrl e.g. http://localhost:5180)
// Checks: the floating stick walks Ethan forward and sprints past its ring, a drag on the right turns the camera, the action
// buttons fire (strike, dodge), an ability button fires, the interact prompt is a button; screenshots of the layout in landscape,
// the rotate hint in portrait and the title menu on a short screen. Prints PASS/FAIL per check.
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const [base = 'http://localhost:5180', out = 'out/touch'] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36' });
  const p = await ctx.newPage();
  const logs = [];
  p.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
  const step = (n) => p.evaluate(async (n) => { for (let i = 0; i < n; i += 10) { window.__game.step(10); await new Promise((r) => setTimeout(r, 0)); } }, n);
  const results = [];
  const check = (name, ok, detail) => { const l = `${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`; results.push(l); console.log(l); };

  // gameplay: Chapter 4's terrace (every ability unlocked), live controls instead of the test harness's scripted ones
  await p.goto(`${base}/?test&chapter=4&quality=performance&fast&touch`);
  await p.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  // test mode reports ready before the chapter's sections have streamed in: wait for them (the real game's loading screen does)
  // (loading advances with the manual loop: step gently in real time until they are in)
  await p.evaluate(async () => { const g = window.__game; const t0 = performance.now();
    while (performance.now() - t0 < 240000) { const c = g.chapter; if (c && c.sections && c.sections.length > 0 && c.current >= 0) return;
      g.step(1); await new Promise((r) => setTimeout(r, 40)); } });
  await p.evaluate(() => { const g = window.__game; g.player.controls = g.live; });
  // the chapter opens with a locked intro (Ethan drops in): wait until he stands, in control
  const ready = await p.evaluate(async () => { const g = window.__game;
    for (let i = 0; i < 300 && (g.player.locked || !g.player.grounded); i++) { g.step(10); await new Promise((r) => setTimeout(r, 15)); }
    return !g.player.locked && g.player.grounded; });
  check('player in control after the intro', ready, '');
  await step(30);
  const sense = () => p.evaluate(() => { const g = window.__game; return { x: g.player.pos.x, z: g.player.pos.z, yaw: g.camera.yaw,
    state: g.player.state, clip: g.player.anim.current, speed: g.player.speed, slow: g.player.slowActive, energy: g.player.energy,
    sprint: g.input.isHeld('sprint'), pr: g.gfx.renderer.getPixelRatio() }; });
  const s0 = await sense();
  check('render resolution', s0.pr > 1.2, `pixel ratio ${s0.pr.toFixed(2)} (render ${Math.round(844 * s0.pr)}x${Math.round(390 * s0.pr)})`);
  await p.screenshot({ path: `${out}/1_landscape.png`, timeout: 300000 });

  // the stick: thumb down on the left, pushed up 45 px, held one second
  await touch('touchStart', [[170, 290, 1]]);
  await touch('touchMove', [[170, 245, 1]]);
  await step(60);
  const s1 = await sense();
  await p.screenshot({ path: `${out}/2_stick.png`, timeout: 300000 });
  const walked = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  check('stick walks', walked > 1.5, `moved ${walked.toFixed(2)} m in 1 s (speed ${s1.speed.toFixed(2)})`);
  // past the ring: sprint
  await touch('touchMove', [[170, 170, 1]]);
  await step(60);
  const s2 = await sense();
  check('stick sprints past its ring', s2.sprint && s2.speed > s1.speed, `sprint held ${s2.sprint}, speed ${s2.speed.toFixed(2)}`);
  // a second thumb drags on the right while the first still steers: the camera turns
  await touch('touchStart', [[170, 170, 1], [560, 160, 2]]);
  for (let k = 1; k <= 6; k++) await touch('touchMove', [[170, 170, 1], [560 + k * 25, 160, 2]]);
  await step(10);
  const s3 = await sense();
  check('drag turns the camera (multi-touch)', Math.abs(s3.yaw - s2.yaw) > 0.3, `yaw ${s2.yaw.toFixed(2)} -> ${s3.yaw.toFixed(2)}`);
  await touch('touchEnd', []);
  await step(30);

  const centre = (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const tap = async (sel, holdTicks = 4) => { const [x, y] = await centre(sel); await touch('touchStart', [[x, y, 7]]); await step(holdTicks); await touch('touchEnd', []); };
  // strike
  await tap('.t-light');
  await step(6);
  const s4 = await sense();
  check('strike button attacks', /attack|light|combo/i.test(s4.state + ' ' + s4.clip), `state ${s4.state}, clip ${s4.clip}`);
  await step(60);
  // dodge
  await tap('.t-dodge');
  await step(4);
  const s5 = await sense();
  check('dodge button dodges', /dodge|roll|evade/i.test(s5.state + ' ' + s5.clip), `state ${s5.state}, clip ${s5.clip}`);
  await step(60);
  // an ability: SLOW (and the slot is what a finger there actually touches)
  const onTop = await p.evaluate(() => { const r = document.querySelector('.hud-abilities .ability').getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.ability') !== null; });
  check('ability slot is on top of the drag surface', onTop, '');
  await tap('.hud-abilities .ability:nth-child(1)');
  await step(10);
  const s6 = await sense();
  check('ability button (slow) fires', s6.slow, `slowActive ${s6.slow}`);
  await p.screenshot({ path: `${out}/3_slow.png`, timeout: 300000 });
  await step(240);
  // the interact prompt is a button while it shows
  const promptOk = await p.evaluate(() => { const g = window.__game; g.hud.setPrompt('[E] Open the door');
    const el = document.querySelector('.prompt'); return getComputedStyle(el).pointerEvents === 'auto' && el.textContent.includes('TAP'); });
  check('interact prompt is a button', promptOk, '');
  await p.evaluate(() => window.__game.hud.setPrompt('[E] Open the door'));
  await p.screenshot({ path: `${out}/4_prompt.png`, timeout: 300000 });

  // portrait: the rotate hint (the first tap took the page fullscreen: leave it to resize)
  const fs_ = await p.evaluate(() => !!document.fullscreenElement);
  console.log(`INFO  fullscreen after the first tap: ${fs_} (headless Chromium does not reliably treat a synthetic touch as a user gesture)`);
  await p.evaluate(() => document.exitFullscreen?.().catch(() => {}));
  await p.waitForTimeout(300);
  await p.setViewportSize({ width: 390, height: 844 });
  await step(2);
  const rot = await p.evaluate(() => getComputedStyle(document.querySelector('.t-rotate')).display);
  check('portrait asks for landscape', rot === 'flex', `display ${rot}`);
  await p.screenshot({ path: `${out}/5_portrait.png`, timeout: 300000 });

  // the title menu on a phone in landscape
  await p.setViewportSize({ width: 844, height: 390 });
  await p.goto(`${base}/`, { timeout: 180000 });
  await p.waitForFunction(() => window.__ready, null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  const fits = await p.evaluate(() => [...document.querySelectorAll('.menu-item')].every((e) => e.getBoundingClientRect().bottom <= innerHeight));
  check('title menu fits a phone', fits, '');
  await p.screenshot({ path: `${out}/6_title.png`, timeout: 300000 });

  if (logs.length) console.log('console:\n  ' + [...new Set(logs)].slice(0, 8).join('\n  '));
  await b.close();
})();
