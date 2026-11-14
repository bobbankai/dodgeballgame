import type { Sfx as SfxApi } from '@/gameplay/ctx';
import type * as THREE from 'three/webgpu';
import { AudioEngine, type Space } from './engine';
import { RECIPES, LOOPS, MIX } from './recipes';
import { Score } from './score';
import { Voices } from './voice';

/**
 * Sound front door used by gameplay (`play(name, {at, volume, pitch})`). Calls are logged (tests assert on them) and, once the audio
 * context is unlocked by the first user gesture, synthesised by the engine (src/audio/recipes.ts). Also owns the ambience beds, the
 * adaptive score and long loops (the time-slow drone, the boss hover).
 */
export class Sfx implements SfxApi {
  enabled = true;
  log: Array<{ name: string; t: number }> = [];
  readonly engine = new AudioEngine();
  readonly score = new Score(this.engine);
  readonly voices = new Voices(this.engine, `${import.meta.env.BASE_URL}assets/`.replace(/\/\/+/g, '/'));
  private t0 = performance.now();
  private bed: string | null = null;

  private volumes = { master: 0.9, music: 0.7, sfx: 0.9, voice: 1.0 };

  /** Player volume settings (0..1 each), applied now and whenever the context starts. */
  setVolumes(v: { master: number; music: number; sfx: number; voice: number }): void {
    this.volumes = { ...v };
    const e = this.engine;
    if (!e.ctx) return;
    const t = e.ctx.currentTime;
    e.master.gain.setTargetAtTime(0.85 * v.master, t, 0.05);
    e.music.gain.setTargetAtTime(0.42 * v.music / 0.7, t, 0.05);
    e.sfx.gain.setTargetAtTime(0.9 * v.sfx / 0.9, t, 0.05);
    e.amb.gain.setTargetAtTime(0.5 * v.sfx / 0.9, t, 0.05);
    e.voice.gain.setTargetAtTime(v.voice, t, 0.05);
  }

  /** First user gesture: start the audio context, the score and the current ambience. */
  unlock(): void {
    const first = !this.engine.ctx;
    this.engine.unlock();
    if (first && this.engine.ctx) {
      this.setVolumes(this.volumes);
      this.score.start();
      if (this.bed) { const b = this.bed; this.bed = null; this.ambience(b); }
    }
  }

  play(name: string, opts: { at?: THREE.Vector3; volume?: number; pitch?: number } = {}): void {
    if (!this.enabled) return;
    this.log.push({ name, t: performance.now() - this.t0 });
    if (this.log.length > 400) this.log.splice(0, 200);
    const e = this.engine;
    if (!e.ctx) return;
    if (name === 'slow_on') e.startLoop('slow', (o) => LOOPS.slow_drone(e, o), { volume: 0.5, fade: 0.8 });
    if (name === 'slow_off') e.stopLoop('slow', 0.5);
    const r = RECIPES[name];
    if (!r) return;
    const jitter = 1 + (Math.random() - 0.5) * 0.06; // no two hits identical
    r(e, e.out({ at: opts.at, volume: (opts.volume ?? 1) * (MIX[name] ?? 1) }), e.now + 0.005, (opts.pitch ?? 1) * jitter);
  }

  loop(id: string, recipe: keyof typeof LOOPS, opts: { at?: THREE.Vector3; volume?: number } = {}): void {
    const e = this.engine;
    if (!e.ctx) return;
    e.startLoop(id, (o) => LOOPS[recipe](e, o), opts);
  }

  stopLoop(id: string, fade = 0.8): void { this.engine.stopLoop(id, fade); }

  /** The ambience bed for the current space ('amb_facility' / 'amb_storm'), cross-faded; also sets the reverb. */
  ambience(bed: string, space: Space = bed === 'amb_storm' ? 'exterior' : 'interior'): void {
    if (this.bed === bed) return;
    const e = this.engine;
    if (this.bed) e.stopLoop('bed:' + this.bed, 2.5);
    this.bed = bed;
    if (!e.ctx) return;
    e.setSpace(space);
    e.startLoop('bed:' + bed, (o) => LOOPS[bed as keyof typeof LOOPS](e, o), { bus: e.amb, volume: 1, fade: 2.5 });
  }

  listen(cam: THREE.Camera): void { this.engine.listen(cam); }
}
