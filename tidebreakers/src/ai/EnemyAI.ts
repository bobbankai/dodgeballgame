// Enemy brains. Each archetype reads the player's position and state and sets the fighter's intent,
// telegraphing attacks before they land. An attack-token pool keeps a mob from attacking all at once.
import { Vector3 } from '@babylonjs/core';
import type { Fighter } from '../game/Fighter';
import type { Game } from '../game/Game';
import { ENEMY, type AttackDef } from '../combat/Attacks';

export type Archetype = 'marine' | 'thug' | 'rifleman' | 'brute' | 'elite' | 'wrecker';

export interface Brain { update(dt: number): void; f: Fighter }

const tokens = new Set<Fighter>();

function angleTo(f: Fighter, p: Vector3): number { return Math.atan2(p.x - f.pos.x, p.z - f.pos.z); }

export class MeleeBrain implements Brain {
  private cd: number;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;
  private strafeT = 0;
  private retreat = 0;
  private reactT = 0;
  constructor(readonly f: Fighter, readonly game: Game, readonly moves: AttackDef[], readonly opts: { range: number; aggression: number; guards?: number; ranged?: boolean; keep?: number } = { range: 2.2, aggression: 1 }) {
    this.cd = 1 + Math.random() * 1.5;
  }

  update(dt: number): void {
    const f = this.f, g = this.game, p = g.player;
    const it = f.intent;
    it.move.setAll(0);
    it.guard = false;
    it.run = true;
    if (!p || !p.alive || !f.alive || f.state === 'cine' || !g.combatActive) { tokens.delete(f); return; }
    if (f.state === 'attack' || f.telegraphing > 0) { it.face = angleTo(f, p.pos); return; }
    if (f.busy) { tokens.delete(f); return; }
    f.target = p;
    const d = p.pos.subtract(f.pos);
    d.y = 0;
    const dist = d.length();
    const dir = d.normalizeToNew();
    it.face = Math.atan2(dir.x, dir.z);
    this.cd -= dt;
    this.strafeT -= dt;
    this.retreat -= dt;
    this.reactT -= dt;
    if (this.strafeT <= 0) { this.strafeT = 1.5 + Math.random() * 2; this.strafeDir *= Math.random() < 0.5 ? -1 : 1; }
    // reactive guard (elites, brutes) when the player swings nearby
    if (this.opts.guards && p.state === 'attack' && dist < 3.2 && this.reactT <= 0) {
      if (Math.random() < this.opts.guards) { it.guard = true; return; }
      this.reactT = 0.6;
    }
    if (this.retreat > 0) { it.move.copyFrom(dir.scale(-0.6)); it.run = false; return; }
    const range = this.opts.range;
    const wantAttack = this.cd <= 0 && dist < range + 0.6;
    if (wantAttack) {
      const free = tokens.size < g.attackTokens || tokens.has(f);
      if (free) {
        tokens.add(f);
        const m = this.moves[Math.floor(Math.random() * this.moves.length)];
        f.telegraph(m);
        this.cd = (1.4 + Math.random() * 1.6) / this.opts.aggression;
        this.retreat = 0.5 + Math.random() * 0.4;
        setTimeout(() => tokens.delete(f), 1400);
        return;
      }
    }
    if (dist > range + 1.6) {
      it.move.copyFrom(dir);
      it.run = dist > 6;
    } else if (dist < range - 0.6) {
      it.move.copyFrom(dir.scale(-0.5));
      it.run = false;
    } else {
      // circle the player
      const side = new Vector3(dir.z, 0, -dir.x).scale(this.strafeDir * 0.55);
      it.move.copyFrom(side.add(dir.scale(this.cd < 0.5 ? 0.4 : 0)));
      it.run = false;
    }
  }
}

export class RangedBrain implements Brain {
  private cd = 1.5 + Math.random() * 2;

  constructor(readonly f: Fighter, readonly game: Game) {}

  update(dt: number): void {
    const f = this.f, g = this.game, p = g.player;
    const it = f.intent;
    it.move.setAll(0);
    it.guard = false;
    if (!p || !p.alive || !f.alive || f.state === 'cine' || !g.combatActive) return;
    if (f.busy && f.state !== 'attack') return;
    if (f.state === 'attack' || f.telegraphing > 0) { it.face = angleTo(f, p.pos); return; }
    f.target = p;
    const d = p.pos.subtract(f.pos);
    d.y = 0;
    const dist = d.length();
    const dir = d.normalizeToNew();
    it.face = Math.atan2(dir.x, dir.z);
    this.cd -= dt;
    if (dist < 4) { it.move.copyFrom(dir.scale(-1)); it.run = true; return; }
    if (dist > 13) { it.move.copyFrom(dir); it.run = true; return; }
    if (this.cd <= 0) {
      f.play('aim', true, 0.15);
      f.telegraph(ENEMY.shoot);
      this.cd = 2.6 + Math.random() * 1.8;
      return;
    }
    const side = new Vector3(dir.z, 0, -dir.x).scale(Math.sin(g.time * 0.7 + f.pos.x) * 0.5);
    it.move.copyFrom(side);
    it.run = false;
  }
}

export function makeBrain(kind: Archetype, f: Fighter, g: Game): Brain {
  switch (kind) {
    case 'thug': return new MeleeBrain(f, g, [ENEMY.punch, ENEMY.hook], { range: 1.8, aggression: 1.3 });
    case 'wrecker': return new MeleeBrain(f, g, [ENEMY.slash1, ENEMY.hook], { range: 2.0, aggression: 1.2 });
    case 'marine': return new MeleeBrain(f, g, [ENEMY.slash1, ENEMY.slash2, ENEMY.thrust], { range: 2.3, aggression: 1 });
    case 'elite': return new MeleeBrain(f, g, [ENEMY.saber1, ENEMY.saber2, ENEMY.saber3], { range: 2.6, aggression: 1.4, guards: 0.45 });
    case 'brute': return new MeleeBrain(f, g, [ENEMY.bash, ENEMY.smash], { range: 2.6, aggression: 0.8, guards: 0.6 });
    case 'rifleman': return new RangedBrain(f, g);
  }
}
