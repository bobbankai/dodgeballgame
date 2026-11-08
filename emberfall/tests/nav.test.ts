import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BinaryHeap } from '../src/ai/nav/BinaryHeap';
import { NavGrid, pointInPolygon, distanceToPolygon } from '../src/ai/nav/NavGrid';
import { AStar, pullString, pathLength } from '../src/ai/nav/AStar';
import { Navigation } from '../src/ai/nav/Navigation';
import { PathFollower } from '../src/ai/nav/PathFollower';
import { TestWorld, v3, rayBox } from './helpers/TestWorld';

const grid = (w: TestWorld, size = 20, extra: Partial<ConstructorParameters<typeof NavGrid>[1]> = {}) =>
  new NavGrid(w, { minX: -size / 2, minZ: -size / 2, maxX: size / 2, maxZ: size / 2, cell: 0.5, top: 40, bottom: -10, ...extra });

describe('BinaryHeap', () => {
  it('pops ids in key order', () => {
    const h = new BinaryHeap(2);
    const keys = [5, 3, 9, 1, 7, 2, 8, 6, 4, 0];
    keys.forEach((k, i) => h.push(i, k));
    const out: number[] = [];
    while (!h.empty) out.push(keys[h.pop()]);
    expect(out).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('decreases a key in place and ignores increases', () => {
    const h = new BinaryHeap();
    h.push(1, 10);
    h.push(2, 20);
    h.push(3, 30);
    h.push(3, 5);
    h.push(1, 50);
    expect(h.size).toBe(3);
    expect(h.pop()).toBe(3);
    expect(h.pop()).toBe(1);
    expect(h.keyOf(2)).toBe(20);
  });

  it('removes arbitrary ids and keeps the order', () => {
    const h = new BinaryHeap();
    for (let i = 0; i < 50; i++) h.push(i, (i * 37) % 50);
    for (let i = 0; i < 50; i += 3) h.remove(i);
    let last = -Infinity;
    while (!h.empty) {
      const k = h.peekKey();
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
      const id = h.pop();
      expect(id % 3).not.toBe(0);
    }
  });

  it('survives a large random workload', () => {
    const h = new BinaryHeap(4);
    const ref = new Map<number, number>();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 3000; i++) {
      const id = Math.floor(rnd() * 500), k = rnd() * 100;
      h.push(id, k);
      ref.set(id, Math.min(ref.get(id) ?? Infinity, k));
    }
    const sorted = [...ref.values()].sort((a, b) => a - b);
    const got: number[] = [];
    while (!h.empty) { got.push(h.peekKey()); h.pop(); }
    expect(got).toEqual(sorted);
  });
});

describe('TestWorld', () => {
  it('finds stacked surfaces from the top down', () => {
    const w = new TestWorld().box(-1, 2, -1, 1, 2.3, 1);
    expect(w.ground(0, 10, 0)).toBeCloseTo(2.3);
    const n = new THREE.Vector3();
    expect(w.ground(0, 2.27, 0, 50, n)).toBeCloseTo(2);
    expect(n.y).toBe(-1);
    expect(w.ground(0, 1.97, 0)).toBeCloseTo(0);
  });

  it('intersects rays with boxes', () => {
    const b = { min: v3(1, -1, -1), max: v3(2, 1, 1) };
    expect(rayBox(v3(0, 0, 0), v3(1, 0, 0), b)).toBeCloseTo(1);
    expect(rayBox(v3(0, 0, 0), v3(-1, 0, 0), b)).toBe(-1);
    expect(rayBox(v3(1.5, 0, 0), v3(1, 0, 0), b)).toBe(0);
  });
});

describe('polygon helpers', () => {
  const sq = [new THREE.Vector2(0, 0), new THREE.Vector2(4, 0), new THREE.Vector2(4, 4), new THREE.Vector2(0, 4)];
  it('tests containment', () => {
    expect(pointInPolygon(2, 2, sq)).toBe(true);
    expect(pointInPolygon(5, 2, sq)).toBe(false);
    expect(pointInPolygon(-0.1, 3, sq)).toBe(false);
  });
  it('measures distance to the boundary', () => {
    expect(distanceToPolygon(2, 2, sq)).toBeCloseTo(2);
    expect(distanceToPolygon(6, 2, sq)).toBeCloseTo(2);
  });
});

describe('NavGrid sampling', () => {
  it('marks flat open ground walkable and maps positions to nodes', () => {
    const g = grid(new TestWorld());
    const n = g.nodeAt(v3(1.1, 0, -2.3));
    expect(n).toBeGreaterThanOrEqual(0);
    const p = g.pos(n);
    expect(p.x).toBeCloseTo(1.25);
    expect(p.z).toBeCloseTo(-2.25);
    expect(p.y).toBeCloseTo(0);
  });

  it('rejects steep slopes', () => {
    const g = grid(new TestWorld((x) => (x > 2 ? (x - 2) * 3 : 0)));
    expect(g.walkable(g.nodeAt(v3(0, 0, 0)))).toBe(true);
    expect(g.layerNear(g.colX(5), g.colZ(0), 9, 2)).toBe(-1);
  });

  it('keeps a bridge deck and the ground beneath it as separate layers', () => {
    const w = new TestWorld().box(-1, 2.0, -5, 1, 2.2, 5);
    const g = grid(w);
    const ix = g.colX(0), iz = g.colZ(0);
    expect(g.heightOf(ix, iz, 0)).toBeCloseTo(2.2);
    expect(g.heightOf(ix, iz, 1)).toBeCloseTo(0);
  });

  it('drops a layer without headroom', () => {
    // a low slab: the ground beneath it is too cramped to stand on
    const w = new TestWorld().box(-1, 1.0, -1, 1, 1.2, 1);
    const g = grid(w);
    const ix = g.colX(0), iz = g.colZ(0);
    expect(g.heightOf(ix, iz, 0)).toBeCloseTo(1.2);
    expect(Number.isNaN(g.heightOf(ix, iz, 1))).toBe(true);
  });

  it('keeps the ground under a high lintel walkable and links it to its neighbours', () => {
    const w = new TestWorld().box(-2, 4.5, -0.25, 2, 5, 0.25);
    const g = grid(w);
    const under = g.nodeAt(v3(0, 0, 0));
    expect(g.pos(under).y).toBeCloseTo(0);
    expect(g.neighbor(under, 2)).toBeGreaterThanOrEqual(0);
    expect(g.neighbor(under, 6)).toBeGreaterThanOrEqual(0);
  });

  it('respects the bounds', () => {
    const g = grid(new TestWorld(), 20, { inside: (x) => x < 3 });
    expect(g.nodeAt(v3(0, 0, 0), 0)).toBeGreaterThanOrEqual(0);
    expect(g.nodeAt(v3(5, 0, 0), 0)).toBe(-1);
  });

  it('builds tiles lazily', () => {
    const g = grid(new TestWorld(), 40);
    expect(g.stats.tiles).toBe(0);
    g.nodeAt(v3(0, 0, 0), 0);
    expect(g.stats.tiles).toBe(1);
    g.want(v3(0, 0, 0), 9);
    g.warm(1000);
    expect(g.stats.tiles).toBeGreaterThan(4);
  });
});

describe('NavGrid links', () => {
  it('blocks links through a wall but not along it', () => {
    const w = new TestWorld().wallX(-5, 5, 0.0);
    const g = grid(w);
    const a = g.nodeAt(v3(0.25, 0, -0.25));
    expect(g.neighbor(a, 2)).toBe(-1); // north, through the wall
    expect(g.neighbor(a, 0)).toBeGreaterThanOrEqual(0); // east, along it
  });

  it('allows steps up to the step height and refuses taller ones', () => {
    const w = new TestWorld().box(0, 0, -5, 5, 0.3, 5).box(0, 0, 6, 5, 1.2, 9);
    const g = grid(w, 24);
    const low = g.nodeAt(v3(-0.25, 0, 0));
    expect(g.neighbor(low, 0)).toBeGreaterThanOrEqual(0);
    const low2 = g.nodeAt(v3(-0.25, 0, 7));
    expect(g.neighbor(low2, 0)).toBe(-1);
  });

  it('does not cut corners diagonally', () => {
    const w = new TestWorld().box(0, -1, 0, 3, 3, 3);
    const g = grid(w);
    const a = g.nodeAt(v3(-0.25, 0, -0.25));
    // NE runs into the box's corner: forbidden
    expect(g.neighbor(a, 1)).toBe(-1);
  });

  it('links are symmetric', () => {
    const w = new TestWorld((x, z) => Math.sin(x * 0.4) * 0.3 + Math.cos(z * 0.3) * 0.3).wallZ(-3, 3, 1.1);
    const g = grid(w);
    for (const p of [v3(0, 0, 0), v3(-2, 0, 1), v3(1.7, 0, -2)]) {
      const a = g.nodeAt(p);
      for (let d = 0; d < 8; d++) {
        const b = g.neighbor(a, d);
        if (b < 0) continue;
        expect(g.neighbor(b, (d + 4) % 8)).toBe(a);
      }
    }
  });

  it('counts walls around a node', () => {
    const w = new TestWorld().wallX(-5, 5, 0.0);
    const g = grid(w);
    expect(g.wallCount(g.nodeAt(v3(0.25, 0, -0.25)))).toBeGreaterThanOrEqual(3);
    expect(g.wallCount(g.nodeAt(v3(0.25, 0, -4.25)))).toBe(0);
  });
});

describe('walkLine', () => {
  it('reaches a point across open ground', () => {
    const g = grid(new TestWorld());
    const a = g.nodeAt(v3(-4, 0, -4));
    const end = g.walkLine(a, 4, 3);
    expect(end).toBeGreaterThanOrEqual(0);
    expect(g.ixOf(end)).toBe(g.colX(4));
    expect(g.izOf(end)).toBe(g.colZ(3));
  });

  it('is blocked by a wall in between', () => {
    const g = grid(new TestWorld().wallZ(-3, 3, 0));
    const a = g.nodeAt(v3(-2, 0, 0));
    expect(g.walkLine(a, 2, 0)).toBe(-1);
    expect(g.walkLine(a, -2, 2.9)).toBeGreaterThanOrEqual(0);
  });

  it('crosses a bridge on its deck layer', () => {
    // a river trench with a bridge over it
    const w = new TestWorld((x, z) => (Math.abs(z) < 2 ? -2 : 0)).box(-1, -0.3, -2.5, 1, 0.0, 2.5);
    const g = grid(w);
    const a = g.nodeAt(v3(0, 0, -4));
    const end = g.walkLine(a, 0, 4);
    expect(end).toBeGreaterThanOrEqual(0);
    // beside the bridge the trench is impassable
    const b = g.nodeAt(v3(3, 0, -4));
    expect(g.walkLine(b, 3, 4)).toBe(-1);
  });
});

describe('AStar', () => {
  it('finds the straight path on open ground with near-optimal cost', () => {
    const g = grid(new TestWorld());
    const s = new AStar(g);
    const a = g.nodeAt(v3(-4, 0, 0)), b = g.nodeAt(v3(4, 0, 0));
    const r = s.search(a, b, { wallPenalty: 0 });
    expect(r.complete).toBe(true);
    expect(r.cost).toBeCloseTo(8, 1);
    expect(r.nodes[0]).toBe(a);
    expect(r.nodes[r.nodes.length - 1]).toBe(b);
  });

  it('goes around a wall through the gap', () => {
    // a wall across the field with a gap at its east end
    const w = new TestWorld().wallX(-10, 3, 0);
    const g = grid(w, 24);
    const s = new AStar(g);
    const r = s.search(g.nodeAt(v3(-3, 0, -3)), g.nodeAt(v3(-3, 0, 3)));
    expect(r.complete).toBe(true);
    // every step is a real link
    for (let i = 1; i < r.nodes.length; i++) {
      let linked = false;
      for (let d = 0; d < 8; d++) if (g.neighbor(r.nodes[i - 1], d) === r.nodes[i]) linked = true;
      expect(linked).toBe(true);
    }
    // the path passes the gap east of x = 3
    const maxX = Math.max(...r.nodes.map((n) => g.cx(g.ixOf(n))));
    expect(maxX).toBeGreaterThan(3);
  });

  it('returns the closest partial path when the goal is walled off', () => {
    const w = new TestWorld().wallX(-3, 3, 2).wallX(-3, 3, 6).wallZ(2, 6, -3).wallZ(2, 6, 3);
    const g = grid(w, 24);
    const s = new AStar(g);
    const r = s.search(g.nodeAt(v3(0, 0, -5)), g.nodeAt(v3(0, 0, 4)), { maxExpand: 5000 });
    expect(r.complete).toBe(false);
    // it stops at the reachable node nearest the goal: just outside the box, on whichever side is closer
    const end = g.pos(r.nodes[r.nodes.length - 1]);
    const outside = end.z < 2 || end.z > 6 || Math.abs(end.x) > 3;
    expect(outside).toBe(true);
    expect(Math.hypot(end.x - 0.25, end.z - 4.25)).toBeLessThan(3.2);
  });

  it('respects forbidden nodes', () => {
    const g = grid(new TestWorld());
    const s = new AStar(g);
    const forbid = (id: number) => (Math.abs(g.cx(g.ixOf(id))) < 1 && g.cz(g.izOf(id)) > -3 ? Infinity : 0);
    const r = s.search(g.nodeAt(v3(-4, 0, 0)), g.nodeAt(v3(4, 0, 0)), { extraCost: forbid });
    expect(r.complete).toBe(true);
    expect(r.nodes.every((n) => forbid(n) === 0)).toBe(true);
  });

  it('stops within reach of the goal', () => {
    const g = grid(new TestWorld());
    const s = new AStar(g);
    const r = s.search(g.nodeAt(v3(-4, 0, 0)), g.nodeAt(v3(4, 0, 0)), { reach: 2 });
    expect(r.complete).toBe(true);
    const end = g.pos(r.nodes[r.nodes.length - 1]);
    expect(Math.abs(end.x - 4.25)).toBeLessThanOrEqual(2.1);
  });
});

describe('pullString', () => {
  it('reduces a straight path to its ends', () => {
    const g = grid(new TestWorld());
    const r = new AStar(g).search(g.nodeAt(v3(-4, 0, -4)), g.nodeAt(v3(4, 0, 3)), { wallPenalty: 0 });
    const s = pullString(g, r.nodes);
    expect(s.length).toBe(2);
  });

  it('keeps the corner around a wall and stays walkable', () => {
    const w = new TestWorld().wallX(-10, 3, 0);
    const g = grid(w, 24);
    const r = new AStar(g).search(g.nodeAt(v3(-3, 0, -3)), g.nodeAt(v3(-3, 0, 3)));
    const s = pullString(g, r.nodes);
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s.length).toBeLessThan(r.nodes.length);
    for (let i = 1; i < s.length; i++) {
      const n = s[i];
      expect(g.walkLine(s[i - 1], g.cx(g.ixOf(n)), g.cz(g.izOf(n)))).toBe(n);
    }
    expect(pathLength(g, s)).toBeLessThanOrEqual(pathLength(g, r.nodes) + 1e-6);
  });
});

describe('Navigation and PathFollower', () => {
  const field = () => {
    const w = new TestWorld().wallX(-10, 3, 0);
    return new Navigation(w, { minX: -12, minZ: -12, maxX: 12, maxZ: 12 }, null, { margin: 0 });
  };

  it('plans in world space, starting at the agent and ending at the goal', () => {
    const nav = field();
    const r = nav.plan(v3(-3, 0, -3), v3(-3, 0, 3))!;
    expect(r.complete).toBe(true);
    expect(r.points[0].x).toBeCloseTo(-3);
    expect(r.points[r.points.length - 1].z).toBeCloseTo(3);
    expect(r.length).toBeGreaterThan(12);
  });

  it('answers straight-line questions', () => {
    const nav = field();
    expect(nav.canWalk(v3(-3, 0, -3), v3(2, 0, -5))).toBe(true);
    expect(nav.canWalk(v3(-3, 0, -3), v3(-3, 0, 3))).toBe(false);
  });

  it('defers plans once the frame budget is spent', () => {
    const w = new TestWorld().wallX(-10, 3, 0);
    const nav = new Navigation(w, { minX: -12, minZ: -12, maxX: 12, maxZ: 12 }, null, { margin: 0, frameBudget: 30 });
    let deferred = 0;
    for (let i = 0; i < 5; i++) if (!nav.plan(v3(-3, 0, -3), v3(-3, 0, 3))) deferred++;
    expect(deferred).toBeGreaterThan(0);
    nav.update(0);
    expect(nav.plan(v3(-3, 0, -3), v3(-3, 0, -2))).not.toBeNull();
  });

  it('walks an agent around a wall to its goal', () => {
    const nav = field();
    const f = new PathFollower(nav, { arrive: 0.4 });
    const pos = v3(-3, 0, -3);
    const goal = v3(-3, 0, 3);
    const dir = new THREE.Vector3();
    let t = 0;
    let arrived = false;
    for (let i = 0; i < 900 && !arrived; i++) {
      t += 1 / 30;
      nav.update(0);
      const m = f.steer(pos, goal, t, dir);
      if (m === 'arrived') { arrived = true; break; }
      // move, but never through the wall (the plane z = 0 for x < 3): slide along it like the real collision
      const nx = pos.x + dir.x * 3 / 30, nz = pos.z + dir.z * 3 / 30;
      if (nx < 3.0 && Math.sign(nz) !== Math.sign(pos.z) && pos.z !== 0) { pos.x = nx; continue; }
      pos.set(nx, 0, nz);
    }
    expect(arrived).toBe(true);
    expect(pos.distanceTo(goal)).toBeLessThan(0.6);
  });

  it('goes direct when nothing is in the way', () => {
    const nav = field();
    const f = new PathFollower(nav);
    const dir = new THREE.Vector3();
    expect(f.steer(v3(-3, 0, -3), v3(3, 0, -6), 0, dir)).toBe('direct');
    expect(dir.x).toBeGreaterThan(0.8);
  });

  it('sidesteps when it makes no progress', () => {
    const nav = field();
    const f = new PathFollower(nav);
    const dir = new THREE.Vector3();
    const pos = v3(-3, 0, -3);
    let sawSidestep = false;
    for (let i = 0; i < 60; i++) {
      f.steer(pos, v3(3, 0, -6), i / 30, dir);
      // the agent never moves (pinned by something the grid does not know about)
      if (Math.abs(dir.x * 1 + dir.z * -0.45) < 0.6) sawSidestep = true;
    }
    expect(sawSidestep).toBe(true);
  });
});
