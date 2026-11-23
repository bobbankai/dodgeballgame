import { Vector3 } from '@babylonjs/core';
import type { Fighter } from './Fighter';

export interface AIProfile {
  aggression: number;     // 0..1 how often it closes in and attacks
  reaction: number;       // seconds before it reacts to an attack
  guard: number;          // chance to guard an incoming attack
  perfect: number;        // chance a guard is a perfect guard
  combo: number;          // chance to continue a string after a hit
  tech: number;           // chance per second to use a technique when it has energy
  dash: number;           // chance per second to dash (in or out)
  range: number;          // preferred fighting distance
  jump: number;           // chance to follow a launcher into the air
}

export const PROFILES: Record<string, AIProfile> = {
  grunt: { aggression: 0.55, reaction: 0.45, guard: 0.15, perfect: 0, combo: 0.35, tech: 0.15, dash: 0.1, range: 1.3, jump: 0 },
  rookie: { aggression: 0.6, reaction: 0.32, guard: 0.35, perfect: 0.05, combo: 0.5, tech: 0.25, dash: 0.25, range: 1.4, jump: 0.2 },
  rival: { aggression: 0.75, reaction: 0.22, guard: 0.5, perfect: 0.15, combo: 0.75, tech: 0.4, dash: 0.45, range: 1.5, jump: 0.5 },
  boss: { aggression: 0.7, reaction: 0.25, guard: 0.45, perfect: 0.12, combo: 0.6, tech: 0.55, dash: 0.3, range: 2.2, jump: 0.2 },
  master: { aggression: 0.85, reaction: 0.18, guard: 0.6, perfect: 0.25, combo: 0.85, tech: 0.6, dash: 0.5, range: 1.7, jump: 0.5 },
  ally: { aggression: 0.8, reaction: 0.3, guard: 0.3, perfect: 0.05, combo: 0.6, tech: 0.4, dash: 0.3, range: 1.4, jump: 0.3 },
};

/** Shared among a team of grunts: only a couple attack at a time, the rest circle. */
export class Tokens {
  private holders = new Set<Fighter>();
  constructor(public max = 2) {}
  take(f: Fighter): boolean {
    if (this.holders.has(f)) return true;
    for (const h of this.holders) if (!h.alive) this.holders.delete(h);
    if (this.holders.size >= this.max) return false;
    this.holders.add(f);
    return true;
  }
  give(f: Fighter): void {
    this.holders.delete(f);
  }
}

export class AI {
  private react = 0;
  private watched: unknown = null;
  private guardFor = 0;
  private strafeDir = Math.random() < 0.5 ? 1 : -1;
  private strafeT = 0;
  private wantCombo = false;
  private holdOff = 0;
  /** multiplies everything the AI does (difficulty, story beats) */
  difficulty = 1;
  passive = false;

  constructor(readonly f: Fighter, public p: AIProfile, readonly tokens: Tokens | null = null) {}

  update(dt: number): void {
    const f = this.f;
    const c = f.cmd;
    c.move.set(0, 0, 0);
    c.light = c.heavy = c.guard = c.guardPressed = c.dash = c.jump = c.domain = c.vow = c.run = false;
    c.tech = -1;
    const t = f.target;
    if (!t || !t.alive || !f.alive || this.passive) return;
    const p = this.p;
    const dist = f.distanceTo(t);
    const toT = t.pos.subtract(f.pos);
    toT.y = 0;
    toT.normalize();
    const side = new Vector3(toT.z, 0, -toT.x);

    // --- defence: react to the target's attacks after a reaction delay -----------------------------
    if (t.move && t.move !== this.watched && t.phase() === 'startup') {
      this.watched = t.move;
      this.react = p.reaction / this.difficulty;
      const threat = dist < 3.2 || t.move.kind === 'projectile' || t.move.kind === 'area';
      this.guardFor = threat && Math.random() < p.guard * this.difficulty ? 0.5 : 0;
      if (this.guardFor > 0 && Math.random() < p.perfect * this.difficulty) this.guardFor = -1;
    }
    if (this.react > 0) this.react -= dt;
    if (this.guardFor !== 0 && this.react <= 0 && f.canAct()) {
      if (this.guardFor === -1) {
        // a perfect guard: press just before the hit lands
        const m = t.move;
        if (m && t.moveTime > m.startup - 0.1) {
          c.guard = true;
          c.guardPressed = true;
          this.guardFor = 0.3;
        }
      } else {
        c.guard = true;
        this.guardFor -= dt;
        if (this.guardFor <= 0) this.guardFor = 0;
        if (!t.move) this.guardFor = 0;
        return;
      }
    }

    // --- continuing strings -------------------------------------------------------------------------------
    if (f.state === 'attack' && f.move) {
      if (f.moveHit && this.wantCombo) {
        const m = f.move.name;
        if (m === 'light4' || m === 'heavy2') c.tech = Math.random() < 0.5 && f.energy > 30 ? Math.floor(Math.random() * 3) : -1;
        else if (m === 'light3' && Math.random() < 0.4) c.heavy = true;
        else if (m === 'heavy' && Math.random() < p.jump) c.jump = true;
        else c.light = true;
      }
      return;
    }
    if (f.state === 'air' && !f.move && t.state === 'launched' && dist < 2.4) {
      c.light = true;
      return;
    }
    if (!f.canAct()) return;

    // --- spacing and offence ---------------------------------------------------------------------------------
    const hasToken = !this.tokens || this.tokens.take(f);
    this.holdOff -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 1 + Math.random() * 2;
      this.strafeDir = -this.strafeDir;
    }
    const range = p.range * (f.ch.root.scaling.y);
    if (!hasToken) {
      // circle close by, waiting for a turn (near enough to be hit, not so near they crowd in)
      const want = dist < 3 ? toT.scale(-0.5) : dist > 4.8 ? toT : Vector3.Zero();
      c.move.copyFrom(want.add(side.scale(this.strafeDir * 0.7)));
      if (c.move.length() > 1) c.move.normalize();
      return;
    }
    // techniques at range
    if (Math.random() < p.tech * dt * 2 * this.difficulty && f.energy >= 25) {
      const techs = f.kit.techs.map((n, i) => ({ i, m: f.kit.moves[n] })).filter((x) => x.m && (x.m.cost ?? 0) <= f.energy);
      if (techs.length) {
        const pick = techs[Math.floor(Math.random() * techs.length)];
        const m = pick.m;
        const ok = m.kind === 'projectile' ? dist > 3 && dist < 14 : m.kind === 'area' && m.area?.at === 'target' ? dist < 10 : dist < (m.area?.radius ?? 3) + 0.8;
        if (ok) {
          c.tech = pick.i;
          return;
        }
      }
    }
    if (Math.random() < p.dash * dt) {
      c.dash = true;
      c.move.copyFrom(dist > 4 ? toT : Math.random() < 0.5 ? side.scale(this.strafeDir) : toT.scale(-1));
      return;
    }
    if (dist > range + 0.4) {
      if (this.holdOff > 0) {
        c.move.copyFrom(side.scale(this.strafeDir * 0.8));
        return;
      }
      c.move.copyFrom(toT);
      c.run = dist > 7;
      if (Math.random() < 0.15 * dt) c.move.addInPlace(side.scale(this.strafeDir * 0.6)).normalize();
      return;
    }
    // in range: attack or back off
    if (Math.random() < p.aggression * dt * 4 * this.difficulty) {
      this.wantCombo = Math.random() < p.combo * this.difficulty;
      const r = Math.random();
      if (r < 0.65) c.light = true;
      else if (r < 0.85) c.heavy = true;
      else if (f.kit.moves.throw && t.state === 'guard') {
        c.guard = true;
        c.light = true;
      } else c.light = true;
      if (this.tokens && Math.random() < 0.3) {
        this.tokens.give(f);
        this.holdOff = 1.2;
      }
      return;
    }
    // shuffle
    c.move.copyFrom(side.scale(this.strafeDir * 0.5));
  }
}
