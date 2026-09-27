import * as THREE from 'three';
import { TUNING } from '../config/tuning';
import { Time } from '../core/Time';
import { GameCamera } from '../camera/GameCamera';
import { Renderer } from '../rendering/Renderer';
import { VFX } from '../vfx/VFX';
import type { Arena } from '../levels/Arena';
import type { AudioEngine } from '../audio/AudioEngine';
import type { Athlete } from './Athlete';
import type { TeamId } from './types';
import type { World } from './World';

const _v = new THREE.Vector3();

/**
 * Presentation director: listens to gameplay events and produces layered feedback
 * (hit-stop, slow motion, camera response, particles, lights, post FX, crowd, audio,
 * announcements). Intensity always scales with gameplay importance.
 */
export class Feedback {
  teamColors: [THREE.Color, THREE.Color] = [new THREE.Color(0x27e0d0), new THREE.Color(0xff4a3a)];
  arena: Arena | null = null;
  private unsubs: (() => void)[] = [];
  private chargeMoteTimer = 0;
  /** Suppress big slow-mo moments (tutorial, cinematics). */
  subtle = false;

  constructor(
    private world: World,
    private time: Time,
    private cam: GameCamera,
    private renderer: Renderer,
    private vfx: VFX,
    private audio: AudioEngine,
  ) {}

  setTeamColors(home: number, away: number) {
    this.teamColors = [new THREE.Color(home), new THREE.Color(away)];
  }

  color(team: TeamId) {
    return this.teamColors[team];
  }

  private isPlayer(a: Athlete | null | undefined) {
    return !!a && a.isPlayer;
  }

  private nearCam(p: THREE.Vector3) {
    return Math.max(0, 1 - this.cam.camera.position.distanceTo(p) / 22);
  }

  bind() {
    const ev = this.world.events;
    const w = this.world;
    this.unsubs.push(
      ev.on('throw', ({ athlete, ball, info }) => {
        const col = this.color(athlete.team);
        const strong = info.kind === 'power' || info.kind === 'ultimate';
        if (info.kind !== 'pass') {
          // proportional to importance: quick = faint sliver, perfect/power = bold streak
          const width = strong ? 0.24 : info.perfect ? 0.17 : 0.07 + info.power * 0.05;
          const intensity = strong ? 1.6 : info.perfect ? 1.2 : 0.35 + info.power * 0.3;
          const life = strong ? 0.3 : info.perfect ? 0.2 : 0.08 + info.power * 0.06;
          this.vfx.trailFor(ball, strong ? new THREE.Color(0xffb13b) : col, width, intensity, life);
        }
        const hand = ball.pos;
        if (info.perfect || strong) {
          this.vfx.flash(hand, strong ? 1.8 : 1.1, info.perfect ? 0xffffff : col, 0.16);
          this.vfx.add.emit({ pos: hand, count: strong ? 40 : 18, dir: ball.vel.clone().normalize(), spread: 0.5, speed: [4, 12], life: [0.12, 0.3], size: [0.06, 0.01], color: 0xffffff, color2: col, stretch: 0.03, shape: 1, drag: 3 });
        }
        if (this.isPlayer(athlete)) {
          const k = info.kind === 'quick' ? 0.3 : info.kind === 'charged' ? 0.6 + info.power * 0.3 : strong ? 1.6 : 0.4;
          this.cam.kickDir(ball.vel.clone().normalize().multiplyScalar(-1), 0.35 * k);
          this.cam.punchFov(info.perfect ? 6 : strong ? 10 : 2 * k);
          if (info.perfect) this.renderer.pulseAberration(0.35);
          if (strong) {
            this.renderer.pulseRadial(1.0);
            this.cam.addTrauma(0.35);
          }
        }
        this.audio.play(strong ? 'throwPower' : info.kind === 'pass' ? 'pass' : info.kind === 'quick' ? 'throwQuick' : 'throw', { pos: hand, volume: 0.6 + info.power * 0.3, pitch: 0.9 + Math.random() * 0.2 });
        if (info.perfect) this.audio.play('perfectRelease', { pos: hand });
      }),
      ev.on('chargeFull', ({ athlete }) => {
        if (athlete.ball) {
          this.vfx.flash(athlete.ball.pos, 0.7, 0xffffff, 0.12);
          this.vfx.ring(athlete.ball.pos, 0.35, this.color(athlete.team), 0.25, 0.3, 1, this.cam.camera.getWorldDirection(new THREE.Vector3()).negate());
        }
        if (this.isPlayer(athlete)) this.audio.play('chargeReady', { volume: 0.7 });
      }),
      ev.on('chargeStart', ({ athlete }) => {
        if (this.isPlayer(athlete)) this.audio.play('chargeStart', { volume: 0.4 });
      }),
      ev.on('hit', ({ victim, thrower, ball, damage, ko, point, dir, power }) => {
        const col = thrower ? this.color(thrower.team) : new THREE.Color(0xffffff);
        this.vfx.endTrail(ball);
        const playerInvolved = this.isPlayer(victim) || this.isPlayer(thrower);
        this.vfx.impact(point, dir, power * (ko ? 1.3 : 1), col, playerInvolved ? 1 : 0.7);
        const heavy = power >= 1.35 || damage >= 2;
        this.time.hitStop(ko ? TUNING.feel.hitStopKO : heavy ? TUNING.feel.hitStopPower : TUNING.feel.hitStopNormal);
        const near = this.nearCam(point);
        this.cam.addTrauma((playerInvolved ? 0.28 : 0.1) * (heavy ? 1.8 : 1) + near * 0.1);
        if (heavy) {
          this.renderer.shockwave(point, 0.8, 0.35);
          if (playerInvolved) this.renderer.pulseAberration(0.6);
        }
        if (this.isPlayer(victim)) {
          this.renderer.pulseVignette(0.5, 0xff2020);
          this.renderer.pulseAberration(0.7);
          this.cam.kickDir(dir, 1.2);
        }
        this.arena?.hype(ko ? 0.9 : 0.45);
        this.audio.play(heavy ? 'hitHeavy' : 'hit', { pos: point, volume: 0.8 + power * 0.2 });
        this.audio.crowd(ko ? 1 : 0.5);
        if (this.isPlayer(thrower)) {
          w.events.emit('announce', { text: ko ? 'KNOCKOUT!' : 'HIT!', sub: ko ? victim.name.toUpperCase() : '', style: ko ? 'ko' : 'hit' });
        } else if (this.isPlayer(victim)) {
          w.events.emit('announce', { text: ko ? 'YOU\'RE OUT' : 'TAKEN A HIT', sub: ko ? 'Teammates can revive you with a catch' : `${victim.hearts} heart${victim.hearts === 1 ? '' : 's'} left`, style: 'warn' });
        }
      }),
      ev.on('catch', ({ catcher, thrower, ball, perfect, point }) => {
        if (ball.info?.kind === 'pass' || !thrower || thrower.team === catcher.team) {
          this.audio.play('passCatch', { pos: point, volume: 0.5 });
          return;
        }
        this.vfx.endTrail(ball);
        const col = this.color(catcher.team);
        const mine = this.isPlayer(catcher);
        const playerInvolved = mine || this.isPlayer(thrower);
        // spectacle scales with how much the moment matters to the player
        this.vfx.catchBurst(point, perfect, col, mine ? 1 : 0.55);
        if (perfect && mine && !this.subtle) {
          this.time.slowMo(0.22, TUNING.feel.perfectCatchSlowmo, 0.02, 0.3);
          this.renderer.flashScreen(0.18, 0xfff4d0);
          this.renderer.pulseRadial(1.3);
          this.renderer.pulseAberration(0.6);
          this.renderer.pulseVignette(0.35, 0xffd36a);
        } else if (perfect && playerInvolved) {
          this.time.hitStop(0.08);
          this.renderer.pulseAberration(0.4);
        } else {
          this.time.hitStop(0.04);
        }
        this.cam.addTrauma(mine ? 0.16 : playerInvolved ? 0.12 : 0.03);
        this.arena?.hype(perfect ? 1.1 : 0.55);
        this.audio.play(perfect ? 'catchPerfect' : 'catch', { pos: point, volume: mine ? 1 : 0.75 });
        this.audio.crowd(perfect ? 1.1 : 0.6);
        if (mine) w.events.emit('announce', { text: perfect ? 'PERFECT CATCH' : 'CAUGHT!', sub: `${thrower.name.toUpperCase()} loses a heart`, style: perfect ? 'perfect' : 'catch' });
        else if (this.isPlayer(thrower)) w.events.emit('announce', { text: 'CAUGHT', sub: `by ${catcher.name}`, style: 'warn' });
        else if (catcher.team === 0) w.events.emit('announce', { text: perfect ? 'PERFECT CATCH' : 'NICE CATCH', sub: catcher.name.toUpperCase(), style: 'info' });
      }),
      ev.on('fumble', ({ athlete, ball, point }) => {
        this.vfx.endTrail(ball);
        this.vfx.sparks(point, new THREE.Vector3(0, 1, 0), 30, this.color(athlete.team === 0 ? 1 : 0), 7);
        this.vfx.flash(point, 1.2, 0xffffff, 0.12);
        this.time.hitStop(0.06);
        this.audio.play('fumble', { pos: point });
        if (this.isPlayer(athlete)) w.events.emit('announce', { text: 'FUMBLE', sub: 'Too powerful — time it perfectly', style: 'warn' });
      }),
      ev.on('block', ({ athlete, ball, reflect, point }) => {
        this.vfx.sparks(point, athlete.forwardVec(new THREE.Vector3()), reflect ? 50 : 24, this.color(athlete.team), reflect ? 10 : 6);
        this.vfx.flash(point, reflect ? 2 : 1, reflect ? 0xffffff : this.color(athlete.team), 0.15);
        if (reflect) {
          this.vfx.trailFor(ball, this.color(athlete.team), 0.18, 1.3, 0.22);
          if (this.isPlayer(athlete)) {
            this.time.slowMo(0.3, 0.3, 0.02, 0.15);
            this.renderer.pulseRadial(1.0);
          }
        } else this.vfx.endTrail(ball);
        this.time.hitStop(0.05);
        this.audio.play(reflect ? 'reflect' : 'block', { pos: point });
        if (this.isPlayer(athlete)) w.events.emit('announce', { text: reflect ? 'REFLECT!' : 'BLOCKED', style: reflect ? 'perfect' : 'info' });
      }),
      ev.on('dodge', ({ athlete, dir }) => {
        this.vfx.dust(athlete.pos, 1.2, 0xcbb89a, dir.clone().negate().setY(0.4).normalize());
        this.audio.play('dodge', { pos: athlete.pos, volume: 0.6 });
      }),
      ev.on('perfectDodge', ({ athlete }) => {
        if (!this.subtle && this.isPlayer(athlete)) this.time.slowMo(0.3, TUNING.feel.perfectDodgeSlowmo, 0.02, 0.2);
        athlete.chestPos(_v);
        this.vfx.flash(_v, 1.8, 0x8fd8ff, 0.25);
        this.vfx.ring(new THREE.Vector3(athlete.pos.x, 0.05, athlete.pos.z), 2, 0x8fd8ff, 0.45, 0.15);
        if (this.isPlayer(athlete)) {
          this.renderer.pulseVignette(0.3, 0x6fc8ff);
          this.renderer.pulseRadial(0.8);
          w.events.emit('announce', { text: 'PERFECT DODGE', sub: '+ Energy', style: 'perfect' });
        }
        this.audio.play('perfectDodge', { pos: athlete.pos });
      }),
      ev.on('pickup', ({ athlete, ball }) => {
        this.vfx.add.emit({ pos: ball.pos, count: 8, speed: [0.5, 1.8], life: [0.2, 0.4], size: [0.05, 0.01], color: 0xffffff, color2: this.color(athlete.team), drag: 3, shape: 1 });
        this.audio.play('pickup', { pos: ball.pos, volume: 0.5 });
      }),
      ev.on('bounce', ({ ball, surface, speed, point, normal }) => {
        if (surface === 'athlete') return;
        const k = Math.min(1, speed / 20);
        if (surface === 'floor') {
          if (speed > 3) this.vfx.dust(point, k, 0xd6c6aa);
          if (ball.info && ball.info.kind !== 'pass') this.vfx.endTrail(ball);
        } else {
          if (speed > 6) this.vfx.sparks(point, normal, 6 + Math.round(k * 16), 0xffe0b0, 3 + k * 6);
          if (ball.live) {
            this.vfx.ring(point, 0.5 + k * 0.6, this.color(ball.lastTeam === 1 ? 1 : 0), 0.25, 0.25, 0.9, normal);
            this.arena?.hype(0.1);
          }
        }
        this.audio.play(surface === 'floor' ? 'bounce' : 'wall', { pos: point, volume: 0.25 + k * 0.7, pitch: 0.9 + Math.random() * 0.25 });
      }),
      ev.on('clash', ({ a, b, point }) => {
        this.vfx.endTrail(a);
        this.vfx.endTrail(b);
        this.vfx.impact(point, new THREE.Vector3(0, 1, 0), 1.6, 0xffffff);
        this.time.hitStop(0.1);
        this.cam.addTrauma(0.25);
        this.arena?.hype(0.8);
        this.audio.play('clash', { pos: point });
        w.events.emit('announce', { text: 'CLASH!', style: 'info' });
      }),
      ev.on('ko', ({ athlete }) => {
        athlete.chestPos(_v);
        this.vfx.ring(new THREE.Vector3(athlete.pos.x, 0.05, athlete.pos.z), 1.8, this.color(athlete.team), 0.6, 0.12);
        this.audio.play('ko', { pos: _v });
      }),
      ev.on('revive', ({ athlete }) => {
        athlete.chestPos(_v);
        this.vfx.ring(new THREE.Vector3(athlete.pos.x, 0.05, athlete.pos.z), 1.6, this.color(athlete.team), 0.8, 0.2);
        this.vfx.add.emit({ pos: new THREE.Vector3(athlete.pos.x, 0.1, athlete.pos.z), count: 40, dir: new THREE.Vector3(0, 1, 0), spread: 0.25, speed: [2, 6], life: [0.4, 0.9], size: [0.06, 0.02], color: 0xffffff, color2: this.color(athlete.team), drag: 1.5, jitter: 0.35, shape: 1 });
        this.audio.play('revive', { pos: _v });
        w.events.emit('announce', { text: 'COMEBACK!', sub: `${athlete.name} returns`, style: athlete.team === 0 ? 'catch' : 'warn' });
      }),
      ev.on('footstep', ({ athlete, intensity }) => {
        if (athlete.sprinting && Math.random() < 0.6) this.vfx.dust(athlete.pos, 0.25, 0xcbb89a);
        if (intensity > 0.5 || athlete.isPlayer) this.audio.play('step', { pos: athlete.pos, volume: 0.12 + intensity * 0.12, pitch: 0.85 + Math.random() * 0.3 });
      }),
      ev.on('shockwave', ({ point, radius, source }) => {
        const col = source ? this.color(source.team) : new THREE.Color(0xffffff);
        this.vfx.shockwave(point, radius, col);
        this.renderer.shockwave(point, 1.4, 0.6);
        this.cam.addTrauma(0.45);
        this.time.hitStop(0.08);
        this.arena?.hype(1);
        this.audio.play('shockwave', { pos: point });
      }),
      ev.on('fake', ({ athlete }) => {
        this.audio.play('fake', { pos: athlete.pos, volume: 0.5 });
      }),
      ev.on('whiff', ({ athlete }) => {
        if (this.isPlayer(athlete)) this.audio.play('whiff', { volume: 0.4 });
      }),
      ev.on('countdown', ({ value }) => {
        if (value > 0) {
          w.events.emit('announce', { text: String(value), style: 'round' });
          this.audio.play('countdown', { volume: 0.7 });
        } else {
          w.events.emit('announce', { text: 'DODGE!', style: 'round' });
          this.audio.play('go', { volume: 0.9 });
          this.arena?.hype(0.8);
          this.audio.crowd(1);
        }
      }),
      ev.on('roundEnd', ({ winner }) => {
        if (!this.subtle) this.time.slowMo(0.25, 1.4, 0.02, 0.6);
        this.renderer.pulseRadial(0.6);
        this.arena?.hype(1.2);
        this.audio.crowd(1.4);
        this.audio.play(winner === 0 ? 'roundWin' : 'roundLose', { volume: 0.9 });
      }),
    );
  }

  /** Per-frame continuous feedback (charge motes, trails of loose balls, speed lines). */
  update(dt: number) {
    const w = this.world;
    this.chargeMoteTimer -= dt;
    for (const a of w.athletes) {
      if ((a.state === 'charging' || a.state === 'power') && a.ball && a.charge > 0.35) {
        if (this.chargeMoteTimer <= 0) {
          const col = a.state === 'power' ? 0xffb13b : this.color(a.team);
          this.vfx.energyMotes(a.ball.pos, col, a.state === 'power' ? 3 : 1, a.state === 'power' ? 0.9 : 0.5);
        }
      }
      if (a.state === 'dodging' && a.stateTime < 0.2 && Math.random() < 0.5) this.vfx.dust(a.pos, 0.3);
    }
    if (this.chargeMoteTimer <= 0) this.chargeMoteTimer = 0.03;
    for (const b of w.balls.balls) {
      if (b.state === 'thrown' && !b.live && b.info?.kind !== 'pass') this.vfx.endTrail(b);
      if (b.state === 'loose') this.vfx.endTrail(b);
    }
    const p = w.match?.player;
    this.renderer.speedLines = p && p.sprinting ? 0.35 : 0;
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}
