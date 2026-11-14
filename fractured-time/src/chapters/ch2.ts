import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';
import { Npc } from '@/characters/npc';

/**
 * CHAPTER 2: THE OTHER WORLD. The Fractured District, the same storm. Ethan comes down off the roofs into a street that is two
 * eras at once, is found by Dr. Imani Reyes, learns to pull his own timeline back (time rewind), and is hunted across the district
 * by the Rift Marshal. Ends on footage of Ethan walking into the Engine before the disaster.
 * Beats (`?chapter=2&at=`): rooftops, street, cafe (more follow as their sections are built).
 */
export const SECTIONS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((s) => `environments/ch2/${s}.glb`);
export const BEATS = ['rooftops', 'street', 'cafe', 'gate', 'plaza', 'pursuit', 'marshal'] as const;
type Beat = (typeof BEATS)[number];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export async function run(g: Game, ch: ChapterRuntime, at: string | null = null): Promise<void> {
  const from = Math.max(0, BEATS.indexOf((at ?? 'rooftops') as Beat));
  const play = (b: Beat) => {
    const on = BEATS.indexOf(b) >= from;
    if (on) g.saveProgress(2, b);
    return on;
  };
  const dir = new Director(g);
  if (from > 0) ch.jumpTo(({ street: 'cp_c2', cafe: 'cp_c3', gate: 'cp_c4', plaza: 'cp_c5', pursuit: 'cp_c6', marshal: 'cp_c7' } as const)[BEATS[from] as Exclude<Beat, 'rooftops'>]);
  g.flags.set('ability_slow', true);

  // --- rooftops: the same storm, the HELIX tower behind him, the street four storeys down ------------------------------------
  if (play('rooftops')) {
    await dir.begin();
    await dir.fade(1, 0.01);
    const p0 = g.player.pos.clone();
    void dir.fade(0, 2.5);
    const titled = dir.title('Chapter Two', 'The Other World', 4.5);
    await dir.rail([
      { pos: V(p0.x + 6, p0.y + 5, p0.z + 8), target: V(p0.x, p0.y + 1.5, p0.z - 10), fov: 44 },
      { pos: V(p0.x + 1.2, p0.y + 1.9, p0.z + 3.2), target: V(p0.x, p0.y + 1.5, p0.z - 6), fov: 46 },
    ], 6.5);
    await titled;
    await ch.say([['COMMANDER NYX', 'All teams. The anomaly came up on the north stack. He\'s on the roofs. Box him in.', 4.6]]);
    await dir.end();
    ch.objective('Get down to the street  [SPACE] jump');
    await ch.say([['ETHAN', 'Down. I need to get down.']]);
    await ch.trigger('c1_street');
  }

  // --- the Overlapping Street: two eras on one block; a van that never finished crashing; a voice on his gauntlet -------------
  if (play('street')) {
    ch.checkpoint('cp_c2');
    ch.objective('Find a way through the district');
    void ch.interact('c2_log1').then(() => ch.say([
      ['CIVILIAN', 'It\'s morning on my street and night on the next one. My daughter\'s school isn\'t there any more. There\'s a field. Just a field.', 7.5],
      ['CIVILIAN', 'If anyone finds this... we went north. Toward the tower. Everyone says it\'s the only thing that\'s still the same.', 6.5],
    ]));
    g.sfx.voices.fx['IMANI'] = 'radio'; // she reaches him through his gauntlet before they meet
    await ch.trigger('c2_van_seen');
    await dir.begin();
    const vk = ch.cameraKey('c2_van_cam', 40);
    await dir.rail([vk, { pos: vk.pos.clone().lerp(vk.target, 0.25), target: vk.target, fov: 34 }], 5.0, { focusOn: () => vk.target });
    await ch.say([
      ['ETHAN', 'It\'s not falling. It\'s just... stopped.'],
      ['IMANI', 'Don\'t touch it. Whatever stopped it is still in there.'],
    ]);
    await dir.end();
    await ch.say([
      ['ETHAN', 'Who is this? How are you on this channel?'],
      ['IMANI', 'Your gauntlet is talking to my rig. That makes you Volunteer Seven. The cafe on the east side, under the green awning. Move.'],
    ]);
    ch.objective('Reach the cafe on the east side');
    await ch.trigger('c2_cafe_door');
  }

  // --- the cafe: Dr. Imani Reyes, and the first honest answer anyone has given him ----------------------------------------
  if (play('cafe')) {
    ch.checkpoint('cp_c3');
    g.sfx.voices.fx['IMANI'] = 'dry';
    const im = ch.byId('imani');
    const imani = im ? await Npc.spawn(g, 'imani', 'IMANI', im.pos.clone(), im.yaw) : null;
    imani?.face.setExpression('concerned');
    await ch.trigger('c3_meet');
    ch.objective('');
    await dir.begin();
    const two = ch.cameraKey('c3_two_shot', 38);
    dir.cut(two);
    dir.focus(two.target);
    await ch.say([
      ['IMANI', 'Close the door. They track movement, not people.'],
      ['ETHAN', 'You know who I am.'],
      ['IMANI', 'I know what you are. I helped build the thing on your arm.'],
    ]);
    imani?.face.setExpression('hard');
    await ch.say([
      ['ETHAN', 'Then tell me what happened down there.'],
      ['IMANI', 'The Engine was supposed to look. Just look, along the timeline. Instead it pulled. Every version of this city is trying to be it at once.'],
    ]);
    imani?.face.setExpression('warm');
    await ch.say([
      ['IMANI', 'And you are the only thing in it that can push back. Your integration keeps a few seconds of your own past. You can step back into them.'],
      ['ETHAN', 'Show me.'],
    ]);
    await dir.end();
    g.flags.set('ability_rewind', true);
    ch.objective('Rewind your own timeline  [2]');
    await ch.until(() => g.temporal.rewinding);
    await ch.until(() => !g.temporal.rewinding);
    ch.objective('');
    await ch.say([['IMANI', 'Four seconds. Use them well, because HELIX will not give you five.']]);
  }
  g.flags.set('ability_rewind', true);

  // --- the security gate: sweeping lasers, a shutter that slams if they see him; rewind is the way through -------------------
  if (play('gate')) {
    ch.checkpoint('cp_c4');
    g.sfx.voices.fx['IMANI'] = 'radio';
    ch.objective('Get through the HELIX checkpoint unseen');
    await ch.say([['IMANI', 'HELIX sweep. If the light touches you, the shutter drops and the whole block knows. If it does... you know what to do.']]);
    const shutter = ch.door('c4_shutter');
    let seen = 0;
    ch.onSeen = () => {
      seen++;
      shutter.close();
      g.sfx.play('alert', { volume: 1.2 });
      g.sfx.play('door_slam', { at: shutter.center });
      ch.objective('You were seen: rewind before it locks  [2]');
      // fail-safe: if the moment has passed (rewind holds four seconds), HELIX resets the gate after a while
      void g.wait(9).then(() => { if (shutter.state === 'closed') { shutter.open(); ch.objective('Get through the HELIX checkpoint unseen'); } });
    };
    const hint = (): void => {
      if (seen && shutter.state === 'open' && g.temporal.rewinding) ch.objective('Get through the HELIX checkpoint unseen  [1] slow the sweep');
    };
    g.tickers.add(hint);
    await ch.trigger('c4_through');
    g.tickers.delete(hint);
    ch.onSeen = null;
    ch.objective('');
    await ch.say([seen ? ['IMANI', 'That was close. Again, and they would have had you.'] : ['IMANI', 'Clean. You are better at this than you think.']]);
  }

  // --- Hartley Plaza: HELIX's checkpoint at the heart of the district, three waves around a fountain that stopped mid-splash ----
  if (play('plaza')) {
    ch.checkpoint('cp_c5');
    await ch.trigger('c5_enter');
    await dir.begin();
    const rk = ch.cameraKey('c5_reveal', 46);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(-6, -1, -3)), target: rk.target, fov: 40 }], 5.0),
      ch.say([['ETHAN', 'Even the water stopped.'], ['COMMANDER NYX', 'There he is. Plaza units, he is yours.', 3.2]]),
    ]);
    await dir.end();
    ch.objective('Survive  [LMB LMB LMB] combo  [RMB] after a dodge: a counter');
    await ch.fight('c5_wave1');
    await ch.say([['IMANI', 'More coming from the south gate. Stay off the open ground.']]);
    await ch.fight('c5_wave2');
    await ch.say([['HELIX TROOPER', 'Heavy unit, plaza. Bring it in!']]);
    await ch.fight('c5_wave3');
    ch.objective('');
    await ch.say([['ETHAN', 'That\'s all of them.'], ['IMANI', 'That\'s all of these. Something else is coming, Ethan. Something HELIX only sends when it means it.']]);
  }

  // --- the pursuit: the Rift Marshal arrives; the highway comes down behind Ethan as he runs for the roofs -------------------------
  if (play('pursuit')) {
    ch.checkpoint('cp_c6');
    await ch.say([['COMMANDER NYX', 'Marshal, you have the anomaly. Bring him in. Whole, if you can.', 3.4], ['IMANI', 'Run. Don\'t fight it here. Get to the roofs!']]);
    ch.objective('Run. Get to the roofs');
    // the hunter: the Marshal blinks in behind Ethan at every stretch of the run, a little closer each time, and runs him down between
    const { Afterimages } = await import('@/temporal/afterimages');
    const hunter = await Npc.spawn(g, 'marshal', 'MARSHAL', g.player.pos.clone().add(V(0, 0, -14)), 0);
    const ghosts = new Afterimages(g.scene, hunter.root, 4, 0xa070ff);
    hunter.play('run');
    const chase = (dt: number) => {
      const to = V(g.player.pos.x - hunter.root.position.x, 0, g.player.pos.z - hunter.root.position.z);
      const d = to.length();
      if (d > 3) hunter.root.position.addScaledVector(to.normalize(), Math.min(d - 3, 4.4 * dt));
      ghosts.step(dt);
    };
    g.tickers.add(chase);
    for (let i = 0; i < 3; i++) {
      await ch.trigger(`c6_run${i}`);
      // the elevated highway breaking up behind him, and the Marshal through the dust, closer
      g.camera.addShake(0.5);
      g.sfx.play('boss_slam', { volume: 0.8 });
      g.fx.pulse(g.player.pos.clone().add(V(0, 2, -6)), 'shift');
      ghosts.spawn(hunter.root, 0.8, 0.6);
      hunter.root.position.copy(g.player.pos).add(V(0, 0, -(10 - i * 2.5)));
      g.sfx.play('dodge', { at: hunter.root.position, pitch: 0.7 });
      if (i === 1) await ch.say([['ETHAN', 'It\'s right behind me!']]);
    }
    await ch.trigger('c6_top');
    g.tickers.delete(chase);
    hunter.dispose();
  }

  // --- the Rift Marshal ----------------------------------------------------------------------------------------------------
  if (play('marshal')) {
    ch.checkpoint('cp_c7');
    const boss = await ch.spawnBoss('marshal');
    await ch.trigger('c7_enter');
    await dir.begin();
    const rk = ch.cameraKey('c7_reveal', 40);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(3, -0.5, -4)), target: boss.pos.clone().setY(boss.pos.y + 1.8), fov: 30 }], 6.0,
        { focusOn: () => boss.pos.clone().setY(boss.pos.y + 1.8) }),
      ch.say([['ETHAN', 'What is that?'], ['IMANI', 'HELIX temporal enforcement. It is wearing the same thing you are, just more of it. Break its rhythm, Ethan.']]),
    ]);
    await dir.end();
    ch.objective('Defeat the Rift Marshal  [Q] parry to crack its armour  [2] rewind a mistake');
    await ch.until(() => !boss.alive);
    ch.objective('');
    await g.wait(1.5);
    // the footage: Imani pulls the Marshal's recorder; it shows Ethan, before any of this, walking into the Engine
    await dir.begin();
    await ch.say([
      ['IMANI', 'Its recorder survived. HELIX logs everything. Let me see what it knows about you.'],
    ]);
    const { playFootage } = await import('@/cinematics/footage');
    const footage = playFootage('cinematics/ch2_footage.webm', 'HELIX CAM 06  ENGINE CHAMBER  2089-03-14  04:12:09');
    await ch.say([
      ['ETHAN', 'That\'s me.'],
      ['IMANI', 'Timestamp says four twelve. The Engine went critical at four fifteen.'],
      ['ETHAN', 'I walked into it. Before it happened. I walked in.'],
      ['IMANI', 'Then you were not caught in the disaster, Ethan. You were in it on purpose.'],
    ]);
    await footage;
    await dir.fade(1, 1.2);
    await dir.title('Chapter Three', 'The Doppelganger', 4.0);
    g.flags.set('chapter2_complete', true);
    g.saveProgress(3, 'start');
  }
}
