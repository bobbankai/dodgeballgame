/**
 * Bone layout shared by every athlete. Character faces +Z; its LEFT side is +X.
 * All bones have identity rotation in bind pose, so authored Euler angles are
 * directly relative to a relaxed "arms down" stance.
 *
 * Euler conventions (XYZ, degrees in clip data):
 *  - Arms (hang down):  x < 0 raises arm forward, x > 0 swings back.
 *                       z > 0 moves arm toward +X (left arm: abduct / right arm: adduct).
 *  - Forearm:           x < 0 flexes elbow.
 *  - Thigh:             x < 0 flexes hip (leg forward).
 *  - Shin:              x > 0 flexes knee.
 *  - Foot:              x > 0 points toe down.
 *  - Spine/chest/head:  x > 0 bends forward, y > 0 twists toward +X (left), z > 0 leans toward -X (right).
 */
export const BONE_NAMES = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'clavL',
  'upperArmL',
  'foreArmL',
  'handL',
  'clavR',
  'upperArmR',
  'foreArmR',
  'handR',
  'thighL',
  'shinL',
  'footL',
  'thighR',
  'shinR',
  'footR',
] as const;

export type BoneName = (typeof BONE_NAMES)[number];
export const BONE_COUNT = BONE_NAMES.length;
export const BONE_INDEX: Record<BoneName, number> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as any;

export interface BoneDef {
  name: BoneName;
  parent: BoneName | null;
  offset: [number, number, number];
}

export const BONE_DEFS: BoneDef[] = [
  { name: 'hips', parent: null, offset: [0, 0.98, 0] },
  { name: 'spine', parent: 'hips', offset: [0, 0.1, 0] },
  { name: 'chest', parent: 'spine', offset: [0, 0.17, 0] },
  { name: 'neck', parent: 'chest', offset: [0, 0.24, -0.005] },
  { name: 'head', parent: 'neck', offset: [0, 0.075, 0.005] },
  { name: 'clavL', parent: 'chest', offset: [0.03, 0.19, -0.01] },
  { name: 'upperArmL', parent: 'clavL', offset: [0.165, -0.015, 0] },
  { name: 'foreArmL', parent: 'upperArmL', offset: [0, -0.28, 0] },
  { name: 'handL', parent: 'foreArmL', offset: [0, -0.255, 0] },
  { name: 'clavR', parent: 'chest', offset: [-0.03, 0.19, -0.01] },
  { name: 'upperArmR', parent: 'clavR', offset: [-0.165, -0.015, 0] },
  { name: 'foreArmR', parent: 'upperArmR', offset: [0, -0.28, 0] },
  { name: 'handR', parent: 'foreArmR', offset: [0, -0.255, 0] },
  { name: 'thighL', parent: 'hips', offset: [0.1, -0.05, 0] },
  { name: 'shinL', parent: 'thighL', offset: [0, -0.43, 0] },
  { name: 'footL', parent: 'shinL', offset: [0, -0.42, 0] },
  { name: 'thighR', parent: 'hips', offset: [-0.1, -0.05, 0] },
  { name: 'shinR', parent: 'thighR', offset: [0, -0.43, 0] },
  { name: 'footR', parent: 'shinR', offset: [0, -0.42, 0] },
];

/** Bind-pose world positions of each bone (identity rotations ⇒ offsets just accumulate). */
export function bindPositions(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const d of BONE_DEFS) {
    if (!d.parent) out.push([...d.offset]);
    else {
      const p = out[BONE_INDEX[d.parent]];
      out.push([p[0] + d.offset[0], p[1] + d.offset[1], p[2] + d.offset[2]]);
    }
  }
  return out;
}

export const UPPER_BODY: BoneName[] = ['spine', 'chest', 'neck', 'head', 'clavL', 'upperArmL', 'foreArmL', 'handL', 'clavR', 'upperArmR', 'foreArmR', 'handR'];
export const LOWER_BODY: BoneName[] = ['hips', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const ARM_R: BoneName[] = ['clavR', 'upperArmR', 'foreArmR', 'handR'];
export const ARM_L: BoneName[] = ['clavL', 'upperArmL', 'foreArmL', 'handL'];

export function mirrorName(n: BoneName): BoneName {
  if (n.endsWith('L')) return (n.slice(0, -1) + 'R') as BoneName;
  if (n.endsWith('R')) return (n.slice(0, -1) + 'L') as BoneName;
  return n;
}
