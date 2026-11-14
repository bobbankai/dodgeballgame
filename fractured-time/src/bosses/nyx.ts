import * as THREE from 'three/webgpu';
import { Enemy, type EnemyDef, type AttackDef } from '@/ai/enemy';
import type { GameCtx } from '@/gameplay/ctx';
import type { HitInfo, HitOutcome } from '@/gameplay/actor';
import { instantiateCharacter } from '@/assets/loader';
import { Afterimages } from '@/temporal/afterimages';
import { G } from '@/physics/physics';

/**
 * COMMANDER NYX (Chapter 4 boss): the head of HELIX temporal security, Ethan's equal with a blade and his better with discipline.
 *   phase 1  precise melee   tight combos, a high guard, a parry-riposte when Ethan's strings get predictable; whiffs are punished
 *   phase 2  temporal        (two thirds) acceleration bursts with crimson afterimages; a temporal counterattack: struck, she
 *                            rewinds her own last second (back along her own path) and answers at once (12 s between)
 *   phase 3  unstable arena  (one third) the crucible platform flips between realities on its own (the script drives it); she
 *                            always knows which ground will be there
 *   yields   the last blow puts her down; the script takes it from there
 * Each phase change calls `onPhase(n)` so the script can play its beat while she is `held`.
 */
const ATTACKS: AttackDef[] = [
  { clip: 'light1', min: 0.8, max: 2.4, weight: 3, cooldown: 0.6, then: 'light2' },
  { clip: 'light2', min: 0.8, max: 2.2, weight: 1.2, cooldown: 0.8, then: 'light3' },
  { clip: 'light4', min: 1.2, max: 3.0, weight: 1.6, cooldown: 1.0 },
  { clip: 'heavy1', min: 1.0, max: 2.6, weight: 1.2, cooldown: 1.4 },
  { clip: 'kick', min: 0.9, max: 2.2, weight: 1.0, cooldown: 1.2 },
];

export const NYX: EnemyDef = {
  id: 'boss_nyx', display: 'Commander Nyx', model: 'characters/nyx/nyx.glb', health: 720, poise: 80, runSpeed: 5.8, circleSpeed: 2.6,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0.55, circleRange: [1.8, 3.0], evades: true, power: 1.3,
  attacks: ATTACKS.map((a) => ({ ...a })),
};
(NYX as any).title = 'HELIX temporal security';

export class NyxBoss extends Enemy {
  phase = 1;
  held = false;
  defeated = false;
  onPhase: ((n: number) => void) | null = null;
  private ghosts: Afterimages;
  private trail = 0;
  private hasteUntil = 0;
  private nextHaste = 0;
  private nextRewind = 0;
  private path: { t: number; p: THREE.Vector3; yaw: number }[] = [];
  private lastClips: string[] = [];

  static async createNyx(ctx: GameCtx, at: THREE.Vector3, yaw = 0): Promise<NyxBoss> {
    const inst = await instantiateCharacter(NYX.model);
    const e = new NyxBoss(ctx, inst, NYX);
    e.height = 1.78;
    e.radius = 0.3;
    e.body = ctx.physics.createCharacter(at, e.radius, e.height, G.ENEMY);
    e.pos.copy(at); e.prev.copy(at); e.yaw = e.prevYaw = yaw;
    e.anim.play('idle_combat', { fade: 0 });
    e.syncVisual(1);
    return e;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Enemy>[1], def: EnemyDef) {
    super(ctx, inst, def);
    this.ghosts = new Afterimages((ctx as any).scene, inst.root, 8, 0xff3048);
    this.noticed = true;
  }

  tick(dt: number): void {
    if (this.held || this.defeated) {
      this.beginTick();
      const d = this.scaledDt(dt);
      this.anim.update(d);
      this.refreshPose();
      this.ghosts.step(dt);
      return;
    }
    const t = this.ctx.time;
    // her own recent path (for the temporal counterattack)
    this.path.push({ t, p: this.pos.clone(), yaw: this.yaw });
    while (this.path.length && t - this.path[0].t > 1.4) this.path.shift();
    if (this.phase >= 2 && this.alive && t > this.nextHaste && this.state !== 'hurt') {
      const dur = this.phase === 3 ? 2.6 : 2.0;
      this.hasteUntil = t + dur;
      this.nextHaste = t + dur + 5 + Math.random() * 3;
      this.ctx.sfx.play('slow_off', { at: this.pos, pitch: 1.5 });
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'rewind');
    }
    this.timeMul = t < this.hasteUntil ? 1.6 : 1;
    if (this.timeMul > 1 && (this.trail += dt) > 0.07) { this.trail = 0; this.ghosts.spawn(this.inst.root, 0.5, 0.35); }
    this.ghosts.step(dt);
    super.tick(dt);
  }

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive || this.held || this.defeated) return 'ignored';
    const t = this.ctx.time;
    // discipline: predictable strings are parried and answered
    this.lastClips.push(hit.clip ?? '');
    if (this.lastClips.length > 3) this.lastClips.shift();
    const repeats = this.lastClips.filter((c) => c === hit.clip).length;
    if (!hit.unblockable && this.state !== 'attack' && this.state !== 'hurt' && Math.random() < 0.08 + 0.14 * (repeats - 1)) {
      this.lastClips = [];
      this.anim.play('parry', { fade: 0.03, restart: true });
      this.ctx.fx.hit(hit.point, hit.dir, { heavy: false, blocked: true, parried: true });
      this.ctx.sfx.play('parry', { at: hit.point, pitch: 1.1 });
      this.cooldown = 0;
      void this.ctx.wait?.(0.12).then(() => { if (this.alive && !this.held) this.startAttack({ ...ATTACKS[3], clip: 'counter' }); });
      return 'blocked';
    }
    // temporal counterattack (phase 2+): she steps back along her own last second and strikes from there
    if (this.phase >= 2 && t > this.nextRewind && this.path.length > 10 && this.state !== 'attack') {
      this.nextRewind = t + 12;
      const back = this.path[0];
      this.ghosts.spawn(this.inst.root, 0.9, 0.7);
      (this.ctx.physics as any).teleport(this.body, { x: back.p.x, y: back.p.y + 0.3, z: back.p.z });
      this.pos.copy(back.p); this.prev.copy(back.p); this.yaw = this.prevYaw = back.yaw;
      this.path = [];
      this.ctx.sfx.play('rewind_off', { at: this.pos, pitch: 1.2 });
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'rewind');
      this.cooldown = 0;
      void this.ctx.wait?.(0.18).then(() => { if (this.alive && !this.held) this.startAttack(ATTACKS[2]); });
      return 'ignored';
    }
    const out = super.receiveHit(hit);
    if (this.phase === 1 && this.health < this.maxHealth * 0.66 && this.alive) {
      this.phase = 2;
      this.nextHaste = t + 1;
      for (const a of this.def.attacks) a.cooldown *= 0.85;
      this.onPhase?.(2);
    } else if (this.phase === 2 && this.health < this.maxHealth * 0.33 && this.alive) {
      this.phase = 3;
      for (const a of this.def.attacks) a.cooldown *= 0.85;
      this.def.attacks.push({ clip: 'heavy2', min: 1.2, max: 3.0, weight: 1.4, cooldown: 1.2, then: 'light3' });
      this.onPhase?.(3);
    }
    return out;
  }

  protected applyDamage(n: number, hit: HitInfo): void {
    if (this.health - n <= 1) {
      this.health = 1;
      this.defeated = true;
      this.releaseToken();
      this.curAttack = null;
      this.anim.play('defeat', { fade: 0.08, restart: true });
      this.vel.set(hit.dir.x * 2, 0, hit.dir.z * 2);
      return;
    }
    super.applyDamage(n, hit);
  }
}
