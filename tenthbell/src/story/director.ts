// The cutscene toolkit: actors on marks, lines with faces that speak them, camera shots, cards and fades.
// Everything waits on game time, so a scene plays the same at any frame rate and can be stepped by the test bot.
import { Shot } from '../engine/camera';
import { Game } from '../game/game';
import { Emotion, Model } from '../game/model';

export class Actor {
  constructor(public model: Model, public name: string) {}

  /** stand at (x, z) turned yaw degrees: 0 faces the camera, 90 faces right, -90 left */
  at(x: number, z: number, yaw: number): this {
    const r = this.model.root;
    r.position.set(x, 0, z); r.rotation.y = (yaw * Math.PI) / 180; r.scaling.set(1, 1, 1);
    return this;
  }
  play(clip: string, fade = 0.35): this { this.model.play(clip, fade, 0, false); return this; }
  feel(e: Emotion): this { this.model.emotion = e; return this; }
  get x() { return this.model.root.position.x; }
  get z() { return this.model.root.position.z; }
  get eye() { return this.model.meta.eye; }
}

export class Director {
  cast = new Map<string, Actor>();
  private skipT = 0;

  constructor(public game: Game) {}

  /** Bring an actor on (loading the model the first time). */
  async actor(name: string, x: number, z: number, yaw: number, clip = 'stand', feel: Emotion = 'neutral'): Promise<Actor> {
    let a = this.cast.get(name);
    if (!a) { a = new Actor(await this.game.spawn(name), name); this.cast.set(name, a); }
    a.model.root.setEnabled(true);
    a.model.flash = 0;
    return a.at(x, z, yaw).play(clip, 0).feel(feel);
  }

  hide(name: string) { this.cast.get(name)?.model.root.setEnabled(false); }

  /** Remove everyone (between chapters). */
  clear() {
    for (const a of this.cast.values()) this.game.despawn(a.model);
    this.cast.clear();
  }

  /** letterbox on, controls off; the scene can be skipped from here until end() */
  begin() {
    const { ui, input } = this.game;
    ui.letterbox(true); ui.skip(true); ui.hint(null);
    input.clear();
    this.game.rush = false; this.skipT = 0;
    this.game.cam.sway = 1;
  }

  end() {
    const { ui } = this.game;
    ui.letterbox(false); ui.skip(false); ui.say(null); ui.card(false);
    this.game.rush = false;
    this.game.cam.sway = 0;
    this.game.cam.focus(0);
    for (const a of this.cast.values()) a.model.talk = 0;
  }

  /** wait, unless the scene is being skipped; holding skip (or Escape) for half a second skips the rest */
  async wait(s: number) {
    const g = this.game;
    for (let t = 0; t < s && !g.rush; t += 1 / 30) {
      await g.wait(1 / 30);
      this.skipT = g.ui.skipHeld ? this.skipT + 1 / 30 : 0;
      if (this.skipT > 0.5 || g.input.takePause()) g.rush = true;
    }
  }

  /** A spoken line. who '' is Kessa's thought (italic, nobody's mouth moves). Moves on with a press or by itself. */
  async say(who: string, text: string, feel?: Emotion) {
    const g = this.game;
    if (g.rush) return;
    const a = this.cast.get(who.toLowerCase());
    if (a) { if (feel) a.feel(feel); a.model.talk = 1; }
    g.ui.say(who, text);
    g.input.takeConfirm();
    const hold = 1.5 + text.length * 0.052;
    for (let t = 0; t < hold && !g.rush; t += 1 / 30) {
      await this.wait(1 / 30);
      if (t > 0.35 && g.input.takeConfirm()) break;
    }
    if (a) a.model.talk = 0;
    g.ui.say(null);
    await this.wait(0.18);
  }

  /** a line said over play, without stopping it */
  bark(who: string, text: string, seconds = 2.6) {
    const g = this.game;
    g.ui.say(who, text);
    void g.wait(seconds).then(() => g.ui.say(null));
  }

  shot(s: Shot, seconds = 0): Promise<void> { return this.game.rush ? this.game.cam.shot(s, 0) : this.game.cam.shot(s, seconds); }

  /** A face. side: which side of the actor the camera stands on (-1 left of frame, 1 right). */
  close(a: Actor, side = 1, dist = 1.5, seconds = 0, lift = 0): Promise<void> {
    const pos: [number, number, number] = [a.x + side * dist * 0.5, a.eye + 0.02 + lift, a.z + dist];
    return this.shot({ pos, look: [a.x, a.eye - 0.03, a.z], fov: 0.3, focus: Math.hypot(side * dist * 0.5, dist), fstop: 1.8 }, seconds);
  }

  /** Two people in frame, from in front. */
  two(a: Actor, b: Actor, dist = 4.2, seconds = 0, height = 1.35): Promise<void> {
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    return this.shot({ pos: [mx + 0.25, height, mz + dist], look: [mx, 1.2, mz], fov: 0.42, focus: dist, fstop: 2.8 }, seconds);
  }

  /** Over one actor's shoulder at another. */
  over(from: Actor, to: Actor, seconds = 0): Promise<void> {
    const dx = Math.sign(to.x - from.x) || 1;
    return this.shot({ pos: [from.x - dx * 0.75, from.eye + 0.1, from.z + 0.95], look: [to.x, to.eye - 0.05, to.z], fov: 0.34, focus: Math.abs(to.x - from.x) + 0.8, fstop: 2.0 }, seconds);
  }

  async fadeOut(s = 0.7) { this.game.ui.fade(1, this.game.rush ? 0 : s); await this.wait(s); }
  async fadeIn(s = 0.9) { this.game.ui.fade(0, this.game.rush ? 0 : s); await this.wait(s * 0.6); }

  /** Words on black (or over the picture). */
  async card(small: string, big: string, em = '', hold = 3.2) {
    if (this.game.rush) return;
    this.game.ui.card(true, small, big, em);
    await this.wait(hold);
    this.game.ui.card(false);
    await this.wait(1.2);
  }
}
