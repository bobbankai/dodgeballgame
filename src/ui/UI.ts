import type { Input } from '../core/Input';
import './ui.css';

export type Speaker = 'Ada' | 'Pip' | 'Mum' | '';

const COLORS: Record<string, string> = { Ada: 'var(--ada)', Pip: 'var(--pip)', Mum: 'var(--mum)' };

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
    this.who.textContent = speaker === 'Mum' ? 'Mum' : speaker;
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
