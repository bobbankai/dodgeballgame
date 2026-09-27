import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Athlete } from '../game/Athlete';

interface Ghost {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  bones: THREE.Bone[];
  mat: THREE.MeshBasicMaterial;
  life: number;
  t: number;
  alpha: number;
  drift: THREE.Vector3;
  source: Athlete | null;
}

/**
 * Afterimages: frozen, tinted copies of an athlete's current pose.
 * Pooled per athlete so geometry is shared and nothing is allocated mid-match.
 */
export class GhostPool {
  readonly root = new THREE.Group();
  private pools = new Map<Athlete, Ghost[]>();
  private active: Ghost[] = [];

  private make(a: Athlete): Ghost {
    const root = cloneSkinned(a.rig.root) as THREE.Object3D;
    let mesh: THREE.SkinnedMesh | null = null;
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh;
    });
    const m = mesh as unknown as THREE.SkinnedMesh;
    const mat = new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    m.material = mat;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.renderOrder = 16;
    const bones = m.skeleton.bones;
    root.visible = false;
    this.root.add(root);
    return { root, mesh: m, bones, mat, life: 0.4, t: 0, alpha: 0.5, drift: new THREE.Vector3(), source: null };
  }

  /** Snapshot athlete's pose now. */
  spawn(a: Athlete, color: THREE.ColorRepresentation, life = 0.4, alpha = 0.45, drift?: THREE.Vector3) {
    let pool = this.pools.get(a);
    if (!pool) {
      pool = [];
      this.pools.set(a, pool);
    }
    let g = pool.find((x) => !x.root.visible);
    if (!g) {
      if (pool.length >= 6) g = pool.reduce((p, q) => (p.t / p.life > q.t / q.life ? p : q));
      else {
        g = this.make(a);
        pool.push(g);
      }
    }
    // copy transforms
    g.root.position.copy(a.rig.root.position);
    g.root.quaternion.copy(a.rig.root.quaternion);
    g.root.scale.copy(a.rig.root.scale);
    const src = a.rig.bones;
    for (let i = 0; i < src.length; i++) {
      g.bones[i].position.copy(src[i].position);
      g.bones[i].quaternion.copy(src[i].quaternion);
    }
    g.root.updateMatrixWorld(true);
    g.mat.color.set(color);
    g.life = life;
    g.t = 0;
    g.alpha = alpha;
    g.drift.copy(drift ?? new THREE.Vector3());
    g.root.visible = true;
    g.source = a;
    if (!this.active.includes(g)) this.active.push(g);
    return g;
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const g = this.active[i];
      g.t += dt;
      const k = g.t / g.life;
      if (k >= 1) {
        g.root.visible = false;
        this.active.splice(i, 1);
        continue;
      }
      g.mat.opacity = g.alpha * (1 - k) * (1 - k);
      if (g.drift.lengthSq() > 0) {
        g.root.position.addScaledVector(g.drift, dt);
        g.root.updateMatrixWorld(true);
      }
    }
  }

  forget(a: Athlete) {
    const pool = this.pools.get(a);
    if (!pool) return;
    for (const g of pool) {
      this.root.remove(g.root);
      g.mat.dispose();
      g.mesh.skeleton.dispose();
    }
    this.pools.delete(a);
    this.active = this.active.filter((g) => g.source !== a);
  }

  clear() {
    for (const a of Array.from(this.pools.keys())) this.forget(a);
  }
}
