// Chapter Four — The Weeping Shoals. Through the storm wall to a reef where ships die. Nell Finch, twelve,
// keeps her father's light burning and floats a letter to him every night; two years ago the cartographer
// Elias Finch rowed into the Shoals and never came back. Wreckers raid the light, the Weeping Maw rises,
// and in the serpent's hoard Nell finds her father's last letter, written to her.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { fbm, lerp, smoothstep, pathDist, plateau } from '../world/Noise';
import type { Fighter } from '../game/Fighter';
import { Boat, WREN } from '../world/Boat';
import { Serpent } from '../world/Serpent';
import { spawn, brains } from '../game/Spawn';
import { hold } from '../game/Props';

const ROCK = { x: 0, z: 60 };
const SHELF = { x: 0, z: -22, r: 12 };
const BARS: [number, number][] = [[0, 50], [-8, 38], [-14, 26], [-6, 12], [6, 2], [2, -10]];

function height(x: number, z: number): number {
  const n = fbm(x * 0.05, z * 0.05, 4, 31);
  let h = -7 + n * 1.5;
  // Nell's rock
  h = Math.max(h, plateau(x, z, ROCK.x, ROCK.z, 9, 14, 4.2) + n * 0.4 - 0.5);
  // the sandbars winding south through the wreck field
  const [d, t] = pathDist(x, z, BARS);
  h = Math.max(h, lerp(2.0, 1.6, t) * (1 - smoothstep(2.6, 5.5, d)) + n * 0.25 - 0.3 * smoothstep(2.0, 5.5, d));
  // the Maw's shelf
  h = Math.max(h, plateau(x, z, SHELF.x, SHELF.z, SHELF.r, SHELF.r + 4, 2.1) + n * 0.2);
  // the hoard: a little cove in the south-west
  h = Math.max(h, plateau(x, z, -18, -34, 4, 7, 1.7));
  return h;
}

function mask(_x: number, _z: number, h: number): [number, number, number, number] {
  return [0, 0.3, h > 2.4 ? 0.7 : 0.15, 1];
}

const LOOK: LookDef = {
  sun: [0.2, 0.5, 0.6], sunIntensity: 0.35, sunColor: [0.65, 0.75, 0.95],
  sky: { zenith: '#1a2230', horizon: '#4a5a6a', glow: '#6a7a8a', cloudLit: '#6a7480', cloudShade: '#141a24', cover: 0.95, cloudHeight: 0.6, sunSize: 0.0, stars: 0, moon: false },
  skyColor: [0.32, 0.38, 0.48], groundColor: [0.15, 0.16, 0.16], shadowTint: [0.3, 0.35, 0.55, 0.5], rim: [0.7, 0.85, 1.0, 1.0],
  fog: [0.2, 0.25, 0.32, 0.009], fogParams: [0.02, 0, 18, 0.1],
  sea: { color: [0.02, 0.07, 0.1, 0.4], shallow: [0.06, 0.16, 0.18, 0.7], level: 0, amp: 1.0, chop: 1.3, storm: 0.35 },
  grade: [1.0, 0.88, 1.08, -0.4], wind: [2.4, 0, 1.0],
  fx: { bloom: 0.5, vignette: 0.45, grain: 0.22, gain: [0.95, 1.0, 1.06], lift: [0.0, 0.01, 0.03] },
};

export class WeepingShoals extends Level {
  readonly id = 'shoals';
  readonly beats = ['storm', 'light', 'wreckers', 'rises', 'run', 'boss', 'letter'];
  private wren: Boat | null = null;
  private maw: Serpent | null = null;

  async build(): Promise<void> {
    this.setLook(LOOK);
    this.makeTerrain(height, -90, -80, 180, 170, {
      grassLight: '#6a7a5a', grassDark: '#3e4a3c', sand: '#8a826e', rock: '#4e5258', dirt: '#5a5448', sandHeight: 2.6, beach: 0.6, rockSlope: 0.35, path: 0.0,
    }, mask);
    this.makeSea();
    const col = this.game.collision;
    col.wallBelow = -0.6;
    col.minY = -12;
    await this.loadKits('common', 'shoals', 'ships');
    const H = (x: number, z: number) => height(x, z);
    this.put('nelllight', 0, 64, 0, 1, 'circle', -0.2);
    this.put('barrel', 3.2, 59, 0, 1, 'circle');
    for (let k = 0; k < 7; k++) this.put('bottle', -4 + k * 0.4, 56.5 + (k % 2) * 0.3, k, 1, 'none');
    // the wreck field
    const stacks: [string, number, number, number, number][] = [
      ['stack0', -22, 46, 0, 1], ['stack1', 20, 40, 1, 1.1], ['stack2', -24, 10, 2, 1], ['stack0', 22, 14, 3, 0.9], ['stack1', -30, -10, 1, 1.2],
      ['stack2', 26, -8, 0, 1.1], ['stack0', -24, -40, 2, 1], ['stack1', 24, -40, 1, 1], ['stack2', 0, -46, 0, 1.3], ['stack0', 34, 60, 1, 1.2], ['stack1', -36, 66, 2, 1],
    ];
    for (const [k, x, z, r, s] of stacks) { this.putAt(k, x, -2, z, r, s, 'none'); col.addCircle(x, z, 3.2 * s); }
    const wrecks: [string, number, number, number][] = [['wreck', -16, 20, 0.6], ['wreck_b', 14, 26, -1.0], ['wreck', 16, -2, 2.4], ['wreck_b', -20, -2, 1.4], ['wreck', -18, -34, 0.2]];
    for (const [k, x, z, r] of wrecks) { this.putAt(k, x, Math.max(-1.2, H(x, z) - 1.2), z, r, 1, 'none'); }
    col.addCircle(-18, -36.5, 3.0);
    // the Wren rides at anchor off Nell's rock
    this.wren = new Boat(this.kit, WREN, this.sea, col, V(14, 0.35, 54), -0.4);
    this.rain = 1;
    this.lightningT = 2;
    // the light
    this.light(V(0, H(0, 64) + 8, 64), 22, [1.0, 0.86, 0.5], 2.0);
  }

  tick(dt: number): void {
    this.wren?.update(this.game.time, dt, this.game);
    this.maw?.update(dt);
  }

  async script(): Promise<void> {
    const d = this.dir, ui = this.ctx.ui, audio = this.ctx.audio, g = this.game, kai = this.kai, pc = this.ctx.pc, flags = this.ctx.flow.flags;
    const H = (x: number, z: number) => height(x, z);
    const P = (x: number, z: number) => V(x, H(x, z), z);
    pc.specialsUnlocked = { burst: true, dash: true, super: !!flags.super };
    audio.ambience('rain');
    const mira = await this.addCrew('mira', P(-1.2, 52), 0);
    const bram = await this.addCrew('bram', P(1.5, 51.5), 0);
    let nell: Fighter | null = null;

    // ---------------------------------------------------------------- through the storm wall
    if (this.from('storm')) {
      this.checkpoint('storm', P(0, 52), 0);
      const w = this.wren!;
      d.cine(true);
      audio.play('storm');
      kai.place(w.deck(0, 3.5), w.yaw);
      d.place(mira, w.deck(-0.8, 0.5), w.yaw);
      d.place(bram, w.deck(0.8, -1.5), w.yaw);
      d.act(bram, 'idle', true); d.act(mira, 'idle', true); d.act(kai, 'idle', true);
      d.drift(w.pos.add(V(-14, 6, -10)), w.pos.add(V(-10, 4, -6)), w.pos.add(V(0, 2, 0)), 9);
      await d.card('CHAPTER FOUR', 'The Weeping Shoals', 'Where the lost ships go, and one small light.');
      d.listen('kai', 'mira', 'bram');
      g.sfx('thunder');
      await d.say('bram', 'Nobody sails into the Shoals, Kai. The charts just stop. There\'s a drawing of a crying sea serpent where the islands should be.', 'worried');
      await d.say('mira', 'The Armada\'s charts end here too. Whatever Vale wants with the Crown, the way to Ys-Marrow goes through this.', 'determined');
      d.close(kai, 1);
      await d.say('kai', 'Look. There. A light!', 'shock', 'point');
      d.wide(P(0, 64).add(V(0, 7, 0)), 2.8, 40, 6, 0, 0.45);
      await d.wait(2.4);
      await d.say('kai', 'Someone\'s keeping a lighthouse. Out here. In this.', 'tender');
      await d.fade(1, 1);
      d.cine(false);
    }

    // ---------------------------------------------------------------- Nell's light
    if (this.from('light')) {
      this.checkpoint('light', P(0, 54), 0);
      kai.place(P(0.3, 53), 0);
      d.place(mira, P(-1.4, 52.4), 0);
      d.place(bram, P(1.8, 52), 0);
      nell = await this.npc('nell', 'nell', P(-2.5, 57.2), Math.PI * 0.8);
      d.act(nell, 'kneel_hold', true);
      hold(this.ctx.flow.props, nell, 'bottle', 'R');
      d.cine(true);
      audio.play('sad');
      void d.fade(0, 1);
      d.listen('kai', 'mira', 'bram', 'nell');
      d.drift(P(-6, 60).add(V(0, 1.4, 0)), P(-5, 59).add(V(0, 1.2, 0)), P(-2.5, 57.2).add(V(0, 0.7, 0)), 8);
      await d.say('nell', '"Dear Papa. The light is on. I fixed the wick with a bootlace, so you can stop worrying about the wick."', 'tender');
      await d.say('nell', '"Tick ate a whole fish today. I think he misses you too. Please come home soon. Love, Nell."', 'sad');
      d.act(nell, 'throw');
      await d.wait(0.8);
      d.release(nell);
      d.face(nell, kai, true);
      d.close(nell, 1, 0, { dist: 1.1 });
      nell.model.face.set('shock');
      await d.say('nell', '...You\'re not him.', 'shock');
      d.two(kai, nell, 1, 0, { dist: 3.6 });
      await d.say('kai', 'I\'m Kai. That\'s Mira, that\'s Bram. We saw your light. Who\'s "Papa"?', 'tender');
      await d.say('nell', 'Elias Finch. He made the charts of the Shoals. Every rock. He went out to finish the last one, two years ago.', 'sad');
      await d.say('nell', 'He said to keep the light lit so he could find his way back. So I keep it lit.', 'determined');
      d.close(bram, -1);
      await d.say('bram', 'Two years. By yourself.', 'sad');
      await d.say('nell', 'I\'m not by myself. I have Tick. And the light. And I write to him every night, so he knows what he\'s missing.', 'smile');
      // horns in the dark
      g.sfx('cannon', undefined, 0.5);
      d.wide(P(0, 34).add(V(0, 2, 0)), Math.PI * 0.15, 30, 6, 0, 0.6);
      await d.say('wrecker', 'There\'s the light, boys! Douse it, and every ship in the Shoals is ours by morning!', 'laugh');
      d.close(nell, -1);
      await d.say('nell', 'Wreckers. They put the light out to make ships hit the reef. Every month they try.', 'angry');
      d.close(kai, 1);
      await d.say('kai', 'Not this month.', 'determined');
      d.cine(false);
      d.release(nell);
      void d.walk(nell, P(1.5, 63), true);
    }

    // ---------------------------------------------------------------- wreckers on the rocks
    if (this.from('wreckers')) {
      if (!nell) nell = await this.npc('nell', 'nell', P(1.5, 63), Math.PI);
      this.checkpoint('wreckers', P(0, 54), 0);
      if (this.starting('wreckers')) kai.place(P(0, 54), 0);
      audio.play('battle');
      await this.fight({
        center: P(0, 56), radius: 9, objective: 'Protect the light', music: 'battle', after: 'storm',
        waves: [
          [['wrecker', -6, 50], ['wrecker', 6, 50], ['wrecker', 0, 48], ['thug', -7, 58]],
          [['wrecker', 7, 58], ['wrecker', -4, 49], ['rifleman', 4, 47], ['brute', 0, 49]],
        ],
      });
      await this.reach(P(-12, 30), 5, 'The wreckers came from the sandbars');
      await this.fight({
        center: P(-12, 30), radius: 8, objective: 'Clear the sandbar', music: 'battle', after: 'storm',
        waves: [[['wrecker', -16, 24], ['wrecker', -8, 24], ['wrecker', -14, 36]], [['elite', -12, 22], ['wrecker', -6, 30], ['rifleman', -18, 30]]],
      });
    }

    // ---------------------------------------------------------------- the Maw rises
    const proxy = await spawn(g, 'thug', P(SHELF.x, SHELF.z), 0, { archetype: undefined, hp: 900, name: 'The Weeping Maw', team: 'neutral' });
    brains.delete(proxy);
    this.maw = new Serpent(this.kit, g, this.sea, P(SHELF.x, SHELF.z), SHELF.r + 3.5, proxy);
    this.boss = { f: proxy };
    if (this.from('rises')) {
      if (!nell) nell = await this.npc('nell', 'nell', P(-11, 32), 0);
      this.checkpoint('rises', P(-12, 30), Math.PI);
      if (this.starting('rises')) kai.place(P(-12, 30), Math.PI);
      d.place(nell, P(-11, 32), Math.PI);
      d.cine(true);
      audio.play('tension');
      this.maw.angle = Math.atan2(28 - SHELF.z, -12 - SHELF.x);
      this.maw.start();
      g.sfx('roar', undefined, 1);
      g.shake(0.8);
      d.wide(P(-10, 10).add(V(0, 3, 0)), 0.2, 24, 4, 0, 0.6);
      await d.wait(2.5);
      d.listen('kai', 'mira', 'bram', 'nell');
      await d.say('nell', 'The Maw. It only comes up when the light goes dark. Something woke it.', 'shock');
      await d.say('bram', 'That is not a fish. I have cooked a great many fish, and that is not one.', 'shock');
      d.close(kai, 1);
      await d.say('kai', 'Back to the Wren! Everybody run!', 'shout');
      d.cine(false);
      d.release(nell);
    }

    // ---------------------------------------------------------------- running fight across the wreck field
    if (this.from('run')) {
      if (!nell) nell = await this.npc('nell', 'nell', P(-10, 30), Math.PI);
      if (this.maw.state === 'idle') this.maw.start();
      this.checkpoint('run', P(-12, 28), Math.PI);
      if (this.starting('run')) kai.place(P(-12, 28), Math.PI);
      void d.walk(nell, P(2, -12), true);
      // the Maw harries you from the water: slams on the path
      let harry = true;
      const harryLoop = async () => {
        while (harry) {
          await d.wait(3.5);
          if (!harry) break;
          const k = this.kai.pos.add(this.kai.vel.scale(0.6));
          g.hazard(k, 2.4, 1.1, 16, 'blast');
          setTimeout(() => { g.vfx.splash(k, 30); g.sfx('splash', k); }, 1100);
        }
      };
      void harryLoop();
      await this.fight({
        center: P(-4, 10), radius: 9, objective: 'Get across the wreck field', music: 'battle', after: 'storm',
        waves: [[['wrecker', -8, 6], ['wrecker', 0, 14], ['wrecker', 2, 4]], [['brute', -4, 2], ['wrecker', -10, 12]]],
      });
      await this.reach(P(2, -8), 5, 'Reach the shelf');
      harry = false;
    }

    // ---------------------------------------------------------------- the Weeping Maw
    if (this.from('boss')) {
      if (!nell) nell = await this.npc('nell', 'nell', P(-6, -30), 0);
      this.checkpoint('boss', P(0, -14), Math.PI);
      kai.place(P(0, -14), Math.PI);
      d.place(nell, P(-6, -31), 0.5);
      if (this.maw.state === 'idle') this.maw.start();
      d.cine(true);
      d.listen('kai', 'nell', 'mira', 'bram');
      d.close(nell, 1);
      await d.say('nell', 'Papa\'s notes said it never leaves the Shoals. It just circles. Like it\'s guarding something.', 'worried');
      d.close(kai, -1);
      await d.say('kai', 'Then we make it stop circling. When it slams its head down, everybody hit it!', 'determined');
      d.cine(false);
      ui.showHint('The Maw rears up and slams where you stand. Dodge the red circle, then hit its head while it\'s stunned. Parry its spit back.', 9);
      g.collision.arena = { x: SHELF.x, z: SHELF.z, r: SHELF.r };
      g.combatActive = true;
      audio.play('boss');
      ui.setObjective('Defeat the Weeping Maw');
      let phased = false;
      await d.until(() => {
        if (!phased && proxy.hp < proxy.maxHp * 0.5) { phased = true; this.maw!.phase = 2; g.sfx('roar'); ui.showHint('It\'s angry now. Two slams, and tide rings: jump them!', 6); }
        return !proxy.alive;
      });
      g.combatActive = false;
      g.collision.arena = null;
      ui.setObjective(null);
      g.slow(0.3, 1.5);
      this.boss = null;
      await d.wait(4);
    }

    // ---------------------------------------------------------------- the letter
    if (this.from('letter')) {
      if (!nell) nell = await this.npc('nell', 'nell', P(-15, -32), 0);
      this.checkpoint('letter', P(-15, -31), 0);
      this.rain = 0.25;
      this.lightningT = -1;
      this.r.globals.set('sea', 0, 0.45, 0.8, 0.1);
      this.r.globals.setSunDir(new Vector3(0.6, 0.35, 0.5), 0.75);
      this.r.globals.set('fogColor', 0.55, 0.6, 0.68, 0.006);
      audio.play('sad');
      audio.ambience('sea');
      d.cine(true);
      const hoard = P(-18, -34);
      d.place(nell, hoard.add(V(0.8, 0, 1.6)), Math.PI);
      d.place(kai, hoard.add(V(2.0, 0, 2.2)), Math.PI + 0.4);
      d.place(mira, hoard.add(V(-1.6, 0, 3.0)), Math.PI - 0.3);
      d.place(bram, hoard.add(V(3.4, 0, 3.6)), Math.PI + 0.5);
      d.listen('kai', 'mira', 'bram', 'nell');
      d.drift(hoard.add(V(6, 2.2, 7)), hoard.add(V(4.5, 1.8, 5.5)), hoard.add(V(0.5, 1.0, 1.4)), 10);
      await d.say('mira', 'Bottles. Hundreds of them. The current brings everything here.', 'shock');
      await d.say('bram', 'It wasn\'t guarding treasure. It was guarding... letters.', 'sad');
      d.act(nell, 'kneel_hold', true);
      hold(this.ctx.flow.props, nell, 'logbook', 'R');
      d.close(nell, 1, 0, { dist: 1.2, height: -0.2 });
      await d.say('nell', 'This is Papa\'s logbook. That\'s his knot. He always tied it like a bow so it looked nice.', 'shock');
      await d.say('nell', 'There\'s a letter. It says "Nell" on it.', 'cry');
      d.shot(hoard.add(V(1.9, 1.5, 3.2)), hoard.add(V(0.8, 0.6, 1.6)), 0, 0.5);
      await d.say('nell', '"Nell, my lighthouse girl. If this reaches you, then I didn\'t."', 'cry');
      await d.say('nell', '"The Shoals are kinder than people say. Only the Maw weeps, and I think it weeps because it\'s lonely, like we were, before we had each other."', 'cry');
      await d.say('nell', '"Keep the light, but don\'t keep it for me. Keep it for whoever is still out there. And then one day..."', 'sob');
      nell.model.face.set('sob');
      await d.wait(1.6);
      d.release(kai);
      await d.walk(kai, hoard.add(V(1.5, 0, 1.6)), false, 0.25);
      d.act(kai, 'kneel_hold', true);
      d.two(kai, nell, 1, 0, { dist: 2.4, height: 0.9 });
      await d.say('kai', 'Can I?', 'tender');
      d.close(kai, -1, 0, { dist: 1.3 });
      await d.say('kai', '"...And then one day, put it out, and go and find your own sea. You are braver than all the maps in the world. I love you more than all of them. Papa."', 'cry');
      await d.wait(1.2);
      await d.say('nell', 'He wants me to put it out.', 'sob');
      d.close(mira, 1);
      await d.say('mira', 'He wants you to go. That\'s different.', 'tender');
      await d.fade(1, 1.6);
      // the last lighting
      const lamp = P(0, 64);
      d.place(nell, lamp.add(V(-1.5, 0, -2.4)), 0.4);
      d.place(kai, lamp.add(V(0.5, 0, -3.6)), 0);
      d.place(mira, lamp.add(V(-3, 0, -4.4)), 0.3);
      d.place(bram, lamp.add(V(2.2, 0, -4.6)), -0.3);
      d.act(nell, 'idle', true);
      this.r.globals.setSunDir(new Vector3(-0.7, 0.18, 0.5), 0.9);
      this.r.globals.set('sunColor', 1.0, 0.7, 0.5, 0.05);
      d.drift(lamp.add(V(-6, 3, -10)), lamp.add(V(-4, 4, -12)), lamp.add(V(0, 6, 0)), 10);
      void d.fade(0, 1.5);
      await d.wait(2);
      await d.say('nell', 'I\'ll leave it lit. For whoever\'s still out there. Tomorrow I\'ll teach the wreckers\' kids to trim the wick. They\'re not bad. Just hungry.', 'tender');
      d.close(nell, 1);
      await d.say('nell', 'You need a navigator. You don\'t have a single chart. I checked.', 'smirk');
      await d.say('kai', 'Is that a yes?!', 'joy');
      await d.say('nell', 'It\'s a "you\'d be dead by Thursday." But yes.', 'smile');
      d.act(kai, 'victory');
      flags.nell = true;
      audio.play('triumph');
      await d.wait(2.6);
      await d.fade(1, 2);
      d.cine(false);
    }
  }
}
