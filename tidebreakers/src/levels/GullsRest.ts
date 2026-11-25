// Chapter One — Gull's Rest. Golden afternoon on Kai's home island: sparring with Grandma Ines on the
// lighthouse green, the Armada landing, fights in the market lane and on the beach, the cliff path, the
// duel with Commodore Halvard, and Ines's death.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { fbm, lerp, smoothstep, pathDist } from '../world/Noise';
import type { Fighter } from '../game/Fighter';
import { hold, drop } from '../game/Props';

const RAMP: [number, number][] = [[-3, 22], [-8, 33], [-7, 46]];
const CLIFF: [number, number][] = [[18, -40], [38, -32], [50, -12], [53, 8], [48, 28], [36, 45], [20, 56]];
const GREEN = { x: 0, z: 68, r: 19 };
const FISHER = { look: { face: { eyeStyle: 3 }, tint: [0.82, 0.95, 1.12] as [number, number, number] } };
const GREEN_H = 16;

export function GULLS_HEIGHT(x: number, z: number): number { return height(x, z); }

function height(x: number, z: number): number {
  const n = fbm(x * 0.03, z * 0.03, 4, 3);
  const zz = z < 6 ? (z - 6) / 72 : (z - 6) / 90;
  const r = Math.hypot(x / 80, zz) + n * 0.07;
  let h = lerp(-9, 1.8, smoothstep(1.02, 0.86, r)) + 1.6 * smoothstep(0.86, 0.72, r);
  const hills = (fbm(x * 0.018 + 5, z * 0.018, 3, 7) * 0.5 + 0.5) * 5 * smoothstep(0.84, 0.6, r);
  h += hills * smoothstep(16, 34, Math.hypot(x, z - 6)) * smoothstep(14, 30, Math.hypot(x, z + 44));
  // the lighthouse green: a sharp plateau
  const g = Math.hypot(x - GREEN.x, (z - GREEN.z) / 0.92);
  const gh = GREEN_H + fbm(x * 0.05, z * 0.05, 2, 11) * 0.35;
  if (g < 26) h = Math.max(h, lerp(gh, h, smoothstep(GREEN.r, GREEN.r + 4.5, g)));
  // the west ramp, village to green
  const [dr, tr] = pathDist(x, z, RAMP);
  if (dr < 6) h = lerp(lerp(3.4, gh, smoothstep(0.05, 0.95, tr)), h, smoothstep(2.6, 5.5, dr));
  // the east cliff path: a ridge along the coast
  const [dc, tc] = pathDist(x, z, CLIFF);
  const ch = lerp(2.6, gh, smoothstep(0.0, 1.0, tc));
  if (dc < 10) h = Math.max(h, lerp(ch, h, smoothstep(2.4, 9, dc)));
  return h;
}

function mask(x: number, z: number, h: number): [number, number, number, number] {
  const lane = Math.abs(x + Math.sin(z * 0.08) * 1.2) < 2.6 && z > -48 && z < 24 ? 1 : 0;
  const [dr] = pathDist(x, z, RAMP);
  const [dc] = pathDist(x, z, CLIFF);
  const green = Math.hypot(x - GREEN.x, z - GREEN.z) < 6 ? 0.7 : 0;
  const path = Math.max(lane, 1 - smoothstep(1.2, 2.2, dr), 1 - smoothstep(1.2, 2.4, dc), green * (1 - smoothstep(3, 6, Math.hypot(x, z - 72))));
  const rock = h > 4 && h < GREEN_H - 1 && dc > 3 && dr > 3 ? smoothstep(0.5, 1, Math.abs(fbm(x * 0.1, z * 0.1, 2, 5)) * 3) * 0.5 : 0;
  return [path, 0.5 + 0.5 * fbm(x * 0.07, z * 0.07, 2, 1), rock, 0];
}

export const GULLS_LOOK: LookDef = {
  sun: [-0.55, 0.55, -0.62], sunIntensity: 1.2, sunColor: [1.0, 0.9, 0.72],
  sky: { zenith: '#4a8fd6', horizon: '#ffd9a8', glow: '#ffb46a', cloudLit: '#fff4e2', cloudShade: '#b4a9c8', cover: 0.42, cloudHeight: 1, sunSize: 0.002, stars: 0, moon: false },
  skyColor: [0.62, 0.72, 0.92], groundColor: [0.42, 0.38, 0.26], shadowTint: [0.5, 0.48, 0.82, 0.32], rim: [1.0, 0.85, 0.6, 0.7],
  fog: [0.95, 0.84, 0.72, 0.0022], fogParams: [0.04, 0, 45, 0.7],
  sea: { color: [0.03, 0.22, 0.38, 0.6], shallow: [0.1, 0.66, 0.62, 1.3], level: 0, amp: 0.9, chop: 1, storm: 0 },
  grade: [1.02, 1.0, 0.96, 0], wind: [0.5, 0, 0.25],
  fx: { bloom: 0.34, vignette: 0.26, gain: [1.03, 1.0, 0.95], lift: [0.01, 0.0, 0.02] },
};

export class GullsRest extends Level {
  readonly id = 'gulls';
  readonly beats = ['intro', 'ships', 'village', 'beach', 'cliff', 'boss', 'farewell'];
  private barricade = false;

  async build(): Promise<void> {
    this.setLook(GULLS_LOOK);
    this.makeTerrain(height, -130, -130, 260, 210, {
      grassLight: '#9fd062', grassDark: '#4f9a3a', sand: '#e3cb96', rock: '#948f86', dirt: '#b98d58', sandHeight: 1.75, beach: 0.45, rockSlope: 0.62, path: 1.0,
    }, mask);
    this.makeSea();
    // meadow grass: off the paths and the lane, above the sand, thinning on steep ground and near houses
    this.makeGrass((x, z, h) => {
      const m = mask(x, z, h);
      const slope = Math.abs(height(x + 1, z) - height(x - 1, z)) + Math.abs(height(x, z + 1) - height(x, z - 1));
      const houses = Math.abs(x) > 6 && Math.abs(x) < 14 && z > -12 && z < 24 ? 1 : 0;
      const lighthouse = Math.hypot(x, z - 80) < 4 || Math.hypot(x + 11, z - 66) < 4.5 ? 1 : 0;
      // the trodden patch in front of Ines's door, where the last scene of the chapter is played on the ground
      const trodden = 1 - smoothstep(2.6, 3.8, Math.hypot(x, z - 64.9));
      return (h > 2.5 ? 1 : 0) * (1 - m[0]) * (1 - smoothstep(0.9, 2.2, slope)) * (1 - houses) * (1 - lighthouse) * (1 - trodden) * (0.55 + 0.45 * fbm(x * 0.06, z * 0.06, 2, 9));
    }, { root: '#2f6a2a', tip: '#a9d65e', dry: '#c8b46a', height: 0.42, width: 0.09, threshold: 0.28, translucency: 0.7 });
    const col = this.game.collision;
    col.wallBelow = -0.9;
    col.minY = -12;
    await this.loadKits('common', 'gulls', 'ships');
    const H = (x: number, z: number) => height(x, z);
    // ---- the green: lighthouse, Ines's house, the memorial
    this.putAt('lighthouse', 0, H(0, 80) - 0.3, 80, 0, 1, 'circle');
    this.putAt('keeperhouse', -11, H(-11, 66) - 0.1, 66, Math.PI / 2);
    for (let i = 0; i < 13; i++) {
      const a = Math.PI * (0.15 + 0.7 * (i / 12));
      const x = -15 + Math.cos(a) * 4.2, z = 80 - Math.sin(a) * 4.2 + 4;
      this.put('marker', x, z, -a + Math.PI / 2, 1, 'none');
    }
    this.put('rock3', -15, 84.5, 0.3, 0.5, 'circle');
    this.put('marker_small', -18.6, 85.6, 0.6, 1, 'none');
    for (const [x, z, r] of [[-12, 54, 0.2], [10, 56, -0.4], [14, 70, 1.4], [-18, 72, 1.2], [8, 86, 0.1]] as const) this.put('fence', x, z, r, 1.2, 'box');
    this.put('netrack', 9, 62, 0.5, 1, 'box');
    this.put('barrel', -8, 62, 0, 1, 'circle');
    this.put('crate', -7.5, 60.6, 0.3, 1, 'box');
    // ---- the village lane
    const west: [string, number][] = [['cottageA', -6], ['cottageC', 3], ['cottageB', 12], ['cottageA', 20]];
    for (const [k, z] of west) this.put(k, -10.5, z, Math.PI / 2, 1, 'box');
    const east: [string, number][] = [['cottageB', -4], ['cottageA', 6], ['cottageC', 16]];
    for (const [k, z] of east) this.put(k, 10.5, z, -Math.PI / 2, 1, 'box');
    this.put('stall', -4.6, 0, Math.PI / 2, 1, 'box');
    this.put('stall', 4.8, 10, -Math.PI / 2, 1, 'box');
    this.put('stall', -4.6, 15, Math.PI / 2, 1, 'box');
    for (const [x, z] of [[-5.6, -10], [5.6, -2], [-5.6, 7], [5.6, 18]] as const) { this.put('lamppost', x, z, x > 0 ? Math.PI : 0, 1, 'none'); col.addCircle(x, z, 0.15); }
    for (const [x, z] of [[-6.5, -3], [6.8, 2], [-7, 18], [7.2, 12], [6.5, -9]] as const) this.put('barrel', x, z, x, 1, 'circle');
    for (const [x, z, r] of [[-6.8, 9, 0.2], [7.1, 21, 0.7], [-7.2, -12, 1.1], [7.6, 13.4, 0.4]] as const) this.put('crate', x, z, r, 1, 'box');
    this.put('flagpole', 0, 24, 0, 1, 'none');
    col.addCircle(0, 24, 0.15);
    // ---- the beach and the dock
    this.putAt('dock', 0, 1.9, -57, 0, 1, 'none');
    this.putAt('dock', 0, 1.9, -69, 0, 1, 'none');
    col.addPlatform(0, -69, 1.6, 12.2, 1.98);
    col.addBox(1.62, -69, 0.08, 12.2, 0, -5, 10);
    col.addBox(-1.62, -69, 0.08, 12.2, 0, -5, 10);
    this.putAt('wren', 5.2, 0.35, -73, -Math.PI / 2, 1, 'none');
    this.putAt('rowboat', -14, H(-14, -55) + 0.25, -55, 0.4, 1, 'box');
    this.putAt('rowboat', 15, H(15, -56) + 0.25, -56, -0.3, 1, 'box');
    this.put('netrack', -10, -48, 0.1, 1, 'box');
    this.put('netrack', 12, -47, -0.2, 1, 'box');
    for (const [x, z] of [[-3, -47], [3.5, -49], [-6, -51]] as const) this.put('crate', x, z, x, 1, 'box');
    this.put('barrel', 4.5, -46, 0, 1, 'circle');
    // ---- the Armada in the bay
    this.putAt('frigate', -55, 1.6, -150, 0.5, 1, 'none');
    this.putAt('frigate', 24, 1.6, -168, -0.25, 1, 'none');
    this.putAt('frigate', 85, 1.6, -138, -0.9, 1, 'none');
    // ---- trees, palms, rocks, bushes
    const trees: [string, number, number, number][] = [
      ['tree1', -26, 10, 1], ['tree2', 24, 24, 1.1], ['tree1', -30, 32, 1.2], ['tree2', 30, -8, 1], ['tree1', -22, -20, 0.9], ['tree2', 22, -22, 1],
      ['tree1', -40, 0, 1.3], ['tree2', 38, 10, 1.1], ['tree1', -18, 40, 1], ['tree2', 18, 40, 1.2], ['tree1', -36, -30, 1], ['tree2', -12, 30, 0.8],
    ];
    for (const [k, x, z, s] of trees) { this.put(k, x, z, x * 0.3, s, 'none'); col.addCircle(x, z, 0.4 * s); }
    const palms: [string, number, number, number][] = [
      ['palm1', -30, -46, 1], ['palm2', -22, -50, 1.1], ['palm3', 26, -46, 1], ['palm1', 34, -40, 0.9], ['palm2', -42, -36, 1], ['palm3', -8, -52, 0.9],
      ['palm1', 44, -30, 1.1], ['palm3', -50, -20, 1],
    ];
    for (const [k, x, z, s] of palms) { this.put(k, x, z, x * 0.7, s, 'none'); col.addCircle(x, z, 0.3 * s); }
    const rocks: [string, number, number, number, number][] = [
      ['rock4', 15, 49, 0, 1.4], ['rock4', -17, 50, 1, 1.2], ['rock3', 62, 0, 0, 1.6], ['rock4', 60, -22, 2, 1.4], ['rock3', 62, 22, 1, 1.3],
      ['rock4', -64, 10, 0, 1.5], ['rock3', -60, -22, 2, 1.4], ['rock2', -20, -58, 0, 1], ['rock2', 22, -60, 1, 1.2], ['rock3', 28, -62, 0.5, 1],
      ['rock1', 8, -60, 0, 1], ['rock3', -34, -56, 1, 1.4], ['rock4', 20, 74, 1, 1.2], ['rock4', -22, 76, 2, 1.1], ['rock3', 6, 90, 0, 1.3],
    ];
    for (const [k, x, z, r, s] of rocks) this.put(k, x, z, r, s, 'circle', -0.4 * s);
    for (let i = 0; i < 34; i++) {
      const a = i * 2.39996, d = 14 + (i * 7.3) % 40;
      const x = Math.cos(a) * d, z = 6 + Math.sin(a) * d * 1.2;
      if (Math.abs(x) < 13 && z > -15 && z < 26) continue;
      if (pathDist(x, z, CLIFF)[0] < 3.5 || pathDist(x, z, RAMP)[0] < 3.5) continue;
      if (height(x, z) < 2.6) continue;
      this.put(i % 2 ? 'bush1' : 'bush2', x, z, a, 0.8 + (i % 3) * 0.25, 'none');
    }
    // lamps at dusk are lit
    for (const [x, z] of [[-5.6, -10], [5.6, -2], [-5.6, 7], [5.6, 18]] as const) this.light(V(x + (x > 0 ? -0.42 : 0.42), H(x, z) + 2.5, z), 5, [1, 0.75, 0.4], 0.6);
  }

  // ------------------------------------------------------------------------------------------ story
  async script(_at: string): Promise<void> {
    const d = this.dir, ui = this.ctx.ui, audio = this.ctx.audio, g = this.game, kai = this.kai, pc = this.ctx.pc;
    const H = (x: number, z: number) => height(x, z);
    const P = (x: number, z: number) => V(x, H(x, z), z);
    pc.specialsUnlocked = { burst: !!this.ctx.flow.flags.burst, dash: !!this.ctx.flow.flags.dash, super: !!this.ctx.flow.flags.super };
    audio.ambience('sea');
    const ines = await this.npc('ines', 'ines', P(4, 63), Math.PI);
    hold(this.ctx.flow.props, ines, 'cane');
    let wim: Fighter | null = null, joss: Fighter | null = null;
    const greeters: Fighter[] = [];

    // ---------------------------------------------------------------- intro: sparring on the green
    if (this.from('intro')) {
      kai.place(P(-1, 60), 0.2);
      this.checkpoint('intro', P(-1, 60), 0.2);
      wim = await this.npc('villager', 'wim', P(5, 58), -0.9);
      joss = await this.npc('villager', 'joss', P(6.5, 60), -1.2);
      d.cine(true);
      audio.play('island');
      d.drift(V(-40, 26, -40), V(-30, 24, -20), V(0, 14, 70), 9);
      await d.card('CHAPTER ONE', 'Gull\'s Rest', 'Seventeen years old, and still losing to his grandmother.');
      d.face('ines', kai, true);
      d.face(kai, ines, true);
      d.act(kai, 'guard', true);
      d.listen('kai', 'ines', 'wim', 'joss');
      d.two(kai, ines, 1, 0);
      await d.say('ines', 'Again. Your guard drops every time you get excited.', 'smirk', 'talk');
      d.close(kai, -1);
      await d.say('kai', 'It doesn\'t drop! It... relaxes. Strategically.', 'grin');
      d.close('ines', 1);
      await d.say('ines', 'The sea doesn\'t care about strategy, boy. Wim, Joss. Show him.', 'calm', 'point');
      d.two('wim', 'joss', -1, 0, { dist: 3.4 });
      await d.say('wim', 'Sorry, Kai. She\'s paying us in pie.', 'embarrassed', 'talk');
      d.close(kai, 1, 0, { dist: 1.0 });
      await d.say('kai', 'PIE?! Grandma, you never pay ME in pie!', 'shock');
      d.two(kai, ines, 1, 0);
      await d.say('ines', 'Win, and we\'ll talk about pie.', 'smile', 'cross_arms');
      d.cine(false);
      // the spar: the twins yield instead of falling
      d.release('wim'); d.release('joss');
      for (const f of [wim, joss]) f.model.dispose();
      g.fighters = g.fighters.filter((f) => f !== wim && f !== joss);
      wim = await this.sparrer('Wim', P(5, 58));
      joss = await this.sparrer('Joss', P(6.5, 61));
      d.place(ines, P(-8, 66), 1.4);
      g.collision.arena = { x: 1, z: 61, r: 11 };
      g.combatActive = true;
      audio.play('battle');
      ui.setObjective('Spar with the Pell twins');
      const hints = ['<b>J</b> / left click: attack. Press it four times for a full combo', '<b>K</b> / right click: heavy. Hold it to charge a launcher', '<b>Q</b>: guard. Tap it just before a hit lands to <b>parry</b>',
        '<b>Shift</b>: dodge through attacks', '<b>Space</b>: jump, then attack in the air', '<b>Tab</b>: lock on to a target'];
      let hi = 0;
      ui.showHint(hints[0]);
      const yielded = new Set<Fighter>();
      for (const f of [wim, joss]) {
        f.floorHp = 1;
        f.onFloor = () => { yielded.add(f); f.team = 'neutral'; f.setState('knock'); f.vel.y = 3; f.onGround = false; f.play(f.anims.knock, false, 0.05); };
      }
      const t0 = d.time;
      await d.until(() => {
        const k = Math.min(hints.length - 1, Math.floor((d.time - t0) / 9));
        if (k !== hi) { hi = k; ui.showHint(hints[k]); }
        return yielded.size === 2;
      });
      ui.showHint(null);
      ui.setObjective(null);
      g.combatActive = false;
      g.collision.arena = null;
      await d.wait(1.6);
      audio.play('island');
      d.cine(true);
      d.place(ines, P(3, 64), Math.PI);
      kai.place(P(1, 61), 0.4);
      d.face(kai, ines, true);
      d.face(ines, kai, true);
      for (const f of [wim, joss]) { d.act(f, 'sit', true); f.model.face.set('laugh'); }
      d.two(kai, ines, -1, 0);
      await d.say('joss', 'Ow. Okay. Okay! You win.', 'pain');
      d.listen('kai', 'ines');
      await d.say('ines', 'Better. Your mother fought like that. All heart, no elbows.', 'tender', 'talk');
      d.close(kai, -1);
      await d.say('kai', 'Tell me about her again?', 'tender');
      d.face(ines, P(0, 80));
      d.wide(P(0, 74), 0.6, 16, 5, 0, 0.6);
      await d.say('ines', 'Seren kept this light eleven years. She never once let it go out. Not even the night of the Great Squall.', 'sad');
      d.ots(kai, ines, 1);
      await d.say('kai', 'And she rowed out anyway.', 'sad');
      d.face(ines, kai);
      await d.say('ines', 'And she rowed out anyway. To a ferry full of strangers. That\'s who you come from.', 'tender');
      hold(this.ctx.flow.props, kai, 'lantern', 'L');
      d.close(kai, 1, 0, { dist: 1.1 });
      await d.say('kai', 'I still light her lantern, you know. Every night.', 'smile');
      await d.say('ines', 'I know, love. I can see it from my window.', 'tender');
      drop(kai, 'lantern');
      // an ordinary morning on the green, the last one: the village came out to watch the spar
      await d.say('ines', 'Go on, then. Half the village came up to watch you lose. Go and tell them you didn\'t.', 'smirk');
      const abe = await this.npc('villager', 'abe', P(-6.5, 56.5), 0.9, { look: { tint: [0.8, 0.78, 0.72] as [number, number, number] } });
      const tilly = await this.npc('teo', 'tilly', P(7.5, 54.5), -0.6, { look: { face: { eyeStyle: 1 }, tint: [1.0, 0.85, 0.95] as [number, number, number] } });
      const pell = await this.npc('villager', 'pell', P(-4.5, 68.5), 2.6, { look: { face: { eyeStyle: 1 }, tint: [0.85, 0.9, 1.0] as [number, number, number] } });
      d.act(abe, 'cross_arms', true);
      d.cine(false);
      const chat = async (who: Fighter, key: string, lines: [string, string, string][]) => {
        await this.reach(who.pos, 2.4, 'Say good morning to the village');
        d.cine(true);
        // a conversational distance, whatever distance he arrived at (running right up to someone, or the
        // test bot's teleport onto the marker, left them standing in each other)
        const away = kai.pos.subtract(who.pos); away.y = 0;
        if (away.length() < 1.4) {
          const dir = away.length() > 0.05 ? away.normalize() : who.forward;
          d.place(kai, this.standAt(who.pos.add(dir.scale(1.6)), 1.5));
        }
        d.face(kai, who, true);
        d.face(who, kai, true);
        d.face(kai, who);
        d.face(who, kai);
        d.listen('kai', key);
        d.two(kai, who, 1, 0, { dist: 3.4 });
        let last = '';
        for (const [sp, text, e] of lines) {
          if (last && sp !== last) d.close(sp === 'kai' ? kai : who, sp === 'kai' ? -1 : 1, 0, { dist: 2.0 });
          await d.say(sp, text, e);
          last = sp;
        }
        d.cine(false);
      };
      await chat(abe, 'abe', [
        ['abe', 'Your mum used to spar on this green, you know. She\'d knock me flat, then help me up and apologise for an hour.', 'laugh'],
        ['kai', 'Did she ever lose?', 'grin'],
        ['abe', 'Once. To your grandmother. She never stopped talking about it.', 'smile'],
      ]);
      await chat(pell, 'pell', [
        ['pell', 'Don\'t let Ines fool you, lad. She walks out to that cliff every evening at dusk and looks south. Thirty years.', 'calm'],
        ['kai', 'Looking for what?', 'worried'],
        ['pell', 'Sails. She never says whose.', 'sad'],
      ]);
      await chat(tilly, 'tilly', [
        ['tilly', 'Kai! Kai! Are you really going to be a pirate?', 'joy'],
        ['kai', 'The best one. With a crew and a ship and a flag with a gull on it.', 'grin'],
        ['tilly', 'Can I be on your crew?', 'joy'],
        ['kai', 'When you\'re tall enough to see over the wheel.', 'smile'],
        ['tilly', 'I\'m tall enough NOW!', 'angry'],
      ]);
      await this.reach(P(1, 61), 2.5, 'Back to Grandma Ines. She promised pie');
      d.cine(true);
      d.place(kai, P(1, 61), 0.4);
      d.place(ines, P(3, 64), Math.PI);
      for (const f of [abe, tilly, pell]) { d.release(f); greeters.push(f); }
    }

    // ---------------------------------------------------------------- ships in the bay
    if (this.from('ships')) {
      if (this.starting('ships')) { kai.place(P(1, 61), 0.4); d.place(ines, P(3, 64), Math.PI); d.cine(true); }
      this.checkpoint('ships', P(1, 61), Math.PI);
      if (!wim) wim = await this.npc('villager', 'wim', P(5, 58), -0.9);
      g.sfx('cannon', undefined, 1);
      g.shake(0.5);
      await d.wait(0.6);
      d.drift(V(-6, 26, 40), V(-8, 24, 30), V(10, 4, -150), 4.5);
      audio.play('tension');
      await d.wait(1.6);
      g.sfx('cannon', undefined, 0.7);
      await d.say('wim', 'Ships! Grandma Ines, those are Armada ships!', 'shock');
      d.close('ines', -1, 0, { dist: 1.0 });
      await d.say('ines', 'White sails. A gold sun... No. Not here. Not again.', 'shock');
      d.two(kai, ines, 1, 0);
      await d.say('kai', 'Grandma?', 'worried');
      await d.say('ines', 'Kai. Take the boys down to the village. Get everyone into the sea caves. Now.', 'determined', 'point');
      await d.say('kai', 'What about you?', 'worried');
      d.close('ines', 1);
      await d.say('ines', 'I\'m seventy-four and I own a cane. I\'ll be fine. GO!', 'shout');
      d.cine(false);
      for (const f of g.fighters) if (f.team === 'neutral' && f !== ines) { f.setState('idle'); void d.walk(f, P(-4, 24), true); }
      await this.reach(P(-2, 22), 5, 'Get down to the village');
      for (const f of [...g.fighters]) if (f.team === 'neutral' && f !== ines) { g.removeFighter(f); }
    }

    // ---------------------------------------------------------------- the market lane
    if (this.from('village')) {
      for (const f of greeters) g.removeFighter(f);
      greeters.length = 0;
      this.checkpoint('village', P(-2, 20), Math.PI);
      if (this.starting('village')) kai.place(P(-2, 20), Math.PI);
      d.place(ines, P(-11, 64), 0);
      const fisher = await this.npc('villager', 'fisher', P(1, 6), 0, FISHER);
      const m1 = await this.npc('marine', 'marine', P(-1.5, 3.5), 0.2);
      const m2 = await this.npc('marine', 'm2', P(2.5, 3), -0.3);
      d.cine(true);
      kai.place(P(-1, 14), Math.PI);
      d.face(fisher, kai, true);
      d.listen('kai', 'fisher', 'marine', 'm2');
      d.two(m1, fisher, 1, 0, { dist: 4 });
      await d.say('marine', 'Search every house. The Commodore wants the old woman, and the boy with the storm in him.', 'angry', 'point');
      d.act(fisher, 'cross_arms', true);
      await d.say('fisher', 'There\'s no storm here, son. Just fish. And not many of those.', 'smirk');
      d.act(m1, 'shield_bash');
      await d.wait(0.35);
      d.act(fisher, 'knockdown');
      g.sfx('thud');
      await d.wait(0.6);
      d.close(kai, 1, 0, { dist: 1.2 });
      await d.say('kai', 'Hey! Hands off, tin-buttons!', 'angry');
      d.ots(m1, kai, -1);
      await d.say('marine', 'Black hair, red headband, no sense. That\'s him. Take the pearl-boy!', 'shout');
      d.cine(false);
      for (const m of [m1, m2]) { g.removeFighter(m); }
      void d.walk(fisher, P(-6, -12), true);
      await this.fight({
        center: P(0, 6), radius: 13, objective: 'Drive the marines out of the lane',
        hint: this.starting('village') ? undefined : 'Marines telegraph with a flash. Watch for it, then dodge or parry.',
        waves: [
          [['marine', -1.5, 3.5], ['marine', 2.5, 3], ['marine', 0, -4]],
          [['marine', -3, 16], ['marine', 3, 17], ['marine', 0, -6]],
        ],
      });
      g.removeFighter(fisher);
    }

    // ---------------------------------------------------------------- the beach
    if (this.from('beach')) {
      this.checkpoint('beach', P(0, -16), Math.PI);
      if (this.starting('beach')) kai.place(P(0, -16), Math.PI);
      ui.showHint('Riflemen flash yellow before they fire. <b>Parry</b> (Q) a bullet to knock it back.', 8);
      await this.reach(P(0, -34), 6, 'Get to the quay');
      await this.fight({
        center: P(0, -43), radius: 13.5, objective: 'Clear the beach',
        waves: [
          [['marine', -4, -48], ['marine', 4, -49], ['rifleman', -8, -52], ['rifleman', 8, -52]],
          [['rifleman', 0, -55], ['marine', -9, -40], ['marine', 9, -38], ['rifleman', 10, -50]],
        ],
      });
      // smoke over the green
      this.addFire(P(-11, 66), 1.6);
      this.addFire(P(-9, 64), 1.1);
      this.addFire(P(-13, 68), 1.2);
      d.cine(true);
      const fisher = await this.npc('villager', 'fisher', P(-6, -38), 0.4, FISHER);
      d.face(kai, P(0, 70), true);
      d.wide(P(0, 30), Math.PI + 0.3, 70, 4, 0, 0.55);
      d.drift(P(-2, -34).add(V(0, 2, 0)), P(-2, -30).add(V(0, 3, 0)), P(-10, 66).add(V(0, 6, 0)), 4);
      await d.say('fisher', 'Smoke. That\'s the light! They\'ve gone up for Ines!', 'shock');
      d.close(kai, 1, 0, { dist: 1.0 });
      await d.say('kai', 'GRANDMA!', 'shout');
      this.blockRamp();
      d.ots(kai, fisher, 1);
      await d.say('fisher', 'Not the lane, it\'s burning! Take the cliff path, past the old cannery. Run, boy!', 'determined', 'point');
      d.cine(false);
      g.removeFighter(fisher);
      this.ctx.flow.flags.burst = true;
      pc.specialsUnlocked.burst = true;
      ui.showHint('<b>Gale Burst</b> unlocked: press <b>E</b> with a third of the storm meter. It blows through guards.', 9);
    }

    // ---------------------------------------------------------------- the cliff path
    if (this.from('cliff')) {
      if (!this.fires.length) { this.addFire(P(-11, 66), 1.6); this.addFire(P(-9, 64), 1.1); this.addFire(P(-13, 68), 1.2); }
      this.blockRamp();
      this.checkpoint('cliff', P(18, -38), 0.9);
      if (this.starting('cliff')) kai.place(P(18, -38), 0.9);
      g.storm = Math.max(g.storm, 40);
      await this.reach(P(48, -14), 6, 'Climb the cliff path to the lighthouse');
      await this.fight({
        center: P(51, -6), radius: 9, objective: 'Break through',
        waves: [[['brute', 52, 4], ['marine', 48, 2]], [['marine', 52, -16], ['rifleman', 54, 8]]],
      });
      await this.reach(P(46, 30), 6, 'Climb the cliff path to the lighthouse');
      await this.fight({
        center: P(44, 34), radius: 9, objective: 'Break through',
        waves: [[['brute', 40, 42], ['marine', 46, 40], ['rifleman', 36, 44]], [['brute', 48, 26], ['marine', 40, 40]]],
      });
      await this.reach(P(24, 54), 5, 'Reach the lighthouse');
    }

    // ---------------------------------------------------------------- Halvard
    if (this.from('boss')) {
      if (!this.fires.length) { this.addFire(P(-11, 66), 1.6); this.addFire(P(-9, 64), 1.1); this.addFire(P(-13, 68), 1.2); }
      this.checkpoint('boss', P(14, 60), -1.6);
      kai.place(P(14, 60), -1.6);
      audio.play('tension');
      d.place(ines, P(-6, 72), 0.5);
      const guards = [await this.npc('marine', 'g1', P(-8.5, 72.5), 1.2), await this.npc('marine', 'g2', P(-5, 75), 2.2)];
      const { f: halvard, brain } = await this.addBoss('halvard', P(-2, 68), -1.2, 500);
      brain.active = false;
      d.cine(true);
      d.face(halvard, ines, true);
      d.listen('ines', 'halvard', 'kai');
      d.drift(P(-20, 50).add(V(0, 5, 0)), P(-16, 56).add(V(0, 3.5, 0)), P(-4, 70).add(V(0, 1.4, 0)), 7);
      await d.say('halvard', 'Ines Corra. Navigator of the Merry Albatross. Thirty years, and you\'re the last name on my list.', 'calm', 'talk');
      d.close('ines', 1);
      await d.say('ines', 'I remember you. A skinny ensign holding the hangman\'s lantern, crying while the ropes went tight.', 'determined');
      d.close(halvard, -1);
      await d.say('halvard', 'I was a boy. I grew up. The sea needs order, old woman, and pirates hang.', 'angry');
      await d.say('ines', 'They were fishermen who carried letters for people your Admiral didn\'t like. You knew that then, too.', 'sad');
      d.face(halvard, kai);
      d.face('ines', kai);
      await d.walk(kai, P(8, 64), true);
      d.close(kai, 1, 0, { dist: 1.15 });
      await d.say('kai', 'GET AWAY FROM HER!', 'shout');
      d.two(kai, halvard, 1, 0, { dist: 6 });
      await d.say('halvard', 'And here\'s the storm itself. Grand Admiral Vale sends his regards, boy. He wants that pearl in your chest. With or without the rest of you.', 'smirk', 'talk');
      await d.say('kai', 'Then come and get it.', 'determined');
      d.cine(false);
      d.act(ines, 'idle', true);
      this.ctx.flow.flags.dash = true;
      pc.specialsUnlocked.dash = true;
      ui.showHint('<b>Tempest Dash</b> unlocked: <b>R</b> to dash through enemies.', 7);
      // phase one until he takes half his health
      halvard.floorHp = Math.round(halvard.maxHp * 0.5);
      const floored = new Promise<void>((res) => { halvard.onFloor = res; });
      g.collision.arena = { x: 1, z: 64, r: 14 };
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      ui.setObjective('Defeat Commodore Halvard');
      for (const gd of guards) d.act(gd, 'sword_idle', true);
      await floored;
      ui.setObjective(null);
      // he ends it
      g.combatActive = false;
      brain.active = false;
      g.slow(0.35, 0.8);
      d.cine(true);
      halvard.attack = null; halvard.telegraphing = 0; halvard.pendingAttack = null;
      const kp = kai.pos.clone();
      const toK = kp.subtract(halvard.pos); toK.y = 0;
      const hp = kp.subtract(toK.normalize().scale(2.4));
      d.place(halvard, hp, Math.atan2(toK.x, toK.z));
      await d.say('halvard', 'Enough.', 'angry');
      d.act(halvard, 'sweep');
      await d.wait(0.55);
      g.sfx('heavy_hit'); g.shake(0.5); g.impactFrame(0.06);
      d.act(kai, 'knockdown');
      kai.model.face.set('pain');
      await d.wait(1.2);
      d.act(halvard, 'overhead');
      halvard.animator.update(0.35);
      d.two(halvard, kai, 1, 0, { dist: 4.2, height: 1.1 });
      // Ines runs between them
      d.release(ines);
      ines.runSpeed = 4.5;
      const mid = Vector3.Lerp(halvard.pos, kai.pos, 0.55);
      await d.walk(ines, mid, true, 0.3);
      d.face(ines, halvard, true);
      d.act(ines, 'idle');
      g.slow(0.25, 1.6);
      g.impactFrame(0.1);
      g.sfx('blade_heavy'); g.shake(0.8);
      // (from high and to his side: Ines falls between him and Halvard, right where a front close-up would be)
      d.close(kai, 1, 0, { dist: 1.5, height: 0.55, angle: 1.0, fov: 0.55 });
      kai.model.face.set('shock');
      d.act(ines, 'death');
      ines.model.face.set('pain');
      audio.play('none');
      await d.wait(1.6);
      await d.say('kai', 'NO!!', 'sob');
      // the storm wakes
      d.act(kai, 'hurricane');
      g.speedLines(2.0);
      g.vfx.gale(kai.center, kai.forward, 3);
      g.vfx.impact(kai.center, 3, [1.2, 2.2, 3]);
      g.sfx('hurricane'); g.shake(1);
      this.rain = 0.8;
      this.lightningT = 0.4;
      this.r.globals.setSunDir(new Vector3(-0.4, 0.5, -0.6), 0.45);
      this.r.globals.set('fogColor', 0.42, 0.45, 0.55, 0.02);
      for (const gd of guards) { gd.vel.set(-6, 3, 4); d.act(gd, 'knockdown'); }
      d.act(halvard, 'hit_front');
      halvard.place(halvard.pos.add(toK.normalize().scale(-2.2)), halvard.yaw);
      await d.wait(1.6);
      d.close(halvard, -1);
      d.face(halvard, P(0, 0));
      await d.say('halvard', '...The pearl\'s waking. Not here. Not like this.', 'shock');
      d.face(halvard, ines);
      await d.say('halvard', 'She shouldn\'t have... Fall back to the ships! All of you!', 'sad');
      for (const f of [halvard, ...guards]) { d.release(f); f.team = 'neutral'; void d.walk(f, P(30, 30), true); }
      await d.wait(2.2);
      for (const f of [halvard, ...guards]) g.removeFighter(f);
      this.boss = null;
    }

    // ---------------------------------------------------------------- farewell
    if (this.from('farewell')) {
      this.checkpoint('farewell', P(0, 64), 0);
      this.rain = 0.7;
      this.lightningT = 3;
      this.r.globals.setSunDir(new Vector3(-0.4, 0.5, -0.6), 0.45);
      this.r.globals.set('fogColor', 0.42, 0.45, 0.55, 0.02);
      if (!this.fires.length) { this.addFire(P(-11, 66), 1.3); this.addFire(P(-9, 64), 0.9); }
      d.cine(true);
      audio.play('sad');
      audio.ambience('rain');
      const c = P(0, 64);
      d.place(kai, c, 0);
      // she lies on her back with her head in his arms (the clip lays the head ~1 m behind her feet' root)
      d.place(ines, c.add(V(0, 0, 1.45)), 0);
      d.act(kai, 'kneel_hold', true);
      d.act(ines, 'lie_back', true);
      ines.animator.update(0.5);
      ines.model.face.snap('tired');
      ines.model.face.autoBlink = false;
      kai.model.face.set('cry');
      d.drift(c.add(V(3.5, 1.6, 3)), c.add(V(2.2, 1.2, 2.0)), c.add(V(0, 0.55, 0.5)), 10);
      // Kai kneels over her with his head bowed: his close-ups are from low in front, under his eyeline (her
      // shoulder in the foreground); hers look down on her face from his side
      const kh = () => d.headOf(kai), ih = () => d.headOf(ines);
      // Kai from low in front, under his bowed face (her shoulder in the foreground); Ines from beside and above
      // her face, Kai bent over her at the edge of the frame
      const onKai = (s: number) => d.shot(kh().add(V(0.42 * s, -0.55, 0.95)), kh().add(V(0, -0.06, 0)), 0, 0.5, kh);
      const onInes = (s: number) => d.shot(ih().add(V(0.22 * s, 1.05, 0.42)), ih().add(V(0, 0.02, 0.04)), 0, 0.5, ih);
      // the two of them from the side: him kneeling, her full length on the ground
      // (from above, so her body on the ground sits clear of the dialogue panel at the bottom of the frame)
      const both = (s: number) => d.shot(c.add(V(2.7 * s, 2.0, 0.85)), c.add(V(0, 0.3, 0.7)), 0, 0.62);
      await d.wait(2.5);
      await d.say('ines', 'Kai... don\'t make that face. You look like your mother the day she burned the bread.', 'tired');
      onKai(1);
      await d.say('kai', 'Don\'t talk. I\'ll get Doc Pell, I\'ll carry you, I\'ll...', 'cry');
      both(-1);
      await d.say('ines', 'Listen. In my coat. The Albatross\'s log. Thirteen names... Read them out loud now and then. So they don\'t get lonely.', 'tender');
      hold(this.ctx.flow.props, kai, 'logbook', 'L');
      onKai(-1);
      await d.say('kai', 'Grandma, please...', 'sob');
      onInes(1);
      await d.say('ines', 'I stayed on this rock thirty years so someone would remember them. And it was so lonely, love.', 'cry');
      both(1);
      await d.say('ines', 'Until a little drowned boy came walking out of the sea with a light in his hand.', 'tender');
      both(1);
      await d.say('ines', 'Find a crew, Kai. Don\'t sail alone like I did. Promise me.', 'tender');
      onKai(1);
      await d.say('kai', 'I promise. I promise!', 'sob');
      onInes(1);
      await d.say('ines', '...There. All heart. No elbows.', 'smile');
      ines.model.face.set('dead', 1.2);
      await d.wait(2.5);
      d.drift(c.add(V(0, 2.5, 4)), c.add(V(0, 9, 12)), c.add(V(0, 0.5, 0)), 7);
      kai.model.face.set('sob');
      g.sfx('thunder');
      await d.wait(4);
      await d.fade(1, 2.5);
      // the morning after
      this.rain = 0;
      this.lightningT = -1;
      this.r.globals.set('flash', 0, 0, 0, 0);
      this.fires = [];
      this.r.globals.lights = [];
      this.r.globals.setSunDir(new Vector3(0.6, 0.3, -0.7), 0.9);
      this.r.globals.set('fogColor', 0.85, 0.8, 0.78, 0.008);
      audio.ambience('sea');
      g.removeFighter(ines);
      ui.showSubtitle('That night, the people of Gull\'s Rest buried Ines Corra beside the thirteen, and the little one from the Squall.');
      await d.wait(4.5);
      ui.showSubtitle(null);
      this.put('marker', -15 + 4.6, 84.5, 0.3, 1.1, 'none');
      const mem = P(-13, 80);
      kai.place(mem, 0.6);
      drop(kai);
      hold(this.ctx.flow.props, kai, 'logbook', 'L');
      const fisher = await this.npc('villager', 'fisher', mem.add(V(2.4, 0, -1.6)), -0.6, FISHER);
      const wim2 = await this.npc('villager', 'wim', mem.add(V(-2.2, 0, -1.8)), 0.5);
      d.act(kai, 'idle', true);
      d.listen('kai', 'fisher', 'wim');
      // the memorial at dawn, the three of them by the new stone
      d.wide(mem.add(V(0, 0.9, 0)), Math.PI + 0.6, 7, 2.0, 0, 0.6);
      void d.fade(0, 2.5);
      await d.wait(3);
      d.two(kai, fisher, 1, 0);
      await d.say('fisher', 'Where will you go?', 'sad');
      d.close(kai, 1, 0, { dist: 1.3 });
      await d.say('kai', 'Wherever the Armada\'s going.', 'determined');
      await d.say('kai', '...And I\'m going to find a crew. I promised.', 'tender');
      d.act(kai, 'talk', true);
      d.close(kai, -1, 0, { dist: 1.3 });
      await d.say('kai', '"Day one. Fair wind. Thirteen of us and a cat." ...Ha. She never told me there was a cat.', 'cry');
      d.two(kai, wim2, 1, 0);
      await d.say('wim', 'Take the Wren. She\'d want it sailed, not sitting at the quay.', 'sad');
      await d.fade(1, 1.5);
      g.removeFighter(fisher);
      g.removeFighter(wim2);
      drop(kai);
      // the Wren sails
      const boatPos = V(5.2, 1.3, -73);
      kai.place(boatPos, Math.PI);
      kai.pos.y = 1.3;
      d.act(kai, 'idle', true);
      hold(this.ctx.flow.props, kai, 'lantern', 'R');
      audio.play('lullaby');
      d.drift(V(30, 8, -96), V(18, 5, -104), V(4, 2, -76), 9);
      void d.fade(0, 2);
      await d.wait(2.5);
      d.close(kai, 1, 0, { dist: 1.5 });
      await d.say('kai', 'Okay, Mum. Grandma. Let\'s go.', 'determined');
      d.drift(V(18, 5, -104), V(12, 9, -120), V(4, 2, -76), 6);
      await d.wait(4);
      await d.fade(1, 2);
      drop(kai);
      d.cine(false);
    }
  }

  private async sparrer(name: string, p: Vector3): Promise<Fighter> {
    const f = await this.enemy('villager', p.x, p.z, undefined, { team: 'enemy', archetype: 'thug', hp: 45, name });
    return f;
  }

  private blockRamp(): void {
    if (this.barricade) return;
    this.barricade = true;
    const z = 24.5;
    for (let i = -2; i <= 2; i++) this.put(i % 2 ? 'crate' : 'barrel', -3.6 + i * 1.2, z + (i % 2) * 0.4, i, 1, 'none');
    this.game.collision.addBox(-3.6, z, 4.5, 1.2, 0, -5, 30);
    this.addFire(V(-3.6, height(-3.6, z), z), 1.2);
  }
}
