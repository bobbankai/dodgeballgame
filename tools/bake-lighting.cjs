// Bakes each arena's diffuse global illumination with Blender Cycles.
// Needs the dev server running (npm run dev) and Blender (npm run blender:install).
// Usage: node tools/bake-lighting.cjs [arenaIds...] [--samples N] [--max-probes N]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = ['rec', 'school', 'street', 'rooftop', 'underground', 'stadium', 'eclipse'];
const argv = process.argv.slice(2);
const flags = [];
const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags.push(argv[i], argv[++i]);
  else ids.push(argv[i]);
}
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'src/assets/lighting');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gi-'));
const blender = process.env.BLENDER || 'blender';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  for (const id of ids.length ? ids : ALL) {
    const t0 = Date.now();
    // fresh page per arena: writing a bake makes the dev server hot-reload
    await page.goto(process.env.GAME_URL || 'http://localhost:5173/?quality=high', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
    const ex = await page.evaluate(async (id) => {
      const { buildArena } = await import('/src/levels/arenas/index.ts');
      const { QUALITY_PRESETS } = await import('/src/config/quality.ts');
      const { exportArenaForBake } = await import('/src/levels/LightBake.ts');
      const arena = buildArena(id, QUALITY_PRESETS.high);
      arena.batchStatic();
      const e = exportArenaForBake(arena, id);
      arena.dispose();
      const b64 = (a) => {
        const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return btoa(s);
      };
      return { meta: e.meta, pos: b64(e.positions), idx: b64(e.indices) };
    }, id);
    const inPrefix = path.join(tmp, id);
    fs.writeFileSync(inPrefix + '.json', JSON.stringify(ex.meta));
    fs.writeFileSync(inPrefix + '.pos.bin', Buffer.from(ex.pos, 'base64'));
    fs.writeFileSync(inPrefix + '.idx.bin', Buffer.from(ex.idx, 'base64'));
    console.log(`[${id}] exported ${ex.meta.meshes.length} meshes, ${ex.meta.materials.length} materials, ${ex.meta.lights.length} lights`);
    const r = spawnSync(blender, ['-b', '--factory-startup', '-P', path.join(root, 'tools/blender/bake_irradiance.py'), '--', inPrefix, path.join(outDir, id), ...flags], { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
    for (const line of r.stdout.split('\n')) if (line.startsWith('[bake]') || /Error|Traceback/.test(line)) console.log(`[${id}] ${line}`);
    if (r.status !== 0) {
      console.error(`[${id}] blender failed (${r.status})`);
      process.exitCode = 1;
    }
    console.log(`[${id}] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await browser.close();
  if (process.env.KEEP_BAKE_INPUT) console.log('inputs kept in', tmp);
  else fs.rmSync(tmp, { recursive: true, force: true });
})();
