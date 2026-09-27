import { clamp } from './math';

export type Action =
  | 'throw'
  | 'catch'
  | 'dodge'
  | 'sprint'
  | 'pass'
  | 'lob'
  | 'ability'
  | 'ultimate'
  | 'pause'
  | 'shoulder'
  | 'target'
  | 'confirm'
  | 'back';

const ACTIONS: Action[] = ['throw', 'catch', 'dodge', 'sprint', 'pass', 'lob', 'ability', 'ultimate', 'pause', 'shoulder', 'target', 'confirm', 'back'];

const KEY_BINDINGS: Record<string, Action[]> = {
  Space: ['dodge'],
  ShiftLeft: ['sprint'],
  ShiftRight: ['sprint'],
  KeyE: ['pass'],
  KeyC: ['lob'],
  KeyQ: ['ability'],
  KeyR: ['ultimate'],
  Escape: ['pause', 'back'],
  KeyP: ['pause'],
  KeyV: ['shoulder'],
  Tab: ['target'],
  Enter: ['confirm'],
  KeyF: ['catch'],
};

const MOUSE_BINDINGS: Record<number, Action[]> = {
  0: ['throw'],
  2: ['catch'],
  1: ['shoulder'],
};

// Standard gamepad mapping
const PAD_BINDINGS: Record<number, Action[]> = {
  0: ['dodge', 'confirm'], // A
  1: ['pass', 'back'], // B
  2: ['ability'], // X
  3: ['ultimate'], // Y
  4: ['sprint'], // LB
  5: ['target'], // RB
  6: ['catch'], // LT
  7: ['throw'], // RT
  9: ['pause'], // Start
  10: ['sprint'], // L3
  11: ['shoulder'], // R3
  12: ['lob'], // D-pad up
};

export interface InputSettings {
  mouseSensitivity: number; // 0.2 .. 3
  invertY: boolean;
  padSensitivity: number;
}

/**
 * Unified input: keyboard + mouse (pointer lock) + gamepad, exposed as named actions
 * with edge detection, press timestamps (for input buffering) and analog axes.
 */
export class Input {
  readonly moveX = { value: 0 };
  readonly moveY = { value: 0 };
  /** Look delta in radians accumulated this frame. */
  lookDX = 0;
  lookDY = 0;
  settings: InputSettings = { mouseSensitivity: 1, invertY: false, padSensitivity: 1 };

  private keys = new Set<string>();
  private mouseButtons = new Set<number>();
  private padButtons = new Set<number>();
  private down = new Map<Action, boolean>();
  private prevDown = new Map<Action, boolean>();
  private pressTime = new Map<Action, number>();
  private consumed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private now = 0;
  private padAxes = [0, 0, 0, 0];
  usingGamepad = false;
  pointerLocked = false;
  /** When false, mouse buttons do not map to gameplay actions (menus). */
  gameplayMouse = false;
  onPointerLockChange: ((locked: boolean) => void) | null = null;
  private canvas: HTMLElement;
  private virtual = new Map<Action, boolean>();
  private virtualMove = { x: 0, y: 0, active: false };

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    for (const a of ACTIONS) {
      this.down.set(a, false);
      this.prevDown.set(a, false);
      this.pressTime.set(a, -999);
    }
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseButtons.clear();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.gameplayMouse && !this.pointerLocked) this.requestLock();
      this.mouseButtons.add(e.button);
      this.usingGamepad = false;
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseButtons.delete(e.button);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.pointerLocked) {
        // Guard against the occasional huge spike some browsers emit on lock
        if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
          this.mouseDX += e.movementX;
          this.mouseDY += e.movementY;
        }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.mouseButtons.clear();
      this.onPointerLockChange?.(this.pointerLocked);
    });
  }

  requestLock() {
    if (this.pointerLocked) return;
    try {
      const p = (this.canvas as any).requestPointerLock?.({ unadjustedMovement: false });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignore — pointer lock unavailable (e.g. headless) */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Programmatic control, used by automated tests and the tutorial demo. */
  setVirtual(action: Action, pressed: boolean) {
    this.virtual.set(action, pressed);
  }

  setVirtualMove(x: number, y: number, active = true) {
    this.virtualMove.x = x;
    this.virtualMove.y = y;
    this.virtualMove.active = active;
  }

  update(realDt: number, realTime: number) {
    this.now = realTime;
    this.consumed.clear();
    for (const a of ACTIONS) this.prevDown.set(a, this.down.get(a)!);

    this.pollGamepad();

    const nextDown = new Map<Action, boolean>();
    for (const a of ACTIONS) nextDown.set(a, false);
    for (const code of this.keys) {
      const acts = KEY_BINDINGS[code];
      if (acts) for (const a of acts) nextDown.set(a, true);
    }
    if (this.gameplayMouse) {
      for (const b of this.mouseButtons) {
        const acts = MOUSE_BINDINGS[b];
        if (acts) for (const a of acts) nextDown.set(a, true);
      }
    }
    for (const b of this.padButtons) {
      const acts = PAD_BINDINGS[b];
      if (acts) for (const a of acts) nextDown.set(a, true);
    }
    for (const [a, v] of this.virtual) if (v) nextDown.set(a, true);

    for (const a of ACTIONS) {
      const d = nextDown.get(a)!;
      if (d && !this.prevDown.get(a)) this.pressTime.set(a, realTime);
      this.down.set(a, d);
    }

    // Movement axes
    let mx = 0, my = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) my += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) my -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    const lx = this.deadzone(this.padAxes[0]);
    const ly = this.deadzone(-this.padAxes[1]);
    if (Math.abs(lx) + Math.abs(ly) > 0) {
      mx = lx;
      my = ly;
    }
    if (this.virtualMove.active) {
      mx = this.virtualMove.x;
      my = this.virtualMove.y;
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.moveX.value = mx;
    this.moveY.value = my;

    // Look
    const sens = 0.0021 * this.settings.mouseSensitivity;
    this.lookDX = this.mouseDX * sens;
    this.lookDY = this.mouseDY * sens * (this.settings.invertY ? -1 : 1);
    this.mouseDX = 0;
    this.mouseDY = 0;
    const rx = this.deadzone(this.padAxes[2]);
    const ry = this.deadzone(this.padAxes[3]);
    if (rx !== 0 || ry !== 0) {
      const curve = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
      const padRate = 3.2 * this.settings.padSensitivity;
      this.lookDX += curve(rx) * padRate * realDt;
      this.lookDY += curve(ry) * padRate * 0.7 * realDt * (this.settings.invertY ? -1 : 1);
    }
  }

  private deadzone(v: number) {
    const dz = 0.18;
    if (Math.abs(v) < dz) return 0;
    return Math.sign(v) * clamp((Math.abs(v) - dz) / (1 - dz), 0, 1);
  }

  private pollGamepad() {
    this.padButtons.clear();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      for (let i = 0; i < p.buttons.length; i++) {
        const b = p.buttons[i];
        if (b.pressed || b.value > 0.4) {
          this.padButtons.add(i);
          this.usingGamepad = true;
        }
      }
      for (let i = 0; i < 4; i++) this.padAxes[i] = p.axes[i] ?? 0;
      if (p.axes.some((a) => Math.abs(a) > 0.3)) this.usingGamepad = true;
      break;
    }
  }

  isDown(a: Action) {
    return this.down.get(a)!;
  }
  pressed(a: Action) {
    return !this.consumed.has(a) && this.down.get(a)! && !this.prevDown.get(a)!;
  }
  released(a: Action) {
    return !this.down.get(a)! && this.prevDown.get(a)!;
  }
  /** True if pressed within the last `window` seconds and not yet consumed (input buffering). */
  buffered(a: Action, window: number) {
    return this.now - this.pressTime.get(a)! <= window;
  }
  consume(a: Action) {
    this.consumed.add(a);
    this.pressTime.set(a, -999);
  }
  heldDuration(a: Action) {
    return this.down.get(a) ? this.now - this.pressTime.get(a)! : 0;
  }
}
