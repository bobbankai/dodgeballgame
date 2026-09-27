import * as THREE from 'three';
import { Appearance } from './Appearance';
import { BONE_DEFS, BoneName } from './Skeleton';
import { CharacterMaterial } from './CharacterMaterial';
import { LodName, MODEL_POSE } from './sculpt/Anatomy';
import { acquireGeometry, acquireGeometryAsync, releaseGeometry } from './sculpt/SculptCache';

export interface CharacterLod {
  /** always-present mesh for the gameplay camera */
  base: THREE.BufferGeometry;
  /** close-up mesh, sculpted in the background (null until it arrives or when not used) */
  hero: THREE.BufferGeometry | null;
  usingHero: boolean;
  released: boolean;
}

export interface CharacterRig {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  material: CharacterMaterial;
  bones: THREE.Bone[];
  boneByName: Record<BoneName, THREE.Bone>;
  sockets: {
    handR: THREE.Object3D;
    handL: THREE.Object3D;
    chest: THREE.Object3D;
    head: THREE.Object3D;
    hips: THREE.Object3D;
  };
  height: number;
  lod: CharacterLod;
}

// ------------------------------------------------------------------ detail levels
let levels: { base: LodName; hero: LodName } = { base: 'game', hero: 'hero' };
/**
 * Character mesh detail for the quality preset (takes effect for new builds): full detail uses
 * a gameplay mesh plus a close-up mesh; reduced uses coarser meshes for both.
 */
export function setCharacterDetail(detail: 'full' | 'reduced') {
  levels = detail === 'full' ? { base: 'game', hero: 'hero' } : { base: 'far', hero: 'game' };
}

export function buildCharacter(app: Appearance, jersey: { number?: number; name?: string } = {}): CharacterRig {
  const lv = levels;
  const geom = acquireGeometry(lv.base, app);
  const material = new CharacterMaterial(app);
  material.setJersey(jersey.number ?? 7, jersey.name ?? '', app.bulk);

  // ---------------- skeleton: bind in the sculpt pose, then relax to the animation rest pose
  const bones: THREE.Bone[] = [];
  const byName = {} as Record<BoneName, THREE.Bone>;
  for (const d of BONE_DEFS) {
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.set(...d.offset);
    const r = MODEL_POSE[d.name];
    if (r) b.rotation.set(r[0], r[1], r[2]);
    bones.push(b);
    byName[d.name] = b;
    if (d.parent) byName[d.parent].add(b);
  }
  const root = new THREE.Group();
  root.name = 'athlete';
  root.add(bones[0]);
  const mesh = new THREE.SkinnedMesh(geom, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  root.add(mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  for (const b of bones) b.quaternion.identity();
  root.updateMatrixWorld(true);

  const mk = (parent: THREE.Object3D, x: number, y: number, z: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const sockets = {
    handR: mk(byName.handR, 0.075, -0.075, 0.03),
    handL: mk(byName.handL, -0.075, -0.075, 0.03),
    chest: mk(byName.chest, 0, 0.06, 0.08),
    head: mk(byName.head, 0, 0.12, 0),
    hips: mk(byName.hips, 0, 0, 0),
  };
  root.scale.setScalar(app.height);
  const lod: CharacterLod = { base: geom, hero: null, usingHero: false, released: false };
  if (lv.hero !== lv.base)
    acquireGeometryAsync(lv.hero, app).then((g) => {
      if (lod.released) releaseGeometry(g);
      else lod.hero = g;
    });
  return { root, mesh, material, bones, boneByName: byName, sockets, height: app.height, lod };
}

const _p = new THREE.Vector3();
/**
 * Swap to the close-up mesh when the athlete fills a good part of the screen
 * (with hysteresis so it doesn't flicker at the threshold).
 */
export function updateCharacterLod(rig: CharacterRig, camera: THREE.PerspectiveCamera) {
  const lod = rig.lod;
  if (!lod.hero) return;
  rig.root.getWorldPosition(_p);
  _p.y += 0.9 * rig.height;
  const d = Math.max(0.05, _p.distanceTo(camera.position));
  // fraction of the viewport height covered by the athlete
  const frac = (1.8 * rig.height) / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const want = lod.usingHero ? frac > 0.3 : frac > 0.36;
  if (want !== lod.usingHero) {
    lod.usingHero = want;
    rig.mesh.geometry = want ? lod.hero : lod.base;
  }
}

/** Free this athlete's GPU resources (shared geometry goes back to the cache). */
export function disposeCharacter(rig: CharacterRig) {
  rig.mesh.skeleton.dispose();
  rig.material.dispose();
  const lod = rig.lod;
  if (lod.released) return;
  lod.released = true;
  releaseGeometry(lod.base);
  if (lod.hero) releaseGeometry(lod.hero);
  lod.hero = null;
}
