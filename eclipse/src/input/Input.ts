import type { Settings } from '../core/Settings';

export type Action =
  | 'light' | 'heavy' | 'dodge' | 'jump' | 'block' | 'sprint' | 'lockOn' | 'interact'
  | 'ability1' | 'ability2' | 'ability3' | 'ability4' | 'ultimate' | 'heal' | 'walk'
  | 'pause' | 'journal' | 'map' | 'skills' | 'inventory' | 'switchLeft' | 'switchRight';

const ACTIONS: Action[] = ['light', 'heavy', 'dodge', 'jump', 'block', 'sprint', 'lockOn', 'interact', 'ability1', 'ability2',
  'ability3', 'ability4', 'ultimate', 'heal', 'walk', 'pause', 'journal', 'map', 'skills', 'inventory', 'switchLeft', 'switchRight'];

/** Standard gamepad layout -> actions (Xbox naming: A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 ...). */
const PAD: Partial<Record<Action, number[]>> = {
  light: [5], heavy: [7], dodge: [1], jump: [0], block: [4], sprint: [10], lockOn: [11], interact: [2],
  heal: [3], ability1: [12], ability2: [15], ability3: [13], ability4: [14], ultimate: [6], pause: [9], map: [8],
};

interface ButtonState {
  down: boolean;
  /** game time of the last press (for buffering) */
  pressedAt: number;
  pressedFrame: number;
  releasedFrame: number;
}

/**
 * Action-based input. Keyboard/mouse (rebindable), gamepads and the touch overlay all write into
 * the same action states; gameplay reads `pressed()` (this step), `held()`, `released()` and the
 * buffered `consume()` used by combat (a press stays valid for a short window so inputs made
 * during an attack's recovery are not lost).
 */
export class Input {
  readonly move = { x: 0, y: 0 };
  readonly look = { x: 0, y: 0 };
  private keys = new Set<string>();
  private states = new Map<Action, ButtonState>();
  private frame = 0;
  private time = 0;
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  pointerLocked = false;
  /** Set by the touch overlay. */
  touchMove = { x: 0, y: 0 };
  touchLook = { x: 0, y: 0 };
  private touchDown = new Set<Action>();
  usingGamepad = false;
  enabled = true;
  private padPrev: boolean[] = [];
  private listeners: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private settings: Settings) {
    for (const a of ACTIONS) this.states.set(a, { down: false, pressedAt: -1e9, pressedFrame: -1, releasedFrame: -1 });
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window) => {
      target.addEventListener(t, fn as EventListener, { passive: false });
      this.listeners.push(() => target.removeEventListener(t, fn as EventListener));
    };
    on('keydown', (e) => {
      if (e.repeat) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => this.keys.clear());
    on('mousedown', (e) => {
      this.keys.add(`Mouse${e.button}`);
      this.usingGamepad = false;
    });
    on('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    on('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    on('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
    });
    on('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  requestPointerLock(): void {
    if (this.pointerLocked || matchMedia('(pointer: coarse)').matches) return;
    this.canvas.requestPointerLock?.()?.catch?.(() => undefined);
  }

  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  setTouchAction(a: Action, down: boolean): void {
    if (down) this.touchDown.add(a);
    else this.touchDown.delete(a);
  }

  /** Simulate a key for tests (`__game.input.press('light')`). */
  press(a: Action): void {
    this.touchDown.add(a);
  }

  release(a: Action): void {
    this.touchDown.delete(a);
  }

  /** Called once per fixed step by the game. */
  update(time: number): void {
    this.frame++;
    this.time = time;
    const b = this.settings.data.controls.bindings;
    const pads = (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p && p.connected);
    const pad = pads[0];
    const padButtons = pad ? pad.buttons.map((x) => x.pressed || x.value > 0.4) : [];
    if (pad && padButtons.some((v, i) => v && !this.padPrev[i])) this.usingGamepad = true;
    this.padPrev = padButtons;
    for (const a of ACTIONS) {
      const keys = b[a] ?? [];
      let down = this.enabled && (keys.some((k) => this.keys.has(k)) || this.touchDown.has(a) || (PAD[a]?.some((i) => padButtons[i]) ?? false));
      if (!this.enabled && a === 'pause') down = keys.some((k) => this.keys.has(k)) || (PAD.pause?.some((i) => padButtons[i]) ?? false);
      const s = this.states.get(a)!;
      if (down && !s.down) {
        s.pressedAt = time;
        s.pressedFrame = this.frame;
      } else if (!down && s.down) {
        s.releasedFrame = this.frame;
      }
      s.down = down;
    }
    // movement
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      if (b.forward?.some((k) => this.keys.has(k))) my += 1;
      if (b.back?.some((k) => this.keys.has(k))) my -= 1;
      if (b.right?.some((k) => this.keys.has(k))) mx += 1;
      if (b.left?.some((k) => this.keys.has(k))) mx -= 1;
      const kl = Math.hypot(mx, my);
      if (kl > 1) {
        mx /= kl;
        my /= kl;
      }
      if (pad) {
        const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
        const px = dz(pad.axes[0] ?? 0);
        const py = -dz(pad.axes[1] ?? 0);
        if (Math.hypot(px, py) > Math.hypot(mx, my)) {
          mx = px;
          my = py;
        }
      }
      if (Math.hypot(this.touchMove.x, this.touchMove.y) > Math.hypot(mx, my)) {
        mx = this.touchMove.x;
        my = this.touchMove.y;
      }
    }
    this.move.x = mx;
    this.move.y = my;
    // look (radians this step)
    const c = this.settings.data.controls;
    const inv = c.invertY ? -1 : 1;
    let lx = this.mouseDX * 0.0022 * c.mouseSensitivity;
    let ly = this.mouseDY * 0.0022 * c.mouseSensitivity * inv;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (pad && this.enabled) {
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
      const rx = dz(pad.axes[2] ?? 0);
      const ry = dz(pad.axes[3] ?? 0);
      lx += rx * Math.abs(rx) * 3.2 * c.stickSensitivity / 60;
      ly += ry * Math.abs(ry) * 2.2 * c.stickSensitivity * inv / 60;
    }
    lx += this.touchLook.x;
    ly += this.touchLook.y * inv;
    this.touchLook.x = 0;
    this.touchLook.y = 0;
    this.look.x = this.enabled ? lx : 0;
    this.look.y = this.enabled ? ly : 0;
  }

  held(a: Action): boolean {
    return this.states.get(a)!.down;
  }

  pressed(a: Action): boolean {
    return this.states.get(a)!.pressedFrame === this.frame;
  }

  released(a: Action): boolean {
    return this.states.get(a)!.releasedFrame === this.frame;
  }

  /** Seconds the action has been held (0 when up). */
  heldFor(a: Action): number {
    const s = this.states.get(a)!;
    return s.down ? this.time - s.pressedAt : 0;
  }

  /** A press within the last `window` seconds that has not been consumed yet. */
  buffered(a: Action, window = 0.25): boolean {
    const s = this.states.get(a)!;
    return this.time - s.pressedAt <= window;
  }

  consume(a: Action): void {
    this.states.get(a)!.pressedAt = -1e9;
  }

  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Rumble on supporting gamepads (respects the vibration setting). */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.settings.data.controls.vibration) return;
    const pad = (navigator.getGamepads?.() ?? []).find((p) => p?.connected);
    const act = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | undefined)?.vibrationActuator;
    act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
  }

  dispose(): void {
    for (const off of this.listeners) off();
  }
}
