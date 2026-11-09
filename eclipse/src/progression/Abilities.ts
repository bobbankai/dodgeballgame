import { Vector3 } from '@babylonjs/core';
import type { Game } from '../game/Game';
import type { AbilitySlot, Player } from '../player/Player';
import type { Combatant, DamageInfo } from '../combat/Types';

/**
 * Godspark abilities: each god Kael defeats lends him part of its power. They cost aether (built by
 * fighting well: hits, parries, perfect dodges) and have cooldowns; the skill tree makes them cheaper
 * and stronger. Abilities are cast from slots 1-4 (and the ultimate, R).
 */
export interface AbilityDef {
  id: string;
  name: string;
  desc: string;
  spark: string;
  make(g: Game): AbilitySlot;
}

function fire(p: Player, base: number, poise: number, victim: Combatant, point: Vector3, extra: Partial<DamageInfo> = {}): DamageInfo {
  const dir = victim.position.subtract(p.position);
  dir.y = 0;
  dir.normalize();
  return {
    amount: base * p.mods.abilityDamage * (0.9 + Math.random() * 0.2), poise, element: 'fire', direction: dir, point,
    source: p, weight: 0.7, knockback: 1.6, parryable: false, ranged: true, status: { burn: 40 }, tag: 'ability', ...extra,
  };
}

export const ABILITIES: Record<string, AbilityDef> = {
  cinder_arc: {
    id: 'cinder_arc', name: 'Cinder Arc', spark: 'ignaroth',
    desc: 'Sweep Oathkeeper through the air and loose a crescent of fire that flies ahead and burns what it strikes.',
    make: (g) => ({
      name: 'Cinder Arc', clip: 'cast_arc', cost: 30, cooldown: 4, ready: 0,
      onRelease: (p) => {
        const fwd = p.char.forward;
        const from = p.position.add(new Vector3(0, 1.2, 0)).add(fwd.scale(0.8));
        const aim = p.target ? p.target.aimPoint(new Vector3()).subtract(from) : fwd;
        g.audio.play('fire_cast', { at: from, pitch: -2 });
        g.projectiles.fire('cinderArc', from, aim, p, p.team, (v, pt) => fire(p, 70, 55, v, pt), p.target);
      },
    }),
  },
  ember_burst: {
    id: 'ember_burst', name: 'Ember Burst', spark: 'ignaroth',
    desc: 'Drive the godspark into the ground: everything close is thrown back by a pillar of fire.',
    make: (g) => ({
      name: 'Ember Burst', clip: 'cast_slam', cost: 45, cooldown: 9, ready: 0,
      onRelease: (p) => {
        const at = p.position.clone();
        g.vfx.burst('firePillar', at, Vector3.Up(), 1.1);
        g.vfx.burst('emberSlam', at, Vector3.Up(), 1.6);
        g.ground.shockwave(at, 6, [1, 0.5, 0.15, 5], 0.5);
        g.ground.scorch(at, 3);
        g.rig.shake(0.5);
        g.combat.area(p, p.team, at.add(new Vector3(0, 0.8, 0)), 4.5, null, (v) => fire(p, 85, 90, v, v.position.clone(), { knockdown: true, knockback: 3, weight: 1 }));
      },
    }),
  },
};

/** Fills the player's slots with the abilities granted by the godsparks claimed so far. */
export function equipAbilities(g: Game, p: Player, sparks: string[]): void {
  const owned = Object.values(ABILITIES).filter((a) => sparks.includes(a.spark));
  p.abilities = [null, null, null, null];
  owned.slice(0, 4).forEach((a, i) => {
    p.abilities[i] = a.make(g);
  });
}
