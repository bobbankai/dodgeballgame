import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';
import { spawnEcho } from '@/characters/echo';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * CHAPTER 1: THE INCIDENT. HELIX Underground Research Facility, 2089, minutes after the first full Chronal Engine activation failed.
 * Ethan wakes in integration lab 01 with half his memory, fights his way past HELIX security, learns to slow time, finds the Engine and
 * the machine sent to guard it, and rides the freight lift to a surface that is no longer one city but several.
 *
 * The script is a list of beats. `?at=<beat>` (dev / tests) starts at a beat: earlier beats are skipped with their end state applied
 * (doors, abilities) and Ethan is placed at the beat's checkpoint.
 */
export const CH1_SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9'].map((s) => `environments/ch1/${s}.glb`);
export const CH1_BEATS = ['wake', 'corridor', 'checkpoint', 'lab', 'servers', 'engine', 'lift', 'surface'] as const;
type Beat = (typeof CH1_BEATS)[number];

export async function chapter1(g: Game, ch: ChapterRuntime, at: string | null = null): Promise<void> {
  const from = Math.max(0, CH1_BEATS.indexOf((at ?? 'wake') as Beat));
  const play = (b: Beat) => {
    const on = CH1_BEATS.indexOf(b) >= from;
    if (on) g.saveProgress(1, b); // Continue resumes at the last beat reached
    return on;
  };
  const dir = new Director(g);
  if (from > 0) ch.jumpTo(({ corridor: 's1_exit', checkpoint: 'cp_s3', lab: 'cp_s4', servers: 'cp_s5', engine: 'cp_s6', lift: 'sentinel', surface: 'cp_s8' } as const)[CH1_BEATS[from] as Exclude<Beat, 'wake'>]);

  // --- integration lab: waking up ------------------------------------------------------------------------------------------
  if (play('wake')) {
    ch.objective('');
    // opening shot: black, the title, the camera sinks from the lab ceiling to Ethan on the integration pod
    await dir.begin();
    await dir.fade(1, 0.01);
    const head = () => g.player.pos.clone().setY(g.player.pos.y + 1.6);
    const p0 = g.player.pos;
    dir.cut({ pos: V(p0.x + 2.4, 4.8, p0.z - 3.4), target: V(p0.x, p0.y + 0.4, p0.z), fov: 40 });
    void dir.fade(0, 3.0);
    const titled = dir.title('Fractured Time', 'Chapter One  \u00b7  The Incident', 5.0);
    const lines = ch.say([
      ['HELIX SYSTEM', 'Chronal integration interrupted. Subject: Vale, Ethan. Synchronisation sixty-one percent.'],
      ['HELIX SYSTEM', 'Containment breach, sublevels four through nine. All personnel evacuate.'],
    ]);
    await dir.rail([
      { pos: V(p0.x + 2.4, 4.8, p0.z - 3.4), target: V(p0.x, p0.y + 0.4, p0.z), fov: 40 },
      { pos: V(p0.x + 2.0, 3.0, p0.z + 1.6), target: V(p0.x, p0.y + 1.2, p0.z), fov: 36 },
      { pos: V(p0.x + 0.8, p0.y + 1.75, p0.z + 2.4), target: V(p0.x, p0.y + 1.6, p0.z), fov: 32 },
    ], 9.0, { focusOn: head });
    await Promise.all([titled, lines]);
    await ch.say([['ETHAN', 'Where... where am I?']]);
    await dir.end();
    ch.objective('Override the lab door from a console');
    await ch.interact('s1_console');
    await ch.say([['HELIX SYSTEM', 'Override accepted. Door 01 released.'], ['ETHAN', 'Okay. Let\'s see how far this goes.']]);
    ch.door('s1_door').open();
    ch.objective('Find a way out');
  }

  // --- service corridor: the first memory ------------------------------------------------------------------------------------
  if (play('corridor')) {
    await ch.trigger('s1_exit');
    ch.door('s1_door').close();
    void ch.interact('memory_1').then(() => ch.say([
      ['DIRECTOR VOSS', 'Volunteer seven. Mister Vale. You understand nobody can promise you come back the same man.', 4.2],
      ['ETHAN', 'I understand. Someone has to go first.', 3.0],
      ['ETHAN', 'That was me. I signed up for this?'],
    ]));
    await ch.trigger('s2_exit');
  }

  // --- security checkpoint: first fight (combat tutorial) ----------------------------------------------------------------------
  if (play('checkpoint')) {
    ch.checkpoint('cp_s3');
    await ch.trigger('s3_enter');
    await ch.say([['COMMANDER NYX', 'All units, sublevel six. Volunteer seven is loose. Containment is your only priority.', 3.8]]);
    ch.objective('Survive  [LMB light  RMB heavy  C dodge  Q block: block just before a hit to parry]');
    await Promise.all([ch.fight('s3_fight'), ch.say([['HELIX TROOPER', 'Contact! Down on the floor, now!']])]);
    await ch.say([['ETHAN', 'They\'re not here to help.']]);
    ch.objective('Keep moving');
  }
  ch.door('s3_door').open();

  // --- research lab: the anomaly and the cycling blast door (time slow) ---------------------------------------------------------
  if (play('lab')) {
    ch.checkpoint('cp_s4');
    await ch.trigger('s4_enter');
    g.flags.set('ability_slow', true);
    await ch.say([
      ['HELIX SYSTEM', 'Warning. Localised temporal discontinuity in lab 04.'],
      ['ETHAN', 'The ceiling came down... and stopped. It\'s just hanging there.'],
    ]);
    await ch.fight('s4_fight');
    ch.objective('Get through the cycling blast door  [1] slow time');
    await ch.say([['ETHAN', 'That door is cycling faster than anyone could move. Unless...'], ['HELIX SYSTEM', 'Subject chronal output rising.']]);
  }
  g.flags.set('ability_slow', true);

  // --- server hall --------------------------------------------------------------------------------------------------------------
  if (play('servers')) {
    ch.checkpoint('cp_s5');
    await ch.trigger('s5_enter');
    ch.objective('Reach the core');
    await Promise.all([ch.fight('s5_fight'), ch.say([['COMMANDER NYX', 'He\'s heading for the Engine. Seal the core and put him down.', 3.6]])]);
  }
  ch.door('s5_door').open();

  // --- the Chronal Engine and Sentinel A-07 -------------------------------------------------------------------------------------
  if (play('engine')) {
    ch.checkpoint('cp_s6');
    const boss = await ch.spawnBoss('sentinel');
    await ch.trigger('s6_enter');
    // the Engine reveal (camera marker authored with the level), then the Sentinel waking
    const b = boss as any;
    b.yaw = Math.atan2(g.player.pos.x - boss.pos.x, g.player.pos.z - boss.pos.z);
    await dir.begin();
    const rev = ch.cameraKey('engine_reveal', 42);
    const pp = g.player.pos.clone();
    await Promise.all([
      dir.rail([{ pos: V(pp.x - 0.9, pp.y + 1.8, pp.z - 1.8), target: V(pp.x, pp.y + 1.7, pp.z + 4), fov: 50 }, rev], 5.5),
      ch.say([['ETHAN', 'The Chronal Engine.']]),
    ]);
    const bh = () => boss.pos.clone().setY(boss.pos.y + 2.4);
    const side = V(boss.pos.x - pp.x, 0, boss.pos.z - pp.z).normalize();
    const left = V(side.z, 0, -side.x);
    const low0 = pp.clone().addScaledVector(left, 1.4).addScaledVector(side, 1.0).setY(pp.y + 0.55);
    const low1 = pp.clone().addScaledVector(left, 0.9).addScaledVector(side, 3.2).setY(pp.y + 0.45);
    const wake = dir.rail([{ pos: low0, target: bh(), fov: 38 }, { pos: low1, target: bh().setY(boss.pos.y + 2.9), fov: 30 }], 4.5, { focusOn: bh });
    await g.wait(1.0);
    boss.wake?.();
    await ch.say([['HELIX SYSTEM', 'Sentinel A-07 authorised. Neutralise the anomaly.']]);
    await wake;
    await dir.end();
    ch.objective('Defeat Sentinel A-07');
    await ch.until(() => !boss.alive);
    // the machine falls: a slow pass around the wreck
    await g.wait(1.2);
    await dir.begin();
    const wreck = boss.pos.clone();
    await dir.rail([
      { pos: wreck.clone().add(V(4.5, 1.2, -3.0)), target: wreck.clone().add(V(0, 1.2, 0)), fov: 40 },
      { pos: wreck.clone().add(V(3.0, 2.2, 4.0)), target: wreck.clone().add(V(0, 1.0, 0)), fov: 36 },
    ], 4.0, { focusOn: () => wreck });
    await dir.end();
  }

  // --- the freight lift ----------------------------------------------------------------------------------------------------------
  if (play('lift')) {
    ch.objective('Take the freight lift to the surface');
    await ch.say([['ETHAN', 'Up. Whatever\'s up there can\'t be worse than this.']]);
    await ch.interact('s7_lift');
    ch.objective('');
    // the ride up: a low angle on Ethan under the lift lamps, the camera rising past him, out to white noise and the next chapter
    await g.wait(0.6);
    await dir.begin();
    const e = g.player.pos.clone();
    const up = dir.rail([
      { pos: e.clone().add(V(-2.4, 0.5, 1.6)), target: e.clone().add(V(0, 1.7, 0)), fov: 38 },
      { pos: e.clone().add(V(-1.6, 3.6, 1.2)), target: e.clone().add(V(0, 1.4, 0)), fov: 34 },
      { pos: e.clone().add(V(-0.4, 7.5, 0.4)), target: e.clone().add(V(0, 0.6, 0)), fov: 30 },
    ], 8.0, { focusOn: () => e.clone().setY(e.y + 1.6) });
    g.camera.addShake(0.25);
    await ch.say([['HELIX SYSTEM', 'Freight lift two. Ascending to surface level.']]);
    await up;
    await dir.fade(1, 1.6);
  }

  // --- the surface: the city is several cities at once; something with Ethan's face is watching -------------------------------
  ch.jumpTo('cp_s8');
  const em = ch.byId('echo');
  const echo = em ? await spawnEcho(g.scene, em.pos.clone(), em.yaw) : null;
  if (echo) { echo.root.visible = false; g.tickers.add((dt) => echo.update(dt)); }
  await g.wait(0.8);
  const s0 = g.player.pos.clone();
  // out through the lift house doors: from behind Ethan's shoulder, the storm and the skyline open up
  dir.cut({ pos: s0.clone().add(V(0.7, 1.75, -1.4)), target: s0.clone().add(V(0, 1.6, 6)), fov: 52 });
  void dir.fade(0, 2.2);
  await dir.rail([
    { pos: s0.clone().add(V(0.7, 1.75, -1.4)), target: s0.clone().add(V(0, 1.6, 6)), fov: 52 },
    { pos: s0.clone().add(V(-1.6, 2.4, 3.0)), target: s0.clone().add(V(-2, 6, 60)), fov: 46 },
  ], 6.5, { focusOn: () => s0.clone().setY(s0.y + 1.6) });
  await ch.say([['ETHAN', '...or maybe it can.']]);
  await dir.end();
  ch.objective('Get to the edge of the deck');
  await ch.trigger('s8_edge');
  ch.objective('');

  // the vista, then the figure on the rooftop
  await dir.begin();
  const vista = ch.cameraKey('vista', 40);
  const v2 = { pos: vista.pos.clone().add(V(-4, 0.4, 0)), target: vista.target.clone().add(V(-60, 15, 0)), fov: 36 };
  await Promise.all([
    dir.rail([vista, v2], 9.0),
    ch.say([
      ['ETHAN', 'That\'s not one city. That\'s all of them.'],
      ['COMMANDER NYX', 'Volunteer seven has surfaced. Sector nine. Nobody engages without me.', 4.0],
    ]),
  ]);
  const ek = ch.cameraKey('echo_cam', 26);
  const flash = () => { g.post.u.flash.value = 0.9; g.camera.addShake(0.15); };
  flash();
  if (echo) echo.root.visible = true;
  dir.cut(ek);
  const eh = () => (echo ? echo.root.position.clone().setY(echo.root.position.y + 1.6) : ek.target);
  dir.focus(eh());
  await dir.rail([ek, { pos: ek.pos.clone().lerp(ek.target, 0.18), target: ek.target, fov: 22 }], 4.5, { focusOn: eh });
  await ch.say([['ETHAN', '...Who are you?']]);
  flash();
  if (echo) echo.root.visible = false;
  await g.wait(0.6);
  await dir.fade(1, 0.05); // cut to black
  await g.wait(1.4);
  await dir.title('Chapter Two', 'The Other World', 4.0);
  g.flags.set('chapter1_complete', true);
}

/** the chapter registry's interface (src/game.ts) */
export const SECTIONS = CH1_SECTIONS;
export const run = chapter1;
