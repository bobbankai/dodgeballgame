// Status effects. Each fighter carries a StatusEffects set:
//   burn   — damage over time while it lasts; re-applying refreshes it and adds intensity up to a cap;
//            water (wading, rain) puts it out faster
//   bleed  — a build-up meter filled by cutting hits; when it fills it bursts for a share of max health
//            and empties; it drains slowly on its own
//   frost  — a build-up meter; when full the fighter is chilled: slower to move and to attack for a while
//   blight — the black flame's touch: healing is halved and the Ember does not refill while it lasts
// The set does not hurt anyone itself: update() returns the damage that ticked this frame and the owner
// applies it (so death, the HUD and the combat log all go through the owner's usual path).
export type StatusKind = 'burn' | 'bleed' | 'frost' | 'blight';

export interface StatusState {
  /** seconds left (timed effects) */
  time: number;
  /** stacks / intensity */
  level: number;
  /** build-up 0..100 (meters) */
  build: number;
  /** a meter that popped stays "active" for this long (chill) */
  active: number;
}

export interface StatusTuning {
  burnDps: number;
  burnTime: number;
  burnMaxLevel: number;
  bleedBurst: number;
  bleedDrain: number;
  frostDrain: number;
  chillTime: number;
  chillSlow: number;
  blightTime: number;
  blightHeal: number;
}

export const DEFAULT_TUNING: StatusTuning = {
  burnDps: 4,
  burnTime: 4,
  burnMaxLevel: 3,
  bleedBurst: 0.14,
  bleedDrain: 6,
  frostDrain: 5,
  chillTime: 5,
  chillSlow: 0.4,
  blightTime: 8,
  blightHeal: 0.5,
};

export interface StatusEvents {
  /** a meter filled (bleed burst, chill) or an effect started */
  onTrigger?: (kind: StatusKind, amount: number) => void;
  /** an effect ended */
  onEnd?: (kind: StatusKind) => void;
}

export class StatusEffects {
  readonly s: Record<StatusKind, StatusState> = {
    burn: { time: 0, level: 0, build: 0, active: 0 },
    bleed: { time: 0, level: 0, build: 0, active: 0 },
    frost: { time: 0, level: 0, build: 0, active: 0 },
    blight: { time: 0, level: 0, build: 0, active: 0 },
  };
  /** how resistant to each kind (multiplies build-up / duration; 0 = immune) */
  resist: Partial<Record<StatusKind, number>> = {};
  /** set by the owner each frame: standing in water puts fire out */
  wet = false;
  readonly t: StatusTuning;

  constructor(public maxHp: () => number, tuning: Partial<StatusTuning> = {}, public ev: StatusEvents = {}) {
    this.t = { ...DEFAULT_TUNING, ...tuning };
  }

  private r(kind: StatusKind): number { return this.resist[kind] ?? 1; }

  /**
   * apply an effect: timed effects (burn, blight) take seconds and a level; meters (bleed, frost) take
   * build-up points
   */
  apply(kind: StatusKind, amount: number, level = 1): void {
    const r = this.r(kind);
    if (r <= 0) return;
    const st = this.s[kind];
    switch (kind) {
      case 'burn': {
        const wasOn = st.time > 0;
        st.time = Math.max(st.time, (amount > 0 ? amount : this.t.burnTime) * r);
        // level 0 refreshes without stacking (standing in a fire keeps you burning, not burning harder)
        st.level = wasOn ? Math.min(this.t.burnMaxLevel, st.level + level) : Math.max(1, Math.min(this.t.burnMaxLevel, level));
        if (!wasOn) this.ev.onTrigger?.('burn', st.level);
        break;
      }
      case 'blight': {
        const wasOn = st.time > 0;
        st.time = Math.max(st.time, (amount > 0 ? amount : this.t.blightTime) * r);
        st.level = 1;
        if (!wasOn) this.ev.onTrigger?.('blight', 1);
        break;
      }
      case 'bleed':
      case 'frost': {
        if (kind === 'frost' && st.active > 0) { st.active = Math.max(st.active, this.t.chillTime * 0.5); return; }
        st.build = Math.min(100, st.build + amount * r);
        break;
      }
    }
  }

  /** advance; returns the damage that ticked this frame (burn + bleed bursts) */
  update(dt: number): number {
    let dmg = 0;
    const T = this.t;
    // burn
    const b = this.s.burn;
    if (b.time > 0) {
      dmg += T.burnDps * b.level * dt;
      b.time -= dt * (this.wet ? 4 : 1);
      if (b.time <= 0) { b.time = 0; b.level = 0; this.ev.onEnd?.('burn'); }
    }
    // bleed: bursts when full
    const bl = this.s.bleed;
    if (bl.build >= 100) {
      const burst = this.maxHp() * T.bleedBurst;
      dmg += burst;
      bl.build = 0;
      bl.active = 1.0;
      this.ev.onTrigger?.('bleed', burst);
    } else bl.build = Math.max(0, bl.build - T.bleedDrain * dt);
    if (bl.active > 0) bl.active = Math.max(0, bl.active - dt);
    // frost: chill when full
    const f = this.s.frost;
    if (f.build >= 100 && f.active <= 0) {
      f.active = T.chillTime;
      f.build = 0;
      this.ev.onTrigger?.('frost', T.chillSlow);
    } else if (f.active <= 0) f.build = Math.max(0, f.build - T.frostDrain * dt);
    if (f.active > 0) {
      f.active -= dt;
      if (f.active <= 0) { f.active = 0; this.ev.onEnd?.('frost'); }
    }
    // blight
    const k = this.s.blight;
    if (k.time > 0) {
      k.time -= dt;
      if (k.time <= 0) { k.time = 0; k.level = 0; this.ev.onEnd?.('blight'); }
    }
    return dmg;
  }

  has(kind: StatusKind): boolean {
    const st = this.s[kind];
    return kind === 'burn' || kind === 'blight' ? st.time > 0 : kind === 'frost' ? st.active > 0 : st.active > 0;
  }

  /** multiplier on movement and attack speed (chill slows) */
  get speedFactor(): number { return this.s.frost.active > 0 ? 1 - this.t.chillSlow : 1; }

  /** multiplier on healing received (blight) */
  get healFactor(): number { return this.s.blight.time > 0 ? this.t.blightHeal : 1; }

  /** can the Ember meter refill? */
  get emberRegen(): boolean { return this.s.blight.time <= 0; }

  /** what to show: active effects and filling meters */
  view(): { kind: StatusKind; value: number; active: boolean }[] {
    const out: { kind: StatusKind; value: number; active: boolean }[] = [];
    const b = this.s.burn;
    if (b.time > 0) out.push({ kind: 'burn', value: Math.min(1, b.time / this.t.burnTime), active: true });
    const bl = this.s.bleed;
    if (bl.build > 0 || bl.active > 0) out.push({ kind: 'bleed', value: bl.active > 0 ? 1 : bl.build / 100, active: bl.active > 0 });
    const f = this.s.frost;
    if (f.build > 0 || f.active > 0) out.push({ kind: 'frost', value: f.active > 0 ? f.active / this.t.chillTime : f.build / 100, active: f.active > 0 });
    const k = this.s.blight;
    if (k.time > 0) out.push({ kind: 'blight', value: k.time / this.t.blightTime, active: true });
    return out;
  }

  /** remove everything (respawn, healing at a shrine) */
  clear(): void {
    for (const k of Object.keys(this.s) as StatusKind[]) this.s[k] = { time: 0, level: 0, build: 0, active: 0 };
  }

  /** remove one effect (cleansing) */
  cure(kind: StatusKind): void {
    const was = this.has(kind);
    this.s[kind] = { time: 0, level: 0, build: 0, active: 0 };
    if (was) this.ev.onEnd?.(kind);
  }
}

/** what a hit of a damage type inflicts on top of its damage (build-up points / seconds) */
export function inflictionOf(type: string, damage: number, heavy: boolean): { kind: StatusKind; amount: number; level?: number } | null {
  switch (type) {
    case 'fire': return { kind: 'burn', amount: heavy ? 5 : 3.5, level: heavy ? 2 : 1 };
    case 'frost': return { kind: 'frost', amount: damage * 2.2 };
    case 'shadow': return { kind: 'blight', amount: 8 };
    case 'slash': return { kind: 'bleed', amount: damage * (heavy ? 1.1 : 0.8) };
    default: return null;
  }
}
