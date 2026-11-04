// Enemy intelligence shared across the cast.
//  PlayerModel  learns how the player fights (decaying rates) so enemies adapt their choices
//  Squad        coordinates a fight: attack tokens, ring slots around the player, flankers, perilous
//               attack exclusivity, alert propagation, fairness (no unannounced off-screen hits),
//               dynamic difficulty
import * as THREE from 'three';
import type { Enemy } from './Enemy';
import type { Game } from './Game';

/** exponentially decaying counter (events per window) */
class Rate {
  v = 0;
  constructor(private half: number) {}
  add(k = 1): void { this.v += k; }
  decay(dt: number): void { this.v *= Math.pow(0.5, dt / this.half); }
}

export class PlayerModel {
  attacks = new Rate(10);
  heavies = new Rate(15);
  blocks = new Rate(12);
  parries = new Rate(15);
  dodges = new Rate(12);
  dodgeLeft = new Rate(15);
  dodgeRight = new Rate(15);
  dodgeBack = new Rate(15);
  incoming = new Rate(12);
  hitsTaken = new Rate(20);
  heals = new Rate(30);
  /** running average of the distance the player fights at */
  range = 2.5;
  /** the player is moving away from the fight */
  retreating = 0;
  private prevDist = 0;

  update(dt: number, distToNearest: number): void {
    for (const r of [this.attacks, this.heavies, this.blocks, this.parries, this.dodges, this.dodgeLeft, this.dodgeRight, this.dodgeBack, this.incoming, this.hitsTaken, this.heals]) r.decay(dt);
    if (distToNearest < 12) {
      this.range += (distToNearest - this.range) * Math.min(1, dt * 0.3);
      const dd = (distToNearest - this.prevDist) / Math.max(dt, 1e-3);
      this.retreating += ((dd > 1.2 ? 1 : 0) - this.retreating) * Math.min(1, dt * 1.5);
    }
    this.prevDist = distToNearest;
  }

  /** fraction of incoming attacks answered with guard / parry / dodge */
  get guardRate(): number { return this.blocks.v / Math.max(1, this.incoming.v); }
  get parryRate(): number { return this.parries.v / Math.max(1, this.incoming.v); }
  get dodgeRate(): number { return this.dodges.v / Math.max(1, this.incoming.v); }
  /** -1 = dodges left, +1 = right */
  get dodgeBias(): number { const t = this.dodgeLeft.v + this.dodgeRight.v; return t < 1 ? 0 : (this.dodgeRight.v - this.dodgeLeft.v) / t; }
  get aggression(): number { return Math.min(1.5, this.attacks.v / 6); }
}

interface Slot { angle: number; owner: Enemy | null }

export class Squad {
  readonly model = new PlayerModel();
  private tokens = new Set<Enemy>();
  maxTokens = 2;
  private perilous: Enemy | null = null;
  private slots: Slot[] = [];
  private slotT = 0;
  /** difficulty multiplier on aggression (eases after deaths, rises when the player dominates) */
  pressure = 1;
  deathsHere = 0;
  private calm = 0;
  private frustum = new THREE.Frustum();
  private pv = new THREE.Matrix4();
  /** id of the player's current attack, so each enemy reacts to it once */
  playerAttackId = 0;
  private lastAct: string | null = null;
  private lastClip: string | null = null;

  constructor(private game: Game) {}

  reset(): void {
    this.tokens.clear();
    this.perilous = null;
    this.slots = [];
  }

  onPlayerDeath(): void {
    this.deathsHere++;
    this.pressure = Math.max(0.6, 1 - 0.12 * Math.min(3, this.deathsHere));
  }

  onAreaCleared(): void { this.deathsHere = 0; }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const alive = g.enemies.filter((e) => !e.dead);
    let nearest = 99;
    for (const e of alive) nearest = Math.min(nearest, e.body.pos.distanceTo(p.body.pos));
    this.model.update(dt, nearest);
    // detect a new player attack
    const clip = p.char.animator.current;
    if ((p.act === 'attack' || p.act === 'heavy' || p.act === 'art') && (p.act !== this.lastAct || clip !== this.lastClip)) {
      this.playerAttackId++;
      this.model.attacks.add();
      if (p.act !== 'attack') this.model.heavies.add();
    }
    if (p.act === 'heal' && this.lastAct !== 'heal') this.model.heals.add();
    this.lastAct = p.act;
    this.lastClip = clip;
    // pressure: rises slowly while the player takes no damage in combat
    const fighting = alive.some((e) => e.aware);
    if (fighting) {
      this.calm += dt;
      if (this.calm > 45) this.pressure = Math.min(1.25, this.pressure + dt * 0.004);
    }
    // camera frustum for fairness tests
    const cam = g.pipe.camera;
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    // ring slots
    this.slotT -= dt;
    if (this.slotT <= 0) { this.slotT = 0.5; this.assignSlots(alive.filter((e) => e.aware && e.inCombat)); }
    for (const t of this.tokens) if (t.dead || !t.attacking) this.tokens.delete(t);
    if (this.perilous && (this.perilous.dead || !this.perilous.attacking)) this.perilous = null;
  }

  onPlayerHurt(): void { this.calm = 0; this.model.hitsTaken.add(); }

  visible(e: Enemy): boolean {
    return this.frustum.containsPoint(e.center());
  }

  takeToken(e: Enemy): boolean {
    if (this.tokens.has(e)) return true;
    for (const t of this.tokens) if (t.dead || !t.attacking) this.tokens.delete(t);
    const max = Math.max(1, Math.round(this.maxTokens * this.pressure));
    if (this.tokens.size >= max) return false;
    this.tokens.add(e);
    return true;
  }

  releaseToken(e: Enemy): void { this.tokens.delete(e); }

  /** only one unblockable attack in flight at a time */
  claimPerilous(e: Enemy): boolean {
    if (this.perilous && this.perilous !== e && !this.perilous.dead && this.perilous.attacking) return false;
    this.perilous = e;
    return true;
  }

  /** desired angle (around the player, world yaw) for an enemy that is waiting its turn */
  slotFor(e: Enemy): number | null {
    const s = this.slots.find((x) => x.owner === e);
    return s ? s.angle : null;
  }

  private assignSlots(list: Enemy[]): void {
    const p = this.game.player;
    const n = list.length;
    if (!n) { this.slots = []; return; }
    // front-weighted ring: slots spread across the player's field of view, one flank slot behind
    const face = p.yaw;
    const angles: number[] = [];
    const spread = Math.min(Math.PI * 1.5, 0.9 + n * 0.45);
    for (let i = 0; i < n; i++) angles.push(face + (n === 1 ? 0 : -spread / 2 + (spread * i) / (n - 1)));
    if (n >= 3) angles[n - 1] = face + Math.PI; // a flanker
    // greedy match by angular distance from each enemy's current bearing
    const free = angles.map((a) => ({ angle: a, owner: null as Enemy | null }));
    const bearing = (e: Enemy) => Math.atan2(e.body.pos.x - p.body.pos.x, e.body.pos.z - p.body.pos.z);
    const pairs: { e: Enemy; s: Slot; d: number }[] = [];
    for (const e of list) for (const s of free) {
      let d = Math.abs(bearing(e) - s.angle) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      // flankers must be agile
      if (Math.abs(((s.angle - face) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.5 && (e.def.flank ?? 0.4) < 0.3) d += 3;
      pairs.push({ e, s, d });
    }
    pairs.sort((a, b) => a.d - b.d);
    const used = new Set<Enemy>();
    for (const pr of pairs) {
      if (used.has(pr.e) || pr.s.owner) continue;
      pr.s.owner = pr.e;
      used.add(pr.e);
    }
    this.slots = free;
  }

  /** alert allies near a newly aware enemy (they hear the call after a short delay) */
  propagate(from: Enemy): void {
    for (const e of this.game.enemies) {
      if (e === from || e.dead || e.aware) continue;
      const d = e.body.pos.distanceTo(from.body.pos);
      if (d < 14) window.setTimeout(() => e.hear(from.body.pos), 250 + d * 60 + Math.random() * 300);
    }
  }

  /** a loud event (clash, cut, shout): enemies in earshot investigate */
  noise(pos: THREE.Vector3, radius: number): void {
    for (const e of this.game.enemies) {
      if (e.dead || e.aware) continue;
      if (e.body.pos.distanceTo(pos) < radius) e.hear(pos);
    }
  }
}
