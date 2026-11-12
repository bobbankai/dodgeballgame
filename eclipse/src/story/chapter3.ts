import { Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import { easeInOut, easeOut, linear } from './Director';
import type { Game } from '../game/Game';
import type { Boss } from '../ai/Boss';

/**
 * Chapter Three: the Shattered Sky. Aethel Spire, Vaeltris's storm-monastery, torn into islands over
 * a sea of cloud. Lines are recorded by tools/voices/record.py.
 */

/** Opening: the islands from far out, then Kael at the wayside shrine. */
export async function opening(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  d.letterbox(true);
  g.hud.fade(true);
  await d.wait(0.5);
  void d.rail({ pos: new Vector3(-70, 30, -60), target: new Vector3(0, 6, 90), fov: 0.85 },
    { pos: new Vector3(-30, 16, -30), target: new Vector3(0, 8, 120), fov: 0.75 }, 15, linear);
  await d.fade(false);
  await d.say('ithra', 'Aethel Spire. Her monks once rang these bells to call the winds home.');
  await d.say('ithra', 'When Vaeltris went mad, the storm tore the mountain out from under them. The pieces never fell.');
  d.focus(3.4, 2);
  await d.rail({ pos: at.add(new Vector3(3.5, 1.7, 3.0)), target: at.add(new Vector3(0, 1.5, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(2.0, 1.75, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 }, 3.5, easeOut);
  await d.say('kael', 'Neither did the monks.');
  await d.say('kael', 'Ithra. Thaloryn said he knew you.');
  void d.rail({ pos: at.add(new Vector3(2.0, 1.75, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 },
    { pos: at.add(new Vector3(-1.2, 2.2, -3.6)), target: at.add(new Vector3(0, 4, 20)), fov: 0.85 }, 4, easeInOut);
  await d.say('ithra', 'The dying say a great many things. Climb, Kael. She is above us.');
  await d.wait(0.6);
  g.audio.play('banner_boom');
  g.hud.showBanner('The Shattered Sky', 'Chapter Three');
  g.hazards.after(4.5, () => g.hud.showBanner(null));
}

export async function courtArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'Mind the edges. The wind up here has teeth.']]);
}

export async function ruinsArrival(d: Director): Promise<void> {
  await d.barks([
    ['kael', 'They are still praying. Even like this.'],
    ['ithra', 'To her. They always prayed to her.'],
  ]);
}

export async function stonesArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'The stones will hold. Do not look down.']]);
}

export async function crownArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'The Stormcrown. Kael, whatever she tells you, remember who carried you out of the ash.']]);
}

/** The Stormcrown: Vaeltris descends. */
export async function bossIntro(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  const p = g.player!;
  const root = boss.char.model.root;
  d.letterbox(true);
  d.focus(12, 2.6);
  // she comes down out of the storm onto the crown
  root.position.y = 4;
  boss.hidden = true;
  await d.rail({ pos: p.position.add(new Vector3(2.5, 1.8, -4)), target: b.add(new Vector3(0, 9, 0)), fov: 0.75 },
    { pos: p.position.add(new Vector3(1.5, 1.4, -2)), target: b.add(new Vector3(0, 6, 0)), fov: 0.65 }, 2.4, easeInOut);
  g.lightning.strike(b, 45);
  g.vfx.burst('lightningStrike', b, Vector3.Up(), 1.4);
  boss.hidden = false;
  g.vfx.burst('feathers', b.add(new Vector3(0, 6, 0)), Vector3.Down(), 2.5);
  const fall = (): void => {
    root.position.y = Math.max(0.28, root.position.y - 1 / 60 * 2.2);
    if (root.position.y > 0.28) g.hazards.after(1 / 60, fall);
  };
  fall();
  void d.rail({ pos: b.add(new Vector3(7, 2.0, -13)), target: b.add(new Vector3(0, 4.5, 0)), fov: 0.8 },
    { pos: b.add(new Vector3(5, 1.8, -10)), target: b.add(new Vector3(0, 3.6, 0)), fov: 0.75 }, 5, easeInOut);
  await d.wait(1.2);
  await d.say('vaeltris', 'Little Vessel. You climbed all this way to bring me his lantern.');
  void d.orbit(b, 13, 2.4, Math.PI * 1.15, Math.PI * 0.85, 6, easeInOut, 3.2);
  await d.say('vaeltris', 'I was his messenger once. I carried the sun\'s word to every god. I know his voice when I hear it.');
  await d.say('kael', 'Whose voice?');
  await d.say('vaeltris', 'Come, then. Let the storm decide what you are.');
  boss.char.animator.play('e_alert', { fade: 0.2, speed: 0.7 });
  g.audio.play('roar_storm', { at: b });
  g.lightning.strike(b.add(new Vector3(6, 0, -3)), 50);
  g.lightning.strike(b.add(new Vector3(-7, 0, 2)), 50);
  g.rig.shake(0.7);
  await d.wait(1.8);
  boss.char.animator.stopAction(0.4);
}

export const PHASE_LINES: Record<number, [string, string][]> = {
  1: [['vaeltris', 'Every spark you take, he drinks. Did she not tell you?']],
  2: [['vaeltris', 'Then fall, Vessel! Fall with all of us!']],
};

/** Vaeltris falls: she names the Eclipse. */
export async function bossDeath(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  d.letterbox(true);
  // the fallen body, low and close: framed where it actually lies (the clip carries it from where it stood)
  const c = boss.bodyCentre();
  const k = boss.height / 4.6; // the bigger the god, the further back
  d.focus(10 * k, 2.4);
  await d.rail({ pos: c.add(new Vector3(-7.5 * k, 2.2 * k, -8.5 * k)), target: c.add(new Vector3(0, 0.5 * k, 0)), fov: 0.62 },
    { pos: c.add(new Vector3(-5.5 * k, 1.5 * k, -6.2 * k)), target: c.add(new Vector3(0, 0.4 * k, 0)), fov: 0.55 }, 3, easeOut);
  await d.say('vaeltris', 'The wind is quiet. I had forgotten the sound of it.');
  await d.say('vaeltris', 'Listen to me, knight. The Eclipse is no moon. It is Aurelion, swallowing the sun, and your lantern is his mouth.');
  g.vfx.burst('feathers', b.add(new Vector3(0, 3, 0)), Vector3.Up(), 3);
  g.vfx.burst('aether', g.player!.aimPoint(new Vector3()), Vector3.Up(), 2);
  g.audio.play('aether');
  await d.wait(1.2);
  await d.say('kael', 'Ithra?');
  await d.say('ithra', 'She lies, Kael. They all lie at the end. Take the spark.');
  await d.say('kael', 'I will take it. And then you will tell me the truth.');
  await d.say('ithra', 'In the forest. I promise.');
  g.audio.play('banner_boom');
  g.hud.showBanner('Godspark Claimed', 'The Storm of Vaeltris');
  await d.wait(3.5);
  g.hud.showBanner(null);
}
