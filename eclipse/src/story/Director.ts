import { Vector3 } from '@babylonjs/core';
import type { Game } from '../game/Game';

export interface Shot {
  pos: Vector3;
  target: Vector3;
  fov?: number;
}

interface Move {
  from: Shot;
  to: Shot;
  t: number;
  dur: number;
  ease: (x: number) => number;
  done: () => void;
}

/** Who speaks a line: subtitle colour/name and the voice used to record it. */
export interface Speaker {
  name: string;
  /** Subtitle size: gods speak larger. */
  size?: 'small' | 'medium' | 'large';
}

export const SPEAKERS: Record<string, Speaker> = {
  kael: { name: 'Kael' },
  ithra: { name: 'Ithra' },
  ignaroth: { name: 'Ignaroth', size: 'large' },
  thaloryn: { name: 'Thaloryn', size: 'large' },
  vaeltris: { name: 'Vaeltris', size: 'large' },
  sylvaris: { name: 'Sylvaris', size: 'large' },
  aurelion: { name: 'Aurelion', size: 'large' },
  mira: { name: 'Mira' },
  brannoc: { name: 'Brannoc' },
};

export const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
export const linear = (x: number): number => x;

/** Thrown inside a script when the player skips; scripts end at their `finally` blocks. */
class Skipped extends Error {}

/**
 * Cinematics and scripted story beats, run as async scripts on game time (so they pause with the
 * game and step deterministically in tests). A script can cut and move the camera (eased rails and
 * orbits), letterbox, fade, pull focus, and speak lines (subtitles timed to the recorded voice, or to
 * reading speed when there is none). Holding pause skips: every pending wait resolves at once and
 * the script's cleanup restores gameplay.
 */
export class Director {
  running = false;
  private skipping = false;
  private move: Move | null = null;
  private holdSkip = 0;
  private lineDurations: Record<string, number> = {};
  /** Lines wait for this long per character when there is no recording. */
  readingSpeed = 0.055;

  constructor(private game: Game) {
    game.updaters.push((dt) => this.update(dt));
  }

  /** Recorded line lengths (audio/voices/manifest.json), so subtitles track the voices. */
  setVoiceDurations(d: Record<string, number>): void {
    this.lineDurations = d;
  }

  async play(script: (d: Director) => Promise<void>): Promise<void> {
    if (this.running) return;
    const g = this.game;
    this.running = true;
    this.skipping = false;
    g.rig.cinematic = true;
    if (g.player) {
      g.player.inputEnabled = false;
      g.player.setCinematic(true);
    }
    g.hud.setVisible(false);
    g.touch.setVisible(false);
    document.getElementById('ui')?.classList.add('ec-letterbox');
    try {
      await script(this);
    } catch (e) {
      if (!(e instanceof Skipped)) throw e;
    } finally {
      this.move?.done();
      this.move = null;
      this.letterbox(false);
      g.hud.showSubtitle(null, null);
      g.hud.setVisible(true);
      g.touch.setVisible(true);
      g.rig.cinematic = false;
      g.rig.blendFromCurrent();
      g.pipe.setFocus(0);
      if (g.player) {
        g.player.setCinematic(false);
        g.player.inputEnabled = true;
      }
      g.hud.fade(false);
      this.running = false;
      this.skipping = false;
    }
  }

  private check(): void {
    if (this.skipping) throw new Skipped();
  }

  wait(seconds: number): Promise<void> {
    this.check();
    return new Promise((resolve, reject) => {
      const start = this.game.clock.time;
      const tick = (): void => {
        if (this.skipping) return reject(new Skipped());
        if (this.game.clock.time - start >= seconds) return resolve();
        this.game.hazards.after(Math.min(0.05, seconds), tick);
      };
      this.game.hazards.after(Math.min(0.05, seconds), tick);
    });
  }

  cut(s: Shot): void {
    this.check();
    this.move = null;
    this.apply(s);
  }

  private apply(s: Shot): void {
    const cam = this.game.camera;
    cam.position.copyFrom(s.pos);
    cam.setTarget(s.target);
    if (s.fov) cam.fov = s.fov;
  }

  /** Eased camera move from one shot to another (resolves when it arrives). */
  rail(from: Shot, to: Shot, seconds: number, ease = easeInOut): Promise<void> {
    this.check();
    this.apply(from);
    return new Promise((resolve, reject) => {
      this.move = { from, to, t: 0, dur: seconds, ease, done: resolve };
      const watch = (): void => {
        if (this.skipping) return reject(new Skipped());
        if (this.move) this.game.hazards.after(0.1, watch);
      };
      this.game.hazards.after(0.1, watch);
    });
  }

  /** Circles a point (angles in radians round Y, starting from +Z). */
  /** Circles `center` at `radius` and `height`, looking at the point `look` metres above it. */
  orbit(center: Vector3, radius: number, height: number, a0: number, a1: number, seconds: number, ease = easeInOut, look = 0): Promise<void> {
    const target = center.add(new Vector3(0, look, 0));
    const at = (a: number): Shot => ({ pos: center.add(new Vector3(Math.sin(a) * radius, height, Math.cos(a) * radius)), target });
    return this.rail(at(a0), at(a1), seconds, ease);
  }

  letterbox(on: boolean): void {
    document.getElementById('ui')?.classList.toggle('on', on);
  }

  fade(on: boolean): Promise<void> {
    this.game.hud.fade(on);
    return this.skipping ? Promise.resolve() : this.wait(0.7);
  }

  focus(distance: number, fStop = 2.2): void {
    this.game.pipe.setFocus(distance, fStop);
  }

  /** Speaks a line: subtitle + voice; resolves when it has been said. */
  async say(who: string, text: string, key?: string): Promise<void> {
    this.check();
    const sp = SPEAKERS[who] ?? { name: who };
    const g = this.game;
    const k = key ?? lineKey(who, text);
    const dur = this.lineDurations[k] ?? Math.max(1.6, text.length * this.readingSpeed);
    g.hud.showSubtitle(sp.name, text, sp.size ?? 'medium');
    g.audio.play(`line:${k}`);
    try {
      await this.wait(dur + 0.35);
    } finally {
      g.hud.showSubtitle(null, null);
    }
  }

  /** A line spoken during play (no camera, no letterbox); later barks replace earlier ones. */
  bark(who: string, text: string, key?: string): void {
    const sp = SPEAKERS[who] ?? { name: who };
    const g = this.game;
    const k = key ?? lineKey(who, text);
    const dur = this.lineDurations[k] ?? Math.max(1.6, text.length * this.readingSpeed);
    const id = ++this.barkId;
    g.hud.showSubtitle(sp.name, text, sp.size ?? 'medium');
    g.audio.play(`line:${k}`);
    g.hazards.after(dur + 0.4, () => {
      if (this.barkId === id && !this.running) g.hud.showSubtitle(null, null);
    });
  }

  private barkId = 0;

  /** Speaks several barks one after another (resolves when the last has been said). */
  async barks(lines: [string, string][]): Promise<void> {
    for (const [who, text] of lines) {
      const k = lineKey(who, text);
      this.bark(who, text, k);
      await new Promise<void>((r) => this.game.hazards.after((this.lineDurations[k] ?? Math.max(1.6, text.length * this.readingSpeed)) + 0.5, r));
    }
  }

  private update(dt: number): void {
    const m = this.move;
    if (m) {
      m.t += dt;
      const k = m.ease(Math.min(1, m.t / m.dur));
      const pos = Vector3.Lerp(m.from.pos, m.to.pos, k);
      const target = Vector3.Lerp(m.from.target, m.to.target, k);
      const fov = (m.from.fov ?? this.game.camera.fov) + ((m.to.fov ?? m.from.fov ?? this.game.camera.fov) - (m.from.fov ?? this.game.camera.fov)) * k;
      this.apply({ pos, target, fov });
      if (m.t >= m.dur) {
        this.move = null;
        m.done();
      }
    }
    if (this.running) {
      // hold pause for a second to skip
      if (this.game.input.held('pause')) this.holdSkip += dt;
      else this.holdSkip = 0;
      if (this.holdSkip > 0.9 && !this.skipping) this.skipping = true;
    }
  }
}

/** Stable id for a line (voice file name). */
export function lineKey(who: string, text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${who}_${(h >>> 0).toString(36)}`;
}
