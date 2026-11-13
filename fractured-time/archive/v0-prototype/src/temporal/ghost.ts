import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const { color, normalView, positionView, positionWorld, normalize, dot, abs, pow, sin, time, float, smoothstep, mix } = TSL as any;

/**
 * Chronal ghost look for Temporal Echoes: a fresnel rim with moving scan bands. Additive, so the echo reads as light, not as a second Ethan.
 * `fade` (0..1) is shared by every echo mesh so a dissolving echo fades as one.
 */
export function ghostMaterial(tint: number | string = 0x5ad8ff): { material: THREE.MeshBasicNodeMaterial; fade: THREE.UniformNode<number> } {
  const fade = TSL.uniform(1) as any;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide });
  const fres = pow(float(1).sub(abs(dot(normalView, normalize(positionView.negate())))), 2.2);
  const bands = smoothstep(0.55, 1.0, sin(positionWorld.y.mul(46.0).sub(time.mul(7.0))).mul(0.5).add(0.5));
  const base = color(new THREE.Color(tint as any));
  m.colorNode = mix(base.mul(0.35), vec3white(), fres.mul(0.4)).mul(float(0.5).add(fres.mul(2.4)).add(bands.mul(0.7))).mul(fade);
  m.opacityNode = fade.mul(float(0.35).add(fres.mul(0.65)));
  return { material: m, fade };
}

function vec3white(): any {
  return TSL.vec3(0.8, 1.0, 1.0);
}

export function ghostify(root: THREE.Object3D, tint?: number): THREE.UniformNode<number> {
  const g = ghostMaterial(tint);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = g.material;
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  return g.fade;
}
