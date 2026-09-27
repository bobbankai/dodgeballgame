import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import { KITS } from '../../data/roster';
import { QUICK_KITS } from '../../data/campaign';

export interface QuickOptions {
  arena: string;
  size: number;
  difficulty: number;
  kit: string;
}

const ARENA_NAMES: Record<string, string> = {
  rec: 'Maplewood Rec',
  street: 'Harbor Street',
  school: 'Westbrook Fieldhouse',
  rooftop: 'Skyline Rooftop',
  underground: 'The Pit',
  stadium: 'Crown Arena',
  eclipse: 'Eclipse Court',
};

const DIFFS = ['Rookie', 'Amateur', 'League', 'Pro', 'Elite', 'Legend'];

export class QuickMatchScreen extends Screen {
  opts: QuickOptions = { arena: 'rec', size: 3, difficulty: 2, kit: 'harbor' };
  onPlay: ((o: QuickOptions) => void) | null = null;
  onBack: (() => void) | null = null;
  unlockedArenas: string[] = ['rec'];

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Escape') this.onBack?.();
    });
  }

  build() {
    this.el.innerHTML = '';
    const o = this.opts;
    const seg = (items: [string, string][], get: () => string, set: (v: string) => void, locked: (v: string) => boolean = () => false) => {
      const row = h('div', { class: 'seg', style: 'flex-wrap:wrap' });
      for (const [v, label] of items) {
        const b = h('button', { class: get() === v ? 'on' : '' }, label) as HTMLButtonElement;
        if (locked(v)) {
          b.disabled = true;
          b.style.opacity = '0.3';
          b.textContent = `${label} 🔒`;
        }
        b.addEventListener('click', () => {
          set(v);
          this.build();
        });
        row.append(b);
      }
      return row;
    };
    const panel = h(
      'div',
      { class: 'panel', style: 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,92vw);padding:30px;display:flex;flex-direction:column;gap:18px' },
      h('div', { class: 'page-title' }, h('small', {}, 'EXHIBITION'), 'Quick Match'),
      h('div', { class: 'setting' }, h('label', {}, 'Arena'), seg(Object.entries(ARENA_NAMES), () => o.arena, (v) => (o.arena = v), (v) => !this.unlockedArenas.includes(v))),
      h('div', { class: 'setting' }, h('label', {}, 'Team size'), seg([['1', '1 v 1'], ['2', '2 v 2'], ['3', '3 v 3']], () => String(o.size), (v) => (o.size = Number(v)))),
      h('div', { class: 'setting' }, h('label', {}, 'Difficulty'), seg(DIFFS.map((d, i) => [String(i + 1), d] as [string, string]), () => String(o.difficulty), (v) => (o.difficulty = Number(v)))),
      h('div', { class: 'setting' }, h('label', {}, 'Opponent'), seg(QUICK_KITS.map((k) => [k, KITS[k].name] as [string, string]), () => o.kit, (v) => (o.kit = v))),
      h('div', { class: 'bs', style: 'color:var(--muted);font-size:13px' }, 'Exhibition matches award reduced XP and credits.'),
      h('div', { class: 'btn-row', style: 'justify-content:flex-end' }, btn('Back', () => this.onBack?.()), btn('Play', () => this.onPlay?.(this.opts), 'btn primary')),
    );
    this.el.append(h('div', { class: 'screen-dim solid' }), panel);
    this.sfx();
  }

  override show() {
    if (!this.unlockedArenas.includes(this.opts.arena)) this.opts.arena = this.unlockedArenas[0] ?? 'rec';
    this.build();
    super.show();
  }
}

export const DIFF_NAMES = DIFFS;
export { ARENA_NAMES };
