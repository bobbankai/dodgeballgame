/* Types for the vendored ocean kit (.claude/skills/ocean-water, three r187 WebGPU/TSL). */
import type * as THREE from 'three/webgpu';
export const OCEAN_PRESETS: Record<string, Record<string, unknown>>;
export const OCEAN_DEFAULTS: Record<string, unknown>;
export class Ocean {
  constructor(scene: THREE.Scene, options?: Record<string, any>);
  mesh: THREE.Mesh;
  u: Record<string, { value: any }>;
  params: Record<string, any>;
  update(camera: THREE.Camera, dt: number, sunDir: THREE.Vector3): void;
  renderMirror(renderer: THREE.WebGPURenderer, camera: THREE.Camera): boolean;
  surfaceHeightAt(x: number, z: number, camX: number, camZ: number): number;
  setReflectionLayers(mask: number | null): void;
  bakeBedNow(x: number, z: number): void;
  applyPreset(name: string): void;
  push(key: string): void;
  dispose(): void;
}
