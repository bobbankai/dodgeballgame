// Secondary motion and procedural overlays applied after the Animator each frame:
//  - spring chains (headband and sash tails, braids, coat tails): verlet points that follow the animated
//    chain root, pulled back toward the animated shape, with gravity, wind and damping; each bone is then
//    turned to point at the next simulated point
//  - look-at: neck and head turn toward a world target within limits
import { Quaternion, Vector3 } from '@babylonjs/core';
import type { TransformNode } from '@babylonjs/core';
import type { CharacterModel } from './CharacterModel';

interface Chain {
  nodes: TransformNode[];
  /** rest local rotations, and what this simulation last wrote (to tell whether the animation wrote since) */
  rest: Quaternion[];
  wrote: (Quaternion | null)[];
  pts: Vector3[];
  prev: Vector3[];
  len: number[];
  stiff: number;
  damp: number;
  gravity: number;
}

const up = new Vector3(0, 1, 0);

function fromTo(a: Vector3, b: Vector3): Quaternion {
  const an = a.normalizeToNew(), bn = b.normalizeToNew();
  const d = Vector3.Dot(an, bn);
  if (d > 0.99999) return Quaternion.Identity();
  if (d < -0.99999) {
    let ax = Vector3.Cross(new Vector3(1, 0, 0), an);
    if (ax.lengthSquared() < 1e-6) ax = Vector3.Cross(new Vector3(0, 1, 0), an);
    return Quaternion.RotationAxis(ax.normalize(), Math.PI);
  }
  const ax = Vector3.Cross(an, bn).normalize();
  return Quaternion.RotationAxis(ax, Math.acos(d));
}

export class Procedural {
  chains: Chain[] = [];
  lookTarget: Vector3 | null = null;
  lookWeight = 0;
  wind = new Vector3(0, 0, 0);
  private lookAmt = 0;

  constructor(readonly model: CharacterModel) {
    // chains are named prefix1..n in the rig (bandL1.., bandR1.., sash1.., braid1.., coatL1..)
    const prefixes = new Set<string>();
    for (const name of model.bones.keys()) {
      const m = name.match(/^([a-zA-Z]+)(\d+)$/);
      if (m && !['index', 'middle', 'ring', 'pinky', 'thumb'].includes(m[1])) prefixes.add(m[1]);
    }
    for (const p of prefixes) {
      const nodes: TransformNode[] = [];
      for (let i = 1; model.bones.has(`${p}${i}`); i++) nodes.push(model.bones.get(`${p}${i}`)!);
      if (nodes.length) this.addChain(nodes, p.startsWith('sash') || p.startsWith('coat') ? 0.55 : 0.35);
    }
  }

  addChain(nodes: TransformNode[], stiff = 0.4): void {
    for (const n of nodes) n.computeWorldMatrix(true);
    const pts = nodes.map((n) => n.getAbsolutePosition().clone());
    // the tip: extend the last segment
    const last = nodes[nodes.length - 1];
    const dir = pts.length > 1 ? pts[pts.length - 1].subtract(pts[pts.length - 2]) : new Vector3(0, -0.05, 0);
    pts.push(last.getAbsolutePosition().add(dir));
    const len = pts.slice(1).map((p, i) => Vector3.Distance(p, pts[i]));
    const rest = nodes.map((n) => (n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation)).clone());
    this.chains.push({ nodes, rest, wrote: nodes.map(() => null), pts, prev: pts.map((p) => p.clone()), len, stiff, damp: 0.12, gravity: 4.5 });
  }

  /** Call after the animator wrote the pose. dt in seconds. */
  update(dt: number): void {
    const h = Math.min(dt, 1 / 30);
    for (const c of this.chains) {
      // the animated shape must not include last frame's simulation: bones the animation didn't write this
      // frame (chains with no tracks, like a braid) go back to rest first, or the correction compounds
      c.nodes.forEach((n, i) => {
        const w = c.wrote[i];
        if (w && n.rotationQuaternion && n.rotationQuaternion.equalsWithEpsilon(w, 1e-6)) n.rotationQuaternion.copyFrom(c.rest[i]);
      });
      // animated (target) shape of the chain this frame
      for (const n of c.nodes) n.computeWorldMatrix(true);
      const anim = c.nodes.map((n) => n.getAbsolutePosition().clone());
      const lastN = c.nodes[c.nodes.length - 1];
      const tipDir = anim.length > 1 ? anim[anim.length - 1].subtract(anim[anim.length - 2]).normalize() : new Vector3(0, -1, 0);
      anim.push(lastN.getAbsolutePosition().add(tipDir.scale(c.len[c.len.length - 1])));
      // teleported (a cutscene placed the actor somewhere else): start the chain from its animated shape
      if (Vector3.DistanceSquared(c.pts[0], anim[0]) > 0.25) {
        for (let i = 0; i < c.pts.length; i++) { c.pts[i].copyFrom(anim[i]); c.prev[i].copyFrom(anim[i]); }
      }
      c.pts[0].copyFrom(anim[0]);
      c.prev[0].copyFrom(anim[0]);
      for (let i = 1; i < c.pts.length; i++) {
        const p = c.pts[i], q = c.prev[i];
        const vel = p.subtract(q).scale(1 - c.damp);
        q.copyFrom(p);
        const acc = new Vector3(this.wind.x, -c.gravity + this.wind.y, this.wind.z);
        p.addInPlace(vel).addInPlace(acc.scale(h * h));
        // pull toward the animated shape
        p.addInPlace(anim[i].subtract(p).scale(c.stiff * 0.35));
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < c.pts.length; i++) {
          const a = c.pts[i - 1], b = c.pts[i];
          const d = b.subtract(a);
          const L = d.length() || 1e-6;
          b.copyFrom(a.add(d.scale(c.len[i - 1] / L)));
        }
      }
      // orient each bone toward its simulated next point, measured from where the bone points NOW (after its
      // parent has turned), so rotations never stack down the chain. The last bone's tip rides in its local space.
      const lastNode = c.nodes[c.nodes.length - 1];
      lastNode.computeWorldMatrix(true);
      const tipLocal = Vector3.TransformCoordinates(anim[anim.length - 1], lastNode.getWorldMatrix().clone().invert());
      for (let i = 0; i < c.nodes.length; i++) {
        const n = c.nodes[i];
        n.computeWorldMatrix(true);
        const head = n.getAbsolutePosition().clone();
        let next: Vector3;
        if (i + 1 < c.nodes.length) { c.nodes[i + 1].computeWorldMatrix(true); next = c.nodes[i + 1].getAbsolutePosition(); }
        else next = Vector3.TransformCoordinates(tipLocal, n.getWorldMatrix());
        const curDir = next.subtract(head);
        const simDir = c.pts[i + 1].subtract(head);
        if (curDir.lengthSquared() < 1e-10 || simDir.lengthSquared() < 1e-10) continue;
        // the turn is found in the parent's space through its full world matrix: glTF rigs sit under a mirrored
        // root in Babylon, and a mirror can't be carried by decomposed rotations without flipping the result
        const parent = n.parent as TransformNode | null;
        if (parent) {
          parent.computeWorldMatrix(true);
          const pinv = parent.getWorldMatrix().clone().invert();
          const cl = Vector3.TransformNormal(curDir, pinv).normalize();
          const sl = Vector3.TransformNormal(simDir, pinv).normalize();
          const local = n.rotationQuaternion ?? Quaternion.FromEulerVector(n.rotation);
          n.rotationQuaternion = fromTo(cl, sl).multiply(local);
          c.wrote[i] = n.rotationQuaternion.clone();
        }
        n.computeWorldMatrix(true);
        for (let j = i + 1; j < c.nodes.length; j++) c.nodes[j].computeWorldMatrix(true);
      }
    }
    // look-at
    const k = Math.min(1, dt * 6);
    this.lookAmt += ((this.lookTarget ? this.lookWeight : 0) - this.lookAmt) * k;
    if (this.lookAmt > 0.01 && this.lookTarget) {
      for (const [bone, share] of [['neck', 0.4], ['head', 0.6]] as const) {
        const n = this.model.bones.get(bone);
        if (!n) continue;
        n.computeWorldMatrix(true);
        const pos = n.getAbsolutePosition();
        const fwd = n.getDirection(new Vector3(0, 0, 1));
        const toT = this.lookTarget.subtract(pos);
        if (toT.lengthSquared() < 1e-6) continue;
        // limit to ~70 degrees yaw / 35 pitch by clamping the target direction
        const flatF = new Vector3(fwd.x, 0, fwd.z).normalize();
        const flatT = new Vector3(toT.x, 0, toT.z).normalize();
        if (Vector3.Dot(flatF, flatT) < 0.3) continue;
        const delta = fromTo(fwd, toT);
        const part = Quaternion.Slerp(Quaternion.Identity(), delta, share * this.lookAmt);
        const world = n.absoluteRotationQuaternion.clone();
        const parent = n.parent as TransformNode | null;
        if (parent) {
          parent.computeWorldMatrix(true);
          n.rotationQuaternion = Quaternion.Inverse(parent.absoluteRotationQuaternion).multiply(part.multiply(world));
        }
      }
    }
    void up;
  }
}
