import * as THREE from 'three';
import type { Speaker } from '../ui/UI';
import type { Companion } from './Companion';
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
  readonly actors = new Map<Speaker, { speaking: boolean }>();
  private waits: { t: number; done: () => void }[] = [];
  private rails: Rail[] = [];
  private focusOn: THREE.Vector3 | (() => THREE.Vector3) | null = null;
  private conds: { fn: () => boolean; done: () => void }[] = [];

  constructor(private game: Game) {}

  reset() {
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

  async say(who: Speaker, text: string) {
    this.speaker = who;
    if (this.pip) this.pip.speaking = who === 'Pip';
    const actor = this.actors.get(who);
    if (actor) actor.speaking = true;
    await this.game.ui.say(who, text);
    if (this.pip) this.pip.speaking = false;
    if (actor) actor.speaking = false;
    this.speaker = '';
  }

  /** A run of lines, then the dialogue box closes. */
  async talk(lines: [Speaker, string][]) {
    for (const [w, t] of lines) await this.say(w, t);
    this.game.ui.hideDialogue();
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

  /** A shot over Ada's shoulder towards a point, nice for conversations. */
  overShoulder(at: THREE.Vector3, fov = 40) {
    const p = this.game.player.position;
    const dir = new THREE.Vector3().subVectors(at, p).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const cam = p.clone().addScaledVector(dir, -2.2).addScaledVector(side, 0.9).add(new THREE.Vector3(0, 1.6, 0));
    this.shot(cam, at.clone().lerp(p, 0.35).add(new THREE.Vector3(0, 0.7, 0)), fov);
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
