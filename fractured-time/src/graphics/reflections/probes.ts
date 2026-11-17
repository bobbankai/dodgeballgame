import * as THREE from 'three/webgpu';

/** Capture the lit level into a PMREM environment (reflections on glossy surfaces, ambient for characters). */
export function captureProbe(renderer: THREE.WebGPURenderer, scene: THREE.Scene, at: THREE.Vector3): THREE.Texture {
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = (pm as any).fromScene(scene, 0.02, 0.1, 60, { position: at }) as THREE.RenderTarget;
  return rt.texture;
}
