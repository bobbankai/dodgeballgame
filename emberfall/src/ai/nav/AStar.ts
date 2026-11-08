// A* over the navigation grid. Octile distance is the heuristic (admissible: every step costs at least its
// planar length); nodes next to walls cost a little more so paths keep off the walls of corridors and
// doorways; an optional extra cost per node lets callers steer around danger (lava, the player's reach).
// The search is bounded: past `maxExpand` settled nodes it gives up and returns the path to the node that
// got closest, so an agent still walks the right way towards an unreachable or very distant goal.
import { BinaryHeap } from './BinaryHeap';
import { DIRS, type NavGrid } from './NavGrid';

export interface SearchOptions {
  /** settled-node budget (default 6000) */
  maxExpand?: number;
  /** extra cost for each blocked link around a node, in cells (default 0.35) */
  wallPenalty?: number;
  /** extra cost of entering a node (Infinity = forbidden) */
  extraCost?: (id: number) => number;
  /** stop as soon as a node within this distance (metres, planar) of the goal is settled */
  reach?: number;
}

export interface SearchResult {
  /** node ids from start to the end of the path (inclusive) */
  nodes: number[];
  /** true when the path ends at the goal (or within `reach` of it) */
  complete: boolean;
  expanded: number;
  cost: number;
}

export class AStar {
  private heap = new BinaryHeap(2048);
  private g = new Map<number, number>();
  private parent = new Map<number, number>();
  private closed = new Set<number>();
  /** totals, for profiling */
  searches = 0;
  totalExpanded = 0;

  constructor(private grid: NavGrid) {}

  private octile(a: number, b: number): number {
    const G = this.grid;
    const dx = Math.abs(G.ixOf(a) - G.ixOf(b)), dz = Math.abs(G.izOf(a) - G.izOf(b));
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * G.cell;
  }

  search(start: number, goal: number, o: SearchOptions = {}): SearchResult {
    const G = this.grid;
    const maxExpand = o.maxExpand ?? 6000;
    const wallPenalty = (o.wallPenalty ?? 0.35) * G.cell;
    const reach = o.reach ?? 0;
    const gx = G.cx(G.ixOf(goal)), gz = G.cz(G.izOf(goal));
    this.searches++;
    this.heap.clear();
    this.g.clear();
    this.parent.clear();
    this.closed.clear();
    if (start < 0 || goal < 0) return { nodes: [], complete: false, expanded: 0, cost: Infinity };
    this.g.set(start, 0);
    this.heap.push(start, this.octile(start, goal));
    let best = start, bestH = this.octile(start, goal);
    let expanded = 0;
    let done = -1;
    while (!this.heap.empty) {
      const cur = this.heap.pop();
      if (cur === goal) { done = cur; break; }
      if (reach > 0) {
        const dx = G.cx(G.ixOf(cur)) - gx, dz = G.cz(G.izOf(cur)) - gz;
        if (dx * dx + dz * dz <= reach * reach) { done = cur; break; }
      }
      this.closed.add(cur);
      if (++expanded > maxExpand) break;
      const gc = this.g.get(cur)!;
      for (let d = 0; d < 8; d++) {
        const nb = G.neighbor(cur, d);
        if (nb < 0 || this.closed.has(nb)) continue;
        let c = G.stepCost(cur, nb, d);
        if (wallPenalty > 0) c += G.wallCount(nb) * wallPenalty;
        if (o.extraCost) {
          const e = o.extraCost(nb);
          if (!Number.isFinite(e)) continue;
          c += e;
        }
        const ng = gc + c;
        const old = this.g.get(nb);
        if (old !== undefined && ng >= old) continue;
        this.g.set(nb, ng);
        this.parent.set(nb, cur);
        const h = this.octile(nb, goal);
        this.heap.push(nb, ng + h);
        if (h < bestH) { bestH = h; best = nb; }
      }
    }
    this.totalExpanded += expanded;
    const end = done >= 0 ? done : best;
    const nodes: number[] = [];
    for (let n: number | undefined = end; n !== undefined; n = this.parent.get(n)) {
      nodes.push(n);
      if (n === start) break;
    }
    nodes.reverse();
    return { nodes, complete: done >= 0, expanded, cost: this.g.get(end) ?? Infinity };
  }
}

/**
 * string pulling: keep only the nodes where the path must turn. From each anchor, look as far ahead along
 * the path as a straight walk over the grid can reach, and jump there.
 */
export function pullString(grid: NavGrid, nodes: number[]): number[] {
  if (nodes.length <= 2) return nodes.slice();
  const out = [nodes[0]];
  let i = 0;
  while (i < nodes.length - 1) {
    let j = i + 1;
    // walk forward while the straight line still reaches the exact node (same column and layer)
    for (let k = i + 2; k < nodes.length; k++) {
      const n = nodes[k];
      const reached = grid.walkLine(nodes[i], grid.cx(grid.ixOf(n)), grid.cz(grid.izOf(n)));
      if (reached !== n) break;
      j = k;
    }
    out.push(nodes[j]);
    i = j;
  }
  return out;
}

/** planar length of a node path, metres */
export function pathLength(grid: NavGrid, nodes: number[]): number {
  let L = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i];
    L += Math.hypot(grid.cx(grid.ixOf(a)) - grid.cx(grid.ixOf(b)), grid.cz(grid.izOf(a)) - grid.cz(grid.izOf(b)));
  }
  return L;
}

export { DIRS };
