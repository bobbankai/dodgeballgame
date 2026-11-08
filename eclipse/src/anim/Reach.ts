import { Matrix, Vector3, type TransformNode } from '@babylonjs/core';
import { Pose } from './Pose';
import type { Character } from '../character/Character';

/** How far an attack clip reaches, measured from its own animation. */
export interface Reach {
  /** Seconds (at speed 1) from the start to the first and last frame the blow can connect. */
  hitOn: number;
  hitOff: number;
  /**
   * Farthest point in front of the start position (metres, unscaled model space, within a 40°
   * cone) that the striking segment passes through during the hit window, root motion included.
   */
  contact: number;
  /** Root motion travelled forward by the time the hit window opens. */
  travel: number;
}

const cache = new Map<string, Reach | null>();
const COS_CONE = Math.cos((40 * Math.PI) / 180);

/**
 * Measures an attack clip on a character: poses the skeleton at each frame of the hit window, reads
 * the striking segment (a socketed weapon's blade, or a pair of bones) relative to the character
 * root, and adds the clip's root motion. Used to warp attackers to the right distance (motion
 * warping) and to judge ranges, so attacks fit any clip, weapon length and body scale without
 * hand-tuned numbers. Results are cached per rig layout, clip and weapon.
 *
 * Must run between simulation updates (it overwrites the bone transforms; the next animator update
 * writes the live pose back).
 */
export function measureReach(char: Character, clipName: string, segment: { socket: string; base: number; tip: number } | { bones: [string, string] }): Reach | null {
  const key = `${char.rig.names.length}:${char.manifest.name}:${clipName}:${JSON.stringify(segment)}`;
  if (cache.has(key)) return cache.get(key)!;
  const clips = char.animator.clips;
  if (!clips.has(clipName)) {
    cache.set(key, null);
    return null;
  }
  const clip = clips.get(clipName);
  const on = clip.events.find((e) => e.name === 'hit_on' || e.name === 'impact' || e.name === 'release');
  const off = clip.events.find((e) => e.name === 'hit_off');
  if (!on) {
    cache.set(key, null);
    return null;
  }
  const hitOn = on.t;
  const hitOff = off && off.t > hitOn ? off.t : hitOn + 0.05;
  const rig = char.rig;
  const pose = new Pose(rig.nodes.length);
  const ri = rig.rootIndex;
  const rootPos = (t: number): Vector3 => {
    const tr = ri >= 0 ? clip.pos[ri] : null;
    if (!tr) return Vector3.Zero();
    const [i0, i1, f] = clip.frameAt(t);
    return new Vector3(
      tr[i0 * 3] + (tr[i1 * 3] - tr[i0 * 3]) * f,
      tr[i0 * 3 + 1] + (tr[i1 * 3 + 1] - tr[i0 * 3 + 1]) * f,
      tr[i0 * 3 + 2] + (tr[i1 * 3 + 2] - tr[i0 * 3 + 2]) * f,
    );
  };
  const r0 = rootPos(0);
  const inv = new Matrix();
  char.root.computeWorldMatrix(true);
  char.root.getWorldMatrix().invertToRef(inv);
  // world matrices must be recomputed parent-first down to the striking nodes
  const chain = (n: TransformNode): TransformNode[] => {
    const out: TransformNode[] = [];
    let c: TransformNode | null = n;
    while (c) {
      out.unshift(c);
      c = c.parent as TransformNode | null;
    }
    return out;
  };
  const ends: TransformNode[] = 'socket' in segment ? [char.socket(segment.socket)] : segment.bones.map((b) => rig.bone(b)!).filter(Boolean);
  const chains = ends.map(chain);
  let contact = 0;
  const p = new Vector3();
  const steps = Math.max(2, Math.ceil((hitOff - hitOn) * 60));
  for (let i = 0; i <= steps; i++) {
    const t = hitOn + ((hitOff - hitOn) * i) / steps;
    pose.sample(clip, t, rig.rest);
    if (ri >= 0) {
      pose.pos.set(rig.rest.pos.subarray(ri * 3, ri * 3 + 3), ri * 3);
      pose.rot.set(rig.rest.rot.subarray(ri * 4, ri * 4 + 4), ri * 4);
    }
    rig.write(pose);
    for (const c of chains) for (const n of c) n.computeWorldMatrix(true);
    const off3 = rootPos(t).subtract(r0);
    const pts: Vector3[] = [];
    if ('socket' in segment) {
      const m = ends[0].getWorldMatrix();
      for (let k = 0; k <= 4; k++) pts.push(Vector3.TransformCoordinates(new Vector3(0, segment.base + ((segment.tip - segment.base) * k) / 4, 0), m));
    } else {
      pts.push(ends[0].getAbsolutePosition().clone(), ends[1].getAbsolutePosition().clone());
    }
    for (const w of pts) {
      Vector3.TransformCoordinatesToRef(w, inv, p);
      p.addInPlace(off3);
      const h = Math.hypot(p.x, p.z);
      if (h > 0.05 && p.z / h >= COS_CONE) contact = Math.max(contact, h);
    }
  }
  // put the live pose back (the next animator update would too, but keep this side-effect free)
  rig.write(char.animator.out);
  const travelV = rootPos(hitOn).subtract(r0);
  const r: Reach = { hitOn, hitOff, contact, travel: travelV.z };
  cache.set(key, r);
  return r;
}
