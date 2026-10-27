import * as THREE from 'three';
import type { Speaker } from '../ui/UI';
import type { Companion } from './Companion';
import type { Game } from './Game';

/**
 * Story scripting on game time: scripts are async functions that await waits, conditions and
 * dialogue lines. Cutscenes take control of the camera and Ada; dialogue drives who is talking.
 */
export class Director {
  cutscene = false;
  speaker: Speaker = '';
  /** Pip, if the level has it, so its mouth (head bob) can follow the dialogue. */
  pip: Companion | null = null;
  private waits: { t: number; done: () => void }[] = [];
  private conds: { fn: () => boolean; done: () => void }[] = [];

  constructor(private game: Game) {}

  reset() {
    this.waits = [];
    this.conds = [];
    this.cutscene = false;
    this.pip = null;
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
    await this.game.ui.say(who, text);
    if (this.pip) this.pip.speaking = false;
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
    this.cutscene = false;
    this.game.player.inputEnabled = true;
    this.game.ui.letterbox(false);
    this.game.ui.hideDialogue();
    this.game.rig.setShot(null);
  }

  shot(position: THREE.Vector3, look: THREE.Vector3, fov?: number) {
    this.game.rig.setShot({ position: position.clone(), look: look.clone(), fov });
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
