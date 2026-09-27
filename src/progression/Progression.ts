import { Appearance, defaultAppearance, HairStyle } from '../character/Appearance';
import { KITS } from '../data/roster';
import { SKILL_BY_ID, SKILLS, SkillNode } from '../data/skills';
import type { AthleteProfile } from '../game/Athlete';
import type { MatchConfig, MatchResult } from '../game/Match';
import { ATTRIBUTE_KEYS, AttributeKey, MAX_ATTRIBUTE, noPerks, Perks } from '../game/Stats';
import { SaveSystem } from './SaveSystem';

export const MAX_LEVEL = 30;
export const POINTS_PER_LEVEL = 2;

export function xpForLevel(level: number) {
  // XP required to go from `level` to `level + 1`
  return Math.round(140 + 70 * (level - 1) + 9 * Math.pow(level - 1, 2));
}

export interface RewardLine {
  label: string;
  xp: number;
  cred: number;
}

export interface RewardSummary {
  lines: RewardLine[];
  xp: number;
  cred: number;
  stars: number;
  levelsGained: number;
  newLevel: number;
  prevLevel: number;
  prevXpFrac: number;
  newXpFrac: number;
  pointsGained: number;
  firstClear: boolean;
}

/** Player progression: XP/levels, currency, attributes, skills and the player's athlete profile. */
export class Progression {
  constructor(public save: SaveSystem) {}

  get d() {
    return this.save.data;
  }

  perks(): Perks {
    const p = noPerks();
    for (const id of this.d.skills) SKILL_BY_ID[id]?.apply?.(p);
    return p;
  }

  appearance(): Appearance {
    const k = KITS.player;
    return {
      ...defaultAppearance(),
      skin: this.d.look.skin,
      hair: this.d.look.hair,
      hairStyle: this.d.look.hairStyle as HairStyle,
      jersey: k.jersey,
      trim: k.trim,
      shorts: k.shorts,
      accent: k.accent,
      headband: this.d.look.headband,
      wristbands: true,
      brow: 'neutral',
      height: 1.0,
      bulk: 1.0,
    };
  }

  playerProfile(): AthleteProfile {
    const ability = this.d.equippedAbility && this.d.skills.some((s) => SKILL_BY_ID[s]?.ability === this.d.equippedAbility) ? this.d.equippedAbility : null;
    return {
      id: 'player',
      name: this.d.name,
      number: this.d.look.number,
      appearance: this.appearance(),
      attributes: { ...this.d.attributes },
      perks: this.perks(),
      baseHearts: 2,
      personality: 'balanced',
      tier: 3,
      ability,
      ultimate: this.d.ultimateUnlocked ? 'overthrow' : null,
    };
  }

  // ------------------------------------------------------------------ skills
  skillState(node: SkillNode): 'owned' | 'available' | 'locked' {
    if (this.d.skills.includes(node.id)) return 'owned';
    if (this.canBuy(node).ok) return 'available';
    return 'locked';
  }

  canBuy(node: SkillNode): { ok: boolean; reason: string } {
    if (this.d.skills.includes(node.id)) return { ok: false, reason: 'Owned' };
    if (node.needsUltimate && !this.d.ultimateUnlocked) return { ok: false, reason: 'Requires the OVERTHROW ultimate (story)' };
    if (this.d.level < node.level) return { ok: false, reason: `Requires level ${node.level}` };
    const missing = node.requires.filter((r) => !this.d.skills.includes(r));
    if (missing.length) return { ok: false, reason: `Requires ${missing.map((m) => SKILL_BY_ID[m]?.name ?? m).join(' + ')}` };
    if (this.d.cred < node.cost) return { ok: false, reason: `Need ₵${node.cost - this.d.cred} more` };
    return { ok: true, reason: '' };
  }

  anySkillAffordable(): boolean {
    return SKILLS.some((s) => this.canBuy(s).ok);
  }

  buy(node: SkillNode): boolean {
    if (!this.canBuy(node).ok) return false;
    this.d.cred -= node.cost;
    this.d.skills.push(node.id);
    if (node.ability && !this.d.equippedAbility) this.d.equippedAbility = node.ability;
    this.save.save(true);
    return true;
  }

  unlockedAbilities(): string[] {
    return SKILLS.filter((s) => s.ability && this.d.skills.includes(s.id)).map((s) => s.ability!);
  }

  equip(ability: string) {
    if (this.unlockedAbilities().includes(ability)) {
      this.d.equippedAbility = ability;
      this.save.save();
    }
  }

  // ------------------------------------------------------------------ attributes
  raise(k: AttributeKey): boolean {
    if (this.d.attrPoints <= 0 || this.d.attributes[k] >= MAX_ATTRIBUTE) return false;
    this.d.attributes[k]++;
    this.d.attrPoints--;
    this.save.save();
    return true;
  }

  // ------------------------------------------------------------------ rewards
  computeRewards(cfg: MatchConfig, r: MatchResult): RewardSummary {
    const lines: RewardLine[] = [];
    const prev = this.d.campaign.completed[cfg.id];
    const firstClear = r.won && !prev;
    const baseXp = cfg.reward.xp, baseCred = cfg.reward.cred;
    if (r.won) lines.push({ label: firstClear ? 'Victory — first clear' : 'Victory', xp: firstClear ? baseXp : Math.round(baseXp * 0.5), cred: firstClear ? baseCred : Math.round(baseCred * 0.4) });
    else lines.push({ label: 'Match played', xp: Math.round(baseXp * 0.3), cred: Math.round(baseCred * 0.15) });
    const s = r.player;
    if (s) {
      if (s.hits) lines.push({ label: `Hits ×${s.hits}`, xp: s.hits * 8, cred: s.hits * 3 });
      if (s.kos) lines.push({ label: `Knockouts ×${s.kos}`, xp: s.kos * 14, cred: s.kos * 6 });
      if (s.catches) lines.push({ label: `Catches ×${s.catches}`, xp: s.catches * 12, cred: s.catches * 5 });
      if (s.perfectCatches) lines.push({ label: `Perfect catches ×${s.perfectCatches}`, xp: s.perfectCatches * 18, cred: s.perfectCatches * 8 });
      if (s.perfectDodges) lines.push({ label: `Perfect dodges ×${s.perfectDodges}`, xp: s.perfectDodges * 10, cred: s.perfectDodges * 4 });
    }
    if (r.won && r.flawless) lines.push({ label: 'Flawless', xp: Math.round(baseXp * 0.4), cred: Math.round(baseCred * 0.3) });
    const xp = lines.reduce((a, l) => a + l.xp, 0);
    const cred = lines.reduce((a, l) => a + l.cred, 0);
    let stars = 0;
    if (r.won) {
      stars = 1;
      if ((s?.timesHit ?? 9) <= 2) stars = 2;
      if (r.flawless || (s && s.perfectCatches >= 2 && s.timesHit <= 1)) stars = 3;
    }
    const prevLevel = this.d.level;
    const prevXpFrac = this.d.xp / xpForLevel(this.d.level);
    return { lines, xp, cred, stars, levelsGained: 0, newLevel: prevLevel, prevLevel, prevXpFrac, newXpFrac: prevXpFrac, pointsGained: 0, firstClear };
  }

  /** Apply rewards; mutates and saves. Returns the completed summary with level info. */
  applyRewards(cfg: MatchConfig, r: MatchResult, sum: RewardSummary): RewardSummary {
    const d = this.d;
    d.cred += sum.cred;
    d.xp += sum.xp;
    let gained = 0;
    while (d.level < MAX_LEVEL && d.xp >= xpForLevel(d.level)) {
      d.xp -= xpForLevel(d.level);
      d.level++;
      gained++;
      d.attrPoints += POINTS_PER_LEVEL;
    }
    if (d.level >= MAX_LEVEL) d.xp = Math.min(d.xp, xpForLevel(d.level));
    sum.levelsGained = gained;
    sum.newLevel = d.level;
    sum.newXpFrac = d.xp / xpForLevel(d.level);
    sum.pointsGained = gained * POINTS_PER_LEVEL;
    // campaign record
    if (r.won) {
      const prev = d.campaign.completed[cfg.id];
      d.campaign.completed[cfg.id] = {
        stars: Math.max(prev?.stars ?? 0, sum.stars),
        bestTime: prev ? Math.min(prev.bestTime || Infinity, r.duration) : r.duration,
        wins: (prev?.wins ?? 0) + 1,
      };
    }
    const st = d.stats;
    st.matches++;
    if (r.won) st.wins++;
    if (r.player) {
      st.hits += r.player.hits;
      st.catches += r.player.catches;
      st.perfectCatches += r.player.perfectCatches;
      st.kos += r.player.kos;
      st.perfectDodges += r.player.perfectDodges;
      st.throws += r.player.throws;
    }
    d.newGame = false;
    this.save.save(true);
    return sum;
  }

  attributeTotal() {
    return ATTRIBUTE_KEYS.reduce((a, k) => a + this.d.attributes[k], 0);
  }
}
