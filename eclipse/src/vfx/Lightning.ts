import { Color3, Constants, Mesh, MeshBuilder, StandardMaterial, Vector3, type Scene } from '@babylonjs/core';

interface Bolt {
  mesh: Mesh;
  t: number;
  life: number;
  flicker: number[];
}

/**
 * Lightning bolts: a jagged channel from the cloud base down to the strike point (recursive midpoint
 * displacement), with a few forking branches, drawn as thin additive tubes so the bloom turns them
 * into a blinding filament. A bolt lives a fifth of a second and flickers (return strokes) before it
 * fades; the sky flashes with it.
 */
export class Lightning {
  private bolts: Bolt[] = [];
  private mat: StandardMaterial;
  /** Called on every strike (sky flash, thunder). */
  onStrike: ((at: Vector3, distant: boolean) => void) | null = null;

  constructor(private scene: Scene) {
    const m = new StandardMaterial('lightning', scene);
    m.disableLighting = true;
    m.emissiveColor = new Color3(3.2, 3.1, 6.0);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.alphaMode = Constants.ALPHA_ADD;
    m.alpha = 1;
    m.backFaceCulling = false;
    this.mat = m;
  }

  /** A bolt down onto `to`. `height`: how far above it the channel starts. */
  strike(to: Vector3, height = 40, distant = false): void {
    const top = to.add(new Vector3((Math.random() - 0.5) * height * 0.3, height, (Math.random() - 0.5) * height * 0.3));
    const main = this.channel(top, to, 6, height * 0.12);
    const tubes: Mesh[] = [];
    const radius = distant ? 0.6 : 0.09;
    tubes.push(MeshBuilder.CreateTube('boltMain', { path: main, radius, tessellation: 5, cap: Mesh.NO_CAP }, this.scene));
    // forks: off the upper two thirds, angled out and down, thinner
    const forks = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < forks; i++) {
      const k = Math.floor((0.15 + Math.random() * 0.5) * (main.length - 1));
      const from = main[k];
      const len = height * (0.15 + Math.random() * 0.25);
      const dir = new Vector3((Math.random() - 0.5) * 2, -0.6 - Math.random() * 0.6, (Math.random() - 0.5) * 2).normalize();
      const path = this.channel(from, from.add(dir.scale(len)), 4, len * 0.15);
      tubes.push(MeshBuilder.CreateTube('boltFork', { path, radius: radius * 0.45, tessellation: 4, cap: Mesh.NO_CAP }, this.scene));
    }
    const mesh = Mesh.MergeMeshes(tubes, true, true) ?? tubes[0];
    mesh.material = this.mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // two or three return strokes: on, off, on, fading
    const flicker = [0, 0.04, 0.07, 0.11, 0.13 + Math.random() * 0.04];
    this.bolts.push({ mesh, t: 0, life: 0.24, flicker });
    this.onStrike?.(to, distant);
  }

  /** Midpoint displacement between two points: `levels` subdivisions, offsets halving each level. */
  private channel(a: Vector3, b: Vector3, levels: number, amp: number): Vector3[] {
    let pts = [a.clone(), b.clone()];
    let off = amp;
    for (let l = 0; l < levels; l++) {
      const next: Vector3[] = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const mid = p0.add(p1).scale(0.5);
        mid.x += (Math.random() - 0.5) * 2 * off;
        mid.z += (Math.random() - 0.5) * 2 * off;
        mid.y += (Math.random() - 0.5) * off * 0.4;
        next.push(mid, p1);
      }
      pts = next;
      off *= 0.55;
    }
    return pts;
  }

  update(dt: number): void {
    for (const b of this.bolts) {
      b.t += dt;
      const f = b.flicker;
      const on = (b.t < f[1]) || (b.t > f[2] && b.t < f[3]) || b.t > f[4];
      const fade = b.t > f[4] ? Math.max(0, 1 - (b.t - f[4]) / (b.life - f[4])) : 1;
      b.mesh.visibility = on ? fade : 0;
    }
    const done = this.bolts.filter((b) => b.t >= b.life);
    for (const b of done) b.mesh.dispose();
    if (done.length) this.bolts = this.bolts.filter((b) => b.t < b.life);
  }

  clear(): void {
    for (const b of this.bolts) b.mesh.dispose();
    this.bolts = [];
  }
}
