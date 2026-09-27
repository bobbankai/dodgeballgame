import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { time } from '../core/Time';
import type { Game } from '../core/Game';
import { CinematicDirector, Shot } from '../cinematics/CinematicDirector';
import { ABILITIES } from '../data/skills';
import type { Athlete } from '../game/Athlete';
import { Ball } from '../game/Ball';
import { GhostPool } from '../vfx/Ghosts';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface DecoyBall {
  ball: Ball;
  life: number;
}

/**
 * Active abilities (Power Shot, Phantom Throw, Blink Step), shockwave rules,
 * afterimages and the cinematic OVERTHROW ultimate. Shared by player and AI.
 */
export class AbilitySystem {
  readonly ghosts = new GhostPool();
  private unsubs: (() => void)[] = [];
  private decoyBalls: DecoyBall[] = [];
  private ghostTimers = new Map<Athlete, number>();
  private decoyId = 1;
  ultimateRunning: Athlete | null = null;
  ultBall: Ball | null = null;
  private moteTimer = 0;
  private ultVictim: Athlete | null = null;
  /** Dedicated light so the energised thrower actually lights the scene. */
  private ultLight = new THREE.PointLight(0xffb13b, 0, 7, 1.6);

  constructor(
    private game: Game,
    private director: CinematicDirector,
  ) {
    game.world.scene.add(this.ghosts.root);
    game.world.scene.add(this.ultLight);
  }

  abilityCost(a: Athlete) {
    const id = a.profile.ability;
    return id ? (ABILITIES[id]?.cost ?? 999) : 999;
  }

  bind() {
    const ev = this.game.world.events;
    // dash afterimages (player and bosses): clone their rigs now rather than on the first dodge
    for (const a of this.game.world.athletes) if (a.isPlayer || a.profile.boss) this.ghosts.preallocate(a, 5);
    this.unsubs.push(
      ev.on('throw', ({ athlete, ball, info }) => {
        if (athlete.phantomArmed && info.kind !== 'pass' && info.kind !== 'ultimate') {
          athlete.phantomArmed = false;
          this.spawnPhantom(athlete, ball);
        }
      }),
      ev.on('dodge', ({ athlete }) => {
        if (athlete.isPlayer || athlete.profile.boss) this.ghostTimers.set(athlete, 0);
      }),
      ev.on('shockwave', ({ point, radius, source }) => this.applyShockwave(point, radius, source)),
      ev.on('hit', ({ ball, point, victim }) => {
        if (ball.info?.kind === 'ultimate') {
          this.ultVictim = victim;
          this.ultimateImpact(point, ball.thrower, victim);
        }
      }),
      ev.on('roundStart', () => this.resetRound()),
    );
  }

  unbind() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.resetRound();
    this.ghosts.clear();
  }

  private resetRound() {
    for (const d of this.decoyBalls) this.removeBall(d.ball);
    this.decoyBalls = [];
    this.game.world.decoys = [];
    if (this.director.playing && this.ultimateRunning) this.director.skip();
    this.ultimateRunning = null;
    time.cineScale = 1;
  }

  // ------------------------------------------------------------------ abilities
  useAbility(a: Athlete): boolean {
    const id = a.profile.ability;
    if (!id || !a.canAct || this.ultimateRunning) return false;
    const cost = this.abilityCost(a);
    if (a.energy < cost) return false;
    const w = this.game.world;
    let ok = false;
    switch (id) {
      case 'powerShot':
        if (a.powerArmed) return false;
        a.powerArmed = true;
        if (a.state === 'charging') a.convertToPower();
        ok = true;
        break;
      case 'phantom':
        if (a.phantomArmed) return false;
        a.phantomArmed = true;
        ok = true;
        break;
      case 'blink':
        ok = this.blink(a);
        break;
    }
    if (!ok) return false;
    a.energy -= cost;
    w.events.emit('ability', { athlete: a, id });
    const col = this.game.feedback.color(a.team);
    a.chestPos(_v);
    this.game.vfx.ring(new THREE.Vector3(a.pos.x, 0.05, a.pos.z), 1.4, id === 'powerShot' ? 0xffb13b : col, 0.45, 0.2);
    this.game.vfx.flash(_v, 1.2, id === 'powerShot' ? 0xffb13b : col, 0.2);
    this.game.audio.play(id === 'blink' ? 'blink' : 'ability', { pos: a.pos });
    if (a.isPlayer) {
      w.events.emit('announce', { text: ABILITIES[id].name.toUpperCase(), style: 'perfect' });
      this.game.renderer.pulseRadial(0.8);
    } else if (a.profile.boss) {
      w.events.emit('announce', { text: ABILITIES[id].name.toUpperCase(), sub: a.name, style: 'warn' });
    }
    return true;
  }

  private blink(a: Athlete): boolean {
    if (a.state !== 'free' && a.state !== 'charging' && a.state !== 'catching' && a.state !== 'dodging') return false;
    const dir = _v.copy(a.move).setY(0);
    if (dir.lengthSq() < 0.05) dir.set(-Math.cos(a.yaw), 0, Math.sin(a.yaw));
    dir.normalize();
    const from = a.pos.clone();
    const to = from.clone().addScaledVector(dir, 6.5);
    this.game.world.court.clampAthlete(to, a.team);
    const col = this.game.feedback.color(a.team);
    // afterimages along the path + a lingering decoy at the origin
    const decoy = this.ghosts.spawn(a, col, 1.6, 0.55);
    for (let i = 1; i <= 4; i++) {
      a.pos.lerpVectors(from, to, i / 5);
      a.rig.root.position.copy(a.pos);
      a.rig.root.updateMatrixWorld(true);
      this.ghosts.spawn(a, col, 0.25 + i * 0.05, 0.35);
    }
    void decoy;
    a.blinkTo(to);
    this.game.world.decoys.push({ owner: a, pos: from, until: this.game.world.time.gameTime + 1.6, id: this.decoyId++ });
    this.game.vfx.dust(from, 1.2);
    this.game.vfx.dust(to, 1.2);
    this.game.vfx.add.emit({ pos: new THREE.Vector3(to.x, 1, to.z), count: 30, speed: [1, 4], life: [0.2, 0.5], size: [0.08, 0.01], color: 0xffffff, color2: col, drag: 3, shape: 1, jitter: 0.4 });
    return true;
  }

  private spawnPhantom(a: Athlete, real: Ball) {
    const w = this.game.world;
    // decoy continues on the "obvious" line
    const decoy = w.balls.spawn(real.pos);
    decoy.decoy = true;
    decoy.vel.copy(real.vel);
    decoy.state = 'thrown';
    decoy.live = true;
    decoy.thrower = a;
    decoy.info = { ...real.info!, kind: 'phantom', curve: null, homing: null };
    decoy.ignore.add(a);
    decoy.energyTarget = 0.4;
    decoy.energyColor.set(this.game.feedback.color(a.team));
    decoy.airTime = 0;
    this.decoyBalls.push({ ball: decoy, life: 0.9 });
    this.game.vfx.trailFor(decoy, this.game.feedback.color(a.team), 0.12, 0.8, 0.14);
    // the real ball swings wide and bends back, invisible until the last moment
    const speed = real.vel.length();
    const target = real.info!.target;
    const dist = target ? target.pos.distanceTo(real.pos) : 12;
    const tFlight = dist / Math.max(10, speed);
    const theta = 0.42 * (Math.random() < 0.5 ? 1 : -1);
    real.vel.applyAxisAngle(UP, theta);
    const left = new THREE.Vector3().crossVectors(UP, real.vel).setY(0).normalize();
    const lateral = dist * Math.sin(Math.abs(theta));
    const acc = (2 * lateral) / (tFlight * tFlight);
    real.info!.curve = left.multiplyScalar(-Math.sign(theta) * acc);
    real.info!.kind = 'phantom';
    real.hiddenTimer = Math.max(0.12, tFlight - 0.22);
    this.game.vfx.endTrail(real);
  }

  private removeBall(b: Ball) {
    const w = this.game.world;
    const i = w.balls.balls.indexOf(b);
    if (i >= 0) w.balls.balls.splice(i, 1);
    b.removeFrom(w.scene);
    this.game.vfx.endTrail(b);
  }

  private applyShockwave(point: THREE.Vector3, radius: number, source: Athlete | null) {
    if (!source) return;
    const w = this.game.world;
    const ult = this.ultimateRunning === source || (this.ultBall?.info?.kind === 'ultimate' && this.ultBall.thrower === source);
    const meteor = ult && source.isPlayer && this.game.progression?.d.skills.includes('meteor');
    const r = meteor ? radius * 1.6 : radius;
    for (const o of w.opponentsOf(source)) {
      const d = Math.hypot(o.pos.x - point.x, o.pos.z - point.z);
      if (d > r) continue;
      const dir = _v2.set(o.pos.x - point.x, 0, o.pos.z - point.z);
      if (dir.lengthSq() < 1e-4) dir.set(0, 0, source.team === 0 ? -1 : 1);
      if (meteor && o.invuln <= 0 && o.state !== 'dodging') {
        o.hearts = Math.max(0, o.hearts - 1);
        o.hitFlash = 1;
        if (o.hearts <= 0) o.knockOut(source);
        else o.stagger(dir, 1);
      } else o.stagger(dir, 1 - d / (r * 1.4));
    }
  }

  // ------------------------------------------------------------------ ultimate
  useUltimate(a: Athlete): boolean {
    if (!a.profile.ultimate || a.ult < TUNING.ult.max || !a.canAct || this.ultimateRunning) return false;
    if (!(a.state === 'free' || a.state === 'charging' || a.state === 'catchRecover' || a.state === 'power')) return false;
    const w = this.game.world;
    const target = a.aimTarget && a.aimTarget.active ? a.aimTarget : w.opponentsOf(a).sort((p, q) => (q.isPlayer ? 1 : 0) - (p.isPlayer ? 1 : 0) || p.pos.distanceTo(a.pos) - q.pos.distanceTo(a.pos))[0];
    if (!target) return false;
    a.ult = 0;
    let ball = a.ball;
    if (!ball) {
      ball = w.balls.spawn(a.handPos(new THREE.Vector3()));
      a.grabBall(ball, false);
    }
    this.ultBall = ball;
    this.ultVictim = null;
    this.ultimateRunning = a;
    a.beginUltimate();
    a.anim.play('ultimateJump', { fade: 0.08, hold: true, manual: true, time: 0 });
    ball.energyTarget = 1;
    ball.energyColor.set(a.isPlayer ? 0xffb13b : this.game.feedback.color(a.team));
    w.events.emit('ultimateStart', { athlete: a });
    this.game.audio.play('ultimateRise', { volume: 1 });
    this.game.audio.crowd(1.2);
    const grade = this.game.renderer.grade;
    const baseExposure = grade.u('uExposure').value as number;
    const col = a.isPlayer ? new THREE.Color(0xffb13b) : this.game.feedback.color(a.team);
    let jumpT = 0;
    const tick = (dt: number, realDt: number) => {
      // animate the wind-up pose in real time so it reads during slow motion
      jumpT = Math.min(0.6, jumpT + realDt * 0.75);
      if (a.state === 'ultimate' && a.anim.current() === 'ultimateJump') a.anim.setTime('ultimateJump', jumpT);
      this.moteTimer -= realDt;
      if (this.moteTimer <= 0 && a.ball) {
        this.moteTimer = 0.03;
        this.game.vfx.energyMotes(a.ball.pos, col, 3, 1.2);
        this.game.vfx.add.emit({ pos: new THREE.Vector3(a.pos.x, 0.1, a.pos.z), count: 2, dir: UP, spread: 0.3, speed: [2, 5], life: [0.3, 0.6], size: [0.08, 0.02], color: 0xffffff, color2: col, jitter: 0.6, shape: 1, drag: 1 });
      }
      grade.u('uExposure').value += (baseExposure * 0.7 - (grade.u('uExposure').value as number)) * Math.min(1, realDt * 6);
      const lp = a.ball ? a.ball.pos : a.pos;
      this.ultLight.position.set(lp.x, lp.y + 0.2, lp.z);
      this.ultLight.color.copy(col);
      this.ultLight.intensity += (26 - this.ultLight.intensity) * Math.min(1, realDt * 5);
    };
    this.game.tickers.add(tick);
    const restore = () => {
      this.game.tickers.delete(tick);
      grade.u('uExposure').value = baseExposure;
      this.ultLight.intensity = 0;
    };
    const release = () => {
      if (!this.ultimateRunning) return;
      restore();
      a.anim.play('ultimateThrow', { fade: 0.03 });
      target.chestPos(_v);
      const from = a.handPos(new THREE.Vector3());
      const dir = _v.clone().sub(from).normalize();
      const chain = a.isPlayer && this.game.progression?.d.skills.includes('supernova') ? 2 : 0;
      const b = a.launchCustom('ultimate', dir.multiplyScalar(46), {
        power: 2.3, damage: 2, heavy: true, homing: target, homingStrength: a.isPlayer ? 6 : 2.4, gravityScale: 0.05, shockwave: true, target, chain,
      });
      if (b) {
        b.energyTarget = 1;
        this.game.vfx.trailFor(b, col, 0.22, 1.5, 0.3);
        w.events.emit('ultimateRelease', { athlete: a, ball: b });
      }
      this.game.renderer.pulseRadial(1.2);
      this.game.renderer.flashScreen(0.12, col.getHex());
      this.game.cam.addTrauma(0.5);
      this.game.audio.play('throwPower', { volume: 1 });
      a.vy = Math.min(a.vy, 0);
      setTimeout(() => a.endUltimate(), 350);
    };

    const shots: Shot[] = a.isPlayer
      ? [
          {
            dur: 0.7,
            pos: { at: a, off: [1.5, 0.75, 2.5] },
            pos2: { at: a, off: [1.0, 1.0, 1.9] },
            look: { at: a, off: [0, 1.15, 0] },
            fov: 46,
            fov2: 38,
            timeScale: 0.12,
            dof: { range: 1.5, bokeh: 3 },
            events: [{ t: 0.45, fn: () => (a.vy = 7.2) }],
          },
          {
            dur: 0.75,
            orbit: { center: { at: a, off: [0, 1.5, 0] }, radius: 3.4, radius2: 2.6, height: 0.2, from: a.yaw + 1.0, to: a.yaw + 2.5 },
            look: { at: a, off: [0, 1.6, 0] },
            fov: 52,
            timeScale: 0.2,
            shake: 0.4,
            events: [{ t: 0.05, fn: () => this.director.ui.big('OVERTHROW', a.name, 'ultimate') }],
          },
          {
            dur: 0.55,
            pos: { at: a, off: [0.75, 1.95, -2.5] },
            look: () => target.chestPos(new THREE.Vector3()),
            fov: 50,
            fov2: 34,
            timeScale: 0.05,
            events: [{ t: 0.5, fn: release }],
          },
          {
            dur: 0.9,
            pos: () => {
              const b = this.ultBall!;
              const v = _v2.copy(b.vel).setY(0);
              if (v.lengthSq() < 0.01) v.set(0, 0, -1);
              v.normalize();
              return b.pos.clone().addScaledVector(v, -2.6).add(new THREE.Vector3(0.4, 0.55, 0));
            },
            look: () => this.ultBall!.pos.clone().addScaledVector(_v2.copy(this.ultBall!.vel).normalize(), 4),
            fov: 72,
            timeScale: 1,
            until: () => !this.ultBall || !this.ultBall.live,
          },
          {
            // impact: low wide angle on the victim while time crawls
            dur: 0.85,
            pos: () => {
              const v = this.ultVictim ?? target;
              const toThrower = _v2.set(a.pos.x - v.pos.x, 0, a.pos.z - v.pos.z).normalize();
              const side = new THREE.Vector3(-toThrower.z, 0, toThrower.x);
              return new THREE.Vector3(v.pos.x, 0.55, v.pos.z).addScaledVector(toThrower, 3.2).addScaledVector(side, 2.2);
            },
            look: () => {
              const v = this.ultVictim ?? target;
              return new THREE.Vector3(v.pos.x, 1.0, v.pos.z);
            },
            fov: 58,
            fov2: 50,
            shake: 0.5,
          },
        ]
      : [
          {
            dur: 0.6,
            pos: { at: a, off: [1.6, 1.0, 2.8] },
            look: { at: a, off: [0, 1.3, 0] },
            fov: 45,
            timeScale: 0.15,
            onStart: () => this.director.ui.big('DANGER', `${a.name.toUpperCase()} — OVERTHROW INCOMING`, 'warn'),
            events: [{ t: 0.3, fn: () => (a.vy = 6.5) }],
          },
          {
            dur: 0.55,
            orbit: { center: { at: a, off: [0, 1.6, 0] }, radius: 3.6, height: 0.4, from: a.yaw + 0.8, to: a.yaw + 1.8 },
            look: { at: a, off: [0, 1.7, 0] },
            fov: 50,
            timeScale: 0.2,
            events: [{ t: 0.5, fn: release }],
          },
        ];
    this.director
      .play(shots, { skippable: false, letterbox: true, returnBlend: 0.4, hideHud: a.isPlayer })
      .then(() => {
        restore();
        if (this.ultimateRunning === a) {
          if (a.state === 'ultimate') a.endUltimate();
          this.ultimateRunning = null;
        }
        time.cineScale = 1;
      });
    return true;
  }

  private ultimateImpact(point: THREE.Vector3, thrower: Athlete | null, victim: Athlete) {
    const g = this.game;
    time.slowMo(0.18, 0.9, 0.01, 0.4);
    g.renderer.flashScreen(0.22, 0xfff1c8);
    g.renderer.pulseRadial(1.1);
    g.renderer.pulseAberration(0.3);
    g.renderer.shockwave(point, 2.2, 0.8);
    g.cam.addTrauma(0.8);
    g.arena?.hype(1.5);
    g.audio.play('ultimateImpact', { volume: 1 });
    g.audio.crowd(1.5);
    const col = thrower ? g.feedback.color(thrower.team) : new THREE.Color(0xffb13b);
    g.vfx.shockwave(new THREE.Vector3(point.x, 0.05, point.z), 4.5, thrower?.isPlayer ? 0xffb13b : col);
    g.vfx.ring(new THREE.Vector3(point.x, 0.06, point.z), 7, 0xffffff, 0.8, 0.06, 0.7);
    for (let i = 0; i < 3; i++) g.vfx.sparks(point, new THREE.Vector3(Math.random() - 0.5, 1, Math.random() - 0.5).normalize(), 40, 0xffb13b, 14);
    if (thrower?.isPlayer) g.world.events.emit('announce', { text: 'OVERTHROWN!', sub: victim.name.toUpperCase(), style: 'ultimate' });
  }

  update(dt: number) {
    this.ghosts.update(dt);
    const w = this.game.world;
    const now = w.time.gameTime;
    w.decoys = w.decoys.filter((d) => d.until > now);
    for (let i = this.decoyBalls.length - 1; i >= 0; i--) {
      const d = this.decoyBalls[i];
      d.life -= dt;
      if (d.life <= 0 || !d.ball.live) {
        this.game.vfx.add.emit({ pos: d.ball.pos, count: 16, speed: [1, 3], life: [0.2, 0.4], size: [0.1, 0.02], color: 0xffffff, color2: this.game.feedback.color(d.ball.thrower?.team ?? 0), drag: 3 });
        this.removeBall(d.ball);
        this.decoyBalls.splice(i, 1);
      }
    }
    // dash afterimages
    for (const [a, t] of this.ghostTimers) {
      if (a.state !== 'dodging' || a.stateTime > 0.24) {
        this.ghostTimers.delete(a);
        continue;
      }
      const nt = t - dt;
      if (nt <= 0) {
        this.ghosts.spawn(a, this.game.feedback.color(a.team), 0.28, a.isPlayer ? 0.32 : 0.25);
        this.ghostTimers.set(a, 0.05);
      } else this.ghostTimers.set(a, nt);
    }
    if (this.ultimateRunning && !this.ultimateRunning.active) this.ultimateRunning = null;
  }
}
