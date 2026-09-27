import { h, ICONS } from '../dom';
import { btn, Screen } from './Screen';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { Progression } from '../../progression/Progression';
import { ABILITIES, BRANCHES, SKILLS, SkillNode } from '../../data/skills';
import { ATTRIBUTE_INFO, ATTRIBUTE_KEYS, MAX_ATTRIBUTE } from '../../game/Stats';

/** Skill tree, attribute allocation and ability loadout. */
export class SkillsScreen extends Screen {
  private tab: 'tree' | 'attributes' | 'loadout' = 'tree';
  private selected: SkillNode | null = null;
  onBack: (() => void) | null = null;

  constructor(parent: HTMLElement, audio: AudioEngine, private prog: Progression) {
    super(parent, audio);
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Escape') this.onBack?.();
    });
  }

  build() {
    const d = this.prog.d;
    this.el.innerHTML = '';
    const tabs = h('div', { class: 'tabs' });
    const mk = (id: typeof this.tab, label: string) => {
      const t = h('button', { class: `tab${this.tab === id ? ' on' : ''}` }, label);
      t.addEventListener('click', () => {
        this.tab = id;
        this.build();
      });
      tabs.append(t);
    };
    mk('tree', 'Skill Tree');
    mk('attributes', `Attributes${d.attrPoints ? ` (${d.attrPoints})` : ''}`);
    mk('loadout', 'Abilities');
    const head = h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'page-title' }, h('small', {}, `LEVEL ${d.level} · ${d.name}`), 'Skills & Stats'),
      h('div', { class: 'btn-row' }, h('div', { class: 'points-badge' }, `₵ ${d.cred.toLocaleString()}`), h('div', { class: 'points-badge' }, `${d.attrPoints} PTS`), btn('Back', () => this.onBack?.())),
    );
    const body = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column;gap:16px;margin-top:12px' });
    if (this.tab === 'tree') body.append(this.buildTree());
    else if (this.tab === 'attributes') body.append(this.buildAttributes());
    else body.append(this.buildLoadout());
    this.el.append(h('div', { class: 'screen-dim solid' }), h('div', { class: 'page' }, head, tabs, body));
    this.sfx();
  }

  private buildTree() {
    const layout = h('div', { class: 'skill-layout' });
    const tree = h('div', { class: 'skill-tree' });
    for (const br of BRANCHES) {
      const col = h('div', { class: 'branch' }, h('div', { class: 'branch-head', style: `color:${br.color}` }, br.name, h('div', { style: 'font-family:var(--body);font-size:12px;font-style:normal;font-weight:400;color:var(--muted);letter-spacing:0;text-transform:none;margin-top:2px' }, br.blurb)));
      for (const s of SKILLS.filter((x) => x.branch === br.id)) {
        const state = this.prog.skillState(s);
        const node = h(
          'div',
          { class: `skill-node panel ${state}${this.selected === s ? ' selected' : ''}` },
          h('div', { class: 'ic', html: (ICONS as any)[s.icon] ?? ICONS.star }),
          h('div', {}, h('div', { class: 'sn' }, s.name), h('div', { class: 'sc' }, state === 'owned' ? 'Owned' : `₵${s.cost} · Lv ${s.level}`)),
        );
        if (s.kind === 'ability' || s.kind === 'ultimate') node.append(h('div', { class: `kd ${s.kind}` }, s.kind === 'ability' ? 'Ability' : 'Ult'));
        node.addEventListener('click', () => {
          this.selected = s;
          this.build();
        });
        col.append(node);
      }
      tree.append(col);
    }
    layout.append(tree);
    const det = h('div', { class: 'skill-detail panel' });
    const s = this.selected ?? SKILLS.find((x) => this.prog.skillState(x) === 'available') ?? SKILLS[0];
    this.selected = s;
    const br = BRANCHES.find((b) => b.id === s.branch)!;
    const state = this.prog.skillState(s);
    const can = this.prog.canBuy(s);
    det.append(
      h('div', { class: 'dt', style: `color:${br.color}` }, `${br.name} · ${s.kind}`),
      h('div', { class: 'dn' }, s.name),
      h('div', { class: 'dd', style: 'font-weight:600;color:#fff' }, s.desc),
      h('div', { class: 'dd' }, s.detail),
      h('div', { class: 'dreq' }, state === 'owned' ? 'Unlocked.' : `Cost ₵${s.cost} · Requires level ${s.level}${s.requires.length ? ` · After ${s.requires.map((r) => SKILLS.find((x) => x.id === r)?.name).join(', ')}` : ''}`),
    );
    if (state !== 'owned') {
      const b = btn(can.ok ? `Unlock — ₵${s.cost}` : can.reason, () => {
        if (this.prog.buy(s)) {
          this.audio.play('uiUnlock');
          this.build();
        }
      }, 'btn primary');
      b.disabled = !can.ok;
      det.append(b);
    }
    layout.append(det);
    return layout;
  }

  private buildAttributes() {
    const d = this.prog.d;
    const wrap = h('div', { class: 'panel', style: 'padding:24px;max-width:860px' });
    const rows = h('div', { class: 'stat-rows' });
    for (const k of ATTRIBUTE_KEYS) {
      const v = d.attributes[k];
      const pips = h('div', { class: 'stat-pips' });
      for (let i = 1; i <= MAX_ATTRIBUTE; i++) pips.append(h('i', { class: i <= v ? 'on' : '' }));
      const plus = h('button', { class: 'plus' }, '+') as HTMLButtonElement;
      plus.disabled = d.attrPoints <= 0 || v >= MAX_ATTRIBUTE;
      plus.addEventListener('click', () => {
        if (this.prog.raise(k)) {
          this.audio.play('uiConfirm');
          this.build();
        }
      });
      rows.append(h('div', { class: 'stat-row' }, h('div', { class: 'sl' }, ATTRIBUTE_INFO[k].name, h('small', {}, ATTRIBUTE_INFO[k].desc)), pips, h('div', { class: 'sv' }, String(v)), plus));
    }
    wrap.append(h('div', { class: 'bs', style: 'color:var(--muted);margin-bottom:14px' }, `Earn ${2} points every level. Attributes make you stronger; skills change how you play.`), rows);
    return wrap;
  }

  private buildLoadout() {
    const unlocked = this.prog.unlockedAbilities();
    const wrap = h('div', { style: 'display:flex;gap:14px;flex-wrap:wrap' });
    if (!unlocked.length) wrap.append(h('div', { class: 'panel', style: 'padding:24px;max-width:600px' }, h('div', { class: 'dd' }, 'No abilities yet. Unlock Power Shot, Phantom Throw or Blink Step in the skill tree, then equip one here. Abilities are triggered with Q and cost energy.')));
    for (const id of Object.keys(ABILITIES)) {
      const a = ABILITIES[id];
      const have = unlocked.includes(id);
      const eq = this.prog.d.equippedAbility === id;
      const card = h(
        'div',
        { class: `panel skill-node${eq ? ' owned' : ''}${have ? '' : ' locked'}`, style: 'width:300px;padding:18px;flex-direction:column;align-items:flex-start' },
        h('div', { class: 'sn', style: 'font-size:24px' }, a.name),
        h('div', { class: 'sc' }, a.desc),
        h('div', { class: 'sc' }, `Energy: ${a.cost}`),
        h('div', { class: 'sc', style: 'color:var(--gold)' }, eq ? 'EQUIPPED (Q)' : have ? 'Click to equip' : 'Locked'),
      );
      if (have)
        card.addEventListener('click', () => {
          this.prog.equip(id);
          this.audio.play('uiConfirm');
          this.build();
        });
      wrap.append(card);
    }
    const ult = h(
      'div',
      { class: `panel skill-node${this.prog.d.ultimateUnlocked ? ' owned' : ' locked'}`, style: 'width:300px;padding:18px;flex-direction:column;align-items:flex-start' },
      h('div', { class: 'sn', style: 'font-size:24px;color:#ffb13b' }, 'OVERTHROW'),
      h('div', { class: 'sc' }, 'Ultimate (R): leap, gather the court’s energy and hurl an unstoppable, homing throw that detonates on impact.'),
      h('div', { class: 'sc', style: 'color:var(--gold)' }, this.prog.d.ultimateUnlocked ? 'UNLOCKED' : 'Awakens during the City League'),
    );
    wrap.append(ult);
    return wrap;
  }

  override show() {
    this.build();
    super.show();
  }
}
