import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import { HAIR_COLORS, SKIN_TONES } from '../../character/Appearance';
import type { Look } from '../../progression/SaveSystem';

const STYLES = ['swept', 'short', 'buzz', 'spiky', 'afro', 'ponytail', 'bun', 'mohawk', 'bald'];

/** New-career character setup: name, number, skin tone, hair. Live 3D preview via callback. */
export class CreateScreen extends Screen {
  look: Look = { skin: SKIN_TONES[2], hair: HAIR_COLORS[0], hairStyle: 'swept', number: 7, headband: false };
  name = 'ACE';
  onChange: ((name: string, look: Look) => void) | null = null;
  onDone: ((name: string, look: Look) => void) | null = null;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
  }

  build() {
    this.el.innerHTML = '';
    const nameInput = h('input', { class: 'name-input', maxlength: '12', value: this.name, spellcheck: 'false' }) as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.name = nameInput.value.toUpperCase().replace(/[^A-Z0-9 ._-]/g, '').slice(0, 12);
      nameInput.value = this.name;
      this.emit();
    });
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    const swatches = (values: number[], get: () => number, set: (v: number) => void) => {
      const row = h('div', { class: 'swatches' });
      for (const v of values) {
        const s = h('div', { class: `swatch${get() === v ? ' on' : ''}`, style: `background:#${v.toString(16).padStart(6, '0')}` });
        s.addEventListener('click', () => {
          set(v);
          row.querySelectorAll('.swatch').forEach((x) => x.classList.remove('on'));
          s.classList.add('on');
          this.emit();
        });
        row.append(s);
      }
      return row;
    };
    const seg = (items: string[], get: () => string, set: (v: string) => void) => {
      const row = h('div', { class: 'seg', style: 'flex-wrap:wrap' });
      for (const it of items) {
        const b = h('button', { class: get() === it ? 'on' : '' }, it);
        b.addEventListener('click', () => {
          set(it);
          row.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          this.emit();
        });
        row.append(b);
      }
      return row;
    };
    const numInput = h('input', { type: 'range', min: '0', max: '99', value: String(this.look.number) }) as HTMLInputElement;
    const numLabel = h('span', {}, `#${this.look.number}`);
    numInput.addEventListener('input', () => {
      this.look.number = Number(numInput.value);
      numLabel.textContent = `#${this.look.number}`;
      this.emit();
    });
    const panel = h(
      'div',
      { class: 'panel', style: 'position:absolute;right:5vw;top:50%;transform:translateY(-50%);width:440px;padding:26px;display:flex;flex-direction:column;gap:16px' },
      h('div', { class: 'page-title' }, h('small', {}, 'NEW CAREER'), 'Your Player'),
      h('div', { class: 'setting' }, h('label', {}, 'Name'), nameInput),
      h('div', { class: 'setting' }, h('label', {}, 'Skin tone'), swatches(SKIN_TONES, () => this.look.skin, (v) => (this.look.skin = v))),
      h('div', { class: 'setting' }, h('label', {}, 'Hair style'), seg(STYLES, () => this.look.hairStyle, (v) => (this.look.hairStyle = v))),
      h('div', { class: 'setting' }, h('label', {}, 'Hair colour'), swatches(HAIR_COLORS, () => this.look.hair, (v) => (this.look.hair = v))),
      h('div', { class: 'setting' }, h('label', {}, 'Headband'), seg(['off', 'on'], () => (this.look.headband ? 'on' : 'off'), (v) => (this.look.headband = v === 'on'))),
      h('div', { class: 'setting' }, h('label', {}, h('span', {}, 'Jersey number '), numLabel), numInput),
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, btn('Back', () => this.onBack?.()), btn('Begin Career', () => this.onDone?.(this.name || 'ACE', this.look), 'btn primary')),
    );
    this.el.append(h('div', { class: 'screen-dim', style: 'background:linear-gradient(90deg, rgba(7,9,14,0) 30%, rgba(7,9,14,.85) 70%)' }), panel);
    this.sfx();
  }

  private emit() {
    this.onChange?.(this.name, this.look);
  }

  override show() {
    this.build();
    super.show();
    this.emit();
  }
}
