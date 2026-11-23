// Story scripts run on game time: waits, dialogue with faces and gestures, scripted walks, camera framing
// (two-shots, close-ups, over-the-shoulder, slow push-ins), letterboxing and fades. A level's script is an
// async function that awaits these; when the level is torn down its director stops stepping, so abandoned
// scripts simply never resume.
import { Vector3 } from '@babylonjs/core';
import type { Game } from '../game/Game';
import type { UI } from '../ui/UI';
import type { Audio } from '../audio/Audio';
import type { Fighter } from '../game/Fighter';
import type { PlayerController } from '../game/Player';

export interface SpeakerDef { name: string; color: string; voice: string }

export const SPEAKERS: Record<string, SpeakerDef> = {
  kai: { name: 'Kai', color: '#d9542b', voice: 'KAI' },
  ines: { name: 'Grandma Ines', color: '#7a5ea8', voice: 'INES' },
  mira: { name: 'Mira', color: '#2f9a6a', voice: 'MIRA' },
  bram: { name: 'Bram', color: '#a8662e', voice: 'BRAM' },
  nell: { name: 'Nell', color: '#c9930f', voice: 'NELL' },
  halvard: { name: 'Commodore Halvard', color: '#36598f', voice: 'HALVARD' },
  gorrick: { name: 'Baron Gorrick', color: '#7d3526', voice: 'GORRICK' },
  vale: { name: 'Admiral Vale', color: '#4d6178', voice: 'VALE' },
  seren: { name: 'Seren', color: '#c77a2a', voice: 'SEREN' },
  teo: { name: 'Teo', color: '#6a8a3a', voice: 'TEO' },
  hana: { name: 'Hana', color: '#b5476a', voice: 'HANA' },
  elias: { name: 'Elias Finch', color: '#5a7a8a', voice: 'BRAM' },
  villager: { name: 'Villager', color: '#6f7f68', voice: 'TEO' },
  fisher: { name: 'Old Fisher', color: '#6f7f68', voice: 'GORRICK' },
  child: { name: 'Child', color: '#8a9a5a', voice: 'NELL' },
  marine: { name: 'Marine', color: '#40527a', voice: 'HALVARD' },
  thug: { name: 'Thug', color: '#6a4a3a', voice: 'GORRICK' },
  wrecker: { name: 'Wrecker', color: '#3a5a5a', voice: 'BRAM' },
  lissa: { name: 'Lissa', color: '#c9a0b0', voice: 'NELL' },
  narrator: { name: '', color: 'transparent', voice: '' },
};

/** Words that suggest an expression when a line doesn't give one. */
export function inferEmotion(text: string): string {
  const t = text.toLowerCase();
  if (/!{2,}|[A-Z]{4,}/.test(text)) return 'shout';
  if (/\b(sorry|gone|lost|never came back|miss|died|dead|alone)\b/.test(t)) return 'sad';
  if (/\b(ha|haha|hah)\b/.test(t)) return 'laugh';
  if (/\?!|what\b.*\?$/.test(t)) return 'shock';
  if (/!$/.test(text)) return 'determined';
  return 'neutral';
}

type Cond = { test: () => boolean; res: () => void };

export class Director {
  time = 0;
  cast = new Map<string, Fighter>();
  private waits: { t: number; res: () => void }[] = [];
  private conds: Cond[] = [];
  private walkers = new Map<Fighter, { to: Vector3; run: boolean; res: () => void; stopDist: number }>();
  private letterbox = 0;
  private letterTarget = 0;
  private speaking: Fighter | null = null;
  private listeners: Fighter[] = [];
  private push: { from: Vector3; to: Vector3; target: Vector3; t: number; dur: number } | null = null;
  cineActive = false;
  stopped = false;

  constructor(readonly game: Game, readonly ui: UI, readonly audio: Audio, readonly pc: PlayerController) {}

  get player(): Fighter { return this.pc.f; }

  // ------------------------------------------------------------------------------------------ time
  step(dt: number): void {
    if (this.stopped) return;
    this.time += dt;
    for (const [f, w] of this.walkers) {
      const d = w.to.subtract(f.pos);
      d.y = 0;
      const dist = d.length();
      if (dist < w.stopDist || !f.alive) {
        f.intent.move.setAll(0);
        this.walkers.delete(f);
        w.res();
        continue;
      }
      if (f.state === 'cine') f.setState('idle');
      f.intent.move.copyFrom(d.scale(1 / dist).scale(Math.min(1, dist / 0.6 + 0.3)));
      f.intent.run = w.run;
      f.intent.face = undefined;
    }
    const due = this.waits.filter((w) => w.t <= this.time);
    if (due.length) { this.waits = this.waits.filter((w) => w.t > this.time); for (const w of due) w.res(); }
    if (this.conds.length) {
      const ready = this.conds.filter((c) => c.test());
      if (ready.length) { this.conds = this.conds.filter((c) => !ready.includes(c)); for (const c of ready) c.res(); }
    }
    // talking mouths and listeners' gaze
    const talking = this.ui.talking;
    for (const f of this.cast.values()) f.model.face.talk = f === this.speaking && talking ? 1 : 0;
    if (this.speaking) {
      const head = this.headOf(this.speaking);
      for (const l of this.listeners) { l.proc.lookTarget = head; l.proc.lookWeight = 0.85; }
    }
    // letterbox ease
    this.letterbox += (this.letterTarget - this.letterbox) * Math.min(1, dt * 3);
    this.game.r.fx.letterbox = this.letterbox;
    // slow camera push
    if (this.push) {
      const p = this.push;
      p.t += dt;
      const u = Math.min(1, p.t / p.dur);
      const e = u * u * (3 - 2 * u);
      this.game.cam.shotTo({ pos: Vector3.Lerp(p.from, p.to, e), target: p.target });
      if (u >= 1) this.push = null;
    }
  }

  wait(s: number): Promise<void> {
    return new Promise((res) => this.waits.push({ t: this.time + s, res }));
  }

  until(test: () => boolean): Promise<void> {
    if (test()) return Promise.resolve();
    return new Promise((res) => this.conds.push({ test, res }));
  }

  // ------------------------------------------------------------------------------------------ cast
  add(key: string, f: Fighter): Fighter { this.cast.set(key, f); return f; }
  get(key: string): Fighter | undefined { return key === 'kai' ? this.player : this.cast.get(key); }

  headOf(f: Fighter): Vector3 { return f.pos.add(new Vector3(0, f.height * 0.92, 0)); }

  /** Cinematic mode: letterbox, HUD off, player control off, all actors calm. */
  cine(on: boolean): void {
    this.cineActive = on;
    this.letterTarget = on ? 1 : 0;
    this.ui.showHud(!on);
    this.pc.enabled = !on;
    this.cast.set('kai', this.player);
    if (on) {
      this.player.intent.move.setAll(0);
    } else {
      this.game.r.fx.dof = [5, 4, 0];
      this.game.cam.release();
      this.push = null;
      this.speaking = null;
      for (const l of this.listeners) { l.proc.lookTarget = null; }
      this.listeners = [];
      for (const f of this.cast.values()) { if (f.state === 'cine') { f.setState('idle'); f.locomotionAnim(0, 0.3); } f.model.face.set('neutral', 4); }
    }
  }

  /** Who looks at the speaker during dialogue. */
  listen(...keys: string[]): void {
    this.listeners = keys.map((k) => this.get(k)).filter((f): f is Fighter => !!f);
  }

  // ------------------------------------------------------------------------------------------ dialogue
  async say(who: string, text: string, expr?: string, anim?: string): Promise<void> {
    const sp = SPEAKERS[who] ?? { name: who, color: '#555', voice: '' };
    const f = this.get(who) ?? null;
    this.speaking = f;
    if (f) {
      f.model.face.set(expr ?? inferEmotion(text), 9);
      if (anim) this.act(f, anim, anim === 'talk' || anim === 'cry' || anim === 'kneel_hold' || anim === 'kneel_grief' || anim === 'cross_arms' || anim === 'sit');
      f.proc.lookTarget = null;
      for (const l of this.listeners) if (l !== f && l.alive) { l.proc.lookTarget = this.headOf(f); l.proc.lookWeight = 0.85; }
    }
    this.ui.onBlip = () => { if (sp.voice) this.audio.blip(sp.voice); };
    const auto = this.cineActive ? 0 : 1.4 + text.length / 22;
    await this.ui.say({ name: sp.name, color: sp.color }, text, auto);
    this.ui.hideDialogue();
    this.speaking = null;
  }

  /** A run of lines: [who, text, expr?, anim?]. */
  async talk(lines: [string, string, string?, string?][]): Promise<void> {
    for (const [w, t, e, a] of lines) await this.say(w, t, e, a);
  }

  expr(who: string, e: string): void { this.get(who)?.model.face.set(e, 6); }

  // ------------------------------------------------------------------------------------------ acting
  /** Plays a clip with the actor held still (cine state). */
  act(f: Fighter | string, clip: string, loop = false, fade = 0.25): void {
    const a = typeof f === 'string' ? this.get(f) : f;
    if (!a) return;
    a.setState('cine');
    a.intent.move.setAll(0);
    a.play(clip, loop, fade);
  }

  release(f: Fighter | string): void {
    const a = typeof f === 'string' ? this.get(f) : f;
    if (!a || !a.alive) return;
    a.setState('idle');
    a.locomotionAnim(0, 0.3);
  }

  walk(f: Fighter | string, to: Vector3, run = false, stopDist = 0.35): Promise<void> {
    const a = typeof f === 'string' ? this.get(f)! : f;
    if (a.state === 'cine') a.setState('idle');
    return new Promise((res) => this.walkers.set(a, { to: to.clone(), run, res, stopDist }));
  }

  face(f: Fighter | string, at: Vector3 | Fighter | string, instant = false): void {
    const a = typeof f === 'string' ? this.get(f) : f;
    if (!a) return;
    const p = at instanceof Vector3 ? at : (typeof at === 'string' ? this.get(at)?.pos : at.pos);
    if (p) a.faceTowards(p, instant);
  }

  place(f: Fighter | string, p: Vector3, yaw?: number): void {
    const a = typeof f === 'string' ? this.get(f) : f;
    if (!a) return;
    a.place(p, yaw ?? a.yaw);
    a.vel.setAll(0);
  }

  // ------------------------------------------------------------------------------------------ camera
  /** Pulls a camera position in toward its target if scenery or the ground is in the way. Returns [pos, free fraction]. */
  private unblock(target: Vector3, pos: Vector3): [Vector3, number] {
    const d = pos.subtract(target);
    const len = d.length();
    if (len < 1e-3) return [pos, 1];
    const dir = d.scale(1 / len);
    const free = Math.min(len, this.game.collision.raycast(target, dir, len, 0.2));
    const p = free < len - 0.05 ? target.add(dir.scale(Math.max(0.7, free - 0.25))) : pos;
    const g = this.game.collision.groundAt(p.x, p.z, p.y + 0.5);
    if (p.y < g + 0.35) p.y = g + 0.35;
    return [p, free / len];
  }

  /** Depth of field for the next shot: focus distance (m), in-focus range, amount (0 = off). */
  focus(dist: number, range = 1.2, amount = 1): void {
    this.game.r.fx.dof = [dist, range, amount];
  }

  shot(pos: Vector3, target: Vector3, dur = 0, fov?: number): void {
    this.push = null;
    // default: focus on what the shot looks at, gently
    if (this.cineActive) this.focus(Vector3.Distance(pos, target), 3.5, 0.55);
    this.game.cam.shotTo({ pos, target, dur, fov });
  }

  /** Slow push from one camera position to another, looking at `target`. */
  drift(from: Vector3, to: Vector3, target: Vector3, dur: number): void {
    this.game.cam.shotTo({ pos: from, target });
    this.push = { from, to, target, t: 0, dur };
  }

  /** Two-shot of a and b from the side (`side` = +1 / -1), framed by their separation. */
  two(a: Fighter | string, b: Fighter | string, side = 1, dur = 0, opts: { dist?: number; height?: number; bias?: number; fov?: number } = {}): void {
    const A = typeof a === 'string' ? this.get(a)! : a;
    const B = typeof b === 'string' ? this.get(b)! : b;
    const bias = opts.bias ?? 0.5;
    const mid = Vector3.Lerp(A.pos, B.pos, bias);
    const ab = B.pos.subtract(A.pos);
    ab.y = 0;
    const sep = Math.max(1.2, ab.length());
    const dist = opts.dist ?? 1.8 + sep * 1.05;
    const h = opts.height ?? 1.45;
    const target = mid.add(new Vector3(0, Math.max(A.height, B.height) * 0.78, 0));
    let best: [Vector3, number] | null = null;
    for (const sd of [side, -side]) {
      const n = new Vector3(-ab.z, 0, ab.x).normalize().scale(sd);
      const r = this.unblock(target, mid.add(n.scale(dist)).add(new Vector3(0, h, 0)));
      if (!best || r[1] > best[1] + 0.15) best = r;
      if (r[1] > 0.95) break;
    }
    this.shot(best![0], target, dur, opts.fov ?? 0.62);
  }

  /** Close-up of one actor's face from in front, slightly off-axis. */
  close(f: Fighter | string, side = 1, dur = 0, opts: { dist?: number; fov?: number; height?: number; angle?: number } = {}): void {
    const A = typeof f === 'string' ? this.get(f)! : f;
    const fwd = A.forward;
    const ang = (opts.angle ?? 0.45) * side;
    const dir = new Vector3(fwd.x * Math.cos(ang) - fwd.z * Math.sin(ang), 0, fwd.x * Math.sin(ang) + fwd.z * Math.cos(ang));
    const head = this.headOf(A).add(new Vector3(0, -0.06, 0));
    const dist = opts.dist ?? 1.15 + A.height * 0.22 + A.radius * 0.6;
    const [pos] = this.unblock(head, head.add(dir.scale(dist)).add(new Vector3(0, opts.height ?? 0.05, 0)));
    this.shot(pos, head.add(new Vector3(0, -0.04, 0)), dur, opts.fov ?? 0.5);
    this.focus(Vector3.Distance(pos, head), 0.9, 1);
  }

  /** Over the shoulder of `from`, looking at `to`'s face. */
  ots(from: Fighter | string, to: Fighter | string, side = 1, dur = 0, fov = 0.55): void {
    const A = typeof from === 'string' ? this.get(from)! : from;
    const B = typeof to === 'string' ? this.get(to)! : to;
    const d = B.pos.subtract(A.pos);
    d.y = 0;
    const n = d.normalizeToNew();
    const right = new Vector3(n.z, 0, -n.x).scale(side);
    const tgt = this.headOf(B).add(new Vector3(0, -0.05, 0));
    const [pos] = this.unblock(tgt, this.headOf(A).add(n.scale(-0.9 - A.radius)).add(right.scale(0.55 + A.radius * 0.5)).add(new Vector3(0, 0.12, 0)));
    this.shot(pos, tgt, dur, fov);
    this.focus(Vector3.Distance(pos, tgt), 1.0, 1);
  }

  /** Wide establishing shot orbiting `center` from yaw `ang` at distance and height. */
  wide(center: Vector3, ang: number, dist: number, height: number, dur = 0, fov = 0.75): void {
    const [pos] = this.unblock(center, center.add(new Vector3(Math.sin(ang) * dist, height, Math.cos(ang) * dist)));
    this.shot(pos, center, dur, fov);
    this.focus(dist, dist, 0.35);
  }

  async fade(to: number, dur = 0.6, color = '#000'): Promise<void> {
    void this.ui.fade(to, dur, color);
    await this.wait(dur);
  }

  /** Chapter title card (game time). */
  async card(num: string, title: string, sub: string, dur = 4.2): Promise<void> {
    void this.ui.chapterCard(num, title, sub, dur);
    await this.wait(dur + 0.8);
  }

  async subtitle(text: string, dur: number): Promise<void> {
    this.ui.showSubtitle(text);
    await this.wait(dur);
    this.ui.showSubtitle(null);
  }

  stop(): void {
    this.stopped = true;
    this.waits = [];
    this.conds = [];
    this.walkers.clear();
    this.game.r.fx.letterbox = 0;
  }
}
