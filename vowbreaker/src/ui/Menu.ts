import { el, uiState } from './UI';
import type { Audio } from '../audio/Audio';

export interface MenuItem {
  label: string;
  sub?: string;
  disabled?: boolean;
  action: () => void;
}

/** Title, pause and chooser menus: keyboard / pad navigable, mouse clickable. */
export class Menu {
  private root: HTMLElement | null = null;
  private buttons: HTMLButtonElement[] = [];
  private sel = 0;
  private onBack: (() => void) | null = null;

  constructor(private parent: HTMLElement, private audio: Audio) {}

  get open(): boolean {
    return this.root !== null;
  }

  close(): void {
    this.root?.remove();
    this.root = null;
    this.buttons = [];
    this.onBack = null;
  }

  private build(cls: string, head: string, items: MenuItem[], foot = '', grid = false): void {
    this.close();
    const m = el('div', `menu ${cls}`, head);
    const box = grid ? el('div', 'chapters') : m;
    for (const it of items) {
      const b = document.createElement('button');
      b.innerHTML = it.sub ? `${it.label}<span>${it.sub}</span>` : it.label;
      b.disabled = !!it.disabled;
      b.onclick = () => {
        this.audio.unlock();
        this.audio.sfx('confirm');
        it.action();
      };
      b.onmouseenter = () => this.select(this.buttons.indexOf(b));
      box.append(b);
      this.buttons.push(b);
    }
    if (grid) m.append(box);
    if (foot) m.append(el('div', 'note', foot));
    this.parent.append(m);
    this.root = m;
    this.sel = this.buttons.findIndex((b) => !b.disabled);
    this.select(this.sel);
  }

  private select(i: number): void {
    if (i < 0) return;
    this.sel = i;
    this.buttons.forEach((b, k) => b.classList.toggle('sel', k === i));
  }

  title(items: MenuItem[]): void {
    this.build('title', '<div class="logo">誓破り<br>VOWBREAKER</div><div class="logo-sub">a story of curses and the people who carry them</div>', items,
      uiState.touch
        ? 'A story-driven fighting game. Play it on its side: the left thumb moves (the stick appears where you touch), the right thumb strikes, guards, dashes and casts. Tap anywhere to move the story on.'
        : 'A story-driven fighting game. Keyboard: WASD move · J light · K heavy · L guard · Space jump · Shift dash · U I O techniques · P domain · Y vow · E/Enter advance · Tab skip scene · Esc pause. Gamepads work too.');
  }

  pause(items: MenuItem[], onBack: () => void): void {
    this.build('pause', '<h2>Paused</h2>', items);
    this.onBack = onBack;
  }

  list(title: string, items: MenuItem[], onBack: () => void, grid = true): void {
    this.build('pause', `<h2>${title}</h2>`, items, '', grid);
    this.onBack = onBack;
  }

  settings(audio: Audio, extra: MenuItem[], onBack: () => void, onChange: (music: number, sfx: number) => void = () => {}): void {
    this.build('pause', '<h2>Settings</h2>', extra);
    const mk = (label: string, value: number, set: (v: number) => void) => {
      const row = el('label', 'slider', `<span style="width:90px">${label}</span>`);
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = '0';
      inp.max = '1';
      inp.step = '0.05';
      inp.value = String(value);
      inp.oninput = () => set(+inp.value);
      row.append(inp);
      this.root!.insertBefore(row, this.root!.querySelector('button'));
    };
    mk('Music', audio.musicVolume, (v) => {
      audio.setVolumes(v, audio.sfxVolume);
      onChange(v, audio.sfxVolume);
    });
    mk('Effects', audio.sfxVolume, (v) => {
      audio.setVolumes(audio.musicVolume, v);
      onChange(audio.musicVolume, v);
    });
    this.onBack = onBack;
  }

  credits(onDone: () => void): void {
    this.close();
    const c = el('div', 'credits', `<div class="roll">
      <h1>誓破り<br>VOWBREAKER</h1>
      <h3>STORY, CODE, SHADERS, MODELS, ANIMATION, MUSIC</h3><p>made with Claude</p>
      <h3>CAST</h3><p>Itsuki Kagari<br>Sayo Tachibana<br>Genjirō Mikami<br>Sōjin Amagiri<br>Ryōga Hoshino<br>Mio Kagari · Hina Amagiri · Kōta Tachibana</p>
      <h3>BUILT WITH</h3><p>Babylon.js on WebGPU · WGSL<br>Blender (every model and animation, built from Python)<br>Web Audio (every sound, synthesized)</p>
      <h3>TYPE</h3><p>Yuji Syuku · Shippori Mincho · Dela Gothic One · Zen Kaku Gothic New (SIL OFL)</p>
      <h3>INSPIRED BY</h3><p>the cursed-sorcery genre of manga and anime,<br>and the people we couldn't keep.</p>
      <p style="margin-top:80px">For the ones who stayed late, and the ones who waited for them.</p>
      <p style="margin-top:120px;font-size:30px;font-family:var(--brush)">終</p></div>`);
    this.parent.append(c);
    this.root = c;
    const done = () => {
      this.close();
      onDone();
    };
    c.onclick = done;
    this.onBack = done;
    setTimeout(() => {
      if (this.root === c) done();
    }, 72000);
  }

  /** Keyboard / pad navigation, called each frame with the input's presses. */
  nav(up: boolean, down: boolean, confirm: boolean, back: boolean): void {
    if (!this.root) return;
    if (back && this.onBack) {
      this.onBack();
      return;
    }
    if (!this.buttons.length) return;
    const step = (d: number) => {
      let i = this.sel;
      for (let k = 0; k < this.buttons.length; k++) {
        i = (i + d + this.buttons.length) % this.buttons.length;
        if (!this.buttons[i].disabled) break;
      }
      this.select(i);
      this.audio.sfx('select');
    };
    if (up) step(-1);
    if (down) step(1);
    if (confirm) this.buttons[this.sel]?.click();
  }
}
