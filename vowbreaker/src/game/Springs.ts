import { Matrix, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

interface Spring {
  node: TransformNode;
  len: number;
  tip: Vector3;
  prev: Vector3;
  stiffness: number;
  damping: number;
  gravity: number;
  /** keep the tip at least this far from the character's vertical axis (skirts round the legs) */
  radius: number;
  inited: boolean;
  rest: Quaternion;
}

const tmpM = new Matrix();
const tmpQ = new Quaternion();

/**
 * Loose things that follow the body with lag: long hair, ponytails, coat tails, skirts. Each spring
 * bone's tip is a Verlet point pulled toward where the animation would put it, with gravity and
 * damping, kept at the bone's length; the bone is then rotated to point at the simulated tip.
 */
export class Springs {
  private springs: Spring[] = [];
  /** world-space velocity of the character (adds drag when dashing) */
  readonly wind = new Vector3();

  constructor(bones: Map<string, TransformNode>, private axisNode: TransformNode, scale: number) {
    for (const [name, node] of bones) {
      let stiffness = 0;
      let damping = 0.86;
      let gravity = 4;
      let len = 0.3 * scale;
      let radius = 0;
      if (name.startsWith('hair_')) {
        stiffness = 0.12;
        damping = 0.85;
        gravity = 6;
        len = 0.3 * scale;
      } else if (name.startsWith('skirt_')) {
        stiffness = 0.25;
        damping = 0.8;
        gravity = 3;
        len = 0.32 * scale;
        radius = 0.14 * scale;
      } else if (name.startsWith('coat_')) {
        stiffness = 0.18;
        damping = 0.84;
        gravity = 5;
        len = 0.42 * scale;
        radius = 0.13 * scale;
      } else continue;
      if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
      // chained bones: length is the distance to the child
      const child = node.getChildren((c) => c instanceof TransformNode && (c as TransformNode).name.startsWith(name.split('_')[0]), true)[0] as TransformNode | undefined;
      if (child) len = child.position.length();
      this.springs.push({ node, len, tip: new Vector3(), prev: new Vector3(), stiffness, damping, gravity, radius, inited: false, rest: node.rotationQuaternion.clone() });
    }
  }

  get count(): number {
    return this.springs.length;
  }

  /** Call after the animator has posed the skeleton (spring bones are at rest in every clip). */
  update(dt: number): void {
    if (!this.springs.length || dt <= 0) return;
    const axis = this.axisNode.getAbsolutePosition();
    for (const s of this.springs) {
      const n = s.node;
      const parent = n.parent as TransformNode;
      n.rotationQuaternion!.copyFrom(s.rest);
      parent.computeWorldMatrix(true);
      n.computeWorldMatrix(true);
      const head = n.getAbsolutePosition().clone();
      // where the tip would be if rigid
      const dir = Vector3.TransformNormal(new Vector3(0, 1, 0), n.getWorldMatrix()).normalize();
      const target = head.add(dir.scale(s.len));
      if (!s.inited) {
        s.tip.copyFrom(target);
        s.prev.copyFrom(target);
        s.inited = true;
      }
      const vel = s.tip.subtract(s.prev).scale(s.damping);
      s.prev.copyFrom(s.tip);
      s.tip.addInPlace(vel);
      s.tip.addInPlace(target.subtract(s.tip).scale(s.stiffness));
      s.tip.y -= s.gravity * dt * dt;
      s.tip.addInPlace(this.wind.scale(-dt * 0.15));
      if (s.radius > 0) {
        const off = new Vector3(s.tip.x - axis.x, 0, s.tip.z - axis.z);
        const d = off.length();
        if (d < s.radius && d > 1e-4) s.tip.addInPlace(off.scale((s.radius - d) / d));
      }
      const to = s.tip.subtract(head);
      const tl = to.length();
      if (tl < 1e-5) continue;
      s.tip.copyFrom(head.add(to.scale(s.len / tl)));
      // do the rotation in the parent's own coordinates (the glTF root mirrors z, so world-space
      // quaternions would come out improper)
      parent.getWorldMatrix().invertToRef(tmpM);
      const a = Vector3.TransformNormal(dir, tmpM).normalize();
      const b = Vector3.TransformNormal(to, tmpM).normalize();
      const ax = Vector3.Cross(a, b);
      const sin = ax.length();
      if (sin < 1e-5) continue;
      const ang = Math.min(Math.atan2(sin, Vector3.Dot(a, b)), 1.4);
      Quaternion.RotationAxisToRef(ax.scale(1 / sin), ang, tmpQ);
      tmpQ.multiplyToRef(s.rest, n.rotationQuaternion!);
    }
  }

  reset(): void {
    for (const s of this.springs) s.inited = false;
  }
}
