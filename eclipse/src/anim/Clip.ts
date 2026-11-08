import { Quaternion, Vector3, type AnimationGroup, type TransformNode } from '@babylonjs/core';

/** Metadata authored with each clip in Blender (anims.json). */
export interface ClipEvent {
  t: number;
  name: string;
  [k: string]: unknown;
}

export interface ClipMeta {
  length: number;
  frames: number;
  loop: boolean;
  rootMotion: boolean;
  events: ClipEvent[];
}

/**
 * A skeletal clip converted from a glTF animation group into flat typed arrays, sampled at a fixed
 * rate (the exporter writes one key per frame). Tracks are indexed by the skeleton's bone order so
 * sampling and blending are allocation-free.
 */
export class Clip {
  readonly name: string;
  readonly fps: number;
  readonly frames: number;
  readonly duration: number;
  readonly loop: boolean;
  readonly rootMotion: boolean;
  readonly events: ClipEvent[];
  /** rot[track][frame*4..+4]; null when the clip does not animate that bone. */
  readonly rot: (Float32Array | null)[];
  readonly pos: (Float32Array | null)[];

  constructor(name: string, fps: number, frames: number, boneCount: number, meta?: ClipMeta) {
    this.name = name;
    this.fps = fps;
    this.frames = frames;
    this.duration = meta?.length ?? (frames - 1) / fps;
    this.loop = meta?.loop ?? false;
    this.rootMotion = meta?.rootMotion ?? false;
    this.events = meta?.events ?? [];
    this.rot = new Array(boneCount).fill(null);
    this.pos = new Array(boneCount).fill(null);
  }

  /**
   * Converts an imported AnimationGroup. `boneIndex` maps a target node to its track index.
   * Keys are resampled to `fps` so frames are evenly spaced.
   */
  static fromGroup(group: AnimationGroup, boneIndex: Map<TransformNode, number>, boneCount: number, meta?: ClipMeta, fps = 30): Clip {
    const to = group.to - group.from;
    const frameRate = group.targetedAnimations[0]?.animation.framePerSecond ?? fps;
    const seconds = meta?.length ?? to / frameRate;
    const frames = Math.max(2, Math.round(seconds * fps) + 1);
    const clip = new Clip(group.name, fps, frames, boneCount, meta);
    const q = new Quaternion();
    const v = new Vector3();
    for (const ta of group.targetedAnimations) {
      const idx = boneIndex.get(ta.target as TransformNode);
      if (idx === undefined) continue;
      const anim = ta.animation;
      const keys = anim.getKeys();
      if (!keys.length) continue;
      const prop = anim.targetProperty;
      if (prop === 'rotationQuaternion') {
        const arr = new Float32Array(frames * 4);
        for (let f = 0; f < frames; f++) {
          const at = group.from + (f / fps) * frameRate;
          sampleQuat(keys, at, q);
          arr.set([q.x, q.y, q.z, q.w], f * 4);
        }
        clip.rot[idx] = arr;
      } else if (prop === 'position') {
        const arr = new Float32Array(frames * 3);
        for (let f = 0; f < frames; f++) {
          const at = group.from + (f / fps) * frameRate;
          sampleVec(keys, at, v);
          arr.set([v.x, v.y, v.z], f * 3);
        }
        clip.pos[idx] = arr;
      }
    }
    return clip;
  }

  /** Frame position for a time (wrapped or clamped). */
  frameAt(t: number): [number, number, number] {
    let f = t * this.fps;
    const last = this.frames - 1;
    if (this.loop) {
      f = ((f % last) + last) % last;
    } else {
      f = Math.min(Math.max(f, 0), last);
    }
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, last);
    return [i0, i1, f - i0];
  }
}

type Key = { frame: number; value: unknown };

function findKey(keys: Key[], at: number): [number, number, number] {
  if (at <= keys[0].frame) return [0, 0, 0];
  const last = keys.length - 1;
  if (at >= keys[last].frame) return [last, last, 0];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].frame <= at) lo = mid;
    else hi = mid;
  }
  const span = keys[hi].frame - keys[lo].frame;
  return [lo, hi, span > 0 ? (at - keys[lo].frame) / span : 0];
}

function sampleQuat(keys: Key[], at: number, out: Quaternion): void {
  const [a, b, t] = findKey(keys, at);
  Quaternion.SlerpToRef(keys[a].value as Quaternion, keys[b].value as Quaternion, t, out);
}

function sampleVec(keys: Key[], at: number, out: Vector3): void {
  const [a, b, t] = findKey(keys, at);
  Vector3.LerpToRef(keys[a].value as Vector3, keys[b].value as Vector3, t, out);
}
