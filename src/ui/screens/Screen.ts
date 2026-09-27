import { h } from '../dom';
import type { AudioEngine } from '../../audio/AudioEngine';

/** Base class: a full-screen DOM layer with fade transitions and UI sounds. */
export class Screen {
  readonly el: HTMLElement;
  visible = false;
  constructor(
    parent: HTMLElement,
    protected audio: AudioEngine,
    cls = '',
  ) {
    this.el = h('div', { class: `screen ${cls}` });
    parent.appendChild(this.el);
  }

  show() {
    this.visible = true;
    this.el.style.display = '';
    // next frame so the transition runs
    requestAnimationFrame(() => this.el.classList.add('visible'));
  }

  hide() {
    this.visible = false;
    this.el.classList.remove('visible');
  }

  /** Wire hover/click sounds on interactive children. */
  protected sfx(root: HTMLElement = this.el) {
    root.querySelectorAll<HTMLElement>('button, .chapter, .match-card, .skill-node, .swatch, .tab').forEach((b) => {
      if ((b as any)._sfx) return;
      (b as any)._sfx = true;
      b.addEventListener('mouseenter', () => this.audio.play('uiHover'));
      b.addEventListener('click', () => this.audio.play('uiClick'));
    });
  }
}

export function btn(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return h('button', { class: cls, onclick: onClick }, h('span', {}, label));
}
