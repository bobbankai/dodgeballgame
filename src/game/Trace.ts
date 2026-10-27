import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { G } from '../render/Globals';
import { ghostMaterial, edgeSegments, SketchLines } from '../render/Sketch';
import type { Body } from './Collision';
import type { Game } from './Game';

const _p = new THREE.Vector3();
const _box = new THREE.Box3();

/**
 * Something in the world that is only pencilled in. Ada holds the interact button nearby to go over
 * it in ink; when finished it becomes real (visible, solid) with a splash of ink.
 */
export class TraceTarget {
  progress = 0;
  done = false;
  readonly center = new THREE.Vector3();
  readonly box = new THREE.Box3();
  private lines: SketchLines;
  private ghost: THREE.Object3D;
  private body: Body | null = null;
  private reveal = 0;
  private holding = false;
  private sparkT = 0;
  /** Seconds of holding to finish. */
  duration: number;
  onDone?: () => void;
  /** Story can keep a target unavailable until its moment. */
  enabled = true;

  constructor(
    private game: Game,
    readonly name: string,
    readonly object: THREE.Object3D,
    solid = true,
    readonly reach = 2.6,
  ) {
    object.updateMatrixWorld(true);
    this.box.setFromObject(object);
    this.box.getCenter(this.center);
    const size = this.box.getSize(new THREE.Vector3()).length();
    this.duration = THREE.MathUtils.clamp(size * 0.35, 2.2, 4.5);
    // busy objects get one stroke per edge, simple ones a doubled, sketchier line
    const probe = edgeSegments(object, 30, 1);
    this.lines = new SketchLines(probe.count > 260 ? probe : edgeSegments(object, 30, 2), { width: 1.6, wobble: 0.03, color: 0x6a6468, alpha: 0.75 });
    this.ghost = object.clone(true);
    const gm = ghostMaterial();
    this.ghost.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.material = gm;
    });
    game.pipe.overlay.add(this.lines, this.ghost);
    object.visible = false;
    if (solid) this.body = game.collision.addBody(name, [object], false);
  }

  /** How far Ada is from the nearest point of the object (horizontally generous). */
  distanceTo(p: THREE.Vector3) {
    _box.copy(this.box).expandByScalar(0.2);
    _box.clampPoint(p, _p);
    return _p.distanceTo(p);
  }

  /** Closest point on the object's bounds, for Ada to face while drawing. */
  focus(p: THREE.Vector3, out = new THREE.Vector3()) {
    return this.box.clampPoint(p, out).lerp(this.center, 0.4);
  }

  hold(dt: number) {
    if (this.done) return;
    this.holding = true;
    this.progress = Math.min(1, this.progress + dt / this.duration);
    this.lines.progress = this.progress;
    // ink sparks at the front of the line being drawn
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.05;
      const g = this.lines.geometry;
      const a = g.attributes.aA.array as Float32Array, b = g.attributes.aB.array as Float32Array, s = g.attributes.aSeed.array as Float32Array;
      const n = g.instanceCount;
      for (let tries = 0; tries < 8; tries++) {
        const i = Math.floor(Math.random() * n);
        if (Math.abs(s[i * 2 + 1] - this.progress) < 0.06) {
          const t = Math.random();
          _p.set(a[i * 3] + (b[i * 3] - a[i * 3]) * t, a[i * 3 + 1] + (b[i * 3 + 1] - a[i * 3 + 1]) * t, a[i * 3 + 2] + (b[i * 3 + 2] - a[i * 3 + 2]) * t);
          this.game.particles.inkBurst(_p, 2, 0.8, 0.035);
          break;
        }
      }
    }
    audio.scratchWiggle(Math.random());
    if (this.progress >= 1) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.progress = 1;
    this.lines.progress = 1;
    this.object.visible = true;
    this.object.scale.setScalar(0.96);
    if (this.body) this.body.enabled = true;
    this.game.overlayRemove(this.ghost);
    this.game.particles.inkBurst(this.center, 40, 4.5, 0.09);
    this.game.particles.sparkles(this.center, 0xfff3c4, 18, this.box.getSize(_p).length() * 0.5, 0.16);
    this.game.rig.addShake(0.2);
    audio.inked();
    this.onDone?.();
  }

  update(dt: number) {
    if (!this.holding && !this.done && this.progress > 0) this.lines.progress = this.progress;
    this.holding = false;
    // unfinished sketches breathe a little so they catch the eye
    if (!this.done) this.lines.alpha = this.enabled ? 0.62 + 0.18 * Math.sin(G.uTime.value * 4) : 0.4;
    if (this.done) {
      this.reveal += dt;
      const s = this.object.scale.x;
      this.object.scale.setScalar(s + (1 - s) * (1 - Math.exp(-dt * 10)));
      this.lines.alpha = Math.max(0, 0.85 - this.reveal * 0.9);
      if (this.lines.alpha <= 0 && this.lines.parent) this.game.overlayRemove(this.lines);
    }
  }
}
