import * as THREE from 'three';
import type { Appearance } from '../Appearance';
import { SLOT } from '../Appearance';
import { BONE_DEFS, BONE_INDEX, BoneName } from '../Skeleton';
import { BoneMix, ellipsoid, group, Op, PK, plane, Prim, rotInv, roundBox, roundCone, sphere, torus } from './Sdf';
import type { MeshPart } from './Mesher';

type V3 = [number, number, number];
const B = BONE_INDEX;

/** Modelling pose: arms lifted into an A so they don't fuse with the torso; legs slightly apart. */
export const MODEL_POSE: Partial<Record<BoneName, [number, number, number]>> = {
  upperArmL: [0, 0, THREE.MathUtils.degToRad(33)],
  upperArmR: [0, 0, THREE.MathUtils.degToRad(-33)],
  thighL: [0, 0, THREE.MathUtils.degToRad(3)],
  thighR: [0, 0, THREE.MathUtils.degToRad(-3)],
};

/** World matrices of every bone in the modelling pose. */
export function modelPoseMatrices(): Map<BoneName, THREE.Matrix4> {
  const bones = new Map<BoneName, THREE.Bone>();
  let root: THREE.Bone | null = null;
  for (const d of BONE_DEFS) {
    const b = new THREE.Bone();
    b.position.set(...d.offset);
    const r = MODEL_POSE[d.name];
    if (r) b.rotation.set(r[0], r[1], r[2]);
    bones.set(d.name, b);
    if (d.parent) bones.get(d.parent)!.add(b);
    else root = b;
  }
  root!.updateMatrixWorld(true);
  const out = new Map<BoneName, THREE.Matrix4>();
  for (const [n, b] of bones) out.set(n, b.matrixWorld.clone());
  return out;
}

export interface Detail {
  body: number;
  head: number;
  hand: number;
  shoe: number;
}
/**
 * Sculpt resolutions (cell size in metres). `hero` is for close-ups and cinematics, `game` for
 * the gameplay camera (athletes are a few hundred pixels tall at most), `far` for LOW quality.
 */
export const DETAILS = {
  hero: { body: 0.011, head: 0.0055, hand: 0.0036, shoe: 0.006 },
  game: { body: 0.021, head: 0.0115, hand: 0.0072, shoe: 0.0115 },
  far: { body: 0.028, head: 0.015, hand: 0.0095, shoe: 0.015 },
} satisfies Record<string, Detail>;
export type LodName = keyof typeof DETAILS;

/** The appearance fields that change the sculpt (colours are material-only). */
export type ShapeApp = Pick<Appearance, 'bulk' | 'hairStyle' | 'headband' | 'visor' | 'sleeveless' | 'wristbands'>;
export type PartKind = 'body' | 'head' | 'handL' | 'handR' | 'shoeL' | 'shoeR';
export const PART_KINDS: PartKind[] = ['body', 'head', 'handL', 'handR', 'shoeL', 'shoeR'];
const CANON: ShapeApp = { bulk: 1, hairStyle: 'bald', headband: false, visor: false, sleeveless: false, wristbands: false };

/**
 * Only the fields a part depends on, so parts are shared widely: every athlete shares the
 * same hands and shoes, heads vary by hair/headwear, bodies by build and kit cut.
 */
export function partShape(kind: PartKind, app: ShapeApp): ShapeApp {
  if (kind === 'body') return { ...CANON, bulk: Math.round(app.bulk * 20) / 20, sleeveless: !!app.sleeveless, wristbands: !!app.wristbands };
  if (kind === 'head') return { ...CANON, hairStyle: app.hairStyle, headband: !!app.headband, visor: !!app.visor };
  return CANON;
}
export function partKey(kind: PartKind, lod: LodName, app: ShapeApp): string {
  const a = partShape(kind, app);
  return [kind, lod, a.bulk, a.hairStyle, a.headband ? 1 : 0, a.visor ? 1 : 0, a.sleeveless ? 1 : 0, a.wristbands ? 1 : 0].join('|');
}

/** The sculpt for one part; neighbours come from the canonical body (for occlusion only). */
export function buildPart(kind: PartKind, lod: LodName, app: ShapeApp): MeshPart {
  const parts = buildAnatomy(partShape(kind, app), DETAILS[lod]);
  const part = parts[kind];
  if (kind !== 'body') part.aoContext = [buildAnatomy(CANON, DETAILS[lod]).body.prims];
  return part;
}

/** primitive tags used by the paint rules (limb tags get +side offsets) */
const TAG_SLEEVE = 1, TAG_SHORTS_LEG = 2, TAG_SOCK = 3, TAG_UPPER_ARM = 10, TAG_THIGH = 12;

/** Head centre in bind space (used by the face painter in the shader). */
export function headCentre(): V3 {
  const mats = modelPoseMatrices();
  const hp = new THREE.Vector3().setFromMatrixPosition(mats.get('head')!);
  return [0, hp.y + 0.112, 0.012];
}

/**
 * Build the sculpt for one athlete as separately meshed parts (body, head, two hands, two
 * shoes) — each at a resolution suited to its detail; overlaps are hidden under collars,
 * cuffs, wristbands and shoe collars.
 */
function buildAnatomy(app: ShapeApp, detail: Detail): Record<PartKind, MeshPart> {
  const M = modelPoseMatrices();
  const b = app.bulk;
  const l = 1 + (b - 1) * 0.75;
  const v = new THREE.Vector3();
  const P = (bone: BoneName, x: number, y: number, z: number): V3 => {
    v.set(x, y, z).applyMatrix4(M.get(bone)!);
    return [v.x, v.y, v.z];
  };
  /** world->local rotation of a bone frame, optionally with an extra local rotation */
  const R = (bone: BoneName, rx = 0, ry = 0, rz = 0): number[] => {
    const e = M.get(bone)!.elements;
    const boneInv = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
    if (!rx && !ry && !rz) return boneInv;
    return mul3(rotInv(rx, ry, rz), boneInv);
  };
  const bm = (...pairs: [BoneName, number][]): BoneMix => pairs.map(([n, w]) => [B[n], w]);

  const SK = SLOT.skin, J = SLOT.jersey, TR = SLOT.trim, SH = SLOT.shorts, SO = SLOT.socks, AC = SLOT.accent;
  const HC = headCentre();

  // ================================================================== BODY
  const body: Prim[] = [];
  body.push(
    ellipsoid(P('hips', 0, 0, -0.004), [0.158 * b, 0.102, 0.112 * b], { slot: SH, bones: bm(['hips', 1]) }),
    ellipsoid(P('hips', 0.068, -0.045, -0.058), [0.074 * b, 0.075, 0.062 * b], { k: 0.05, slot: SH, bones: bm(['hips', 0.7], ['thighL', 0.3]) }),
    ellipsoid(P('hips', -0.068, -0.045, -0.058), [0.074 * b, 0.075, 0.062 * b], { k: 0.05, slot: SH, bones: bm(['hips', 0.7], ['thighR', 0.3]) }),
    // waistband: a slightly raised band where the jersey meets the shorts
    torus(P('hips', 0, 0.075, 0.0), 1, 0.011, { ellipse: [0.127 * b, 0.09 * b], k: 0.02, slot: SH, bones: bm(['hips', 0.8], ['spine', 0.2]) }),
    ellipsoid(P('spine', 0, 0.035, 0.006), [0.142 * b, 0.125, 0.102 * b], { k: 0.06, slot: J, bones: bm(['spine', 1]) }),
    ellipsoid(P('chest', 0, 0.06, 0.004), [0.166 * b, 0.172, 0.113 * b], { k: 0.08, slot: J, bones: bm(['chest', 1]) }),
    // one broad pectoral plate: an athletic chest line for any build
    ellipsoid(P('chest', 0, 0.108, 0.05), [0.135 * b, 0.062, 0.058 * b], { k: 0.05, slot: J, bones: bm(['chest', 1]) }),
    ellipsoid(P('chest', 0.075, 0.085, -0.052), [0.07 * b, 0.11, 0.05 * b], { k: 0.05, slot: J, bones: bm(['chest', 1]) }),
    ellipsoid(P('chest', -0.075, 0.085, -0.052), [0.07 * b, 0.11, 0.05 * b], { k: 0.05, slot: J, bones: bm(['chest', 1]) }),
    // collar: ribbed crew neck
    torus(P('chest', 0, 0.229, 0.01), 1, 0.0095, { rot: rotInv(0.3, 0, 0), ellipse: [0.066 * Math.sqrt(b), 0.059], k: 0.014, slot: TR, bones: bm(['chest', 0.7], ['neck', 0.3]) }),
  );

  // hems are painted by height along the limb, so the cuff/hem line is a clean ring even where
  // muscle shapes poke up under the fabric
  const hemRef = new Map<number, { cone: Prim; t: number }>();
  for (const s of [1, -1] as const) {
    const L = s === 1 ? 'L' : 'R';
    const side = s === 1 ? 0 : 1;
    const armTag = TAG_UPPER_ARM + side, thighTag = TAG_THIGH + side;
    const clav = `clav${L}` as BoneName, up = `upperArm${L}` as BoneName, fore = `foreArm${L}` as BoneName;
    const thigh = `thigh${L}` as BoneName, shin = `shin${L}` as BoneName, foot = `foot${L}` as BoneName;
    const sleeve = app.sleeveless ? SK : J;
    // shoulders / trapezius slope
    body.push(
      roundCone(P('chest', s * 0.02, 0.215, -0.022), P(up, -s * 0.03, 0.012, -0.004), 0.05 * b, 0.05 * l, { k: 0.05, slot: J, bones: bm(['chest', 0.65], [clav, 0.35]) }),
      sphere(P(up, s * 0.006, -0.012, 0), 0.058 * l, { k: 0.045, slot: sleeve, bones: bm([up, 0.55], [clav, 0.3], ['chest', 0.15]) }),
    );
    if (!app.sleeveless) {
      body.push(
        roundCone(P(up, 0, -0.02, 0), P(up, 0, -0.132, 0), 0.057 * l, 0.056 * l, { k: 0.035, slot: J, tag: TAG_SLEEVE, bones: bm([up, 1]) }),
      );
    }
    const armCone = roundCone(P(up, 0, -0.1, 0), P(up, 0, -0.272, 0), 0.047 * l, 0.039 * l, { k: 0.025, slot: SK, tag: armTag, bones: bm([up, 1]), bonesB: bm([up, 0.5], [fore, 0.5]), t0: 0.78 });
    if (!app.sleeveless) hemRef.set(armTag, { cone: armCone, t: 0.5 });
    body.push(
      armCone,
      ellipsoid(P(up, 0, -0.168, 0.016), [0.035 * l, 0.062, 0.038 * l], { rot: R(up), k: 0.03, slot: SK, tag: armTag, bones: bm([up, 1]) }),
      ellipsoid(P(up, 0, -0.14, -0.018), [0.035 * l, 0.07, 0.034 * l], { rot: R(up), k: 0.03, slot: SK, tag: armTag, bones: bm([up, 1]) }),
      sphere(P(fore, 0, 0.004, -0.012), 0.035 * l, { k: 0.022, slot: SK, bones: bm([up, 0.5], [fore, 0.5]) }),
      roundCone(P(fore, 0, -0.012, 0), P(fore, 0, -0.238, 0), 0.041 * l, 0.028 * l, { k: 0.02, slot: SK, bones: bm([up, 0.3], [fore, 0.7]), bonesB: bm([fore, 1]), t0: 0.0, t1: 0.25 }),
      ellipsoid(P(fore, s * 0.004, -0.072, 0.004), [0.042 * l, 0.075, 0.037 * l], { rot: R(fore), k: 0.03, slot: SK, bones: bm([fore, 1]) }),
    );
    if (app.wristbands)
      body.push(roundCone(P(fore, 0, -0.184, 0), P(fore, 0, -0.242, 0), 0.0345 * l, 0.0325 * l, { k: 0.004, slot: AC, bones: bm([fore, 1]) }));

    // legs
    const thighCone = roundCone(P(thigh, 0, -0.18, 0), P(thigh, 0, -0.418, 0), 0.075 * l, 0.053 * l, { k: 0.02, slot: SK, tag: thighTag, bones: bm([thigh, 1]), bonesB: bm([thigh, 0.5], [shin, 0.5]), t0: 0.82 });
    hemRef.set(thighTag, { cone: thighCone, t: 0.43 });
    body.push(
      roundCone(P(thigh, 0, 0.035, 0), P(thigh, 0, -0.205, 0), 0.099 * l, 0.089 * l, { k: 0.06, slot: SH, tag: TAG_SHORTS_LEG, bones: bm(['hips', 0.4], [thigh, 0.6]), bonesB: bm([thigh, 1]), t0: 0.05, t1: 0.45 }),
      thighCone,
      ellipsoid(P(thigh, 0, -0.262, 0.022), [0.063 * l, 0.12, 0.057 * l], { rot: R(thigh), k: 0.04, slot: SK, tag: thighTag, bones: bm([thigh, 1]) }),
      sphere(P(shin, 0, 0.016, 0.021), 0.041 * l, { k: 0.025, slot: SK, bones: bm([thigh, 0.45], [shin, 0.55]) }),
      roundCone(P(shin, 0, -0.02, 0), P(shin, 0, -0.405, 0), 0.047 * l, 0.034 * l, { k: 0.02, slot: SK, bones: bm([shin, 1]) }),
      ellipsoid(P(shin, 0, -0.128, -0.025), [0.049 * l, 0.095, 0.048 * l], { rot: R(shin), k: 0.04, slot: SK, bones: bm([shin, 1]) }),
      roundCone(P(shin, 0, -0.265, 0), P(shin, 0, -0.418, 0), 0.0405 * l, 0.036 * l, { k: 0.006, slot: SO, tag: TAG_SOCK, bones: bm([shin, 1]), bonesB: bm([shin, 0.6], [foot, 0.4]), t0: 0.85 }),
    );
  }

  const bodyPaint = (slot: number, x: number, y: number, z: number, owner: Prim | null): number => {
    // cuffs, hems and sock stripes follow each garment's own axis
    if (owner) {
      if (owner.tag === TAG_SLEEVE && owner.axisT(x, y, z) > 0.94) return TR;
      if (owner.tag === TAG_SHORTS_LEG && owner.axisT(x, y, z) > 0.97) return TR;
      const hem = hemRef.get(owner.tag);
      if (hem && hem.cone.axisT(x, y, z) < hem.t) return TR;
      if (owner.tag === TAG_SOCK) {
        const t = owner.axisT(x, y, z);
        if ((t > 0.07 && t < 0.13) || (t > 0.17 && t < 0.23)) return TR;
      }
    }
    // jersey side panels and shorts side stripes in the trim / accent colours
    if (slot === J && y > 1.0 && y < 1.44 && Math.abs(z) < 0.034 && Math.abs(x) > 0.118 * b && Math.abs(x) < 0.2) return TR;
    if (slot === SH && Math.abs(z - 0.004) < 0.022 && Math.abs(x) > 0.15 * b && y > 0.72) return AC;
    return slot;
  };

  // ================================================================== HEAD
  const head: Prim[] = [];
  const H = (dx: number, dy: number, dz: number): V3 => [HC[0] + dx, HC[1] + dy, HC[2] + dz];
  head.push(
    roundCone([0, 1.415, -0.018], [0, 1.628, -0.004], 0.053, 0.046, { slot: SK, bones: bm(['chest', 0.45], ['neck', 0.55]), bonesB: bm(['neck', 0.35], ['head', 0.65]), t0: 0.35, t1: 0.95 }),
    ellipsoid(H(0, 0.022, -0.012), [0.104, 0.115, 0.118], { k: 0.045, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0, -0.03, 0.02), [0.075, 0.086, 0.09], { k: 0.05, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0.047, -0.052, -0.004), [0.026, 0.031, 0.04], { k: 0.035, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(-0.047, -0.052, -0.004), [0.026, 0.031, 0.04], { k: 0.035, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0, -0.101, 0.066), [0.025, 0.022, 0.024], { k: 0.032, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0.052, -0.004, 0.066), [0.027, 0.019, 0.026], { k: 0.03, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(-0.052, -0.004, 0.066), [0.027, 0.019, 0.026], { k: 0.03, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0, 0.036, 0.087), [0.07, 0.017, 0.022], { k: 0.03, slot: SK, bones: bm(['head', 1]) }),
    // gentle eye recesses for the painted eyes
    ellipsoid(H(0.035, 0.011, 0.119), [0.021, 0.014, 0.011], { op: Op.Subtract, k: 0.012, slot: SK }),
    ellipsoid(H(-0.035, 0.011, 0.119), [0.021, 0.014, 0.011], { op: Op.Subtract, k: 0.012, slot: SK }),
    // nose
    roundCone(H(0, 0.028, 0.104), H(0, -0.016, 0.121), 0.0075, 0.0098, { k: 0.012, slot: SK, bones: bm(['head', 1]) }),
    sphere(H(0, -0.021, 0.12), 0.0115, { k: 0.01, slot: SK, bones: bm(['head', 1]) }),
    sphere(H(0.0112, -0.027, 0.111), 0.0076, { k: 0.008, slot: SK, bones: bm(['head', 1]) }),
    sphere(H(-0.0112, -0.027, 0.111), 0.0076, { k: 0.008, slot: SK, bones: bm(['head', 1]) }),
    // lips
    ellipsoid(H(0, -0.052, 0.104), [0.022, 0.0074, 0.0098], { k: 0.008, slot: SK, bones: bm(['head', 1]) }),
    ellipsoid(H(0, -0.0655, 0.1), [0.0185, 0.0085, 0.0098], { k: 0.008, slot: SK, bones: bm(['head', 1]) }),
  );
  for (const s of [1, -1]) {
    head.push(
      ellipsoid(H(s * 0.103, 0.0, -0.006), [0.013, 0.03, 0.021], { rot: rotInv(0, s * 0.25, 0), k: 0.006, slot: SK, bones: bm(['head', 1]) }),
      ellipsoid(H(s * 0.113, 0.002, 0.0), [0.0065, 0.019, 0.012], { rot: rotInv(0, s * 0.25, 0), op: Op.Subtract, k: 0.004, slot: SK }),
    );
  }
  head.push(...buildHair(app, HC, bm));
  if (app.headband) {
    const t = app.hairStyle === 'bald' ? 0.002 : app.hairStyle === 'afro' ? 0.06 : app.hairStyle === 'buzz' ? 0.008 : 0.022;
    head.push(torus(H(0, 0.05, -0.01), 1, 0.012, { rot: rotInv(-0.2, 0, 0), ellipse: [0.101 + t, 0.114 + t], k: 0.006, slot: AC, bones: bm(['head', 1]) }));
  }
  if (app.visor) {
    head.push(
      group(
        [
          ellipsoid(H(0, 0.012, 0.004), [0.118, 0.13, 0.131], {}),
          ellipsoid(H(0, 0.012, 0.004), [0.108, 0.12, 0.121], { op: Op.Subtract }),
          plane(H(0, 0.036, 0), [0, 1, 0], { op: Op.Intersect }),
          plane(H(0, -0.012, 0), [0, -1, 0], { op: Op.Intersect }),
          plane(H(0, 0, 0.03), [0, 0, -1], { op: Op.Intersect }),
        ],
        { k: 0.002, slot: SLOT.visor, bones: bm(['head', 1]) },
      ),
    );
  }

  // ================================================================== HANDS
  const hands: MeshPart[] = [];
  for (const s of [1, -1] as const) {
    const L = s === 1 ? 'L' : 'R';
    const hand = `hand${L}` as BoneName, fore = `foreArm${L}` as BoneName;
    const hp: Prim[] = [];
    const bones = bm([hand, 1]);
    // fingers first (so they stay separate), then the palm blends into their bases
    const fz = [0.0245, 0.0082, -0.0082, -0.0235];
    const lens = [
      [0.036, 0.024, 0.02],
      [0.04, 0.026, 0.021],
      [0.037, 0.024, 0.02],
      [0.028, 0.019, 0.017],
    ];
    const rad = [0.0079, 0.0082, 0.0078, 0.007];
    const curl = [0.22, 0.42, 0.32];
    const spread = [0.07, 0.02, -0.03, -0.1];
    for (let f = 0; f < 4; f++) {
      let x = 0, y = -0.094, z = fz[f];
      let ang = 0.04 * f;
      let r = rad[f];
      for (let j = 0; j < 3; j++) {
        ang += curl[j];
        const len = lens[f][j];
        const dx = -s * Math.sin(ang) * len, dy = -Math.cos(ang) * len, dz = Math.sin(spread[f]) * len;
        const r2 = r * (j === 2 ? 0.86 : 0.93);
        hp.push(roundCone(P(hand, x, y, z), P(hand, x + dx, y + dy, z + dz), r, r2, { k: j === 0 ? 0.0 : 0.003, slot: SK, bones }));
        x += dx;
        y += dy;
        z += dz;
        r = r2;
      }
    }
    // thumb
    {
      const pts: V3[] = [
        [-s * 0.004, -0.032, 0.026],
        [-s * 0.014, -0.057, 0.047],
        [-s * 0.023, -0.077, 0.057],
        [-s * 0.029, -0.094, 0.06],
      ];
      const rr = [0.0115, 0.0098, 0.009, 0.0077];
      for (let j = 0; j < 3; j++) hp.push(roundCone(P(hand, ...pts[j]), P(hand, ...pts[j + 1]), rr[j], rr[j + 1], { k: 0.004, slot: SK, bones }));
    }
    hp.push(
      roundBox(P(hand, 0, -0.058, 0.002), [0.0055, 0.036, 0.029], 0.0118, { rot: R(hand), k: 0.013, slot: SK, bones }),
      ellipsoid(P(hand, -s * 0.009, -0.046, 0.027), [0.013, 0.027, 0.016], { rot: R(hand), k: 0.012, slot: SK, bones }),
      ellipsoid(P(hand, -s * 0.007, -0.05, -0.022), [0.011, 0.03, 0.012], { rot: R(hand), k: 0.012, slot: SK, bones }),
    );
    for (let f = 0; f < 4; f++) hp.push(sphere(P(hand, s * 0.01, -0.093, fz[f]), 0.0082, { k: 0.007, slot: SK, bones }));
    hp.push(roundCone(P(hand, 0, 0.03, 0), P(hand, 0, -0.022, 0.002), 0.028, 0.029, { k: 0.012, slot: SK, bones: bm([fore, 0.6], [hand, 0.4]), bonesB: bm([hand, 1]), t0: 0.2, t1: 0.8 }));
    hands.push({ prims: hp, cell: detail.hand, sigma: 0.008 });
  }

  // ================================================================== SHOES
  const shoes: MeshPart[] = [];
  for (const s of [1, -1] as const) {
    const foot = (s === 1 ? 'footL' : 'footR') as BoneName;
    const bones = bm([foot, 1]);
    const SO2 = SLOT.sole, SHO = SLOT.shoes;
    const sp: Prim[] = [
      roundBox(P(foot, 0, -0.066, 0.046), [0.037, 0.006, 0.116], 0.0085, { rot: R(foot), slot: SO2, bones }),
      roundBox(P(foot, 0, -0.058, -0.036), [0.036, 0.011, 0.034], 0.01, { rot: R(foot), k: 0.012, slot: SO2, bones }),
      ellipsoid(P(foot, 0, -0.06, 0.142), [0.041, 0.016, 0.034], { rot: R(foot), k: 0.014, slot: SO2, bones }),
      ellipsoid(P(foot, s * 0.002, -0.031, 0.052), [0.043, 0.036, 0.104], { rot: R(foot), k: 0.016, slot: SHO, bones }),
      ellipsoid(P(foot, 0, -0.022, -0.045), [0.041, 0.049, 0.042], { rot: R(foot), k: 0.026, slot: SHO, bones }),
      ellipsoid(P(foot, s * 0.003, -0.045, 0.122), [0.041, 0.025, 0.052], { rot: R(foot), k: 0.026, slot: SHO, bones }),
      torus(P(foot, 0, 0.012, -0.012), 1, 0.0105, { rot: R(foot, -0.28, 0, 0), ellipse: [0.037, 0.043], k: 0.012, slot: SHO, bones: bm([foot, 0.8], [(s === 1 ? 'shinL' : 'shinR') as BoneName, 0.2]) }),
      roundBox(P(foot, 0, 0.004, 0.034), [0.021, 0.0035, 0.034], 0.006, { rot: R(foot, -0.95, 0, 0), k: 0.01, slot: SHO, bones }),
      roundBox(P(foot, 0, 0.012, -0.066), [0.009, 0.012, 0.004], 0.003, { rot: R(foot), k: 0.004, slot: AC, bones }),
    ];
    for (const [z, y] of [[0.018, 0.008], [0.042, 0.009], [0.066, 0.005]]) sp.push(roundCone(P(foot, -0.016, y, z), P(foot, 0.016, y, z), 0.0034, 0.0034, { k: 0.002, slot: SO2, bones }));
    const inv = M.get(foot)!.clone().invert();
    const lv = new THREE.Vector3();
    shoes.push({
      prims: sp,
      cell: detail.shoe,
      sigma: 0.01,
      paint: (slot, x, y, z) => {
        if (slot !== SHO) return slot;
        lv.set(x, y, z).applyMatrix4(inv);
        // side swoosh from low heel to the midfoot
        const t = (lv.z + 0.035) / 0.13;
        if (t > 0 && t < 1 && Math.abs(lv.x) > 0.026) {
          const yc = -0.053 + t * 0.036;
          const th = 0.0045 + 0.004 * (1 - t);
          if (Math.abs(lv.y - yc) < th) return AC;
        }
        return slot;
      },
    });
  }

  return {
    body: { prims: body, cell: detail.body, sigma: 0.016, paint: bodyPaint },
    head: { prims: head, cell: detail.head, sigma: 0.012, flow: hairFlow(app, HC) },
    handL: hands[0],
    handR: hands[1],
    shoeL: shoes[0],
    shoeR: shoes[1],
  };
}

// ------------------------------------------------------------------ hair
/**
 * Strand direction for the hair shader: clumps and spikes follow their own axis; caps are
 * combed from the crown, swept styles flow back, tied styles pull toward the tie, afros swirl.
 */
function hairFlow(app: ShapeApp, HC: V3): MeshPart['flow'] {
  const style = app.hairStyle;
  const at = (dx: number, dy: number, dz: number): V3 => [HC[0] + dx, HC[1] + dy, HC[2] + dz];
  const crown = at(0, 0.125, -0.03);
  const tie = style === 'bun' ? at(0, 0.1, -0.1) : at(0, 0.04, -0.118);
  return (x, y, z, nx, _ny, nz, owner) => {
    if (!owner || owner.slot !== SLOT.hair) return null;
    const unit = (v: V3, k = 1): V3 => {
      const l = Math.hypot(...v) || 1;
      return [(v[0] / l) * k, (v[1] / l) * k, (v[2] / l) * k];
    };
    if (owner.kind === PK.RoundCone) return unit([owner.bx - owner.ax, owner.by - owner.ay, owner.bz - owner.az]);
    switch (style) {
      case 'swept':
        return [0, 0.35, -1];
      case 'bun':
      case 'ponytail':
        return [tie[0] - x, tie[1] - y, tie[2] - z];
      case 'afro':
        return unit([-nz, 0.3, nx], 0.2);
      case 'buzz':
        return unit([x - crown[0], y - crown[1], z - crown[2]], 0.45);
      default:
        return [x - crown[0], y - crown[1], z - crown[2]];
    }
  };
}

function buildHair(app: ShapeApp, HC: V3, bm: (...p: [BoneName, number][]) => BoneMix): Prim[] {
  const style = app.hairStyle;
  if (style === 'bald') return [];
  const HS = SLOT.hair;
  const bones = bm(['head', 1]);
  const H = (dx: number, dy: number, dz: number): V3 => [HC[0] + dx, HC[1] + dy, HC[2] + dz];
  /** skull-hugging cap with a natural hairline (forehead, temples, nape) */
  const cap = (t: number, extra: Prim[] = []) =>
    group(
      [
        ellipsoid(H(0, 0.024, -0.012), [0.104 + t, 0.116 + t, 0.119 + t], {}),
        ...extra,
        // forehead line
        plane(H(0, 0.052, 0.092), [0, -0.5, 1], { op: Op.Intersect, k: 0.022 }),
        // temples / above the ears, dropping toward the nape
        plane(H(0, -0.008, 0.0), [0, -1, 0.95], { op: Op.Intersect, k: 0.02 }),
      ],
      { k: 0.004, slot: HS, bones },
    );
  const clump = (a: V3, bb: V3, ra: number, rb: number, k = 0.012) => roundCone(H(...a), H(...bb), ra, rb, { k, slot: HS, bones });
  /** point on the skull (direction d, `off` above the scalp) */
  const skull = (d: V3, off: number): V3 => {
    const l = Math.hypot(...d) || 1;
    return H((d[0] / l) * (0.104 + off), 0.024 + (d[1] / l) * (0.116 + off), -0.012 + (d[2] / l) * (0.119 + off));
  };
  /**
   * A sculpted lock following the scalp from direction d0 to d1: its axis runs `off0`→`off1`
   * above the scalp (ends sink into the cap so they taper away), arching by `lift`.
   */
  const lock = (d0: V3, d1: V3, off0: number, off1: number, r0: number, r1: number, lift = 0): Prim[] => {
    const out: Prim[] = [];
    const n = 4;
    let prev = skull(d0, off0);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const d: V3 = [d0[0] + (d1[0] - d0[0]) * t, d0[1] + (d1[1] - d0[1]) * t, d0[2] + (d1[2] - d0[2]) * t];
      const cur = skull(d, off0 + (off1 - off0) * t + lift * Math.sin(t * Math.PI));
      out.push(roundCone(prev, cur, r0 + (r1 - r0) * ((i - 1) / n), r0 + (r1 - r0) * t, { k: 0.007 }));
      prev = cur;
    }
    return out;
  };
  /** locks combed from the hairline back to a tie, tapering into the cap at both ends */
  const combed = (tie: V3): Prim[] => {
    const out: Prim[] = [];
    for (const fx of [-0.8, -0.55, -0.3, -0.08, 0.14, 0.36, 0.6, 0.82]) out.push(...lock([fx, 0.46 - Math.abs(fx) * 0.12, 0.75], [tie[0] + fx * 0.22, tie[1], tie[2]], 0.0, -0.006, 0.02, 0.012, 0.004));
    for (const sx of [-1, 1]) out.push(...lock([sx * 0.95, 0.12, 0.15], [tie[0] + sx * 0.2, tie[1] - 0.05, tie[2]], 0.0, -0.006, 0.019, 0.012));
    return out;
  };
  switch (style) {
    case 'buzz':
      return [cap(0.005)];
    case 'short': {
      // locks combed forward from the crown, with soft grooves between them
      const locks: Prim[] = [];
      const fronts: [number, number][] = [[-0.78, 0.36], [-0.52, 0.47], [-0.26, 0.55], [0, 0.58], [0.26, 0.56], [0.52, 0.48], [0.78, 0.37]];
      for (const [fx, fy] of fronts) locks.push(...lock([fx * 0.3, 0.95, -0.4], [fx, fy, 0.72], 0.0, -0.004, 0.017, 0.009, 0.004));
      for (const sx of [-1, 1]) locks.push(...lock([sx * 0.3, 0.9, -0.5], [sx * 0.95, 0.2, -0.4], 0.0, -0.006, 0.016, 0.008));
      return [cap(0.013, locks)];
    }
    case 'swept': {
      // a lifted front sweeping back over the crown in broad clumps
      const locks: Prim[] = [];
      const xs = [-0.55, -0.28, 0, 0.28, 0.55];
      xs.forEach((x, i) => locks.push(...lock([x * 0.9, 0.62, 0.75], [x * 1.2, 0.3, -0.92], 0.006, -0.012, 0.024 - Math.abs(i - 2) * 0.002, 0.012, 0.02 - Math.abs(i - 2) * 0.005)));
      for (const sx of [-1, 1]) locks.push(...lock([sx * 0.8, 0.45, 0.45], [sx * 0.85, 0.1, -0.6], 0.002, -0.01, 0.018, 0.01));
      return [cap(0.016, locks)];
    }
    case 'spiky': {
      const parts: Prim[] = [cap(0.016)];
      const spikes: [V3, V3][] = [
        [[0, 0.11, 0.06], [0.0, 0.2, 0.1]],
        [[0.045, 0.11, 0.05], [0.08, 0.19, 0.08]],
        [[-0.045, 0.11, 0.05], [-0.08, 0.19, 0.07]],
        [[0.02, 0.13, -0.01], [0.04, 0.215, -0.02]],
        [[-0.03, 0.13, -0.01], [-0.055, 0.21, -0.03]],
        [[0.06, 0.1, -0.04], [0.12, 0.16, -0.08]],
        [[-0.06, 0.1, -0.04], [-0.12, 0.15, -0.07]],
        [[0.0, 0.1, -0.07], [0.0, 0.15, -0.15]],
        [[0.075, 0.06, 0.03], [0.13, 0.09, 0.06]],
        [[-0.075, 0.06, 0.03], [-0.13, 0.09, 0.05]],
      ];
      for (const [a, c] of spikes) parts.push(clump(a, c, 0.03, 0.005, 0.02));
      return parts;
    }
    case 'mohawk': {
      const parts: Prim[] = [cap(0.004)];
      for (let i = 0; i < 6; i++) {
        const z = 0.09 - i * 0.042;
        const y = 0.1 + Math.sin((i / 5) * Math.PI) * 0.03;
        parts.push(clump([0, y, z], [0, y + 0.07 - i * 0.004, z - 0.035], 0.02, 0.005, 0.015));
      }
      return parts;
    }
    case 'afro': {
      // a cloud of soft curl puffs around a full base
      const puffs: Prim[] = [sphere(H(0, 0.05, -0.015), 0.132)];
      const n = 34;
      for (let i = 0; i < n; i++) {
        const y = 1 - ((i + 0.5) / n) * 2;
        if (y < -0.5) continue;
        const r = Math.sqrt(1 - y * y), th = i * 2.39996;
        const jitter = ((i * 7919) % 13) / 13;
        const R = 0.126 + jitter * 0.008;
        puffs.push(sphere(H(Math.cos(th) * r * R, 0.05 + y * R, -0.015 + Math.sin(th) * r * R), 0.036 + jitter * 0.01, { k: 0.028 }));
      }
      return [
        group(
          [
            ...puffs,
            plane(H(0, 0.052, 0.098), [0, -0.45, 1], { op: Op.Intersect, k: 0.02 }),
            plane(H(0, -0.03, 0.0), [0, -1, 0.8], { op: Op.Intersect, k: 0.02 }),
          ],
          { k: 0.004, slot: HS, bones },
        ),
      ];
    }
    case 'bun':
      return [
        cap(0.014, combed([0, 0.62, -0.78])),
        sphere(H(0, 0.1, -0.1), 0.047, { k: 0.014, slot: HS, bones, noise: [0.003, 60] }),
        torus(H(0, 0.075, -0.085), 1, 0.008, { rot: rotInv(1.0, 0, 0), ellipse: [0.03, 0.03], k: 0.004, slot: SLOT.accent, bones }),
      ];
    case 'ponytail':
      return [
        cap(0.015, combed([0, 0.12, -0.99])),
        torus(H(0, 0.04, -0.118), 1, 0.009, { rot: rotInv(1.25, 0, 0), ellipse: [0.022, 0.022], k: 0.004, slot: SLOT.accent, bones }),
        clump([0, 0.045, -0.125], [0, -0.02, -0.165], 0.026, 0.024, 0.012),
        clump([0, -0.02, -0.165], [0, -0.1, -0.16], 0.024, 0.016, 0.01),
        clump([0, -0.1, -0.16], [0, -0.15, -0.14], 0.016, 0.006, 0.01),
      ];
  }
  return [];
}

function mul3(a: number[], b: number[]): number[] {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
