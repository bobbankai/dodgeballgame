// A rigged character: mesh + skeleton + materials + weapon sockets + face + animator.
import * as THREE from 'three';
import { FootIK, type GroundProbe } from '../anim/IK';
import { loadGLTF, loadGLTFShared } from '../core/Assets';
import { Animator, ClipLib, ClipMeta, groundClips, prepareLibrary } from './Animator';
import { setupCharacterMaterial } from './Materials';
import type { Pipeline } from '../render/Pipeline';
import { setFX } from '../render/MaterialFX';

let libPromise: Promise<ClipLib> | null = null;
export function clipLibrary(): Promise<ClipLib> {
  libPromise ??= (async () => {
    const [g, meta] = await Promise.all([
      loadGLTFShared('assets/anims/human.glb'),
      fetch('assets/anims/human.json').then((r) => r.json() as Promise<Record<string, ClipMeta>>),
    ]);
    const lib = prepareLibrary(g.animations, meta);
    // put every clip's feet on the floor (retargeted clips key the pelvis at the source actor's height)
    const shifted = groundClips(g.scene, lib.clips.values());
    if (shifted.size) console.info('grounded clips', Object.fromEntries([...shifted].map(([k, d]) => [k, +d.toFixed(2)])));
    return lib;
  })();
  return libPromise;
}

export const EXPRESSIONS: Record<string, Record<string, number>> = {
  neutral: {},
  calm: { squint_L: 0.1, squint_R: 0.1, press: 0.1 },
  determined: { browDown_L: 0.45, browDown_R: 0.45, press: 0.35, squint_L: 0.2, squint_R: 0.2 },
  fierce: { browDown_L: 0.8, browDown_R: 0.8, squint_L: 0.35, squint_R: 0.35, press: 0.5, sneer_L: 0.15, sneer_R: 0.15 },
  angry: { browDown_L: 0.9, browDown_R: 0.9, snarl: 0.35, squint_L: 0.4, squint_R: 0.4, sneer_L: 0.2, sneer_R: 0.2 },
  sad: { browInner_L: 0.8, browInner_R: 0.8, frown: 0.45, squint_L: 0.15, squint_R: 0.15 },
  grief: { browInner_L: 1, browInner_R: 1, frown: 0.7, squint_L: 0.5, squint_R: 0.5, stretch: 0.25, lipsPart: 0.3 },
  worried: { browInner_L: 0.65, browInner_R: 0.65, browUp_L: 0.2, browUp_R: 0.2, press: 0.3, wide_L: 0.15, wide_R: 0.15 },
  surprised: { browUp_L: 0.8, browUp_R: 0.8, wide_L: 0.6, wide_R: 0.6, jawOpen: 0.25 },
  fear: { browInner_L: 0.8, browInner_R: 0.8, browUp_L: 0.5, browUp_R: 0.5, wide_L: 0.7, wide_R: 0.7, stretch: 0.5, lipsPart: 0.4 },
  smile: { smile: 0.65, squint_L: 0.25, squint_R: 0.25, browUp_L: 0.15, browUp_R: 0.15 },
  warm: { smile: 0.35, squint_L: 0.15, squint_R: 0.15, browInner_L: 0.15, browInner_R: 0.15 },
  relief: { smile: 0.3, browInner_L: 0.4, browInner_R: 0.4, lipsPart: 0.2 },
  smirk: { smile: 0.4, sneer_L: 0.25, browDown_R: 0.3, squint_L: 0.2 },
  pain: { browInner_L: 0.7, browInner_R: 0.7, squint_L: 0.7, squint_R: 0.7, stretch: 0.5, jawOpen: 0.2 },
  shout: { browDown_L: 0.7, browDown_R: 0.7, jawOpen: 0.75, stretch: 0.3, squint_L: 0.3, squint_R: 0.3 },
  effort: { browDown_L: 0.6, browDown_R: 0.6, press: 0.6, squint_L: 0.5, squint_R: 0.5, snarl: 0.2 },
};

/** guess an emotion from a line of dialogue when the script doesn't give one */
export function inferEmotion(text: string): string {
  const t = text.toLowerCase();
  if (/[!]{1}/.test(t) && /(run|now|behind|watch out|hurry|move)/.test(t)) return 'fear';
  if (/(why|how could|traitor|you did this|monster)/.test(t)) return 'angry';
  if (/(sorry|forgive|gone|dead|lost|miss|never again|mother|father)/.test(t)) return 'sad';
  if (/(thank|safe|home|we did it|well done|smile)/.test(t)) return 'warm';
  if (/[?]$/.test(t)) return 'worried';
  if (/[!]$/.test(t)) return 'determined';
  return 'calm';
}

export class Face {
  private meshes: THREE.Mesh[] = [];
  /** base mood + a transient flash (pain on a hit, effort on a strike) */
  private mood: Record<string, number> = {};
  private flashExpr: Record<string, number> = {};
  private flashT = 0;
  private flashDur = 0;
  private cur: Record<string, number> = {};
  private blinkT = 2;
  private blink = 0;
  talk = 0;
  private talkPhase = 0;
  autoBlink = true;
  moodName = 'neutral';

  constructor(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && Object.keys(m.morphTargetDictionary).length) this.meshes.push(m);
    });
  }

  /** the lasting mood (dialogue emotion, combat focus) */
  set(expr: string, k = 1): void {
    this.moodName = expr;
    const e = EXPRESSIONS[expr] ?? {};
    this.mood = {};
    for (const [n, v] of Object.entries(e)) this.mood[n] = v * k;
  }

  /** a short reaction on top of the mood */
  react(expr: string, dur = 0.6, k = 1): void {
    const e = EXPRESSIONS[expr] ?? {};
    this.flashExpr = {};
    for (const [n, v] of Object.entries(e)) this.flashExpr[n] = v * k;
    this.flashT = dur;
    this.flashDur = dur;
  }

  /** trigger a blink (big gaze shifts) */
  blinkNow(): void { if (this.blink <= 0) this.blink = 1; }

  update(dt: number): void {
    if (!this.meshes.length) return;
    if (this.autoBlink) {
      this.blinkT -= dt;
      if (this.blinkT <= 0) { this.blink = 1; this.blinkT = 2.2 + Math.random() * 3.5; }
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const bl = this.blink > 0.5 ? (1 - this.blink) * 2 : this.blink * 2;
    this.flashT = Math.max(0, this.flashT - dt);
    const fk = this.flashDur > 0 ? Math.sin(Math.min(1, this.flashT / this.flashDur) * Math.PI * 0.5) : 0;
    const k = Math.min(1, dt * 10);
    const names = new Set([...Object.keys(this.cur), ...Object.keys(this.mood), ...Object.keys(this.flashExpr), 'blink_L', 'blink_R', 'jawOpen', 'lipsPart']);
    this.talkPhase += dt * 11;
    const talkJaw = this.talk * (0.18 + 0.18 * Math.abs(Math.sin(this.talkPhase) * Math.sin(this.talkPhase * 0.37 + 1)));
    for (const n of names) {
      let t = (this.mood[n] ?? 0) * (1 - fk) + Math.max(this.mood[n] ?? 0, this.flashExpr[n] ?? 0) * fk;
      if (n === 'blink_L' || n === 'blink_R') t = Math.max(t, bl);
      if (n === 'jawOpen') t = Math.max(t, talkJaw);
      if (n === 'lipsPart') t = Math.max(t, this.talk * 0.4);
      const c = this.cur[n] ?? 0;
      this.cur[n] = n.startsWith('blink') ? t : c + (t - c) * k;
    }
    for (const m of this.meshes) {
      const d = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      for (const [n, v] of Object.entries(this.cur)) {
        const i = d[n];
        if (i !== undefined) inf[i] = v;
      }
    }
  }
}

/** procedural gaze: eyes lead, the head follows (clamped, damped), saccades keep the eyes alive */
export class Gaze {
  target: THREE.Vector3 | null = null;
  /** 0 = eyes only, 1 = head turns fully */
  headWeight = 0.6;
  enabled = true;
  private eyes: THREE.Bone[] = [];
  private eyeRest: THREE.Quaternion[] = [];
  private neck: THREE.Bone | null;
  private head: THREE.Bone | null;
  private base = new Map<THREE.Bone, THREE.Quaternion>();
  private yaw = 0;
  private pitch = 0;
  private sacc = new THREE.Vector2();
  private saccT = 1;
  private prevTarget = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  constructor(bones: Map<string, THREE.Bone>, private face: Face) {
    for (const n of ['eye_l', 'eye_r']) { const b = bones.get(n); if (b) { this.eyes.push(b); this.eyeRest.push(b.quaternion.clone()); } }
    this.neck = bones.get('neck_01') ?? null;
    this.head = bones.get('head') ?? null;
  }

  /** restore the animated pose before the mixer runs (it only writes values that changed) */
  restore(): void {
    for (const [b, q] of this.base) b.quaternion.copy(q);
  }

  /** remember the animated pose right after the mixer ran */
  capture(): void {
    for (const b of [this.neck, this.head]) if (b) this.base.set(b, b.quaternion.clone());
  }

  apply(dt: number, root: THREE.Object3D): void {
    if (!this.head) return;
    let wantYaw = 0, wantPitch = 0;
    if (this.enabled && this.target) {
      const hp = this.head.getWorldPosition(new THREE.Vector3());
      const to = this.target.clone().sub(hp);
      const inv = new THREE.Quaternion();
      root.getWorldQuaternion(inv).invert();
      to.applyQuaternion(inv);
      wantYaw = THREE.MathUtils.clamp(Math.atan2(to.x, to.z), -1.4, 1.4);
      wantPitch = THREE.MathUtils.clamp(Math.atan2(to.y, Math.hypot(to.x, to.z)), -0.6, 0.5);
      if (Math.abs(wantYaw) > 1.35) wantYaw = 0; // behind: don't break the neck
      if (this.target.distanceToSquared(this.prevTarget) > 4) this.face.blinkNow();
      this.prevTarget.copy(this.target);
    }
    const k = 1 - Math.exp(-dt * 5);
    this.yaw += (wantYaw - this.yaw) * k;
    this.pitch += (wantPitch - this.pitch) * k;
    const hy = this.yaw * this.headWeight, hpch = this.pitch * this.headWeight;
    // neck takes 40%, head 60% of the head turn (rotation about character up / right)
    for (const [b, w] of [[this.neck, 0.4], [this.head, 0.6]] as [THREE.Bone | null, number][]) {
      if (!b) continue;
      const parentQ = new THREE.Quaternion();
      b.parent!.getWorldQuaternion(parentQ);
      const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hy * w);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -hpch * w);
      // rotation expressed in character space, converted into the bone's parent space
      const charRot = qYaw.multiply(qPitch);
      const toParent = parentQ.clone().invert().multiply(rootQ);
      const local = toParent.clone().multiply(charRot).multiply(toParent.clone().invert());
      b.quaternion.premultiply(local);
    }
    // eyes: remaining angle + saccades
    this.saccT -= dt;
    if (this.saccT <= 0) {
      this.saccT = 0.4 + Math.random() * 1.8;
      this.sacc.set((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.05);
    }
    const ey = THREE.MathUtils.clamp(this.yaw - hy, -0.45, 0.45) + this.sacc.x;
    const ep = THREE.MathUtils.clamp(this.pitch - hpch, -0.3, 0.3) + this.sacc.y;
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    this.eyes.forEach((e, i) => {
      e.quaternion.copy(this.eyeRest[i]);
      const parentQ = e.parent!.getWorldQuaternion(new THREE.Quaternion());
      const charRot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ey)
        .multiply(this.tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -ep));
      const toParent = parentQ.invert().multiply(rootQ);
      e.quaternion.premultiply(toParent.clone().multiply(charRot).multiply(toParent.clone().invert()));
    });
  }
}

export interface CharacterOptions {
  url: string;
  scale?: number;
  weapon?: string | null;
  sheathed?: boolean;
}

export class Character {
  readonly root = new THREE.Group();
  model!: THREE.Group;
  animator!: Animator;
  face!: Face;
  gaze!: Gaze;
  bones = new Map<string, THREE.Bone>();
  sockets = new Map<string, THREE.Object3D>();
  weapon: THREE.Object3D | null = null;
  scabbard: THREE.Object3D | null = null;
  bladeBase: THREE.Object3D | null = null;
  bladeTip: THREE.Object3D | null = null;
  height = 1.7;
  private hitFlash = 0;
  /** feet planted on the real ground (stairs, slopes), when enabled */
  ik: FootIK | null = null;

  /** plant this character's feet on the ground the probe reports */
  enableFootIK(probe: GroundProbe): FootIK | null {
    const ik = new FootIK(this.bones, probe);
    this.ik = ik.ready ? ik : null;
    return this.ik;
  }

  static async load(pipe: Pipeline, opts: CharacterOptions): Promise<Character> {
    const c = new Character();
    const [g, lib] = await Promise.all([loadGLTF(opts.url), clipLibrary()]);
    c.model = g.scene;
    c.root.add(c.model);
    if (opts.scale) c.model.scale.setScalar(opts.scale);
    const msaa = pipe.quality.msaa > 0;
    c.model.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) c.bones.set(b.name, b);
      if (o.name.startsWith('socket_')) c.sockets.set(o.name, o);
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isMesh) {
        mesh.frustumCulled = false; // skinned bounds are unreliable; characters are few
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const out = mats.map((m0) => {
          const m = m0.clone(); // per-instance: hit flash / dissolve are per character
          const r = setupCharacterMaterial(m, msaa);
          pipe.patch(r.mat, r.fx);
          return r.mat;
        });
        mesh.material = Array.isArray(mesh.material) ? out : out[0];
        mesh.castShadow = (out[0] as THREE.Material).name !== 'cornea';
        mesh.receiveShadow = true;
      }
    });
    c.animator = new Animator(c.model, lib);
    c.face = new Face(c.model);
    c.gaze = new Gaze(c.bones, c.face);
    const head = c.bones.get('head');
    if (head) {
      c.model.updateMatrixWorld(true);
      c.height = head.getWorldPosition(new THREE.Vector3()).y + 0.12;
    }
    if (opts.weapon) await c.equip(pipe, opts.weapon, opts.sheathed ?? false);
    return c;
  }

  async equip(pipe: Pipeline, weapon: string, sheathed: boolean): Promise<void> {
    const g = await loadGLTF(`assets/weapons/${weapon}.glb`);
    this.weapon = g.scene;
    pipe.prepare(this.weapon, () => ({ hit: true }));
    this.weapon.traverse((o) => {
      if (o.name === 'blade_base') this.bladeBase = o;
      if (o.name === 'blade_tip') this.bladeTip = o;
    });
    if (weapon === 'katana') {
      const s = await loadGLTF('assets/weapons/saya.glb');
      this.scabbard = s.scene;
      pipe.prepare(this.scabbard);
      this.sockets.get('socket_hip')?.add(this.scabbard);
    }
    this.holster(sheathed);
  }

  offhand: THREE.Object3D | null = null;

  async equipOffhand(pipe: Pipeline, weapon: string): Promise<void> {
    const g = await loadGLTF(`assets/weapons/${weapon}.glb`);
    this.offhand = g.scene;
    pipe.prepare(this.offhand, () => ({ hit: true }));
    this.sockets.get('socket_l')?.add(this.offhand);
  }

  holster(sheathed: boolean): void {
    if (!this.weapon) return;
    const s = this.sockets.get(sheathed && this.scabbard ? 'socket_hip' : 'socket_r');
    s?.add(this.weapon);
  }

  flash(k = 1): void { this.hitFlash = Math.max(this.hitFlash, k); }

  update(dt: number): void {
    this.gaze.restore();
    this.ik?.restore();
    this.animator.update(dt);
    this.gaze.capture();
    this.ik?.capture();
    this.root.updateMatrixWorld(true);
    this.gaze.apply(dt, this.root);
    this.ik?.apply(dt, this.root);
    this.face.update(dt);
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
      setFX(this.model, 'uHit', this.hitFlash);
    }
  }

  bonePos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.bones.get(name);
    return b ? b.getWorldPosition(out) : out.copy(this.root.position);
  }
}
