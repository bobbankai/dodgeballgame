import type { Action, Input } from '@/input/input';

/**
 * On-screen controls for phones and tablets. Everything feeds the same named actions as the keyboard and the gamepad (`Input`),
 * so combat buffering, parry windows and the abilities behave the same under a thumb.
 *
 * - Left of the screen: a floating stick. It appears where the thumb lands (no hunting for a fixed pad) and rests, faint, at its
 *   home position. Pushing past its ring sprints.
 * - Right of the screen: drag anywhere to turn the camera.
 * - Bottom right: the action cluster under the right thumb (attack at its centre; heavy, block, dodge, jump and lock-on around
 *   it). Block is held; a tap on it at the right moment parries, as on the keyboard.
 * - The HUD's four chronal abilities become buttons, and the interact prompt becomes one when it shows.
 * - Pause, top right. In portrait a hint asks for landscape; the first tap asks for fullscreen and a landscape lock where the
 *   browser allows it (Android; iOS keeps its browser bars).
 * Pointer events with per-pointer capture: any number of thumbs at once, each tracked by its own id.
 */
const ICON: Record<string, string> = {
  light: '<path d="M6 18 L18 6"/><path d="M4 14 L10 20"/><path d="M15 4 h5 v5"/>',
  heavy: '<path d="M4 15 L15 4"/><path d="M9 20 L20 9"/><path d="M15 15 l3 3"/>',
  block: '<path d="M12 3 l7 3 v6 c0 4.5 -3 7.5 -7 9 c-4 -1.5 -7 -4.5 -7 -9 V6 z"/>',
  dodge: '<path d="M13 6 l6 6 l-6 6"/><path d="M19 12 H8"/><path d="M4 8.5 h4"/><path d="M4 15.5 h4"/>',
  jump: '<path d="M6 13 l6 -6 l6 6"/><path d="M6 19 l6 -6 l6 6"/>',
  lock: '<circle cx="12" cy="12" r="6"/><path d="M12 2 v5 M12 17 v5 M2 12 h5 M17 12 h5"/>',
  pause: '<path d="M9 6 v12 M15 6 v12"/>',
};
const LABEL: Record<string, string> = { light: 'Strike', heavy: 'Heavy', block: 'Guard', dodge: 'Dodge', jump: 'Jump', lock: 'Lock' };

const svg = (k: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

/** CSS pixels of drag -> mouse-pixel equivalents for the camera (a thumb travels further than a mouse for the same turn). */
const LOOK_GAIN = 1.7;

export class TouchControls {
  readonly root = document.createElement('div');
  private stick = document.createElement('div');
  private knob = document.createElement('div');
  private stickId = -1;
  private lookId = -1;
  private origin = { x: 0, y: 0 };
  private last = { x: 0, y: 0 };
  private asked = false;

  constructor(private input: Input, hud: HTMLElement) {
    document.body.classList.add('touch');
    this.root.className = 'touch';
    const zone = document.createElement('div');
    zone.className = 't-zone';
    this.stick.className = 't-stick';
    this.knob.className = 't-knob';
    this.stick.appendChild(this.knob);
    const cluster = document.createElement('div');
    cluster.className = 't-cluster';
    for (const a of ['light', 'heavy', 'block', 'dodge', 'jump', 'lock'] as const) {
      cluster.appendChild(this.button(a, `t-btn t-${a}`, `${svg(a)}<span>${LABEL[a]}</span>`, a));
    }
    const pause = this.button('pause', 't-btn t-pause', svg('pause'), 'Pause');
    const hint = document.createElement('div');
    hint.className = 't-rotate';
    hint.innerHTML = '<div class="phone"></div><p>Turn your device sideways</p>';
    this.root.append(zone, this.stick, cluster, pause, hint);
    hud.appendChild(this.root);

    // the HUD's ability slots and its interact prompt answer to a tap
    const abilities: Action[] = ['slow', 'rewind', 'echo', 'shift'];
    hud.querySelectorAll<HTMLElement>('.hud-abilities .ability').forEach((el, i) => this.hold(el, abilities[i]));
    const prompt = hud.querySelector<HTMLElement>('.prompt');
    if (prompt) this.hold(prompt, 'interact');

    zone.addEventListener('pointerdown', (e) => this.down(e, zone));
    zone.addEventListener('pointermove', (e) => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) zone.addEventListener(ev, (e) => this.up(e));
    // no page scrolling, pinch zoom or long-press callouts while playing
    this.root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('pointerdown', () => this.immerse());
    addEventListener('resize', () => { if (this.stickId < 0) this.rest(); });
    this.rest();
  }

  private button(action: Action, cls: string, html: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.innerHTML = html;
    b.setAttribute('aria-label', label);
    this.hold(b, action);
    return b;
  }

  /** Press on pointerdown, release on up/cancel; the pointer is captured so a thumb sliding off still releases it. */
  private hold(el: HTMLElement, action: Action): void {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      el.classList.add('down');
      this.input.touchActive = true;
      this.input.set(action, true);
      navigator.vibrate?.(8);
    });
    const release = () => { el.classList.remove('down'); this.input.set(action, false); };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, release);
  }

  private radius(): number { return Math.max(44, Math.min(68, innerHeight * 0.13)); }

  private down(e: PointerEvent, zone: HTMLElement): void {
    e.preventDefault();
    try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    if (e.clientX < innerWidth * 0.42 && this.stickId < 0) {
      this.stickId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.stick.classList.add('on');
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(0, 0)';
    } else if (this.lookId < 0) {
      this.lookId = e.pointerId;
      this.last = { x: e.clientX, y: e.clientY };
    }
  }

  private move(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      const R = this.radius();
      let dx = e.clientX - this.origin.x, dy = e.clientY - this.origin.y;
      const d = Math.hypot(dx, dy);
      // sprint: the thumb pushed well past the ring
      this.input.set('sprint', d > R * 1.3);
      if (d > R) { dx *= R / d; dy *= R / d; }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      let x = dx / R, y = -dy / R;
      const m = Math.hypot(x, y);
      if (m < 0.12) { x = 0; y = 0; }   // dead zone: a resting thumb does not creep
      this.input.setTouchAxes({ x, y }, { x: 0, y: 0 });
    } else if (e.pointerId === this.lookId) {
      this.input.addLook((e.clientX - this.last.x) * LOOK_GAIN, (e.clientY - this.last.y) * LOOK_GAIN);
      this.last = { x: e.clientX, y: e.clientY };
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.input.setTouchAxes({ x: 0, y: 0 }, { x: 0, y: 0 });
      this.input.set('sprint', false);
      this.rest();
    } else if (e.pointerId === this.lookId) this.lookId = -1;
  }

  /** The stick waits, faint, where a left thumb naturally rests. */
  private rest(): void {
    this.stick.classList.remove('on');
    const R = this.radius();
    const x = Math.max(R * 1.6, innerWidth * 0.12), y = innerHeight - Math.max(R * 1.7, innerHeight * 0.26);
    this.stick.style.transform = `translate(${x}px, ${y}px)`;
    this.knob.style.transform = 'translate(0, 0)';
  }

  /** Fullscreen and a landscape lock, asked once from a user gesture (where the browser allows them). */
  private immerse(): void {
    if (this.asked) return;
    this.asked = true;
    const el = document.documentElement as HTMLElement & { requestFullscreen?: (o?: object) => Promise<void> };
    const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape').catch(() => {});
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  }
}
