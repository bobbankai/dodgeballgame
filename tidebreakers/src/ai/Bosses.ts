// Boss brains. Each boss reads distance and its own phase, strings attacks into short combos with
// readable telegraphs, and has arena specials: Halvard calls marines and dashes, Gorrick drags with his
// chain and erupts the furnace vents, Vale (with the Crown) raises spears of still water and rings of tide.
import { Vector3 } from '@babylonjs/core';
import type { Fighter } from '../game/Fighter';
import type { Game } from '../game/Game';
import { BOSS, type AttackDef } from '../combat/Attacks';
import type { Brain } from './EnemyAI';

export type BossKind = 'halvard' | 'gorrick' | 'vale';

export class BossBrain implements Brain {
  phase = 1;
  private cd = 1.6;
  private queue: AttackDef[] = [];
  private specialT = 6;
  private guardT = 0;
  private strafe = 1;
  active = true;
  onSummon?: () => void;
  /** arena centre for specials */
  center = new Vector3();

  constructor(readonly f: Fighter, readonly game: Game, readonly kind: BossKind) {
    f.boss = true;
  }

  private combos(): AttackDef[][] {
    const B = BOSS;
    switch (this.kind) {
      case 'halvard': return this.phase === 1
        ? [[B.h_lance], [B.h_sweep], [B.h_lance, B.h_sweep], [B.h_cleave]]
        : [[B.h_dash, B.h_dash], [B.h_sweep, B.h_cleave], [B.h_spin], [B.h_lance, B.h_dash, B.h_sweep]];
      case 'gorrick': return this.phase === 1
        ? [[B.g_smash], [B.g_chain, B.g_smash], [B.g_stomp]]
        : [[B.g_rush], [B.g_chain, B.g_rush], [B.g_stomp, B.g_smash], [B.g_rush, B.g_stomp]];
      case 'vale': return this.phase === 1
        ? [[B.v_s1, B.v_s2], [B.v_s1, B.v_s2, B.v_s3], [B.v_s3], [B.v_s2, B.v_s1]]
        : [[B.v_s1, B.v_s2, B.v_s3], [B.v_s3, B.v_s3], [B.v_still]];
    }
  }

  private range(): number { return this.kind === 'gorrick' ? 3.0 : this.kind === 'halvard' ? 3.4 : 2.6; }

  update(dt: number): void {
    const f = this.f, g = this.game, p = g.player;
    const it = f.intent;
    it.move.setAll(0);
    it.guard = false;
    if (!p || !p.alive || !f.alive || f.state === 'cine' || !g.combatActive || !this.active) return;
    if (f.state === 'attack' || f.telegraphing > 0) { it.face = Math.atan2(p.pos.x - f.pos.x, p.pos.z - f.pos.z); return; }
    if (f.busy) return;
    f.target = p;
    const d = p.pos.subtract(f.pos);
    d.y = 0;
    const dist = d.length();
    const dir = d.scale(1 / Math.max(dist, 1e-3));
    it.face = Math.atan2(dir.x, dir.z);
    this.cd -= dt;
    this.specialT -= dt;
    this.guardT -= dt;
    // specials on a timer
    if (this.specialT <= 0) { this.special(); return; }
    // Vale guards and parries when Kai swings at him
    if (this.kind === 'vale' && p.state === 'attack' && dist < 3 && this.guardT <= 0 && Math.random() < 0.35) { this.guardT = 1.2; }
    if (this.guardT > 0.4) { it.guard = true; return; }
    // continue a combo
    if (this.queue.length && dist < this.range() + 2.5) {
      const m = this.queue.shift()!;
      this.fire(m);
      return;
    }
    this.queue = [];
    if (this.cd <= 0 && dist < this.range() + 1.0) {
      const cs = this.combos();
      const c = cs[Math.floor(Math.random() * cs.length)];
      this.queue = c.slice(1);
      this.fire(c[0]);
      this.cd = (this.phase === 1 ? 1.7 : 1.1) + Math.random() * 0.9;
      return;
    }
    if (this.kind === 'gorrick' && this.cd <= 0 && dist > 5 && dist < 9 && Math.random() < 0.5) { this.fire(BOSS.g_chain); this.cd = 2.2; return; }
    if (this.kind === 'halvard' && this.phase === 2 && this.cd <= 0 && dist > 6) { this.fire(BOSS.h_dash); this.cd = 1.8; return; }
    if (dist > this.range() + 0.4) { it.move.copyFrom(dir); it.run = dist > 6; return; }
    if (Math.random() < dt * 0.6) this.strafe *= -1;
    it.move.copyFrom(new Vector3(dir.z, 0, -dir.x).scale(0.5 * this.strafe));
    it.run = false;
  }

  private fire(m: AttackDef): void {
    if (m.id === 'v_still') { this.stillwater(); return; }
    this.f.telegraph(m);
  }

  private special(): void {
    const g = this.game, p = g.player!, f = this.f;
    switch (this.kind) {
      case 'halvard':
        this.specialT = this.phase === 1 ? 16 : 11;
        if (this.phase === 2) this.onSummon?.();
        else this.fire(BOSS.h_spin);
        break;
      case 'gorrick': {
        // furnace vents erupt round the player
        this.specialT = this.phase === 1 ? 9 : 6;
        f.play('taunt', false, 0.2);
        const n = this.phase === 1 ? 4 : 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + Math.random();
          const r = i === 0 ? 0 : 2 + Math.random() * 4;
          g.hazard(p.pos.add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 1.6, 1.1 + i * 0.12, 14, 'fire');
        }
        g.sfx('charge', f.pos, 0.8);
        break;
      }
      case 'vale':
        this.specialT = this.phase === 1 ? 13 : 7;
        if (this.phase === 1) { this.queue = [BOSS.v_s1, BOSS.v_s2, BOSS.v_s3]; this.fire(BOSS.v_s1); }
        else if (Math.random() < 0.5) this.stillwater();
        else { f.play('overhead', false, 0.1); g.ring(f.pos, 7, 16, 16); g.ring(f.pos, 5, 16, 0); }
        break;
    }
  }

  /** Vale phase 2: spears of still water rise under and around the player. */
  private stillwater(): void {
    const g = this.game, p = g.player!, f = this.f;
    f.setState('cine');
    f.play('overhead', false, 0.1);
    setTimeout(() => { if (f.state === 'cine' && f.alive) { f.setState('idle'); f.locomotionAnim(0); } }, 900);
    const lead = p.vel.scale(0.5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = i === 0 ? 0 : 2.6;
      g.hazard(p.pos.add(lead).add(new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)), 1.3, 0.9 + (i === 0 ? 0 : 0.35), 15, 'spike');
    }
    g.sfx('charge', f.pos, 0.6);
  }

  setPhase(n: number): void {
    this.phase = n;
    this.queue = [];
    this.cd = 1.5;
    this.specialT = 3;
    if (n === 2) {
      this.f.speedScale = this.kind === 'vale' ? 1.12 : 1.08;
      this.f.maxPoise *= 1.3;
    }
  }
}
