import { clamp, Ease } from './math';

interface SlowMoRequest {
  scale: number;
  duration: number; // real seconds
  elapsed: number;
  easeIn: number;
  easeOut: number;
}

/**
 * Global time management: delta clamping, time scale, slow motion and hit-stop.
 * All durations of slow-mo / hitstop are specified in REAL (unscaled) seconds so they
 * feel identical regardless of the current scale.
 */
export class Time {
  /** Unscaled seconds since start. */
  realTime = 0;
  /** Scaled gameplay seconds since start. */
  gameTime = 0;
  realDt = 0;
  dt = 0;
  scale = 1;
  /** Extra user-controlled multiplier (pause = 0). */
  baseScale = 1;
  /** Sustained scale set by cinematics (1 = normal). */
  cineScale = 1;
  frame = 0;
  private slowMos: SlowMoRequest[] = [];
  private hitStopTimer = 0;
  private hitStopScale = 0.03;
  private last = performance.now();
  fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;

  tick(now = performance.now()) {
    let raw = (now - this.last) / 1000;
    this.last = now;
    if (!(raw > 0)) raw = 1 / 60;
    this.realDt = clamp(raw, 0, 1 / 20);
    this.realTime += this.realDt;
    this.frame++;

    this.fpsAccum += raw;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    let s = 1;
    for (let i = this.slowMos.length - 1; i >= 0; i--) {
      const r = this.slowMos[i];
      r.elapsed += this.realDt;
      if (r.elapsed >= r.duration) {
        this.slowMos.splice(i, 1);
        continue;
      }
      let w = 1;
      if (r.elapsed < r.easeIn) w = Ease.outQuad(r.elapsed / r.easeIn);
      else if (r.elapsed > r.duration - r.easeOut) w = Ease.inOutSine((r.duration - r.elapsed) / r.easeOut);
      const sc = 1 + (r.scale - 1) * w;
      s = Math.min(s, sc);
    }
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= this.realDt;
      s = Math.min(s, this.hitStopScale);
    }
    this.scale = s * this.baseScale * this.cineScale;
    this.dt = this.realDt * this.scale;
    this.gameTime += this.dt;
  }

  /** Advance by a fixed step (headless simulation / tests). */
  manualStep(step: number) {
    this.last = performance.now();
    this.realDt = step;
    this.realTime += step;
    let s = 1;
    for (let i = this.slowMos.length - 1; i >= 0; i--) {
      const r = this.slowMos[i];
      r.elapsed += step;
      if (r.elapsed >= r.duration) this.slowMos.splice(i, 1);
      else s = Math.min(s, r.scale);
    }
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= step;
      s = Math.min(s, this.hitStopScale);
    }
    this.scale = s * this.baseScale * this.cineScale;
    this.dt = step * this.scale;
    this.gameTime += this.dt;
    this.frame++;
  }

  /** Request a slow motion window. Overlapping requests take the slowest. */
  slowMo(scale: number, duration: number, easeIn = 0.05, easeOut = 0.25) {
    this.slowMos.push({ scale, duration, elapsed: 0, easeIn: Math.min(easeIn, duration * 0.5), easeOut: Math.min(easeOut, duration * 0.5) });
  }

  /** Freeze-frame for impact weight. */
  hitStop(duration: number, scale = 0.03) {
    this.hitStopTimer = Math.max(this.hitStopTimer, duration);
    this.hitStopScale = scale;
  }

  clearEffects() {
    this.slowMos.length = 0;
    this.hitStopTimer = 0;
  }

  get inSlowMo() {
    return this.slowMos.length > 0;
  }

  resetClock() {
    this.last = performance.now();
  }
}

export const time = new Time();
