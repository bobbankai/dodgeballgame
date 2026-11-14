import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';

/**
 * CHAPTER 5: THE FINAL TIMELINE. The Temporal Nexus: fragments of every place the fractures tore loose, adrift around the Engine.
 * Ethan crosses them with everything he has learned, fights beside the Echo on a broken skybridge, and faces Director Voss before
 * the Engine. Then he chooses: restore the original timeline (Ending A) or preserve the fractured worlds (Ending B).
 * The epilogues borrow two places the player knows: the integration lab of Chapter 1 and the street of Chapter 2.
 * Beats (`?chapter=5&at=`): fragments, bridge, voss.  (`&ending=A|B` in tests skips the choice.)
 */
export const SECTIONS = [...['n1', 'n2', 'n3'].map((s) => `environments/ch5/${s}.glb`), 'environments/ch1/s1.glb', 'environments/ch2/c2.glb'];
export const BEATS = ['fragments', 'bridge', 'voss'] as const;
type Beat = (typeof BEATS)[number];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export async function run(g: Game, ch: ChapterRuntime, at: string | null = null): Promise<void> {
  const from = Math.max(0, BEATS.indexOf((at ?? 'fragments') as Beat));
  const play = (b: Beat) => {
    const on = BEATS.indexOf(b) >= from;
    if (on) g.saveProgress(5, b);
    return on;
  };
  const dir = new Director(g);
  for (const a of ['slow', 'rewind', 'echo', 'shift']) g.flags.set(`ability_${a}`, true);
  if (from > 0) ch.jumpTo(({ bridge: 'cp_n2', voss: 'cp_n3' } as const)[BEATS[from] as Exclude<Beat, 'fragments'>]);
  g.sfx.voices.fx['IMANI'] = 'radio';
  g.sfx.voices.fx['DIRECTOR VOSS'] = 'dry';
  const shiftTo = (t: 'a' | 'b') => {
    if (ch.timeline === t) return;
    g.temporal.timelineState = t === 'a' ? 0 : 1;
    ch.setTimeline(t);
  };
  // a fall into the void: back to the last checkpoint, a little poorer for it
  for (const f of ['n1_fall', 'n2_fall', 'n3_fall']) {
    ch.repeat(f, async () => {
      g.post.u.hurt.value = 1;
      await g.wait(0.2);
      g.respawn();
    });
  }

  // --- the fragments: every ability, one crossing ----------------------------------------------------------------------------
  if (play('fragments')) {
    await dir.begin();
    await dir.fade(1, 0.01);
    void dir.fade(0, 3.0);
    const titled = dir.title('Chapter Five', 'The Final Timeline', 5.0);
    const rk = ch.cameraKey('n1_reveal', 48);
    const p0 = g.player.pos.clone();
    await dir.rail([rk, { pos: V(p0.x + 1.6, p0.y + 1.8, p0.z + 2.8), target: V(p0.x, p0.y + 1.2, p0.z - 10), fov: 50 }], 8.0);
    await titled;
    await ch.say([
      ['IMANI', 'You are inside the Nexus. Everything the fractures tore loose ends up here, turning around the Engine.'],
      ['ETHAN', 'It is beautiful.'],
      ['IMANI', 'It is a wound, Ethan. Every one of those islands was somewhere. Somebody lived there.'],
    ]);
    await dir.end();
    ch.objective('Cross toward the Engine');
    // the timeline crossing
    await ch.until(() => g.player.pos.z > 20 && g.player.pos.z < 30);
    ch.checkpoint('cp_n1b');
    ch.objective('The way on exists in two timelines at once  [4] shift');
    await ch.until(() => g.player.pos.z > 42.5);
    ch.checkpoint('cp_n1c');
    // the swept causeway: too fast to pass at normal speed
    ch.objective('Slow time to pass the beams  [1] slow');
    ch.onSeen = (l) => {
      (g.player as any).receiveHit?.({ attacker: null, damage: 14, stagger: 1.5, heavy: true, point: g.player.pos.clone(), dir: V(0, 0, -1), launch: 0.4 });
      void l;
    };
    await ch.until(() => g.player.pos.z > 64.5);
    ch.onSeen = null;
    ch.checkpoint('cp_n1d');
    ch.objective('Hold the gate open  [3] echo');
    await ch.until(() => g.player.pos.z > 76.5);
    await ch.say([['HELIX TROOPER', 'Elites on the island. He is through the gate!']]);
    ch.objective('Fight');
    await ch.fight('n1_wave');
    ch.objective('');
    await ch.trigger('n1_exit');
  }

  // --- the bridge: fighting beside the Echo ------------------------------------------------------------------------------------
  if (play('bridge')) {
    ch.checkpoint('cp_n2');
    const { spawnEcho } = await import('@/characters/echo');
    const { Companion } = await import('@/characters/companion');
    const p = g.player.pos;
    const fig = await spawnEcho(g.scene, V(p.x + 1.6, p.y, p.z - 0.8), 0);
    const mate = new Companion(g, fig);
    const tick = (dt: number) => mate.tick(dt);
    g.tickers.add(tick);
    g.fx.pulse(fig.root.position.clone().setY(p.y + 1), 'echo');
    await dir.begin();
    await dir.cut({ pos: p.clone().add(V(2.6, 1.7, -3.0)), target: p.clone().add(V(0.6, 1.4, 0)), fov: 40 });
    fig.play('talk', 0.3);
    await ch.say([
      ['THE ECHO', 'You were going to do the last part alone.'],
      ['ETHAN', 'I was going to try.'],
      ['THE ECHO', 'We tried that once. Both of us, separately. Look where it got everyone.'],
    ]);
    await dir.end();
    await ch.trigger('n2_enter');
    ch.objective('Cross the bridge  (the Echo fights with you)');
    await ch.fight('n2_wave1');
    await ch.say([['THE ECHO', 'Left side. I have the right.']]);
    await ch.fight('n2_wave2');
    ch.objective('');
    await ch.say([['THE ECHO', 'Go. Voss will be waiting at the heart. I will keep the way open behind you.']]);
    await ch.trigger('n2_exit');
    mate.enabled = false;
    fig.play('idle_combat', 0.3);
    g.tickers.delete(tick);
  }

  // --- Director Voss -------------------------------------------------------------------------------------------------------------
  if (play('voss')) {
    ch.checkpoint('cp_n3');
    const boss = (await ch.spawnBoss('voss')) as any;
    await ch.trigger('n3_enter');
    await dir.begin();
    const rk = ch.cameraKey('n3_reveal', 44);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(-6, -1.5, -6)), target: boss.pos.clone().setY(boss.pos.y + 1.6), fov: 30 }], 8.0,
        { focusOn: () => boss.pos.clone().setY(boss.pos.y + 1.6) }),
      ch.say([
        ['DIRECTOR VOSS', 'Ethan. You walked into the Engine to save a city. I only ever asked for the same thing on a larger scale.'],
        ['ETHAN', 'You wrote the disaster into the model.'],
        ['DIRECTOR VOSS', 'I wrote the future we were going to have anyway, and made sure HELIX was standing at the end of it. Somebody has to choose.'],
        ['ETHAN', 'Not you.'],
      ]),
    ]);
    await dir.end();
    boss.held = false;
    ch.objective('Defeat Director Voss  [heavy] breaks his barrier');
    // pylons (phase 2+): each one wakes in turn, charges, and bursts; standing close when it bursts hurts
    const pylons = ch.markers.filter((m) => m.name === 'pylon').map((m) => m.pos.clone());
    let pylonsOn = false;
    let flipping = 0; // seconds between flips (0 = off)
    const hazards = async () => {
      let i = 0;
      while (!boss.defeated) {
        if (!pylonsOn || boss.held) { await g.wait(0.5); continue; }
        const at = pylons[i++ % pylons.length];
        g.fx.pulse(at.clone().setY(at.y + 2), 'slow');
        g.sfx.play('boss_charge', { at, volume: 0.7 });
        await g.wait(1.4);
        g.fx.pulse(at.clone().setY(at.y + 1), 'shift');
        g.sfx.play('boss_pulse', { at });
        g.camera.addShake(0.25);
        if (g.player.pos.distanceTo(at) < 4.2 && !g.temporal.rewinding) {
          (g.player as any).receiveHit?.({ attacker: null, damage: 22, stagger: 2, heavy: true, point: at.clone(), dir: g.player.pos.clone().sub(at).setY(0).normalize(), launch: 0.5 });
        }
        await g.wait(boss.phase === 3 ? 2.0 : 3.2);
      }
    };
    const flips = async () => {
      while (!boss.defeated) {
        if (!flipping || boss.held) { await g.wait(0.5); continue; }
        await g.wait(Math.max(0.5, flipping - 1.2));
        if (boss.defeated) break;
        g.fx.pulse(g.player.pos.clone().setY(g.player.pos.y + 0.2), 'shift');
        g.sfx.play('alert', { volume: 0.6 });
        await g.wait(1.2);
        if (boss.defeated) break;
        shiftTo(ch.timeline === 'a' ? 'b' : 'a');
        g.camera.addShake(0.3);
      }
    };
    void hazards();
    void flips();
    boss.onPhase = (n: number) => {
      void (async () => {
        boss.held = true;
        boss.dismiss();
        await dir.begin();
        if (n === 2) {
          // Temporal Ascension: he lets the Engine into himself
          await dir.cut({ pos: boss.pos.clone().add(V(2.2, 1.0, 2.6)), target: boss.pos.clone().setY(boss.pos.y + 1.7), fov: 34 });
          await ch.say([['DIRECTOR VOSS', 'You think in one timeline at a time. That is why you lose.']]);
          g.post.u.flash.value = 0.6;
          g.camera.addShake(0.6);
          const low = ch.cameraKey('n3_low', 40);
          await dir.rail([low, { pos: low.pos.clone().add(V(2, 0.6, 0)), target: low.target, fov: 36 }], 3.0);
          await ch.say([['IMANI', 'He is drawing on the Engine directly. Watch the pylons, and do not stand in his fields.']]);
          pylonsOn = true;
          flipping = 9;
        } else {
          // Reality Collapse: the heart itself stops holding a single timeline
          await dir.cut({ pos: boss.pos.clone().add(V(-2.6, 2.2, 3.0)), target: boss.pos.clone().setY(boss.pos.y + 1.4), fov: 38 });
          await ch.say([['DIRECTOR VOSS', 'Then let none of it hold. If HELIX cannot have this future, nobody will.']]);
          g.post.u.fracture.value = 1;
          g.camera.addShake(0.9);
          await ch.say([['THE ECHO', 'Ethan! The platform is coming apart between timelines. Everything you have, now.']]);
          flipping = 5;
        }
        await dir.end();
        boss.held = false;
      })();
    };
    await ch.until(() => boss.defeated);
    flipping = 0;
    pylonsOn = false;
    shiftTo('a');
    ch.objective('');
    await g.wait(1.2);
    await dir.begin();
    await dir.cut({ pos: boss.pos.clone().add(V(-1.8, 1.2, 2.0)), target: boss.pos.clone().setY(boss.pos.y + 0.9), fov: 34 });
    await ch.say([
      ['DIRECTOR VOSS', 'Whatever you do with it, you will be doing what I did. Choosing for everyone.'],
      ['ETHAN', 'I know.'],
    ]);
    await dir.end();
    ch.objective('Reach into the Engine');
    await ch.interact('n3_engine');
    ch.objective('');
    await dir.begin();
    const low = ch.cameraKey('n3_low', 40);
    await dir.cut(low);
    await ch.say([
      ['IMANI', 'Ethan, listen to me. If you restore the original timeline, everything since the fracture goes. Including what I did, and what I tried to undo.'],
      ['THE ECHO', 'And if you keep them, you keep what Voss broke as well. There is no clean answer here.'],
    ]);
    const forced = new URLSearchParams(location.search).get('ending');
    const { chooseEnding, rollCredits } = await import('@/ui/finale');
    const ending = forced === 'A' || forced === 'B' ? forced : await chooseEnding();
    g.flags.set('ending', ending);
    if (ending === 'A') await endingA(g, ch, dir);
    else await endingB(g, ch, dir);
    g.flags.set('chapter5_complete', true);
    g.saveProgress(5, 'voss');
    try { localStorage.setItem(`ft.ending${ending}`, '1'); } catch { /* storage unavailable */ }
    await rollCredits(ending, g.testMode);
  }
}

/** Ending A: the original timeline. The fracture closes; the night before the Incident comes back; Imani does not know him. */
async function endingA(g: Game, ch: ChapterRuntime, dir: Director): Promise<void> {
  g.post.u.flash.value = 1.0;
  g.sfx.play('shift', { pitch: 0.6 });
  await ch.say([
    ['ETHAN', 'Close it. All of it.'],
    ['THE ECHO', 'Then this is goodbye. I was only ever here because the world broke.'],
    ['ETHAN', 'Thank you.'],
    ['THE ECHO', 'Make it worth it.'],
  ]);
  await dir.fade(1, 2.5);
  // the epilogue: the integration lab, the night of the fourteenth, a minute before four fifteen. The Engine never starts.
  const wake = ch.byId('wake');
  if (wake) ch.place(wake.pos.clone(), 0);
  await g.wait(0.5);
  const { Npc } = await import('@/characters/npc');
  const imani = await Npc.spawn(g, 'characters/imani/imani.glb', 'IMANI', wake ? wake.pos.clone().add(V(1.2, -0.75, -2.4)) : V(0, 0, 0), Math.PI);
  g.sfx.voices.fx['IMANI'] = 'dry';
  await dir.title('14 March 2089', '04:14', 3.0);
  await dir.fade(0, 2.5);
  await dir.cut({ pos: (wake?.pos ?? V(0, 0, 0)).clone().add(V(2.4, 1.6, -3.6)), target: (wake?.pos ?? V(0, 0, 0)).clone().add(V(0.4, 1.4, -1.2)), fov: 38 });
  await ch.say([
    ['IMANI', 'You are awake early. The integration test is not until six.'],
    ['ETHAN', 'Imani. The Engine. Do not start it. Not tonight.'],
    ['IMANI', 'I am sorry, have we met? You know my name.'],
    ['ETHAN', 'We will.'],
  ]);
  await dir.fade(1, 3.0);
  imani.dispose();
}

/** Ending B: the many histories. Each timeline is sealed into its own world; the district's rain eases; the Echo walks home. */
async function endingB(g: Game, ch: ChapterRuntime, dir: Director): Promise<void> {
  g.post.u.flash.value = 1.0;
  g.sfx.play('shift', { pitch: 0.8 });
  await ch.say([
    ['ETHAN', 'Let them stand. All of them. Seal each one where it is.'],
    ['IMANI', 'The fractures are closing around each world, not across them. They are holding, Ethan. They are holding.'],
  ]);
  await dir.fade(1, 2.5);
  const cp = ch.byId('cp_c2');
  if (cp) ch.place(cp.pos.clone(), 0);
  await g.wait(0.5);
  const { Npc } = await import('@/characters/npc');
  const { spawnEcho } = await import('@/characters/echo');
  const base = cp?.pos.clone() ?? V(0, 0, 0);
  const imani = await Npc.spawn(g, 'characters/imani/imani.glb', 'IMANI', base.clone().add(V(1.1, 0, 1.4)), Math.PI);
  const echo = await spawnEcho(g.scene, base.clone().add(V(-1.4, 0, 3.0)), Math.PI);
  const tick = (dt: number) => echo.update(dt);
  g.tickers.add(tick);
  g.sfx.voices.fx['IMANI'] = 'dry';
  await dir.title('The Fractured District', 'One of many', 3.0);
  await dir.fade(0, 2.5);
  // the rain eases off over the scene
  const rain0 = g.rain.intensity;
  const ease = (dt: number) => { g.rain.intensity = Math.max(0.15, g.rain.intensity - dt * rain0 * 0.06); };
  g.tickers.add(ease);
  await dir.cut({ pos: base.clone().add(V(3.2, 1.6, 5.5)), target: base.clone().add(V(0, 1.3, 1.8)), fov: 40 });
  echo.play('talk', 0.3);
  await ch.say([
    ['IMANI', 'Somewhere out there the terrace is still white, and the foundry is still pouring. And here it is just raining.'],
    ['THE ECHO', 'My timeline is still out there too. I think I will go and see what is left of it.'],
    ['ETHAN', 'Will I see you again?'],
    ['THE ECHO', 'You see me every time you look in a mirror. Try to make me look better.'],
  ]);
  // he walks off down the abandoned side of the street, and the rain closes behind him
  echo.play('walk', 0.4);
  echo.root.rotation.y = Math.PI;
  const leave = (dt: number) => { echo.root.position.z += dt * 1.3; };
  g.tickers.add(leave);
  await g.wait(3.5);
  await dir.fade(1, 3.0);
  for (const f of [tick, ease, leave]) g.tickers.delete(f);
  imani.dispose();
}
