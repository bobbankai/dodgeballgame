// Perception: how an enemy comes to notice Kaede. Instead of a yes/no line of sight, awareness is a meter
// that sight and sound fill and time drains:
//   - sight fills it faster the closer, the more centred in the view cone and the more she is moving;
//     a wide peripheral cone fills slowly, a near field around the agent fills even behind it;
//   - light matters (a night level sees less far) and so does cover (the occlusion ray is cast to several
//     points on her body: half-hidden is half as visible);
//   - sounds (footsteps, combat, a body falling) carry by loudness over distance, muffled by walls;
//   - the meter's thresholds give the states: calm → suspicious (turns and goes to look) → alerted (fight);
//   - memory keeps the last known position and how sure the agent is of it, decaying over time.
import * as THREE from 'three';

export type AwarenessState = 'calm' | 'suspicious' | 'alerted';

export interface PerceptionConfig {
  /** full view cone (degrees) and its range (m) */
  fov?: number;
  range?: number;
  /** wider, slower peripheral cone (degrees) */
  peripheral?: number;
  /** all-round awareness radius (m): "felt" presence */
  near?: number;
  /** seconds of clear, centred, close sight to go from calm to alerted */
  reaction?: number;
  /** seconds for a full meter to drain once the stimulus is gone */
  forget?: number;
  /** loudness (m of reach) below which sounds are ignored */
  hearing?: number;
  /** thresholds */
  suspicious?: number;
  /** multiplier on everything (difficulty, sleeping guards...) */
  acuity?: number;
}

export interface SightQuery {
  eye: THREE.Vector3;
  /** unit facing direction of the agent's head / body */
  forward: THREE.Vector3;
  /** points on the target to test (head, chest, hips): visibility is the fraction unblocked */
  points: THREE.Vector3[];
  /** target planar speed (m/s): moving targets are seen sooner */
  speed: number;
  /** ambient visibility 0..1 (night levels lower it; standing by a fire raises it) */
  light: number;
  /** returns the distance to the first obstacle along dir (or `far`) */
  raycast: (o: THREE.Vector3, d: THREE.Vector3, far: number) => number;
}

export interface Stimulus {
  kind: 'sight' | 'sound' | 'touch' | 'ally';
  pos: THREE.Vector3;
  t: number;
  strength: number;
}

const _d = new THREE.Vector3();

export class Perception {
  awareness = 0;
  state: AwarenessState = 'calm';
  /** where the target was last perceived, and how long ago (s) */
  readonly lastKnown = new THREE.Vector3();
  lastKnownT = -Infinity;
  /** how sure the agent is of lastKnown (1 = seen this frame) */
  certainty = 0;
  /** 0..1 how visible the target was this frame */
  visibility = 0;
  /** the strongest stimulus since the last time the owner consumed it */
  pending: Stimulus | null = null;
  private time = 0;
  private c: Required<PerceptionConfig>;

  constructor(c: PerceptionConfig = {}) {
    this.c = {
      fov: c.fov ?? 110, range: c.range ?? 16, peripheral: c.peripheral ?? 200, near: c.near ?? 2.2,
      reaction: c.reaction ?? 0.9, forget: c.forget ?? 9, hearing: c.hearing ?? 1, suspicious: c.suspicious ?? 0.3,
      acuity: c.acuity ?? 1,
    };
  }

  get config(): Readonly<Required<PerceptionConfig>> { return this.c; }

  /** force the meter (an ally shouted, a cutscene) */
  set(level: number, at?: THREE.Vector3): void {
    this.awareness = THREE.MathUtils.clamp(level, 0, 1);
    if (at) this.remember(at, 1);
    this.classify();
  }

  private remember(p: THREE.Vector3, certainty: number): void {
    this.lastKnown.copy(p);
    this.lastKnownT = this.time;
    this.certainty = Math.max(this.certainty, certainty);
  }

  private classify(): void {
    const prev = this.state;
    if (this.awareness >= 1) this.state = 'alerted';
    else if (this.awareness >= this.c.suspicious) this.state = prev === 'alerted' ? 'alerted' : 'suspicious';
    // alerted agents only calm down once the meter is nearly empty
    if (prev === 'alerted' && this.awareness < 0.15) this.state = 'calm';
    else if (prev === 'suspicious' && this.awareness < this.c.suspicious * 0.5) this.state = 'calm';
  }

  /**
   * how visible the target is from the eye, 0..1, including cone, distance, light and cover.
   * Exposed for tests and debug views.
   */
  sightFactor(q: SightQuery): number {
    const c = this.c;
    const target = q.points[0];
    _d.copy(target).sub(q.eye);
    const dist = _d.length();
    if (dist < 1e-3) return 1;
    _d.divideScalar(dist);
    const range = c.range * (0.45 + 0.55 * q.light) * c.acuity;
    const nearField = dist < c.near;
    if (dist > range && !nearField) return 0;
    const cosA = _d.x * q.forward.x + _d.z * q.forward.z;
    const flat = Math.hypot(_d.x, _d.z) || 1;
    const ang = Math.acos(THREE.MathUtils.clamp(cosA / flat, -1, 1)) * THREE.MathUtils.RAD2DEG;
    let cone: number;
    if (ang <= c.fov / 2) cone = 1 - 0.35 * (ang / (c.fov / 2)); // centre of view is sharpest
    else if (ang <= c.peripheral / 2) cone = 0.22 * (1 - (ang - c.fov / 2) / (c.peripheral / 2 - c.fov / 2));
    else cone = 0;
    if (nearField) cone = Math.max(cone, 0.6 * (1 - dist / c.near) + 0.25);
    if (cone <= 0) return 0;
    // cover: fraction of the test points with a clear line from the eye
    let clear = 0;
    for (const p of q.points) {
      _d.copy(p).sub(q.eye);
      const d = _d.length();
      if (d < 1e-3) { clear++; continue; }
      _d.divideScalar(d);
      if (q.raycast(q.eye, _d, d) >= d - 0.25) clear++;
    }
    const cover = clear / q.points.length;
    if (cover <= 0) return 0;
    const distF = nearField ? 1 : 1 - Math.pow(dist / range, 1.6);
    return THREE.MathUtils.clamp(cone * distF * cover, 0, 1);
  }

  /** one frame of looking (and forgetting) */
  update(dt: number, q: SightQuery | null): void {
    this.time += dt;
    const c = this.c;
    this.visibility = q ? this.sightFactor(q) : 0;
    if (this.visibility > 0.02 && q) {
      // moving targets catch the eye; a still one at the edge of vision may be missed
      const motion = 0.55 + 0.45 * THREE.MathUtils.clamp(q.speed / 3, 0, 1);
      const gain = (this.visibility * motion * c.acuity) / Math.max(0.05, c.reaction);
      this.awareness = Math.min(1, this.awareness + gain * dt);
      this.remember(q.points[0], this.visibility);
      const st: Stimulus = { kind: 'sight', pos: q.points[0].clone(), t: this.time, strength: this.visibility };
      if (!this.pending || st.strength >= this.pending.strength) this.pending = st;
    } else {
      // drain: slowly while suspicious (the agent keeps looking), faster when calm
      const rate = 1 / Math.max(0.5, c.forget) * (this.state === 'alerted' ? 0.6 : 1);
      this.awareness = Math.max(0, this.awareness - rate * dt);
    }
    // certainty of the remembered position fades with time
    this.certainty = Math.max(0, this.certainty - dt / Math.max(1, c.forget));
    this.classify();
  }

  /**
   * a sound: `loudness` is how far (m) it carries in the open; walls between halve it each.
   * Returns the awareness gained.
   */
  hear(at: THREE.Vector3, ear: THREE.Vector3, loudness: number, walls = 0): number {
    const reach = loudness * Math.pow(0.5, walls) * this.c.acuity;
    const d = at.distanceTo(ear);
    if (reach < this.c.hearing || d > reach) return 0;
    const s = 1 - d / reach;
    const gain = 0.25 + 0.75 * s * s;
    const before = this.awareness;
    this.awareness = Math.min(1, this.awareness + gain);
    // a sound gives a vaguer position than sight
    this.remember(at, 0.4 + 0.4 * s);
    const st: Stimulus = { kind: 'sound', pos: at.clone(), t: this.time, strength: s };
    if (!this.pending || st.strength >= this.pending.strength) this.pending = st;
    this.classify();
    return this.awareness - before;
  }

  /** the target is lost: drop to suspicious at `level` (the agent goes to look rather than forgetting) */
  lose(level = 0.6): void {
    this.awareness = Math.min(this.awareness, Math.max(this.c.suspicious, level));
    this.state = 'suspicious';
    this.pending = null;
  }

  /** touched / hit: instantly alerted, and the position is certain */
  touch(at: THREE.Vector3): void {
    this.awareness = 1;
    this.remember(at, 1);
    this.pending = { kind: 'touch', pos: at.clone(), t: this.time, strength: 1 };
    this.classify();
  }

  /** an ally called out: raises the meter to at least `level` */
  told(at: THREE.Vector3, level = 1): void {
    this.awareness = Math.max(this.awareness, level);
    this.remember(at, 0.7);
    this.pending = { kind: 'ally', pos: at.clone(), t: this.time, strength: level };
    this.classify();
  }

  /** take the pending stimulus (the owner reacts to it once) */
  consume(): Stimulus | null {
    const s = this.pending;
    this.pending = null;
    return s;
  }

  /** seconds since the target was last perceived */
  get sinceKnown(): number { return this.time - this.lastKnownT; }
}

/** how loud common events are (metres of reach in the open) */
export const LOUDNESS = {
  walk: 3,
  run: 7,
  sprint: 11,
  land: 9,
  swing: 6,
  clash: 18,
  body: 14,
  shout: 22,
  ignite: 12,
} as const;
