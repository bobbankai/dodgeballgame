import { Vector3 } from '@babylonjs/core';
import { Boss, type BossDef, type Special } from '../Boss';
import type { EnemyAttack } from '../Archetypes';
import type { Combatant, DamageInfo } from '../../combat/Types';

/**
 * Aurelion, the Sun Swallowed: the first of the Pentarchs, who closed his own hand over the sun.
 * Dawnbreaker in his hands, the black sun over his crown.
 *
 * Phase 1 (100-66%): greatsword cleaves and sweeps, a three-strike combo, a lunge, the sun-lance (a
 *   line of fire torn across the dais) and solar flares round Kael.
 * Phase 2 (66-33%): the corona nova (a ring of light rolling outward: jump it or dodge through it)
 *   and faster flares.
 * Phase 3 (<33%): the Black Sun. The sky goes dark; void orbs drift out of him and hunt Kael; his
 *   sentinels come.
 */
export const AURELION: BossDef = {
  title: 'The Sun Swallowed',
  kit: 'aurelion',
  element: 'light',
  archetype: {
    id: 'aurelion', name: 'Aurelion', model: 'aurelion', weapon: 'dawnbreaker', scale: 2.3,
    health: 5000, poise: 320, stamina: 999, radius: 0.5, height: 2.0,
    walk: 1.6, run: 5.0, strafe: 1.7, sight: 90, fov: 6.3, hearing: 90,
    aggression: 0.75, block: 0, dodge: 0, holdRange: 3.4, heavy: true, executable: false,
    xp: 4000, aether: 100, voice: 'roar_sun',
    death: { vfx: 'deathSun', color: [1.0, 0.8, 0.4], sound: 'sun_dissolve' },
    resist: { light: 0.1, fire: 0.4, lightning: 1.0, water: 1.1, life: 1.2, physical: 0.9 },
    attacks: [
      { id: 'cleave', clip: 'heavy_1', speed: 0.8, damage: 60, poise: 70, weight: 0.95, knockback: 2.6, element: 'light', range: [0, 4.6], cooldown: 3.4, score: 1, parryable: true, track: 4, trackTime: 0.45, armour: true, hit: { kind: 'weapon' }, tell: 'glint', status: { burn: 30 } },
      { id: 'sweep', clip: 'heavy_2', speed: 0.8, damage: 52, poise: 64, weight: 0.9, knockback: 2.8, element: 'light', range: [0, 4.8], cooldown: 4, score: 1, parryable: false, knockdown: true, track: 3, trackTime: 0.4, armour: true, hit: { kind: 'weapon' }, tell: 'red' },
      { id: 'combo', clip: 'light_1', speed: 0.9, damage: 40, poise: 40, weight: 0.7, knockback: 1, range: [0, 4.2], cooldown: 2.8, score: 0.9, parryable: true, track: 4, trackTime: 0.3, next: ['combo2'], chain: 0.85, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo2', clip: 'light_2', speed: 0.9, damage: 42, poise: 44, weight: 0.75, knockback: 1.2, range: [0, 4.4], cooldown: 3, score: 0, parryable: true, track: 3, trackTime: 0.3, next: ['combo3'], chain: 0.7, armour: true, hit: { kind: 'weapon' } },
      { id: 'combo3', clip: 'light_3', speed: 0.85, damage: 50, poise: 56, weight: 0.85, knockback: 2, element: 'light', range: [0, 4.6], cooldown: 3.4, score: 0, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'weapon' }, tell: 'red', status: { burn: 30 } },
      { id: 'lunge', clip: 'sprint_attack', speed: 0.85, damage: 56, poise: 60, weight: 0.9, knockback: 2, range: [4, 10], cooldown: 4, score: 1, parryable: true, track: 5, trackTime: 0.45, lunge: 1.0, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'lance', clip: 'cast_push', speed: 0.8, damage: 54, poise: 70, weight: 0.9, knockback: 2.6, element: 'light', range: [5, 34], cooldown: 7, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 6, trackTime: 0.7, armour: true, hit: { kind: 'none' }, tell: 'red', status: { burn: 60 } },
      { id: 'flares', clip: 'cast_slam', speed: 0.8, damage: 46, poise: 56, weight: 0.8, knockback: 2, element: 'light', range: [3, 34], cooldown: 7.5, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 4, trackTime: 0.4, armour: true, hit: { kind: 'none' }, status: { burn: 50 } },
      { id: 'nova', clip: 'cast_arc', speed: 0.75, damage: 50, poise: 70, weight: 0.85, knockback: 3, element: 'light', range: [0, 18], cooldown: 10, score: 1.2, parryable: false, unblockable: true, knockdown: true, track: 1, trackTime: 0.2, armour: true, hit: { kind: 'none' }, tell: 'red', status: { burn: 40 } },
      { id: 'blacksun', clip: 'cast_heal', speed: 0.5, damage: 30, poise: 30, weight: 0.5, knockback: 1, element: 'void', range: [0, 40], cooldown: 14, score: 1.4, parryable: false, track: 1, trackTime: 0.2, armour: true, hit: { kind: 'none' } },
      { id: 'summon', clip: 'cast_push', speed: 0.8, damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 40], cooldown: 30, score: 2, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' } },
    ],
  },
  phases: [
    { at: 1, attacks: ['cleave', 'sweep', 'combo', 'lunge', 'lance', 'flares'], speed: 0.85, aggression: 0.62 },
    { at: 0.66, attacks: ['cleave', 'sweep', 'combo', 'lunge', 'lance', 'flares', 'nova'], speed: 0.95, aggression: 0.75 },
    { at: 0.33, attacks: ['cleave', 'combo', 'lunge', 'lance', 'flares', 'nova', 'blacksun', 'summon'], speed: 1.05, aggression: 0.9 },
  ],
};

const SUN: [number, number, number, number] = [1, 0.72, 0.3, 4];

function sunHit(b: Boss, a: EnemyAttack, scale = 1): (v: Combatant) => DamageInfo {
  return (v) => {
    const dir = v.position.subtract(b.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2), poise: a.poise * scale, element: a.element ?? 'light', direction: dir,
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

const voids = new WeakMap<Boss, number>();

const KIT: Record<string, Special> = {
  // the sun-lance: fire torn across the dais in a straight line through Kael, from far behind him
  lance: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      const from = b.position;
      const dir = t.position.subtract(from);
      dir.y = 0;
      const len = dir.length();
      dir.scaleInPlace(1 / Math.max(len, 1e-3));
      const n = Math.ceil((len + 10) / 2.2);
      for (let i = 1; i <= n; i++) {
        const at = from.add(dir.scale(i * 2.2));
        b.ctx.hazards.eruption(ground(b, at), 1.6, 0.6 + i * 0.045, 'sunPillar', b, b.team, sunHit(b, a), { color: SUN, scorch: true });
      }
      b.ctx.shake(0.3);
    },
  },
  // flares: sunfire breaking out of the stone round Kael, one ring then another
  flares: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      const n = b.phase >= 1 ? 8 : 6;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const r = i % 2 ? 4.5 : 2.2;
        b.ctx.hazards.eruption(ground(b, t.position.add(new Vector3(Math.sin(ang) * r, 0, Math.cos(ang) * r))), 2.0, 1.0 + (i % 2) * 0.5, 'sunPillar', b, b.team, sunHit(b, a), { color: SUN, scorch: true });
      }
      b.ctx.hazards.eruption(ground(b, t.position), 2.2, 1.9, 'sunPillar', b, b.team, sunHit(b, a), { color: SUN, scorch: true });
    },
  },
  // the corona nova: a ring of light rolling outward from him
  nova: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('sunPillar', b.position, Vector3.Up(), 2);
      b.ctx.hazards.ring(b.position, 11, 26, 0.9, b, b.team, sunHit(b, a), SUN);
      if (b.phase >= 2) b.ctx.hazards.after(0.8, () => b.ctx.hazards.ring(b.position, 11, 26, 0.9, b, b.team, sunHit(b, a), SUN));
      b.ctx.shake(0.6);
    },
  },
  // the black sun: void orbs drift out of him while he holds it, and hunt Kael
  blacksun: {
    start(b) {
      voids.set(b, 0);
      b.ctx.vfx.burst('voidBurst', b.position.add(new Vector3(0, 4, 0)), Vector3.Up(), 2.5);
    },
    step(b, a, dt) {
      let acc = (voids.get(b) ?? 0) + dt;
      while (acc > 0.7) {
        acc -= 0.7;
        const ang = Math.random() * Math.PI * 2;
        const from = b.position.add(new Vector3(Math.sin(ang) * 2.5, 4.5 + Math.random() * 1.5, Math.cos(ang) * 2.5));
        const dir = new Vector3(Math.sin(ang), 0.4, Math.cos(ang));
        b.ctx.projectiles.fire('voidOrb', from, dir, b, b.team, (v, point) => ({ ...sunHit(b, a)(v), element: 'void', point }), b.target);
      }
      voids.set(b, acc);
    },
    end(b) {
      voids.delete(b);
    },
  },
  summon: {
    event(b, _a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('sunPillar', b.position.add(b.facing.scale(4)), Vector3.Up(), 1.4);
      b.spawnAdds?.(b.position.clone(), 3);
    },
  },
};

Boss.specials.aurelion = KIT;
