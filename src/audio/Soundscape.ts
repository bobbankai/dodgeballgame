import * as THREE from 'three';
import { audio, type Emitter, type EmitterKind } from './Audio';

interface Item {
  kind: EmitterKind;
  count: number;
  emitters: Emitter[];
  /** Where each of this item's emitters should be, given where the listener is. */
  place(listener: THREE.Vector3, out: THREE.Vector3[]): void;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

/**
 * A level's sounds in the world: a fixed spot (a windmill), the nearest point along a line (a stream
 * you walk beside), the nearest few of many points (surf along a beach), or something moving (a
 * boat). Emitters are made once sound is unlocked, and moved every frame as the listener moves.
 */
export class Soundscape {
  private items: Item[] = [];
  private outs = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  /** A sound at one place. */
  point(kind: EmitterKind, p: THREE.Vector3) {
    const q = p.clone();
    this.items.push({ kind, count: 1, emitters: [], place: (_l, out) => out[0].copy(q) });
  }

  /** A sound along a line (polyline): it sits at the point of the line nearest the listener. */
  line(kind: EmitterKind, pts: THREE.Vector3[]) {
    this.items.push({
      kind, count: 1, emitters: [],
      place: (l, out) => {
        let best = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          _a.copy(pts[i]);
          _b.subVectors(pts[i + 1], pts[i]);
          const t = THREE.MathUtils.clamp(_p.subVectors(l, _a).dot(_b) / Math.max(_b.lengthSq(), 1e-6), 0, 1);
          _p.copy(_a).addScaledVector(_b, t);
          const d = _p.distanceToSquared(l);
          if (d < best) {
            best = d;
            out[0].copy(_p);
          }
        }
      },
    });
  }

  /** Several sources at the nearest of many points, kept apart from each other (surf on a beach). */
  nearest(kind: EmitterKind, pts: THREE.Vector3[], count = 2, apart = 12) {
    this.items.push({
      kind, count, emitters: [],
      place: (l, out) => {
        const order = pts.map((p, i) => [p.distanceToSquared(l), i] as const).sort((x, y) => x[0] - y[0]);
        let n = 0;
        for (const [, i] of order) {
          if (n >= count) break;
          if (out.slice(0, n).some((o) => o.distanceTo(pts[i]) < apart)) continue;
          out[n++].copy(pts[i]);
        }
        for (; n < count; n++) out[n].copy(out[0]);
      },
    });
  }

  /** A sound that goes where something goes. */
  follow(kind: EmitterKind, where: () => THREE.Vector3 | null) {
    this.items.push({
      kind, count: 1, emitters: [],
      place: (_l, out) => {
        const p = where();
        if (p) out[0].copy(p);
      },
    });
  }

  update(listener: THREE.Vector3) {
    if (!audio.ctx) return;
    for (const it of this.items) {
      it.place(listener, this.outs);
      while (it.emitters.length < it.count) {
        const o = this.outs[it.emitters.length];
        it.emitters.push(audio.emitter(it.kind, o.x, o.y, o.z));
      }
      it.emitters.forEach((e, i) => e.at(this.outs[i].x, this.outs[i].y, this.outs[i].z));
    }
  }
}
