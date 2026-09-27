import { h } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { MatchResult } from '../../game/Match';
import type { RewardSummary } from '../../progression/Progression';
import { ICONS, svg } from '../dom';

/** Post-match: verdict, stats, animated rewards, XP bar and level-up/unlock callouts. */
export class ResultsScreen extends Screen {
  onContinue: (() => void) | null = null;
  onRetry: (() => void) | null = null;

  constructor(parent: HTMLElement, audio: AudioEngine) {
    super(parent, audio);
  }

  open(title: string, r: MatchResult, sum: RewardSummary | null, unlocks: string[]) {
    this.el.innerHTML = '';
    const s = r.player;
    const verdict = h('div', { class: `results-verdict ${r.won ? 'win' : 'lose'}` }, r.won ? 'Victory' : 'Defeat');
    const stars = h('div', { class: 'stars', style: 'gap:8px' });
    if (sum && r.won)
      for (let i = 0; i < 3; i++) {
        const st = svg(ICONS.star);
        st.setAttribute('style', 'width:34px;height:34px');
        if (i < sum.stars) {
          st.classList.add('on');
          st.style.animation = `levelUp .5s ${0.5 + i * 0.25}s both`;
        }
        stars.append(st);
      }
    const grid = h('div', { class: 'results-grid' });
    const stat = (k: string, v: string | number) => grid.append(h('div', { class: 'results-stat' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'k' }, k)));
    stat('Score', `${r.score[0]} – ${r.score[1]}`);
    stat('Hits', s?.hits ?? 0);
    stat('Catches', s?.catches ?? 0);
    stat('Knockouts', s?.kos ?? 0);
    stat('Perfect catches', s?.perfectCatches ?? 0);
    stat('Dodges', s?.dodges ?? 0);
    stat('Times hit', s?.timesHit ?? 0);
    stat('Time', `${Math.floor(r.duration / 60)}:${Math.floor(r.duration % 60).toString().padStart(2, '0')}`);
    const card = h('div', { class: 'results-card panel' }, h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-end' }, h('div', {}, h('div', { class: 'page-title', style: 'font-size:22px' }, h('small', {}, title.toUpperCase())), verdict), stars), grid);
    if (sum) {
      const rows = h('div', { class: 'reward-rows' });
      sum.lines.forEach((l, i) => {
        rows.append(h('div', { class: 'reward-row', style: `animation-delay:${0.3 + i * 0.12}s` }, h('span', {}, l.label), h('span', {}, h('b', {}, `+${l.xp} XP`), '  ', h('span', { style: 'color:var(--muted)' }, `₵${l.cred}`))));
      });
      rows.append(h('div', { class: 'reward-row', style: `animation-delay:${0.3 + sum.lines.length * 0.12}s;border-bottom:none` }, h('b', { style: 'color:#fff' }, 'TOTAL'), h('span', {}, h('b', {}, `+${sum.xp} XP`), '  ', h('b', { style: 'color:var(--text)' }, `+₵${sum.cred}`))));
      card.append(rows);
      const bar = h('div', { class: 'xpbar' }, h('div', { style: `width:${(sum.prevXpFrac * 100).toFixed(1)}%` }));
      card.append(h('div', { style: 'display:flex;justify-content:space-between;font-family:var(--display);letter-spacing:2px;font-size:14px;color:var(--muted)' }, h('span', {}, `LEVEL ${sum.prevLevel}`), h('span', {}, sum.levelsGained ? `LEVEL ${sum.newLevel}` : '')), bar);
      setTimeout(() => {
        const fill = bar.firstElementChild as HTMLElement;
        if (sum.levelsGained > 0) {
          fill.style.width = '100%';
          setTimeout(() => {
            fill.style.transition = 'none';
            fill.style.width = '0%';
            requestAnimationFrame(() => {
              fill.style.transition = '';
              fill.style.width = `${(sum.newXpFrac * 100).toFixed(1)}%`;
            });
            card.insertBefore(h('div', { class: 'levelup' }, `Level up! → ${sum.newLevel}`, h('div', { style: 'font-size:16px;font-style:normal;color:var(--text);letter-spacing:2px' }, `+${sum.pointsGained} attribute points`)), bar.nextSibling);
            this.audio.stinger('levelup');
          }, 1300);
        } else fill.style.width = `${(sum.newXpFrac * 100).toFixed(1)}%`;
      }, 900);
    }
    for (const u of unlocks) card.append(h('div', { class: 'unlock-banner' }, u));
    const row = h('div', { class: 'btn-row', style: 'justify-content:flex-end;margin-top:6px' });
    if (!r.won && this.onRetry) row.append(btn('Retry', () => this.onRetry?.()));
    row.append(btn('Continue', () => this.onContinue?.(), 'btn primary'));
    card.append(row);
    this.el.append(h('div', { class: 'screen-dim solid' }), h('div', { class: 'results' }, card));
    this.sfx();
    this.show();
  }
}
