// Epilogue — The Wake. Dawn at sea: the Wren under full sail, the crew on deck, Kai hanging his mother's
// lantern at the bow, and Ines's voice reading the first line of the logbook.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { Boat, WREN } from '../world/Boat';
import { hold } from '../game/Props';

const LOOK: LookDef = {
  sun: [0.85, 0.22, 0.45], sunIntensity: 1.0, sunColor: [1.0, 0.78, 0.55],
  sky: { zenith: '#5a86c8', horizon: '#ffcf9a', glow: '#ff9e5a', cloudLit: '#ffe6c8', cloudShade: '#b48ab0', cover: 0.35, cloudHeight: 1, sunSize: 0.003, stars: 0, moon: false },
  skyColor: [0.7, 0.72, 0.9], groundColor: [0.4, 0.35, 0.3], shadowTint: [0.55, 0.45, 0.78, 0.3], rim: [1.0, 0.8, 0.6, 0.8],
  fog: [1.0, 0.82, 0.66, 0.004], fogParams: [0.03, 0, 40, 0.9],
  sea: { color: [0.05, 0.22, 0.4, 0.6], shallow: [0.1, 0.5, 0.6, 1.0], level: 0, amp: 0.8, chop: 0.9, storm: 0 },
  grade: [1.03, 1.0, 0.96, 0], wind: [0.8, 0, 0.3],
  fx: { bloom: 0.45, vignette: 0.3, gain: [1.04, 1.0, 0.94] },
};

export class Epilogue extends Level {
  readonly id = 'epilogue';
  readonly beats = ['dawn'];
  private wren: Boat | null = null;

  async build(): Promise<void> {
    this.setLook(LOOK);
    this.makeSea();
    this.game.collision.minY = -40;
    await this.loadKits('common', 'ships');
    this.wren = new Boat(this.kit, WREN, this.sea, this.game.collision, V(0, 0.2, 0), 0);
    this.wren.bob = 0.7;
  }

  tick(dt: number): void { this.wren?.update(this.game.time, dt, this.game); }

  async script(): Promise<void> {
    const d = this.dir, g = this.game, kai = this.kai, audio = this.ctx.audio, ui = this.ctx.ui;
    const w = this.wren!;
    w.update(g.time, 0, null);
    audio.play('triumph');
    audio.ambience('sea');
    kai.place(w.deck(0, 2.5), 0);
    const mira = await this.npc('mira', 'mira', w.deck(-1.0, -0.5), 0.3);
    const bram = await this.npc('bram', 'bram', w.deck(1.1, -1.8), -0.2);
    const nell = await this.npc('nell', 'nell', w.deck(-0.6, 1.0), 0.8);
    d.cine(true);
    // shots from just outside the rail (the mast and sail block anything taken from on deck)
    const across = w.deck(1, 0).subtract(w.deck(0, 0)).normalize(), along = w.deck(0, 1).subtract(w.deck(0, 0)).normalize();
    const up = V(0, 1, 0);
    // a close-up from in front of whoever speaks (they face the person they're talking to)
    // (tries straight on and 45 degrees to either side, and takes the first that keeps out of the mast and sail,
    // which stand on the centre line from the mast aft to the boom)
    const o = w.deck(0, 0);
    const inRig = (p: Vector3) => {
      const q = p.subtract(o);
      const a = Vector3.Dot(q, across), b = Vector3.Dot(q, along);
      return Math.abs(a) < 1.25 && b > -4.5 && b < 1.2;
    };
    const cu = (f: import('../game/Fighter').Fighter, side: number, dist = 2.1) => {
      const eye = f.pos.add(up.scale(f.height * 0.8));
      let best: Vector3 | null = null;
      for (const turn of [0.35 * side, 0.8 * side, -0.8 * side, 0]) {
        const yaw = f.yaw + turn;
        const c = f.pos.add(V(Math.sin(yaw), 0, Math.cos(yaw)).scale(dist)).add(up.scale(f.height * 0.8 + 0.08));
        if (!inRig(c)) { best = c; break; }
      }
      d.shot(best ?? f.pos.add(across.scale(side * 2.6)).add(up.scale(f.height * 0.8)), eye, 0, 0.5);
    };
    // the crew from the bow, looking aft: everyone in frame, the sail behind them
    const fromBow = (side = 1) => d.shot(w.deck(0.9 * side, 5.7).add(up.scale(1.85)), w.deck(0, 0.6).add(up.scale(0.8)), 0, 0.6);
    d.act(bram, 'cross_arms', true);
    d.act(mira, 'idle', true);
    d.act(nell, 'idle', true);
    d.act(kai, 'idle', true);
    d.listen('kai', 'mira', 'bram', 'nell');
    d.drift(V(-30, 10, 30), V(-18, 6, 18), w.deck(0, 0).add(V(0, 2, 0)), 9);
    await d.wait(4);
    ui.showSubtitle('Three weeks later.');
    await d.wait(3);
    ui.showSubtitle(null);
    d.face(kai, mira, true); d.face(mira, kai, true); d.face(nell, kai, true); d.face(bram, kai, true);
    fromBow(1);
    await d.say('nell', 'Wind\'s backing west. If we hold this heading we\'ll raise Gull\'s Rest by noon.', 'smile', 'point');
    await d.say('mira', 'You sure you want to go back there, Kai?', 'worried');
    fromBow(1);
    await d.say('kai', 'Yeah. I\'ve got fifteen names to read out loud. And a little girl to tell about her dad.', 'tender');
    fromBow(-1);
    await d.say('bram', 'I\'ll make soup. Grandmothers like soup. Even... you know. Even ones who aren\'t around to eat it.', 'tender');
    await d.say('nell', 'That\'s the nicest thing anyone\'s ever said about soup.', 'laugh');
    // what each of them carries home
    cu(mira, -1);
    await d.say('mira', 'Kai. Look at the deck by the mast. I drew something last night.', 'embarrassed');
    fromBow(-1);
    await d.say('kai', 'A sun! A really big one.', 'joy');
    await d.say('kai', '...It\'s missing a moustache, though.', 'grin');
    cu(mira, -1);
    await d.say('mira', 'Next time. I\'ve got time now.', 'tender');
    fromBow(1);
    await d.say('nell', 'When we\'re done at Gull\'s Rest, I want to go back to the Shoals. Forty-one flags. I counted.', 'determined');
    fromBow(1);
    await d.say('bram', 'Forty-one flags, a lighthouse and a serpent who cries. We\'ll need a bigger boat.', 'laugh');
    await d.say('bram', 'Hana wrote, by the way. Every boat in the market has a lifebuoy on the rail now. She painted KAI on one of them. Badly.', 'tender');
    fromBow(1);
    await d.say('kai', 'Grandma would have hated how much we\'re all smiling.', 'smile');
    cu(mira, -1);
    await d.say('mira', 'No, she wouldn\'t.', 'tender');
    fromBow(1);
    await d.say('kai', '...No. She wouldn\'t.', 'tender');
    // the lantern at the bow
    hold(this.ctx.flow.props, kai, 'lantern', 'R');
    d.release(kai);
    await d.walk(kai, w.deck(0, 4.4), false, 0.3);
    d.act(kai, 'salute');
    await d.wait(0.6);
    for (const p of kai.model.props) p.setEnabled(false);
    const lan = this.ctx.flow.props.instance('lantern')!;
    this.meshes.push(lan);
    const bow = w.deck(0, 4.9).add(V(0, 1.3, 0));
    lan.position.copyFrom(bow);
    this.r.globals.lights.push({ pos: bow, radius: 5, color: [1, 0.78, 0.45], intensity: 1.6 });
    d.shot(w.deck(0.7, 7.4).add(up.scale(1.7)), w.deck(0, 4.6).add(up.scale(1.35)), 0, 0.55);
    await d.say('kai', 'There. Now everyone can find us.', 'smile');
    d.drift(w.deck(0, 6).add(V(3, 1.6, 2)), w.deck(0, 7).add(V(6, 4, 8)), bow, 10);
    audio.play('lullaby');
    await d.wait(1.5);
    await d.say('ines', '"Day one. Fair wind. A crew of good people, and a long way to go."', 'tender');
    await d.wait(1);
    const g2 = this.game;
    d.wide(w.pos, -0.8, 34, 9, 0, 0.6);
    g2.r.fx.memory = 0;
    await d.wait(5);
    await d.fade(1, 3);
    d.cine(false);
    void Vector3;
  }
}
