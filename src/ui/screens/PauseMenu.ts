import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import { controlsList } from './SettingsScreen';

export class PauseMenu extends Screen {
  onResume: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;
  private showControls = false;
  canRestart = true;

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
  }

  build(title: string) {
    this.el.innerHTML = '';
    const card = h('div', { class: 'pause-card panel' }, h('div', { class: 'page-title' }, h('small', {}, title.toUpperCase()), 'Paused'));
    const list = h('div', { class: 'menu-list' });
    const item = (label: string, fn: () => void) => list.append(h('button', { class: 'menu-btn', onclick: fn }, label));
    item('Resume', () => this.onResume?.());
    if (this.canRestart) item('Restart Match', () => this.onRestart?.());
    item(this.showControls ? 'Hide Controls' : 'Controls', () => {
      this.showControls = !this.showControls;
      this.build(title);
    });
    item('Settings', () => this.onSettings?.());
    item('Quit to Menu', () => this.onQuit?.());
    card.append(list);
    if (this.showControls) card.append(controlsList());
    this.el.append(h('div', { class: 'screen-dim solid' }), card);
    this.sfx();
  }

  open(title: string) {
    this.build(title);
    this.show();
  }
}
