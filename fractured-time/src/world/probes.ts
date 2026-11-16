import * as THREE from 'three/webgpu';
import * as T from 'three/tsl';
import { assetUrl } from '@/rendering/charmat';

/**
 * Baked light probes: Cycles renders the scene at a grid of points in every level section and projects the radiance onto order-2
 * spherical harmonics (blender/environments/envkit.py bake_probes). Characters are lit by a blend of the nearest probes, so they sit in
 * the same light as the lightmapped walls around them (bounce from the floor, the colour of the room, darkness in corners), the way
 * volumetric lightmaps / light probe groups light dynamic objects in production engines.
 */
interface Probe { p: THREE.Vector3; sh: THREE.Vector3[]; section: number; timeline?: 'a' | 'b' }

export class ProbeField {
  private probes: Probe[] = [];
  private boxes: THREE.Box3[] = [];

  /** sections with a second set (Timeline Shift) answer from the current reality's set */
  timeline: 'a' | 'b' = 'a';

  async load(path: string, section: number, box: THREE.Box3, timeline?: 'a' | 'b'): Promise<void> {
    this.boxes[section] = box;
    const r = await fetch(assetUrl(path));
    if (!r.ok) return;
    const j = (await r.json()) as { probes: { p: number[]; sh: number[][] }[] };
    for (const q of j.probes) {
      this.probes.push({ p: new THREE.Vector3(q.p[0], q.p[1], q.p[2]), sh: q.sh.map((c) => new THREE.Vector3(c[0], c[1], c[2])), section, timeline });
    }
  }

  get size(): number { return this.probes.length; }

  /** Blend of the nearest probes (inverse squared distance, k nearest; probes of the section the point is in when there are any). */
  sample(at: THREE.Vector3, out: THREE.Vector3[], k = 4): boolean {
    if (!this.probes.length) return false;
    const inside = this.boxes.map((b, i) => (b && b.containsPoint(at) ? i : -1)).filter((i) => i >= 0);
    const real = this.probes.filter((p) => !p.timeline || p.timeline === this.timeline);
    let pool = inside.length ? real.filter((p) => inside.includes(p.section)) : real;
    if (!pool.length) pool = real.length ? real : this.probes;
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
const _flash = new THREE.Vector3();
const _to = new THREE.Vector3();
const _right = new THREE.Vector3();
const _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const lum = (v: THREE.Vector3) => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;

/**
 * The character light rig, as film and games light their actors on top of the set's own light: a soft FILL from the camera's
 * side that only lifts a character toward a readable minimum where the place is dark (Ethan's suit is near black: on the night
 * street the baked probe left him a silhouette), and a RIM from behind and above in the colour of the air around him, which
 * separates the figure from the background and fades out where the place is bright enough to model him itself. Only characters
 * see these lights (their own lights node).
 */
const FILL_E = 2.1;   // effective irradiance (x the place's exposure) the fill lifts a character's lit side to
const RIM_E = 4.2;    // effective rim strength in a dark place

export class CharacterLight {
  readonly probe = new THREE.LightProbe();
  private target = Array.from({ length: 9 }, () => new THREE.Vector3());
  private primed = false;
  private fill = new THREE.DirectionalLight(0xffffff, 0);
  private rim = new THREE.DirectionalLight(0xffffff, 0);

  constructor(root: THREE.Object3D, shared: THREE.Light[]) {
    const node = (T as any).lights([...shared, this.probe, this.fill, this.rim]);
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

  /** Follow the probe field at `at` (chest height), easing so walking between probes never pops. `flash` (0..1): a lightning
   *  strike adds cold light from the sky above (L0 + the upward L1 term), applied instantly so the flicker is sharp. */
  update(field: ProbeField, at: THREE.Vector3, dt: number, flash = 0): void {
    if (!field.sample(at, this.target)) return;
    const k = this.primed ? 1 - Math.exp(-dt * 5) : 1;
    this.primed = true;
    for (let i = 0; i < 9; i++) this.base[i].lerp(this.target[i], k);
    this.flashed = flash;
  }

  private flashed = 0;
  private base = Array.from({ length: 9 }, () => new THREE.Vector3());

  /** Aim and weigh the fill and rim for this frame. `at` = chest, `exposure` = the place's eye adaptation, `air` = the colour
   *  of the air behind (outdoors the haze; null indoors: the probe's own colour). */
  rig(at: THREE.Vector3, cam: THREE.Vector3, exposure: number, air: THREE.Color | null): void {
    const a = lum(this.base[0]);
    const eff = a * exposure;
    _to.subVectors(cam, at).setY(0);
    if (_to.lengthSq() < 1e-6) _to.set(0, 0, 1);
    _to.normalize();
    _right.crossVectors(UP, _to).normalize();
    // fill: from beside the camera, a little above; just enough to bring the lit side up to FILL_E (the probe's own
    // irradiance on that side is about twice its L0 term)
    const ex = Math.max(exposure, 0.25);
    this.fill.intensity = Math.max(0, FILL_E / ex - a * 0.886 * 2);
    const tint = _d.copy(this.base[0]).multiplyScalar(1 / Math.max(a, 1e-4));
    this.fill.color.setRGB(0.55 + 0.45 * tint.x, 0.55 + 0.45 * tint.y, 0.55 + 0.45 * tint.z);
    this.fill.position.copy(at).addScaledVector(_to, 4).addScaledVector(_right, 2.2).addScaledVector(UP, 2.6);
    // rim: behind him and above, the air's colour, strongest where the place is dark
    const dark = 1 - THREE.MathUtils.smoothstep(eff, 0.45, 1.3);
    const src = air ?? new THREE.Color(this.base[0].x, this.base[0].y, this.base[0].z);
    const sl = Math.max(0.2126 * src.r + 0.7152 * src.g + 0.0722 * src.b, 1e-4);
    this.rim.intensity = RIM_E * dark / ex;
    this.rim.color.setRGB(src.r / sl, src.g / sl, src.b / sl).multiplyScalar(0.8).addScalar(0.2);
    this.rim.position.copy(at).addScaledVector(_to, -4).addScaledVector(_right, -1.4).addScaledVector(UP, 3.2);
    for (const l of [this.fill, this.rim]) {
      l.target.position.copy(at);
      l.updateMatrixWorld(true);
      l.target.updateMatrixWorld(true);
    }
  }
  /** The probe as rendered this frame: the eased base plus the instantaneous flash. */
  apply(): void {
    const c = this.probe.sh.coefficients;
    for (let i = 0; i < 9; i++) c[i].copy(this.base[i]);
    const f = this.flashed;
    if (f <= 0) return;
    c[0].add(_flash.set(0.7, 0.8, 1.0).multiplyScalar(f * 1.6));
    c[1].add(_flash.set(0.7, 0.8, 1.0).multiplyScalar(f * 1.2)); // L1 y: light from above
  }
}
