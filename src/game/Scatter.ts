import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { inkMaterial } from '../render/InkMaterial';

/** A tuft of grass: a few folded blades leaning out from the centre. */
function tuftGeometry() {
  const pos: number[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + Math.sin(k * 7.3) * 0.4;
    const dx = Math.cos(a), dz = Math.sin(a);
    const h = 0.2 + ((k * 37) % 10) / 60;
    const w = 0.028;
    const lean = 0.06 + ((k * 13) % 5) / 60;
    pos.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * lean, h, dz * lean);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // blades catch light from above like the ground they grow from
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  return g;
}

function flowerGeometry() {
  const g = new THREE.IcosahedronGeometry(0.06, 0);
  g.scale(1, 0.55, 1);
  g.translate(0, 0.16, 0);
  return g;
}

export interface ScatterOptions {
  count: number;
  /** x/z bounds to try. */
  min: THREE.Vector2;
  max: THREE.Vector2;
  /** Accept a spot given the terrain colour there (linear RGB) and its normal. */
  accept: (color: THREE.Color, normal: THREE.Vector3, p: THREE.Vector3) => boolean;
}

/**
 * Plant instanced grass tufts and flowers on a terrain mesh, choosing spots by the terrain's
 * painted vertex colours (so paths and rock stay bare).
 */
export function scatter(terrain: THREE.Mesh, opts: ScatterOptions, seed = 1, lineId = 251) {
  terrain.updateMatrixWorld(true);
  const geo = terrain.geometry.clone().applyMatrix4(terrain.matrixWorld);
  const bvh = new MeshBVH(geo);
  const col = geo.attributes.color as THREE.BufferAttribute | undefined;
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const c = new THREE.Color(), tmp = new THREE.Color();
  const grass: THREE.Matrix4[] = [];
  const flowers: { m: THREE.Matrix4; c: number }[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const palette = [0xf2eee6, 0xe8c440, 0xe07a9a, 0xd0503c, 0xf2eee6];
  for (let i = 0; i < opts.count * 3 && grass.length < opts.count; i++) {
    const x = opts.min.x + rnd() * (opts.max.x - opts.min.x);
    const z = opts.min.y + rnd() * (opts.max.y - opts.min.y);
    ray.origin.set(x, 200, z);
    const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
    if (!hit || !hit.face) continue;
    c.setRGB(1, 1, 1);
    if (col) {
      const f = hit.face;
      const ids = [f.a, f.b, f.c];
      c.setRGB(0, 0, 0);
      for (const id of ids) c.add(tmp.fromBufferAttribute(col, id).multiplyScalar(1 / 3));
    }
    if (!opts.accept(c, hit.face.normal, hit.point)) continue;
    // tufts come in little clumps
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const p = hit.point.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.5, -0.02, (rnd() - 0.5) * 0.5));
      q.setFromUnitVectors(up, hit.face.normal.clone().lerp(up, 0.6).normalize());
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, rnd() * Math.PI * 2));
      const sc = 0.7 + rnd() * 0.8;
      grass.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, sc * (0.8 + rnd() * 0.5), sc)));
    }
    if (rnd() < 0.08) {
      const fc = palette[Math.floor(rnd() * palette.length)];
      for (let k = 0; k < 3 + rnd() * 4; k++) {
        const p = hit.point.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.9, 0, (rnd() - 0.5) * 0.9));
        flowers.push({ m: new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 0.8 + rnd() * 0.6, 1)), c: fc });
      }
    }
  }
  const group = new THREE.Group();
  const gm = new THREE.InstancedMesh(tuftGeometry(), inkMaterial({ color: 0x86b05e, hatch: 0.3, soft: 0.3, side: THREE.DoubleSide, lineId }), grass.length);
  grass.forEach((m, i) => gm.setMatrixAt(i, m));
  gm.receiveShadow = true;
  group.add(gm);
  const byColor = new Map<number, THREE.Matrix4[]>();
  for (const f of flowers) {
    if (!byColor.has(f.c)) byColor.set(f.c, []);
    byColor.get(f.c)!.push(f.m);
  }
  for (const [color, ms] of byColor) {
    const fm = new THREE.InstancedMesh(flowerGeometry(), inkMaterial({ color, hatch: 0.2, soft: 0.2 }), ms.length);
    ms.forEach((m, i) => fm.setMatrixAt(i, m));
    group.add(fm);
  }
  geo.dispose();
  return group;
}
