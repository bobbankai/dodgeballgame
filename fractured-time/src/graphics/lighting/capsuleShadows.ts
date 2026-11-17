import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Capsule shadows: the soft occlusion a body casts under light from everywhere (UE's capsule indirect shadows, the same idea
 * as its distance-field AO for characters). In a room lit evenly the directional shadow of a moving character is weak by
 * design; without something else the figure floats. Each nearby character is approximated by five capsules from its
 * skeleton (torso, thighs, shins); baked surfaces within a few metres of the player lose the share of their sky that those
 * capsules cover: (r / d)^2, stretched by the capsule's length and weighted by the angle to the surface normal.
 */
const T = TSL as any;
const { Fn, uniform, uniformArray, float, vec3, vec4, positionWorld, normalWorldGeometry, max, min, dot, clamp, length, If, smoothstep, Loop, int } = T;

const MAX_CHARS = 4;
const PER_CHAR = 5;
const MAX_CAPS = MAX_CHARS * PER_CHAR;

/** bone pairs and radii (m) */
const SEGMENTS: [string, string, number][] = [
  ['pelvis', 'neck_01', 0.16],
  ['thigh_l', 'calf_l', 0.085], ['thigh_r', 'calf_r', 0.085],
  ['calf_l', 'foot_l', 0.06], ['calf_r', 'foot_r', 0.06],
];

export class CapsuleShadows {
  private a = Array.from({ length: MAX_CAPS }, () => new THREE.Vector4(0, -1e4, 0, 0));
  private b = Array.from({ length: MAX_CAPS }, () => new THREE.Vector4(0, -1e4, 0, 0));
  readonly u = {
    a: uniformArray(this.a, 'vec4'), b: uniformArray(this.b, 'vec4'), count: uniform(0, 'int'),
    focus: uniform(new THREE.Vector3()), strength: uniform(0.75),
  };
  private bones = new WeakMap<THREE.Object3D, (THREE.Object3D | undefined)[]>();
  private node: any = null;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  /** Characters near the player (nearest first; at most four are used) and the player's position. */
  update(roots: THREE.Object3D[], focus: THREE.Vector3): void {
    const u = this.u as any;
    u.focus.value.copy(focus);
    let n = 0;
    for (const root of roots.slice(0, MAX_CHARS)) {
      let b = this.bones.get(root);
      if (!b) {
        b = SEGMENTS.flatMap(([x, y]) => [root.getObjectByName(x), root.getObjectByName(y)]);
        this.bones.set(root, b);
      }
      if (!root.visible) continue;
      SEGMENTS.forEach(([, , r], i) => {
        const p = b![i * 2], q = b![i * 2 + 1];
        if (!p || !q || n >= MAX_CAPS) return;
        p.getWorldPosition(this.tmp);
        q.getWorldPosition(this.tmp2);
        this.a[n].set(this.tmp.x, this.tmp.y, this.tmp.z, r);
        this.b[n].set(this.tmp2.x, this.tmp2.y, this.tmp2.z, 0);
        n++;
      });
    }
    u.count.value = n;
    for (let i = n; i < MAX_CAPS; i++) this.a[i].set(0, -1e4, 0, 0);
  }

  /** The visibility factor (1 = open) for the current fragment of a baked surface. One node shared by every material. */
  factor(): any {
    if (this.node) return this.node;
    const u = this.u as any;
    this.node = Fn(() => {
      const vis = float(1).toVar();
      const P = positionWorld;
      If(length(P.sub(u.focus)).lessThan(7.0).and(u.count.greaterThan(0)), () => {
        const N = normalWorldGeometry;
        Loop({ start: int(0), end: u.count, type: 'int', condition: '<' }, ({ i }: any) => {
          const A = u.a.element(i), B = u.b.element(i);
          const r = A.w;
          const ab = B.xyz.sub(A.xyz);
          const len2 = max(dot(ab, ab), 1e-6);
          const t = clamp(dot(P.sub(A.xyz), ab).div(len2), 0.0, 1.0);
          const v = A.xyz.add(ab.mul(t)).sub(P);
          const d = max(length(v), r.add(0.01));
          // a sphere covers (r/d)^2 of the hemisphere; a capsule as long as the distance covers about twice that
          const stretch = float(1).add(min(len2.sqrt().div(d), 2.0));
          const cosT = clamp(dot(N, v.div(d)).mul(0.6).add(0.4), 0.0, 1.0);
          const occ = clamp(r.mul(r).div(d.mul(d)).mul(stretch).mul(cosT), 0.0, 1.0);
          vis.mulAssign(float(1).sub(occ.mul(u.strength)));
        });
        // fade out toward the edge of the region so the cut-off never shows
        vis.assign(vis.add(vis.oneMinus().mul(smoothstep(5.0, 7.0, length(P.sub(u.focus))))));
      });
      return vis;
    })();
    return this.node;
  }
}

/** The live capsule pass (null when the preset has none): baked materials built while it exists read its factor. */
let active: CapsuleShadows | null = null;
export function setActiveCapsules(c: CapsuleShadows | null): void { active = c; }
export function activeCapsuleFactor(): any { return active ? active.factor() : null; }

void vec3; void vec4;
