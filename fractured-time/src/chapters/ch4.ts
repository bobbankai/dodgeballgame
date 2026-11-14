import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';

/**
 * CHAPTER 4: THE PARADOX. The fractures have joined places that were never next to each other. Ethan crosses a future terrace that
 * is also its own ruin, walks into the room where he volunteered ten years ago (and learns what Imani did that night), forces a
 * foundry that is both pouring and dead, and meets Commander Nyx over the crucible, where the ground itself cannot decide which
 * timeline it belongs to. Beats (`?chapter=4&at=`): terrace, memory, foundry, nyx.
 */
export const SECTIONS = ['p1', 'p2', 'p3', 'p4'].map((s) => `environments/ch4/${s}.glb`);
export const BEATS = ['terrace', 'memory', 'foundry', 'nyx'] as const;
type Beat = (typeof BEATS)[number];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export async function run(g: Game, ch: ChapterRuntime, at: string | null = null): Promise<void> {
  const from = Math.max(0, BEATS.indexOf((at ?? 'terrace') as Beat));
  const play = (b: Beat) => {
    const on = BEATS.indexOf(b) >= from;
    if (on) g.saveProgress(4, b);
    return on;
  };
  const dir = new Director(g);
  for (const a of ['slow', 'rewind', 'echo', 'shift']) g.flags.set(`ability_${a}`, true);
  if (from > 0) ch.jumpTo(({ memory: 'cp_p2', foundry: 'cp_p3', nyx: 'cp_p4' } as const)[BEATS[from] as Exclude<Beat, 'terrace'>]);
  g.sfx.voices.fx['IMANI'] = 'radio';
  g.sfx.voices.fx['COMMANDER NYX'] = 'dry'; // in person this time
  const shiftTo = (t: 'a' | 'b') => {
    if (ch.timeline === t) return;
    g.temporal.timelineState = t === 'a' ? 0 : 1;
    ch.setTimeline(t);
  };

  // --- the terrace: one place, two futures --------------------------------------------------------------------------------
  if (play('terrace')) {
    await dir.begin();
    await dir.fade(1, 0.01);
    const p0 = g.player.pos.clone();
    void dir.fade(0, 2.5);
    const titled = dir.title('Chapter Four', 'The Paradox', 4.5);
    const rk = ch.cameraKey('p1_reveal', 50);
    await dir.rail([rk, { pos: V(p0.x + 1.5, p0.y + 1.8, p0.z + 2.6), target: V(p0.x, p0.y + 1.4, p0.z - 8), fov: 50 }], 7.0);
    await titled;
    await ch.say([
      ['IMANI', 'You are standing in the future, Ethan. Twenty one oh one, if the clocks here can be trusted.'],
      ['ETHAN', 'And the storm I can hear behind it?'],
      ['IMANI', 'The same terrace after Voss wins. Both are real now, and they are leaking into each other.'],
    ]);
    await dir.end();
    ch.objective('Reach the far gate  [4] shift');
    let crossed = false;
    ch.repeat('p1_fall', async () => {
      ch.jumpTo(crossed ? 'cp_p1b' : 'cp_p1');
      shiftTo('a');
      await ch.say([['IMANI', 'The bridge only exists in one of them. Do not change your mind halfway across.']]);
    });
    await ch.trigger('p1_crossed');
    crossed = true;
    ch.checkpoint('cp_p1b');
    await ch.say([['HELIX TROOPER', 'Unregistered chronal signature on the terrace! Engage!']]);
    ch.objective('Fight');
    await ch.fight('p1_wave');
    ch.objective('The gate is sealed in this timeline');
    await ch.trigger('p1_exit');
    ch.objective('');
    await dir.begin();
    await dir.fade(1, 1.2);
    ch.jumpTo('cp_p2');
    shiftTo('a');
  }

  // --- the memory: the HELIX lab, 2079 ------------------------------------------------------------------------------------------
  if (play('memory')) {
    if (from === 1) await dir.begin();
    await dir.fade(0, 2.0);
    await dir.end();
    await ch.say([
      ['ETHAN', 'I know this room.'],
      ['IMANI', 'You should. HELIX, ten years before the Incident. Ethan... touch the shards. Please.'],
    ]);
    ch.objective('Touch the memories');
    const memories: [string, [string, string][]][] = [
      ['p2_mem1', [
        ['DIRECTOR VOSS', 'Four fifteen, the fourteenth of March, twenty eighty nine. A chronal cascade takes the city. Every model agrees.'],
        ['IMANI', 'Every model we built, Soren. That is not the same thing.'],
      ]],
      ['p2_mem2', [
        ['ETHAN', 'If the prediction holds, someone has to be inside the Engine when it starts. I will do it.'],
        ['IMANI', 'The integration has never been tested on a person.'],
        ['ETHAN', 'Then test it on me.'],
      ]],
      ['p2_mem3', [
        ['ETHAN', 'The cascade data was edited. Someone wrote the disaster into the model.'],
        ['DIRECTOR VOSS', 'Then you understand why you cannot remember this. Doctor Reyes. His memory. Tonight.'],
        ['IMANI', 'Yes, Director.'],
      ]],
    ];
    const memo = async (id: string, lines: [string, string][]) => {
      await ch.interact(id);
      g.post.u.fracture.value = 0.8;
      g.sfx.play('echo_on', { pitch: 0.7 });
      // the past speaks through the memory treatment; the present keeps its own
      const fx = g.sfx.voices.fx as Record<string, any>;
      const prev = { IMANI: fx['IMANI'], VOSS: fx['DIRECTOR VOSS'], ETHAN: fx['ETHAN'] };
      fx['IMANI'] = fx['DIRECTOR VOSS'] = fx['ETHAN'] = 'memory';
      await ch.say(lines);
      fx['IMANI'] = prev.IMANI; fx['DIRECTOR VOSS'] = prev.VOSS; fx['ETHAN'] = prev.ETHAN;
    };
    // in any order; the conversation after waits for all three
    await Promise.all(memories.map(([id, lines]) => memo(id, lines)));
    ch.objective('');
    await ch.say([
      ['ETHAN', 'Imani. You were there.'],
      ['IMANI', 'I took it from you. Voss ordered it and I did it. I hid what I took inside the Engine\'s own memory, so you could find it if you lived.'],
      ['ETHAN', 'Why should I trust you now?'],
      ['IMANI', 'You should not. But you need me for what comes next.'],
    ]);
    await ch.trigger('p2_exit');
    await dir.begin();
    await dir.fade(1, 1.2);
    ch.jumpTo('cp_p3');
    shiftTo('a');
  }

  // --- the foundry: pouring and dead at once -------------------------------------------------------------------------------------
  if (play('foundry')) {
    if (from === 2) await dir.begin();
    await dir.fade(0, 1.8);
    const rk = ch.cameraKey('p3_reveal', 46);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(-3, -2, -4)), target: rk.target.clone(), fov: 40 }], 5.0),
      ch.say([['IMANI', 'A HELIX foundry, coming apart between two timelines. In one it is still pouring. In the other it went cold years ago.']]),
    ]);
    await dir.end();
    ch.objective('Clear the foundry floor');
    await ch.fight('p3_wave');
    ch.objective('Cross the casting channel  [4] shift');
    let crossed = false;
    ch.repeat('p3_lava', async () => {
      if (ch.timeline !== 'a') return;
      (g.player as any).receiveHit?.({ attacker: null, damage: 35, stagger: 2, heavy: true, point: g.player.pos.clone(), dir: V(0, 0, 1), launch: 0.6 });
      g.post.u.hurt.value = 1;
      await g.wait(0.4);
      ch.place(ch.byId(crossed ? 'cp_p3b' : 'cp_p3')!.pos.clone());
      await ch.say([['IMANI', 'Not in this timeline. In the other one that metal set years ago.']]);
    });
    await ch.trigger('p3_crossed');
    crossed = true;
    ch.checkpoint('cp_p3b');
    ch.objective('Restore power to the door');
    // the console only has power in the working foundry
    for (;;) {
      await ch.interact('p3_console');
      if (ch.timeline === 'a') break;
      await ch.say([['ETHAN', 'Dead. Nothing has run in here for years.']]);
      ch.rearm('p3_console');
    }
    ch.door('p3_door').open();
    await ch.say([['IMANI', 'Door is open. Something is waiting past it. One signature, very steady.']]);
    ch.objective('');
    await ch.trigger('p3_exit');
  }

  // --- Commander Nyx, over the crucible ------------------------------------------------------------------------------------------
  if (play('nyx')) {
    ch.checkpoint('cp_p4');
    const boss = (await ch.spawnBoss('nyx')) as any;
    await ch.trigger('p4_enter');
    await dir.begin();
    const rk = ch.cameraKey('p4_reveal', 42);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(-5, -0.8, -4)), target: boss.pos.clone().setY(boss.pos.y + 1.6), fov: 30 }], 7.0,
        { focusOn: () => boss.pos.clone().setY(boss.pos.y + 1.6) }),
      ch.say([
        ['COMMANDER NYX', 'Ethan Vale. You were the best of us. You still could be.'],
        ['ETHAN', 'Commander.'],
        ['COMMANDER NYX', 'Walk back through that door and I will tell Voss I never found you.'],
        ['ETHAN', 'He erased me once. I am not walking anywhere for him.'],
        ['COMMANDER NYX', 'Then let us see how much of you he left.'],
      ]),
    ]);
    await dir.end();
    boss.held = false;
    ch.objective('Defeat Commander Nyx');
    const centre = ch.byId('cp_p4')!.pos.clone().add(V(0, 0, -12));
    ch.repeat('p4_fall', async () => {
      (g.player as any).receiveHit?.({ attacker: null, damage: 20, stagger: 1, heavy: false, point: g.player.pos.clone(), dir: V(0, 0, 1), launch: 0 });
      ch.place(centre);
    });
    let flipping = false;
    boss.onPhase = (n: number) => {
      void (async () => {
        boss.held = true;
        await dir.begin();
        await dir.cut({ pos: boss.pos.clone().add(V(1.8, 1.7, 2.4)), target: boss.pos.clone().setY(boss.pos.y + 1.5), fov: 36 });
        if (n === 2) await ch.say([['COMMANDER NYX', 'You are not the only one he gave time to.']]);
        else {
          await ch.say([['COMMANDER NYX', 'This place is failing. So are you.']]);
          g.camera.addShake(0.6);
          await ch.say([['IMANI', 'The platform is losing its timeline. Watch the ground, Ethan, it is going to flip under you.']]);
          flipping = true;
        }
        await dir.end();
        boss.held = false;
      })();
    };
    // phase 3: the arena flips between realities on its own (a warning pulse first)
    const flip = async () => {
      while (!boss.defeated) {
        if (!flipping || boss.held) { await g.wait(0.5); continue; }
        await g.wait(5.2);
        if (boss.defeated) break;
        g.fx.pulse(g.player.pos.clone().setY(g.player.pos.y + 0.2), 'shift');
        g.sfx.play('alert', { volume: 0.7 });
        g.post.u.fracture.value = 0.5;
        await g.wait(1.2);
        if (boss.defeated) break;
        shiftTo(ch.timeline === 'a' ? 'b' : 'a');
        g.camera.addShake(0.35);
      }
    };
    void flip();
    await ch.until(() => boss.defeated);
    flipping = false;
    shiftTo('a');
    ch.objective('');
    await g.wait(1.2);
    await dir.begin();
    await dir.cut({ pos: boss.pos.clone().add(V(-1.8, 1.2, 2.0)), target: boss.pos.clone().setY(boss.pos.y + 0.9), fov: 34 });
    await ch.say([
      ['COMMANDER NYX', 'Stop. Enough.'],
      ['COMMANDER NYX', 'I read the cascade data too, Ethan. The same night you did. He did not erase me. He promoted me.'],
      ['ETHAN', 'Then help me end it.'],
      ['COMMANDER NYX', 'The Engines are a network now. To restore anything you would have to go inside it. Into the Nexus.'],
      ['IMANI', 'If you restore the original timeline, every branch that grew from the fracture could be erased. People who only exist now.'],
      ['ETHAN', 'Then I will find another way.'],
      ['THE ECHO', 'Not alone, you will not.'],
    ]);
    const { spawnEcho } = await import('@/characters/echo');
    const walk = ch.byId('cp_p4')!.pos.clone();
    const echo = await spawnEcho(g.scene, walk.clone(), Math.PI);
    const anim = (dt: number) => echo.update(dt);
    g.tickers.add(anim);
    g.fx.pulse(walk.clone().setY(walk.y + 1), 'echo');
    await dir.cut({ pos: walk.clone().add(V(1.6, 1.6, -3.0)), target: walk.clone().setY(walk.y + 1.5), fov: 38 });
    echo.play('talk', 0.3);
    await ch.say([
      ['ETHAN', 'You came back.'],
      ['THE ECHO', 'I said I would. When it matters.'],
    ]);
    await dir.fade(1, 1.6);
    g.tickers.delete(anim);
    await dir.title('Chapter Five', 'The Final Timeline', 4.0);
    g.flags.set('chapter4_complete', true);
    g.saveProgress(5, 'start');
  }
}
