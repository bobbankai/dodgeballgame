import { h, ICONS, svg } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Progression } from '../../progression/Progression';
import { CampaignMatch, CHAPTERS, chapterMatches, chapterUnlocked, isUnlocked } from '../../data/campaign';

/** Campaign map: chapters across the top, match cards, and a briefing panel. */
export class CareerScreen extends Screen {
  private chapterIdx = 0;
  private selected: CampaignMatch | null = null;
  onPlay: ((m: CampaignMatch) => void) | null = null;
  onBack: (() => void) | null = null;
  onSkills: (() => void) | null = null;
  onChapterPreview: ((arena: string) => void) | null = null;

  constructor(parent: HTMLElement, audio: AudioEngine, private prog: Progression) {
    super(parent, audio);
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Escape') this.onBack?.();
      if (e.code === 'Enter' && this.selected && isUnlocked(this.selected, this.prog.d.campaign.completed)) this.onPlay?.(this.selected);
    });
  }

  /** Select the next unplayed match automatically. */
  focusNext() {
    const done = this.prog.d.campaign.completed;
    for (let c = CHAPTERS.length - 1; c >= 0; c--) {
      if (chapterUnlocked(CHAPTERS[c], done)) {
        this.chapterIdx = c;
        break;
      }
    }
    const ms = chapterMatches(CHAPTERS[this.chapterIdx].id);
    this.selected = ms.find((m) => !(m.id in done) && isUnlocked(m, done)) ?? ms[ms.length - 1];
  }

  build() {
    const d = this.prog.d;
    const done = d.campaign.completed;
    this.el.innerHTML = '';
    const ch = CHAPTERS[this.chapterIdx];
    this.onChapterPreview?.(ch.arena);
    const chapters = h('div', { class: 'chapters' });
    CHAPTERS.forEach((c, i) => {
      const ms = chapterMatches(c.id);
      const cleared = ms.filter((m) => m.id in done).length;
      const unlocked = chapterUnlocked(c, done);
      const el = h(
        'div',
        { class: `chapter panel${i === this.chapterIdx ? ' active' : ''}${unlocked ? '' : ' locked'}` },
        h('div', { class: 'num' }, `CHAPTER ${c.num}`),
        h('div', { class: 'nm' }, unlocked ? c.name : '???'),
        h('div', { class: 'loc' }, unlocked ? c.location : 'Locked'),
        h('div', { class: 'prog' }, h('div', { style: `width:${(cleared / ms.length) * 100}%` })),
      );
      if (unlocked)
        el.addEventListener('click', () => {
          this.chapterIdx = i;
          const list = chapterMatches(c.id);
          this.selected = list.find((m) => !(m.id in done) && isUnlocked(m, done)) ?? list[0];
          this.build();
        });
      chapters.append(el);
    });

    const cards = h('div', { class: 'matches' });
    const list = chapterMatches(ch.id);
    const nextId = list.find((m) => !(m.id in done) && isUnlocked(m, done))?.id;
    list.forEach((m, i) => {
      const unlocked = isUnlocked(m, done);
      const rec = done[m.id];
      const stars = h('div', { class: 'stars' });
      for (let s = 0; s < 3; s++) {
        const st = svg(ICONS.star);
        if (rec && s < rec.stars) st.classList.add('on');
        stars.append(st);
      }
      const card = h(
        'div',
        { class: `match-card panel${unlocked ? '' : ' locked'}${rec ? ' done' : ''}${m.id === nextId ? ' next' : ''}${this.selected === m ? ' active' : ''}`, style: this.selected === m ? 'border-color: var(--accent)' : '' },
        h('div', { class: 'num', style: 'font-family:var(--display);font-size:13px;letter-spacing:3px;color:var(--muted)' }, `${ch.num}-${i + 1}`),
        h('div', { class: 'mt' }, m.title),
        h('div', { class: 'md' }, unlocked ? `vs ${m.opponent}` : 'Complete the previous match to unlock'),
        h('div', { class: 'tags' }, ...m.tags.map((t) => h('span', { class: `tag${m.boss ? ' boss' : ''}${t === 'Survival' || t === 'Time Attack' || t === 'Special Rules' || t === 'Tutorial' ? ' mode' : ''}` }, t))),
        stars,
      );
      if (unlocked)
        card.addEventListener('click', () => {
          this.selected = m;
          this.build();
        });
      cards.append(card);
    });

    const brief = h('div', { class: 'briefing panel' });
    const m = this.selected && list.includes(this.selected) ? this.selected : null;
    if (m) {
      const cfg = m.build();
      const unlocked = isUnlocked(m, done);
      brief.append(
        h('div', { class: 'tags' }, ...m.tags.map((t) => h('span', { class: `tag${m.boss ? ' boss' : ''}` }, t))),
        h('div', { class: 'bt' }, m.title),
        h('div', { class: 'bs' }, m.desc),
      );
      const roster = h('div', { class: 'roster' });
      const opp = cfg.mode === 'survival' ? (cfg.waves ?? []).flat().slice(0, 4) : cfg.away;
      for (const p of opp.slice(0, 4)) {
        roster.append(
          h(
            'div',
            { class: 'roster-row' },
            h('div', { class: 'sw', style: `background:#${p.appearance.jersey.toString(16).padStart(6, '0')}` }),
            h('div', { class: 'rn' }, p.title ?? p.name),
            h('div', { class: 'rp' }, `${p.personality === 'boss' ? 'Boss' : p.personality} · ${'★'.repeat(Math.max(1, Math.min(6, p.tier)))}`),
          ),
        );
      }
      brief.append(h('div', { style: 'font-family:var(--display);letter-spacing:3px;font-size:14px;color:var(--muted)' }, cfg.mode === 'survival' ? `WAVES: ${cfg.waves?.length ?? 1}` : 'OPPONENTS'), roster);
      const info = [cfg.mode === 'survival' ? 'Survive every wave' : cfg.mode === 'timeAttack' ? `${cfg.timeLimit}s time limit` : `First to ${cfg.roundsToWin} round${cfg.roundsToWin > 1 ? 's' : ''}`, `${cfg.homeMates.length + 1}v${cfg.mode === 'survival' ? '?' : cfg.away.length}`, `Reward ${cfg.reward.xp} XP · ₵${cfg.reward.cred}`];
      brief.append(h('div', { class: 'bs' }, info.join('  ·  ')));
      if (cfg.objective) brief.append(h('div', { class: 'bs', style: 'color:var(--gold)' }, cfg.objective));
      const play = btn(done[m.id] ? 'Replay' : m.mode === 'tutorial' ? 'Start Practice' : 'Play Match', () => this.onPlay?.(m), 'btn primary');
      play.disabled = !unlocked;
      brief.append(h('div', { class: 'btn-row', style: 'margin-top:10px' }, play));
    }

    this.el.append(
      h('div', { class: 'screen-dim solid', style: 'background:linear-gradient(90deg, rgba(5,7,11,.92) 55%, rgba(5,7,11,.55))' }),
      h(
        'div',
        { class: 'page', style: 'right:470px' },
        h(
          'div',
          { class: 'page-head' },
          h('div', { class: 'page-title' }, h('small', {}, `CAREER · LEVEL ${d.level} · ₵${d.cred.toLocaleString()}`), ch.name),
          h('div', { class: 'btn-row' }, btn('Skills & Stats', () => this.onSkills?.()), btn('Back', () => this.onBack?.())),
        ),
        h('div', { class: 'bs', style: 'color:var(--muted);margin:-10px 0 16px;font-size:15px' }, `${ch.location} — ${ch.blurb}`),
        chapters,
        cards,
      ),
      brief,
    );
    if (d.attrPoints > 0) this.el.append(h('div', { class: 'toast panel', style: 'top:auto;bottom:30px;right:auto;left:5vw' }, `${d.attrPoints} attribute points to spend`));
    this.sfx();
  }

  override show() {
    if (!this.selected) this.focusNext();
    this.build();
    super.show();
  }
}
