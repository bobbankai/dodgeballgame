import type { Renderer } from './Renderer';

/**
 * Dynamic resolution: watches the real frame time and renders at a lower resolution while the
 * device can't hold the frame rate, climbing back up when it has room. The ink-wash look scales
 * down gracefully, and the HUD (HTML) stays sharp whatever the 3D is drawn at.
 *
 * Changing the render size rebuilds the post chain's targets, so it moves in steps, rarely, and
 * never in the first seconds after a load (the shaders are still compiling then).
 */
export class AdaptiveScale {
  /** hardware scaling level: 1 / render scale, so 1 is native and 2 is half resolution */
  level: number;
  private readonly min: number;
  private readonly max: number;
  private acc = 0;
  private frames = 0;
  private last = 0;
  private warm = 0;
  private slowFor = 0;
  private fastFor = 0;
  private since = 0;
  /** seconds of spare frame time before it tries a sharper resolution (doubles each time a climb fails) */
  private climbWait = 10;
  private sinceClimb = 1e9;
  enabled = true;

  /** Starts at the renderer's base scale; may climb to its best scale, or fall to 1 / maxLevel. */
  constructor(private r: Renderer, readonly targetMs = 24, maxLevel = 2.4) {
    this.min = 1 / r.bestScale;
    this.level = 1 / r.baseScale;
    this.max = Math.max(this.level, maxLevel);
  }

  /** Call once a frame with performance.now(). */
  tick(now: number): void {
    if (!this.enabled) return;
    const dt = this.last ? now - this.last : 0;
    this.last = now;
    // a frame over a quarter second is a hitch (a load, a tab switch), not the device's pace
    if (dt <= 0 || dt > 250) return;
    this.warm += dt;
    this.since += dt;
    this.sinceClimb += dt;
    if (this.warm < 5000) return;
    this.acc += dt;
    this.frames++;
    if (this.acc < 1000) return;
    const ms = this.acc / this.frames;
    this.acc = 0;
    this.frames = 0;
    if (ms > this.targetMs * 1.25) {
      this.slowFor++;
      this.fastFor = 0;
    } else if (ms < this.targetMs * 0.72) {
      this.fastFor++;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    // two slow seconds in a row to drop, a stretch of fast ones to climb (dropping is urgent, climbing
    // isn't); a climb that is followed by a drop soon after makes the next one wait twice as long
    if (this.slowFor >= 2 && this.level < this.max && this.since > 2500) {
      if (this.sinceClimb < 25000) this.climbWait = Math.min(160, this.climbWait * 2);
      this.set(Math.min(this.max, this.level * 1.18));
    } else if (this.fastFor >= this.climbWait && this.level > this.min && this.since > 2500) {
      this.sinceClimb = 0;
      this.set(Math.max(this.min, this.level / 1.1));
    }
  }

  private set(level: number): void {
    this.level = Math.round(level * 100) / 100;
    this.slowFor = 0;
    this.fastFor = 0;
    this.since = 0;
    this.r.engine.setHardwareScalingLevel(this.level);
    this.r.resize();
  }
}
