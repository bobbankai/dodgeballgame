import * as THREE from 'three';
import { G } from '../render/Globals';
import { WAVES } from '../render/glsl';
import { inkMaterial } from '../render/InkMaterial';

const K = WAVES.map((w) => (2 * Math.PI) / w.len);

/** Height of the sea at (x, z) at time t: the same sum of waves the shader draws. */
export function seaHeight(x: number, z: number, t = G.uTime.value, storm = G.uStorm.value) {
  let h = 0;
  for (let i = 0; i < WAVES.length; i++) {
    const w = WAVES[i];
    h += w.amp * Math.sin((x * w.dir[0] + z * w.dir[1]) * K[i] + t * w.speed + w.phase);
  }
  return h * (1 + storm * 1.8);
}

/**
 * The Folded Sea: a big grid of triangles pushed about by waves in the vertex shader and shaded
 * facet by facet, so it reads as folded paper. Grey pencil until the blue comes back.
 */
export class Sea {
  readonly mesh: THREE.Mesh;

  constructor(center: THREE.Vector2, size: THREE.Vector2, cell = 1.9) {
    const nx = Math.ceil(size.x / cell), nz = Math.ceil(size.y / cell);
    const pos: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        // nudge vertices off the grid a little so the folds don't look machine-made
        const jx = Math.sin(i * 12.9898 + j * 78.233) * 0.18 * cell;
        const jz = Math.sin(i * 39.346 + j * 11.135) * 0.18 * cell;
        pos.push(center.x - size.x / 2 + i * cell + jx, 0, center.y - size.y / 2 + j * cell + jz);
      }
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
        if ((i + j) % 2) idx.push(a, c, b, b, c, d);
        else idx.push(a, c, d, a, d, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.boundingSphere!.radius += 4;
    this.mesh = new THREE.Mesh(g, inkMaterial({ color: 0x3f7fb3, waves: true, water: true, hatch: 0.35, soft: 0.25, lineId: 6 }));
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
  }
}
