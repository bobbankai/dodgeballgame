import { Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import { easeInOut, easeOut, linear } from './Director';
import type { Game } from '../game/Game';
import type { Boss } from '../ai/Boss';

/**
 * Chapter One: the Ashen Kingdom. Scripts are plain async functions on the Director; every spoken
 * line is recorded by tools/voices/record.py (it scans this folder for say / bark calls).
 */

/** Opening: the Eclipse, the fall of the Vigil, Kael waking in the ash on the Cinder Road. */
export async function opening(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  // Kael lies where he fell
  p.char.animator.play('knockdown', { fade: 0, start: p.char.animator.clips.get('knockdown').duration - 0.02 });
  d.letterbox(true);
  g.hud.fade(true);
  await d.wait(0.6);
  // high over Varn Keld, the black moon over the sun
  const town = new Vector3(0, 6, 120);
  void d.rail({ pos: new Vector3(-60, 38, 30), target: town.add(new Vector3(0, 30, 200)), fov: 0.75 },
    { pos: new Vector3(-30, 30, 60), target: town.add(new Vector3(0, 20, 160)), fov: 0.75 }, 14, linear);
  await d.fade(false);
  await d.say('ithra', 'Twelve years ago the sun went dark. A black moon slid across it, and it never moved again.');
  await d.say('ithra', 'The gods we prayed to went mad in the dark. The Dawn Vigil fell in a single night.');
  await d.say('ithra', 'But one of us lived. One of us still carries the light.');
  // down to the road: Kael in the ash
  d.focus(3.2, 1.8);
  await d.rail({ pos: at.add(new Vector3(2.5, 6, -5)), target: at.add(new Vector3(0, 0.3, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(1.6, 1.1, -2.6)), target: at.add(new Vector3(0, 0.4, 0.2)), fov: 0.55 }, 4.5, easeOut);
  await d.say('ithra', 'Kael. Get up. The ash still falls, and you are not finished.');
  p.char.animator.play('getup', { fade: 0.2 });
  void d.rail({ pos: at.add(new Vector3(1.6, 1.1, -2.6)), target: at.add(new Vector3(0, 0.4, 0.2)), fov: 0.55 },
    { pos: at.add(new Vector3(2.2, 1.7, -3.0)), target: at.add(new Vector3(0, 1.5, 0.4)), fov: 0.6 }, 2.4, easeInOut);
  await d.wait(1.4);
  d.focus(3.0, 2.4);
  await d.say('kael', 'Ithra? You died. I watched the citadel burn with you in it.');
  await d.say('ithra', 'I am a voice in your lantern now, nothing more. Walk, knight. Varn Keld is waiting.');
  p.char.animator.stopAction(0.3);
  await d.rail({ pos: at.add(new Vector3(2.2, 1.7, -3.0)), target: at.add(new Vector3(0, 1.5, 0.4)), fov: 0.6 },
    { pos: at.add(new Vector3(0, 2.6, -4.4)), target: at.add(new Vector3(0, 1.4, 4)), fov: 0.9 }, 2.2, easeInOut);
  g.audio.play('banner_boom');
  g.hud.showBanner('The Ashen Kingdom', 'Chapter One');
  g.hazards.after(4.5, () => g.hud.showBanner(null));
}

/** Tutorial hints along the Cinder Road (shown once each, in order). */
export const HINTS: { z: number; title: string; body: string }[] = [
  { z: -1, title: 'Move', body: 'WASD / left stick to move, mouse / right stick to look. Shift to sprint.' },
  { z: 12, title: 'Fight', body: 'Left click / X: light attack — chain up to four. Right click / Y: heavy (hold to charge).' },
  { z: 24, title: 'Survive', body: 'Space / B: dodge through attacks. Q / LB: block. Tap block as a blow lands to parry, then strike to riposte.' },
  { z: 42, title: 'Focus', body: 'Middle mouse / R3: lock on to the nearest foe. A glint warns of a parryable blow; a red flare cannot be blocked.' },
  { z: 66, title: 'Mend', body: 'R / D-pad up: drink from your ember flask. Flasks refill at shrines.' },
  { z: 96, title: 'Break them', body: 'Heavy blows crack an enemy\'s poise. When they stagger to one knee, strike to execute.' },
];

export async function villageArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'These were Ignaroth\'s people. He burned them to keep them, and still they serve him.'],
    ['kael', 'Then I\'ll give them their rest.'],
  ]);
}

export async function gateArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'The gate is choked with rubble. Take the wall. There will be a way up.'],
  ]);
}

/** The Crucible Throne: Ignaroth rises. */
export async function bossIntro(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  const p = g.player!;
  d.letterbox(true);
  d.focus(9, 2.8);
  boss.char.animator.play('kneel', { fade: 0, start: boss.char.animator.clips.get('kneel').duration - 0.02 });
  await d.rail({ pos: p.position.add(new Vector3(-3, 2.2, -4)), target: b.add(new Vector3(0, 3, 0)), fov: 0.7 },
    { pos: p.position.add(new Vector3(-1.5, 1.8, -1.5)), target: b.add(new Vector3(0, 4, 0)), fov: 0.55 }, 3, easeInOut);
  await d.say('ignaroth', 'Another Vessel. Crawling up to my throne with his little lantern.');
  boss.char.animator.play('getup', { fade: 0.3, speed: 0.6 });
  void d.orbit(b, 12, 2.4, Math.PI * 1.15, Math.PI * 0.85, 5, easeInOut, 2.8);
  await d.wait(1.6);
  await d.say('ignaroth', 'Come, then. Let me see if the Vigil\'s light still burns in you.');
  boss.char.animator.play('e_alert', { fade: 0.2, speed: 0.75 });
  g.audio.play('roar_giant', { at: b });
  g.vfx.burst('firePillar', b, Vector3.Up(), 1.4);
  g.rig.shake(0.8);
  await d.wait(1.8);
  boss.char.animator.stopAction(0.4);
}

export const PHASE_LINES: Record<number, [string, string][]> = {
  1: [['ignaroth', 'You cut deep, Vessel. But I am the fire that remembers!']],
  2: [['ignaroth', 'Burn with me, then! Burn with me!']],
};

/** Ignaroth falls: his last words, the spark. */
export async function bossDeath(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  d.letterbox(true);
  // the fallen body, low and close: framed where it actually lies (the clip carries it from where it stood)
  const c = boss.bodyCentre();
  const k = boss.height / 4.6; // the bigger the god, the further back
  d.focus(10 * k, 2.4);
  await d.rail({ pos: c.add(new Vector3(7.5 * k, 2.2 * k, -8.5 * k)), target: c.add(new Vector3(0, 0.5 * k, 0)), fov: 0.62 },
    { pos: c.add(new Vector3(5.5 * k, 1.5 * k, -6.2 * k)), target: c.add(new Vector3(0, 0.4 * k, 0)), fov: 0.55 }, 3, easeOut);
  await d.say('ignaroth', 'You carry his light. Do you not even know it?');
  await d.say('ignaroth', 'The Eclipse was never a curse, little knight. It was a hand. Closing.');
  g.vfx.burst('firePillar', b, Vector3.Up(), 1.2);
  g.vfx.burst('aether', g.player!.aimPoint(new Vector3()), Vector3.Up(), 2);
  g.audio.play('aether');
  await d.wait(1.2);
  await d.say('kael', 'What did he mean? Whose light?');
  await d.say('ithra', 'He is dying, and the dying lie. His spark is yours now, Kael. Four more.');
  await d.say('ithra', 'West, then, to the sea. Thaloryn waits in the city he drowned.');
  g.audio.play('banner_boom');
  g.hud.showBanner('Godspark Claimed', 'The Flame of Ignaroth');
  await d.wait(3.5);
  g.hud.showBanner(null);
}
