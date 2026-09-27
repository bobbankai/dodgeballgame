import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Athlete } from './Athlete';
import { AIController } from '../ai/AIController';

interface Step {
  text: string;
  sub?: string;
  enter?: () => void;
  update?: (dt: number) => boolean;
  /** seconds to show before auto-advancing when no update() */
  hold?: number;
}

const K = (k: string) => `<kbd>${k}</kbd>`;

/**
 * Coach Marla's guided practice. Gates actions step by step, reacts to what the
 * player actually does (not just button presses) and ends in a mini knockout drill.
 */
export class Tutorial {
  private steps: Step[] = [];
  private idx = -1;
  private t = 0;
  private moved = 0;
  private sprintTime = 0;
  private flags = new Set<string>();
  private unsubs: (() => void)[] = [];
  private coachTimer = 0;
  private lastPos = new THREE.Vector3();
  done = false;
  onComplete: (() => void) | null = null;
  private tick = (dt: number, realDt: number) => this.update(dt, realDt);

  constructor(private game: Game) {}

  start() {
    const g = this.game;
    const m = g.world.match!;
    const player = g.player!;
    const [dummy, coach] = [m.away[0], m.away[1]];
    const pc = g.pc!;
    // set up passive opponents
    for (const a of m.away) {
      const ai = a.controller as AIController;
      ai.passive = true;
      ai.noThrow = true;
      a.hearts = a.maxHearts = 99;
      a.wantsPickup = false;
    }
    coach.rig.material.setAppearance({ ...coach.profile.appearance, jersey: 0x2b3448, trim: 0xf2c14e });
    this.lastPos.copy(player.pos);
    const allow = pc.allow;
    Object.keys(allow).forEach((k) => ((allow as any)[k] = false));
    allow.move = true;

    const ev = g.world.events;
    this.unsubs.push(
      ev.on('throw', (e) => {
        if (e.athlete === player) this.flags.add(`throw:${e.info.kind}${e.info.perfect ? ':perfect' : ''}`);
      }),
      ev.on('hit', (e) => {
        if (e.thrower === player) this.flags.add('hitDummy');
        if (e.victim === player) {
          this.flags.add('gotHit');
          player.hearts = player.maxHearts;
        }
      }),
      ev.on('catch', (e) => {
        if (e.catcher === player && e.thrower === coach) this.flags.add('caught');
      }),
      ev.on('dodge', (e) => {
        if (e.athlete === player) this.flags.add('dodged');
      }),
      ev.on('ko', (e) => {
        if (e.athlete.team === 1) this.flags.add(`ko:${e.athlete.id}`);
      }),
    );

    const coachThrow = (speed: number) => {
      const b = g.world.balls.balls.find((x) => x.state === 'loose' && !x.live) ?? g.world.balls.balls[0];
      if (!b || b.state === 'held' && b.holder !== coach) return;
      if (!coach.ball) coach.grabBall(b, false);
      coach.aimTarget = player;
      player.chestPos(coach.aimPoint);
      coach.faceYaw = Math.atan2(player.pos.x - coach.pos.x, player.pos.z - coach.pos.z);
      const from = coach.handPos(new THREE.Vector3());
      const to = player.chestPos(new THREE.Vector3());
      const dir = to.sub(from).normalize();
      coach.anim.play('throw', { fade: 0.08 });
      coach.launchCustom('quick', dir.multiplyScalar(speed), { power: 0.5, gravityScale: 0.2, target: player });
    };

    const place = (a: Athlete, x: number, z: number) => {
      a.pos.set(x, 0, z);
      a.vel.set(0, 0, 0);
      a.faceYaw = 0;
    };
    place(dummy, -2.2, -5.5);
    place(coach, 2.5, -4.2);

    this.steps = [
      {
        text: `Move with ${K('W')}${K('A')}${K('S')}${K('D')} · look with the ${K('MOUSE')}`,
        sub: 'Click the court to capture the mouse',
        update: () => this.moved > 5,
      },
      {
        text: `Hold ${K('SHIFT')} to sprint`,
        sub: 'Sprinting drains stamina — watch the green bar',
        enter: () => (allow.sprint = true),
        update: () => this.sprintTime > 1.2,
      },
      {
        text: 'Grab a ball — just run over it',
        sub: 'Balls start on the centre line. You can reach a little past it.',
        update: () => !!player.ball,
      },
      {
        text: `${K('TAP')} left click for a quick throw at the dummy`,
        sub: 'Aim with the reticle — it locks onto nearby opponents',
        enter: () => (allow.throw = true),
        update: () => this.flags.has('throw:quick'),
      },
      {
        text: `${K('HOLD')} left click to charge — release on the flash for a PERFECT release`,
        sub: 'Charged throws are faster and more accurate. Perfect releases hit harder.',
        enter: () => this.resupply(player),
        update: () => [...this.flags].some((f) => f.startsWith('throw:charged')),
      },
      {
        text: 'Hit the dummy with a throw',
        sub: 'Moving targets need you to lead — the lock-on helps a little',
        enter: () => this.resupply(player),
        update: () => {
          if (!player.ball && !this.hasLooseBallNear(player)) this.resupply(player);
          return this.flags.has('hitDummy');
        },
      },
      {
        text: `Press ${K('C')} to LOB — a high arc that drops over cover`,
        sub: 'The landing ring closes in until impact. Lobs can only be held with a perfect catch.',
        enter: () => this.resupply(player),
        update: () => {
          if (!player.ball && !this.hasLooseBallNear(player)) this.resupply(player);
          return this.flags.has('throw:lob');
        },
      },
      {
        text: `Coach Marla will throw at you. Press ${K('RIGHT CLICK')} just before it arrives to CATCH`,
        sub: 'Too early and the window closes. Watch her wind up, then time it.',
        enter: () => {
          allow.catch = true;
          allow.throw = false;
          if (player.ball) player.dropBall(1);
          this.coachTimer = 1.8;
        },
        update: (dt) => {
          this.coachTimer -= dt;
          if (this.coachTimer <= 0 && !this.liveBallFrom(coach)) {
            coachThrow(this.flags.has('gotHit') ? 11 : 12.5);
            this.coachTimer = 2.6;
          }
          return this.flags.has('caught');
        },
      },
      {
        text: `Great catch! Now ${K('SPACE')} to DODGE the next throw`,
        sub: 'Dodging uses a charge (blue pips). Dodge through the ball at the last moment.',
        enter: () => {
          allow.dodge = true;
          allow.catch = false;
          if (player.ball) player.dropBall(1);
          this.flags.delete('dodged');
          this.coachTimer = 1.4;
        },
        update: (dt) => {
          this.coachTimer -= dt;
          if (this.coachTimer <= 0 && !this.liveBallFrom(coach)) {
            coachThrow(15);
            this.coachTimer = 2.4;
          }
          return this.flags.has('dodged') && !this.liveBallFrom(coach);
        },
      },
      {
        text: 'The rules: a hit costs a heart. Two hearts and you’re out.',
        sub: 'Catch a throw and the thrower loses a heart — and a benched teammate comes back.',
        hold: 5,
        enter: () => {
          allow.catch = allow.throw = allow.pass = true;
        },
      },
      {
        text: 'Final drill: knock out the dummy and Coach Marla!',
        sub: 'Two hits each. They will move — but they won’t throw back. Yet.',
        enter: () => {
          for (const a of [dummy, coach]) {
            a.hearts = a.maxHearts = 2;
            const ai = a.controller as AIController;
            ai.passive = false;
            ai.noThrow = true;
            ai.params.awareness = 0.25;
            ai.params.dodgeBias = 0.5;
            ai.params.catchBias = 0.15;
          }
          this.resupply(player);
          g.hud.buildTags(g.world);
        },
        update: () => {
          if (!player.ball && !this.hasLooseBallNear(player, 9)) this.resupply(player);
          return !dummy.active && !coach.active;
        },
      },
      { text: 'Practice complete!', sub: 'Welcome to the league, rookie.', hold: 2.5 },
    ];
    g.tickers.add(this.tick);
    this.next();
  }

  private hasLooseBallNear(a: Athlete, r = 7) {
    return this.game.world.balls.balls.some((b) => b.state === 'loose' && !b.live && this.game.world.court.inHalf(b.pos, 0, 0.4) && b.pos.distanceTo(a.pos) < r);
  }

  private liveBallFrom(a: Athlete) {
    return this.game.world.balls.balls.some((b) => b.live && b.thrower === a);
  }

  private resupply(p: Athlete) {
    if (p.ball) return;
    const w = this.game.world;
    const b = w.balls.balls.find((x) => x.state === 'loose' && !x.live) ?? w.balls.balls.find((x) => x.holder && x.holder.team === 1);
    if (!b) return;
    if (b.holder) b.holder.dropBall(0);
    b.setLoose();
    b.pos.set(p.pos.x + (Math.random() - 0.5), 0.6, Math.max(1.2, p.pos.z - 1.4));
    b.vel.set(0, 1.5, 0);
    b.grounded = false;
  }

  private next() {
    this.idx++;
    this.t = 0;
    const s = this.steps[this.idx];
    if (!s) {
      this.finish();
      return;
    }
    s.enter?.();
    this.game.hud.hint(s.text, s.sub);
    if (this.idx > 0) this.game.audio.play('uiConfirm', { volume: 0.7 });
  }

  private update(dt: number, realDt: number) {
    if (this.done) return;
    const g = this.game;
    const p = g.player;
    if (!p || !g.world.match) return;
    this.t += realDt;
    this.moved += p.pos.distanceTo(this.lastPos);
    this.lastPos.copy(p.pos);
    if (p.sprinting) this.sprintTime += dt;
    if (p.hearts < p.maxHearts && this.idx < this.steps.length - 2) p.hearts = p.maxHearts;
    const s = this.steps[this.idx];
    if (!s) return;
    const ok = s.update ? s.update(dt) : this.t >= (s.hold ?? 3);
    if (ok && this.t > 0.6) {
      if (s.update) g.world.events.emit('announce', { text: 'NICE', style: 'catch' });
      this.next();
    }
  }

  private finish() {
    this.done = true;
    this.game.hud.hint(null);
    this.dispose();
    this.onComplete?.();
  }

  dispose() {
    this.game.tickers.delete(this.tick);
    for (const u of this.unsubs) u();
    this.unsubs = [];
    const pc = this.game.pc;
    if (pc) Object.keys(pc.allow).forEach((k) => ((pc.allow as any)[k] = true));
  }
}
