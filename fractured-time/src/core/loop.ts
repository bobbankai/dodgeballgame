/**
 * Fixed-timestep game loop. Simulation always advances in STEP-second ticks (60 Hz); rendering interpolates between the last
 * two states. Time manipulation never changes the tick rate. It scales the `dt` that individual actors receive:
 *   timeScale.player : Ethan, his echoes, abilities    timeScale.world : enemies, hazards, machinery
 * `hitstop` freezes both for a few ticks on impact.
 */
export const STEP = 1 / 60;
export const MAX_FRAME = 0.1;

export const timeScale = { player: 1, world: 1, hitstop: 0 };

export interface Simulation {
  /** Advance one fixed tick. `dt` is always STEP; read timeScale for per-group scaling. */
  tick(dt: number): void;
  /** Called every rendered frame; alpha in [0,1) is the interpolation between the previous and current tick. */
  frame(alpha: number, realDt: number): void;
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;
  tickCount = 0;
  fps = 60;
  private fpsAcc = 0;
  private fpsFrames = 0;
  paused = false;
  /** When set, the loop advances ticks manually (automated tests). */
  manual = false;

  constructor(private sim: Simulation) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      // a frame's timestamp is when it began, which can be before `start()` read the clock (after a long load, seconds before):
      // a negative step blew the camera's exponential damping up to 1e17 m
      const real = Math.max(0, Math.min((now - this.last) / 1000, MAX_FRAME));
      this.last = now;
      this.fpsAcc += real;
      this.fpsFrames++;
      if (this.fpsAcc > 0.5) {
        this.fps = this.fpsFrames / this.fpsAcc;
        this.fpsAcc = 0;
        this.fpsFrames = 0;
      }
      if (!this.manual && !this.paused) {
        this.acc += real;
        while (this.acc >= STEP) {
          if (timeScale.hitstop > 0) timeScale.hitstop -= 1;
          else this.sim.tick(STEP);
          this.tickCount++;
          this.acc -= STEP;
        }
      }
      this.sim.frame(this.manual ? 0 : this.acc / STEP, real);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Advance n ticks immediately (used by tests and by deterministic cutscene seeking). */
  step(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.sim.tick(STEP);
      this.tickCount++;
    }
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
