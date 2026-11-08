import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { solveTwoBone, rotateBoneWorld, FootIK } from '../src/anim/IK';

/** a leg: hip at (0, 1, 0), knee 0.45 below and slightly forward, ankle 0.45 below that */
function leg(name = 'l', x = 0) {
  const root = new THREE.Object3D();
  const pelvis = new THREE.Bone(); pelvis.name = 'pelvis'; pelvis.position.set(0, 1, 0); root.add(pelvis);
  const thigh = new THREE.Bone(); thigh.name = `thigh_${name}`; thigh.position.set(x, 0, 0); pelvis.add(thigh);
  const calf = new THREE.Bone(); calf.name = `calf_${name}`; calf.position.set(0, -0.45, 0.04); thigh.add(calf);
  const foot = new THREE.Bone(); foot.name = `foot_${name}`; foot.position.set(0, -0.45, -0.04); calf.add(foot);
  root.updateMatrixWorld(true);
  return { root, pelvis, thigh, calf, foot };
}

const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('rotateBoneWorld', () => {
  it('rotates about the world axes regardless of the parent', () => {
    const p = new THREE.Object3D();
    p.rotation.set(0.3, 1.1, -0.4);
    const b = new THREE.Object3D();
    b.position.set(0, 0, 0);
    const child = new THREE.Object3D();
    child.position.set(1, 0, 0);
    b.add(child);
    p.add(b);
    p.updateMatrixWorld(true);
    const before = wp(child);
    rotateBoneWorld(b, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
    const after = wp(child);
    // a quarter turn about world up maps (x, y, z) to (z, y, -x)
    expect(after.x).toBeCloseTo(before.z, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    expect(after.z).toBeCloseTo(-before.x, 5);
  });
});

describe('two-bone IK', () => {
  it('reaches a target within range exactly', () => {
    const L = leg();
    const target = new THREE.Vector3(0.1, 0.35, 0.2);
    const r = solveTwoBone(L.thigh, L.calf, L.foot, target);
    expect(r.clamped).toBe(false);
    expect(r.error).toBeLessThan(1e-3);
    expect(wp(L.foot).distanceTo(target)).toBeLessThan(1e-3);
  });

  it('keeps the bone lengths', () => {
    const L = leg();
    const lab = wp(L.thigh).distanceTo(wp(L.calf)), lcb = wp(L.calf).distanceTo(wp(L.foot));
    solveTwoBone(L.thigh, L.calf, L.foot, new THREE.Vector3(0.2, 0.4, -0.1));
    expect(wp(L.thigh).distanceTo(wp(L.calf))).toBeCloseTo(lab, 5);
    expect(wp(L.calf).distanceTo(wp(L.foot))).toBeCloseTo(lcb, 5);
  });

  it('straightens towards an out-of-reach target', () => {
    const L = leg();
    const r = solveTwoBone(L.thigh, L.calf, L.foot, new THREE.Vector3(0, -2, 0));
    expect(r.clamped).toBe(true);
    const dir = wp(L.foot).sub(wp(L.thigh)).normalize();
    expect(dir.y).toBeLessThan(-0.99);
  });

  it('bends the knee forwards as the animation did', () => {
    const L = leg();
    // pull the foot up: the knee must come forward (+z), not backward
    solveTwoBone(L.thigh, L.calf, L.foot, new THREE.Vector3(0, 0.45, 0));
    expect(wp(L.calf).z).toBeGreaterThan(0.1);
  });

  it('weight blends between the pose and the solution', () => {
    const L = leg();
    const start = wp(L.foot);
    const target = new THREE.Vector3(0.15, 0.3, 0.25);
    solveTwoBone(L.thigh, L.calf, L.foot, target, 0);
    expect(wp(L.foot).distanceTo(start)).toBeLessThan(1e-4);
    const M = leg();
    solveTwoBone(M.thigh, M.calf, M.foot, target, 0.5);
    const half = wp(M.foot);
    expect(half.distanceTo(start)).toBeGreaterThan(0.01);
    expect(half.distanceTo(target)).toBeGreaterThan(0.01);
  });

  it('is stable when re-solved every frame', () => {
    const L = leg();
    const target = new THREE.Vector3(0.05, 0.25, 0.1);
    for (let i = 0; i < 30; i++) solveTwoBone(L.thigh, L.calf, L.foot, target);
    expect(wp(L.foot).distanceTo(target)).toBeLessThan(1e-3);
  });
});

describe('foot IK', () => {
  function rig() {
    const root = new THREE.Object3D();
    const pelvis = new THREE.Bone(); pelvis.name = 'pelvis'; pelvis.position.set(0, 0.95, 0); root.add(pelvis);
    const bones = new Map<string, THREE.Bone>([['pelvis', pelvis]]);
    for (const [s, x] of [['l', 0.1], ['r', -0.1]] as const) {
      const thigh = new THREE.Bone(); thigh.name = `thigh_${s}`; thigh.position.set(x, 0, 0); pelvis.add(thigh);
      const calf = new THREE.Bone(); calf.name = `calf_${s}`; calf.position.set(0, -0.44, 0.03); thigh.add(calf);
      const foot = new THREE.Bone(); foot.name = `foot_${s}`; foot.position.set(0, -0.43, -0.03); calf.add(foot);
      bones.set(thigh.name, thigh); bones.set(calf.name, calf); bones.set(foot.name, foot);
    }
    root.updateMatrixWorld(true);
    return { root, bones };
  }

  it('lowers the pelvis and plants each foot on a step', () => {
    const { root, bones } = rig();
    // a step: the right foot (x < 0) stands 0.25 lower
    const ground = (x: number, _y: number, _z: number, n: THREE.Vector3) => { n.set(0, 1, 0); return x < 0 ? -0.25 : 0; };
    const ik = new FootIK(bones, ground, { speed: 1000 });
    const animFootL = wp(bones.get('foot_l')!).y, animFootR = wp(bones.get('foot_r')!).y;
    for (let i = 0; i < 20; i++) { ik.restore(); ik.capture(); ik.apply(1 / 30, root); }
    expect(ik.drop).toBeCloseTo(-0.25, 2);
    expect(wp(bones.get('foot_r')!).y).toBeCloseTo(animFootR - 0.25, 2);
    expect(wp(bones.get('foot_l')!).y).toBeCloseTo(animFootL, 2);
  });

  it('does nothing on flat ground', () => {
    const { root, bones } = rig();
    const ik = new FootIK(bones, (_x, _y, _z, n) => { n.set(0, 1, 0); return 0; }, { speed: 1000 });
    const before = wp(bones.get('foot_l')!);
    for (let i = 0; i < 5; i++) { ik.restore(); ik.capture(); ik.apply(1 / 30, root); }
    expect(wp(bones.get('foot_l')!).distanceTo(before)).toBeLessThan(1e-3);
    expect(Math.abs(ik.drop)).toBeLessThan(1e-4);
  });

  it('fades out when its weight is zero, and restore() undoes the corrections', () => {
    const { root, bones } = rig();
    const ik = new FootIK(bones, (x, _y, _z, n) => { n.set(0, 1, 0); return x < 0 ? -0.3 : 0; }, { speed: 1000 });
    const pelvis = bones.get('pelvis')!;
    const y0 = pelvis.position.y;
    ik.capture();
    ik.apply(1 / 30, root);
    ik.restore();
    expect(pelvis.position.y).toBeCloseTo(y0);
    ik.weight = 0;
    for (let i = 0; i < 60; i++) { ik.restore(); ik.capture(); ik.apply(1 / 30, root); }
    ik.restore();
    ik.capture();
    ik.apply(1 / 30, root);
    expect(Math.abs(pelvis.position.y - y0)).toBeLessThan(0.02);
  });

  it('tilts the feet to a gentle slope but not to a cliff', () => {
    const { root, bones } = rig();
    const slope = new THREE.Vector3(0.3, 1, 0).normalize();
    const ik = new FootIK(bones, (_x, _y, _z, n) => { n.copy(slope); return 0; }, { speed: 1000 });
    const foot = bones.get('foot_l')!;
    const q0 = foot.getWorldQuaternion(new THREE.Quaternion());
    for (let i = 0; i < 10; i++) { ik.restore(); ik.capture(); ik.apply(1 / 30, root); }
    const q1 = foot.getWorldQuaternion(new THREE.Quaternion());
    expect(q0.angleTo(q1)).toBeGreaterThan(0.2);
    const cliff = rig();
    const ik2 = new FootIK(cliff.bones, (_x, _y, _z, n) => { n.set(0.9, 0.3, 0).normalize(); return 0; }, { speed: 1000 });
    const f2 = cliff.bones.get('foot_l')!;
    const a0 = f2.getWorldQuaternion(new THREE.Quaternion());
    for (let i = 0; i < 10; i++) { ik2.restore(); ik2.capture(); ik2.apply(1 / 30, cliff.root); }
    expect(a0.angleTo(f2.getWorldQuaternion(new THREE.Quaternion()))).toBeLessThan(0.05);
  });
});
