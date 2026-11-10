// The running game: one clock for everything, the stage, the fighters in the scene, and the frame order.
import { Vector3 } from '@babylonjs/core';
import { Sound } from '../audio/audio';
import { Cam } from '../engine/camera';
import { Gfx } from '../engine/gfx';
import { Stage, STAGES } from '../engine/stage';
import { Vfx } from '../engine/vfx';
import { UI } from '../ui/ui';
import { Input } from './input';
import { Match } from './match';
import { Model } from './model';

export class Game {
  cam: Cam; ui: UI; input = new Input(); sound = new Sound(); vfx: Vfx;
  stage: Stage | null = null;
  models: Model[] = [];
  match: Match | null = null;
  /** seconds since the game started (never slowed) */ time = 0;
  /** slow motion: 1 normal */ slow = 1;
  /** seconds the fight stands still (hit-stop) */ freeze = 0;
  /** cutscenes are being skipped: waits end at once */ rush = false;
  /** what the stage's shadow box and rain follow */ focus = new Vector3(0, 1, 0);
  private waits: { at: number; done: () => void }[] = [];
  private beds: Record<string, number> = {};
  private dt = 0;
  /** called every frame with the frame time (cutscene actors, tutorials) */ tick: ((dt: number) => void) | null = null;

  constructor(public g: Gfx) {
    this.cam = new Cam(g);
    this.ui = new UI(this.input);
    this.vfx = new Vfx(g);
    g.scene.onBeforeAnimationsObservable.add(() => { for (const m of this.models) m.apply(); });
    g.scene.onAfterAnimationsObservable.add(() => { for (const m of this.models) m.swing(this.dt); });
    const wake = () => this.sound.start();
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  }

  /** resolves after s seconds of game time (at once while a cutscene is being skipped) */
  wait(s: number): Promise<void> {
    if (this.rush || s <= 0) return Promise.resolve();
    return new Promise((done) => this.waits.push({ at: this.time + s, done }));
  }

  async setStage(id: string) {
    const def = STAGES[id];
    if (this.stage && this.stage.def.glb === def.glb && def.glb) this.stage.mood(id);
    else { this.stage?.dispose(); this.stage = await Stage.load(this.g, id); }
    this.vfx.rain(def.rain ?? 0);
    for (const b of Object.keys(this.beds)) if (!def.beds?.[b]) { this.sound.bed(b, 0); delete this.beds[b]; }
    for (const [b, v] of Object.entries(def.beds ?? {})) { this.sound.bed(b, v); this.beds[b] = v; }
  }

  async spawn(name: string): Promise<Model> {
    const m = await Model.load(this.g, name);
    this.models.push(m);
    return m;
  }

  despawn(m: Model) {
    this.models.splice(this.models.indexOf(m), 1);
    m.dispose();
  }

  update(dt: number) {
    this.dt = dt;
    this.time += dt;
    for (let i = this.waits.length - 1; i >= 0; i--) if (this.waits[i].at <= this.time || this.rush) this.waits.splice(i, 1)[0].done();
    const frozen = this.freeze > 0;
    if (frozen) this.freeze -= dt;
    const gdt = frozen ? 0 : dt * this.slow;
    this.match?.update(gdt, dt);
    this.tick?.(dt);
    for (const m of this.models) m.update(gdt, dt);
    this.cam.update(dt);
    this.stage?.update(dt, this.focus);
    this.vfx.update(dt, this.focus.x);
    this.sound.update();
  }
}
