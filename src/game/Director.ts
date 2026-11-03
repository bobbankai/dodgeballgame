import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { speech } from '../audio/Speech';
import type { Speaker } from '../ui/UI';
import { inferEmotion, type Emotion, type Expressive } from './Face';
import type { Companion } from './Companion';
import type { Procedural } from './Procedural';
import type { Game } from './Game';

export interface RailOptions {
  path: THREE.Vector3[];
  look: THREE.Vector3 | THREE.Vector3[];
  duration: number;
  fov?: [number, number];
  roll?: [number, number];
  ease?: 'inOut' | 'linear' | 'out';
}

interface Rail {
  curve: THREE.CatmullRomCurve3;
  look: THREE.Vector3 | THREE.CatmullRomCurve3;
  t: number;
  o: RailOptions;
  done: () => void;
}

/** A line of dialogue: who, what, and (optionally) how they feel saying it. */
export type Line = [Speaker, string] | [Speaker, string, Emotion];

/**
 * Story scripting on game time: scripts are async functions that await waits, conditions and
 * dialogue lines. Cutscenes take control of the camera and Ada; dialogue drives who is talking.
 */
export class Director {
  cutscene = false;
  speaker: Speaker = '';
  /** Pip, if the level has it, so its mouth (head bob) can follow the dialogue. */
  pip: Companion | null = null;
  /** Other characters who talk (they animate while their lines type out). */
  readonly actors = new Map<Speaker, { speaking: boolean; expression?: Expressive; life?: Procedural; root?: THREE.Object3D }>();
  /** Who spoke last apart from Ada (she looks at them while she answers). */
  lastOther: Speaker = '';
  private waits: { t: number; done: () => void }[] = [];
  private rails: Rail[] = [];
  private focusOn: THREE.Vector3 | (() => THREE.Vector3) | null = null;
  private conds: { fn: () => boolean; done: () => void }[] = [];

  constructor(private game: Game) {}

  reset() {
    speech.stop();
    this.lastOther = '';
    this.rails = [];
    this.focusOn = null;
    this.waits = [];
    this.conds = [];
    this.cutscene = false;
    this.pip = null;
    this.actors.clear();
  }

  wait(seconds: number): Promise<void> {
    return new Promise((done) => this.waits.push({ t: seconds, done }));
  }

  until(fn: () => boolean): Promise<void> {
    if (fn()) return Promise.resolve();
    return new Promise((done) => this.conds.push({ fn, done }));
  }

  /** Whoever can show a feeling: Ada always, Pip and the others while they're in the scene. */
  faceOf(who: Speaker): Expressive | undefined {
    if (who === 'Ada') return this.game.player.expression;
    if (who === 'Pip') return this.pip?.expression;
    return this.actors.get(who)?.expression;
  }

  /** Where someone's head is (for others to look at), if they are here. */
  headOf(who: Speaker, out: THREE.Vector3): THREE.Vector3 | null {
    if (who === 'Ada') return this.game.player.life.headPosition(out);
    if (who === 'Pip') return this.pip?.root.visible ? this.pip.life.headPosition(out) : null;
    const a = this.actors.get(who);
    if (!a?.life || (a.root && !a.root.visible)) return null;
    return a.life.headPosition(out);
  }

  private faces(): [Speaker, Expressive][] {
    const out: [Speaker, Expressive][] = [];
    for (const w of ['Ada', 'Pip', 'Mum', 'Keeper'] as Speaker[]) {
      const f = this.faceOf(w);
      if (f) out.push([w, f]);
    }
    return out;
  }

  /** Say a line with a feeling (given, or read from the words); the others react a little. */
  async say(who: Speaker, text: string, feeling?: Emotion) {
    this.speaker = who;
    if (who !== 'Ada') this.lastOther = who;
    if (this.pip) this.pip.speaking = who === 'Pip';
    const actor = this.actors.get(who);
    if (actor) actor.speaking = true;
    const e = feeling ?? inferEmotion(text);
    audio.setMood(e);
    // listeners catch a softer echo of it (a frightened line worries them; anger only worries)
    const echo: Partial<Record<Emotion, [Emotion, number]>> = {
      sad: ['sad', 0.5], joy: ['happy', 0.6], happy: ['happy', 0.4], tender: ['tender', 0.5], scared: ['worried', 0.6],
      worried: ['worried', 0.4], surprised: ['surprised', 0.4], wonder: ['wonder', 0.5], angry: ['worried', 0.4],
    };
    for (const [w, f] of this.faces()) {
      if (w === who) f.set(e, 1);
      else if (echo[e]) f.set(echo[e][0], echo[e][1]);
    }
    // the recording, if there is one: the words keep pace with it; without one they type out
    let voiced: boolean | null = null;
    void speech.start(who, text).then((r) => (voiced = !!r));
    await this.game.ui.say(who, text, 42, () => (voiced === null ? 0 : voiced ? speech.progress() : null));
    speech.stop();
    this.faceOf(who)?.quiet();
    if (this.pip) this.pip.speaking = false;
    if (actor) actor.speaking = false;
    this.speaker = '';
  }

  /** A run of lines, then the dialogue box closes and faces settle back. */
  async talk(lines: Line[]) {
    speech.prefetch(lines.map(([w, t]) => [w, t]));
    for (const [w, t, e] of lines) await this.say(w, t, e);
    this.game.ui.hideDialogue();
    for (const [, f] of this.faces()) f.set('neutral', 1, 0.01);
  }

  /** Show a feeling outside dialogue (a gasp, a grin), easing back after `seconds`. */
  feel(who: Speaker, e: Emotion, seconds = 2.5, strength = 1) {
    this.faceOf(who)?.set(e, strength, seconds);
  }

  begin(bars = true) {
    this.cutscene = true;
    this.game.player.inputEnabled = false;
    this.game.player.mode = 'free';
    if (bars) this.game.ui.letterbox(true);
    this.game.ui.prompt(null);
  }

  end() {
    this.rails = [];
    this.focus(null);
    this.game.pipe.uniforms.uVignette.value = 0;
    this.cutscene = false;
    this.game.player.inputEnabled = true;
    this.game.ui.letterbox(false);
    this.game.ui.hideDialogue();
    this.game.rig.setShot(null);
  }

  shot(position: THREE.Vector3, look: THREE.Vector3, fov?: number, cut = false) {
    this.game.rig.setShot({ position: position.clone(), look: look.clone(), fov }, cut);
  }

  /**
   * A camera move along a spline: the camera follows `path`, looking along `look` (a point or a
   * second spline), easing in and out over `duration` seconds, with optional fov and roll changes.
   * Cuts to the start. Resolves when the move ends; the camera holds the last frame.
   */
  rail(o: RailOptions): Promise<void> {
    return new Promise((done) => {
      const curve = new THREE.CatmullRomCurve3(o.path.map((p) => p.clone()), false, 'centripetal');
      const look = Array.isArray(o.look) ? new THREE.CatmullRomCurve3(o.look.map((p) => p.clone()), false, 'centripetal') : o.look.clone();
      this.rails = [{ curve, look, t: 0, o, done }];
      this.stepRail(0);
    });
  }

  /** Cinematic depth of field: keep `on` sharp (a point, or a function for moving subjects). */
  focus(on: THREE.Vector3 | (() => THREE.Vector3) | null, aperture = 0.6) {
    this.focusOn = on;
    this.game.pipe.uniforms.uAperture.value = on ? aperture : 0;
  }

  /** Letterbox, a heavier vignette and shallow focus: the film look for story moments. */
  cinematic(on = true) {
    this.game.ui.letterbox(on);
    this.game.pipe.uniforms.uVignette.value = on ? 0.18 : 0;
  }

  private stepRail(dt: number) {
    const r = this.rails[0];
    if (!r) return;
    r.t += dt;
    const k = Math.min(1, r.t / r.o.duration);
    const e = r.o.ease === 'linear' ? k : r.o.ease === 'out' ? 1 - (1 - k) * (1 - k) : k * k * k * (k * (k * 6 - 15) + 10);
    // arc-length lookups can overshoot 1 by a hair, which short splines don't survive
    const u = Math.min(Math.max(e, 0), 0.99999);
    const pos = r.curve.getPointAt(u);
    const look = r.look instanceof THREE.Vector3 ? r.look : r.look.getPointAt(u);
    const fov = r.o.fov ? r.o.fov[0] + (r.o.fov[1] - r.o.fov[0]) * e : undefined;
    const roll = r.o.roll ? r.o.roll[0] + (r.o.roll[1] - r.o.roll[0]) * e : undefined;
    this.game.rig.setShot({ position: pos, look: look.clone(), fov, roll }, true);
    if (k >= 1) {
      this.rails = [];
      r.done();
    }
  }

  /**
   * A shot over Ada's shoulder towards a point, nice for conversations. If scenery stands behind her
   * (a doorway, a wall), it swings round her to the first angle with a clear view instead of being
   * pushed up against the back of her head.
   */
  overShoulder(at: THREE.Vector3, fov = 40) {
    const p = this.game.player.position;
    const dir = new THREE.Vector3().subVectors(at, p).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    // lower for someone small (Pip), and aimed low so whoever she talks to sits above the dialogue
    const h = THREE.MathUtils.clamp(at.y - p.y + 1.0, 1.15, 1.6);
    const look = at.clone().lerp(p, 0.35);
    look.y = THREE.MathUtils.lerp(at.y, p.y + 1.2, 0.3) - 0.1;
    const cams = ([[2.2, 0.9], [2.2, -0.9], [1.5, 1.9], [1.5, -1.9], [0.7, 2.5], [0.7, -2.5]] as const).map(([back, sd]) =>
      p.clone().addScaledVector(dir, -back).addScaledVector(side, sd).add(new THREE.Vector3(0, h, 0)));
    this.shot(this.clearest(look, cams), look, fov);
  }

  /**
   * Of some camera positions for a shot of `look` (in order of preference), the first with nothing in
   * the way, or failing that the one that sees furthest.
   */
  clearest(look: THREE.Vector3, candidates: THREE.Vector3[]) {
    let best = candidates[0], bd = -1;
    const dir = new THREE.Vector3();
    for (const c of candidates) {
      dir.subVectors(c, look);
      const len = dir.length();
      dir.normalize();
      const hit = this.game.collision.raycast(look, dir, len);
      if (hit === null) return c;
      const free = hit;
      if (free > bd) {
        bd = free;
        best = c;
      }
    }
    return best;
  }

  /** Walk Ada to a point (cutscenes). */
  async walk(to: THREE.Vector3, speed = 1.35) {
    const pl = this.game.player;
    pl.goal = to.clone();
    pl.goalSpeed = speed;
    await this.until(() => pl.goal === null);
  }

  update(dt: number) {
    this.stepRail(dt);
    if (this.focusOn) {
      const f = typeof this.focusOn === 'function' ? this.focusOn() : this.focusOn;
      const u = this.game.pipe.uniforms.uFocus;
      const d = this.game.camera.position.distanceTo(f);
      u.value += (d - u.value) * (1 - Math.exp(-dt * 8));
    }
    if (this.waits.length) {
      const due: (() => void)[] = [];
      this.waits = this.waits.filter((w) => {
        w.t -= dt;
        if (w.t <= 0) due.push(w.done);
        return w.t > 0;
      });
      due.forEach((d) => d());
    }
    if (this.conds.length) {
      const due: (() => void)[] = [];
      this.conds = this.conds.filter((c) => {
        if (c.fn()) {
          due.push(c.done);
          return false;
        }
        return true;
      });
      due.forEach((d) => d());
    }
  }
}
