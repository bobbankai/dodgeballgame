/**
 * Fixed-step simulation clock. Gameplay, physics, AI and animation advance in exact 1/60 s steps so
 * that combat timing does not depend on the frame rate; rendering happens once per real frame.
 *
 * In test mode (`?test`) the harness drives the clock with `advance()` instead of real time, which
 * makes headless runs deterministic regardless of how slowly the software renderer draws.
 */
export class Clock {
  static readonly STEP = 1 / 60;
  /** Longest real frame we simulate in one go; beyond this the game slows down instead of spiralling. */
  static readonly MAX_FRAME = 0.25;

  /** Seconds of game time since start (only advanced by steps). */
  time = 0;
  /** Scaled time multiplier: hit-stop and slow motion lower it briefly. */
  timeScale = 1;
  private acc = 0;
  private hitStopLeft = 0;
  private slowMoLeft = 0;
  private slowMoScale = 1;
  steps = 0;

  /**
   * Accumulates real seconds and returns how many fixed steps to run. `alpha` is the interpolation
   * fraction between the last two steps, for smoothing rendered transforms.
   */
  accumulate(realDt: number): number {
    const dt = Math.min(realDt, Clock.MAX_FRAME);
    this.acc += dt * this.effectiveScale();
    // Hit-stop and slow motion last for real seconds, not for game seconds.
    if (this.hitStopLeft > 0) this.hitStopLeft = Math.max(0, this.hitStopLeft - dt);
    if (this.slowMoLeft > 0) this.slowMoLeft = Math.max(0, this.slowMoLeft - dt);
    let n = 0;
    while (this.acc >= Clock.STEP) {
      this.acc -= Clock.STEP;
      n++;
    }
    return n;
  }

  get alpha(): number {
    return this.acc / Clock.STEP;
  }

  /** Called once per fixed step by the game loop. */
  tick(): void {
    this.time += Clock.STEP;
    this.steps++;
  }

  private effectiveScale(): number {
    let s = this.timeScale;
    if (this.hitStopLeft > 0) s *= 0.05;
    if (this.slowMoLeft > 0) s *= this.slowMoScale;
    return s;
  }

  /** Freezes the action for a few frames on heavy impacts (weight and readability). */
  hitStop(seconds: number): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, seconds);
  }

  slowMotion(seconds: number, scale: number): void {
    this.slowMoLeft = seconds;
    this.slowMoScale = scale;
  }

  get inHitStop(): boolean {
    return this.hitStopLeft > 0;
  }
}
