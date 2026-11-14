import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { assetUrl } from '@/rendering/charmat';

/**
 * Baked light probes: Cycles renders the scene at a grid of points in every level section and projects the radiance onto order-2
 * spherical harmonics (blender/environments/envkit.py bake_probes). Characters are lit by a blend of the nearest probes, so they sit in
 * the same light as the lightmapped walls around them (bounce from the floor, the colour of the room, darkness in corners), the way
 * volumetric lightmaps / light probe groups light dynamic objects in production engines.
 */
interface Probe { p: THREE.Vector3; sh: THREE.Vector3[]; section: number }

export class ProbeField {
  private probes: Probe[] = [];
  private boxes: THREE.Box3[] = [];

  async load(path: string, section: number, box: THREE.Box3): Promise<void> {
    this.boxes[section] = box;
    const r = await fetch(assetUrl(path));
    if (!r.ok) return;
    const j = (await r.json()) as { probes: { p: number[]; sh: number[][] }[] };
    for (const q of j.probes) {
      this.probes.push({ p: new THREE.Vector3(q.p[0], q.p[1], q.p[2]), sh: q.sh.map((c) => new THREE.Vector3(c[0], c[1], c[2])), section });
    }
  }

  get size(): number { return this.probes.length; }

  /** Blend of the nearest probes (inverse squared distance, k nearest; probes of the section the point is in when there are any). */
  sample(at: THREE.Vector3, out: THREE.Vector3[], k = 4): boolean {
    if (!this.probes.length) return false;
    const inside = this.boxes.map((b, i) => (b && b.containsPoint(at) ? i : -1)).filter((i) => i >= 0);
    let pool = inside.length ? this.probes.filter((p) => inside.includes(p.section)) : this.probes;
    if (!pool.length) pool = this.probes;
    const near = pool.map((p) => ({ p, d: p.p.distanceToSquared(at) })).sort((a, b) => a.d - b.d).slice(0, k);
    for (const v of out) v.set(0, 0, 0);
    let wsum = 0;
    for (const { p, d } of near) {
      const w = 1 / (d + 0.25);
      wsum += w;
      for (let i = 0; i < 9; i++) out[i].addScaledVector(p.sh[i], w);
    }
    for (const v of out) v.multiplyScalar(1 / wsum);
    return true;
  }
}

/** Per-character lighting: its own SH probe plus the shared real-time light pool, wired into every material of the character. */
export class CharacterLight {
  readonly probe = new THREE.LightProbe();
  private target = Array.from({ length: 9 }, () => new THREE.Vector3());
  private primed = false;

  constructor(root: THREE.Object3D, shared: THREE.Light[]) {
    const node = (T as any).lights([...shared, this.probe]);
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (seen.has(mat) || !(mat as any).isNodeMaterial) continue;
        seen.add(mat);
        (mat as any).lightsNode = node;
        mat.needsUpdate = true;
      }
    });
  }

  /** Follow the probe field at `at` (chest height), easing so walking between probes never pops. */
  update(field: ProbeField, at: THREE.Vector3, dt: number): void {
    if (!field.sample(at, this.target)) return;
    const k = this.primed ? 1 - Math.exp(-dt * 5) : 1;
    this.primed = true;
    const c = this.probe.sh.coefficients;
    for (let i = 0; i < 9; i++) c[i].lerp(this.target[i], k);
  }
}
