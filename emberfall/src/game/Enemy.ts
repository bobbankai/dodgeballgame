// The Hollow: enemy controller with a utility brain.
//
//  perception   sight cone + line of sight (BVH ray), hearing (noise events, ally calls), memory of the
//               player's last known position -> investigate -> search -> give up and return home
//  brain        every ~0.2 s scores: each attack (range fit, cooldown, the player's state and habits),
//               approach, hold a ring slot, flank, back off, retreat, feint. Highest score wins, with
//               hysteresis so behaviour doesn't flicker
//  reactions    when the player starts an attack aimed at this enemy, it may block, sidestep or back
//               step after a human reaction delay (skill-dependent, with cooldown so it isn't perfect)
//  adaptation   PlayerModel rates: turtling -> unblockable / guard-crushing attacks; parry-spam -> feints
//               and delayed swings; kiting -> lunges; healing / knocked down -> punish
//  squad        attack tokens, ring slots, one perilous attack at a time, no unannounced off-screen hits
//  steering     separation from allies, obstacle feelers against the level BVH
import * as THREE from 'three';
import type { Character } from './Character';
import { makeBody, type Body, type World } from './World';
import { angleDiff, bladeSweep, inCone, type Combatant, type Hit, type HitResult } from './Combat';
import type { Game } from './Game';
import { setFX } from '../render/MaterialFX';

export interface AttackDef {
  clip: string;
  range: [number, number];
  damage: number;
  poise?: number;
  heavy?: boolean;
  unblockable?: boolean;
  knock?: number;
  cooldown: number;
  weight?: number;
  /** turn rate while winding up (rad/s) */
  track?: number;
  speed?: number;
  /** follow-up attack chained at the cancel point */
  chain?: string;
  /** below this hp fraction only */
  phase?: number;
  aoe?: number;
  /** guard damage multiplier against a blocking player */
  guardBreak?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  model: string;
  weapon?: string;
  offhand?: string;
  scale?: number;
  hp: number;
  poise: number;
  damage?: number;
  walk: number;
  run: number;
  sight?: number;
  attacks: AttackDef[];
  idle?: string;
  move?: string[];
  aggression?: number;
  block?: number;
  /** 0..1 reaction skill: dodge / block timing, feints */
  skill?: number;
  /** 0..1 how happy it is to take the flank slot */
  flank?: number;
  /** 0..1 how readily it retreats when hurt */
  caution?: number;
  boss?: boolean;
  superArmor?: number;
  radius?: number;
  glow?: [number, number, number];
  hurt?: string[];
  stagger?: string;
  knockdown?: string;
  getup?: string;
  death?: string;
  blockClip?: string;
  evade?: { back?: string; left?: string; right?: string };
  roar?: string;
  /** keeps this distance while circling */
  spacing?: number;
  /** non-lethal: health never falls below this fraction; reaching it makes the enemy yield (no finisher) */
  minHp?: number;
}

type State = 'idle' | 'investigate' | 'search' | 'return' | 'alert' | 'engage' | 'attack' | 'feint' | 'block' | 'evade' | 'roar'
  | 'hit' | 'stagger' | 'down' | 'getup' | 'dead' | 'scripted';
type Move = 'hold' | 'approach' | 'slot' | 'flank' | 'backoff' | 'retreat';

const tmpV = new THREE.Vector3();

export class Enemy implements Combatant {
  team = 'enemy' as const;
  name: string;
  body: Body;
  yaw = 0;
  hp: number;
  maxHp: number;
  poise: number;
  dead = false;
  aware = false;
  state: State = 'idle';
  staggered = false;
  /** a non-lethal enemy (def.minHp) beaten down to its floor: it stops fighting */
  yielded = false;
  private stateT = 0;
  private cool = new Map<string, number>();
  private atk: AttackDef | null = null;
  private hitDone = false;
  private prevBase = new THREE.Vector3();
  private prevTip = new THREE.Vector3();
  private haveBlade = false;
  private dissolve = 0;
  removed = false;
  home: THREE.Vector3;
  onDeath: (() => void) | null = null;
  invulnerable = false;
  private glintDone = false;
  readonly def: EnemyDef;
  noAI = false;
  // perception / memory
  private lastSeen = new THREE.Vector3();
  private lastSeenT = -99;
  private sinceSeen = 99;
  private searchT = 0;
  private time = 0;
  // brain
  private move: Move = 'hold';
  private thinkT = 0;
  private strafeDir = 1;
  private strafeT = 0;
  private reactedTo = -1;
  private reactCool = 0;
  private pendingReact: { at: number; kind: 'block' | 'evade' } | null = null;
  private feintCool = 6;
  private speedNow = 0;
  private hpAtEngage = 1;
  private comboN = 0;
  private sGoal: THREE.Vector3 | null = null;
  private sSpeed = 1.3;
  private sDone: (() => void) | null = null;

  constructor(public char: Character, def: EnemyDef, private game: Game, pos: THREE.Vector3, yaw = 0) {
    this.def = def;
    this.name = def.name;
    this.hp = this.maxHp = def.hp;
    this.poise = def.poise;
    this.body = makeBody(pos, def.radius ?? 0.34 * (def.scale ?? 1), 1.75 * (def.scale ?? 1));
    this.yaw = yaw;
    this.home = pos.clone();
    char.animator.setLocomotion(def.idle ?? 'idle', def.move ?? ['walk', 'run']);
    char.animator.onEvent = (n) => this.onEvent(n);
    char.root.position.copy(pos);
    char.root.rotation.y = yaw;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
  }

  center(out = new THREE.Vector3()): THREE.Vector3 { return out.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.68, this.body.pos.z); }
  targetable(): boolean { return !this.dead && this.state !== 'scripted'; }
  get attacking(): boolean { return this.state === 'attack' || this.state === 'feint'; }
  get inCombat(): boolean { return this.aware && !this.dead && ['engage', 'attack', 'feint', 'block', 'evade', 'roar', 'hit'].includes(this.state); }
  private get skill(): number { return this.def.skill ?? 0.4; }

  private go(s: State): void { this.state = s; this.stateT = 0; }

  alert(): void {
    if (this.aware || this.dead) return;
    this.aware = true;
    this.hpAtEngage = this.hp / this.maxHp;
    this.go('alert');
    this.game.audio.sfx('hollow_alert', this.body.pos, 0.7);
    this.game.squad.propagate(this);
  }

  /** heard something at pos: turn and go look (or join the fight if the player is right there) */
  hear(pos: THREE.Vector3): void {
    if (this.dead || this.aware || this.state === 'scripted') return;
    this.lastSeen.copy(pos);
    this.lastSeenT = this.time;
    if (pos.distanceTo(this.game.player.body.pos) < 6) { this.alert(); return; }
    this.go('investigate');
  }

  private canSee(): boolean {
    const p = this.game.player;
    if (p.dead) return false;
    const eye = this.center();
    eye.y += 0.35;
    const tgt = p.center();
    const d = eye.distanceTo(tgt);
    const sight = this.def.sight ?? 13;
    if (d > sight) return false;
    const ang = Math.abs(angleDiff(this.yaw, Math.atan2(tgt.x - eye.x, tgt.z - eye.z)));
    const fov = this.aware ? Math.PI : 1.15;
    if (ang > fov && d > 3) return false;
    const dir = tgt.clone().sub(eye).normalize();
    return this.game.world.raycast(eye, dir, d) >= d - 0.3;
  }

  update(dt: number, world: World): void {
    const a = this.char.animator;
    this.stateT += dt;
    this.time += dt;
    this.reactCool -= dt;
    this.feintCool -= dt;
    for (const [k, v] of this.cool) this.cool.set(k, v - dt);
    const g = this.game;
    const p = g.player;
    const toP = p.body.pos.clone().sub(this.body.pos);
    const dist = Math.hypot(toP.x, toP.z);
    const yawP = Math.atan2(toP.x, toP.z);

    if (this.dead) {
      this.applyRoot(dt, world);
      if (a.finished || this.stateT > 2.5) {
        this.dissolve = Math.min(1, this.dissolve + dt * 0.6);
        setFX(this.char.model, 'uDissolve', this.dissolve);
        if (Math.random() < dt * 40) g.particles.burst(Math.random() < 0.6 ? 'ember' : 'ash', this.center().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.7) * 1.2, (Math.random() - 0.5) * 0.6)), 2);
        if (this.dissolve >= 1) this.removed = true;
      }
      this.sync();
      return;
    }
    if (this.noAI) { a.locomote(0, dt); this.sync(); return; }

    // ---------------- perception
    const seen = this.canSee();
    if (seen) {
      this.lastSeen.copy(p.body.pos);
      this.lastSeenT = this.time;
      this.sinceSeen = 0;
      if (!this.aware) this.alert();
    } else this.sinceSeen += dt;
    if (p.dead && this.aware) { this.aware = false; g.squad.releaseToken(this); this.go('return'); }
    // lost the player for a while: investigate the last known position
    if (this.aware && this.sinceSeen > 3.5 && (this.state === 'engage')) {
      this.aware = false;
      g.squad.releaseToken(this);
      this.go('investigate');
    }

    // ---------------- reactions to the player's attacks (any non-committed state)
    if (this.aware && this.reactedTo !== g.squad.playerAttackId && (this.state === 'engage' || this.state === 'alert')) {
      this.reactedTo = g.squad.playerAttackId;
      this.considerReaction(dist, yawP);
    }
    if (this.pendingReact && this.time >= this.pendingReact.at && (this.state === 'engage')) {
      const k = this.pendingReact.kind;
      this.pendingReact = null;
      if (k === 'block') this.startBlock();
      else this.startEvade(yawP);
    }

    switch (this.state) {
      case 'idle': {
        a.locomote(0, dt);
        break;
      }
      case 'investigate': {
        const to = this.lastSeen.clone().sub(this.body.pos).setY(0);
        // memory fades: stale leads are abandoned
        if (to.length() < 1.2 || this.stateT > 12 || this.time - this.lastSeenT > 25) { this.go('search'); this.searchT = 0; break; }
        this.steer(dt, world, to.normalize(), this.def.walk, Math.atan2(to.x, to.z), 4);
        break;
      }
      case 'search': {
        this.searchT += dt;
        // look around
        this.yaw += Math.sin(this.searchT * 1.3) * dt * 1.2;
        a.locomote(0, dt);
        if (this.searchT > 5) this.go('return');
        break;
      }
      case 'return': {
        const to = this.home.clone().sub(this.body.pos).setY(0);
        if (to.length() < 0.8) { this.go('idle'); a.locomote(0, dt); break; }
        this.steer(dt, world, to.normalize(), this.def.walk, Math.atan2(to.x, to.z), 4);
        break;
      }
      case 'alert': {
        this.turnTo(yawP, dt, 6);
        a.locomote(0, dt);
        if (this.stateT > 0.45) {
          if (this.def.roar && Math.random() < 0.6 && dist > 4) this.startRoar();
          else this.go('engage');
        }
        break;
      }
      case 'engage': {
        this.turnTo(yawP, dt, 5);
        this.thinkT -= dt;
        if (this.thinkT <= 0) {
          this.thinkT = 0.16 + Math.random() * 0.12;
          if (this.think(dist, yawP)) break;
        }
        this.locomote(dt, world, dist, yawP);
        break;
      }
      case 'attack':
      case 'feint': {
        const atk = this.atk!;
        if (!a.after('hit')) this.turnTo(yawP, dt, atk.track ?? 4);
        const hw = a.meta(atk.clip)?.events.hit as number[] | undefined;
        // the feint: cancel just before the swing lands, then strike for real after the bait
        if (this.state === 'feint' && hw && a.time > hw[0] - 0.08) {
          a.stop(0.12);
          this.go('engage');
          this.thinkT = 0.05;
          this.cool.set(atk.clip, 0);
          this.comboN = 0;
          break;
        }
        // the perilous glint before an unblockable strike
        if (atk.unblockable && !this.glintDone && hw && a.time > hw[0] - 0.45) {
          this.glintDone = true;
          g.glint(this);
        }
        this.applyRoot(dt, world);
        this.updateBlade(atk);
        if (atk.chain && a.after('cancel') && dist < atk.range[1] + 1.2 && Math.random() < 0.85 * (g.squad.pressure)) {
          const next = this.def.attacks.find((x) => x.clip === atk.chain);
          if (next) { this.attack(next, false); break; }
        }
        if (a.finished) { g.squad.releaseToken(this); this.go('engage'); a.stop(0.25); this.thinkT = 0.2 + Math.random() * 0.4; }
        break;
      }
      case 'block': {
        this.turnTo(yawP, dt, 8);
        this.applyRoot(dt, world);
        if (this.stateT > 0.75 || (a.finished && this.stateT > 0.4)) { this.go('engage'); a.stop(0.2); }
        break;
      }
      case 'evade':
      case 'hit':
      case 'roar': {
        this.applyRoot(dt, world);
        if (this.state === 'evade') this.turnTo(yawP, dt, 3);
        if (a.finished) { this.go('engage'); a.stop(0.2); this.thinkT = this.state === 'evade' ? 0.05 : 0.2; }
        break;
      }
      case 'stagger': {
        this.applyRoot(dt, world);
        if (this.stateT > 2.6) { this.staggered = false; this.poise = this.def.poise; this.go('engage'); a.stop(0.3); }
        break;
      }
      case 'down': {
        this.applyRoot(dt, world);
        if (a.finished && this.stateT > 1.4) { this.go('getup'); a.play(this.def.getup ?? 'getup', { fade: 0.3, speed: 1.5 }); }
        break;
      }
      case 'getup': {
        if (a.time > a.duration * 0.7 || a.finished) { this.go('engage'); a.stop(0.3); }
        break;
      }
      case 'scripted': {
        this.applyRoot(dt, world);
        if (this.sGoal) {
          // cutscene walk: straight to the goal at a set pace
          const to = tmpV.set(this.sGoal.x - this.body.pos.x, 0, this.sGoal.z - this.body.pos.z);
          const d = to.length();
          if (d < 0.2) {
            this.sGoal = null;
            a.locomote(0, dt);
            const r = this.sDone;
            this.sDone = null;
            r?.();
          } else {
            this.turnTo(Math.atan2(to.x, to.z), dt, 4);
            const sp = Math.min(this.sSpeed, d * 1.5 + 0.3);
            world.move(this.body, to.normalize().multiplyScalar(sp * dt), dt);
            a.locomote(sp, dt);
          }
        } else if (!a.current) a.locomote(0, dt);
        break;
      }
    }
    // gaze: aware enemies watch the player
    this.char.gaze.target = this.aware && !p.dead ? p.center().add(tmpV.set(0, 0.35, 0)) : null;
    this.sync();
  }

  // ------------------------------------------------------------------ brain
  /** returns true if it started a committed action */
  private think(dist: number, yawP: number): boolean {
    const g = this.game;
    const p = g.player;
    const M = g.squad.model;
    const hpK = this.hp / this.maxHp;
    const visible = g.squad.visible(this);
    const pressure = g.squad.pressure;
    const pAct = p.act;
    const pVulnerable = pAct === 'heal' || pAct === 'down' || pAct === 'getup' || pAct === 'guardbreak' || (pAct === 'attack' && p.char.animator.after('cancel'));
    const turtle = M.guardRate > 0.45;
    const parrier = M.parryRate > 0.3;
    const kiting = M.retreating > 0.5;
    let best: { kind: 'attack' | 'feint'; atk: AttackDef } | null = null;
    let bestS = 0;
    for (const atk of this.def.attacks) {
      if ((this.cool.get(atk.clip) ?? 0) > 0) continue;
      if (atk.phase !== undefined && hpK > atk.phase) continue;
      if ((atk.weight ?? 1) <= 0) continue;
      const [lo, hi] = atk.range;
      let fit = dist >= lo && dist <= hi ? 1 : dist > hi && dist < hi + 0.8 ? 0.35 : 0;
      if (fit <= 0) continue;
      let s = (atk.weight ?? 1) * fit * (this.def.aggression ?? 0.5) * pressure;
      if (pVulnerable) s += 0.6;
      if (turtle && (atk.unblockable || (atk.guardBreak ?? 1) > 1.4 || atk.heavy)) s += 0.5;
      if (parrier && !atk.heavy && !atk.unblockable) s *= 0.7;
      if (kiting && hi > 3) s += 0.45;
      if (atk.unblockable && !g.squad.claimPerilous(this)) s = 0;
      if (!visible && !this.def.boss) s *= 0.25;
      s *= 0.8 + Math.random() * 0.4;
      if (s > bestS) { bestS = s; best = { kind: 'attack', atk }; }
    }
    // feints against parry-happy players
    if (best && parrier && this.skill > 0.5 && this.feintCool <= 0 && !best.atk.unblockable && Math.random() < 0.35) {
      best = { kind: 'feint', atk: best.atk };
    }
    // threshold: attacks must beat "keep circling"
    const waitScore = 0.18 + Math.random() * 0.1;
    if (best && bestS > waitScore) {
      const token = this.def.boss || g.squad.takeToken(this);
      if (token) {
        if (!visible && !this.def.boss) g.audio.sfx('hollow_alert', this.body.pos, 0.9); // announce off-screen attackers
        if (best.kind === 'feint') { this.feintCool = 8; this.attack(best.atk, true); } else this.attack(best.atk, false);
        return true;
      }
    }
    // movement choice with hysteresis
    const spacing = this.def.spacing ?? 2.6;
    const scores: [Move, number][] = [
      ['approach', dist > spacing + 1.2 ? 0.7 : dist > spacing + 0.4 ? 0.35 : 0],
      ['slot', g.squad.slotFor(this) !== null && dist < spacing + 3 ? 0.45 : 0],
      ['flank', (this.def.flank ?? 0.3) * (g.alive().length > 1 ? 0.5 : 0.1)],
      ['backoff', dist < spacing - 0.8 ? 0.55 : 0],
      ['retreat', !this.def.boss && hpK < 0.25 && hpK < this.hpAtEngage - 0.3 ? (this.def.caution ?? 0.3) * 0.9 : 0],
      ['hold', 0.2],
    ];
    let pick: Move = this.move;
    let ps = this.move === 'hold' ? 0.2 : (scores.find((x) => x[0] === this.move)?.[1] ?? 0) + 0.12;
    for (const [m, sc] of scores) if (sc > ps) { pick = m; ps = sc; }
    this.move = pick;
    void yawP;
    return false;
  }

  private locomote(dt: number, world: World, dist: number, yawP: number): void {
    const p = this.game.player;
    const toP = p.body.pos.clone().sub(this.body.pos).setY(0).normalize();
    const spacing = this.def.spacing ?? 2.6;
    let dir = new THREE.Vector3();
    let speed = 0;
    switch (this.move) {
      case 'approach':
        dir.copy(toP);
        speed = dist > spacing + 5 ? this.def.run : this.def.walk;
        break;
      case 'slot':
      case 'flank': {
        let ang = this.game.squad.slotFor(this);
        if (this.move === 'flank' || ang === null) ang = p.yaw + Math.PI * (this.strafeDir > 0 ? 0.6 : -0.6);
        const ring = spacing + 0.4;
        const target = new THREE.Vector3(p.body.pos.x + Math.sin(ang) * ring, 0, p.body.pos.z + Math.cos(ang) * ring);
        const to = target.sub(this.body.pos).setY(0);
        const d = to.length();
        if (d > 0.4) { dir.copy(to.normalize()); speed = d > 3 ? this.def.run * 0.7 : this.def.walk * 0.75; }
        break;
      }
      case 'backoff':
        dir.copy(toP).negate();
        speed = this.def.walk * 0.8;
        break;
      case 'retreat':
        dir.copy(toP).negate();
        speed = this.def.run * 0.8;
        if (dist > 9) this.move = 'hold';
        break;
      case 'hold': {
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = 1.2 + Math.random() * 2.2; this.strafeDir = Math.random() < 0.5 ? -1 : 1; }
        dir.set(toP.z * this.strafeDir, 0, -toP.x * this.strafeDir);
        speed = this.def.walk * 0.45;
        break;
      }
    }
    this.steer(dt, world, dir, speed, yawP, 5);
  }

  /** steering: separation from allies + obstacle feelers; faces `faceYaw` */
  private steer(dt: number, world: World, dir: THREE.Vector3, speed: number, faceYaw: number, turn: number): void {
    const want = dir.clone();
    // separation
    for (const o of this.game.enemies) {
      if (o === this || o.dead) continue;
      const d = this.body.pos.distanceTo(o.body.pos);
      if (d < 1.8 && d > 1e-3) want.add(this.body.pos.clone().sub(o.body.pos).setY(0).multiplyScalar((1.8 - d) / d * 0.9));
    }
    if (want.lengthSq() > 1e-6) want.normalize();
    // feelers: avoid walking into walls (try the freer side)
    if (speed > 0.01 && want.lengthSq() > 0) {
      const eye = this.body.pos.clone();
      eye.y += 0.7;
      const far = 1.4;
      if (this.game.world.raycast(eye, want, far) < far * 0.95) {
        const l = want.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.8);
        const r = want.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.8);
        const dl = this.game.world.raycast(eye, l, far), dr = this.game.world.raycast(eye, r, far);
        want.copy(dl > dr ? l : r);
      }
    }
    this.speedNow += (speed - this.speedNow) * Math.min(1, dt * 6);
    world.move(this.body, want.multiplyScalar(this.speedNow * dt), dt);
    this.turnTo(faceYaw, dt, turn);
    this.char.animator.locomote(this.speedNow, dt);
  }

  // ------------------------------------------------------------------ reactions
  private considerReaction(dist: number, yawP: number): void {
    const p = this.game.player;
    if (this.reactCool > 0 || dist > 3.6) return;
    // is the player's attack aimed at me?
    const facing = Math.abs(angleDiff(p.yaw, yawP + Math.PI)) < 0.8;
    if (!facing) return;
    const skill = this.skill;
    const M = this.game.squad.model;
    const roll = Math.random();
    // humans react in ~0.15-0.35 s; skilled enemies faster
    const delay = 0.32 - skill * 0.2 + Math.random() * 0.08;
    const blockP = (this.def.block ?? 0) * (0.6 + skill * 0.6) * (M.heavies.v > 2 ? 0.6 : 1);
    const evadeP = skill * 0.45 * (this.def.evade ? 1 : 0.4);
    if (roll < blockP) this.pendingReact = { at: this.time + delay, kind: 'block' };
    else if (roll < blockP + evadeP) this.pendingReact = { at: this.time + delay, kind: 'evade' };
    this.reactCool = 1.6 - skill;
  }

  private startBlock(): void {
    this.go('block');
    this.char.animator.play(this.def.blockClip ?? 'block_start', { fade: 0.06 });
  }

  private startEvade(yawP: number): void {
    const ev = this.def.evade ?? {};
    const M = this.game.squad.model;
    // step away from the side the player tends to finish on
    const r = Math.random();
    let clip = ev.back ?? 'dodge_back';
    if (ev.left && ev.right && r < 0.6) clip = (M.dodgeBias > 0 ? ev.left : ev.right);
    this.go('evade');
    this.yaw = yawP;
    this.char.animator.play(clip, { fade: 0.05 });
    this.game.audio.sfx('whoosh', this.body.pos, 0.4);
  }

  private startRoar(): void {
    this.go('roar');
    this.char.animator.play(this.def.roar!, { fade: 0.15 });
    this.game.audio.sfx(this.def.boss ? 'boss_roar' : 'brute', this.body.pos, 1);
    this.game.cam.addTrauma(0.25);
  }

  private turnTo(y: number, dt: number, rate: number): void {
    const d = angleDiff(this.yaw, y);
    this.yaw += THREE.MathUtils.clamp(d, -rate * dt, rate * dt);
  }

  private sync(): void {
    this.char.root.position.copy(this.body.pos);
    this.char.root.rotation.y = this.yaw;
  }

  private attack(atk: AttackDef, feint: boolean): void {
    this.atk = atk;
    this.hitDone = false;
    this.haveBlade = false;
    this.glintDone = false;
    this.cool.set(atk.clip, atk.cooldown / Math.max(0.6, this.game.squad.pressure));
    this.go(feint ? 'feint' : 'attack');
    this.comboN++;
    // against parry-happy players, vary the swing speed so the timing can't be memorised
    const M = this.game.squad.model;
    const vary = M.parryRate > 0.3 && !this.def.boss ? 0.82 + Math.random() * 0.3 : 1;
    this.char.animator.play(atk.clip, { fade: 0.12, speed: (atk.speed ?? 1) * vary });
  }

  private applyRoot(dt: number, world: World): void {
    const d = this.char.animator.rootDelta;
    let lz = d.y;
    const lx = d.x;
    // don't run through the player
    const p = this.game.player;
    const dist = p.body.pos.distanceTo(this.body.pos) - p.body.radius;
    if (this.state === 'attack' && lz > 0 && dist - lz < 0.9) lz = Math.max(0, dist - 0.9);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    world.move(this.body, tmpV.set(lx * c + lz * s, 0, -lx * s + lz * c), dt);
  }

  private updateBlade(atk: AttackDef): void {
    const ch = this.char;
    const a = ch.animator;
    const w = a.meta(atk.clip)?.events.hit as number[] | undefined;
    if (!w || this.state === 'feint') return;
    const active = a.time >= w[0] && a.time <= w[1];
    const p = this.game.player;
    if (!active || this.hitDone) { this.haveBlade = false; return; }
    let point: THREE.Vector3 | null = null;
    if (ch.bladeBase && ch.bladeTip) {
      const base = ch.bladeBase.getWorldPosition(new THREE.Vector3());
      const tip = ch.bladeTip.getWorldPosition(new THREE.Vector3());
      if (this.haveBlade) point = bladeSweep(this.prevBase, this.prevTip, base, tip, p.body, 0.06);
      this.prevBase.copy(base);
      this.prevTip.copy(tip);
      this.haveBlade = true;
    }
    if (!point && atk.aoe && p.body.pos.distanceTo(this.body.pos) < atk.aoe) point = p.center();
    if (!point && inCone(this.body.pos, this.yaw, p.body, atk.range[1] * 0.9 + 0.4, 0.55)) point = p.center();
    if (!point) return;
    this.hitDone = true;
    const dmg = atk.damage * (this.def.damage ?? 1) * this.game.difficultyDamage;
    const hit: Hit = {
      from: this, damage: dmg, poise: atk.poise ?? 20, heavy: !!atk.heavy, unblockable: atk.unblockable, knock: atk.knock,
      point, dir: p.body.pos.clone().sub(this.body.pos).setY(0).normalize(), kind: 'slash',
    };
    const sq = this.game.squad;
    sq.model.incoming.add();
    const res = p.receive(hit);
    if (res === 'blocked') sq.model.blocks.add();
    if (res === 'parried') sq.model.parries.add();
    if (res === 'dodged') { sq.model.dodges.add(); }
    if (res === 'hit' || res === 'killed') sq.onPlayerHurt();
    this.game.onHit(this, p, hit, res);
    if (res === 'parried') {
      // posture break on a parry: open for a counter
      this.poise -= 45;
      if (this.poise <= 0) this.doStagger();
      else { this.go('hit'); this.char.animator.play(this.def.hurt?.[0] ?? 'hit_front', { fade: 0.05, speed: 0.8 }); }
      sq.releaseToken(this);
    }
  }

  private onEvent(n: string): void {
    if (n === 'swing') this.game.audio.sfx(this.def.scale && this.def.scale > 1.3 ? 'heavy_swing' : 'swing', this.body.pos, 0.6);
    if (n === 'thud') this.game.audio.sfx('thud', this.body.pos, 0.6);
    if (n === 'step') this.game.audio.sfx('step_heavy', this.body.pos, 0.7);
    if (n === 'burst' || n === 'slam') {
      this.game.cam.addTrauma(0.4);
      this.game.particles.burst('dust', this.body.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 1.4, 0.1, Math.cos(this.yaw) * 1.4)), 30);
      this.game.audio.sfx('slam', this.body.pos, 1);
    }
  }

  private doStagger(): void {
    this.staggered = true;
    this.go('stagger');
    this.char.animator.play(this.def.stagger ?? 'guard_break', { fade: 0.05 });
    this.game.audio.sfx('stagger', this.body.pos, 0.9);
    this.game.squad.releaseToken(this);
  }

  receive(hit: Hit): HitResult {
    if (this.dead || this.invulnerable) return 'none';
    if (!this.aware) {
      // backstab on an unaware enemy: heavy bonus
      hit.damage *= 2;
      this.alert();
    }
    const g = this.game;
    g.squad.noise(this.body.pos, 12);
    const facing = Math.abs(angleDiff(this.yaw, Math.atan2(-hit.dir.x, -hit.dir.z))) < 1.2;
    if (this.state === 'block' && facing && !hit.art) {
      this.char.animator.play(this.def.blockClip ?? 'block_hit', { fade: 0.03 });
      this.poise -= hit.poise * (hit.heavy ? 0.9 : 0.5);
      this.stateT = 0;
      if (this.poise <= 0) { this.doStagger(); return 'hit'; }
      return 'blocked';
    }
    const mult = this.staggered ? 1.5 : 1;
    this.hp -= hit.damage * mult;
    this.char.flash(1);
    this.char.face.react('pain', 0.6);
    if (this.def.minHp !== undefined) {
      const floor = this.maxHp * this.def.minHp;
      if (this.hp <= floor) {
        this.hp = floor;
        if (!this.yielded) { this.yielded = true; this.doStagger(); }
        return 'hit';
      }
    }
    if (this.hp <= 0) { this.die(hit); return 'killed'; }
    this.poise -= hit.poise;
    if (this.poise <= 0 && !this.staggered) { this.doStagger(); return 'hit'; }
    if (this.staggered) return 'hit';
    const armor = (this.def.superArmor ?? 0) + (this.state === 'attack' && this.def.boss ? 1 : 0);
    if (this.state === 'attack' && (armor > 0.5 || (this.def.superArmor ?? 0) > Math.random())) return 'armor';
    g.squad.releaseToken(this);
    if (hit.knock && hit.knock > 0.5 && !this.def.boss) {
      this.go('down');
      this.yaw = Math.atan2(-hit.dir.x, -hit.dir.z);
      this.char.animator.play(this.def.knockdown ?? 'knockdown', { fade: 0.05 });
      return 'hit';
    }
    this.go('hit');
    const hurt = this.def.hurt ?? ['hit_front'];
    this.char.animator.play(hurt[Math.floor(Math.random() * hurt.length)], { fade: 0.04, speed: 1.1 });
    return 'hit';
  }

  die(hit?: Hit): void {
    this.dead = true;
    this.hp = 0;
    this.go('dead');
    this.game.squad.releaseToken(this);
    if (hit) this.yaw = Math.atan2(-hit.dir.x, -hit.dir.z);
    this.char.animator.play(this.def.death ?? 'death', { fade: 0.08 });
    this.game.audio.sfx('hollow_die', this.body.pos, 0.8);
    this.char.face.set('pain');
    this.onDeath?.();
  }

  /** scripted: walk to a point (cutscenes); resolves on arrival */
  walkTo(p: THREE.Vector3, speed = 1.3): Promise<void> {
    this.go('scripted');
    this.char.animator.stop(0.3);
    this.sGoal = p.clone();
    this.sSpeed = speed;
    return new Promise((res) => { this.sDone = res; });
  }

  teleport(p: THREE.Vector3, yaw = this.yaw): void {
    this.body.pos.copy(p);
    this.body.vel?.set(0, 0, 0);
    this.yaw = yaw;
    this.home.copy(p);
    this.sync();
  }

  /** leave the scene without dying (cutscenes) */
  vanish(): void {
    this.dead = true;
    this.removed = true;
    this.invulnerable = true;
  }

  /** the boss roars (phase change); returns to the fight afterwards */
  roar(): void { if (this.def.roar && !this.dead) this.startRoar(); }

  perform(clip: string, loop = false): void {
    this.go('scripted');
    this.char.animator.play(clip, { fade: 0.3, loop });
  }

  release(): void { this.go(this.aware ? 'engage' : 'idle'); this.char.animator.stop(0.3); }
}
