import '@fontsource/dela-gothic-one';
import '@fontsource/shippori-mincho';
import '@fontsource/yuji-syuku';
import '@fontsource/zen-kaku-gothic-new';
import './styles.css';
import type { Fighter } from '../game/Fighter';

/** Shared by the HUD and the menus: the player is using a finger, so show touch prompts, not keys. */
export const uiState = { touch: false };

const TOUCH_NAMES: Record<string, string> = {
  J: 'Light', K: 'Heavy', L: 'Guard', Space: 'Jump', Shift: 'Dash', U: '1', I: '2', O: '3', P: 'Domain', Y: 'Vow',
};

/** A tutorial line written for the keyboard, reworded for the on-screen buttons. */
export function touchPrompt(html: string): string {
  return html
    .replace(/<kbd>W<\/kbd>\s*<kbd>A<\/kbd>\s*<kbd>S<\/kbd>\s*<kbd>D<\/kbd>/g, '<kbd>the stick</kbd>')
    .replace(/<kbd>([A-Za-z]+)<\/kbd>/g, (m, k: string) => (TOUCH_NAMES[k] ? `<kbd>${TOUCH_NAMES[k]}</kbd>` : m))
    .replace(/Press <kbd>/g, 'Tap <kbd>')
    .replace(/press <kbd>/g, 'tap <kbd>');
}

const el = (tag: string, cls = '', html = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

class Side {
  readonly root: HTMLElement;
  private name: HTMLElement;
  private fill: HTMLElement;
  private chip: HTMLElement;
  private energy: HTMLElement;
  private gauge: HTMLElement;
  private vow: HTMLElement;
  private count: HTMLElement;
  fighter: Fighter | null = null;

  constructor(parent: HTMLElement, side: 'left' | 'right') {
    this.root = el('div', `hud-side ${side}`);
    this.name = el('div', 'hud-name');
    const bar = el('div', 'bar');
    this.chip = el('div', 'chip');
    this.fill = el('div', 'fill');
    bar.append(this.chip, this.fill);
    const eb = el('div', 'bar energy');
    this.energy = el('div', 'fill');
    eb.append(this.energy, el('div', 'ticks'));
    this.gauge = el('div', 'domain-gauge', '<span>領</span>');
    this.vow = el('div', 'vow-mark hidden', 'VOW');
    this.count = el('div', 'enemy-count');
    this.root.append(this.name, bar, eb, this.gauge, this.vow, this.count);
    parent.append(this.root);
  }

  update(f: Fighter | null, extra = ''): void {
    this.fighter = f;
    this.root.classList.toggle('hidden', !f);
    if (!f) return;
    const sub = f.kit.domain ? `<small>${f.kit.domain.name}</small>` : '';
    const html = `${f.name}${sub}`;
    if (this.name.innerHTML !== html) this.name.innerHTML = html;
    const hp = Math.max(0, f.hp / f.maxHp) * 100;
    this.fill.style.width = hp + '%';
    this.chip.style.width = hp + '%';
    this.fill.classList.toggle('low', hp < 30);
    this.energy.style.width = f.energy + '%';
    this.gauge.style.setProperty('--p', f.domainGauge + '%');
    this.gauge.classList.toggle('ready', f.domainGauge >= 100 && !!f.kit.domain);
    this.gauge.classList.toggle('hidden', !f.kit.domain);
    this.vow.classList.toggle('hidden', f.vowTime <= 0 && !(f.hp < f.maxHp * 0.3 && !f.vowUsed));
    this.vow.textContent = f.vowTime > 0 ? `VOW  ${Math.ceil(f.vowTime)}` : uiState.touch ? 'VOW READY' : 'VOW READY  [Y]';
    this.count.textContent = extra;
  }
}

/** The in-fight HUD plus banners, combo counter and tutorial prompts. */
export class HUD {
  readonly root: HTMLElement;
  private left: Side;
  private right: Side;
  private combo: HTMLElement;
  private comboN: HTMLElement;
  private comboD: HTMLElement;
  private comboT = 0;
  private comboCount = 0;
  private comboDmg = 0;
  private techs: HTMLElement;
  private prompt: HTMLElement;
  private bannerBox: HTMLElement;
  private hint: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'layer hud hidden');
    this.left = new Side(this.root, 'left');
    this.right = new Side(this.root, 'right');
    this.combo = el('div', 'combo');
    this.comboN = el('div', 'n');
    this.comboD = el('div', 'dmg');
    this.combo.append(this.comboN, this.comboD);
    this.combo.style.opacity = '0';
    this.techs = el('div', 'techs');
    this.prompt = el('div', 'prompt hidden');
    this.bannerBox = el('div', 'layer');
    this.hint = el('div', 'keys-hint', 'WASD move · J light · K heavy · L guard<br>Space jump · Shift dash · U I O techniques<br>P domain · Y vow · Esc pause');
    this.root.append(this.combo, this.techs, this.prompt, this.bannerBox, this.hint);
    parent.append(this.root);
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  bindTechs(f: Fighter): void {
    this.techs.innerHTML = '';
    ['U', 'I', 'O'].forEach((k, i) => {
      const m = f.kit.moves[f.kit.techs[i]];
      if (!m) return;
      const t = el('div', 'tech', `<b>${k}</b>${m.label ?? m.name}<i>${m.cost ?? 0} energy</i>`);
      t.dataset.cost = String(m.cost ?? 0);
      this.techs.append(t);
    });
  }

  update(dt: number, player: Fighter | null, enemy: Fighter | null, enemies: number): void {
    this.left.update(player);
    this.right.update(enemy, enemies > 1 ? `+ ${enemies - 1} more` : '');
    if (player) {
      for (const t of Array.from(this.techs.children) as HTMLElement[]) {
        t.classList.toggle('off', player.energy < +(t.dataset.cost ?? 0) && !player.domainActive);
      }
    }
    this.comboT -= dt;
    this.combo.style.opacity = this.comboT > 0 && this.comboCount > 1 ? '1' : '0';
    if (this.comboT <= -0.5) {
      this.comboCount = 0;
      this.comboDmg = 0;
    }
  }

  onHit(byPlayer: boolean, dmg: number): void {
    if (!byPlayer) {
      return;
    }
    if (this.comboT <= 0) {
      this.comboCount = 0;
      this.comboDmg = 0;
    }
    this.comboCount++;
    this.comboDmg += dmg;
    this.comboT = 1.4;
    this.comboN.innerHTML = `${this.comboCount}<em>HITS</em>`;
    this.comboD.textContent = `${Math.round(this.comboDmg)} DMG`;
  }

  banner(text: string, cls = '', sub = '', dur = 1.4): void {
    const b = el('div', `banner ${cls}`, `${text}${sub ? `<small>${sub}</small>` : ''}`);
    this.bannerBox.append(b);
    setTimeout(() => b.remove(), dur * 1000);
  }

  private promptHtml = '';

  setPrompt(html: string | null): void {
    this.prompt.classList.toggle('hidden', !html);
    if (!html) return;
    const out = uiState.touch ? touchPrompt(html) : html;
    // (set every frame by the fight: only touch the DOM when the text changes)
    if (out !== this.promptHtml) {
      this.promptHtml = out;
      this.prompt.innerHTML = out;
    }
  }
}

/** Subtitled dialogue with a typewriter; returns when the reader moves on. */
export class DialogueBox {
  readonly root: HTMLElement;
  private who: HTMLElement;
  private text: HTMLElement;
  private next: HTMLElement;
  private full = '';
  private shown = 0;
  private resolve: (() => void) | null = null;
  private hold = 0;
  /** test mode: advance automatically this many seconds after a line is out, plus `autoPerChar` a letter */
  auto = 0;
  autoPerChar = 0;
  private autoT = 0;
  speed = 45;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'dialogue hidden');
    this.who = el('div', 'who');
    this.text = el('div', 'text');
    this.next = el('div', 'next', '▼');
    this.root.append(this.who, this.text, this.next);
    parent.append(this.root);
  }

  get active(): boolean {
    return this.resolve !== null;
  }

  say(who: string, text: string, style: '' | 'narration' | 'thought' = ''): Promise<void> {
    this.root.classList.remove('hidden', 'narration', 'thought');
    if (style) this.root.classList.add(style);
    this.who.classList.toggle('hidden', !who || style === 'narration');
    this.who.textContent = who;
    this.full = text;
    this.shown = 0;
    this.text.textContent = '';
    this.hold = 0;
    this.autoT = 0;
    this.next.classList.add('hidden');
    return new Promise((res) => {
      this.resolve = res;
    });
  }

  /** Called every frame with whether the player pressed advance. */
  update(dt: number, advance: boolean): void {
    if (!this.resolve) return;
    this.hold += dt;
    const done = this.shown >= this.full.length;
    if (!done) {
      this.shown = Math.min(this.full.length, this.shown + dt * this.speed);
      this.text.textContent = this.full.slice(0, Math.floor(this.shown));
      if (advance && this.hold > 0.15) {
        this.shown = this.full.length;
        this.text.textContent = this.full;
      }
    } else {
      this.next.classList.remove('hidden');
      this.autoT += dt;
      if ((advance && this.hold > 0.2) || (this.auto > 0 && this.autoT > this.auto + this.autoPerChar * this.full.length)) {
        const r = this.resolve;
        this.resolve = null;
        this.root.classList.add('hidden');
        r();
      }
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}

export function makeUIRoot(): HTMLElement {
  return document.getElementById('ui')!;
}

export { el };
