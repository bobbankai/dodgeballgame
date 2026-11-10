// A fighter's body in the scene: the loaded model, its clips played as a pure function of time (so a hit
// lands on the frame the rules say it does, and hit-stop and slow motion are exact), its face and its hair.
import {
  AnimationGroup, AssetContainer, LoadAssetContainerAsync, MorphTarget, Quaternion, TransformNode, Vector3,
} from '@babylonjs/core';
import { Gfx } from '../engine/gfx';
import { applyLibrary, plugin } from '../engine/matlib';
import { SurfacePlugin } from '../engine/surface';

export interface Hit { t: number; bone: string; reach: number; z: number }
export interface ClipMeta { dur: number; loop: boolean; hits: Hit[]; speed?: number }
export interface CharMeta { name: string; scale: number; height: number; eye: number; chest: number; clips: Record<string, ClipMeta> }

interface Layer { g: AnimationGroup; w: number; t: number; meta: ClipMeta; out: number }

export type Emotion = 'neutral' | 'focus' | 'angry' | 'pain' | 'sad' | 'soft' | 'smile' | 'shock' | 'effort' | 'out' | 'cry';
const FACES: Record<Emotion, Record<string, number>> = {
  neutral: { squint: 0.12 },
  focus: { browDown: 0.45, squint: 0.22, press: 0.3 },
  angry: { browDown: 0.9, sneer: 0.45, grit: 0.35, squint: 0.2 },
  pain: { squint: 0.75, grit: 0.85, browSad: 0.5, sneer: 0.3 },
  sad: { browSad: 0.9, frown: 0.55, squint: 0.2 },
  soft: { browSad: 0.35, smile: 0.2, squint: 0.2 },
  smile: { smile: 0.75, squint: 0.3 },
  shock: { wide: 0.8, browUp: 0.7, open: 0.3 },
  effort: { browDown: 0.7, grit: 0.7, squint: 0.3 },
  out: { blink: 1, open: 0.18, browSad: 0.2 },
  cry: { browSad: 1, frown: 0.7, squint: 0.55, grit: 0.25 },
};

export class Model {
  root: TransformNode;
  nodes = new Map<string, TransformNode>();
  plugins: SurfacePlugin[] = [];
  /** seconds the clip clock is frozen (hit-stop) */ hold = 0;
  emotion: Emotion = 'neutral';
  /** 0..1 mouth movement while a line is spoken */ talk = 0;
  private clips = new Map<string, AnimationGroup>();
  private layers: Layer[] = [];
  private morphs = new Map<string, MorphTarget[]>();
  private face: Record<string, number> = {};
  private blink = 2;
  private chain: { nodes: TransformNode[]; pts: Vector3[]; vel: Vector3[]; len: number[] } | null = null;

  private constructor(public g: Gfx, private c: AssetContainer, public meta: CharMeta) {
    this.root = new TransformNode('fighter_' + meta.name, g.scene);
    for (const n of c.rootNodes) n.parent = this.root;
    for (const t of c.transformNodes) this.nodes.set(t.name, t);
    for (const a of c.animationGroups) { a.stop(); this.clips.set(a.name, a); }
    for (const m of c.meshes) {
      m.alwaysSelectAsActiveMesh = true; // skinned: the rest-pose bounds say nothing about where it is
      m.receiveShadows = true;
      g.shadow.addShadowCaster(m);
      const mm = m.morphTargetManager;
      for (let i = 0; mm && i < mm.numTargets; i++) {
        const t = mm.getTarget(i);
        (this.morphs.get(t.name) ?? this.morphs.set(t.name, []).get(t.name)!).push(t);
      }
      const p = m.material && plugin(m.material);
      if (p && !this.plugins.includes(p)) this.plugins.push(p);
    }
    const braid = [...this.nodes.keys()].filter((n) => n.startsWith('braid.')).sort().map((n) => this.nodes.get(n)!);
    if (braid.length) this.chain = { nodes: braid, pts: [], vel: [], len: [] };
  }

  static async load(g: Gfx, name: string): Promise<Model> {
    const [c, meta] = await Promise.all([
      LoadAssetContainerAsync(`assets/chars/${name}.glb`, g.scene),
      fetch(`assets/chars/${name}.json`).then((r) => r.json() as Promise<CharMeta>),
    ]);
    applyLibrary(c, g.scene);
    c.addAllToScene();
    return new Model(g, c, meta);
  }

  dispose() {
    for (const l of this.layers) l.g.stop();
    this.c.dispose();
    this.root.dispose();
  }

  clip(name: string): ClipMeta { return this.meta.clips[name]; }
  get current(): string { return this.layers[this.layers.length - 1]?.g.name ?? ''; }
  get time(): number { return this.layers[this.layers.length - 1]?.t ?? 0; }

  /** Cross-fade to a clip. Playing the clip that is already on top restarts it only when asked. */
  play(name: string, fade = 0.1, at = 0, restart = true) {
    const g = this.clips.get(name);
    if (!g) throw new Error(`${this.meta.name} has no clip ${name}`);
    const top = this.layers[this.layers.length - 1];
    if (top && top.g === g) { if (restart) top.t = at; return; }
    const old = this.layers.findIndex((l) => l.g === g);
    if (old >= 0) this.layers.splice(old, 1);
    else { g.start(false, 1, g.from, g.to); g.pause(); }
    for (const l of this.layers) l.out = fade;
    this.layers.push({ g, w: this.layers.length ? 0 : 1, t: at, meta: this.meta.clips[name], out: -1 });
    this.fade = fade;
  }
  private fade = 0.1;

  /** dt in game seconds (already scaled by slow motion). */
  update(dt: number, wall: number) {
    if (this.hold > 0) { this.hold -= wall; dt = 0; }
    const top = this.layers[this.layers.length - 1];
    if (top) {
      top.t += dt;
      const k = this.fade > 0 ? Math.min(1, wall / this.fade) : 1;
      let rest = 0;
      for (const l of this.layers) if (l !== top) { l.w *= 1 - k; if (l.w < 0.01) l.w = 0; rest += l.w; }
      top.w = 1 - rest;
      for (let i = this.layers.length - 2; i >= 0; i--) if (this.layers[i].w === 0) { this.layers[i].g.stop(); this.layers.splice(i, 1); }
    }
    this.updateFace(wall);
  }

  /** Pose the skeleton from the layers. Must run once per drawn frame, just before the scene animates: the engine
   *  sums weighted poses per frame, and posing twice between two frames would count everything twice. */
  apply() {
    for (const l of this.layers) {
      const t = l.meta.loop ? l.t % l.meta.dur : Math.min(l.t, l.meta.dur);
      l.g.setWeightForAllAnimatables(l.w);
      l.g.goToFrame(l.g.from + t * 60, true);
    }
  }

  /** world position of a bone as of the last rendered frame */
  bone(name: string): Vector3 {
    const n = this.nodes.get(name);
    return n ? n.getAbsolutePosition() : this.root.position;
  }

  set flash(v: number) { for (const p of this.plugins) p.flash = v; }
  set damage(v: number) { for (const p of this.plugins) p.damage = v; }

  private updateFace(dt: number) {
    const want = FACES[this.emotion];
    this.blink -= dt;
    if (this.blink < -0.13) this.blink = 1.5 + Math.random() * 3.5;
    const lid = this.blink < 0 ? Math.sin((-this.blink / 0.13) * Math.PI) : 0;
    const mouth = this.talk > 0 ? this.talk * (0.25 + 0.3 * Math.abs(Math.sin(performance.now() * 0.019)) * Math.abs(Math.sin(performance.now() * 0.0071))) : 0;
    for (const [name, ts] of this.morphs) {
      let v = want[name] ?? 0;
      if (name === 'blink') v = Math.max(v, lid);
      if (name === 'open') v = Math.max(v, mouth);
      const cur = this.face[name] ?? 0;
      const nv = cur + (v - cur) * Math.min(1, dt * (name === 'blink' ? 40 : 9));
      this.face[name] = nv;
      for (const t of ts) t.influence = nv;
    }
  }

  /** Hair on a bone chain swings behind the head: verlet points pulled back to the posed chain. Call after animations. */
  swing(dt: number) {
    const ch = this.chain;
    if (!ch || dt <= 0) return;
    const n = ch.nodes.length;
    if (!ch.pts.length) {
      for (let i = 0; i < n; i++) { ch.nodes[i].rotationQuaternion ??= Quaternion.Identity(); ch.pts.push(ch.nodes[i].getAbsolutePosition().clone()); ch.vel.push(Vector3.Zero()); }
      for (let i = 0; i < n - 1; i++) ch.len.push(Vector3.Distance(ch.pts[i], ch.pts[i + 1]));
      return;
    }
    const rootPos = ch.nodes[0].getAbsolutePosition();
    ch.pts[0].copyFrom(rootPos);
    const s = this.root.scaling.z < 0 ? -1 : 1;
    for (let i = 1; i < n; i++) {
      const p = ch.pts[i], v = ch.vel[i];
      v.scaleInPlace(Math.max(0, 1 - 3.2 * dt));
      v.y -= 9.0 * dt;
      p.addInPlace(v.scale(dt));
      const d = p.subtract(ch.pts[i - 1]);
      const L = d.length() || 1e-4;
      const fixed = ch.pts[i - 1].add(d.scale(ch.len[i - 1] / L));
      v.addInPlace(fixed.subtract(p).scale(1 / Math.max(dt, 1e-3)));
      p.copyFrom(fixed);
      // keep it off the back: nothing may pass in front of the spine line
      const spine = this.bone('spine02');
      const fwd = this.root.getDirection(new Vector3(0, 0, 1)).scale(s);
      const depth = Vector3.Dot(p.subtract(spine), fwd);
      if (depth > -0.11 && p.y < this.bone('neck01').y) p.addInPlace(fwd.scale(-0.11 - depth));
    }
    for (let i = 0; i < n - 1; i++) {
      const node = ch.nodes[i];
      const parent = node.parent as TransformNode;
      const inv = parent.getWorldMatrix().clone().invert();
      const a = Vector3.TransformCoordinates(ch.pts[i], inv), b = Vector3.TransformCoordinates(ch.pts[i + 1], inv);
      const dir = b.subtract(a).normalize();
      // glTF bones point along +Y
      Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, dir, node.rotationQuaternion!);
      node.computeWorldMatrix(true);
    }
  }
}
