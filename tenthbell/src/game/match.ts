// One fight: rounds, the clock, turning the rules' hit events into sparks, sound, shake and score.
import { AI, ARENA, Fighter, HitEvent, Intent, separate } from './fight';
import { Game } from './game';

export interface MatchOpts {
  /** rounds needed to win */ need: number;
  /** seconds per round; Infinity for none */ time: number;
  /** AI skill 0..1 */ level: number;
  /** the fight has no clock, no round call and no K.O. banner: the story handles its ending */ story?: boolean;
  /** both fighters are driven by the AI (attract mode, tests) */ demo?: boolean;
  /** called with every hit before it is shown */ onHit?: (e: HitEvent) => void;
}

export class Match {
  phase: 'wait' | 'fight' | 'over' = 'wait';
  round = 1; clock: number;
  /** who won the last round */ winner: Fighter | null = null;
  private events: HitEvent[] = [];
  private flash = [0, 0];
  private last: (string | null)[] = [null, null];
  private roundOver: ((w: Fighter) => void) | null = null;
  private seed = 12345;
  private aiA: AI | null = null;
  /** the player's hands are tied (tutorial pauses, cutscenes inside a fight) */ locked = false;

  constructor(private game: Game, public a: Fighter, public b: Fighter, public opts: MatchOpts) {
    this.clock = opts.time;
    b.ai = new AI(b); b.ai.level = opts.level;
    if (opts.demo) { this.aiA = new AI(a); this.aiA.level = opts.level; }
  }

  private rnd = () => { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; };

  /** Play rounds until someone has won enough of them. Resolves with the winner. */
  async run(): Promise<Fighter> {
    const { game, a, b, opts } = this;
    const ui = game.ui;
    game.match = this;
    ui.hud(true, [a.kit.title, b.kit.title], opts.need);
    ui.touch(true);
    for (;;) {
      a.reset(-1.6, 1); b.reset(1.6, -1);
      this.clock = opts.time; this.phase = 'wait';
      this.bars();
      if (!opts.story) {
        ui.fade(0, 0.5);
        await game.wait(0.5);
        ui.announce(a.rounds + b.rounds + 1 >= opts.need * 2 - 1 && opts.need > 1 ? 'FINAL ROUND' : `ROUND ${this.round}`, '', 1.2);
        await game.wait(1.25);
        ui.announce('FIGHT', '', 0.8);
        game.sound.bell(392, 0.5, 1.6);
      }
      this.phase = 'fight';
      const w = this.winner = await new Promise<Fighter>((r) => { this.roundOver = r; });
      this.phase = 'over';
      const l = w === a ? b : a;
      w.rounds++;
      this.bars();
      if (opts.story) break;
      if (l.hp <= 0) {
        ui.announce('K.O.', '', 2.2, true);
        game.sound.bell(196, 0.7, 4);
        await game.wait(0.5);
        game.slow = 0.3;
        await game.wait(1.6);
        game.slow = 1;
      } else { ui.announce('TIME', '', 1.6); await game.wait(1.2); }
      w.pose('win', 'win', 0.4); w.model.emotion = 'neutral';
      await game.wait(2.2);
      if (w.rounds >= opts.need) break;
      ui.fade(1, 0.4);
      await game.wait(0.5);
      this.round++;
    }
    return this.winner!;
  }

  end() {
    this.game.match = null;
    this.game.ui.hud(false);
    this.game.ui.touch(false);
    this.game.slow = 1; this.game.freeze = 0;
  }

  private bars() {
    const { a, b } = this;
    this.game.ui.bars({ hp: a.hp, max: a.kit.hp, guard: a.guard, meter: a.meter, rounds: a.rounds }, { hp: b.hp, max: b.kit.hp, guard: b.guard, meter: b.meter, rounds: b.rounds }, this.clock);
  }

  /** dt: fight time (zero in hit-stop, shortened in slow motion); wall: real frame time */
  update(dt: number, wall: number) {
    const { game, a, b } = this;
    const fighting = this.phase === 'fight';
    const idle: Intent = { move: 0, block: false, press: [] };
    let ia = idle, ib = idle;
    if (fighting) {
      if (this.aiA) ia = this.aiA.intent(dt, b, this.rnd);
      else if (!this.locked) {
        const p = game.input.poll();
        ia = { move: p.axis * a.face, block: p.block, press: p.press };
        if (p.dash) ia = { ...ia, move: p.dash * a.face };
      }
      ib = b.ai!.intent(dt, a, this.rnd);
    } else game.input.poll();
    if (dt > 0) {
      a.update(dt, b, ia, this.events);
      b.update(dt, a, ib, this.events);
      separate(a, b);
    }
    a.place(); b.place();
    for (const e of this.events.splice(0)) this.show(e);
    [a, b].forEach((f, i) => {
      this.flash[i] = Math.max(0, this.flash[i] - wall * 7);
      f.model.flash = this.flash[i];
      f.model.damage = f.wear;
      const mv = f.state === 'attack' ? f.move!.clip : null;
      if (mv && mv !== this.last[i]) game.sound.whoosh(f.move!.level * 0.5);
      if (f.state === 'dash' && this.last[i] !== 'dash') { game.sound.step(); game.vfx.puff(f.x, 3); }
      this.last[i] = mv ?? (f.state === 'dash' ? 'dash' : null);
    });
    if (fighting && dt > 0) {
      if (this.clock !== Infinity && !this.opts.story) this.clock -= dt;
      const ko = a.state === 'ko' ? b : b.state === 'ko' ? a : null;
      if (ko) this.finish(ko);
      else if (this.clock <= 0) this.finish(a.hp / a.kit.hp >= b.hp / b.kit.hp ? a : b);
    }
    this.bars();
    game.focus.set((a.x + b.x) / 2, 1, 0);
    game.cam.fight(a.x, b.x, wall, ARENA + 1.2);
    // the score leans in as health runs out
    game.sound.intensity = 0.35 + 0.65 * (1 - Math.min(a.hp / a.kit.hp, b.hp / b.kit.hp));
  }

  private finish(w: Fighter) { const r = this.roundOver; this.roundOver = null; r?.(w); }

  private show(e: HitEvent) {
    const { game } = this;
    this.opts.onHit?.(e);
    const side = e.by === this.a ? 0 : 1, other = (1 - side) as 0 | 1;
    const power = Math.min(1.4, e.move.dmg / 12);
    const wet = (game.stage?.def.wet ?? 0) * 0.5 + e.on.wear * 0.6;
    if (e.kind === 'hit') {
      const big = e.ko || e.move.level >= 4;
      game.vfx.hit(e.at, power, e.by.face, big ? 'big' : 'hit', 0.3 + wet);
      game.sound.hit(e.move.sound, power);
      game.cam.trauma = Math.min(1, game.cam.trauma + e.move.shake + (e.ko ? 0.5 : 0));
      game.freeze = e.ko ? 0.32 : e.move.stop * (e.counter ? 1.5 : 1);
      this.flash[other] = 1;
      if (big) { game.cam.kick = 1; game.ui.flash(0.35, 0.3); }
      if (e.on.state === 'down' || e.ko) { game.sound.cheer(1); }
      if (e.counter) game.ui.call(side as 0 | 1, 'COUNTER');
      else if (e.by.combo >= 2) game.ui.call(side as 0 | 1, `${e.by.combo} HITS`);
    } else if (e.kind === 'block') {
      game.vfx.hit(e.at, 0.3, e.by.face, 'block');
      game.sound.block();
      game.cam.trauma = Math.min(1, game.cam.trauma + 0.08);
      game.freeze = 0.03;
    } else if (e.kind === 'parry') {
      game.vfx.hit(e.at, 0.6, e.by.face, 'block');
      game.sound.parry();
      game.ui.call(other, 'PARRY');
      game.freeze = 0.12;
    } else {
      game.vfx.hit(e.at, 1, e.by.face, 'big', 0);
      game.sound.hit('heavy', 1.2);
      game.ui.call(side as 0 | 1, 'GUARD BREAK');
      game.cam.trauma = Math.min(1, game.cam.trauma + 0.4);
      game.freeze = 0.14;
    }
  }
}
