import * as THREE from 'three';

/** What a face can show. Lines of dialogue carry one (or have one inferred from their words). */
export type Emotion =
  | 'neutral' | 'happy' | 'joy' | 'tender' | 'sad' | 'worried' | 'scared'
  | 'surprised' | 'wonder' | 'angry' | 'determined' | 'curious';

/**
 * One expression as a handful of controls: brows up/down and tilted (inner end up for sad, down for
 * cross), eyes narrowed or wide and tilted (outer corners down for sad), mouth corners up or down,
 * narrower (an "o") or wider, and how far the mouth rests open.
 */
interface Pose {
  brow: number;
  browTilt: number;
  lid: number;
  eyeTilt: number;
  corner: number;
  width: number;
  open: number;
}

const P = (brow: number, browTilt: number, lid: number, eyeTilt: number, corner: number, width: number, open: number): Pose =>
  ({ brow, browTilt, lid, eyeTilt, corner, width, open });

const POSES: Record<Emotion, Pose> = {
  //              brow  tilt   lid   eyeT  corner width open
  neutral:    P(0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0),
  happy:      P(0.3, 0.15, 0.86, 0.0, 1.0, 0.25, 0.08),
  joy:        P(0.55, 0.25, 0.55, 0.0, 1.35, 0.45, 0.5),
  tender:     P(0.2, 0.55, 0.8, 0.04, 0.6, 0.1, 0.0),
  sad:        P(-0.1, 1.0, 0.8, 0.1, -0.85, -0.1, 0.0),
  worried:    P(0.35, 0.9, 1.04, 0.04, -0.45, -0.15, 0.08),
  scared:     P(0.9, 0.85, 1.22, 0.0, -0.6, -0.25, 0.35),
  surprised:  P(1.0, 0.15, 1.2, 0.0, 0.05, -0.6, 0.8),
  wonder:     P(0.75, 0.3, 1.12, 0.0, 0.4, -0.35, 0.35),
  angry:      P(-0.55, -1.0, 0.84, -0.05, -0.55, 0.05, 0.0),
  determined: P(-0.35, -0.5, 0.88, 0.0, 0.15, 0.1, 0.0),
  curious:    P(0.45, 0.0, 1.06, 0.0, 0.15, -0.1, 0.05),
};

/** Guess a line's feeling from its words and punctuation (lines can also say it outright). */
export function inferEmotion(text: string): Emotion {
  const t = text.toLowerCase();
  if (/\b(ha+|haha|hooray|yay|we did it|it worked)\b/.test(t)) return 'joy';
  if (/\b(sorry|miss (you|her)|gone|lost|never got to|alone|cry|crying|goodbye)\b/.test(t)) return 'sad';
  if (/\b(run|hurry|quick|watch out|look out|help|smudge|it'?s coming)\b/.test(t)) return 'scared';
  if (/\?!|!\?/.test(t)) return 'surprised';
  if (/\b(oh|whoa|wow)\b/.test(t) && /[!.]/.test(t)) return 'wonder';
  if (/\b(love|beautiful|thank|wonderful|home)\b/.test(t)) return 'tender';
  if (/!$/.test(t.trim())) return 'happy';
  if (/\?$/.test(t.trim())) return 'curious';
  if (/(\.\.\.|…|—)$/.test(t.trim())) return 'worried';
  return 'neutral';
}

/** Anything that can show a feeling and talk (a face, or a fox's ears and tail). */
export interface Expressive {
  set(e: Emotion, strength?: number, seconds?: number): void;
  setBase(e: Emotion): void;
  letter(c: string): void;
  quiet(): void;
  update(dt: number): void;
}

interface FaceBone {
  bone: THREE.Object3D;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale?: THREE.Vector3;
  /** Character space (x = her left, y = up, z = forward) to the bone's parent space. */
  toParent: THREE.Quaternion;
  unit: number;
}

/**
 * Drives a character's face on top of whatever the body is doing: blends toward an expression,
 * flaps the mouth open on vowels while a line types out, and now and then lifts a brow. Works on
 * the expression bones (brow_L/R, mouth_L/R), the eye bones and the mouth bone; call update()
 * right after the animation mixer.
 */
export class Face implements Expressive {
  private bones = new Map<string, FaceBone>();
  private cur: Pose = { ...POSES.neutral };
  private target: Pose = { ...POSES.neutral };
  private hold = 0;
  private base: Emotion = 'neutral';
  private talk = 0;
  private talkTarget = 0;
  private flick = 0;
  private flickIn = 3;
  /** Blinks are ours too (the mixer only writes a bone when its value changes, so the face owns
   * the eye and mouth bones outright and sets them from rest every frame). */
  private blinkT = -1;
  private blinkIn = 2;
  /** Which local scale axis opens/closes the eyes and mouth (read from the blink and speak clips). */
  private eyeAxis: 'x' | 'y' | 'z' = 'y';
  private mouthAxis: 'x' | 'y' | 'z' = 'y';
  private mouthWide: 'x' | 'y' | 'z' = 'x';
  readonly has: boolean;
  /** Blink on their own (tests switch it off to catch an expression). */
  autoBlink = true;

  /** `size` scales every movement (1 = Ada's face; a grown-up's features are finer). */
  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], private size = 1) {
    model.updateMatrixWorld(true);
    const rootQ = model.getWorldQuaternion(new THREE.Quaternion());
    const rootS = model.getWorldScale(new THREE.Vector3()).x;
    for (const name of ['brow_L', 'brow_R', 'mouth_L', 'mouth_R', 'mouth', 'eye_L', 'eye_R']) {
      const bone = model.getObjectByName(name);
      if (!bone || !bone.parent) continue;
      const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const ps = bone.parent.getWorldScale(new THREE.Vector3()).x;
      this.bones.set(name, {
        bone, pos: bone.position.clone(), quat: bone.quaternion.clone(), scale: bone.scale.clone(),
        toParent: pq.invert().multiply(rootQ), unit: rootS / ps,
      });
    }
    this.has = this.bones.has('brow_L') && this.bones.has('mouth_L');
    const axis = (track: THREE.KeyframeTrack | undefined, pick: 'min' | 'max'): 'x' | 'y' | 'z' | null => {
      if (!track) return null;
      const v = track.values;
      const ext = [0, 1, 2].map((k) => {
        let e = 1;
        for (let i = k; i < v.length; i += 3) e = pick === 'min' ? Math.min(e, v[i]) : Math.max(e, v[i]);
        return Math.abs(e - 1);
      });
      return (['x', 'y', 'z'] as const)[ext.indexOf(Math.max(...ext))];
    };
    const blink = clips.find((c) => c.name === 'blink')?.tracks.find((t) => /eye_L\.scale$/.test(t.name));
    const speak = clips.find((c) => c.name === 'speak')?.tracks.find((t) => /mouth\.scale$/.test(t.name));
    this.eyeAxis = axis(blink, 'min') ?? 'y';
    this.mouthAxis = axis(speak, 'max') ?? 'y';
    this.mouthWide = this.mouthAxis === 'x' ? 'y' : 'x';
  }

  /** Show a feeling: `strength` 0..1 of the way from neutral; after `seconds` it eases back to the base. */
  set(e: Emotion, strength = 1, seconds = 0) {
    const p = POSES[e], n = POSES.neutral;
    for (const k of Object.keys(p) as (keyof Pose)[]) this.target[k] = n[k] + (p[k] - n[k]) * strength;
    this.hold = seconds;
  }

  /** The resting expression between lines (e.g. worried while the Smudge is about). */
  setBase(e: Emotion) {
    this.base = e;
    if (this.hold <= 0) this.set(e, e === 'neutral' ? 1 : 0.6);
  }

  /** One letter of speech: vowels open the mouth, consonants half close it, spaces close it. */
  letter(c: string) {
    if (/[aeiouyàáâäéèêëíìîïóòôöúùûü]/i.test(c)) this.talkTarget = 0.55 + Math.random() * 0.45;
    else if (/[a-z]/i.test(c)) this.talkTarget = Math.min(this.talkTarget, 0.25);
    else this.talkTarget = 0;
  }

  /** The line is over: close the mouth. */
  quiet() {
    this.talkTarget = 0;
  }

  blink() {
    this.blinkT = 0;
  }

  update(dt: number) {
    if (!this.has) return;
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this.setBase(this.base);
    }
    const ease = 1 - Math.exp(-dt * 7);
    for (const k of Object.keys(this.cur) as (keyof Pose)[]) this.cur[k] += (this.target[k] - this.cur[k]) * ease;
    // the mouth snaps open on a vowel and falls closed between them
    this.talk += (this.talkTarget - this.talk) * (1 - Math.exp(-dt * (this.talkTarget > this.talk ? 30 : 16)));
    this.talkTarget *= Math.exp(-dt * 6);
    // now and then the brows lift a moment, as faces do while listening or thinking
    this.flickIn -= dt;
    if (this.flickIn <= 0) {
      this.flick = 1;
      this.flickIn = 3 + Math.random() * 5;
    }
    this.flick = Math.max(0, this.flick - dt * 2.5);
    // blinks: shut fast, open a little slower; now and then a double blink
    this.blinkIn -= dt;
    if (this.blinkIn <= 0 && this.autoBlink) {
      this.blinkT = 0;
      this.blinkIn = Math.random() < 0.15 ? 0.3 : 1.8 + Math.random() * 3.5;
    }
    let shut = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      const t = this.blinkT;
      shut = t < 0.06 ? t / 0.06 : t < 0.1 ? 1 : Math.max(0, 1 - (t - 0.1) / 0.12);
      if (t > 0.25) this.blinkT = -1;
    }
    const c = this.cur;
    const s = this.size;
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const side of [1, -1]) {
      const L = side > 0 ? 'L' : 'R';
      const brow = this.bones.get(`brow_${L}`)!;
      const lift = (c.brow + this.flick * 0.18) * 0.0055 * s;
      this.place(brow, v.set(0, lift, 0), q.setFromAxisAngle(fwd, -side * c.browTilt * 0.42));
      const corner = this.bones.get(`mouth_${L}`)!;
      this.place(corner, v.set(side * c.width * 0.004 * s, c.corner * 0.0055 * s, -Math.abs(c.corner) * 0.0012 * s), null);
      const eye = this.bones.get(`eye_${L}`);
      if (eye) {
        // narrowed or wide for the feeling, closed in a blink, the outer corner tilted
        eye.bone.scale.copy(eye.scale!);
        eye.bone.scale[this.eyeAxis] *= Math.max(0.08, c.lid * (1 - shut * 0.94));
        eye.bone.quaternion.copy(this.parentRot(eye, q.setFromAxisAngle(fwd, -side * c.eyeTilt * 1.5))).multiply(eye.quat);
      }
    }
    const mouth = this.bones.get('mouth');
    if (mouth) {
      const open = Math.min(1.2, c.open * (1 - this.talk) + this.talk);
      mouth.bone.scale.copy(mouth.scale!);
      mouth.bone.scale[this.mouthAxis] *= 1 + open * 2.2;
      mouth.bone.scale[this.mouthWide] *= 1 - open * 0.12 + c.width * 0.06;
    }
  }

  private parentRot(b: FaceBone, qChar: THREE.Quaternion) {
    // a rotation about a character-space axis, expressed in the bone's parent space
    return b.toParent.clone().multiply(qChar).multiply(b.toParent.clone().invert());
  }

  private place(b: FaceBone, offset: THREE.Vector3, rot: THREE.Quaternion | null) {
    b.bone.position.copy(offset).applyQuaternion(b.toParent).multiplyScalar(b.unit).add(b.pos);
    if (rot) b.bone.quaternion.copy(this.parentRot(b, rot)).multiply(b.quat);
  }
}

/**
 * Pip has no face to pull, so a fox's feelings go into its ears (pricked for joy and curiosity,
 * flattened back when sad or frightened), its tail (wagging when happy, tucked when scared) and a
 * tilt of the head when it wonders.
 */
export class FoxFace implements Expressive {
  private bones = new Map<string, FaceBone>();
  private ears = 0;
  private earsT = 0;
  private wag = 0;
  private wagT = 0;
  private tuck = 0;
  private tuckT = 0;
  private tilt = 0;
  private tiltT = 0;
  private hold = 0;
  private base: Emotion = 'neutral';
  private t = 0;
  private flickIn = 2;
  private flick = 0;

  /** Bones some clip animates: the mixer rewrites them every frame, so we turn them on top. */
  private animated = new Set<string>();

  constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    model.updateMatrixWorld(true);
    const rootQ = model.getWorldQuaternion(new THREE.Quaternion());
    for (const name of ['ear_L', 'ear_R', 'tail1', 'tail2', 'head']) {
      const bone = model.getObjectByName(name);
      if (!bone || !bone.parent) continue;
      const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      this.bones.set(name, { bone, pos: bone.position.clone(), quat: bone.quaternion.clone(), toParent: pq.invert().multiply(rootQ), unit: 1 });
      if (clips.some((c) => c.tracks.some((t) => t.name === `${name}.quaternion`))) this.animated.add(name);
    }
  }

  /** What the mixer last wrote to each animated bone, before we turned it. */
  private mixed = new Map<string, THREE.Quaternion>();

  /** Call before the mixer updates: put back what it last wrote (it only writes values that changed). */
  restore() {
    for (const [name, q] of this.mixed) this.bones.get(name)!.bone.quaternion.copy(q);
  }

  private turn(name: string, b: FaceBone, qChar: THREE.Quaternion) {
    const qp = this.inParent(b, qChar);
    if (this.animated.has(name)) {
      const m = this.mixed.get(name) ?? new THREE.Quaternion();
      this.mixed.set(name, m.copy(b.bone.quaternion));
      b.bone.quaternion.premultiply(qp);
    } else b.bone.quaternion.copy(qp).multiply(b.quat);
  }

  set(e: Emotion, strength = 1, seconds = 0) {
    // ears: + pricked forward, - flattened back; wag: tail sways; tuck: tail drops; tilt: head on one side
    const m: Record<Emotion, [number, number, number, number]> = {
      neutral: [0, 0, 0, 0], happy: [0.6, 0.8, 0, 0], joy: [0.9, 1, 0, 0], tender: [0.2, 0.3, 0, 0.3],
      sad: [-1, 0, 0.6, 0], worried: [-0.5, 0, 0.3, 0.2], scared: [-1, 0, 1, 0], surprised: [1, 0, 0, 0],
      wonder: [0.8, 0.2, 0, 0.5], angry: [-0.7, 0, 0, 0], determined: [0.5, 0, 0, 0], curious: [0.7, 0.1, 0, 1],
    };
    const [ears, wag, tuck, tilt] = m[e];
    this.earsT = ears * strength;
    this.wagT = wag * strength;
    this.tuckT = tuck * strength;
    this.tiltT = tilt * strength;
    this.hold = seconds;
  }

  setBase(e: Emotion) {
    this.base = e;
    if (this.hold <= 0) this.set(e, 0.6);
  }

  letter() {
    // Pip's lines already bob its head; an ear twitch now and then while it chatters
    if (Math.random() < 0.04) this.flick = 1;
  }

  quiet() {}

  update(dt: number) {
    if (this.hold > 0) {
      this.hold -= dt;
      if (this.hold <= 0) this.setBase(this.base);
    }
    this.t += dt;
    const e = 1 - Math.exp(-dt * 6);
    this.ears += (this.earsT - this.ears) * e;
    this.wag += (this.wagT - this.wag) * e;
    this.tuck += (this.tuckT - this.tuck) * e;
    this.tilt += (this.tiltT - this.tilt) * e;
    this.flickIn -= dt;
    if (this.flickIn <= 0) {
      this.flick = 1;
      this.flickIn = 2.5 + Math.random() * 4;
    }
    this.flick = Math.max(0, this.flick - dt * 5);
    const q = new THREE.Quaternion();
    const x = new THREE.Vector3(1, 0, 0), y = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3(0, 0, 1);
    for (const side of [1, -1]) {
      const ear = this.bones.get(side > 0 ? 'ear_L' : 'ear_R');
      if (!ear) continue;
      // tip the ear forward (pricked) or back (flat), splaying outward when flattened; one flicks
      const back = -this.ears * 0.45 + (side > 0 ? this.flick * 0.3 : 0);
      q.setFromAxisAngle(x, -back).multiply(new THREE.Quaternion().setFromAxisAngle(z, side * Math.max(0, -this.ears) * 0.35));
      this.turn(side > 0 ? 'ear_L' : 'ear_R', ear, q);
    }
    const wag = Math.sin(this.t * 13) * this.wag * 0.35;
    for (const name of ['tail1', 'tail2']) {
      const b = this.bones.get(name);
      if (!b) continue;
      q.setFromAxisAngle(y, wag * (name === 'tail1' ? 0.6 : 1)).multiply(new THREE.Quaternion().setFromAxisAngle(x, this.tuck * 0.35));
      this.turn(name, b, q);
    }
    const head = this.bones.get('head');
    if (head) this.turn('head', head, q.setFromAxisAngle(z, this.tilt * 0.3));
  }

  private inParent(b: FaceBone, qChar: THREE.Quaternion) {
    return b.toParent.clone().multiply(qChar).multiply(b.toParent.clone().invert());
  }
}
