import { Matrix, Quaternion, Vector3, type MorphTarget } from '@babylonjs/core';
import type { RigBinding } from '../anim/Animator';

export type Expression = 'neutral' | 'determined' | 'angry' | 'pain' | 'effort' | 'sad' | 'surprised' | 'smile' | 'fear' | 'grief' | 'dead';

/** Morph weights for each expression (morph names come from the Blender shape keys). */
const EXPRESSIONS: Record<Expression, Record<string, number>> = {
  neutral: {},
  determined: { browDown_L: 0.3, browDown_R: 0.3, lipsPress: 0.3, squint_L: 0.15, squint_R: 0.15 },
  angry: { browDown_L: 0.85, browDown_R: 0.85, snarl: 0.4, squint_L: 0.35, squint_R: 0.35, lipsPress: 0.35 },
  pain: { browInner: 0.75, squint_L: 0.7, squint_R: 0.7, snarl: 0.35, mouthPart: 0.4, jawOpen: 0.18 },
  effort: { browDown_L: 0.6, browDown_R: 0.6, snarl: 0.5, squint_L: 0.5, squint_R: 0.5, jawOpen: 0.12, lipsWide: 0.3 },
  sad: { browInner: 0.8, frown: 0.5, squint_L: 0.1, squint_R: 0.1 },
  surprised: { browUp_L: 0.8, browUp_R: 0.8, wide_L: 0.55, wide_R: 0.55, jawOpen: 0.3 },
  smile: { smile: 0.6, squint_L: 0.2, squint_R: 0.2 },
  fear: { browInner: 0.7, browUp_L: 0.35, browUp_R: 0.35, wide_L: 0.5, wide_R: 0.5, lipsWide: 0.4 },
  grief: { browInner: 1, frown: 0.7, squint_L: 0.45, squint_R: 0.45, mouthPart: 0.25 },
  dead: { blink_L: 0.85, blink_R: 0.85, jawOpen: 0.2, mouthPart: 0.3 },
};

/**
 * Facial animation: expressions blended over time, automatic blinks (with occasional double blinks
 * and blink-on-saccade), speech mouth movement from a loudness envelope, and eye look-at through
 * the eye bones.
 */
export class Face {
  private targets = new Map<string, MorphTarget[]>();
  private weights = new Map<string, number>();
  private goal: Record<string, number> = {};
  expression: Expression = 'neutral';
  intensity = 1;
  /** 0..1 mouth opening from speech (set every frame by the voice system). */
  speech = 0;
  autoBlink = true;
  private blinkT = 0;
  private nextBlink = 2.5;
  private blinkPhase = -1;
  private doubleBlink = false;
  /** World-space point the eyes look at (null = straight ahead). */
  lookAt: Vector3 | null = null;
  private eyeL?: import('@babylonjs/core').TransformNode;
  private eyeR?: import('@babylonjs/core').TransformNode;
  private eyeRestL?: Quaternion;
  private eyeRestR?: Quaternion;
  private q = new Quaternion();
  private m = new Matrix();

  constructor(morphs: MorphTarget[], rig: RigBinding) {
    for (const m of morphs) {
      const list = this.targets.get(m.name) ?? [];
      list.push(m);
      this.targets.set(m.name, list);
    }
    this.eyeL = rig.bone('eye_l');
    this.eyeR = rig.bone('eye_r');
    this.eyeRestL = this.eyeL?.rotationQuaternion?.clone();
    this.eyeRestR = this.eyeR?.rotationQuaternion?.clone();
  }

  get hasMorphs(): boolean {
    return this.targets.size > 0;
  }

  set(e: Expression, intensity = 1): void {
    this.expression = e;
    this.intensity = intensity;
  }

  update(dt: number): void {
    if (!this.targets.size) return;
    const preset = EXPRESSIONS[this.expression] ?? {};
    this.goal = {};
    for (const [k, v] of Object.entries(preset)) this.goal[k] = v * this.intensity;
    // speech: jaw and lip shapes from the loudness envelope
    if (this.speech > 0.01) {
      const s = this.speech;
      this.goal.jawOpen = Math.max(this.goal.jawOpen ?? 0, s * 0.55);
      this.goal.mouthPart = Math.max(this.goal.mouthPart ?? 0, s * 0.5);
      this.goal.lipsPucker = (this.goal.lipsPucker ?? 0) + Math.max(0, Math.sin(performance.now() * 0.011)) * s * 0.25;
    }
    // blinks
    if (this.autoBlink && this.expression !== 'dead') {
      this.blinkT += dt;
      if (this.blinkPhase < 0 && this.blinkT >= this.nextBlink) {
        this.blinkPhase = 0;
        this.blinkT = 0;
        this.doubleBlink = Math.random() < 0.15;
        this.nextBlink = 1.8 + Math.random() * 4.2;
      }
      if (this.blinkPhase >= 0) {
        this.blinkPhase += dt / 0.16;
        const b = this.blinkPhase < 0.4 ? this.blinkPhase / 0.4 : Math.max(0, 1 - (this.blinkPhase - 0.4) / 0.6);
        this.goal.blink_L = Math.max(this.goal.blink_L ?? 0, b);
        this.goal.blink_R = Math.max(this.goal.blink_R ?? 0, b);
        if (this.blinkPhase >= 1) {
          this.blinkPhase = this.doubleBlink ? 0 : -1;
          this.doubleBlink = false;
        }
      }
    }
    const rate = Math.min(1, dt * 12);
    for (const name of this.targets.keys()) {
      const cur = this.weights.get(name) ?? 0;
      const g = this.goal[name] ?? 0;
      const fast = name.startsWith('blink') || name === 'jawOpen' ? 1 : rate;
      const v = cur + (g - cur) * fast;
      this.weights.set(name, v);
      for (const t of this.targets.get(name)!) t.influence = v;
    }
    this.updateEyes();
  }

  private updateEyes(): void {
    for (const [eye, rest] of [[this.eyeL, this.eyeRestL], [this.eyeR, this.eyeRestR]] as const) {
      if (!eye || !rest) continue;
      if (!this.lookAt) {
        eye.rotationQuaternion?.copyFrom(rest);
        continue;
      }
      const parent = eye.parent as import('@babylonjs/core').TransformNode;
      parent.computeWorldMatrix(true);
      const inv = parent.getWorldMatrix().clone().invert();
      const local = Vector3.TransformCoordinates(this.lookAt, inv).subtract(eye.position).normalize();
      // eye bones point along their local +Y; turn that towards the target, limited to ~30 degrees
      rest.toRotationMatrix(this.m);
      const restDir = Vector3.TransformNormal(new Vector3(0, 1, 0), this.m);
      const axis = Vector3.Cross(restDir, local);
      const ang = Math.min(0.5, Math.acos(Math.min(1, Math.max(-1, Vector3.Dot(restDir, local)))));
      if (axis.lengthSquared() < 1e-8) {
        eye.rotationQuaternion?.copyFrom(rest);
        continue;
      }
      Quaternion.RotationAxisToRef(axis.normalize(), ang, this.q);
      eye.rotationQuaternion = this.q.multiply(rest);
    }
  }
}
