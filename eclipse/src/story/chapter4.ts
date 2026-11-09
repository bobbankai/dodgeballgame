import { Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import { easeInOut, easeOut, linear } from './Director';
import type { Game } from '../game/Game';
import type { Boss } from '../ai/Boss';

/**
 * Chapter Four: the Forgotten Sanctuary. Sylvaris's temple-forest, grown past all keeping. Ithra
 * keeps her promise, and the goddess of growth tells Kael what the sparks are for.
 * Lines are recorded by tools/voices/record.py.
 */

export async function opening(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  d.letterbox(true);
  g.hud.fade(true);
  await d.wait(0.5);
  // down through the canopy toward the Heartwood, then to Kael at the forest's edge
  void d.rail({ pos: new Vector3(30, 40, 60), target: new Vector3(0, 10, 190), fov: 0.8 },
    { pos: new Vector3(14, 22, 110), target: new Vector3(0, 12, 200), fov: 0.75 }, 14, linear);
  await d.fade(false);
  await d.say('ithra', 'The Forgotten Sanctuary. Sylvaris kept the whole world green from here, once.');
  d.focus(3.4, 2);
  await d.rail({ pos: at.add(new Vector3(-3, 1.6, 3)), target: at.add(new Vector3(0, 1.5, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(-1.8, 1.7, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 }, 3.5, easeOut);
  await d.say('kael', 'You promised me the truth, Ithra.');
  await d.say('ithra', 'And you will have it, at her heart. Not before.');
  void d.rail({ pos: at.add(new Vector3(-1.8, 1.7, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 },
    { pos: at.add(new Vector3(1.2, 2.0, -3.4)), target: at.add(new Vector3(0, 3, 16)), fov: 0.85 }, 4, easeInOut);
  await d.say('ithra', 'Walk softly. Here, everything that grows is listening.');
  await d.wait(0.6);
  g.audio.play('banner_boom');
  g.hud.showBanner('The Forgotten Sanctuary', 'Chapter Four');
  g.hazards.after(4.5, () => g.hud.showBanner(null));
}

export async function gateArrival(d: Director): Promise<void> {
  await d.barks([
    ['kael', 'The roots have swallowed the gate.'],
    ['ithra', 'They swallow everything, given time.'],
  ]);
}

export async function groveArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'Her keepers. They tend the rot as lovingly as they once tended the bloom.']]);
}

export async function ravineArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'The old log will bear you. Mind the drop.']]);
}

export async function blightArrival(d: Director): Promise<void> {
  await d.barks([
    ['kael', 'The forest is dying.'],
    ['ithra', 'No. It is growing. It simply no longer knows when to stop.'],
  ]);
}

/** Before the Heartwood: Ithra's confession. */
export async function heartArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'Kael. I was his priestess. Aurelion\'s. When the sun went dark, he bound my voice to your lantern.'],
    ['kael', 'Then everything you have told me...'],
    ['ithra', 'Was true. Most of it. Finish this, and I will tell you the rest.'],
  ]);
}

/** The Heartwood: Sylvaris steps out of the roots. */
export async function bossIntro(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  const p = g.player!;
  const root = boss.char.model.root;
  d.letterbox(true);
  d.focus(12, 2.6);
  root.position.y = -2.2;
  boss.hidden = true;
  await d.rail({ pos: p.position.add(new Vector3(2.5, 2, -4)), target: b.add(new Vector3(0, 2, 0)), fov: 0.75 },
    { pos: p.position.add(new Vector3(1.4, 1.6, -2)), target: b.add(new Vector3(0, 3, 0)), fov: 0.65 }, 2.6, easeInOut);
  g.vfx.burst('rootBurst', b, Vector3.Up(), 2.2);
  g.vfx.burst('petals', b.add(new Vector3(0, 2, 0)), Vector3.Up(), 3);
  g.rig.shake(0.4);
  const rise = (): void => {
    root.position.y = Math.min(0, root.position.y + 1 / 60 * 0.9);
    if (root.position.y > -1.4) boss.hidden = false;
    if (root.position.y < 0) g.hazards.after(1 / 60, rise);
  };
  rise();
  void d.rail({ pos: b.add(new Vector3(7, 1.8, -13)), target: b.add(new Vector3(0, 3.2, 0)), fov: 0.8 },
    { pos: b.add(new Vector3(5, 1.6, -10)), target: b.add(new Vector3(0, 3.8, 0)), fov: 0.75 }, 5, easeInOut);
  await d.wait(1.4);
  await d.say('sylvaris', 'So the lantern finally tells the truth. Good. A knight should know whose hand he holds.');
  void d.orbit(b, 13, 2.4, Math.PI * 1.15, Math.PI * 0.85, 7, easeInOut, 3.2);
  await d.say('sylvaris', 'Three sparks burn in you, Vessel. Take mine, and he will come for all four.');
  await d.say('kael', 'And if I keep them?');
  await d.say('sylvaris', 'Then you will have to choose what they feed. Everything that lives must choose.');
  root.position.y = 0;
  boss.hidden = false;
  boss.char.animator.play('e_alert', { fade: 0.2, speed: 0.7 });
  g.audio.play('roar_bloom', { at: b });
  g.vfx.burst('rootBurst', b.add(new Vector3(4, 0, -2)), Vector3.Up(), 1.6);
  g.vfx.burst('rootBurst', b.add(new Vector3(-5, 0, 1)), Vector3.Up(), 1.6);
  g.rig.shake(0.6);
  await d.wait(1.8);
  boss.char.animator.stopAction(0.4);
}

export const PHASE_LINES: Record<number, [string, string][]> = {
  1: [['sylvaris', 'Root and rot, bloom and blight. I am all of it.']],
  2: [['sylvaris', 'Grow, my children! Hold him fast!']],
};

export async function bossDeath(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  d.letterbox(true);
  d.focus(6, 2.2);
  await d.rail({ pos: b.add(new Vector3(-6, 2.6, -7)), target: b.add(new Vector3(0, 2.4, 0)), fov: 0.65 },
    { pos: b.add(new Vector3(-4, 2.2, -5)), target: b.add(new Vector3(0, 2.6, 0)), fov: 0.55 }, 3, easeOut);
  await d.say('sylvaris', 'There. Do you feel it? The spark is warm. It wants to be given away.');
  await d.say('sylvaris', 'The sun is not dead, knight. It is only held. Hold it better than he did.');
  g.vfx.burst('petals', b.add(new Vector3(0, 3, 0)), Vector3.Up(), 3);
  g.vfx.burst('aether', g.player!.aimPoint(new Vector3()), Vector3.Up(), 2);
  g.audio.play('aether');
  await d.wait(1.2);
  await d.say('kael', 'Ithra. What happens at the end?');
  await d.say('ithra', 'At the end, you will stand before him with four sparks. And you will choose.');
  g.audio.play('banner_boom');
  g.hud.showBanner('Godspark Claimed', 'The Bloom of Sylvaris');
  await d.wait(3.5);
  g.hud.showBanner(null);
}
