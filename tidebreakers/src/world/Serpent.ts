// The Weeping Maw: a sea serpent assembled from kit pieces (head, barnacled body plates, tail fin) that
// follow the head's wake. It circles the fight, rises with its lantern lure lit, slams its head down where
// Kai stands (telegraphed), and lies stunned on the rock for a few seconds: that is when it can be hurt.
// It spits parryable water at range, and in its second phase it slams twice and sends tide rings.
// Its health lives on an invisible proxy Fighter placed at the head, so combat, the HUD and the crew work
// on it like any other enemy.
import { Vector3, Quaternion } from '@babylonjs/core';
import type { InstancedMesh } from '@babylonjs/core';
import type { EnvKit, Sea } from './World';
import type { Game } from '../game/Game';
import type { Fighter } from '../game/Fighter';

type MawState = 'circle' | 'rise' | 'slam' | 'stunned' | 'recover' | 'sink' | 'gone' | 'idle';

export class Serpent {
  head: InstancedMesh;
  segs: InstancedMesh[] = [];
  tail: InstancedMesh;
  trail: Vector3[] = [];
  headPos = new Vector3();
  headDir = new Vector3(1, 0, 0);
  state: MawState = 'idle';
  stateT = 0;
  angle = 0;
  phase = 1;
  private nextAttack = 5;
  private spitT = 3;
  private slamTarget = new Vector3();
  private slamsLeft = 0;
  private stunHp = 0;
  private lureLight = -1;
  onSlam?: (at: Vector3) => void;

  constructor(kit: EnvKit, readonly game: Game, readonly sea: Sea | null, readonly center: Vector3, readonly radius: number, readonly proxy: Fighter, n = 16) {
    this.head = kit.instance('maw_head')!;
    for (let i = 0; i < n; i++) {
      const s = kit.instance('maw_seg')!;
      const k = 1 - (i / n) * 0.55;
      s.scaling.setAll(k * 1.1);
      this.segs.push(s);
    }
    this.tail = kit.instance('maw_tail')!;
    for (const m of [this.head, ...this.segs, this.tail]) game.r.addCaster(m);
    this.headPos.copyFrom(center.add(new Vector3(radius, -2, 0)));
    for (let i = 0; i < 400; i++) this.trail.push(this.headPos.clone());
    this.lureLight = game.r.globals.lights.length;
    game.r.globals.lights.push({ pos: this.headPos.clone(), radius: 10, color: [1.0, 0.92, 0.55], intensity: 2.5 });
    proxy.model.anchor.setEnabled(false);
    proxy.radius = 0.1;
    proxy.height = 2.4;
    proxy.maxPoise = 1e9;
    proxy.poise = 1e9;
    proxy.team = 'neutral';
    proxy.invuln = 1e9;
    this.setVisible(false);
  }

  setVisible(v: boolean): void { for (const m of [this.head, ...this.segs, this.tail]) m.setEnabled(v); }

  start(): void { this.setVisible(true); this.state = 'circle'; this.stateT = 0; }

  private seaY(x: number, z: number): number { return this.sea ? this.sea.heightAt(x, z, this.game.time) : 0; }

  private set(s: MawState): void { this.state = s; this.stateT = 0; }

  update(dt: number): void {
    if (this.state === 'idle' || this.state === 'gone') return;
    const g = this.game, p = g.player!;
    this.stateT += dt;
    const c = this.center;
    const speed = this.phase === 1 ? 0.32 : 0.45;
    const want = new Vector3();
    switch (this.state) {
      case 'circle': {
        this.angle += dt * speed;
        const r = this.radius + Math.sin(this.angle * 2.3) * 2;
        want.set(c.x + Math.cos(this.angle) * r, this.seaY(c.x, c.z) - 0.4 + Math.sin(g.time * 1.7) * 0.6, c.z + Math.sin(this.angle) * r);
        this.headPos = Vector3.Lerp(this.headPos, want, Math.min(1, dt * 3));
        this.spitT -= dt;
        if (this.spitT <= 0 && g.combatActive) { this.spit(); this.spitT = this.phase === 1 ? 4.5 : 3.0; }
        this.nextAttack -= dt;
        if (this.nextAttack <= 0 && g.combatActive) { this.slamsLeft = this.phase === 1 ? 1 : 2; this.set('rise'); }
        if (this.phase === 2 && Math.random() < dt * 0.12 && g.combatActive) g.ring(this.headPos.clone(), 6, 22, 12);
        break;
      }
      case 'rise': {
        // rear up at the rock's edge, lure blazing, looking at Kai
        const toP = p.pos.subtract(c); toP.y = 0;
        const edge = c.add(toP.normalize().scale(this.radius * 0.85));
        want.set(edge.x, c.y + 7.5, edge.z);
        this.headPos = Vector3.Lerp(this.headPos, want, Math.min(1, dt * 2.2));
        if (this.stateT > 1.4) {
          this.slamTarget.copyFrom(p.pos);
          g.hazard(this.slamTarget, 2.6, 1.0, 24, 'blast', 'enemy');
          g.sfx('roar', this.headPos, 0.9);
          this.set('slam');
        }
        break;
      }
      case 'slam': {
        const t = Math.min(1, this.stateT / 1.0);
        const e = t < 0.75 ? 0 : (t - 0.75) / 0.25;
        const hover = this.slamTarget.add(new Vector3(0, 7, 0)).add(this.headDir.scale(-2));
        this.headPos = Vector3.Lerp(Vector3.Lerp(this.headPos, hover, Math.min(1, dt * 4)), this.slamTarget.add(new Vector3(0, 0.6, 0)), e * e);
        if (this.stateT >= 1.0) {
          g.shake(0.9);
          g.vfx.splash(this.slamTarget, 40);
          g.vfx.dust(this.slamTarget, 16);
          this.onSlam?.(this.slamTarget);
          this.slamsLeft--;
          if (this.slamsLeft > 0) { this.set('rise'); break; }
          this.set('stunned');
          this.stunHp = this.proxy.hp;
          this.proxy.team = 'enemy';
          this.proxy.invuln = 0;
          this.proxy.radius = 1.6;
        }
        break;
      }
      case 'stunned': {
        this.headPos.y = this.slamTarget.y + 0.6 + Math.sin(this.stateT * 6) * 0.05;
        // stars over the head
        if (Math.random() < dt * 6) g.vfx.burst(this.headPos.add(new Vector3(0, 2.2, 0)), [2.5, 2.4, 1.2], 2, 1.5, 'star', 0.18, 0.6);
        const took = this.stunHp - this.proxy.hp;
        if (this.stateT > (this.phase === 1 ? 4.5 : 3.6) || took > this.proxy.maxHp * 0.22) {
          this.proxy.team = 'neutral';
          this.proxy.invuln = 1e9;
          this.proxy.radius = 0.1;
          g.sfx('roar', this.headPos, 0.7);
          g.ring(this.headPos.clone(), 7, 10, 10);
          this.set('recover');
        }
        break;
      }
      case 'recover': {
        want.set(c.x + Math.cos(this.angle) * this.radius, -1, c.z + Math.sin(this.angle) * this.radius);
        this.headPos = Vector3.Lerp(this.headPos, want, Math.min(1, dt * 1.5));
        if (this.stateT > 2.0) { this.nextAttack = this.phase === 1 ? 7 : 5; this.set('circle'); }
        break;
      }
      case 'sink': {
        const up = this.stateT < 1.6;
        want.set(this.headPos.x, up ? 9 : -12, this.headPos.z);
        this.headPos = Vector3.Lerp(this.headPos, want, Math.min(1, dt * (up ? 1.5 : 0.9)));
        if (this.stateT > 1.6 && this.stateT - dt <= 1.6) { g.sfx('splash', this.headPos, 1); g.vfx.splash(this.headPos.clone(), 60); }
        if (this.stateT > 6) { this.setVisible(false); this.set('gone'); }
        break;
      }
    }
    // body follows the head's wake
    const last = this.trail[0];
    if (Vector3.DistanceSquared(last, this.headPos) > 0.04) { this.trail.unshift(this.headPos.clone()); if (this.trail.length > 600) this.trail.pop(); }
    const lookAt = this.state === 'circle' || this.state === 'recover' ? this.trail[Math.min(6, this.trail.length - 1)] : p.pos;
    const hd = this.headPos.subtract(lookAt);
    if (this.state !== 'circle' && this.state !== 'recover') hd.scaleInPlace(-1);
    hd.y *= 0.35;
    if (hd.lengthSquared() > 1e-4) this.headDir = Vector3.Lerp(this.headDir, hd.normalize(), Math.min(1, dt * 6)).normalize();
    this.orient(this.head, this.headPos, this.headDir);
    let acc = 0;
    let idx = 0;
    let prev = this.headPos.clone();
    const spacing = 1.8;
    const pts: Vector3[] = [];
    for (let i = 1; i < this.trail.length && pts.length < this.segs.length + 1; i++) {
      acc += Vector3.Distance(this.trail[i], this.trail[i - 1]);
      if (acc >= spacing * (pts.length + 1)) pts.push(this.trail[i]);
    }
    while (pts.length < this.segs.length + 1) pts.push((pts[pts.length - 1] ?? prev).add(this.headDir.scale(-spacing)));
    for (const s of this.segs) {
      const q = pts[idx];
      // segments dip into the water in a travelling wave
      const wave = Math.sin(this.game.time * 2.4 - idx * 0.7) * 0.5;
      const pos = new Vector3(q.x, Math.min(q.y, this.headPos.y) * (this.state === 'circle' ? 1 : 0.6) + wave - idx * 0.05, q.z);
      const dir = prev.subtract(pos);
      this.orient(s, pos, dir.lengthSquared() > 1e-4 ? dir.normalize() : this.headDir);
      prev = pos;
      idx++;
    }
    const tp = pts[idx] ?? prev;
    this.orient(this.tail, new Vector3(tp.x, Math.min(tp.y, 0) - 0.3, tp.z), prev.subtract(tp).normalize());
    // the proxy sits on the head
    if (this.proxy.alive) {
      const ground = g.collision.groundAt(this.headPos.x, this.headPos.z, this.headPos.y + 1);
      this.proxy.pos.set(this.headPos.x, Math.max(ground, this.headPos.y - 1.2), this.headPos.z);
      this.proxy.vel.setAll(0);
    } else if ((this.state as MawState) !== 'sink' && (this.state as MawState) !== 'gone') {
      this.set('sink');
      g.sfx('roar', this.headPos, 1);
    }
    const L = g.r.globals.lights[this.lureLight];
    if (L) {
      L.pos.copyFrom(this.headPos.add(this.headDir.scale(4.4)).add(new Vector3(0, 2.3, 0)));
      const st = this.state as MawState;
      L.intensity = st === 'rise' ? 4.5 : st === 'gone' ? 0 : 2.2 + Math.sin(g.time * 3) * 0.4;
    }
  }

  /** Model forward is local -X (Blender +X); point it along `dir`. */
  private orient(m: InstancedMesh, pos: Vector3, dir: Vector3): void {
    m.position.copyFrom(pos);
    const yaw = Math.atan2(-dir.z, -dir.x);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    m.rotationQuaternion = Quaternion.FromEulerAngles(0, yaw + Math.PI, 0).multiply(Quaternion.FromEulerAngles(0, 0, -pitch));
  }

  private spit(): void {
    const g = this.game, p = g.player!;
    const mouth = this.headPos.add(this.headDir.scale(3)).add(new Vector3(0, 0.6, 0));
    const dir = p.center.subtract(mouth).normalize();
    g.projectiles.push({ pos: mouth, vel: dir.scale(17), def: { speed: 17, damage: 12, radius: 0.55, life: 3, vfx: 'water', knock: 5, parryable: true }, owner: this.proxy, life: 3, reflected: false });
    g.sfx('splash', mouth, 0.6);
    g.vfx.splash(mouth, 8);
  }
}
