// Runtime animation: the shared humanoid library (assets/anims/humanoid.glb), retargeted onto any
// character built on the same rig, with crossfading states, an upper-body override layer, additive
// flinches and timed events (hit frames, footsteps).
//
// Retargeting: clips store full local rotations for the library skeleton. For a character, a bone's
// rotation is   rest_target * (rest_source^-1 * anim_source)   — the animation as a delta in the bone's
// rest frame — so characters with other proportions keep their own rest shape. The hips translation is
// scaled by the ratio of leg lengths.
import { Quaternion, Vector3 } from '@babylonjs/core';
import type { Scene, TransformNode } from '@babylonjs/core';
import { loadContainer, type CharacterModel } from './CharacterModel';

export interface ClipData {
  name: string;
  fps: number;
  frames: number;
  duration: number;
  rot: Map<string, Float32Array>;   // bone -> frames * 4 (x, y, z, w) source local rotations
  pos: Map<string, Float32Array>;   // bone -> frames * 3
}

export class AnimLibrary {
  clips = new Map<string, ClipData>();
  restRot = new Map<string, Quaternion>();
  restPos = new Map<string, Vector3>();
  legLength = 0.865;
  /** natural travel speed (m/s) of captured locomotion clips, from mocap.json */
  speeds = new Map<string, number>();

  speed(name: string, fallback: number): number { return this.speeds.get(name) || fallback; }

  static async load(scene: Scene, url = 'assets/anims/humanoid.glb'): Promise<AnimLibrary> {
    const lib = new AnimLibrary();
    try {
      const meta = await (await fetch(url.replace(/humanoid\.glb$/, 'mocap.json'))).json() as Record<string, { speed: number }>;
      for (const [k, v] of Object.entries(meta)) if (v.speed > 0) lib.speeds.set(k, v.speed);
    } catch { /* keyed clips only */ }
    const cont = await loadContainer(url, scene);
    for (const n of cont.transformNodes) {
      if (n.rotationQuaternion) lib.restRot.set(n.name, n.rotationQuaternion.clone());
      lib.restPos.set(n.name, n.position.clone());
    }
    // groups restored the nodes to frame 0 of whichever clip ran last: rest comes from the skin's bind
    // pose instead when available
    const sk = cont.skeletons[0];
    if (sk) {
      for (const b of sk.bones) {
        const tn = b.getTransformNode();
        const rest = b.getRestMatrix();
        const s = new Vector3(), r = new Quaternion(), t = new Vector3();
        rest.decompose(s, r, t);
        if (tn) { lib.restRot.set(tn.name, r); lib.restPos.set(tn.name, t); }
      }
    }
    for (const g of cont.animationGroups) {
      g.stop();
      let frames = 0;
      let fps = 60;
      const rot = new Map<string, Float32Array>();
      const pos = new Map<string, Float32Array>();
      const from = g.from, to = g.to;
      for (const ta of g.targetedAnimations) {
        fps = ta.animation.framePerSecond;
        frames = Math.max(frames, Math.round(((to - from) / fps) * 30) + 1);
      }
      for (const ta of g.targetedAnimations) {
        const name = (ta.target as TransformNode).name;
        const keys = ta.animation.getKeys();
        const prop = ta.animation.targetProperty;
        const sample = (i: number) => {
          // sample at 30 fps clip frames
          const f = from + (i / 30) * fps;
          let k = 0;
          while (k < keys.length - 2 && keys[k + 1].frame <= f) k++;
          const a = keys[k], b = keys[Math.min(k + 1, keys.length - 1)];
          const u = b.frame > a.frame ? Math.min(1, Math.max(0, (f - a.frame) / (b.frame - a.frame))) : 0;
          return { a: a.value, b: b.value, u };
        };
        if (prop === 'rotationQuaternion') {
          const arr = new Float32Array(frames * 4);
          for (let i = 0; i < frames; i++) {
            const { a, b, u } = sample(i);
            const qq = Quaternion.Slerp(a as Quaternion, b as Quaternion, u);
            arr.set([qq.x, qq.y, qq.z, qq.w], i * 4);
          }
          rot.set(name, arr);
        } else if (prop === 'position') {
          const arr = new Float32Array(frames * 3);
          for (let i = 0; i < frames; i++) {
            const { a, b, u } = sample(i);
            const vv = Vector3.Lerp(a as Vector3, b as Vector3, u);
            arr.set([vv.x, vv.y, vv.z], i * 3);
          }
          pos.set(name, arr);
        }
      }
      lib.clips.set(g.name, { name: g.name, fps: 30, frames, duration: (frames - 1) / 30, rot, pos });
    }
    return lib;
  }
}

// ---------------------------------------------------------------------------------------------- player

export interface PlayOptions {
  fade?: number;       // crossfade seconds
  loop?: boolean;
  speed?: number;
  layer?: 'base' | 'upper';
  restart?: boolean;
  events?: Record<string, number>;      // name -> time (s) within the clip
  onEvent?: (name: string) => void;
  onEnd?: () => void;
}

interface Track {
  clip: ClipData;
  time: number;
  speed: number;
  loop: boolean;
  weight: number;
  target: number;   // weight target (1 for the active track, 0 fading out)
  fade: number;
  events?: Record<string, number>;
  fired: Set<string>;
  onEvent?: (name: string) => void;
  onEnd?: () => void;
  ended: boolean;
}

const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'shoulder.L', 'shoulder.R', 'upperarm.L', 'upperarm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R',
  ...['index', 'middle', 'ring', 'pinky', 'thumb'].flatMap((f) => [1, 2, 3].flatMap((i) => [`${f}${i}.L`, `${f}${i}.R`]))]);

const tmpQ = new Quaternion();
const tmpQ2 = new Quaternion();

export class Animator {
  base: Track[] = [];
  upper: Track[] = [];
  upperWeight = 0;
  upperTarget = 0;
  /** additive flinch: bone -> rotation offset decaying to identity */
  flinch = new Map<string, { q: Quaternion; t: number; dur: number }>();
  private bones: { name: string; node: TransformNode; tgtRest: Quaternion; srcRestInv: Quaternion; tgtPos: Vector3; srcPos: Vector3 }[] = [];
  private posScale = 1;

  constructor(readonly model: CharacterModel, readonly lib: AnimLibrary) {
    for (const [name, node] of model.bones) {
      const src = lib.restRot.get(name);
      const tgt = model.restRot.get(name);
      if (!src || !tgt) continue;
      this.bones.push({
        name, node, tgtRest: tgt, srcRestInv: Quaternion.Inverse(src),
        tgtPos: model.restPos.get(name)!.clone(), srcPos: lib.restPos.get(name)?.clone() ?? Vector3.Zero(),
      });
    }
    const hipsT = model.restPos.get('hips'), hipsS = lib.restPos.get('hips');
    if (hipsT && hipsS && hipsS.length() > 0.01) this.posScale = hipsT.length() / hipsS.length();
  }

  has(name: string): boolean { return this.lib.clips.has(name); }

  current(layer: 'base' | 'upper' = 'base'): string | null {
    const arr = layer === 'base' ? this.base : this.upper;
    const t = arr.find((x) => x.target > 0);
    return t ? t.clip.name : null;
  }

  currentTime(layer: 'base' | 'upper' = 'base'): number {
    const arr = layer === 'base' ? this.base : this.upper;
    const t = arr.find((x) => x.target > 0);
    return t ? t.time : 0;
  }

  play(name: string, o: PlayOptions = {}): boolean {
    const clip = this.lib.clips.get(name);
    if (!clip) return false;
    const layer = o.layer ?? 'base';
    const arr = layer === 'base' ? this.base : this.upper;
    const active = arr.find((x) => x.target > 0);
    if (active && active.clip === clip && !o.restart) {
      active.speed = o.speed ?? active.speed;
      return true;
    }
    const fade = o.fade ?? 0.15;
    for (const t of arr) { t.target = 0; t.fade = fade; }
    arr.push({
      clip, time: 0, speed: o.speed ?? 1, loop: o.loop ?? false, weight: arr.length ? 0 : 1, target: 1, fade,
      events: o.events, fired: new Set(), onEvent: o.onEvent, onEnd: o.onEnd, ended: false,
    });
    if (layer === 'upper') { this.upperTarget = 1; }
    return true;
  }

  stopUpper(fade = 0.2): void {
    this.upperTarget = 0;
    for (const t of this.upper) { t.target = 0; t.fade = fade; }
  }

  addFlinch(bone: string, q: Quaternion, dur = 0.25): void {
    this.flinch.set(bone, { q, t: 0, dur });
  }

  private advance(arr: Track[], dt: number): void {
    for (const t of arr) {
      const prev = t.time;
      t.time += dt * t.speed;
      const dur = t.clip.duration;
      if (t.events && t.onEvent) {
        for (const [ev, at] of Object.entries(t.events)) {
          if (!t.fired.has(ev) && prev <= at && t.time >= at) { t.fired.add(ev); t.onEvent(ev); }
        }
      }
      if (t.time >= dur) {
        if (t.loop) { t.time %= Math.max(dur, 1e-3); t.fired.clear(); } else { t.time = dur; if (!t.ended) { t.ended = true; t.onEnd?.(); } }
      }
      const k = t.fade > 0 ? dt / t.fade : 1;
      t.weight += Math.sign(t.target - t.weight) * Math.min(Math.abs(t.target - t.weight), k);
    }
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].target === 0 && arr[i].weight <= 0.001) arr.splice(i, 1);
  }

  update(dt: number): void {
    this.advance(this.base, dt);
    this.advance(this.upper, dt);
    const k = Math.min(1, dt / 0.15);
    this.upperWeight += (this.upperTarget - this.upperWeight) * k;
    if (this.upper.length === 0) this.upperWeight = Math.max(0, this.upperWeight - k);
    for (const [, f] of this.flinch) f.t += dt;
    this.apply();
  }

  private sampleRot(t: Track, bone: string, out: Quaternion): boolean {
    const arr = t.clip.rot.get(bone);
    if (!arr) return false;
    const f = Math.min(t.time * 30, t.clip.frames - 1);
    const i0 = Math.floor(f), i1 = Math.min(i0 + 1, t.clip.frames - 1);
    const u = f - i0;
    const a = tmpQ2.set(arr[i0 * 4], arr[i0 * 4 + 1], arr[i0 * 4 + 2], arr[i0 * 4 + 3]);
    const b = out.set(arr[i1 * 4], arr[i1 * 4 + 1], arr[i1 * 4 + 2], arr[i1 * 4 + 3]);
    Quaternion.SlerpToRef(a, b, u, out);
    return true;
  }

  private layerRot(arr: Track[], bone: string, out: Quaternion): boolean {
    let total = 0;
    let first = true;
    const q = new Quaternion();
    for (const t of arr) {
      if (t.weight <= 0.0001) continue;
      if (!this.sampleRot(t, bone, q)) continue;
      total += t.weight;
      if (first) { out.copyFrom(q); first = false; } else {
        if (Quaternion.Dot(out, q) < 0) q.scaleInPlace(-1);
        Quaternion.SlerpToRef(out, q, t.weight / total, out);
      }
    }
    return !first;
  }

  private apply(): void {
    const qBase = new Quaternion();
    const qUp = new Quaternion();
    for (const b of this.bones) {
      if (!this.layerRot(this.base, b.name, qBase)) continue;
      if (this.upperWeight > 0.001 && UPPER.has(b.name) && this.layerRot(this.upper, b.name, qUp)) {
        if (Quaternion.Dot(qBase, qUp) < 0) qUp.scaleInPlace(-1);
        Quaternion.SlerpToRef(qBase, qUp, this.upperWeight, qBase);
      }
      // retarget: tgtRest * srcRest^-1 * anim
      b.srcRestInv.multiplyToRef(qBase, tmpQ);
      const out = b.node.rotationQuaternion ?? (b.node.rotationQuaternion = new Quaternion());
      b.tgtRest.multiplyToRef(tmpQ, out);
      const fl = this.flinch.get(b.name);
      if (fl && fl.t < fl.dur) {
        const w = Math.sin((1 - fl.t / fl.dur) * Math.PI * 0.5);
        Quaternion.SlerpToRef(Quaternion.Identity(), fl.q, w, tmpQ);
        out.multiplyToRef(tmpQ, out);
      }
      if (b.name === 'hips') {
        // translation: blend positions of the base layer
        let tot = 0;
        const p = new Vector3();
        for (const t of this.base) {
          const arr = t.clip.pos.get('hips');
          if (!arr || t.weight <= 0) continue;
          const f = Math.min(t.time * 30, t.clip.frames - 1);
          const i0 = Math.floor(f), i1 = Math.min(i0 + 1, t.clip.frames - 1), u = f - i0;
          const x = arr[i0 * 3] * (1 - u) + arr[i1 * 3] * u, y = arr[i0 * 3 + 1] * (1 - u) + arr[i1 * 3 + 1] * u, z = arr[i0 * 3 + 2] * (1 - u) + arr[i1 * 3 + 2] * u;
          p.addInPlaceFromFloats(x * t.weight, y * t.weight, z * t.weight);
          tot += t.weight;
        }
        if (tot > 0) {
          p.scaleInPlace(1 / tot);
          const d = p.subtract(b.srcPos).scaleInPlace(this.posScale);
          b.node.position.copyFrom(b.tgtPos.add(d));
        }
      }
    }
  }
}
