import { Vector3 } from '@babylonjs/core';
import { Boss, type BossDef, type Special } from '../Boss';
import type { EnemyAttack } from '../Archetypes';
import type { Combatant, DamageInfo } from '../../combat/Types';

/**
 * Vaeltris, Goddess of Storms: she hangs a little above the Stormcrown on her wings, spear in hand.
 *
 * Phase 1 (100-65%): spear thrusts and sweeps, a two-strike combo, chained lightning strikes that
 *   walk toward Kael, and a wind gust that throws him back.
 * Phase 2 (65-30%): a fan of feather blades, and the dive: she climbs out of reach and comes down on
 *   him in a burst of lightning.
 * Phase 3 (<30%): the tempest (lightning across the whole crown while she channels) and her monks.
 */
export const VAELTRIS: BossDef = {
  title: 'The Storm Unbound',
  kit: 'vaeltris',
  element: 'lightning',
  archetype: {
    id: 'vaeltris', name: 'Vaeltris', model: 'vaeltris', weapon: 'storm_spear', scale: 2.2,
    health: 3600, poise: 260, stamina: 999, radius: 0.5, height: 2.0,
    walk: 1.6, run: 5.2, strafe: 1.8, sight: 90, fov: 6.3, hearing: 90,
    aggression: 0.75, block: 0, dodge: 0, holdRange: 3.4, heavy: true, executable: false,
    xp: 2300, aether: 80, voice: 'roar_storm',
    death: { vfx: 'deathStorm', color: [0.7, 0.65, 1.0], sound: 'storm_dissolve' },
    resist: { lightning: 0.1, fire: 1.2, water: 1.0, physical: 0.9 },
    attacks: [
      { id: 'thrust', clip: 'sprint_attack', speed: 0.85, damage: 54, poise: 60, weight: 0.9, knockback: 2, element: 'lightning', range: [0, 7], cooldown: 3.2, score: 1, parryable: true, track: 5, trackTime: 0.45, lunge: 0.8, armour: true, hit: { kind: 'weapon' }, tell: 'glint', status: { shock: 35 } },
      { id: 'sweep', clip: 'heavy_2', speed: 0.85, damage: 46, poise: 60, weight: 0.9, knockback: 2.6, element: 'lightning', range: [0, 4.6], cooldown: 4, score: 1, parryable: false, knockdown: true, track: 3, trackTime: 0.4, armour: true, hit: { kind: 'weapon' }, tell: 'red', status: { shock: 30 } },
      { id: 'combo', clip: 'light_1', speed: 0.9, damage: 36, poise: 40, weight: 0.7, knockback: 1, range: [0, 4.2], cooldown: 2.6, score: 0.9, parryable: true, track: 4, trackTime: 0.3, next: ['combo2'], chain: 0.8, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo2', clip: 'light_2', speed: 0.9, damage: 40, poise: 46, weight: 0.8, knockback: 1.6, range: [0, 4.4], cooldown: 3, score: 0, parryable: true, track: 3, trackTime: 0.3, armour: true, hit: { kind: 'weapon' } },
      { id: 'strikes', clip: 'cast_slam', speed: 0.8, damage: 44, poise: 60, weight: 0.8, knockback: 2, element: 'lightning', range: [3, 30], cooldown: 7, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 4, trackTime: 0.4, armour: true, hit: { kind: 'none' }, tell: 'red', status: { shock: 50 } },
      { id: 'gust', clip: 'cast_push', speed: 0.8, damage: 22, poise: 50, weight: 0.6, knockback: 4, range: [0, 9], cooldown: 8, score: 1, parryable: false, unblockable: true, track: 6, trackTime: 0.5, armour: true, hit: { kind: 'none' } },
      { id: 'feathers', clip: 'cast_arc', speed: 0.85, damage: 24, poise: 18, weight: 0.35, knockback: 0.8, element: 'lightning', range: [4, 30], cooldown: 6, score: 1.1, parryable: false, track: 6, trackTime: 0.5, armour: true, hit: { kind: 'none' }, status: { shock: 20 } },
      { id: 'dive', clip: 'cast_slam', speed: 0.55, damage: 62, poise: 90, weight: 1, knockback: 3.5, element: 'lightning', range: [5, 30], cooldown: 12, score: 1.2, parryable: false, unblockable: true, knockdown: true, track: 0, trackTime: 0, armour: true, hit: { kind: 'none' }, tell: 'red', status: { shock: 60 } },
      { id: 'tempest', clip: 'cast_heal', speed: 0.5, damage: 40, poise: 60, weight: 0.8, knockback: 2, element: 'lightning', range: [0, 40], cooldown: 16, score: 1.4, parryable: false, unblockable: true, knockdown: true, track: 1, trackTime: 0.2, armour: true, hit: { kind: 'none' }, status: { shock: 50 } },
      { id: 'summon', clip: 'cast_push', speed: 0.8, damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 40], cooldown: 30, score: 2, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' } },
    ],
  },
  phases: [
    { at: 1, attacks: ['thrust', 'sweep', 'combo', 'strikes', 'gust'], speed: 0.85, aggression: 0.6 },
    { at: 0.65, attacks: ['thrust', 'sweep', 'combo', 'strikes', 'gust', 'feathers', 'dive'], speed: 0.95, aggression: 0.72 },
    { at: 0.3, attacks: ['thrust', 'combo', 'strikes', 'feathers', 'dive', 'tempest', 'summon'], speed: 1.05, aggression: 0.88 },
  ],
};

const STORM: [number, number, number, number] = [0.65, 0.6, 1, 4];

function stormHit(b: Boss, a: EnemyAttack, scale = 1): (v: Combatant) => DamageInfo {
  return (v) => {
    const dir = v.position.subtract(b.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2), poise: a.poise * scale, element: 'lightning', direction: dir,
      point: v.position.add(new Vector3(0, 1, 0)), source: b, weight: a.weight, knockback: a.knockback, knockdown: a.knockdown,
      unblockable: a.unblockable, parryable: false, ranged: true, status: a.status, tag: a.id,
    };
  };
}

function ground(b: Boss, p: Vector3): Vector3 {
  const out = p.clone();
  out.y = b.position.y;
  if (b.ctx.nav) b.ctx.nav.closest(out, out);
  return out;
}

/** A telegraphed lightning strike (the burst draws the bolt). */
function strike(b: Boss, a: EnemyAttack, at: Vector3, delay: number, radius = 2.2, scale = 1): void {
  b.ctx.hazards.eruption(ground(b, at), radius, delay, 'lightningStrike', b, b.team, stormHit(b, a, scale), { color: STORM, scorch: true });
}

interface Dive { t: number; up: boolean; spot: Vector3 | null; landed: boolean }
const dives = new WeakMap<Boss, Dive>();
const tempests = new WeakMap<Boss, number>();
/** Hover height (in the model's own units, before the boss's scale). */
const HOVER = 0.28;

Boss.passives.vaeltris = (b, dt) => {
  // she hangs above the stones on slow wingbeats, unless a dive owns her height
  if (dives.has(b)) return;
  const root = b.char.model.root;
  const t = b.ctx.hazards.time;
  const want = HOVER + 0.05 * Math.sin(t * 1.9);
  root.position.y += (want - root.position.y) * Math.min(1, dt * 4);
  void dt;
};

const KIT: Record<string, Special> = {
  // three to five strikes walking from her toward Kael, each a beat after the last
  strikes: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      const n = b.phase >= 1 ? 5 : 3;
      const from = b.position;
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        const at = Vector3.Lerp(from, t.position, k).add(new Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
        strike(b, a, at, 0.8 + i * 0.28);
      }
      b.ctx.shake(0.3);
    },
  },
  // the wingbeat: a cone of wind that throws Kael back and staggers him
  gust: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const f = b.facing;
      const c = b.position.add(f.scale(5));
      b.ctx.vfx.burst('gust', b.position.add(new Vector3(0, 2, 0)).add(f.scale(1.5)), f, 2.2);
      b.ctx.vfx.burst('feathers', b.position.add(new Vector3(0, 3, 0)), f, 1);
      b.ctx.hazards.wind(c, 6.5, f.scale(11), 0.7);
      for (const h of b.ctx.world.area(b, b.team, c, 6, null, stormHit(b, a))) b.ctx.hazards.onHit?.(h);
      b.ctx.shake(0.35);
    },
  },
  // a fan of feather blades
  feathers: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      const n = b.phase >= 2 ? 7 : 5;
      const from = b.position.add(new Vector3(0, 2.6, 0));
      const aim = t ? t.aimPoint(new Vector3()).subtract(from) : b.facing.clone();
      const base = Math.atan2(aim.x, aim.z);
      const pitch = Math.atan2(aim.y, Math.hypot(aim.x, aim.z));
      for (let i = 0; i < n; i++) {
        const yaw = base + (i - (n - 1) / 2) * 0.16;
        const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        b.ctx.projectiles.fire('featherBlade', from, dir, b, b.team, (v, point) => ({ ...stormHit(b, a)(v), point }), i === (n - 1) / 2 ? t : null);
      }
      b.ctx.vfx.burst('feathers', from, b.facing, 1.2);
    },
  },
  // she climbs out of reach, hangs over Kael, and comes down in a lightning burst
  dive: {
    start(b) {
      dives.set(b, { t: 0, up: true, spot: null, landed: false });
      b.ctx.vfx.burst('feathers', b.position.add(new Vector3(0, 2, 0)), Vector3.Up(), 2);
      b.ctx.vfx.burst('gust', b.position, Vector3.Down(), 1.5);
    },
    step(b, a, dt) {
      const d = dives.get(b);
      if (!d) return;
      d.t += dt;
      const root = b.char.model.root;
      const scale = b.def.scale;
      if (d.t < 0.8) {
        root.position.y = HOVER + (d.t / 0.8) ** 2 * (9 / scale);
        if (d.t > 0.5) b.hidden = true;
      } else if (!d.spot) {
        const t = b.target;
        d.spot = ground(b, t ? t.position.clone() : b.position.clone());
        b.ctx.ground.telegraph(d.spot, 4.5, 1.1, STORM);
        b.ctx.hazards.after(0.9, () => b.teleport(d.spot!));
      } else if (d.t > 1.95 && !d.landed) {
        root.position.y = Math.max(0, root.position.y - dt * 60 / scale);
        if (root.position.y <= 0.001) {
          d.landed = true;
          b.hidden = false;
          const at = b.position.clone();
          b.ctx.vfx.burst('lightningStrike', at, Vector3.Up(), 1.6);
          b.ctx.ground.shockwave(at, 8, STORM, 0.6);
          b.ctx.ground.scorch(at, 3.5, [0.5, 0.45, 1, 4]);
          for (const h of b.ctx.world.area(b, b.team, at.add(new Vector3(0, 1, 0)), 4.5, null, stormHit(b, a))) b.ctx.hazards.onHit?.(h);
          b.ctx.shake(0.9);
        }
      }
    },
    end(b) {
      dives.delete(b);
      b.hidden = false;
    },
  },
  // the tempest: while she channels, lightning falls across the whole crown, and on Kael
  tempest: {
    start(b) {
      tempests.set(b, 0);
      b.ctx.vfx.burst('feathers', b.position.add(new Vector3(0, 3, 0)), Vector3.Up(), 2);
    },
    step(b, a, dt) {
      let acc = (tempests.get(b) ?? 0) + dt;
      while (acc > 0.35) {
        acc -= 0.35;
        const t = b.target;
        const near = t && Math.random() < 0.45;
        const c = near ? t!.position : b.position;
        const r = near ? 2.5 : 16;
        const ang = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * r;
        strike(b, a, c.add(new Vector3(Math.sin(ang) * rr, 0, Math.cos(ang) * rr)), 0.9, 2.0, 0.8);
      }
      tempests.set(b, acc);
    },
    end(b) {
      tempests.delete(b);
    },
  },
  summon: {
    event(b, _a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('lightningStrike', b.position.add(b.facing.scale(4)), Vector3.Up(), 1);
      b.spawnAdds?.(b.position.clone(), 3);
    },
  },
};

Boss.specials.vaeltris = KIT;
