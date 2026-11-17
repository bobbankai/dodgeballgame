import * as THREE from 'three/webgpu';
import type { Capabilities } from './capabilities';
import { refineCapabilities } from './capabilities';

/**
 * Renderer creation. WebGPU first; `WebGPURenderer` falls back to its WebGL2 backend by itself when no adapter is available,
 * and `?webgl` forces that path for testing. Timestamp queries are requested only where the adapter has them (the backend
 * also drops them silently otherwise). Anti-aliasing is part of the frame graph, so the canvas is created without MSAA.
 */
export interface Device {
  renderer: THREE.WebGPURenderer;
  caps: Capabilities;
}

export async function createDevice(canvas: HTMLCanvasElement, caps: Capabilities, opts: { timing: boolean }): Promise<Device> {
  const forceWebGL = !caps.webgpuAvailable || new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    forceWebGL,
    trackTimestamp: opts.timing && caps.timestampQuery && !forceWebGL,
  });
  await renderer.init();
  // tone mapping happens once, inside the frame graph; the renderer only encodes the output to sRGB
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return { renderer, caps: refineCapabilities(caps, renderer as any) };
}
