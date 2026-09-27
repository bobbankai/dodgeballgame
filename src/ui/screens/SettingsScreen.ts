import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Settings } from '../../progression/SaveSystem';

export function controlsList() {
  const rows: [string, string][] = [
    ['WASD', 'Move'],
    ['Mouse', 'Aim / camera'],
    ['Left click (tap)', 'Quick throw'],
    ['Left click (hold)', 'Charge throw — release at the flash for a perfect release'],
    ['Right click', 'Catch — press just before the ball arrives (perfect = last instant)'],
    ['Right click while charging', 'Pump fake (skill)'],
    ['Right click while holding', 'Block / reflect (skill)'],
    ['Space', 'Dodge (uses a charge)'],
    ['Shift', 'Sprint'],
    ['E', 'Pass to teammate / call for pass'],
    ['Q', 'Ability'],
    ['R', 'Ultimate (when meter is full)'],
    ['Tab', 'Cycle target'],
    ['V / Middle click', 'Swap shoulder'],
    ['Esc', 'Pause'],
  ];
  const el = h('div', { class: 'controls-list' });
  for (const [k, v] of rows) el.append(h('kbd', {}, k), h('span', {}, v));
  el.append(h('kbd', {}, 'Gamepad'), h('span', {}, 'RT throw · LT catch · A dodge · LB sprint · X ability · Y ultimate · B pass'));
  return el;
}

/** Graphics / audio / control settings. Changes apply immediately. */
export class SettingsScreen extends Screen {
  onBack: (() => void) | null = null;
  onChange: ((s: Settings) => void) | null = null;
  settings!: Settings;

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Escape') this.onBack?.();
    });
  }

  open(s: Settings) {
    this.settings = s;
    this.build();
    this.show();
  }

  private build() {
    const s = this.settings;
    this.el.innerHTML = '';
    const change = () => this.onChange?.(s);
    const seg = <T extends string>(items: T[], get: () => T, set: (v: T) => void) => {
      const row = h('div', { class: 'seg' });
      for (const it of items) {
        const b = h('button', { class: get() === it ? 'on' : '' }, it);
        b.addEventListener('click', () => {
          set(it);
          row.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          change();
        });
        row.append(b);
      }
      return row;
    };
    const slider = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt = (v: number) => `${Math.round(v * 100)}%`) => {
      const val = h('span', { style: 'float:right;color:var(--text)' }, fmt(get()));
      const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()) }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        set(Number(inp.value));
        val.textContent = fmt(get());
        change();
      });
      return h('div', { class: 'setting' }, h('label', {}, label, val), inp);
    };
    const QUALITY_DESC = {
      low: 'No shadows or post effects. For older laptops and integrated graphics.',
      medium: 'Shadows, bloom, lens streaks and film finish.',
      high: 'Adds polished-floor reflections, ambient occlusion, soft shadows and cinematic depth of field.',
      ultra: 'Adds 4× MSAA, 4K shadow maps, sharper reflections and occlusion, up to 2× pixel density.',
    } as const;
    const qDesc = h('div', { class: 'setting-desc' }, QUALITY_DESC[s.quality]);
    const grid = h(
      'div',
      { class: 'settings-grid' },
      h(
        'div',
        { class: 'setting', style: 'grid-column: 1 / -1' },
        h('label', {}, 'Graphics quality'),
        seg(['low', 'medium', 'high', 'ultra'] as const, () => s.quality, (v) => {
          s.quality = v;
          qDesc.textContent = QUALITY_DESC[v];
        }),
        qDesc,
      ),
      h('div', { class: 'setting' }, h('label', {}, 'Adaptive resolution'), seg(['on', 'off'], () => (s.autoQuality ? 'on' : 'off'), (v) => (s.autoQuality = v === 'on'))),
      slider('Mouse sensitivity', 0.2, 3, 0.05, () => s.mouseSensitivity, (v) => (s.mouseSensitivity = v), (v) => v.toFixed(2)),
      slider('Gamepad sensitivity', 0.2, 3, 0.05, () => s.padSensitivity, (v) => (s.padSensitivity = v), (v) => v.toFixed(2)),
      h('div', { class: 'setting' }, h('label', {}, 'Invert Y'), seg(['off', 'on'], () => (s.invertY ? 'on' : 'off'), (v) => (s.invertY = v === 'on'))),
      slider('Camera shake', 0, 1.5, 0.05, () => s.cameraShake, (v) => (s.cameraShake = v)),
      slider('Master volume', 0, 1, 0.01, () => s.masterVolume, (v) => (s.masterVolume = v)),
      slider('Music', 0, 1, 0.01, () => s.musicVolume, (v) => (s.musicVolume = v)),
      slider('Effects', 0, 1, 0.01, () => s.sfxVolume, (v) => (s.sfxVolume = v)),
      h('div', { class: 'setting' }, h('label', {}, 'Show FPS'), seg(['off', 'on'], () => (s.showFps ? 'on' : 'off'), (v) => (s.showFps = v === 'on'))),
    );
    this.el.append(
      h('div', { class: 'screen-dim solid' }),
      h(
        'div',
        { class: 'page', style: 'max-width:1200px;margin:0 auto' },
        h('div', { class: 'page-head' }, h('div', { class: 'page-title' }, h('small', {}, 'OPTIONS'), 'Settings'), btn('Done', () => this.onBack?.(), 'btn primary')),
        h('div', { style: 'display:grid;grid-template-columns:1.2fr 1fr;gap:30px;overflow-y:auto' }, h('div', { class: 'panel', style: 'padding:24px' }, grid), h('div', { class: 'panel', style: 'padding:24px' }, h('div', { class: 'dt', style: 'font-family:var(--display);letter-spacing:3px;color:var(--gold);margin-bottom:12px' }, 'CONTROLS'), controlsList())),
      ),
    );
    this.sfx();
  }
}
