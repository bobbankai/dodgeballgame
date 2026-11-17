import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { Enemy, type EnemyDef, type AttackDef } from '@/ai/enemy';
import type { GameCtx } from '@/gameplay/ctx';
import type { HitInfo, HitOutcome } from '@/gameplay/actor';
import { instantiateCharacter } from '@/assets/loader';
import { Afterimages } from '@/temporal/afterimages';
import { ghostify } from '@/temporal/ghost';
import { G } from '@/physics/physics';

const T = TSL as any;

/**
 * DIRECTOR SOREN VOSS (final boss), at the heart of the Engine. Three phases that play differently:
 *   1 Human Control (100-66%)   precise melee and parry-ripostes; a temporal BARRIER he raises every few seconds (light hits slide
 *                               off; a heavy strike or a guard break shatters it and staggers him); advanced movement (blinks)
 *   2 Temporal Ascension (66-33%) TEMPORAL PROJECTIONS (violet copies of himself) and SLOW FIELDS on the floor (Ethan's time drags
 *                               inside); the script adds the rapid timeline flips and wakes the pylons
 *   3 Reality Collapse (33-0%)  everything at once, faster; the script keeps the arena transforming and cuts the camera between
 * He yields at the end (the script plays the choice). `onPhase(n)` lets the script stage each change while he is `held`.
 */
const ATTACKS: AttackDef[] = [
  { clip: 'light1', min: 0.8, max: 2.4, weight: 3, cooldown: 0.7, then: 'light2' },
  { clip: 'heavy1', min: 1.0, max: 2.6, weight: 1.6, cooldown: 1.3 },
  { clip: 'light4', min: 1.2, max: 3.0, weight: 1.4, cooldown: 1.0 },
  { clip: 'kick', min: 0.9, max: 2.2, weight: 1.0, cooldown: 1.2 },
];

export const VOSS: EnemyDef = {
  id: 'boss_voss', display: 'Director Soren Voss', model: 'characters/voss/voss.glb', health: 950, poise: 90, runSpeed: 5.4, circleSpeed: 2.4,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0.5, circleRange: [1.8, 3.2], evades: true, power: 1.35,
  attacks: ATTACKS.map((a) => ({ ...a })),
};
(VOSS as any).title = 'HELIX, Director';

const PROJ: EnemyDef = {
  id: 'voss_projection', display: 'Projection', model: 'characters/voss/voss.glb', health: 34, poise: 8, runSpeed: 5.2, circleSpeed: 2.2,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0, circleRange: [1.6, 2.6], power: 0.75,
  attacks: [{ clip: 'light1', min: 0.8, max: 2.2, weight: 2, cooldown: 1.2 }, { clip: 'heavy1', min: 1.0, max: 2.4, weight: 1, cooldown: 1.8 }],
};

export class VossBoss extends Enemy {
  phase = 1;
  held = false;
  defeated = false;
  onPhase: ((n: number) => void) | null = null;
  private ghosts: Afterimages;
  private barrier: THREE.Mesh;
  private barrierUntil = 0;
  private nextBarrier = 4;
  private nextBlink = 7;
  private nextProj = 0;
  private nextField = 0;
  private trail = 0;
  private lastClips: string[] = [];
  private projections: { e: Enemy; born: number; fade: { value: number } }[] = [];
  private fields: { mesh: THREE.Mesh; pos: THREE.Vector3; until: number }[] = [];

  static async createVoss(ctx: GameCtx, at: THREE.Vector3, yaw = 0): Promise<VossBoss> {
    const inst = await instantiateCharacter(VOSS.model);
    const e = new VossBoss(ctx, inst, VOSS);
    e.height = 1.86;
    e.radius = 0.32;
    e.body = ctx.physics.createCharacter(at, e.radius, e.height, G.ENEMY);
    e.pos.copy(at); e.prev.copy(at); e.yaw = e.prevYaw = yaw;
    e.anim.play('idle_combat', { fade: 0 });
    e.syncVisual(1);
    return e;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Enemy>[1], def: EnemyDef) {
    super(ctx, inst, def);
    this.ghosts = new Afterimages((ctx as any).scene, inst.root, 8, 0x9a70ff);
    this.noticed = true;
    // the barrier: a violet shell, bright at its rim, with bands of time running over it
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const rim = T.float(1).sub(T.dot(T.normalView, T.positionViewDirection).abs()).pow(2.5);
    const bands = T.sin(T.positionLocal.y.mul(18).add(T.time.mul(6))).mul(0.3).add(0.7);
    m.colorNode = T.vec3(0.55, 0.38, 1.0).mul(rim.mul(2.4).add(0.06)).mul(bands);
    this.barrier = new THREE.Mesh(new THREE.SphereGeometry(1.25, 40, 24), m);
    this.barrier.position.set(0, 1.0, 0);
    this.barrier.visible = false;
    inst.root.add(this.barrier);
  }

  get shielded(): boolean { return this.ctx.time < this.barrierUntil; }

  tick(dt: number): void {
    this.barrier.visible = this.shielded && !this.defeated;
    if (this.held || this.defeated) {
      this.beginTick();
      this.anim.update(this.scaledDt(dt));
      this.refreshPose();
      this.ghosts.step(dt);
      return;
    }
    const t = this.ctx.time;
    const free = this.alive && this.state !== 'hurt' && this.state !== 'attack';
    const pl = this.ctx.player;
    const dist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    // the barrier
    if (free && t > this.nextBarrier && !this.shielded) {
      this.barrierUntil = t + (this.phase === 3 ? 3.5 : 3.0);
      this.nextBarrier = t + (this.phase === 1 ? 9 : 12);
      this.ctx.sfx.play('boss_charge', { at: this.pos, pitch: 1.3, volume: 0.6 });
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'shift');
    }
    // blinks: out of reach, or behind Ethan in the later phases
    if (free && t > this.nextBlink) {
      this.nextBlink = t + (this.phase === 1 ? 8 : 5.5) + Math.random() * 2;
      const behind = this.phase >= 2 && Math.random() < 0.6;
      const f = pl.forward(new THREE.Vector3());
      const to = behind ? pl.pos.clone().addScaledVector(f, -2.0)
        : this.pos.clone().add(this.pos.clone().sub(pl.pos).setY(0).normalize().multiplyScalar(dist < 3 ? 4 : 0)).add(new THREE.Vector3(f.z, 0, -f.x).multiplyScalar(2.5));
      if (this.ctx.lineOfSight(pl.focusPoint(new THREE.Vector3()), to.clone().setY(to.y + 1.2))) {
        this.ghosts.spawn(this.inst.root, 0.8, 0.6);
        (this.ctx.physics as any).teleport(this.body, { x: to.x, y: this.pos.y + 0.3, z: to.z });
        this.pos.set(to.x, this.pos.y, to.z); this.prev.copy(this.pos);
        this.yaw = this.prevYaw = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
        this.ctx.sfx.play('dodge', { at: this.pos, pitch: 0.8 });
        this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'echo');
        if (behind) this.startAttack(ATTACKS[0]);
      }
    }
    // projections and slow fields (phase 2+)
    if (this.phase >= 2) {
      if (free && t > this.nextProj && !this.projections.length) {
        this.nextProj = t + (this.phase === 3 ? 10 : 14);
        void this.project();
      }
      if (t > this.nextField) {
        this.nextField = t + (this.phase === 3 ? 6 : 8);
        this.spawnField(pl.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)));
      }
    }
    this.projections = this.projections.filter((p) => {
      if (t - p.born > 8 || !p.e.alive) {
        p.fade.value = Math.max(0, p.fade.value - 0.05);
        if (p.fade.value <= 0.01) { this.removeEnemy(p.e); return false; }
      }
      return true;
    });
    this.fields = this.fields.filter((f) => {
      const inside = Math.hypot(pl.pos.x - f.pos.x, pl.pos.z - f.pos.z) < 2.4;
      if (inside) (this.ctx as any).slowPlayer?.(0.25);
      const left = f.until - t;
      (f.mesh.material as any).opacity = Math.min(1, left) * 0.9;
      if (left <= 0) { (this.ctx as any).scene.remove(f.mesh); return false; }
      return true;
    });
    this.timeMul = this.phase === 3 ? 1.25 : 1;
    if (this.timeMul > 1 && (this.trail += dt) > 0.1) { this.trail = 0; this.ghosts.spawn(this.inst.root, 0.35, 0.3); }
    this.ghosts.step(dt);
    super.tick(dt);
  }

  private spawnField(at: THREE.Vector3): void {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const d = T.length(T.uv().sub(0.5)).mul(2);
    const ring = T.smoothstep(0.8, 0.98, d).mul(T.smoothstep(1.0, 0.98, d));
    const swirl = T.sin(T.atan(T.uv().y.sub(0.5), T.uv().x.sub(0.5)).mul(8).add(T.time.mul(-2)).add(d.mul(12))).mul(0.5).add(0.5);
    m.colorNode = T.vec3(0.5, 0.38, 1.0).mul(ring.mul(2.0).add(swirl.mul(0.18).mul(T.float(1).sub(d))));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 4.8), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, this.pos.y + 0.03, at.z);
    (this.ctx as any).scene.add(mesh);
    this.ctx.sfx.play('slow_on', { at, pitch: 0.7, volume: 0.6 });
    this.fields.push({ mesh, pos: at.clone(), until: this.ctx.time + 6 });
  }

  private async project(): Promise<void> {
    const g = this.ctx as any;
    const pl = this.ctx.player;
    this.anim.play('echo', { fade: 0.06, restart: true });
    this.ctx.sfx.play('echo_on', { at: this.pos, pitch: 0.7 });
    const n = this.phase === 3 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const at = new THREE.Vector3(pl.pos.x + Math.cos(a) * 3.4, this.pos.y, pl.pos.z + Math.sin(a) * 3.4);
      if (!this.ctx.lineOfSight(pl.focusPoint(new THREE.Vector3()), at.clone().setY(at.y + 1.2))) continue;
      const e = await Enemy.create(this.ctx, { ...PROJ, attacks: PROJ.attacks.map((x) => ({ ...x })) }, at, Math.atan2(pl.pos.x - at.x, pl.pos.z - at.z));
      const fade = ghostify(e.inst.root, 0x9a70ff) as unknown as { value: number };
      fade.value = 1;
      (e as any).noticed = true;
      g.chapter?.rig?.(e.root);
      if (g.chapter) await g.gfx.warmUp([e.root], { block: false }); // built before it appears, not on its first frame
      g.enemies.push(e);
      g.scene.add(e.root);
      this.ctx.fx.pulse(at.clone().setY(at.y + 1), 'echo');
      this.projections.push({ e, born: this.ctx.time, fade });
    }
  }

  private removeEnemy(e: Enemy): void {
    const g = this.ctx as any;
    g.scene.remove(e.root);
    const i = g.enemies.indexOf(e);
    if (i >= 0) g.enemies.splice(i, 1);
    e.dispose();
  }

  /** End projections and fields at once (cinematics). */
  dismiss(): void {
    for (const p of this.projections) this.removeEnemy(p.e);
    this.projections = [];
    for (const f of this.fields) (this.ctx as any).scene.remove(f.mesh);
    this.fields = [];
  }

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive || this.held || this.defeated) return 'ignored';
    if (this.shielded) {
      if (hit.heavy || hit.guardbreak) {
        // a heavy strike breaks the barrier and him with it
        this.barrierUntil = 0;
        this.ctx.sfx.play('boss_shed', { at: this.pos });
        this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'parry');
        this.staggerFor(1.4);
        return 'hit';
      }
      this.ctx.fx.hit(hit.point, hit.dir, { heavy: false, blocked: true, parried: false });
      this.ctx.sfx.play('block', { at: hit.point, pitch: 1.4 });
      return 'blocked';
    }
    this.lastClips.push(hit.clip ?? '');
    if (this.lastClips.length > 3) this.lastClips.shift();
    const repeats = this.lastClips.filter((c) => c === hit.clip).length;
    if (!hit.unblockable && this.state !== 'attack' && this.state !== 'hurt' && Math.random() < 0.06 + 0.13 * (repeats - 1) + (this.phase - 1) * 0.04) {
      this.lastClips = [];
      this.anim.play('parry', { fade: 0.03, restart: true });
      this.ctx.fx.hit(hit.point, hit.dir, { heavy: false, blocked: true, parried: true });
      this.ctx.sfx.play('parry', { at: hit.point, pitch: 0.95 });
      this.cooldown = 0;
      void this.ctx.wait?.(0.12).then(() => { if (this.alive && !this.held) this.startAttack({ ...ATTACKS[1], clip: 'counter' }); });
      return 'blocked';
    }
    const out = super.receiveHit(hit);
    if (this.phase === 1 && this.health < this.maxHealth * 0.66 && this.alive) {
      this.phase = 2;
      this.nextProj = this.ctx.time + 2;
      this.nextField = this.ctx.time + 4;
      for (const a of this.def.attacks) a.cooldown *= 0.85;
      this.onPhase?.(2);
    } else if (this.phase === 2 && this.health < this.maxHealth * 0.33 && this.alive) {
      this.phase = 3;
      for (const a of this.def.attacks) a.cooldown *= 0.8;
      this.def.attacks.push({ clip: 'heavy2', min: 1.2, max: 3.0, weight: 1.5, cooldown: 1.1, then: 'light3' });
      this.onPhase?.(3);
    }
    return out;
  }

  protected applyDamage(n: number, hit: HitInfo): void {
    if (this.health - n <= 1) {
      this.health = 1;
      this.defeated = true;
      this.barrierUntil = 0;
      this.releaseToken();
      this.curAttack = null;
      this.dismiss();
      this.anim.play('defeat', { fade: 0.08, restart: true });
      this.vel.set(hit.dir.x * 2, 0, hit.dir.z * 2);
      return;
    }
    super.applyDamage(n, hit);
  }
}
