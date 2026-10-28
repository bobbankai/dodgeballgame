import * as THREE from 'three';
import { audio } from '../audio/Audio';
import { inkMaterial } from '../render/InkMaterial';
import { SketchLines, type Segments } from '../render/Sketch';
import type { Game } from './Game';

export type PathKind = 'planks' | 'stones' | 'books' | 'ribbon';

interface Piece {
  mesh: THREE.Object3D;
  /** Where along the path it sits (0..1): it appears when the drawing gets there. */
  at: number;
  shown: boolean;
  grow: number;
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/**
 * A way across the blank page that Ada draws herself: nothing to trace, so as she holds the button
 * a pencil guide runs out ahead of her and the path appears piece by piece behind it (planks,
 * stepping stones, a staircase of old sketchbooks, a ribbon of paper). Solid once it is finished.
 */
export class DrawnPath {
  progress = 0;
  done = false;
  enabled = true;
  readonly curve: THREE.CatmullRomCurve3;
  readonly group = new THREE.Group();
  /** Seconds of holding to draw it all. */
  duration: number;
  onDone?: () => void;
  private pieces: Piece[] = [];
  private guide: SketchLines;
  private guideSegs = 0;
  private sparkT = 0;

  constructor(private game: Game, readonly name: string, readonly start: THREE.Vector3, readonly end: THREE.Vector3, kind: PathKind, seed = 1) {
    const r = rng(seed * 7919 + 13);
    const dir = new THREE.Vector3().subVectors(end, start).setY(0).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    // a little hand-drawn wander and lift, and a lip running onto the ground at both ends
    const a0 = start.clone().addScaledVector(dir, -0.9);
    const b0 = end.clone().addScaledVector(dir, 0.9);
    const mid1 = start.clone().lerp(end, 0.33).addScaledVector(side, (r() - 0.5) * 2.4).add(new THREE.Vector3(0, 0.35, 0));
    const mid2 = start.clone().lerp(end, 0.66).addScaledVector(side, (r() - 0.5) * 2.4).add(new THREE.Vector3(0, 0.3, 0));
    this.curve = new THREE.CatmullRomCurve3([a0, start.clone(), mid1, mid2, end.clone(), b0], false, 'centripetal');
    const len = this.curve.getLength();
    this.duration = THREE.MathUtils.clamp(len * 0.42, 3.5, 7);

    const spacing = { planks: 0.46, stones: 0.9, books: 0.58, ribbon: 0.5 }[kind];
    const n = Math.ceil(len / spacing);
    const mats = {
      plank: inkMaterial({ color: 0xb08a5f, hatch: 0.55, soft: 0.1, lineId: 120 }),
      stone: inkMaterial({ color: 0xe9e2d2, hatch: 0.5, soft: 0.18, lineId: 121 }),
      books: [0x3d6b8c, 0x5f8f48, 0xb5523b, 0xd9b45a, 0x6e7f8f].map((c, i) => inkMaterial({ color: c, hatch: 0.45, soft: 0.1, lineId: 122 + i })),
      pages: inkMaterial({ color: 0xf4eedc, hatch: 0.2, soft: 0.2, lineId: 128 }),
      ribbon: inkMaterial({ color: 0xf2ecdc, hatch: 0.35, soft: 0.2, lineId: 129, side: THREE.DoubleSide }),
    };
    for (let i = 0; i <= n; i++) {
      const u = Math.min(1, i / n);
      this.curve.getPointAt(Math.min(u, 0.9999), _p);
      this.curve.getTangentAt(Math.min(u, 0.9999), _t);
      const yaw = Math.atan2(_t.x, _t.z);
      const pitch = -Math.atan2(_t.y, Math.hypot(_t.x, _t.z));
      const g = new THREE.Group();
      g.position.copy(_p);
      g.rotation.set(pitch, yaw, 0, 'YXZ');
      if (kind === 'planks') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.5 + (r() - 0.5) * 0.12, 0.08, 0.4), mats.plank);
        m.position.y = -0.04;
        m.rotation.y = (r() - 0.5) * 0.08;
        g.add(m);
      } else if (kind === 'stones') {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.58 + r() * 0.08, 0.5, 0.16, 12), mats.stone);
        m.position.set((r() - 0.5) * 0.25, -0.08, 0);
        g.add(m);
      } else if (kind === 'books') {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.14, 0.52), mats.books[Math.floor(r() * mats.books.length)]);
        m.position.y = -0.07;
        m.rotation.y = (r() - 0.5) * 0.3;
        const pages = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.5), mats.pages);
        pages.position.set(0.03, 0, 0);
        m.add(pages);
        g.add(m);
      } else {
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.05, spacing + 0.04), mats.ribbon);
        m.position.y = -0.025;
        m.rotation.z = Math.sin(u * 9) * 0.06;
        g.add(m);
      }
      g.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      g.scale.setScalar(0.001);
      g.visible = false;
      this.group.add(g);
      this.pieces.push({ mesh: g, at: u, shown: false, grow: 0 });
    }
    game.scene.add(this.group);

    // the pencil guide: two wavering lines along the edges, drawn a little ahead of the path
    const segs = 60;
    const seg: Segments = { a: new Float32Array(segs * 2 * 3), b: new Float32Array(segs * 2 * 3), seed: new Float32Array(segs * 2 * 2), count: segs * 2 };
    const q = new THREE.Vector3(), q2 = new THREE.Vector3(), tt = new THREE.Vector3();
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < segs; i++) {
        const u0 = i / segs, u1 = (i + 1) / segs;
        for (const [u, out] of [[u0, q], [u1, q2]] as const) {
          this.curve.getPointAt(Math.min(u, 0.9999), out);
          this.curve.getTangentAt(Math.min(u, 0.9999), tt);
          const sd = new THREE.Vector3(-tt.z, 0, tt.x).normalize();
          out.addScaledVector(sd, (s ? 1 : -1) * 0.78).y += 0.05;
        }
        // both edges interleaved, so a prefix of the list is the path drawn so far
        const j = i * 2 + s;
        seg.a.set([q.x, q.y, q.z], j * 3);
        seg.b.set([q2.x, q2.y, q2.z], j * 3);
        seg.seed[j * 2] = r() * 100;
        seg.seed[j * 2 + 1] = Math.min(0.999, u0);
      }
    }
    this.guide = new SketchLines(seg, { width: 1.7, wobble: 0.03, color: 0x4a4448, alpha: 0.8 });
    this.guideSegs = segs;
    this.guide.geometry.instanceCount = 0;
    game.pipe.overlay.add(this.guide);
  }

  /** Distance from Ada to where she can start drawing. */
  distanceTo(p: THREE.Vector3) {
    return Math.hypot(p.x - this.start.x, p.z - this.start.z) + Math.max(0, Math.abs(p.y - this.start.y) - 0.6);
  }

  hold(dt: number) {
    if (this.done) return;
    this.progress = Math.min(1, this.progress + dt / this.duration);
    this.sparkT -= dt;
    if (this.sparkT <= 0) {
      this.sparkT = 0.06;
      this.curve.getPointAt(Math.min(0.9999, this.progress + 0.06), _p);
      this.game.particles.inkBurst(_p, 2, 0.9, 0.04);
    }
    audio.scratchWiggle(Math.random());
    if (this.progress >= 1) this.finish();
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.progress = 1;
    for (const p of this.pieces) {
      p.shown = true;
      p.grow = 1;
      p.mesh.visible = true;
      p.mesh.scale.setScalar(1);
    }
    this.group.updateMatrixWorld(true);
    this.game.collision.addBody(this.name, [this.group], true);
    this.game.particles.sparkles(this.end, 0xfff3c4, 20, 1.2, 0.16);
    this.game.rig.addShake(0.15);
    audio.inked();
    this.onDone?.();
  }

  update(dt: number) {
    // there is nothing to trace: the pencil edges exist only as far as Ada has drawn (and a touch ahead)
    const ahead = this.progress > 0 ? Math.min(1, this.progress + 0.07) : 0;
    this.guide.geometry.instanceCount = Math.ceil(ahead * this.guideSegs) * 2;
    this.guide.progress = this.progress;
    this.guide.alpha = this.done ? Math.max(0.35, this.guide.alpha - dt * 0.4) : this.enabled ? 0.8 : 0;
    // nothing to trace: just a glint at the edge where a path could start
    if (!this.done && this.enabled && this.progress === 0 && Math.random() < dt * 4) {
      this.game.particles.sparkles(this.start.clone().add(new THREE.Vector3(0, 0.3, 0)), 0xfff3c4, 1, 0.5, 0.12);
    }
    for (const p of this.pieces) {
      if (!p.shown && this.progress >= p.at) {
        p.shown = true;
        p.mesh.visible = true;
        this.game.particles.inkBurst(p.mesh.position, 4, 1.4, 0.05);
      }
      if (p.shown && p.grow < 1) {
        p.grow = Math.min(1, p.grow + dt * 5);
        const k = p.grow;
        // a little overshoot as each piece is inked in
        p.mesh.scale.setScalar(Math.max(0.001, k * (1 + 0.15 * Math.sin(k * Math.PI))));
      }
    }
  }
}
