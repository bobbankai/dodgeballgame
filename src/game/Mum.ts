import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify } from '../core/Assets';
import { Animator } from './Animator';

/**
 * Mum, as she drew herself into the last page. She is drawn in (and out again) from the feet up
 * with a line of gold, holds a pose for each moment of the scene, talks, blinks and turns to look.
 */
export class Mum {
  readonly root = new THREE.Group();
  readonly anim: Animator;
  /** World height she is drawn up to (see InkOptions.reveal). */
  readonly cut = { value: -1e3 };
  speaking = false;
  pose = 'idle';
  lookAt: THREE.Vector3 | null = null;
  yaw = 0;
  private blinkIn = 2;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    inkify(model, () => ({ alwaysColor: true, hatch: 0.5, soft: 0.05, reveal: this.cut }));
    model.traverse((o) => (o.frustumCulled = false));
    this.root.add(model);
    this.anim = new Animator(model, gltf.animations);
    this.root.visible = false;
  }

  place(p: THREE.Vector3, yaw = this.yaw) {
    this.root.position.copy(p);
    this.yaw = yaw;
  }

  /** How far up she is drawn, 0 (not at all) .. 1 (all of her). */
  set drawn(k: number) {
    this.cut.value = this.root.position.y - 0.05 + k * 1.85;
    this.root.visible = k > 0.001;
  }

  update(dt: number) {
    const a = this.anim;
    a.target({ [this.speaking && this.pose === 'idle' ? 'talk' : this.pose]: 1 }, 4);
    if (this.lookAt) {
      const dir = Math.atan2(this.lookAt.x - this.root.position.x, this.lookAt.z - this.root.position.z);
      let d = dir - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 3));
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      a.blink();
      this.blinkIn = 2 + Math.random() * 3;
    }
    a.overlay('speak', this.speaking);
    this.root.rotation.y = this.yaw;
    a.update(dt);
  }
}
