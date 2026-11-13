import { Color3, Vector3 } from '@babylonjs/core';
import type { Director } from './Director';
import { easeInOut, easeOut, linear } from './Director';
import type { Game } from '../game/Game';
import type { Boss } from '../ai/Boss';

/**
 * Chapter Five: the Eternal Eclipse, and the end. Solmara, the sun-citadel, under the black sun.
 * Lines are recorded by tools/voices/record.py.
 */

export async function opening(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  d.letterbox(true);
  g.hud.fade(true);
  await d.wait(0.5);
  // the summit from below the cloud line, rising to the dais under the black sun
  void d.rail({ pos: new Vector3(-50, -6, 20), target: new Vector3(0, 30, 200), fov: 0.8 },
    { pos: new Vector3(-24, 14, 50), target: new Vector3(0, 26, 200), fov: 0.72 }, 15, linear);
  await d.fade(false);
  await d.say('ithra', 'Solmara. His citadel. Once, every dawn in the world was lit from here.');
  await d.say('kael', 'And now?');
  await d.say('ithra', 'Now it only remembers.');
  d.focus(3.4, 2);
  await d.rail({ pos: at.add(new Vector3(3, 1.7, 3)), target: at.add(new Vector3(0, 1.5, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(1.9, 1.75, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 }, 3.5, easeOut);
  await d.say('ithra', 'Kael. He will offer you everything. He offered it to me.');
  await d.say('kael', 'What did you take?');
  void d.rail({ pos: at.add(new Vector3(1.9, 1.75, 2.4)), target: at.add(new Vector3(0, 1.6, 0.2)), fov: 0.55 },
    { pos: at.add(new Vector3(-1.2, 2.2, -3.6)), target: at.add(new Vector3(0, 8, 30)), fov: 0.85 }, 4, easeInOut);
  await d.say('ithra', 'His voice. Go. End it.');
  await d.wait(0.6);
  g.audio.play('banner_boom');
  g.hud.showBanner('The Eternal Eclipse', 'Chapter Five');
  g.hazards.after(4.5, () => g.hud.showBanner(null));
}

export async function terraceArrival(d: Director): Promise<void> {
  await d.barks([
    ['ithra', 'His sentinels. They were the best of the Dawn Vigil, once.'],
    ['kael', 'The Vigil knelt to him?'],
    ['ithra', 'We all did.'],
  ]);
}

export async function processionArrival(d: Director): Promise<void> {
  await d.barks([
    ['kael', 'The five of them, carved side by side.'],
    ['ithra', 'Before he wanted to be the only one.'],
  ]);
}

export async function summitArrival(d: Director): Promise<void> {
  await d.barks([['ithra', 'The dais. Whatever happens up there, I am glad it was you.']]);
}

/** The Eclipse Dais: Aurelion turns from the black sun. */
export async function bossIntro(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  const p = g.player!;
  d.letterbox(true);
  d.focus(12, 2.6);
  boss.char.animator.play('kneel', { fade: 0, start: boss.char.animator.clips.get('kneel').duration - 0.02 });
  await d.rail({ pos: p.position.add(new Vector3(2.5, 2.2, -4)), target: b.add(new Vector3(0, 12, 30)), fov: 0.8 },
    { pos: p.position.add(new Vector3(1.4, 1.6, -2)), target: b.add(new Vector3(0, 4, 0)), fov: 0.65 }, 3.2, easeInOut);
  await d.say('aurelion', 'Vessel. You have carried my light across the whole broken world. Give it back to me.');
  boss.char.animator.play('getup', { fade: 0.3, speed: 0.55 });
  void d.orbit(b, 14, 2.6, Math.PI * 1.15, Math.PI * 0.85, 8, easeInOut, 3.6);
  await d.wait(1.0);
  await d.say('aurelion', 'Four sparks. With them I close my hand forever, and nothing will ever burn, or drown, or fall, or rot again.');
  await d.say('kael', 'Nothing will ever live again, either.');
  await d.say('aurelion', 'Peace has a price, little knight. Ithra paid it. Will you?');
  await d.say('ithra', 'Not this time.');
  boss.char.animator.play('e_alert', { fade: 0.2, speed: 0.7 });
  g.audio.play('roar_sun', { at: b });
  g.vfx.burst('sunPillar', b, Vector3.Up(), 2.2);
  g.rig.shake(0.8);
  await d.wait(1.8);
  boss.char.animator.stopAction(0.4);
}

export const PHASE_LINES: Record<number, [string, string][]> = {
  1: [['aurelion', 'You fight with my own fire!']],
  2: [['aurelion', 'Then see the sun as I see it! Black, and endless!']],
};

/** Aurelion falls. */
export async function bossDeath(d: Director, g: Game, boss: Boss): Promise<void> {
  const b = boss.position.clone();
  d.letterbox(true);
  // the fallen body, low and close: framed where it actually lies (the clip carries it from where it stood)
  const c = boss.bodyCentre();
  const k = boss.height / 4.6; // the bigger the god, the further back
  d.focus(10 * k, 2.4);
  await d.rail({ pos: c.add(new Vector3(-7.5 * k, 2.2 * k, -8.5 * k)), target: c.add(new Vector3(0, 0.5 * k, 0)), fov: 0.62 },
    { pos: c.add(new Vector3(-5.5 * k, 1.5 * k, -6.2 * k)), target: c.add(new Vector3(0, 0.4 * k, 0)), fov: 0.55 }, 3, easeOut);
  await d.say('aurelion', 'The hand opens. After all this time.');
  await d.say('aurelion', 'It was so heavy, the light. Carry it better than I did.');
  g.vfx.burst('sunPillar', b, Vector3.Up(), 1.6);
  g.vfx.burst('aether', g.player!.aimPoint(new Vector3()), Vector3.Up(), 2.4);
  g.audio.play('aether');
  await d.wait(1.6);
}

/** The ending: the sparks given back, the black sun sliding away, morning over Solmara. */
export async function ending(d: Director, g: Game): Promise<void> {
  const p = g.player!;
  const at = p.position.clone();
  d.letterbox(true);
  d.focus(4, 2.4);
  await d.rail({ pos: at.add(new Vector3(2.6, 1.8, -3.0)), target: at.add(new Vector3(0, 1.6, 0)), fov: 0.6 },
    { pos: at.add(new Vector3(1.8, 1.7, -2.2)), target: at.add(new Vector3(0, 1.7, 0.3)), fov: 0.55 }, 3, easeOut);
  await d.say('ithra', 'Kael. Let them go. Give the sun back to the sky.');
  await d.say('kael', 'And you?');
  await d.say('ithra', 'I was a voice in a lantern. Let me be a voice in the morning instead.');
  // the sparks rise, one for each god
  for (let i = 0; i < 4; i++) {
    g.hazards.after(i * 0.5, () => {
      g.vfx.burst('aether', p.aimPoint(new Vector3()).add(new Vector3(0, 0.4 + i * 0.3, 0)), Vector3.Up(), 2);
      g.audio.play('aether', { pitch: i * 2 });
    });
  }
  // up and out: the camera climbs as the black sun slides off the sun and the day comes back
  void d.rail({ pos: at.add(new Vector3(1.8, 1.7, -2.2)), target: at.add(new Vector3(0, 1.7, 0.3)), fov: 0.55 },
    { pos: at.add(new Vector3(-10, 14, -22)), target: at.add(new Vector3(0, 30, 120)), fov: 0.9 }, 12, easeInOut);
  const sky0 = { eclipse: 0.97, sunSize: 0.085, sunIntensity: 6, zenith: new Color3(0.06, 0.05, 0.12), horizon: new Color3(0.78, 0.5, 0.38) };
  const sky1 = { eclipse: 0.0, sunSize: 0.03, sunIntensity: 26, zenith: new Color3(0.2, 0.36, 0.62), horizon: new Color3(0.98, 0.78, 0.56) };
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const k = easeInOut(i / steps);
    g.sky.set({
      eclipse: sky0.eclipse + (sky1.eclipse - sky0.eclipse) * k,
      sunSize: sky0.sunSize + (sky1.sunSize - sky0.sunSize) * k,
      sunIntensity: sky0.sunIntensity + (sky1.sunIntensity - sky0.sunIntensity) * k,
      zenith: Color3.Lerp(sky0.zenith, sky1.zenith, k),
      horizon: Color3.Lerp(sky0.horizon, sky1.horizon, k),
    });
    g.lighting.sun.intensity = 1.0 + 3.6 * k;
    if (i === steps / 2) g.audio.play('banner_boom', { volume: 0.6 });
    await d.wait(10 / steps);
  }
  void g.lighting.captureEnvironment(g.sky);
  await d.say('kael', 'Morning.');
  await d.wait(1.5);
  g.audio.play('banner_boom');
  g.hud.showBanner('Eclipse: Fallen Gods', 'The End');
  await d.wait(5);
  g.hud.showBanner(null);
}
