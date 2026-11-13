import { Vector3 } from '@babylonjs/core';
import { Boss, type BossDef, type Special } from '../Boss';
import type { EnemyAttack } from '../Archetypes';
import type { Combatant, DamageInfo } from '../../combat/Types';

/**
 * Ignaroth, the Burning King: first of the Pentarchs, lord of the Ashen Kingdom. A four-and-a-half
 * metre giant of cooling magma in a king's blackened plate, swinging Cinderfall.
 *
 * Phase 1 (100-62%): heavy sword work - cleaves that split the ground into a line of eruptions,
 *   wide knockdown sweeps, a two-swing combo, a stomp shockwave, a charging thrust from range.
 * Phase 2 (62-30%): adds a leaping slam that lands in a ring of fire and a rain of meteors.
 * Phase 3 (<30%): faster and relentless; adds a channelled nova that fills the arena near him
 *   (get out, or dodge through the blast) and calls his thralls once.
 */
export const IGNAROTH: BossDef = {
  title: 'The Burning King',
  kit: 'ignaroth',
  archetype: {
    id: 'ignaroth', name: 'Ignaroth', model: 'ignaroth', weapon: 'cinderfall', scale: 2.3,
    health: 2600, poise: 240, stamina: 999, radius: 0.5, height: 1.95,
    walk: 1.4, run: 4.6, strafe: 1.3, sight: 80, fov: 6.3, hearing: 80,
    aggression: 0.7, block: 0, dodge: 0, holdRange: 3, heavy: true, executable: false,
    xp: 1500, aether: 60, glow: [1, 0.5, 0.15],
    resist: { fire: 0.1, water: 1.6, physical: 0.9 },
    attacks: [
      { id: 'cleave', clip: 'e_overhead', fallback: 'heavy_1', damage: 58, poise: 70, weight: 1, knockback: 2, element: 'fire', range: [0, 3.2], cooldown: 4, score: 1, parryable: false, knockdown: true, track: 3.5, trackTime: 0.6, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'sweep', clip: 'heavy_2', speed: 0.85, damage: 44, poise: 60, weight: 0.9, knockback: 2.4, range: [0, 3.4], cooldown: 3.2, score: 0.9, parryable: false, knockdown: true, track: 3, trackTime: 0.45, armour: true, hit: { kind: 'weapon' } },
      { id: 'combo', clip: 'light_3', damage: 36, poise: 40, weight: 0.7, knockback: 1, range: [0, 2.8], cooldown: 2.6, score: 0.9, parryable: true, track: 4, trackTime: 0.3, next: ['combo2'], chain: 0.85, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo2', clip: 'light_4', damage: 42, poise: 50, weight: 0.85, knockback: 2, range: [0, 3.2], cooldown: 3, score: 0, parryable: true, track: 3, trackTime: 0.3, armour: true, hit: { kind: 'weapon' } },
      { id: 'stomp', clip: 'land_heavy', damage: 30, poise: 70, weight: 0.8, knockback: 2.8, element: 'fire', range: [0, 2.2], cooldown: 6, score: 1.3, parryable: false, unblockable: true, knockdown: true, track: 2, trackTime: 0.2, armour: true, hit: { kind: 'none' }, tell: 'red' },
      { id: 'thrust', clip: 'e_thrust', fallback: 'sprint_attack', damage: 52, poise: 70, weight: 1, knockback: 2.2, range: [5, 14], cooldown: 7, score: 0.9, parryable: false, unblockable: true, knockdown: true, track: 3, trackTime: 0.7, lunge: 1.2, armour: true, hit: { kind: 'weapon' }, tell: 'red' },
      { id: 'leap', clip: 'cast_slam', speed: 0.8, damage: 60, poise: 90, weight: 1, knockback: 3, element: 'fire', range: [6, 24], cooldown: 9, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 6, trackTime: 0.4, armour: true, hit: { kind: 'none' }, tell: 'red' },
      { id: 'meteors', clip: 'cast_arc', speed: 0.8, damage: 34, poise: 40, weight: 0.6, knockback: 1.5, element: 'fire', range: [3, 30], cooldown: 12, score: 0.9, parryable: false, knockdown: true, track: 4, trackTime: 0.4, armour: true, hit: { kind: 'none' }, status: { burn: 40 } },
      { id: 'nova', clip: 'cast_heal', speed: 0.55, damage: 85, poise: 120, weight: 1, knockback: 3.5, element: 'fire', range: [0, 7], cooldown: 16, score: 1.4, parryable: false, unblockable: true, knockdown: true, track: 0, trackTime: 0, armour: true, hit: { kind: 'none' } },
      { id: 'summon', clip: 'cast_push', speed: 0.8, damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 40], cooldown: 30, score: 2, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' } },
    ],
  },
  phases: [
    { at: 1, attacks: ['cleave', 'sweep', 'combo', 'stomp', 'thrust'], speed: 0.8, aggression: 0.55 },
    { at: 0.62, attacks: ['cleave', 'sweep', 'combo', 'stomp', 'thrust', 'leap', 'meteors'], speed: 0.9, aggression: 0.72 },
    { at: 0.3, attacks: ['cleave', 'sweep', 'combo', 'stomp', 'leap', 'meteors', 'nova', 'summon'], speed: 1, aggression: 0.88 },
  ],
};

function fireHit(b: Boss, a: EnemyAttack, scale = 1): (v: Combatant) => DamageInfo {
  return (v) => {
    const dir = v.position.subtract(b.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2), poise: a.poise * scale, element: 'fire', direction: dir,
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

/** Leap state per boss (start, landing, timing). */
const leaps = new WeakMap<Boss, { from: Vector3; to: Vector3; t0: number; t1: number; t: number }>();

const KIT: Record<string, Special> = {
  // the blade bites into the ground and the ground splits open ahead of it
  cleave: {
    event(b, a, e) {
      if (e.name !== 'impact') return;
      const f = b.facing;
      const origin = b.position.add(f.scale(2.4 * b.def.scale / 2.3));
      b.ctx.vfx.burst('emberSlam', ground(b, origin), Vector3.Up(), 1.6);
      b.ctx.ground.shockwave(ground(b, origin), 4);
      b.ctx.shake(0.5);
      for (let i = 0; i < 6; i++) {
        const p = ground(b, origin.add(f.scale(1.2 + i * 1.7)));
        b.ctx.hazards.eruption(p, 1.5, 0.12 + i * 0.11, 'fireBurst', b, b.team, fireHit(b, a, 0.55), { color: [1, 0.4, 0.1, 3] });
      }
    },
  },
  // a stamp that sends a ring of fire out from his feet
  stomp: {
    event(b, a, e) {
      if (e.name !== 'impact') return;
      const at = b.position.clone();
      b.ctx.vfx.burst('emberSlam', at, Vector3.Up(), 2.2);
      b.ctx.ground.shockwave(at, 6.5, [1, 0.45, 0.12, 5], 0.55);
      b.ctx.ground.scorch(at, 3.5);
      b.ctx.shake(0.6);
      b.ctx.world.area(b, b.team, at.add(new Vector3(0, 0.6, 0)), 5.2, null, fireHit(b, a));
    },
  },
  // leaps across the arena and lands in a ring of eruptions
  leap: {
    start(b) {
      const t = b.target;
      if (!t) return;
      const dir = b.position.subtract(t.position);
      dir.y = 0;
      const d = dir.length();
      dir.scaleInPlace(1 / Math.max(d, 1e-3));
      // land just in front of the player (so the slam lands on them if they stay)
      const to = ground(b, t.position.add(dir.scale(Math.min(d, b.radius + 0.6))));
      const clip = b.char.animator.clips.get('cast_slam');
      const sp = b.attack?.speed ?? 1;
      const ch = clip.events.find((x) => x.name === 'channel')?.t ?? 0.3;
      const im = clip.events.find((x) => x.name === 'impact')?.t ?? 0.9;
      leaps.set(b, { from: b.position.clone(), to, t0: ch / sp, t1: im / sp, t: 0 });
      b.ctx.ground.telegraph(to, 4.2, im / sp, [1, 0.25, 0.05, 3.5]);
    },
    step(b, _a, dt) {
      const L = leaps.get(b);
      if (!L) return;
      L.t += dt;
      const k = (L.t - L.t0) / Math.max(1e-3, L.t1 - L.t0);
      if (k <= 0 || k > 1) {
        b.char.model.root.position.y = 0;
        return;
      }
      const want = Vector3.Lerp(L.from, L.to, Math.min(1, k + dt / (L.t1 - L.t0)));
      const cur = Vector3.Lerp(L.from, L.to, k);
      b.setWarp(want.subtract(cur));
      // the arc: up to a third of his height above the ground
      b.char.model.root.position.y = Math.sin(Math.PI * k) * 1.6 / b.def.scale;
    },
    event(b, a, e) {
      if (e.name !== 'impact') return;
      const L = leaps.get(b);
      b.char.model.root.position.y = 0;
      const at = b.position.clone();
      b.ctx.vfx.burst('firePillar', at, Vector3.Up(), 1.3);
      b.ctx.vfx.burst('emberSlam', at, Vector3.Up(), 2.4);
      b.ctx.ground.shockwave(at, 7, [1, 0.45, 0.12, 5], 0.6);
      b.ctx.ground.scorch(at, 4);
      b.ctx.shake(0.9);
      b.ctx.world.area(b, b.team, at.add(new Vector3(0, 0.6, 0)), 4.2, null, fireHit(b, a));
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const p = ground(b, at.add(new Vector3(Math.sin(ang) * 5.2, 0, Math.cos(ang) * 5.2)));
        b.ctx.hazards.eruption(p, 1.3, 0.35 + (i % 2) * 0.15, 'fireBurst', b, b.team, fireHit(b, a, 0.45));
      }
      if (L) leaps.delete(b);
    },
    end(b) {
      b.char.model.root.position.y = 0;
      leaps.delete(b);
    },
  },
  // raises Cinderfall to the sky: burning rock falls round the player
  meteors: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      b.ctx.vfx.burst('fireBurst', b.position.add(new Vector3(0, b.height, 0)), Vector3.Up(), 2);
      for (let i = 0; i < 8; i++) {
        const off = i === 0 ? Vector3.Zero() : new Vector3((Math.random() - 0.5) * 11, 0, (Math.random() - 0.5) * 11);
        b.ctx.hazards.after(i * 0.28, () => {
          const at = ground(b, t.position.add(off));
          b.ctx.hazards.eruption(at, 1.8, 0.7, 'fireBurst', b, b.team, fireHit(b, a), { zone: 3, color: [1, 0.35, 0.08, 3] });
          // the falling rock itself, timed to arrive with the eruption
          const from = at.add(new Vector3((Math.random() - 0.5) * 4, 16, (Math.random() - 0.5) * 4));
          b.ctx.hazards.after(Math.max(0, 0.7 - 16 / 24), () => {
            b.ctx.projectiles.fire('emberShard', from, at.subtract(from), b, b.team, (v, p) => ({ ...fireHit(b, a, 0.15)(v), point: p }));
          });
        });
      }
    },
  },
  // gathers the fire into himself, then releases it all at once
  nova: {
    event(b, a, e) {
      if (e.name !== 'channel') return;
      const at = b.position.clone();
      const clip = b.char.animator.clips.get('cast_heal');
      const sp = b.attack?.speed ?? 1;
      const rel = clip.events.find((x) => x.name === 'release')?.t ?? 0.8;
      const ch = clip.events.find((x) => x.name === 'channel')?.t ?? 0.2;
      const delay = (rel - ch) / sp + 0.4;
      b.ctx.vfx.burst('embers', at, Vector3.Up(), 3);
      b.ctx.hazards.eruption(at, 9, delay, 'firePillar', b, b.team, fireHit(b, a), { color: [1, 0.2, 0.04, 4], zone: 4 });
      b.ctx.hazards.after(delay, () => b.ctx.shake(1));
    },
  },
  // calls the burnt soldiers of his kingdom up out of the ash
  summon: {
    event(b, _a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('fireBurst', b.position.add(new Vector3(0, 2, 0)), Vector3.Up(), 2);
      b.spawnAdds?.(b.position.clone(), 3);
    },
  },
};

Boss.specials.ignaroth = KIT;
