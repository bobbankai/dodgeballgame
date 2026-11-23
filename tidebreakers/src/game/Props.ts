// Held props: weapons and story objects from the props kit, parented to hand bones. The kit authors every
// prop with its grip at the origin and its length along +Y; GRIPS turns that into each hand's frame.
import { Vector3, Quaternion, TransformNode } from '@babylonjs/core';
import type { InstancedMesh } from '@babylonjs/core';
import type { EnvKit } from '../world/World';
import type { Fighter } from './Fighter';

export interface Hold { piece: string; bone: string; pos?: [number, number, number]; rot?: [number, number, number]; scale?: number }

// Rotation (Euler, radians) taking the prop's +Y onto the fist's through-axis, per hand.
const GRIP_R: [number, number, number] = [0, 0, -Math.PI / 2];
const GRIP_L: [number, number, number] = [0, 0, Math.PI / 2];
const PALM_R: [number, number, number] = [0.07, 0.015, 0];
const PALM_L: [number, number, number] = [-0.07, 0.015, 0];

const R = (piece: string, extra: Partial<Hold> = {}): Hold => ({ piece, bone: 'hand.R', pos: PALM_R, rot: GRIP_R, ...extra });
const L = (piece: string, extra: Partial<Hold> = {}): Hold => ({ piece, bone: 'hand.L', pos: PALM_L, rot: GRIP_L, ...extra });

export const LOADOUT: Record<string, Hold[]> = {
  marine: [R('cutlass')],
  elite: [R('sabre_gold')],
  rifleman: [R('rifle')],
  brute: [R('mace'), L('shield', { pos: [-0.02, 0.06, 0.05], rot: [Math.PI / 2, 0, 0] })],
  thug: [R('club')],
  wrecker: [R('boathook')],
  halvard: [R('halberd')],
  vale: [R('sabre_gold')],
  gorrick: [L('chain')],
  mira: [R('harpoon')],
  bram: [R('ladle')],
  ines: [R('cane', { rot: [0, 0, Math.PI / 2] })],
};

export function attach(kit: EnvKit, f: Fighter, h: Hold): InstancedMesh | null {
  const bone = f.model.bones.get(h.bone);
  if (!bone || !kit.has(h.piece)) return null;
  const inst = kit.instance(h.piece);
  if (!inst) return null;
  const node = new TransformNode(`${h.piece}@${h.bone}`, f.model.r.scene);
  node.parent = bone;
  // bones carry the armature's scale; undo it so props keep their authored size
  bone.computeWorldMatrix(true);
  const ws = bone.absoluteScaling;
  const wsAvg = Math.max(1e-4, (Math.abs(ws.x) + Math.abs(ws.y) + Math.abs(ws.z)) / 3);
  node.scaling.setAll((h.scale ?? 1) / wsAvg);
  node.position.copyFrom(new Vector3(...(h.pos ?? [0, 0, 0])).scale(1 / wsAvg));
  node.rotationQuaternion = Quaternion.FromEulerAngles(...(h.rot ?? [0, 0, 0]));
  inst.parent = node;
  f.model.r.addCaster(inst);
  f.model.props.push(node);
  return inst;
}

export function equip(kit: EnvKit, f: Fighter, kind: string): void {
  for (const h of LOADOUT[kind] ?? []) attach(kit, f, h);
}

/** Puts a story prop in a hand for a scene (the lantern, the logbook, the crown). */
export function hold(kit: EnvKit, f: Fighter, piece: string, hand: 'R' | 'L' = 'R'): void {
  attach(kit, f, hand === 'R' ? R(piece, { rot: [0, 0, 0] }) : L(piece, { rot: [0, 0, 0] }));
}

export function drop(f: Fighter, piece?: string): void {
  f.model.props = f.model.props.filter((n) => {
    if (piece && !n.name.startsWith(piece + '@')) return true;
    n.dispose();
    return false;
  });
}
