// The rules of a fight on one line: two fighters, their states, and what happens when a strike arrives.
import { Vector3 } from '@babylonjs/core';
import { Model } from './model';
import { Button, Kit, KITS, Move, MOVES } from './moves';

export type State = 'idle' | 'dash' | 'attack' | 'block' | 'hit' | 'stagger' | 'down' | 'getup' | 'ko' | 'win' | 'cine';
export interface Intent { /** -1 away from the opponent, +1 towards */ move: number; block: boolean; press: Button[] }
export interface HitEvent { by: Fighter; on: Fighter; move: Move; kind: 'hit' | 'block' | 'parry' | 'break'; counter: boolean; ko: boolean; at: Vector3; dmg: number }

export const ARENA = 5.2;       // half width of the floor the fighters may use
const BODY = 0.3;               // how close two fighters' centres may come, per unit of scale
const BUFFER = 0.2;             // a press is remembered this long
const PARRY = 0.13;             // a guard raised this recently turns the strike aside

export class Fighter {
  kit: Kit;
  state: State = 'idle';
  /** seconds in the current state */ t = 0;
  x = 0; /** +1 faces +X */ face: 1 | -1 = 1;
  hp: number; guard = 100; meter = 0; rounds = 0;
  move: Move | null = null;
  /** strikes of the current move already resolved */ private done = 0;
  /** the current move touched its target (hit or blocked): it may be cancelled */ touched = false;
  private stun = 0; private vel = 0; private dashDir = 0;
  private want: { b: Button; t: number; fwd: number }[] = [];
  private guardT = 9; private stepLeft = 0; private stepV = 0;
  combo = 0; private comboT = 0; /** hits taken in a row, for damage scaling */ taken = 0;
  /** damage shown on skin (bruises build over the whole match) */ wear = 0;
  ai: AI | null = null;
  invulnerable = false;

  constructor(public model: Model, public name: string) {
    this.kit = KITS[name];
    this.hp = this.kit.hp;
  }

  get scale() { return this.model.meta.scale; }
  get busy() { return this.state !== 'idle' && this.state !== 'block'; }
  get helpless() { return this.state === 'hit' || this.state === 'stagger' || this.state === 'down' || this.state === 'getup'; }

  reset(x: number, face: 1 | -1) {
    Object.assign(this, { x, face, state: 'idle', t: 0, hp: this.kit.hp, guard: 100, move: null, stun: 0, vel: 0, combo: 0, taken: 0, touched: false, invulnerable: false });
    this.want.length = 0;
    this.model.play('idle', 0.2);
    this.model.emotion = 'focus';
    this.place();
  }

  place() {
    const r = this.model.root;
    r.position.x = this.x;
    r.rotation.y = Math.PI / 2;      // the model looks down +Z; the fight runs along X
    r.scaling.set(1, 1, this.face);  // the fighter on the right is mirrored, so both show their chest to the camera
  }

  private set(s: State, clip?: string, fade = 0.08) {
    this.state = s; this.t = 0;
    if (clip) this.model.play(clip, fade);
  }

  private start(id: string) {
    const mv = MOVES[id];
    this.move = mv; this.done = 0; this.touched = false;
    if (mv.cost) this.meter -= mv.cost;
    this.set('attack', mv.clip, 0.05);
    this.model.emotion = mv.level >= 3 ? 'effort' : 'focus';
    const first = this.model.clip(mv.clip).hits[0]?.t ?? 0.15;
    this.stepLeft = (mv.step ?? 0) * this.scale; this.stepV = this.stepLeft / first;
  }

  /** which move a button means right now, or null */
  private pick(b: Button, fwd: number): string | null {
    const k = this.kit;
    if (b === 'S') return this.meter >= (MOVES[k.S].cost ?? 0) ? k.S : null;
    if (b === 'H') return fwd > 0.3 ? k.fH : fwd < -0.3 ? k.bH : k.H;
    const list = b === 'L' ? k.L : k.K;
    if (b === 'K' && fwd > 0.3 && !this.move) return k.fK;
    const i = this.move ? list.indexOf(this.move.clip) : -1;
    return i >= 0 ? list[i + 1] ?? null : list[0];
  }

  update(dt: number, opp: Fighter, intent: Intent, events: HitEvent[]) {
    this.t += dt; this.guardT += dt;
    for (const b of intent.press) this.want.push({ b, t: BUFFER, fwd: intent.move });
    for (const w of this.want) w.t -= dt;
    this.want = this.want.filter((w) => w.t > 0);
    if ((this.comboT -= dt) <= 0) this.combo = 0;
    if (this.state !== 'block' && !this.helpless) this.guard = Math.min(100, this.guard + 9 * dt);
    const md = this.model;
    const clip = md.clip(md.current);

    switch (this.state) {
      case 'idle': {
        this.taken = 0;
        if (intent.block) { this.set('block', 'block', 0.06); this.guardT = 0; break; }
        if (this.tryAct(opp)) break;
        const v = intent.move > 0.3 ? 1 : intent.move < -0.3 ? -1 : 0;
        const want = v > 0 ? 'walk_f' : v < 0 ? 'walk_b' : 'idle';
        if (md.current !== want) md.play(want, 0.14);
        if (v) this.x += this.face * v * (md.clip(want).speed ?? 1) * this.kit.speed * this.scale * dt;
        break;
      }
      case 'block':
        if (this.stun > 0) { this.stun -= dt; break; }
        if (!intent.block) { this.set('idle', 'idle', 0.12); break; }
        if (md.current !== 'block') md.play('block', 0.1);
        break;
      case 'dash': {
        const dur = this.dashDir > 0 ? 0.26 : 0.3;
        const k = Math.min(this.t / dur, 1);
        this.x += this.face * this.dashDir * (this.dashDir > 0 ? 1.5 : 1.25) * this.scale * (1 - k) * 2 * dt / dur;
        this.invulnerable = this.dashDir < 0 && this.t < 0.2;
        if (this.t >= clip.dur) { this.invulnerable = false; this.set('idle', 'idle', 0.1); }
        else if (this.t > dur && this.tryAct(opp)) this.invulnerable = false;
        break;
      }
      case 'attack': {
        const mv = this.move!;
        if (this.stepLeft > 0) { const d = Math.min(this.stepLeft, this.stepV * dt); this.stepLeft -= d; this.x += this.face * d; }
        const hits = clip.hits;
        while (this.done < hits.length && this.t >= hits[this.done].t) this.strike(opp, mv, hits[this.done++], events);
        if (this.touched && this.done >= hits.length && this.t > (hits[hits.length - 1]?.t ?? 0) + 0.05 && this.tryAct(opp, mv)) break;
        if (this.t >= clip.dur) { this.move = null; this.set('idle', 'idle', 0.12); }
        break;
      }
      case 'hit':
        if ((this.stun -= dt) <= 0) { this.set('idle', 'idle', 0.14); this.model.emotion = 'focus'; }
        break;
      case 'stagger':
        if (this.t >= clip.dur) { this.set('idle', 'idle', 0.14); this.model.emotion = 'focus'; }
        break;
      case 'down':
        if (this.t >= clip.dur + 0.25) { this.set('getup', 'getup', 0.1); }
        break;
      case 'getup':
        if (this.t >= clip.dur) { this.invulnerable = false; this.set('idle', 'idle', 0.12); this.model.emotion = 'focus'; }
        break;
    }
    // being shoved slides you; friction stops it
    if (this.vel) {
      this.x += this.vel * dt;
      this.vel *= Math.max(0, 1 - 7 * dt);
      if (Math.abs(this.vel) < 0.05) this.vel = 0;
    }
  }

  /** act on a remembered press. `from`: the move being cancelled, if any. */
  private tryAct(opp: Fighter, from?: Move): boolean {
    for (let i = 0; i < this.want.length; i++) {
      const w = this.want[i];
      if (w.b === 'D') {
        if (from) continue;
        this.want.splice(i, 1);
        this.dashDir = w.fwd < -0.3 ? -1 : 1;
        this.move = null;
        this.set('dash', this.dashDir > 0 ? 'dash_f' : 'dash_b', 0.05);
        return true;
      }
      const id = this.pick(w.b, w.fwd);
      if (!id) continue;
      const mv = MOVES[id];
      const chained = !!from && (this.kit.L.includes(from.clip) && this.kit.L.includes(id) || this.kit.K.includes(from.clip) && this.kit.K.includes(id));
      if (from && !(mv.level > from.level || chained)) continue;
      this.want.splice(i, 1);
      if (!from) this.move = null;
      this.start(id);
      void opp;
      return true;
    }
    return false;
  }

  private strike(opp: Fighter, mv: Move, hit: { reach: number; z: number; bone: string }, events: HitEvent[]) {
    const dist = Math.abs(opp.x - this.x);
    if (dist > hit.reach + 0.24 * opp.scale || opp.invulnerable || opp.state === 'ko' || opp.state === 'down' || opp.state === 'getup' || opp.state === 'cine') return;
    this.touched = true;
    const at = this.model.bone(hit.bone).clone();
    at.x = this.x + this.face * Math.min(dist - 0.12, hit.reach);
    at.y = hit.z;
    at.z = 0.05;
    const ev: HitEvent = { by: this, on: opp, move: mv, kind: 'hit', counter: false, ko: false, at, dmg: 0 };
    const push = mv.push * this.face;
    if (opp.state === 'block' && opp.guard > 0) {
      if (opp.guardT < PARRY && mv.level < 4) {          // turned aside: the attacker is left open
        ev.kind = 'parry';
        this.move = null; this.set('stagger', 'stagger', 0.06); this.model.emotion = 'shock';
        opp.meter = Math.min(100, opp.meter + 14);
      } else {
        opp.guard -= mv.guard * this.kit.power;
        ev.dmg = mv.dmg * 0.1 * this.kit.power;
        opp.hp = Math.max(1, opp.hp - ev.dmg);
        opp.vel = push * 0.7;
        if (opp.guard <= 0) {                             // guard broken: staggered and wide open
          ev.kind = 'break'; opp.guard = 40;
          opp.set('stagger', 'stagger', 0.06); opp.model.emotion = 'shock';
        } else {
          ev.kind = 'block'; opp.stun = mv.block;
          opp.model.play('block_hit', 0.04);
        }
        this.meter = Math.min(100, this.meter + mv.dmg * 0.4);
        opp.meter = Math.min(100, opp.meter + mv.dmg * 0.3);
      }
    } else {
      ev.counter = opp.state === 'attack';
      const scaling = Math.max(0.4, 1 - 0.1 * opp.taken);
      ev.dmg = mv.dmg * this.kit.power * scaling * (ev.counter ? 1.25 : 1);
      opp.hp = Math.max(0, opp.hp - ev.dmg);
      opp.taken++; opp.wear = Math.min(1, opp.wear + ev.dmg / 160);
      this.combo++; this.comboT = 1.2;
      this.meter = Math.min(100, this.meter + mv.dmg * 0.9);
      opp.meter = Math.min(100, opp.meter + mv.dmg * 0.6);
      opp.vel = push;
      opp.move = null;
      opp.model.emotion = 'pain';
      if (opp.hp <= 0) { ev.ko = true; opp.set('ko', 'ko', 0.06); opp.model.emotion = 'out'; opp.vel = push * 0.6; }
      else if (mv.fall === 'down' || (mv.fall === 'stagger' && ev.counter)) { opp.set('down', 'knockdown', 0.05); opp.invulnerable = true; opp.vel = push * 1.3; }
      else if (mv.fall === 'stagger') opp.set('stagger', 'stagger', 0.05);
      else { opp.set('hit', mv.zone === 'high' ? 'hit_high' : 'hit_body', 0.04); opp.stun = mv.stun; }
    }
    events.push(ev);
  }

  /** end of round: put the fighter in a pose the director chose */
  pose(s: State, clip: string, fade = 0.2) { this.move = null; this.vel = 0; this.set(s, clip, fade); }
}

/** Keep the two apart and inside the arena. */
export function separate(a: Fighter, b: Fighter) {
  const min = BODY * (a.scale + b.scale);
  const left = a.x < b.x ? a : b, right = left === a ? b : a;
  const gap = right.x - left.x;
  if (gap < min) {
    const push = (min - gap) / 2;
    left.x -= push; right.x += push;
  }
  for (const f of [left, right]) f.x = Math.max(-ARENA, Math.min(ARENA, f.x));
  if (right.x - left.x < min) { if (left.x <= -ARENA + 1e-3) right.x = left.x + min; else left.x = right.x - min; }
}

/** The opponent's mind: reads the distance and what the other fighter is doing, and presses the same buttons. */
export class AI {
  private think = 0.3; private plan: Intent = { move: 0, block: false, press: [] }; private hold = 0; private queue: { b: Button; at: number; fwd: number }[] = [];
  /** 0 easy .. 1 hard: scales reaction and discipline */ level = 0.5;
  constructor(private me: Fighter) {}

  intent(dt: number, opp: Fighter, rnd: () => number): Intent {
    const me = this.me, k = me.kit.ai;
    const press: Button[] = [];
    this.think -= dt; this.hold -= dt;
    for (const q of this.queue) q.at -= dt;
    while (this.queue.length && this.queue[0].at <= 0) { const q = this.queue.shift()!; press.push(q.b); this.plan.move = q.fwd; }
    const d = Math.abs(opp.x - me.x);
    const reach = 0.95 * me.scale;
    // a strike is coming: guard it, sometimes too late, sometimes not at all
    if (opp.state === 'attack' && opp.t < 0.12 && d < 1.6 && this.hold <= 0 && !me.busy) {
      if (rnd() < k.guard * (0.55 + 0.6 * this.level)) { this.plan = { move: 0, block: true, press: [] }; this.hold = 0.35 + rnd() * 0.25; this.think = this.hold; }
      else this.hold = 0.3;
    }
    if (this.think <= 0 && !me.busy) {
      this.think = k.react * (1.5 - this.level) * (0.7 + rnd() * 0.6);
      this.plan = { move: 0, block: false, press: [] };
      const open = opp.helpless && opp.state !== 'down' && opp.state !== 'getup';
      if (opp.state === 'down' || opp.state === 'getup') this.plan.move = d > 1.7 ? 1 : d < 1.2 ? -1 : 0;   // wait just out of range
      else if (d > reach + 0.9) { this.plan.move = 1; if (d > 2.6 && rnd() < 0.35 * k.press) press.push('D'); }
      else if (d > reach + 0.15) {                                                                           // edge of range: poke, step in, or hold ground
        const r = rnd();
        if (r < 0.3 * k.press) { this.plan.move = 1; press.push('K'); }
        else if (r < 0.7 * k.press + 0.2) this.plan.move = 1;
        else if (r > 0.92) { this.plan.move = -1; }
      } else {
        const r = rnd();
        if (open || r < k.press * (0.6 + 0.4 * this.level)) {
          const special = me.meter >= 50 && (open || rnd() < 0.25);
          if (special) press.push('S');
          else if (rnd() < 0.55) this.combo(['L', 'L', 'L', rnd() < 0.5 ? 'H' : 'K'].slice(0, 1 + Math.floor(rnd() * 4)) as Button[], 0);
          else if (rnd() < 0.5) this.combo(['K', 'K'], rnd() < 0.4 ? 1 : 0);
          else { this.plan.move = rnd() < 0.5 ? 1 : -1; press.push('H'); }
        } else if (r > 0.9 - 0.2 * (1 - k.press)) { this.plan.move = -1; if (rnd() < 0.4) press.push('D'); }
        else if (rnd() < k.guard * 0.5) { this.plan.block = true; this.hold = 0.3; }
      }
      if (rnd() < k.whiff * (1 - this.level) && d < reach + 1.2 && !press.length) press.push(rnd() < 0.5 ? 'H' : 'K');   // impatience
    }
    return { move: this.plan.move, block: this.plan.block && this.hold > 0, press };
  }

  private combo(buttons: Button[], fwd: number) {
    buttons.forEach((b, i) => this.queue.push({ b, at: i * 0.2, fwd }));
  }
}
