import type { Action, Input } from '../input/Input';

interface Btn {
  action: Action;
  label: string;
  cls: string;
}

const BUTTONS: Btn[] = [
  { action: 'light', label: 'Strike', cls: 'b-light' },
  { action: 'heavy', label: 'Heavy', cls: 'b-heavy' },
  { action: 'dodge', label: 'Dodge', cls: 'b-dodge' },
  { action: 'block', label: 'Guard', cls: 'b-block' },
  { action: 'jump', label: 'Jump', cls: 'b-jump' },
  { action: 'lockOn', label: 'Lock', cls: 'b-lock' },
  { action: 'heal', label: 'Flask', cls: 'b-heal' },
  { action: 'pause', label: '❚❚', cls: 'b-pause' },
];

/**
 * Touch controls for phones and tablets: a floating stick under the left thumb (it appears where the
 * thumb lands), drag anywhere on the right half to turn the camera, and a thumb arc of action
 * buttons. Multi-touch: each finger is tracked independently. Only shown on touch devices (or with
 * `?touch` for testing).
 */
export class TouchControls {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  /** Look speed in radians per pixel. */
  sensitivity = 0.006;
  /** Called when a touch device is turned upright (true) or sideways (false). */
  onPortrait: ((portrait: boolean) => void) | null = null;
  private rotate: HTMLElement;
  private isTouch = false;
  private wasPortrait = false;

  constructor(host: HTMLElement, private input: Input) {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('touch');
    this.root = document.createElement('div');
    this.root.className = 'ec-touch';
    host.appendChild(this.root);
    const zone = document.createElement('div');
    zone.className = 'zone';
    this.root.appendChild(zone);
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    const pad = document.createElement('div');
    pad.className = 'pad';
    this.root.appendChild(pad);
    for (const b of BUTTONS) {
      const e = document.createElement('div');
      e.className = `btn ${b.cls}`;
      e.textContent = b.label;
      // the pad is scaled on short screens, and a transform traps fixed children: pause lives outside it
      (b.action === 'pause' ? this.root : pad).appendChild(e);
      const down = (ev: PointerEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        e.classList.add('down');
        this.input.setTouchAction(b.action, true);
        e.setPointerCapture(ev.pointerId);
      };
      const up = (ev: PointerEvent) => {
        ev.preventDefault();
        e.classList.remove('down');
        this.input.setTouchAction(b.action, false);
      };
      e.addEventListener('pointerdown', down);
      e.addEventListener('pointerup', up);
      e.addEventListener('pointercancel', up);
    }
    // The HUD's ability slots are the ability buttons (1-4 and the ultimate): only the abilities Kael has
    // unlocked are shown, each with its cooldown, and a tap casts it.
    const casts: Action[] = ['ability1', 'ability2', 'ability3', 'ability4', 'ultimate'];
    // (the HUD sits under this layer, whose look/stick area would swallow the taps: the bar moves up into it;
    // the HUD keeps updating it through its own references)
    const bar = host.querySelector<HTMLElement>('.ec-abilities');
    if (bar && touch) this.root.appendChild(bar);
    host.querySelectorAll<HTMLElement>('.ec-abilities .ec-slot').forEach((slot, i) => {
      const action = casts[i];
      if (!action) return;
      slot.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        slot.classList.add('down');
        this.input.setTouchAction(action, true);
        slot.setPointerCapture(ev.pointerId);
      });
      const up = (ev: PointerEvent) => {
        ev.preventDefault();
        slot.classList.remove('down');
        this.input.setTouchAction(action, false);
      };
      slot.addEventListener('pointerup', up);
      slot.addEventListener('pointercancel', up);
    });
    zone.addEventListener('pointerdown', (ev) => this.start(ev));
    zone.addEventListener('pointermove', (ev) => this.drag(ev));
    zone.addEventListener('pointerup', (ev) => this.end(ev));
    zone.addEventListener('pointercancel', (ev) => this.end(ev));
    this.root.classList.toggle('on', touch);
    // the HUD lays itself out round the pad (hotbar out of the pad's way)
    document.documentElement.classList.toggle('ec-touch-on', touch);
    // the game is played sideways: upright, a full-screen note asks for a turn (and the game pauses)
    this.rotate = document.createElement('div');
    this.rotate.className = 'ec-rotate';
    this.rotate.innerHTML = '<div class="ico">&#10227;</div><div class="msg">Turn your device sideways to play</div>';
    host.appendChild(this.rotate);
    // read the size itself (the media query's change event is not delivered reliably) on every resize
    this.isTouch = touch;
    window.addEventListener('resize', () => this.tick());
    window.addEventListener('orientationchange', () => this.tick());
    queueMicrotask(() => this.tick());
    // Android Chrome honours this in full screen; elsewhere it is refused, which is fine
    window.addEventListener('pointerdown', () => {
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> } | undefined)?.lock?.('landscape').catch(() => undefined);
    }, { once: true });
  }

  private start(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' && !new URLSearchParams(location.search).has('touch')) return;
    const left = ev.clientX < window.innerWidth * 0.45;
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    if (left && this.stickId === null) {
      this.stickId = ev.pointerId;
      this.stickOrigin = { x: ev.clientX, y: ev.clientY };
      this.stick.style.left = `${ev.clientX}px`;
      this.stick.style.top = `${ev.clientY}px`;
      this.stick.classList.add('on');
    } else if (!left && this.lookId === null) {
      this.lookId = ev.pointerId;
      this.lookLast = { x: ev.clientX, y: ev.clientY };
    }
  }

  private drag(ev: PointerEvent): void {
    if (ev.pointerId === this.stickId) {
      const r = 56;
      let dx = ev.clientX - this.stickOrigin.x;
      let dy = ev.clientY - this.stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > r) {
        dx *= r / len;
        dy *= r / len;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.touchMove.x = dx / r;
      this.input.touchMove.y = -dy / r;
      // push to the rim to sprint
      this.input.setTouchAction('sprint', len > r * 1.6);
    } else if (ev.pointerId === this.lookId) {
      this.input.touchLook.x += (ev.clientX - this.lookLast.x) * this.sensitivity;
      this.input.touchLook.y += (ev.clientY - this.lookLast.y) * this.sensitivity;
      this.lookLast = { x: ev.clientX, y: ev.clientY };
    }
  }

  private end(ev: PointerEvent): void {
    if (ev.pointerId === this.stickId) {
      this.stickId = null;
      this.input.touchMove.x = 0;
      this.input.touchMove.y = 0;
      this.input.setTouchAction('sprint', false);
      this.knob.style.transform = '';
      this.stick.classList.remove('on');
    } else if (ev.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  /** Every frame (and on resize): is the device held upright? Shows the note and tells the game once per change. */
  tick(): void {
    const p = this.isTouch && window.innerHeight > window.innerWidth;
    if (p === this.wasPortrait && this.rotate.classList.contains('on') === p) return;
    this.rotate.classList.toggle('on', p);
    if (p !== this.wasPortrait) this.onPortrait?.(p);
    this.wasPortrait = p;
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }
}
