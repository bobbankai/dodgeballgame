import * as THREE from 'three';

/** Clips that only drive part of the face, layered over whatever the body is doing. */
const OVERLAYS: Record<string, RegExp> = { blink: /^eye_/, speak: /^mouth/ };
const FACE = /^(eye_|mouth)/;

/**
 * Weighted clip blending. Each frame the owner sets target weights for the body clips; weights
 * ease towards their targets and are normalised so the body always sums to one pose. Overlay
 * clips (blink, speak) only touch their own bones and play on top.
 */
export class Animator {
  readonly mixer: THREE.AnimationMixer;
  readonly actions = new Map<string, THREE.AnimationAction>();
  private weights = new Map<string, number>();
  private targets = new Map<string, number>();
  private rates = new Map<string, number>();
  private overlayOn = new Map<string, number>();

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], once: string[] = []) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const src of clips) {
      const clip = src.clone();
      const only = OVERLAYS[clip.name];
      clip.tracks = clip.tracks.filter((t) => (only ? only.test(t.name) : !FACE.test(t.name)));
      const a = this.mixer.clipAction(clip);
      if (once.includes(clip.name) || clip.name === 'blink') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      if (!only) this.weights.set(clip.name, 0);
      else this.overlayOn.set(clip.name, 0);
      this.actions.set(clip.name, a);
    }
  }

  has(name: string) {
    return this.actions.has(name);
  }

  duration(name: string) {
    return this.actions.get(name)?.getClip().duration ?? 0;
  }

  time(name: string) {
    return this.actions.get(name)?.time ?? 0;
  }

  /** Restart a clip from the beginning (one-shots). */
  restart(name: string, timeScale = 1) {
    const a = this.actions.get(name);
    if (!a) return;
    a.reset();
    a.timeScale = timeScale;
    a.setEffectiveWeight(this.weights.get(name) ?? 0);
    a.play();
  }

  /** Drive a looping clip's phase directly (0..1), e.g. to keep walk and run in step. */
  setPhase(name: string, phase: number) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = 0;
    a.time = phase * a.getClip().duration;
  }

  /** Desired body weights this frame; clips not mentioned fade out. `rate` is how fast (1/s). */
  target(want: Record<string, number>, rate = 10) {
    for (const k of this.weights.keys()) {
      this.targets.set(k, want[k] ?? 0);
      this.rates.set(k, rate);
    }
  }

  /** Make one clip snap in faster than the rest (e.g. landing). */
  rate(name: string, rate: number) {
    this.rates.set(name, rate);
  }

  overlay(name: string, on: boolean) {
    if (this.overlayOn.has(name)) this.overlayOn.set(name, on ? 1 : 0);
  }

  blink() {
    const a = this.actions.get('blink');
    if (!a) return;
    a.reset();
    a.setEffectiveWeight(1);
    a.play();
  }

  update(dt: number) {
    let sum = 0;
    for (const [k, w] of this.weights) {
      const t = this.targets.get(k) ?? 0;
      const nw = w + (t - w) * (1 - Math.exp(-dt * (this.rates.get(k) ?? 10)));
      this.weights.set(k, nw);
      sum += nw;
    }
    for (const [k, w] of this.weights) this.actions.get(k)!.setEffectiveWeight(sum > 1e-4 ? w / sum : 0);
    for (const [k, on] of this.overlayOn) {
      const a = this.actions.get(k)!;
      if (k === 'blink') continue;
      const w = a.getEffectiveWeight();
      a.setEffectiveWeight(w + (on - w) * (1 - Math.exp(-dt * 12)));
    }
    this.mixer.update(dt);
  }
}
