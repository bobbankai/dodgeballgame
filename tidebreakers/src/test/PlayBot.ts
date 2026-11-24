// A play-bot that plays the story the way a person would, to measure how long it takes. It only uses
// the controls: a virtual stick (run toward the objective marker, chase enemies, step out of warning
// circles), button presses (combos, launchers, specials, the super, crew assists, dodges, parries, jumps
// over tide rings) and the dialogue button (pressed once a line has had time to be read). It reacts
// with a human delay and only sometimes defends in time, so it gets hit, dies and restarts from
// checkpoints like a player does. When it is stuck on scenery for a long time it is moved to the marker
// (counted, so the report says how often). Time is counted only while a level is running.
import { Vector3 } from '@babylonjs/core';
import type { Flow } from '../Flow';
import type { Game } from '../game/Game';
import type { Fighter } from '../game/Fighter';
import type { Input, Action } from '../core/Input';
import type { UI } from '../ui/UI';
import type { PlayerController } from '../game/Player';

interface Span { time: number; deaths: number; rescues: number; lines: number; assisted: boolean; lost: number }

export class PlayBot {
  /** reading speed for dialogue, characters per second (about 200 words a minute) */
  readCps = 18;
  /** chance to see a telegraphed attack coming and defend against it (grows as a player learns a fight) */
  skill = 0.5;
  private get learned(): number { return Math.min(0.9, this.skill + 0.08 * this.span().deaths); }
  spans = new Map<string, Span>();
  order: string[] = [];
  credits = 0;
  private key = '';
  private lineSeen = '';
  private bestDist = 1e9;
  private bestT = 0;
  private detourT = 0;
  private detourDir = new Vector3();
  private detours = 0;
  private pressT = 0;
  private comboN = 0;
  private pauseT = 0;
  private assistT = 8;
  private heldT = new Map<Action, number>();
  private seen = new WeakMap<object, number>();   // hazards / rings -> decision (0 ignore, 1 defend)
  private swing = new Map<Fighter, number>();      // enemy mid-telegraph -> 0 keep swinging, 1 dodge, 2 parry
  private wasAlive = true;
  private fightIdleT = 0;
  private lastEnemyHp = 0;
  private wander = 0;
  private attemptT = 0;   // time since this checkpoint was (re)started: lost if Kai dies

  constructor(readonly flow: Flow, readonly game: Game, readonly kai: Fighter, readonly pc: PlayerController,
    readonly input: Input, readonly ui: UI) {}

  private span(): Span {
    let s = this.spans.get(this.key);
    if (!s) { s = { time: 0, deaths: 0, rescues: 0, lines: 0, assisted: false, lost: 0 }; this.spans.set(this.key, s); this.order.push(this.key); }
    return s;
  }

  private press(a: Action, hold = 0): void {
    this.input.press(a);
    this.heldT.set(a, hold);
  }

  private stick(dir: Vector3 | null): void {
    if (!dir || dir.lengthSquared() < 1e-4) { this.input.stick = { x: 0, y: 0 }; return; }
    const yaw = this.game.cam.forwardYaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const n = Math.hypot(dir.x, dir.z);
    const x = dir.x / n, z = dir.z / n;
    this.input.stick = { x: x * fz - z * fx, y: x * fx + z * fz };
  }

  update(dt: number): void {
    const f = this.flow, L = f.level, k = this.kai, ui = this.ui;
    // let go of held buttons when their time is up
    for (const [a, t] of this.heldT) {
      if (t - dt <= 0) { this.input.release(a); this.heldT.delete(a); } else this.heldT.set(a, t - dt);
    }
    if (!L) {
      if (f.inCredits) this.credits += dt;
      this.stick(null);
      return;
    }
    if (f.isLoading || f.paused) { this.stick(null); return; }
    const key = `${f.levelId}:${f.at || 'start'}`;
    if (key !== this.key) { this.key = key; this.bestDist = 1e9; this.detours = 0; this.attemptT = 0; }
    const sp = this.span();
    sp.time += dt;
    this.attemptT += dt;
    if (this.wasAlive && !k.alive) { sp.deaths++; sp.lost += this.attemptT; this.attemptT = 0; }
    this.wasAlive = k.alive;
    // a player who has died here four times has learned the fight: they stop taking the big hits
    if (sp.deaths >= 4 && k.alive && k.hp < k.maxHp * 0.3) { k.hp = k.maxHp * 0.6; sp.assisted = true; }

    // ---- dialogue: read the line, then press the button
    const line = ui.line;
    if (line && line.text !== this.lineSeen) { this.lineSeen = line.text; sp.lines++; }
    if (L.dir.cineActive) {
      this.stick(null);
      if (line && !line.auto) {
        const need = Math.max(line.text.length / ui.textSpeed + 0.5, line.text.length / this.readCps + 0.35);
        if (ui.lineT > need) this.press('confirm');
      }
      return;
    }
    if (!this.pc.enabled || k.state === 'cine' || !k.alive) { this.stick(null); return; }

    if (this.game.combatActive) { this.fight(dt); return; }
    this.pc.locked = null;
    if (L.marker) { this.travel(dt, L.marker); return; }
    this.stick(null);
  }

  // ------------------------------------------------------------------------------------------ travel
  private travel(dt: number, target: Vector3): void {
    const k = this.kai;
    const to = target.subtract(k.pos);
    to.y = 0;
    const dist = to.length();
    if (dist < this.bestDist - 0.3) { this.bestDist = dist; this.bestT = 0; this.detours = 0; }
    else this.bestT += dt;
    if (this.detourT > 0) {
      this.detourT -= dt;
      this.stick(this.detourDir);
      return;
    }
    if (this.bestT > 2.5) {
      this.bestT = 0;
      this.detours++;
      if (this.detours > 5) {
        // a person would have found the way by now
        k.place(target.add(new Vector3(0.5, 0, 0.5)), k.yaw);
        this.span().rescues++;
        this.detours = 0;
        this.bestDist = 1e9;
        return;
      }
      const side = this.detours % 2 ? 1 : -1;
      const n = to.normalizeToNew();
      this.detourDir = new Vector3(n.z * side, 0, -n.x * side).scale(0.85).add(n.scale(-0.35));
      this.detourT = 0.9 + this.detours * 0.3;
      if (this.detours >= 2) this.press('jump');
      return;
    }
    this.stick(to);
  }

  // ------------------------------------------------------------------------------------------ fight
  private fight(dt: number): void {
    const g = this.game, k = this.kai;
    const enemies = g.enemies();
    // 1. warning circles: step out (when noticed)
    for (const h of g.hazards) {
      if (h.done || h.team === 'player') continue;
      let d = this.seen.get(h);
      if (d === undefined) { d = Math.random() < this.learned + 0.25 ? 1 : 0; this.seen.set(h, d); }
      const dx = k.pos.x - h.pos.x, dz = k.pos.z - h.pos.z;
      const dist = Math.hypot(dx, dz);
      if (d && dist < h.radius + 0.9 && h.delay < 1.0) {
        const away = dist > 0.05 ? new Vector3(dx, 0, dz) : new Vector3(1, 0, 0);
        this.stick(away);
        if (h.delay < 0.35 && dist < h.radius) this.press('dodge');
        return;
      }
    }
    // 2. tide rings: jump them
    for (const r of g.rings) {
      if (r.damage <= 0 || r.hit.has(k)) continue;
      let d = this.seen.get(r);
      if (d === undefined) { d = Math.random() < this.learned + 0.2 ? 1 : 0; this.seen.set(r, d); }
      const dist = Math.hypot(k.pos.x - r.pos.x, k.pos.z - r.pos.z);
      if (d && dist - r.r > 0 && dist - r.r < r.speed * 0.25 && k.onGround) { this.press('jump'); this.seen.set(r, 0); }
    }
    // 3. pick a target
    let t: Fighter | null = null, best = 1e9;
    for (const e of enemies) {
      const dd = Math.hypot(e.pos.x - k.pos.x, e.pos.z - k.pos.z) + (e === this.flow.level?.boss?.f ? -2 : 0);
      if (dd < best) { best = dd; t = e; }
    }
    if (!t) {
      // nothing to hit right now (the serpent is circling): keep moving near the middle of the arena
      this.pc.locked = null;
      const a = g.collision.arena;
      this.wander += dt * 0.6;
      if (a) {
        const want = new Vector3(a.x + Math.cos(this.wander) * a.r * 0.35, 0, a.z + Math.sin(this.wander) * a.r * 0.35);
        this.stick(want.subtract(k.pos).scale(0.6));
      } else this.stick(null);
      return;
    }
    this.pc.locked = t;
    const to = t.pos.subtract(k.pos);
    to.y = 0;
    const dist = to.length();
    // stuck: no progress on the fight for a long while (target out of reach): move next to it
    const hpSum = enemies.reduce((s, e) => s + e.hp, 0);
    if (hpSum < this.lastEnemyHp - 0.01) this.fightIdleT = 0; else this.fightIdleT += dt;
    this.lastEnemyHp = hpSum;
    if (this.fightIdleT > 25 && dist > 4) {
      this.fightIdleT = 0;
      k.place(t.pos.add(to.normalizeToNew().scale(-1.6)), k.yaw);
      this.span().rescues++;
    }
    // 4. defend against a telegraphed swing, sometimes
    for (const e of enemies) {
      if (e.telegraphing <= 0) { this.swing.delete(e); continue; }
      const de = Math.hypot(e.pos.x - k.pos.x, e.pos.z - k.pos.z);
      if (de > 4.5) continue;
      let choice = this.swing.get(e);
      if (choice === undefined) {
        // hurt players play it safer
        const sk = Math.min(0.95, this.learned + (k.hp < k.maxHp * 0.35 ? 0.2 : 0));
        const roll = Math.random();
        choice = roll < sk * 0.6 ? 1 : roll < sk ? 2 : 0;
        this.swing.set(e, choice);
      }
      if (choice === 1 && e.telegraphing < 0.25) {
        const side = new Vector3(-(e.pos.z - k.pos.z), 0, e.pos.x - k.pos.x);
        this.stick(side.subtract(new Vector3(e.pos.x - k.pos.x, 0, e.pos.z - k.pos.z).scale(0.5)));
        this.press('dodge');
        return;
      }
      if (choice === 2 && e.telegraphing < 0.12) { this.press('guard', 0.35); this.stick(null); return; }
    }
    if (this.input.isHeld('guard')) { this.stick(null); return; }
    // 5. close in
    if (dist > 2.1) {
      if (dist > 5 && dist < 10 && g.storm >= 30 && Math.random() < dt * 0.4) { this.stick(to); this.press('special2'); return; }
      this.stick(to);
      return;
    }
    this.stick(to.scale(0.3));
    // 6. attack: four-hit combos with a breath between, a launcher now and then, specials when the meter allows
    this.pressT -= dt;
    this.pauseT -= dt;
    this.assistT -= dt;
    if (this.pauseT > 0 || this.pressT > 0) return;
    const near = enemies.filter((e) => Math.hypot(e.pos.x - k.pos.x, e.pos.z - k.pos.z) < 4).length;
    const boss = this.flow.level?.boss?.f === t;
    if (g.storm >= 100 && (boss || near >= 3)) { this.press('super'); this.pressT = 1.2; return; }
    if (g.storm >= 30 && near >= 2 && Math.random() < 0.35) { this.press('special1'); this.pressT = 0.9; return; }
    if (this.assistT <= 0 && this.flow.level && this.flow.level.crew.size > 0) { this.press('assist'); this.assistT = 13 + Math.random() * 6; }
    if (this.comboN === 2 && Math.random() < 0.3) { this.press('heavy', 0.1); this.comboN = 0; this.pressT = 0.6; this.pauseT = 0.5; return; }
    this.press('light');
    this.comboN++;
    this.pressT = 0.17 + Math.random() * 0.08;
    if (this.comboN >= 4) { this.comboN = 0; this.pauseT = 0.35 + Math.random() * 0.45; }
  }

  /** Minutes per checkpoint and per level. */
  report(): Record<string, unknown> {
    const levels: Record<string, { min: number; lostMin: number; deaths: number; rescues: number; lines: number; assisted: boolean }> = {};
    const beats: [string, number, number, number][] = [];
    let total = 0, lost = 0;
    for (const k of this.order) {
      const s = this.spans.get(k)!;
      const lv = k.split(':')[0];
      const l = levels[lv] ?? (levels[lv] = { min: 0, lostMin: 0, deaths: 0, rescues: 0, lines: 0, assisted: false });
      l.min += s.time / 60; l.lostMin += s.lost / 60; l.deaths += s.deaths; l.rescues += s.rescues; l.lines += s.lines; l.assisted ||= s.assisted;
      beats.push([k, +(s.time / 60).toFixed(2), s.deaths, s.rescues]);
      total += s.time;
      lost += s.lost;
    }
    for (const l of Object.values(levels)) { l.min = +l.min.toFixed(2); l.lostMin = +l.lostMin.toFixed(2); }
    // without the attempts that ended in death: what a player who never dies would spend
    return { totalMin: +(total / 60).toFixed(2), withoutDeathsMin: +((total - lost) / 60).toFixed(2), creditsMin: +(this.credits / 60).toFixed(2), levels, beats };
  }
}
