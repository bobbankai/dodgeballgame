import * as THREE from 'three';

export type Action = 'jump' | 'interact' | 'walk' | 'pause' | 'skip';

const KEYS: Record<Action, string[]> = {
  jump: ['Space'],
  interact: ['KeyE', 'Enter'],
  walk: ['ShiftLeft', 'ShiftRight'],
  pause: ['Escape', 'KeyP'],
  skip: ['Space', 'Enter', 'KeyE'],
};
// standard gamepad mapping
const PAD: Record<Action, number[]> = { jump: [0], interact: [2, 1], walk: [6], pause: [9], skip: [0, 2] };

/** Keyboard + mouse + gamepad, read once per frame. */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padDown = new Set<number>();
  private padPressed = new Set<number>();
  private look = new THREE.Vector2();
  private wheel = 0;
  locked = false;
  /** Last device used, for showing the right button prompts. */
  device: 'keyboard' | 'gamepad' = 'keyboard';

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.device = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      if (this.locked) this.look.add(new THREE.Vector2(e.movementX, e.movementY));
    });
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    document.addEventListener('pointerlockchange', () => (this.locked = document.pointerLockElement === canvas));
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock?.()?.catch?.(() => {});
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  private pad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }

  /** Called at the start of a frame. */
  poll() {
    const p = this.pad();
    this.padPressed.clear();
    if (!p) return;
    p.buttons.forEach((b, i) => {
      if (b.pressed && !this.padDown.has(i)) {
        this.padPressed.add(i);
        this.device = 'gamepad';
      }
      if (b.pressed) this.padDown.add(i);
      else this.padDown.delete(i);
    });
    if (Math.hypot(p.axes[0] ?? 0, p.axes[1] ?? 0) > 0.3) this.device = 'gamepad';
  }

  /** Called at the end of a frame. */
  endFrame() {
    this.pressed.clear();
    this.look.set(0, 0);
    this.wheel = 0;
  }

  down(a: Action) {
    return KEYS[a].some((k) => this.keys.has(k)) || PAD[a].some((b) => this.padDown.has(b));
  }

  justPressed(a: Action) {
    return KEYS[a].some((k) => this.pressed.has(k)) || PAD[a].some((b) => this.padPressed.has(b));
  }

  /** Movement intent: x = right, y = forward, length 0..1. */
  move(out = new THREE.Vector2()) {
    out.set(0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) out.y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) out.y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) out.x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) out.x -= 1;
    if (out.lengthSq() > 1) out.normalize();
    const p = this.pad();
    if (p) {
      const x = p.axes[0] ?? 0, y = -(p.axes[1] ?? 0);
      const m = Math.hypot(x, y);
      if (m > 0.18) {
        const k = Math.min(1, (m - 0.18) / 0.77) / m;
        out.set(x * k, y * k);
      }
    }
    return out;
  }

  /** Camera look delta in radians-ish units (mouse pixels scaled, stick per second). */
  lookDelta(dt: number, out = new THREE.Vector2()) {
    out.copy(this.look).multiplyScalar(0.0024);
    const p = this.pad();
    if (p) {
      const x = p.axes[2] ?? 0, y = p.axes[3] ?? 0;
      if (Math.abs(x) > 0.15) out.x += Math.sign(x) * (Math.abs(x) - 0.15) * 3.2 * dt;
      if (Math.abs(y) > 0.15) out.y += Math.sign(y) * (Math.abs(y) - 0.15) * 2.0 * dt;
    }
    return out;
  }

  zoom() {
    return this.wheel;
  }
}
