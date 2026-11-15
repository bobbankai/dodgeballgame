/* Types for the vendored interior-mapping kit (.claude/skills/interior-mapping, three r187 WebGPU/TSL). */
import type * as THREE from 'three/webgpu';
export const WINDOW_DEFAULTS: Record<string, unknown>;
export function createWindowMaterial(options?: Record<string, any>): THREE.MeshStandardNodeMaterial;
export function setWindowNight(material: THREE.Material, night: number, overrides?: Record<string, any>): void;
