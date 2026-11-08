import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeDamage, postureDamage, regenRate, resistOf, CombatLog, MULT } from '../src/combat/DamageModel';
import { StatusEffects, inflictionOf } from '../src/combat/Status';
import { ProjectileSystem, solveBallistic, ballisticAt, PROJECTILES, type ProjectileHost } from '../src/combat/Projectiles';
import { Hazards, HAZARDS, type HazardTarget } from '../src/combat/Hazards';
import { segSegDist, bladeSweep, inCone, angleDiff } from '../src/game/Combat';
import type { Combatant, Hit, HitResult } from '../src/game/Combat';
import { makeBody } from '../src/game/World';
import { v3 } from './helpers/TestWorld';

describe('geometry helpers', () => {
  it('segment distance: parallel, crossing and skew segments', () => {
    expect(segSegDist(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0), v3(1, 1, 0))).toBeCloseTo(1);
    expect(segSegDist(v3(-1, 0, 0), v3(1, 0, 0), v3(0, -1, 0), v3(0, 1, 0))).toBeCloseTo(0);
    expect(segSegDist(v3(-1, 0, 0), v3(1, 0, 0), v3(0, -1, 2), v3(0, 1, 2))).toBeCloseTo(2);
    expect(segSegDist(v3(0, 0, 0), v3(0, 0, 0), v3(3, 4, 0), v3(3, 4, 0))).toBeCloseTo(5);
  });

  it('blade sweep catches a fast swing passing through a body', () => {
    const body = makeBody(v3(0, 0, 0));
    // the blade swings from far left to far right in one frame, through the body
    const hit = bladeSweep(v3(-1.5, 1.2, -0.2), v3(-1.5, 1.2, 0.8), v3(1.5, 1.2, -0.2), v3(1.5, 1.2, 0.8), body);
    expect(hit).not.toBeNull();
    const miss = bladeSweep(v3(-1.5, 1.2, 2), v3(-1.5, 1.2, 3), v3(1.5, 1.2, 2), v3(1.5, 1.2, 3), body);
    expect(miss).toBeNull();
  });

  it('cone test respects reach and facing', () => {
    const t = makeBody(v3(0, 0, 2));
    expect(inCone(v3(0, 0, 0), 0, t, 2.5, 0.6)).toBe(true);
    expect(inCone(v3(0, 0, 0), Math.PI, t, 2.5, 0.6)).toBe(false);
    expect(inCone(v3(0, 0, 0), 0, t, 1.0, 0.6)).toBe(false);
  });

  it('angle difference wraps', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2);
  });
});

describe('damage model', () => {
  it('applies resistances and weaknesses', () => {
    expect(resistOf({ fire: 0.5 }, 'fire')).toBe(0.5);
    expect(resistOf({ fire: 0.5 }, 'slash')).toBe(1);
    expect(computeDamage(20, 'fire', { fire: 0.5 }).amount).toBeCloseTo(10);
    const weak = computeDamage(20, 'fire', { fire: 1.5 });
    expect(weak.amount).toBeCloseTo(30);
    expect(weak.tags).toContain('weak');
  });

  it('stacks situational multipliers', () => {
    const r = computeDamage(10, 'slash', undefined, { backstab: true, staggered: true, roll: 1 });
    expect(r.amount).toBeCloseTo(10 * MULT.backstab * MULT.staggered);
    expect(r.tags).toEqual(['backstab', 'staggered']);
  });

  it('rolls criticals deterministically when given a roll', () => {
    expect(computeDamage(10, 'slash', undefined, { critChance: 0.2, roll: 0.1 }).crit).toBe(true);
    expect(computeDamage(10, 'slash', undefined, { critChance: 0.2, roll: 0.5 }).crit).toBe(false);
  });

  it('never shows zero for a connecting hit unless immune', () => {
    expect(computeDamage(10, 'fire', { fire: 0.001 }).amount).toBeGreaterThan(0);
    expect(computeDamage(10, 'fire', { fire: 0 }).amount).toBe(0);
  });

  it('posture: heavy and blocked hits break guard faster, toughness resists', () => {
    expect(postureDamage(10, { heavy: true })).toBeGreaterThan(postureDamage(10));
    expect(postureDamage(10, { blocked: true, guardBreak: 2 })).toBeCloseTo(24);
    expect(postureDamage(10, { toughness: 2 })).toBeCloseTo(5);
  });

  it('regeneration waits, then ramps', () => {
    expect(regenRate(10, 1)).toBe(0);
    expect(regenRate(10, 3.5)).toBeCloseTo(5);
    expect(regenRate(10, 10)).toBe(10);
  });

  it('logs damage and reports dps', () => {
    const log = new CombatLog(5);
    for (let i = 0; i < 10; i++) log.add(i, 'kaede', 'footman', 10, i % 2 ? 'slash' : 'fire');
    expect(log.size).toBe(5);
    expect(log.dealt(9, 2.5)).toBeCloseTo(30);
    expect(log.dps(9, 3, 'kaede')).toBeCloseTo(40 / 3);
    expect(Object.keys(log.byType()).sort()).toEqual(['fire', 'slash']);
  });
});

describe('status effects', () => {
  const make = () => new StatusEffects(() => 100);

  it('burn ticks damage over its duration and stacks intensity', () => {
    const s = make();
    s.apply('burn', 2, 1);
    let dmg = 0;
    for (let i = 0; i < 60; i++) dmg += s.update(1 / 30);
    expect(dmg).toBeCloseTo(s.t.burnDps * 2, 0);
    expect(s.has('burn')).toBe(false);
    s.apply('burn', 2, 1);
    s.apply('burn', 2, 1);
    expect(s.s.burn.level).toBe(2);
    s.apply('burn', 2, 5);
    expect(s.s.burn.level).toBe(s.t.burnMaxLevel);
    // level 0 refreshes the duration without stacking
    const r = make();
    r.apply('burn', 2, 0);
    r.apply('burn', 3, 0);
    expect(r.s.burn.level).toBe(1);
    expect(r.s.burn.time).toBeCloseTo(3);
  });

  it('water puts fire out faster', () => {
    const dry = make(), wet = make();
    wet.wet = true;
    dry.apply('burn', 4); wet.apply('burn', 4);
    let a = 0, b = 0;
    for (let i = 0; i < 120; i++) { a += dry.update(1 / 30); b += wet.update(1 / 30); }
    expect(b).toBeLessThan(a * 0.5);
  });

  it('bleed builds up and bursts for a share of max health', () => {
    const triggers: string[] = [];
    const s = new StatusEffects(() => 200, {}, { onTrigger: (k) => triggers.push(k) });
    s.apply('bleed', 60);
    expect(s.update(1 / 30)).toBe(0);
    s.apply('bleed', 50);
    const burst = s.update(1 / 30);
    expect(burst).toBeCloseTo(200 * s.t.bleedBurst);
    expect(triggers).toContain('bleed');
    expect(s.s.bleed.build).toBe(0);
  });

  it('frost chills when full and slows', () => {
    const s = make();
    expect(s.speedFactor).toBe(1);
    s.apply('frost', 120);
    s.update(1 / 30);
    expect(s.has('frost')).toBe(true);
    expect(s.speedFactor).toBeCloseTo(1 - s.t.chillSlow);
    for (let i = 0; i < 30 * 6; i++) s.update(1 / 30);
    expect(s.speedFactor).toBe(1);
  });

  it('meters drain when left alone', () => {
    const s = make();
    s.apply('frost', 50);
    for (let i = 0; i < 30 * 20; i++) s.update(1 / 30);
    expect(s.s.frost.build).toBe(0);
  });

  it('blight halves healing and stops the Ember refilling', () => {
    const s = make();
    s.apply('blight', 3);
    expect(s.healFactor).toBeCloseTo(0.5);
    expect(s.emberRegen).toBe(false);
    for (let i = 0; i < 30 * 4; i++) s.update(1 / 30);
    expect(s.healFactor).toBe(1);
    expect(s.emberRegen).toBe(true);
  });

  it('resistance scales and immunity blocks', () => {
    const s = make();
    s.resist = { burn: 0, frost: 0.5 };
    s.apply('burn', 5);
    expect(s.has('burn')).toBe(false);
    s.apply('frost', 100);
    expect(s.s.frost.build).toBe(50);
  });

  it('reports a view for the HUD and clears', () => {
    const s = make();
    s.apply('burn', 4);
    s.apply('bleed', 30);
    const v = s.view();
    expect(v.map((x) => x.kind).sort()).toEqual(['bleed', 'burn']);
    s.clear();
    expect(s.view()).toEqual([]);
  });

  it('maps damage types to inflictions', () => {
    expect(inflictionOf('fire', 10, false)?.kind).toBe('burn');
    expect(inflictionOf('slash', 10, true)?.kind).toBe('bleed');
    expect(inflictionOf('blunt', 10, true)).toBeNull();
  });
});

describe('ballistics', () => {
  it('hits a fixed target with both the flat and the lobbed arc', () => {
    const from = v3(0, 1.5, 0), to = v3(12, 0.5, 3);
    for (const high of [false, true]) {
      const s = solveBallistic(from, to, null, 14, 9.8, high)!;
      expect(s).not.toBeNull();
      const at = ballisticAt(from, s.vel, 9.8, s.time);
      expect(at.distanceTo(to)).toBeLessThan(0.05);
      expect(s.vel.length()).toBeCloseTo(14, 3);
    }
    const flat = solveBallistic(from, to, null, 14, 9.8, false)!, lob = solveBallistic(from, to, null, 14, 9.8, true)!;
    expect(lob.time).toBeGreaterThan(flat.time);
  });

  it('leads a moving target', () => {
    const from = v3(0, 1.5, 0), to = v3(10, 1, 0), vel = v3(0, 0, 3);
    const s = solveBallistic(from, to, vel, 20, 9.8)!;
    const target = to.clone().addScaledVector(vel, s.time);
    expect(ballisticAt(from, s.vel, 9.8, s.time).distanceTo(target)).toBeLessThan(0.1);
  });

  it('reports out-of-range targets', () => {
    expect(solveBallistic(v3(0, 0, 0), v3(100, 0, 0), null, 10, 9.8)).toBeNull();
  });

  it('flies straight without gravity', () => {
    const s = solveBallistic(v3(0, 0, 0), v3(0, 3, 4), null, 10, 0)!;
    expect(s.time).toBeCloseTo(0.5);
    expect(s.vel.y).toBeCloseTo(6);
  });
});

/** a minimal fighter for projectile tests */
function fighter(team: 'player' | 'enemy', pos: THREE.Vector3, react: HitResult = 'hit'): Combatant & { hits: Hit[] } {
  const f = {
    team, name: team, char: {} as never, body: makeBody(pos), hp: 100, maxHp: 100, dead: false, yaw: 0, hits: [] as Hit[],
    targetable: () => true,
    receive(h: Hit): HitResult { f.hits.push(h); if (react === 'hit') f.hp -= h.damage; return react; },
    center: (out = new THREE.Vector3()) => out.set(f.body.pos.x, f.body.pos.y + 1.2, f.body.pos.z),
  };
  return f;
}

function host(fighters: Combatant[], wallZ = Infinity): ProjectileHost & { impacts: number } {
  const h = {
    impacts: 0,
    raycast: (o: THREE.Vector3, d: THREE.Vector3, far: number) => {
      // a wall across the field at z = wallZ
      if (wallZ === Infinity || Math.abs(d.z) < 1e-6) return far;
      const t = (wallZ - o.z) / d.z;
      return t >= 0 && t < far ? t : far;
    },
    targets: (team: string) => fighters.filter((f) => f.team !== team),
    impact: () => { h.impacts++; },
  };
  return h;
}

describe('projectile system', () => {
  it('a thrown pot reaches its target and hits it, splashing others', () => {
    const thrower = fighter('enemy', v3(0, 0, 0));
    const victim = fighter('player', v3(0, 0, 10));
    const other = fighter('player', v3(1.2, 0, 10.4));
    const sys = new ProjectileSystem(host([thrower, victim, other]));
    const p = sys.throwAt('firepot', v3(0, 1.6, 0), victim, null, 'enemy', thrower)!;
    expect(p).not.toBeNull();
    for (let i = 0; i < 300 && !p.dead; i++) sys.update(1 / 60);
    expect(p.dead).toBe(true);
    expect(victim.hits.length + other.hits.length).toBeGreaterThan(0);
    expect(sys.stats.hits + (sys.host as { impacts: number }).impacts).toBeGreaterThan(0);
  });

  it('does not tunnel through a body at high speed', () => {
    const victim = fighter('player', v3(0, 0, 5));
    const sys = new ProjectileSystem(host([victim]));
    // an arrow covering 2 m per frame straight through the body
    sys.spawn('arrow', v3(0, 1.2, 0), v3(0, 0, 120), 'enemy', null);
    for (let i = 0; i < 10; i++) sys.update(1 / 60);
    expect(victim.hits.length).toBe(1);
  });

  it('stops at a wall in front of the target', () => {
    const victim = fighter('player', v3(0, 0, 10));
    const h = host([victim], 5);
    const sys = new ProjectileSystem(h);
    sys.spawn('arrow', v3(0, 1.2, 0), v3(0, 0, 40), 'enemy', null);
    for (let i = 0; i < 60; i++) sys.update(1 / 60);
    expect(victim.hits.length).toBe(0);
    expect(h.impacts).toBe(1);
  });

  it('a parry sends it back to the thrower', () => {
    const thrower = fighter('enemy', v3(0, 0, 0));
    const parrier = fighter('player', v3(0, 0, 8), 'parried');
    const sys = new ProjectileSystem(host([thrower, parrier]));
    const p = sys.spawn('arrow', v3(0, 1.2, 0.6), v3(0, 0, 30), 'enemy', thrower);
    for (let i = 0; i < 90 && !p.dead; i++) sys.update(1 / 60);
    expect(sys.stats.reflected).toBe(1);
    expect(thrower.hits.length).toBe(1);
    expect(thrower.hits[0].damage).toBeGreaterThan(PROJECTILES.arrow.damage);
  });

  it('a dodged projectile flies on', () => {
    const dodger = fighter('player', v3(0, 0, 5), 'dodged');
    const behind = fighter('player', v3(0, 0, 9));
    const sys = new ProjectileSystem(host([dodger, behind]));
    sys.spawn('blackfire', v3(0, 1.2, 0), v3(0, 0, 16), 'enemy', null);
    for (let i = 0; i < 90; i++) sys.update(1 / 60);
    expect(dodger.hits.length).toBe(1);
    expect(behind.hits.length).toBe(1);
  });

  it('throws as far as it can at a target just out of reach', () => {
    const thrower = fighter('enemy', v3(0, 0, 0));
    const far = fighter('player', v3(0, 0, 40));
    const sys = new ProjectileSystem(host([thrower, far]));
    const p = sys.throwAt('firepot', v3(0, 1.6, 0), far, null, 'enemy', thrower);
    expect(p).not.toBeNull();
    expect(p!.vel.z).toBeGreaterThan(0);
    expect(p!.vel.y).toBeCloseTo(p!.vel.z, 3);
  });

  it('expires after its lifetime', () => {
    const sys = new ProjectileSystem(host([]));
    sys.spawn('blackfire', v3(0, 50, 0), v3(0, 0, 1), 'enemy', null);
    for (let i = 0; i < 60 * 5; i++) sys.update(1 / 60);
    expect(sys.list.length).toBe(0);
    expect(sys.stats.expired).toBe(1);
  });
});

describe('hazards', () => {
  const target = (x: number, z: number): HazardTarget & { got: string[] } => {
    const t = { body: { pos: v3(x, 0, z), radius: 0.3 }, dead: false, got: [] as string[], afflict: (k: string) => { t.got.push(k); } };
    return t;
  };

  it('afflicts those inside at its rate and nobody outside', () => {
    const hz = new Hazards();
    hz.add(HAZARDS.oil, v3(0, 0, 0), 2, 3);
    const inside = target(0.5, 0), outside = target(4, 0);
    for (let i = 0; i < 30; i++) hz.update(1 / 30, [inside, outside]);
    expect(inside.got.length).toBe(2);
    expect(outside.got.length).toBe(0);
  });

  it('expires and shrinks at the end', () => {
    const hz = new Hazards();
    const z = hz.add(HAZARDS.oil, v3(0, 0, 0), 2, 1.5);
    hz.update(1.2, []);
    expect(hz.strength(z)).toBeLessThan(0.5);
    hz.update(0.5, []);
    expect(hz.zones.length).toBe(0);
  });

  it('renews an overlapping pool instead of stacking', () => {
    const hz = new Hazards();
    hz.add(HAZARDS.oil, v3(0, 0, 0), 2, 3);
    hz.add(HAZARDS.oil, v3(0.3, 0, 0), 2, 3);
    expect(hz.zones.length).toBe(1);
    expect(hz.inside(v3(0.2, 0.2, 0.2), 'burn')).toBe(true);
    expect(hz.inside(v3(0.2, 3, 0.2), 'burn')).toBe(false);
  });
});
