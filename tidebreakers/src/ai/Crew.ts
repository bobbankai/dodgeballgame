// The crew as allies: they follow Kai between fights, pick their own targets in a fight, can't die (they go
// down and get back up), and each has an assist the player calls with C: Mira's harpoon pull, Bram's
// anchor drop, Nell's flash flare.
import { Vector3 } from '@babylonjs/core';
import type { Fighter } from '../game/Fighter';
import type { Game } from '../game/Game';
import { ALLY, type AttackDef } from '../combat/Attacks';
import type { Brain } from './EnemyAI';

export type CrewKind = 'mira' | 'bram' | 'nell';

const SLOTS: Record<CrewKind, [number, number]> = { mira: [-1.4, -1.3], bram: [1.5, -1.5], nell: [0.2, -2.4] };

export class CrewBrain implements Brain {
  private cd = 1;
  assistCd = 0;
  private downT = 0;
  private strafe = 1;
  following = true;

  constructor(readonly f: Fighter, readonly game: Game, readonly kind: CrewKind) {
    f.team = 'ally';
    f.floorHp = 1;
    this.arm();
  }

  private arm(): void {
    this.f.onFloor = () => {
      this.downT = 4;
      this.f.vel.y = 4;
      this.f.onGround = false;
      this.f.setState('knock');
      this.f.play(this.f.anims.knock, false, 0.05);
    };
  }

  private moves(): AttackDef[] {
    if (this.kind === 'mira') return [ALLY.m_thrust, ALLY.m_thrust, ALLY.m_sweep, ALLY.m_throw];
    if (this.kind === 'bram') return [ALLY.b_punch, ALLY.b_punch, ALLY.b_sweep, ALLY.b_slam];
    return [ALLY.n_flare, ALLY.n_flare, ALLY.n_kick];
  }

  private nearestEnemy(): Fighter | null {
    let best: Fighter | null = null;
    let bd = 1e9;
    const p = this.game.player;
    for (const e of this.game.enemies()) {
      // prefer enemies close to us, a little toward the ones crowding Kai
      const d = Vector3.Distance(e.pos, this.f.pos) + (p ? Vector3.Distance(e.pos, p.pos) * 0.35 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  update(dt: number): void {
    const f = this.f, g = this.game, p = g.player;
    const it = f.intent;
    it.move.setAll(0);
    it.guard = false;
    this.assistCd = Math.max(0, this.assistCd - dt);
    if (!p || f.state === 'cine') return;
    // regenerate, and get back up after going down
    f.hp = Math.min(f.maxHp, f.hp + dt * (g.combatActive ? 1.5 : 25));
    if (this.downT > 0) {
      this.downT -= dt;
      if (f.state === 'down') f.stateT = 0;   // stay down
      if (this.downT <= 0) { f.hp = Math.max(f.hp, f.maxHp * 0.45); f.setState('getup'); f.play(f.anims.getup, false, 0.15); f.invuln = 1.2; this.arm(); }
      return;
    }
    if (f.busy) return;
    if (Vector3.Distance(f.pos, p.pos) > 30) { f.place(p.pos.add(p.forward.scale(-2)), p.yaw); return; }
    this.cd -= dt;
    if (g.combatActive) {
      const t = this.nearestEnemy();
      if (t) {
        f.target = t;
        const d = t.pos.subtract(f.pos);
        d.y = 0;
        const dist = d.length();
        const dir = d.scale(1 / Math.max(dist, 1e-3));
        it.face = Math.atan2(dir.x, dir.z);
        const ranged = this.kind === 'nell';
        const range = ranged ? 7 : this.kind === 'mira' ? 2.8 : 2.2;
        if (ranged && dist < 3.5) { it.move.copyFrom(dir.scale(-1)); it.run = true; return; }
        if (dist > range + 0.6) { it.move.copyFrom(dir); it.run = true; return; }
        if (this.cd <= 0) {
          const ms = this.moves();
          const m = ms[Math.floor(Math.random() * ms.length)];
          if (f.startAttack(m)) this.cd = 1.2 + Math.random() * 1.4;
          return;
        }
        if (Math.random() < dt * 0.5) this.strafe *= -1;
        it.move.copyFrom(new Vector3(dir.z, 0, -dir.x).scale(0.45 * this.strafe));
        it.run = false;
        return;
      }
    }
    if (!this.following) return;
    // follow: hold a slot behind Kai
    const [sx, sz] = SLOTS[this.kind];
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const slot = p.pos.add(new Vector3(sx * c + sz * s, 0, -sx * s + sz * c));
    const d = slot.subtract(f.pos);
    d.y = 0;
    const dist = d.length();
    if (dist > 0.9) {
      it.move.copyFrom(d.scale(1 / dist).scale(Math.min(1, dist / 1.5)));
      it.run = dist > 3.5;
    } else {
      it.face = p.yaw;
    }
  }

  /** The player's crew call. Returns false if not ready. */
  assist(): boolean {
    const f = this.f, g = this.game, p = g.player;
    if (!p || this.assistCd > 0 || this.downT > 0 || f.state === 'cine' || !g.combatActive) return false;
    const target = (p.target && p.target.alive ? p.target : null) ?? this.nearestEnemy();
    if (!target) return false;
    this.assistCd = 12;
    f.attack = null;
    f.setState('idle');
    if (this.kind === 'mira') {
      f.target = target;
      f.startAttack({ ...ALLY.m_throw, projectile: { ...ALLY.m_throw.projectile!, damage: 22, knock: -12, speed: 36 } });
      g.vfx.burst(f.center, [0.6, 2.4, 1.6], 10, 5, 'star', 0.2, 0.3);
    } else if (this.kind === 'bram') {
      const to = target.pos.add(target.pos.subtract(p.pos).normalize().scale(-1.6));
      g.vfx.dust(f.pos, 10);
      f.place(to, Math.atan2(target.pos.x - to.x, target.pos.z - to.z));
      f.target = target;
      f.startAttack({ ...ALLY.b_slam, damage: 26, reach: 4, telegraph: 0 });
      g.vfx.burst(f.center, [2.6, 1.6, 0.6], 10, 5, 'star', 0.2, 0.3);
    } else {
      f.target = target;
      f.startAttack(ALLY.n_flare);
      for (const e of g.enemies()) {
        if (Vector3.Distance(e.pos, p.pos) > 10) continue;
        e.attack = null; e.pendingAttack = null; e.telegraphing = 0;
        if (!e.boss) { e.setState('hit'); e.stun = 2.6; e.play(e.anims.hit, false, 0.05); } else e.stun = 0.6;
        g.vfx.burst(e.center.add(new Vector3(0, 0.5, 0)), [3, 3, 2], 6, 2, 'star', 0.2, 1.2);
      }
      g.vfx.impact(p.center.add(new Vector3(0, 2, 0)), 2.5, [3, 3, 2.4]);
      g.impactFrame(0.08);
      g.sfx('parry');
    }
    g.sfx('super_start', f.pos, 0.5);
    return true;
  }
}
