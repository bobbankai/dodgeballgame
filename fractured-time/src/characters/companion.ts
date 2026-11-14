import * as THREE from 'three/webgpu';
import type { Game } from '@/game';
import type { EchoFigure } from './echo';
import { Afterimages } from '@/temporal/afterimages';

/**
 * The Echo as an ally (Chapter 5): he fights beside Ethan the way only he can, half out of this timeline. He keeps to Ethan's
 * side; when something hostile is near he blinks to its flank in a smear of amber afterimages, strikes (a real hit through the
 * combat system: damage, stagger, reactions), and blinks again or falls back. Enemies do not target him: he is out of phase.
 */
type Mode = 'follow' | 'strike' | 'recover';

export class Companion {
  private mode: Mode = 'follow';
  private t = 0;
  private cooldown = 2;
  private target: any = null;
  private hitDone = false;
  private ghosts: Afterimages;
  private vel = new THREE.Vector3();
  private readonly pos: THREE.Vector3;
  private yaw = 0;
  /** stand-in attacker for the combat system (enemies read its position and team) */
  private readonly self: any;
  enabled = true;

  constructor(private g: Game, readonly fig: EchoFigure) {
    this.pos = fig.root.position;
    this.ghosts = new Afterimages(g.scene, fig.root, 6, 0xffa040);
    this.self = { pos: this.pos, team: 'player', alive: true, name: 'The Echo', focusPoint: (o: THREE.Vector3) => o.copy(this.pos).setY(this.pos.y + 1.2) };
  }

  private blinkTo(to: THREE.Vector3): void {
    this.ghosts.spawn(this.fig.root, 0.7, 0.5);
    this.g.fx.pulse(this.pos.clone().setY(this.pos.y + 1), 'echo');
    this.pos.copy(to);
    this.g.sfx.play('dodge', { at: to, pitch: 1.25, volume: 0.6 });
    this.g.fx.pulse(to.clone().setY(to.y + 1), 'echo');
  }

  tick(dt: number): void {
    this.fig.update(dt);
    this.ghosts.step(dt);
    if (!this.enabled) return;
    this.t += dt;
    this.cooldown -= dt;
    const pl = this.g.player;
    const foes = (this.g.enemies as any[]).filter((e) => e.alive && !e.def?.id?.startsWith('boss') && e.pos.distanceTo(pl.pos) < 16);
    if (this.mode === 'follow') {
      // keep to Ethan's right, a step behind
      const f = pl.forward(new THREE.Vector3());
      const want = pl.pos.clone().add(new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(1.6)).add(f.clone().multiplyScalar(-0.8));
      const to = want.sub(this.pos).setY(0);
      const d = to.length();
      const speed = d > 6 ? 0 : d > 1.2 ? Math.min(5.5, d * 2.2) : 0;
      if (d > 6) this.blinkTo(pl.pos.clone().add(new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(1.6)));
      this.vel.lerp(to.normalize().multiplyScalar(speed), Math.min(1, dt * 6));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y = pl.pos.y;
      const sp = this.vel.length();
      if (sp > 0.3) this.yaw = Math.atan2(this.vel.x, this.vel.z);
      else this.yaw += (Math.atan2(f.x, f.z) - this.yaw) * Math.min(1, dt * 3);
      this.fig.play(sp > 3.2 ? 'run' : sp > 0.4 ? 'walk' : foes.length ? 'idle_combat' : 'idle', 0.2);
      if (foes.length && this.cooldown <= 0) {
        foes.sort((a, b) => a.pos.distanceTo(this.pos) - b.pos.distanceTo(this.pos));
        this.target = foes[0];
        const side = this.target.pos.clone().sub(pl.pos).setY(0).normalize();
        const flank = new THREE.Vector3(-side.z, 0, side.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        this.blinkTo(this.target.pos.clone().add(flank.multiplyScalar(0.95)).setY(this.target.pos.y));
        this.yaw = Math.atan2(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
        this.fig.play(Math.random() < 0.6 ? 'light1' : 'heavy1', 0.06);
        this.mode = 'strike';
        this.t = 0;
        this.hitDone = false;
      }
    } else if (this.mode === 'strike') {
      if (!this.hitDone && this.t > 0.32 && this.target?.alive) {
        this.hitDone = true;
        const dir = this.target.pos.clone().sub(this.pos).setY(0).normalize();
        const heavy = this.fig.current === 'heavy1';
        this.target.receiveHit({ attacker: this.self, damage: heavy ? 22 : 14, stagger: heavy ? 2 : 1, heavy, launch: 0, guardbreak: heavy,
          point: this.target.pos.clone().setY(this.target.pos.y + 1.2), dir, clip: this.fig.current });
        this.g.fx.hit(this.target.pos.clone().setY(this.target.pos.y + 1.2), dir, { heavy, blocked: false, parried: false });
        this.g.sfx.play(heavy ? 'hit_heavy' : 'hit_light', { at: this.target.pos });
      }
      if (this.t > 0.85) { this.mode = 'recover'; this.t = 0; }
    } else if (this.t > 0.35) {
      this.mode = 'follow';
      this.cooldown = 1.4 + Math.random() * 1.2;
    }
    this.fig.root.rotation.y = this.yaw;
  }

  dispose(): void {
    this.enabled = false;
    this.g.scene.remove(this.fig.root);
  }
}
