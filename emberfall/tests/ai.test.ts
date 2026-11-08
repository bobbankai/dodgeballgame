import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { avoid, timeToCollision, type CrowdAgent } from '../src/ai/nav/Crowd';
import { Perception, LOUDNESS, type SightQuery } from '../src/ai/Perception';
import { v3 } from './helpers/TestWorld';

const agent = (x: number, z: number, vx = 0, vz = 0, radius = 0.35, priority = 0): CrowdAgent => ({ pos: v3(x, 0, z), vel: v3(vx, 0, vz), radius, priority });

describe('timeToCollision', () => {
  it('is the time until the discs touch when closing head on', () => {
    // 10 m apart, closing at 2 m/s, combined radius 1: touch after 4.5 s
    expect(timeToCollision(10, 0, 2, 0, 1)).toBeCloseTo(4.5);
  });
  it('is infinite when moving apart or passing wide', () => {
    expect(timeToCollision(10, 0, -2, 0, 1)).toBe(Infinity);
    expect(timeToCollision(10, 5, 2, 0, 1)).toBe(Infinity);
  });
  it('is zero when already overlapping', () => {
    expect(timeToCollision(0.5, 0, 1, 0, 1)).toBe(0);
  });
});

describe('crowd avoidance', () => {
  it('keeps the wish when nobody is near', () => {
    const out = avoid(agent(0, 0), v3(2, 0, 0), [agent(30, 0)], new THREE.Vector3());
    expect(out.x).toBeCloseTo(2);
    expect(out.z).toBeCloseTo(0);
  });

  it('turns aside for an agent standing in the way', () => {
    const me = agent(0, 0);
    const out = avoid(me, v3(2, 0, 0), [me, agent(1.5, 0)], new THREE.Vector3());
    // still makes progress, but no longer straight into the blocker
    expect(out.x).toBeGreaterThan(0);
    expect(Math.abs(Math.atan2(out.z, out.x))).toBeGreaterThan(0.2);
  });

  it('two agents meeting head on pass each other without colliding', () => {
    const a = agent(-5, 0.01, 1.5, 0), b = agent(5, -0.01, -1.5, 0);
    const wa = v3(1.5, 0, 0), wb = v3(-1.5, 0, 0);
    const va = new THREE.Vector3(), vb = new THREE.Vector3();
    let minD = Infinity;
    for (let i = 0; i < 300; i++) {
      avoid(a, wa, [a, b], va);
      avoid(b, wb, [a, b], vb);
      a.vel.copy(va); b.vel.copy(vb);
      a.pos.addScaledVector(va, 1 / 30);
      b.pos.addScaledVector(vb, 1 / 30);
      minD = Math.min(minD, a.pos.distanceTo(b.pos));
    }
    expect(minD).toBeGreaterThan(0.6);
    // and both got where they were going
    expect(a.pos.x).toBeGreaterThan(3);
    expect(b.pos.x).toBeLessThan(-3);
  });

  it('lets a high-priority agent keep its line while the other gives way', () => {
    const brute = agent(-4, 0, 2, 0, 0.5, 2), small = agent(4, 0, -2, 0, 0.35, 0);
    const vb = new THREE.Vector3(), vs = new THREE.Vector3();
    let bruteDev = 0, smallDev = 0;
    for (let i = 0; i < 120; i++) {
      avoid(brute, v3(2, 0, 0), [brute, small], vb);
      avoid(small, v3(-2, 0, 0), [brute, small], vs);
      brute.vel.copy(vb); small.vel.copy(vs);
      brute.pos.addScaledVector(vb, 1 / 30);
      small.pos.addScaledVector(vs, 1 / 30);
      bruteDev = Math.max(bruteDev, Math.abs(brute.pos.z));
      smallDev = Math.max(smallDev, Math.abs(small.pos.z));
    }
    expect(smallDev).toBeGreaterThan(bruteDev);
  });

  it('stops rather than walk into a wall of agents', () => {
    const me = agent(0, 0);
    const wall = [-1, -0.5, 0, 0.5, 1].map((z) => agent(0.75, z, 0, 0, 0.3));
    const out = avoid(me, v3(1.5, 0, 0), [me, ...wall], new THREE.Vector3());
    expect(out.x).toBeLessThan(0.6);
  });
});

describe('perception', () => {
  const open = () => 1e9; // nothing blocks
  const query = (target: THREE.Vector3, o: Partial<SightQuery> = {}): SightQuery => ({
    eye: v3(0, 1.6, 0), forward: v3(0, 0, 1), points: [target], speed: 0, light: 1, raycast: (_o, _d, far) => Math.min(far, open()), ...o,
  });

  it('sees a target straight ahead and not one far behind', () => {
    const p = new Perception({ range: 15 });
    expect(p.sightFactor(query(v3(0, 1.6, 6)))).toBeGreaterThan(0.6);
    expect(p.sightFactor(query(v3(0, 1.6, -8)))).toBe(0);
  });

  it('is weaker in the periphery and with distance', () => {
    const p = new Perception({ range: 15, fov: 100, peripheral: 200 });
    const centre = p.sightFactor(query(v3(0, 1.6, 6)));
    const edge = p.sightFactor(query(v3(6, 1.6, 1)));
    const far = p.sightFactor(query(v3(0, 1.6, 13)));
    expect(edge).toBeLessThan(centre);
    expect(far).toBeLessThan(centre);
  });

  it('feels a target right behind it (the near field)', () => {
    const p = new Perception({ near: 2.5 });
    expect(p.sightFactor(query(v3(0, 1.6, -1)))).toBeGreaterThan(0.3);
  });

  it('cover hides part of the body', () => {
    const p = new Perception();
    const t = v3(0, 1.6, 6);
    const pts = [t, v3(0, 2.1, 6), v3(0, 1.1, 6)];
    const full = p.sightFactor(query(t, { points: pts }));
    // a low wall: the hips and chest are hidden, the head is not
    const half = p.sightFactor(query(t, { points: pts, raycast: (o, d, far) => (o.y + d.y * far < 1.9 ? far * 0.5 : far) }));
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(full * 0.6);
  });

  it('darkness shortens the view', () => {
    const p = new Perception({ range: 16 });
    expect(p.sightFactor(query(v3(0, 1.6, 12), { light: 1 }))).toBeGreaterThan(0);
    expect(p.sightFactor(query(v3(0, 1.6, 12), { light: 0.2 }))).toBe(0);
  });

  it('fills the meter over time, faster for a moving target, and alerts', () => {
    const still = new Perception({ reaction: 1 });
    const moving = new Perception({ reaction: 1 });
    for (let i = 0; i < 10; i++) {
      still.update(1 / 30, query(v3(0, 1.6, 6), { speed: 0 }));
      moving.update(1 / 30, query(v3(0, 1.6, 6), { speed: 4 }));
    }
    expect(moving.awareness).toBeGreaterThan(still.awareness);
    for (let i = 0; i < 90; i++) moving.update(1 / 30, query(v3(0, 1.6, 6), { speed: 4 }));
    expect(moving.state).toBe('alerted');
    expect(moving.lastKnown.z).toBeCloseTo(6);
  });

  it('goes suspicious first, then calms down when the target vanishes', () => {
    const p = new Perception({ reaction: 2, forget: 3, suspicious: 0.3 });
    let t = 0;
    while (p.state === 'calm' && t < 5) { p.update(1 / 30, query(v3(0, 1.6, 10))); t += 1 / 30; }
    expect(p.state).toBe('suspicious');
    for (let i = 0; i < 400; i++) p.update(1 / 30, null);
    expect(p.state).toBe('calm');
    expect(p.awareness).toBe(0);
  });

  it('an alerted agent stays alerted for a while after losing sight', () => {
    const p = new Perception({ forget: 9 });
    p.set(1, v3(0, 0, 5));
    for (let i = 0; i < 60; i++) p.update(1 / 30, null);
    expect(p.state).toBe('alerted');
  });

  it('hears loud sounds near and ignores quiet far ones; walls muffle', () => {
    const p = new Perception();
    const ear = v3(0, 1.6, 0);
    expect(p.hear(v3(30, 0, 0), ear, LOUDNESS.walk)).toBe(0);
    const q = new Perception();
    expect(q.hear(v3(5, 0, 0), ear, LOUDNESS.clash)).toBeGreaterThan(0.4);
    const r = new Perception();
    expect(r.hear(v3(8, 0, 0), ear, LOUDNESS.run, 1)).toBe(0);
    // the heard position is remembered, the sight-less stimulus queued
    expect(q.lastKnown.x).toBeCloseTo(5);
    expect(q.consume()?.kind).toBe('sound');
    expect(q.consume()).toBeNull();
  });

  it('losing the target leaves the agent suspicious, not alerted or calm', () => {
    const p = new Perception();
    p.set(1, v3(0, 0, 5));
    p.lose(0.7);
    expect(p.state).toBe('suspicious');
    expect(p.awareness).toBeCloseTo(0.7);
    // one more clear look re-alerts
    for (let i = 0; i < 40; i++) p.update(1 / 30, query(v3(0, 1.6, 4), { speed: 3 }));
    expect(p.state).toBe('alerted');
  });

  it('a touch alerts at once with certainty', () => {
    const p = new Perception();
    p.touch(v3(1, 0, 1));
    expect(p.state).toBe('alerted');
    expect(p.certainty).toBe(1);
  });

  it('acuity scales everything', () => {
    const sharp = new Perception({ acuity: 1.5, range: 10 });
    const dull = new Perception({ acuity: 0.5, range: 10 });
    expect(sharp.sightFactor(query(v3(0, 1.6, 9)))).toBeGreaterThan(dull.sightFactor(query(v3(0, 1.6, 9))));
  });
});
