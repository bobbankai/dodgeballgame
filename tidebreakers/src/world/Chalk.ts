// Children's chalk drawings on the ground: hand-wobbly strokes of coloured chalk built as thin flat ribbons
// that follow the ground (scenery material, so they are lit, shadowed and outlined like everything else).
// Each drawing is a list of strokes in its own 2D space (metres, +y away from the viewer).
import { Mesh, VertexData, Vector3 } from '@babylonjs/core';
import type { Renderer } from '../render/Renderer';
import type { Collision } from '../game/Collision';
import { EnvKit } from './World';

type Stroke = { pts: [number, number][]; col: [number, number, number]; w?: number };

const WHITE: [number, number, number] = [0.92, 0.9, 0.86];
const PINK: [number, number, number] = [0.95, 0.55, 0.62];
const YELLOW: [number, number, number] = [0.98, 0.85, 0.35];
const BLUE: [number, number, number] = [0.45, 0.7, 0.95];
const GREEN: [number, number, number] = [0.55, 0.85, 0.5];

function circle(cx: number, cy: number, r: number, n = 14, a0 = 0, a1 = Math.PI * 2): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

function stick(x: number, y: number, h: number, col: [number, number, number], skirt = false): Stroke[] {
  const head = h * 0.18;
  const s: Stroke[] = [
    { pts: circle(x, y + h - head, head, 12), col },
    { pts: [[x, y + h - head * 2], [x, y + h * 0.35]], col },
    { pts: [[x - h * 0.22, y + h * 0.55], [x, y + h * 0.68], [x + h * 0.22, y + h * 0.55]], col },
    { pts: [[x - h * 0.16, y], [x, y + h * 0.35], [x + h * 0.16, y]], col },
  ];
  if (skirt) s.push({ pts: [[x - h * 0.14, y + h * 0.2], [x, y + h * 0.45], [x + h * 0.14, y + h * 0.2], [x - h * 0.14, y + h * 0.2]], col: PINK });
  return s;
}

/** The drawings Teo left in the tunnels (and a few more). */
export const DRAWINGS: Record<string, Stroke[]> = {
  // a boat with two stick children and a big sun
  boat: [
    { pts: [[-1.0, 0.3], [-0.7, 0.0], [0.7, 0.0], [1.0, 0.3], [-1.0, 0.3]], col: BLUE, w: 0.05 },
    { pts: [[0.0, 0.3], [0.0, 1.5]], col: WHITE },
    { pts: [[0.05, 1.45], [0.75, 0.45], [0.05, 0.45]], col: WHITE },
    ...stick(-0.55, 0.3, 0.6, YELLOW, true),
    ...stick(-0.25, 0.3, 0.45, WHITE),
    { pts: circle(1.1, 1.55, 0.25, 12), col: YELLOW },
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const a = i * Math.PI / 4; return { pts: [[1.1 + Math.cos(a) * 0.32, 1.55 + Math.sin(a) * 0.32], [1.1 + Math.cos(a) * 0.45, 1.55 + Math.sin(a) * 0.45]] as [number, number][], col: YELLOW }; }),
    { pts: Array.from({ length: 13 }, (_, i) => [-1.3 + i * 0.22, -0.12 + Math.sin(i * 1.6) * 0.06] as [number, number]), col: BLUE },
  ],
  // a sun with a moustache (their father, who worked the night shift)
  sun: [
    { pts: circle(0, 0.8, 0.45, 16), col: YELLOW, w: 0.05 },
    ...Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5; return { pts: [[Math.cos(a) * 0.55, 0.8 + Math.sin(a) * 0.55], [Math.cos(a) * 0.78, 0.8 + Math.sin(a) * 0.78]] as [number, number][], col: YELLOW }; }),
    { pts: circle(-0.15, 0.92, 0.04, 6), col: WHITE },
    { pts: circle(0.15, 0.92, 0.04, 6), col: WHITE },
    { pts: [[-0.28, 0.72], [-0.12, 0.66], [0, 0.72], [0.12, 0.66], [0.28, 0.72]], col: WHITE, w: 0.05 },
    { pts: circle(0, 0.62, 0.14, 8, Math.PI * 1.15, Math.PI * 1.85), col: PINK },
  ],
  // an arrow and the number nine, counted so he could find his way back
  nine: [
    { pts: [[-0.9, 0.5], [0.6, 0.5]], col: WHITE, w: 0.05 },
    { pts: [[0.3, 0.75], [0.62, 0.5], [0.3, 0.25]], col: WHITE, w: 0.05 },
    { pts: [...circle(1.05, 0.85, 0.22, 12), [1.27, 0.85], [1.22, 0.3]], col: PINK, w: 0.05 },
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ pts: [[-0.9 + i * 0.16, -0.05], [-0.9 + i * 0.16, 0.18]] as [number, number][], col: WHITE })),
    { pts: [[-0.95, 0.06], [0.45, 0.06]], col: WHITE },
  ],
  // a seagull and a house on a cliff with a lit window
  home: [
    { pts: [[-0.8, 0], [-0.8, 0.7], [-0.35, 1.1], [0.1, 0.7], [0.1, 0], [-0.8, 0]], col: WHITE, w: 0.05 },
    { pts: [[-0.5, 0.25], [-0.5, 0.5], [-0.25, 0.5], [-0.25, 0.25], [-0.5, 0.25]], col: YELLOW },
    { pts: [[0.4, 1.0], [0.6, 1.15], [0.8, 1.0], [1.0, 1.15], [1.2, 1.0]], col: WHITE },
    { pts: [[-1.2, -0.05], [1.4, -0.05]], col: GREEN },
  ],
};

/** Builds one drawing as a mesh lying on the ground at `at`, rotated by `yaw`, `scale` x the drawing size. */
export function chalkDrawing(r: Renderer, col: Collision, name: string, at: Vector3, yaw = 0, scale = 1): Mesh {
  const strokes = DRAWINGS[name];
  const pos: number[] = [], nrm: number[] = [], clr: number[] = [], uv2: number[] = [], idx: number[] = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const st of strokes) {
    const w = (st.w ?? 0.045) * Math.max(scale, 0.8);
    const pts = st.pts.map(([x, y]) => [x * scale + (rnd() - 0.5) * 0.02, y * scale + (rnd() - 0.5) * 0.02]);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len * w * 0.5, ny = dx / len * w * 0.5;
      // chalk is uneven: each segment a little lighter or darker, with gaps where it skipped
      const k = 0.85 + rnd() * 0.25;
      if (rnd() < 0.06) continue;
      const base = pos.length / 3;
      for (const [px, py] of [[x0 - nx, y0 - ny], [x0 + nx, y0 + ny], [x1 - nx * 0.8, y1 - ny * 0.8], [x1 + nx * 0.8, y1 + ny * 0.8]]) {
        const wx = at.x + px * c + py * s, wz = at.z - px * s + py * c;
        const gy = col.groundAt(wx, wz, at.y + 1.0) + 0.012;
        pos.push(wx, gy, wz);
        nrm.push(0, 1, 0);
        clr.push(st.col[0] * k, st.col[1] * k, st.col[2] * k, 0);
        uv2.push(1, 1);
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const m = new Mesh(`chalk:${name}`, r.scene);
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.colors = clr; vd.indices = idx;
  vd.applyToMesh(m);
  m.setVerticesData('uv2', uv2, false, 2);
  m.material = EnvKit.material(r, `chalkMat:${name}`, 0);
  m.isPickable = false;
  return m;
}
