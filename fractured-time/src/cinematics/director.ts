import * as THREE from 'three/webgpu';
import type { Game } from '@/game';

/**
 * The director: in-engine cinematics on game time (deterministic in tests, frozen by pause).
 *   await dir.begin()                         letterbox in, gameplay HUD out, Ethan's input locked
 *   await dir.rail(keys, seconds, opts)       camera along a Catmull-Rom path of positions (and of look targets), eased
 *   await dir.hold(seconds)                   keep the current framing
 *   dir.focus(point | null)                   depth-of-field focus pull to a point (or back to gameplay)
 *   await dir.fade(1, 0.8) / fade(0, 0.8)     to / from black
 *   await dir.title('Chapter One', 'The Incident', 3.5)
 *   await dir.end(blend)                      camera eases back behind Ethan, letterbox out, control returns
 * Lines of dialogue run alongside with ChapterRuntime.say (subtitles move up above the letterbox).
 */
export interface Key { pos: THREE.Vector3; target: THREE.Vector3; fov?: number }

const ease = (t: number) => t * t * (3 - 2 * t);

export class Director {
  private top = document.createElement('div');
  private bottom = document.createElement('div');
  private fadeEl = document.createElement('div');
  private titleEl = document.createElement('div');
  private shot = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50 };
  active = false;

  constructor(private g: Game) {
    this.top.className = 'cine-bar top';
    this.bottom.className = 'cine-bar bottom';
    this.fadeEl.className = 'cine-fade';
    this.titleEl.className = 'cine-title';
    document.body.append(this.top, this.bottom, this.fadeEl, this.titleEl);
  }

  /** Run `f(t01)` every tick for `seconds` of game time. */
  private run(seconds: number, f: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      let t = 0;
      const tick = (dt: number) => {
        t += dt;
        const k = Math.min(1, t / Math.max(1e-3, seconds));
        f(k);
        if (k >= 1) { this.g.tickers.delete(tick); resolve(); }
      };
      this.g.tickers.add(tick);
      f(0);
    });
  }

  async begin(): Promise<void> {
    this.active = true;
    this.g.player.locked = true;
    document.body.classList.add('cine');
    document.querySelector('.hud')?.classList.add('cine');
    const c = this.g.camera.camera;
    this.shot.position.copy(c.position);
    this.shot.target.copy(c.position).add(c.getWorldDirection(new THREE.Vector3()).multiplyScalar(5));
    this.shot.fov = c.fov;
  }

  async end(blend = 1.2): Promise<void> {
    this.g.camera.cinematic(null);
    this.g.camera.reset(this.g.player.yaw, this.g.player.pos);
    this.focus(null);
    document.body.classList.remove('cine');
    document.querySelector('.hud')?.classList.remove('cine');
    this.g.player.locked = false;
    this.active = false;
    await this.g.wait(Math.min(blend, 0.3));
  }

  /** Cut (blend = 0) or blend to a fixed framing. */
  cut(k: Key, blend = 0): void {
    this.shot.position.copy(k.pos);
    this.shot.target.copy(k.target);
    this.shot.fov = k.fov ?? this.shot.fov;
    this.g.camera.cinematic(this.shot, blend);
  }

  /** Move the camera through `keys` over `seconds` (ease in/out over the whole move). Targets interpolate on their own path. */
  rail(keys: Key[], seconds: number, opts: { linear?: boolean; focusOn?: () => THREE.Vector3 } = {}): Promise<void> {
    const P = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
    const Tg = new THREE.CatmullRomCurve3(keys.length > 1 ? keys.map((k) => k.target) : [keys[0].target, keys[0].target], false, 'centripetal');
    const fovs = keys.map((k) => k.fov ?? 50);
    this.g.camera.cinematic(this.shot, 0);
    return this.run(seconds, (t) => {
      const u = opts.linear ? t : ease(t);
      P.getPoint(u, this.shot.position);
      Tg.getPoint(u, this.shot.target);
      const f = u * (fovs.length - 1);
      const i = Math.min(fovs.length - 2, Math.floor(f));
      this.shot.fov = fovs.length > 1 ? THREE.MathUtils.lerp(fovs[i], fovs[i + 1], f - i) : fovs[0];
      if (opts.focusOn) this.g.focusOverride = this.shot.position.distanceTo(opts.focusOn());
    });
  }

  hold(seconds: number): Promise<void> { return this.g.wait(seconds); }

  focus(at: THREE.Vector3 | null): void {
    this.g.focusOverride = at ? this.shot.position.distanceTo(at) : null;
  }

  fade(to: 0 | 1, seconds: number): Promise<void> {
    const from = Number(this.fadeEl.style.opacity || 0);
    return this.run(seconds, (t) => { this.fadeEl.style.opacity = String(THREE.MathUtils.lerp(from, to, ease(t))); });
  }

  async title(text: string, sub: string, seconds: number): Promise<void> {
    this.titleEl.innerHTML = `<div class="t">${text}</div><div class="s">${sub}</div>`;
    await this.run(0.8, (t) => { this.titleEl.style.opacity = String(ease(t)); });
    await this.g.wait(Math.max(0, seconds - 1.6));
    await this.run(0.8, (t) => { this.titleEl.style.opacity = String(1 - ease(t)); });
  }
}
