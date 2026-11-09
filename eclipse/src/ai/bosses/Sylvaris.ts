import { Vector3 } from '@babylonjs/core';
import { Boss, type BossDef, type Special } from '../Boss';
import type { EnemyAttack } from '../Archetypes';
import type { Combatant, DamageInfo } from '../../combat/Types';

/**
 * Sylvaris, Goddess of Growth: the heart of the Forgotten Sanctuary, crowned with living antlers,
 * a briar staff in her hand. Everything she touches grows, and everything that grows holds on.
 *
 * Phase 1 (100-62%): staff lash and thrust, a two-strike combo, a thicket of roots bursting along the
 *   ground toward Kael, and spore pods lobbed over him.
 * Phase 2 (62-30%): vines that drag him to her, and regrowth: she heals while she channels, unless her
 *   poise is broken.
 * Phase 3 (<30%): the bloomfield (thorns across the whole glade but a ring round her) and her thornbound.
 */
export const SYLVARIS: BossDef = {
  title: 'The Rot and the Bloom',
  kit: 'sylvaris',
  element: 'life',
  archetype: {
    id: 'sylvaris', name: 'Sylvaris', model: 'sylvaris', weapon: 'briar_staff', scale: 2.3,
    health: 4000, poise: 300, stamina: 999, radius: 0.5, height: 2.0,
    walk: 1.4, run: 4.4, strafe: 1.5, sight: 90, fov: 6.3, hearing: 90,
    aggression: 0.7, block: 0, dodge: 0, holdRange: 3.4, heavy: true, executable: false,
    xp: 2800, aether: 90, voice: 'roar_bloom',
    death: { vfx: 'deathBloom', color: [0.75, 1.0, 0.35], sound: 'bloom_dissolve' },
    resist: { life: 0.1, fire: 1.4, lightning: 1.0, water: 0.8, physical: 0.9 },
    attacks: [
      { id: 'lash', clip: 'heavy_2', speed: 0.8, damage: 48, poise: 60, weight: 0.85, knockback: 2.4, element: 'life', range: [0, 5.2], cooldown: 3.6, score: 1, parryable: false, knockdown: true, track: 3, trackTime: 0.4, armour: true, hit: { kind: 'weapon' }, tell: 'red', status: { root: 30 } },
      { id: 'thrust', clip: 'sprint_attack', speed: 0.85, damage: 50, poise: 55, weight: 0.85, knockback: 2, range: [0, 7], cooldown: 3.4, score: 1, parryable: true, track: 5, trackTime: 0.45, lunge: 0.8, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo', clip: 'light_1', speed: 0.9, damage: 36, poise: 40, weight: 0.7, knockback: 1, range: [0, 4.4], cooldown: 2.6, score: 0.9, parryable: true, track: 4, trackTime: 0.3, next: ['combo2'], chain: 0.8, armour: true, hit: { kind: 'weapon' }, tell: 'glint' },
      { id: 'combo2', clip: 'light_2', speed: 0.9, damage: 40, poise: 46, weight: 0.8, knockback: 1.6, range: [0, 4.6], cooldown: 3, score: 0, parryable: true, track: 3, trackTime: 0.3, armour: true, hit: { kind: 'weapon' }, status: { root: 25 } },
      { id: 'thicket', clip: 'cast_slam', speed: 0.8, damage: 42, poise: 60, weight: 0.8, knockback: 2, element: 'life', range: [3, 30], cooldown: 7, score: 1.1, parryable: false, unblockable: true, knockdown: true, track: 4, trackTime: 0.4, armour: true, hit: { kind: 'none' }, tell: 'red', status: { root: 60 } },
      { id: 'spores', clip: 'cast_arc', speed: 0.85, damage: 26, poise: 20, weight: 0.4, knockback: 0.8, element: 'life', range: [5, 30], cooldown: 6, score: 1.0, parryable: false, track: 6, trackTime: 0.5, armour: true, hit: { kind: 'none' }, status: { root: 35 } },
      { id: 'grasp', clip: 'cast_push', speed: 0.8, damage: 30, poise: 40, weight: 0.6, knockback: 1, element: 'life', range: [5, 22], cooldown: 9, score: 1.1, parryable: false, unblockable: true, track: 5, trackTime: 0.5, armour: true, hit: { kind: 'none' }, status: { root: 50 } },
      { id: 'regrowth', clip: 'cast_heal', speed: 0.45, damage: 0, poise: 0, weight: 0, knockback: 0, range: [6, 40], cooldown: 22, score: 1.3, parryable: false, track: 1, trackTime: 0.2, armour: false, hit: { kind: 'none' } },
      { id: 'bloomfield', clip: 'kneel', speed: 0.45, damage: 22, poise: 30, weight: 0.4, knockback: 1, element: 'life', range: [0, 40], cooldown: 18, score: 1.4, parryable: false, unblockable: true, track: 0, trackTime: 0, armour: true, hit: { kind: 'none' }, status: { root: 40 } },
      { id: 'summon', clip: 'cast_push', speed: 0.8, damage: 0, poise: 0, weight: 0, knockback: 0, range: [0, 40], cooldown: 30, score: 2, parryable: false, track: 2, trackTime: 0.3, armour: true, hit: { kind: 'none' } },
    ],
  },
  phases: [
    { at: 1, attacks: ['lash', 'thrust', 'combo', 'thicket', 'spores'], speed: 0.85, aggression: 0.6 },
    { at: 0.62, attacks: ['lash', 'thrust', 'combo', 'thicket', 'spores', 'grasp', 'regrowth'], speed: 0.92, aggression: 0.72 },
    { at: 0.3, attacks: ['thrust', 'combo', 'thicket', 'grasp', 'regrowth', 'bloomfield', 'summon'], speed: 1.0, aggression: 0.85 },
  ],
};

const GREEN: [number, number, number, number] = [0.55, 0.9, 0.25, 3];

function lifeHit(b: Boss, a: EnemyAttack, scale = 1): (v: Combatant) => DamageInfo {
  return (v) => {
    const dir = v.position.subtract(b.position);
    dir.y = 0;
    dir.normalize();
    return {
      amount: a.damage * scale * (0.9 + Math.random() * 0.2), poise: a.poise * scale, element: 'life', direction: dir,
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

const regrowing = new WeakMap<Boss, number>();
const blooms = new WeakMap<Boss, number>();

const KIT: Record<string, Special> = {
  // roots break the ground in a line from her feet to Kael's, one after another
  thicket: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      if (!t) return;
      const from = b.position;
      const to = t.position;
      const n = b.phase >= 1 ? 7 : 5;
      const side = new Vector3(to.z - from.z, 0, from.x - to.x).normalize();
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n;
        const at = Vector3.Lerp(from, to, k).add(side.scale(Math.sin(i * 1.7) * 0.8));
        b.ctx.hazards.eruption(ground(b, at), 2.0, 0.55 + i * 0.16, 'rootBurst', b, b.team, lifeHit(b, a), { color: GREEN, scorch: false });
      }
      b.ctx.shake(0.25);
    },
  },
  // spore pods lobbed over and round Kael
  spores: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      const from = b.position.add(new Vector3(0, 3.2, 0));
      const n = b.phase >= 1 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const aim = t ? t.position.add(new Vector3((i - (n - 1) / 2) * 2.2, 2.5, (Math.random() - 0.5) * 2)).subtract(from) : b.facing.clone();
        aim.y += aim.length() * 0.25;
        b.ctx.projectiles.fire('sporePod', from, aim, b, b.team, (v, point) => ({ ...lifeHit(b, a)(v), point }), i === 1 ? t : null);
      }
      b.ctx.vfx.burst('petals', from, b.facing, 0.8);
    },
  },
  // vines lash out and drag Kael in
  grasp: {
    event(b, a, e) {
      if (e.name !== 'release') return;
      const t = b.target;
      b.ctx.hazards.pull(b.position, 24, 7.5, 1.3);
      b.ctx.vfx.burst('rootBurst', b.position.add(b.facing.scale(2)), Vector3.Up(), 1.2);
      if (t) b.ctx.hazards.eruption(ground(b, t.position), 1.6, 0.35, 'rootBurst', b, b.team, lifeHit(b, a, 0.7), { color: GREEN, scorch: false });
      b.ctx.hazards.after(1.2, () => {
        for (const h of b.ctx.world.area(b, b.team, b.position.add(new Vector3(0, 1, 0)), 4.2, null, lifeHit(b, a))) b.ctx.hazards.onHit?.(h);
        b.ctx.vfx.burst('rootBurst', b.position, Vector3.Up(), 1.6);
      });
    },
  },
  // regrowth: she heals while she channels (a poise break stops it)
  regrowth: {
    start(b) {
      regrowing.set(b, 0);
      b.ctx.vfx.burst('petals', b.position.add(new Vector3(0, 3, 0)), Vector3.Up(), 2);
      b.ctx.ground.telegraph(b.position.clone(), 3.5, 3, GREEN);
    },
    step(b, _a, dt) {
      let acc = (regrowing.get(b) ?? 0) + dt;
      while (acc > 0.5) {
        acc -= 0.5;
        const s = b.stats;
        s.health = Math.min(s.maxHealth, s.health + s.maxHealth * 0.0075);
        b.ctx.vfx.burst('heal', b.position.add(new Vector3(0, 2, 0)), Vector3.Up(), 2);
      }
      regrowing.set(b, acc);
    },
    end(b) {
      regrowing.delete(b);
    },
  },
  // the bloomfield: thorns break out across the whole glade but a ring round her
  bloomfield: {
    start(b) {
      blooms.set(b, 0);
      b.ctx.ground.telegraph(b.position.clone(), 9, 1.2, [0.4, 1, 0.3, 2]);
      b.ctx.vfx.burst('petals', b.position.add(new Vector3(0, 2, 0)), Vector3.Up(), 3);
    },
    step(b, a, dt) {
      let acc = (blooms.get(b) ?? 0) + dt;
      while (acc > 0.3) {
        acc -= 0.3;
        const ang = Math.random() * Math.PI * 2;
        const r = 10 + Math.random() * 12;
        const at = b.position.add(new Vector3(Math.sin(ang) * r, 0, Math.cos(ang) * r));
        b.ctx.hazards.eruption(ground(b, at), 2.4, 0.8, 'rootBurst', b, b.team, lifeHit(b, a), { color: GREEN, scorch: false });
        const t = b.target;
        if (t && Vector3.Distance(t.position, b.position) > 9 && Math.random() < 0.35) {
          b.ctx.hazards.eruption(ground(b, t.position), 1.8, 0.8, 'rootBurst', b, b.team, lifeHit(b, a), { color: GREEN, scorch: false });
        }
      }
      blooms.set(b, acc);
    },
    end(b) {
      blooms.delete(b);
    },
  },
  summon: {
    event(b, _a, e) {
      if (e.name !== 'release') return;
      b.ctx.vfx.burst('rootBurst', b.position.add(b.facing.scale(4)), Vector3.Up(), 1.4);
      b.spawnAdds?.(b.position.clone(), 3);
    },
  },
};

Boss.specials.sylvaris = KIT;
