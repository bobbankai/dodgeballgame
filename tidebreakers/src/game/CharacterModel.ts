// A loaded character: skinned mesh with the toon material, an inverted-hull outline sharing its
// skeleton, a bone lookup by name, and a Face driving the procedural face shader.
import { LoadAssetContainerAsync, TransformNode, Mesh, MultiMaterial, SubMesh } from '@babylonjs/core';
import type { AssetContainer, Skeleton, AbstractMesh, ShaderMaterial, Scene } from '@babylonjs/core';
import '@babylonjs/loaders/glTF';
import type { Renderer } from '../render/Renderer';
import { toonMaterial, outlineMaterial, newObjectId, v4 } from '../render/materials';
import { Face, type FaceStyle } from './Face';
import { fixSkinIndices } from '../render/babylonFixes';

const cache = new Map<string, Promise<AssetContainer>>();

export function loadContainer(url: string, scene: Scene): Promise<AssetContainer> {
  let p = cache.get(url);
  if (!p) {
    p = LoadAssetContainerAsync(url, scene).then((c) => {
      for (const g of c.animationGroups) g.stop();
      return c;
    });
    cache.set(url, p);
  }
  return p;
}

export interface CharacterLook {
  face?: Partial<FaceStyle>;
  outline?: number;
  ink?: string;
  tint?: [number, number, number];
  lodDistance?: number;
}

const DEFAULT_FACE: FaceStyle = {
  eyeStyle: 0, eyeSize: 1, irisSize: 1, irisTop: [0.35, 0.16, 0.04], irisBottom: [0.95, 0.66, 0.2], ink: [0.06, 0.035, 0.04], lineWeight: 1,
};

export class CharacterModel {
  root!: TransformNode;
  /** game-controlled node: position/rotation of the character in the world */
  anchor!: TransformNode;
  mesh!: Mesh;
  outline!: Mesh;
  skeleton!: Skeleton;
  mat!: ShaderMaterial;
  outlineMat!: ShaderMaterial;
  face!: Face;
  bones = new Map<string, TransformNode>();
  /** held props (parented to bones) */
  props: TransformNode[] = [];
  tint: [number, number, number] = [1, 1, 1];
  restRot = new Map<string, import('@babylonjs/core').Quaternion>();
  restPos = new Map<string, import('@babylonjs/core').Vector3>();
  readonly id = newObjectId();

  private constructor(readonly name: string, readonly r: Renderer) {}

  static async load(r: Renderer, name: string, look: CharacterLook = {}): Promise<CharacterModel> {
    const c = new CharacterModel(name, r);
    const cont = await loadContainer(`assets/chars/${name}.glb`, r.scene);
    const inst = cont.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: true });
    c.root = inst.rootNodes[0] as TransformNode;
    c.root.name = `${name}`;
    for (const g of inst.animationGroups) g.dispose();
    const meshes = c.root.getChildMeshes(false) as AbstractMesh[];
    const skinnedAll = meshes.filter((m) => m.skeleton) as Mesh[];
    const skinned = skinnedAll.find((m) => !m.name.endsWith('_LOD1')) ?? skinnedAll[0];
    const lod1 = skinnedAll.find((m) => m.name.endsWith('_LOD1'));
    c.mesh = skinned;
    c.skeleton = skinned.skeleton!;
    fixSkinIndices(skinned);
    // COLOR_0.a is the face mask, not transparency: keep characters in the opaque pass (depth writes on)
    skinned.hasVertexAlpha = false;
    for (const n of c.root.getChildTransformNodes(false)) {
      const bn = n.name.split(':').pop()!;
      c.bones.set(bn, n);
      if (n.rotationQuaternion) c.restRot.set(bn, n.rotationQuaternion.clone());
      c.restPos.set(bn, n.position.clone());
    }
    c.mat = toonMaterial(`${name}-toon`, r);
    c.mat.setVector4('fx', v4(0, 0, 0, c.id));
    if (look.tint) c.tint = look.tint;
    c.mat.setVector4('tint', v4(c.tint[0], c.tint[1], c.tint[2], 0));
    // Ink outline: a second sub-mesh over the same triangles drawn with the inverted-hull material.
    // (A cloned mesh would share draw wrappers with the original in Babylon 9.37.)
    c.outlineMat = outlineMaterial(`${name}-ol`, r, look.outline ?? 2.4, look.ink ?? '#1b1220', 0.5);
    c.outlineMat.setVector4('fx', v4(0, look.outline ?? 2.4, 0, c.id));
    const multi = new MultiMaterial(`${name}-multi`, r.scene);
    multi.subMaterials.push(c.mat, c.outlineMat);
    const nv = skinned.getTotalVertices(), ni = skinned.getTotalIndices();
    skinned.subMeshes = [];
    new SubMesh(0, 0, nv, 0, ni, skinned);
    new SubMesh(1, 0, nv, 0, ni, skinned);
    skinned.material = multi;
    skinned.alwaysSelectAsActiveMesh = true;
    c.outline = skinned;
    if (lod1) {
      fixSkinIndices(lod1);
      lod1.hasVertexAlpha = false;
      const lv = lod1.getTotalVertices(), li = lod1.getTotalIndices();
      lod1.subMeshes = [];
      new SubMesh(0, 0, lv, 0, li, lod1);
      new SubMesh(1, 0, lv, 0, li, lod1);
      lod1.material = multi;
      skinned.addLODLevel(look.lodDistance ?? 14, lod1);
    }
    // ground the model: its lowest rest-pose point sits on y = 0 of the anchor node
    skinned.refreshBoundingInfo({ applySkeleton: true });
    const minY = skinned.getBoundingInfo().boundingBox.minimumWorld.y;
    c.root.position.y -= minY;
    c.anchor = new TransformNode(`${name}-anchor`, r.scene);
    c.root.parent = c.anchor;
    r.addCaster(skinned);
    c.face = new Face([c.mat], { ...DEFAULT_FACE, ...look.face });
    return c;
  }

  setFx(dissolve: number, flash: number): void {
    this.mat.setVector4('fx', v4(dissolve, 0, 0, this.id));
    this.outlineMat.setVector4('fx', v4(dissolve, (this.outlineMat as any)._outlineW ?? 2.4, 0, this.id));
    this.mat.setVector4('tint', v4(this.tint[0], this.tint[1], this.tint[2], flash));
  }

  dispose(): void {
    for (const p of this.props) p.dispose();
    this.props = [];
    this.r.removeCaster(this.mesh);
    this.anchor.dispose(false, true);
  }
}
