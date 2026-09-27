import * as THREE from 'three';
import { ellipsoid, group, Op, plane, Prim, roundBox, roundCone, sphere } from '../character/sculpt/Sdf';
import { meshPart, MeshOut } from '../character/sculpt/Mesher';

/**
 * Spectators sculpted from the same SDF clay as the athletes, at crowd resolution.
 * The part id (baked per vertex) drives colouring and the GPU cheering animation:
 */
export const SP = {
  shirt: 0,
  skin: 1,
  sleeveL: 2,
  sleeveR: 3,
  pants: 4,
  hair: 5,
  hat: 6,
  handL: 7,
  handR: 8,
  shoes: 9,
} as const;
/** Shoulder pivots the shader rotates the arms around (x = ±, y). */
export const ARM_PIVOT = { x: 0.2, y: 0.46 };
export const SPECTATOR_VARIANTS = 3;

const cache = new Map<string, THREE.BufferGeometry>();

type V3 = [number, number, number];

/** Seated (bench-top origin) or standing (hip-height origin) spectator; +Z faces the court. */
export function spectatorGeometry(standing: boolean, variant: number): THREE.BufferGeometry {
  const key = `${standing ? 's' : 'b'}${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // ---------------- body: pelvis, torso, neck, legs
  const body: Prim[] = [
    ellipsoid([0, 0.09, 0], [0.165, 0.1, 0.12], { slot: SP.pants }),
    ellipsoid([0, 0.21, 0.005], [0.155, 0.13, 0.115], { k: 0.07, slot: SP.shirt }),
    ellipsoid([0, 0.36, -0.01], [0.185, 0.16, 0.118], { k: 0.08, slot: SP.shirt }),
    sphere([0.165, 0.45, -0.02], 0.068, { k: 0.06, slot: SP.shirt }),
    sphere([-0.165, 0.45, -0.02], 0.068, { k: 0.06, slot: SP.shirt }),
    roundCone([0, 0.47, -0.02], [0, 0.6, -0.005], 0.052, 0.047, { k: 0.03, slot: SP.skin }),
  ];
  for (const s of [1, -1]) {
    const x = s * 0.088;
    if (standing) {
      body.push(
        roundCone([x, 0.06, 0], [x * 1.1, -0.4, 0.015], 0.078, 0.058, { k: 0.04, slot: SP.pants }),
        roundCone([x * 1.1, -0.4, 0.015], [x * 1.1, -0.76, -0.01], 0.056, 0.044, { k: 0.02, slot: SP.pants }),
        ellipsoid([x * 1.1, -0.79, 0.04], [0.05, 0.04, 0.1], { k: 0.02, slot: SP.shoes }),
      );
    } else {
      body.push(
        roundCone([x, 0.07, 0.02], [x * 1.1, 0.075, 0.37], 0.078, 0.064, { k: 0.04, slot: SP.pants }),
        roundCone([x * 1.1, 0.07, 0.38], [x * 1.1, -0.27, 0.42], 0.056, 0.045, { k: 0.02, slot: SP.pants }),
        ellipsoid([x * 1.1, -0.31, 0.47], [0.05, 0.04, 0.1], { k: 0.02, slot: SP.shoes }),
      );
    }
  }

  // ---------------- head: face with a nose, hair or a cap
  const HC: V3 = [0, 0.69, 0.01];
  const H = (x: number, y: number, z: number): V3 => [HC[0] + x, HC[1] + y, HC[2] + z];
  const head: Prim[] = [
    ellipsoid(H(0, 0, 0), [0.092, 0.112, 0.102], { slot: SP.skin }),
    ellipsoid(H(0, -0.045, 0.03), [0.07, 0.065, 0.075], { k: 0.04, slot: SP.skin }),
    sphere(H(0, -0.005, 0.1), 0.02, { k: 0.02, slot: SP.skin }),
    sphere(H(0.092, -0.005, -0.005), 0.022, { k: 0.012, slot: SP.skin }),
    sphere(H(-0.092, -0.005, -0.005), 0.022, { k: 0.012, slot: SP.skin }),
  ];
  const cap = (t: number, extra: Prim[] = []) =>
    group(
      [
        ellipsoid(H(0, 0.02, -0.01), [0.092 + t, 0.112 + t, 0.104 + t]),
        ...extra,
        plane(H(0, 0.045, 0.085), [0, -0.5, 1], { op: Op.Intersect, k: 0.012 }),
        plane(H(0, -0.01, 0), [0, -1, 0.9], { op: Op.Intersect, k: 0.012 }),
      ],
      { k: 0.006, slot: SP.hair },
    );
  if (variant === 0) head.push(cap(0.018));
  else if (variant === 1) {
    // longer hair falling to the shoulders
    head.push(cap(0.024), roundCone(H(0, -0.01, -0.06), H(0, -0.13, -0.075), 0.085, 0.07, { k: 0.03, slot: SP.hair }));
  } else {
    // team cap: crown and brim
    head.push(
      group(
        [ellipsoid(H(0, 0.03, -0.005), [0.104, 0.1, 0.112]), plane(H(0, 0.02, 0), [0, -1, 0], { op: Op.Intersect, k: 0.01 })],
        { k: 0.004, slot: SP.hat },
      ),
      roundBox(H(0, 0.028, 0.11), [0.07, 0.006, 0.05], 0.006, { k: 0.01, slot: SP.hat }),
    );
  }

  // ---------------- arms (separate so they can swing about the shoulder)
  const arm = (s: number): Prim[] => {
    const sl = s > 0 ? SP.sleeveL : SP.sleeveR;
    const hd = s > 0 ? SP.handL : SP.handR;
    const sh: V3 = [s * ARM_PIVOT.x, ARM_PIVOT.y - 0.01, -0.02];
    const elbow: V3 = standing ? [s * 0.23, 0.2, 0.0] : [s * 0.23, 0.2, 0.03];
    const wrist: V3 = standing ? [s * 0.22, -0.03, 0.08] : [s * 0.17, 0.12, 0.25];
    const mid: V3 = [(sh[0] + elbow[0]) / 2, (sh[1] + elbow[1]) / 2, (sh[2] + elbow[2]) / 2];
    return [
      roundCone(sh, mid, 0.058, 0.052, { slot: sl }),
      roundCone(mid, elbow, 0.046, 0.042, { k: 0.02, slot: hd }),
      roundCone(elbow, wrist, 0.041, 0.034, { k: 0.02, slot: hd }),
      ellipsoid([wrist[0] * 1.02, wrist[1] - 0.02, wrist[2] + 0.035], [0.034, 0.045, 0.03], { k: 0.02, slot: hd }),
    ];
  };

  const out = new MeshOut();
  meshPart({ prims: body, cell: 0.074, splitSlots: false }, out);
  meshPart({ prims: head, cell: 0.043, aoContext: [body], splitSlots: false }, out);
  meshPart({ prims: arm(1), cell: 0.054, aoContext: [body], splitSlots: false }, out);
  meshPart({ prims: arm(-1), cell: 0.054, aoContext: [body], splitSlots: false }, out);

  const n = out.count;
  const ao = new Float32Array(n);
  for (let i = 0; i < n; i++) ao[i] = out.detail[i * 2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(out.slot, 1));
  g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1));
  g.setIndex(out.idx);
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}
