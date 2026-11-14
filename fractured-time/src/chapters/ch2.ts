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
export const SECTIONS = ['c1', 'c2', 'c3'].map((s) => `environments/ch2/${s}.glb`);
export const BEATS = ['rooftops', 'street', 'cafe'] as const;
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
  if (from > 0) ch.jumpTo(({ street: 'cp_c2', cafe: 'cp_c3' } as const)[BEATS[from] as Exclude<Beat, 'rooftops'>]);
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
  g.flags.set('chapter2_progress', 'cafe');
}
