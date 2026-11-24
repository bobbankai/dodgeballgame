// Prologue — The Lantern. Ten years earlier, the night of the Great Squall: Seren rows out to a ferry
// breaking on the reef, puts a little girl into a lifeboat with her lantern, and is taken by the sea. On
// the beach her son wades in after her; the storm dies over his head and leaves a pearl in his hand.
import { Vector3 } from '@babylonjs/core';
import { Level, V, type LookDef } from './Level';
import { Boat, ROWBOAT } from '../world/Boat';
import { hold } from '../game/Props';
import { GULLS_HEIGHT } from './GullsRest';

const LOOK: LookDef = {
  sun: [0.35, 0.5, 0.55], sunIntensity: 0.38, sunColor: [0.55, 0.68, 1.0],
  sky: { zenith: '#03050c', horizon: '#141c30', glow: '#22304a', cloudLit: '#3a4660', cloudShade: '#06080f', cover: 0.85, cloudHeight: 0.8, sunSize: 0.0, stars: 0, moon: false },
  skyColor: [0.08, 0.11, 0.2], groundColor: [0.03, 0.03, 0.05], shadowTint: [0.2, 0.25, 0.5, 0.55], rim: [0.55, 0.7, 1.0, 1.0],
  fog: [0.035, 0.05, 0.09, 0.011], fogParams: [0.05, 0, 12, 0.15],
  sea: { color: [0.005, 0.02, 0.05, 0.45], shallow: [0.03, 0.1, 0.13, 0.7], level: 0, amp: 0.85, chop: 1.4, storm: 0.6 },
  grade: [1.05, 0.9, 1.18, -0.3], wind: [2.5, 0, 1.2],
  fx: { bloom: 0.55, vignette: 0.55, grain: 0.22, memory: 0.28, bloomThreshold: 1.0, gain: [0.95, 1.0, 1.12], lift: [0.0, 0.006, 0.02] },
};

export class Prologue extends Level {
  readonly id = 'prologue';
  readonly beats = ['storm', 'shore'];
  private boats: Boat[] = [];

  async build(): Promise<void> {
    this.setLook(LOOK);
    this.makeTerrain(GULLS_HEIGHT, -130, -130, 260, 160, {
      grassLight: '#4f6a4a', grassDark: '#2a3a30', sand: '#8a8070', rock: '#4a4a50', dirt: '#5a4a3a', sandHeight: 1.75, beach: 0.45, rockSlope: 0.62, path: 0.4,
    });
    this.makeSea();
    this.game.collision.minY = -40;
    await this.loadKits('common', 'gulls', 'ships');
    this.putAt('lighthouse', 0, GULLS_HEIGHT(0, 80) - 0.3, 80, 0, 1, 'none');
    // the ferry, broken on the reef
    this.putAt('frigate', 30, -1.5, -150, 0.6, 0.62, 'none');
    for (const [x, z, s] of [[18, -140, 2], [40, -146, 1.6], [26, -158, 1.8], [44, -136, 1.4]] as const) this.putAt('rock4', x, -2, z, x, s, 'none');
    this.addFire(V(30, 3, -150), 2.2);
    this.addFire(V(26, 2, -146), 1.2);
    this.rain = 1;
    this.lightningT = 1.5;
  }

  tick(dt: number): void {
    for (const b of this.boats) b.update(this.game.time, dt, this.game);
  }

  async script(): Promise<void> {
    const d = this.dir, g = this.game, ui = this.ctx.ui, audio = this.ctx.audio, kai = this.kai;
    audio.play('storm');
    audio.ambience('rain');
    // Kai is in this scene as a child: hidden until the shore
    kai.model.root.setEnabled(false);
    kai.place(V(0, 0, 0));
    if (this.from('storm')) {
      d.cine(true);
      await d.fade(1, 0.01);
      ui.showSubtitle('Gull\'s Rest. Ten years ago.<br>The night of the Great Squall.');
      await d.wait(4.5);
      ui.showSubtitle(null);
      // Seren's rowboat
      const row = new Boat(this.kit, ROWBOAT, this.sea, g.collision, V(12, 0.4, -118), 2.6);
      const life = new Boat(this.kit, ROWBOAT, this.sea, g.collision, V(16, 0.4, -124), -0.6);
      row.bob = 1.0; life.bob = 1.0;
      this.boats.push(row, life);
      row.update(g.time, 0, null);
      const seren = await this.npc('seren', 'seren', row.deck(0, 0.6), row.yaw);
      hold(this.ctx.flow.props, seren, 'lantern', 'L');
      d.act(seren, 'idle', true);
      d.drift(V(-10, 6, -100), V(-2, 4.5, -106), row.deck(0, 0).add(V(0, 1.2, 0)), 8);
      void d.fade(0, 2.5);
      await d.wait(2.2);
      g.sfx('thunder');
      await d.say('seren', 'Hold on! I see your lights! Hold on!', 'shout');
      d.close(seren, 1, 0, { dist: 1.6 });
      await d.wait(0.4);
      await d.say('seren', 'Come on, old girl. Just a little further.', 'determined');
      // at the lifeboat
      await d.fade(1, 0.8);
      row.pos.copyFrom(V(14.2, 0, -122.4));
      row.update(g.time, 0, null);
      d.place(seren, row.deck(0, 1.2), row.yaw + Math.PI);
      d.act(seren, 'kneel_hold', true);
      const lanternAt = life.deck(0, 0.6).add(V(0, 0.35, 0));
      // Lissa, alone in the lifeboat in her red ribbon, huddled on the thwart
      const lissaAt = () => life.deck(0, 0.15);
      const lissaYaw = () => Math.atan2(row.pos.x - life.pos.x, row.pos.z - life.pos.z);
      const lissa = await this.npc('teo', 'lissa', lissaAt(), lissaYaw(), { look: { face: { eyeStyle: 1, eyeSize: 1.15 }, tint: [1.0, 0.82, 0.86] as [number, number, number] } });
      lissa.model.anchor.scaling.setAll(0.9);
      d.act(lissa, 'sit', true);
      lissa.model.face.set('cry');
      d.listen('seren', 'lissa');
      d.two(seren, lissa, 1, 0, { dist: 3.2, height: 1.2 });
      void d.fade(0, 0.8);
      await d.wait(1);
      await d.say('seren', 'There you are, sweetheart. There you are. What\'s your name?', 'tender');
      // (a little above her: she sits low in the boat, and a camera at her eyeline would be in the swell)
      d.close(lissa, 1, 0, { dist: 1.5, height: 0.42 });
      await d.say('lissa', '...Lissa.', 'cry');
      d.close(seren, 1, 0, { dist: 1.4 });
      await d.say('seren', 'Lissa. That\'s a brave name. Here. Take my light, and hold it up high so they can find you.', 'tender');
      d.close(lissa, -1, 0, { dist: 1.5, height: 0.42 });
      await d.say('lissa', 'Where\'s my mama? Where\'s my papa?', 'cry');
      d.close(seren, -1, 0, { dist: 1.2 });
      await d.say('seren', 'They\'re coming. Everyone\'s coming. Don\'t let the light go out, okay? Not for anything.', 'cry');
      // she gives the lantern to the lifeboat and pushes it toward the shore
      const lantern = this.ctx.flow.props.instance('lantern')!;
      lantern.position.copyFrom(lanternAt);
      this.meshes.push(lantern);
      const lightIdx = this.r.globals.lights.length;
      this.r.globals.lights.push({ pos: lanternAt.add(V(0, 0.1, 0)), radius: 6, color: [1, 0.75, 0.4], intensity: 2.5 });
      for (const p of seren.model.props) p.setEnabled(false);
      d.act(seren, 'shield_bash');
      await d.wait(0.5);
      d.wide(life.pos, 2.2, 14, 4, 0, 0.6);
      for (let i = 0; i < 90; i++) {
        life.pos.addInPlace(V(-0.05, 0, 0.08));
        lissa.place(lissaAt(), lissaYaw());
        lantern.position.copyFrom(life.deck(0, 0.6).add(V(0, 0.35, 0)));
        this.r.globals.lights[lightIdx].pos.copyFrom(lantern.position);
        await d.wait(1 / 60);
      }
      d.close(seren, 1, 0, { dist: 2.2, height: 0.3 });
      d.act(seren, 'idle', true);
      await d.say('seren', 'Kai... my little lighthouse. Mum\'s coming home.', 'tender');
      // the wave
      g.sfx('roar', undefined, 0.6);
      d.wide(row.pos, 1.3, 9, 1.2, 0, 0.75);
      this.r.globals.set('sea', 0, 1.3, 1.8, 0.9);
      g.ring(row.pos.add(V(-14, 0, -14)), 9, 30, 0);
      await d.wait(1.1);
      g.shake(1);
      g.sfx('splash', undefined, 1);
      g.vfx.splash(row.deck(0, 0), 60);
      g.impactFrame(0.08);
      await d.fade(1, 0.12, '#ffffff');
      g.removeFighter(seren);
      g.removeFighter(lissa);
      row.inst.setEnabled(false);
      row.plat.top = -100;
      await d.fade(1, 1.4);
      this.r.globals.set('sea', 0, 0.85, 1.4, 0.6);
    }
    // ---------------------------------------------------------------- the shore
    // the beach at the waterline (found from the terrain, so it stays right if the island is reshaped): Kai stands
    // on the wet sand and wades in until the sea is round his knees
    const along = (zFrom: number, below: number) => { let z = zFrom; while (z > -90 && GULLS_HEIGHT(-2, z) > below) z -= 0.25; return z; };
    const zShore = along(-30, 0.25);
    const shore = V(-2, GULLS_HEIGHT(-2, zShore), zShore);
    const life = this.boats[1] ?? new Boat(this.kit, ROWBOAT, this.sea, g.collision, V(-1, 0, -70), 2.8);
    if (!this.boats.length) this.boats.push(life);
    life.pos.copyFrom(V(-1.5, 0, -66));
    life.yaw = 0.3;
    const lantern = this.ctx.flow.props.instance('lantern')!;
    this.meshes.push(lantern);
    // little Kai
    kai.model.root.setEnabled(true);
    kai.model.anchor.scaling.setAll(0.62);
    kai.place(shore, Math.PI);
    d.act(kai, 'idle', true);
    kai.model.face.set('worried');
    const lifeBoatLight = this.r.globals.lights.length;
    this.r.globals.lights.push({ pos: V(0, 0, 0), radius: 6, color: [1, 0.75, 0.4], intensity: 2.5 });
    const moveLantern = () => { lantern.position.copyFrom(life.deck(0, 0.6).add(V(0, 0.35, 0))); this.r.globals.lights[lifeBoatLight].pos.copyFrom(lantern.position); };
    moveLantern();
    d.drift(shore.add(V(4, 1.2, 5)), shore.add(V(3, 0.9, 3.4)), shore.add(V(0, 0.6, -1)), 10);
    await d.fade(0, 2);
    ui.showSubtitle('He was seven. He had been told to stay in the lighthouse.');
    await d.wait(3.5);
    ui.showSubtitle(null);
    d.close(kai, 1, 0, { dist: 1.0, height: -0.3 });
    await d.say('kai', 'Mum? MUM!', 'cry');
    d.release(kai);
    kai.walkSpeed = 1.2;
    const zInto = along(zShore, -0.3);
    const into = V(-2, GULLS_HEIGHT(-2, zInto), zInto);
    d.wide(into, 0.4, 7, 1.5, 0, 0.65);
    await d.walk(kai, into, false, 0.4);
    d.act(kai, 'idle', true);
    g.sfx('thunder');
    this.lightningT = 0.2;
    await d.wait(1.2);
    // the storm dies over his head
    d.close(kai, -1, 0, { dist: 1.3, height: -0.2, fov: 0.6 });
    await d.say('kai', 'Give her back! GIVE HER BACK!', 'sob');
    g.speedLines(1.5);
    g.vfx.gale(kai.center, V(0, 1, 0), 2.5);
    g.vfx.impact(kai.center.add(V(0, 0.4, 0)), 2.6, [1.2, 2.2, 3]);
    g.sfx('hurricane');
    g.shake(0.8);
    await d.wait(1.0);
    this.rain = 0;
    this.lightningT = -1;
    this.fires = [];
    this.r.globals.set('sea', 0, 0.35, 0.6, 0);
    this.r.globals.setSunDir(new Vector3(-0.2, 0.35, -0.9), 0.5);
    this.r.globals.set('fogColor', 0.3, 0.36, 0.52, 0.01);
    audio.play('lullaby');
    audio.ambience('sea');
    for (let i = 0; i < 40; i++) {
      g.vfx.spawn({ x: kai.center.x, y: kai.center.y + 0.1, z: kai.center.z, vx: (Math.random() - 0.5) * 3, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 3, size: 0.08, life: 2, r: 1.2, g: 2.2, b: 3, a: 1, drag: 1.5 }, 'star');
    }
    d.act(kai, 'kneel_hold', true);
    const pearl = this.r.globals.lights.length;
    this.r.globals.lights.push({ pos: kai.center, radius: 3, color: [0.5, 0.8, 1.0], intensity: 3 });
    kai.model.face.set('shock');
    d.close(kai, 1, 0, { dist: 0.9, height: -0.15, fov: 0.45 });
    await d.wait(2.4);
    // the lifeboat comes in on the last of the swell, its light still burning
    life.pos.copyFrom(into.add(V(-2.5, 0, -5)));
    d.wide(into, 2.4, 8, 1.6, 0, 0.6);
    for (let i = 0; i < 150; i++) {
      life.pos.addInPlace(V(0.012, 0, 0.022));
      moveLantern();
      this.r.globals.lights[pearl].pos.copyFrom(kai.center);
      await d.wait(1 / 60);
    }
    await d.say('kai', '...Her light.', 'cry');
    await d.wait(1.5);
    await d.fade(1, 2.5);
    kai.model.anchor.scaling.setAll(1);
    kai.walkSpeed = 1.7;
    this.r.globals.lights = [];
    audio.play('title');
    this.r.fx.memory = 0;
    d.cine(false);
    this.ctx.ui.showHud(false);
    // the title over black, after the cold open
    await d.card('', 'TIDEBREAKERS', 'The Song Beneath the Sea', 4.5);
  }
}
