import {
  Matrix, Quaternion, TransformNode, Vector3, type AbstractMesh, type MorphTarget, type Scene,
} from '@babylonjs/core';
import type { AssetManager, ModelInstance } from '../assets/AssetManager';
import { CharacterMaterials, type CharacterManifest, type CharacterMaterialSet } from './CharacterMaterials';
import { Animator, RigBinding } from '../anim/Animator';
import { ClothSprings } from '../anim/ClothSprings';
import type { AnimLibrary } from '../anim/AnimLibrary';
import { Face } from './Face';

/**
 * A skinned, animated character: model instance, materials, rig binding, animator, face (morph
 * targets: blinks, expressions, lip movement), sockets for weapons and props, and the root node
 * that gameplay moves. The model faces +Z in its own space.
 */
export class Character {
  readonly root: TransformNode;
  readonly model: ModelInstance;
  readonly rig: RigBinding;
  readonly animator: Animator;
  readonly materials: CharacterMaterialSet;
  readonly manifest: CharacterManifest;
  readonly face: Face;
  /** Hem springs for robes and skirts (characters built with cloth bones). */
  readonly cloth: ClothSprings | null;
  readonly meshes: AbstractMesh[];
  private sockets = new Map<string, TransformNode>();

  private constructor(scene: Scene, model: ModelInstance, manifest: CharacterManifest, materials: CharacterMaterialSet, lib: AnimLibrary, name: string) {
    this.model = model;
    this.manifest = manifest;
    this.materials = materials;
    this.root = new TransformNode(`${name}:root`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    model.root.parent = this.root;
    this.meshes = model.meshes;
    const skeleton = model.skeletons[0];
    this.rig = new RigBinding(skeleton);
    this.animator = new Animator(this.rig, lib.bind(this.rig));
    this.cloth = ClothSprings.create(this.rig);
    const morphs: MorphTarget[] = [];
    for (const m of this.meshes) {
      const mgr = (m as AbstractMesh & { morphTargetManager?: { numTargets: number; getTarget(i: number): MorphTarget } }).morphTargetManager;
      if (!mgr) continue;
      for (let i = 0; i < mgr.numTargets; i++) morphs.push(mgr.getTarget(i));
    }
    this.face = new Face(morphs, this.rig);
    for (const m of this.meshes) {
      m.alwaysSelectAsActiveMesh = false;
      // characters are always near the camera: skip per-frame bounding refresh costs on skinned meshes
      m.refreshBoundingInfo({ applySkeleton: false, applyMorph: false });
    }
  }

  static async create(scene: Scene, assets: AssetManager, mats: CharacterMaterials, lib: AnimLibrary, id: string, name: string): Promise<Character> {
    const [manifest, model] = await Promise.all([
      assets.loadJson<CharacterManifest>(`chars/${id}/${id}.json`),
      assets.instantiate(`chars/${id}/${id}.glb`, name),
    ]);
    const set = mats.apply(model.meshes, id, manifest);
    return new Character(scene, model, manifest, set, lib, name);
  }

  /** A node following a socket bone (weapon_r, weapon_l, lantern, head ...). */
  socket(name: string): TransformNode {
    let s = this.sockets.get(name);
    if (!s) {
      const bone = this.rig.bone(name);
      if (!bone) throw new Error(`no socket bone ${name}`);
      s = new TransformNode(`${this.root.name}:${name}:socket`, this.root.getScene());
      s.parent = bone;
      this.sockets.set(name, s);
    }
    return s;
  }

  /** World position of a bone. */
  bonePosition(name: string, out = new Vector3()): Vector3 {
    const b = this.rig.bone(name);
    if (!b) return out.copyFrom(this.root.position);
    b.computeWorldMatrix(true);
    return out.copyFrom(b.getAbsolutePosition());
  }

  /** Facing direction on the ground plane (unit vector). */
  get forward(): Vector3 {
    const m = Matrix.Identity();
    this.root.rotationQuaternion!.toRotationMatrix(m);
    return Vector3.TransformNormal(new Vector3(0, 0, 1), m);
  }

  get yaw(): number {
    const f = this.forward;
    return Math.atan2(f.x, f.z);
  }

  set yaw(a: number) {
    Quaternion.RotationYawPitchRollToRef(a, 0, 0, this.root.rotationQuaternion!);
  }

  update(dt: number): void {
    this.animator.update(dt);
    this.cloth?.update(dt);
    this.face.update(dt);
  }

  setDissolve(v: number): void {
    for (const d of this.materials.dissolve) d.setAmount(v);
  }

  /** The glow at the dissolving edge (ember orange by default; brine for the drowned). */
  setDissolveColor(c: [number, number, number]): void {
    for (const d of this.materials.dissolve) d.color.set(c[0], c[1], c[2]);
  }

  dispose(): void {
    for (const s of this.sockets.values()) s.dispose();
    this.model.dispose();
    this.root.dispose();
  }
}
