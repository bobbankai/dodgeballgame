// Unified input: keyboard + mouse (pointer lock), gamepad (standard mapping) and the touch layer all
// write the same actions. Presses are buffered briefly so combat inputs made during a swing are kept.
import * as THREE from 'three';

export type Button = 'attack' | 'heavy' | 'dodge' | 'block' | 'art' | 'lock' | 'interact' | 'heal' | 'sprint' | 'pause' | 'skip' | 'art1' | 'art2' | 'art3';

const KEYMAP: Record<string, Button> = {
  Space: 'dodge', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyQ: 'lock', KeyE: 'interact', KeyF: 'heal', KeyR: 'art',
  Digit1: 'art1', Digit2: 'art2', Digit3: 'art3', Escape: 'pause', KeyP: 'pause', Enter: 'skip', KeyJ: 'attack', KeyK: 'heavy', KeyL: 'block',
  ControlLeft: 'block',
};

export class Input {
  readonly move = new THREE.Vector2();
  readonly look = new THREE.Vector2();
  private held = new Set<Button>();
  private pressedAt = new Map<Button, number>();
  private releasedAt = new Map<Button, number>();
  private keys = new Set<string>();
  private time = 0;
  /** touch layer writes here */
  readonly touchMove = new THREE.Vector2();
  readonly touchLook = new THREE.Vector2();
  touchHeld = new Set<Button>();
  private prevTouchHeld = new Set<Button>();
  private padPrev = new Set<Button>();
  mouseSensitivity = 0.0022;
  invertY = false;
  lastDevice: 'kbm' | 'pad' | 'touch' = 'kbm';
  enabled = true;

  constructor(canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = KEYMAP[e.code];
      if (b) this.press(b);
      this.lastDevice = 'kbm';
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const b = KEYMAP[e.code];
      if (b) this.release(b);
    });
    window.addEventListener('blur', () => { this.keys.clear(); for (const b of [...this.held]) this.release(b); });
    canvas.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas && !('ontouchstart' in window)) { canvas.requestPointerLock?.(); }
      if (e.button === 0) this.press('attack');
      if (e.button === 2) this.press('block');
      if (e.button === 1) this.press('lock');
      this.lastDevice = 'kbm';
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.release('attack');
      if (e.button === 2) this.release('block');
      if (e.button === 1) this.release('lock');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        this.look.x += e.movementX * this.mouseSensitivity;
        this.look.y += e.movementY * this.mouseSensitivity * (this.invertY ? -1 : 1);
      }
    });
  }

  private press(b: Button): void {
    if (!this.held.has(b)) {
      this.held.add(b);
      this.pressedAt.set(b, this.time);
    }
  }

  private release(b: Button): void {
    if (this.held.has(b)) {
      this.held.delete(b);
      this.releasedAt.set(b, this.time);
    }
  }

  /** held right now */
  down(b: Button): boolean { return this.held.has(b); }

  /** pressed within the buffer window (consumes the press) */
  pressed(b: Button, buffer = 0.22): boolean {
    const t = this.pressedAt.get(b);
    if (t === undefined || this.time - t > buffer) return false;
    this.pressedAt.delete(b);
    return true;
  }

  /** peek without consuming */
  peek(b: Button, buffer = 0.22): boolean {
    const t = this.pressedAt.get(b);
    return t !== undefined && this.time - t <= buffer;
  }

  /** how long a button has been held (0 if not held) */
  heldFor(b: Button): number {
    if (!this.held.has(b)) return 0;
    return this.time - (this.pressedAt.get(b) ?? this.time);
  }

  released(b: Button, buffer = 0.1): boolean {
    const t = this.releasedAt.get(b);
    if (t === undefined || this.time - t > buffer) return false;
    this.releasedAt.delete(b);
    return true;
  }

  clear(): void {
    this.pressedAt.clear();
    this.releasedAt.clear();
  }

  update(dt: number): void {
    this.time += dt;
    // keyboard move
    const k = this.keys;
    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    // gamepad
    const pads = navigator.getGamepads?.() ?? [];
    const pad = [...pads].find((p) => p && p.connected);
    const padNow = new Set<Button>();
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
      const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0);
      const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
      if (Math.abs(lx) + Math.abs(ly) > 0) { mx = lx; my = -ly; this.lastDevice = 'pad'; }
      this.look.x += rx * dt * 2.8;
      this.look.y += ry * dt * 2.0 * (this.invertY ? -1 : 1);
      const map: [number, Button][] = [[2, 'attack'], [3, 'heavy'], [0, 'dodge'], [5, 'block'], [7, 'art'], [11, 'lock'], [1, 'interact'], [4, 'heal'], [10, 'sprint'], [9, 'pause'], [8, 'skip'], [6, 'block']];
      for (const [i, b] of map) if (pad.buttons[i]?.pressed) padNow.add(b);
      if (padNow.size) this.lastDevice = 'pad';
    }
    for (const b of padNow) if (!this.padPrev.has(b)) this.press(b);
    for (const b of this.padPrev) if (!padNow.has(b)) this.release(b);
    this.padPrev = padNow;
    // touch
    if (this.touchMove.lengthSq() > 0.0004) { mx = this.touchMove.x; my = this.touchMove.y; this.lastDevice = 'touch'; }
    this.look.x += this.touchLook.x;
    this.look.y += this.touchLook.y;
    this.touchLook.set(0, 0);
    for (const b of this.touchHeld) if (!this.prevTouchHeld.has(b)) this.press(b);
    for (const b of this.prevTouchHeld) if (!this.touchHeld.has(b)) this.release(b);
    this.prevTouchHeld = new Set(this.touchHeld);
    this.move.set(mx, my);
    if (this.move.lengthSq() > 1) this.move.normalize();
    if (!this.enabled) this.move.set(0, 0);
  }

  /** read and reset the accumulated look delta */
  takeLook(out: THREE.Vector2): THREE.Vector2 {
    out.copy(this.look);
    this.look.set(0, 0);
    return out;
  }
}
