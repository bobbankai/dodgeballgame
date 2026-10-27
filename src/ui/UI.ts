import type { Input } from '../core/Input';
import './ui.css';

export type Speaker = 'Ada' | 'Pip' | 'Mum' | 'Keeper' | '';

const COLORS: Record<string, string> = { Ada: 'var(--ada)', Pip: 'var(--pip)', Mum: 'var(--mum)', Keeper: '#3d5f86' };

function el(tag: string, cls: string, parent: HTMLElement, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

/**
 * The page-and-pencil interface: dialogue on torn paper, prompts, Mum's notes, chapter cards and
 * fades. Everything is driven by update(dt) so it runs on game time.
 */
export class UI {
  readonly root: HTMLElement;
  private dlg: HTMLElement;
  private who: HTMLElement;
  private text: HTMLElement;
  private promptEl: HTMLElement;
  private promptKey: HTMLElement;
  private promptText: HTMLElement;
  private ring: HTMLElement;
  private noteWrap: HTMLElement;
  private noteEl: HTMLElement;
  private card: HTMLElement;
  private fadeEl: HTMLElement;
  private bars: HTMLElement;
  private toastEl: HTMLElement;
  private counterEl: HTMLElement;
  readonly menuLayer: HTMLElement;

  private typing: { full: string; shown: number; done: () => void; speed: number; pause: number } | null = null;
  private waitingNote: (() => void) | null = null;
  private fadeAnim: { from: number; to: number; t: number; dur: number; done: () => void } | null = null;
  private fadeValue = 0;
  private toastTime = 0;
  private timers: { t: number; fn: () => void }[] = [];
  /** Called for each typed character (for the scratchy pencil voice). */
  onType?: (speaker: Speaker) => void;
  private speaker: Speaker = '';

  constructor(private input: Input) {
    document.body.insertAdjacentHTML(
      'beforeend',
      `<svg width="0" height="0" style="position:absolute"><filter id="ui-rough"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3.5"/></filter></svg>`,
    );
    this.root = el('div', '', document.body);
    this.root.id = 'ui';
    const layer = el('div', 'ui-layer', this.root);
    this.bars = el('div', 'ui-layer bars', layer);
    this.counterEl = el('div', 'counter', layer);
    this.toastEl = el('div', 'toast paper', layer);
    this.promptEl = el('div', 'prompt paper', layer);
    this.promptKey = el('span', 'key', this.promptEl);
    this.ring = el('span', 'ring', this.promptKey);
    this.promptText = el('span', '', this.promptEl);
    this.dlg = el('div', 'dialogue paper', layer);
    this.who = el('div', 'who', this.dlg);
    this.text = el('div', 'text', this.dlg);
    el('div', 'more', this.dlg, '&#9662;');
    this.noteWrap = el('div', 'note-wrap', layer);
    this.noteEl = el('div', 'note paper', this.noteWrap);
    this.card = el('div', 'title-card', layer);
    this.menuLayer = el('div', 'ui-layer', this.root);
    this.fadeEl = el('div', 'fade', this.root);
  }

  /** Show a button prompt (or hide it with null). `hold` (0..1) draws a progress ring. */
  prompt(text: string | null, key = 'E', hold = -1) {
    if (!text) {
      this.promptEl.classList.remove('show');
      return;
    }
    const k = this.input.device === 'gamepad' ? (key === 'E' ? 'X' : key === 'Space' ? 'A' : key) : key;
    if (this.promptKey.firstChild?.nodeValue !== k) {
      this.promptKey.firstChild?.nodeType === 3 ? (this.promptKey.firstChild.nodeValue = k) : this.promptKey.prepend(k);
    }
    this.promptText.textContent = text;
    this.ring.style.background = hold >= 0 ? `conic-gradient(rgba(42,36,40,.55) ${hold * 360}deg, transparent 0)` : 'none';
    this.ring.style.mask = 'radial-gradient(circle, transparent 58%, #000 60%)';
    this.promptEl.classList.add('show');
  }

  /** Speak a line; resolves when the player moves on. */
  say(speaker: Speaker, text: string, speed = 42): Promise<void> {
    this.speaker = speaker;
    this.who.textContent = speaker === 'Keeper' ? 'The Keeper' : speaker;
    this.who.style.color = COLORS[speaker] ?? 'var(--ink)';
    this.who.style.display = speaker ? '' : 'none';
    this.text.textContent = '';
    this.dlg.classList.add('show');
    this.dlg.classList.remove('done');
    return new Promise((done) => (this.typing = { full: text, shown: 0, done, speed, pause: 0 }));
  }

  get talking() {
    return this.typing !== null && this.typing.shown < this.typing.full.length;
  }

  get inDialogue() {
    return this.typing !== null;
  }

  hideDialogue() {
    this.dlg.classList.remove('show');
  }

  /** One of Mum's notes; resolves when dismissed. */
  note(title: string, body: string, sign = '— Mum'): Promise<void> {
    this.noteEl.innerHTML = `<div class="title">${title}</div><div>${body}</div><div class="sign">${sign}</div><div class="close">press E</div>`;
    this.noteWrap.classList.add('show');
    return new Promise((done) => {
      // ignore the press that opened it
      this.later(0.3, () => (this.waitingNote = done));
    });
  }

  title(small: string, big: string, hold = 3.2): Promise<void> {
    this.card.innerHTML = `<div class="small">${small}</div><div class="big">${big}</div><div class="rule"></div>`;
    requestAnimationFrame(() => this.card.classList.add('show'));
    return new Promise((done) => {
      this.later(hold, () => {
        this.card.classList.remove('show');
        this.later(1.2, done);
      });
    });
  }

  /** Fade the page in or out: 1 = covered by paper (or `color`), 0 = clear. */
  fade(to: number, seconds = 1, color?: string): Promise<void> {
    if (color) this.fadeEl.style.background = color;
    return new Promise((done) => (this.fadeAnim = { from: this.fadeValue, to, t: 0, dur: Math.max(seconds, 1e-3), done }));
  }

  /**
   * The page fills the screen and a door draws itself in pencil, swings open onto light, and we
   * fall through. Resolves once the screen is plain paper again.
   */
  doorTransition(onStroke?: () => void): Promise<void> {
    const wrap = el('div', 'door-wrap', this.root);
    wrap.innerHTML = `<svg viewBox="0 0 400 600" class="door-svg">
      <defs><radialGradient id="dlight"><stop offset="0" stop-color="#fffbe8"/><stop offset="1" stop-color="#f7e7b0" stop-opacity="0"/></radialGradient></defs>
      <ellipse class="glow" cx="201" cy="330" rx="120" ry="230" fill="url(#dlight)"/>
      <g class="strokes" fill="none" stroke="#4a4548" stroke-linecap="round" stroke-linejoin="round">
        <path d="M78,523 Q200,517 334,521" pathLength="1" style="--d:0s"/>
        <path d="M118,522 L117,150 Q200,112 284,148 L285,522" pathLength="1" style="--d:.25s"/>
        <path d="M111,524 L110,146 Q200,104 291,144 L293,524" pathLength="1" style="--d:.5s;stroke-width:2"/>
        <g class="leaf">
          <path d="M134,516 L133,165 Q200,137 268,163 L269,516 Z" pathLength="1" style="--d:.8s"/>
          <path d="M168,512 L167,150" pathLength="1" style="--d:1.15s;stroke-width:2"/>
          <path d="M201,512 L201,142" pathLength="1" style="--d:1.3s;stroke-width:2"/>
          <path d="M234,512 L235,150" pathLength="1" style="--d:1.45s;stroke-width:2"/>
          <circle cx="252" cy="340" r="7" pathLength="1" style="--d:1.7s"/>
        </g>
      </g></svg>`;
    requestAnimationFrame(() => wrap.classList.add('show'));
    return new Promise((done) => {
      [0.1, 0.5, 1.0, 1.5].forEach((t) => this.later(t, () => onStroke?.()));
      this.later(2.6, () => wrap.classList.add('open'));
      this.later(4.2, () => wrap.classList.add('through'));
      this.later(5.4, () => {
        this.fadeValue = 1;
        this.fadeEl.style.background = 'var(--paper)';
        this.fadeEl.style.opacity = '1';
        wrap.remove();
        done();
      });
    });
  }

  /**
   * A centred hand-lettered menu. Arrow keys / stick / mouse to choose, E or Enter to pick.
   * Resolves with the chosen item's id.
   */
  menu(title: string, sub: string, items: { id: string; label: string }[], hint = ''): Promise<string> {
    const m = el('div', 'menu', this.menuLayer);
    m.innerHTML = `${title ? `<h1>${title}</h1>` : ''}${sub ? `<div class="sub">${sub}</div>` : ''}`;
    const buttons = items.map((it) => {
      const b = el('button', '', m) as HTMLButtonElement;
      b.textContent = it.label;
      return b;
    });
    if (hint) el('div', 'hint', m, hint);
    requestAnimationFrame(() => m.classList.add('show'));
    let sel = 0;
    const mark = () => buttons.forEach((b, i) => b.classList.toggle('sel', i === sel));
    mark();
    return new Promise((done) => {
      let finished = false;
      const pick = (i: number) => {
        if (finished) return;
        finished = true;
        this.menuTick = null;
        m.classList.remove('show');
        this.later(0.5, () => m.remove());
        done(items[i].id);
      };
      buttons.forEach((b, i) => {
        b.addEventListener('mouseenter', () => {
          sel = i;
          mark();
        });
        b.addEventListener('click', () => pick(i));
      });
      let cool = 0;
      this.menuTick = (dt: number) => {
        cool -= dt;
        const mv = this.input.move();
        const k = (code: string) => this.input.pressedKey(code);
        if ((mv.y > 0.5 && cool <= 0) || k('ArrowUp') || k('KeyW')) {
          sel = (sel + items.length - 1) % items.length;
          cool = 0.25;
          mark();
        } else if ((mv.y < -0.5 && cool <= 0) || k('ArrowDown') || k('KeyS')) {
          sel = (sel + 1) % items.length;
          cool = 0.25;
          mark();
        }
        if (Math.abs(mv.y) < 0.3) cool = 0;
        if (this.input.justPressed('interact') || this.input.justPressed('jump')) pick(sel);
      };
    });
  }

  private menuTick: ((dt: number) => void) | null = null;

  get inMenu() {
    return this.menuTick !== null;
  }

  letterbox(on: boolean) {
    this.bars.classList.toggle('on', on);
  }

  toast(text: string, seconds = 4) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTime = seconds;
  }

  counter(text: string | null) {
    this.counterEl.textContent = text ?? '';
    this.counterEl.classList.toggle('show', !!text);
  }

  /** Run fn after `seconds` of game time. */
  later(seconds: number, fn: () => void) {
    this.timers.push({ t: seconds, fn });
  }

  update(dt: number) {
    if (this.menuTick) {
      this.menuTick(dt);
      this.tickTimers(dt);
      return;
    }
    const skip = this.input.justPressed('skip') || this.input.justPressed('interact');
    const ty = this.typing;
    if (ty) {
      if (ty.shown < ty.full.length) {
        if (skip) ty.shown = ty.full.length;
        else if (ty.pause > 0) ty.pause -= dt;
        else {
          const before = Math.floor(ty.shown);
          ty.shown = Math.min(ty.full.length, ty.shown + dt * ty.speed);
          const now = Math.floor(ty.shown);
          if (now > before) {
            const c = ty.full[now - 1];
            if (/\S/.test(c)) this.onType?.(this.speaker);
            // a natural breath after punctuation
            if (c === ',') ty.pause = 0.12;
            else if (c === '.' || c === '?' || c === '!' || c === '—') ty.pause = 0.3;
          }
        }
        this.text.textContent = ty.full.slice(0, Math.floor(ty.shown));
        if (ty.shown >= ty.full.length) this.dlg.classList.add('done');
      } else if (skip) {
        this.typing = null;
        ty.done();
      }
    }
    if (this.waitingNote && skip) {
      const d = this.waitingNote;
      this.waitingNote = null;
      this.noteWrap.classList.remove('show');
      this.later(0.3, d);
    }
    const f = this.fadeAnim;
    if (f) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      this.fadeValue = f.from + (f.to - f.from) * (k * k * (3 - 2 * k));
      this.fadeEl.style.opacity = String(this.fadeValue);
      if (k >= 1) {
        this.fadeAnim = null;
        f.done();
      }
    }
    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) this.toastEl.classList.remove('show');
    }
    this.tickTimers(dt);
  }

  private tickTimers(dt: number) {
    if (this.timers.length) {
      const due: (() => void)[] = [];
      this.timers = this.timers.filter((t) => {
        t.t -= dt;
        if (t.t <= 0) due.push(t.fn);
        return t.t > 0;
      });
      due.forEach((fn) => fn());
    }
  }
}
