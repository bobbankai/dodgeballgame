// Strike trails: while a fighter is attacking, the fastest-moving striking point (a weapon's blade, or a
// fist / foot) leaves an arc behind it for a fraction of a second. One dynamic ribbon mesh holds every trail
// in the scene and is rebuilt each frame (tbTrail.wgsl). Only the active part of an attack (just before its
// first hit to just after its last) draws, so idle swings and walking never smear.
import { Mesh, VertexData, ShaderMaterial, ShaderLanguage, Constants, Vector3 } from '@babylonjs/core';
import type { TransformNode } from '@babylonjs/core';
import type { Renderer } from './Renderer';

/** blade length (m, along the prop's +Y from the grip) for weapons that leave a trail */
const BLADE: Record<string, [number, number]> = {
  cutlass: [0.25, 0.78], sabre_gold: [0.25, 0.86], hookblade: [0.2, 0.6], halberd: [1.1, 1.9], harpoon: [1.0, 1.85],
  club: [0.25, 0.6], mace: [0.3, 0.72], boathook: [0.9, 1.6], ladle: [0.35, 0.75], cane: [0.4, 0.9], rifle: [0.6, 1.0],
};
const LIMBS = ['hand.L', 'hand.R', 'foot.L', 'foot.R'];
const LIFE = 0.16;
const MAX_SAMPLES = 1500;

export interface TrailFighter {
  model: { bones: Map<string, TransformNode>; props: TransformNode[] };
  state: string;
  attack: { hit: number[]; id: string } | null;
  attackT: number;
  team: string;
  alive: boolean;
}

interface Sample { a: Vector3; b: Vector3; age: number }
interface Trail { samples: Sample[]; color: [number, number, number]; key: string }

export class Trails {
  private mesh: Mesh;
  private mat: ShaderMaterial;
  private trails = new Map<TrailFighter, Trail>();
  private prev = new Map<TrailFighter, Map<string, Vector3>>();
  private empty = true;

  constructor(readonly r: Renderer) {
    this.mesh = new Mesh('trails', r.scene);
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    vd.uvs = [0, 0, 0, 0, 0, 0];
    vd.colors = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    vd.indices = [0, 1, 2];
    vd.applyToMesh(this.mesh, true);
    const m = new ShaderMaterial('trailMat', r.scene, { vertex: 'tbTrail', fragment: 'tbTrail' }, {
      attributes: ['position', 'uv', 'color'], uniforms: ['viewProjection'], uniformBuffers: ['globals'],
      shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    m.setUniformBuffer('globals', r.globals.ubo);
    m.alphaMode = Constants.ALPHA_ONEONE;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    this.mesh.material = m;
    this.mesh.hasVertexAlpha = true;
    this.mat = m;
    this.mesh.setEnabled(false);
  }

  /** The striking segments a fighter has: its weapon blades, or its fists and feet. */
  private points(f: TrailFighter): Map<string, [Vector3, Vector3]> {
    const out = new Map<string, [Vector3, Vector3]>();
    for (const p of f.model.props) {
      const piece = p.name.split('@')[0];
      const bl = BLADE[piece];
      if (!bl) continue;
      p.computeWorldMatrix(true);
      const m = p.getWorldMatrix();
      out.set(piece, [Vector3.TransformCoordinates(new Vector3(0, bl[0], 0), m), Vector3.TransformCoordinates(new Vector3(0, bl[1], 0), m)]);
    }
    if (out.size) return out;
    for (const b of LIMBS) {
      const n = f.model.bones.get(b);
      if (!n) continue;
      n.computeWorldMatrix(true);
      const p = n.getAbsolutePosition().clone();
      out.set(b, [p, p]);
    }
    return out;
  }

  update(dt: number, fighters: TrailFighter[], camPos: Vector3): void {
    if (dt <= 0) return;
    for (const f of fighters) {
      const a = f.attack;
      const active = f.alive && f.state === 'attack' && a && a.hit.length > 0 &&
        f.attackT >= a.hit[0] - 0.14 && f.attackT <= a.hit[a.hit.length - 1] + 0.06;
      if (!active && !this.trails.has(f)) { this.prev.delete(f); continue; }
      const pts = this.points(f);
      const prev = this.prev.get(f) ?? new Map<string, Vector3>();
      let best: string | null = null, bestV = 0;
      for (const [k, [, tip]] of pts) {
        const q = prev.get(k);
        if (q) {
          const v = Vector3.Distance(tip, q) / dt;
          if (v > bestV) { bestV = v; best = k; }
        }
        prev.set(k, tip.clone());
      }
      this.prev.set(f, prev);
      let tr = this.trails.get(f);
      if (active && best && bestV > (pts.get(best)![0] === pts.get(best)![1] ? 4.0 : 3.0)) {
        const color: [number, number, number] = f.team === 'player' ? [0.5, 1.5, 2.6] : f.team === 'ally' ? [0.6, 2.2, 1.4] : [2.6, 0.7, 0.4];
        if (!tr || tr.key !== best) { tr = { samples: tr?.samples ?? [], color, key: best }; this.trails.set(f, tr); }
        const [base, tip] = pts.get(best)!;
        let A = base, B = tip;
        if (base === tip) {
          // a fist or foot: a band across the direction of travel, facing the camera
          const vel = tip.subtract(prev.get(best) ?? tip);
          const toCam = camPos.subtract(tip).normalize();
          let side = Vector3.Cross(vel, toCam);
          if (side.lengthSquared() < 1e-8) side = new Vector3(0, 1, 0);
          side.normalize();
          A = tip.subtract(side.scale(0.13));
          B = tip.add(side.scale(0.13));
        }
        tr.samples.unshift({ a: A.clone(), b: B.clone(), age: 0 });
      }
      if (tr) {
        for (const s of tr.samples) s.age += dt;
        tr.samples = tr.samples.filter((s) => s.age < LIFE).slice(0, 40);
        if (!tr.samples.length) this.trails.delete(f);
      }
    }
    for (const f of [...this.trails.keys()]) if (!fighters.includes(f)) this.trails.delete(f);
    this.rebuild();
  }

  private rebuild(): void {
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    let n = 0;
    for (const tr of this.trails.values()) {
      if (tr.samples.length < 2) continue;
      const base = pos.length / 3;
      for (const s of tr.samples) {
        if (n >= MAX_SAMPLES) break;
        const u = s.age / LIFE;
        pos.push(s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z);
        uv.push(u, 0, u, 1);
        for (let k = 0; k < 2; k++) col.push(tr.color[0], tr.color[1], tr.color[2], 1);
        n++;
      }
      const cnt = (pos.length / 3 - base) / 2;
      for (let i = 0; i < cnt - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    if (!idx.length) {
      if (!this.empty) { this.mesh.setEnabled(false); this.empty = true; }
      return;
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uv;
    vd.colors = col;
    vd.indices = idx;
    vd.applyToMesh(this.mesh, true);
    if (this.empty) { this.mesh.setEnabled(true); this.empty = false; }
  }

  clear(): void { this.trails.clear(); this.prev.clear(); this.rebuild(); }

  dispose(): void { this.mesh.dispose(); this.mat.dispose(); }
}
