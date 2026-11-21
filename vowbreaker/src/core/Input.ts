/**
 * Keyboard + gamepad, mapped to game actions. Buttons report held / pressed-this-frame /
 * released-this-frame, and keep a short buffer so a press a few frames early still counts
 * (fighting-game input buffering).
 */
export type Action =
  | 'light' | 'heavy' | 'guard' | 'dash' | 'jump' | 'tech1' | 'tech2' | 'tech3' | 'domain' | 'vow'
  | 'confirm' | 'back' | 'pause' | 'up' | 'down' | 'left' | 'right' | 'skip';

const KEYS: Record<Action, string[]> = {
  light: ['KeyJ'],
  heavy: ['KeyK'],
  guard: ['KeyL'],
  dash: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  tech1: ['KeyU'],
  tech2: ['KeyI'],
  tech3: ['KeyO'],
  domain: ['KeyP'],
  vow: ['KeyY'],
  confirm: ['Enter', 'KeyE', 'Space'],
  back: ['Escape', 'Backspace'],
  pause: ['Escape'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  skip: ['Tab'],
};

// standard gamepad mapping
const PAD: Partial<Record<Action, number[]>> = {
  light: [2], heavy: [3], guard: [5], dash: [7], jump: [0], tech1: [1], tech2: [4], tech3: [6],
  domain: [11], vow: [10], confirm: [0], back: [1], pause: [9], up: [12], down: [13], left: [14], right: [15], skip: [8],
};

const BUFFER = 0.15;

export class Input {
  private down = new Set<string>();
  private pressedKeys = new Set<string>();
  private held = new Map<Action, boolean>();
  private pressed = new Map<Action, number>();
  private released = new Set<Action>();
  private padPrev = new Map<number, boolean>();
  moveX = 0;
  moveY = 0;
  /** last few pressed actions with their age (for Black Spark timing and combos) */
  history: { action: Action; t: number }[] = [];
  time = 0;
  enabled = true;
  /** touch / UI buttons can inject presses */
  readonly virtual = new Set<Action>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!this.down.has(e.code)) this.pressedKeys.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  update(dt: number): void {
    this.time += dt;
    this.released.clear();
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p): p is Gamepad => !!p) : [];
    const pad = pads[0];
    for (const a of Object.keys(KEYS) as Action[]) {
      let h = KEYS[a].some((k) => this.down.has(k)) || this.virtual.has(a);
      let p = KEYS[a].some((k) => this.pressedKeys.has(k));
      if (pad) {
        for (const b of PAD[a] ?? []) {
          const v = !!pad.buttons[b]?.pressed;
          const prev = this.padPrev.get(b * 100 + a.length) ?? false;
          if (v) h = true;
          if (v && !prev) p = true;
          this.padPrev.set(b * 100 + a.length, v);
        }
      }
      const was = this.held.get(a) ?? false;
      if (!h && was) this.released.add(a);
      if (h && !was && this.virtual.has(a)) p = true;
      this.held.set(a, h);
      if (p) {
        this.pressed.set(a, this.time);
        this.history.push({ action: a, t: this.time });
      }
    }
    this.pressedKeys.clear();
    if (this.history.length > 16) this.history.splice(0, this.history.length - 16);
    let x = (this.held.get('right') ? 1 : 0) - (this.held.get('left') ? 1 : 0);
    let y = (this.held.get('up') ? 1 : 0) - (this.held.get('down') ? 1 : 0);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = -(pad.axes[1] ?? 0);
      if (Math.hypot(ax, ay) > 0.25) {
        x = ax;
        y = ay;
      }
    }
    const l = Math.hypot(x, y);
    this.moveX = l > 1 ? x / l : x;
    this.moveY = l > 1 ? y / l : y;
  }

  isDown(a: Action): boolean {
    return this.enabled && (this.held.get(a) ?? false);
  }

  /** Pressed within the buffer window (and not yet consumed). */
  wasPressed(a: Action, buffer = BUFFER): boolean {
    if (!this.enabled) return false;
    const t = this.pressed.get(a);
    return t !== undefined && this.time - t <= buffer;
  }

  consume(a: Action): void {
    this.pressed.delete(a);
  }

  wasReleased(a: Action): boolean {
    return this.enabled && this.released.has(a);
  }

  /** Press anything that advances dialogue / menus. */
  anyConfirm(): boolean {
    const p = this.wasPressed('confirm', 0.05) || this.wasPressed('light', 0.05);
    if (p) {
      this.consume('confirm');
      this.consume('light');
    }
    return p;
  }

  clear(): void {
    this.pressed.clear();
    this.history = [];
  }
}
