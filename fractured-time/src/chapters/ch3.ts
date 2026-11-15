import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';

/**
 * CHAPTER 3: THE DOPPELGANGER. The HELIX Corporate Arcology exists twice: in 2089, immaculate, and twenty years abandoned. Ethan
 * learns to step between the two (Timeline Shift), finds Project Palimpsest, and meets the man who has been watching him since the
 * surface: himself. Beats (`?chapter=3&at=`): lobby, offices, palimpsest (Temporal Echo), mirror, echo (the boss and the revelation).
 */
export const SECTIONS = ['a1', 'a2', 'a3', 'a4', 'a5'].map((s) => `environments/ch3/${s}.glb`);
export const BEATS = ['lobby', 'offices', 'palimpsest', 'mirror', 'echo'] as const;
type Beat = (typeof BEATS)[number];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export async function run(g: Game, ch: ChapterRuntime, at: string | null = null): Promise<void> {
  const from = Math.max(0, BEATS.indexOf((at ?? 'lobby') as Beat));
  const play = (b: Beat) => {
    const on = BEATS.indexOf(b) >= from;
    if (on) g.saveProgress(3, b);
    return on;
  };
  const dir = new Director(g);
  g.flags.set('ability_slow', true);
  g.flags.set('ability_rewind', true);
  if (from > 0) ch.jumpTo(({ offices: 'cp_a2', palimpsest: 'cp_a3', mirror: 'cp_a4', echo: 'cp_a5' } as const)[BEATS[from] as Exclude<Beat, 'lobby'>]);
  if (from > 0) g.flags.set('ability_shift', true);
  if (from > 2) g.flags.set('ability_echo', true);
  g.sfx.voices.fx['IMANI'] = 'radio';

  // --- the lobby: the arcology twice over; the lesson is that each reality has a door the other has lost ----------------------
  if (play('lobby')) {
    await dir.begin();
    await dir.fade(1, 0.01);
    const p0 = g.player.pos.clone();
    void dir.fade(0, 2.5);
    const titled = dir.title('Chapter Three', 'The Doppelganger', 4.5);
    const rk = ch.cameraKey('a1_reveal', 50);
    await dir.rail([rk, { pos: V(p0.x + 1.5, p0.y + 1.8, p0.z + 2.5), target: V(p0.x, p0.y + 1.4, p0.z - 8), fov: 50 }], 7.0);
    await titled;
    await ch.say([
      ['IMANI', 'The HELIX arcology. Palimpsest was run from here. If there is a record of what they did to you, it is in this building.'],
      ['ETHAN', 'The lifts are sealed.'],
      ['IMANI', 'In this year they are. The building exists twice now, Ethan, and your integration can stand in either. Feel for the seam.'],
    ]);
    await dir.end();
    g.flags.set('ability_shift', true);
    ch.objective('Shift between timelines to reach the lifts  [4] shift');
    // falling into the pit (timeline b) puts him back at the lip, not at the checkpoint across the room
    ch.repeat('a1_pit', async () => {
      ch.jumpTo('cp_a1');
      await ch.say([['IMANI', 'The floor is only gone in one of them. Pick the other before you step.']]);
    });
    await ch.until(() => g.temporal.timelineState === 1);
    await ch.say([['ETHAN', 'Twenty years... maybe more. Nobody has been here in a long time.']]);
    await ch.trigger('a1_lifts');
    ch.objective('');
  }

  // --- the offices: a maze in one reality, a ruin in the other -------------------------------------------------------------
  if (play('offices')) {
    ch.checkpoint('cp_a2');
    ch.objective('Find the Palimpsest wing');
    await ch.say([
      ['IMANI', 'Glass in one year, rubble in the other. Neither of them lets you walk straight through. Both of them together might.'],
    ]);
    await ch.trigger('a2_exit');
    ch.objective('');
    await ch.say([['THE ECHO', 'You are slower than I remember.']]);
    await ch.say([['ETHAN', 'Who said that?'], ['IMANI', 'Ethan, I am reading two of you. Two signatures, the same one. Ethan... get out of there.']]);
  }

  // --- Project Palimpsest: the records, the recorder (Temporal Echo), a gate held by a plate -------------------------------
  if (play('palimpsest')) {
    ch.checkpoint('cp_a3');
    ch.objective('Search the Palimpsest lab');
    void ch.interact('a3_log1').then(() => ch.say([
      ['HELIX SYSTEM', 'Project Palimpsest. Objective: identify divergent timelines and overwrite them with the preferred history. Authorisation: Director Voss.'],
    ]));
    void ch.interact('a3_log2').then(() => ch.say([
      ['DIRECTOR VOSS', 'Every catastrophe we have ever suffered was a branch someone failed to prune. The Engine lets us prune. Begin with the timelines where HELIX loses.'],
      ['IMANI', 'Prune. He means erase. Whole futures, and everyone living in them.'],
    ]));
    await ch.say([['IMANI', 'That pedestal is drawing power in both timelines at once. Whatever it records, it records across them.']]);
    await ch.interact('a3_recorder');
    await dir.begin();
    g.post.u.flash.value = 0.5;
    g.sfx.play('echo_on');
    await ch.say([
      ['ETHAN', 'I can feel it. A few seconds behind me, still moving.'],
      ['IMANI', 'An echo. It does what you just did, exactly, a few seconds late. Stand where it needs to stand, then let it take your place.'],
    ]);
    await dir.end();
    g.flags.set('ability_echo', true);
    ch.objective('Open the gate: let an echo hold the plate  [3] echo');
    await ch.trigger('a3_exit');
    ch.objective('');
  }

  // --- the mirror hall: the reflection walks with him, until it doesn't ------------------------------------------------------
  if (play('mirror')) {
    ch.checkpoint('cp_a4');
    await ch.trigger('a4_mirror');
    const { spawnEcho } = await import('@/characters/echo');
    const { ghostify } = await import('@/temporal/ghost');
    const p = g.player;
    const fig = await spawnEcho(g.scene, V(-p.pos.x, p.pos.y, p.pos.z), -p.yaw);
    ch.lightRoot(fig.root);
    let mirroring = true;
    const mirror = (dt: number) => {
      if (mirroring) {
        // across the glass (x = 0): the mirror image of Ethan's place and heading, playing his motion (left and right not swapped:
        // the reflection is subtly wrong, because it is not his)
        fig.root.position.set(-p.pos.x, p.pos.y, p.pos.z);
        fig.root.rotation.y = -p.yaw;
        fig.play(p.anim.current || 'idle', 0.15);
      }
      fig.update(dt);
    };
    g.tickers.add(mirror);
    await g.wait(4);
    await ch.say([['IMANI', 'Ethan, your reading just doubled again.']]);
    await ch.trigger('a4_ambush');
    mirroring = false;
    await dir.begin();
    const cam = ch.cameraKey('a4_glass_cam', 38);
    fig.root.rotation.y = Math.atan2(p.pos.x - fig.root.position.x, p.pos.z - fig.root.position.z);
    fig.play('talk', 0.3);
    await Promise.all([
      dir.rail([{ pos: p.pos.clone().add(V(0.6, 1.7, -1.2)), target: fig.root.position.clone().setY(fig.root.position.y + 1.6), fov: 40 }, cam], 6.0,
        { focusOn: () => fig.root.position.clone().setY(fig.root.position.y + 1.6) }),
      ch.say([
        ['THE ECHO', 'You keep looking for the man who broke the world. You keep finding mirrors.'],
        ['ETHAN', 'Who are you?'],
        ['THE ECHO', 'Ask the Engine. It made both of us.'],
      ]),
    ]);
    // he walks away down his side of the glass and comes apart
    fig.play('walk', 0.3);
    fig.root.rotation.y = 0;
    const fade = ghostify(fig.root, 0xffa040) as unknown as { value: number };
    fade.value = 1;
    const leave = (dt: number) => { fig.root.position.z += dt * 1.3; fade.value = Math.max(0, fade.value - dt * 0.4); };
    g.tickers.add(leave);
    await g.wait(2.0);
    await dir.end();
    void g.wait(1.5).then(() => { g.tickers.delete(leave); g.tickers.delete(mirror); g.scene.remove(fig.root); });
    await ch.say([['HELIX TROOPER', 'Contact! Two of them, same signature!']]);
    ch.objective('Survive the ambush');
    await ch.fight('a4_wave');
    ch.objective('');
    await ch.trigger('a4_exit');
  }

  // --- the Palimpsest Core: the Echo -------------------------------------------------------------------------------------------
  if (play('echo')) {
    ch.checkpoint('cp_a5');
    const boss = (await ch.spawnBoss('echo')) as any;
    await ch.trigger('a5_enter');
    await dir.begin();
    const rk = ch.cameraKey('a5_reveal', 42);
    await Promise.all([
      dir.rail([rk, { pos: rk.pos.clone().add(V(-4, -0.6, -3)), target: boss.pos.clone().setY(boss.pos.y + 1.6), fov: 32 }], 7.0,
        { focusOn: () => boss.pos.clone().setY(boss.pos.y + 1.6) }),
      ch.say([
        ['THE ECHO', 'They built this to choose which of us gets to exist.'],
        ['ETHAN', 'Then help me stop them.'],
        ['THE ECHO', 'I tried. Look around you. This is what trying looks like.'],
      ]),
    ]);
    await dir.end();
    boss.held = false;
    ch.objective('Defeat the Echo  [Q] parry  [3] echo  [4] shift');
    // half way: the Core falls out of 2089 and into its ruin around them
    boss.onPhase2 = () => {
      void (async () => {
        boss.held = true;
        boss.dismissClones();
        await dir.begin();
        await dir.cut({ pos: boss.pos.clone().add(V(1.6, 1.7, 2.4)), target: boss.pos.clone().setY(boss.pos.y + 1.5), fov: 36 });
        await ch.say([['THE ECHO', 'You hesitate. I never did.']]);
        g.temporal.timelineState = 1;
        ch.setTimeline('b');
        g.post.u.flash.value = 0.6;
        g.camera.addShake(0.7);
        await g.wait(0.8);
        await ch.say([['IMANI', 'The whole room just slipped into the other timeline. It is his ground now. Make it yours.']]);
        await dir.end();
        boss.held = false;
      })();
    };
    await ch.until(() => boss.defeated);
    ch.objective('');
    await g.wait(1.2);
    // the revelation
    await dir.begin();
    await dir.cut({ pos: boss.pos.clone().add(V(-1.8, 1.2, 2.0)), target: boss.pos.clone().setY(boss.pos.y + 0.9), fov: 34 });
    await ch.say([
      ['THE ECHO', 'Enough.'],
      ['THE ECHO', 'Palimpsest was never a cure. Voss meant to overwrite every future where HELIX did not win.'],
      ['ETHAN', 'And you stopped it.'],
      ['THE ECHO', 'I broke it. I went into the Engine to tear it apart, and so did you. Two of us in the same moment. That is what fractured everything.'],
      ['ETHAN', 'So it was us.'],
      ['THE ECHO', 'It was us. Both of us. Neither of us gets to call it an accident.'],
      ['IMANI', 'Ethan, I have a second Engine signature. Voss is bringing another one online. The fractures are spreading faster.'],
      ['THE ECHO', 'Then he is finishing what he started. Go. I will find you when it matters.'],
    ]);
    await dir.fade(1, 1.6);
    await dir.title('Chapter Four', 'The Paradox', 4.0);
    g.flags.set('chapter3_complete', true);
    g.saveProgress(4, 'start');
  }
  g.flags.set('chapter3_progress', 'echo');
}
