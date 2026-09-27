import * as THREE from 'three';
import type { Game } from '../core/Game';
import { AIController } from '../ai/AIController';
import type { Athlete } from './Athlete';

interface Hazard {
  pos: THREE.Vector3;
  t: number;
  fuse: number;
  ringTimer: number;
}

/**
 * Boss-fight layer: enrage phases at low health (faster reactions, aggression,
 * abilities recharged, visible aura) and telegraphed arena hazards for special rules.
 */
export class BossDirector {
  private unsubs: (() => void)[] = [];
  private raged = new Set<Athlete>();
  private hazardTimer = 7;
  private hazards: Hazard[] = [];

  constructor(private game: Game) {}

  bind() {
    this.unbind();
    const ev = this.game.world.events;
    this.unsubs.push(
      ev.on('hit', ({ victim }) => this.checkRage(victim)),
      ev.on('catch', ({ thrower }) => thrower && this.checkRage(thrower)),
      ev.on('roundStart', () => {
        this.hazards = [];
        this.hazardTimer = 8;
        for (const a of this.raged) this.calm(a);
        this.raged.clear();
      }),
    );
  }

  unbind() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.raged.clear();
    this.hazards = [];
  }

  private checkRage(a: Athlete) {
    if (!a.profile.boss || !a.active || a.hearts !== 1 || this.raged.has(a)) return;
    this.raged.add(a);
    const ai = a.controller instanceof AIController ? a.controller : null;
    if (ai) {
      ai.rage = 1;
      ai.params.reaction *= 0.8;
      ai.params.aggression = Math.min(1, ai.params.aggression + 0.25);
      ai.params.abilityUse = 1;
    }
    a.energy = 100;
    if (a.profile.ultimate) a.ult = 100;
    a.rig.material.u.uEnergyColor.value.set(0xff3a2a);
    const g = this.game;
    g.world.events.emit('announce', { text: `${a.name.toUpperCase()} ENRAGED`, sub: a.profile.ultimate ? 'Ultimate charged — be ready to dodge' : 'Faster. Angrier. Punish mistakes.', style: 'warn' });
    g.renderer.pulseVignette(0.5, 0xff3a2a);
    g.arena?.hype(1.2);
    g.audio.play('ultimateRise', { volume: 0.6 });
    const p = a.chestPos(new THREE.Vector3());
    g.vfx.ring(new THREE.Vector3(a.pos.x, 0.05, a.pos.z), 3, 0xff3a2a, 0.8, 0.15);
    g.vfx.flash(p, 2.5, 0xff3a2a, 0.3);
  }

  private calm(a: Athlete) {
    const ai = a.controller instanceof AIController ? a.controller : null;
    if (ai) ai.rage = 0;
  }

  update(dt: number) {
    const g = this.game;
    const m = g.world.match;
    if (!m || !m.playing) return;
    // enraged aura
    for (const a of this.raged) {
      if (!a.active) continue;
      a.rig.material.u.uEnergy.value = Math.max(a.rig.material.u.uEnergy.value, 0.35 + 0.15 * Math.sin(g.world.time.gameTime * 8));
      if (Math.random() < dt * 20) g.vfx.add.emit({ pos: new THREE.Vector3(a.pos.x, 0.2, a.pos.z), count: 1, dir: new THREE.Vector3(0, 1, 0), spread: 0.4, speed: [1, 3], life: [0.3, 0.6], size: [0.08, 0.02], color: 0xff6a3a, jitter: 0.4, shape: 1 });
    }
    if (!m.config.rules?.hazards) return;
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0) {
      this.hazardTimer = 7.5 + Math.random() * 3;
      const targets = g.world.athletes.filter((a) => a.active);
      const pick = g.player && g.player.active && Math.random() < 0.55 ? g.player : targets[Math.floor(Math.random() * targets.length)];
      if (pick) {
        const pos = new THREE.Vector3(pick.pos.x + (Math.random() - 0.5) * 1.5, 0.05, pick.pos.z + (Math.random() - 0.5) * 1.5);
        this.hazards.push({ pos, t: 0, fuse: 1.4, ringTimer: 0 });
        g.audio.play('chargeStart', { pos, volume: 1 });
      }
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const hz = this.hazards[i];
      hz.t += dt;
      hz.ringTimer -= dt;
      if (hz.ringTimer <= 0) {
        hz.ringTimer = 0.28;
        const k = hz.t / hz.fuse;
        g.vfx.ring(hz.pos, 2.4 * (1 - k * 0.5), 0xa78bfa, 0.3, 0.12 + k * 0.2, 0.6 + k * 0.4);
      }
      if (hz.t >= hz.fuse) {
        this.hazards.splice(i, 1);
        g.vfx.shockwave(hz.pos, 2.6, 0xa78bfa);
        g.renderer.shockwave(hz.pos, 1, 0.4);
        g.cam.addTrauma(0.25);
        g.audio.play('shockwave', { pos: hz.pos, volume: 0.8 });
        g.arena?.hype(0.6);
        for (const a of g.world.athletes) {
          if (!a.active || a.state === 'dodging' || a.state === 'ultimate') continue;
          const d = Math.hypot(a.pos.x - hz.pos.x, a.pos.z - hz.pos.z);
          if (d < 2.6) a.stagger(new THREE.Vector3(a.pos.x - hz.pos.x || 0.01, 0, a.pos.z - hz.pos.z), 1);
        }
      }
    }
  }
}
