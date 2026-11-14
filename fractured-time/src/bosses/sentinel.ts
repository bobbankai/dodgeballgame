import * as THREE from 'three/webgpu';
import { Actor, type HitInfo, type HitOutcome, type Team } from '@/gameplay/actor';
import type { GameCtx } from '@/gameplay/ctx';
import type { CharacterInstance } from '@/assets/loader';
import { loadGLTF } from '@/assets/loader';
import { dressCharacter, texturesReady } from '@/rendering/charmat';
import { timeScale } from '@/core/loop';
import { G } from '@/physics/physics';
import { vec3, float, sin, time } from 'three/tsl';

/**
 * SENTINEL A-07 (Chapter 1 boss). A rigid machine animated procedurally: every joint (hover, torso, head, shoulders, arms, forearms,
 * fists, fins, plates) eases toward a pose the state machine sets. Telegraphed attacks with real hit volumes on the fists, readable
 * openings, poise-break staggers and a cinematic phase transition at half health.
 *   phase 1: SLAM (both fists, long opening after), SWEEP (one arm, wide arc), CHARGE (dash, skids to a vulnerable stop)
 *   phase 2: armour blown off, core red, faster windups, adds BEAM (sweeping eye beam) and PULSE (temporal ring that slows Ethan)
 * Its armour halves damage until the plates are gone; staggered or exposed it takes full damage plus a bonus on the core.
 */
type Pose = Record<string, [number, number, number]>; // node -> euler (rad) in three space

const P_IDLE: Pose = { torso: [0.05, 0, 0], head: [0, 0, 0], shoulder_l: [0, 0, -0.08], shoulder_r: [0, 0, 0.08], arm_l: [0, 0, 0], arm_r: [0, 0, 0],
  forearm_l: [-0.18, 0, 0], forearm_r: [-0.18, 0, 0] };
const P_SLAM_UP: Pose = { torso: [-0.25, 0, 0], head: [-0.15, 0, 0], shoulder_l: [-2.6, 0, -0.25], shoulder_r: [-2.6, 0, 0.25], forearm_l: [-0.9, 0, 0],
  forearm_r: [-0.9, 0, 0] };
const P_SLAM_DOWN: Pose = { torso: [0.45, 0, 0], head: [0.2, 0, 0], shoulder_l: [-0.9, 0, -0.1], shoulder_r: [-0.9, 0, 0.1], forearm_l: [-0.1, 0, 0],
  forearm_r: [-0.1, 0, 0] };
const P_SWEEP_BACK: Pose = { torso: [0, 0.7, 0], shoulder_r: [-1.4, 0, 1.1], forearm_r: [-0.3, 0, 0], shoulder_l: [0, 0, -0.3] };
const P_SWEEP_END: Pose = { torso: [0.1, -0.9, 0], shoulder_r: [-1.5, 0, -0.4], forearm_r: [-0.15, 0, 0], shoulder_l: [0.2, 0, -0.4] };
const P_CHARGE: Pose = { torso: [0.55, 0, 0], head: [-0.3, 0, 0], shoulder_l: [0.6, 0, -0.5], shoulder_r: [0.6, 0, 0.5], forearm_l: [-1.2, 0, 0],
  forearm_r: [-1.2, 0, 0] };
const P_STAGGER: Pose = { torso: [0.7, 0, 0.15], head: [0.4, 0, 0.2], shoulder_l: [0.3, 0, -0.05], shoulder_r: [0.3, 0, 0.05], forearm_l: [-0.1, 0, 0],
  forearm_r: [-0.1, 0, 0] };
const P_BEAM: Pose = { torso: [-0.1, 0, 0], head: [0.15, 0, 0], shoulder_l: [-0.4, 0, -0.6], shoulder_r: [-0.4, 0, 0.6], forearm_l: [-1.4, 0, 0],
  forearm_r: [-1.4, 0, 0] };
const P_PULSE: Pose = { torso: [-0.3, 0, 0], head: [-0.25, 0, 0], shoulder_l: [-0.3, 0, -1.3], shoulder_r: [-0.3, 0, 1.3], forearm_l: [-0.3, 0, 0],
  forearm_r: [-0.3, 0, 0] };

type State = 'intro' | 'stalk' | 'slam' | 'sweep' | 'charge' | 'beam' | 'pulse' | 'stagger' | 'transition' | 'dead';

export class SentinelBoss extends Actor {
  readonly team: Team = 'enemy';
  readonly def = { id: 'boss_sentinel', display: 'Sentinel A-07' };
  phase = 1;
  state: State = 'intro';
  stateT = 0;
  private nodes = new Map<string, THREE.Object3D>();
  private rest = new Map<string, THREE.Euler>();
  private pose: Pose = P_IDLE;
  private poseSpeed = 4;
  private poise = 0;
  private cooldowns: Record<string, number> = {};
  private hitDone = false;
  private chargeDir = new THREE.Vector3();
  private slamAt = new THREE.Vector3();
  private beamYaw = 0;
  private plates: { obj: THREE.Object3D; vel: THREE.Vector3; spin: THREE.Vector3 }[] = [];
  private coreMats: THREE.MeshStandardNodeMaterial[] = [];
  private bob = 0;
  private hoverLow = 0;
  isCorpseExpired = false;
  /** spawned asleep: `wake()` starts the fight (the intro cinematic times it) */
  dormant = false;
  wake(): void {
    this.dormant = false; this.stateT = 0;
    const sfx = this.ctx.sfx as any;
    sfx.loop?.('boss_hum', 'boss_hum', { volume: 0.55 });
    sfx.play('boss_servo', { at: this.pos, pitch: 0.6 });
  }

  static async create(ctx: GameCtx, pos: THREE.Vector3, yaw: number): Promise<SentinelBoss> {
    const g = await loadGLTF('bosses/sentinel/sentinel.glb');
    const root = g.scene.clone(true) as THREE.Group;
    dressCharacter(root);
    await texturesReady();
    const inst: CharacterInstance = { root, clips: new Map(), bones: new Map(), meta: {} };
    const b = new SentinelBoss(ctx, inst);
    root.traverse((o) => {
      if (o.name) { b.nodes.set(o.name, o); b.rest.set(o.name, o.rotation.clone()); }
      const m = o as THREE.Mesh;
      if (m.isMesh && /^(core|gravity_core)/.test(m.name) && !/cage/.test(m.name)) b.coreMats.push(m.material as THREE.MeshStandardNodeMaterial);
    });
    b.name = 'Sentinel A-07';
    b.maxHealth = b.health = 900;
    b.radius = 1.1;
    b.height = 3.4;
    b.pos.copy(pos);
    b.prev.copy(pos);
    b.yaw = yaw;
    b.body = ctx.physics.createCharacter(pos, 1.0, 3.2, G.ENEMY);
    b.refresh();
    return b;
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  private setPose(p: Pose, speed: number) { this.pose = { ...P_IDLE, ...p }; this.poseSpeed = speed; }
  private toPlayer(): THREE.Vector3 { return new THREE.Vector3(this.ctx.player.pos.x - this.pos.x, 0, this.ctx.player.pos.z - this.pos.z); }
  private faceYaw(target: number, dt: number, rate: number) {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  }
  private enter(s: State) {
    this.state = s; this.stateT = 0; this.hitDone = false;
    const sfx = this.ctx.sfx as any;
    if (s !== 'stalk' && s !== 'dead') sfx.play('boss_servo', { at: this.pos, pitch: s === 'stagger' ? 0.7 : 1 });
    if (s === 'charge') sfx.play('boss_charge', { at: this.pos });
    if (s === 'dead') { sfx.play('boss_death', { at: this.pos }); sfx.stopLoop?.('boss_hum', 2.5); }
  }
  private node(n: string) { return this.nodes.get(n); }
  private fist(side: 'l' | 'r', out = new THREE.Vector3()) { return (this.node(`fist_${side}`) ?? this.root).getWorldPosition(out); }

  /** Damage the player once per attack if a hit volume touches him. */
  private strike(point: THREE.Vector3, radius: number, damage: number, heavy: boolean, unblockable = false): void {
    if (this.hitDone) return;
    const p = this.ctx.player;
    if (!p.alive || p.distanceToPoint(point) > radius) return;
    this.hitDone = true;
    const dir = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0).normalize();
    p.receiveHit({ attacker: this, damage, stagger: heavy ? 1.2 : 0.6, heavy, guardbreak: heavy, launch: 0, point: point.clone(), dir,
      unblockable, clip: heavy ? 'heavy1' : 'light1' } as HitInfo);
    this.ctx.fx.hit(point, dir, { heavy, blocked: false, parried: false });
  }

  // --- simulation --------------------------------------------------------------------------------------------------------------

  tick(dt: number): void {
    this.beginTick();
    const d = this.scaledDt(dt);
    this.stateT += d;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - d);
    const to = this.toPlayer();
    const dist = to.length();
    const want = Math.atan2(to.x, to.z);
    const fast = this.phase === 2 ? 0.75 : 1; // phase 2 telegraphs are shorter
    this.vel.set(0, 0, 0);

    switch (this.state) {
      case 'intro':
        // dormant (slumped, hover low) until the boss intro cinematic wakes it, then it rises and turns on Ethan
        if (this.dormant) { this.stateT = 0; this.setPose(P_STAGGER, 2); break; }
        this.setPose(this.stateT < 0.6 ? P_STAGGER : P_IDLE, 2);
        this.faceYaw(want, d, 0.8);
        if (this.stateT > 2.4) this.enter('stalk');
        break;
      case 'stalk': {
        this.setPose(P_IDLE, 3);
        this.faceYaw(want, d, 1.6);
        const desired = dist > 5.5 ? 2.2 : dist < 3.2 ? -1.4 : 0;
        this.vel.copy(to).normalize().multiplyScalar(desired);
        if (this.stateT > 0.9 * fast) this.choose(dist);
        break;
      }
      case 'slam': {
        const wind = 1.15 * fast;
        if (this.stateT < wind) { this.setPose(P_SLAM_UP, 3.2); this.faceYaw(want, d, 2.2); this.slamAt.copy(this.ctx.player.pos); }
        else if (this.stateT < wind + 0.22) {
          this.setPose(P_SLAM_DOWN, 16);
          if (this.stateT > wind + 0.12) {
            const c = new THREE.Vector3().addVectors(this.fist('l'), this.fist('r')).multiplyScalar(0.5).setY(this.pos.y + 0.3);
            if (!this.hitDone) { this.ctx.fx.pulse(c, 'shift'); this.ctx.camera.addShake(0.6); this.ctx.sfx.play('boss_slam', { at: c }); }
            this.strike(c, 1.7, 26, true);
          }
        } else if (this.stateT < wind + 0.22 + 1.5) this.setPose(P_SLAM_DOWN, 4); // stuck: the opening
        else this.enter('stalk');
        break;
      }
      case 'sweep': {
        const wind = 0.75 * fast;
        if (this.stateT < wind) { this.setPose(P_SWEEP_BACK, 4); this.faceYaw(want, d, 2.6); }
        else if (this.stateT < wind + 0.35) {
          this.setPose(P_SWEEP_END, 9);
          this.strike(this.fist('r'), 1.0, 18, false);
        } else if (this.stateT > wind + 1.0) this.enter('stalk');
        break;
      }
      case 'charge': {
        const wind = 0.9 * fast;
        if (this.stateT < wind) { this.setPose(P_CHARGE, 4); this.faceYaw(want, d, 3.0); this.chargeDir.copy(to).normalize(); }
        else if (this.stateT < wind + 0.6) {
          this.vel.copy(this.chargeDir).multiplyScalar(13);
          this.strike(this.focusPoint(), 1.6, 22, true);
        } else if (this.stateT < wind + 0.6 + 1.3) this.setPose(P_STAGGER, 5); // skid to a stop, exposed
        else this.enter('stalk');
        break;
      }
      case 'beam': {
        const wind = 1.0;
        const eye = this.node('eye');
        if (this.stateT < wind) { this.setPose(P_BEAM, 3); this.faceYaw(want, d, 2.0); this.beamYaw = this.yaw - 0.9; }
        else if (this.stateT < wind + 2.2) {
          this.beamYaw += d * 0.85;
          this.yaw = this.beamYaw;
          if (eye) {
            const o = eye.getWorldPosition(new THREE.Vector3());
            const dir = new THREE.Vector3(Math.sin(this.yaw), -0.12, Math.cos(this.yaw)).normalize();
            const rel = new THREE.Vector3().subVectors(this.ctx.player.focusPoint(), o);
            const along = rel.dot(dir);
            const off = rel.clone().addScaledVector(dir, -along).length();
            this.ctx.fx.pulse(o.clone().addScaledVector(dir, Math.min(14, Math.max(0, along))), 'rewind');
            if (along > 0 && along < 16 && off < 0.6) { this.hitDone = false; this.strike(this.ctx.player.focusPoint(), 2, 6 * d * 10, false); }
          }
        } else this.enter('stalk');
        break;
      }
      case 'pulse': {
        const wind = 0.85;
        if (this.stateT < wind) this.setPose(P_PULSE, 4);
        else if (this.stateT < wind + 0.5) {
          const r = (this.stateT - wind) / 0.5 * 6.0;
          if (!this.hitDone && Math.abs(dist - r) < 0.7) {
            this.strike(this.ctx.player.focusPoint(), 3, 12, false, true);
            this.ctx.slowPlayer?.(2.0); // caught by the temporal ring: Ethan's own time drags
          }
          if (this.stateT - d < wind) { this.ctx.fx.pulse(this.focusPoint(), 'slow'); this.ctx.sfx.play('boss_pulse', { at: this.pos }); }
        } else if (this.stateT > wind + 1.0) this.enter('stalk');
        break;
      }
      case 'stagger':
        this.setPose(P_STAGGER, 6);
        if (this.stateT > 3.0) { this.poise = 0; this.enter('stalk'); }
        break;
      case 'transition':
        // phase change: rises, blows its armour off, core turns red
        this.setPose(this.stateT < 1.2 ? P_PULSE : P_IDLE, 3);
        if (this.stateT > 1.0 && this.plates.length === 0) this.shedArmour();
        if (this.stateT > 3.2) { this.phase = 2; this.enter('stalk'); }
        break;
      case 'dead':
        this.setPose(P_STAGGER, 2);
        if (this.stateT > 6) this.isCorpseExpired = true;
        break;
    }
    // move the body (hover: no gravity), keep it on the arena floor
    const res = this.ctx.physics.move(this.body, this.vel.clone().multiplyScalar(d));
    void res;
    this.syncFromBody();
    this.animate(d);
    this.refresh();
  }

  private choose(dist: number): void {
    const opts: [State, number][] = [];
    if (dist < 4.2 && !this.cooldowns.slam) opts.push(['slam', 3]);
    if (dist < 3.6 && !this.cooldowns.sweep) opts.push(['sweep', 3]);
    if (dist > 5.0 && !this.cooldowns.charge) opts.push(['charge', 2.5]);
    if (this.phase === 2 && dist > 4 && !this.cooldowns.beam) opts.push(['beam', 2]);
    if (this.phase === 2 && dist < 6 && !this.cooldowns.pulse) opts.push(['pulse', 1.6]);
    if (!opts.length) return;
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0);
    for (const [s, w] of opts) {
      r -= w;
      if (r <= 0) {
        this.cooldowns[s] = { slam: 4.5, sweep: 3, charge: 5, beam: 8, pulse: 7, stalk: 0, intro: 0, stagger: 0, transition: 0, dead: 0 }[s];
        this.enter(s);
        return;
      }
    }
  }

  private shedArmour(): void {
    for (const n of ['plate_chest_l', 'plate_chest_r', 'plate_back']) {
      const o = this.node(n);
      if (!o) continue;
      const out = new THREE.Vector3().subVectors(o.getWorldPosition(new THREE.Vector3()), this.focusPoint()).normalize();
      this.plates.push({ obj: o, vel: out.multiplyScalar(6).setY(4), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6) });
      this.ctx.fx.hit(o.getWorldPosition(new THREE.Vector3()), out, { heavy: true, blocked: false, parried: false });
    }
    this.ctx.camera.addShake(0.8);
    this.ctx.sfx.play('boss_shed', { at: this.pos });
    // phase 2: the exposed core runs hot and red, pulsing faster
    for (const m of this.coreMats) {
      (m as any).emissiveNode = vec3(1.0, 0.16, 0.05).mul(float(5.0)).mul(sin(time.mul(5.0)).mul(0.25).add(0.85));
      m.needsUpdate = true;
    }
  }

  private animate(d: number): void {
    this.bob += d;
    const hover = this.node('hover');
    const low = this.state === 'stagger' || this.state === 'dead' || this.dormant ? -0.45 : 0;
    this.hoverLow += (low - this.hoverLow) * Math.min(1, d * 3);
    if (hover) hover.position.y = 0.9 + Math.sin(this.bob * 1.7) * 0.06 * (this.dormant ? 0 : 1) + this.hoverLow;
    const k = 1 - Math.exp(-this.poseSpeed * d);
    for (const [n, e] of Object.entries(this.pose)) {
      const o = this.node(n);
      const r = this.rest.get(n);
      if (!o || !r) continue;
      o.rotation.x += (r.x + e[0] - o.rotation.x) * k;
      o.rotation.y += (r.y + e[1] - o.rotation.y) * k;
      o.rotation.z += (r.z + e[2] - o.rotation.z) * k;
    }
    for (const p of this.plates) {
      p.vel.y -= 9.8 * d;
      p.obj.position.addScaledVector(p.vel, d * 0.4);
      p.obj.rotation.x += p.spin.x * d;
      p.obj.rotation.y += p.spin.y * d;
      if (p.obj.position.y < -6) p.obj.visible = false;
    }
  }

  private refresh(): void {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.root.updateMatrixWorld(true);
  }

  // --- receiving hits ----------------------------------------------------------------------------------------------------------

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive || this.state === 'transition' || this.state === 'intro') return 'ignored';
    const exposed = this.state === 'stagger' || this.phase === 2 || (this.state === 'slam' && this.stateT > 1.2) || (this.state === 'charge' && this.stateT > 1.4);
    let dmg = hit.damage * (exposed ? 1.0 : 0.5);
    if (this.state === 'stagger') dmg *= 1.5;
    this.health -= dmg;
    this.poise += hit.stagger * (exposed ? 1.6 : 0.6) + (hit.heavy ? 1.5 : 0);
    this.ctx.fx.hit(hit.point, hit.dir, { heavy: hit.heavy, blocked: !exposed, parried: false });
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.enter('dead');
      return 'killed';
    }
    if (this.phase === 1 && this.health < this.maxHealth * 0.5) { this.enter('transition'); return 'hit'; }
    if (this.poise > 9 && this.state !== 'stagger') { this.enter('stagger'); this.ctx.camera.addShake(0.4); }
    return 'hit';
  }

  onParried(): void { this.poise += 3; }

  focusPoint(out = new THREE.Vector3()): THREE.Vector3 { return out.copy(this.pos).setY(this.pos.y + 2.1); }

  distanceToPoint(p: THREE.Vector3): number {
    const a = this.pos.y + 0.6, b = this.pos.y + 3.2;
    const y = THREE.MathUtils.clamp(p.y, a, b);
    return Math.hypot(p.x - this.pos.x, p.y - y, p.z - this.pos.z) - this.radius;
  }

  syncVisual(alpha: number): void { super.syncVisual(alpha); }
}

void timeScale;
