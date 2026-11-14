import * as THREE from 'three/webgpu';
import { Enemy, type EnemyDef } from '@/ai/enemy';
import type { GameCtx } from '@/gameplay/ctx';
import type { HitInfo, HitOutcome } from '@/gameplay/actor';
import { instantiateCharacter } from '@/assets/loader';
import { Afterimages } from '@/temporal/afterimages';
import { G } from '@/physics/physics';

/**
 * THE RIFT MARSHAL (Chapter 2 boss): HELIX's answer to a man who can bend time, a commander in temporal armour.
 *   temporal armour   most of every hit is absorbed until a PARRY cracks it (5 s of full damage, then it seals again)
 *   acceleration      it speeds up its own timeline in bursts (x1.7), leaving violet afterimages; phase 2 bursts are longer and more often
 *   recovery          hit three times in quick succession, it blinks back out of reach and resets
 *   counters habits   the same attack three times running is read: the third is blocked and answered at once
 *   phase 2 (half health): the armour shatters for good... and reforms denser; new pattern: lunging combos, a ground pulse
 * Built on the HELIX enemy AI (perception, spacing, tokens, clips), with the boss behaviours layered on top.
 */
export const MARSHAL: EnemyDef = {
  id: 'boss_marshal', display: 'The Rift Marshal', model: 'characters/marshal/marshal.glb', health: 520, poise: 60, runSpeed: 5.2, circleSpeed: 2.4,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0.35, circleRange: [2.0, 3.6], evades: true, power: 1.35, scale: 1.1,
  attacks: [
    { clip: 'light1', min: 0.8, max: 2.6, weight: 3, cooldown: 0.8, then: 'light2' },
    { clip: 'heavy1', min: 1.0, max: 2.6, weight: 1.6, cooldown: 1.6 },
    { clip: 'kick', min: 1.0, max: 2.4, weight: 1.2, cooldown: 1.4 },
    { clip: 'light4', min: 1.4, max: 3.2, weight: 1.4, cooldown: 1.2 },
  ],
};
(MARSHAL as any).title = 'HELIX temporal enforcement';

export class RiftMarshal extends Enemy {
  phase = 1;
  private armourBrokenUntil = 0;
  private hasteUntil = 0;
  private nextHaste = 6;
  private trail = 0;
  private recentHits: number[] = [];
  private lastClips: string[] = [];
  private ghosts: Afterimages;

  static async createMarshal(ctx: GameCtx, at: THREE.Vector3, yaw = 0): Promise<RiftMarshal> {
    const inst = await instantiateCharacter(MARSHAL.model, { scale: MARSHAL.scale });
    const e = new RiftMarshal(ctx, inst, MARSHAL);
    e.height = 1.85 * (MARSHAL.scale ?? 1);
    e.radius = 0.36;
    e.body = ctx.physics.createCharacter(at, e.radius, e.height, G.ENEMY);
    e.pos.copy(at); e.prev.copy(at); e.yaw = e.prevYaw = yaw;
    e.anim.play('idle_combat', { fade: 0 });
    e.syncVisual(1);
    return e;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Enemy>[1], def: EnemyDef) {
    super(ctx, inst, def);
    this.ghosts = new Afterimages((ctx as any).scene, inst.root, 6, 0xa070ff);
    this.noticed = true;
  }

  get armoured(): boolean { return this.ctx.time > this.armourBrokenUntil; }

  tick(dt: number): void {
    const t = this.ctx.time;
    // acceleration bursts on its own timeline
    if (this.alive && t > this.nextHaste && this.state !== 'hurt') {
      const dur = this.phase === 2 ? 3.2 : 2.2;
      this.hasteUntil = t + dur;
      this.nextHaste = t + dur + (this.phase === 2 ? 3.5 + Math.random() * 2 : 6 + Math.random() * 3);
      this.ctx.sfx.play('slow_off', { at: this.pos, pitch: 1.4 });
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'echo');
    }
    this.timeMul = t < this.hasteUntil ? 1.7 : 1;
    if (this.timeMul > 1 && (this.trail += dt) > 0.07) { this.trail = 0; this.ghosts.spawn(this.inst.root, 0.5, 0.35); }
    this.ghosts.step(dt);
    super.tick(dt);
  }

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive) return 'ignored';
    const t = this.ctx.time;
    // reads habits: the same strike three times running is blocked and answered
    this.lastClips.push(hit.clip ?? '');
    if (this.lastClips.length > 3) this.lastClips.shift();
    if (this.lastClips.length === 3 && this.lastClips.every((c) => c === this.lastClips[0]) && !hit.unblockable) {
      this.lastClips = [];
      this.anim.play('block_hit', { fade: 0.03, restart: true });
      this.ctx.fx.hit(hit.point, hit.dir, { heavy: false, blocked: true, parried: false });
      this.ctx.sfx.play('block', { at: hit.point, pitch: 0.8 });
      this.cooldown = 0;
      const a = this.def.attacks[Math.floor(Math.random() * this.def.attacks.length)];
      void this.ctx.wait?.(0.12).then(() => { if (this.alive) this.startAttack(a); });
      return 'blocked';
    }
    // temporal armour: absorbs most of the hit until a parry cracks it
    const scaled: HitInfo = this.armoured ? { ...hit, damage: hit.damage * (this.phase === 2 ? 0.25 : 0.35), stagger: hit.stagger * 0.2 } : hit;
    if (this.armoured) this.ctx.fx.pulse(hit.point, 'slow');
    const out = super.receiveHit(scaled);
    // recovery: three hits in quick succession and it blinks out of reach
    this.recentHits = this.recentHits.filter((x) => t - x < 1.4);
    this.recentHits.push(t);
    if (this.recentHits.length >= 3 && this.alive) { this.recentHits = []; this.blink(); }
    if (this.phase === 1 && this.health < this.maxHealth * 0.5 && this.alive) this.enterPhase2();
    return out;
  }

  onParried(): void {
    // a parry cracks the armour: five seconds of full damage, and it staggers
    this.armourBrokenUntil = this.ctx.time + 5;
    this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'parry');
    this.ctx.sfx.play('boss_shed', { at: this.pos, volume: 0.6 });
    this.staggerFor(1.6);
  }

  private blink(): void {
    const pl = this.ctx.player;
    const away = new THREE.Vector3(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z).normalize().multiplyScalar(4.5);
    this.ghosts.spawn(this.inst.root, 0.8, 0.6);
    const to = this.pos.clone().add(away);
    (this.ctx.physics as any).teleport(this.body, { x: to.x, y: to.y + 0.3, z: to.z });
    this.pos.copy(to);
    this.prev.copy(to);
    this.ctx.sfx.play('dodge', { at: to, pitch: 0.7 });
    this.ctx.fx.pulse(to.clone().setY(to.y + 1), 'echo');
    this.cooldown = 0.6;
    this.setState('circle');
  }

  private enterPhase2(): void {
    this.phase = 2;
    this.armourBrokenUntil = 0;
    this.hasteUntil = this.ctx.time + 3.5;
    this.nextHaste = this.ctx.time + 7;
    this.ctx.camera.addShake(0.6);
    this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'shift');
    this.ctx.sfx.play('boss_pulse', { at: this.pos });
    // the new pattern: longer combos and lunges
    this.def.attacks.push({ clip: 'heavy2', min: 1.2, max: 3.0, weight: 1.6, cooldown: 1.4, then: 'light3' });
    for (const a of this.def.attacks) a.cooldown *= 0.7;
  }
}
