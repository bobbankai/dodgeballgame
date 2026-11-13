#!/usr/bin/env node
/**
 * Touch-control test on an emulated phone (real multi-touch through the DevTools protocol).
 *
 *   node eclipse/tools/touch.mjs <base url, e.g. http://127.0.0.1:5181/> <outDir> [width] [height]
 *
 * Loads the playground with a thrall, then checks each control the way a thumb would use it: the
 * floating stick moves Kael (and pushing to the rim sprints), a drag on the right turns the camera,
 * the buttons act, the ability slots appear as abilities are unlocked and cast when tapped, and
 * holding the phone upright shows the "turn your device" note and pauses. Prints one PASS/FAIL line
 * per check and saves screenshots to <outDir>. Software rendering: timings mean nothing.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const [base, outDir, w = '844', h = '390'] = process.argv.slice(2);
if (!base || !outDir) {
  console.error('usage: touch.mjs <base url> <outDir> [width] [height]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const W = +w;
const H = +h;

const flags = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
  '--disable-vulkan-surface', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: flags });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const cdp = await ctx.newCDPSession(page);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const shot = (name) => page.screenshot({ path: path.join(outDir, name + '.png') });
const advance = async (seconds, chunk = 0.1) => {
  for (let t = 0; t < seconds - 1e-6; t += chunk) await page.evaluate((d) => window.__game.advance(d), Math.min(chunk, seconds - t));
};
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
const centre = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
}, sel);
const pos = () => page.evaluate(() => { const p = window.__game.player.position; return [p.x, p.y, p.z]; });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

await page.goto(`${base}?test&nointro&quality=low&level=playground&enemies=thrall`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000, polling: 500 });
await page.evaluate(() => { window.__game.player.stats.maxHealth = 1e6; window.__game.player.stats.health = 1e6; for (const e of window.__game.enemies.list) e.dormant = true; });
await advance(1);

check('touch overlay is on', await page.evaluate(() => document.querySelector('.ec-touch')?.classList.contains('on') === true));
check('no abilities yet: no ability buttons shown', (await page.evaluate(() => [...document.querySelectorAll('.ec-abilities .ec-slot')].filter((s) => s.offsetParent && getComputedStyle(s).display !== 'none').length)) === 0);
await shot('1_idle');

// --- every action button exists, is on screen and is big enough to hit
const need = { b_light: '.b-light', b_heavy: '.b-heavy', b_dodge: '.b-dodge', b_block: '.b-block', b_jump: '.b-jump', b_lock: '.b-lock', b_heal: '.b-heal', b_pause: '.b-pause' };
const small = [];
for (const [k, sel] of Object.entries(need)) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, sel);
  if (!r || r.x < 0 || r.y < 0 || r.x + r.w > W || r.y + r.h > H || Math.min(r.w, r.h) < 38) small.push(k + (r ? ` ${Math.round(r.w)}x${Math.round(r.h)} at ${Math.round(r.x)},${Math.round(r.y)}` : ' missing'));
}
check('all action buttons are on screen and at least 38 px', small.length === 0, small.join('; '));

// --- floating stick: drag up = forward
const start = await pos();
await touch('touchStart', [[110, 280]]);
await touch('touchMove', [[110, 240]]);
await advance(1.0);
const mid = await pos();
const mv = await page.evaluate(() => ({ ...window.__game.input.touchMove, sprint: window.__game.input.down?.('sprint') }));
await touch('touchEnd', []);
check('stick drag moves Kael', dist(start, mid) > 0.8, `moved ${dist(start, mid).toFixed(2)} m, stick y=${mv.y.toFixed(2)}`);
await advance(0.5);
const rest = await pos();
await advance(0.5);
check('releasing the stick stops him', dist(rest, await pos()) < 0.25);

// --- pushing to the rim sprints (faster than a walk)
const s0 = await pos();
await touch('touchStart', [[110, 300]]);
await touch('touchMove', [[110, 190]]);
await advance(1.0);
const s1 = await pos();
await touch('touchEnd', []);
check('stick pushed to the rim sprints', dist(s0, s1) > dist(start, mid) * 1.25, `${dist(s0, s1).toFixed(2)} m vs ${dist(start, mid).toFixed(2)} m`);

// --- look drag on the right
const yaw0 = await page.evaluate(() => window.__game.rig.yaw ?? window.__game.rig.alpha ?? 0);
await touch('touchStart', [[560, 120]]);
for (let i = 1; i <= 10; i++) {
  await touch('touchMove', [[560 + i * 14, 120]]);
  await advance(0.05);
}
await touch('touchEnd', []);
const yaw1 = await page.evaluate(() => window.__game.rig.yaw ?? window.__game.rig.alpha ?? 0);
check('a drag on the right turns the camera', Math.abs(yaw1 - yaw0) > 0.05, `yaw ${yaw0.toFixed?.(2)} -> ${yaw1.toFixed?.(2)}`);

// --- stick and look at the same time (two thumbs)
const m0 = await pos();
const yawA = await page.evaluate(() => window.__game.rig.yaw ?? window.__game.rig.alpha ?? 0);
await touch('touchStart', [[110, 280], [560, 120]]);
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [[110, 230], [560 + i * 12, 120]]);
  await advance(0.1);
}
await touch('touchEnd', []);
const yawB = await page.evaluate(() => window.__game.rig.yaw ?? window.__game.rig.alpha ?? 0);
check('two thumbs at once: moving and looking together', dist(m0, await pos()) > 0.5 && Math.abs(yawB - yawA) > 0.05);

// --- buttons: Strike attacks, Dodge dodges, Jump leaves the ground
const press = async (sel, hold = 0.12) => { const c = await centre(sel); await touch('touchStart', [c]); await advance(hold, 0.04); await touch('touchEnd', []); };
await advance(0.6);
await press('.b-light');
await advance(0.1, 0.05);
check('Strike starts an attack', await page.evaluate(() => /attack|light|combo|strike/i.test(String(window.__game.player.state))), await page.evaluate(() => String(window.__game.player.state)));
await advance(1.5);
await press('.b-dodge');
await advance(0.1, 0.05);
check('Dodge starts a dodge', await page.evaluate(() => /dodge|roll/i.test(String(window.__game.player.state))), await page.evaluate(() => String(window.__game.player.state)));
await advance(1.2);
const y0 = (await pos())[1];
await press('.b-jump', 0.1);
let top = y0;
for (let i = 0; i < 6; i++) { await advance(0.08, 0.04); top = Math.max(top, (await pos())[1]); }
check('Jump leaves the ground', top - y0 > 0.15, `+${(top - y0).toFixed(2)} m`);
await advance(1.0);

// --- abilities appear as they are unlocked, and a tap casts
await page.evaluate(() => { window.__game.flow.claimSpark('ignaroth'); window.__game.flow.claimSpark('thaloryn'); });
await advance(0.6);
const slots = await page.evaluate(() => [...document.querySelectorAll('.ec-abilities .ec-slot')].map((s) => ({ shown: getComputedStyle(s).display !== 'none', empty: s.classList.contains('empty') })));
check('unlocked abilities show as buttons (two sparks)', slots.filter((s) => !s.empty).length >= 2, JSON.stringify(slots.map((s) => (s.empty ? 0 : 1))));
await shot('2_abilities');
const slot = await centre('.ec-abilities .ec-slot:not(.empty)');
await page.evaluate(() => { const st = window.__game.player.stats; st.aether = st.maxAether ?? 100; });
const aether0 = await page.evaluate(() => window.__game.player.stats.aether);
if (slot) {
  await touch('touchStart', [slot]);
  await advance(0.15, 0.05);
  await touch('touchEnd', []);
  await advance(0.4, 0.1);
}
const aether1 = await page.evaluate(() => window.__game.player.stats.aether);
const cast = await page.evaluate(() => { const p = window.__game.player; const a = p.abilities[0]; return { name: a?.name, cost: a?.cost, cooling: a ? a.ready > p.now : null, state: String(p.state) }; });
check('tapping an ability button casts it', aether1 < aether0 || cast.cooling === true, `aether ${aether0.toFixed?.(0)} -> ${aether1.toFixed?.(0)}, ${JSON.stringify(cast)}`);
check('ability buttons are at least 44 px', !slot || (await page.evaluate(() => { const e = document.querySelector('.ec-abilities .ec-slot:not(.empty)'); const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) >= 44; })));
check('ability buttons clear the action pad', await page.evaluate(() => {
  const pad = document.querySelector('.ec-touch .pad').getBoundingClientRect();
  return [...document.querySelectorAll('.ec-abilities .ec-slot:not(.empty)')].every((e) => e.getBoundingClientRect().right < pad.left + 20);
}));

// --- pause button opens the pause menu; the menu takes taps
await press('.b-pause');
await advance(0.3);
check('Pause opens the pause menu', await page.evaluate(() => window.__game.flow.menus.open));
await shot('3_pause');
const resume = await page.evaluate(() => { const n = [...document.querySelectorAll('.ec-menu .item')].find((e) => /resume/i.test(e.textContent)); if (!n) return null; const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
if (resume) { await touch('touchStart', [resume]); await touch('touchEnd', []); await advance(0.3); }
check('tapping Resume closes it', !(await page.evaluate(() => window.__game.flow.menus.open)));

// --- turned upright: the note appears and the game pauses
await page.setViewportSize({ width: H, height: W });
await page.waitForTimeout(400);
await advance(0.3);
const rot = await page.evaluate(() => ({ note: document.querySelector('.ec-rotate')?.classList.contains('on'), paused: window.__game.paused, menu: window.__game.flow.menus.open,
  mq: matchMedia('(orientation: portrait)').matches, size: [innerWidth, innerHeight], touchOn: document.documentElement.classList.contains('ec-touch-on') }));
check('upright: "turn your device" note shows and the game pauses', rot.note && rot.paused, JSON.stringify(rot));
await shot('4_portrait');
await page.setViewportSize({ width: W, height: H });
await advance(0.3);
check('sideways again: the note is gone', !(await page.evaluate(() => document.querySelector('.ec-rotate')?.classList.contains('on'))));
await shot('5_back');

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | ').slice(0, 200));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
