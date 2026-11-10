// THE TENTH BELL, from the title screen to the credits.
// One night: Kessa Vale goes down into the Pit to bring her brother home.
import { Fighter, HitEvent } from '../game/fight';
import { Game } from '../game/game';
import { Match } from '../game/match';
import { Actor, Director } from './director';

interface Save { chapter: number; level: number; sound: boolean; quality: string }
const KEY = 'tenthbell.save';
export const loadSave = (): Save => ({ chapter: 0, level: 1, sound: true, quality: '', ...JSON.parse(localStorage.getItem(KEY) ?? '{}') });
const store = (s: Save) => localStorage.setItem(KEY, JSON.stringify(s));
const LEVELS = [['GENTLE', 0.6], ['FAIR', 1.0], ['CRUEL', 1.35]] as const;

export class Story {
  d: Director;
  save = loadSave();
  constructor(public game: Game) {
    this.d = new Director(game);
    game.sound.setEnabled(this.save.sound);
  }

  // ---------------------------------------------------------------- flow
  async run(startAt?: number) {
    const { game, d } = this;
    for (;;) {
      let ch = startAt ?? await this.title();
      startAt = undefined;
      for (; ch < CHAPTERS.length; ch++) {
        game.ui.loading(true);
        d.clear();
        const done = await CHAPTERS[ch].play(this);
        if (!done) break;
        this.save.chapter = Math.max(this.save.chapter, Math.min(ch + 1, CHAPTERS.length - 1));
        store(this.save);
      }
      d.clear();
      game.sound.setMood('none');
    }
  }

  private async title(): Promise<number> {
    const { game, d } = this;
    const ui = game.ui;
    ui.loading(true);
    await game.setStage('roof_rain');
    const k = await d.actor('kessa', -0.6, 0.2, 35, 'stand', 'focus');
    ui.loading(false);
    game.sound.setMood('theme');
    game.cam.sway = 1;
    void game.cam.shot({ pos: [1.6, 1.25, 3.1], look: [k.x - 0.9, 1.3, 0], fov: 0.42, focus: 3.4, fstop: 2.2 });
    void game.cam.shot({ pos: [2.6, 1.5, 3.6], look: [k.x - 0.9, 1.3, 0], fov: 0.42, focus: 3.9, fstop: 2.2 }, 40);
    ui.fade(0, 1.5);
    for (;;) {
      const items = [{ id: 'new', label: 'NEW STORY' }];
      if (this.save.chapter > 0) items.unshift({ id: 'go', label: 'CONTINUE', sub: CHAPTERS[this.save.chapter].name } as never);
      if (this.save.chapter > 0) items.push({ id: 'chapters', label: 'CHAPTERS' });
      items.push({ id: 'options', label: 'OPTIONS' });
      const pick = await ui.menu('THE TENTH <i>BELL</i>', 'One night. One brother. One bell that must not ring.', items, false, 'MOVE A D · GUARD S · JAB J · KICK K · HEAVY L · BELL I · DASH SPACE');
      game.sound.ui();
      let ch = -1;
      if (pick === 'new') ch = 0;
      else if (pick === 'go') ch = this.save.chapter;
      else if (pick === 'chapters') {
        const c = await ui.menu('CHAPTERS', '', [...CHAPTERS.slice(0, this.save.chapter + 1).map((c, i) => ({ id: String(i), label: c.name })), { id: 'back', label: 'BACK' }]);
        if (c !== 'back') ch = +c;
      } else await this.options();
      if (ch >= 0) { await d.fadeOut(0.8); game.cam.sway = 0; return ch; }
    }
  }

  private async options() {
    const ui = this.game.ui, s = this.save;
    for (;;) {
      const q = s.quality || this.game.g.quality;
      const pick = await ui.menu('OPTIONS', '', [
        { id: 'level', label: `OPPONENTS: ${LEVELS[s.level][0]}` }, { id: 'sound', label: `SOUND: ${s.sound ? 'ON' : 'OFF'}` },
        { id: 'quality', label: `PICTURE: ${q.toUpperCase()}`, sub: 'changing this reloads the game' }, { id: 'back', label: 'BACK' }]);
      if (pick === 'level') s.level = (s.level + 1) % 3;
      else if (pick === 'sound') { s.sound = !s.sound; this.game.sound.setEnabled(s.sound); }
      else if (pick === 'quality') { s.quality = q === 'high' ? 'medium' : q === 'medium' ? 'low' : 'high'; store(s); location.reload(); return; }
      else { store(s); return; }
      store(s);
    }
  }

  // ---------------------------------------------------------------- fights
  /** A fight the story needs won. Returns false if the player gives up. */
  async fight(a: Actor, b: Actor, opts: { need?: number; level: number; mood?: 'fight' | 'boss'; story?: boolean; onHit?: (e: HitEvent, m: Match) => void; tick?: (m: Match, dt: number) => void }): Promise<boolean> {
    const { game } = this;
    for (;;) {
      const fa = new Fighter(a.model, a.name), fb = new Fighter(b.model, b.name);
      const m: Match = new Match(game, fa, fb, { need: opts.need ?? 2, time: opts.story ? Infinity : 60, level: Math.min(1, opts.level * LEVELS[this.save.level][1]), story: opts.story,
                                                 onHit: (e) => opts.onHit?.(e, m) });
      game.sound.setMood(opts.mood ?? 'fight');
      game.tick = (dt) => { opts.tick?.(m, dt); this.pauseCheck(); };
      game.ui.fade(0, 0.5);
      const w = await m.run();
      game.tick = null;
      game.ui.hint(null);
      if (w === fa) { m.end(); return true; }
      await game.wait(1.2);
      game.ui.fade(0.75, 0.6);
      const pick = await game.ui.menu('DOWN', 'The count is not over until you say it is.', [{ id: 'again', label: 'GET UP' }, { id: 'quit', label: 'LEAVE THE PIT' }], true);
      m.end();
      if (pick === 'quit') { await this.d.fadeOut(0.5); return false; }
      game.ui.fade(1, 0.3);
      await game.wait(0.4);
    }
  }

  private paused = false;
  private pauseCheck() {
    const { game } = this;
    if (this.paused || !game.input.takePause() || !game.match) return;
    this.paused = true;
    const slow = game.slow;
    game.slow = 0; game.match.locked = true;
    void game.ui.menu('PAUSED', '', [{ id: 'go', label: 'RESUME' }, { id: 'quit', label: 'QUIT TO TITLE' }], true).then((p) => {
      if (p === 'quit') location.reload();
      game.slow = slow || 1; if (game.match) game.match.locked = false; this.paused = false;
    });
  }
}

type Chapter = { name: string; play(s: Story): Promise<boolean> };

// ---------------------------------------------------------------- PROLOGUE
const prologue: Chapter = {
  name: 'PROLOGUE · TEN BELLS',
  async play(s) {
    const { d, game } = s;
    const { ui, sound } = game;
    await game.setStage('gym_dusk');
    const kessa = await d.actor('kessa', -5.9, -3.0, -75, 'idle', 'focus');
    const dee = await d.actor('dee', -1.2, -0.3, -70, 'stand', 'soft');
    ui.loading(false);
    d.begin();
    sound.setMood('none');
    for (let i = 0; i < 3; i++) { sound.bell(131, 0.5, 5); await d.wait(2.4); }
    await d.card('', '', 'They ring ten bells for a fighter who is not coming back.\nI was nine. I counted every one.', 5);
    sound.setMood('theme');
    void d.close(kessa, 1, 2.2);
    await d.fadeIn(1.6);
    void d.close(kessa, 1, 1.5, 9);
    kessa.play('jab'); await d.wait(0.5); kessa.play('cross'); await d.wait(0.6); kessa.play('idle');
    await d.say('', 'After Dad, the gym went to my brother. So did I.');
    kessa.play('hook'); await d.wait(0.7); kessa.play('idle');
    await d.say('', 'Dee taught me the only lullaby our family knows.');
    await d.two(kessa, dee, 5.2);
    await d.say('DEE', 'Hands, Kess.', 'soft');
    kessa.at(-2.15, -0.3, 90).play('hands_out').feel('soft');
    dee.at(-1.2, -0.3, -90).play('wrap');
    await d.shot({ pos: [-1.2, 1.25, 1.3], look: [-1.68, 1.12, -0.3], fov: 0.3, focus: 1.7, fstop: 1.8 });
    void d.shot({ pos: [-1.9, 1.3, 1.3], look: [-1.68, 1.14, -0.3], fov: 0.3, focus: 1.7, fstop: 1.8 }, 8);
    await d.say('DEE', 'Guard up, little star. The bell does not end a fight.');
    await d.close(kessa, -1, 1.3);
    await d.say('KESSA', 'It tells you who is still standing. I know, Dee.', 'smile');
    await d.close(dee, 1, 1.3);
    await d.say('DEE', 'Then show me.', 'smile');
    await d.fadeOut(0.6);
    d.end();
    // ---- the lesson
    const steps: { hint: string; done: (t: Tut) => boolean; start?: (m: Match) => void }[] = [
      { hint: 'Move with <kbd>A</kbd> <kbd>D</kbd> (or the arrows on screen). Step up to Dee.', done: (t) => t.moved > 1.5 },
      { hint: '<kbd>J</kbd> is your jab. Press it three times: jab, cross, hook.', done: (t) => t.best >= 3 },
      { hint: 'Hold <kbd>S</kbd> to guard. Let him hit your gloves twice.', done: (t) => t.blocked >= 2, start: (m) => { m.b.ai!.level = 0.9; } },
      { hint: '<kbd>K</kbd> kicks. <kbd>L</kbd> is the heavy hand. Land one of each.', done: (t) => t.kick > 0 && t.heavy > 0, start: (m) => { m.b.ai!.level = 0.05; } },
      { hint: '<kbd>Space</kbd> dashes in; hold away from him and it slips back out of reach.', done: (t) => t.dashed > 0 },
      { hint: 'Fighting fills your RESOLVE. At half, <kbd>I</kbd> rings the bell: Dad’s palm.', done: (t) => t.bell > 0, start: (m) => { m.a.meter = 100; } },
    ];
    interface Tut { moved: number; best: number; blocked: number; kick: number; heavy: number; dashed: number; bell: number }
    const t: Tut = { moved: 0, best: 0, blocked: 0, kick: 0, heavy: 0, dashed: 0, bell: 0 };
    let step = -1, lastX = 0, gap = 0, over: (() => void) | null = null;
    const won = await new Promise<boolean>((resolve) => {
      void s.fight(kessa, dee, {
        need: 1, level: 0.05, story: true,
        onHit: (e, m) => {
          if (e.by === m.a && e.kind === 'hit') { t.best = Math.max(t.best, m.a.combo); if (e.move.level === 2) t.kick++; if (e.move.level === 3) t.heavy++; if (e.move.level === 4) t.bell++; }
          if (e.on === m.a && e.kind !== 'hit') t.blocked++;
        },
        tick: (m, dt) => {
          m.a.hp = Math.max(m.a.hp, m.a.kit.hp * 0.5); m.b.hp = Math.max(m.b.hp, m.b.kit.hp * 0.45);   // nobody loses a lesson
          t.moved += Math.abs(m.a.x - lastX); lastX = m.a.x;
          if (m.a.state === 'dash') t.dashed = 1;
          if (step < 0 || (gap -= dt) < 0 && steps[step].done(t)) {
            step++;
            if (step >= steps.length) { ui.hint(null); over?.(); over = null; step = steps.length - 1; gap = 1e9; resolve(true); return; }
            Object.assign(t, { moved: 0, best: 0, blocked: 0, kick: 0, heavy: 0, dashed: 0, bell: 0 });
            steps[step].start?.(m);
            ui.hint(steps[step].hint); sound.ui(); gap = 0.8;
          }
        },
      }).then((ok) => resolve(ok));
    });
    game.match?.end(); game.tick = null;
    if (!won) return false;
    d.begin();
    kessa.at(-0.9, 0, 90).play('stand').feel('smile');
    dee.at(0.7, 0, -90).play('stand').feel('smile');
    void d.close(dee, 1, 1.4);
    await d.fadeIn(0.6);
    await d.say('DEE', 'That is the one. Dad’s hand. You ring that, and they hear it in the cheap seats.');
    await d.fadeOut(1.2);
    d.hide('dee');
    kessa.at(-3.2, -0.6, -20).play('sad').feel('sad');
    sound.setMood('dread');
    await d.card('', '', 'Three months later.', 2.6);
    await d.close(kessa, 1, 1.6);
    await d.fadeIn(1.2);
    void d.close(kessa, 1, 1.25, 12);
    await d.say('', 'The notice came on a Tuesday. FINAL DEMAND, in red. Crane Holdings.');
    await d.say('', 'Dee had been gone nine weeks by then. He left a note with four words on it.');
    await d.fadeOut(1.0);
    await d.card('', '', '“Don’t come looking.”\n— D.', 3.4);
    await d.say('', 'So I went looking.');
    await d.card('', 'THE TENTH BELL', '', 3.6);
    d.end();
    return true;
  },
};

// ---------------------------------------------------------------- ONE
const door: Chapter = {
  name: 'ONE · THE DOOR',
  async play(s) {
    const { d, game } = s;
    await game.setStage('roof_rain');
    const kessa = await d.actor('kessa', -4.6, 0, 90, 'walk', 'focus');
    const rook = await d.actor('rook', 2.6, -0.4, -80, 'tough', 'neutral');
    game.ui.loading(false);
    d.begin();
    game.sound.setMood('dread');
    await d.shot({ pos: [-1.5, 3.4, 8.5], look: [1.2, 1.6, -3], fov: 0.5 });
    void d.shot({ pos: [-0.5, 1.6, 6.8], look: [0.8, 1.3, -1], fov: 0.5 }, 7);
    await d.fadeIn(1.4);
    await d.card('ONE', 'THE DOOR', 'The roof of the Graywater Cannery. Friday, before midnight.', 3.4);
    for (let t = 0; t < 2.2 && !game.rush; t += 1 / 30) { kessa.at(kessa.x + 1.24 / 30, 0, 90); await d.wait(1 / 30); }
    kessa.at(-1.9, 0, 90).play('stand');
    await d.close(rook, -1, 1.7);
    await d.say('ROOK', 'Roof is closed, sweetheart. The fights are invitation only.');
    await d.close(kessa, 1, 1.5);
    await d.say('KESSA', 'I am here for Dee Vale.');
    await d.over(kessa, rook);
    await d.say('ROOK', 'Nobody sees the Saint. Not his fans. Not his creditors.', 'smile');
    await d.say('ROOK', 'Definitely not his kid sister.');
    await d.close(kessa, 1, 1.25);
    await d.say('KESSA', 'Then you had better be good at closing doors.', 'angry');
    await d.close(rook, -1, 1.4);
    await d.say('ROOK', 'Oh, I like you. Shame.', 'smile');
    await d.fadeOut(0.5);
    d.end();
    if (!(await s.fight(kessa, rook, { level: 0.3 }))) return false;
    await d.fadeOut(0.6);
    d.begin();
    game.sound.setMood('theme');
    rook.at(1.3, 0, -90).play('kneel').feel('pain');
    kessa.at(-0.5, 0, 90).play('stand').feel('focus');
    await d.close(rook, -1, 1.8, 0, -0.5);
    await d.fadeIn(0.8);
    await d.say('ROOK', 'Hah... You hit like him. Same hook. Same damned look.', 'smile');
    await d.close(kessa, 1, 1.4);
    await d.say('KESSA', 'Where is he?');
    await d.two(kessa, rook, 4.4);
    await d.say('ROOK', 'Downstairs. Main event, every Friday. Crane’s prize horse.', 'neutral');
    await d.close(rook, -1, 1.5, 0, -0.5);
    await d.say('ROOK', 'Listen. He is not the brother you remember. Three months down there, nobody is.', 'sad');
    await d.close(kessa, 1, 1.3);
    await d.say('KESSA', 'Open the door, Rook.');
    await d.say('ROOK', 'Mind the Wren. She bites.', 'smile');
    await d.fadeOut(1.0);
    d.end();
    return true;
  },
};

// ---------------------------------------------------------------- TWO
const undercard: Chapter = {
  name: 'TWO · THE UNDERCARD',
  async play(s) {
    const { d, game } = s;
    await game.setStage('pit_blue');
    const kessa = await d.actor('kessa', -1.8, 0, 90, 'stand', 'focus');
    const wren = await d.actor('wren', 1.8, 0, -90, 'stand', 'neutral');
    game.ui.loading(false);
    d.begin();
    game.sound.setMood('dread');
    await d.shot({ pos: [0, 4.6, 9], look: [0, 1.2, -2], fov: 0.55 });
    void d.shot({ pos: [0, 1.5, 6.2], look: [0, 1.2, 0], fov: 0.5 }, 8);
    await d.fadeIn(1.2);
    await d.card('TWO', 'THE UNDERCARD', 'Forty feet under the cannery, where the tide used to come in.', 3.4);
    await d.close(kessa, 1, 1.4);
    await d.say('KESSA', '...Wren?', 'shock');
    await d.close(wren, -1, 1.4);
    await d.say('WREN', 'Six years, Kess. You got tall.', 'soft');
    await d.over(wren, kessa);
    await d.say('KESSA', 'You left. No goodbye. Dee waited at that door for a week.', 'angry');
    await d.close(wren, -1, 1.25);
    await d.say('WREN', 'I did not leave. I was sold. My father’s debts. Crane collects in people.', 'sad');
    await d.say('WREN', 'Go home. I am asking as someone who used to share your corner.');
    await d.close(kessa, 1, 1.25);
    await d.say('KESSA', 'I am not leaving without him.', 'focus');
    await d.two(kessa, wren, 4.6);
    await d.say('WREN', 'Then I have to put you down gently. It is the only kindness this place allows.', 'focus');
    await d.fadeOut(0.5);
    d.end();
    if (!(await s.fight(kessa, wren, { level: 0.5 }))) return false;
    await d.fadeOut(0.6);
    d.begin();
    game.sound.setMood('theme');
    wren.at(1.0, 0, -90).play('kneel').feel('pain');
    kessa.at(-0.35, 0, 90).play('reach').feel('soft');
    await d.close(wren, -1, 1.8, 0, -0.5);
    await d.fadeIn(0.8);
    await d.say('WREN', 'He taught you the palm. Of course he did.', 'smile');
    await d.close(kessa, 1, 1.4);
    await d.say('KESSA', 'Why is he fighting for Crane?');
    await d.close(wren, -1, 1.5, 0, -0.5);
    await d.say('WREN', 'Because Crane bought the gym’s debt. Every fight Dee wins, Crane adds the purse to what you owe.', 'sad');
    await d.say('WREN', 'He is not fighting to get out, Kess. He is fighting so Crane never comes for you.');
    await d.close(kessa, 1, 1.2);
    await d.say('KESSA', '...', 'shock');
    await d.close(wren, -1, 1.3, 0, -0.5);
    await d.say('WREN', 'And his left eye is gone. He cannot see a hook coming.');
    await d.say('WREN', 'One more bad night, and the bell they ring for him will be the long one.', 'cry');
    await d.two(kessa, wren, 3.6, 0, 1.1);
    await d.say('WREN', 'Crane will make you fight him. That is the show. Do not let him make you finish it.', 'focus');
    await d.fadeOut(1.0);
    d.end();
    return true;
  },
};

// ---------------------------------------------------------------- THREE
const family: Chapter = {
  name: 'THREE · FAMILY NIGHT',
  async play(s) {
    const { d, game } = s;
    const { ui, sound, vfx } = game;
    await game.setStage('pit_red');
    const kessa = await d.actor('kessa', -2.4, 0, 90, 'stand', 'focus');
    const dee = await d.actor('dee', 1.9, 0, -90, 'sad', 'sad');
    const crane = await d.actor('crane', 0.2, -1.5, 0, 'tough', 'neutral');
    ui.loading(false);
    d.begin();
    sound.setMood('dread');
    await d.shot({ pos: [0.2, 1.7, 3.2], look: [0.2, 1.55, -1.5], fov: 0.36, focus: 4.7, fstop: 2 });
    await d.fadeIn(1.2);
    await d.card('THREE', 'FAMILY NIGHT', '', 2.6);
    void d.shot({ pos: [0.2, 1.75, 1.6], look: [0.2, 1.62, -1.5], fov: 0.3, focus: 3.1, fstop: 2 }, 6);
    await d.say('CRANE', 'Ladies and gentlemen. A treat. Blood against blood.');
    await d.say('CRANE', 'Miss Vale. Your brother owes me nine fights’ worth of mercy.', 'smile');
    crane.play('show_arm');
    await d.shot({ pos: [1.1, 1.5, 0.1], look: [0.36, 1.42, -1.5], fov: 0.22, focus: 1.8, fstop: 1.8 });
    await d.say('CRANE', 'I ink a bell for every man he has broken for me. Nine.');
    await d.say('CRANE', 'I have been saving the tenth.');
    await d.close(crane, 1, 1.6);
    await d.say('CRANE', 'Beat him, and the gym is yours, clean. Lose, and I own you both. That is the whole contract.', 'neutral');
    await d.close(dee, -1, 1.4);
    await d.say('DEE', 'Go home, Kess.', 'sad');
    await d.close(kessa, 1, 1.3);
    await d.say('KESSA', 'Not without you.', 'focus');
    await d.close(dee, -1, 1.2);
    await d.say('DEE', 'I cannot see you properly. Do you know that? The left side is just... rain.', 'sad');
    await d.say('DEE', 'So stay on my left. And do not dare hold back, or he will know.', 'focus');
    await d.close(kessa, 1, 1.15);
    await d.say('KESSA', 'Guard up, Dee.', 'cry');
    await d.close(dee, -1, 1.15);
    await d.say('DEE', '...Guard up, little star.', 'soft');
    await d.fadeOut(0.5);
    d.hide('crane');
    d.end();
    let said = 0;
    const won = await s.fight(kessa, dee, {
      need: 1, level: 0.6, story: true,
      tick: (m) => {
        const f = m.b.hp / m.b.kit.hp;
        if (said === 0 && f < 0.6) { said = 1; d.bark('DEE', 'Good. Again.'); }
        if (said === 1 && f < 0.3) { said = 2; d.bark('DEE', 'Finish it, Kess. Let me rest.', 3.2); m.b.kit = { ...m.b.kit, ai: { press: 0.15, guard: 0, react: 0.9, whiff: 0 } }; m.b.model.emotion = 'sad'; }
      },
    });
    if (!won) return false;
    // ---- nine bells
    d.begin();
    sound.setMood('none');
    game.slow = 0.35;
    await d.shot({ pos: [dee.x - 1.2, 1.0, 3.4], look: [dee.x, 0.7, 0], fov: 0.4, focus: 3.6, fstop: 2 });
    await d.wait(1.6);
    game.slow = 1;
    kessa.at(dee.x - 0.2, -0.75, 20).play('cradle').feel('cry');
    dee.play('lying').feel('out');
    vfx.grey = 0.85;
    sound.bed('crowd', 0);
    await d.shot({ pos: [dee.x + 0.4, 0.85, 2.6], look: [dee.x + 0.3, 0.55, -0.4], fov: 0.36, focus: 2.9, fstop: 1.8 });
    void d.shot({ pos: [dee.x + 0.2, 0.75, 1.9], look: [dee.x + 0.3, 0.55, -0.4], fov: 0.34, focus: 2.2, fstop: 1.8 }, 26);
    await d.say('KESSA', 'No. No, no. Dee. Dee, stay with me.', 'cry');
    const words = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.', 'Seven.', 'Eight.', 'Nine.'];
    for (let i = 0; i < 9 && !game.rush; i++) {
      sound.bell(131, 0.55, 4.5);
      ui.say('', words[i]);
      await d.wait(i < 6 ? 1.9 : 2.5);
    }
    ui.say(null);
    await d.close(kessa, -1, 1.2, 0, -0.75);
    await d.say('KESSA', '...Do not ring it.', 'cry');
    await d.say('KESSA', 'Do not you ring it.');
    await d.wait(1.8);
    dee.feel('pain');
    await d.shot({ pos: [dee.x + 0.9, 0.6, 1.5], look: [dee.x + 0.75, 0.3, -0.1], fov: 0.28, focus: 1.7, fstop: 1.8 });
    await d.say('DEE', '...you stayed... on my left.', 'soft');
    vfx.grey = 0;
    sound.setMood('theme');
    kessa.feel('smile');
    await d.close(kessa, -1, 1.2, 0, -0.75);
    await d.wait(1.6);
    crane.model.root.setEnabled(true);
    crane.at(3.4, -0.6, -70).play('tough').feel('neutral');
    sound.setMood('dread');
    await d.close(crane, 1, 1.6);
    await d.say('CRANE', 'Touching. But I was promised a tenth bell.');
    await d.say('CRANE', 'The contract says beat him. He is still breathing. So the debt stands.', 'smile');
    await d.say('CRANE', 'Unless you would like to finish the job?');
    kessa.at(dee.x - 0.6, -0.3, 80).play('stand').feel('angry');
    await d.close(kessa, 1, 1.2);
    await d.say('KESSA', 'You want a tenth bell, Crane?', 'angry');
    await d.say('KESSA', 'Come and ring it yourself.');
    await d.close(crane, 1, 1.3);
    await d.say('CRANE', 'On the roof, then. I like the weather for it.', 'smile');
    await d.fadeOut(1.0);
    d.end();
    return true;
  },
};

// ---------------------------------------------------------------- FOUR
const longNight: Chapter = {
  name: 'FOUR · THE LONG NIGHT',
  async play(s) {
    const { d, game } = s;
    const { sound, ui } = game;
    await game.setStage('roof_storm');
    const stage = game.stage!;
    const kessa = await d.actor('kessa', -1.9, 0, 90, 'stand', 'focus');
    const crane = await d.actor('crane', 1.9, 0, -90, 'tough', 'neutral');
    ui.loading(false);
    d.begin();
    sound.setMood('dread');
    await d.shot({ pos: [0, 2.2, 8.5], look: [0, 1.4, 0], fov: 0.5 });
    void d.shot({ pos: [0, 1.4, 6.2], look: [0, 1.2, 0], fov: 0.5 }, 7);
    await d.fadeIn(1.2);
    stage.bolt = 1; sound.thunder();
    await d.card('FOUR', 'THE LONG NIGHT', '', 2.8);
    await d.close(crane, -1, 1.5);
    await d.say('CRANE', 'Forty years I have broken fighters. Do you know what they all had?');
    await d.say('CRANE', 'Something to lose.', 'smile');
    stage.bolt = 1; sound.thunder();
    await d.close(kessa, 1, 1.25);
    await d.say('KESSA', 'I have something to keep.', 'angry');
    await d.fadeOut(0.5);
    d.end();
    let dawn = 0, storm = 6;
    const won = await s.fight(kessa, crane, {
      level: 0.72, mood: 'boss',
      tick: (m, dt) => {
        if ((storm -= dt) < 0 && dawn === 0) { storm = 5 + 9 * Math.random(); stage.bolt = 1; sound.thunder(); }
        // the storm breaks once the last round is being fought: rain thins, the sky lets the morning through
        if (dawn === 0 && m.round >= 2 && m.phase === 'fight') {
          dawn = 0.001; stage.bolt = 1; sound.thunder(); ui.flash(0.5, 0.8);
          void game.setStage('roof_dawn').then(() => { stage.dawn('roof_dawn', 1.0); sound.setMood('boss'); });
        }
        if (dawn > 0 && dawn < 1) { dawn = Math.min(1, dawn + dt / 14); stage.skyMix = dawn; }
      },
    });
    if (!won) return false;
    await d.fadeOut(0.8);
    if (dawn === 0) { await game.setStage('roof_dawn'); stage.dawn('roof_dawn', 1.0); }
    stage.skyMix = 1;
    d.begin();
    sound.setMood('dawn');
    crane.at(1.6, 0, -90).play('kneel').feel('pain');
    kessa.at(-0.2, 0, 90).play('stand').feel('focus');
    const dee = await d.actor('dee', -4.6, -1.2, 80, 'hurt', 'soft');
    const wren = await d.actor('wren', -5.4, -1.0, 80, 'stand', 'soft');
    const rook = await d.actor('rook', -6.6, -1.6, 75, 'tough', 'smile');
    void rook; void wren; void dee;
    await d.shot({ pos: [3.4, 1.0, 3.6], look: [0.6, 1.1, 0], fov: 0.42, focus: 4.2, fstop: 2.4 });
    await d.fadeIn(1.4);
    await d.close(crane, -1, 1.7, 0, -0.5);
    await d.say('CRANE', '...Ring it, then.', 'pain');
    await d.close(kessa, 1, 1.3);
    await d.say('KESSA', 'No. You do not get a bell.', 'focus');
    await d.say('KESSA', 'Tear up the paper, Crane. Or I come back every Friday until you do.');
    await d.shot({ pos: [-2.2, 1.5, 3.0], look: [-5.0, 1.45, -1.2], fov: 0.34, focus: 4.6, fstop: 2 });
    await d.say('DEE', 'Sun is up, Kess.', 'soft');
    await d.close(kessa, -1, 1.3);
    await d.say('KESSA', 'Yeah.', 'smile');
    await d.say('KESSA', '...Let us go home.');
    void d.shot({ pos: [0, 3.6, 9.5], look: [-1.5, 2.2, -4], fov: 0.5 }, 6);
    await d.wait(3);
    await d.fadeOut(1.6);
    d.end();
    return true;
  },
};

// ---------------------------------------------------------------- EPILOGUE
const morning: Chapter = {
  name: 'EPILOGUE · MORNING',
  async play(s) {
    const { d, game } = s;
    const { sound } = game;
    await game.setStage('gym_dawn');
    const kessa = await d.actor('kessa', -2.2, -0.3, 90, 'wrap', 'soft');
    const dee = await d.actor('dee', -1.25, -0.3, -90, 'hands_out', 'soft');
    const wren = await d.actor('wren', 5.9, -2.4, 80, 'idle', 'focus');
    game.ui.loading(false);
    d.begin();
    sound.setMood('dawn');
    await d.shot({ pos: [2.5, 2.0, 6.5], look: [0, 1.3, -1.5], fov: 0.5 });
    void d.shot({ pos: [0.5, 1.5, 4.6], look: [-1.2, 1.2, -0.6], fov: 0.46 }, 9);
    await d.fadeIn(1.8);
    await d.card('', 'MORNING', '', 2.4);
    await d.say('', 'Dee never fought again. His left eye sees rain. His right one sees everything.');
    void (async () => { for (let i = 0; i < 6 && !game.rush; i++) { wren.play(i % 2 ? 'cross' : 'jab'); await d.wait(0.9); } wren.play('idle'); })();
    await d.shot({ pos: [4.2, 1.5, 1.2], look: [5.9, 1.35, -2.4], fov: 0.36, focus: 4.0, fstop: 2.2 });
    await d.say('', 'Wren took the spare room. Rook sends flowers, which is deeply unsettling.');
    await d.shot({ pos: [-0.9, 1.3, 1.3], look: [-1.72, 1.14, -0.3], fov: 0.3, focus: 1.7, fstop: 1.8 });
    await d.say('DEE', 'Hands, Kess.', 'smile');
    await d.close(kessa, -1, 1.3);
    await d.say('KESSA', 'My turn. Give me yours.', 'smile');
    await d.close(dee, 1, 1.3);
    await d.say('DEE', '...Guard up, little star.', 'soft');
    kessa.at(-3.55, -0.1, 180).play('stand').feel('soft');
    dee.play('stand');
    await d.shot({ pos: [-2.4, 1.5, 1.6], look: [-3.8, 1.3, -0.7], fov: 0.34, focus: 2.6, fstop: 2 });
    await d.say('', 'They ring ten bells for a fighter who is not coming back.');
    await d.say('', 'We ring one. Every morning. For the ones who did.');
    kessa.play('ring_bell', 0.2);
    await d.wait(0.95);
    sound.bell(392, 0.8, 5);
    sound.bell(196, 0.4, 6);
    await d.wait(2.4);
    await d.fadeOut(2.4);
    await d.card('', 'THE TENTH BELL', '', 4);
    await d.card('A FIGHTING STORY', '', 'Fighters, arenas and every clip built in Blender.\nRendered with Babylon.js on WebGPU.\nSkies and surfaces from Poly Haven (CC0). Bodies shaped with MPFB (CC0).', 6);
    await d.card('', '', 'Thank you for staying on the left.', 3.6);
    d.end();
    return true;
  },
};

export const CHAPTERS: Chapter[] = [prologue, door, undercard, family, longNight, morning];
