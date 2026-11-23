import {
  AbstractMesh, Camera, Color4, Constants, FreeCamera, Matrix, Mesh, RenderTargetTexture, Scene, Vector3,
} from '@babylonjs/core';
import { CharacterLook, Lighting, Materials } from './Materials';

/**
 * The sun's shadow map: an orthographic depth pass that follows the action (the two fighters),
 * texel-snapped so the shadow edges don't swim as the camera moves.
 */
export class ShadowPass {
  readonly rtt: RenderTargetTexture;
  readonly cam: FreeCamera;
  center = new Vector3(0, 0, 0);
  extent = 14;
  private casters = new Map<AbstractMesh, true>();

  constructor(scene: Scene, private mats: Materials, private lighting: Lighting, readonly size = 2048) {
    this.cam = new FreeCamera('sunCam', new Vector3(0, 30, 0), scene, false);
    this.cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.cam.minZ = 0.5;
    this.cam.maxZ = 120;
    this.rtt = new RenderTargetTexture('sunShadow', { width: size, height: size }, scene, {
      generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      generateDepthBuffer: true, format: Constants.TEXTUREFORMAT_RGBA,
    });
    this.rtt.activeCamera = this.cam;
    this.rtt.clearColor = new Color4(1, 1, 1, 1);
    this.rtt.renderList = [];
    this.rtt.refreshRate = 1;
    scene.customRenderTargets.push(this.rtt);
    lighting.shadowMap = this.rtt;
    lighting.shadowSize = size;
  }

  addCaster(mesh: AbstractMesh, look?: CharacterLook): void {
    if (this.casters.has(mesh)) return;
    this.casters.set(mesh, true);
    this.rtt.renderList!.push(mesh);
    this.rtt.setMaterialForRendering(mesh, this.mats.depthPass(mesh, 'shadowDepth', 0, look));
    mesh.onDisposeObservable.addOnce(() => this.removeCaster(mesh));
  }

  removeCaster(mesh: AbstractMesh): void {
    this.casters.delete(mesh);
    const list = this.rtt.renderList;
    if (!list) return;
    const i = list.indexOf(mesh);
    if (i >= 0) list.splice(i, 1);
  }

  update(): void {
    const d = this.lighting.sunDir;
    // snap the centre to whole texels in light space
    const texel = (this.extent * 2) / this.size;
    const right = Vector3.Cross(Vector3.Up(), d).normalize();
    if (right.lengthSquared() < 1e-6) right.set(1, 0, 0);
    const up = Vector3.Cross(d, right).normalize();
    const cx = Math.round(Vector3.Dot(this.center, right) / texel) * texel;
    const cy = Math.round(Vector3.Dot(this.center, up) / texel) * texel;
    const cz = Vector3.Dot(this.center, d);
    const c = right.scale(cx).add(up.scale(cy)).add(d.scale(cz));
    this.cam.position = c.add(d.scale(60));
    this.cam.setTarget(c);
    this.cam.orthoLeft = -this.extent;
    this.cam.orthoRight = this.extent;
    this.cam.orthoTop = this.extent;
    this.cam.orthoBottom = -this.extent;
    this.cam.computeWorldMatrix();
    const view = this.cam.getViewMatrix();
    const proj = this.cam.getProjectionMatrix();
    view.multiplyToRef(proj, this.lighting.lightViewProj);
  }
}

/**
 * G-buffer: octahedral view normal, linear view depth and object id for the post chain.
 */
export class GBufferPass {
  readonly rtt: RenderTargetTexture;
  private nextId = 1;
  private members = new Map<AbstractMesh, true>();

  constructor(scene: Scene, private mats: Materials, camera: Camera, ratio = 1) {
    this.rtt = new RenderTargetTexture('gbuffer', { ratio }, scene, {
      generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Constants.TEXTURE_NEAREST_SAMPLINGMODE,
      generateDepthBuffer: true, format: Constants.TEXTUREFORMAT_RGBA,
    });
    this.rtt.activeCamera = camera;
    this.rtt.clearColor = new Color4(0, 0, 1000, 0);
    this.rtt.renderList = [];
    scene.customRenderTargets.push(this.rtt);
  }

  add(mesh: AbstractMesh, look?: CharacterLook, id?: number): number {
    if (this.members.has(mesh)) return 0;
    this.members.set(mesh, true);
    const oid = id ?? (this.nextId++ * 37) % 2000;
    this.rtt.renderList!.push(mesh);
    this.rtt.setMaterialForRendering(mesh, this.mats.depthPass(mesh, 'gbuffer', oid, look));
    mesh.onDisposeObservable.addOnce(() => {
      this.members.delete(mesh);
      const list = this.rtt.renderList;
      if (!list) return;
      const i = list.indexOf(mesh);
      if (i >= 0) list.splice(i, 1);
    });
    return oid;
  }

  setCamera(camera: Camera): void {
    this.rtt.activeCamera = camera;
  }
}

export function isInk(m: AbstractMesh): boolean {
  return !!(m.metadata && (m.metadata as { ink?: boolean }).ink);
}

export function worldMatrixOf(m: Mesh): Matrix {
  return m.computeWorldMatrix(true);
}
