import { describe, expect, it } from 'vitest';
import { segSegDist2, sweptBladeHitsCapsule, sphereHitsCapsule, inCone } from '../src/combat/Geometry';
import { Stats } from '../src/combat/Stats';
import { Clock } from '../src/core/Clock';

const v = (x: number, y: number, z: number) => ({ x, y, z });

describe('segment distance', () => {
  it('parallel segments', () => {
    const r = segSegDist2(v(0, 0, 0), v(1, 0, 0), v(0, 1, 0), v(1, 1, 0));
    expect(Math.sqrt(r.d2)).toBeCloseTo(1);
  });
  it('crossing segments touch', () => {
    const r = segSegDist2(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 0), v(0, 1, 0));
    expect(r.d2).toBeCloseTo(0);
    expect(r.s).toBeCloseTo(0.5);
    expect(r.t).toBeCloseTo(0.5);
  });
  it('degenerate points', () => {
    const r = segSegDist2(v(0, 0, 0), v(0, 0, 0), v(3, 4, 0), v(3, 4, 0));
    expect(Math.sqrt(r.d2)).toBeCloseTo(5);
  });
  it('clamps to segment ends', () => {
    const r = segSegDist2(v(0, 0, 0), v(1, 0, 0), v(3, 0, 0), v(4, 0, 0));
    expect(Math.sqrt(r.d2)).toBeCloseTo(2);
  });
});

describe('swept blade', () => {
  const capA = v(0, 0, 2);
  const capB = v(0, 2, 2);
  it('hits a capsule the blade sweeps through', () => {
    // blade swings from left of the target to its right in one step
    const hit = sweptBladeHitsCapsule(v(-2, 1, 1), v(-2, 1, 3), v(2, 1, 1), v(2, 1, 3), 0.05, capA, capB, 0.3);
    expect(hit).not.toBeNull();
  });
  it('does not tunnel through a thin target at high speed', () => {
    const hit = sweptBladeHitsCapsule(v(-20, 1, 1.5), v(-20, 1, 2.5), v(20, 1, 1.5), v(20, 1, 2.5), 0.02, capA, capB, 0.15, 64);
    expect(hit).not.toBeNull();
  });
  it('misses when out of reach', () => {
    const hit = sweptBladeHitsCapsule(v(-2, 1, 4), v(-1, 1, 4), v(1, 1, 4), v(2, 1, 4), 0.05, capA, capB, 0.3);
    expect(hit).toBeNull();
  });
  it('sphere overlap', () => {
    expect(sphereHitsCapsule(v(0.5, 1, 2), 0.3, capA, capB, 0.3)).toBe(true);
    expect(sphereHitsCapsule(v(1.5, 1, 2), 0.3, capA, capB, 0.3)).toBe(false);
  });
  it('cone test', () => {
    expect(inCone(v(0, 0, 5), v(0, 0, 0), v(0, 0, 1), Math.cos(0.5), 10)).toBe(true);
    expect(inCone(v(5, 0, 0), v(0, 0, 0), v(0, 0, 1), Math.cos(0.5), 10)).toBe(false);
    expect(inCone(v(0, 0, 50), v(0, 0, 0), v(0, 0, 1), Math.cos(0.5), 10)).toBe(false);
  });
});

describe('stats', () => {
  it('damage, heal and death', () => {
    const s = new Stats({ health: 100 });
    expect(s.damage(30)).toBe(30);
    expect(s.health).toBe(70);
    s.heal(100);
    expect(s.health).toBe(100);
    s.damage(500);
    expect(s.alive).toBe(false);
    expect(s.health).toBe(0);
  });
  it('poise breaks and regenerates after a delay', () => {
    const s = new Stats({ health: 100, poise: 40 });
    expect(s.poiseDamage(25)).toBe(false);
    expect(s.poiseDamage(25)).toBe(true);
    s.update(1);
    expect(s.poise).toBe(0);
    s.update(2);
    expect(s.poise).toBeGreaterThan(0);
  });
  it('stamina refuses spends when nearly empty and regenerates', () => {
    const s = new Stats({ health: 100, stamina: 100 });
    expect(s.spend(80)).toBe(true);
    expect(s.spend(80)).toBe(false);
    for (let i = 0; i < 120; i++) s.update(1 / 60);
    expect(s.stamina).toBeGreaterThan(20);
  });
  it('aether gain caps', () => {
    const s = new Stats({ health: 1, aether: 50 });
    s.gainAether(80);
    expect(s.aether).toBe(50);
    expect(s.useAether(60)).toBe(false);
    expect(s.useAether(50)).toBe(true);
  });
});

describe('clock', () => {
  it('runs fixed steps from real time', () => {
    const c = new Clock();
    expect(c.accumulate(1 / 30)).toBe(2);
    expect(c.accumulate(0.01)).toBe(0);
    expect(c.accumulate(0.01)).toBe(1);
  });
  it('hit-stop slows the simulation for real seconds only', () => {
    const c = new Clock();
    c.hitStop(0.1);
    // during the 0.1 s of real time, almost no game time passes
    const n = c.accumulate(0.1);
    expect(n).toBeLessThanOrEqual(1);
    expect(c.inHitStop).toBe(false);
    expect(c.accumulate(0.1)).toBe(6);
  });
  it('caps long frames', () => {
    const c = new Clock();
    expect(c.accumulate(5)).toBe(Math.floor(Clock.MAX_FRAME / Clock.STEP));
  });
});
