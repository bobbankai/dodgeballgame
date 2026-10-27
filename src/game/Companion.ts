import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { inkify } from '../core/Assets';
import { Animator } from './Animator';
import type { Collision } from './Collision';
import type { Player } from './Player';

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();

function angleTo(a: number, b: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Pip, the paper fox: trots after Ada, keeps a little to one side, hops up and down ledges, sits
 * when she stops for a while. Story scripts can send it somewhere or have it talk.
 */
export class Companion {
  readonly root = new THREE.Group();
  readonly anim: Animator;
  readonly position = this.root.position;
  yaw = 0;
  /** Scripted destination; while set, Pip ignores Ada. */
  goal: THREE.Vector3 | null = null;
  follow = true;
  speaking = false;
  /** Look at this instead of where it's going (conversations). */
  lookAt: THREE.Vector3 | null = null;
  private speed = 0;
  private idleTime = 0;
  private hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null = null;
  private side = 1;

  constructor(gltf: GLTF) {
    const model = gltf.scene;
    inkify(model, () => ({ alwaysColor: true, hatch: 0.5, soft: 0.04 }));
    model.traverse((o) => (o.frustumCulled = false));
    this.root.add(model);
    this.anim = new Animator(model, gltf.animations, ['hop']);
  }

  place(p: THREE.Vector3, yaw = 0) {
    this.position.copy(p);
    this.yaw = yaw;
    this.hop = null;
  }

  private ground(col: Collision, x: number, z: number, nearY: number) {
    _v.set(x, nearY + 1.6, z);
    return col.groundAt(_v, 4);
  }

  update(dt: number, ada: Player, col: Collision) {
    const a = this.anim;
    // where to be: a little behind and beside Ada, or the scripted goal
    let target: THREE.Vector3 | null = null;
    if (this.goal) target = this.goal;
    else if (this.follow) {
      const behind = 1.3, beside = 1.0 * this.side;
      _t.set(Math.sin(ada.yaw) * -behind + Math.cos(ada.yaw) * beside, 0, Math.cos(ada.yaw) * -behind - Math.sin(ada.yaw) * beside).add(ada.position);
      target = _t;
      // keep to whichever side Pip is already on
      _v.subVectors(this.position, ada.position);
      const rightOfAda = _v.x * Math.cos(ada.yaw) - _v.z * Math.sin(ada.yaw);
      if (Math.abs(rightOfAda) > 0.6) this.side = Math.sign(rightOfAda);
      // too far behind: reappear just out of sight
      if (this.position.distanceTo(ada.position) > 16 && !this.hop) {
        this.position.set(ada.position.x - Math.sin(ada.yaw) * 3, ada.position.y, ada.position.z - Math.cos(ada.yaw) * 3);
        const g = this.ground(col, this.position.x, this.position.z, ada.position.y + 1);
        if (g !== null) this.position.y = g;
      }
    }

    if (this.hop) {
      const h = this.hop;
      h.t += dt / h.dur;
      const k = Math.min(1, h.t);
      this.position.lerpVectors(h.from, h.to, k);
      this.position.y += Math.sin(Math.PI * k) * (0.5 + Math.abs(h.to.y - h.from.y) * 0.4) + (h.to.y - h.from.y) * (k * k - k) * 0;
      if (k >= 1) this.hop = null;
      a.target({ hop: 1 }, 20);
    } else {
      let want = 0;
      if (target) {
        _v.subVectors(target, this.position).setY(0);
        const d = _v.length();
        const arrive = this.goal ? 0.15 : 0.6;
        if (d > arrive) {
          // gallop to catch up, trot nearby, ease in at the end
          const top = this.goal ? 3.4 : d > 5 ? 5.2 : d > 2.2 ? 3.6 : 2.0;
          want = Math.min(top, (d - arrive) * 2.5 + 0.6);
          const dir = Math.atan2(_v.x, _v.z);
          this.yaw += angleTo(this.yaw, dir) * (1 - Math.exp(-dt * 9));
        } else if (this.goal) this.goal = null;
      }
      this.speed += (want - this.speed) * (1 - Math.exp(-dt * 6));
      if (this.speed > 0.02) {
        const nx = this.position.x + Math.sin(this.yaw) * this.speed * dt;
        const nz = this.position.z + Math.cos(this.yaw) * this.speed * dt;
        const g = this.ground(col, nx, nz, this.position.y);
        if (g !== null && Math.abs(g - this.position.y) < 0.45) {
          this.position.set(nx, g, nz);
        } else {
          // a ledge or a step up: hop to a spot nearer Ada if it is landable
          const tgt = this.goal ?? ada.position;
          const hx = this.position.x + (tgt.x - this.position.x) * 0.6;
          const hz = this.position.z + (tgt.z - this.position.z) * 0.6;
          const hg = this.ground(col, hx, hz, Math.max(this.position.y, tgt.y));
          if (hg !== null && Math.abs(hg - this.position.y) < 3.5) {
            this.hop = { from: this.position.clone(), to: new THREE.Vector3(hx, hg, hz), t: 0, dur: 0.55 };
            this.anim.restart('hop');
          } else this.speed = 0;
        }
      }
      if (this.lookAt && this.speed < 0.3) {
        const dir = Math.atan2(this.lookAt.x - this.position.x, this.lookAt.z - this.position.z);
        this.yaw += angleTo(this.yaw, dir) * (1 - Math.exp(-dt * 6));
      }
      this.idleTime = this.speed < 0.15 ? this.idleTime + dt : 0;
      const s = this.speed;
      const move = THREE.MathUtils.smoothstep(s, 0.05, 0.5);
      const run = THREE.MathUtils.smoothstep(s, 2.8, 4.2);
      const still = this.speaking ? 'talk' : this.idleTime > 4 && !this.lookAt ? 'sit' : 'idle';
      a.target({ [still]: 1 - move, trot: move * (1 - run), run: move * run }, 8);
      const trot = a.actions.get('trot'), gal = a.actions.get('run');
      if (trot) trot.timeScale = Math.max(0.6, s / 2.2);
      if (gal) gal.timeScale = Math.max(0.7, s / 4.4);
    }
    this.root.rotation.y = this.yaw;
    a.update(dt);
  }
}
