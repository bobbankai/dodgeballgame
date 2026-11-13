import type { Game } from '@/game';
import type { ChapterRuntime } from './runtime';

/**
 * CHAPTER 1: THE INCIDENT. HELIX Underground Research Facility, 2089, minutes after the first full Chronal Engine activation failed.
 * Ethan wakes in integration lab 01 with half his memory, fights his way past HELIX security, learns to slow time, finds the Engine and
 * the machine sent to guard it, and rides the freight lift to a surface that is no longer one city but several.
 */
export const CH1_SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((s) => `environments/ch1/${s}.glb`);

export async function chapter1(g: Game, ch: ChapterRuntime): Promise<void> {
  // --- integration lab: waking up ------------------------------------------------------------------------------------------
  ch.objective('');
  await g.wait(1.2);
  await ch.say([
    ['HELIX SYSTEM', 'Chronal integration interrupted. Subject: Vale, Ethan. Synchronisation sixty-one percent.'],
    ['HELIX SYSTEM', 'Containment breach, sublevels four through nine. All personnel evacuate.'],
    ['ETHAN', 'Where... where am I?'],
  ]);
  ch.objective('Override the lab door from a console');
  await ch.interact('s1_console');
  await ch.say([['HELIX SYSTEM', 'Override accepted. Door 01 released.'], ['ETHAN', 'Fine. Let us see how far this goes.']]);
  ch.door('s1_door').open();
  ch.objective('Find a way out');

  // --- service corridor: the first memory ------------------------------------------------------------------------------------
  await ch.trigger('s1_exit');
  ch.door('s1_door').close();
  void ch.interact('memory_1').then(() => ch.say([
    ['DIRECTOR VOSS', 'Volunteer seven. Mister Vale. You understand nobody can promise you come back the same man.', 4.2],
    ['ETHAN', 'I understand. Someone has to go first.', 3.0],
    ['ETHAN', 'That was me. I signed up for this?'],
  ]));
  await ch.trigger('s2_exit');

  // --- security checkpoint: first fight (combat tutorial) ----------------------------------------------------------------------
  ch.checkpoint('cp_s3');
  await ch.trigger('s3_enter');
  await ch.say([['COMMANDER NYX', 'All units, sublevel six. Volunteer seven is loose. Containment is your only priority.', 3.8]]);
  ch.objective('Survive  [LMB light  RMB heavy  C dodge  Q block: block just before a hit to parry]');
  await Promise.all([ch.fight('s3_fight'), ch.say([['HELIX TROOPER', 'Contact! Down on the floor, now!']])]);
  await ch.say([['ETHAN', 'They are not here to help.']]);
  ch.door('s3_door').open();
  ch.objective('Keep moving');

  // --- research lab: the anomaly and the cycling blast door (time slow) ---------------------------------------------------------
  ch.checkpoint('cp_s4');
  await ch.trigger('s4_enter');
  g.flags.set('ability_slow', true);
  await ch.say([
    ['HELIX SYSTEM', 'Warning. Localised temporal discontinuity in lab 04.'],
    ['ETHAN', 'The ceiling came down... and stopped. It is just hanging there.'],
  ]);
  await ch.fight('s4_fight');
  ch.objective('Get through the cycling blast door  [1] slow time');
  await ch.say([['ETHAN', 'That door is cycling faster than anyone could move. Unless...'], ['HELIX SYSTEM', 'Subject chronal output rising.']]);

  // --- server hall --------------------------------------------------------------------------------------------------------------
  ch.checkpoint('cp_s5');
  await ch.trigger('s5_enter');
  ch.objective('Reach the core');
  await Promise.all([ch.fight('s5_fight'), ch.say([['COMMANDER NYX', 'He is heading for the Engine. Seal the core and put him down.', 3.6]])]);
  ch.door('s5_door').open();

  // --- the Chronal Engine and Sentinel A-07 -------------------------------------------------------------------------------------
  ch.checkpoint('cp_s6');
  await ch.trigger('s6_enter');
  await ch.say([
    ['ETHAN', 'The Chronal Engine.'],
    ['HELIX SYSTEM', 'Sentinel A-07 authorised. Neutralise the anomaly.'],
  ]);
  ch.objective('Defeat Sentinel A-07');
  await ch.boss('sentinel');
  ch.objective('Take the freight lift to the surface');
  await ch.say([['ETHAN', 'Up. Whatever is up there cannot be worse than this.']]);
  await ch.interact('s7_lift');
  ch.objective('');
  await ch.say([['ETHAN', '...or maybe it can.']]);
  g.flags.set('chapter1_complete', true);
}
