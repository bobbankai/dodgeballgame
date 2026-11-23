import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

/** eyes open, brow height, brow tilt (+ inner ends down), mouth corners up, mouth open, mouth wide */
type Shape = [number, number, number, number, number, number];

export const EXPRESSIONS: Record<string, Shape> = {
  neutral: [1, 0, 0, 0, 0, 0],
  angry: [0.82, -0.7, 1.0, -0.5, 0.12, 0.2],
  determined: [0.86, -0.35, 0.65, -0.1, 0, 0],
  sad: [0.72, 0.35, -1.0, -0.65, 0, -0.1],
  grief: [0.38, 0.45, -1.2, -0.9, 0.35, 0.15],
  surprised: [1.22, 1.0, -0.25, 0, 0.6, -0.25],
  smile: [0.88, 0.25, -0.1, 0.85, 0.08, 0.3],
  gentle: [0.78, 0.15, -0.35, 0.45, 0, 0.1],
  pain: [0.3, -0.45, 0.9, -0.6, 0.45, 0.45],
  shout: [0.95, -0.6, 1.0, -0.35, 1.0, 0.45],
  cold: [0.68, -0.2, 0.25, -0.15, 0, -0.1],
  tired: [0.55, 0.0, -0.2, -0.1, 0, 0],
  fear: [1.15, 0.8, -0.8, -0.5, 0.3, 0.2],
  closed: [0.05, 0.1, -0.2, 0.1, 0, 0],
};

/**
 * Anime faces on the shared face bones: eyes squash shut to blink, brows rise, fall and tilt,
 * mouth corners lift and drop, the mouth opens for vowels while talking. Values ease toward the
 * expression and are written on top of the rest pose every frame.
 */
export class Face {
  private cur: Shape = [...EXPRESSIONS.neutral] as Shape;
  private goal: Shape = [...EXPRESSIONS.neutral] as Shape;
  private nodes: Record<string, TransformNode | undefined> = {};
  private restPos = new Map<string, Vector3>();
  private restScale = new Map<string, Vector3>();
  private blinkT = 2 + Math.random() * 3;
  private blink = 0;
  talking = 0;
  private talkPhase = 0;
  expression = 'neutral';
  autoBlink = true;
  /** metres per unit of brow / mouth movement, from the head size */
  private unit = 0.006;

  constructor(bones: Map<string, TransformNode>, headHeight: number) {
    for (const k of ['eye_L', 'eye_R', 'brow_L', 'brow_R', 'mouth', 'mouth_L', 'mouth_R']) {
      const n = bones.get(k);
      this.nodes[k] = n;
      if (n) {
        this.restPos.set(k, n.position.clone());
        this.restScale.set(k, n.scaling.clone());
        if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.Identity();
      }
    }
    this.unit = headHeight * 0.028;
  }

  set(name: string): void {
    const s = EXPRESSIONS[name] ?? EXPRESSIONS.neutral;
    this.expression = name;
    this.goal = [...s] as Shape;
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 14);
    for (let i = 0; i < 6; i++) this.cur[i] += (this.goal[i] - this.cur[i]) * k;
    if (this.autoBlink) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) {
        this.blink = 0.13;
        this.blinkT = 1.8 + Math.random() * 3.5;
      }
    }
    this.blink = Math.max(0, this.blink - dt);
    const blinking = this.blink > 0 ? Math.sin((this.blink / 0.13) * Math.PI) : 0;
    let open = this.cur[4];
    if (this.talking > 0) {
      this.talkPhase += dt * (9 + Math.sin(this.talkPhase * 0.37) * 3);
      const syll = Math.max(0, Math.sin(this.talkPhase)) * (0.55 + 0.45 * Math.sin(this.talkPhase * 2.3));
      open = Math.max(open, syll * 0.7 * this.talking);
    }
    const u = this.unit;
    const eyeY = Math.max(0.06, this.cur[0] * (1 - blinking * 0.94));
    for (const side of ['L', 'R']) {
      const e = this.nodes[`eye_${side}`];
      if (e) {
        const rs = this.restScale.get(`eye_${side}`)!;
        e.scaling.set(rs.x * (1 + (this.cur[0] - 1) * 0.15), rs.y * eyeY, rs.z);
      }
      const b = this.nodes[`brow_${side}`];
      if (b) {
        const rp = this.restPos.get(`brow_${side}`)!;
        b.position.set(rp.x, rp.y + this.cur[1] * u - blinking * 0.2 * u, rp.z);
        const tilt = this.cur[2] * 0.22 * (side === 'L' ? 1 : -1);
        Quaternion.RotationYawPitchRollToRef(0, 0, tilt, b.rotationQuaternion!);
      }
      const m = this.nodes[`mouth_${side}`];
      if (m) {
        const rp = this.restPos.get(`mouth_${side}`)!;
        const wide = this.cur[5] * 0.6 * u;
        m.position.set(rp.x + (side === 'L' ? wide : -wide), rp.y + this.cur[3] * 0.9 * u, rp.z);
      }
    }
    const mo = this.nodes.mouth;
    if (mo) {
      const rs = this.restScale.get('mouth')!;
      const rp = this.restPos.get('mouth')!;
      mo.scaling.set(rs.x * (1 - open * 0.25 + this.cur[5] * 0.2), rs.y * (1 + open * 5), rs.z * (1 + open * 1.5));
      mo.position.set(rp.x, rp.y - open * 0.6 * u, rp.z);
    }
  }
}
