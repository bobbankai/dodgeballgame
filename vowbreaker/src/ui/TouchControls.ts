import { el, uiState } from './UI';
import type { Action, Input } from '../core/Input';
import { device, loadPrefs } from '../core/Device';
import type { Fighter } from '../game/Fighter';

export type TouchScene = 'none' | 'fight' | 'cutscene';

interface Btn {
  id: string;
  action: Action;
  label: string;
  sub?: string;
  /** centre, in button-widths from the screen's right / bottom edge, and size in button-widths */
  x: number;
  y: number;
  s: number;
  cls: string;
  /** centred on the screen (x is an offset from the middle, in button-widths) */
  mid?: boolean;
}

/**
 * Right thumb: Light is the big button, the rest fan out round it in an arc (heavy beside it, jump
 * above, dash and guard further out, the three techniques along the outer rim). The domain and the
 * vow sit at the bottom middle, shown only when they can be used.
 */
const BUTTONS: Btn[] = [
  { id: 'light', action: 'light', label: 'Light', x: 1.0, y: 1.0, s: 1.4, cls: 'main' },
  { id: 'heavy', action: 'heavy', label: 'Heavy', x: 2.4, y: 0.65, s: 1.05, cls: 'heavy' },
  { id: 'dash', action: 'dash', label: 'Dash', x: 2.2, y: 1.95, s: 0.95, cls: 'move' },
  { id: 'jump', action: 'jump', label: 'Jump', x: 0.8, y: 2.4, s: 0.95, cls: 'move' },
  { id: 'guard', action: 'guard', label: 'Guard', x: 3.65, y: 1.35, s: 1.05, cls: 'guard' },
  { id: 'tech1', action: 'tech1', label: '1', x: 3.7, y: 2.65, s: 0.95, cls: 'abl' },
  { id: 'tech2', action: 'tech2', label: '2', x: 2.6, y: 3.1, s: 0.95, cls: 'abl' },
  { id: 'tech3', action: 'tech3', label: '3', x: 1.5, y: 3.5, s: 0.95, cls: 'abl' },
  { id: 'domain', action: 'domain', label: '領', sub: 'Domain', x: -0.62, y: 0.72, s: 0.95, cls: 'special domain', mid: true },
  { id: 'vow', action: 'vow', label: '誓', sub: 'Vow', x: 0.62, y: 0.72, s: 0.95, cls: 'special vow', mid: true },
];

const buzz = (ms = 9): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
};

/**
 * The on-screen controls: a floating stick on the left, action buttons on the right, tap anywhere
 * to advance a cutscene, and pause / skip buttons. Everything feeds Input (press / release /
 * touchX / touchY), so the game doesn't know the difference between a finger and a key.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private buttons = new Map<string, HTMLElement>();
  private techKey = '';
  private zone: HTMLElement;
  private base: HTMLElement;
  private knob: HTMLElement;
  private skipBtn: HTMLElement;
  private advance: HTMLElement;
  private stickId: number | null = null;
  private ox = 0;
  private oy = 0;
  private radius = 60;
  private skipArmed = 0;
  private shown = false;
  private scene: TouchScene = 'none';
  private wake: { release(): Promise<void> } | null = null;

  constructor(parent: HTMLElement, private input: Input) {
    const d = device();
    if (d.coarse || d.forceTouch) input.device = 'touch';
    uiState.touch = this.enabled;
    document.body.classList.toggle('touch-ui', uiState.touch);

    this.root = el('div', 'touch hidden');
    // cutscenes: a tap anywhere moves the dialogue on
    this.advance = el('div', 'tc-advance');
    this.advance.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.press('confirm');
    });
    // fights: the floating stick (its zone is the left of the screen)
    this.zone = el('div', 'tc-zone');
    this.base = el('div', 'tc-base idle');
    this.knob = el('div', 'tc-knob');
    this.base.append(this.knob);
    this.bindStick();
    this.root.append(this.advance, this.zone, this.base);

    for (const b of BUTTONS) {
      const e = el('button', `tc-btn ${b.cls}`, `<span class="g">${b.label}</span>${b.sub ? `<i>${b.sub}</i>` : '<i></i>'}`);
      e.style.setProperty('--x', String(b.x));
      e.style.setProperty('--y', String(b.y));
      e.style.setProperty('--s', String(b.s));
      if (b.mid) e.classList.add('mid');
      e.setAttribute('type', 'button');
      this.bindButton(e, b.action);
      this.buttons.set(b.id, e);
      this.root.append(e);
    }

    const pause = el('button', 'tc-pause', '<span></span><span></span>');
    pause.setAttribute('type', 'button');
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.input.press('pause');
      buzz(12);
    });
    this.skipBtn = el('button', 'tc-skip', 'Skip');
    this.skipBtn.setAttribute('type', 'button');
    this.skipBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // one tap arms it, the second within two seconds skips (so a stray tap can't lose a scene)
      if (this.skipArmed > 0) {
        this.skipArmed = 0;
        this.skipBtn.textContent = 'Skip';
        this.input.press('skip');
      } else {
        this.skipArmed = 2;
        this.skipBtn.textContent = 'Skip?';
      }
    });
    this.root.append(pause, this.skipBtn);
    parent.append(this.root);
    parent.append(el('div', 'rotate-hint', '<div class="phone"></div><div>Turn your phone sideways to play</div>'));

    // the page itself: no zoom, no selection, no context menu, a finger seen on a hybrid device
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.input.device = 'touch';
    }, true);
    // fullscreen, landscape and a wake lock want a user gesture: the first finger lifted
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') this.firstGesture();
    }, { once: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wake === null && this.gestured) void this.keepAwake();
    });
  }

  private gestured = false;

  /** Show the controls: forced on or off by ?touch=, otherwise whenever a finger is the player's input. */
  get enabled(): boolean {
    const d = device();
    if (d.forceTouch !== null) return d.forceTouch;
    return this.input.device === 'touch';
  }

  /** A short phone held upright: the game wants landscape. */
  get portrait(): boolean {
    return window.innerHeight > window.innerWidth * 1.05;
  }

  // --- the stick -----------------------------------------------------------------------------------------

  private bindStick(): void {
    const z = this.zone;
    z.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      z.setPointerCapture(e.pointerId);
      const b = this.btnSize();
      this.radius = b * 0.95;
      const r = z.getBoundingClientRect();
      // the stick appears under the thumb (kept clear of the screen's edge)
      this.ox = Math.max(r.left + b * 1.2, Math.min(r.right - b * 0.6, e.clientX));
      this.oy = Math.max(r.top + b * 1.2, Math.min(r.bottom - b * 1.0, e.clientY));
      this.base.classList.remove('idle');
      this.base.style.left = this.ox + 'px';
      this.base.style.top = this.oy + 'px';
      this.knob.style.transform = 'translate(0, 0)';
      this.drag(e);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.drag(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.input.touchX = 0;
      this.input.touchY = 0;
      this.base.classList.add('idle');
      this.base.style.left = '';
      this.base.style.top = '';
      this.knob.style.transform = 'translate(0, 0)';
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }

  private drag(e: PointerEvent): void {
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const len = Math.hypot(dx, dy);
    const R = this.radius;
    if (len > R) {
      // a floating stick: the base follows the thumb, so the stick never runs out of travel
      const k = (len - R) / len;
      this.ox += dx * k;
      this.oy += dy * k;
      this.base.style.left = this.ox + 'px';
      this.base.style.top = this.oy + 'px';
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    let x = dx / R;
    let y = -dy / R;
    // a dead zone, then a curve so small pushes are fine steps and the edge is a full run
    const m = Math.hypot(x, y);
    const dead = 0.14;
    if (m < dead) {
      x = 0;
      y = 0;
    } else {
      const k = Math.min(1, (m - dead) / (1 - dead)) / m;
      x *= k;
      y *= k;
    }
    this.input.touchX = x;
    this.input.touchY = y;
  }

  // --- buttons -------------------------------------------------------------------------------------------

  private bindButton(e: HTMLElement, a: Action): void {
    e.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      e.setPointerCapture(ev.pointerId);
      this.input.press(a, true);
      e.classList.add('down');
      buzz();
    });
    const up = (): void => {
      this.input.release(a);
      e.classList.remove('down');
    };
    e.addEventListener('pointerup', up);
    e.addEventListener('pointercancel', up);
    e.addEventListener('lostpointercapture', up);
  }

  private btnSize(): number {
    return Math.min(70, Math.max(46, window.innerHeight * 0.14));
  }

  // --- per-frame -----------------------------------------------------------------------------------------

  /** Show the controls that fit the moment, and label them for the fighter in play. */
  sync(dt: number, scene: TouchScene, f: Fighter | null): void {
    const on = this.enabled;
    if (on !== uiState.touch) {
      uiState.touch = on;
      document.body.classList.toggle('touch-ui', on);
    }
    const show = on && scene !== 'none';
    if (show !== this.shown) {
      this.shown = show;
      this.root.classList.toggle('hidden', !show);
      if (!show) this.releaseAll();
    }
    if (this.skipArmed > 0) {
      this.skipArmed -= dt;
      if (this.skipArmed <= 0) this.skipBtn.textContent = 'Skip';
    }
    if (!show) return;
    if (scene !== this.scene) {
      this.scene = scene;
      this.root.classList.toggle('fight', scene === 'fight');
      this.root.classList.toggle('cutscene', scene === 'cutscene');
      if (scene !== 'fight') this.releaseAll();
    }
    if (scene !== 'fight' || !f) return;
    // technique names and costs for this fighter
    const key = f.kit.techs.join(',');
    if (key !== this.techKey) {
      this.techKey = key;
      ['tech1', 'tech2', 'tech3'].forEach((id, i) => {
        const m = f.kit.moves[f.kit.techs[i]];
        const b = this.buttons.get(id)!;
        b.classList.toggle('hidden', !m);
        if (m) {
          b.dataset.cost = String(m.cost ?? 0);
          b.querySelector('i')!.textContent = String(m.label ?? m.name);
        }
      });
    }
    for (const id of ['tech1', 'tech2', 'tech3']) {
      const b = this.buttons.get(id)!;
      b.classList.toggle('off', f.energy < +(b.dataset.cost ?? 0) && !f.domainActive);
    }
    const dom = this.buttons.get('domain')!;
    dom.classList.toggle('hidden', !f.kit.domain);
    dom.classList.toggle('ready', f.domainGauge >= 100 && !!f.kit.domain);
    dom.style.setProperty('--p', Math.min(100, f.domainGauge) + '%');
    const vow = this.buttons.get('vow')!;
    const canVow = f.vowTime > 0 || (f.hp < f.maxHp * 0.3 && !f.vowUsed);
    vow.classList.toggle('hidden', !canVow);
    vow.classList.toggle('ready', canVow && f.vowTime <= 0);
  }

  private releaseAll(): void {
    this.stickId = null;
    this.input.touchX = 0;
    this.input.touchY = 0;
    for (const b of BUTTONS) this.input.release(b.action);
    for (const e of this.buttons.values()) e.classList.remove('down');
    this.base?.classList.add('idle');
  }

  // --- fullscreen, landscape, screen awake --------------------------------------------------------------------

  private firstGesture(): void {
    this.gestured = true;
    const d = device();
    const prefs = loadPrefs();
    if (d.tier !== 'desktop' && prefs.fullscreen !== false && document.fullscreenEnabled && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o.lock?.('landscape');
      }).catch(() => {
        /* refused: the page still plays */
      });
    }
    void this.keepAwake();
  }

  private async keepAwake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } };
      if (!nav.wakeLock) return;
      const lock = await nav.wakeLock.request('screen');
      this.wake = lock;
      lock.addEventListener('release', () => {
        this.wake = null;
      });
    } catch {
      /* no wake lock here */
    }
  }
}
