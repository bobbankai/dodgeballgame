// Chapter Five — The Sunken Crown. Vale's Reach: a white-and-gold citadel over the place where Ys-Marrow
// drowned. The crew splits to hold the three gates; Kai climbs alone to the Crown. Severin Vale lost his wife
// and his daughter Lissa to the Great Squall and wants the sea stilled forever. In the second phase he raises
// the drowned city and the sea turns to glass; Kai's storm nearly takes him, and his crew pulls him back.
// Then Kai tells Vale where his daughter is buried.
import { Vector3, Vector4 } from '@babylonjs/core';
import type { InstancedMesh } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { fbm, lerp, smoothstep, plateau } from '../world/Noise';
import type { Fighter } from '../game/Fighter';
import { hold, drop } from '../game/Props';

const SUMMIT = { x: 0, z: 36, r: 15 };

function height(x: number, z: number): number {
  const n = fbm(x * 0.03, z * 0.03, 4, 41);
  let h = -12 + n * 2;
  // the island and its walls of cliff
  h = Math.max(h, plateau(x, z, 0, 0, 52, 62, 6.5, 1.0, 1.15) + n * 0.3);
  // the beach below the main gate
  h = Math.max(h, lerp(1.6, 6.5, smoothstep(-68, -46, z)) * (1 - smoothstep(10, 18, Math.abs(x))) * (z < -30 ? 1 : 0));
  // the summit and the grand stairs up to it
  h = Math.max(h, plateau(x, z, SUMMIT.x, SUMMIT.z, SUMMIT.r, SUMMIT.r + 1.5, 14.5));
  if (Math.abs(x) < 5.5 && z > 12 && z < 21.5) h = Math.max(h, lerp(6.5, 14.5, smoothstep(12, 21.5, z)));
  return h;
}

function mask(x: number, z: number, h: number): [number, number, number, number] {
  const avenue = Math.abs(x) < 4 && z > -40 && z < 14 ? 1 : 0;
  const ring = Math.abs(Math.hypot(x - SUMMIT.x, z - SUMMIT.z) - 9) < 1.2 ? 1 : 0;
  return [Math.max(avenue, ring), 0.6, h > 0 && h < 6 ? 0.4 : 0, 0];
}

const LOOK: LookDef = {
  sun: [-0.45, 0.6, -0.55], sunIntensity: 1.1, sunColor: [1.0, 0.93, 0.8],
  sky: { zenith: '#3a7ad8', horizon: '#dcefff', glow: '#fff2d0', cloudLit: '#ffffff', cloudShade: '#a8bce0', cover: 0.35, cloudHeight: 1.1, sunSize: 0.002, stars: 0, moon: false },
  skyColor: [0.5, 0.6, 0.85], groundColor: [0.55, 0.5, 0.44], shadowTint: [0.45, 0.5, 0.85, 0.36], rim: [1.0, 0.95, 0.85, 0.7],
  fog: [0.85, 0.9, 1.0, 0.003], fogParams: [0.03, 0, 40, 0.8],
  sea: { color: [0.02, 0.2, 0.42, 0.6], shallow: [0.15, 0.65, 0.7, 1.2], level: 0, amp: 0.8, chop: 1, storm: 0 },
  grade: [0.9, 1.06, 1.12, 0.2], wind: [0.6, 0, 0.3],
  fx: { bloom: 0.42, vignette: 0.24, gain: [1.02, 1.01, 0.98] },
};

export class SunkenCrown extends Level {
  readonly id = 'crown';
  readonly beats = ['landing', 'gates', 'halls', 'summit', 'crown', 'lantern'];
  private risen: { m: InstancedMesh; y0: number; y1: number }[] = [];
  private rising = 0;
  private stormOn = 0;

  async build(): Promise<void> {
    this.setLook(LOOK);
    this.makeTerrain(height, -120, -110, 240, 230, {
      grassLight: '#ddd5c4', grassDark: '#c2b7a4', sand: '#d8c59a', rock: '#b8b0a2', dirt: '#c8a868', sandHeight: 2.2, beach: 0.6, rockSlope: 0.5, path: 1.0,
    }, mask);
    this.makeSea();
    const col = this.game.collision;
    col.wallBelow = -0.9;
    col.minY = -14;
    await this.loadKits('common', 'citadel', 'ships');
    const H = (x: number, z: number) => height(x, z);
    // the main gate and the outer walls with the side gates
    this.put('citadelgate', 0, -36, 0, 1, 'none');
    col.addBox(-6.8, -36, 1.6, 1.7);
    col.addBox(6.8, -36, 1.6, 1.7);
    for (const [x, r] of [[-30, Math.PI / 2], [30, -Math.PI / 2]] as const) this.put('citadelgate', x, -14, r, 0.8, 'none');
    for (const [x, z, l, r] of [[-19, -36, 21, 0], [19, -36, 21, 0], [-30, -26, 16, Math.PI / 2], [30, -26, 16, Math.PI / 2]] as const) {
      this.put('wall', x, z, r, [l / 4, 3.5, 2.2], 'box');
    }
    // the avenue of columns and banners
    for (let z = -28; z <= 8; z += 6) {
      for (const x of [-6, 6]) {
        this.put('column', x, z, 0, 1, 'none');
        col.addCircle(x, z, 0.9);
      }
      this.put('banner', -6, z + 3, Math.PI / 2, 1, 'none');
      this.put('banner', 6, z + 3, -Math.PI / 2, 1, 'none');
    }
    for (let z = -30; z <= 10; z += 6) for (const x of [-3, 3]) this.put('slab', x, z, 0, 1, 'none', 0.01);
    for (const [x, z] of [[-4.5, -32], [4.5, -32], [-4.5, 10], [4.5, 10]] as const) { this.put('brazier', x, z, 0, 1, 'circle'); this.addFire(V(x, H(x, z) + 1.45, z), 0.45); }
    // the grand stairs and the summit
    this.putAt('grandstairs', 0, 6.5, 12.5, 0, [1.1, 1.25, 1.2], 'none');
    this.put('altar', SUMMIT.x, SUMMIT.z + 4, 0, 1, 'circle');
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const x = SUMMIT.x + Math.cos(a) * (SUMMIT.r - 1.2), z = SUMMIT.z + Math.sin(a) * (SUMMIT.r - 1.2);
      if (Math.abs(x) < 6 && z < SUMMIT.z) continue;
      this.put(k % 3 === 0 ? 'column_broken' : 'column', x, z, a, 1, 'none');
      col.addCircle(x, z, 0.9);
    }
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (Math.hypot(i, j) < 2.6) this.put(Math.abs(i + j) % 2 ? 'slab_dark' : 'slab', SUMMIT.x + i * 6, SUMMIT.z + j * 6, 0, 1, 'none', 0.02);
    // Ys-Marrow, drowned until Vale calls it up
    const city: [string, number, number, number, number][] = [];
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2 + 0.2;
      const r = 92 + (k % 3) * 18;
      city.push([k % 3 === 0 ? 'coraltower1' : k % 3 === 1 ? 'coraltower0' : 'brokenarch' + (k % 2), Math.cos(a) * r, Math.sin(a) * r * 0.9, a, 1 + (k % 4) * 0.25]);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.6;
      city.push([k % 2 ? 'column_coral' : 'column_coral_b', Math.cos(a) * 72, Math.sin(a) * 66, a, 1.6]);
    }
    for (const [name, x, z, r, s] of city) {
      this.kit.place(name, x, -40, z, r, s, undefined, 'none');
      const m = this.kit.placed[this.kit.placed.length - 1] as InstancedMesh;
      this.risen.push({ m, y0: -40, y1: name.startsWith('column') ? -2 : -4 });
    }
    this.putAt('frigate', 40, 1.6, -95, 0.3, 1, 'none');
    this.putAt('wren', -10, 0.35, -76, 0.2, 1, 'none');
  }

  tick(dt: number): void {
    if (this.rising > 0) {
      this.rising = Math.min(1, this.rising + dt / 9);
      const e = 1 - (1 - this.rising) ** 3;
      for (const r of this.risen) r.m.position.y = lerp(r.y0, r.y1, e);
      if (this.rising < 1 && Math.random() < dt * 20) {
        const r = this.risen[Math.floor(Math.random() * this.risen.length)];
        this.game.vfx.splash(new Vector3(r.m.position.x, 0, r.m.position.z), 10);
      }
    }
    // Kai's storm taking hold: wind and lightning around him
    if (this.stormOn > 0) {
      const k = this.kai.center;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2;
        this.game.vfx.spawn({ x: k.x + Math.cos(a) * 1.4, y: k.y - 0.6 + Math.random() * 2, z: k.z + Math.sin(a) * 1.4, vx: -Math.sin(a) * 6, vy: 1, vz: Math.cos(a) * 6, size: 0.7, grow: 1, life: 0.6, r: 0.8, g: 1.4, b: 2.4, a: 0.6 * this.stormOn, rot: a, stretch: 2 }, 'wind');
      }
    }
  }

  async script(): Promise<void> {
    const d = this.dir, ui = this.ctx.ui, audio = this.ctx.audio, g = this.game, kai = this.kai, pc = this.ctx.pc, flags = this.ctx.flow.flags;
    const H = (x: number, z: number) => height(x, z);
    const P = (x: number, z: number) => V(x, H(x, z), z);
    pc.specialsUnlocked = { burst: true, dash: true, super: !!flags.super };
    audio.ambience('wind');
    let mira: Fighter | null = null, bram: Fighter | null = null, nell: Fighter | null = null;

    // ---------------------------------------------------------------- landing
    if (this.from('landing')) {
      this.checkpoint('landing', P(0, -58), 0);
      kai.place(P(0, -58), 0);
      mira = await this.npc('mira', 'mira', P(-2, -60), 0);
      bram = await this.npc('bram', 'bram', P(2.2, -60.5), 0);
      nell = await this.npc('nell', 'nell', P(-0.6, -61.5), 0);
      d.cine(true);
      audio.play('citadel');
      d.drift(V(30, 30, -110), V(18, 22, -90), V(0, 12, 0), 10);
      await d.card('CHAPTER FIVE', 'The Sunken Crown', 'He wanted no one to drown ever again.');
      d.listen('kai', 'mira', 'bram', 'nell');
      d.wide(P(0, -59).add(V(0, 1.2, 0)), Math.PI + 0.2, 9, 2.2, 0, 0.6);
      await d.say('nell', 'Vale\'s Reach. Ys-Marrow sank right under this rock. Papa\'s chart has a little crown drawn on it, with a question mark.', 'worried');
      await d.say('mira', 'Three gates. If we all go through the main one, they close the other two behind us and we\'re trapped on the stairs.', 'determined');
      await d.say('bram', 'So we each hold one. And the captain goes up.', 'calm');
      d.close(kai, 1);
      await d.say('kai', '...The captain?', 'shock');
      d.close(bram, -1);
      await d.say('bram', 'You have a crew. That makes you a captain. Those are the rules. I was in the navy, I know the rules.', 'tender');
      await d.say('nell', 'Don\'t let it go to your head. Your head is already the biggest thing on the ship.', 'smirk');
      d.two(kai, mira, 1, 0);
      await d.say('mira', 'Go and get him, Kai. And come back down. That\'s an order from your first mate.', 'tender');
      await d.say('kai', 'Everybody comes back down. That\'s an order from your captain.', 'determined');
      d.act(kai, 'salute');
      await d.wait(1.6);
      d.cine(false);
      for (const [f, to] of [[mira, P(-30, -16)], [bram, P(30, -16)], [nell, P(-8, -40)]] as const) { d.release(f!); void d.walk(f!, to, true); }
      await d.wait(1);
    }

    // ---------------------------------------------------------------- the gates
    if (this.from('gates')) {
      this.checkpoint('gates', P(0, -44), 0);
      if (this.starting('gates')) kai.place(P(0, -44), 0);
      await this.reach(P(0, -38), 3, 'Break the main gate');
      void d.say('mira', 'West gate\'s mine! Go!', 'shout');
      await this.fight({
        center: P(0, -30), radius: 10, objective: 'Take the main gate', music: 'battle', after: 'citadel',
        waves: [
          [['elite', -4, -24], ['elite', 4, -24], ['marine', 0, -20], ['rifleman', -6, -18]],
          [['brute', 0, -22], ['elite', -5, -28], ['rifleman', 6, -20], ['marine', 4, -32]],
        ],
      });
      void d.say('bram', 'East gate\'s holding! They\'ll have to go through my soup first!', 'laugh');
      for (const f of [mira, bram, nell]) if (f) g.removeFighter(f);
    }

    // ---------------------------------------------------------------- the halls
    if (this.from('halls')) {
      this.checkpoint('halls', P(0, -22), 0);
      if (this.starting('halls')) kai.place(P(0, -22), 0);
      await this.reach(P(0, -12), 4, 'Up the avenue');
      void d.say('vale', 'You\'ve come a long way to stop a man from ending drowning, Kai Marlowe.', 'calm');
      await this.fight({
        center: P(0, -6), radius: 7, objective: 'The Gilded Guard', music: 'battle', after: 'citadel',
        waves: [[['elite', -3, 0], ['elite', 3, 0], ['elite', 0, -12]], [['elite', -3, 2], ['brute', 3, -12], ['elite', 3, 2], ['rifleman', 0, 6]]],
      });
      void d.say('vale', 'The Great Squall took my wife, Amara. It took my daughter. She was six. She was afraid of the dark.', 'sad');
      await this.reach(P(0, 8), 4, 'To the stairs');
      void d.say('nell', 'Main gate\'s mine now, Kai. The stairs are clear. Go!', 'determined');
      await this.reach(P(0, 23), 4, 'Climb to the Crown');
    }

    // ---------------------------------------------------------------- the summit: Vale
    const { f: vale, brain } = await this.addBoss('vale', P(SUMMIT.x, SUMMIT.z + 1), Math.PI, 720);
    brain.active = false;
    if (this.from('summit')) {
      this.checkpoint('summit', P(0, 23.5), 0);
      kai.place(P(0, 24), 0);
      d.cine(true);
      audio.play('tension');
      hold(this.ctx.flow.props, vale, 'crown', 'L');
      d.listen('kai', 'vale');
      d.face(vale, kai, true);
      d.drift(P(-10, 30).add(V(0, 2, 0)), P(-7, 28).add(V(0, 1.7, 0)), vale.pos.add(V(0, 1.7, 0)), 8);
      await d.say('vale', 'This is the Sunken Crown. Whoever wears it, the sea obeys. No storms. No tides. No currents to drag a little girl\'s boat away in the dark.', 'calm', 'talk');
      d.close(kai, 1);
      await d.say('kai', 'And no wind. No fishing boats coming home. No ships at all. Just a big flat dead puddle.', 'angry');
      d.close(vale, -1);
      await d.say('vale', 'Yes. Nobody will lose anyone to it ever again.', 'determined');
      await d.say('kai', 'You burned my home. Halvard killed my grandma for you.', 'angry');
      await d.say('vale', 'I know. I keep a list too, boy. It is longer than his. It is the price.', 'sad');
      d.two(kai, vale, 1, 0, { dist: 6 });
      await d.say('kai', 'Then I\'m going to stop you paying it.', 'determined');
      d.cine(false);
      drop(vale, 'crown');
    }

    // ---------------------------------------------------------------- the duel and the Crown
    if (this.from('crown')) {
      this.checkpoint('crown', P(0, 25), 0);
      if (this.starting('crown')) kai.place(P(0, 25), 0);
      vale.floorHp = Math.round(vale.maxHp * 0.5);
      const half = new Promise<void>((res) => { vale.onFloor = res; });
      g.collision.arena = { x: SUMMIT.x, z: SUMMIT.z, r: SUMMIT.r - 1.4 };
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      ui.setObjective('Defeat Grand Admiral Vale');
      ui.showHint('Vale guards and parries. Bait his combos, then punish.', 6);
      await half;
      // the Crown: Ys-Marrow rises, the sea goes still
      g.combatActive = false;
      brain.active = false;
      d.cine(true);
      hold(this.ctx.flow.props, vale, 'crown', 'L');
      d.act(vale, 'overhead');
      d.close(vale, -1);
      await d.say('vale', 'Enough. Let the sea be still.', 'determined');
      drop(vale, 'crown');
      g.sfx('roar', undefined, 0.6);
      g.shake(0.8);
      this.rising = 0.001;
      this.r.globals.set('sea', 0, 0.06, 0.1, 0);
      this.sea!.mat.setVector4('seaFx', new Vector4(0, 0.2, 1.0, 0.9));
      this.r.globals.set('seaColor', 0.1, 0.3, 0.45, 0.2);
      d.drift(V(0, 40, -40), V(0, 50, -10), V(0, 0, 60), 9);
      audio.play('citadel');
      await d.wait(5);
      await d.say('vale', 'Listen. No waves. That is what peace sounds like.', 'calm');
      d.close(kai, 1);
      await d.say('kai', 'That\'s not peace. That\'s just quiet.', 'angry');
      d.cine(false);
      brain.setPhase(2);
      g.collision.arena = { x: SUMMIT.x, z: SUMMIT.z, r: SUMMIT.r - 1.4 };
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      ui.showHint('Still-water spears rise where you stand. Tide rings: jump them!', 6);
      vale.floorHp = Math.round(vale.maxHp * 0.2);
      const low = new Promise<void>((res) => { vale.onFloor = res; });
      await low;
      // Kai's storm nearly takes him
      g.combatActive = false;
      brain.active = false;
      d.cine(true);
      audio.play('storm');
      this.stormOn = 1;
      this.lightningT = 0.3;
      this.r.globals.setSunDir(new Vector3(-0.3, 0.5, -0.5), 0.45);
      this.r.globals.set('fogColor', 0.3, 0.33, 0.45, 0.012);
      this.r.fx.radialBlur = 0.5;
      d.act(kai, 'charge', true);
      kai.model.face.set('shout');
      d.close(kai, 1, 0, { dist: 1.6, fov: 0.6 });
      g.sfx('hurricane');
      await d.say('kai', 'It\'s... too much. I can\'t... it won\'t stop...', 'pain');
      await d.say('vale', 'You see? The sea takes everyone in the end. Even you. Even from the inside.', 'sad');
      // they came back up
      mira = await this.npc('mira', 'mira', P(-5, 23.5), 0.4);
      bram = await this.npc('bram', 'bram', P(5, 23.5), -0.4);
      nell = await this.npc('nell', 'nell', P(0, 22.5), 0);
      d.wide(P(0, 26).add(V(0, 1.5, 0)), Math.PI, 10, 2.5, 0, 0.65);
      await d.say('mira', 'KAI! Both of us, remember? Both of us!', 'shout');
      await d.say('bram', 'Captain! Throw the rest of the lifebuoys! You said so yourself!', 'shout');
      await d.say('nell', 'You don\'t get to sail alone, you idiot. Not ever!', 'cry');
      d.close(kai, -1, 0, { dist: 1.3 });
      ui.showSubtitle('<i>"Find a crew, Kai. Don\'t sail alone like I did."</i>');
      await d.wait(3);
      ui.showSubtitle(null);
      this.stormOn = 0;
      this.r.fx.radialBlur = 0;
      kai.model.face.set('determined');
      await d.say('kai', '...I\'m not alone.', 'determined');
      this.lightningT = -1;
      this.r.globals.setSunDir(new Vector3(-0.45, 0.6, -0.55), 1.1);
      this.r.globals.set('fogColor', 0.85, 0.9, 1.0, 0.003);
      flags.super = true;
      pc.specialsUnlocked.super = true;
      g.storm = 100;
      d.cine(false);
      for (const f of [mira, bram, nell]) { f.team = 'ally'; }
      ui.showHint('<b>Hurricane</b> unlocked: press <b>F</b> with a full storm meter.', 8);
      vale.floorHp = 0;
      vale.onFloor = undefined;
      vale.floorHp = 1;
      const end = new Promise<void>((res) => { vale.onFloor = res; });
      g.combatActive = true;
      brain.active = true;
      audio.play('boss');
      await end;
      g.combatActive = false;
      brain.active = false;
      g.collision.arena = null;
      ui.setObjective(null);
      g.slow(0.25, 1.6);
      g.impactFrame(0.1);
      this.boss = null;
      await d.wait(2.4);
    }

    // ---------------------------------------------------------------- the lantern
    if (this.from('lantern')) {
      this.checkpoint('lantern', P(0, 30), 0);
      if (!mira) mira = await this.npc('mira', 'mira', P(-5, 27), 0.4);
      if (!bram) bram = await this.npc('bram', 'bram', P(5, 27), -0.4);
      if (!nell) nell = await this.npc('nell', 'nell', P(0, 25), 0);
      audio.play('sad');
      d.cine(true);
      vale.team = 'neutral';
      vale.hp = 1;
      d.place(vale, P(0, 37), Math.PI);
      d.act(vale, 'kneel_grief', true);
      d.place(kai, P(0, 33.6), 0);
      d.listen('kai', 'vale', 'mira', 'bram', 'nell');
      d.two(kai, vale, 1, 0, { dist: 4 });
      await d.say('vale', 'Finish it. I would.', 'tired');
      hold(this.ctx.flow.props, kai, 'lantern', 'R');
      d.close(kai, -1);
      await d.say('kai', 'The night of the Great Squall, my mum rowed out to a ferry on the reef off Gull\'s Rest.', 'tender');
      await d.say('kai', 'She didn\'t come back. In the morning a lifeboat came in on the tide with her lantern still burning in it. And a little girl.', 'sad');
      d.close(vale, 1, 0, { dist: 1.4 });
      vale.model.face.set('shock');
      await d.wait(1.4);
      d.two(kai, vale, -1, 0, { dist: 3 });
      await d.say('kai', 'She had a yellow ribbon. Grandma Ines buried her up on the cliff, next to the Albatross\'s thirteen, and put flowers there every Sunday for ten years.', 'cry');
      await d.say('kai', 'We never knew her name. My mum must have put her in that boat with her own light. It\'s the last thing she did.', 'cry');
      d.release(kai);
      await d.walk(kai, P(0, 35.8), false, 0.25);
      d.act(kai, 'kneel_hold', true);
      d.close(vale, 1, 0, { dist: 1.3, height: -0.15 });
      await d.say('vale', '...Lissa.', 'sob');
      await d.say('vale', 'Her name was Lissa. She tied that ribbon herself. Badly. She was so proud of it.', 'sob');
      d.act(vale, 'cry', true);
      await d.wait(2);
      d.two(kai, vale, 1, 0, { dist: 2.6, height: 1.0 });
      await d.say('kai', 'The sea took her. But somebody went into the sea to try and bring her home. That\'s the sea too, Admiral. That\'s people.', 'tender');
      await d.say('vale', 'I burned that island. I burned the people who kept her grave.', 'sob');
      await d.say('kai', 'Yeah. You did.', 'sad');
      await d.say('kai', 'So come and put flowers on it anyway. That\'s how it works. Grandma Ines would\'ve said so.', 'tender');
      // he breaks the Crown
      d.release(vale);
      hold(this.ctx.flow.props, vale, 'crown', 'L');
      d.act(vale, 'overhead');
      await d.wait(0.6);
      g.impactFrame(0.1);
      g.sfx('heavy_hit'); g.shake(0.6);
      g.vfx.impact(vale.center.add(V(0, 0.6, 0)), 3, [1.4, 2.6, 3]);
      g.vfx.burst(vale.center.add(V(0, 0.6, 0)), [2, 2.6, 3], 40, 9, 'shard', 0.25, 1.0, 5);
      drop(vale, 'crown');
      this.rising = 0;
      for (const r of this.risen) { r.y1 = -40; r.y0 = r.m.position.y; }
      this.rising = 0.001;
      this.r.globals.set('sea', 0, 0.9, 1, 0);
      this.sea!.mat.setVector4('seaFx', new Vector4(1, 1, 0.5, 0.9));
      this.r.globals.set('seaColor', 0.02, 0.2, 0.42, 0.6);
      audio.play('lullaby');
      audio.ambience('sea');
      d.drift(V(-20, 18, 10), V(-30, 24, -10), V(0, 4, 40), 10);
      await d.wait(3);
      await d.say('nell', 'Listen. Waves.', 'joy');
      await d.say('bram', 'That\'s the best sound in the world. After soup.', 'laugh');
      await d.say('mira', 'The tide came back.', 'tender');
      d.close(kai, 1);
      await d.say('kai', 'Of course it did. It always comes back.', 'smile');
      await d.wait(2);
      await d.fade(1, 2.5);
      drop(kai);
      d.cine(false);
    }
  }
}
