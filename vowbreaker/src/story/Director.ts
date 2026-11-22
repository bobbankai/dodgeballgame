import { Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import type { Input } from '../core/Input';
import { Character, CharacterOptions } from '../game/Character';
import { CameraRig, Shot } from '../game/CameraRig';
import { PAL, Effects } from '../game/Effects';
import { Fight, FightResult, FightSpec } from '../game/Fight';
import { STAGES, Stage } from '../game/Stage';
import type { Fighter } from '../game/Fighter';
import { DialogueBox, HUD, el } from '../ui/UI';
import type { Audio, Mood } from '../audio/Audio';
import { Ambient } from '../render/Ambient';
import { DomainScene } from '../render/Domain';
import { SK } from '../render/Sprites';
import { PK } from '../render/GpuParticles';
import { CineLight, type CineRig } from './CineLight';

/** Display names and voices of the speakers. */
export const WHO: Record<string, { name: string; voice: string }> = {
  itsuki: { name: 'Itsuki', voice: 'itsuki' }, sayo: { name: 'Sayo', voice: 'sayo' }, mikami: { name: 'Mikami', voice: 'mikami' },
  sojin: { name: 'Sōjin', voice: 'sojin' }, sojin_young: { name: 'Sōjin', voice: 'sojin' }, ryoga: { name: 'Ryōga', voice: 'ryoga' },
  mio: { name: 'Mio', voice: 'mio' }, hina: { name: 'Hina', voice: 'hina' }, kota: { name: 'Kōta', voice: 'kota' },
  mikami_young: { name: 'Mikami', voice: 'itsuki' }, elder: { name: 'Elder Tachibana', voice: 'elder' }, bride: { name: 'The Bride', voice: 'bride' },
  littlebell: { name: '???', voice: 'mio' }, acolyte: { name: 'Acolyte', voice: 'curse' }, umbrella: { name: 'Red Umbrella', voice: 'curse' },
  shiragami: { name: 'Shiragami', voice: 'curse' }, narrator: { name: '', voice: 'narrator' }, voice: { name: '???', voice: 'curse' },
};

interface Waiter {
  until: number;
  resolve: () => void;
}

/** Everything a chapter script can do, all on game time. */
export class Director {
  readonly cast = new Map<string, Character>();
  stage: Stage | null = null;
  readonly cam: CameraRig;
  readonly fx: Effects;
  readonly ambient: Ambient;
  readonly domain: DomainScene;
  /** the lights cutscenes put on their actors */
  readonly cineLight = new CineLight();
  fight: Fight | null = null;
  time = 0;
  private waiters: Waiter[] = [];
  private tasks: ((dt: number) => boolean)[] = [];
  skipping = false;
  private fadeTarget = 0;
  private fadeRate = 1;
  private letterTarget = 0;
  private flashTarget = 0;
  /** characters the director animates (those not in a fight) */
  private walking = new Map<string, number>();
  autoTest = false;
  /** set by Game: retry policy when the player loses */
  onLose: (() => Promise<'retry' | 'quit'>) | null = null;
  quit = false;

  constructor(readonly r: Renderer, readonly input: Input, readonly ui: HTMLElement, readonly hud: HUD, readonly dialogue: DialogueBox, readonly audio: Audio) {
    this.cam = new CameraRig(r.camera, r.post);
    this.fx = new Effects(r, this.cam, audio);
    this.ambient = new Ambient(r.scene);
    this.domain = new DomainScene(r);
  }

  // --- time -------------------------------------------------------------------------------------------

  wait(t: number): Promise<void> {
    if (this.skipping || t <= 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push({ until: this.time + t, resolve }));
  }

  /** Run fn every frame until it returns true. */
  task(fn: (dt: number) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.tasks.push((dt) => {
        const done = fn(dt);
        if (done) resolve();
        return done;
      });
    });
  }

  update(dt: number): void {
    this.time += dt;
    if (this.input.wasPressed('skip') && !this.fight) {
      this.input.consume('skip');
      this.skipping = true;
      this.dialogue.hide();
    }
    const adv = this.input.anyConfirm();
    this.dialogue.update(dt, adv || this.skipping);
    for (const w of this.waiters.slice()) {
      if (this.time >= w.until || this.skipping) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve();
      }
    }
    this.tasks = this.tasks.filter((t) => !t(dt));
    // fight or cutscene
    const inFight = new Set<Character>();
    if (this.fight) {
      this.fight.update(dt);
      for (const f of this.fight.fighters) inFight.add(f.ch);
      this.hud.update(dt, this.fight.player, this.fight.enemy, this.fight.fighters.filter((f) => f.team !== this.fight!.player.team && f.alive).length);
    }
    for (const c of this.cast.values()) if (!inFight.has(c) && c.visible) c.update(dt);
    this.cam.update(dt);
    this.cineLight.update(dt, this.r.camera, this.r.lighting);
    // particles stay inside the arena and swirl round an open domain
    const parts = this.fx.particles;
    parts.arena.set(0, this.stage ? this.stage.def.arena + 3 : 0, 0);
    if (this.domain.active) {
      parts.vortex.copyFrom(this.domain.center);
      parts.vortexStrength = 2.5 * this.domain.reveal;
    } else {
      parts.vortexStrength = 0;
    }
    // fighters push the grass aside as they move through it
    if (this.stage?.grass) {
      const fs = this.fight ? this.fight.fighters : [];
      this.stage.grass.setPushers(fs.filter((f) => f.alive).map((f) => ({ x: f.pos.x, y: f.pos.y, z: f.pos.z, r: 0.9 })));
    }
    this.fx.update(dt, this.fight ? this.fight.fighters : []);
    this.ambient.flash = this.r.sky.lightning;
    this.ambient.sunDir.copyFrom(this.r.lighting.sunDir);
    this.ambient.sunColor.copyFrom(this.r.lighting.sunColor);
    this.ambient.update(this.r.lighting.time);
    this.stage?.update(dt);
    // screen state eases
    const s = this.r.post.settings;
    s.fadeBlack += Math.sign(this.fadeTarget - s.fadeBlack) * Math.min(Math.abs(this.fadeTarget - s.fadeBlack), dt * this.fadeRate);
    s.letterbox += Math.sign(this.letterTarget - s.letterbox) * Math.min(Math.abs(this.letterTarget - s.letterbox), dt * 2.5);
    s.flashback += Math.sign(this.flashTarget - s.flashback) * Math.min(Math.abs(this.flashTarget - s.flashback), dt * 1.2);
    // memories are painted in ink
    s.sumie = s.flashback;
    this.audio.update();
  }

  // --- stage and cast ------------------------------------------------------------------------------------

  async setStage(id: string): Promise<void> {
    // a change of place mid-story: the old place is held on screen while the new one loads, then
    // washes away in ink (the first stage just appears)
    if (this.stage && !this.skipping && !this.transitionBusy) {
      await this.transition('ink', () => this.loadStage(id), 1.4);
      return;
    }
    await this.loadStage(id);
  }

  private async loadStage(id: string): Promise<void> {
    this.stage?.dispose();
    const def = STAGES[id] ?? STAGES.void;
    const st = new Stage(this.r, def);
    await st.load();
    this.stage = st;
    this.ambient.set(def.ambient?.kind ?? 'none', def.ambient?.density ?? 1);
    this.audio.setRain(def.ambient?.kind === 'rain' ? 1 : 0);
    this.audio.setWind(0.3);
    this.fx.particles.wind.set(def.ambient?.kind === 'petals' ? 0.6 : 0, 0, 0.2);
    // the place's own cutscene light (off while fighting)
    this.cineLight.setStage(def.id);
    if (this.fight) this.cineLight.set(null, {}, 0.05);
  }

  /** Light the actors for a shot: a named look (see CINE), a custom rig, or null for none. */
  cine(look: string | CineRig | null, over: Partial<CineRig> = {}, fade = 0.7): void {
    this.cineLight.set(look, over, fade);
  }

  async actor(id: string, model = id, opts: CharacterOptions = {}): Promise<Character> {
    let c = this.cast.get(id);
    if (!c) {
      c = await Character.create(this.r, model, id, opts);
      this.cast.set(id, c);
    }
    c.setVisible(true);
    return c;
  }

  get(id: string): Character {
    const c = this.cast.get(id);
    if (!c) throw new Error('no actor ' + id);
    return c;
  }

  place(id: string, x: number, z: number, yaw?: number): void {
    const c = this.get(id);
    c.position.set(x, 0, z);
    if (yaw !== undefined) c.yaw = yaw;
    c.springs.reset();
  }

  /** Turn to face another actor (or a point). */
  look(id: string, at: string | [number, number]): void {
    const c = this.get(id);
    const p = typeof at === 'string' ? this.get(at).position : new Vector3(at[0], 0, at[1]);
    c.yaw = Math.atan2(p.x - c.position.x, p.z - c.position.z);
  }

  anim(id: string, clip: string, fade = 0.25, speed = 1): void {
    this.get(id).anim.play(clip, fade, speed);
  }

  expr(id: string, e: string): void {
    this.get(id).face.set(e);
  }

  hide(id: string): void {
    this.cast.get(id)?.setVisible(false);
  }

  remove(id: string): void {
    const c = this.cast.get(id);
    if (c) {
      c.dispose();
      this.cast.delete(id);
    }
  }

  clearCast(keep: string[] = []): void {
    for (const id of Array.from(this.cast.keys())) if (!keep.includes(id)) this.remove(id);
  }

  /** Walk an actor to a point (plays walk, turns toward it), resolves on arrival. */
  walk(id: string, x: number, z: number, speed = 1.4, clip = 'walk'): Promise<void> {
    const c = this.get(id);
    const target = new Vector3(x, 0, z);
    c.anim.play(clip, 0.2, speed / 1.4);
    const token = (this.walking.get(id) ?? 0) + 1;
    this.walking.set(id, token);
    return this.task((dt) => {
      if (this.walking.get(id) !== token) return true;
      const d = target.subtract(c.position);
      d.y = 0;
      const l = d.length();
      if (l < 0.05 || this.skipping) {
        c.position.copyFrom(target);
        c.anim.play('stand', 0.3);
        return true;
      }
      c.yaw = Math.atan2(d.x, d.z);
      c.position.addInPlace(d.scale(Math.min(1, (speed * dt) / l)));
      return false;
    });
  }

  // --- words ------------------------------------------------------------------------------------------------

  async say(who: string, text: string, emotion?: string, style: '' | 'narration' | 'thought' = ''): Promise<void> {
    if (this.skipping) return;
    const info = WHO[who] ?? { name: who, voice: 'narrator' };
    const c = this.cast.get(who);
    if (c && emotion) c.face.set(emotion);
    if (c && style !== 'thought') c.face.talking = 1;
    this.audio.setDuck(0.45);
    const pitch = emotion === 'shout' || emotion === 'angry' ? 1.15 : emotion === 'sad' || emotion === 'grief' ? 0.92 : 1;
    if (style !== 'thought') this.audio.voice(info.voice, text, pitch);
    // talking time follows the text length; the mouth stops when the line is out
    const talkFor = Math.min(6, 0.5 + text.length / 22);
    const t0 = this.time;
    const stop = this.task(() => {
      if (this.time - t0 > talkFor && c) c.face.talking = 0;
      return this.time - t0 > talkFor;
    });
    await this.dialogue.say(style === 'narration' ? '' : info.name, text, style);
    if (c) c.face.talking = 0;
    void stop;
    this.audio.setDuck(1);
  }

  narrate(text: string): Promise<void> {
    return this.say('narrator', text, undefined, 'narration');
  }

  think(who: string, text: string, emotion?: string): Promise<void> {
    return this.say(who, text, emotion, 'thought');
  }

  // --- camera -------------------------------------------------------------------------------------------------

  /** A point at an actor's head / chest height. */
  at(id: string, h = 0.9): Vector3 {
    const c = this.get(id);
    return c.position.add(new Vector3(0, c.height * h * c.root.scaling.y, 0));
  }

  shot(pos: [number, number, number], target: [number, number, number] | string, fov = 0.75): void {
    const t = typeof target === 'string' ? this.at(target) : new Vector3(...target);
    this.cam.cut({ pos: new Vector3(...pos), target: t, fov });
  }

  /** A close-up on an actor's face, from the side `side` (radians from their facing). */
  closeUp(id: string, side = 0.5, dist = 1.1, fov = 0.5): void {
    const c = this.get(id);
    const head = this.at(id, 0.92);
    const a = c.yaw + side;
    const pos = head.add(new Vector3(Math.sin(a) * dist, 0.05, Math.cos(a) * dist));
    this.cam.cut({ pos, target: head, fov });
    this.dof(dist, 0.8);
  }

  /** Over-the-shoulder of `a` looking at `b`. */
  over(a: string, b: string, fov = 0.6): void {
    const ca = this.get(a);
    const pb = this.at(b, 0.88);
    const pa = this.at(a, 0.92);
    const d = pb.subtract(pa);
    d.y = 0;
    d.normalize();
    const right = new Vector3(d.z, 0, -d.x);
    const pos = pa.add(d.scale(-0.9)).add(right.scale(0.45)).add(new Vector3(0, 0.12, 0));
    this.cam.cut({ pos, target: pb, fov });
    this.dof(Vector3.Distance(pos, pb), 0.6);
    void ca;
  }

  twoShot(a: string, b: string, dist = 4, height = 1.5, side = 1): void {
    const pa = this.get(a).position;
    const pb = this.get(b).position;
    const mid = pa.add(pb).scale(0.5);
    const d = pb.subtract(pa);
    d.y = 0;
    d.normalize();
    const perp = new Vector3(d.z, 0, -d.x).scale(side);
    const pos = mid.add(perp.scale(dist)).add(new Vector3(0, height, 0));
    this.cam.cut({ pos, target: mid.add(new Vector3(0, 1.3, 0)), fov: 0.75 });
    this.dof(0, 0);
  }

  rail(from: Shot, to: Shot, dur: number): Promise<void> {
    this.cam.move(from, to, dur);
    return this.wait(dur);
  }

  dof(focus: number, amount: number, range = 1.2): void {
    const s = this.r.post.settings;
    s.dofFocus = focus;
    s.dofAmount = amount;
    s.dofRange = range;
  }

  // --- screen ---------------------------------------------------------------------------------------------------

  fade(toBlack: boolean, dur = 0.8): Promise<void> {
    this.fadeTarget = toBlack ? 1 : 0;
    this.fadeRate = 1 / Math.max(dur, 0.01);
    if (this.skipping) this.r.post.settings.fadeBlack = this.fadeTarget;
    return this.wait(dur);
  }

  letterbox(on: boolean): void {
    this.letterTarget = on ? 1 : 0;
  }

  flashback(on: boolean, keepHue = 0.0): void {
    // into a memory the present burns away like paper; out of it, ink washes it off
    if ((on ? 1 : 0) !== this.flashTarget && this.stage) void this.transition(on ? 'burn' : 'ink', () => {}, 1.6);
    this.flashTarget = on ? 1 : 0;
    // memories are lit warm and soft, glowing at their edges
    if (on) this.cineLight.set('memory', {}, 1.2);
    else this.cineLight.restore(1.2);
    this.r.post.settings.flashbackHue = keepHue;
    this.r.post.settings.sumieHue = keepHue > 0 ? keepHue : -1;
  }

  white(dur = 0.4): Promise<void> {
    const s = this.r.post.settings;
    s.fadeWhite = 1;
    return this.task((dt) => {
      s.fadeWhite = Math.max(0, s.fadeWhite - dt / dur);
      return s.fadeWhite <= 0;
    });
  }

  async card(num: string, title: string, sub: string, hold = 3.2): Promise<void> {
    const c = el('div', 'chapter-card', `<div class="num">${num}</div><div class="title">${title}</div><div class="sub">${sub}</div>`);
    this.ui.append(c);
    this.audio.sfx('toll');
    // the brushwork under the title draws itself on, then fades with the card
    const s = this.r.post.settings;
    s.callMode = 2;
    s.callSeed = Math.random();
    s.callProgress = 0;
    s.callAmount = 1;
    let t = 0;
    await this.task((dt) => {
      t += dt;
      s.callProgress = Math.min(1, t / 1.6);
      return t >= hold;
    });
    c.style.transition = 'opacity 0.8s';
    c.style.opacity = '0';
    await this.task((dt) => {
      s.callAmount = Math.max(0, s.callAmount - dt / 0.8);
      return s.callAmount <= 0;
    });
    s.callMode = 0;
    s.callAmount = 1;
    c.remove();
  }

  music(m: Mood): void {
    this.audio.setMood(m);
  }

  // --- effects on demand --------------------------------------------------------------------------------------

  aura(id: string, amount: number, palette?: number): void {
    const c = this.get(id);
    c.look.energy.x = amount;
    if (palette !== undefined) c.look.energy.y = palette;
  }

  burst(id: string, palette: [number, number, number], size = 2): void {
    const p = this.at(id, 0.55);
    this.fx.sprites.spawn({ kind: SK.flare, pos: p, size: size * 1.5, color: palette, intensity: 2, life: 0.4 });
    this.fx.sprites.spawn({ kind: SK.ring, pos: p, size: size * 2, color: palette, intensity: 2, life: 0.5 });
    this.fx.particles.burst({ kind: PK.ember, pos: p, count: 60, speed: 4, spread: 1, color: [...palette, 1] as [number, number, number, number], size: [0.05, 0.1], life: [0.4, 1.2] });
    this.fx.light(p, palette, 6, 6, 0.6);
    this.cam.addShake(0.3);
  }

  // --- fights ---------------------------------------------------------------------------------------------------

  async battle(spec: FightSpec): Promise<FightResult> {
    if (!this.stage) await this.setStage('void');
    for (;;) {
      this.letterbox(false);
      this.dof(0, 0);
      this.hud.show(true);
      // fights are lit by the place alone
      this.cineLight.set(null, {}, 0.4);
      const f = new Fight(this.r, spec, this.input, this.cam, this.fx, this.hud, this.stage!, this.cast);
      f.onDomain = (ff) => this.domainCinematic(ff);
      await f.setup();
      this.fight = f;
      this.input.clear();
      if (this.autoTest) this.autoFight(f);
      await this.task(() => f.over);
      const res = f.result!;
      this.hud.show(false);
      this.endDomain();
      this.cineLight.restore(1.0);
      const keep = new Set<string>(spec.fighters.map((x) => x.id).filter((id) => this.cast.has(id) && !id.startsWith('grunt')));
      f.dispose(keep);
      this.fight = null;
      // fighters return to their idle selves
      for (const fi of f.fighters) {
        fi.ch.anim.play('idle_relaxed', 0.3);
        fi.ch.look.energy.z = 0;
      }
      if (res === 'lose' && this.onLose) {
        const choice = await this.onLose();
        if (choice === 'retry') continue;
        this.quit = true;
      }
      return res;
    }
  }

  /** Test mode: the player character is driven by an AI so fights finish by themselves. */
  private autoFight(f: Fight): void {
    void import('../game/AI').then(({ AI, PROFILES }) => {
      const ai = new AI(f.player, PROFILES.master);
      ai.difficulty = 1.5;
      f.player.power = 3;
      f.player.defense = 0.3;
      f.autopilot = ai;
    });
  }

  /** The domain cinematic: the caster's hand sign, the name, the world repainted. */
  async domainCinematic(f: Fighter): Promise<void> {
    const d = f.kit.domain;
    if (!d) return;
    const c = f.ch;
    this.audio.setMood('domain');
    c.anim.play('domain', 0.1);
    c.look.energy.x = 1;
    const head = c.position.add(new Vector3(0, c.height * 0.9, 0));
    const fwd = c.forward();
    this.cam.cut({ pos: head.add(fwd.scale(1.2)).add(new Vector3(0.3, 0.05, 0)), target: head, fov: 0.45 });
    // the caster lit hard, rimmed in their own colour
    const rimPal = PAL[f.kit.palette] ?? PAL[0];
    this.cineLight.set('drama', { rimColor: [rimPal.body[0] * 1.4, rimPal.body[1] * 1.4, rimPal.body[2] * 1.4], amount: 1 }, 0.2);
    this.r.post.settings.desatPulse = 0.8;
    this.fx.impactFrame(1, 0.1);
    await this.wait(0.9);
    this.hud.banner('DOMAIN UNVEILING', 'red', d.name, 2.2);
    this.audio.sfx('toll');
    const s = this.r.post.settings;
    this.cam.move({ pos: head.add(fwd.scale(2.5)).add(new Vector3(0, -0.4, 0)), target: head, fov: 0.6 },
      { pos: c.position.add(fwd.scale(9)).add(new Vector3(4, 4, 0)), target: c.position.add(new Vector3(0, 1.5, 0)), fov: 0.95 }, 2.4);
    this.domain.show(d.id, c.position.clone());
    // the domain spills out of the caster as ink across the screen
    const pal = PAL[f.kit.palette] ?? PAL[0];
    this.fx.inkBurst(c.position.add(new Vector3(0, 1.2, 0)), [pal.body[0] * 0.35, pal.body[1] * 0.35, pal.body[2] * 0.35], 1.6, 6);
    s.domainActive = 1;
    s.domainCenter.copyFrom(c.position);
    s.domainPalette = f.kit.palette;
    await this.task((dt) => {
      this.domain.reveal = Math.min(1, this.domain.reveal + dt / 1.8);
      s.domainProgress = this.domain.reveal;
      s.domainTwist = Math.sin(this.domain.reveal * Math.PI) * 0.25;
      this.r.lighting.domainAmount = this.domain.reveal * 0.5;
      this.r.lighting.domainPalette = f.kit.palette;
      return this.domain.reveal >= 1 || this.skipping;
    });
    s.domainTwist = 0;
    s.domainActive = 0;
    this.domain.reveal = 1;
    this.stageVisible(false);
    await this.wait(0.4);
    // back to the fight: its own light
    this.cineLight.set(null, {}, 0.6);
  }

  /**
   * Two domains at once: the frame is drawn inside each of them on alternate frames and the
   * screen split between them along a seam where space breaks (vbClash). `balance(t)` says who is
   * winning as the clash goes on (t 0..1; below 0 the first, above 0 the second).
   */
  async domainClash(a: { domain: number; who: string; palette: number }, b: { domain: number; who: string; palette: number }, dur: number,
    balance: (t: number) => number = (t) => Math.sin(t * 12) * 0.25): Promise<void> {
    const s = this.r.post.settings;
    const pa = PAL[a.palette] ?? PAL[0];
    const pb = PAL[b.palette] ?? PAL[0];
    s.clashSeed = Math.random();
    s.clashColorA.set(pa.body[0], pa.body[1], pa.body[2]);
    s.clashColorB.set(pb.body[0], pb.body[1], pb.body[2]);
    this.audio.sfx('toll');
    let t = 0;
    let phase = 0;
    let lastSwing = 0;
    await this.task((dt) => {
      t += dt;
      const k = Math.min(1, t / dur);
      phase = 1 - phase;
      s.clashPhase = phase;
      this.domain.id = phase ? b.domain : a.domain;
      const ca = this.fx.project(this.at(a.who, 1.2));
      const cb = this.fx.project(this.at(b.who, 1.2));
      s.clashA.set(ca.x, ca.y);
      s.clashB.set(cb.x, cb.y);
      const bal = balance(k);
      // every swing of the balance shakes the world
      if (Math.abs(bal - lastSwing) > 0.25) {
        this.cam.addShake(0.35);
        lastSwing = bal;
      }
      s.clashBalance = bal;
      s.clash = Math.min(1, t / 0.4) * (k < 0.92 ? 1 : (1 - k) / 0.08);
      this.cam.addShake(0.03);
      return k >= 1 || this.skipping;
    });
    s.clash = 0;
  }

  endDomain(): void {
    if (!this.domain.active) return;
    // the domain's world shatters like glass back into the real one
    const center = this.domain.center.clone();
    void this.transition('shatter', () => {
      this.domain.hide();
      this.stageVisible(true);
      this.r.lighting.domainAmount = 0;
      this.r.post.settings.domainActive = 0;
    }, 1.5, center.add(new Vector3(0, 1.2, 0)));
  }

  private transitionBusy = false;

  /**
   * A scene transition on real frames: the current frame is kept, `change` sets up the new scene
   * underneath it, then the old frame breaks away (shatter from `impact`, ink, burn, slash, or
   * talismans). Skipped while another one runs (the change is applied at once).
   */
  async transition(kind: 'shatter' | 'ink' | 'burn' | 'slash' | 'talisman', change: () => void | Promise<void>, dur = 1.3, impact?: Vector3): Promise<void> {
    const s = this.r.post.settings;
    if (this.transitionBusy || this.skipping) {
      await change();
      return;
    }
    this.transitionBusy = true;
    s.transKind = { shatter: 0, ink: 1, burn: 2, slash: 3, talisman: 4 }[kind];
    s.transSeed = Math.random();
    if (impact) {
      const sp = this.fx.project(impact);
      s.transImpact.set(sp.x, sp.y);
    } else {
      s.transImpact.set(0.5, 0.5);
    }
    // keep this frame, cover the screen with it, change the scene underneath
    this.r.post.captureSnapshot();
    s.transT = 0;
    await this.wait(0.02);
    await change();
    let t = 0;
    await this.task((dt) => {
      t += dt / dur;
      s.transT = Math.min(t, 0.999);
      return t >= 1;
    });
    s.transT = -1;
    this.transitionBusy = false;
  }

  private stageVisible(v: boolean): void {
    for (const m of this.r.scene.meshes) {
      if (m.material && m.material.name.startsWith('env_')) m.setEnabled(v);
    }
  }

  /** Called every frame by Game while a fight's domain runs. */
  domainUpdate(): void {
    if (this.fight && this.domain.active && !this.fight.combat.domainOwner && this.domain.reveal >= 1) this.endDomain();
  }
}
