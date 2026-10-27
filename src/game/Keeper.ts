import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify } from '../core/Assets';
import { Animator } from './Animator';

/**
 * The lighthouse keeper: an old paper crane. Stands, talks, bows, and flies short hops (up to the
 * lantern gallery). Drawn in pencil like the rest of the book until its blue comes back.
 */
export class Keeper {
  readonly root = new THREE.Group();
  readonly anim: Animator;
  speaking = false;
  lookAt: THREE.Vector3 | null = null;
  yaw = 0;
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; done: () => void } | null = null;
  private bowing = 0;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    inkify(model, () => ({ hatch: 0.4, soft: 0.06 }));
    model.traverse((o) => (o.frustumCulled = false));
    this.root.add(model);
    this.anim = new Animator(model, gltf.animations, ['bow']);
  }

  place(p: THREE.Vector3, yaw = this.yaw) {
    this.root.position.copy(p);
    this.yaw = yaw;
  }

  bow() {
    this.anim.restart('bow');
    this.bowing = this.anim.duration('bow');
  }

  /** Fly in a gentle arc to a point; resolves on landing. */
  flyTo(to: THREE.Vector3, dur = 2.5): Promise<void> {
    return new Promise((done) => (this.flight = { from: this.root.position.clone(), to: to.clone(), t: 0, dur, done }));
  }

  update(dt: number) {
    const a = this.anim;
    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.dur;
      const k = Math.min(1, f.t);
      const e = k * k * (3 - 2 * k);
      this.root.position.lerpVectors(f.from, f.to, e);
      this.root.position.y += Math.sin(Math.PI * k) * 2.5;
      const dir = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
      this.yaw += (dir - this.yaw) * (1 - Math.exp(-dt * 4));
      a.target({ flap: 1 }, 10);
      if (k >= 1) {
        this.flight = null;
        f.done();
      }
    } else if (this.bowing > 0) {
      this.bowing -= dt;
      a.target({ bow: 1 }, 10);
    } else {
      a.target({ [this.speaking ? 'talk' : 'idle']: 1 }, 6);
      if (this.lookAt) {
        const dir = Math.atan2(this.lookAt.x - this.root.position.x, this.lookAt.z - this.root.position.z);
        let d = dir - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * (1 - Math.exp(-dt * 3));
      }
    }
    this.root.rotation.y = this.yaw;
    a.update(dt);
  }
}
