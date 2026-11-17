import type { GraphicsSettings } from '../config/presets';

/**
 * Render resolution. Desktop: the display size times min(devicePixelRatio, cap) times the preset's scale. Phones and
 * tablets: a render height per preset (a phone in landscape is ~390 CSS px tall at 3x density; a ratio cap rendered the
 * low presets at a smear). Dynamic resolution then scales that between `minDynamicScale` and 1 to hold the target frame
 * time: it drops quickly when frames run long and climbs back slowly, in steps large enough to be worth a resize.
 */
export class Resolution {
  /** current dynamic factor (1 = the preset's own resolution) */
  dynamic = 1;
  private overBudget = 0;
  private underBudget = 0;

  constructor(private touch: boolean) {}

  pixelRatio(s: GraphicsSettings, cssHeight: number): number {
    const dpr = (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1;
    const base = this.touch ? Math.min(dpr, Math.max(1, s.touchLines / Math.max(1, cssHeight)))
      : Math.min(dpr, s.maxPixelRatio) * s.renderScale;
    return base * this.dynamic;
  }

  /**
   * Feed the frame time (ms, GPU time when known); returns true when the dynamic factor changed (the caller resizes).
   * Headless tests never call this (their timing is meaningless).
   */
  adapt(s: GraphicsSettings, ms: number): boolean {
    if (!s.dynamicResolution) {
      if (this.dynamic !== 1) { this.dynamic = 1; return true; }
      return false;
    }
    const budget = 1000 / s.targetFps;
    if (ms > budget * 1.12) { this.overBudget++; this.underBudget = 0; } else if (ms < budget * 0.8) { this.underBudget++; this.overBudget = 0; } else {
      this.overBudget = Math.max(0, this.overBudget - 1);
      this.underBudget = Math.max(0, this.underBudget - 1);
    }
    let next = this.dynamic;
    if (this.overBudget > 20) next = Math.max(s.minDynamicScale, this.dynamic * 0.9);
    else if (this.underBudget > 180) next = Math.min(1, this.dynamic * 1.06);
    if (Math.abs(next - this.dynamic) < 0.02) return false;
    this.dynamic = next;
    this.overBudget = this.underBudget = 0;
    return true;
  }
}
