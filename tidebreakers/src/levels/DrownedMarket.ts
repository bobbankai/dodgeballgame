// Chapter Three — The Drowned Market. A floating city of lashed hulls under paper lanterns. Bram Oakhart
// feeds every refugee for free; nine years ago, as an Armada sergeant, he obeyed Commodore Halvard's
// order to fire on a "pirate" ship full of families, threw a single lifebuoy, and deserted. Halvard has
// come for the deserter. Bram means to give himself up; Kai won't let him. Hana, a woman Bram has fed
// for years, was the girl who caught the lifebuoy.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import type { Fighter } from '../game/Fighter';
import { Boat, WREN } from '../world/Boat';
import { hold, drop } from '../game/Props';

const DECK = 0.68;
// lashed barges (14 x 7): centres
const BARGES: [number, number][] = [[0, -12], [0, -5], [-7, 12], [7, 12], [-7, 19], [7, 19], [0, 36], [0, 43]];
// plank bridges: [x, z, length, rot]
const BRIDGES: [number, number, number, number][] = [[0, -18.5, 6, 0], [0, 3.5, 10, 0], [0, 27.5, 10, 0], [0, 50.5, 10, 0], [-14.5, 15.5, 6, Math.PI / 2], [14.5, 15.5, 6, Math.PI / 2]];

export const MARKET_LOOK: LookDef = {
  sun: [-0.3, 0.6, 0.5], sunIntensity: 0.32, sunColor: [0.6, 0.7, 1.0],
  sky: { zenith: '#070b1e', horizon: '#2a2a50', glow: '#5a4a8a', cloudLit: '#4a4a78', cloudShade: '#0e1024', cover: 0.3, cloudHeight: 1, sunSize: 0.0, stars: 1, moon: true },
  skyColor: [0.12, 0.14, 0.3], groundColor: [0.14, 0.09, 0.08], shadowTint: [0.3, 0.28, 0.6, 0.5], rim: [0.7, 0.75, 1.0, 0.9],
  fog: [0.05, 0.06, 0.13, 0.006], fogParams: [0.04, 0, 30, 0.2],
  sea: { color: [0.01, 0.03, 0.08, 0.5], shallow: [0.04, 0.08, 0.14, 0.6], level: 0, amp: 0.45, chop: 0.7, storm: 0 },
  grade: [0.95, 1.08, 1.08, 0.3], wind: [0.3, 0, 0.2],
  fx: { bloom: 0.6, vignette: 0.42, bloomThreshold: 1.1, gain: [1.0, 0.98, 1.06], lift: [0.0, 0.0, 0.03] },
};

export class DrownedMarket extends Level {
  readonly id = 'market';
  readonly beats = ['arrival', 'kitchen', 'raid', 'confession', 'gangway', 'boss', 'hana'];
  private wren: Boat | null = null;

  async build(): Promise<void> {
    this.setLook(MARKET_LOOK);
    this.makeSea();
    const col = this.game.collision;
    col.terrain = () => -20;
    col.wallBelow = -0.9;
    col.minY = -12;
    await this.loadKits('common', 'gulls', 'market', 'ships');
    BARGES.forEach(([x, z], k) => {
      this.putAt(k === 4 || k === 5 ? 'barge' : 'barge_open', x, DECK - 0.17, z, 0, 1, 'none');
      col.addPlatform(x, z, 7, 3.5, DECK);
    });
    for (const [x, z, L, r] of BRIDGES) {
      this.putAt('plankbridge', x, DECK - 0.02, z, r, [1, 1, L / 4], 'none');
      const along = Math.abs(Math.sin(r)) > 0.5;
      col.addPlatform(x, z, along ? L / 2 : 0.75, along ? 0.75 : L / 2, DECK);
    }
    // the Wren tied up at the south end
    this.wren = new Boat(this.kit, WREN, this.sea, col, V(0, 0.45, -26), 0);
    this.wren.bob = 0.25;
    // hull-houses round the edges (homes; solid)
    const hh: [string, number, number, number][] = [
      ['hullhouseA', -16, -10, Math.PI / 2], ['hullhouseB', 16, -8, -Math.PI / 2], ['hullhouseC', -20, 8, 0.2], ['hullhouseA', 20, 6, -0.3],
      ['hullhouseB', -21, 24, -0.2], ['hullhouseC', 21, 26, 0.3], ['hullhouseA', -14, 38, Math.PI / 2], ['hullhouseB', 14, 42, -Math.PI / 2],
      ['hullhouseC', -26, -22, 0.5], ['hullhouseA', 26, -20, -0.4], ['hullhouseB', -30, 40, 1.2], ['hullhouseC', 30, 44, -1.0],
    ];
    for (const [k, x, z, r] of hh) this.putAt(k, x, 0.5, z, r, 1, 'box');
    // the soup kitchen and stalls
    this.putAt('souppot', -3.5, DECK, -6, 0, 1, 'box');
    for (const [x, z] of [[4, -13], [-4, -14], [5, -4]] as const) this.putAt('crate', x, DECK, z, x, 1, 'box');
    this.putAt('barrel', 5.5, DECK, -10, 0, 1, 'circle');
    // lanterns strung between the hulls
    const strings: [string, number, number, number, number][] = [
      ['lanterns0', 0, -8.5, 0, 5.2], ['lanterns1', 0, 15.5, 0, 6.0], ['lanterns0', -8, 2, Math.PI / 2, 4.8], ['lanterns1', 8, 28, Math.PI / 2, 5.4], ['lanterns0', 0, 39.5, 0, 5.0],
    ];
    for (const [k, x, z, r, y] of strings) this.putAt(k, x, y, z, r, 1, 'none');
    for (const [x, z] of [[-6, -16], [6, -16], [-7, 0], [7, 0], [-13, 22], [13, 22], [-6, 47], [6, 47]] as const) {
      this.putAt('mooring', x, DECK - 1.0, z, 0, 1, 'circle');
    }
    // lights: lantern glow over each square
    for (const [x, z, r] of [[0, -8, 12], [0, 15.5, 14], [0, 40, 12], [-18, 8, 8], [18, 8, 8]] as const) this.light(V(x, 4.5, z), r, [1.0, 0.62, 0.32], 1.6);
    // the Armada flagship
    this.putAt('frigate', 0, 1.6, 64, Math.PI / 2, 1, 'none');
    col.addBox(0, 64, 18, 4.6, 0, -10, 30);
  }

  tick(dt: number): void { this.wren?.update(this.game.time, dt, this.game); }

  async script(): Promise<void> {
    const d = this.dir, ui = this.ctx.ui, audio = this.ctx.audio, g = this.game, kai = this.kai, pc = this.ctx.pc, flags = this.ctx.flow.flags;
    const P = (x: number, z: number) => V(x, DECK, z);
    pc.specialsUnlocked = { burst: true, dash: true, super: !!flags.super };
    audio.ambience('sea');
    const mira = await this.addCrew('mira', P(-1.5, -14), 0);
    let bram: Fighter | null = null;
    const hana = await this.npc('hana', 'hana', P(-1.5, -4), Math.PI);
    const refugees: Fighter[] = [];
    for (let k = 0; k < 4; k++) {
      const p = [P(3, -7), P(4.5, -3), P(-5.5, -2.5), P(2, -1.5)][k];
      const f = await this.npc(k % 2 ? 'villager' : 'teo', `ref${k}`, p, Math.PI + k, { look: { face: { eyeStyle: k % 2 ? 1 : 0 }, tint: [0.85 + k * 0.05, 0.8, 0.9] as [number, number, number] } });
      d.act(f, k === 3 ? 'sit' : 'idle', true);
      refugees.push(f);
    }

    // ---------------------------------------------------------------- arrival
    if (this.from('arrival')) {
      this.checkpoint('arrival', P(0, -16), 0);
      // the night before: on the Wren's deck, coming in to the market
      d.cine(true);
      audio.play('sad');
      const deck = V(0, 0.6, -26);
      d.place(kai, deck.add(V(0.55, 0, -0.9)), 0.4);
      d.place(mira, deck.add(V(-0.6, 0, 1.0)), Math.PI - 0.3);
      hold(this.ctx.flow.props, kai, 'lantern', 'R');
      const lamp = this.light(deck.add(V(0.9, 1.3, -0.6)), 7, [1.0, 0.72, 0.4], 1.6);
      d.face(kai, deck.add(V(6, 0, -4)), true);
      d.face(mira, kai, true);
      d.drift(deck.add(V(6, 3.2, -5)), deck.add(V(4.2, 2.2, -2.5)), deck.add(V(0, 1.0, 0)), 9);
      await d.wait(2.5);
      d.listen('kai', 'mira');
      await d.say('mira', 'You keep looking at that lantern. Every night. Like it\'s going to say something.', 'calm');
      d.two(kai, mira, 1, 0, { dist: 3.4 });
      await d.say('kai', 'It was my mum\'s. She kept the light at Gull\'s Rest. The night of the Great Squall she rowed out with it to a ship that was breaking up on the reef.', 'tender');
      await d.say('mira', 'Did she come back?', 'worried');
      d.face(kai, mira);
      d.close(kai, 1, 0, { dist: 1.6 });
      await d.say('kai', 'No. But I did. They found me on the beach in the morning holding this. I was four. I don\'t even know why I was in the water.', 'sad');
      await d.say('kai', 'I don\'t remember her face. Only the light. Is that stupid?', 'sad');
      d.close(mira, -1, 0, { dist: 1.6 });
      await d.say('mira', 'It\'s not stupid. I can\'t remember Teo\'s voice any more. Only his drawings.', 'sad');
      await d.say('mira', '...So you keep the light and I keep the drawings. That\'s what we\'ve got.', 'tender');
      d.two(kai, mira, 1, 0, { dist: 3.2 });
      await d.say('kai', 'And each other. That\'s what a crew is.', 'smile');
      await d.say('mira', 'Don\'t make it weird, storm-boy.', 'embarrassed');
      await d.fade(1, 0.8);
      drop(kai, 'lantern');
      this.unlight(lamp);
      d.act(kai, 'idle', true);
      d.place(mira, P(-1.5, -14), 0);
      kai.place(P(0.8, -16), 0);
      void d.fade(0, 0.8);
      audio.play('market');
      d.drift(V(-30, 14, -50), V(-22, 9, -36), V(0, 2, 10), 10);
      await d.card('CHAPTER THREE', 'The Drowned Market', 'Where the ships that had nowhere to go went.');
      d.listen('kai', 'mira');
      d.two(kai, mira, 1, 0);
      await d.say('kai', 'It\'s a whole town. Floating! Made of BOATS!', 'joy');
      await d.say('mira', 'Refugees. Every island the Armada "saved" ends up here eventually.', 'calm');
      await d.say('kai', 'I smell soup. Mira. Mira, I smell SOUP.', 'shock');
      d.cine(false);
    }

    // ---------------------------------------------------------------- the soup kitchen
    if (this.from('kitchen')) {
      this.checkpoint('kitchen', P(0, -14), 0);
      if (this.starting('kitchen')) kai.place(P(0.8, -14), 0);
      bram = await this.addCrew('bram', P(-3.5, -8.2), Math.PI);
      bram.team = 'neutral';
      this.crew.get('bram')!.brain.following = false;
      d.act(bram, 'idle', true);
      await this.reach(P(-1.5, -9.5), 2.5, 'Follow your nose');
      d.cine(true);
      d.face(kai, bram);
      d.face(bram, kai);
      d.listen('kai', 'mira', 'bram', 'hana');
      d.two(kai, bram, 1, 0, { dist: 4.2 });
      await d.say('bram', 'Sit, sit. Bowls are by the barrel. Nobody pays at this pot, so don\'t you try.', 'smile', 'talk');
      await d.say('kai', 'Nobody PAYS? Are you a saint?', 'shock');
      d.close(bram, -1);
      await d.say('bram', 'Ha. No. I\'m a cook with a big pot and a lot of time.', 'tender');
      // nine bowls later
      await d.fade(1, 0.6);
      d.act(kai, 'sit', true);
      kai.model.face.set('joy');
      void d.fade(0, 0.6);
      d.two(kai, hana, 1, 0, { dist: 3.6 });
      await d.say('hana', 'That\'s nine bowls. Bram, he\'s had nine bowls.', 'laugh');
      await d.say('kai', 'Ten would be greedy. Ten, please.', 'grin');
      await d.say('mira', 'I apologise for him. Often. In advance.', 'smirk');
      d.close('hana', 1);
      await d.say('hana', 'Don\'t. Bram\'s been feeding me since I was eleven. It\'s nice to see someone eat it like it\'s the best thing in the world.', 'tender');
      d.close(bram, -1);
      await d.say('bram', 'It is the best thing in the world. Hot food, and nobody shooting at you while you eat it.', 'tender');
      // a horn across the water
      g.sfx('cannon');
      g.shake(0.4);
      audio.play('tension');
      d.wide(V(0, 6, 64), Math.PI + 0.4, 50, 12, 0, 0.5);
      await d.wait(2);
      await d.say('marine', 'By order of Commodore Halvard Crane! Deliver the deserter Bram Oakhart and no one else need be hurt!', 'shout');
      d.close(bram, 1);
      await d.say('bram', '...He found me.', 'shock');
      d.release(kai);
      d.cine(false);
    }

    // ---------------------------------------------------------------- the raid
    if (this.from('raid')) {
      if (!bram) { bram = await this.addCrew('bram', P(-3.5, -8.2), Math.PI); bram.team = 'neutral'; this.crew.get('bram')!.brain.following = false; }
      this.checkpoint('raid', P(0, -9), 0);
      for (const r of refugees) { d.release(r); void d.walk(r, P(-20 + Math.random() * 4, -10), true); }
      void d.walk(hana, P(-4, -14), true);
      d.act(bram, 'idle', true);
      await this.fight({
        center: P(0, -8.5), radius: 7.2, objective: 'Defend the soup kitchen', music: 'battle', after: 'market',
        hint: 'Knock marines into the water. They don\'t come back.',
        waves: [
          [['marine', -5, -2], ['marine', 5, -3], ['marine', 0, -1.5]],
          [['marine', -5, -14], ['rifleman', 5, -14], ['marine', 4, -6], ['marine', -4, -6]],
        ],
      });
      for (const r of refugees) g.removeFighter(r);
    }

    // ---------------------------------------------------------------- Bram's confession
    if (this.from('confession')) {
      if (!bram) { bram = await this.addCrew('bram', P(-3.5, -8.2), Math.PI); this.crew.get('bram')!.brain.following = false; }
      this.checkpoint('confession', P(0, -9), 0);
      audio.play('sad');
      d.cine(true);
      d.place(bram, P(-2.5, -7.5), 0.3);
      d.place(kai, P(0.2, -9.6), -0.8);
      d.place(mira, P(1.6, -8.0), -1.4);
      d.place(hana, P(-4.6, -9.8), 0.7);
      d.face(bram, V(0, 2, 64));
      d.listen('kai', 'mira', 'hana', 'bram');
      d.act(bram, 'sad', true);
      d.drift(P(-6, -3).add(V(0, 1.8, 0)), P(-5, -5).add(V(0, 1.6, 0)), P(-2.5, -7.5).add(V(0, 1.8, 0)), 10);
      await d.say('bram', 'Nine years ago I was a sergeant on Halvard\'s gun deck. We ran down a ship flying no colours. Pirates, he said.', 'sad');
      await d.say('bram', 'They were families. Fishing families running from a famine with everything they owned in sacks. I could see the children on the rail.', 'sad');
      d.close(bram, -1, 0, { dist: 1.6 });
      await d.say('bram', 'He gave the order. And I pulled the lanyard.', 'cry');
      await d.say('bram', 'When she went down I threw one lifebuoy over the side. One. Then I jumped after it and swam until I couldn\'t see the gold sun any more.', 'cry');
      d.two(kai, bram, 1, 0, { dist: 3.4 });
      await d.say('bram', 'Every bowl I\'ve ladled since has been an apology to people who can\'t hear it. Halvard wants me. He can have me, and the market lives.', 'determined');
      d.release(bram);
      await d.walk(bram, P(0, 2), false);
      await d.say('kai', 'No.', 'determined');
      d.face(bram, kai, true);
      d.close(kai, 1);
      await d.say('kai', 'You threw one lifebuoy. Okay. So throw the rest of them. Every person on these boats is in the water right now, Bram.', 'angry');
      await d.say('kai', 'Halvard doesn\'t get to drown anybody else. Not them, and not you.', 'determined');
      d.close(mira, -1);
      await d.say('mira', 'He\'s like this. You can\'t argue with him. I tried for a whole tunnel.', 'smirk');
      d.close(bram, 1);
      await d.say('bram', '...My ladle\'s in the pot.', 'tender');
      await d.say('kai', 'Then go and get your ladle!', 'grin');
      flags.bram = true;
      bram.team = 'ally';
      this.crew.get('bram')!.brain.following = true;
      d.cine(false);
    }

    // ---------------------------------------------------------------- to the gangway
    if (this.from('gangway')) {
      if (!bram) bram = await this.addCrew('bram', P(-1, -6), 0);
      this.checkpoint('gangway', P(0, 4), 0);
      if (this.starting('gangway')) kai.place(P(0, 4), 0);
      audio.play('battle');
      this.addFire(P(-10, 14), 1.0);
      this.addFire(P(11, 21), 1.0);
      ui.showHint('<b>C</b> calls a crew assist: Mira hooks, Bram drops his anchor on them.', 6);
      await this.reach(P(0, 10), 3, 'Push through the market to Halvard\'s gangway');
      await this.fight({
        center: P(0, 15.5), radius: 8.5, objective: 'Clear the market square', music: 'battle', after: 'tension',
        waves: [
          [['marine', -9, 13], ['marine', 9, 13], ['brute', 0, 21], ['rifleman', -10, 20]],
          [['elite', 0, 22], ['marine', -10, 18], ['marine', 10, 18], ['rifleman', 10, 11]],
          [['brute', -8, 20], ['marine', 8, 12], ['rifleman', 0, 23], ['marine', -9, 12]],
        ],
      });
      // the shelling has put people in the water: Bram's lifebuoys, the rest of them
      d.cine(true);
      d.two(bram, kai, -1, 0, { dist: 4 });
      await d.say('bram', 'The shelling\'s knocked people off the east boats! They\'re in the water!', 'shock');
      await d.say('kai', 'Then we throw them every lifebuoy in this market. Mira, Bram, take the stalls!', 'determined');
      d.cine(false);
      const buoys: [Vector3, Vector3, string, string][] = [
        [P(-15.8, 15.5), V(-20.5, 0, 15.5), 'villager', 'I\'ve got it! I\'ve got it! Pull, pull!'],
        [P(15.8, 15.5), V(20.5, 0, 15.5), 'villager', 'My boy! Take my boy first, please!'],
        [P(-11.5, 21.2), V(-12.5, 0, 26), 'villager', '...Thank you. Thank you. I can\'t swim. I never could.'],
      ];
      for (let i = 0; i < buoys.length; i++) {
        const [spot, water, who, line] = buoys[i];
        await this.reach(spot, 2.2, `Throw lifebuoys to the people in the water (${i}/3)`);
        d.cine(true);
        d.face(kai, water, true);
        // over Kai's shoulder: him in the foreground, the swimmer beyond
        const back = spot.subtract(water); back.y = 0; back.normalize();
        const side = new Vector3(back.z, 0, -back.x);
        d.shot(spot.add(back.scale(2.6)).add(side.scale(1.0)).add(V(0, 2.0, 0)), Vector3.Lerp(spot, water, 0.55).add(V(0, 0.9, 0)), 0, 0.62);
        d.act(kai, 'throw');
        await d.wait(0.45);
        g.vfx.splash(water, 26);
        g.sfx('splash', water);
        await d.wait(0.6);
        await d.say(who, line, i === 2 ? 'cry' : 'shock');
        d.act(kai, 'idle', true);
        d.cine(false);
      }
      d.cine(true);
      d.place(bram, P(-9.5, 20.2), 0.6);
      d.face(bram, V(-12.5, 0, 26), true);
      d.two(kai, bram, 1, 0, { dist: 3.6 });
      await d.say('bram', '...That\'s three more than I threw.', 'cry');
      await d.say('kai', 'Then that\'s three more people who get to be hungry tomorrow. Come on. Your soup\'s still on.', 'tender');
      d.cine(false);
      await this.reach(P(0, 21.5), 2.5, 'To the gangway');
      await this.reach(P(0, 33), 3, 'To the gangway');
    }

    // ---------------------------------------------------------------- Halvard, again
    if (this.from('boss')) {
      if (!bram) bram = await this.addCrew('bram', P(-1.5, 33), 0);
      this.checkpoint('boss', P(0, 33.5), 0);
      kai.place(P(0, 34), 0);
      this.addFire(P(-6, 38), 1.2);
      this.addFire(P(6, 45), 1.2);
      this.addFire(P(-5.5, 45.5), 0.9);
      const { f: hal, brain } = await this.addBoss('halvard', P(0, 43), Math.PI, 900);
      brain.active = false;
      brain.onSummon = () => {
        void this.enemy('marine', hal.pos.x - 4, hal.pos.z + 1);
        void this.enemy('marine', hal.pos.x + 4, hal.pos.z + 1);
        g.sfx('cannon', undefined, 0.6);
      };
      d.cine(true);
      d.face(hal, kai, true);
      d.listen('kai', 'bram', 'halvard', 'mira');
      d.two(hal, bram, 1, 0, { dist: 6 });
      await d.say('halvard', 'Sergeant Oakhart. You left your post.', 'calm', 'talk');
      d.close(bram, -1);
      await d.say('bram', 'I left your post. Mine\'s been a soup pot for nine years.', 'determined');
      d.close(hal, 1);
      await d.say('halvard', 'And the storm-boy again. You\'ve grown teeth since Gull\'s Rest.', 'smirk');
      d.close(kai, -1);
      await d.say('kai', 'She stood in front of me. You remember? You keep a list. Put her on it.', 'angry');
      hal.model.face.set('sad');
      await d.wait(0.8);
      await d.say('halvard', '...I do keep a list.', 'sad');
      d.cine(false);
      hal.floorHp = Math.round(hal.maxHp * 0.5);
      const half = new Promise<void>((res) => { hal.onFloor = res; });
      g.collision.arena = { x: 0, z: 39.5, r: 9.5 };
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      ui.setObjective('Defeat Commodore Halvard');
      await half;
      hal.floorHp = 0;
      g.combatActive = false;
      brain.active = false;
      d.cine(true);
      d.act(hal, 'taunt');
      d.close(hal, 1);
      await d.say('halvard', 'Then let\'s finish this properly.', 'determined');
      d.cine(false);
      brain.setPhase(2);
      g.combatActive = true;
      brain.active = true;
      this.addFire(P(5, 36), 1.0);
      await d.until(() => !hal.alive);
      g.combatActive = false;
      for (const e of g.enemies()) { e.hp = 0; e.die(new Vector3(), 2); }
      g.collision.arena = null;
      ui.setObjective(null);
      this.boss = null;
      g.slow(0.25, 1.2);
      await d.wait(2.4);
    }

    // ---------------------------------------------------------------- Hana
    if (this.from('hana')) {
      if (!bram) bram = await this.addCrew('bram', P(-1.5, 36), 0);
      this.checkpoint('hana', P(0, 38), 0);
      audio.play('sad');
      d.cine(true);
      const hal = await this.npc('halvard', 'halvard', P(0, 44), Math.PI);
      d.act(hal, 'sit', true);
      d.place(kai, P(-1.5, 40.5), 0.2);
      d.place(bram, P(1.2, 40.8), -0.1);
      d.place(mira, P(-3.4, 39.6), 0.4);
      d.place(hana, P(2.8, 37.6), -0.4);
      d.listen('kai', 'bram', 'mira', 'hana', 'halvard');
      d.two(bram, hal, 1, 0, { dist: 3.8 });
      await d.say('halvard', 'Go on, Sergeant. You know the drill.', 'tired');
      await d.say('bram', 'I\'m not going to shoot you, Halvard. I\'m done following your orders.', 'calm');
      d.close(hal, -1);
      await d.say('halvard', 'Vale is at the Reach. He\'s found where Ys-Marrow sank, and the Crown with it. He means to still the sea. Every current, every wind. Nothing will drown ever again.', 'sad');
      await d.say('kai', 'And nothing will sail.', 'shock');
      await d.say('halvard', 'He says that\'s a fair price. I believed him for twenty years.', 'tired');
      // Hana
      d.release(hana);
      await d.walk(hana, P(1.8, 39.0), false, 0.3);
      d.face(hana, bram, true);
      d.face(bram, hana, true);
      d.two(hana, bram, -1, 0, { dist: 3.0 });
      await d.say('hana', 'Mister Bram. The lifebuoy. Did it have a name painted on it?', 'worried');
      d.close(bram, 1);
      await d.say('bram', '..."Gilded Sparrow." Halvard\'s old ship. How do you...', 'shock');
      d.close(hana, -1, 0, { dist: 1.3 });
      await d.say('hana', 'It was red and white, and it smelled of tar, and I held on to it for a whole night. I was eleven.', 'cry');
      await d.say('hana', 'I was the girl in the water, Bram.', 'cry');
      d.act(bram, 'kneel_hold', true);
      d.two(hana, bram, -1, 0, { dist: 2.6, height: 1.1 });
      await d.say('bram', 'No. No, I... I left you all there. I left you...', 'sob');
      d.act(hana, 'kneel_hold', true);
      await d.say('hana', 'You threw the one thing you could. And then you fed me every single day for nine years. I just never knew it was you twice.', 'cry');
      await d.say('hana', 'Let yourself be forgiven, you big oaf. I did, a long time ago.', 'tender');
      bram.model.face.set('cry');
      await d.wait(2.2);
      d.close(kai, 1);
      await d.say('kai', '...So. My crew, Bram. We have a ship. We need a cook. And a guy who can throw lifebuoys really far.', 'tender');
      d.close(bram, -1);
      await d.say('bram', 'Ha... You\'d have a deserter?', 'cry');
      await d.say('mira', 'He\'d have anybody. It\'s his worst quality.', 'smile');
      await d.say('bram', '...Hana. Mind the pot for me?', 'tender');
      await d.say('hana', 'I\'ll keep it hot until you come home.', 'smile');
      d.act(kai, 'victory');
      audio.play('triumph');
      await d.wait(2.6);
      g.removeFighter(hal);
      await d.fade(1, 2);
      d.cine(false);
    }
  }
}
