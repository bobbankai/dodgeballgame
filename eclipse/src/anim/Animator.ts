import { Quaternion, Vector3, type Skeleton, type TransformNode } from '@babylonjs/core';
import { Clip, type ClipEvent } from './Clip';
import { Pose } from './Pose';

/** The bones of one character instance, in skeleton order, and their rest pose. */
export class RigBinding {
  readonly nodes: TransformNode[];
  readonly names: string[];
  readonly index = new Map<string, number>();
  readonly rest: Pose;
  readonly rootIndex: number;

  constructor(skeleton: Skeleton) {
    this.nodes = [];
    this.names = [];
    skeleton.bones.forEach((b) => {
      const node = b.getTransformNode();
      if (!node) return;
      const name = b.name.split(':').pop()!;
      this.index.set(name, this.nodes.length);
      this.nodes.push(node);
      this.names.push(name);
    });
    this.rest = new Pose(this.nodes.length);
    this.nodes.forEach((n, i) => {
      const q = n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation);
      this.rest.rot.set([q.x, q.y, q.z, q.w], i * 4);
      this.rest.pos.set([n.position.x, n.position.y, n.position.z], i * 3);
    });
    this.rootIndex = this.index.get('Root') ?? -1;
  }

  bone(name: string): TransformNode | undefined {
    const i = this.index.get(name);
    return i === undefined ? undefined : this.nodes[i];
  }

  /** Per-bone weights: 1 for `from` and everything under it, 0 elsewhere (layer masks). */
  maskFrom(names: string[], weights?: Record<string, number>): Float32Array {
    const m = new Float32Array(this.nodes.length);
    this.nodes.forEach((node, i) => {
      let n: TransformNode | null = node;
      while (n) {
        const nm = n.name.split(':').pop()!;
        if (names.includes(nm)) {
          m[i] = weights?.[this.names[i]] ?? 1;
          break;
        }
        n = n.parent as TransformNode | null;
      }
    });
    if (weights) for (const [k, v] of Object.entries(weights)) {
      const i = this.index.get(k);
      if (i !== undefined) m[i] = v;
    }
    return m;
  }

  write(p: Pose): void {
    const nodes = this.nodes;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const q = n.rotationQuaternion ?? (n.rotationQuaternion = new Quaternion());
      q.set(p.rot[i * 4], p.rot[i * 4 + 1], p.rot[i * 4 + 2], p.rot[i * 4 + 3]);
      n.position.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
    }
  }
}

/** Clips retargeted onto one rig (by bone name), shared by every instance of that rig. */
export class ClipSet {
  readonly clips = new Map<string, Clip>();
  get(name: string): Clip {
    const c = this.clips.get(name);
    if (!c) throw new Error(`no clip ${name}`);
    return c;
  }
  has(name: string): boolean {
    return this.clips.has(name);
  }
}

export interface PlayOptions {
  fade?: number;
  speed?: number;
  start?: number;
  loop?: boolean;
  /** Called for every authored event the playback passes. */
  onEvent?: (e: ClipEvent) => void;
  onEnd?: () => void;
}

class Playback {
  time: number;
  prevTime: number;
  speed: number;
  loop: boolean;
  ended = false;
  constructor(public clip: Clip, o: PlayOptions) {
    this.time = o.start ?? 0;
    this.prevTime = this.time;
    this.speed = o.speed ?? 1;
    this.loop = o.loop ?? clip.loop;
  }
}

/** A layer plays one clip at a time with crossfades from the previous one. */
class Layer {
  cur?: Playback;
  prev?: Playback;
  fade = 0;
  fadeDur = 0;
  weight = 1;
  targetWeight = 1;
  weightSpeed = 6;
  opts?: PlayOptions;
  constructor(public mask?: Float32Array) {}
}

/** Locomotion: clips blended by speed (and direction) with a shared, phase-synchronised cycle. */
export interface LocoEntry {
  clip: Clip;
  speed: number;
}

/**
 * Character animator: a locomotion blend space under a full-body action layer (attacks, dodges,
 * reactions), a masked upper-body layer (casting while moving, blocking), an additive layer
 * (breathing, flinches), root-motion extraction, authored events, and post-process hooks for IK
 * and secondary motion. Runs on the fixed simulation step.
 */
export class Animator {
  readonly rig: RigBinding;
  readonly clips: ClipSet;
  readonly out: Pose;
  private tmpA: Pose;
  private tmpB: Pose;
  private tmpC: Pose;
  readonly action = new Layer();
  readonly upper: Layer;
  readonly additiveLayer = new Layer();
  private loco: LocoEntry[] = [];
  private locoStrafe: { fwd?: Clip; back?: Clip; left?: Clip; right?: Clip } = {};
  locoSpeed = 0;
  /** Movement direction relative to facing (radians, 0 = forward), for strafing blends. */
  locoDir = 0;
  strafing = false;
  private phase = 0;
  private locoFadeDur = 0.25;
  /** Root motion accumulated by the last update (model space) and yaw delta (radians). */
  readonly rootDelta = new Vector3();
  rootYaw = 0;
  post: ((dt: number) => void)[] = [];
  private q = new Quaternion();

  constructor(rig: RigBinding, clips: ClipSet) {
    this.rig = rig;
    this.clips = clips;
    const n = rig.nodes.length;
    this.out = new Pose(n).copyFrom(rig.rest);
    this.tmpA = new Pose(n);
    this.tmpB = new Pose(n);
    this.tmpC = new Pose(n);
    this.upper = new Layer(rig.maskFrom(['spine_02'], { spine_01: 0.3, spine_02: 0.7 }));
    this.upper.weight = 0;
    this.additiveLayer.weight = 0;
  }

  /** Pose locomotion is crossfading from (set when the locomotion set changes). */
  private locoFrom?: Pose;
  private locoFade = 1;

  setLocomotion(entries: { clip: string; speed: number }[], fade = 0.25): void {
    if (this.loco.length && fade > 0) {
      this.locoFrom = (this.locoFrom ?? new Pose(this.rig.nodes.length)).copyFrom(this.out);
      this.locoFade = 0;
      this.locoFadeDur = fade;
    }
    this.loco = entries.filter((e) => this.clips.has(e.clip)).map((e) => ({ clip: this.clips.get(e.clip), speed: e.speed })).sort((a, b) => a.speed - b.speed);
  }

  setStrafe(s: { fwd?: string; back?: string; left?: string; right?: string }): void {
    const g = (n?: string) => (n && this.clips.has(n) ? this.clips.get(n) : undefined);
    this.locoStrafe = { fwd: g(s.fwd), back: g(s.back), left: g(s.left), right: g(s.right) };
  }

  /** Plays a clip on the full-body action layer (it overrides locomotion while its weight is up). */
  play(name: string, o: PlayOptions = {}): void {
    this.start(this.action, name, o);
    this.action.targetWeight = 1;
  }

  /** Lets locomotion take over again. */
  stopAction(fade = 0.2): void {
    this.action.targetWeight = 0;
    this.action.weightSpeed = 1 / Math.max(fade, 1e-3);
  }

  playUpper(name: string, o: PlayOptions = {}): void {
    this.start(this.upper, name, o);
    this.upper.targetWeight = 1;
    this.upper.weightSpeed = 1 / Math.max(o.fade ?? 0.15, 1e-3);
  }

  stopUpper(fade = 0.2): void {
    this.upper.targetWeight = 0;
    this.upper.weightSpeed = 1 / Math.max(fade, 1e-3);
  }

  playAdditive(name: string, weight = 1, o: PlayOptions = {}): void {
    this.start(this.additiveLayer, name, o);
    this.additiveLayer.targetWeight = weight;
  }

  get actionClip(): Clip | undefined {
    return this.action.cur?.clip;
  }

  get actionTime(): number {
    return this.action.cur?.time ?? 0;
  }

  /** Normalised progress (0..1) of the action layer's clip. */
  get actionProgress(): number {
    const c = this.action.cur;
    return c ? c.time / c.clip.duration : 1;
  }

  get actionActive(): boolean {
    return this.action.weight > 0.001 || this.action.targetWeight > 0;
  }

  private start(layer: Layer, name: string, o: PlayOptions): void {
    const clip = this.clips.get(name);
    const fade = o.fade ?? 0.15;
    if (layer.cur && fade > 0) {
      layer.prev = layer.cur;
      layer.fade = 0;
      layer.fadeDur = fade;
    } else {
      layer.prev = undefined;
      layer.fade = 1;
      layer.fadeDur = 0;
    }
    layer.cur = new Playback(clip, o);
    layer.opts = o;
    if (layer.weight <= 0.001 && layer.targetWeight === 0) layer.weight = fade > 0 ? 0 : 1;
    layer.weightSpeed = 1 / Math.max(fade, 1e-3);
  }

  update(dt: number): void {
    this.rootDelta.setAll(0);
    this.rootYaw = 0;
    // advance layers
    for (const layer of [this.action, this.upper, this.additiveLayer]) {
      if (layer.weight !== layer.targetWeight) {
        const d = layer.weightSpeed * dt;
        layer.weight = layer.weight < layer.targetWeight ? Math.min(layer.targetWeight, layer.weight + d) : Math.max(layer.targetWeight, layer.weight - d);
      }
      if (layer.prev) {
        layer.fade += dt / Math.max(layer.fadeDur, 1e-3);
        this.advance(layer.prev, dt, undefined);
        if (layer.fade >= 1) layer.prev = undefined;
      }
      if (layer.cur) this.advance(layer.cur, dt, layer);
    }
    if (this.locoFade < 1) this.locoFade = Math.min(1, this.locoFade + dt / this.locoFadeDur);
    // locomotion phase (normalised, shared by all cycle clips so feet stay in step)
    if (this.loco.length) {
      const [a, b, w] = this.locoPair();
      const rate = (1 - w) / a.clip.duration + w / b.clip.duration;
      this.phase = (this.phase + rate * dt) % 1;
    }
    this.evaluate();
    this.rig.write(this.out);
    for (const fn of this.post) fn(dt);
  }

  private advance(p: Playback, dt: number, layer: Layer | undefined): void {
    p.prevTime = p.time;
    p.time += dt * p.speed;
    const d = p.clip.duration;
    if (p.time >= d) {
      if (p.loop) {
        p.time %= d;
      } else {
        p.time = d;
        if (!p.ended) {
          p.ended = true;
          if (layer?.cur === p) layer.opts?.onEnd?.();
        }
      }
    }
    if (layer?.cur === p) {
      this.fireEvents(p, layer.opts?.onEvent);
      if (p.clip.rootMotion && layer === this.action) this.accumulateRoot(p);
    }
  }

  private fireEvents(p: Playback, fn?: (e: ClipEvent) => void): void {
    if (!fn || !p.clip.events.length) return;
    const a = p.prevTime;
    const b = p.time;
    for (const e of p.clip.events) {
      if (b >= a ? e.t > a && e.t <= b : e.t > a || e.t <= b) fn(e);
    }
    if (p.prevTime === 0 && p.time > 0) {
      for (const e of p.clip.events) if (e.t === 0) fn(e);
    }
  }

  private accumulateRoot(p: Playback): void {
    const ri = this.rig.rootIndex;
    if (ri < 0) return;
    const pos = p.clip.pos[ri];
    if (!pos) return;
    const s = (t: number) => {
      const [i0, i1, f] = p.clip.frameAt(t);
      return [
        pos[i0 * 3] + (pos[i1 * 3] - pos[i0 * 3]) * f,
        pos[i0 * 3 + 1] + (pos[i1 * 3 + 1] - pos[i0 * 3 + 1]) * f,
        pos[i0 * 3 + 2] + (pos[i1 * 3 + 2] - pos[i0 * 3 + 2]) * f,
      ];
    };
    const a = s(p.prevTime);
    const b = s(Math.max(p.time, p.prevTime));
    const w = this.action.weight;
    this.rootDelta.x += (b[0] - a[0]) * w;
    this.rootDelta.y += (b[1] - a[1]) * w;
    this.rootDelta.z += (b[2] - a[2]) * w;
  }

  private locoPair(): [LocoEntry, LocoEntry, number] {
    const l = this.loco;
    const s = this.locoSpeed;
    if (s <= l[0].speed) return [l[0], l[0], 0];
    for (let i = 0; i < l.length - 1; i++) {
      if (s <= l[i + 1].speed) return [l[i], l[i + 1], (s - l[i].speed) / (l[i + 1].speed - l[i].speed)];
    }
    const last = l[l.length - 1];
    return [last, last, 0];
  }

  private evaluate(): void {
    const rest = this.rig.rest;
    const out = this.out;
    // 1. locomotion (blend space, phase-synced)
    if (this.loco.length) {
      const [a, b, w] = this.locoPair();
      out.sample(a.clip, this.phase * a.clip.duration, rest);
      if (b !== a && w > 0) out.blend(this.tmpA.sample(b.clip, this.phase * b.clip.duration, rest), w);
      if (this.strafing && this.locoSpeed > 0.2) this.blendStrafe(out);
    } else {
      out.copyFrom(rest);
    }
    if (this.locoFrom && this.locoFade < 1) {
      this.tmpC.copyFrom(this.locoFrom).blend(out, smooth(this.locoFade));
      out.copyFrom(this.tmpC);
    }
    // 2. full-body action layer with crossfade
    const act = this.action;
    if (act.weight > 0 && act.cur) {
      this.layerPose(act, this.tmpB);
      out.blend(this.tmpB, act.weight);
    }
    // 3. upper body
    const up = this.upper;
    if (up.weight > 0 && up.cur) {
      this.layerPose(up, this.tmpB);
      out.blend(this.tmpB, up.weight, up.mask);
    }
    // 4. additive
    const ad = this.additiveLayer;
    if (ad.weight > 0 && ad.cur) {
      this.tmpB.sample(ad.cur.clip, ad.cur.time, rest);
      this.tmpC.sample(ad.cur.clip, 0, rest);
      out.additive(this.tmpB, this.tmpC, ad.weight);
    }
    // root motion is applied to the character, so the Root bone itself stays put
    const ri = this.rig.rootIndex;
    if (ri >= 0) {
      out.pos.set(rest.pos.subarray(ri * 3, ri * 3 + 3), ri * 3);
      out.rot.set(rest.rot.subarray(ri * 4, ri * 4 + 4), ri * 4);
    }
  }

  private layerPose(layer: Layer, into: Pose): void {
    const rest = this.rig.rest;
    into.sample(layer.cur!.clip, layer.cur!.time, rest);
    if (layer.prev && layer.fade < 1) {
      this.tmpC.sample(layer.prev.clip, layer.prev.time, rest);
      const f = smooth(layer.fade);
      this.tmpC.blend(into, f);
      into.copyFrom(this.tmpC);
    }
  }

  private blendStrafe(out: Pose): void {
    const s = this.locoStrafe;
    const a = this.locoDir;
    const pick: [Clip | undefined, number][] = [
      [s.fwd, Math.max(0, Math.cos(a))],
      [s.back, Math.max(0, -Math.cos(a))],
      [s.left, Math.max(0, Math.sin(a))],
      [s.right, Math.max(0, -Math.sin(a))],
    ];
    let first = true;
    let acc = 0;
    for (const [clip, w] of pick) {
      if (!clip || w <= 0.001) continue;
      this.tmpA.sample(clip, this.phase * clip.duration, this.rig.rest);
      if (first) {
        this.tmpB.copyFrom(this.tmpA);
        first = false;
        acc = w;
      } else {
        acc += w;
        this.tmpB.blend(this.tmpA, w / acc);
      }
    }
    if (!first) out.copyFrom(this.tmpB);
    void this.q;
  }
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}
