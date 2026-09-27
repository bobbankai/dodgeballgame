import * as THREE from 'three';

/** Objects on this layer appear in the floor's planar reflection. Lights must be on it too. */
export const REFLECT_LAYER = 5;

/** Shared uniforms every court-floor material binds to. */
export const reflectionUniforms = {
  uRefl: { value: null as THREE.Texture | null },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
};

export function reflect(obj: THREE.Object3D, recursive = false) {
  if (recursive) obj.traverse((o) => o.layers.enable(REFLECT_LAYER));
  else obj.layers.enable(REFLECT_LAYER);
  return obj;
}

const _normal = new THREE.Vector3(0, 1, 0);
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
const _camPos = new THREE.Vector3();
const _lookAt = new THREE.Vector3();
const _view = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _clearColor = new THREE.Color();

/**
 * Planar reflection of the court (plane y = 0). A mirrored camera renders only the reflect
 * layer (athletes, balls, VFX, lamps, court-side boards) into a low-resolution HDR target with
 * an oblique near plane, then mipmaps it so the floor can blur the image by its roughness.
 */
export class FloorReflection {
  readonly target: THREE.WebGLRenderTarget;
  private cam = new THREE.PerspectiveCamera();
  scale = 0.35;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.target.texture.name = 'floorReflection';
    this.cam.layers.set(REFLECT_LAYER);
    reflectionUniforms.uRefl.value = this.target.texture;
  }

  setSize(drawingWidth: number, drawingHeight: number) {
    const w = Math.max(16, Math.round(drawingWidth * this.scale));
    const h = Math.max(16, Math.round(drawingHeight * this.scale));
    if (w !== this.target.width || h !== this.target.height) this.target.setSize(w, h);
  }

  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (_camPos.y <= 0.02) return;
    // mirrored eye and look-at target (three.js Reflector math, plane through the origin)
    _view.copy(_camPos).negate().reflect(_normal).negate();
    _rot.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.copy(_lookAt).negate().reflect(_normal).negate();
    const cam = this.cam;
    cam.position.copy(_view);
    cam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    cam.lookAt(_target);
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    const tm = reflectionUniforms.uReflMatrix.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // oblique near plane: clip everything below the floor
    _plane.setFromNormalAndCoplanarPoint(_normal, _target.set(0, 0, 0)).applyMatrix4(cam.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const e = cam.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    e[2] = _clip.x;
    e[6] = _clip.y;
    e[10] = _clip.z + 1 - 0.003;
    e[14] = _clip.w;

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevBg = scene.background;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(_clearColor);
    renderer.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(_clearColor, prevAlpha);
    scene.background = prevBg;
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  dispose() {
    this.target.dispose();
  }
}
