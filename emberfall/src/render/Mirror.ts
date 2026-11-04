// Planar reflections for large flat water (flooded shrine, still pools): the scene is rendered from the
// camera mirrored in the water plane into a half-resolution HDR target, with an oblique near plane so
// nothing below the water leaks in. The water shader samples it in projected screen space, offset by its
// ripple normals, and blends it with the sky IBL by Fresnel. Quality presets scale the target
// (Ultra 0.75, High 0.5, Performance off: IBL reflections only).
import * as THREE from 'three';

export class PlanarMirror {
  readonly target: THREE.WebGLRenderTarget;
  readonly textureMatrix = new THREE.Matrix4();
  readonly camera = new THREE.PerspectiveCamera();
  /** objects hidden while the reflection renders (the water itself, particles) */
  readonly hide: THREE.Object3D[] = [];
  enabled = true;
  private plane = new THREE.Plane();
  private normal = new THREE.Vector3(0, 1, 0);
  private point = new THREE.Vector3();

  constructor(public height: number, private scale: number) {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 0, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
  }

  resize(w: number, h: number): void {
    this.target.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale)));
  }

  /** render the reflection (call before the main frame) */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera): void {
    if (!this.enabled) return;
    const mirrorPos = this.point.set(0, this.height, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    if (camPos.y < this.height) return; // under the surface: nothing sensible to mirror
    // mirror the camera through the plane y = height
    const view = camPos.clone();
    view.y = 2 * this.height - view.y;
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).add(camPos);
    look.y = 2 * this.height - look.y;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    up.y = -up.y;
    const c = this.camera;
    c.position.copy(view);
    c.up.copy(up);
    c.lookAt(look);
    c.fov = cam.fov;
    c.aspect = cam.aspect;
    c.near = cam.near;
    c.far = cam.far;
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    // projective texture matrix (clip space -> [0,1])
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // oblique near plane = the water plane (Lengyel), so the reflection is clipped at the surface
    this.plane.setFromNormalAndCoplanarPoint(this.normal, mirrorPos).applyMatrix4(c.matrixWorldInverse);
    const cp = new THREE.Vector4(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const p = c.projectionMatrix.elements;
    const q = new THREE.Vector4(
      (Math.sign(cp.x) + p[8]) / p[0],
      (Math.sign(cp.y) + p[9]) / p[5],
      -1.0,
      (1.0 + p[10]) / p[14],
    );
    cp.multiplyScalar(2.0 / cp.dot(q));
    p[2] = cp.x; p[6] = cp.y; p[10] = cp.z + 1.0 - 0.0; p[14] = cp.w;
    // render
    const vis = this.hide.map((o) => o.visible);
    for (const o of this.hide) o.visible = false;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, c);
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    this.hide.forEach((o, i) => { o.visible = vis[i]; });
  }

  dispose(): void { this.target.dispose(); }
}
