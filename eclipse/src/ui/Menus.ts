import type { Input } from '../input/Input';

export interface MenuItem {
  label: string;
  /** Extra text shown to the right (values, costs) or below (descriptions). */
  detail?: string;
  hint?: string;
  disabled?: boolean;
  /** A slider / option control: left/right change the value. */
  value?: { get(): string; step(dir: -1 | 1): void };
  action?: () => void;
  /** Visual state for skill nodes and the like. */
  state?: 'learned' | 'available' | 'locked';
}

export interface Screen {
  id: string;
  title: string;
  subtitle?: string;
  items: () => MenuItem[];
  /** Columns layout (skill tree): items are split into groups by `column`. */
  columns?: { name: string; filter: (i: MenuItem, index: number) => boolean }[];
  back?: () => void;
  /** Dim and blur the game behind (pause) or cover it (title has its own backdrop). */
  overlay?: 'dim' | 'clear';
  footer?: string;
}

function el(tag: string, cls: string, parent?: HTMLElement, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

/**
 * Menu screens over the game: a stack of screens (title -> settings -> ...), each a list (or
 * columns) of items navigated with the keyboard, mouse or a gamepad. Items can be actions or value
 * controls (left/right). Rendering is plain DOM so text stays crisp at any resolution.
 */
export class Menus {
  readonly root: HTMLElement;
  private stack: Screen[] = [];
  private index = 0;
  private items: MenuItem[] = [];
  private nodes: HTMLElement[] = [];
  private panel: HTMLElement;
  private repeat = 0;
  onMove: (() => void) | null = null;
  onConfirm: (() => void) | null = null;

  constructor(host: HTMLElement, private input: Input) {
    this.root = el('div', 'ec-menu', host);
    this.panel = el('div', 'panel', this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      if (e.key === 'ArrowDown' || e.key === 's') this.move(1);
      else if (e.key === 'ArrowUp' || e.key === 'w') this.move(-1);
      else if (e.key === 'ArrowLeft' || e.key === 'a') this.change(-1);
      else if (e.key === 'ArrowRight' || e.key === 'd') this.change(1);
      else if (e.key === 'Enter' || e.key === ' ') this.confirm();
      else if (e.key === 'Escape' || e.key === 'Backspace') this.back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  get open(): boolean {
    return this.stack.length > 0;
  }

  get current(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  push(s: Screen): void {
    this.stack.push(s);
    this.index = 0;
    this.render();
  }

  replace(s: Screen): void {
    this.stack.pop();
    this.push(s);
  }

  pop(): void {
    this.stack.pop();
    this.index = 0;
    if (this.open) this.render();
    else this.root.classList.remove('on');
  }

  close(): void {
    this.stack = [];
    this.root.classList.remove('on');
  }

  /** Re-reads the current screen's items (after a value changed). */
  refresh(): void {
    if (this.open) this.render(true);
  }

  private render(keepIndex = false): void {
    const s = this.current!;
    this.root.className = `ec-menu on ${s.overlay ?? 'dim'} screen-${s.id}`;
    this.panel.innerHTML = '';
    el('div', 'title', this.panel, s.title);
    if (s.subtitle) el('div', 'subtitle', this.panel, s.subtitle);
    el('div', 'rule', this.panel);
    this.items = s.items();
    if (!keepIndex) this.index = Math.max(0, this.items.findIndex((i) => !i.disabled));
    this.index = Math.min(this.index, this.items.length - 1);
    this.nodes = [];
    const makeItem = (it: MenuItem, i: number, parent: HTMLElement) => {
      const n = el('div', `item${it.disabled ? ' disabled' : ''}${it.state ? ` ${it.state}` : ''}${it.value ? ' value' : ''}`, parent);
      el('span', 'label', n, it.label);
      if (it.value) {
        const v = el('span', 'val', n);
        el('span', 'arrow', v, '&#8249;');
        el('span', 'cur', v, it.value.get());
        el('span', 'arrow', v, '&#8250;');
      } else if (it.detail) {
        el('span', 'detail', n, it.detail);
      }
      if (it.hint) el('div', 'hint', n, it.hint);
      n.addEventListener('mouseenter', () => {
        if (!it.disabled) this.select(i);
      });
      n.addEventListener('click', (e) => {
        if (it.disabled) return;
        this.select(i);
        if (it.value) {
          const r = n.getBoundingClientRect();
          this.change(e.clientX > r.left + r.width / 2 ? 1 : -1);
        } else this.confirm();
      });
      this.nodes[i] = n;
    };
    if (s.columns) {
      const cols = el('div', 'columns', this.panel);
      for (const c of s.columns) {
        const col = el('div', 'col', cols);
        el('div', 'colname', col, c.name);
        this.items.forEach((it, i) => {
          if (c.filter(it, i)) makeItem(it, i, col);
        });
      }
    } else {
      const list = el('div', 'list', this.panel);
      this.items.forEach((it, i) => makeItem(it, i, list));
    }
    this.descEl = el('div', 'desc', this.panel);
    if (s.footer) el('div', 'footer', this.panel, s.footer);
    this.select(this.index);
  }

  private descEl: HTMLElement | null = null;

  private select(i: number): void {
    if (i < 0 || i >= this.nodes.length) return;
    this.nodes[this.index]?.classList.remove('sel');
    this.index = i;
    this.nodes[i]?.classList.add('sel');
    const it = this.items[i];
    if (this.descEl) this.descEl.innerHTML = it?.hint && this.current?.columns ? it.hint : '';
  }

  private move(dir: 1 | -1): void {
    if (!this.items.length) return;
    let i = this.index;
    for (let k = 0; k < this.items.length; k++) {
      i = (i + dir + this.items.length) % this.items.length;
      if (!this.items[i].disabled) break;
    }
    if (i !== this.index) {
      this.select(i);
      this.onMove?.();
    }
  }

  private change(dir: -1 | 1): void {
    const it = this.items[this.index];
    if (it?.value) {
      it.value.step(dir);
      this.onMove?.();
      this.refresh();
    } else if (this.current?.columns) {
      // jump between columns
      const cols = this.current.columns;
      const colOf = (k: number) => cols.findIndex((c) => c.filter(this.items[k], k));
      const target = colOf(this.index) + dir;
      if (target < 0 || target >= cols.length) return;
      const firstIn = this.items.findIndex((x, k) => cols[target].filter(x, k) && !x.disabled);
      if (firstIn >= 0) this.select(firstIn);
    }
  }

  private confirm(): void {
    const it = this.items[this.index];
    if (!it || it.disabled || !it.action) return;
    this.onConfirm?.();
    it.action();
    if (this.open) this.refresh();
  }

  back(): void {
    const s = this.current;
    if (!s) return;
    if (s.back) s.back();
    else this.pop();
  }

  /** Gamepad navigation (called every frame while open). */
  update(dt: number): void {
    if (!this.open) return;
    const inp = this.input;
    const y = inp.move.y;
    const x = inp.move.x;
    this.repeat -= dt;
    if (Math.abs(y) > 0.6 || Math.abs(x) > 0.6) {
      if (this.repeat <= 0) {
        if (Math.abs(y) > Math.abs(x)) this.move(y > 0 ? -1 : 1);
        else this.change(x > 0 ? 1 : -1);
        this.repeat = 0.22;
      }
    } else {
      this.repeat = 0;
    }
    if (inp.pressed('jump')) this.confirm();
    if (inp.pressed('dodge')) this.back();
  }
}
