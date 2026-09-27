import * as THREE from 'three';
import type { CharacterMaterial } from './CharacterMaterial';

/**
 * Drives the painted face: blinks, eye darts, gaze toward what the athlete cares about, and
 * expressions blended from the athlete's current emotion over their resting brow style.
 */

export type Emotion = 'neutral' | 'focus' | 'strain' | 'yell' | 'surprise' | 'pain' | 'daze' | 'joy' | 'smirk' | 'sad';

// brow anger, brow raise (m), smile (-1..1), mouth open (0..1), squint (0..1)
const EMO: Record<Emotion, [number, number, number, number, number]> = {
  neutral: [0, 0, 0.15, 0, 0],
  focus: [0.45, 0, -0.05, 0, 0.12],
  strain: [1, 0, -0.45, 0.14, 0.4],
  yell: [1.1, 0.001, -0.2, 0.85, 0.35],
  surprise: [-0.3, 0.0055, 0, 0.42, 0],
  pain: [-0.55, 0.003, -0.7, 0.5, 0.85],
  daze: [-0.4, 0.002, -0.3, 0.2, 0.3],
  joy: [-0.45, 0.0035, 1, 0.55, 0.35],
  smirk: [0.2, 0.001, 0.75, 0, 0.2],
  sad: [-0.75, 0.003, -0.65, 0, 0.15],
};
/** how strongly each emotion overrides the character's resting brow style */
const OVERRIDE: Record<Emotion, number> = {
  neutral: 0, focus: 0.55, strain: 0.85, yell: 0.9, surprise: 0.9, pain: 0.95, daze: 0.9, joy: 0.9, smirk: 0.7, sad: 0.9,
};

const _inv = new THREE.Matrix4();
const _d = new THREE.Vector3();

export class FaceAnimator {
  private blinkT = -1;
  private nextBlink = 1 + Math.random() * 3;
  private doubleBlink = false;
  private gx = 0;
  private gy = 0;
  private dartX = 0;
  private dartY = 0;
  private nextDart = Math.random() * 2;
  private expr = new THREE.Vector4();
  private squint = 0;
  private started = false;

  /**
   * @param look world point to look at (null: idle eye darts around straight ahead)
   * @param eyesShut extra lid closure 0..1 (daze, knocked out)
   */
  update(dt: number, mat: CharacterMaterial, head: THREE.Object3D, emotion: Emotion, look: THREE.Vector3 | null, eyesShut = 0) {
    // ---- blink
    this.nextBlink -= dt;
    if (this.blinkT < 0 && this.nextBlink <= 0) {
      this.blinkT = 0;
      this.nextBlink = 1.6 + Math.random() * 3.6;
      this.doubleBlink = Math.random() < 0.18;
    }
    let blink = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT;
      // fast close, brief hold, slower open
      blink = t < 0.055 ? t / 0.055 : t < 0.085 ? 1 : Math.max(0, 1 - (t - 0.085) / 0.1);
      if (t > 0.185) {
        if (this.doubleBlink) {
          this.doubleBlink = false;
          this.blinkT = 0;
        } else this.blinkT = -1;
      }
    }

    // ---- gaze: small darts on top of the look target
    this.nextDart -= dt;
    if (this.nextDart <= 0) {
      this.nextDart = 0.4 + Math.random() * 1.8;
      const idle = look ? 0.18 : 0.55;
      this.dartX = (Math.random() * 2 - 1) * idle;
      this.dartY = (Math.random() * 2 - 1) * idle * 0.6;
    }
    let tx = this.dartX, ty = this.dartY;
    if (look) {
      _inv.copy(head.matrixWorld).invert();
      _d.copy(look).applyMatrix4(_inv);
      // face points along +Z in head space
      const yaw = Math.atan2(_d.x, Math.max(0.05, _d.z));
      const pitch = Math.atan2(_d.y - 0.1, Math.hypot(_d.x, _d.z));
      tx += THREE.MathUtils.clamp(yaw / 0.55, -1, 1);
      ty += THREE.MathUtils.clamp(pitch / 0.45, -1, 1);
    }
    // saccades are quick
    const k = 1 - Math.exp(-dt * 28);
    this.gx += (THREE.MathUtils.clamp(tx, -1, 1) - this.gx) * k;
    this.gy += (THREE.MathUtils.clamp(ty, -1, 1) - this.gy) * k;

    // ---- expression
    const e = EMO[emotion];
    const w = OVERRIDE[emotion];
    const b = mat.baseExpr;
    const ke = 1 - Math.exp(-dt * (emotion === 'yell' || emotion === 'pain' || emotion === 'surprise' ? 22 : 9));
    const target = [b.x + (e[0] - b.x) * w, b.y + (e[1] - b.y) * w, b.z + (e[2] - b.z) * w, b.w + (e[3] - b.w) * w];
    if (!this.started) {
      this.expr.set(target[0], target[1], target[2], target[3]);
      this.squint = e[4];
      this.started = true;
    }
    this.expr.x += (target[0] - this.expr.x) * ke;
    this.expr.y += (target[1] - this.expr.y) * ke;
    this.expr.z += (target[2] - this.expr.z) * ke;
    this.expr.w += (target[3] - this.expr.w) * ke;
    this.squint += (e[4] - this.squint) * ke;

    const u = mat.u;
    u.uFace.value.set(Math.max(blink, eyesShut, this.squint * 0.28), this.gx, this.gy, this.squint);
    u.uExpr.value.copy(this.expr);
  }
}
