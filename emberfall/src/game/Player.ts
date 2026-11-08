// Kaede: the player controller.
import * as THREE from 'three';
import type { Character } from './Character';
import { makeBody, type Body, type World } from './World';
import type { Input } from '../core/Input';
import type { CameraRig } from './CameraRig';
import { angleDiff, bladeSweep, inCone, yawTo, type Combatant, type Hit, type HitResult } from './Combat';
import type { Game } from './Game';
import { StatusEffects, inflictionOf } from '../combat/Status';

type Act = 'attack' | 'heavy' | 'dodge' | 'block' | 'parry' | 'hit' | 'down' | 'getup' | 'art' | 'heal' | 'finisher' | 'interact' | 'death' | 'draw' | 'guardbreak' | 'scripted';

const COMBO = ['attack_1', 'attack_2', 'attack_3', 'attack_4'];
const COMBO_DMG = [11, 12, 14, 26];
const COMBO_POISE = [10, 10, 14, 35];
export const ARTS = [
  { clip: 'art_whirl', name: 'Ember Whirl', cost: 35, dmg: 22, poise: 25, chapter: 1 },
  { clip: 'art_rising', name: 'Rising Flame', cost: 40, dmg: 34, poise: 60, chapter: 2 },
  { clip: 'art_burst', name: 'Cinder Burst', cost: 55, dmg: 46, poise: 70, chapter: 3 },
];

export class Player implements Combatant {
  team = 'player' as const;
  name = 'Kaede';
  body: Body;
  yaw = 0;
  hp = 100;
  /** burn, bleed, frost and blight */
  readonly status = new StatusEffects(() => this.maxHp);
  private statusFxT = 0;
  maxHp = 100;
  ember = 0;
  maxEmber = 100;
  guard = 100;
  heals = 3;
  maxHeals = 3;
  dead = false;
  drawn = false;
  artsUnlocked = 1;
  artIndex = 0;
  speed = 0;
  lock: Combatant | null = null;
  act: Act | null = null;
  private combo = 0;
  private queued = false;
  private hitSet = new Set<Combatant>();
  private prevBase = new THREE.Vector3();
  private prevTip = new THREE.Vector3();
  private haveBlade = false;
  private invuln = 0;
  private blockPressT = -10;
  private time = 0;
  private charge = 0;
  private combatT = 0;
  private parryT = 0;
  private healGiven = false;
  /** set by levels: freeze input (cutscenes) */
  controllable = true;
  /** perfect-dodge window bookkeeping */
  private dodgeStartT = -10;
  private aimTarget: Combatant | null = null;
  readonly vel = new THREE.Vector3();
  godMode = false;

  constructor(public char: Character, private game: Game) {
    this.body = makeBody(char.root.position, 0.32, 1.7);
    this.char.animator.onEvent = (n, v) => this.onEvent(n, v);
    this.setLocomotion();
  }

  center(out = new THREE.Vector3()): THREE.Vector3 { return out.set(this.body.pos.x, this.body.pos.y + 1.2, this.body.pos.z); }
  targetable(): boolean { return !this.dead; }

  private setLocomotion(): void {
    const a = this.char.animator;
    if (this.drawn) a.setLocomotion('idle', ['walk', 'run', 'sprint']);
    else a.setLocomotion('idle_relaxed', ['walk_relaxed', 'run_relaxed', 'sprint']);
  }

  setDrawn(d: boolean): void {
    if (d === this.drawn) return;
    this.drawn = d;
    this.char.holster(!d);
    this.setLocomotion();
  }

  teleport(p: THREE.Vector3, yaw: number): void {
    this.body.pos.copy(p);
    this.body.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.char.root.position.copy(p);
    this.char.root.rotation.y = yaw;
  }

  private play(act: Act, clip: string, opts: { fade?: number; speed?: number; loop?: boolean } = {}): void {
    this.act = act;
    this.char.animator.play(clip, opts);
    this.hitSet.clear();
    this.haveBlade = false;
  }

  private endAction(fade = 0.2): void {
    this.act = null;
    this.char.animator.stop(fade);
    this.game.trail.active = false;
  }

  /** choose an enemy to aim at: lock target, else the most "in front" enemy nearby */
  private pickAim(dir: THREE.Vector3 | null): Combatant | null {
    if (this.lock && !this.lock.dead) return this.lock;
    let best: Combatant | null = null;
    let bestScore = Infinity;
    const fwd = dir && dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.z) : this.yaw;
    for (const e of this.game.enemies) {
      if (e.dead || !e.targetable()) continue;
      const d = e.body.pos.distanceTo(this.body.pos);
      if (d > 4.5) continue;
      const ang = Math.abs(angleDiff(fwd, yawTo(this.body.pos, e.body.pos)));
      if (ang > 1.4) continue;
      const score = d + ang * 2.2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  private faceAim(dir: THREE.Vector3 | null, snap = true): void {
    const t = this.pickAim(dir);
    this.aimTarget = t;
    if (t) this.yaw = yawTo(this.body.pos, t.body.pos);
    else if (dir && dir.lengthSq() > 0.01 && snap) this.yaw = Math.atan2(dir.x, dir.z);
  }

  private startAttack(i: number, dir: THREE.Vector3 | null): void {
    if (!this.drawn) this.setDrawn(true);
    this.combo = i;
    this.queued = false;
    this.faceAim(dir);
    this.play('attack', COMBO[i], { fade: i === 0 ? 0.08 : 0.06 });
    this.combatT = 0;
    this.char.face.react(i === 3 ? 'shout' : 'effort', 0.55, i === 3 ? 1 : 0.8);
  }

  update(dt: number, input: Input, cam: CameraRig, world: World): void {
    this.time += dt;
    this.tickStatus(dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.parryT = Math.max(0, this.parryT - dt);
    this.combatT += dt;
    const a = this.char.animator;
    const moveIn = this.controllable ? input.move : new THREE.Vector2();
    const dir = cam.moveDir(moveIn);
    const mag = Math.min(1, moveIn.length());
    if (this.controllable && input.peek('block', 0.05) && !input.down('block')) { /* tap */ }
    if (this.controllable && input.pressed('block', 0.05)) this.blockPressT = this.time;
    // guard regenerates when not blocking
    if (this.act !== 'block') this.guard = Math.min(100, this.guard + dt * 22);

    // sheathe automatically out of combat
    const threat = this.game.enemies.some((e) => !e.dead && e.aware && e.body.pos.distanceTo(this.body.pos) < 18);
    if (threat) this.combatT = 0;
    if (!this.act && this.drawn && this.combatT > 6) this.setDrawn(false);
    if (!this.act && !this.drawn && threat && this.controllable) this.setDrawn(true);

    // lock-on
    if (this.controllable && input.pressed('lock')) {
      if (this.lock) this.lock = null;
      else {
        let best: Combatant | null = null;
        let bd = 1e9;
        const camFwd = cam.moveDir(new THREE.Vector2(0, 1));
        for (const e of this.game.enemies) {
          if (e.dead || !e.targetable()) continue;
          const d = e.body.pos.distanceTo(this.body.pos);
          if (d > 18) continue;
          const to = e.body.pos.clone().sub(this.body.pos).setY(0).normalize();
          const score = d * (1.6 - to.dot(camFwd));
          if (score < bd) { bd = score; best = e; }
        }
        this.lock = best;
      }
    }
    if (this.lock && (this.lock.dead || this.lock.body.pos.distanceTo(this.body.pos) > 24)) this.lock = null;

    if (this.dead) {
      this.applyRoot(dt, world);
      return;
    }

    if (!this.act) this.freeUpdate(dt, input, dir, mag, world);
    else this.actionUpdate(dt, input, dir, world);

    this.updateFace(threat);
    // sword trail + hit detection during hit windows
    this.updateBlade();
    this.char.root.position.copy(this.body.pos);
    this.char.root.rotation.y = this.yaw;
    void a;
  }

  /** mood and gaze: who she looks at and how she feels about it */
  private updateFace(threat: boolean): void {
    const f = this.char.face;
    const g = this.char.gaze;
    if (this.game.cinematic) return; // the director drives faces in cutscenes
    let mood = threat ? 'determined' : 'calm';
    if (this.act === 'heavy') mood = 'fierce';
    if (this.hp < this.maxHp * 0.3) mood = 'pain';
    if (f.moodName !== mood) f.set(mood, mood === 'pain' ? 0.55 : 1);
    // gaze: lock target, else the nearest aware enemy, else nothing (look ahead)
    let look: THREE.Vector3 | null = null;
    if (this.lock && !this.lock.dead) look = this.lock.center().add(new THREE.Vector3(0, 0.35, 0));
    else {
      let best = 12;
      for (const e of this.game.enemies) {
        if (e.dead || !e.aware) continue;
        const d = e.body.pos.distanceTo(this.body.pos);
        if (d < best) { best = d; look = e.center().add(new THREE.Vector3(0, 0.35, 0)); }
      }
    }
    g.target = look;
    g.headWeight = this.act === 'attack' || this.act === 'dodge' ? 0.15 : 0.6;
  }

  private freeUpdate(dt: number, input: Input, dir: THREE.Vector3, mag: number, world: World): void {
    const a = this.char.animator;
    const sprint = input.down('sprint') && !this.lock;
    const want = (mag < 0.05 ? 0 : mag < 0.55 ? 1.6 * (mag / 0.55) : (sprint ? 6.2 : this.drawn ? 4.3 : 4.6) * Math.min(1, mag)) * this.status.speedFactor;
    this.speed += (want - this.speed) * Math.min(1, dt * (want > this.speed ? 7 : 10));
    // facing
    if (this.lock && this.drawn) {
      const ty = yawTo(this.body.pos, this.lock.body.pos);
      this.yaw += angleDiff(this.yaw, ty) * Math.min(1, dt * 10);
    } else if (mag > 0.05) {
      const ty = Math.atan2(dir.x, dir.z);
      const turn = this.speed > 5 ? 6 : 12;
      this.yaw += angleDiff(this.yaw, ty) * Math.min(1, dt * turn);
    }
    const mv = mag > 0.05 ? dir.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const disp = mv.multiplyScalar(this.speed * dt);
    world.move(this.body, disp, dt);
    a.locomote(this.speed, dt);
    this.game.cam.punch(this.speed > 5.5 ? 0.0 : 0);
    if (!this.controllable) return;

    // actions
    if (input.pressed('attack')) { this.startAttack(0, mag > 0.1 ? dir : null); return; }
    if (input.pressed('dodge')) { this.dodge(dir, mag); return; }
    if (input.down('heavy') || input.pressed('heavy')) {
      if (!this.drawn) this.setDrawn(true);
      this.faceAim(mag > 0.1 ? dir : null);
      this.charge = 0;
      this.play('heavy', 'heavy_start', { fade: 0.1 });
      return;
    }
    if (input.down('block') && this.drawn) { this.play('block', 'block_start', { fade: 0.06 }); return; }
    if (input.down('block') && !this.drawn) { this.setDrawn(true); this.play('block', 'block_start', { fade: 0.06 }); return; }
    const artBtn = input.pressed('art') ? this.artIndex : input.pressed('art1') ? 0 : input.pressed('art2') ? 1 : input.pressed('art3') ? 2 : -1;
    if (artBtn >= 0) { this.art(artBtn, mag > 0.1 ? dir : null); return; }
    if (input.pressed('heal') && this.heals > 0 && this.hp < this.maxHp) {
      if (!this.drawn) this.setDrawn(true);
      this.heals--;
      this.healGiven = false;
      this.play('heal', 'heal', { fade: 0.15 });
      return;
    }
  }

  private dodge(dir: THREE.Vector3, mag: number): void {
    if (!this.drawn) this.setDrawn(true);
    let clip = 'dodge_back';
    if (mag > 0.2) {
      if (this.lock) {
        const rel = angleDiff(this.yaw, Math.atan2(dir.x, dir.z));
        if (Math.abs(rel) < Math.PI / 4) clip = 'dodge_fwd';
        else if (Math.abs(rel) > Math.PI * 3 / 4) clip = 'dodge_back';
        else clip = rel > 0 ? 'dodge_left' : 'dodge_right';
      } else {
        this.yaw = Math.atan2(dir.x, dir.z);
        clip = 'dodge_fwd';
      }
    }
    this.play('dodge', clip, { fade: 0.05 });
    this.dodgeStartT = this.time;
    const m = this.game.squad.model;
    if (clip === 'dodge_left') m.dodgeLeft.add(); else if (clip === 'dodge_right') m.dodgeRight.add(); else if (clip === 'dodge_back') m.dodgeBack.add();
    this.game.audio.sfx('whoosh', this.body.pos, 0.6);
  }

  art(i: number, dir: THREE.Vector3 | null): void {
    if (i >= this.artsUnlocked) { this.game.hud.toast('That art has not been learned yet'); return; }
    const art = ARTS[i];
    if (this.ember < art.cost) { this.game.hud.toast('Not enough ember'); this.game.audio.sfx('deny', this.body.pos, 0.5); return; }
    if (!this.drawn) this.setDrawn(true);
    this.ember -= art.cost;
    this.faceAim(dir);
    this.play('art', art.clip, { fade: 0.08 });
    this.game.audio.sfx('ignite', this.body.pos, 0.9);
    this.char.face.react('shout', 0.9);
  }

  private actionUpdate(dt: number, input: Input, dir: THREE.Vector3, world: World): void {
    const a = this.char.animator;
    const act = this.act!;
    const t = a.time;
    const ctl = this.controllable;
    // face the target during the wind-up of attacks
    if ((act === 'attack' || act === 'heavy' || act === 'art') && this.aimTarget && !this.aimTarget.dead && !a.after('hit')) {
      const ty = yawTo(this.body.pos, this.aimTarget.body.pos);
      this.yaw += angleDiff(this.yaw, ty) * Math.min(1, dt * 14);
    }
    this.applyRoot(dt, world);

    switch (act) {
      case 'attack': {
        if (ctl && input.pressed('attack', 0.5) && t > 0.1) this.queued = true;
        const canCancel = a.after('cancel');
        if (this.queued && canCancel) {
          if (this.combo < COMBO.length - 1) { this.startAttack(this.combo + 1, dir.lengthSq() > 0.01 ? dir : null); return; }
        }
        const hitW = a.meta(a.current ?? '')?.events.hit as number[] | undefined;
        const inActive = hitW ? t >= hitW[0] && t <= hitW[1] : false;
        if (ctl && !inActive && input.pressed('dodge')) { this.dodge(dir, input.move.length()); return; }
        if (ctl && canCancel && input.pressed('heavy')) { this.charge = 0; this.play('heavy', 'heavy_start', { fade: 0.08 }); return; }
        if (ctl && canCancel && input.move.lengthSq() > 0.1 && !this.queued) { this.endAction(0.25); return; }
        if (a.finished) { this.combo = 0; this.endAction(0.2); }
        break;
      }
      case 'heavy': {
        const cur = a.current;
        if (cur === 'heavy_start' && a.finished) a.play('heavy_hold', { fade: 0.05, loop: true });
        if (cur !== 'heavy_release') {
          this.charge = Math.min(1.5, this.charge + dt);
          if (this.charge > 0.5 && Math.random() < dt * 30) {
            const tip = this.bladeTip();
            if (tip) this.game.particles.burst('ember', tip, 1);
          }
          const released = !ctl || !input.down('heavy');
          if (released && this.charge > 0.25) {
            this.play('heavy', 'heavy_release', { fade: 0.04 });
            this.game.audio.sfx('heavy_swing', this.body.pos, 1);
          } else if (released && this.charge <= 0.25 && cur === 'heavy_hold') {
            this.play('heavy', 'heavy_release', { fade: 0.04 });
          }
          if (ctl && input.pressed('dodge')) { this.dodge(dir, input.move.length()); return; }
        } else if (a.finished || (a.after('cancel') && ctl && (input.move.lengthSq() > 0.1 || input.peek('attack')))) {
          this.endAction(0.2);
          if (ctl && input.pressed('attack')) this.startAttack(0, dir.lengthSq() > 0.01 ? dir : null);
        }
        break;
      }
      case 'dodge': {
        if (a.after('cancel')) {
          if (ctl && input.pressed('attack')) { this.startAttack(0, dir.lengthSq() > 0.01 ? dir : null); return; }
          if (ctl && input.pressed('dodge')) { this.dodge(dir, input.move.length()); return; }
          if (a.finished || (ctl && input.move.lengthSq() > 0.1)) this.endAction(0.18);
        }
        break;
      }
      case 'block': {
        const cur = a.current;
        if (cur === 'block_start' && a.finished) a.play('block_hold', { fade: 0.05, loop: true });
        if (cur === 'block_hit' && a.finished) a.play('block_hold', { fade: 0.08, loop: true });
        // walk slowly while guarding
        const dirN = dir.clone();
        if (dirN.lengthSq() > 0.01) world.move(this.body, dirN.normalize().multiplyScalar(1.1 * dt * Math.min(1, input.move.length())), dt);
        if (this.lock) this.yaw += angleDiff(this.yaw, yawTo(this.body.pos, this.lock.body.pos)) * Math.min(1, dt * 10);
        if (!ctl || !input.down('block')) { this.endAction(0.15); break; }
        if (input.pressed('attack')) { this.startAttack(0, null); return; }
        if (input.pressed('dodge')) { this.dodge(dir, input.move.length()); return; }
        break;
      }
      case 'parry': {
        if (a.after('cancel') && ctl && input.pressed('attack')) {
          // riposte: jump straight to the strong cut
          this.startAttack(2, null);
          return;
        }
        if (a.finished) this.endAction(0.15);
        break;
      }
      case 'heal': {
        if (!this.healGiven && a.after('heal')) {
          this.healGiven = true;
          this.hp = Math.min(this.maxHp, this.hp + 45 * this.status.healFactor);
          // the gourd's warmth puts out fire and stops bleeding
          this.status.cure('burn');
          this.status.cure('bleed');
          this.char.face.react('relief', 1.4);
          this.game.particles.burst('heal', this.center(), 40);
          this.game.audio.sfx('heal', this.body.pos, 0.8);
        }
        if (a.finished) this.endAction(0.2);
        break;
      }
      case 'art':
      case 'finisher':
      case 'interact':
      case 'draw':
      case 'guardbreak':
      case 'scripted': {
        if (a.finished || (a.after('cancel') && ctl && act !== 'finisher' && input.move.lengthSq() > 0.1)) this.endAction(0.25);
        break;
      }
      case 'hit': {
        if (a.after('cancel') && ctl && input.pressed('dodge')) { this.dodge(dir, input.move.length()); return; }
        if (a.finished) this.endAction(0.15);
        break;
      }
      case 'down': {
        if (a.current === 'knockdown' && a.finished) {
          this.play('getup', 'getup', { fade: 0.25, speed: 1.6 });
          this.invuln = 1.2;
        }
        break;
      }
      case 'getup': {
        this.invuln = Math.max(this.invuln, 0.1);
        if (a.time > a.duration * 0.72 || a.finished) this.endAction(0.3);
        break;
      }
      case 'death':
        break;
    }
  }

  /** root motion, with magnetism: stop strikes at sword range from the target instead of overrunning */
  private applyRoot(dt: number, world: World): void {
    const d = this.char.animator.rootDelta;
    let lx = d.x, lz = d.y;
    if ((this.act === 'attack' || this.act === 'art' || this.act === 'heavy' || this.act === 'finisher') && this.aimTarget && !this.aimTarget.dead) {
      const dist = this.aimTarget.body.pos.distanceTo(this.body.pos) - this.aimTarget.body.radius;
      const stopAt = this.act === 'finisher' ? 0.75 : 0.95;
      if (lz > 0 && dist - lz < stopAt) lz = Math.max(0, dist - stopAt);
    }
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const disp = new THREE.Vector3(lx * c + lz * s, 0, -lx * s + lz * c);
    world.move(this.body, disp, dt);
  }

  private bladeTip(): THREE.Vector3 | null {
    return this.char.bladeTip ? this.char.bladeTip.getWorldPosition(new THREE.Vector3()) : null;
  }

  private updateBlade(): void {
    const ch = this.char;
    if (!ch.bladeBase || !ch.bladeTip || !this.drawn) { this.game.trail.active = false; return; }
    const base = ch.bladeBase.getWorldPosition(new THREE.Vector3());
    const tip = ch.bladeTip.getWorldPosition(new THREE.Vector3());
    const a = ch.animator;
    const cur = a.current;
    const meta = cur ? a.meta(cur) : undefined;
    const hitW = meta?.events.hit as number[] | undefined;
    const swinging = !!hitW && a.time >= hitW[0] - 0.08 && a.time <= hitW[1] + 0.04;
    this.game.trail.active = swinging;
    const fire = this.act === 'art' || (this.act === 'heavy' && this.charge > 0.8);
    if (fire) {
      this.game.trail.setColors(new THREE.Color(9, 4, 1.2), new THREE.Color(3, 0.5, 0.05), 1.4);
      if (swinging) this.game.particles.burst('fire', tip.clone().lerp(base, Math.random()), 2);
    } else this.game.trail.setColors(new THREE.Color(3.2, 3.0, 2.8), new THREE.Color(0.9, 0.45, 0.25), 0.9);
    const active = !!hitW && a.time >= hitW[0] && a.time <= hitW[1];
    if (active && this.haveBlade) this.sweep(this.prevBase, this.prevTip, base, tip);
    this.prevBase.copy(base);
    this.prevTip.copy(tip);
    this.haveBlade = true;
  }

  private sweep(pb0: THREE.Vector3, pt0: THREE.Vector3, pb1: THREE.Vector3, pt1: THREE.Vector3): void {
    const cur = this.char.animator.current ?? '';
    for (const e of this.game.enemies) {
      if (e.dead || !e.targetable() || this.hitSet.has(e)) continue;
      let point = bladeSweep(pb0, pt0, pb1, pt1, e.body);
      const multi = cur === 'art_whirl';
      if (!point && inCone(this.body.pos, this.yaw, e.body, multi ? 2.4 : 2.1, multi ? Math.PI : 0.9)) point = e.center().lerp(pt1, 0.3);
      if (!point) continue;
      this.hitSet.add(e);
      let dmg = 10, poise = 10, heavy = false, art = false, knock = 0;
      const ci = COMBO.indexOf(cur);
      if (ci >= 0) { dmg = COMBO_DMG[ci]; poise = COMBO_POISE[ci]; heavy = ci === 3; }
      else if (cur === 'heavy_release') { const k = Math.min(1.5, this.charge) / 1.5; dmg = 18 + 34 * k; poise = 30 + 50 * k; heavy = true; knock = k > 0.8 ? 1 : 0; }
      else if (cur === 'finisher') { dmg = 120; poise = 100; heavy = true; }
      else {
        const ad = ARTS.find((x) => x.clip === cur);
        if (ad) { dmg = ad.dmg; poise = ad.poise; heavy = true; art = true; knock = cur === 'art_rising' || cur === 'art_burst' ? 1 : 0; }
      }
      const hdir = e.body.pos.clone().sub(this.body.pos).setY(0).normalize();
      const hit: Hit = { from: this, damage: dmg, poise, heavy, point, dir: hdir, kind: art ? 'fire' : 'slash', art, knock };
      const res = e.receive(hit);
      this.game.onHit(this, e, hit, res);
      if ((res === 'hit' || res === 'killed' || res === 'armor') && this.status.emberRegen) this.ember = Math.min(this.maxEmber, this.ember + (art ? 2 : heavy ? 9 : 6));
      if (cur === 'art_whirl') this.hitSetClearLater(e);
    }
  }

  /** the whirl hits each enemy up to four times */
  private hitSetClearLater(e: Combatant): void {
    window.setTimeout(() => this.hitSet.delete(e), 140);
  }

  private onEvent(n: string, v: number | number[]): void {
    const g = this.game;
    if (n === 'iframes' && Array.isArray(v)) this.invuln = v[1] - v[0] + 0.02;
    if (n === 'swing') g.audio.sfx('swing', this.body.pos, 0.7);
    if (n === 'whoosh') g.audio.sfx('whoosh', this.body.pos, 0.5);
    if (n === 'step') g.audio.sfx('step_heavy', this.body.pos, 0.5);
    if (n === 'burst') g.burst(this, this.body.pos.clone().add(new THREE.Vector3(Math.sin(this.yaw) * 1.1, 0.05, Math.cos(this.yaw) * 1.1)));
    if (n === 'fire') g.audio.sfx('ignite', this.body.pos, 0.7);
    if (n === 'thud') { g.cam.addTrauma(0.3); g.audio.sfx('thud', this.body.pos, 0.8); }
  }

  receive(hit: Hit): HitResult {
    if (this.dead || this.godMode) return 'none';
    const g = this.game;
    if (this.invuln > 0 && (this.act === 'dodge' || this.act === 'getup')) {
      // perfect dodge: dodged in the first moments of the roll
      if (this.time - this.dodgeStartT < 0.22 && this.act === 'dodge') {
        g.time.slowmo(0.25, 0.35);
        this.ember = Math.min(this.maxEmber, this.ember + 12);
        g.audio.sfx('perfect', this.body.pos, 0.8);
      }
      return 'dodged';
    }
    const facing = Math.abs(angleDiff(this.yaw, Math.atan2(-hit.dir.x, -hit.dir.z))) < 1.9;
    if ((this.act === 'block' || this.act === 'parry') && facing && !hit.unblockable) {
      if (this.time - this.blockPressT < 0.2 || this.act === 'parry') {
        this.play('parry', 'parry', { fade: 0.03 });
        this.char.face.react('fierce', 0.6);
        this.ember = Math.min(this.maxEmber, this.ember + 15);
        this.guard = Math.min(100, this.guard + 20);
        return 'parried';
      }
      this.guard -= hit.damage * (hit.heavy ? 2.4 : 1.6);
      if (this.guard <= 0) {
        this.guard = 0;
        this.play('guardbreak', 'guard_break', { fade: 0.04 });
        this.hp -= hit.damage * 0.5;
        return 'hit';
      }
      this.char.animator.play('block_hit', { fade: 0.03 });
      this.hp -= hit.damage * 0.12;
      this.checkDeath();
      return 'blocked';
    }
    this.hp -= hit.damage;
    const inf = inflictionOf(hit.kind, hit.damage, hit.heavy);
    if (inf) this.status.apply(inf.kind, inf.amount, inf.level);
    this.char.flash(0.8);
    this.char.face.react('pain', 0.8);
    this.lock = this.lock ?? (hit.from as Combatant);
    if (this.checkDeath()) return 'killed';
    if (hit.knock && hit.knock > 0.5) {
      this.yaw = Math.atan2(-hit.dir.x, -hit.dir.z);
      this.play('down', 'knockdown', { fade: 0.05 });
    } else {
      const back = !facing;
      this.play('hit', back ? 'hit_back' : 'hit_front', { fade: 0.04 });
    }
    return 'hit';
  }

  /** status effects: their damage, and the look of them (flames on her, frost breath) */
  private tickStatus(dt: number): void {
    if (this.dead) return;
    this.status.wet = !!this.game.envFx.wet;
    const dmg = this.status.update(dt);
    if (dmg > 0) {
      this.hp -= dmg;
      this.checkDeath();
    }
    this.statusFxT -= dt;
    if (this.statusFxT <= 0) {
      this.statusFxT = 0.08;
      const c = this.center();
      const pr = this.game.particles;
      if (this.status.has('burn')) { pr.burst('fire', c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.4) * 1.1, (Math.random() - 0.5) * 0.4)), 2); if (Math.random() < 0.3) pr.burst('smoke', c, 1); }
      if (this.status.has('frost')) pr.burst('ice', c.clone().add(new THREE.Vector3(0, 0.4, 0)), 1, new THREE.Vector3(0, 1, 0), 0.6);
      if (this.status.has('blight')) pr.burst('hexfire', c, 1, new THREE.Vector3(0, 1, 0), 0.5);
      if (this.status.s.bleed.active > 0) pr.burst('blood', c, 4);
    }
  }

  private checkDeath(): boolean {
    if (this.hp > 0) return false;
    this.hp = 0;
    this.dead = true;
    this.lock = null;
    this.act = 'death';
    this.char.animator.play('death', { fade: 0.1 });
    this.char.face.set('pain');
    this.char.gaze.target = null;
    this.game.onPlayerDeath();
    return true;
  }

  revive(): void {
    this.dead = false;
    this.hp = this.maxHp;
    this.heals = this.maxHeals;
    this.status.clear();
    this.guard = 100;
    this.act = null;
    this.char.animator.stop(0.01);
    this.lock = null;
  }

  /** scripted animation (cutscenes) */
  perform(clip: string, opts: { loop?: boolean; fade?: number } = {}): void {
    this.play('scripted', clip, { fade: opts.fade ?? 0.3, loop: opts.loop });
  }

  finisher(target: Combatant): void {
    this.aimTarget = target;
    this.yaw = yawTo(this.body.pos, target.body.pos);
    this.play('finisher', 'finisher', { fade: 0.06 });
    this.invuln = 1.6;
  }

  get attacking(): boolean { return this.act === 'attack' || this.act === 'heavy' || this.act === 'art'; }
  get canFinish(): boolean { return !this.act && !this.dead; }
}
