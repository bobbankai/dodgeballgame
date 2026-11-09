import { Vector3 } from '@babylonjs/core';
import { Boss, type BossDef, type Special } from '../Boss';
import type { EnemyAttack } from '../Archetypes';
import type { Combatant, DamageInfo } from '../../combat/Types';

/**
 * Thaloryn, God of Tides: the drowned sea-king, risen to the waist from the flooded amphitheatre of
 * the Drowned Empire with a trident of verdigris bronze.
 *
 * Phase 1 (100-60%): trident thrusts and sweeps, a two-strike combo, and tidal waves sent rolling
 *   across the arena (jump the crest or dodge through it).
 * Phase 2 (60-25%): whirlpools open round Kael and drag him in; Thaloryn dives beneath the water and
 *   bursts up under him in a geyser.
 * Phase 3 (<25%): twin crossing waves, and he calls his drowned legion.
 */
export const THALORYN: BossDef = {
  title: 'The Drowned King',
  kit: 'thaloryn',
  archetype: {
    id: 'thaloryn', name: 'Thaloryn', model: 'thaloryn', weapon: 'trident', scale: 2.4,
    health: 3200, poise: 280, stamina: 999, radius: 0.5, height: 2.3,
    walk: 1.3, run: 4.2, strafe: 1.2, sight: 80, fov: 6.3, hearing: 80,
    aggression: 0.7, block: 0, dodge: 0, holdRange: 3, heavy: true, executable: false,
    xp: 1900, aether: 70,
    resist: { water: 0.1, fire: 0.8, lightning: 1.5, physical: 0.9 },
    attacks: [
      { id: 'thrust', clip: 'sprint_attack', speed: 0.8, damage: 52, poise: 60, weight: 0.9, knockback: 2, element: 'water', range: [0, 6], cooldown: 3.5, score: 1, parryable: true, track: 4, trackTime: 0.45, lunge: 0.7, armour: true, hit: { kind: 'weapon' }, tell: 'glint', status: { soak: 40 } },
      { id: 'sweep', clip: 'heavy_2', speed: 0.8, damage: 44, poise: 60, weight: 0.9, knockback: 2.6, element: 'water', range: [0, 4.5], cooldown: 4, score: 1, parryable: false, knockdown: true, track: 3, trackTime: 0.4, armour: true, hit: { kind: 'weapon' }, status: { soak: 30 } },
      { id: 'combo', clip: 'light_1', speed: 0.85, damage: 36, poise: 40, weight: 0.7, knockback: 1, range: [0, 4], cooldown: 2.8, score: 0.9, parryable: true, track: 4, trackTime: 0.3, next: ['combo2'], chain: 0.8, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo2', clip: 'light_2', speed: 0.85, damage: 40, poise: 46, weight: 0.8, knockback: 1.6, range: [0, 4.2], cooldown: 3, score: 0, parryable: true, track: 3, trackTime: 0.3, armour: true, hit: { kind: 'weapon' } },
      { id: 'tidal', clip: 'cast_arc', speed: 0.75, damage: 46, poise: 70, weight: 0.9, knockback: 3, element: 'water', range: [4, 30], cooldown: 7, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 6, trackTime: 0.6, armour: true, hit: { kind: 'none' }, tell: 'red', status: { soak: 50 } },
      { id: 'whirlpool', clip: 'cast_heal', speed: 0.8, damage: 14, poise: 0, weight: 0.2, knockback: 0, element: 'water', range: [0, 30], cooldown: 12, score: 1, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' }, status: { soak: 25 } },
      { id: 'submerge', clip: 'kneel', speed: 0.45, damage: 58, poise: 90, weight: 1, knockback: 3.5, element: 'water', range: [3, 30], cooldown: 14, score: 1.2, parryable: false, unblockable: true, knockdown: true, track: 0, trackTime: 0, armour: true, hit: { kind: 'none' } },
      { id: 'twin', clip: 'cast_slam', speed: 0.8, damage: 46, poise: 70, weight: 0.9, knockback: 3, element: 'water', range: [3, 30], cooldown: 10, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 5, trackTime: 0.5, armour: true, hit: { kind: 'none' }, tell: 'red' },
      { id: 'summon', clip: 'cast_push', speed: 0.8, damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 40], cooldown: 30, score: 2, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' } },
    ],
  },
  phases: [
    { at: 1, attacks: ['thrust', 'sweep', 'combo', 'tidal'], speed: 0.8, aggression: 0.55 },
    { at: 0.6, attacks: ['thrust', 'sweep', 'combo', 'tidal', 'whirlpool', 'submerge'], speed: 0.9, aggression: 0.7 },
    { at: 0.25, attacks: ['thrust', 'sweep', 'combo', 'whirlpool', 'submerge', 'twin', 'summon'], speed: 1, aggression: 0.85 },
  ],
};

function waterHit(b: Boss, a: EnemyAttack, scale = 1): (v: Combatant) => DamageInfo {
  return (v) => {
    const dir = v.position.subtract(b.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2), poise: a.poise * scale, element: 'water', direction: dir,
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

const dives = new WeakMap<Boss, { t: number; sunk: boolean; risen: boolean }>();

const KIT: Record<string, Special> = {
  // a wall of water rolls out at the player
  tidal: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      const dir = t ? t.position.subtract(b.position) : b.facing;
      b.ctx.vfx.burst('geyser', b.position.add(b.facing.scale(2)), Vector3.Up(), 1.2);
      b.ctx.hazards.wave(ground(b, b.position.add(b.facing.scale(3))), dir, 16, 1.9, 9, 34, b, b.team, waterHit(b, a));
      b.ctx.shake(0.4);
    },
  },
  // two waves from either side, crossing where the player stands
  twin: {
    event(b, a, e) {
      if (e.name !== 'release' && e.name !== 'impact') return;
      if (e.name === 'impact') return;
      const t = b.target;
      if (!t) return;
      const side = new Vector3(b.facing.z, 0, -b.facing.x);
      for (const s of [-1, 1]) {
        const from = ground(b, t.position.add(side.scale(s * 16)));
        b.ctx.hazards.wave(from, side.scale(-s), 18, 1.8, 10, 30, b, b.team, waterHit(b, a));
      }
      b.ctx.vfx.burst('geyser', b.position, Vector3.Up(), 1.4);
      b.ctx.shake(0.5);
    },
  },
  // whirlpools open round the player and drag them toward the eye
  whirlpool: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      const n = b.phase >= 2 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const c = ground(b, t.position.add(new Vector3(Math.sin(ang) * (2 + i * 2.5), 0, Math.cos(ang) * (2 + i * 2.5))));
        b.ctx.ground.telegraph(c, 4.5, 6, [0.25, 0.7, 1, 2.2]);
        b.ctx.hazards.pull(c, 5, 3.2, 6);
        b.ctx.hazards.zone(c, 1.2, 6, b, b.team, 0.5, waterHit(b, a));
        for (let k = 0; k < 6; k++) b.ctx.hazards.after(k, () => b.ctx.vfx.burst('splash', c, Vector3.Up(), 1.2));
      }
    },
  },
  // sinks beneath the water, then bursts up beneath the player
  submerge: {
    start(b) {
      dives.set(b, { t: 0, sunk: false, risen: false });
    },
    step(b, a, dt) {
      const d = dives.get(b);
      if (!d) return;
      d.t += dt;
      const root = b.char.model.root;
      if (d.t < 1.0) {
        root.position.y = -d.t * (b.def.height / 1.0) * 0.9;
        if (d.t > 0.6) b.hidden = true;
      } else if (!d.sunk) {
        d.sunk = true;
        const t = b.target;
        if (t) {
          const at = ground(b, t.position.add(new Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3)));
          b.ctx.hazards.eruption(at, 3.2, 1.2, 'geyser', b, b.team, waterHit(b, a), { color: [0.25, 0.75, 1, 3], scorch: false });
          b.ctx.hazards.after(1.2, () => {
            b.teleport(at);
            d.risen = true;
          });
        }
      } else if (d.risen) {
        root.position.y = Math.min(0, root.position.y + dt * b.def.height * 1.6);
        if (root.position.y >= -0.3) b.hidden = false;
      }
    },
    end(b) {
      b.char.model.root.position.y = 0;
      b.hidden = false;
      dives.delete(b);
    },
  },
  summon: {
    event(b, _a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('geyser', b.position, Vector3.Up(), 1.6);
      b.spawnAdds?.(b.position.clone(), 3);
    },
  },
};

Boss.specials.thaloryn = KIT;
