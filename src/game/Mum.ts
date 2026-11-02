import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify, lineIdFor } from '../core/Assets';
import { Animator } from './Animator';
import { Face } from './Face';

/**
 * Mum, as she drew herself into the last page (tools/blender/mum.py): long copper hair and a braid,
 * an indigo dress under a paint-splashed apron. She is drawn in (and out again) from the feet up
 * with a line of gold, holds a pose for each moment of the scene, talks, blinks and turns to look.
 */
export class Mum {
  readonly root = new THREE.Group();
  readonly anim: Animator;
  readonly expression: Face;
  /** World height she is drawn up to (see InkOptions.reveal). */
  readonly cut = { value: -1e3 };
  speaking = false;
  pose = 'idle';
  lookAt: THREE.Vector3 | null = null;
  yaw = 0;
  private blinkIn = 2;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    // the eyes are drawn like Ada's: a line round the white and the iris, none round the glints, no hatching
    const eye = ['mum_eye_white', 'mum_iris', 'mum_eye_hi'];
    // what shines: gold, her leather shoes, a sheen on her hair, a little on her lips
    const shine: Record<string, [number, number, number]> = {
      mum_gold: [0.9, 0.06, 1], mum_shoe: [0.55, 0.05, 0.5], mum_sole: [0.3, 0.06, 0.4], mum_hair: [0.35, 0.08, 0.06],
      mum_lips: [0.35, 0.05, 0.5], mum_skin: [0.12, 0.05, 0.25], mum_ribbon: [0.3, 0.06, 0.3], mum_dress: [0.15, 0.08, 0.2],
    };
    inkify(model, (name) => ({
      alwaysColor: true,
      hatch: eye.includes(name) ? 0 : name === 'mum_skin' ? 0.22 : name === 'mum_hair' ? 0.6 : 0.45,
      soft: eye.includes(name) ? 0.3 : name === 'mum_skin' ? 0.2 : name === 'mum_hair' ? 0.09 : 0.06,
      skin: name === 'mum_skin',
      ...(name === 'mum_dress' || name === 'mum_dress_dark' || name === 'mum_apron' ? { sheen: 0.22 } : {}),
      reveal: this.cut,
      ...(name === 'mum_eye_hi' ? { lineId: lineIdFor('mum_iris'), emissive: 0.7 } : {}),
      ...(name === 'mum_eye_white' ? { emissive: 0.18 } : {}),
      ...(shine[name] ? { gloss: shine[name][0], glossSize: shine[name][1], glossWhite: shine[name][2] } : {}),
    }));
    model.traverse((o) => (o.frustumCulled = false));
    this.root.add(model);
    this.anim = new Animator(model, gltf.animations);
    // a grown-up's features are finer than Ada's: the same expressions, smaller movements
    this.expression = new Face(model, gltf.animations, 0.62);
    this.root.visible = false;
  }

  private headBone: THREE.Object3D | null = null;

  /** Where her face is right now (follows the pose: standing, kneeling...). */
  face(out = new THREE.Vector3()) {
    this.headBone ??= this.root.getObjectByName('head') ?? null;
    if (!this.headBone) return out.copy(this.root.position).add(new THREE.Vector3(0, 1.6, 0));
    this.root.updateMatrixWorld(true);
    this.headBone.getWorldPosition(out);
    // the head bone starts at the base of the skull: the face is a little above and in front
    return out.add(new THREE.Vector3(Math.sin(this.yaw) * 0.06, 0.11, Math.cos(this.yaw) * 0.06));
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
    if (this.blinkIn <= 0 && !this.expression.has) {
      a.blink();
      this.blinkIn = 2 + Math.random() * 3;
    }
    a.overlay('speak', this.speaking && !this.expression.has);
    this.root.rotation.y = this.yaw;
    a.update(dt);
    this.expression.update(dt);
  }
}
