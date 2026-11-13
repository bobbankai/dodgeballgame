import * as THREE from 'three/webgpu';
import type { CharacterInstance, ClipMeta } from '@/assets/loader';

export interface PlayOpts {
  fade?: number;
  speed?: number;
  /** override the clip's authored looping */
  loop?: boolean;
  /** restart even if already playing */
  restart?: boolean;
  /** start offset in frames */
  from?: number;
}

export type FrameEventHandler = (clip: string, event: string, frame: number) => void;

/**
 * Animation state: crossfaded playback of the Blender-authored actions, with frame-accurate events.
 * `frame` is in the clip's authored 30 fps, so gameplay windows (hit, cancel, parry, i-frames) line up with what is on screen.
 */
export class CharacterAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  current: string | null = null;
  private lastFrame = 0;
  onEvent: FrameEventHandler | null = null;
  /** playback speed multiplier for the whole character (time slow) */
  timeScale = 1;

  constructor(readonly inst: CharacterInstance) {
    this.mixer = new THREE.AnimationMixer(inst.root);
  }

  meta(name: string | null = this.current): ClipMeta | null {
    return name ? this.inst.meta[name] ?? null : null;
  }

  has(name: string): boolean {
    return this.inst.clips.has(name);
  }

  private action(name: string): THREE.AnimationAction {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.inst.clips.get(name);
      if (!clip) throw new Error(`Missing animation clip "${name}"`);
      a = this.mixer.clipAction(clip);
      this.actions.set(name, a);
    }
    return a;
  }

  play(name: string, o: PlayOpts = {}): THREE.AnimationAction {
    const meta = this.inst.meta[name];
    const loop = o.loop ?? meta?.loop ?? false;
    const next = this.action(name);
    if (this.current === name && !o.restart) {
      next.timeScale = o.speed ?? next.timeScale;
      return next;
    }
    const prev = this.current ? this.actions.get(this.current) : null;
    next.reset();
    next.enabled = true;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.timeScale = o.speed ?? 1;
    next.setEffectiveWeight(1);
    if (o.from) next.time = o.from / 30;
    if (prev && prev !== next) {
      const fade = o.fade ?? 0.12;
      if (fade > 0) next.crossFadeFrom(prev, fade, false);
      else prev.stop();
    }
    next.play();
    this.current = name;
    this.lastFrame = o.from ?? 0;
    return next;
  }

  /** Jump straight to a clip at a frame with no blending (rewind, checkpoint restore, cutscene seeking). */
  restore(name: string, frame: number): void {
    const a = this.action(name);
    this.current = null;
    this.mixer.stopAllAction();
    this.play(name, { fade: 0, from: frame, restart: true });
    a.time = frame / 30;
    this.mixer.update(0);
    this.lastFrame = frame;
  }

  /** current time in authored frames */
  get frame(): number {
    if (!this.current) return 0;
    return this.action(this.current).time * 30;
  }

  get normalized(): number {
    const m = this.meta();
    return m ? Math.min(1, this.frame / m.frames) : 0;
  }

  get finished(): boolean {
    const m = this.meta();
    if (!m || m.loop) return false;
    return this.frame >= m.frames - 0.5;
  }

  set speed(v: number) {
    if (this.current) this.action(this.current).timeScale = v;
  }

  update(dt: number): void {
    const before = this.lastFrame;
    this.mixer.update(dt * this.timeScale);
    const now = this.frame;
    const m = this.meta();
    if (m && this.current && this.onEvent) {
      const ev = m.events;
      const wrapped = now < before;
      const crossed = (f: number | undefined) => f !== undefined && (wrapped ? f > before || f <= now : f > before && f <= now);
      if (ev.hit) {
        if (crossed(ev.hit[0])) this.onEvent(this.current, 'hit_start', ev.hit[0]);
        if (crossed(ev.hit[1])) this.onEvent(this.current, 'hit_end', ev.hit[1]);
      }
      for (const key of ['cancel', 'activate', 'use', 'impact', 'launch'] as const) {
        const f = ev[key];
        if (typeof f === 'number' && crossed(f)) this.onEvent(this.current, key, f);
      }
    }
    this.lastFrame = now;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.inst.root);
  }
}
