// Keyboard, mouse and gamepad -> actions. Presses are buffered so a combo input made slightly early
// still counts (fighting-game style input buffer).
export type Action =
  | 'light' | 'heavy' | 'jump' | 'dodge' | 'guard' | 'special1' | 'special2' | 'assist' | 'super' | 'lock'
  | 'interact' | 'pause' | 'confirm' | 'skip';

const KEYS: Record<string, Action[]> = {
  KeyJ: ['light'], KeyK: ['heavy'], Space: ['jump', 'confirm'], ShiftLeft: ['dodge'], ShiftRight: ['dodge'],
  KeyQ: ['guard'], KeyE: ['special1', 'interact'], KeyR: ['special2'], KeyC: ['assist'], KeyF: ['super'], Tab: ['lock'],
  Escape: ['pause'], Enter: ['confirm'], KeyL: ['lock'], Backspace: ['skip'],
};

export class Input {
  move = { x: 0, y: 0 };          // x right, y forward (-1..1)
  look = { x: 0, y: 0 };          // accumulated mouse / stick look this frame (radians-ish)
  held = new Set<Action>();
  private keys = new Set<string>();
  private pressedAt = new Map<Action, number>();
  private time = 0;
  enabled = true;
  pointerLocked = false;
  sensitivity = 0.0026;
  private padPrev = new Set<number>();
  usedGamepad = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      for (const a of KEYS[e.code] ?? []) this.press(a);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      for (const a of KEYS[e.code] ?? []) this.held.delete(a);
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.pointerLocked && !(window as any).__testMode) canvas.requestPointerLock?.();
      if (e.button === 0) this.press('light');
      if (e.button === 2) this.press('heavy');
      if (e.button === 1) this.press('lock');
    });
    canvas.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.held.delete('light');
      if (e.button === 2) this.held.delete('heavy');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === canvas; });
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.look.x += e.movementX * this.sensitivity;
      this.look.y += e.movementY * this.sensitivity;
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.held.clear(); });
  }

  press(a: Action): void {
    this.held.add(a);
    this.pressedAt.set(a, this.time);
  }

  /** True once if `a` was pressed within the buffer window. */
  consume(a: Action, buffer = 0.22): boolean {
    const t = this.pressedAt.get(a);
    if (t === undefined || this.time - t > buffer) return false;
    this.pressedAt.delete(a);
    return true;
  }

  peek(a: Action, buffer = 0.22): boolean {
    const t = this.pressedAt.get(a);
    return t !== undefined && this.time - t <= buffer;
  }

  isHeld(a: Action): boolean { return this.held.has(a); }

  clearBuffer(): void { this.pressedAt.clear(); }

  /** Call once per fixed step before reading. */
  update(dt: number): void {
    this.time += dt;
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    // gamepad
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find((p) => p && p.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0);
      if (lx || ly) { x = lx; y = -ly; this.usedGamepad = true; }
      const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      this.look.x += rx * dt * 2.6;
      this.look.y += ry * dt * 1.8;
      const map: [number, Action][] = [[2, 'light'], [3, 'heavy'], [0, 'jump'], [0, 'confirm'], [1, 'dodge'], [4, 'guard'], [5, 'special1'], [7, 'special2'], [6, 'assist'], [11, 'lock'], [9, 'pause'], [8, 'skip']];
      const now = new Set<number>();
      gp.buttons.forEach((b, i) => { if (b.pressed) now.add(i); });
      for (const [i, a] of map) {
        if (now.has(i) && !this.padPrev.has(i)) { this.press(a); this.usedGamepad = true; }
        if (!now.has(i) && this.padPrev.has(i)) this.held.delete(a);
      }
      if (now.has(10) && now.has(11) && !(this.padPrev.has(10) && this.padPrev.has(11))) this.press('super');
      this.padPrev = now;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.move.x = this.enabled ? x : 0;
    this.move.y = this.enabled ? y : 0;
  }

  /** Read and reset the look delta. */
  takeLook(): { x: number; y: number } {
    const l = { x: this.look.x, y: this.look.y };
    this.look.x = 0;
    this.look.y = 0;
    return l;
  }
}
