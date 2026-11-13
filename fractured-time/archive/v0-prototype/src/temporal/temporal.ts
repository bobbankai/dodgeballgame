import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import { Player, ABILITY_COST, type PlayerSnapshot } from '@/player/player';
import { ReplayControls, type ControlFrame } from '@/player/controls';
import type { Enemy, EnemySnapshot } from '@/ai/enemy';
import { ghostify } from './ghost';
import { bus } from '@/core/events';

/** Anything that must travel back in time with Ethan: machinery, crates, doors, hazards. Register with `temporal.register`. */
export interface Rewindable {
  snapshot(): unknown;
  restore(s: unknown): void;
}

interface Snap {
  time: number;
  player: PlayerSnapshot;
  enemies: Array<{ e: Enemy; s: EnemySnapshot }>;
  objects: unknown[];
}

const HISTORY_SECONDS = 6;
const HISTORY = HISTORY_SECONDS * 60;
const REWIND_SECONDS = 4;
const SLOW_SCALE = 0.26;
const SLOW_DRAIN = 4.5;
const ECHO_RECORD = 4 * 60;
const ECHO_TAIL = 100;

interface EchoRec { actor: Player; replay: ReplayControls; fade: THREE.UniformNode<number>; age: number; length: number; ending: boolean }

/**
 * The temporal systems, all driven by the fixed tick and all with explicit ownership of what they touch:
 *  - SLOW sets the world time group's scale (enemies, hazards, registered machinery) and drains energy; Ethan stays at full speed.
 *  - REWIND restores a bounded snapshot history (player, enemies, registered rewindables). It never touches story flags, checkpoints or
 *    the save, and it cannot lower Ethan's health. History is recorded only while time flows forward.
 *  - ECHO replays the last few seconds of Ethan's recorded control frames on a second body that hits, blocks and triggers mechanisms.
 *  - SHIFT flips the level's timeline state (geometry + collision + atmosphere), see `world/timeline.ts`.
 */
export class Temporal {
  slowActive = false;
  rewinding = false;
  echoes: EchoRec[] = [];
  private history: Snap[] = [];
  private rewindLeft = 0;
  private frames: ControlFrame[] = [];
  private starts: Array<{ pos: THREE.Vector3; yaw: number }> = [];
  private objects = new Set<Rewindable>();
  private fractureT = 0;
  private shiftHandlers: Array<(state: number) => void> = [];
  timelineState = 0;
  timelineCount = 2;
  private attached = false;
  private busy = false;

  constructor(private g: Game) {}

  register(o: Rewindable): () => void {
    this.objects.add(o);
    return () => this.objects.delete(o);
  }

  onShift(fn: (state: number) => void): void { this.shiftHandlers.push(fn); }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.g.player.onRecord = (f) => {
      this.frames.push(f);
      this.starts.push({ pos: this.g.player.pos.clone(), yaw: this.g.player.yaw });
      if (this.frames.length > ECHO_RECORD) { this.frames.shift(); this.starts.shift(); }
    };
  }

  // --- abilities -----------------------------------------------------------------------------------------------

  activate(name: 'slow' | 'rewind' | 'echo' | 'shift'): void {
    this.attach();
    const p = this.g.player;
    switch (name) {
      case 'slow': {
        this.slowActive = !this.slowActive;
        p.slowActive = this.slowActive;
        this.g.fx.pulse(p.pos.clone().setY(p.pos.y + 1), 'slow');
        this.g.sfx.play(this.slowActive ? 'slow_on' : 'slow_off');
        bus.emit('ability', { name: 'slow', phase: this.slowActive ? 'start' : 'end' });
        break;
      }
      case 'rewind': this.beginRewind(); break;
      case 'echo': void this.spawnEcho(); break;
      case 'shift': this.shift(); break;
    }
  }

  worldScaleTarget(): number {
    return this.slowActive ? SLOW_SCALE : 1;
  }

  readiness(): boolean[] {
    const e = this.g.player.energy;
    return [e >= ABILITY_COST.slow || this.slowActive, e >= ABILITY_COST.rewind && this.history.length > 30, e >= ABILITY_COST.echo && this.frames.length > 40, e >= ABILITY_COST.shift];
  }

  // --- recording -----------------------------------------------------------------------------------------------

  /** Called each tick while time flows forward. */
  record(dt: number): void {
    this.attach();
    if (this.slowActive) {
      this.g.player.energy -= SLOW_DRAIN * dt;
      if (this.g.player.energy <= 0) { this.g.player.energy = 0; this.activate('slow'); }
    }
    const g = this.g;
    this.history.push({
      time: g.time,
      player: g.player.snapshot(),
      enemies: (g.enemies as Enemy[]).map((e) => ({ e, s: e.snapshot() })),
      objects: [...this.objects].map((o) => o.snapshot()),
    });
    if (this.history.length > HISTORY) this.history.shift();
  }

  // --- rewind --------------------------------------------------------------------------------------------------

  private beginRewind(): void {
    if (this.history.length < 20 || this.rewinding) return;
    this.rewinding = true;
    this.slowActive = false;
    this.g.player.slowActive = false;
    this.rewindLeft = Math.min(this.history.length, REWIND_SECONDS * 60);
    this.g.player.state = 'busy';
    this.g.sfx.play('rewind_on');
    this.g.fx.pulse(this.g.player.pos.clone().setY(this.g.player.pos.y + 1), 'rewind');
    bus.emit('ability', { name: 'rewind', phase: 'start' });
    // the echo recorded before the rewind no longer matches the timeline
    this.frames = []; this.starts = [];
  }

  /** @returns true while a rewind is playing back (the normal simulation is suspended). */
  tick(_dt: number): boolean {
    if (!this.rewinding) return false;
    const g = this.g;
    // play back two snapshots per tick (2x speed), landing on the oldest one reached
    for (let i = 0; i < 2 && this.history.length > 0 && this.rewindLeft > 0; i++) {
      const s = this.history.pop()!;
      this.rewindLeft--;
      g.player.restore(s.player);
      for (const { e, s: es } of s.enemies) e.restore(es);
      let k = 0;
      for (const o of this.objects) o.restore(s.objects[k++]);
      g.player.state = 'busy';
    }
    g.player.anim.update(0);
    g.player.syncFromBody();
    if (this.rewindLeft <= 0 || this.history.length === 0) {
      this.rewinding = false;
      g.player.state = 'loco';
      g.sfx.play('rewind_off');
      bus.emit('ability', { name: 'rewind', phase: 'end' });
    }
    return true;
  }

  // --- echo ----------------------------------------------------------------------------------------------------

  private async spawnEcho(): Promise<void> {
    if (this.busy || this.frames.length < 40) return;
    this.busy = true;
    const g = this.g;
    const frames = this.frames.slice();
    const start = this.starts[0];
    const replay = new ReplayControls(frames);
    const actor = await Player.create(g, replay, start.pos, start.yaw);
    const fade = ghostify(actor.root);
    actor.name = 'Echo';
    g.scene.add(actor.root);
    this.echoes.push({ actor, replay, fade, age: 0, length: frames.length, ending: false });
    g.fx.pulse(start.pos.clone().setY(start.pos.y + 1), 'echo');
    g.sfx.play('echo_on');
    bus.emit('ability', { name: 'echo', phase: 'start' });
    this.busy = false;
  }

  tickEcho(dt: number): void {
    for (const e of this.echoes) {
      e.age++;
      if (!e.ending) e.actor.tick(dt);
      if (e.age > e.length + ECHO_TAIL || !e.actor.alive) e.ending = true;
      if (e.ending) (e.fade as any).value = Math.max(0, (e.fade as any).value - dt * 1.8);
    }
    this.echoes = this.echoes.filter((e) => {
      if (e.ending && (e.fade as any).value <= 0.01) { e.actor.dispose(); bus.emit('ability', { name: 'echo', phase: 'end' }); return false; }
      return true;
    });
  }

  syncVisual(alpha: number): void {
    for (const e of this.echoes) e.actor.syncVisual(alpha);
  }

  // --- timeline shift ------------------------------------------------------------------------------------------

  private shift(): void {
    this.timelineState = (this.timelineState + 1) % this.timelineCount;
    this.fractureT = 1;
    this.g.fx.pulse(this.g.player.pos.clone().setY(this.g.player.pos.y + 1), 'shift');
    this.g.sfx.play('shift');
    for (const h of this.shiftHandlers) h(this.timelineState);
    bus.emit('ability', { name: 'shift', phase: 'start' });
  }

  // --- look ----------------------------------------------------------------------------------------------------

  updateLook(dt: number): void {
    const u = this.g.post.u;
    const k = (cur: number, to: number, rate: number) => cur + (to - cur) * Math.min(1, dt * rate);
    u.slow.value = k(u.slow.value, this.slowActive ? 1 : this.g.player.openingActive ? 0.75 : 0, 6);
    u.rewind.value = k(u.rewind.value, this.rewinding ? 1 : 0, this.rewinding ? 10 : 5);
    this.fractureT = Math.max(0, this.fractureT - dt * 0.9);
    u.fracture.value = this.fractureT * this.fractureT;
  }
}
