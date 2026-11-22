import { Color3, Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import { SK, Sprites } from '../render/Sprites';
import { GpuParticles, PK } from '../render/GpuParticles';
import { Trails } from '../render/Trails';
import { Vfx, VK, type VfxPalette } from '../render/Vfx';
import { Fluid } from '../render/Fluid';
import { MK, type MarkStamp } from '../render/Marks';
import type { WebGPUEngine } from '@babylonjs/core';
import type { CameraRig } from './CameraRig';
import type { CombatFx, HitResult, Projectile } from './Combat';
import type { Fighter } from './Fighter';
import type { Move } from './Moves';
import type { Audio } from '../audio/Audio';

type RGB = [number, number, number];

/** Linear colours of each technique palette (matching vb_vfx paletteFor). */
export const PAL: { body: RGB; core: RGB; edge: RGB }[] = [
  { body: [1.0, 0.62, 0.16], core: [1.0, 0.95, 0.8], edge: [0.85, 0.22, 0.04] },
  { body: [0.95, 0.9, 0.82], core: [1, 1, 0.98], edge: [0.85, 0.12, 0.1] },
  { body: [0.3, 0.8, 1.0], core: [0.9, 1, 1], edge: [0.12, 0.25, 0.85] },
  { body: [1.0, 0.2, 0.08], core: [1.0, 0.9, 0.7], edge: [0.35, 0.85, 0.3] },
  { body: [0.58, 0.22, 1.0], core: [0.95, 0.85, 1], edge: [0.2, 0.02, 0.4] },
  { body: [0.08, 0, 0.02], core: [0.02, 0, 0.01], edge: [1, 0.05, 0.12] },
  { body: [0.18, 0.05, 0.22], core: [0.6, 0.35, 0.7], edge: [0.5, 0.1, 0.3] },
];

/** How each palette's slashes are drawn (vfx_blade styles: 0 energy, 1 ink, 2 paper, 3 water). */
const SLASH_STYLE: Record<number, number> = { 0: 0, 1: 2, 2: 3, 3: 0, 4: 0, 5: 0, 6: 1 };
/** Black Spark as light: crimson body, a pale core, a near-black edge. */
const SPARK_LIGHT: VfxPalette = { body: [1, 0.05, 0.12], core: [1, 0.75, 0.75], edge: [0.35, 0, 0.03] };

interface Flash {
  slot: number;
  pos: Vector3;
  color: Color3;
  intensity: number;
  range: number;
  life: number;
  age: number;
}

/**
 * Everything a fight looks and sounds like: hit sparks, starbursts, shockwaves, onomatopoeia,
 * impact frames, hitstop shakes, Black Spark lightning, slash trails, technique visuals, the
 * cursed-energy light flashes, and the camera's reactions.
 */
export class Effects implements CombatFx {
  readonly sprites: Sprites;
  readonly particles: GpuParticles;
  readonly trails: Trails;
  readonly vfx: Vfx;
  /** ink in water over the screen */
  readonly fluid: Fluid;
  private flashes: Flash[] = [];
  private projVisuals = new Map<number, number[]>();
  private projVfx = new Map<number, number[]>();
  /** seconds each fighter has been fighting (sweat builds up) */
  private fightTime = new Map<Fighter, number>();
  private impactT = 0;
  private flashT = 0;
  private desatT = 0;
  private radialT = 0;
  private speedT = 0;
  private shockIdx = 0;
  private shocks: { pos: Vector3; t: number; strength: number }[] = [];
  private activeTrails = new Map<Fighter, ReturnType<Trails['start']>>();
  /** distance each fighter has walked since their last footprint, and which foot is next */
  private stride = new Map<Fighter, { x: number; z: number; d: number; side: number }>();
  /** the player (screen effects are stronger for their hits) */
  player: Fighter | null = null;
  onHitHud: ((attacker: Fighter, target: Fighter, dmg: number, res: HitResult, spark: boolean) => void) | null = null;
  onKo: ((f: Fighter, by: Fighter | null) => void) | null = null;
  onVowFx: ((f: Fighter) => void) | null = null;

  constructor(private r: Renderer, private cam: CameraRig, private audio: Audio) {
    this.sprites = new Sprites(r.scene);
    this.particles = new GpuParticles(r.engine, r.scene);
    this.trails = new Trails(r.scene);
    this.vfx = new Vfx(r);
    this.fluid = new Fluid(r.engine as unknown as WebGPUEngine, r.scene);
    r.post.fluid = this.fluid;
  }

  /** A world position on screen (post-chain uv: x right, y up). */
  project(p: Vector3): { x: number; y: number } {
    return this.screenPos(p);
  }

  /** Leave a scar on the arena floor (src/render/Marks.ts), if this stage keeps them. */
  mark(s: MarkStamp): void {
    this.r.mats.marks?.stamp(s);
  }

  /** Ink thrown on the floor under a blow, flung along its direction. */
  private splatter(at: Vector3, dir: Vector3, size: number, strength = 1): void {
    this.mark({ kind: MK.splatter, x: at.x + dir.x * 0.4, z: at.z + dir.z * 0.4, radius: size, angle: Math.atan2(dir.z, dir.x), strength });
  }

  /** Pour ink into the screen's water at a world position (a burst of splats outward). */
  inkBurst(at: Vector3, color: RGB, strength = 1, count = 6): void {
    const sp = this.screenPos(at);
    if (sp.x < -0.2 || sp.x > 1.2 || sp.y < -0.2 || sp.y > 1.2) return;
    this.fluid.burst(sp.x, sp.y, color, count, 0.5 * strength, 0.05 + 0.04 * strength);
  }

  private pal(f: Fighter) {
    return PAL[f.kit.palette] ?? PAL[0];
  }

  private vpal(f: Fighter): VfxPalette {
    const p = this.pal(f);
    return { body: p.body, core: p.core, edge: p.edge };
  }

  /** A crescent of the strike's path round the attacker (heavy blows, finishers). */
  private slashArc(a: Fighter, toward: Vector3, scale: number, life: number, intensity = 1.4): void {
    const fwd = new Vector3(toward.x - a.pos.x, 0, toward.z - a.pos.z);
    if (fwd.lengthSquared() < 1e-4) fwd.set(0, 0, 1);
    fwd.normalize();
    const style = SLASH_STYLE[a.kit.palette] ?? 0;
    this.vfx.spawn({
      kind: VK.slash, pos: a.ch.bonePos('chest'), dir: fwd, roll: (Math.random() - 0.5) * 1.1, scale, life,
      color: this.vpal(a), intensity, p: [style, 0.85, 0.6, 0.22],
    });
  }

  private dustRing(at: Vector3, radius: number, life = 0.7): void {
    this.vfx.spawn({ kind: VK.groundRing, pos: new Vector3(at.x, 0.03, at.z), scale: radius, life, color: { body: [0.6, 0.55, 0.5], core: [1, 1, 1], edge: [0.4, 0.38, 0.36] }, p: [0.08, 0, 0, 0], q: [1, 0, 0, 0] });
  }

  private puff(at: Vector3, size: number, life: number, dark = 0.15): void {
    this.vfx.spawn({ kind: VK.smoke, pos: at, scale: size, grow: 1.6, life, color: { body: [0.6, 0.58, 0.55], core: [1, 1, 1], edge: [0.3, 0.3, 0.3] }, p: [dark, 0, 0, 0] });
  }

  private screenPos(p: Vector3): { x: number; y: number } {
    const c = this.r.camera;
    const vp = c.getViewMatrix().multiply(c.getProjectionMatrix());
    const v = Vector3.TransformCoordinates(p, vp);
    return { x: v.x * 0.5 + 0.5, y: v.y * 0.5 + 0.5 };
  }

  /** A short-lived coloured point light (cursed energy lighting the scene). */
  light(pos: Vector3, color: RGB, intensity: number, range: number, life: number): void {
    const used = new Set(this.flashes.map((f) => f.slot));
    let slot = [1, 2, 3].find((s) => !used.has(s));
    if (slot === undefined) {
      const oldest = this.flashes.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
      slot = oldest.slot;
      this.flashes = this.flashes.filter((f) => f !== oldest);
    }
    this.flashes.push({ slot, pos: pos.clone(), color: new Color3(...color), intensity, range, life, age: 0 });
  }

  shockwave(pos: Vector3, strength: number): void {
    this.shocks.push({ pos: pos.clone(), t: 0, strength });
    if (this.shocks.length > 4) this.shocks.shift();
  }

  impactFrame(mode: number, dur = 0.09): void {
    const s = this.r.post.settings;
    s.impactMode = mode;
    this.impactT = dur;
  }

  // --- CombatFx --------------------------------------------------------------------------------------

  hit(a: Fighter, t: Fighter, m: Move, at: Vector3, dmg: number, res: HitResult, spark: boolean, marked: boolean): void {
    const pal = spark ? PAL[5] : this.pal(a);
    const dir = t.pos.subtract(a.pos).normalize();
    const big = dmg > 60 || !!m.heavy || spark;
    const mine = a === this.player || t === this.player;
    if (res === 'block' || res === 'perfect') {
      const c: RGB = res === 'perfect' ? [1, 1, 1] : [0.7, 0.8, 1];
      this.sprites.spawn({ kind: SK.flare, pos: at, size: res === 'perfect' ? 1.8 : 0.9, color: c, intensity: 2, life: 0.18, rot: Math.random() * 3 });
      this.sprites.spawn({ kind: SK.ring, pos: at, size: 1.2, color: c, intensity: 1.5, life: 0.25 });
      this.particles.burst({ kind: PK.spark, pos: at, count: 14, speed: 7, spread: 0.6, dir: dir.scale(-1), color: [0.8, 0.9, 1, 1], size: [0.03, 0.06], life: [0.15, 0.3] });
      this.audio.sfx(res === 'perfect' ? 'parry' : 'block', at);
      this.cam.addShake(0.15);
      if (res === 'perfect') {
        this.impactFrame(2, 0.06);
        this.flashT = 0.06;
        this.r.post.settings.flashColor.set(0.9, 0.95, 1);
      }
      this.onHitHud?.(a, t, dmg, res, false);
      return;
    }
    // light
    this.light(at, pal.body, big ? 6 : 3, big ? 5 : 3, big ? 0.35 : 0.18);
    // starburst + flare + sparks
    this.sprites.spawn({ kind: SK.starburst, pos: at, size: big ? 1.6 : 0.8, color: pal.body, intensity: 2.2, life: big ? 0.28 : 0.16, rot: Math.random() * 6 });
    this.sprites.spawn({ kind: SK.flare, pos: at, size: big ? 2.6 : 1.3, color: pal.core, intensity: 2.5, life: 0.16, rot: Math.random() * 3 });
    this.particles.burst({ kind: PK.spark, pos: at, count: big ? 48 : 20, speed: big ? 14 : 9, spread: 0.55, dir, color: [...pal.body, 1] as [number, number, number, number], size: [0.03, 0.07], life: [0.15, 0.45], drag: 2.5 });
    if (big) {
      // the blow's path and the air it pushes
      this.slashArc(a, t.pos, spark ? 1.5 : 1.25, spark ? 0.32 : 0.26);
      this.vfx.spawn({ kind: VK.shockDome, pos: at, scale: 0.25, grow: spark ? 5 : 4, life: 0.32, color: spark ? SPARK_LIGHT : this.vpal(a), intensity: 1.2, p: [4, 0, 0.8, 0] });
      if (at.y < 1.4) this.dustRing(at, 1.6, 0.6);
      this.sprites.spawn({ kind: SK.ring, pos: at, size: 3.5, color: pal.body, intensity: 2, life: 0.4 });
      this.particles.burst({ kind: PK.ember, pos: at, count: 30, speed: 4, spread: 1, color: [...pal.body, 1] as [number, number, number, number], size: [0.05, 0.1], life: [0.4, 1.0] });
      this.shockwave(at, spark ? 1.4 : 0.8);
      // manga sound effect
      this.sprites.spawn({ kind: SK.glyph, pos: at.add(new Vector3(0, 0.8, 0)).add(dir.scale(-0.5)), size: spark ? 2.2 : 1.4, color: pal.edge, life: 0.6, seed: Math.floor(Math.random() * 20), rot: (Math.random() - 0.5) * 0.4 });
    }
    // the floor remembers: ink thrown along the blow, the target's heels dragged back
    if (big || Math.random() < 0.3) this.splatter(t.pos, dir, big ? 0.32 + Math.random() * 0.12 : 0.16, big ? 1 : 0.7);
    if (big) this.mark({ kind: MK.skid, x: t.pos.x - dir.x * 0.2, z: t.pos.z - dir.z * 0.2, angle: Math.atan2(dir.z, dir.x), len: 0.9 + dmg / 80, width: 0.35, strength: 0.8 });
    if (marked) {
      // the seal tolls: a ring of gold and a second ripple
      this.sprites.spawn({ kind: SK.seal, pos: at, size: 2.4, color: PAL[0].body, intensity: 2, life: 0.6 });
      this.sprites.spawn({ kind: SK.ring, pos: at, size: 5, color: PAL[0].core, intensity: 2, life: 0.5 });
      this.audio.sfx('toll', at);
    }
    if (m.mark) {
      const follow = () => t.alive || t.state !== 'dead' ? t.ch.bonePos('chest') : null;
      this.sprites.spawn({ kind: SK.seal, pos: at, size: 0.9, color: this.pal(a).body, intensity: 1.2, life: 2.5, follow });
    }
    if (spark) {
      // Black Spark: black lightning, a red-black impact frame, a long hitstop and a camera punch
      for (let i = 0; i < 6; i++) {
        const d = new Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().scale(1.2 + Math.random() * 1.5);
        this.sprites.spawn({ kind: SK.bolt, pos: at, size: 0.5, color: [0, 0, 0], intensity: 2, life: 0.35, mode: 2, dir: d, seed: Math.random() });
      }
      // black lightning: forked bolts, black in the core, red round it
      for (let i = 0; i < 4; i++) {
        const d = new Vector3(Math.random() - 0.5, Math.random() * 0.8 - 0.2, Math.random() - 0.5).normalize();
        this.vfx.spawn({ kind: VK.bolt, pos: at, dir: d, scale: new Vector3(0.7, 1, 1.6 + Math.random() * 1.4), life: 0.4, color: PAL[5], p: [1, 0.8, 0.8, 0.16], seed: Math.random() });
      }
      this.vfx.spawn({ kind: VK.crater, pos: new Vector3(at.x, 0.03, at.z), scale: 1.4, life: 4, color: SPARK_LIGHT });
      this.mark({ kind: MK.crater, x: t.pos.x, z: t.pos.z, radius: 1.5, strength: 1, palette: 5 });
      this.mark({ kind: MK.splatter, x: t.pos.x + dir.x, z: t.pos.z + dir.z, radius: 0.45, angle: Math.atan2(dir.z, dir.x), strength: 1 });
      // black lightning bleeds red ink across the screen
      this.inkBurst(at, [0.45, 0.0, 0.03], 1.2, 7);
      this.impactFrame(3, 0.14);
      this.desatT = 0.6;
      this.radialT = 0.4;
      this.r.post.settings.radialCenter.set(this.screenPos(at).x, this.screenPos(at).y);
      this.cam.zoomPunch(1);
      this.audio.sfx('blackspark', at);
    } else if (big && mine) {
      this.impactFrame(Math.random() < 0.5 ? 1 : 2, 0.07);
      this.cam.zoomPunch(0.5);
    }
    const sp = this.screenPos(at);
    this.r.post.settings.fxCenter.set(sp.x, sp.y);
    this.cam.addShake(Math.min(1, 0.12 + dmg / 140) * (mine ? 1 : 0.6));
    t.ch.look.flash.set(1, 1, 1, big ? 0.85 : 0.6);
    t.ch.look.squash.set(1.06, 0.92, 1.06, 0);
    this.audio.sfx(spark ? 'heavyhit' : big ? 'heavyhit' : 'hit', at, Math.min(1, dmg / 60));
    this.onHitHud?.(a, t, dmg, res, spark);
  }

  technique(f: Fighter, m: Move, at: Vector3, dir: Vector3): void {
    const pal = this.pal(f);
    const kind = m.area?.kind ?? m.projectile?.kind ?? m.buff?.kind ?? '';
    this.light(at.add(new Vector3(0, 1, 0)), pal.body, 5, 6, 0.5);
    this.audio.sfx(m.sfx ?? 'cast', at);
    if (m.showcase) {
      // the technique's energy wraps the caster
      this.vfx.spawn({ kind: VK.aura, pos: f.pos.add(new Vector3(0, 0.95, 0)), scale: new Vector3(0.55, 1.05, 0.55), life: 1.2, color: this.vpal(f), intensity: 1.2, p: [1, 1.3, 0, 0], follow: () => (f.alive ? f.pos.add(new Vector3(0, 0.95, 0)) : null) });
      this.speedT = 0.5;
      this.cam.zoomPunch(0.6);
      const sp = this.screenPos(f.ch.bonePos('chest'));
      this.r.post.settings.fxCenter.set(sp.x, sp.y);
    }
    if (m.area) {
      // the caster's circle under them as the technique is shaped
      this.vfx.spawn({ kind: VK.seal, pos: new Vector3(f.pos.x, 0.04, f.pos.z), scale: 1.3, life: 0.9, color: this.vpal(f), intensity: 1.1, p: [f.kit.palette === 6 ? 5 : f.kit.palette, 2, 0.8, 0] });
      this.mark({ kind: MK.seal, x: f.pos.x, z: f.pos.z, radius: 1.2, angle: Math.random() * 6.28, strength: 0.6, palette: f.kit.palette });
    }
    if (m.area?.at === 'target' && m.area.delay) {
      // a warning sign on the floor where it will land
      this.sprites.spawn({ kind: kind === 'gravity' ? SK.gravity : SK.seal, pos: at, size: m.area.radius * 2, color: pal.body, intensity: 1, life: m.area.delay + 0.2, mode: 1 });
    }
    if (kind === 'slow-field') {
      this.sprites.spawn({ kind: SK.ripple, pos: f.pos, size: 12, color: pal.body, intensity: 1.2, life: 5, mode: 1 });
      this.vfx.spawn({ kind: VK.seal, pos: new Vector3(f.pos.x, 0.04, f.pos.z), scale: 6, life: 5, color: this.vpal(f), intensity: 0.9, p: [f.kit.palette, 0.4, 0.15, 0] });
      this.r.post.settings.heatHaze = 0.4;
      this.radialT = 0.3;
    }
    if (kind === 'pull') {
      this.sprites.spawn({ kind: SK.gravity, pos: f.pos.add(dir.scale(3)).add(new Vector3(0, 1.1, 0)), size: 4, color: pal.body, intensity: 1.5, life: 0.6 });
      this.vfx.spawn({ kind: VK.portal, pos: f.pos.add(dir.scale(3)).add(new Vector3(0, 1.1, 0)), scale: 2.2, life: 0.8, color: this.vpal(f), billboard: 1, p: [4, 0.5, 0, 0] });
    }
    void dir;
  }

  areaFire(owner: Fighter, kind: string, at: Vector3, radius: number): void {
    const pal = this.pal(owner);
    const c4 = [...pal.body, 1] as [number, number, number, number];
    const ground = new Vector3(at.x, 0.05, at.z);
    this.sprites.spawn({ kind: SK.ring, pos: ground, size: radius * 2.4, color: pal.body, intensity: 2.2, life: 0.5, mode: 1 });
    this.sprites.spawn({ kind: SK.flare, pos: at.add(new Vector3(0, 1, 0)), size: radius * 1.4, color: pal.core, intensity: 2, life: 0.25 });
    this.particles.burst({ kind: PK.dust, pos: ground, count: 40, speed: radius * 2.5, spread: 1, up: 2, color: c4, size: [0.04, 0.08], life: [0.3, 0.8] });
    this.sprites.spawn({ kind: SK.dust, pos: ground, size: radius * 2.2, color: [0.6, 0.55, 0.5], intensity: 0.9, life: 0.7, mode: 1 });
    this.light(at.add(new Vector3(0, 1, 0)), pal.body, 7, radius * 2.5, 0.45);
    this.shockwave(at, Math.min(1.2, radius / 3));
    const vp = this.vpal(owner);
    this.vfx.spawn({ kind: VK.groundRing, pos: ground, scale: radius * 1.25, life: 0.6, color: vp, intensity: 1.4, p: [0.06, 0, 0.4, 0] });
    if (radius > 2) this.vfx.spawn({ kind: VK.crater, pos: new Vector3(at.x, 0.03, at.z), scale: radius * 0.7, life: 5, color: vp });
    // the floor remembers it: a crater for the big ones, debris thrown round every blast
    if (radius > 1.5) this.mark({ kind: MK.crater, x: at.x, z: at.z, radius: Math.min(3.5, radius * 0.6), strength: Math.min(1, radius / 3), palette: owner.kit.palette });
    this.mark({ kind: MK.scatter, x: at.x, z: at.z, radius: radius * 1.3, strength: 0.8 });
    switch (kind) {
      case 'fire':
      case 'firering':
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + Math.random();
          const rr = kind === 'firering' ? radius * 0.8 : radius * Math.random() * 0.6;
          this.mark({ kind: MK.scorch, x: at.x + Math.cos(a) * rr, z: at.z + Math.sin(a) * rr, radius: 0.8 + Math.random() * 0.7, strength: 1, palette: owner.kit.palette });
        }
        break;
      case 'tears':
      case 'rainspike':
      case 'wail':
        for (let i = 0; i < 3; i++) {
          this.mark({ kind: MK.splatter, x: at.x + (Math.random() - 0.5) * radius, z: at.z + (Math.random() - 0.5) * radius, radius: 0.35 + Math.random() * 0.3, angle: Math.random() * 6.28, strength: 0.9 });
        }
        break;
      case 'blade':
      case 'umbrella':
        for (let i = 0; i < 2; i++) {
          this.mark({ kind: MK.slash, x: at.x, z: at.z, angle: Math.random() * 6.28, len: radius * 2.2, width: 0.08, extra: (Math.random() - 0.5) * 2, strength: 1, palette: owner.kit.palette });
        }
        break;
      case 'moonfall':
      case 'toll':
      case 'requiem':
        this.mark({ kind: MK.seal, x: at.x, z: at.z, radius: radius * 0.9, angle: Math.random() * 6.28, strength: 0.8, palette: owner.kit.palette });
        break;
      default:
        break;
    }
    this.cam.addShake(Math.min(0.9, radius * 0.15));
    switch (kind) {
      case 'toll':
      case 'requiem':
        this.sprites.spawn({ kind: SK.seal, pos: ground, size: radius * 2, color: pal.body, intensity: 2, life: 0.9, mode: 1 });
        // the bell itself, rung, and its sound as rings of gold
        this.vfx.spawn({ kind: VK.bell, pos: ground, scale: new Vector3(Math.min(radius * 0.4, 1.6), Math.min(radius * 0.45, 1.8), Math.min(radius * 0.4, 1.6)), life: kind === 'requiem' ? 2 : 1.3, color: vp, intensity: 0.8, p: [1, 1, 0, 0] });
        this.vfx.spawn({ kind: VK.shockDome, pos: at.add(new Vector3(0, 0.6, 0)), scale: radius * 0.25, grow: 4, life: 0.9, color: vp, intensity: 1, p: [6, 0, 0.6, 0], q: [2, 0, 0, 0] });
        this.vfx.spawn({ kind: VK.seal, pos: new Vector3(at.x, 0.04, at.z), scale: radius, life: 1.4, color: vp, intensity: 1.2, p: [0, 3, 0.5, 0] });
        this.particles.burst({ kind: PK.dust, pos: at.add(new Vector3(0, 0.5, 0)), count: 80, speed: 3, spread: 1, up: 3, color: [1, 0.8, 0.3, 1], size: [0.04, 0.09], life: [0.6, 1.6] });
        break;
      case 'fire':
      case 'firering':
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const p = kind === 'firering' ? at.add(new Vector3(Math.cos(a) * radius * 0.8, 0, Math.sin(a) * radius * 0.8)) : at.add(new Vector3((Math.random() - 0.5) * radius, 0, (Math.random() - 0.5) * radius));
          this.sprites.spawn({ kind: SK.fire, pos: p.add(new Vector3(0, 0.9, 0)), size: 1.8 + Math.random(), color: pal.body, intensity: 2, life: 0.9, seed: Math.random(), mode: 0 });
        }
        this.particles.burst({ kind: PK.ember, pos: at, count: 90, speed: 4, spread: 1, up: 4, color: [1, 0.4, 0.1, 1], size: [0.05, 0.1], life: [0.6, 1.5], jitter: radius });
        if (kind === 'fire') {
          this.vfx.spawn({ kind: VK.firenado, pos: ground, scale: new Vector3(radius * 0.4, radius * 1.3, radius * 0.4), life: 1.5, color: vp, intensity: 1.2 });
        }
        for (let i = 0; i < (kind === 'firering' ? 8 : 4); i++) {
          const a = (i / (kind === 'firering' ? 8 : 4)) * Math.PI * 2 + Math.random() * 0.3;
          const r = kind === 'firering' ? radius * 0.85 : radius * (0.3 + Math.random() * 0.4);
          this.vfx.spawn({ kind: VK.flame, pos: new Vector3(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r), scale: new Vector3(0.45, 1.6 + Math.random() * 0.8, 0.45), life: 1.1 + Math.random() * 0.4, color: vp, intensity: 1.2, p: [owner.kit.palette === 6 ? 1 : 0, 1, 1.4, 0.6], delay: i * 0.03 });
        }
        break;
      case 'ripple':
        this.sprites.spawn({ kind: SK.ripple, pos: ground, size: radius * 2.6, color: pal.body, intensity: 1.6, life: 0.8, mode: 1 });
        this.vfx.spawn({ kind: VK.groundRing, pos: new Vector3(at.x, 0.04, at.z), scale: radius * 1.4, life: 1.0, color: vp, p: [0.05, 0, 0, 0], q: [2, 0, 0, 0] });
        this.vfx.spawn({ kind: VK.splash, pos: ground, scale: new Vector3(radius * 0.35, radius * 0.45, radius * 0.35), life: 0.9, color: vp, flare: 1.1 });
        break;
      case 'moonfall':
        this.sprites.spawn({ kind: SK.moon, pos: at.add(new Vector3(0, 1.5, 0)), size: radius * 2.5, color: pal.core, intensity: 2.5, life: 0.5 });
        this.vfx.spawn({ kind: VK.column, pos: ground, scale: new Vector3(radius * 0.45, 9, radius * 0.45), life: 1.1, color: vp, intensity: 1.3 });
        break;
      case 'gravity':
        this.sprites.spawn({ kind: SK.gravity, pos: ground, size: radius * 2.2, color: pal.body, intensity: 1.6, life: 0.6, mode: 1 });
        this.vfx.spawn({ kind: VK.gravity, pos: at.add(new Vector3(0, 1.2, 0)), scale: Math.max(0.5, radius * 0.3), life: 1.0, color: vp, intensity: 1.2 });
        this.dustRing(at, radius * 1.2, 0.9);
        this.particles.burst({ kind: PK.debris, pos: ground, count: 24, speed: 3, spread: 1, up: 1, color: [0.25, 0.2, 0.3, 1], size: [0.06, 0.14], life: [0.6, 1.2] });
        break;
      case 'blade':
      case 'umbrella':
        for (let i = 0; i < 3; i++) {
          const d = new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5);
          this.vfx.spawn({ kind: VK.slash, pos: at.add(new Vector3(0, 0.9 + i * 0.25, 0)), dir: d, roll: (Math.random() - 0.5) * 1.4, scale: radius * 0.7, life: 0.35, color: vp, intensity: 1.3, p: [kind === 'umbrella' ? 3 : 2, 0.85, 0.5, 0.25], delay: i * 0.06 });
        }
        this.sprites.spawn({ kind: SK.slash, pos: at.add(new Vector3(0, 1.0, 0)), size: radius * 2, color: pal.body, intensity: 2, life: 0.25, mode: 3, dir: new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5), rot: Math.random() * 6 });
        this.particles.burst({ kind: PK.paper, pos: at.add(new Vector3(0, 1, 0)), count: 20, speed: 5, spread: 1, color: [0.95, 0.92, 0.85, 1], size: [0.05, 0.09], life: [0.8, 1.6] });
        break;
      case 'tears':
      case 'rainspike':
        for (let i = 0; i < 8; i++) {
          this.sprites.spawn({ kind: SK.drop, pos: at.add(new Vector3((Math.random() - 0.5) * radius, 2 + Math.random() * 2, (Math.random() - 0.5) * radius)), size: 0.35, color: [0.25, 0.3, 0.45], life: 0.5, vel: new Vector3(0, -9, 0) });
        }
        this.particles.burst({ kind: PK.ink, pos: ground, count: 30, speed: 3, spread: 1, up: 2, color: [0.2, 0.15, 0.25, 1], size: [0.08, 0.16], life: [0.5, 1.2] });
        for (let i = 0; i < 3; i++) {
          const o = new Vector3((Math.random() - 0.5) * radius, 0, (Math.random() - 0.5) * radius);
          this.vfx.spawn({ kind: VK.splash, pos: at.add(o).multiplyByFloats(1, 0, 1), scale: new Vector3(0.4, 0.6, 0.4), life: 0.8, color: vp, delay: 0.25 + i * 0.08 });
        }
        this.vfx.spawn({ kind: VK.groundRing, pos: new Vector3(at.x, 0.04, at.z), scale: radius * 1.2, life: 1.0, color: vp, p: [0.05, 0, 0, 0], q: [2, 0, 0, 0] });
        break;
      case 'wail':
      case 'paperquake':
        if (kind === 'wail') {
          this.vfx.spawn({ kind: VK.ink, pos: new Vector3(at.x, 0.04, at.z), scale: radius * 0.9, life: 4, color: vp, p: [0, 11, 1, 0] });
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2;
            this.vfx.spawn({ kind: VK.tendril, pos: at.add(new Vector3(Math.cos(a) * radius * 0.4, 0, Math.sin(a) * radius * 0.4)), dir: new Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), scale: new Vector3(0.45, 1, 2.2), life: 1.4, color: vp, delay: i * 0.05 });
          }
          this.vfx.spawn({ kind: VK.shockDome, pos: at.add(new Vector3(0, 0.2, 0)), scale: radius * 0.3, grow: 3.5, life: 0.8, color: vp, p: [3, 0, 1, 0], q: [1, 0, 0, 0], shape: 'dome' });
        } else {
          this.vfx.spawn({ kind: VK.paper, pos: ground, scale: new Vector3(radius * 0.55, 3, radius * 0.55), life: 1.6, color: vp, p: [14, 1.3, 1, 0] });
          this.dustRing(at, radius * 1.2, 0.9);
        }
        this.particles.burst({ kind: kind === 'wail' ? PK.ink : PK.paper, pos: at.add(new Vector3(0, 1, 0)), count: 70, speed: 8, spread: 1, color: kind === 'wail' ? [0.15, 0.1, 0.2, 1] : [0.95, 0.93, 0.88, 1], size: [0.06, 0.14], life: [0.6, 1.4] });
        this.impactFrame(2, 0.07);
        break;
      default:
        break;
    }
  }

  projectileSpawn(p: Projectile): void {
    const pal = this.pal(p.owner);
    const ids: number[] = [];
    const follow = () => (p.alive ? p.pos : null);
    const life = p.life + 1;
    switch (p.kind) {
      case 'crane':
        ids.push(this.sprites.spawn({ kind: SK.crane, pos: p.pos, size: 0.7, color: [1, 1, 1], life, follow }));
        break;
      case 'lantern':
        ids.push(this.sprites.spawn({ kind: SK.lantern, pos: p.pos, size: 0.9, color: pal.body, intensity: 1.6, life, follow }));
        break;
      case 'wolf':
        ids.push(this.sprites.spawn({ kind: SK.talisman, pos: p.pos, size: 0.9, color: [1, 1, 1], life, follow, rot: 0.3 }));
        ids.push(this.sprites.spawn({ kind: SK.orb, pos: p.pos, size: 1.4, color: pal.edge, intensity: 1.2, life, follow }));
        break;
      default:
        ids.push(this.sprites.spawn({ kind: SK.orb, pos: p.pos, size: p.radius * 2.4, color: pal.body, intensity: 2, life, follow }));
        ids.push(this.sprites.spawn({ kind: SK.flare, pos: p.pos, size: p.radius * 3, color: pal.core, intensity: 1, life, follow }));
        break;
    }
    this.projVisuals.set(p.id, ids);
    const vids: number[] = [];
    const vp = this.vpal(p.owner);
    const back = () => (p.alive && p.vel.lengthSquared() > 1e-4 ? p.vel.scale(-1) : null);
    if (p.kind === 'crane') {
      vids.push(this.vfx.spawn({ kind: VK.crane, pos: p.pos.clone(), dir: p.vel.scale(-1), scale: new Vector3(0.45, 1, 2.2), life, color: vp, follow, followDir: back }));
    } else if (p.kind === 'wolf') {
      vids.push(this.vfx.spawn({ kind: VK.tendril, pos: p.pos.clone(), dir: p.vel.scale(-1), scale: new Vector3(0.4, 1, 1.6), life, color: vp, follow, followDir: back }));
    } else if (p.kind !== 'lantern') {
      vids.push(this.vfx.spawn({ kind: VK.arcs, pos: p.pos.clone(), scale: p.radius * 1.25, life, color: vp, intensity: 1.3, follow }));
      vids.push(this.vfx.spawn({ kind: VK.thrust, pos: p.pos.clone(), dir: p.vel.scale(-1), scale: new Vector3(p.radius * 1.6, 1, 1.4), life, color: vp, intensity: 0.9, follow, followDir: back }));
    }
    this.projVfx.set(p.id, vids);
  }

  projectileUpdate(p: Projectile): void {
    if (Math.random() < 0.6) {
      const pal = this.pal(p.owner);
      const kind = p.kind === 'crane' || p.kind === 'wolf' ? PK.paper : PK.ember;
      this.particles.burst({ kind, pos: p.pos, count: 2, speed: 0.6, spread: 1, color: kind === PK.paper ? [0.95, 0.92, 0.86, 1] : [...pal.body, 1] as [number, number, number, number], size: [0.03, 0.06], life: [0.3, 0.6] });
    }
  }

  projectileEnd(p: Projectile, hit: boolean): void {
    for (const id of this.projVisuals.get(p.id) ?? []) this.sprites.kill(id);
    this.projVisuals.delete(p.id);
    for (const id of this.projVfx.get(p.id) ?? []) this.vfx.kill(id);
    this.projVfx.delete(p.id);
    if (!hit && p.pos.y < 1.2) this.mark({ kind: MK.scorch, x: p.pos.x, z: p.pos.z, radius: 0.5, strength: 0.7, palette: p.owner.kit.palette });
    if (!hit) {
      const pal = this.pal(p.owner);
      this.particles.burst({ kind: PK.ember, pos: p.pos, count: 12, speed: 2, spread: 1, color: [...pal.body, 1] as [number, number, number, number], size: [0.04, 0.07], life: [0.2, 0.5] });
    }
  }

  moveStart(f: Fighter, m: Move): void {
    const prev = this.activeTrails.get(f);
    if (prev) this.trails.stop(prev);
    this.activeTrails.delete(f);
    if (m.bone && (m.kind === 'strike')) {
      const bone = m.bone;
      const spark = f.blackSpark && (m.name === 'heavy' || m.name === 'heavy2');
      const t = this.trails.start(() => f.ch.bonePos(bone), m.heavy ? 0.5 : 0.32, spark ? 5 : f.kit.palette, spark);
      this.activeTrails.set(f, t);
      if (spark) {
        // the charge before a Black Spark: crackle on the fist
        this.sprites.spawn({ kind: SK.bolt, pos: f.ch.bonePos(bone), size: 0.35, color: [0, 0, 0], intensity: 2, life: 0.2, mode: 2, dir: new Vector3(0.3, 0.6, 0) });
      }
    }
    if (m.kind !== 'strike' && m.kind !== 'grab') {
      // casting: energy gathers into the body
      f.ch.look.energy.x = 1;
      this.particles.attract.copyFrom(f.ch.bonePos('chest'));
    }
    this.audio.sfx('whoosh', f.pos, m.heavy ? 1 : 0.6);
  }

  dash(f: Fighter): void {
    const back = f.vel.clone().normalize().scale(-1);
    // the push-off scrapes the floor behind the dash
    this.mark({ kind: MK.skid, x: f.pos.x, z: f.pos.z, angle: Math.atan2(-back.z, -back.x), len: 1.4, width: 0.4, strength: 0.7 });
    this.sprites.spawn({ kind: SK.dust, pos: new Vector3(f.pos.x, 0.05, f.pos.z), size: 1.5, color: [0.6, 0.58, 0.55], intensity: 0.8, life: 0.4, mode: 1 });
    for (let i = 0; i < 3; i++) {
      this.sprites.spawn({ kind: SK.streak, pos: f.pos.add(new Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random(), (Math.random() - 0.5) * 0.6)), size: 0.06, color: [1, 1, 1], intensity: 0.7, life: 0.2, mode: 2, dir: back.scale(1.5) });
    }
    this.audio.sfx('dash', f.pos);
  }

  land(f: Fighter, hard: boolean): void {
    const g = new Vector3(f.pos.x, 0.05, f.pos.z);
    this.sprites.spawn({ kind: SK.dust, pos: g, size: hard ? 2.5 : 1.2, color: [0.6, 0.58, 0.55], intensity: hard ? 1 : 0.6, life: 0.5, mode: 1 });
    const facing = Math.atan2(f.vel.z, f.vel.x);
    for (const side of [0, 1]) {
      const o = side ? 0.13 : -0.13;
      this.mark({ kind: MK.footprint, x: f.pos.x - Math.sin(facing) * o, z: f.pos.z + Math.cos(facing) * o, radius: 0.3, angle: facing, extra: side, strength: 1 });
    }
    if (hard) {
      this.mark({ kind: MK.crater, x: f.pos.x, z: f.pos.z, radius: 0.9, strength: 0.45, palette: f.kit.palette });
      // dust settles on whoever hit the ground
      f.ch.look.surface.y = Math.min(1, f.ch.look.surface.y + 0.18);
      this.dustRing(g, 1.8, 0.7);
      this.puff(g.add(new Vector3(0, 0.3, 0)), 0.5, 0.9);
      this.particles.burst({ kind: PK.debris, pos: g, count: 14, speed: 3, spread: 1, up: 2.5, color: [0.4, 0.38, 0.36, 1], size: [0.04, 0.09], life: [0.5, 1.0] });
      this.cam.addShake(0.25);
      this.audio.sfx('thud', f.pos);
    }
    f.ch.look.squash.set(1.08, 0.88, 1.08, 0);
  }

  vow(f: Fighter): void {
    this.impactFrame(3, 0.12);
    // the Vow: a red-black aura and a pillar of curse rising round the one who swore it
    const vowPal: VfxPalette = { body: [1, 0.05, 0.1], core: [1, 0.7, 0.6], edge: [0.6, 0, 0.05] };
    this.vfx.spawn({ kind: VK.aura, pos: f.pos.add(new Vector3(0, 0.95, 0)), scale: new Vector3(0.6, 1.1, 0.6), life: 2.5, color: vowPal, intensity: 1.4, p: [1.3, 1.6, 0, 0], follow: () => (f.alive ? f.pos.add(new Vector3(0, 0.95, 0)) : null) });
    this.vfx.spawn({ kind: VK.pillar, pos: new Vector3(f.pos.x, 0, f.pos.z), scale: new Vector3(1.1, 5, 1.1), life: 1.4, color: vowPal, q: [0, 1, 0, 0] });
    // red ink pours in from the edges of the screen
    for (const [x, y, dx, dy] of [[0.02, 0.5, 0.7, 0], [0.98, 0.5, -0.7, 0], [0.5, 0.02, 0, 0.6], [0.5, 0.98, 0, -0.6]] as const) {
      this.fluid.splat({ x, y, dx, dy, color: [0.4, 0.0, 0.03], amount: 1, radius: 0.12 });
    }
    this.light(f.ch.bonePos('chest'), [1, 0.05, 0.08], 8, 6, 1.0);
    this.particles.burst({ kind: PK.ember, pos: f.ch.bonePos('chest'), count: 120, speed: 6, spread: 1, color: [1, 0.05, 0.1, 1], size: [0.05, 0.1], life: [0.5, 1.4] });
    this.audio.sfx('vow', f.pos);
    this.onVowFx?.(f);
  }

  ko(f: Fighter, by: Fighter | null): void {
    this.impactFrame(by === this.player ? 1 : 3, 0.18);
    this.vfx.spawn({ kind: VK.ink, pos: new Vector3(f.pos.x, 0.04, f.pos.z), scale: 1.8, life: 6, color: this.vpal(by ?? f), p: [by ? 1 : 0, 9, 1, 0], delay: 0.35 });
    this.inkBurst(f.ch.bonePos('chest'), [0.03, 0.02, 0.04], 1.4, 8);
    this.mark({ kind: MK.splatter, x: f.pos.x, z: f.pos.z, radius: 0.7, angle: Math.random() * 6.28, strength: 1 });
    for (let i = 0; i < 3; i++) this.puff(f.pos.add(new Vector3((Math.random() - 0.5) * 0.8, 0.3, (Math.random() - 0.5) * 0.8)), 0.45 + Math.random() * 0.3, 1.1, 0.25);
    this.desatT = 1.2;
    this.cam.zoomPunch(1);
    this.audio.sfx('ko', f.pos);
    this.onKo?.(f, by);
  }

  domainTick(f: Fighter, target: Fighter, dmg: number): void {
    const pal = this.pal(f);
    const at = target.ch.bonePos('chest');
    void dmg;
    switch (f.kit.domain?.id) {
      case 0:
        this.sprites.spawn({ kind: SK.seal, pos: at, size: 3, color: pal.body, intensity: 2, life: 0.7 });
        this.vfx.spawn({ kind: VK.bell, pos: new Vector3(target.pos.x, 0, target.pos.z), scale: new Vector3(0.9, 1.3, 0.9), life: 0.9, color: this.vpal(f), intensity: 1.1, p: [1, 1, 0, 0] });
        this.vfx.spawn({ kind: VK.shockDome, pos: at, scale: 0.4, grow: 4, life: 0.6, color: this.vpal(f), p: [5, 0, 0.6, 0], q: [2, 0, 0, 0] });
        this.audio.sfx('toll', at);
        break;
      case 1:
        for (let i = 0; i < 5; i++) this.sprites.spawn({ kind: SK.crane, pos: at.add(new Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, (Math.random() - 0.5) * 3)), size: 0.6, color: [1, 1, 1], life: 0.4, vel: new Vector3(0, -8, 0) });
        break;
      case 2:
        this.sprites.spawn({ kind: SK.moon, pos: at.add(new Vector3(0, 2, 0)), size: 3, color: pal.core, intensity: 2.5, life: 0.4 });
        this.vfx.spawn({ kind: VK.column, pos: new Vector3(target.pos.x, 0, target.pos.z), scale: new Vector3(0.8, 8, 0.8), life: 0.8, color: this.vpal(f), intensity: 1.2 });
        break;
      default:
        this.sprites.spawn({ kind: SK.fire, pos: at, size: 2.4, color: pal.body, intensity: 2, life: 0.6 });
        break;
    }
  }

  // --- the frame ----------------------------------------------------------------------------------------

  update(dt: number, fighters: Fighter[]): void {
    const s = this.r.post.settings;
    this.sprites.update(dt);
    this.vfx.update(dt);
    this.fluid.step(dt);
    this.particles.update(dt);
    this.trails.update(dt, this.r.camera.position);
    this.particles.attractStrength *= Math.exp(-dt * 3);
    // fighters: flashes and squash ease back, aura fades unless charging
    const marks = this.r.mats.marks;
    for (const f of fighters) {
      const l = f.ch.look;
      // prints in soft ground (snow, ash, sand): one every stride while walking
      if (marks && marks.soft > 0 && f.grounded) {
        const st = this.stride.get(f) ?? { x: f.pos.x, z: f.pos.z, d: 0, side: 0 };
        const dx = f.pos.x - st.x;
        const dz = f.pos.z - st.z;
        st.d += Math.hypot(dx, dz);
        if (st.d > 0.75 && Math.hypot(dx, dz) > 1e-4) {
          const facing = Math.atan2(dz, dx);
          const o = st.side ? 0.12 : -0.12;
          this.mark({ kind: MK.footprint, x: f.pos.x - Math.sin(facing) * o, z: f.pos.z + Math.cos(facing) * o, radius: 0.3, angle: facing, extra: st.side, strength: marks.soft });
          st.d = 0;
          st.side = 1 - st.side;
        }
        st.x = f.pos.x;
        st.z = f.pos.z;
        this.stride.set(f, st);
      }
      // what the fight does to a body: wet in the rain, dust from falls, damage, sweat, Black Spark
      const ft = (this.fightTime.get(f) ?? 0) + dt;
      this.fightTime.set(f, ft);
      const hurt = 1 - Math.max(0, f.hp) / Math.max(1, f.maxHp);
      l.surface.x += (this.r.lighting.wetness - l.surface.x) * Math.min(1, dt * 0.5);
      l.surface.y = Math.max(0, l.surface.y - dt * 0.004);
      l.surface.z += (hurt - l.surface.z) * Math.min(1, dt * 2);
      l.surface.w = Math.min(1, ft / 120 + hurt * 0.5);
      l.surface2.z += ((f.blackSpark ? 1 : 0) - l.surface2.z) * Math.min(1, dt * 6);
      l.flash.w = Math.max(0, l.flash.w - dt * 6);
      l.squash.x += (1 - l.squash.x) * Math.min(1, dt * 12);
      l.squash.y += (1 - l.squash.y) * Math.min(1, dt * 12);
      l.squash.z += (1 - l.squash.z) * Math.min(1, dt * 12);
      const casting = f.move && f.move.kind !== 'strike' && f.move.kind !== 'grab';
      const target = f.domainActive ? 1 : casting ? 1 : f.vowTime > 0 ? 0.6 : 0;
      l.energy.x += (target - l.energy.x) * Math.min(1, dt * 4);
      if (!f.move) {
        const tr = this.activeTrails.get(f);
        if (tr) {
          this.trails.stop(tr);
          this.activeTrails.delete(f);
        }
      } else if (f.phase() === 'recovery') {
        const tr = this.activeTrails.get(f);
        if (tr) {
          this.trails.stop(tr);
          this.activeTrails.delete(f);
        }
      }
    }
    // dramatic moments get manga hatching in the shadows on the fighters
    const drama = fighters.some((f) => f.alive && (f.vowTime > 0 || f.domainActive)) ? 0.65 : 0;
    s.lineHatch += (drama - s.lineHatch) * Math.min(1, dt * 3);
    // dashing fighters leave afterimages in their colours
    s.ghosts = fighters.filter((f) => f.alive && f.state === 'dash' && f.ch.idBase >= 0).map((f) => ({ idBase: f.ch.idBase, color: this.pal(f).body }));
    // cursed-energy auras: whoever is gathering energy burns (the Vow smokes, Black Spark crackles)
    s.auras = [];
    for (const f of fighters) {
      const l = f.ch.look;
      if (!f.alive || f.ch.idBase < 0) continue;
      const vow = f.vowTime > 0;
      const strength = Math.min(1, Math.max(l.energy.x, vow ? 0.8 : 0));
      if (strength < 0.15) continue;
      const pal = f.blackSpark ? PAL[5] : this.pal(f);
      const style = vow ? 2 : f.blackSpark ? 1 : f.domainActive ? 3 : 0;
      const color: RGB = vow ? [1, 0.06, 0.1] : f.blackSpark ? [1, 0.08, 0.14] : pal.body;
      const edge: RGB = vow ? [0.3, 0, 0.02] : pal.edge;
      s.auras.push({ idBase: f.ch.idBase, color, edge, style, strength, reach: style === 3 ? 10 : 16 });
    }
    // light flashes into the lighting slots 1..3 (slot 0 belongs to the stage)
    const L = this.r.lighting;
    for (let i = 1; i < 4; i++) L.pointCol.set([0, 0, 0, 0], i * 4);
    for (const fl of this.flashes) {
      fl.age += dt;
      const k = Math.max(0, 1 - fl.age / fl.life);
      L.setPoint(fl.slot, fl.pos, fl.range, fl.color, fl.intensity * k * k);
    }
    this.flashes = this.flashes.filter((f) => f.age < f.life);
    // screen effects
    this.impactT -= dt;
    s.impactAmount = this.impactT > 0 ? 1 : 0;
    this.flashT -= dt;
    s.flashAmount = this.flashT > 0 ? 0.6 : 0;
    this.desatT = Math.max(0, this.desatT - dt);
    s.desatPulse = Math.min(0.85, this.desatT * 1.5);
    this.radialT = Math.max(0, this.radialT - dt);
    s.radialBlur = this.radialT * 1.5;
    this.speedT = Math.max(0, this.speedT - dt);
    s.speedLines = Math.min(1, this.speedT * 2.5);
    s.heatHaze = Math.max(0, s.heatHaze - dt * 0.1);
    // screen shockwaves
    s.shockwaves.fill(0);
    let i = 0;
    for (const sh of this.shocks) {
      sh.t += dt;
      const sp = this.screenPos(sh.pos);
      if (i < 4 && sh.t < 0.6) {
        s.shockwaves.set([sp.x, sp.y, sh.t * 0.9, sh.strength * (1 - sh.t / 0.6)], i * 4);
        i++;
      }
    }
    this.shocks = this.shocks.filter((x) => x.t < 0.6);
    // the same shockwaves shove particles: a shell racing outward at 18 m/s
    const ps = this.particles.shocks;
    ps.fill(0);
    this.shocks.slice(-4).forEach((sh, k) => ps.set([sh.pos.x, sh.pos.y, sh.pos.z, sh.t * 18 * sh.strength], k * 4));
    void this.shockIdx;
  }

  clear(): void {
    this.sprites.clear();
    this.vfx.clear();
    this.particles.clear();
    this.trails.clear();
    this.flashes = [];
    this.shocks = [];
    this.activeTrails.clear();
    this.fightTime.clear();
    this.stride.clear();
    this.r.mats.marks?.clear();
  }
}
