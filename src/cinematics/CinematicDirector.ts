import * as THREE from 'three';
import { Ease, EaseName, noise1 } from '../core/math';
import { time } from '../core/Time';
import type { Athlete } from '../game/Athlete';
import type { Ball } from '../game/Ball';
import type { Game } from '../core/Game';
import { h } from '../ui/dom';

/** A world-space point that can follow actors. */
export type V3Src =
  | THREE.Vector3
  | (() => THREE.Vector3)
  | { at: Athlete; off: [number, number, number] }
  | { ball: Ball; off?: [number, number, number] };

export interface Shot {
  /** real-time seconds */
  dur: number;
  pos?: V3Src;
  pos2?: V3Src;
  look: V3Src;
  look2?: V3Src;
  /** orbit around a point instead of pos/pos2 (angles in radians, 0 = +Z) */
  orbit?: { center: V3Src; radius: number; height: number; from: number; to: number; radius2?: number };
  ease?: EaseName;
  fov?: number;
  fov2?: number;
  roll?: number;
  shake?: number;
  dof?: { range?: number; bokeh?: number };
  /** gameplay time scale during the shot */
  timeScale?: number;
  /** blend in from previous camera pose (seconds); 0 = hard cut */
  blend?: number;
  onStart?: () => void;
  events?: { t: number; fn: () => void }[];
  title?: { t1: string; t2: string; t3?: string };
  subtitle?: { who?: string; text: string };
  /** stop the shot early when this returns true */
  until?: () => boolean;
}

export interface PlayOpts {
  skippable?: boolean;
  letterbox?: boolean;
  returnBlend?: number;
  /** restore gameplay camera after (default true) */
  restore?: boolean;
  hideHud?: boolean;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export function resolve(src: V3Src, out: THREE.Vector3): THREE.Vector3 {
  if (src instanceof THREE.Vector3) return out.copy(src);
  if (typeof src === 'function') return out.copy(src());
  if ('at' in src) {
    const a = src.at;
    const f = [Math.sin(a.yaw), Math.cos(a.yaw)];
    const r = [-Math.cos(a.yaw), Math.sin(a.yaw)];
    const [ox, oy, oz] = src.off;
    return out.set(a.pos.x + r[0] * ox + f[0] * oz, a.pos.y + a.y + oy, a.pos.z + r[1] * ox + f[1] * oz);
  }
  const b = src.ball;
  const off = src.off ?? [0, 0, 0];
  if (off[0] === 0 && off[1] === 0 && off[2] === 0) return out.copy(b.pos);
  // offset in ball-velocity frame: [right, up, back]
  const v = _b.copy(b.vel);
  if (v.lengthSq() < 1e-4) v.set(0, 0, -1);
  v.normalize();
  const right = new THREE.Vector3().crossVectors(v, new THREE.Vector3(0, 1, 0)).normalize();
  return out.copy(b.pos).addScaledVector(right, off[0]).addScaledVector(new THREE.Vector3(0, 1, 0), off[1]).addScaledVector(v, -off[2]);
}

/** Overlay elements for cinematics (title cards, subtitles, skip prompt). */
class CinematicUI {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private sub: HTMLElement;
  private skip: HTMLElement;
  private flash: HTMLElement;
  constructor(parent: HTMLElement) {
    this.title = h('div', { class: 'letterbox-title' }, h('div', { class: 't1' }), h('div', { class: 't2' }), h('div', { class: 't3' }));
    this.sub = h('div', { class: 'subtitle' });
    this.skip = h('div', { class: 'skip-hint' }, 'HOLD SPACE / ENTER TO SKIP');
    this.flash = h('div', { class: 'announce' });
    this.el = h('div', { class: 'cine-ui', style: 'position:absolute;inset:0;pointer-events:none' }, this.title, this.sub, this.skip, this.flash);
    parent.appendChild(this.el);
  }
  setTitle(t: { t1: string; t2: string; t3?: string } | null) {
    if (!t) {
      this.title.classList.remove('on');
      return;
    }
    (this.title.children[0] as HTMLElement).textContent = t.t1;
    (this.title.children[1] as HTMLElement).textContent = t.t2;
    (this.title.children[2] as HTMLElement).textContent = t.t3 ?? '';
    this.title.classList.add('on');
  }
  setSubtitle(s: { who?: string; text: string } | null) {
    if (!s) {
      this.sub.classList.remove('on');
      return;
    }
    this.sub.innerHTML = '';
    if (s.who) this.sub.append(h('b', {}, s.who));
    this.sub.append(document.createTextNode(s.text));
    this.sub.classList.add('on');
  }
  showSkip(on: boolean) {
    this.skip.classList.toggle('on', on);
  }
  big(text: string, sub = '', style = 'ultimate') {
    this.flash.innerHTML = '';
    this.flash.append(h('div', { class: `a-item ${style}` }, h('div', { class: 'a-main' }, text), sub ? h('div', { class: 'a-sub' }, sub) : null));
  }
}

/**
 * Data-driven real-time cinematics: shots describe camera motion (dolly, orbit,
 * tracking, FOV, shake, DOF), time-scale, titles, subtitles and timed events.
 * Positions can be absolute or follow actors/balls.
 */
export class CinematicDirector {
  playing = false;
  private shots: Shot[] = [];
  private idx = 0;
  private t = 0;
  private opts: PlayOpts = {};
  private resolveEnd: (() => void) | null = null;
  private fired = new Set<number>();
  readonly ui: CinematicUI;
  private blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
  private skipHold = 0;
  private tick = (_dt: number, realDt: number) => this.update(realDt);

  constructor(private game: Game) {
    this.ui = new CinematicUI(game.uiRoot);
  }

  play(shots: Shot[], opts: PlayOpts = {}): Promise<void> {
    if (this.playing) this.finish(false);
    this.shots = shots;
    this.opts = { restore: true, letterbox: true, returnBlend: 0.45, ...opts };
    this.idx = -1;
    this.playing = true;
    this.skipHold = 0;
    this.game.cinematicActive = true;
    this.game.cam.mode = 'cinematic';
    if (this.opts.letterbox) this.game.renderer.setLetterbox(true);
    if (this.opts.hideHud) this.game.hud.show(false);
    this.ui.showSkip(!!opts.skippable);
    this.game.tickers.add(this.tick);
    this.next();
    return new Promise((res) => (this.resolveEnd = res));
  }

  skip() {
    if (this.playing && this.opts.skippable) this.finish(true);
  }

  private next() {
    this.idx++;
    this.t = 0;
    this.fired.clear();
    if (this.idx >= this.shots.length) {
      this.finish(false);
      return;
    }
    const s = this.shots[this.idx];
    const cam = this.game.world.camera;
    this.blendFrom.pos.copy(cam.position);
    this.blendFrom.quat.copy(cam.quaternion);
    this.blendFrom.fov = cam.fov;
    time.cineScale = s.timeScale ?? 1;
    s.onStart?.();
    this.ui.setTitle(s.title ?? null);
    this.ui.setSubtitle(s.subtitle ?? null);
    if (s.dof) this.game.renderer.setDof(true, 5, s.dof.range ?? 2.5, s.dof.bokeh ?? 3);
    else this.game.renderer.setDof(false);
  }

  private finish(skipped: boolean) {
    if (!this.playing) return;
    // fire remaining events so game state stays consistent when skipping
    if (skipped) {
      for (let i = Math.max(0, this.idx); i < this.shots.length; i++) {
        const s = this.shots[i];
        if (i > this.idx) s.onStart?.();
        for (const [k, e] of (s.events ?? []).entries()) if (i > this.idx || !this.fired.has(k)) e.fn();
      }
    }
    this.playing = false;
    time.cineScale = 1;
    this.game.tickers.delete(this.tick);
    this.ui.setTitle(null);
    this.ui.setSubtitle(null);
    this.ui.showSkip(false);
    this.game.renderer.setLetterbox(false);
    this.game.renderer.setDof(false);
    if (this.opts.restore !== false) {
      this.game.cinematicActive = false;
      this.game.cam.mode = this.game.player ? 'follow' : 'orbit';
      this.game.cam.blendFromCurrent(this.opts.returnBlend ?? 0.45);
      if (this.opts.hideHud && this.game.player) this.game.hud.show(true);
    }
    const r = this.resolveEnd;
    this.resolveEnd = null;
    r?.();
  }

  update(realDt: number) {
    if (!this.playing) return;
    const s = this.shots[this.idx];
    if (!s) return;
    // skip input
    if (this.opts.skippable) {
      const inp = this.game.input;
      if (inp.isDown('dodge') || inp.isDown('confirm')) {
        this.skipHold += realDt;
        if (this.skipHold > 0.45) {
          this.finish(true);
          return;
        }
      } else this.skipHold = 0;
    }
    this.t += realDt;
    const k = Math.min(1, this.t / s.dur);
    const e = Ease[s.ease ?? 'inOutSine'](k);
    (s.events ?? []).forEach((ev, i) => {
      if (!this.fired.has(i) && this.t >= ev.t) {
        this.fired.add(i);
        ev.fn();
      }
    });
    const cam = this.game.world.camera;
    // position
    if (s.orbit) {
      const c = resolve(s.orbit.center, _a);
      const ang = s.orbit.from + (s.orbit.to - s.orbit.from) * e;
      const rad = s.orbit.radius + ((s.orbit.radius2 ?? s.orbit.radius) - s.orbit.radius) * e;
      cam.position.set(c.x + Math.sin(ang) * rad, c.y + s.orbit.height, c.z + Math.cos(ang) * rad);
    } else if (s.pos) {
      resolve(s.pos, cam.position);
      if (s.pos2) cam.position.lerp(resolve(s.pos2, _a), e);
    }
    const look = resolve(s.look, _b);
    if (s.look2) look.lerp(resolve(s.look2, _a), e);
    cam.lookAt(look);
    if (s.roll) cam.rotateZ(s.roll * (1 - e * 0.3));
    if (s.shake) {
      const t = time.realTime;
      cam.rotateX(noise1(t * 20, 1) * s.shake * 0.02);
      cam.rotateY(noise1(t * 20, 2) * s.shake * 0.02);
    }
    const fov = s.fov ?? 55;
    cam.fov = fov + ((s.fov2 ?? fov) - fov) * e;
    // blend-in from previous pose
    if (s.blend && this.t < s.blend) {
      const bk = Ease.inOutSine(this.t / s.blend);
      cam.position.lerpVectors(this.blendFrom.pos, cam.position, bk);
      cam.quaternion.slerpQuaternions(this.blendFrom.quat, cam.quaternion, bk);
      cam.fov = this.blendFrom.fov + (cam.fov - this.blendFrom.fov) * bk;
    }
    cam.updateProjectionMatrix();
    if (s.dof) {
      const d = cam.position.distanceTo(look);
      this.game.renderer.setDof(true, d, s.dof.range ?? 2.5, s.dof.bokeh ?? 3);
    }
    if (k >= 1 || (s.until && s.until())) this.next();
  }
}
