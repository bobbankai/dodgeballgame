import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { rng } from '../core/math';
import type { Athlete, AthleteProfile } from './Athlete';
import type { TeamId } from './types';
import type { World } from './World';

export type MatchMode = 'elimination' | 'survival' | 'timeAttack' | 'boss' | 'tutorial' | 'exhibition';

export interface MatchRules {
  /** Every throw ricochets off walls with homing. */
  ricochet?: boolean;
  /** Every throw hits like a power shot. */
  heavy?: boolean;
  /** Catches revive a benched teammate. */
  reviveOnCatch?: boolean;
  /** Only perfect catches count. */
  hardCatch?: boolean;
  /** The arena periodically pulses shockwaves (boss). */
  hazards?: boolean;
}

export interface MatchConfig {
  id: string;
  title: string;
  subtitle?: string;
  mode: MatchMode;
  arena: string;
  home: AthleteProfile[];
  away: AthleteProfile[];
  waves?: AthleteProfile[][];
  roundsToWin: number;
  ballCount: number;
  timeLimit: number;
  court?: { halfWidth: number; halfLength: number };
  rules?: MatchRules;
  tier: number;
  reward: { xp: number; cred: number };
  objective?: string;
  introCinematic?: string;
  outroCinematic?: string;
  /** Player controls home[0]; false for attract-mode demos. */
  playerControlled?: boolean;
}

export type MatchPhase = 'intro' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd' | 'done';

export interface MatchResult {
  won: boolean;
  score: [number, number];
  rounds: number;
  duration: number;
  wavesCleared: number;
  player: Athlete['stats_'] | null;
  flawless: boolean;
}

/** Match rules & flow: rounds, countdown, eliminations, catches, revives, win/loss. */
export class Match {
  phase: MatchPhase = 'intro';
  phaseTime = 0;
  round = 0;
  score: [number, number] = [0, 0];
  roundTime = 0;
  totalTime = 0;
  suddenDeath = false;
  wave = 0;
  wavesCleared = 0;
  countdownValue = 0;
  home: Athlete[] = [];
  away: Athlete[] = [];
  player: Athlete | null = null;
  private unsubs: (() => void)[] = [];
  private koQueue: { a: Athlete; t: number }[] = [];
  private lastKO: Athlete | null = null;
  roundWinner: TeamId | -1 = -1;
  onEnd: ((r: MatchResult) => void) | null = null;
  onRoundStart: ((round: number) => void) | null = null;
  playerHitCount = 0;
  paused = false;

  constructor(
    public world: World,
    public config: MatchConfig,
    public factory: (p: AthleteProfile, team: TeamId) => Athlete,
  ) {
    world.match = this;
    if (config.court) {
      world.court.halfWidth = config.court.halfWidth;
      world.court.halfLength = config.court.halfLength;
    }
    for (const p of config.home) this.home.push(this.spawnAthlete(p, 0));
    const firstAway = config.mode === 'survival' && config.waves ? config.waves[0] : config.away;
    for (const p of firstAway) this.away.push(this.spawnAthlete(p, 1));
    if (config.playerControlled !== false && this.home.length) {
      this.player = this.home[0];
      this.player.isPlayer = true;
    }
    this.placeTeams();
    world.balls.layoutCenter(config.ballCount);
    const ev = world.events;
    this.unsubs.push(
      ev.on('catch', (e) => this.onCatch(e.catcher, e.thrower, e.ball.info === null || e.ball.info.kind !== 'pass')),
      ev.on('ko', (e) => this.onKO(e.athlete)),
      ev.on('hit', (e) => {
        if (e.victim === this.player) this.playerHitCount++;
      }),
    );
  }

  private spawnAthlete(p: AthleteProfile, team: TeamId) {
    const a = this.factory(p, team);
    this.world.addAthlete(a);
    return a;
  }

  get playing() {
    return this.phase === 'playing' && !this.paused;
  }
  get allowPickups() {
    return this.phase === 'playing' || this.phase === 'roundEnd';
  }
  get controlsEnabled() {
    return this.phase === 'playing';
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    if (this.world.match === this) this.world.match = null;
  }

  benchSpot(a: Athlete, out: THREE.Vector3) {
    const c = this.world.court;
    const team = a.team === 0 ? this.home : this.away;
    const idx = team.indexOf(a);
    const s = c.side(a.team);
    out.set(-(c.halfWidth + 1.45), 0, s * (2.2 + idx * 1.0));
    return out;
  }

  // ------------------------------------------------------------------ flow
  begin() {
    this.startRound();
  }

  /** Put both teams on their spawn marks facing each other. */
  placeTeams() {
    const c = this.world.court;
    const tmp = new THREE.Vector3();
    const place = (list: Athlete[], team: TeamId) => {
      list.forEach((a, i) => {
        c.spawnPoint(team, i, list.length, tmp);
        a.resetForRound(tmp, team === 0 ? Math.PI : 0);
        a.energy = Math.min(a.energy, 60);
      });
    };
    place(this.home, 0);
    place(this.away, 1);
  }

  startRound() {
    this.round++;
    this.roundTime = 0;
    this.suddenDeath = false;
    this.roundWinner = -1;
    this.koQueue = [];
    this.world.time.clearEffects();
    this.placeTeams();
    this.world.balls.layoutCenter(this.config.ballCount);
    this.setPhase('countdown');
    this.countdownValue = TUNING.round.countdown + 1;
    this.world.events.emit('roundStart', { round: this.round });
    this.onRoundStart?.(this.round);
  }

  private setPhase(p: MatchPhase) {
    this.phase = p;
    this.phaseTime = 0;
  }

  /** Skip the pre-round countdown (used by the tutorial). */
  skipCountdown() {
    if (this.phase === 'countdown') {
      this.setPhase('playing');
      this.world.events.emit('countdown', { value: 0 });
    }
  }

  update(dt: number, realDt: number) {
    if (this.paused) return;
    this.phaseTime += realDt;
    switch (this.phase) {
      case 'countdown': {
        const remaining = TUNING.round.countdown + 0.6 - this.phaseTime;
        const v = Math.ceil(remaining - 0.6);
        if (v !== this.countdownValue && v >= 0) {
          this.countdownValue = v;
          this.world.events.emit('countdown', { value: v });
        }
        if (remaining <= 0.6) {
          this.setPhase('playing');
        }
        break;
      }
      case 'playing': {
        this.roundTime += dt;
        this.totalTime += dt;
        this.processKOs(dt);
        if (this.config.mode === 'tutorial') break;
        this.checkRoundEnd();
        if (this.config.mode !== 'survival' && this.config.timeLimit > 0 && this.roundTime >= this.config.timeLimit && this.phase === 'playing') this.timeUp();
        break;
      }
      case 'roundEnd': {
        this.processKOs(dt);
        if (this.phaseTime > 3.4) {
          if (this.config.mode === 'survival') {
            // waves cleared live in score[0]; only failed attempts count toward defeat
            if (this.roundWinner === 0) this.nextWave();
            else if (this.score[1] >= this.config.roundsToWin) this.endMatch();
            else this.startRound();
          } else if (this.score[0] >= this.config.roundsToWin || this.score[1] >= this.config.roundsToWin || this.config.mode === 'timeAttack') this.endMatch();
          else this.startRound();
        }
        break;
      }
      case 'matchEnd': {
        if (this.phaseTime > 3.6) {
          this.setPhase('done');
          this.onEnd?.(this.result());
        }
        break;
      }
    }
  }

  private processKOs(dt: number) {
    for (let i = this.koQueue.length - 1; i >= 0; i--) {
      const k = this.koQueue[i];
      k.t -= dt;
      if (k.t <= 0) {
        this.koQueue.splice(i, 1);
        if (k.a.state === 'knockdown') {
          const spot = this.benchSpot(k.a, new THREE.Vector3());
          k.a.sendToBench(spot, Math.PI / 2);
        }
      }
    }
  }

  private onKO(a: Athlete) {
    this.lastKO = a;
    this.koQueue.push({ a, t: 1.25 });
  }

  private onCatch(catcher: Athlete, thrower: Athlete | null, isThrowCatch: boolean) {
    if (!isThrowCatch || this.phase !== 'playing') return;
    if (thrower && thrower.team !== catcher.team && thrower.active) {
      thrower.hearts -= 1;
      if (thrower.hearts <= 0) thrower.knockOut(catcher);
      else {
        thrower.hitFlash = 1;
        thrower.anim.flinch(0, 1, 0.8);
      }
    }
    const reviveOn = this.config.rules?.reviveOnCatch ?? TUNING.round.reviveOnCatch;
    if (reviveOn) {
      const team = catcher.team === 0 ? this.home : this.away;
      const benched = team.find((t) => t.isOut && t.state === 'out');
      if (benched) {
        const c = this.world.court;
        const spot = new THREE.Vector3(rng.range(-c.halfWidth * 0.5, c.halfWidth * 0.5), 0, c.side(catcher.team) * c.halfLength * 0.7);
        benched.revive(spot, catcher.team === 0 ? Math.PI : 0);
      }
    }
  }

  private teamAlive(list: Athlete[]) {
    return list.some((a) => a.active);
  }

  private checkRoundEnd() {
    const homeAlive = this.teamAlive(this.home);
    const awayAlive = this.teamAlive(this.away);
    if (homeAlive && awayAlive) return;
    let winner: TeamId | -1 = -1;
    if (homeAlive && !awayAlive) winner = 0;
    else if (awayAlive && !homeAlive) winner = 1;
    this.finishRound(winner);
  }

  private timeUp() {
    const h = this.home.filter((a) => a.active);
    const w = this.away.filter((a) => a.active);
    const hh = h.reduce((s, a) => s + a.hearts, 0) + h.length * 10;
    const ww = w.reduce((s, a) => s + a.hearts, 0) + w.length * 10;
    if (this.config.mode === 'timeAttack') {
      this.finishRound(1);
      return;
    }
    if (hh === ww && !this.suddenDeath) {
      this.suddenDeath = true;
      for (const a of [...h, ...w]) a.hearts = 1;
      this.world.events.emit('announce', { text: 'SUDDEN DEATH', sub: 'Next hit wins', style: 'warn' });
      this.roundTime = this.config.timeLimit - 45;
      return;
    }
    this.finishRound(hh > ww ? 0 : 1);
  }

  private finishRound(winner: TeamId | -1) {
    this.roundWinner = winner;
    if (winner >= 0) this.score[winner as 0 | 1]++;
    this.setPhase('roundEnd');
    if (this.config.mode === 'survival' && winner === 0) this.wavesCleared++;
    this.world.events.emit('roundEnd', { round: this.round, winner });
    if (this.config.mode === 'survival' && winner === 1 && this.score[1] < this.config.roundsToWin)
      this.world.events.emit('announce', { text: 'WAVE LOST', sub: 'Last chance — the wave restarts', style: 'warn' });
    // celebrate / lament
    for (const a of this.home) if (a.active) a.celebrate(winner === 0);
    for (const a of this.away) if (a.active) a.celebrate(winner === 1);
  }

  private nextWave() {
    const waves = this.config.waves ?? [];
    this.wave++;
    if (this.wave >= waves.length) {
      this.endMatch();
      return;
    }
    this.koQueue = [];
    // Replace away team with the next wave; home heals up and anyone down gets back in
    for (const a of this.away) {
      a.dropBall(1);
      a.destroy(this.world.scene);
      this.world.athletes.splice(this.world.athletes.indexOf(a), 1);
    }
    this.away = waves[this.wave].map((p) => this.spawnAthlete(p, 1));
    const c = this.world.court;
    const tmp = new THREE.Vector3();
    this.away.forEach((a, i) => {
      c.spawnPoint(1, i, this.away.length, tmp);
      a.resetForRound(tmp, 0);
      a.dissolve = 1;
      a.fadeIn(1.5);
    });
    this.home.forEach((a, i) => {
      if (a.isOut || !a.active) {
        // includes a teammate knocked down by a trade on the wave's final throw
        a.dropBall(0);
        c.spawnPoint(0, i, this.home.length, tmp);
        a.resetForRound(tmp, Math.PI);
        a.dissolve = 1;
        a.fadeIn(2);
      } else {
        a.releaseScripted();
        a.hearts = a.maxHearts;
      }
    });
    this.world.events.emit('announce', { text: `WAVE ${this.wave + 1}`, sub: `${waves.length - this.wave} remaining`, style: 'round' });
    this.roundTime = 0;
    this.roundWinner = -1;
    // short breather: the new challengers materialise during a countdown
    this.setPhase('countdown');
    this.countdownValue = TUNING.round.countdown + 1;
  }

  private endMatch() {
    this.setPhase('matchEnd');
    const won = this.config.mode === 'survival' ? this.wave >= (this.config.waves?.length ?? 1) : this.score[0] > this.score[1];
    this.world.events.emit('matchEnd', { winner: won ? 0 : 1 });
  }

  forceEnd(won: boolean) {
    this.score = won ? [this.config.roundsToWin, 0] : [0, this.config.roundsToWin];
    this.endMatch();
  }

  result(): MatchResult {
    const won = this.config.mode === 'survival' ? this.wave >= (this.config.waves?.length ?? 1) : this.score[0] > this.score[1];
    return {
      won,
      score: [...this.score] as [number, number],
      rounds: this.round,
      duration: this.totalTime,
      wavesCleared: this.wavesCleared,
      player: this.player ? { ...this.player.stats_ } : null,
      flawless: this.playerHitCount === 0,
    };
  }

  get timeRemaining() {
    return Math.max(0, this.config.timeLimit - this.roundTime);
  }
}
