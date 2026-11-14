import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { instantiateCharacter } from '@/assets/loader';

const T = TSL as any;

/**
 * THE ECHO: an alternate Ethan Vale from a timeline where the integration went further. Same body, same face, same kit, which is
 * the point: the player should recognise him before he is named. What sets him apart is his chronal signature: amber where Ethan's is
 * cyan, a faint amber rim that flickers as if his outline does not quite agree with this timeline, and the kit dulled by wear.
 */
export interface EchoFigure { root: THREE.Group; mixer: THREE.AnimationMixer; update(dt: number): void }

const AMBER = [1.0, 0.46, 0.1] as const;

export function echoify(root: THREE.Object3D): void {
  const flicker = T.sin(T.time.mul(23.0)).mul(T.sin(T.time.mul(3.1))).mul(0.25).add(0.8);
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (seen.has(mat) || !(mat as any).isNodeMaterial) continue;
      seen.add(mat);
      const nm = mat as any;
      const ft = String(mat.userData?.ft ?? '');
      if (ft.includes('"emissive"')) {
        // his light-lines burn amber
        nm.emissiveNode = T.vec3(...AMBER).mul(4.0).mul(flicker);
      } else if (!/cornea|"eye"|hair|teeth/.test(ft)) {
        // an amber rim: strongest at grazing angles, breathing and flickering (faint on skin, a clear outline on the kit)
        const k = ft.includes('"skin"') ? 0.12 : 0.5;
        const rim = T.float(1).sub(T.dot(T.normalView, T.positionViewDirection).abs()).pow(4.0);
        const base = nm.emissiveNode ?? T.vec3(0);
        nm.emissiveNode = base.add(T.vec3(...AMBER).mul(rim).mul(k).mul(flicker));
      }
      mat.needsUpdate = true;
    }
  });
}

export async function spawnEcho(scene: THREE.Scene, pos: THREE.Vector3, yaw: number): Promise<EchoFigure> {
  const inst = await instantiateCharacter('characters/ethan/ethan.glb');
  echoify(inst.root);
  inst.root.position.copy(pos);
  inst.root.rotation.y = yaw;
  scene.add(inst.root);
  const mixer = new THREE.AnimationMixer(inst.root);
  const idle = inst.clips.get('idle') ?? inst.clips.get('guard') ?? [...inst.clips.values()][0];
  if (idle) mixer.clipAction(idle).play();
  return { root: inst.root, mixer, update: (dt) => mixer.update(dt) };
}
