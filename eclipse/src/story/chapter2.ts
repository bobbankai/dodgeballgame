import { Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import { easeInOut, easeOut, linear } from './Director';
import type { Game } from '../game/Game';
import type { Boss } from '../ai/Boss';

/**
 * Chapter Two: the Drowned Empire. Vael Maris, the sea-empire whose god pulled the sea over it
 * rather than let the Eclipse have it. Lines are recorded by tools/voices/record.py.
 */

/** Opening: over the drowned city in the rain, down to Kael on the harbour steps. */
export async function opening(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  d.letterbox(true);
  g.hud.fade(true);
  await d.wait(0.5);
  // high over the flooded city: the aqueducts, the temple, the amphitheatre beyond
  void d.rail({ pos: new Vector3(48, 34, -30), target: new Vector3(0, 4, 120), fov: 0.8 },
    { pos: new Vector3(22, 22, 4), target: new Vector3(0, 6, 150), fov: 0.75 }, 15, linear);
  await d.fade(false);
  await d.say('ithra', 'Vael Maris. Its fleets ruled every sea, until its own god pulled the sea over its head.');
  await d.say('ithra', 'Thaloryn loved his people too much to let the dark take them. So he took them first.');
  // down to the quay: Kael beside the wreck, looking up at the arch
  d.focus(3.4, 2);
  await d.rail({ pos: at.add(new Vector3(-4.5, 1.6, 3.5)), target: at.add(new Vector3(0, 1.5, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(-2.2, 1.7, 2.6)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 }, 3.5, easeOut);
  await d.say('kael', 'He drowned a city to save it. Gods.');
  void d.rail({ pos: at.add(new Vector3(-2.2, 1.7, 2.6)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 },
    { pos: at.add(new Vector3(1.2, 1.9, -3.4)), target: at.add(new Vector3(0, 2.6, 12)), fov: 0.8 }, 4, easeInOut);
  await d.say('ithra', 'The tide still holds them. Tread carefully, Kael. Here, the water listens.');
  await d.wait(0.6);
  g.audio.play('banner_boom');
  g.hud.showBanner('The Drowned Empire', 'Chapter Two');
  g.hazards.after(4.5, () => g.hud.showBanner(null));
}

export async function forumArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'The Emperor raised that hand to bless the fleet. Now it begs the sky.'],
    ['kael', 'His soldiers are still standing guard. Under the water. After all this time.'],
  ]);
}

export async function aqueductArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'The aqueducts still run. Thaloryn keeps the old rhythms, even now.'],
  ]);
}

export async function bridgeArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'Mind the canal. The current down there would carry you out to sea.'],
  ]);
}

/** Inside the Temple of Tides: the priests' prophecy. */
export async function templeLore(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'The Temple of Tides. Its priests wrote that the sun would close like an eye, and a light would walk out of it.'],
    ['kael', 'A light. Ignaroth said I carry someone\'s light.'],
    ['ithra', 'Ignaroth said a great many things. Come. The amphitheatre is close.'],
  ]);
}

export async function arenaApproach(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'He is here. I can feel the whole sea leaning toward us.'],
  ]);
}

/** The flooded amphitheatre: Thaloryn rises from the water. */
export async function bossIntro(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  const p = g.player!;
  const root = boss.char.model.root;
  d.letterbox(true);
  d.focus(12, 2.6);
  root.position.y = -2.1;
  boss.hidden = true;
  boss.char.animator.play('kneel', { fade: 0, start: boss.char.animator.clips.get('kneel').duration - 0.02 });
  // the water churns at the centre of the arena
  await d.rail({ pos: p.position.add(new Vector3(2.5, 2.2, -4)), target: b.add(new Vector3(0, 1, 0)), fov: 0.7 },
    { pos: p.position.add(new Vector3(1.4, 1.7, -1.8)), target: b.add(new Vector3(0, 2, 0)), fov: 0.6 }, 2.6, easeInOut);
  g.vfx.burst('geyser', b, Vector3.Up(), 1.8);
  g.rig.shake(0.5);
  for (let k = 0; k < 4; k++) g.hazards.after(k * 0.5, () => g.vfx.burst('splash', b.add(new Vector3(Math.sin(k * 2.3) * 3, 0, Math.cos(k * 2.3) * 3)), Vector3.Up(), 2));
  // he rises: the camera low by the water, looking up
  void d.rail({ pos: b.add(new Vector3(7, 1.0, -12)), target: b.add(new Vector3(0, 3, 0)), fov: 0.75 },
    { pos: b.add(new Vector3(5, 0.8, -9)), target: b.add(new Vector3(0, 5, 0)), fov: 0.65 }, 5, easeInOut);
  const rise = { t: 0 };
  const lift = (): void => {
    rise.t += 1 / 60;
    root.position.y = Math.min(0, -2.1 + rise.t * 0.75);
    if (root.position.y > -1.2) boss.hidden = false;
    if (root.position.y < 0) g.hazards.after(1 / 60, lift);
  };
  lift();
  boss.char.animator.play('getup', { fade: 0.4, speed: 0.45 });
  g.audio.play('roar_tide', { at: b, volume: 0.6 });
  await d.wait(1.2);
  await d.say('thaloryn', 'Another Vessel, wading into my city. The last one drowned on the steps outside.');
  void d.orbit(b, 13, 4, Math.PI * 1.2, Math.PI * 0.82, 6, easeInOut);
  await d.say('thaloryn', 'Turn back, little knight. You carry the thing that ended us, and you cannot even feel its weight.');
  await d.say('kael', 'Then tell me what it is.');
  await d.say('thaloryn', 'Ask your lantern.');
  root.position.y = 0;
  boss.hidden = false;
  boss.char.animator.play('e_alert', { fade: 0.2, speed: 0.7 });
  g.audio.play('roar_tide', { at: b });
  g.vfx.burst('geyser', b.add(new Vector3(0, 0, 0)), Vector3.Up(), 2);
  g.rig.shake(0.8);
  await d.wait(1.8);
  boss.char.animator.stopAction(0.4);
}

export const PHASE_LINES: Record<number, [string, string][]> = {
  1: [['thaloryn', 'The sea forgets nothing. Not your face. Not hers.']],
  2: [['thaloryn', 'Rise, my legion! Rise, and drag him under!']],
};

/** Thaloryn falls: he knows Ithra. */
export async function bossDeath(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  d.letterbox(true);
  d.focus(6, 2.2);
  await d.rail({ pos: b.add(new Vector3(-6, 2.6, -7)), target: b.add(new Vector3(0, 2.2, 0)), fov: 0.65 },
    { pos: b.add(new Vector3(-4, 2, -5)), target: b.add(new Vector3(0, 2.4, 0)), fov: 0.55 }, 3, easeOut);
  await d.say('thaloryn', 'The tide is going out. At last.');
  await d.say('thaloryn', 'Lantern-voice. I know you. You sang to us at the end, before the sun went black.');
  g.vfx.burst('geyser', b, Vector3.Up(), 1.4);
  g.vfx.burst('aether', g.player!.aimPoint(new Vector3()), Vector3.Up(), 2);
  g.audio.play('aether');
  await d.wait(1.2);
  await d.say('kael', 'Ithra. What is he talking about?');
  await d.say('ithra', 'He is raving, Kael. The deep has rotted him through. Take his spark.');
  await d.wait(0.8);
  await d.say('ithra', 'Three more.');
  g.audio.play('banner_boom');
  g.hud.showBanner('Godspark Claimed', 'The Tide of Thaloryn');
  await d.wait(3.5);
  g.hud.showBanner(null);
}
