import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { hash21 } from '../shaders/common';
import type { Recipe } from './recipes';

/**
 * Window panes of the city's towers (citykit.lit_windows): a room behind every pane by interior mapping (van Dongen 2008),
 * written for this game. Each pane carries window coordinates in its third UV set (one unit per window; the integer cell is
 * the window's seed). The view ray is taken into the window's own frame (built from screen derivatives of position and
 * those coordinates, so any flat pane works) and traced through a box room larger than the opening:
 *
 *   glass -> dressing a few cm behind it (venetian blinds, a roller blind, curtains, or nothing) -> a furniture plane at
 *   ~40 % of the depth -> the walls, floor, ceiling and back wall (a doorway in some)
 *
 * By day the room is lit by the sky through its own window (falling off with depth); after dark a share of rooms have their
 * lights on (warm homes, mixed office lighting) and glow through closed blinds. The sash and glazing bars are opaque and lit
 * like the facade; the glass reflects the section's probe. Once a window shrinks to a few pixels its pattern gives way to
 * the mean of all windows (blended by screen size), so distant facades neither shimmer nor pop.
 */
const T = TSL as any;
const { Fn, uv, vec2, vec3, float, mix, min, max, abs, fract, floor, smoothstep, step, dot, normalize, length, dFdx, dFdy, sin, positionWorld,
  cameraPosition, normalWorld, fwidth, select } = T;

interface Style {
  depth: number; panes: [number, number]; frame: number; mullion: number; frameColor: [number, number, number];
  wallA: [number, number, number]; wallB: [number, number, number]; floor: [number, number, number];
  dressA: [number, number, number]; dressB: [number, number, number];
  /** weights: venetian, roller, curtains, bare */
  dressing: [number, number, number, number];
  warm: [number, number, number]; cool: [number, number, number]; coolChance: number; lamp: number;
  seed: number;
}

const rgb = (h: number): [number, number, number] => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };

const STYLES: Record<string, Style> = {
  modern: { depth: 3.2, panes: [3, 1], frame: 0.05, mullion: 0.035, frameColor: rgb(0x2b2e33), wallA: rgb(0x9a9c9e), wallB: rgb(0x7f8285),
    floor: rgb(0x55575a), dressA: rgb(0xb9b6ae), dressB: rgb(0x6f6d68), dressing: [2, 1.2, 0, 1.6], warm: rgb(0xffe0b5), cool: rgb(0xcfdcff),
    coolChance: 0.4, lamp: 1.5, seed: 3 },
  brick: { depth: 2.6, panes: [2, 2], frame: 0.06, mullion: 0.035, frameColor: rgb(0xcfc8bb), wallA: rgb(0xa39a8c), wallB: rgb(0x8f887c),
    floor: rgb(0x5e4a3a), dressA: rgb(0xc4b7a2), dressB: rgb(0x7e6d5a), dressing: [1, 1, 2, 0.6], warm: rgb(0xffb066), cool: rgb(0x9fc4ff),
    coolChance: 0.12, lamp: 1.8, seed: 11 },
  home: { depth: 2.6, panes: [2, 2], frame: 0.06, mullion: 0.035, frameColor: rgb(0xcfc8bb), wallA: rgb(0xa39a8c), wallB: rgb(0x8f887c),
    floor: rgb(0x5e4a3a), dressA: rgb(0xc4b7a2), dressB: rgb(0x7e6d5a), dressing: [1, 1, 2, 0.6], warm: rgb(0xffb066), cool: rgb(0x9fc4ff),
    coolChance: 0.12, lamp: 1.8, seed: 7 },
};

export function windowMaterial(r: Recipe): THREE.MeshStandardNodeMaterial {
  const st = STYLES[String(r.era)] ?? STYLES.home;
  const lit = Math.min(0.9, Math.max(0, Number(r.lit ?? 0.3)));
  const night = Math.min(1, Math.max(0, Number(r.night ?? 0)));
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0 });
  const V3 = (c: [number, number, number]) => vec3(c[0], c[1], c[2]);

  const shade = Fn(() => {
    const c = uv(2);
    const cell = floor(c);
    const f = fract(c);
    const h = (k: number) => hash21(cell.add(vec2(k * 7.13 + st.seed, k * 3.71)));
    // the window's frame from screen derivatives: metres per window unit along u (T) and v (B)
    const p = positionWorld;
    const dpx = dFdx(p), dpy = dFdy(p), dcx = dFdx(c), dcy = dFdy(c);
    const det = dcx.x.mul(dcy.y).sub(dcx.y.mul(dcy.x));
    const safe = select(abs(det).lessThan(1e-12), float(1e-12), det);
    const Tm = dpx.mul(dcy.y).sub(dpy.mul(dcx.y)).div(safe);
    const Bm = dpy.mul(dcx.x).sub(dpx.mul(dcy.x)).div(safe);
    const lenT = max(length(Tm), 0.05), lenB = max(length(Bm), 0.05);
    const N = normalWorld.normalize();
    const Vw = normalize(p.sub(cameraPosition)); // into the room
    // ray in (u units, v units, metres of depth)
    const d = vec3(dot(Vw, Tm.div(lenT)).div(lenT), dot(Vw, Bm.div(lenB)).div(lenB), max(dot(Vw, N).negate(), 0.02)).toVar();
    // the room is larger than the opening
    const lo = vec2(-0.45, -0.55), hi = vec2(1.45, 1.25);
    const D = float(st.depth).mul(h(1).mul(0.35).add(0.8));
    const tx = select(d.x.greaterThan(0.0), hi.x.sub(f.x), lo.x.sub(f.x)).div(select(abs(d.x).lessThan(1e-5), float(1e-5), d.x));
    const ty = select(d.y.greaterThan(0.0), hi.y.sub(f.y), lo.y.sub(f.y)).div(select(abs(d.y).lessThan(1e-5), float(1e-5), d.y));
    const tz = D.div(d.z);
    const t = min(min(tx, ty), tz);
    const hit = vec3(f.add(d.xy.mul(t)), d.z.mul(t));
    // surfaces: back wall, side walls, floor, ceiling
    const wall = mix(V3(st.wallA), V3(st.wallB), h(2));
    const isBack = step(tz, min(tx, ty));
    const isFloor = step(ty, min(tx, tz)).mul(step(d.y, 0.0));
    const isCeil = step(ty, min(tx, tz)).mul(step(0.0, d.y));
    const col = wall.mul(0.92).toVar();
    // back wall: a doorway in some rooms, a darker skirting
    const door = step(h(3), 0.45).mul(step(abs(hit.x.sub(h(4).mul(1.2).add(-0.1))), 0.28)).mul(step(hit.y, 0.95));
    col.assign(mix(col, wall, isBack));
    col.assign(mix(col, col.mul(0.25), door.mul(isBack)));
    col.assign(mix(col, V3(st.floor), isFloor));
    col.assign(mix(col, wall.mul(1.15), isCeil));
    col.assign(col.mul(mix(float(1), float(0.7), step(hit.y, lo.y.add(0.08)).mul(float(1).sub(isFloor)))));
    // furniture masses on a middle plane
    const zf = D.mul(0.4);
    const tf = zf.div(d.z);
    const pf = f.add(d.xy.mul(tf));
    const fx = h(5).mul(1.2).sub(0.1);
    const furn = step(tf, t).mul(step(abs(pf.x.sub(fx)), h(6).mul(0.35).add(0.15))).mul(step(pf.y, lo.y.add(h(7).mul(0.5).add(0.45))));
    col.assign(mix(col, V3(st.floor).mul(0.45), furn));
    const depthM = select(furn.greaterThan(0.5), zf, hit.z);
    // light: by day the sky through the window, falling off into the room; at night the lamp, if this room has it on
    const day = float(0.35).mul(float(1).div(depthM.mul(0.45).add(1.0)));
    const on = step(h(8), float(lit));
    const lampCol = mix(V3(st.warm), V3(st.cool), step(h(9), float(st.coolChance)));
    const lamp = lampCol.mul(st.lamp).mul(on).mul(h(10).mul(0.6).add(0.4)).mul(smoothstep(-0.2, 1.3, hit.y).mul(0.6).add(0.4));
    // unlit rooms at night still catch a little of the street's and the sky's glow through the glass
    const room = col.mul(mix(vec3(day), lamp.add(vec3(0.018, 0.017, 0.016)), float(night))).toVar();
    // dressing a few cm behind the glass
    const zd = float(0.08);
    const pd = f.add(d.xy.mul(zd.div(d.z)));
    const w = st.dressing;
    const pick = h(11).mul(w[0] + w[1] + w[2] + w[3]);
    const kind = select(pick.lessThan(w[0]), float(0), select(pick.lessThan(w[0] + w[1]), float(1), select(pick.lessThan(w[0] + w[1] + w[2]), float(2), float(3))));
    const drop = h(12).mul(0.75).add(0.25);
    const below = step(float(1).sub(drop), pd.y);
    const slats = step(0.45, fract(pd.y.mul(float(1.0).div(0.035).div(lenB))));
    const sideCover = h(13).mul(0.3).add(0.12);
    const curtain = step(pd.x, sideCover).max(step(float(1).sub(sideCover), pd.x));
    const cover = select(kind.equal(0.0), below.mul(slats), select(kind.equal(1.0), below, select(kind.equal(2.0), curtain, float(0))));
    const folds = select(kind.equal(2.0), sin(pd.x.mul(60.0)).mul(0.15).add(0.85), float(1));
    const fabric = mix(V3(st.dressA), V3(st.dressB), h(14)).mul(folds);
    const fabricLit = fabric.mul(mix(vec3(0.3), lamp.mul(0.35), float(night)));
    room.assign(mix(room, fabricLit, cover));
    // the sash and glazing bars
    const fw = float(st.frame).div(lenT), fh = float(st.frame).div(lenB);
    const edge = step(f.x, fw).max(step(float(1).sub(fw), f.x)).max(step(f.y, fh)).max(step(float(1).sub(fh), f.y));
    const mx = abs(fract(f.x.mul(st.panes[0])).sub(0.5)).mul(2.0);
    const my = abs(fract(f.y.mul(st.panes[1])).sub(0.5)).mul(2.0);
    const bars = st.panes[0] > 1 ? step(float(1).sub(float(st.mullion * st.panes[0]).div(lenT)), mx) : float(0);
    const barsY = st.panes[1] > 1 ? step(float(1).sub(float(st.mullion * st.panes[1]).div(lenB)), my) : float(0);
    const frame = edge.max(bars).max(barsY);
    // far away: the mean of all windows
    const cellsPerPixel = max(fwidth(c.x), fwidth(c.y));
    const far = smoothstep(0.3, 0.7, cellsPerPixel);
    const mean = mix(vec3(0.03), V3(st.warm).mul(lit * st.lamp * 0.12), float(night));
    return T.vec4(mix(room, mean, far), mix(frame, float(0), far));
  })();

  const frameMask = shade.w;
  const fc = st.frameColor;
  m.colorNode = mix(vec3(0.0), vec3(fc[0], fc[1], fc[2]), frameMask);
  m.roughnessNode = mix(float(0.06), float(0.55), frameMask);
  m.emissiveNode = shade.xyz.mul(float(1).sub(frameMask));
  m.name = `window_${r.era}`;
  return m;
}
