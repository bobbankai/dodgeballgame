// Animation playback for every humanoid: one AnimationMixer per character, clips shared across the
// cast (same 53-bone rig). Features:
//  * root motion: the Root bone track is pulled out of each clip into a curve; the controller applies
//    its delta (rotated into the character's facing) so attacks, dodges and lunges travel exactly as
//    authored, with collision, while the mesh never drifts from its capsule
//  * locomotion blend space (idle / walk / run / sprint) with phase sync and speed-matched playback
//  * one-shot actions with crossfade, events (hit windows, cancels, sounds) fired as time passes
import * as THREE from 'three';

export interface ClipMeta {
  dur: number;
  loop: boolean;
  events: Record<string, number | number[]>;
  root: number[];
  speed?: number;
}

export interface ClipLib {
  clips: Map<string, THREE.AnimationClip>;
  meta: Record<string, ClipMeta>;
  /** root motion curve per clip: sampled positions (x, z) in character space at 60 Hz */
  root: Map<string, Float32Array>;
}

const RM_HZ = 60;

/** Extract the Root bone translation into a curve and zero it in the clip. */
export function prepareLibrary(anims: THREE.AnimationClip[], meta: Record<string, ClipMeta>): ClipLib {
  const clips = new Map<string, THREE.AnimationClip>();
  const root = new Map<string, Float32Array>();
  for (const c of anims) {
    const keep: THREE.KeyframeTrack[] = [];
    for (const tr of c.tracks) {
      if (tr.name === 'Root.position') {
        const n = Math.max(2, Math.ceil(c.duration * RM_HZ) + 1);
        const curve = new Float32Array(n * 2);
        const interp = (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant();
        for (let i = 0; i < n; i++) {
          const v = interp.evaluate(Math.min(c.duration, i / RM_HZ));
          curve[i * 2] = v[0];
          curve[i * 2 + 1] = v[2];
        }
        // make the curve start at zero
        const x0 = curve[0], z0 = curve[1];
        for (let i = 0; i < n; i++) { curve[i * 2] -= x0; curve[i * 2 + 1] -= z0; }
        root.set(c.name, curve);
        continue;
      }
      keep.push(tr);
    }
    c.tracks = keep;
    clips.set(c.name, c);
  }
  return { clips, meta, root };
}

function sampleRoot(curve: Float32Array, t: number, out: THREE.Vector2): THREE.Vector2 {
  const n = curve.length / 2;
  const f = Math.max(0, Math.min(n - 1, t * RM_HZ));
  const i = Math.floor(f);
  const j = Math.min(n - 1, i + 1);
  const k = f - i;
  out.set(curve[i * 2] + (curve[j * 2] - curve[i * 2]) * k, curve[i * 2 + 1] + (curve[j * 2 + 1] - curve[i * 2 + 1]) * k);
  return out;
}

export type EventFn = (name: string, value: number | number[]) => void;

interface OneShot {
  name: string;
  action: THREE.AnimationAction;
  meta: ClipMeta;
  prevT: number;
  rmPrev: THREE.Vector2;
  weight: number;
  fading: boolean;
  speed: number;
}

export class Animator {
  readonly mixer: THREE.AnimationMixer;
  private loco: { name: string; action: THREE.AnimationAction; speed: number }[] = [];
  private locoWeight = 1;
  private shot: OneShot | null = null;
  private fadingShots: OneShot[] = [];
  private idle: THREE.AnimationAction | null = null;
  private idleName = '';
  /** normalised locomotion phase (0..1) shared by the blend space */
  private phase = 0;
  readonly rootDelta = new THREE.Vector2();
  onEvent: EventFn | null = null;
  timeScale = 1;
  private tmp = new THREE.Vector2();

  constructor(root: THREE.Object3D, private lib: ClipLib) {
    this.mixer = new THREE.AnimationMixer(root);
  }

  has(name: string): boolean { return this.lib.clips.has(name); }
  meta(name: string): ClipMeta | undefined { return this.lib.meta[name]; }

  action(name: string): THREE.AnimationAction {
    const clip = this.lib.clips.get(name);
    if (!clip) throw new Error('missing clip ' + name);
    return this.mixer.clipAction(clip);
  }

  /** locomotion set: idle + moving clips ordered by speed */
  setLocomotion(idle: string, moves: string[]): void {
    for (const l of this.loco) l.action.stop();
    this.idle?.stop();
    this.idleName = idle;
    this.idle = this.action(idle);
    this.idle.play();
    this.loco = moves.filter((m) => this.has(m)).map((m) => {
      const a = this.action(m);
      a.play();
      a.setEffectiveWeight(0);
      return { name: m, action: a, speed: this.lib.meta[m]?.speed ?? 1 };
    });
  }

  get idleClip(): string { return this.idleName; }

  /** blend locomotion by ground speed (m/s) */
  locomote(speed: number, dt: number): void {
    const L = this.loco;
    const w = new Array(L.length).fill(0);
    let idleW = 0;
    if (L.length === 0 || speed < 0.05) idleW = 1;
    else if (speed <= L[0].speed) { const k = speed / L[0].speed; idleW = 1 - k; w[0] = k; } else {
      let done = false;
      for (let i = 0; i < L.length - 1; i++) {
        if (speed <= L[i + 1].speed) {
          const k = (speed - L[i].speed) / (L[i + 1].speed - L[i].speed);
          w[i] = 1 - k; w[i + 1] = k; done = true; break;
        }
      }
      if (!done) w[L.length - 1] = 1;
    }
    // phase advance: weighted cycle rate, so feet stay in sync when blending
    let rate = 0;
    let wsum = 0;
    for (let i = 0; i < L.length; i++) {
      if (w[i] <= 0) continue;
      const clip = L[i].action.getClip();
      const playback = Math.max(0.6, Math.min(1.6, speed / L[i].speed));
      rate += w[i] * playback / clip.duration;
      wsum += w[i];
    }
    if (wsum > 0) this.phase = (this.phase + (rate / wsum) * dt) % 1;
    for (let i = 0; i < L.length; i++) {
      const a = L[i].action;
      a.time = this.phase * a.getClip().duration;
      a.timeScale = 0; // time driven by the shared phase
      a.setEffectiveWeight(w[i] * this.locoWeight);
    }
    this.idle?.setEffectiveWeight(idleW * this.locoWeight);
  }

  /** play a one-shot (or a looping pose like block_hold) on top of locomotion */
  play(name: string, opts: { fade?: number; speed?: number; loop?: boolean; from?: number } = {}): void {
    if (!this.has(name)) { console.warn('no clip', name); return; }
    const fade = opts.fade ?? 0.12;
    if (this.shot) {
      this.shot.fading = true;
      this.shot.action.fadeOut(fade);
      this.fadingShots.push(this.shot);
    }
    const a = this.action(name);
    const meta = this.lib.meta[name] ?? { dur: a.getClip().duration, loop: false, events: {}, root: [0, 0] };
    const loop = opts.loop ?? meta.loop;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    a.timeScale = opts.speed ?? 1;
    a.time = opts.from ?? 0;
    a.setEffectiveWeight(1);
    a.fadeIn(fade);
    a.play();
    this.shot = { name, action: a, meta, prevT: a.time, rmPrev: new THREE.Vector2(), weight: 1, fading: false, speed: opts.speed ?? 1 };
    const curve = this.lib.root.get(name);
    if (curve) sampleRoot(curve, a.time, this.shot.rmPrev);
  }

  /** stop the one-shot, fading back to locomotion */
  stop(fade = 0.18): void {
    if (!this.shot) return;
    this.shot.action.fadeOut(fade);
    this.shot.fading = true;
    this.fadingShots.push(this.shot);
    this.shot = null;
  }

  get current(): string | null { return this.shot?.name ?? null; }
  get time(): number { return this.shot?.action.time ?? 0; }
  get duration(): number { return this.shot?.action.getClip().duration ?? 0; }
  get finished(): boolean {
    if (!this.shot) return true;
    const a = this.shot.action;
    return a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 1e-3;
  }
  inWindow(key: string): boolean {
    const s = this.shot;
    if (!s) return false;
    const w = s.meta.events[key];
    if (!Array.isArray(w)) return false;
    return s.action.time >= w[0] && s.action.time <= w[1];
  }
  after(key: string): boolean {
    const s = this.shot;
    if (!s) return true;
    const v = s.meta.events[key];
    if (v === undefined) return s.action.time >= s.action.getClip().duration - 1e-3;
    return s.action.time >= (Array.isArray(v) ? v[0] : v);
  }

  update(dt: number): void {
    dt *= this.timeScale;
    // locomotion weight drops while a one-shot owns the body
    const target = this.shot && !this.shot.fading ? 0 : 1;
    this.locoWeight += (target - this.locoWeight) * Math.min(1, dt * 12);
    this.mixer.update(dt);
    // root motion of the active one-shot (and of shots still fading out)
    this.rootDelta.set(0, 0);
    const shots = this.shot ? [this.shot, ...this.fadingShots] : this.fadingShots;
    for (const s of shots) {
      const curve = this.lib.root.get(s.name);
      const t = s.action.time;
      if (curve) {
        sampleRoot(curve, t, this.tmp);
        if (t >= s.prevT) {
          const w = s.action.getEffectiveWeight();
          this.rootDelta.x += (this.tmp.x - s.rmPrev.x) * w;
          this.rootDelta.y += (this.tmp.y - s.rmPrev.y) * w;
        }
        s.rmPrev.copy(this.tmp);
      }
      // events (only the active shot)
      if (s === this.shot && this.onEvent) {
        for (const [k, v] of Object.entries(s.meta.events)) {
          const at = Array.isArray(v) ? v[0] : v;
          if (typeof at === 'number' && s.prevT < at && t >= at) this.onEvent(k, v);
        }
      }
      s.prevT = t;
    }
    this.fadingShots = this.fadingShots.filter((s) => s.action.getEffectiveWeight() > 0.001 && s.action.isRunning());
  }
}
