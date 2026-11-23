// CPU mirror of the WGSL `TBGlobals` block (src/shaders/lib/tbGlobals.wgsl). All members are vec4/mat4.
import { UniformBuffer, Vector3, Matrix } from '@babylonjs/core';
import type { Engine } from '@babylonjs/core';

export const MAX_LIGHTS = 12;

const OFF = {
  time: 0, sunDir: 4, sunColor: 8, skyColor: 12, groundColor: 16, shadowTint: 20, rimColor: 24, fogColor: 28,
  fogParams: 32, camPos: 36, shadowMat: 40, shadowMat1: 56, shadowParams: 72, shadowSplit: 76, wind: 80, grade: 84,
  flash: 88, viewport: 92, sea: 96, seaColor: 100, seaShallow: 104, counts: 108, lightPos: 112, lightCol: 160,
} as const;
const SIZE = 208;

export type Vec4Key = Exclude<keyof typeof OFF, 'shadowMat' | 'shadowMat1' | 'lightPos' | 'lightCol'>;

export interface PointLight { pos: Vector3; radius: number; color: [number, number, number]; intensity: number }

export class Globals {
  readonly data = new Float32Array(SIZE);
  readonly ubo: UniformBuffer;
  lights: PointLight[] = [];

  constructor(engine: Engine) {
    this.ubo = new UniformBuffer(engine, undefined, true, 'globals');
    this.ubo.addUniform('data', SIZE);
    this.ubo.create();
    this.set('time', 0, 0, 0, 0);
    this.set('sunDir', 0.4, 0.8, 0.3, 1);
    this.set('sunColor', 1, 0.96, 0.88, 0.05);
    this.set('skyColor', 0.55, 0.7, 0.95, 1);
    this.set('groundColor', 0.35, 0.3, 0.25, 1);
    this.set('shadowTint', 0.52, 0.55, 0.85, 0.3);
    this.set('rimColor', 1, 0.95, 0.85, 0.6);
    this.set('fogColor', 0.7, 0.8, 0.95, 0);
    this.set('fogParams', 0.05, 0, 20, 0.5);
    this.set('shadowParams', 1 / 2048, 0.002, 0.03, 0);
    this.set('grade', 1, 1, 1, 0);
    this.set('sea', 0, 1, 1, 0);
    this.set('seaColor', 0.02, 0.18, 0.32, 0.6);
    this.set('seaShallow', 0.1, 0.62, 0.62, 1.2);
    this.set('counts', 0, 0, 2, 0);
  }

  set(key: Vec4Key, x: number, y: number, z: number, w: number): void {
    const o = OFF[key];
    this.data[o] = x; this.data[o + 1] = y; this.data[o + 2] = z; this.data[o + 3] = w;
  }

  get(key: Vec4Key): [number, number, number, number] {
    const o = OFF[key];
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]];
  }

  setSunDir(d: Vector3, intensity = this.get('sunDir')[3]): void {
    const n = d.normalizeToNew();
    this.set('sunDir', n.x, n.y, n.z, intensity);
  }

  setMatrix(key: 'shadowMat' | 'shadowMat1', m: Matrix): void {
    this.data.set(m.toArray() as Float32Array, OFF[key]);
  }

  /** Writes lights, time and camera, then uploads. Call once per frame before rendering. */
  upload(): void {
    const n = Math.min(this.lights.length, MAX_LIGHTS);
    for (let i = 0; i < n; i++) {
      const l = this.lights[i];
      const p = OFF.lightPos + i * 4, c = OFF.lightCol + i * 4;
      this.data[p] = l.pos.x; this.data[p + 1] = l.pos.y; this.data[p + 2] = l.pos.z; this.data[p + 3] = l.radius;
      this.data[c] = l.color[0]; this.data[c + 1] = l.color[1]; this.data[c + 2] = l.color[2]; this.data[c + 3] = l.intensity;
    }
    this.data[OFF.counts] = n;
    this.ubo.updateUniform('data', this.data, SIZE);
    this.ubo.update();
  }
}
