/**
 * Unified input: keyboard + mouse (pointer lock), gamepad, and on-screen touch controls all feed the same named actions.
 * Press edges are timestamped so combat can buffer inputs (press slightly early and the action still fires).
 */
export type Action =
  | 'light' | 'heavy' | 'block' | 'dodge' | 'jump' | 'sprint' | 'interact' | 'lock' | 'pause'
  | 'slow' | 'rewind' | 'echo' | 'shift' | 'skip';

const KEYMAP: Record<string, Action> = {
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyE: 'interact', Tab: 'lock', KeyQ: 'block', KeyC: 'dodge',
  Escape: 'pause', Digit1: 'slow', Digit2: 'rewind', Digit3: 'echo', Digit4: 'shift', KeyJ: 'light', KeyK: 'heavy', Enter: 'skip',
};

const PAD: Record<number, Action> = { 0: 'jump', 1: 'dodge', 2: 'light', 3: 'heavy', 4: 'block', 5: 'sprint', 9: 'pause', 10: 'lock', 6: 'slow', 7: 'rewind', 12: 'echo', 13: 'shift', 8: 'skip', 14: 'interact' };

export interface Bindings { [code: string]: Action }

export class Input {
  readonly held = new Set<Action>();
  private pressedAt = new Map<Action, number>();
  private releasedAt = new Map<Action, number>();
  private consumed = new Map<Action, number>();
  private queue: Action[] = [];
  private keys = new Set<string>();
  moveX = 0;
  moveY = 0;
  lookDX = 0;
  lookDY = 0;
  sensitivity = 1;
  invertY = false;
  locked = false;
  gamepadActive = false;
  touchActive = false;
  /** simulated time source (seconds); set by the game each tick so buffering is deterministic */
  now = 0;
  private bindings: Bindings = { ...KEYMAP };
  private padPrev: boolean[] = [];
  private touchMove = { x: 0, y: 0 };
  private touchLook = { x: 0, y: 0 };

  constructor(private canvas: HTMLElement) {
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked && !this.touchActive) this.lock();
      if (e.button === 0) this.set('light', true);
      if (e.button === 2) this.set('heavy', true);
      if (e.button === 1) { this.set('lock', true); e.preventDefault(); }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.set('light', false);
      if (e.button === 2) this.set('heavy', false);
      if (e.button === 1) this.set('lock', false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.set('pause', true);
    });
  }

  lock(): void {
    try { void this.canvas.requestPointerLock?.(); } catch { /* denied */ }
  }

  rebind(code: string, action: Action): void {
    this.bindings[code] = action;
  }

  getBindings(): Bindings {
    return { ...this.bindings };
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (e.repeat) return;
    this.keys[down ? 'add' : 'delete'](e.code);
    const a = this.bindings[e.code];
    if (a) {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      this.set(a, down || this.stillHeld(a));
      if (!down && this.stillHeld(a)) this.held.add(a);
    }
  }

  private stillHeld(a: Action): boolean {
    for (const k of this.keys) if (this.bindings[k] === a) return true;
    return false;
  }

  private releaseAll(): void {
    this.keys.clear();
    for (const a of [...this.held]) this.set(a, false);
  }

  /** Programmatic input for tests, cutscenes, and the touch UI. */
  set(a: Action, down: boolean): void {
    const was = this.held.has(a);
    if (down && !was) {
      this.held.add(a);
      this.queue.push(a);
      this.pressedAt.set(a, this.now);
      this.consumed.delete(a);
    } else if (!down && was) {
      this.held.delete(a);
      this.releasedAt.set(a, this.now);
    }
  }

  setTouchAxes(move: { x: number; y: number }, look: { x: number; y: number }): void {
    this.touchActive = true;
    this.touchMove = move;
    this.touchLook = look;
  }

  /** Poll gamepad and compose movement axes. Call once per tick. */
  poll(dt: number): void {
    let x = 0, y = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    let lx = 0, ly = 0;
    const pads = navigator.getGamepads?.() ?? [];
    const gp = pads.find((p) => p && p.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : v);
      const gx = dz(gp.axes[0] ?? 0), gy = dz(gp.axes[1] ?? 0);
      if (gx || gy) { x = gx; y = -gy; this.gamepadActive = true; }
      lx = dz(gp.axes[2] ?? 0) * 900 * dt;
      ly = dz(gp.axes[3] ?? 0) * 700 * dt;
      gp.buttons.forEach((b, i) => {
        const a = PAD[i];
        if (!a) return;
        if (b.pressed !== !!this.padPrev[i]) this.set(a, b.pressed);
        this.padPrev[i] = b.pressed;
      });
    }
    if (this.touchActive) { x += this.touchMove.x; y += this.touchMove.y; lx += this.touchLook.x * dt * 400; ly += this.touchLook.y * dt * 400; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    this.moveX = x;
    this.moveY = y;
    this.lookDX += lx;
    this.lookDY += ly;
  }

  /** Mouse/stick look accumulated since last call (then cleared). */
  takeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookDX * this.sensitivity, dy: this.lookDY * this.sensitivity * (this.invertY ? -1 : 1) };
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  /** Actions pressed since the last call (edge events; robust to multiple ticks per frame). */
  takePressed(): Action[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  isHeld(a: Action): boolean {
    return this.held.has(a);
  }

  /** True for the tick after a press (not yet consumed). */
  justPressed(a: Action): boolean {
    const t = this.pressedAt.get(a);
    return t !== undefined && this.consumed.get(a) !== t && this.now - t < 1 / 60 + 1e-6;
  }

  /** True if pressed within `window` seconds and not consumed. Consuming prevents double-fires. */
  buffered(a: Action, window = 0.18): boolean {
    const t = this.pressedAt.get(a);
    return t !== undefined && this.consumed.get(a) !== t && this.now - t <= window;
  }

  consume(a: Action): void {
    const t = this.pressedAt.get(a);
    if (t !== undefined) this.consumed.set(a, t);
  }

  /** Seconds since the last press of an action (Infinity if never). */
  sincePress(a: Action): number {
    const t = this.pressedAt.get(a);
    return t === undefined ? Infinity : this.now - t;
  }

  sinceRelease(a: Action): number {
    const t = this.releasedAt.get(a);
    return t === undefined ? Infinity : this.now - t;
  }
}
