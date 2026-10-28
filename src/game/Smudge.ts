import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { G, MAX_ERASE } from '../render/Globals';
import { SketchLines, type Segments } from '../render/Sketch';
import type { Collision } from './Collision';
import type { Game } from './Game';

const LOOPS = 34;
const SEGS = 10;
/** Room for the biggest Smudge: more, smaller, rounder loops rather than a few huge straight ones. */
const MAX_SEGMENTS = 90 * 16;

function eyeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f6f1e4';
  g.beginPath();
  g.ellipse(32, 32, 18, 26, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(40,36,40,0.5)';
  g.lineWidth = 2;
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  return t;
}

/**
 * The Smudge: a knot of frantic graphite scribble with two rubbed-out eyes. It drifts after Ada
 * and erases the page behind it; the world slowly redraws itself once it has passed.
 */
export class Smudge {
  readonly position = new THREE.Vector3();
  active = false;
  speed = 2.4;
  maxSpeed = 3.1;
  catchRadius = 1.25;
  /** Overall size (the storm over the sea is much bigger). */
  scale = 1;
  onCatch?: () => void;
  private lines: SketchLines;
  private seg: Segments;
  private eyes: THREE.Sprite[] = [];
  private lastBoil = -1;
  private patches: { p: THREE.Vector3; age: number; scale: number }[] = [];
  private lastPatch = new THREE.Vector3(1e9, 0, 0);
  private size = 0;
  private heading = new THREE.Vector3(0, 0, 1);

  constructor(private game: Game) {
    const n = MAX_SEGMENTS;
    this.seg = { a: new Float32Array(n * 3), b: new Float32Array(n * 3), seed: new Float32Array(n * 2), count: n };
    this.lines = new SketchLines(this.seg, { width: 2.2, wobble: 0.0, color: 0x2a2629, alpha: 0.9 });
    this.lines.visible = false;
    const tex = eyeTexture();
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
      s.scale.set(0.26, 0.36, 1);
      s.visible = false;
      this.eyes.push(s);
      game.pipe.overlay.add(s);
    }
    game.pipe.overlay.add(this.lines);
  }

  spawn(at: THREE.Vector3) {
    this.position.copy(at);
    this.active = true;
    this.size = 0;
    this.lines.visible = true;
    this.eyes.forEach((e) => (e.visible = true));
  }

  dismiss() {
    this.active = false;
  }

  private scribble(time: number) {
    const s = this.seg;
    const R = 1.5 * this.size * this.scale;
    let k = 0;
    // a big Smudge is a dense cloud of scribbles, each still small enough to read as a pencil loop
    const grow = Math.min(2.6, Math.max(1, Math.pow(this.scale, 0.75)));
    const loops = Math.round(LOOPS * grow);
    const rMax = Math.min((R * 0.7) / Math.sqrt(grow), 2.2);
    for (let l = 0; l < loops; l++) {
      const c = new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2).multiplyScalar(R * 0.6);
      const r = (0.25 + Math.random() * 0.7) * rMax;
      const segs = Math.max(SEGS, Math.min(16, Math.round(r * 9)));
      const u = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).cross(u).normalize();
      const a0 = Math.random() * Math.PI * 2;
      const turns = 1.2 + Math.random() * 1.2;
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= segs; i++) {
        const a = a0 + (i / segs) * turns * Math.PI * 2;
        const rr = r * (0.75 + 0.35 * Math.sin(a * 2.3 + time));
        const p = c.clone().addScaledVector(u, Math.cos(a) * rr).addScaledVector(v, Math.sin(a) * rr).add(this.position);
        if (prev) {
          s.a.set([prev.x, prev.y, prev.z], k * 3);
          s.b.set([p.x, p.y, p.z], k * 3);
          s.seed[k * 2] = Math.random() * 100;
          s.seed[k * 2 + 1] = 2;
          k++;
        }
        prev = p;
      }
    }
    s.count = k;
    this.lines.setSegments(s);
  }

  update(dt: number, target: THREE.Vector3, col: Collision) {
    // patches of erased page grow, linger, then fill back in
    for (const p of this.patches) p.age += dt;
    this.patches = this.patches.filter((p) => p.age < 8);
    const n = Math.min(this.patches.length, MAX_ERASE);
    for (let i = 0; i < n; i++) {
      const p = this.patches[this.patches.length - n + i];
      const r = 2.6 * p.scale * Math.min(1, p.age * 2) * (1 - THREE.MathUtils.smoothstep(p.age, 5, 8));
      G.uErase.value[i].set(p.p.x, p.p.y, p.p.z, r);
    }
    G.uEraseCount.value = n;

    const vis = this.active || this.size > 0.01;
    this.lines.visible = vis;
    this.eyes.forEach((e) => (e.visible = vis));
    this.size += ((this.active ? 1 : 0) - this.size) * (1 - Math.exp(-dt * (this.active ? 1.5 : 3)));
    if (!vis) {
      audio.smudgeLevel(0);
      return;
    }
    if (this.active) {
      // drift towards Ada over everything, a little above the ground
      const to = new THREE.Vector3().subVectors(target, this.position).setY(0);
      const d = to.length();
      if (d > 0.01) {
        to.normalize();
        // its quarry straight behind it: swing round through one side rather than never turning
        if (this.heading.dot(to) < -0.6) this.heading.add(new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(0.4));
        this.heading.lerp(to, 1 - Math.exp(-dt * 2)).normalize();
      }
      this.speed = Math.min(this.maxSpeed, this.speed + dt * 0.05);
      this.position.addScaledVector(this.heading, this.speed * dt * this.size);
      const g = col.groundAt(new THREE.Vector3(this.position.x, Math.max(this.position.y, target.y) + 3, this.position.z), 12);
      const want = (g ?? target.y) + 1.3 * this.scale;
      this.position.y += (want - this.position.y) * (1 - Math.exp(-dt * 3));
      if (this.position.distanceTo(new THREE.Vector3(target.x, target.y + 0.7, target.z)) < this.catchRadius * this.size * this.scale) this.onCatch?.();
      if (this.lastPatch.distanceTo(this.position) > 1.4 * this.scale) {
        this.lastPatch.copy(this.position);
        this.patches.push({ p: new THREE.Vector3(this.position.x, g ?? target.y, this.position.z), age: 0, scale: this.scale });
      }
      const near = 1 - THREE.MathUtils.smoothstep(this.position.distanceTo(target), 2, 18);
      audio.smudgeLevel(0.25 + near * 0.75);
    } else audio.smudgeLevel(this.size * 0.3);
    if (G.uBoil.value !== this.lastBoil) {
      this.lastBoil = G.uBoil.value;
      this.scribble(G.uTime.value);
    }
    // two rubbed-out eyes looking where it goes
    const side = new THREE.Vector3(-this.heading.z, 0, this.heading.x);
    this.eyes.forEach((e, i) => {
      const k = this.size * this.scale;
      e.position.copy(this.position).addScaledVector(this.heading, 0.9 * k).addScaledVector(side, (i ? 1 : -1) * 0.3 * k);
      e.position.y += 0.25 * k + Math.sin(G.uTime.value * 3 + i) * 0.02;
      e.scale.set(0.26 * k, 0.36 * k * (Math.sin(G.uTime.value * 0.7) > 0.97 ? 0.15 : 1), 1);
      // an eye right in front of the lens would just be a white blot: it melts away instead
      (e.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.smoothstep(this.game.camera.position.distanceTo(e.position), 1.2 * k, 3 * k);
    });
  }

  clearTrail() {
    this.patches = [];
    G.uEraseCount.value = 0;
  }
}
