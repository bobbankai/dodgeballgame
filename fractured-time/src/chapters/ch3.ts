import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';
import { Director } from '@/cinematics/director';

/**
 * CHAPTER 3: THE DOPPELGANGER. The HELIX Corporate Arcology exists twice: in 2089, immaculate, and twenty years abandoned. Ethan
 * learns to step between the two (Timeline Shift), finds Project Palimpsest, and meets the man who has been watching him since the
 * surface: himself. Beats (`?chapter=3&at=`): lobby, offices (Palimpsest, the mirror hall and the Echo follow as they are built).
 */
export const SECTIONS = ['a1', 'a2'].map((s) => `environments/ch3/${s}.glb`);
export const BEATS = ['lobby', 'offices'] as const;
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
  if (from > 0) ch.jumpTo(({ offices: 'cp_a2' } as const)[BEATS[from] as Exclude<Beat, 'lobby'>]);
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
    void ch.trigger('a1_pit').then(async function retry(): Promise<void> {
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
  g.flags.set('chapter3_progress', 'offices');
}
