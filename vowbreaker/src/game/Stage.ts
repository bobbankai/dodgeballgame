import { AbstractMesh, Color3, Mesh, MeshBuilder, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { EnvSettings, envMaterial } from '../render/Env';
import { CURSED, DAWN, DAY, DUSK, FESTIVAL, FIRE, MOONLIT, NIGHT_RAIN, SPRING, SkyMood } from '../render/Sky';
import type { AmbientKind } from '../render/Ambient';
import type { Mood } from '../audio/Audio';
import { loadContainer } from './Assets';

export interface StageDef {
  id: string;
  glb: string | null;
  sky: SkyMood;
  sunDir: [number, number, number];
  sunColor: [number, number, number];
  skyColor: [number, number, number];
  groundColor: [number, number, number];
  shadowColor: [number, number, number];
  rimColor: [number, number, number];
  fog: { density: number; color: [number, number, number]; falloff?: number; base?: number };
  horizon: [number, number, number];
  aerial?: [number, number];
  grade?: Partial<{ exposure: number; contrast: number; saturation: number; temperature: number; tint: number; split: number; bloom: number; vignette: number }>;
  ambient?: { kind: AmbientKind; density: number };
  wet?: number;
  hatching?: number;
  glow?: [number, number, number];
  /** a static warm light (lanterns, street lamp): x, y, z, range, r, g, b, intensity */
  lamp?: [number, number, number, number, number, number, number, number];
  arena: number;
  music: Mood;
  rays?: boolean;
  /** fallback floor colour and pattern when there is no GLB yet */
  floor?: [number, number, number, number];
}

const S = (o: StageDef) => o;

/** The places the story happens. */
export const STAGES: Record<string, StageDef> = {
  alley: S({ id: 'alley', glb: 'stages/alley.glb', sky: NIGHT_RAIN, sunDir: [0.3, 0.8, 0.4], sunColor: [0.45, 0.5, 0.75], skyColor: [0.12, 0.14, 0.24],
    groundColor: [0.08, 0.06, 0.08], shadowColor: [0.3, 0.32, 0.55], rimColor: [0.9, 0.35, 0.7], fog: { density: 0.03, color: [0.1, 0.1, 0.16] },
    horizon: [0.12, 0.12, 0.2], grade: { exposure: 0.25, contrast: 1.12, saturation: 1.1, split: 0.3, bloom: 0.8 }, ambient: { kind: 'rain', density: 1 }, wet: 1,
    glow: [1.0, 0.35, 0.8], lamp: [2, 3.2, 4, 9, 1.0, 0.75, 0.45, 2.2], arena: 9, music: 'tense', floor: [0.32, 0.32, 0.36, 5] }),
  academy: S({ id: 'academy', glb: 'stages/academy.glb', sky: DAWN, sunDir: [-0.6, 0.45, 0.55], sunColor: [1.45, 1.1, 0.85], skyColor: [0.45, 0.5, 0.7],
    groundColor: [0.25, 0.22, 0.2], shadowColor: [0.42, 0.45, 0.72], rimColor: [1.0, 0.8, 0.6], fog: { density: 0.008, color: [0.75, 0.7, 0.75] },
    horizon: [0.85, 0.78, 0.8], aerial: [25, 140], grade: { exposure: 0.1, contrast: 1.05, saturation: 1.05, temperature: 0.1, split: 0.15 },
    ambient: { kind: 'petals', density: 0.5 }, arena: 13, music: 'calm', rays: true, floor: [0.62, 0.58, 0.5, 6] }),
  academy_night: S({ id: 'academy_night', glb: 'stages/academy.glb', sky: NIGHT_RAIN, sunDir: [0.4, 0.75, -0.4], sunColor: [0.4, 0.48, 0.75], skyColor: [0.1, 0.12, 0.22],
    groundColor: [0.06, 0.05, 0.07], shadowColor: [0.25, 0.28, 0.5], rimColor: [0.5, 0.7, 1.0], fog: { density: 0.025, color: [0.08, 0.09, 0.14] },
    horizon: [0.1, 0.11, 0.18], grade: { exposure: 0.3, contrast: 1.12, saturation: 0.9, split: 0.35, bloom: 0.8 }, ambient: { kind: 'rain', density: 1 }, wet: 1,
    glow: [1.0, 0.6, 0.3], lamp: [0, 4, 0, 12, 1.0, 0.6, 0.3, 1.5], arena: 13, music: 'boss', floor: [0.4, 0.38, 0.34, 6] }),
  chapel: S({ id: 'chapel', glb: 'stages/chapel.glb', sky: MOONLIT, sunDir: [-0.4, 0.45, 0.8], sunColor: [0.65, 0.75, 1.1], skyColor: [0.12, 0.17, 0.3],
    groundColor: [0.05, 0.06, 0.08], shadowColor: [0.22, 0.28, 0.5], rimColor: [0.6, 0.8, 1.2], fog: { density: 0.015, color: [0.1, 0.14, 0.22] },
    horizon: [0.12, 0.18, 0.3], grade: { exposure: 0.35, contrast: 1.1, saturation: 0.95, split: 0.3, bloom: 0.7 }, ambient: { kind: 'motes', density: 0.4 },
    arena: 12, music: 'tense', rays: true, floor: [0.7, 0.68, 0.66, 14] }),
  subway: S({ id: 'subway', glb: 'stages/subway.glb', sky: NIGHT_RAIN, sunDir: [0.0, 1.0, 0.1], sunColor: [0.85, 0.9, 1.0], skyColor: [0.25, 0.28, 0.3],
    groundColor: [0.12, 0.12, 0.14], shadowColor: [0.3, 0.34, 0.45], rimColor: [0.9, 0.95, 1.0], fog: { density: 0.02, color: [0.12, 0.13, 0.12] },
    horizon: [0.15, 0.16, 0.15], grade: { exposure: 0.15, contrast: 1.1, saturation: 0.85, temperature: -0.1, tint: 0.15, split: 0.2 },
    glow: [0.9, 1.0, 0.95], lamp: [0, 3.5, 0, 14, 0.9, 1.0, 0.95, 1.2], arena: 11, music: 'battle', floor: [0.55, 0.55, 0.55, 23] }),
  village: S({ id: 'village', glb: 'stages/village.glb', sky: FESTIVAL, sunDir: [0.5, 0.6, -0.6], sunColor: [0.5, 0.45, 0.65], skyColor: [0.12, 0.1, 0.2],
    groundColor: [0.1, 0.06, 0.05], shadowColor: [0.25, 0.22, 0.45], rimColor: [1.2, 0.6, 0.3], fog: { density: 0.012, color: [0.2, 0.1, 0.12] },
    horizon: [0.3, 0.14, 0.15], grade: { exposure: 0.35, contrast: 1.05, saturation: 1.15, temperature: 0.15, split: 0.2, bloom: 0.9 }, ambient: { kind: 'motes', density: 0.6 },
    glow: [1.0, 0.5, 0.18], lamp: [0, 3, 0, 14, 1.0, 0.5, 0.2, 2], arena: 13, music: 'festival', floor: [0.55, 0.45, 0.36, 22] }),
  village_burning: S({ id: 'village_burning', glb: 'stages/village.glb', sky: FIRE, sunDir: [0.5, 0.6, -0.6], sunColor: [1.2, 0.5, 0.2], skyColor: [0.25, 0.08, 0.05],
    groundColor: [0.12, 0.04, 0.02], shadowColor: [0.3, 0.12, 0.2], rimColor: [1.6, 0.6, 0.2], fog: { density: 0.03, color: [0.3, 0.1, 0.05] },
    horizon: [0.5, 0.15, 0.05], grade: { exposure: 0.3, contrast: 1.15, saturation: 1.2, temperature: 0.3, split: 0.3, bloom: 1.2 }, ambient: { kind: 'embers', density: 1 },
    glow: [1.0, 0.4, 0.1], lamp: [0, 2, 0, 18, 1.0, 0.4, 0.1, 3], arena: 13, music: 'boss', floor: [0.4, 0.3, 0.25, 22] }),
  estate: S({ id: 'estate', glb: 'stages/estate.glb', sky: DAY, sunDir: [-0.5, 0.7, 0.4], sunColor: [1.5, 1.4, 1.25], skyColor: [0.45, 0.55, 0.8],
    groundColor: [0.3, 0.28, 0.25], shadowColor: [0.45, 0.5, 0.78], rimColor: [1, 1, 1], fog: { density: 0.006, color: [0.8, 0.85, 0.95] },
    horizon: [0.8, 0.85, 0.95], aerial: [30, 160], grade: { exposure: 0, contrast: 1.04, saturation: 0.95, split: 0.1 }, ambient: { kind: 'petals', density: 0.25 },
    glow: [1.0, 0.95, 0.85], arena: 12, music: 'tense', rays: true, floor: [0.85, 0.83, 0.78, 28] }),
  apartment: S({ id: 'apartment', glb: 'stages/apartment.glb', sky: FIRE, sunDir: [0.2, 0.8, 0.5], sunColor: [1.1, 0.45, 0.2], skyColor: [0.2, 0.06, 0.04],
    groundColor: [0.1, 0.03, 0.02], shadowColor: [0.25, 0.08, 0.15], rimColor: [1.8, 0.7, 0.25], fog: { density: 0.04, color: [0.25, 0.07, 0.03] },
    horizon: [0.4, 0.1, 0.04], grade: { exposure: 0.25, contrast: 1.18, saturation: 1.1, temperature: 0.35, split: 0.35, bloom: 1.3, vignette: 0.6 },
    ambient: { kind: 'ash', density: 1 }, glow: [1.0, 0.4, 0.08], lamp: [0, 2.5, 0, 14, 1.0, 0.35, 0.08, 3], arena: 9, music: 'memory', floor: [0.35, 0.28, 0.24, 3] }),
  crossing: S({ id: 'crossing', glb: 'stages/crossing.glb', sky: CURSED, sunDir: [0.3, 0.35, 0.9], sunColor: [1.2, 0.3, 0.2], skyColor: [0.3, 0.05, 0.05],
    groundColor: [0.08, 0.02, 0.02], shadowColor: [0.3, 0.1, 0.2], rimColor: [1.6, 0.3, 0.2], fog: { density: 0.02, color: [0.3, 0.05, 0.04] },
    horizon: [0.5, 0.08, 0.05], grade: { exposure: 0.2, contrast: 1.15, saturation: 1.1, temperature: 0.1, split: 0.3, bloom: 1.0 }, ambient: { kind: 'embers', density: 0.6 },
    wet: 0.4, glow: [1.0, 0.3, 0.6], lamp: [0, 4, 0, 18, 1.0, 0.3, 0.15, 1.5], arena: 14, music: 'finale', floor: [0.3, 0.3, 0.32, 5] }),
  tower: S({ id: 'tower', glb: 'stages/crossing.glb', sky: CURSED, sunDir: [0.3, 0.35, 0.9], sunColor: [1.3, 0.25, 0.15], skyColor: [0.3, 0.03, 0.03],
    groundColor: [0.06, 0.01, 0.01], shadowColor: [0.3, 0.08, 0.18], rimColor: [1.8, 0.25, 0.2], fog: { density: 0.025, color: [0.35, 0.04, 0.03] },
    horizon: [0.6, 0.06, 0.04], grade: { exposure: 0.2, contrast: 1.2, saturation: 1.15, temperature: 0.15, split: 0.35, bloom: 1.1, vignette: 0.55 },
    ambient: { kind: 'embers', density: 1 }, glow: [1.0, 0.25, 0.1], lamp: [0, 4, 0, 18, 1.0, 0.25, 0.1, 2], arena: 14, music: 'finale', floor: [0.3, 0.28, 0.3, 5] }),
  graves: S({ id: 'graves', glb: 'stages/graves.glb', sky: SPRING, sunDir: [-0.5, 0.5, 0.6], sunColor: [1.5, 1.3, 1.1], skyColor: [0.5, 0.55, 0.8],
    groundColor: [0.3, 0.28, 0.26], shadowColor: [0.5, 0.48, 0.78], rimColor: [1.2, 1.0, 0.9], fog: { density: 0.007, color: [0.9, 0.85, 0.9] },
    horizon: [0.95, 0.85, 0.88], aerial: [25, 140], grade: { exposure: 0.15, contrast: 1.02, saturation: 1.08, temperature: 0.1, split: 0.12 },
    ambient: { kind: 'petals', density: 1 }, arena: 12, music: 'sad', rays: true, floor: [0.5, 0.55, 0.35, 12] }),
  void: S({ id: 'void', glb: null, sky: DUSK, sunDir: [-0.4, 0.6, -0.5], sunColor: [1.4, 1.0, 0.75], skyColor: [0.35, 0.38, 0.6],
    groundColor: [0.2, 0.16, 0.16], shadowColor: [0.45, 0.42, 0.75], rimColor: [1, 0.7, 0.5], fog: { density: 0.01, color: [0.6, 0.45, 0.45] },
    horizon: [1.0, 0.6, 0.45], arena: 14, music: 'battle', floor: [0.55, 0.5, 0.46, 14] }),
};

/** A loaded stage: scenery meshes with the environment shader, its light and atmosphere. */
export class Stage {
  readonly env = new EnvSettings();
  private nodes: TransformNode[] = [];
  private meshes: AbstractMesh[] = [];
  def: StageDef;

  constructor(private r: Renderer, def: StageDef) {
    this.def = def;
  }

  async load(): Promise<void> {
    const d = this.def;
    const r = this.r;
    let loaded = false;
    if (d.glb) {
      try {
        const c = await loadContainer(r.scene, d.glb);
        const inst = c.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
        for (const n of inst.rootNodes) this.nodes.push(n as TransformNode);
        for (const n of inst.rootNodes) {
          for (const m of n.getChildMeshes(false)) {
            if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue;
            m.material = envMaterial(r.mats, m, this.env);
            m.isPickable = false;
            r.shadow.addCaster(m);
            r.gbuffer.add(m);
            this.meshes.push(m);
          }
        }
        loaded = true;
      } catch (e) {
        console.warn('stage', d.glb, 'missing, using a plain floor', e);
      }
    }
    if (!loaded) this.fallback();
    this.apply();
  }

  private fallback(): void {
    const r = this.r;
    const f = this.def.floor ?? [0.5, 0.5, 0.5, 14];
    const g = MeshBuilder.CreateDisc('floor', { radius: 40, tessellation: 64 }, r.scene);
    g.rotation.x = Math.PI / 2;
    g.bakeCurrentTransformIntoVertices();
    const n = g.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) cols.set([f[0], f[1], f[2], f[3] / 32], i * 4);
    g.setVerticesData(VertexBuffer.ColorKind, cols);
    g.material = envMaterial(r.mats, g, this.env);
    r.shadow.addCaster(g);
    r.gbuffer.add(g);
    this.meshes.push(g);
  }

  /** Lighting, sky, fog and grading for this stage. */
  apply(): void {
    const d = this.def;
    const r = this.r;
    const L = r.lighting;
    const v3 = (a: [number, number, number]) => new Vector3(a[0], a[1], a[2]);
    const c3 = (a: [number, number, number]) => new Color3(a[0], a[1], a[2]);
    L.sunDir = v3(d.sunDir).normalize();
    L.sunColor = c3(d.sunColor);
    L.skyColor = c3(d.skyColor);
    L.groundColor = c3(d.groundColor);
    L.shadowColor = c3(d.shadowColor);
    L.rimColor = c3(d.rimColor);
    L.wetness = d.wet ?? 0;
    L.clearPoints();
    if (d.lamp) {
      const l = d.lamp;
      L.setPoint(0, new Vector3(l[0], l[1], l[2]), l[3], new Color3(l[4], l[5], l[6]), l[7]);
    }
    r.sky.mood = d.sky;
    const s = r.post.settings;
    s.fogDensity = d.fog.density;
    s.fogColor = c3(d.fog.color);
    s.fogFalloff = d.fog.falloff ?? 0.15;
    s.fogBase = d.fog.base ?? 0;
    s.horizonColor = c3(d.horizon);
    s.aerialStart = d.aerial?.[0] ?? 18;
    s.aerialEnd = d.aerial?.[1] ?? 110;
    const g = d.grade ?? {};
    s.exposure = g.exposure ?? 0;
    s.contrast = g.contrast ?? 1.06;
    s.saturation = g.saturation ?? 1.05;
    s.temperature = g.temperature ?? 0;
    s.tint = g.tint ?? 0;
    s.splitStrength = g.split ?? 0.15;
    s.bloomIntensity = g.bloom ?? 0.55;
    s.vignette = g.vignette ?? 0.38;
    s.raysOn = !!d.rays;
    s.raysSource = null;
    this.env.wetness = d.wet ?? 0;
    this.env.hatching = d.hatching ?? 0.4;
    if (d.glow) this.env.glowColor = c3(d.glow);
    r.shadow.extent = Math.max(12, d.arena + 4);
  }

  /** Pass the combat world's floor cracks to the environment shader. */
  setCracks(list: { x: number; z: number; r: number; pal: number; t: number }[]): void {
    this.env.cracks.fill(-1);
    list.slice(-8).forEach((c, i) => this.env.cracks.set([c.x, c.z, c.r * Math.min(1, c.t), c.pal], i * 4));
  }

  dispose(): void {
    // materials go, but never their textures: the shadow map is shared by every material
    for (const m of this.meshes) {
      m.material?.dispose(false, false);
      m.dispose(false, false);
    }
    for (const n of this.nodes) n.dispose(false, false);
    this.meshes = [];
    this.nodes = [];
  }
}
