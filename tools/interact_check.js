// Every interactable in the level at the URL: find a spot where it becomes the prompt, stand Ada
// there, and use it the way the phone controls do (the action button: a tap, or a hold for drawing).
//   node tools/drive.cjs 'http://localhost:5173/?test&level=sea&at=pier' tools/interact_check.js
// Prints one line per interactable (OK / FAIL and why) and a summary.
await ev(() => { __game.ui.autoAdvance = 0.2; });
const settle = async (max = 60) => {
  for (let t = 0; t < max; t += 0.5) {
    if (await ev(() => !__game.director.cutscene && !__game.ui.inDialogue && !__game.ui.waitingNote && __game.player.inputEnabled)) return true;
    await adv(0.5);
  }
  return false;
};
await adv(1);
await settle(90);
// optional per-run setup (e.g. show a note that appears late in the story)
const setup = process.env.SETUP;
if (setup) { await ev(setup); await settle(240); }

const found = await ev(([R, step]) => {
  const g = __game, col = g.collision, p0 = g.player.position.clone();
  const its = [...g.interactables].filter((i) => !i.enabled || i.enabled());
  window.__its = its;
  const V = THREE.Vector3, n = new V(), q = new V(), dirv = new V();
  const N = Math.round(R / step), W = 2 * N + 1;
  // every floor in every column, top down (a gallery under a dome, a beach under a pier), with headroom
  const floors = new Array(W * W);
  for (let ix = 0; ix < W; ix++) {
    for (let iz = 0; iz < W; iz++) {
      const x = p0.x + (ix - N) * step, z = p0.z + (iz - N) * step;
      const list = [];
      let top = p0.y + 30;
      for (let layer = 0; layer < 16; layer++) {
        q.set(x, top, z);
        const h = col.groundAt(q, top - (p0.y - 60), n);
        if (h === null) break;
        top = h - 0.8; // (groundAt casts from half a metre above the point it is given)
        if (n.y < 0.57) continue;
        if (col.raycast(new V(x, h + 0.1, z), new V(0, 1, 0), 1.45) !== null) continue;
        list.push(h);
      }
      floors[ix * W + iz] = list;
    }
  }
  // where Ada can get to from where she stands: walk (steps up to 0.4), jump (up to 1.0), drop down
  const key = (ix, iz, k) => (ix * W + iz) * 8 + k;
  // start from every floor near where she stands (she may be on a stair over a gap)
  const startList = floors[N * W + N];
  const seeds = [];
  const rr = Math.ceil(1.0 / step);
  for (let dx = -rr; dx <= rr; dx++) {
    for (let dz = -rr; dz <= rr; dz++) {
      const list = floors[(N + dx) * W + N + dz];
      list?.forEach((h, k) => { if (Math.abs(h - p0.y) < 0.6) seeds.push([N + dx, N + dz, k]); });
    }
  }
  const blocked = (x, y, z, dx, dz) => {
    dirv.set(dx, 0, dz);
    const len = dirv.length() * step;
    dirv.normalize();
    return col.raycast(new V(x, y, z), dirv, len) !== null;
  };
  // walking only first (where a player would stand), then with jumps
  const flood = (maxRise) => {
  const seen = new Set();
  const queue = [];
  for (const sd of seeds) { queue.push(sd); seen.add(key(sd[0], sd[1], sd[2])); }
  while (queue.length) {
    const [ix, iz, k] = queue.pop();
    const h = floors[ix * W + iz][k];
    const x = p0.x + (ix - N) * step, z = p0.z + (iz - N) * step;
    for (const [dx0, dz0] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let dx = dx0, dz = dz0, jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= W || jz >= W) continue;
      // a crack between floorboards lets the probe through: step over an empty column
      if (!floors[jx * W + jz].length) {
        dx *= 2; dz *= 2; jx = ix + dx; jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= W || jz >= W) continue;
      }
      const list = floors[jx * W + jz];
      for (let m = 0; m < list.length; m++) {
        const h2 = list[m], rise = h2 - h;
        if (rise > maxRise || rise < -4) continue;
        if (seen.has(key(jx, jz, m))) continue;
        // a wall in the way (low for a walk, high for a jump)
        if (blocked(x, h + 1.3, z, dx, dz)) continue;
        if (rise <= 0.4 && blocked(x, h + Math.max(0.45, rise + 0.1), z, dx, dz)) continue;
        seen.add(key(jx, jz, m));
        queue.push([jx, jz, m]);
      }
    }
  }
  return seen;
  };
  const walk = flood(0.4), seen = flood(1.0);
  const best = new Map(), any = new Map(), jump = new Map();
  for (let ix = 0; ix < W; ix++) {
    for (let iz = 0; iz < W; iz++) {
      const list = floors[ix * W + iz];
      list.forEach((h, k) => {
        q.set(p0.x + (ix - N) * step, h, p0.z + (iz - N) * step);
        const kk = key(ix, iz, k);
        const target = walk.has(kk) ? best : seen.has(kk) ? jump : any;
        // for each thing in reach: would it be the prompt if Ada stood here facing it? (as Game.interact scores)
        its.forEach((it, i) => {
          const di = it.where(q);
          if (di >= it.reach) return;
          const face = it.at ? Math.atan2(it.at.x - q.x, it.at.z - q.z) : null;
          const fx = face === null ? 0 : Math.sin(face), fz = face === null ? 0 : Math.cos(face);
          const score = (jt) => {
            let sc = jt.where(q);
            if (jt.at && face !== null) {
              const dx = jt.at.x - q.x, dz = jt.at.z - q.z, l = Math.hypot(dx, dz);
              if (l > 0.05) sc += 0.9 * (1 - (dx * fx + dz * fz) / l);
            }
            return sc;
          };
          const mine = score(it);
          const wins = its.every((jt, j) => j === i || jt.where(q) >= jt.reach || score(jt) > mine);
          if (!wins) return;
          const b = target.get(i);
          if (!b || di < b.d) target.set(i, { d: di, p: q.clone(), yaw: face });
        });
      });
    }
  }
  // (reached by jumping only if walking can't get there)
  for (const [i, b] of jump) if (!best.has(i)) best.set(i, { ...b, jump: true });
  window.__spots = {};
  window.__yaws = {};
  for (const [i, b] of best) { window.__spots[i] = b.p; window.__yaws[i] = b.yaw; }
  if (window.__debug) console.log('DBG', JSON.stringify({ p0: p0.toArray(), start: startList, seeds: seeds.length, walk: walk.size, seen: seen.size, cols: W * W }));
  return its.map((it, i) => ({
    i, label: it.label, hold: !!it.hold,
    spot: best.has(i) ? best.get(i).p.toArray().map((v) => +v.toFixed(1)) : null,
    jump: !!best.get(i)?.jump,
    elsewhere: any.has(i) ? any.get(i).p.toArray().map((v) => +v.toFixed(1)) : null,
    reachable: seen.size,
  }));
}, [Number(process.env.R ?? 60), Number(process.env.STEP ?? 0.5)]);

// drawing first, then reading and looking; anything that starts a long scene (or leaves the level) last
const order = (f) => (f.hold ? 0 : /^(Look|Read|Fish)/.test(f.label) ? 1 : 2);
found.sort((a, b) => order(a) - order(b));
let ok = 0, bad = 0;
const level0 = await ev(() => __game.level?.name);
for (const f of found) {
  if ((await ev(() => __game.level?.name)) !== level0) { log('  (level changed: stopping)'); break; }
  if (!f.spot) {
    log(`${f.elsewhere ? 'UNREACHABLE' : 'FAIL'}  ${f.label}: no spot Ada can walk to from here where it is offered${f.elsewhere ? ` (offered at ${f.elsewhere}, cut off from the start)` : ''}`);
    bad++;
    continue;
  }
  await settle(60);
  await ev((i) => { const P = window.__spots[i], y = window.__yaws[i]; __game.player.teleport(P, y ?? __game.player.yaw); __game.rig.snap(P); }, f.i);
  await adv(0.5);
  // (arriving somewhere can start a conversation: let it finish, then stand there again)
  if (!(await ev(() => !__game.director.cutscene && !__game.ui.inDialogue))) {
    await settle(90);
    await ev((i) => { const P = window.__spots[i], y = window.__yaws[i]; __game.player.teleport(P, y ?? __game.player.yaw); }, f.i);
    await adv(0.5);
  }
  const offered = await ev((i) => __game.active === window.__its[i] && document.querySelector('.prompt').classList.contains('show'), f.i);
  if (!offered) {
    log(`FAIL  ${f.label} at ${f.spot}: not offered (active: ${await ev(() => __game.active?.label ?? 'none')})`);
    bad++;
    continue;
  }
  const button = await ev(() => __game.ui.actionLabel);
  if (f.hold) {
    const before = await ev((i) => window.__its[i].progress?.() ?? 0, f.i);
    await ev(() => __game.input.touchKey('KeyE', true));
    await adv(1.5);
    const after = await ev((i) => [window.__its[i].progress?.() ?? 0, window.__its[i].enabled ? window.__its[i].enabled() : true], f.i);
    await ev(() => __game.input.touchKey('KeyE', false));
    await adv(0.2);
    const moved = after[0] > before + 0.01 || !after[1];
    log(`${moved ? 'OK  ' : 'FAIL'}  ${f.label} [${button}] at ${f.spot}${f.jump ? ' (needs a jump)' : ''}: progress ${before.toFixed(2)} -> ${after[0].toFixed(2)}`);
    moved ? ok++ : bad++;
  } else {
    // (nothing moves on by itself while we look at what the tap did)
    await ev(() => { __game.ui.autoAdvance = 0; __game.input.touchKey('KeyE', true); });
    await adv(1 / 30);
    await ev(() => __game.input.touchKey('KeyE', false));
    await adv(0.5);
    const what = await ev(() => __game.ui.waitingNote || document.querySelector('.note-wrap').classList.contains('show') ? 'note' : __game.ui.inDialogue ? 'dialogue' : __game.director.cutscene ? 'scene' : '');
    await ev(() => { __game.ui.autoAdvance = 0.2; });
    log(`${what ? 'OK  ' : 'FAIL'}  ${f.label} [${button}] at ${f.spot}${f.jump ? ' (needs a jump)' : ''}: ${what || 'nothing happened'}`);
    what ? ok++ : bad++;
    await settle(60);
  }
}
log(`SUMMARY ${level0}: ${ok} ok, ${bad} failed`);
