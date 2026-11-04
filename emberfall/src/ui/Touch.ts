// Touch controls: floating stick (left half), camera drag (right half), combat buttons (right thumb).
import type { Button, Input } from '../core/Input';

const CSS = `
#touch { position: fixed; inset: 0; z-index: 6; pointer-events: none; display: none; touch-action: none; }
#touch.on { display: block; }
#touch .zone { position: absolute; top: 0; bottom: 0; pointer-events: auto; }
#touch .left { left: 0; width: 45%; }
#touch .right { right: 0; width: 55%; }
#touch .stick { position: absolute; width: 132px; height: 132px; margin: -66px 0 0 -66px; border-radius: 50%; border: 2px solid rgba(239,228,207,.28); background: radial-gradient(circle, rgba(0,0,0,.15), rgba(0,0,0,.35)); display: none; }
#touch .knob { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, rgba(255,226,180,.55), rgba(180,120,70,.35)); border: 1px solid rgba(255,220,170,.5); }
#touch .btn { position: absolute; pointer-events: auto; border-radius: 50%; border: 1.5px solid rgba(217,178,106,.55); background: radial-gradient(circle at 45% 35%, rgba(60,40,30,.55), rgba(10,8,10,.55)); color: #efe4cf; font: 600 12px/1 'Cinzel', serif; letter-spacing: .08em; display: flex; align-items: center; justify-content: center; text-align: center; box-shadow: 0 0 10px rgba(0,0,0,.5); -webkit-tap-highlight-color: transparent; }
#touch .btn.down { background: radial-gradient(circle, rgba(255,150,70,.55), rgba(120,40,10,.5)); border-color: #ffcf7a; }
#touch .btn.big { width: 92px; height: 92px; font-size: 15px; }
#touch .btn.mid { width: 64px; height: 64px; }
#touch .btn.sm { width: 48px; height: 48px; font-size: 10px; }
#touch .btn.hidden { display: none; }
#touch .btn.art { border-color: rgba(255,140,60,.45); color: rgba(239,228,207,.6); }
#touch .btn.art.ready { border-color: #ffb45a; color: #fff1d8; box-shadow: 0 0 14px rgba(255,140,50,.55); }
#touch .knob.sprint { background: radial-gradient(circle at 40% 35%, rgba(255,190,120,.85), rgba(220,110,40,.6)); }
`;

interface BtnDef { b: Button; label: string; size: 'big' | 'mid' | 'sm'; right: number; bottom: number }

const BTNS: BtnDef[] = [
  { b: 'attack', label: 'Strike', size: 'big', right: 36, bottom: 42 },
  { b: 'heavy', label: 'Heavy', size: 'mid', right: 146, bottom: 34 },
  { b: 'dodge', label: 'Dodge', size: 'mid', right: 40, bottom: 148 },
  { b: 'block', label: 'Guard', size: 'mid', right: 136, bottom: 122 },
  { b: 'art1', label: 'Whirl', size: 'sm', right: 232, bottom: 30 },
  { b: 'art2', label: 'Rise', size: 'sm', right: 236, bottom: 92 },
  { b: 'art3', label: 'Burst', size: 'sm', right: 214, bottom: 150 },
  { b: 'heal', label: 'Heal', size: 'sm', right: 196, bottom: 206 },
  { b: 'lock', label: 'Lock', size: 'sm', right: 30, bottom: 236 },
  { b: 'interact', label: 'Use', size: 'mid', right: 110, bottom: 212 },
  { b: 'pause', label: 'II', size: 'sm', right: 20, bottom: -1 },
];

export class Touch {
  readonly root: HTMLElement;
  private stick: HTMLElement;
  private knob: HTMLElement;
  private stickId = -1;
  private stickOrigin = { x: 0, y: 0 };
  private lookId = -1;
  private lookLast = { x: 0, y: 0 };
  private btnEls = new Map<Button, HTMLElement>();
  sensitivity = 0.0055;

  constructor(private input: Input) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.root = document.createElement('div');
    this.root.id = 'touch';
    document.body.appendChild(this.root);
    const left = document.createElement('div');
    left.className = 'zone left';
    const right = document.createElement('div');
    right.className = 'zone right';
    this.root.append(left, right);
    this.stick = document.createElement('div');
    this.stick.className = 'stick';
    this.knob = document.createElement('div');
    this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    left.addEventListener('touchstart', (e) => this.stickStart(e), { passive: false });
    right.addEventListener('touchstart', (e) => this.lookStart(e), { passive: false });
    window.addEventListener('touchmove', (e) => this.move(e), { passive: false });
    window.addEventListener('touchend', (e) => this.end(e), { passive: false });
    window.addEventListener('touchcancel', (e) => this.end(e), { passive: false });
    for (const d of BTNS) {
      const b = document.createElement('div');
      b.className = `btn ${d.size}${d.b.startsWith('art') ? ' art hidden' : ''}`;
      b.textContent = d.label;
      b.style.right = `calc(${d.right}px + env(safe-area-inset-right))`;
      if (d.bottom < 0) { b.style.top = 'calc(14px + env(safe-area-inset-top))'; } else b.style.bottom = `calc(${d.bottom}px + env(safe-area-inset-bottom))`;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); this.input.touchHeld.add(d.b); }, { passive: false });
      const up = (e: Event) => { e.preventDefault(); b.classList.remove('down'); this.input.touchHeld.delete(d.b); };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      this.root.appendChild(b);
      this.btnEls.set(d.b, b);
    }
    const want = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || new URLSearchParams(location.search).has('touch');
    this.enable(want);
  }

  enable(on: boolean): void { this.root.classList.toggle('on', on); }
  get enabled(): boolean { return this.root.classList.contains('on'); }

  showInteract(on: boolean, label = 'Use'): void {
    const b = this.btnEls.get('interact');
    if (!b) return;
    b.classList.toggle('hidden', !on);
    b.textContent = label;
  }

  /** show the arts learned so far; light the ones the ember gauge can pay for */
  setArts(unlocked: number, ember: number, costs: number[]): void {
    for (let i = 0; i < 3; i++) {
      const b = this.btnEls.get(`art${i + 1}` as Button);
      if (!b) continue;
      b.classList.toggle('hidden', i >= unlocked);
      b.classList.toggle('ready', ember >= costs[i]);
    }
  }

  private stickStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (this.stickId !== -1) return;
    this.stickId = t.identifier;
    this.stickOrigin = { x: t.clientX, y: t.clientY };
    this.stick.style.display = 'block';
    this.stick.style.left = t.clientX + 'px';
    this.stick.style.top = t.clientY + 'px';
    this.knob.style.transform = 'translate(0,0)';
  }

  private lookStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (this.lookId !== -1) return;
    this.lookId = t.identifier;
    this.lookLast = { x: t.clientX, y: t.clientY };
  }

  private move(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        e.preventDefault();
        let dx = t.clientX - this.stickOrigin.x, dy = t.clientY - this.stickOrigin.y;
        const r = 56;
        const d = Math.hypot(dx, dy);
        // pushing well past the ring breaks into a sprint
        const sprint = d > r * 1.45;
        if (sprint) this.input.touchHeld.add('sprint'); else this.input.touchHeld.delete('sprint');
        this.knob.classList.toggle('sprint', sprint);
        if (d > r) { dx *= r / d; dy *= r / d; }
        this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        const m = Math.min(1, d / r);
        const k = m < 0.12 ? 0 : (m - 0.12) / 0.88;
        this.input.touchMove.set((dx / (d || 1)) * k, (-dy / (d || 1)) * k);
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        this.input.touchLook.x += (t.clientX - this.lookLast.x) * this.sensitivity;
        this.input.touchLook.y += (t.clientY - this.lookLast.y) * this.sensitivity;
        this.lookLast = { x: t.clientX, y: t.clientY };
      }
    }
  }

  private end(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickId = -1;
        this.stick.style.display = 'none';
        this.input.touchMove.set(0, 0);
        this.input.touchHeld.delete('sprint');
        this.knob.classList.remove('sprint');
      } else if (t.identifier === this.lookId) this.lookId = -1;
    }
  }
}
