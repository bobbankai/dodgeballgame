// The title screen's backdrop: golden hour at sea. The Wren runs before the wind with Kai at the bow and his
// mother's lantern lit, a lighthouse on a rock and two Armada frigates on the horizon, while the camera drifts
// through a loop of slow shots behind the menu. No story, no control; Flow tears it down when play starts.
import { Level, V, type LookDef } from './Level';
import { Boat, WREN } from '../world/Boat';
import { hold } from '../game/Props';

const LOOK: LookDef = {
  sun: [-0.7, 0.16, 0.62], sunIntensity: 1.05, sunColor: [1.0, 0.72, 0.48],
  sky: { zenith: '#3e6fb8', horizon: '#ffc58a', glow: '#ff8a4a', cloudLit: '#ffd9b0', cloudShade: '#9a7aa8', cover: 0.42, cloudHeight: 1, sunSize: 0.004, stars: 0, moon: false },
  skyColor: [0.66, 0.66, 0.88], groundColor: [0.42, 0.34, 0.3], shadowTint: [0.5, 0.42, 0.78, 0.32], rim: [1.0, 0.76, 0.52, 0.9],
  fog: [1.0, 0.78, 0.6, 0.0035], fogParams: [0.03, 0, 50, 0.95],
  sea: { color: [0.04, 0.2, 0.38, 0.6], shallow: [0.1, 0.5, 0.6, 1.0], level: 0, amp: 0.9, chop: 1.0, storm: 0 },
  grade: [1.04, 1.04, 1.02, 0.15], wind: [0.9, 0, 0.3],
  fx: { bloom: 0.5, vignette: 0.34, gain: [1.04, 1.0, 0.94], flare: 0.75, shafts: 0.45 },
  clouds: 0,
};

export class TitleScene extends Level {
  readonly id = 'title';
  readonly beats = ['title'];
  private wren: Boat | null = null;
  private ships: Boat[] = [];

  async build(): Promise<void> {
    this.setLook(LOOK);
    this.makeSea();
    this.game.collision.minY = -40;
    await this.loadKits('common', 'gulls', 'ships');
    this.wren = new Boat(this.kit, WREN, this.sea, this.game.collision, V(0, 0.2, 0), 0.25);
    this.wren.bob = 0.9;
    for (const [x, z, yaw] of [[-70, 120, 2.2], [-40, 150, 2.5]] as const) {
      const f = new Boat(this.kit, { piece: 'frigate', deckY: 2, deckHalf: [3, 12], length: 30, beam: 8 }, this.sea, this.game.collision, V(x, 0.4, z), yaw);
      this.ships.push(f);
    }
    // a lighthouse on a rock off the port bow
    this.putAt('rock4', 60, -2, 90, 0.7, [2.4, 2.0, 2.4], 'none');
    this.putAt('lighthouse', 60, 4.5, 90, 0, 1, 'none');
    // Kai at the bow with the lantern
    const kai = this.kai;
    this.ctx.pc.enabled = false;
    kai.place(this.wren.deck(0, 3.6), 0.25);
    hold(this.ctx.flow.props, kai, 'lantern', 'R');
  }

  tick(dt: number): void {
    this.wren?.update(this.game.time, dt, this.game);
    for (const s of this.ships) s.update(this.game.time, dt, this.game);
  }

  /** Slow shots around the boat, on a loop, until play starts. */
  async script(): Promise<void> {
    const d = this.dir, w = this.wren!;
    d.cine(true);
    d.act(this.kai, 'idle', true);
    for (;;) {
      const o = w.deck(0, 0);
      d.drift(o.add(V(-14, 4.5, -10)), o.add(V(-9, 3.2, -4)), o.add(V(0, 2.4, 2)), 14);
      await d.wait(13);
      d.drift(o.add(V(6, 1.6, 12)), o.add(V(3, 2.2, 9)), o.add(V(0, 2.0, 2)), 12);
      await d.wait(11);
      d.drift(o.add(V(18, 9, -16)), o.add(V(24, 11, 2)), o.add(V(-20, 6, 60)), 14);
      await d.wait(13);
    }
  }
}
