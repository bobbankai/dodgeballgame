import * as THREE from 'three/webgpu';
import { Actor, type HitInfo, type HitOutcome } from '@/gameplay/actor';
import type { GameCtx } from '@/gameplay/ctx';
import { G } from '@/physics/physics';
import { instantiateCharacter } from '@/assets/loader';
import { applyStrike, strikeTest } from '@/combat/strike';
import type { Action } from '@/input/input';
import type { Controls, ControlFrame } from './controls';

export type PState = 'loco' | 'attack' | 'block' | 'parry' | 'dodge' | 'hurt' | 'ability' | 'dead' | 'busy';

// --- tuning (feel lives here) -------------------------------------------------------------------------------
const RUN = 4.6;
const SPRINT = 6.6;
const COMBAT_SPEED = 3.3;
const BLOCK_SPEED = 1.9;
const ACCEL = 34;
const DECEL = 28;
const AIR_CONTROL = 0.35;
const GRAVITY = -24;
const JUMP_V = 7.6;
const COYOTE = 0.1;
const PARRY_WINDOW = 0.2;
const BUFFER = 0.2;
const DODGE_COST = 18;
const DODGE_DIST = 2.7;
const OPENING_TIME = 1.1;

export const ABILITY_COST: Record<string, number> = { slow: 25, rewind: 40, echo: 30, shift: 25 };
const ABILITY_CLIP: Record<string, string> = { slow: 'time_slow', rewind: 'rewind', echo: 'echo', shift: 'timeline_shift' };

const approachAngle = (a: number, b: number, maxStep: number) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + THREE.MathUtils.clamp(d, -maxStep, maxStep);
};

export interface PlayerSnapshot {
  pos: [number, number, number];
  yaw: number;
  vel: [number, number, number];
  health: number; stamina: number; guard: number; energy: number;
  state: PState; stateT: number;
  clip: string | null; frame: number;
  attackName: string; openingUntil: number;
}

export class Player extends Actor {
  readonly team = 'player' as const;
  name = 'Ethan';
  state: PState = 'loco';
  stateT = 0;
  stamina = 100;
  guard = 100;
  energy = 100;
  lockTarget: Actor | null = null;
  openingUntil = -1;
  openingTarget: Actor | null = null;
  /** frames recorded this tick (echo source) */
  lastFrame: ControlFrame | null = null;
  onRecord: ((f: ControlFrame) => void) | null = null;
  onAbility: ((name: 'slow' | 'rewind' | 'echo' | 'shift') => void) | null = null;
  /** set by the temporal system while slow is running (for HUD + energy drain) */
  slowActive = false;

  private buf = new Map<Action, number>();
  private held = new Set<Action>();
  private coyote = 0;
  private airTime = 0;
  private landing = 0;
  private attackName = '';
  private attackYaw = 0;
  private lungeDir = new THREE.Vector3();
  private lungeDist = 0;
  private hitDone = new Set<Actor>();
  private combatTimer = 0;
  private dodgeDir = new THREE.Vector3();
  private dodgeClip = 'dodge_F';
  private lastDodgeAt = -9;
  private pendingAbility: 'slow' | 'rewind' | 'echo' | 'shift' | null = null;
  private lastStaminaUse = -9;
  private moveAnimScale = 1;
  private flat = new THREE.Vector3();
  private want = new THREE.Vector3();
  private desired = new THREE.Vector3();

  static async create(ctx: GameCtx, controls: Controls, spawn: THREE.Vector3, yaw = 0, model = 'characters/ethan/ethan.glb'): Promise<Player> {
    const inst = await instantiateCharacter(model);
    const p = new Player(ctx, inst, controls);
    p.body = ctx.physics.createCharacter(spawn, p.radius, p.height, G.PLAYER);
    p.pos.copy(spawn); p.prev.copy(spawn); p.yaw = p.prevYaw = yaw;
    p.anim.play('idle', { fade: 0 });
    p.anim.onEvent = (clip, ev) => p.animEvent(clip, ev);
    p.syncVisual(1);
    return p;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Actor>[1], public controls: Controls) {
    super(ctx, inst);
  }

  // --- derived state -------------------------------------------------------------------------------------------

  get inCombat(): boolean { return this.lockTarget !== null || this.combatTimer > 0; }
  get openingActive(): boolean { return this.ctx.time < this.openingUntil; }
  get speed(): number { return Math.hypot(this.vel.x, this.vel.z); }

  private buffered(a: Action, w = BUFFER): boolean { return this.ctx.time - (this.buf.get(a) ?? -9) <= w; }
  private consume(a: Action): void { this.buf.delete(a); }
  private isHeld(a: Action): boolean { return this.held.has(a); }

  private inIframes(): boolean {
    if (this.state !== 'dodge') return false;
    const ev = this.anim.meta(this.dodgeClip)?.events.iframes;
    if (!ev) return false;
    const f = this.anim.frame;
    return f >= ev[0] && f <= ev[1];
  }

  noteCombat(sec = 4): void { this.combatTimer = Math.max(this.combatTimer, sec); }

  // --- main tick -----------------------------------------------------------------------------------------------

  /** cinematics: the player's input is ignored (Ethan stands, the scene plays) */
  locked = false;

  tick(dt: number): void {
    this.beginTick();
    const frame = this.locked ? { dx: 0, dz: 0, sprint: false, held: [], pressed: [], switchTarget: 0 } : this.controls.next();
    this.lastFrame = frame;
    this.onRecord?.(frame);
    for (const a of frame.pressed) this.buf.set(a, this.ctx.time);
    this.held = new Set(frame.held);
    const d = this.scaledDt(dt);
    this.stateT += d;
    this.combatTimer = Math.max(0, this.combatTimer - d);

    if (this.lockTarget && !this.lockTarget.alive) this.cycleLock(0);
    if (this.buffered('lock', 0.05)) { this.consume('lock'); this.toggleLock(); }

    if (this.alive) {
      switch (this.state) {
        case 'loco': this.tickLoco(d, frame); break;
        case 'attack': this.tickAttack(d, frame); break;
        case 'block': this.tickBlock(d, frame); break;
        case 'parry': this.tickParry(d); break;
        case 'dodge': this.tickDodge(d); break;
        case 'hurt': this.tickHurt(d, frame); break;
        case 'ability': this.tickAbility(d); break;
        case 'busy':
          // scripted one-shots (interact, cinematic beats): hold still until the clip ends
          this.vel.x *= 0.8; this.vel.z *= 0.8;
          if (this.anim.finished) { this.state = 'loco'; this.stateT = 0; }
          break;
        default: this.vel.x *= 0.85; this.vel.z *= 0.85; break;
      }
    } else {
      this.vel.x *= 0.9; this.vel.z *= 0.9;
    }

    this.integrate(d);
    this.anim.update(d);
    this.refreshPose();
    this.regen(d);
  }

  private integrate(d: number): void {
    // gravity / grounding
    if (!this.grounded) {
      this.vel.y = Math.max(-32, this.vel.y + GRAVITY * d);
      this.airTime += d;
    } else if (this.vel.y <= 0) {
      this.vel.y = -2;
    }
    this.desired.set(this.vel.x * d, this.vel.y * d, this.vel.z * d);
    const res = this.ctx.physics.move(this.body, this.desired);
    const wasGrounded = this.grounded;
    this.grounded = res.grounded;
    if (this.grounded) {
      this.coyote = COYOTE;
      if (!wasGrounded && this.airTime > 0.3 && this.state === 'loco') { this.landing = 0.22; this.anim.play('land', { fade: 0.04, restart: true }); }
      if (!wasGrounded) this.ctx.sfx.play('land', { at: this.pos, volume: Math.min(1, this.airTime) });
      this.airTime = 0;
      if (this.vel.y < 0) this.vel.y = -2;
    } else this.coyote = Math.max(0, this.coyote - d);
    // ceiling bump
    if (res.movement.y < this.desired.y - 0.001 && this.vel.y > 0) this.vel.y = 0;
    this.syncFromBody();
  }

  private regen(d: number): void {
    const idleStamina = this.ctx.time - this.lastStaminaUse > 0.7;
    if (idleStamina) this.stamina = Math.min(100, this.stamina + 26 * d);
    if (this.state !== 'block') this.guard = Math.min(100, this.guard + 14 * d);
    if (!this.slowActive && this.state !== 'ability') this.energy = Math.min(100, this.energy + 2.2 * d);
  }

  // --- locomotion ----------------------------------------------------------------------------------------------

  private inputDir(f: ControlFrame, out: THREE.Vector3): number {
    out.set(f.dx, 0, f.dz);
    const m = Math.min(1, out.length());
    if (m > 0.001) out.normalize();
    return m;
  }

  private tickLoco(d: number, f: ControlFrame): void {
    const mag = this.inputDir(f, this.want);
    // --- decide intent priority: ability > dodge > attack > block > jump
    for (const a of ['slow', 'rewind', 'echo', 'shift'] as const) {
      if (this.buffered(a, 0.1) && this.tryAbility(a)) return;
    }
    if (this.buffered('dodge') && this.startDodge(mag > 0.2 ? this.want : null)) return;
    if (this.openingActive && this.buffered('light')) { this.consume('light'); this.startAttack('temporal_counter'); return; }
    if (this.buffered('light')) { this.consume('light'); this.startAttack('light1'); return; }
    if (this.buffered('heavy')) { this.consume('heavy'); this.startAttack('heavy1'); return; }
    if (this.isHeld('block') && this.landing <= 0) { this.enterBlock(); return; }

    // --- speed target
    const combat = this.inCombat;
    let target = 0;
    if (mag > 0.05 && this.landing <= 0.08) {
      if (combat) target = COMBAT_SPEED * mag;
      else target = (f.sprint ? SPRINT : RUN) * (mag < 0.55 ? 0.34 : 1);
    }
    this.accelerate(d, this.want, target, 1);

    // --- jump
    if (this.buffered('jump', 0.12) && (this.grounded || this.coyote > 0) && this.landing <= 0.1) {
      this.consume('jump');
      this.vel.y = JUMP_V;
      this.grounded = false;
      this.coyote = 0;
      this.anim.play('jump', { fade: 0.05, restart: true });
      this.ctx.sfx.play('jump', { at: this.pos });
    }
    this.landing = Math.max(0, this.landing - d);

    // --- facing
    if (this.lockTarget) {
      const t = this.lockTarget;
      this.yaw = approachAngle(this.yaw, Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), 13 * d);
    } else if (this.speed > 0.4) {
      this.yaw = approachAngle(this.yaw, Math.atan2(this.vel.x, this.vel.z), (f.sprint ? 9 : 13) * d);
    }

    this.chooseLocoAnim(f);
  }

  private accelerate(d: number, dir: THREE.Vector3, target: number, control: number): void {
    const air = this.grounded ? 1 : AIR_CONTROL;
    const tx = dir.x * target, tz = dir.z * target;
    const dx = tx - this.vel.x, dz = tz - this.vel.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-5) return;
    const rate = (target > this.speed ? ACCEL : DECEL) * air * control * d;
    const k = Math.min(1, rate / dl);
    this.vel.x += dx * k;
    this.vel.z += dz * k;
  }

  private chooseLocoAnim(f: ControlFrame): void {
    void f;
    const a = this.anim;
    if (!this.grounded) {
      if (this.vel.y > 0.5 && a.current !== 'jump') a.play('jump', { fade: 0.08 });
      else if (this.vel.y <= 0.5 && !(a.current === 'jump' && !a.finished)) a.play('fall', { fade: 0.16 });
      return;
    }
    if (this.landing > 0) return;
    const sp = this.speed;
    const combat = this.inCombat;
    const meta = a.inst.meta;
    if (sp < 0.3) { a.play(combat ? 'idle_combat' : 'idle', { fade: 0.2, speed: 1 }); return; }
    if (combat) {
      this.forward(this.flat);
      const fwd = this.vel.x * this.flat.x + this.vel.z * this.flat.z;
      this.left(this.flat);
      const lft = this.vel.x * this.flat.x + this.vel.z * this.flat.z;
      let clip: string;
      if (Math.abs(lft) > Math.abs(fwd)) clip = lft > 0 ? 'combat_strafe_L' : 'combat_strafe_R';
      else clip = fwd >= 0 ? 'combat_walk_F' : 'combat_walk_B';
      a.play(clip, { fade: 0.14, speed: THREE.MathUtils.clamp(sp / (meta[clip]?.speed ?? 1.6), 0.6, 1.5) });
      return;
    }
    const cur = a.current;
    let clip: string;
    const up = (lo: number, hi: number) => (cur === 'walk' ? hi : lo);
    if (sp < up(2.2, 2.6)) clip = 'walk';
    else if (sp < (cur === 'sprint' ? 5.4 : 5.8)) clip = 'run';
    else clip = 'sprint';
    a.play(clip, { fade: 0.16, speed: THREE.MathUtils.clamp(sp / (meta[clip]?.speed ?? 4), 0.55, 1.4) });
  }

  // --- lock-on -------------------------------------------------------------------------------------------------

  private toggleLock(): void {
    if (!this.lockTarget) {
      this.lockTarget = this.ctx.findTarget(this.pos, this.forward(this.flat), 14, Math.PI * 2);
      return;
    }
    this.cycleLock(1);
  }

  /** Cycle lock to the next-nearest enemy; unlock if none (or only the current one remains and dir === 1). */
  cycleLock(dir: number): void {
    const cur = this.lockTarget;
    const cands = this.ctx.enemies.filter((e) => e.alive && e !== cur && e.pos.distanceTo(this.pos) < 16);
    if (cands.length === 0) { this.lockTarget = null; return; }
    if (dir === 0) { this.lockTarget = cands.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos))[0]; return; }
    // pick the candidate closest in angle to the current target (so repeated presses sweep around)
    const ang = (e: Actor) => Math.atan2(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
    const base = cur ? ang(cur) : this.yaw;
    cands.sort((a, b) => Math.abs(approachAngle(base, ang(a), 99) - base) - Math.abs(approachAngle(base, ang(b), 99) - base));
    this.lockTarget = cands[0];
  }

  // --- attacks -------------------------------------------------------------------------------------------------

  startAttack(name: string): void {
    const meta = this.anim.inst.meta[name];
    if (!meta) return;
    this.state = 'attack';
    this.stateT = 0;
    this.attackName = name;
    this.hitDone.clear();
    this.noteCombat(5);
    this.anim.play(name, { fade: 0.05, restart: true });
    // aim assist: lock target, else nearest in front (or toward stick direction)
    const f = this.lastFrame;
    const stick = f ? this.want.set(f.dx, 0, f.dz) : this.want.set(0, 0, 0);
    const heading = stick.lengthSq() > 0.04 ? stick.clone().normalize() : this.forward(new THREE.Vector3());
    const t = this.lockTarget ?? this.ctx.findTarget(this.pos, heading, 5.5, 1.15);
    if (name === 'temporal_counter' && this.openingTarget?.alive) this.assistTo(this.openingTarget, meta.events.lunge ?? 1);
    else if (t) this.assistTo(t, meta.events.lunge ?? 0.4);
    else { this.attackYaw = Math.atan2(heading.x, heading.z); this.lungeDist = meta.events.lunge ?? 0; }
    this.lungeDir.set(Math.sin(this.attackYaw), 0, Math.cos(this.attackYaw));
    this.ctx.sfx.play('whoosh', { at: this.pos, pitch: name.startsWith('heavy') ? 0.8 : 1 });
  }

  private assistTo(t: Actor, lunge: number): void {
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z;
    this.attackYaw = Math.atan2(dx, dz);
    // aim assist closes real gaps: the authored lunge is the base, scaled up when a target is assisted (stops short of body contact)
    this.lungeDist = THREE.MathUtils.clamp(Math.hypot(dx, dz) - 0.95, 0, lunge * 2.4);
  }

  private nextAttackFor(kind: 'light' | 'heavy'): string {
    const prev = this.attackName;
    if (kind === 'light') {
      const m = /^light(\d)$/.exec(prev);
      return m ? `light${(Number(m[1]) % 4) + 1}` : 'light1';
    }
    if (prev === 'light2' || prev === 'light3') return 'heavy2';
    if (/^light/.test(prev)) return 'heavy1';
    return 'heavy1';
  }

  private tickAttack(d: number, f: ControlFrame): void {
    const meta = this.anim.meta(this.attackName);
    if (!meta) { this.state = 'loco'; return; }
    const ev = meta.events;
    const fr = this.anim.frame;
    const hit0 = ev.hit?.[0] ?? 8;
    this.inputDir(f, this.want);

    // turn toward the target before the strike lands
    if (fr < hit0) this.yaw = approachAngle(this.yaw, this.attackYaw, 18 * d);
    // lunge: carry the body into the strike
    if (fr >= 2 && fr < hit0 && this.lungeDist > 0) {
      const sp = this.lungeDist / Math.max(0.05, (hit0 - 2) / 30);
      this.vel.x = this.lungeDir.x * sp; this.vel.z = this.lungeDir.z * sp;
    } else {
      this.vel.x *= Math.exp(-14 * d); this.vel.z *= Math.exp(-14 * d);
    }

    // hit window
    if (ev.hit && fr >= ev.hit[0] && fr <= ev.hit[1]) {
      for (const c of strikeTest(this, ev, this.ctx.enemies, this.hitDone)) {
        this.hitDone.add(c.target);
        const out = applyStrike(this.ctx, this, this.attackName, ev, c);
        if (out === 'hit' || out === 'killed') this.energy = Math.min(100, this.energy + 3.5);
        this.noteCombat(6);
      }
    }

    // chaining and cancels (buffered input makes these forgiving)
    const cancelOpen = fr >= (ev.cancel ?? 999);
    const postStrike = fr >= hit0;
    if (this.buffered('dodge') && postStrike && this.startDodge(this.want.lengthSq() > 0.04 ? this.want : null)) return;
    if (this.isHeld('block') && fr >= (ev.cancel ?? hit0 + 6) - 2 && this.stamina > 0) { this.enterBlock(); return; }
    if (cancelOpen) {
      if (this.openingActive && this.buffered('light')) { this.consume('light'); this.startAttack('temporal_counter'); return; }
      if (this.buffered('light')) { this.consume('light'); this.startAttack(this.nextAttackFor('light')); return; }
      if (this.buffered('heavy')) { this.consume('heavy'); this.startAttack(this.nextAttackFor('heavy')); return; }
    }
    if (this.anim.finished || fr >= meta.frames - 0.6) { this.attackName = this.attackName; this.state = 'loco'; this.stateT = 0; }
  }

  // --- defence -------------------------------------------------------------------------------------------------

  /** Turn to face a world point (used before interacting with something). */
  faceTowards(p: THREE.Vector3): void {
    this.yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  /** Play a scripted one-shot clip (interact, gestures); control returns when it ends. */
  playAction(clip: string): void {
    if (!this.alive || !this.anim.has(clip)) return;
    this.state = 'busy';
    this.stateT = 0;
    this.anim.play(clip, { fade: 0.12, restart: true });
  }

  private enterBlock(): void {
    this.state = 'block';
    this.stateT = 0;
    this.anim.play('block_start', { fade: 0.06, restart: true });
  }

  private tickBlock(d: number, f: ControlFrame): void {
    const mag = this.inputDir(f, this.want);
    if (!this.isHeld('block')) { this.state = 'loco'; return; }
    if (this.buffered('dodge') && this.startDodge(mag > 0.2 ? this.want : null)) return;
    if (this.buffered('light')) { this.consume('light'); this.startAttack(this.openingActive ? 'temporal_counter' : 'light1'); return; }
    if (this.buffered('heavy')) { this.consume('heavy'); this.startAttack('heavy1'); return; }
    if (this.anim.current === 'block_start' && this.anim.finished) this.anim.play('block_hold', { fade: 0.05 });
    this.accelerate(d, this.want, BLOCK_SPEED * mag, 1);
    const t = this.lockTarget ?? this.ctx.findTarget(this.pos, this.forward(this.flat), 8, Math.PI * 2);
    if (t) this.yaw = approachAngle(this.yaw, Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z), 10 * d);
  }

  private tickParry(d: number): void {
    this.vel.x *= Math.exp(-10 * d); this.vel.z *= Math.exp(-10 * d);
    if (this.openingActive && this.buffered('light') && this.stateT > 0.15) { this.consume('light'); this.startAttack('temporal_counter'); return; }
    if (this.anim.finished || this.stateT > 0.5) this.state = 'loco';
  }

  private startDodge(dir: THREE.Vector3 | null): boolean {
    if (this.stamina < DODGE_COST) return false;
    this.consume('dodge');
    this.stamina -= DODGE_COST;
    this.lastStaminaUse = this.ctx.time;
    this.lastDodgeAt = this.ctx.time;
    const fwd = this.forward(new THREE.Vector3());
    const lft = this.left(new THREE.Vector3());
    let clip = 'dodge_B';
    const wd = dir ? dir.clone() : fwd.clone().multiplyScalar(-1);
    if (dir) {
      const fComp = wd.dot(fwd), lComp = wd.dot(lft);
      if (this.lockTarget) clip = Math.abs(lComp) > Math.abs(fComp) ? (lComp > 0 ? 'dodge_L' : 'dodge_R') : (fComp >= 0 ? 'dodge_F' : 'dodge_B');
      else { clip = 'dodge_F'; this.yaw = Math.atan2(wd.x, wd.z); }
    }
    this.dodgeClip = clip;
    this.dodgeDir.copy(wd).setY(0).normalize();
    this.state = 'dodge';
    this.stateT = 0;
    this.noteCombat(4);
    this.anim.play(clip, { fade: 0.04, restart: true });
    this.ctx.sfx.play('dodge', { at: this.pos });
    return true;
  }

  private tickDodge(d: number): void {
    const meta = this.anim.meta(this.dodgeClip);
    const fr = this.anim.frame;
    const N = meta?.frames ?? 22;
    const speed = DODGE_DIST / ((N - 10) / 30);
    if (fr >= 3 && fr < N - 7) { this.vel.x = this.dodgeDir.x * speed; this.vel.z = this.dodgeDir.z * speed; }
    else { this.vel.x *= Math.exp(-12 * d); this.vel.z *= Math.exp(-12 * d); }
    const cancel = meta?.events.cancel ?? N - 6;
    if (fr >= cancel - 4) {
      if (this.buffered('light')) { this.consume('light'); this.startAttack('light1'); return; }
      if (this.buffered('heavy')) { this.consume('heavy'); this.startAttack('heavy3'); return; }
    }
    if (this.anim.finished || fr >= N - 0.6) this.state = 'loco';
  }

  // --- damage --------------------------------------------------------------------------------------------------

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive || this.invulnerable) return 'ignored';
    if (this.inIframes()) return 'dodged';
    const src = hit.attacker?.pos ?? hit.point; // environmental hits (doors, hazards) have no attacker
    const toAtk = this.tmp.set(src.x - this.pos.x, 0, src.z - this.pos.z).normalize();
    const facing = this.forward(this.flat).dot(toAtk) > 0.15;
    this.noteCombat(6);
    if ((this.state === 'block' || this.state === 'parry') && facing && !hit.unblockable) {
      const pressedAt = this.buf.get('block') ?? -9;
      const sinceBlock = this.state === 'parry' ? 0 : this.ctx.time - Math.max(pressedAt, this.ctx.time - this.stateT);
      if ((this.state === 'parry' || sinceBlock <= PARRY_WINDOW) && !hit.guardbreak) {
        this.enterParry(hit);
        return 'parried';
      }
      if (hit.guardbreak || this.guard <= hit.damage * 0.9) {
        this.guard = 0;
        this.takeDamage(hit.damage * 0.5);
        this.enterHurt('stagger', hit, 1.2);
        return this.alive ? 'hit' : 'killed';
      }
      this.guard -= hit.damage * 0.9 + hit.stagger * 4;
      this.takeDamage(hit.damage * 0.1);
      this.anim.play('block_hit', { fade: 0.03, restart: true });
      this.vel.x += hit.dir.x * 2.6; this.vel.z += hit.dir.z * 2.6;
      return 'blocked';
    }
    this.takeDamage(hit.damage);
    this.ctx.post.u.hurt.value = Math.min(1, this.ctx.post.u.hurt.value + 0.55);
    if (!this.alive) { this.die(hit); return 'killed'; }
    const heavy = hit.stagger >= 1.5 ? 'stagger' : hit.heavy ? 'hit_heavy' : 'hit_light';
    this.enterHurt(heavy, hit, hit.heavy ? 1 : 0.5);
    return 'hit';
  }

  private takeDamage(n: number): void {
    this.health = Math.max(0, this.health - n);
    if (this.health <= 0) this.alive = false;
  }

  private enterHurt(clip: string, hit: HitInfo, knock: number): void {
    this.state = 'hurt';
    this.stateT = 0;
    this.anim.play(clip, { fade: 0.04, restart: true });
    this.vel.x = hit.dir.x * 3.2 * knock; this.vel.z = hit.dir.z * 3.2 * knock;
    this.yaw = approachAngle(this.yaw, Math.atan2(-hit.dir.x, -hit.dir.z), 1.2);
    this.hurtClip = clip;
  }
  private hurtClip = 'hit_light';

  private tickHurt(d: number, f: ControlFrame): void {
    this.vel.x *= Math.exp(-7 * d); this.vel.z *= Math.exp(-7 * d);
    const meta = this.anim.meta(this.hurtClip);
    const N = meta?.frames ?? 16;
    // let the player act out of a light hit a little early (so combat never feels stuck)
    const early = this.hurtClip === 'hit_light' ? 0.45 : 0.62;
    if (this.anim.frame > N * early && this.buffered('dodge') && this.startDodge(this.inputDir(f, this.want) > 0.2 ? this.want : null)) return;
    if (this.anim.finished || this.anim.frame >= N - 0.6) this.state = 'loco';
  }

  private enterParry(hit: HitInfo): void {
    this.state = 'parry';
    this.stateT = 0;
    this.anim.play('parry', { fade: 0.02, restart: true });
    this.openingUntil = this.ctx.time + OPENING_TIME;
    this.openingTarget = hit.attacker;
    this.energy = Math.min(100, this.energy + 12);
    this.guard = Math.min(100, this.guard + 25);
    hit.attacker.staggerFor(1.3 + hit.stagger * 0.3);
    this.ctx.post.u.flash.value = Math.max(this.ctx.post.u.flash.value, 0.35);
  }

  staggerFor(seconds: number): void {
    if (!this.alive) return;
    this.state = 'hurt';
    this.stateT = 0;
    this.hurtClip = 'stagger';
    this.anim.play('stagger', { fade: 0.04, restart: true });
    void seconds;
  }

  private die(hit: HitInfo): void {
    this.state = 'dead';
    this.anim.play('defeat', { fade: 0.05, restart: true });
    this.vel.x = hit.dir.x * 2; this.vel.z = hit.dir.z * 2;
    this.lockTarget = null;
  }

  // --- abilities -----------------------------------------------------------------------------------------------

  tryAbility(name: 'slow' | 'rewind' | 'echo' | 'shift'): boolean {
    this.consume(name === 'shift' ? 'shift' : name);
    // slow is a toggle: pressing it again while active ends it for free
    if (name === 'slow' && this.slowActive) { this.onAbility?.('slow'); return true; }
    const cost = ABILITY_COST[name];
    if (this.energy < cost) { this.ctx.sfx.play('deny'); return false; }
    this.energy -= cost;
    this.state = 'ability';
    this.stateT = 0;
    this.pendingAbility = name;
    this.anim.play(ABILITY_CLIP[name], { fade: 0.08, restart: true });
    return true;
  }

  private tickAbility(d: number): void {
    this.vel.x *= Math.exp(-10 * d); this.vel.z *= Math.exp(-10 * d);
    if (this.anim.finished) { this.state = 'loco'; this.pendingAbility = null; }
  }

  private animEvent(clip: string, ev: string): void {
    if (ev === 'activate' && this.pendingAbility) {
      const a = this.pendingAbility;
      this.pendingAbility = null;
      this.onAbility?.(a);
    }
    void clip;
  }

  // --- rewind --------------------------------------------------------------------------------------------------

  snapshot(): PlayerSnapshot {
    return {
      pos: [this.pos.x, this.pos.y, this.pos.z], yaw: this.yaw, vel: [this.vel.x, this.vel.y, this.vel.z],
      health: this.health, stamina: this.stamina, guard: this.guard, energy: this.energy,
      state: this.state, stateT: this.stateT, clip: this.anim.current, frame: this.anim.frame,
      attackName: this.attackName, openingUntil: this.openingUntil,
    };
  }

  restore(s: PlayerSnapshot, keepEnergy = true): void {
    this.pos.set(...s.pos); this.prev.copy(this.pos); this.yaw = this.prevYaw = s.yaw;
    this.vel.set(...s.vel);
    this.health = Math.max(this.health, s.health); // rewind never kills and never takes health that has been regained
    this.stamina = s.stamina; this.guard = s.guard;
    if (!keepEnergy) this.energy = s.energy;
    this.state = s.state === 'dead' ? 'loco' : s.state; this.stateT = s.stateT;
    this.attackName = s.attackName; this.openingUntil = s.openingUntil;
    this.alive = this.health > 0;
    this.ctx.physics.teleport(this.body, this.pos);
    if (s.clip) this.anim.restore(s.clip, s.frame);
  }

  /** Respawn at a checkpoint. */
  respawn(at: THREE.Vector3, yaw: number): void {
    this.alive = true; this.health = this.maxHealth; this.stamina = 100; this.guard = 100;
    this.energy = Math.max(this.energy, 60);
    this.state = 'loco'; this.stateT = 0; this.vel.set(0, 0, 0);
    this.pos.copy(at); this.prev.copy(at); this.yaw = this.prevYaw = yaw;
    this.ctx.physics.teleport(this.body, at);
    this.anim.play('idle', { fade: 0, restart: true });
    this.lockTarget = null;
  }
}
