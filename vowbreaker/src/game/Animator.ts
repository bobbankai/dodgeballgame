import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Clip, ClipLibrary } from './Assets';

interface Layer {
  clip: Clip;
  time: number;
  speed: number;
  weight: number;
  target: number;
  fade: number;
}

const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();

/**
 * Plays the shared clips on one character: crossfades, game-time driven (hitstop and slow motion
 * freeze it), and sampled on "2s or 3s" for the limited-animation look: the pose is only resampled
 * `stepFps` times a second, while the root still moves smoothly at full rate.
 */
export class Animator {
  private layers: Layer[] = [];
  readonly bones = new Map<string, TransformNode>();
  private rest = new Map<string, Quaternion>();
  private restHips = new Vector3();
  private hipScale = 1;
  /** sampled pose cache, refreshed at the stepped rate */
  private pose = new Map<string, Quaternion>();
  private poseHips = new Vector3();
  private sinceStep = 1e9;
  stepFps = 15;
  /** set false for smooth (non-stepped) playback, e.g. in slow-motion close-ups */
  stepped = true;
  current = '';
  /** extra rotations multiplied on after sampling (look-at, spring bones, hit wobble) */
  readonly post = new Map<string, Quaternion>();

  constructor(private lib: ClipLibrary, root: TransformNode) {
    for (const n of root.getDescendants(false) as TransformNode[]) {
      if (!(n instanceof TransformNode)) continue;
      this.bones.set(n.name, n);
      this.rest.set(n.name, (n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation)).clone());
      if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    }
    const hips = this.bones.get('hips');
    if (hips) {
      this.restHips.copyFrom(hips.position);
      this.hipScale = hips.position.length() / Math.max(lib.refHipHeight, 0.01);
    }
  }

  has(name: string): boolean {
    return this.lib.clips.has(name);
  }

  duration(name: string): number {
    return this.lib.clips.get(name)?.duration ?? 0;
  }

  /** Start a clip, crossfading over `fade` seconds. Restarts it if already current unless keep. */
  play(name: string, fade = 0.12, speed = 1, keep = false): void {
    const clip = this.lib.clips.get(name);
    if (!clip) return;
    if (keep && this.current === name) {
      const top = this.layers[this.layers.length - 1];
      if (top) top.speed = speed;
      return;
    }
    this.current = name;
    for (const l of this.layers) {
      l.target = 0;
      l.fade = fade;
    }
    this.layers.push({ clip, time: 0, speed, weight: fade <= 0 ? 1 : 0, target: 1, fade });
    if (fade <= 0) this.layers = this.layers.slice(-1);
    this.sinceStep = 1e9;
  }

  /** Normalised progress of the current clip (0..1). */
  progress(): number {
    const top = this.layers[this.layers.length - 1];
    if (!top) return 1;
    return Math.min(1, top.time / Math.max(top.clip.duration, 1e-3));
  }

  time(): number {
    return this.layers[this.layers.length - 1]?.time ?? 0;
  }

  finished(): boolean {
    const top = this.layers[this.layers.length - 1];
    return !top || (!top.clip.loop && top.time >= top.clip.duration);
  }

  private sample(clip: Clip, t: number, bone: string, out: Quaternion): boolean {
    const arr = clip.rot.get(bone);
    if (!arr) return false;
    let f = t * clip.fps;
    if (clip.loop) f = ((f % clip.frames) + clip.frames) % clip.frames;
    else f = Math.min(f, clip.frames);
    const i = Math.floor(f);
    const j = Math.min(i + 1, clip.frames);
    const k = f - i;
    tmpQ.set(arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2], arr[i * 4 + 3]);
    tmpQ2.set(arr[j * 4], arr[j * 4 + 1], arr[j * 4 + 2], arr[j * 4 + 3]);
    Quaternion.SlerpToRef(tmpQ, tmpQ2, k, out);
    return true;
  }

  private sampleHips(clip: Clip, t: number, out: Vector3): void {
    const arr = clip.hips;
    if (!arr) {
      out.set(0, 0, 0);
      return;
    }
    let f = t * clip.fps;
    if (clip.loop) f = ((f % clip.frames) + clip.frames) % clip.frames;
    else f = Math.min(f, clip.frames);
    const i = Math.floor(f);
    const j = Math.min(i + 1, clip.frames);
    const k = f - i;
    out.set(arr[i * 3] + (arr[j * 3] - arr[i * 3]) * k, arr[i * 3 + 1] + (arr[j * 3 + 1] - arr[i * 3 + 1]) * k, arr[i * 3 + 2] + (arr[j * 3 + 2] - arr[i * 3 + 2]) * k);
  }

  update(dt: number): void {
    for (const l of this.layers) {
      l.time += dt * l.speed;
      if (l.fade <= 0) l.weight = l.target;
      else l.weight += Math.sign(l.target - l.weight) * Math.min(Math.abs(l.target - l.weight), dt / l.fade);
    }
    this.layers = this.layers.filter((l, i) => l.weight > 0.001 || i === this.layers.length - 1);
    this.sinceStep += dt;
    const stepDt = 1 / this.stepFps;
    if (!this.stepped || this.sinceStep >= stepDt) {
      this.sinceStep = this.stepped ? this.sinceStep % stepDt : 0;
      this.resample();
    }
    this.apply();
  }

  private resample(): void {
    const q = new Quaternion();
    const hp = new Vector3();
    for (const [name] of this.rest) {
      let acc: Quaternion | null = null;
      let wsum = 0;
      for (const l of this.layers) {
        if (l.weight <= 0) continue;
        if (!this.sample(l.clip, l.time, name, q)) continue;
        if (!acc) {
          acc = q.clone();
          wsum = l.weight;
        } else {
          wsum += l.weight;
          if (Quaternion.Dot(acc, q) < 0) q.scaleInPlace(-1);
          Quaternion.SlerpToRef(acc, q, l.weight / wsum, acc);
        }
      }
      if (acc) {
        const cur = this.pose.get(name);
        if (cur) cur.copyFrom(acc);
        else this.pose.set(name, acc);
      }
    }
    this.poseHips.set(0, 0, 0);
    let wsum = 0;
    for (const l of this.layers) {
      if (l.weight <= 0 || !l.clip.hips) continue;
      this.sampleHips(l.clip, l.time, hp);
      wsum += l.weight;
      Vector3.LerpToRef(this.poseHips, hp, l.weight / wsum, this.poseHips);
    }
  }

  private apply(): void {
    for (const [name, q] of this.pose) {
      const n = this.bones.get(name);
      if (!n || !n.rotationQuaternion) continue;
      n.rotationQuaternion.copyFrom(q);
      const extra = this.post.get(name);
      if (extra) n.rotationQuaternion.multiplyInPlace(extra);
    }
    const hips = this.bones.get('hips');
    if (hips) {
      hips.position.copyFrom(this.restHips).addInPlace(this.poseHips.scale(this.hipScale));
    }
  }

  /** Reset a bone to its rest rotation (face bones, springs). */
  restOf(name: string): Quaternion | undefined {
    return this.rest.get(name);
  }
}
