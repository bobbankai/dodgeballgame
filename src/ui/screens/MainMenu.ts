import { h } from '../dom';
import { Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Progression } from '../../progression/Progression';
import { xpForLevel } from '../../progression/Progression';

export interface MainMenuActions {
  continueCareer: () => void;
  newCareer: () => void;
  quickMatch: () => void;
  skills: () => void;
  settings: () => void;
  credits: () => void;
}

export class MainMenu extends Screen {
  private list: HTMLElement;
  private profile: HTMLElement;
  private focusIdx = 0;

  constructor(parent: HTMLElement, audio: AudioEngine, private prog: Progression, private actions: MainMenuActions) {
    super(parent, audio, 'main-menu-screen');
    this.list = h('div', { class: 'menu-list' });
    this.profile = h('div', { class: 'menu-profile' });
    this.el.append(
      h('div', { class: 'screen-dim' }),
      h(
        'div',
        { class: 'main-menu' },
        h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'Overthrow'), h('div', { class: 'l2' }, 'DODGEBALL ASCENSION')),
        this.list,
      ),
      this.profile,
      h('div', { class: 'menu-footer' }, 'WASD move · MOUSE aim · LMB throw (hold to charge) · RMB catch · SPACE dodge · SHIFT sprint'),
    );
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const btns = Array.from(this.list.querySelectorAll('button')).filter((b) => !(b as HTMLButtonElement).disabled);
      if (e.code === 'ArrowDown' || e.code === 'KeyS') this.focusIdx = (this.focusIdx + 1) % btns.length;
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.focusIdx = (this.focusIdx - 1 + btns.length) % btns.length;
      else if (e.code === 'Enter') {
        btns[this.focusIdx]?.click();
        return;
      } else return;
      this.audio.play('uiHover');
      btns.forEach((b, i) => b.classList.toggle('focus', i === this.focusIdx));
    });
  }

  refresh() {
    const d = this.prog.d;
    const hasProgress = !d.newGame || d.tutorialDone;
    this.list.innerHTML = '';
    const item = (label: string, sub: string, fn: () => void, disabled = false) => {
      const b = h('button', { class: 'menu-btn', onclick: fn }, label, h('small', {}, sub));
      if (disabled) b.disabled = true;
      this.list.append(b);
    };
    if (hasProgress) item('Continue', `Career · Level ${d.level}`, this.actions.continueCareer);
    item(hasProgress ? 'New Career' : 'Start Career', hasProgress ? 'Overwrites current progress' : 'Your journey begins at the rec center', this.actions.newCareer);
    item('Quick Match', 'Exhibition against the AI', this.actions.quickMatch);
    item('Skills & Stats', `${d.attrPoints} points · ₵${d.cred}`, this.actions.skills, !hasProgress);
    item('Settings', 'Graphics · Audio · Controls', this.actions.settings);
    item('Credits', '', this.actions.credits);
    this.focusIdx = 0;
    (this.list.firstElementChild as HTMLElement)?.classList.add('focus');
    this.profile.innerHTML = '';
    if (hasProgress) {
      const frac = d.xp / xpForLevel(d.level);
      this.profile.append(
        h('div', { class: 'nm' }, d.name),
        h('div', { class: 'lv' }, `Level ${d.level}`),
        h('div', { class: 'xp' }, h('div', { style: `width:${(frac * 100).toFixed(1)}%` })),
        h('div', { class: 'cr' }, `₵ ${d.cred.toLocaleString()}`),
      );
    }
    this.sfx();
  }

  override show() {
    this.refresh();
    super.show();
  }
}
