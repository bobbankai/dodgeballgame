import { audio } from '../audio/Audio';
import type { Input } from './Input';

/** True on phones and tablets (a touch screen as the main pointer). */
export const isTouchDevice = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

/**
 * On-screen controls for phones: a floating stick on the left half of the screen, drag anywhere on
 * the right half to look around, and buttons for jump, interact (hold it to ink things in) and
 * pause. They feed the same Input the keyboard does, so nothing else in the game knows about touch.
 */
export class TouchControls {
  private root = document.createElement('div');
  private base = document.createElement('div');
  private knob = document.createElement('div');
  private stick: { id: number; x: number; y: number } | null = null;
  private look: { id: number; x: number; y: number } | null = null;
  private static readonly R = 56;

  constructor(private input: Input) {
    const css = document.createElement('style');
    css.textContent = `
      .tc { position: fixed; inset: 0; z-index: 5; touch-action: none; user-select: none; -webkit-user-select: none; pointer-events: none; }
      .tc .zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; }
      .tc .l { left: 0; width: 45%; } .tc .r { right: 0; width: 55%; }
      .tc .base { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%;
        border: 2px solid rgba(42,36,40,.45); background: rgba(240,230,210,.28); display: none; }
      .tc .knob { position: absolute; width: 52px; height: 52px; left: 30px; top: 30px; border-radius: 50%;
        background: rgba(240,230,210,.8); border: 2px solid rgba(42,36,40,.6); }
      .tc .btn { position: absolute; width: 74px; height: 74px; border-radius: 50%; pointer-events: auto;
        border: 2px solid rgba(42,36,40,.55); background: rgba(240,230,210,.55); color: #2a2428;
        font: 700 20px 'Patrick Hand', sans-serif; display: flex; align-items: center; justify-content: center; }
      .tc .btn.on { background: rgba(240,200,120,.9); }
      .tc .pause { right: 14px; top: 14px; width: 44px; height: 44px; font-size: 16px; }
      .tc .jump { right: 22px; bottom: 120px; } .tc .act { right: 110px; bottom: 36px; }
      .tc .hint { position: absolute; left: 0; right: 0; bottom: 8px; text-align: center; pointer-events: none;
        font: 14px 'Patrick Hand', sans-serif; color: rgba(42,36,40,.7); }
    `;
    document.head.appendChild(css);
    this.root.className = 'tc';
    const left = this.zone('l'), right = this.zone('r');
    this.base.className = 'base';
    this.knob.className = 'knob';
    this.base.appendChild(this.knob);
    left.appendChild(this.base);
    this.root.append(left, right);
    this.button('jump', 'Jump', 'Space');
    this.button('act', 'Ink', 'KeyE');
    this.button('pause', 'II', 'Escape');
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'left: move · right: look · Ink: hold near glowing lines';
    this.root.appendChild(hint);
    setTimeout(() => hint.remove(), 9000);
    document.body.appendChild(this.root);
    document.body.classList.add('touch');
    // landscape works best: ask for it where the browser allows
    // (older iPhone Safari has no screen.orientation at all, and none can lock it: never let this throw)
    try {
      const o = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      o?.lock?.('landscape')?.catch?.(() => {});
    } catch {
      // not supported: portrait still works
    }

    left.addEventListener('pointerdown', (e) => {
      if (this.stick) return;
      left.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
    });
    left.addEventListener('pointermove', (e) => {
      const s = this.stick;
      if (!s || e.pointerId !== s.id) return;
      const R = TouchControls.R;
      let dx = e.clientX - s.x, dy = e.clientY - s.y;
      const m = Math.hypot(dx, dy);
      if (m > R) {
        dx = (dx / m) * R;
        dy = (dy / m) * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // up on screen = forward
      input.touchMove.set(dx / R, -dy / R);
    });
    const endStick = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null;
      input.touchMove.set(0, 0);
      this.knob.style.transform = '';
      this.base.style.display = 'none';
    };
    left.addEventListener('pointerup', endStick);
    left.addEventListener('pointercancel', endStick);

    right.addEventListener('pointerdown', (e) => {
      if (this.look) return;
      right.setPointerCapture(e.pointerId);
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      input.device = 'touch';
    });
    right.addEventListener('pointermove', (e) => {
      const l = this.look;
      if (!l || e.pointerId !== l.id) return;
      input.touchLook.x += (e.clientX - l.x) * 1.5;
      input.touchLook.y += (e.clientY - l.y) * 1.5;
      l.x = e.clientX;
      l.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => {
      if (this.look && e.pointerId === this.look.id) this.look = null;
    };
    right.addEventListener('pointerup', endLook);
    right.addEventListener('pointercancel', endLook);
    // sound can only start from a touch
    window.addEventListener('pointerdown', () => audio.unlock());
    // stop the page scrolling, zooming or selecting under the fingers
    for (const t of ['touchmove', 'gesturestart', 'contextmenu'] as const) {
      document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
    }
  }

  private zone(cls: string) {
    const z = document.createElement('div');
    z.className = `zone ${cls}`;
    return z;
  }

  private button(cls: string, label: string, code: string) {
    const b = document.createElement('div');
    b.className = `btn ${cls}`;
    b.textContent = label;
    const id = new Set<number>();
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      b.setPointerCapture(e.pointerId);
      id.add(e.pointerId);
      b.classList.add('on');
      this.input.touchKey(code, true);
    });
    const up = (e: PointerEvent) => {
      if (!id.delete(e.pointerId)) return;
      if (!id.size) {
        b.classList.remove('on');
        this.input.touchKey(code, false);
      }
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    this.root.appendChild(b);
  }
}
