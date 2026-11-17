import * as THREE from 'three/webgpu';
import { Enemy, type EnemyDef, type AttackDef } from '@/ai/enemy';
import type { GameCtx } from '@/gameplay/ctx';
import type { HitInfo, HitOutcome } from '@/gameplay/actor';
import { instantiateCharacter } from '@/assets/loader';
import { Afterimages } from '@/temporal/afterimages';
import { ghostify } from '@/temporal/ghost';
import { echoify } from '@/characters/echo';
import { G } from '@/physics/physics';

/**
 * THE ECHO (Chapter 3 boss): Ethan Vale from the timeline where the integration went further. He fights the way Ethan fights, only
 * he has had longer to learn it.
 *   mirror counters  he reads Ethan's strings: the more the same strike repeats, the likelier he turns it aside and answers at once
 *   temporal clones  two amber copies of himself step out of his own past to flank Ethan, then come apart (eight seconds)
 *   blink strikes    a smear of afterimages and he is behind Ethan, already swinging
 *   time slow        (phase 2) he slows Ethan's time for a moment, as Ethan does to everyone else
 *   adapts           a player who parries a lot gets late, heavy swings; one who dodges gets tracking kicks and lunges
 *   yields           he is not killed: at the last of his strength he goes down on one knee (the script takes it from there)
 * Phase 2 at half health; the script freezes him (`held`) for the transition, during which the arena falls into the other timeline.
 */
const BASE_ATTACKS: AttackDef[] = [
  { clip: 'light1', min: 0.8, max: 2.4, weight: 3, cooldown: 0.7, then: 'light2' },
  { clip: 'light4', min: 1.2, max: 3.0, weight: 1.6, cooldown: 1.0 },
  { clip: 'heavy1', min: 1.0, max: 2.6, weight: 1.4, cooldown: 1.4 },
  { clip: 'kick', min: 0.9, max: 2.2, weight: 1.2, cooldown: 1.2 },
];

export const ECHO: EnemyDef = {
  id: 'boss_echo', display: 'The Echo', model: 'characters/ethan/ethan.glb', health: 620, poise: 70, runSpeed: 6.2, circleSpeed: 2.8,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0.45, circleRange: [1.8, 3.2], evades: true, power: 1.25,
  attacks: BASE_ATTACKS.map((a) => ({ ...a })),
};
(ECHO as any).title = 'Ethan Vale, of another timeline';

const CLONE: EnemyDef = {
  id: 'echo_clone', display: 'Echo', model: 'characters/ethan/ethan.glb', health: 26, poise: 6, runSpeed: 5.4, circleSpeed: 2.2,
  aggroRange: 40, fov: Math.PI * 2, guardChance: 0.0, circleRange: [1.6, 2.6], power: 0.7,
  attacks: [{ clip: 'light1', min: 0.8, max: 2.2, weight: 2, cooldown: 1.3 }, { clip: 'kick', min: 0.9, max: 2.0, weight: 1, cooldown: 1.6 }],
};

export class EchoBoss extends Enemy {
  phase = 1;
  /** frozen by a cinematic (phase transition, the end) */
  held = false;
  /** brought to his knee: the fight is over */
  defeated = false;
  /** called once at half health (the script plays the transition) */
  onPhase2: (() => void) | null = null;
  private ghosts: Afterimages;
  private trail = 0;
  private nextClones = 9;
  private nextBlink = 6;
  private nextSlow = 0;
  private slowCastAt = -1;
  private blinkAt = -1;
  private nextAdapt = 8;
  private lastClips: string[] = [];
  private playerParries = 0;
  private playerDodges = 0;
  private lastPlayerState = '';
  private clones: { e: Enemy; born: number; fade: { value: number } }[] = [];

  static async createEcho(ctx: GameCtx, at: THREE.Vector3, yaw = 0): Promise<EchoBoss> {
    const inst = await instantiateCharacter(ECHO.model);
    echoify(inst.root);
    const e = new EchoBoss(ctx, inst, ECHO);
    e.height = 1.85;
    e.radius = 0.32;
    e.body = ctx.physics.createCharacter(at, e.radius, e.height, G.ENEMY);
    e.pos.copy(at); e.prev.copy(at); e.yaw = e.prevYaw = yaw;
    e.anim.play('idle_combat', { fade: 0 });
    e.syncVisual(1);
    return e;
  }

  constructor(ctx: GameCtx, inst: ConstructorParameters<typeof Enemy>[1], def: EnemyDef) {
    super(ctx, inst, def);
    this.ghosts = new Afterimages((ctx as any).scene, inst.root, 8, 0xffa040);
    this.noticed = true;
    this.hurtClip = 'hit_light';
  }

  tick(dt: number): void {
    if (this.held || this.defeated) {
      // a performance, not a fight: keep animating in place
      this.beginTick();
      const d = this.scaledDt(dt);
      this.anim.update(d);
      this.refreshPose();
      this.ghosts.step(dt);
      return;
    }
    const t = this.ctx.time;
    const pl = this.ctx.player as any;
    // read the player: count parries (via onParried) and dodges
    if (pl.state === 'dodge' && this.lastPlayerState !== 'dodge') this.playerDodges++;
    this.lastPlayerState = pl.state;
    if (t > this.nextAdapt) { this.nextAdapt = t + 8; this.adapt(); }
    const dist = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
    const free = this.alive && this.state !== 'hurt' && this.state !== 'attack';
    // temporal clones
    this.clones = this.clones.filter((c) => {
      const age = t - c.born;
      if (age > 8 || !c.e.alive) {
        c.fade.value = Math.max(0, c.fade.value - 0.05);
        if (c.fade.value <= 0.01) { this.removeClone(c.e); return false; }
      }
      return true;
    });
    if (free && t > this.nextClones && !this.clones.length) {
      this.nextClones = t + (this.phase === 2 ? 11 : 16);
      void this.spawnClones();
    }
    // blink strike: telegraph (a flare where he stands), then he is behind Ethan mid-swing
    if (free && t > this.nextBlink && dist > 2.2 && this.blinkAt < 0) {
      this.blinkAt = t + 0.35;
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'echo');
      this.ctx.sfx.play('slow_off', { at: this.pos, pitch: 1.8, volume: 0.6 });
    }
    if (this.blinkAt > 0 && t >= this.blinkAt) { this.blinkAt = -1; this.nextBlink = t + (this.phase === 2 ? 5 + Math.random() * 2 : 8 + Math.random() * 3); this.blinkStrike(); }
    // time slow on Ethan (phase 2): a visible cast first, then Ethan's time drags for two seconds
    if (this.phase === 2 && free && t > this.nextSlow && this.slowCastAt < 0 && dist < 10) {
      this.slowCastAt = t + 0.8;
      this.anim.play('time_slow', { fade: 0.06, restart: true });
      this.ctx.fx.pulse(this.focusPoint(new THREE.Vector3()), 'slow');
      this.ctx.sfx.play('slow_on', { at: this.pos, pitch: 0.8 });
    }
    if (this.slowCastAt > 0 && t >= this.slowCastAt) {
      this.slowCastAt = -1;
      this.nextSlow = t + 14;
      (this.ctx as any).slowPlayer?.(2.2);
      this.timeMul = 1.25;
    }
    if (this.timeMul > 1 && this.slowCastAt < 0 && t > this.nextSlow - 11.5) this.timeMul = 1;
    if ((this.timeMul > 1 || this.blinkAt > 0) && (this.trail += dt) > 0.06) { this.trail = 0; this.ghosts.spawn(this.inst.root, 0.45, 0.3); }
    this.ghosts.step(dt);
    super.tick(dt);
  }

  /** Re-weight his attacks toward what beats the player's habits. */
  private adapt(): void {
    const parryHeavy = this.playerParries > this.playerDodges;
    for (const a of this.def.attacks) {
      const base = BASE_ATTACKS.find((b) => b.clip === a.clip)?.weight ?? a.weight;
      if (parryHeavy) a.weight = a.clip === 'heavy1' || a.clip === 'heavy2' ? base * 2.4 : base * 0.8;
      else a.weight = a.clip === 'kick' || a.clip === 'light4' ? base * 2.2 : base * 0.85;
    }
    this.playerParries *= 0.5;
    this.playerDodges *= 0.5;
  }

  private blinkStrike(): void {
    const pl = this.ctx.player;
    const back = pl.forward(new THREE.Vector3()).multiplyScalar(-1.9);
    const to = new THREE.Vector3(pl.pos.x + back.x, pl.pos.y, pl.pos.z + back.z);
    if (!this.ctx.lineOfSight(pl.focusPoint(new THREE.Vector3()), to.clone().setY(to.y + 1.2))) return;
    this.ghosts.spawn(this.inst.root, 0.8, 0.6);
    (this.ctx.physics as any).teleport(this.body, { x: to.x, y: to.y + 0.3, z: to.z });
    this.pos.copy(to); this.prev.copy(to);
    this.yaw = this.prevYaw = Math.atan2(pl.pos.x - to.x, pl.pos.z - to.z);
    this.ctx.sfx.play('dodge', { at: to, pitch: 1.3 });
    this.ctx.fx.pulse(to.clone().setY(to.y + 1), 'echo');
    this.startAttack(this.def.attacks.find((a) => a.clip === (Math.random() < 0.5 ? 'light1' : 'heavy1')) ?? this.def.attacks[0]);
  }

  private async spawnClones(): Promise<void> {
    const g = this.ctx as any;
    const pl = this.ctx.player;
    this.anim.play('echo', { fade: 0.06, restart: true });
    this.ctx.sfx.play('echo_on', { at: this.pos, pitch: 0.85 });
    for (const side of [-1, 1]) {
      const f = pl.forward(new THREE.Vector3());
      const r = new THREE.Vector3(f.z, 0, -f.x).multiplyScalar(side * 3.4);
      const at = new THREE.Vector3(pl.pos.x + r.x, this.pos.y, pl.pos.z + r.z);
      if (!this.ctx.lineOfSight(pl.focusPoint(new THREE.Vector3()), at.clone().setY(at.y + 1.2))) continue;
      const e = await Enemy.create(this.ctx, { ...CLONE, attacks: CLONE.attacks.map((a) => ({ ...a })) }, at, Math.atan2(pl.pos.x - at.x, pl.pos.z - at.z));
      echoify(e.inst.root);
      const fade = ghostify(e.inst.root, 0xffa040) as unknown as { value: number };
      fade.value = 1;
      (e as any).noticed = true;
      g.chapter?.rig?.(e.root);
      if (g.chapter) await g.gfx.warmUp([e.root], { block: false }); // built before it appears, not on its first frame
      g.enemies.push(e);
      g.scene.add(e.root);
      this.ctx.fx.pulse(at.clone().setY(at.y + 1), 'echo');
      this.clones.push({ e, born: this.ctx.time, fade });
    }
  }

  private removeClone(e: Enemy): void {
    const g = this.ctx as any;
    g.scene.remove(e.root);
    const i = g.enemies.indexOf(e);
    if (i >= 0) g.enemies.splice(i, 1);
    e.dispose();
  }

  /** End every clone at once (cinematics). */
  dismissClones(): void {
    for (const c of this.clones) this.removeClone(c.e);
    this.clones = [];
  }

  receiveHit(hit: HitInfo): HitOutcome {
    if (!this.alive || this.held || this.defeated) return 'ignored';
    // mirror counters: the same strike again is likelier to be read, turned aside and answered (more so in phase 2)
    this.lastClips.push(hit.clip ?? '');
    if (this.lastClips.length > 4) this.lastClips.shift();
    const streak = this.lastClips.filter((c) => c === hit.clip).length;
    const chance = (this.phase === 2 ? 0.2 : 0.1) + 0.12 * (streak - 1);
    if (!hit.unblockable && this.state !== 'attack' && this.state !== 'hurt' && Math.random() < chance) {
      this.lastClips = [];
      this.anim.play('parry', { fade: 0.03, restart: true });
      this.ctx.fx.hit(hit.point, hit.dir, { heavy: false, blocked: true, parried: true });
      this.ctx.sfx.play('parry', { at: hit.point, pitch: 0.9 });
      this.cooldown = 0;
      const answer = this.def.attacks.find((a) => a.clip === 'heavy1') ?? this.def.attacks[0];
      void this.ctx.wait?.(0.14).then(() => { if (this.alive && !this.held) this.startAttack({ ...answer, clip: 'counter' }); });
      return 'blocked';
    }
    const out = super.receiveHit(hit);
    if (this.phase === 1 && this.health < this.maxHealth * 0.5 && this.alive) {
      this.phase = 2;
      this.nextSlow = this.ctx.time + 3;
      for (const a of this.def.attacks) a.cooldown *= 0.75;
      this.def.attacks.push({ clip: 'heavy2', min: 1.2, max: 3.0, weight: 1.4, cooldown: 1.2, then: 'light3' });
      this.onPhase2?.();
    }
    return out;
  }

  onParried(): void {
    this.playerParries++;
    super.onParried();
  }

  /** He is not killed: the last blow brings him to one knee. */
  protected applyDamage(n: number, hit: HitInfo): void {
    if (this.health - n <= 1) {
      this.health = 1;
      this.defeated = true;
      this.releaseToken();
      this.curAttack = null;
      this.dismissClones();
      this.anim.play('defeat', { fade: 0.08, restart: true });
      this.vel.set(hit.dir.x * 2, 0, hit.dir.z * 2);
      return;
    }
    super.applyDamage(n, hit);
  }
}
