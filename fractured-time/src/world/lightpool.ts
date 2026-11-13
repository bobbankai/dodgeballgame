import * as THREE from 'three/webgpu';

/**
 * Real-time lights for characters and moving props. A level has dozens of baked fixtures; evaluating all of them per pixel would be
 * ruinous and adding/removing lights recompiles every material. Instead a fixed pool (rect area lights + point lights) is re-pointed every
 * tick at the fixtures nearest the player: same light count forever, no recompiles, the right lights where the action is.
 */
export interface LightDef { kind: 'area' | 'point'; pos: THREE.Vector3; size: [number, number]; color: THREE.Color; intensity: number }

export class LightPool {
  readonly rects: THREE.RectAreaLight[] = [];
  readonly points: THREE.PointLight[] = [];
  defs: LightDef[] = [];

  constructor(scene: THREE.Scene, nRect = 5, nPoint = 3) {
    for (let i = 0; i < nRect; i++) {
      const l = new THREE.RectAreaLight(0xffffff, 0, 1, 0.2);
      scene.add(l);
      this.rects.push(l);
    }
    for (let i = 0; i < nPoint; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      scene.add(l);
      this.points.push(l);
    }
  }

  add(defs: LightDef[]): void { this.defs.push(...defs); }

  update(at: THREE.Vector3): void {
    const near = (kind: LightDef['kind'], n: number) =>
      this.defs.filter((d) => d.kind === kind).map((d) => ({ d, k: d.pos.distanceToSquared(at) })).sort((a, b) => a.k - b.k).slice(0, n);
    const r = near('area', this.rects.length);
    this.rects.forEach((l, i) => {
      const e = r[i];
      if (!e) { l.intensity = 0; return; }
      l.position.copy(e.d.pos);
      l.width = e.d.size[0];
      l.height = e.d.size[1];
      l.color.copy(e.d.color);
      l.intensity = e.d.intensity;
      l.lookAt(e.d.pos.x, e.d.pos.y - 1, e.d.pos.z);
    });
    const p = near('point', this.points.length);
    this.points.forEach((l, i) => {
      const e = p[i];
      if (!e) { l.intensity = 0; return; }
      l.position.copy(e.d.pos);
      l.color.copy(e.d.color);
      l.intensity = e.d.intensity;
    });
  }
}
