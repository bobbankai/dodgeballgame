import { catchRisk } from './AIController';
import type { Athlete } from '../game/Athlete';
import type { Ball } from '../game/Ball';
import type { TeamId } from '../game/types';
import type { World } from '../game/World';
import type { AIController } from './AIController';

interface Volley {
  members: AIController[];
  target: Athlete;
  created: number;
  released: boolean;
}

/**
 * Team-level coordination: ball claims (no two AIs chase the same ball, human
 * teammates get priority), a shared focus target, crossfire volleys, spacing
 * and protection of teammates under fire.
 */
export class TeamBrain {
  agents: AIController[] = [];
  claims = new Map<Ball, AIController>();
  focus: Athlete | null = null;
  volley: Volley | null = null;
  private timer = 0;
  coordination = 0;

  constructor(
    public team: TeamId,
    public world: World,
  ) {}

  add(ai: AIController) {
    this.agents.push(ai);
    this.coordination = Math.max(this.coordination, ai.params.coordination);
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.2;
      this.assignClaims();
      this.pickFocus();
      this.planVolley();
    }
    this.runVolley();
  }

  private members(): Athlete[] {
    return this.world.athletes.filter((a) => a.team === this.team && a.active);
  }

  private assignClaims() {
    this.claims.clear();
    const w = this.world;
    const free = this.agents.filter((ai) => ai.athlete.active && !ai.athlete.ball && !ai.passive);
    const human = this.members().find((a) => a.isPlayer && !a.ball && a.active);
    const loose = w.balls.balls.filter((b) => b.state === 'loose' && !b.live && !b.decoy && w.court.inHalf(b.pos, this.team, 0.5));
    // sort by closeness to our back line (safer first) mixed with distance
    const taken = new Set<AIController>();
    for (const b of loose) {
      let best: AIController | null = null;
      let bd = Infinity;
      for (const ai of free) {
        if (taken.has(ai)) continue;
        const d = ai.athlete.pos.distanceTo(b.pos);
        if (d < bd) {
          bd = d;
          best = ai;
        }
      }
      if (!best) continue;
      // leave balls that the human teammate is clearly going for
      if (human && human.pos.distanceTo(b.pos) < bd * 0.8) continue;
      this.claims.set(b, best);
      taken.add(best);
    }
  }

  claimFor(ai: AIController): Ball | null {
    for (const [b, owner] of this.claims) if (owner === ai) return b;
    return null;
  }

  private pickFocus() {
    const opps = this.world.athletes.filter((a) => a.team !== this.team && a.active);
    if (!opps.length) {
      this.focus = null;
      return;
    }
    let best: Athlete | null = null;
    let bs = -Infinity;
    for (const o of opps) {
      let s = (o.maxHearts - o.hearts) * 1.2 + (o.vulnerable ? 1.5 : 0) + (o.ball ? 0.6 : 0) + (o.isPlayer ? 0.8 : 0) - (o.vulnerable ? 0 : catchRisk(o) * 0.8);
      if (this.focus === o) s += 0.8; // hysteresis
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    this.focus = best;
  }

  private planVolley() {
    if (this.volley || this.coordination < 0.35) return;
    const holders = this.agents.filter((ai) => ai.athlete.active && ai.athlete.ball && !ai.passive && !ai.noThrow);
    if (holders.length < 2 || !this.focus) return;
    if (Math.random() > this.coordination * 0.5) return;
    const members = holders.slice(0, 3);
    this.volley = { members, target: this.focus, created: this.world.time.gameTime, released: false };
    for (const m of members) {
      m.inVolley = true;
      m.volleyGo = false;
      m.target = this.focus;
    }
  }

  private runVolley() {
    const v = this.volley;
    if (!v) return;
    const now = this.world.time.gameTime;
    const alive = v.members.filter((m) => m.athlete.active && (m.athlete.ball || m.athlete.state === 'throwing'));
    if (!v.target.active || alive.length < 2 && !v.released) {
      this.endVolley();
      return;
    }
    if (!v.released) {
      const allCharged = alive.every((m) => (m.athlete.state === 'charging' || m.athlete.state === 'power') && m.athlete.charge > 0.55);
      if (allCharged || now - v.created > 3.5) {
        v.released = true;
        alive.forEach((m, i) => setTimeout(() => (m.volleyGo = true), i * 70 + Math.random() * 60));
      }
    } else if (alive.every((m) => !m.athlete.ball) || now - v.created > 6) {
      this.endVolley();
    }
  }

  private endVolley() {
    if (!this.volley) return;
    for (const m of this.volley.members) {
      m.inVolley = false;
      m.volleyGo = false;
    }
    this.volley = null;
  }

  /** Lateral slot so teammates spread across the court. */
  formationX(ai: AIController): number {
    const mem = this.members().sort((a, b) => a.pos.x - b.pos.x);
    const n = mem.length;
    const i = mem.indexOf(ai.athlete);
    const hw = this.world.court.halfWidth;
    if (n <= 1) return 0;
    const span = Math.min(hw * 1.4, 2.8 * (n - 1));
    return -span / 2 + (span * Math.max(0, i)) / (n - 1);
  }

  spacingOffset(ai: AIController): number {
    let push = 0;
    for (const m of this.members()) {
      if (m === ai.athlete) continue;
      const dx = ai.athlete.pos.x - m.pos.x;
      const dz = ai.athlete.pos.z - m.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.4) push += Math.sign(dx || Math.random() - 0.5) * (2.4 - d);
    }
    return push;
  }

  mostDangerousOpponent(me: Athlete): Athlete | null {
    let best: Athlete | null = null;
    let bs = -Infinity;
    for (const o of this.world.athletes) {
      if (o.team === this.team || !o.active) continue;
      let s = -o.pos.distanceTo(me.pos) * 0.2;
      if (o.ball) s += 2;
      if (o.isWindingUp) s += 2 + (o.aimTarget === me ? 3 : 0);
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    return best;
  }

  teammateUnderFire(me: Athlete): { mate: Athlete; shooter: Athlete } | null {
    for (const o of this.world.athletes) {
      if (o.team === this.team || !o.active || !o.isWindingUp) continue;
      const t = o.aimTarget;
      if (t && t !== me && t.team === this.team && t.active) return { mate: t, shooter: o };
    }
    return null;
  }

  bestPassTarget(ai: AIController): Athlete | null {
    const me = ai.athlete;
    const target = ai.target;
    if (!target) return null;
    const myD = me.pos.distanceTo(target.pos);
    let best: Athlete | null = null;
    let bd = myD - 2.5;
    for (const m of this.members()) {
      if (m === me || m.ball || !m.canAct || m.isPlayer) continue;
      const d = m.pos.distanceTo(target.pos);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }
}

