import { AbstractMesh, Mesh, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { CharacterLook, makeOutline } from '../render/Materials';
import { loadClips, loadContainer } from './Assets';
import { Animator } from './Animator';
import { Face } from './Face';
import { Springs } from './Springs';

export interface CharacterOptions {
  /** multiply the painted colours (curses, the Little Bell's black) */
  tint?: [number, number, number];
  outline?: number;
  scale?: number;
  palette?: number;
}

/** Heights the models were built at (Blender cast.py), used to scale animation and springs. */
export const HEIGHTS: Record<string, number> = {
  itsuki: 1.74, sayo: 1.66, mikami: 1.86, sojin: 1.82, sojin_young: 1.78, ryoga: 1.77, mio: 1.26, hina: 1.1, kota: 1.2,
  acolyte: 1.76, mudhand: 1.55, umbrella: 2.35, bride: 2.2, shiragami: 3.1,
};

/**
 * A sculpted character in the world: the skinned model with its toon material and ink outline,
 * the shared clips on its own skeleton, an anime face, spring bones and props in its hands.
 */
export class Character {
  readonly root: TransformNode;
  readonly look = new CharacterLook();
  meshes: Mesh[] = [];
  anim!: Animator;
  face!: Face;
  springs!: Springs;
  bones = new Map<string, TransformNode>();
  height = 1.7;
  private props: TransformNode[] = [];
  /** yaw in radians; the model faces +Z at yaw 0 */
  yaw = 0;
  visible = true;

  private constructor(readonly r: Renderer, readonly model: string, readonly id: string) {
    this.root = new TransformNode('char_' + id, r.scene);
  }

  static async create(r: Renderer, model: string, id = model, opts: CharacterOptions = {}): Promise<Character> {
    const c = new Character(r, model, id);
    const [container, lib] = await Promise.all([loadContainer(r.scene, `chars/${model}.glb`), loadClips(r.scene)]);
    const inst = container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
    c.height = HEIGHTS[model] ?? 1.7;
    for (const n of inst.rootNodes) n.parent = c.root;
    const scale = opts.scale ?? 1;
    c.root.scaling.setAll(scale);
    if (opts.tint) c.look.tint.set(opts.tint[0], opts.tint[1], opts.tint[2], 1);
    if (opts.outline !== undefined) c.look.outlineWidth = opts.outline;
    if (opts.palette !== undefined) c.look.energy.y = opts.palette;
    for (const n of c.root.getDescendants(false)) {
      if (n instanceof TransformNode && !(n instanceof AbstractMesh)) c.bones.set(n.name, n);
    }
    const meshes = c.root.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    for (const m of meshes) {
      // vertex colour alpha carries material ids, not transparency
      m.hasVertexAlpha = false;
      m.material = r.mats.toon(m, c.look);
      m.alwaysSelectAsActiveMesh = true;
      m.isPickable = false;
      const ink = makeOutline(r.mats, m, c.look);
      ink.alwaysSelectAsActiveMesh = true;
      r.shadow.addCaster(m, c.look);
      r.gbuffer.add(m, c.look);
      c.meshes.push(m, ink);
    }
    c.anim = new Animator(lib, c.root);
    c.face = new Face(c.anim.bones, c.height * 0.13);
    const hips = c.bones.get('hips') ?? c.root;
    c.springs = new Springs(c.anim.bones, hips, c.height / 1.72);
    c.anim.play('idle_relaxed', 0);
    return c;
  }

  get position(): Vector3 {
    return this.root.position;
  }

  bone(name: string): TransformNode | undefined {
    return this.bones.get(name);
  }

  /** World position of a bone (forces its world matrix up to date). */
  bonePos(name: string, out = new Vector3()): Vector3 {
    const b = this.bones.get(name);
    if (!b) return out.copyFrom(this.root.position);
    b.computeWorldMatrix(true);
    return out.copyFrom(b.getAbsolutePosition());
  }

  forward(out = new Vector3()): Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.setEnabled(v);
    for (const m of this.meshes) m.setEnabled(v);
  }

  /** Attach a prop mesh to a bone (Sojin's staff, Sayo's talismans). */
  attach(node: TransformNode, bone: string, offset = Vector3.Zero(), rot = Quaternion.Identity()): void {
    const b = this.bones.get(bone);
    if (!b) return;
    node.parent = b;
    node.position.copyFrom(offset);
    node.rotationQuaternion = rot;
    this.props.push(node);
  }

  update(dt: number, animDt = dt): void {
    this.root.rotationQuaternion = Quaternion.RotationYawPitchRoll(this.yaw, 0, 0);
    this.anim.update(animDt);
    this.face.update(dt);
    this.root.computeWorldMatrix(true);
    this.look.pivot.set(this.root.position.x, this.root.position.y, this.root.position.z, 0);
    this.springs.update(animDt);
    this.updateHeadFrame();
  }

  private updateHeadFrame(): void {
    const head = this.bones.get('head');
    const el = this.bones.get('eye_L');
    const er = this.bones.get('eye_R');
    if (!head || !el || !er) return;
    head.computeWorldMatrix(true);
    el.computeWorldMatrix(true);
    er.computeWorldMatrix(true);
    const hp = head.getAbsolutePosition();
    const pl = el.getAbsolutePosition();
    const pr = er.getAbsolutePosition();
    const left = pl.subtract(pr).normalize();
    const mid = pl.add(pr).scale(0.5);
    let fwd = mid.subtract(hp);
    const up = Vector3.Cross(fwd, left).normalize();
    // the face looks along `fwd` minus its vertical part relative to `up`
    fwd = Vector3.Cross(left, up).normalize();
    this.look.headRight.copyFrom(left);
    this.look.headUp.copyFrom(up.y < 0 ? up.scale(-1) : up);
    this.look.headForward.copyFrom(fwd);
  }

  dispose(): void {
    for (const p of this.props) p.dispose();
    for (const m of this.meshes) m.dispose(false, false);
    this.root.dispose(false, true);
  }
}
