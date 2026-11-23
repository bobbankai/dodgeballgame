// Kai's controls: camera-relative movement, the four-hit combo, launcher and charged heavy, air combo
// with a spike finisher, dodge with i-frames, guard/parry, two specials and the super, lock-on.
import { Vector3 } from '@babylonjs/core';
import type { Fighter } from './Fighter';
import type { Game } from './Game';
import type { Input } from '../core/Input';
import { KAI, KAI_COMBO } from '../combat/Attacks';

export class PlayerController {
  locked: Fighter | null = null;
  private heavyHeld = 0;
  private charging = false;
  enabled = true;
  specialsUnlocked = { burst: true, dash: true, super: true };

  constructor(readonly f: Fighter, readonly game: Game, readonly input: Input) {
    game.cam.follow = () => f.pos;
    game.cam.lock = () => (this.locked && this.locked.alive ? this.locked.center : null);
  }

  private moveDir(): Vector3 {
    const m = this.input.move;
    const yaw = this.game.cam.forwardYaw;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    return fwd.scale(m.y).add(right.scale(m.x));
  }

  update(dt: number): void {
    const f = this.f, inp = this.input, g = this.game;
    const it = f.intent;
    if (!this.enabled || f.state === 'cine') {
      it.move.setAll(0);
      it.guard = false;
      it.face = undefined;
      return;
    }
    const dir = this.moveDir();
    it.move.copyFrom(dir);
    it.run = true;
    it.guard = inp.isHeld('guard');
    it.face = undefined;
    // lock-on
    if (inp.consume('lock')) {
      this.locked = this.locked ? null : this.pickTarget();
    }
    if (this.locked && !this.locked.alive) this.locked = this.pickTarget();
    f.target = this.locked ?? this.softTarget();
    if (this.locked && (f.state === 'idle' || f.state === 'guard')) it.face = Math.atan2(this.locked.pos.x - f.pos.x, this.locked.pos.z - f.pos.z);
    // heavy charge
    if (this.charging) {
      it.move.setAll(0);
      this.heavyHeld += dt;
      g.vfx.aura(f.pos, [0.6, 1.8, 2.4], 2);
      if (!inp.isHeld('heavy') || this.heavyHeld > 2.2) {
        this.charging = false;
        f.setState('idle');
        f.startAttack(this.heavyHeld > 0.75 ? KAI.charged : KAI.gale_hammer);
        if (this.heavyHeld > 0.75) { g.shake(0.4); g.speedLines(0.35); }
      }
      return;
    }
    // defensive actions first (they can cancel attack recovery)
    if (inp.consume('dodge', 0.15)) { if (f.dodge(dir)) { inp.clearBuffer(); return; } }
    if (inp.consume('jump', 0.15)) { f.jump(); }
    const canChain = f.state === 'attack' && f.attack && f.attack.combo !== undefined && f.attackT >= f.attack.combo;
    const free = f.canAct() || canChain;
    const air = !f.onGround && (f.state === 'air' || (f.state === 'attack' && f.attack?.air));
    if (inp.consume('super', 0.2) && this.specialsUnlocked.super && g.storm >= 100 && f.onGround && (free || f.state === 'hit')) {
      f.setState('idle');
      f.startAttack(KAI.hurricane);
      return;
    }
    if (inp.peek('special1', 0.2) && this.specialsUnlocked.burst && free && f.onGround) {
      if (g.storm >= (KAI.gale_burst.cost ?? 0)) { inp.consume('special1'); f.setState('idle'); f.startAttack(KAI.gale_burst); return; }
      inp.consume('special1'); g.sfx('denied');
    }
    if (inp.peek('special2', 0.2) && this.specialsUnlocked.dash && free && f.onGround) {
      if (g.storm >= (KAI.tempest_dash.cost ?? 0)) { inp.consume('special2'); f.setState('idle'); f.lungeDir = dir.lengthSquared() > 0.01 ? dir.normalize() : f.forward; f.startAttack(KAI.tempest_dash); return; }
      inp.consume('special2'); g.sfx('denied');
    }
    if (air && inp.consume('heavy', 0.2) && f.state === 'air') { f.startAttack(KAI.air_attack); f.vel.y = -4; return; }
    if (air && inp.consume('light', 0.25) && (f.state === 'air' || canChain) && f.airHits < 3) {
      f.airHits++;
      f.vel.y = Math.max(f.vel.y, 3.5);
      f.setState('air');
      f.startAttack(KAI.air_jab);
      return;
    }
    if (!f.onGround) return;
    if (inp.peek('heavy', 0.2) && free) {
      inp.consume('heavy');
      // L, L, H -> launcher immediately; otherwise begin charging (tap releases quickly)
      if (canChain && f.comboStep >= 2) { f.setState('idle'); f.startAttack(KAI.gale_hammer); f.comboStep = 0; return; }
      this.charging = true;
      this.heavyHeld = 0;
      f.setState('attack');
      f.attack = null;
      f.play('charge', true, 0.08);
      g.sfx('charge', f.pos, 0.6);
      return;
    }
    if (inp.peek('light', 0.25) && free) {
      inp.consume('light');
      if (!canChain) f.comboStep = 0;
      const id = KAI_COMBO[f.comboStep % KAI_COMBO.length];
      f.setState('idle');
      f.startAttack(KAI[id]);
      f.comboStep = (f.comboStep + 1) % KAI_COMBO.length;
      return;
    }
    if (f.state === 'idle' && f.stateT > 0.5) f.comboStep = 0;
  }

  /** Nearest enemy in front of the camera. */
  pickTarget(): Fighter | null {
    const f = this.f;
    let best: Fighter | null = null, bs = 1e9;
    const yaw = this.game.cam.forwardYaw;
    const fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    for (const e of this.game.enemies()) {
      const d = e.pos.subtract(f.pos);
      const dist = d.length();
      if (dist > 18) continue;
      const facing = Vector3.Dot(d.normalize(), fwd);
      const s = dist * (1.6 - facing);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  /** Soft target: the enemy most in front of Kai within reach (attacks snap toward it). */
  softTarget(): Fighter | null {
    const f = this.f;
    let best: Fighter | null = null, bs = 1e9;
    const dirIn = this.moveDir();
    const fwd = dirIn.lengthSquared() > 0.01 ? dirIn.normalize() : f.forward;
    for (const e of this.game.enemies()) {
      const d = e.pos.subtract(f.pos);
      const dist = d.length();
      if (dist > 4.5) continue;
      const facing = Vector3.Dot(d.normalize(), fwd);
      if (facing < 0.2) continue;
      const s = dist * (1.5 - facing);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
}
