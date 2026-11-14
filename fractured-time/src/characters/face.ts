import type * as THREE from 'three/webgpu';

/**
 * A face that is alive: blinks on its own (random intervals, quick close, slower open), speaks with its voice (the jaw and lips follow
 * the line's loudness, measured from the audio itself through an AnalyserNode), and holds an expression (ARKit face units).
 * Works on every MPFB character: the body, brows, lashes, eyes and teeth carry the same face shapes (bound at export).
 */
const EXPRESSIONS: Record<string, Record<string, number>> = {
  neutral: {},
  concerned: { browInnerUp: 0.45, browDownLeft: 0.12, browDownRight: 0.12, mouthFrownLeft: 0.15, mouthFrownRight: 0.15, eyeSquintLeft: 0.1, eyeSquintRight: 0.1 },
  warm: { mouthSmileLeft: 0.28, mouthSmileRight: 0.28, cheekSquintLeft: 0.15, cheekSquintRight: 0.15, browInnerUp: 0.1 },
  hard: { browDownLeft: 0.35, browDownRight: 0.35, eyeSquintLeft: 0.25, eyeSquintRight: 0.25, mouthPressLeft: 0.2, mouthPressRight: 0.2, jawForward: 0.05 },
  shocked: { eyeWideLeft: 0.5, eyeWideRight: 0.5, browInnerUp: 0.5, browOuterUpLeft: 0.4, browOuterUpRight: 0.4, jawOpen: 0.12 },
};

export class FaceRig {
  private meshes: THREE.Mesh[] = [];
  private blinkT = 2 + Math.random() * 2;
  private blink = 0;
  private expr: Record<string, number> = {};
  private target: Record<string, number> = {};
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private talk = 0;

  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && 'jawOpen' in m.morphTargetDictionary) this.meshes.push(m);
    });
  }

  get ok(): boolean { return this.meshes.length > 0; }

  setExpression(name: keyof typeof EXPRESSIONS | string): void { this.target = { ...(EXPRESSIONS[name] ?? {}) }; }

  /** Lip-sync source: the analyser on this character's current voice line (null when silent). */
  listen(a: AnalyserNode | null): void {
    this.analyser = a;
    this.buf = a ? new Float32Array(a.fftSize) : null;
  }

  private set(name: string, v: number): void {
    for (const m of this.meshes) {
      const i = m.morphTargetDictionary![name];
      if (i !== undefined) m.morphTargetInfluences![i] = v;
    }
  }

  update(dt: number): void {
    if (!this.ok) return;
    // blink: a quick close (70 ms), a slower open (120 ms); sometimes a double blink
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.19; this.blinkT = 2.2 + Math.random() * 3.5 + (Math.random() < 0.15 ? -2.0 : 0); }
    let b = 0;
    if (this.blink > 0) { this.blink -= dt; const t = 0.19 - this.blink; b = t < 0.07 ? t / 0.07 : Math.max(0, 1 - (t - 0.07) / 0.12); }
    // speech: RMS of the line -> jaw + a little lip funnel and stretch, smoothed (fast attack, slower release)
    let level = 0;
    if (this.analyser && this.buf) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      level = Math.min(1, Math.sqrt(s / this.buf.length) * 7);
    }
    this.talk += (level - this.talk) * Math.min(1, dt * (level > this.talk ? 30 : 12));
    // expression eases toward its target
    const keys = new Set([...Object.keys(this.expr), ...Object.keys(this.target)]);
    for (const k of keys) {
      const v = (this.expr[k] ?? 0) + ((this.target[k] ?? 0) - (this.expr[k] ?? 0)) * Math.min(1, dt * 4);
      this.expr[k] = v;
      this.set(k, v);
    }
    this.set('eyeBlinkLeft', Math.max(b, this.expr.eyeBlinkLeft ?? 0));
    this.set('eyeBlinkRight', Math.max(b, this.expr.eyeBlinkRight ?? 0));
    this.set('jawOpen', Math.max(this.expr.jawOpen ?? 0, this.talk * 0.42));
    this.set('mouthFunnel', this.talk * 0.12);
    this.set('mouthStretchLeft', this.talk * 0.08);
    this.set('mouthStretchRight', this.talk * 0.08);
  }
}
