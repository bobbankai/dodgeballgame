// The whole story, from the title to the credits, by a bot that teleports between beats and finishes the drawings.
// Logs each beat (and STUCK if one never comes); ends with DONE. See tools/drive.cjs.
const T0 = Date.now();
let gameT = 0;
const L = () => ev(() => window.__game.level?.name ?? null);
const state = () => ev(() => { const g = __game, l = g.level; return { lvl: l?.name, t: +g.time.toFixed(1), cut: g.director.cutscene, dlg: g.ui.inDialogue, flags: l?.flags ? [...l.flags] : null, pos: g.player.position.toArray().map((v) => +v.toFixed(1)), input: g.player.inputEnabled }; });
async function until(fn, max = 120, label = '') {
  for (let t = 0; t < max; t += 0.5) {
    if (await ev(fn)) return true;
    await adv(0.5);
  }
  log('STUCK waiting for ' + label, await state());
  await shot('stuck_' + label.replace(/\W+/g, '_'));
  return false;
}
const tp = (name, dx = 0, dz = 0) => ev(([n, dx, dz]) => { const l = __game.level, p = l.at(n); p.x += dx; p.z += dz; __game.player.teleport(p, __game.player.yaw); __game.rig.snap(p); }, [name, dx, dz]);
const fin = (name) => ev((n) => { const l = __game.level; (l.traces ?? new Map()).get(n)?.finish(); }, name);
const flag = (f) => `(() => { const l = __game.level; return !!l?.flags?.has(${JSON.stringify(f)}) && !__game.director.cutscene && !__game.ui.inDialogue; })()`;
const free = '!__game.director.cutscene && !__game.ui.inDialogue && __game.player.inputEnabled';
const beat = async (name) => { log(`[${((Date.now() - T0) / 1000).toFixed(0)}s] ${name}`, await state()); await shot(name); };

await ev(() => { __game.ui.autoAdvance = 0.25; });
// --- title -> prologue
await adv(3);
await beat('title');
await hold(['KeyE'], 0.2);
await until('!__game.director.cutscene && __game.level?.name === "attic" && !__game.ui.inDialogue && __game.player.inputEnabled', 60, 'prologue start');
await beat('attic');
await ev(() => { void __game.level.look('look_window', ['test line']); });
await until(free, 30, 'look');
await ev(() => { void __game.level.openBook(); });
await until('__game.level?.name === "margin_village"', 120, 'to village');
// --- chapter one
await until(`(() => __game.level?.flags?.has("metPip") && ${free})()`, 120, 'intro');
await beat('c1_met_pip');
await tp('cp_bridge_south');
await until(flag('bridgeTalk'), 40, 'bridgeTalk');
await fin('trace_bridge');
await until(flag('bridgeDone'), 30, 'bridgeDone');
await tp('cp_village');
await until(flag('village'), 40, 'villageTalk');
await ev(() => { void __game.level.readNote(__game.level.notes[0]); });
await until(free, 20, 'note');
await fin('trace_stairs');
await until(flag('stairsDone'), 30, 'stairs');
await tp('cp_terrace2');
await until(flag('chase'), 60, 'chase scene');
await beat('c1_chase');
await tp('cp_terrace3');
await until(flag('chaseDone'), 40, 'chase over');
await tp('cp_plateau');
await until(flag('tree'), 60, 'tree scene');
await beat('c1_tree');
for (const b of [1, 2, 3]) await fin('trace_branch' + b);
await until(flag('pigment'), 120, 'pigment scene');
await beat('c1_green');
await ev(() => { void __game.level.readNote(__game.level.notes.find((n) => n.key === 'tree')); });
await until('__game.level?.name === "folded_sea"', 200, 'to sea');
// --- chapter two
await until(`(() => __game.level?.flags?.has("intro") && ${free})()`, 120, 'sea intro');
await beat('c2_intro');
await tp('cp_headland', 0, 3);
await until(flag('metKeeper'), 120, 'meet keeper');
await beat('c2_keeper');
await fin('trace_steps');
await until(flag('keeperUp'), 60, 'keeper flight');
await tp('cp_gallery');
await until(flag('galleryTalk'), 60, 'gallery talk');
await fin('trace_lens');
await until(flag('lit'), 120, 'light scene');
await beat('c2_lit');
await tp('cp_pier');
await until(flag('pierTalk'), 40, 'pier talk');
await fin('trace_boat');
await until(flag('launched'), 90, 'launch');
await beat('c2_sailing');
await ev(() => { const l = __game.level; l.readBottle(l.bottles[0]); });
await until(free, 20, 'bottle');
await ev(() => { const l = __game.level, s = l.at('storm_start'); l.boat.position.set(s.x, 0, s.z - 2); });
await until(flag('storm'), 60, 'storm scene');
await beat('c2_storm');
await adv(3);
await ev(() => { const l = __game.level, s = l.at('island_landing'); l.boat.position.set(s.x, 0, s.z + 25); });
await until(flag('stormOver'), 40, 'storm over');
await ev(() => { const l = __game.level, s = l.at('island_landing'); l.boat.position.set(s.x, 0, s.z + 5); });
await until(flag('landed'), 60, 'landing');
await beat('c2_island');
await fin('trace_label');
await until('__game.level?.name === "unfinished_page"', 240, 'to page');
// --- chapter three
await until(`(() => __game.level?.flags?.has("intro") && ${free})()`, 120, 'page intro');
await beat('c3_intro');
await ev(() => __game.level.paths[0].finish());
await tp('cp_kitchen');
await until(flag('kitchen'), 40, 'kitchen');
await ev(() => { void __game.level.readNote(__game.level.notes[0]); });
await until(free, 20, 'note3');
await ev(() => __game.level.paths[1].finish());
await tp('cp_garden');
await until(flag('chase'), 40, 'garden');
await beat('c3_smudge');
await ev(() => __game.level.paths[2].finish());
await tp('cp_studio');
await until(flag('studio'), 120, 'studio');
await beat('c3_studio');
await ev(() => __game.level.paths[3].finish());
await tp('cp_page');
await until(flag('page'), 120, 'page scene');
await beat('c3_page');
await ev(() => { for (let i = 0; i < 120; i++) __game.level.shadeWith(0.1); });
await until(flag('canDraw'), 240, 'mum');
await beat('c3_after_mum');
await ev(() => { for (let i = 0; i < 130; i++) __game.level.drawPage(0.1); });
await until('__game.level?.name === "attic"', 120, 'to epilogue');
// --- epilogue
await until(free, 60, 'morning');
await beat('epilogue');
await ev(() => { void __game.level.liftSheet(); });
await until(free, 60, 'sheet');
await ev(() => { void __game.level.lastPage(); });
await until('!!document.querySelector(".credits")', 120, 'credits');
await beat('credits');
await until('!!document.querySelector(".menu")', 120, 'back to title');
await beat('title_again');
log('DONE in', ((Date.now() - T0) / 1000).toFixed(0), 's', await state());
