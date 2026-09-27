import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { SaveData } from '../../progression/SaveSystem';
import { CHAPTERS, chapterMatches, MATCHES } from '../../data/campaign';

const RIVALS: { name: string; tag: string; match: string }[] = [
  { name: "Jax 'Ricochet' Rourke", tag: 'The Rival · bank-shot artist', match: 'm2-3' },
  { name: "Andre 'Brick' Okafor", tag: 'Westbrook powerhouse', match: 'm3-4' },
  { name: 'Vanta', tag: 'The Shade of the Underground', match: 'm5-3' },
  { name: 'Regina Vale', tag: 'The Wall · Crown champion', match: 'm6-3' },
  { name: 'The Monarch', tag: 'Keeper of the Eclipse', match: 'm7-2' },
];

/** Rolling end credits: the road travelled, the rivals beaten and the career in numbers. */
export class CreditsScreen extends Screen {
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
    window.addEventListener('keydown', (e) => {
      if (this.visible && (e.code === 'Escape' || e.code === 'Enter')) this.onBack?.();
    });
  }

  open(d: SaveData, finale: boolean) {
    this.el.innerHTML = '';
    const done = d.campaign.completed;
    const roll = h('div', { class: 'credits-roll' });
    const section = (title: string, ...rows: HTMLElement[]) => roll.append(h('div', { class: 'credits-sec' }, h('div', { class: 'credits-h' }, title), ...rows));
    const row = (a: string, b: string | HTMLElement, cls = '') => h('div', { class: `credits-row ${cls}` }, h('span', {}, a), typeof b === 'string' ? h('b', {}, b) : b);

    // the road
    const road: HTMLElement[] = [];
    for (const c of CHAPTERS) {
      const ms = chapterMatches(c.id);
      const stars = ms.reduce((s, m) => s + (done[m.id]?.stars ?? 0), 0);
      const cleared = ms.every((m) => m.id in done);
      road.push(row(`${c.num}. ${c.name} — ${c.location}`, cleared ? h('b', {}, h('i', { class: 'st' }, '★ '), `${stars}/${ms.length * 3}`) : '—', cleared ? '' : 'dim'));
    }
    section('The Road', ...road);
    section('Rivals', ...RIVALS.map((r) => row(r.name, r.match in done ? 'Defeated' : 'Undefeated', r.match in done ? '' : 'dim')).map((el, i) => (el.title = RIVALS[i].tag, el)));
    const st = d.stats;
    const matchesWon = MATCHES.filter((m) => m.id in done).length;
    section(
      'Career',
      row('Level', String(d.level)),
      row('Matches played', String(st.matches)),
      row('Wins', String(st.wins)),
      row('Campaign matches cleared', `${matchesWon}/${MATCHES.length}`),
      row('Hits landed', String(st.hits)),
      row('Knockouts', String(st.kos)),
      row('Catches', `${st.catches} (${st.perfectCatches} perfect)`),
      row('Perfect dodges', String(st.perfectDodges)),
      row('Ultimates unleashed', String(st.ultimates)),
    );
    section(
      'Built with',
      row('Rendering', 'three.js'),
      row('Post-processing', 'pmndrs/postprocessing'),
      row('Type', 'Barlow Condensed · Inter'),
      row('Characters & animation', 'Procedural, generated at runtime'),
      row('Arenas & crowds', 'Procedural, generated at runtime'),
      row('Music & sound', 'Synthesised live with Web Audio'),
    );
    roll.append(h('div', { class: 'credits-end' }, finale ? 'The court is yours.' : 'Thanks for playing.'));

    const left = h(
      'div',
      { class: 'credits-left' },
      h('div', { class: 'logo' }, h('div', { class: 'l1', style: 'font-size:110px' }, 'Overthrow'), h('div', { class: 'l2' }, finale ? 'CHAMPION' : 'A DODGEBALL STORY')),
      finale ? h('div', { class: 'credits-champ' }, `${d.name.toUpperCase()} — the one who broke the Eclipse.`) : null,
      h('div', { class: 'btn-row', style: 'margin-top:26px' }, btn(finale ? 'Continue' : 'Back', () => this.onBack?.(), finale ? 'btn primary' : 'btn')),
    );
    this.el.append(h('div', { class: 'screen-dim', style: 'background:linear-gradient(90deg, rgba(5,7,11,.9) 30%, rgba(5,7,11,.6))' }), left, h('div', { class: 'credits-view' }, roll));
    // roll speed scales with content so it always reads at the same pace
    requestAnimationFrame(() => {
      const hgt = roll.scrollHeight;
      roll.style.animationDuration = `${Math.max(20, hgt / 38)}s`;
    });
    this.sfx();
    this.show();
  }
}
