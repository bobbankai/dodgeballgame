import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Reflection probes: the lit level captured into a PMREM environment (reflections on glossy surfaces, ambient for characters).
 *
 * Every capture goes through the graphics system's one PMREM generator: a generator owns its blur and convolution
 * materials, so a new one per capture built those shaders again each time and was never freed.
 *
 * The scene's environment is one node for the whole chapter (`EnvironmentSlot`), whose texture is swapped as Ethan moves
 * between places. Assigning a new texture to `scene.environment` gives three a new environment node, and the node's id is
 * part of every lit material's build key: each section's first probe rebuilt every material in view (56-74 builds per
 * section in Chapter 4, measured), which no warm-up could prevent. Swapping the value of one PMREM node changes bindings only.
 */
const targets = new WeakMap<THREE.Texture, THREE.RenderTarget>();

/** Capture the scene at a point into a new PMREM target (a recapture must not render into the probe the scene is lit by). */
export function captureProbe(pmrem: THREE.PMREMGenerator, scene: THREE.Scene, at: THREE.Vector3): THREE.Texture {
  const rt = (pmrem as any).fromScene(scene, 0.02, 0.1, 60, { position: at }) as THREE.RenderTarget;
  targets.set(rt.texture, rt);
  return rt.texture;
}

/** Free a probe's GPU target. */
export function releaseProbe(t: THREE.Texture): void {
  const rt = targets.get(t);
  if (rt) { targets.delete(t); rt.dispose(); } else t.dispose();
}

/** The scene's environment as one PMREM node whose texture changes. */
export class EnvironmentSlot {
  private node: any = null;
  constructor(private scene: THREE.Scene) {}

  set(t: THREE.Texture): void {
    if (!this.node) {
      this.node = (TSL as any).pmremTexture(t);
      (this.scene as any).environmentNode = this.node;
      this.scene.environment = null;
    } else if (this.node.value !== t) this.node.value = t;
  }

  get texture(): THREE.Texture | null { return this.node?.value ?? null; }
}
