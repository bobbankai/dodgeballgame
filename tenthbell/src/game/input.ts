// Keyboard, gamepad and touch folded into one set of intents.
//   move  A D / arrows / stick / the touch pad        guard  S, down, shift / RB / GUARD (hold)
//   L jab  J / X      K kick  K / A      H heavy  L / B      S special  I / Y      D dash  space / LB (or double-tap a direction)
import { Button } from './moves';

const KEYS: Record<string, Button> = { KeyJ: 'L', KeyK: 'K', KeyL: 'H', KeyI: 'S', KeyU: 'S', Space: 'D' };
const PAD: [number, Button][] = [[2, 'L'], [0, 'K'], [1, 'H'], [3, 'S'], [4, 'D']];

export class Input {
  /** -1 screen left .. +1 screen right */ axis = 0;
  block = false;
  private held = new Set<string>();
  private queue: Button[] = [];
  private confirmed = false; private paused = false;
  private padHeld = new Set<number>();
  private lastTap = { dir: 0, t: 0 };
  /** set by the touch pad */ touchAxis = 0; touchBlock = false;
  /** true once a touch has been seen: the UI shows the on-screen controls */ touch = false;
  onTouch: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      const b = KEYS[e.code];
      if (b) this.queue.push(b);
      if (e.code === 'Enter' || e.code === 'Space' || b) this.confirmed = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.paused = true;
      const dir = e.code === 'KeyA' || e.code === 'ArrowLeft' ? -1 : e.code === 'KeyD' || e.code === 'ArrowRight' ? 1 : 0;
      if (dir) this.tap(dir);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.touch) { this.touch = true; this.onTouch?.(); }
    }, true);
  }

  /** two taps of one direction inside a quarter second: dash that way */
  tap(dir: number) {
    const now = performance.now();
    if (this.lastTap.dir === dir && now - this.lastTap.t < 260) { this.queue.push('D'); this.dashDir = dir; this.lastTap.t = 0; }
    else this.lastTap = { dir, t: now };
  }
  /** direction of a double-tap dash, consumed with the press */ dashDir = 0;

  press(b: Button) { this.queue.push(b); this.confirmed = true; }
  confirm() { this.confirmed = true; }
  pause() { this.paused = true; }

  /** Read this frame's state. Presses are handed over once. */
  poll(): { axis: number; block: boolean; press: Button[]; dash: number } {
    const h = this.held;
    let axis = (h.has('KeyD') || h.has('ArrowRight') ? 1 : 0) - (h.has('KeyA') || h.has('ArrowLeft') ? 1 : 0);
    let block = h.has('KeyS') || h.has('ArrowDown') || h.has('ShiftLeft') || h.has('ShiftRight');
    for (const gp of navigator.getGamepads?.() ?? []) {
      if (!gp) continue;
      const x = Math.abs(gp.axes[0]) > 0.35 ? Math.sign(gp.axes[0]) : (gp.buttons[15]?.pressed ? 1 : 0) - (gp.buttons[14]?.pressed ? 1 : 0);
      if (x) axis = x;
      block ||= !!(gp.buttons[5]?.pressed || gp.buttons[7]?.pressed);
      for (const [i, b] of PAD) {
        const down = !!gp.buttons[i]?.pressed;
        if (down && !this.padHeld.has(i)) { this.queue.push(b); this.confirmed = true; }
        down ? this.padHeld.add(i) : this.padHeld.delete(i);
      }
      const start = !!gp.buttons[9]?.pressed;
      if (start && !this.padHeld.has(9)) this.paused = true;
      start ? this.padHeld.add(9) : this.padHeld.delete(9);
    }
    if (this.touchAxis) axis = this.touchAxis;
    block ||= this.touchBlock;
    this.axis = axis; this.block = block;
    const press = this.queue; this.queue = [];
    const dash = this.dashDir; this.dashDir = 0;
    return { axis, block, press, dash };
  }

  /** true once per confirm press (advance dialogue, menus) */
  takeConfirm() { const c = this.confirmed; this.confirmed = false; return c; }
  takePause() { const p = this.paused; this.paused = false; return p; }
  clear() { this.queue.length = 0; this.confirmed = false; this.paused = false; }
}
