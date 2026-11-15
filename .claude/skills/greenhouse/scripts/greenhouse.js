/**
 * greenhouse.js
 * A pressurised horticultural dome and a tiered hydroponic grow row, for Three.js.
 * Both are procedural: no model files, no textures. The dome is a ribbed glazing
 * envelope on a tension ring, with an airlock, a perimeter catwalk, a central
 * nutrient core and a light mast. The grow row is a freestanding tiered rack with
 * trays, substrate, crops, LED bars, a drip manifold and an optional tank.
 *
 * Usage:
 *   import { registerModel, createModel } from './procedural-models.js';
 *   import { registerGreenhouse, createGreenhouse } from './greenhouse.js';
 *   registerGreenhouse();                       // registers 'greenhouse-dome' and 'grow-row'
 *   scene.add(createModel('greenhouse-dome', { diameter: 24, rise: 0.8 }));
 *   scene.add(createGreenhouse({ diameter: 24, bays: 8, innerBays: 5 }));
 *   scene.add(createModel('grow-row', { length: 6, tiers: 4, crop: 'lettuce' }));
 *
 * Written against the kernel of the procedural-models library shipped with the
 * `pipes` skill (procedural-models.js: Geo, P2, prism, lathe, tube, box, rbox,
 * beam, boltsAt, grating, MAT, the matrix helpers). Copy both files into the
 * project together, or copy the whole geometry folder. The distribution pipework
 * is not modelled here: use the `pipes` skill's pipe-rack model for mains and
 * branches; the rows expose their feed points (layoutRows(...).feed) to meet it.
 *
 * Written against three 0.187.0, WebGPU and TSL.
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {
  Geo, P2, prism, lathe, tube, box, rbox, cyl, beam, bolt, boltsAt, grating,
  flat, stripes, MAT, createMaterial, createModel, registerModel,
  T, RX, RY, RZ, SC, X, TAU, HALF,
} from './procedural-models.js';

/** Top of the dome's inner floor above the model origin, in metres. */
export const FLOOR_Y = 0.55;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const wrapPi = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
const ahead = (a, b) => Math.abs(wrapPi(a - b));

/* =====================================================================
   MATERIALS — plain layer descriptions to TSL node materials.
   The library's createMaterial covers paint, metal and glow. Glass needs
   a physical transmission material; leaves are double-sided.
   ===================================================================== */
/**
 * A material for one greenhouse layer.
 * Layer descriptions used here:
 *   { color, rough, metal, coat?, glow? }          as procedural-models
 *   { glass: true, color, rough, transmission, ior, thickness, frost? }
 *   { leaf: true, color, rough, translucency? }
 */
export function greenhouseMaterials(def, opts = {}) {
  if (def.glass) {
    const m = new THREE.MeshPhysicalNodeMaterial({
      color: def.color,
      roughness: def.rough === undefined ? 0.06 : def.rough,
      metalness: 0,
      transmission: def.transmission === undefined ? 1 : def.transmission,
      ior: def.ior === undefined ? 1.45 : def.ior,
      thickness: def.thickness === undefined ? 0.02 : def.thickness,
      transparent: false,
      side: THREE.DoubleSide,
    });
    m.colorNode = TSL.color(def.color);
    m.attenuationColor = new THREE.Color(def.attenuation || def.color);
    m.attenuationDistance = def.attenuationDistance === undefined ? 25 : def.attenuationDistance;
    if (def.frost) {
      m.roughnessNode = TSL.float(def.frost === true ? 0.32 : def.frost);
      m.transmissionNode = TSL.float(0.55);
    }
    return m;
  }
  const m = createMaterial(def, opts);
  if (def.leaf) m.side = THREE.DoubleSide;
  return m;
}

/* =====================================================================
   PLANT GEOMETRY — leaves as folded ribbons, berries as small lathes.
   One template per crop and detail level is built once per model and
   placed many times, so a row of 200 plants is a few merged geometries.
   ===================================================================== */
/** A leaf along +X, width on Z, the midrib raised. Origin at the stem. */
function leafGeo(len, wid, lift = 0.35, segs = 3) {
  const g = new Geo(), rows = [], nSegs = Math.max(2, segs);
  for (let i = 0; i <= nSegs; i++) {
    const t = i / nSegs;
    const w = wid * Math.sin(Math.PI * Math.pow(t, 0.72)) * (1 - 0.18 * t);
    const y = len * lift * Math.sin(HALF * t) * (1 - 0.25 * t) + 0.004;
    const zDroop = w * 0.18;
    rows.push({ x: len * t, y, w, zDroop });
  }
  for (let i = 0; i < nSegs; i++) {
    const a = rows[i], b = rows[i + 1];
    const aL = [a.x, a.y - a.zDroop, -a.w / 2], aR = [a.x, a.y - a.zDroop, a.w / 2], aC = [a.x, a.y, 0];
    const bL = [b.x, b.y - b.zDroop, -b.w / 2], bR = [b.x, b.y - b.zDroop, b.w / 2], bC = [b.x, b.y, 0];
    g.quad(aL, bL, bC, aC);
    g.quad(aC, bC, bR, aR);
  }
  return g.finish(38);
}
/** One crop plant in local space, base at y = 0. */
function cropPlant(kind, lod, seed = 0) {
  const hi = lod === 'high', mid = lod === 'medium';
  const leaves = new Geo(), stems = new Geo(), fruit = new Geo();
  const nLeaf = kind === 'seedling' ? 2 : kind === 'herb' ? (hi ? 11 : mid ? 8 : 5)
    : kind === 'strawberry' ? (hi ? 9 : mid ? 7 : 4) : (hi ? 9 : mid ? 6 : 4);
  const segs = hi ? 3 : mid ? 2 : 2;
  const base = kind === 'seedling' ? 0.035 : kind === 'herb' ? 0.045 : 0.05;
  const stemH = kind === 'seedling' ? 0.03 : kind === 'herb' ? 0.06 : 0.05;
  stems.add(cyl(0.006, stemH, hi ? 6 : 4).at(0, stemH / 2, 0));
  const r0 = hash(seed * 17.3 + 4.1);
  const rings = kind === 'lettuce'
    ? [
      { n: hi ? 7 : mid ? 5 : 3, lo: 0.16, hi: 0.21, tiltLo: 0.06, tiltHi: 0.28 },
      { n: hi ? 4 : mid ? 3 : 2, lo: 0.075, hi: 0.11, tiltLo: 0.65, tiltHi: 1.05 },
    ]
    : [{
      n: nLeaf,
      lo: kind === 'seedling' ? 0.035 : kind === 'herb' ? 0.08 : 0.09,
      hi: kind === 'seedling' ? 0.035 : kind === 'herb' ? 0.115 : 0.14,
      tiltLo: kind === 'herb' ? 1.05 : 0.35,
      tiltHi: kind === 'herb' ? 1.35 : 0.9,
    }];
  let li = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++, li++) {
      const t = ring.n === 1 ? 0 : i / ring.n;
      const a = TAU * (t + r0 * 0.16) + hash(seed * 3.7 + li) * 0.32;
      const l = ring.lo + hash(seed + li) * (ring.hi - ring.lo);
      const w = l * (kind === 'herb' ? 0.24 : kind === 'seedling' ? 0.6 : kind === 'lettuce' ? 0.92 : 0.78);
      const tilt = ring.tiltLo + hash(seed + li * 2) * (ring.tiltHi - ring.tiltLo);
      const leaf = leafGeo(l, w, kind === 'herb' ? 0.15 : 0.4, segs);
      leaves.add(leaf, X(T(0, base + hash(seed + li * 5) * 0.02, 0), RY(a), RZ(tilt), SC(1, 1, 1)));
    }
  }
  if (kind === 'strawberry' && hi) {
    for (let i = 0; i < 2; i++) {
      const a = r0 * TAU + i * 2.3, rr = 0.05 + hash(seed + i * 9) * 0.03;
      fruit.add(lathe([[0, -0.012], [0.014, -0.008], [0.016, 0.004], [0.008, 0.016], [0, 0.018]], 8)
        .at(Math.cos(a) * rr, 0.05 + hash(seed + i) * 0.02, Math.sin(a) * rr));
    }
  }
  return { leaves, stems, fruit };
}

/* =====================================================================
   MODEL — Grow row
   A tiered hydroponic rack: posts and shelf beams, U-channel trays with a
   substrate slab, a crop at a fixed spacing, a light bar above each tray,
   a drip manifold at one end and an optional tank under the bottom shelf.
   ===================================================================== */
const CROP = {
  lettuce: { spacing: 0.24, across: 0.24, height: 0.20 },
  herb: { spacing: 0.18, across: 0.17, height: 0.17 },
  seedling: { spacing: 0.12, across: 0.11, height: 0.08 },
  strawberry: { spacing: 0.26, across: 0.24, height: 0.16 },
};
const CROP_ORDER = ['lettuce', 'herb', 'strawberry', 'seedling'];

export const growRow = {
  id: 'grow-row', tab: 'Greenhouse', name: 'Hydroponic grow row',
  kind: 'Tiered rack with trays, crops, LED bars, drip line and tank',
  view: { az: -0.8, el: 0.24 },
  params: [
    { key: 'length', label: 'Length', type: 'range', min: 2, max: 12, step: 0.5, value: 6, unit: 'm' },
    { key: 'tiers', label: 'Tiers', type: 'range', min: 2, max: 6, step: 1, value: 4 },
    { key: 'width', label: 'Tray width', type: 'range', min: 0.6, max: 1.2, step: 0.05, value: 0.9, unit: 'm' },
    { key: 'pitch', label: 'Tier pitch', type: 'range', min: 0.45, max: 0.9, step: 0.05, value: 0.65, unit: 'm' },
    { key: 'crop', label: 'Crop', type: 'select', options: [['lettuce', 'Lettuce'], ['herb', 'Herbs'], ['strawberry', 'Strawberry'], ['seedling', 'Seedlings'], ['none', 'None']], value: 'lettuce' },
    { key: 'lights', label: 'Grow lights', type: 'toggle', value: true },
    { key: 'tank', label: 'Tank and pump', type: 'toggle', value: true },
    { key: 'color', label: 'Frame paint', type: 'color', options: ['#D8DAD3', '#A7B3B8', '#D5A24A', '#8FAF9B'], value: '#D8DAD3' },
    { key: 'leafColor', label: 'Leaf colour', type: 'color', options: ['#4F8A3C', '#6FAE4F', '#356B32'], value: '#4F8A3C' },
  ],
  build(s) {
    const lod = s.detail || 'high', hi = lod === 'high';
    const L = s.length, NT = s.tiers, W = s.width, P = s.pitch;
    const crop = s.crop, cropDef = CROP[crop];
    const frame = new Geo(), trays = new Geo(), medium = new Geo(), leaves = new Geo(), stems = new Geo(),
      fruit = new Geo(), lights = new Geo(), diffusers = new Geo(), water = new Geo(), tank = new Geo(),
      fittings = new Geo(), bolts = new Geo();
    const baseY = 0.03, tier0 = 0.42, postW = 0.07, xEnd = L / 2 - 0.06, zSide = W / 2;
    const tierY = k => tier0 + k * P;
    const lightY = k => k < NT - 1 ? tierY(k + 1) - 0.17 : tierY(NT - 1) + 0.58;
    const topY = s.lights ? lightY(NT - 1) + 0.16 : tierY(NT - 1) + 0.30;
    const segs = r => (lod === 'low' ? 6 : hi ? 12 : 8);

    /* End frames: posts on base plates, crossbars at every tier, a top bar, diagonal braces. */
    const post = hi ? rbox(postW, topY, postW, 0.008, 2) : box(postW, topY, postW);
    const foot = hi ? rbox(0.19, 0.02, 0.19, 0.004, 2) : box(0.19, 0.02, 0.19);
    const cross = hi ? rbox(0.07, 0.09, W + 0.02, 0.006, 2) : box(0.07, 0.09, W + 0.02);
    const shelfBar = hi ? rbox(L - 0.02, 0.10, 0.05, 0.006, 2) : box(L - 0.02, 0.10, 0.05);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * xEnd, z = sz * zSide;
        frame.add(post, T(x, baseY + topY / 2, z));
        frame.add(foot, T(x, baseY / 2, z));
        if (hi) for (const dx of [-0.06, 0.06]) for (const dz of [-0.06, 0.06]) bolts.add(bolt(0.012, 'nut'), T(x + dx, baseY, z + dz));
      }
      frame.add(cross, T(sx * xEnd, topY + baseY - 0.05, 0));
      for (let k = 0; k < NT; k++) {
        frame.add(hi ? rbox(0.06, 0.08, W, 0.005, 2) : box(0.06, 0.08, W), T(sx * xEnd, tierY(k) - 0.05, 0));
      }
      if (hi) {
        const zB = -zSide;
        frame.add(beam([sx * xEnd, baseY + 0.18, zB], [sx * xEnd, tierY(NT - 1) - 0.1, zB], P2.chamfer(0.035, 0.035, 0.006)));
        frame.add(beam([sx * xEnd, baseY + 0.18, zB], [sx * xEnd, tierY(0) + 0.35, zB], P2.chamfer(0.035, 0.035, 0.006)));
      }
    }
    for (const sz of [-1, 1]) {
      for (let k = 0; k < NT; k++) frame.add(shelfBar, T(0, tierY(k) - 0.05, sz * zSide));
      if (s.lights) frame.add(shelfBar, T(0, topY + baseY - 0.1, 0));
    }

    /* U-channel tray, one per tier. */
    const wall = 0.024, depth = 0.13, w = W;
    const profile = [
      [-w / 2, 0], [w / 2, 0], [w / 2, depth], [w / 2 - wall, depth], [w / 2 - wall, wall],
      [-w / 2 + wall, wall], [-w / 2 + wall, depth], [-w / 2, depth],
    ];
    const tray = (hi ? prism(P2.fillet(profile, 0.012, 2), L - 0.04, { bevel: 0.006 }) : prism(profile, L - 0.04)).ry(HALF);
    const slab = hi ? rbox(L - 0.1, 0.055, W - 0.09, 0.008, 2) : box(L - 0.1, 0.055, W - 0.09);
    for (let k = 0; k < NT; k++) {
      const y = tierY(k);
      trays.add(tray, T(0, y, 0));
      medium.add(slab, T(0, y + depth + 0.028, 0));
    }

    /* Crop. Four templates per crop/detail, placed with yaw and scale. */
    if (crop !== 'none' && cropDef) {
      const templates = Array.from({ length: 4 }, (_, i) => cropPlant(crop, lod, i + 7));
      const spacing = cropDef.spacing, acrossSp = cropDef.across;
      const nx = Math.max(1, Math.floor((L - 0.28) / spacing));
      const nz = Math.max(1, Math.floor((W - 0.12) / acrossSp));
      for (let k = 0; k < NT; k++) {
        const y = tierY(k) + depth + 0.06;
        for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
          const h = hash(k * 131 + ix * 17 + iz * 7 + 3);
          const x = -L / 2 + 0.16 + (ix + 0.5) * (L - 0.3) / nx + (h - 0.5) * spacing * 0.18;
          const z = (iz - (nz - 1) / 2) * acrossSp + (hash(h * 91) - 0.5) * acrossSp * 0.12;
          const tpl = templates[(h * 4) | 0];
          const sc = 0.82 + hash(h * 57) * 0.36;
          leaves.add(tpl.leaves, X(T(x, y, z), RY(hash(h * 29) * TAU), SC(sc, sc, sc)));
          stems.add(tpl.stems, X(T(x, y, z), SC(sc, sc, sc)));
          if (tpl.fruit.tris) fruit.add(tpl.fruit, X(T(x, y, z), RY(hash(h * 29) * TAU), SC(sc, sc, sc)));
        }
      }
    }

    /* LED bars: under the tray above, and on the top frame. */
    if (s.lights) {
      const barW = W > 0.8 ? 2 : 1;
      const housing = hi ? rbox(L - 0.34, 0.06, 0.10, 0.01, 2) : box(L - 0.34, 0.06, 0.10);
      const lens = hi ? rbox(L - 0.4, 0.012, 0.062, 0.003, 2) : box(L - 0.4, 0.012, 0.062);
      const cap = hi ? rbox(0.09, 0.085, 0.12, 0.008, 2) : box(0.09, 0.085, 0.12);
      for (let k = 0; k < NT; k++) {
        const y = lightY(k);
        for (let b = 0; b < barW; b++) {
          const z = barW === 1 ? 0 : (b === 0 ? -W * 0.26 : W * 0.26);
          lights.add(housing, T(0, y, z));
          diffusers.add(lens, T(0, y - 0.036, z));
          for (const e of [-1, 1]) lights.add(cap, T(e * (L - 0.3) / 2, y, z));
          if (hi) {
            const ex = (L - 0.3) / 2;
            water.add(tube([[ex, y + 0.03, z], [ex, y + 0.03, zSide - 0.04], [ex, y + 0.35, zSide - 0.04]], 0.009,
              { segs: 5, bend: 0.035, caps: 'none' }));
          }
        }
      }
    }

    /* Drip manifold at the left end, a branch and a distribution line per tray, emitters. */
    const mx = -L / 2 + 0.10, mz = zSide + 0.08, manifoldTop = topY + baseY - 0.12;
    water.add(tube([[mx, 0.14, mz], [mx, manifoldTop, mz]], 0.026, { segs: hi ? 10 : 6, caps: 'flat' }));
    for (let k = 0; k < NT; k++) {
      const y = tierY(k) + depth + 0.10;
      water.add(tube([[mx, y, mz], [mx, y, zSide - 0.10], [mx + 0.12, y, zSide - 0.10]], 0.018,
        { segs: hi ? 8 : 5, bend: 0.05, caps: 'none' }));
      const x0 = -L / 2 + 0.04, x1 = L / 2 - 0.06;
      water.add(tube([[mx + 0.12, y, zSide - 0.10], [x0 + 0.04, y, zSide - 0.10], [x1, y, zSide - 0.10]], 0.011,
        { segs: hi ? 6 : 4, bend: 0.04, caps: 'flat' }));
      if (hi) {
        const n = Math.max(2, Math.floor((L - 0.2) / 0.32));
        for (let i = 0; i < n; i++) {
          const x = x0 + 0.08 + (x1 - x0 - 0.12) * i / (n - 1);
          water.add(cyl(0.007, 0.05, 5).at(x, y - 0.035, zSide - 0.10));
        }
      }
      /* a small isolation valve on the branch */
      if (hi && k === 0) {
        water.add(rbox(0.10, 0.13, 0.08, 0.01, 2), T(mx + 0.12, y, mz - 0.02));
        water.add(cyl(0.025, 0.07, 8).rx(HALF).at(mx + 0.12, y + 0.10, mz - 0.02));
      }
    }
    /* Bottom valve and a flexible tail to the tank or the floor stub. */
    water.add(rbox(0.11, 0.14, 0.09, 0.012, 2), T(mx, 0.25, mz));
    water.add(cyl(0.03, 0.08, 8).rz(HALF).at(mx - 0.08, 0.25, mz));
    if (s.tank) water.add(tube([[mx, 0.18, mz], [mx, 0.12, mz - 0.18], [mx + 0.32, 0.12, mz - 0.18]], 0.018,
      { segs: hi ? 8 : 5, bend: 0.05, caps: 'none' }));

    /* Tank and pump under the bottom shelf, or a floor stub. */
    if (s.tank) {
      const tw = 0.65, th = 0.26, td = 0.42, tx = mx + 0.46, tz = 0.05, tb = 0.03;
      tank.add(hi ? rbox(tw, th, td, 0.025, 2) : box(tw, th, td), T(tx, tb + th / 2, tz));
      tank.add(hi ? rbox(tw - 0.05, 0.03, td - 0.05, 0.01, 2) : box(tw - 0.05, 0.03, td - 0.05), T(tx, tb + th + 0.015, tz));
      if (hi) {
        tank.add(rbox(0.16, 0.12, 0.12, 0.015, 2), T(tx + 0.18, tb + th + 0.08, tz));
        tank.add(cyl(0.028, 0.10, 8).at(tx - 0.2, tb + th + 0.05, tz));
        fittings.add(cyl(0.012, 0.05, 8).rx(HALF).at(mx, 0.25, mz));
      }
      if (hi) {
        tank.add(flat(P2.rect(tw - 0.12, 0.055)), X(T(tx, tb + th * 0.58, tz + td / 2 + 0.002), RY(0)));
      }
    } else {
      water.add(tube([[mx, 0.2, mz], [mx, 0.06, mz], [mx - 0.18, 0.06, mz]], 0.02,
        { segs: hi ? 8 : 5, bend: 0.05, caps: 'flat' }));
    }

    return {
      layers: [
        { name: 'Frame', geo: frame, mat: MAT.paint(s.color) },
        { name: 'Trays', geo: trays, mat: { color: '#DDE2DA', rough: 0.5, metal: 0.02 } },
        { name: 'Substrate', geo: medium, mat: { color: '#2C241D', rough: 0.96, metal: 0 } },
        { name: 'Leaves', geo: leaves, mat: { color: s.leafColor, rough: 0.62, metal: 0, leaf: true, translucency: 0.18 } },
        { name: 'Stems', geo: stems, mat: { color: '#6E8B4A', rough: 0.72, metal: 0 } },
        { name: 'Fruit', geo: fruit, mat: { color: '#B83A32', rough: 0.38, metal: 0, coat: 0.25 } },
        { name: 'Light housings', geo: lights, mat: { color: '#2A2D31', rough: 0.48, metal: 0.45 } },
        { name: 'Light diffusers', geo: diffusers, mat: { color: '#FF8FC4', rough: 0.35, metal: 0, glow: 2.2 } },
        { name: 'Irrigation', geo: water, mat: { color: '#7D8A93', rough: 0.4, metal: 0.5 } },
        { name: 'Tank and pump', geo: tank, mat: { color: '#505A5E', rough: 0.62, metal: 0.08 } },
        { name: 'Fittings', geo: fittings, mat: MAT.zinc },
        { name: 'Fasteners', geo: bolts, mat: MAT.zinc },
      ],
      figure: [L / 2 + 0.9, 0.15, -0.4],
    };
  },
};

/* =====================================================================
   MODEL — Greenhouse dome
   A ribbed ellipsoidal pressure envelope on a tension ring: flat glazing
   panels between meridian ribs and ring beams, a crown vent, an airlock,
   a perimeter catwalk with rails and a ladder, a drained floor, and a
   central nutrient core with a light mast.
   ===================================================================== */
const domePoint = (R, H, phi, theta, off = 0) => {
  const cp = Math.cos(phi), sp = Math.sin(phi), c = Math.cos(theta), s = Math.sin(theta);
  const p = [R * cp * c, H * sp, R * cp * s];
  if (!off) return p;
  const nx = p[0] / (R * R), ny = p[1] / (H * H), nz = p[2] / (R * R);
  const l = Math.hypot(nx, ny, nz) || 1;
  return [p[0] + nx / l * off, p[1] + ny / l * off, p[2] + nz / l * off];
};
const domeNormal = (R, H, p) => {
  const nx = p[0] / (R * R), ny = p[1] / (H * H), nz = p[2] / (R * R), l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
};
/** Add a quad whose front face points along `out`. */
function quadOut(g, a, b, c, d, out) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) g.quad(a, b, c, d); else g.quad(a, d, c, b);
}

export const greenhouseDome = {
  id: 'greenhouse-dome', tab: 'Greenhouse', name: 'Pressurised greenhouse dome',
  kind: 'Ribbed glazing dome with airlock, catwalk, core and light mast',
  view: { az: -0.7, el: 0.26 },
  params: [
    { key: 'diameter', label: 'Diameter', type: 'range', min: 12, max: 48, step: 1, value: 24, unit: 'm' },
    { key: 'rise', label: 'Crown rise', type: 'range', min: 0.55, max: 1, step: 0.05, value: 0.8, unit: 'of radius' },
    { key: 'ribs', label: 'Meridian ribs', type: 'range', min: 12, max: 32, step: 4, value: 24 },
    { key: 'bands', label: 'Glazing bands', type: 'range', min: 3, max: 8, step: 1, value: 6 },
    { key: 'glazing', label: 'Glazing', type: 'select', options: [['clear', 'Clear'], ['frost', 'Frosted'], ['solar', 'Solar tint']], value: 'clear' },
    { key: 'airlock', label: 'Airlock', type: 'toggle', value: true },
    { key: 'catwalk', label: 'Catwalk', type: 'toggle', value: true },
    { key: 'core', label: 'Nutrient core and light mast', type: 'toggle', value: true },
    { key: 'color', label: 'Frame paint', type: 'color', options: ['#C6CBC4', '#8FA6A8', '#C7A05A', '#8E9A8A'], value: '#C6CBC4' },
  ],
  build(s) {
    const lod = s.detail || 'high', hi = lod === 'high', mid = lod === 'medium';
    const R = s.diameter / 2, H = R * s.rise, ribs = Math.max(8, Math.round(s.ribs / 4) * 4), bands = s.bands;
    const ringH = FLOOR_Y - 0.06, ringOut = R + 0.55, ringIn = R - 0.35;
    const ringN = Math.max(48, ribs * 3);
    const phi0 = Math.asin(clamp((ringH + 0.02) / H, 0, 0.999));
    const crownR = R * 0.11, phiC = Math.acos(clamp(crownR / R, 0, 1));
    const nBand = Math.max(2, bands), dPhi = (phiC - phi0) / nBand;
    const air = s.airlock, airHalf = air ? Math.asin(clamp(1.45 / R, 0, 0.9)) : 0;
    const doorTop = ringH + 2.25, phiDoor = air ? Math.asin(clamp(doorTop / H, 0, 0.999)) : 0;

    const glass = new Geo(), frame = new Geo(), base = new Geo(), deck = new Geo(), rails = new Geo(),
      airlock = new Geo(), core = new Geo(), lamps = new Geo(), lenses = new Geo(), floor = new Geo(),
      concrete = new Geo(), marks = new Geo(), bolts = new Geo(), pipes = new Geo(), fittings = new Geo();
    const glassMat = s.glazing === 'frost'
      ? { glass: true, color: '#D5E6E4', rough: 0.3, frost: 0.34, transmission: 0.72, ior: 1.46, thickness: 0.03 }
      : s.glazing === 'solar'
        ? { glass: true, color: '#8FA9A6', rough: 0.05, transmission: 0.85, ior: 1.45, thickness: 0.025, attenuation: '#5E8A84', attenuationDistance: 6 }
        : { glass: true, color: '#D8ECEC', rough: 0.04, transmission: 1, ior: 1.45, thickness: 0.02, attenuation: '#C8E4E0', attenuationDistance: 30 };

    /* Glazing panels, with the airlock opening cut out of the lowest bands. */
    for (let i = 0; i < nBand; i++) {
      const p0 = phi0 + dPhi * i, p1 = phi0 + dPhi * (i + 1);
      for (let j = 0; j < ribs; j++) {
        const t0 = TAU * j / ribs, t1 = TAU * (j + 1) / ribs;
        if (air && p0 < phiDoor) {
          const mid = wrapPi((t0 + t1) / 2);
          if (Math.abs(mid) < airHalf * 1.35) continue;
        }
        const a = domePoint(R, H, p0, t0), b = domePoint(R, H, p0, t1),
          c = domePoint(R, H, p1, t1), d = domePoint(R, H, p1, t0);
        const cx = (a[0] + b[0] + c[0] + d[0]) / 4, cy = (a[1] + b[1] + c[1] + d[1]) / 4, cz = (a[2] + b[2] + c[2] + d[2]) / 4;
        const edges = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + Math.hypot(b[0] - c[0], b[1] - c[1], b[2] - c[2]);
        const k = clamp(1 - 0.16 / Math.max(0.1, edges / 2), 0.82, 0.98);
        const n = domeNormal(R, H, [cx, cy, cz]);
        const off = hi ? 0.025 : 0.015;
        const q = [a, b, c, d].map(p => [
          cx + (p[0] - cx) * k + n[0] * off,
          cy + (p[1] - cy) * k + n[1] * off,
          cz + (p[2] - cz) * k + n[2] * off,
        ]);
        quadOut(glass, q[0], q[1], q[2], q[3], n);
      }
    }
    /* Low detail: the panels are tiny facets; one surface is cheaper and reads the same. */
    if (lod === 'low') {
      glass.p = []; glass.n = []; glass.w = []; glass.e = [];
      const prof = [];
      for (let i = 0; i <= 8; i++) { const p = phi0 + (phiC - phi0) * i / 8; prof.push([R * Math.cos(p), H * Math.sin(p)]); }
      glass.add(lathe(prof, 24));
    }

    /* Meridian ribs and ring beams. */
    const ribW = hi ? 0.10 : 0.08, ribD = hi ? 0.18 : 0.14;
    const ribProfile = hi ? P2.round(ribW, ribD, 0.018, 2) : P2.chamfer(ribW, ribD, 0.014);
    const ringProfile = hi ? P2.round(0.09, 0.16, 0.014, 2) : P2.chamfer(0.08, 0.13, 0.012);
    const ribOff = ribD / 2 + 0.02;
    for (let j = 0; j < ribs; j++) {
      const th = TAU * j / ribs;
      for (let i = 0; i < nBand; i++) {
        const p0 = phi0 + dPhi * i, p1 = phi0 + dPhi * (i + 1);
        const a = domePoint(R, H, p0, th, ribOff), b = domePoint(R, H, p1, th, ribOff);
        const n = domeNormal(R, H, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        frame.add(beam(a, b, ribProfile, { up: n }));
      }
      const baseP = domePoint(R, H, phi0 + 0.01, th, ribOff);
      const baseN = domeNormal(R, H, baseP);
      if (lod !== 'low') frame.add(hi ? rbox(0.2, 0.1, 0.26, 0.01, 2) : box(0.2, 0.1, 0.26), X(T(baseP[0], baseP[1] + 0.04, baseP[2]), RY(th)));
      if (hi) boltsAt(bolts, X(T(baseP[0], ringH + 0.01, baseP[2]), RX(-HALF)), [[-0.1, 0], [0.1, 0]], 0.014);
    }
    const ringPhi = [];
    for (let i = 0; i <= nBand; i++) ringPhi.push(phi0 + dPhi * i);
    for (const p of ringPhi.slice(1, -1)) {
      for (let j = 0; j < ribs; j++) {
        const t0 = TAU * j / ribs, t1 = TAU * (j + 1) / ribs;
        const a = domePoint(R, H, p, t0, 0.02), b = domePoint(R, H, p, t1, 0.02);
        frame.add(beam(a, b, ringProfile, { up: [0, 1, 0] }));
      }
      if (hi) for (let j = 0; j < ribs; j++) {
        const th = TAU * j / ribs, pp = domePoint(R, H, p, th, 0.03);
        frame.add(cyl(0.075, 0.06, 8).at(pp[0], pp[1], pp[2]));
      }
    }

    /* Tension ring, concrete plinth and floor. */
    base.add(prism(P2.circle(ringOut, ringN), ringH, { holes: [P2.circle(ringIn, ringN)], bevel: hi ? 0.035 : 0 }).rx(-HALF).at(0, ringH / 2, 0));
    concrete.add(prism(P2.circle(ringOut + 0.35, ringN), 0.16, { holes: [P2.circle(ringIn - 0.15, ringN)] }).rx(-HALF).at(0, 0.08, 0));
    floor.add(cyl(R - 0.32, 0.12, ringN).at(0, FLOOR_Y - 0.06, 0));
    floor.add(prism(P2.circle(ringIn + 0.1, ringN), 0.02, { holes: [P2.circle(ringIn - 0.08, ringN)] }).rx(-HALF).at(0, FLOOR_Y + 0.01, 0));
    /* anchor bolts on the tension ring */
    if (lod !== 'low') {
      const bn = hi ? Math.max(12, Math.round(TAU * ringOut / 2.2)) : 12;
      for (let i = 0; i < bn; i++) {
        const a = TAU * i / bn;
        boltsAt(bolts, X(T(Math.cos(a) * (ringIn + 0.28), ringH + 0.01, Math.sin(a) * (ringIn + 0.28)), RX(-HALF)), [[0, 0]], hi ? 0.022 : 0.016, 'nut');
      }
    }
    /* perimeter drain channel and walkway markings */
    marks.add(prism(P2.circle(ringIn - 0.45, ringN), 0.004, { holes: [P2.circle(ringIn - 0.68, ringN)] }).rx(-HALF).at(0, FLOOR_Y + 0.012, 0));
    marks.add(prism(P2.circle(ringIn - 1.1, ringN), 0.004, { holes: [P2.circle(ringIn - 1.22, ringN)] }).rx(-HALF).at(0, FLOOR_Y + 0.012, 0));
    if (hi) for (let i = 0; i < 4; i++) {
      const a = TAU * i / 4 + Math.PI / 4;
      marks.add(box(1.8, 0.004, 0.12).ry(a), T(Math.cos(a) * (ringIn * 0.55), FLOOR_Y + 0.012, Math.sin(a) * (ringIn * 0.55)));
    }

    /* Crown compression ring and vent lantern. */
    const crownY = H * Math.sin(phiC);
    frame.add(prism(P2.circle(crownR + 0.18, Math.max(24, ribs * 2)), 0.32, { holes: [P2.circle(crownR - 0.04, Math.max(24, ribs * 2))], bevel: hi ? 0.03 : 0 }).rx(-HALF).at(0, crownY + 0.16, 0));
    if (lod !== 'low') {
      const drumH = 0.62;
      frame.add(cyl(crownR, drumH, hi ? 32 : 16, hi ? 0.04 : 0).at(0, crownY + 0.32 + drumH / 2, 0));
      if (hi) for (let i = 0; i < 24; i++) {
        const a = TAU * i / 24;
        frame.add(rbox(0.06, 0.28, 0.5, 0.012, 2), X(T(Math.cos(a) * (crownR + 0.05), crownY + 0.55, Math.sin(a) * (crownR + 0.05)), RY(-a), RZ(-0.32)));
      }
      const cap = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; cap.push([crownR * (1 - t * 0.92), crownY + 0.94 + t * 0.36]); }
      frame.add(lathe(cap, hi ? 32 : 16));
      lamps.add(prism(P2.circle(crownR + 0.09, Math.max(24, ribs * 2)), 0.035, { holes: [P2.circle(crownR - 0.02, Math.max(24, ribs * 2))] }).rx(-HALF).at(0, crownY + 0.3, 0));
    } else {
      frame.add(cyl(crownR, 0.5, 12).at(0, crownY + 0.4, 0));
    }

    /* Airlock: a vestibule attached to the ring, two doors, steps, rail and status lamp. */
    if (air) {
      const vx = ringOut + 1.35, vw = 2.75, vh = 2.55, vd = 2.75;
      const y0 = ringH;
      airlock.add(hi ? rbox(vw, vh, vd, 0.08, 3) : box(vw, vh, vd), T(vx, y0 + vh / 2, 0));
      /* a short collar from the shell to the vestibule */
      airlock.add(hi ? rbox(0.8, 2.35, 2.55, 0.05, 2) : box(0.8, 2.35, 2.55), T(ringOut + 0.05, y0 + 1.2, 0));
      /* portal frame around the opening in the shell */
      for (const sz of [-1, 1]) frame.add(hi ? rbox(0.16, 2.3, 0.16, 0.02, 2) : box(0.16, 2.3, 0.16), T(R + 0.02, y0 + 1.15, sz * 1.28));
      frame.add(hi ? rbox(0.16, 0.18, 2.72, 0.02, 2) : box(0.16, 0.18, 2.72), T(R + 0.02, y0 + 2.33, 0));
      /* outer door: a leaf in a recessed frame, a porthole and a small panel */
      const dx = vx + vw / 2 + 0.01, dh = 2.08, dw = 1.78;
      for (const sz of [-1, 1]) airlock.add(hi ? rbox(0.10, dh + 0.18, 0.12, 0.015, 2) : box(0.10, dh + 0.18, 0.12), T(dx, y0 + dh / 2 + 0.02, sz * (dw / 2 + 0.07)));
      airlock.add(hi ? rbox(0.10, 0.12, dw + 0.24, 0.015, 2) : box(0.10, 0.12, dw + 0.24), T(dx, y0 + dh + 0.12, 0));
      airlock.add(hi ? rbox(0.07, dh, dw, 0.025, 2) : box(0.07, dh, dw), T(dx + 0.015, y0 + dh / 2 + 0.02, 0));
      const portR = 0.24, portY = y0 + 1.45;
      const portPts = [];
      for (let i = 0; i < 24; i++) portPts.push([portR * Math.cos(TAU * i / 24), portR * Math.sin(TAU * i / 24)]);
      glass.add(prism(portPts, 0.04).ry(HALF).at(dx + 0.06, portY, 0));
      airlock.add(prism(P2.circle(portR + 0.08, 24), 0.06, { holes: [P2.circle(portR, 24)] }).ry(HALF).at(dx + 0.045, portY, 0));
      for (let i = 0; i < 8; i++) {
        const a = TAU * i / 8;
        bolts.add(bolt(0.012, 'hex'), X(T(dx + 0.08, portY + Math.sin(a) * (portR + 0.04), Math.cos(a) * (portR + 0.04)), RY(HALF)));
      }
      airlock.add(rbox(0.12, 0.34, 0.24, 0.015, 2), T(dx + 0.08, y0 + 1.0, 0.95));
      lenses.add(rbox(0.02, 0.07, 0.07, 0.008, 2), T(dx + 0.15, y0 + 1.12, 0.95));
      /* inner door */
      airlock.add(hi ? rbox(0.07, dh, dw, 0.02, 2) : box(0.07, dh, dw), T(vx - vw / 2 - 0.02, y0 + dh / 2 + 0.02, 0));
      /* steps down to grade, with rails */
      const steps = 3, rise = y0 / (steps + 1), tread = 0.30, sx0 = dx + 0.15;
      for (let i = 0; i < steps; i++) {
        const y = y0 - rise * (i + 1);
        concrete.add(box(tread, rise, 1.9).at(sx0 + tread * (i + 0.5), y + rise / 2, 0));
      }
      for (const sz of [-1, 1]) {
        rails.add(tube([[sx0 + tread * steps + 0.05, 1.05, sz * 0.98], [sx0 + 0.02, y0 + 0.95, sz * 0.98]], 0.024, { segs: hi ? 8 : 5, caps: 'flat' }));
        rails.add(tube([[sx0 + tread * steps + 0.05, 0.62, sz * 0.98], [sx0 + 0.02, y0 + 0.55, sz * 0.98]], 0.018, { segs: hi ? 7 : 4, caps: 'flat' }));
      }
      /* hazard strip on the top step */
      marks.add(stripes(1.9, 0.22, 0.10), X(T(sx0 + 0.15, y0 + 0.005, 0.11), RX(-HALF)));
    }

    /* Catwalk ring: grating segments, edge beams, brackets, rails and a ladder. */
    if (s.catwalk) {
      const hC = clamp(H * 0.5, 3.3, 5.2);
      const rShell = R * Math.sqrt(Math.max(0.05, 1 - (hC / H) * (hC / H)));
      const rC = Math.max(2.2, rShell - 0.95), nSeg = Math.max(16, ribs);
      const chord = 2 * rC * Math.sin(Math.PI / nSeg), wid = 1.05;
      const deckSeg = hi ? grating(chord + 0.04, wid) : box(chord + 0.04, 0.04, wid);
      for (let i = 0; i < nSeg; i++) {
        const a = TAU * (i + 0.5) / nSeg;
        const tan = [-Math.sin(a), 0, Math.cos(a)], rad = [Math.cos(a), 0, Math.sin(a)];
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...tan), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...rad))
          .setPosition(Math.cos(a) * rC, hC, Math.sin(a) * rC);
        deck.add(deckSeg, X(m, T(-chord / 2, 0, 0)));
        for (const sz of [-1, 1]) {
          deck.add(beam([-chord / 2, -0.09, sz * (wid / 2 - 0.04)], [chord / 2, -0.09, sz * (wid / 2 - 0.04)],
            P2.chamfer(0.05, 0.12, 0.008)), X(m, T(0, 0, 0)));
          if (lod !== 'low') deck.add(box(0.006, 0.10, 0.006), X(m, T(-chord / 2, -0.04, sz * (wid / 2 - 0.01))));
          if (hi) rails.add(box(chord, 0.09, 0.006), X(m, T(-chord / 2, 0.045, sz * (wid / 2 - 0.01))));
        }
        /* brackets to the shell at both ends of the segment */
        for (const e of [-1, 1]) {
          const ae = a + e * Math.PI / nSeg;
          const br = [Math.cos(ae) * rC, hC - 0.11, Math.sin(ae) * rC];
          const sh = [Math.cos(ae) * (rShell - 0.18), hC - 0.35, Math.sin(ae) * (rShell - 0.18)];
          const sh2 = [Math.cos(ae) * (rShell - 0.25), hC - 1.25, Math.sin(ae) * (rShell - 0.25)];
          deck.add(beam(br, sh, P2.chamfer(0.06, 0.06, 0.01)));
          deck.add(beam(sh, sh2, P2.chamfer(0.05, 0.05, 0.008)));
        }
      }
      /* rails: two circles on each edge, posts and toe boards */
      const railN = hi ? 96 : mid ? 64 : 40;
      const railSegs = hi ? 8 : mid ? 6 : 5;
      const railPts = (radius, y) => {
        const pts = [];
        for (let i = 0; i <= railN; i++) { const a = TAU * i / railN; pts.push([Math.cos(a) * radius, y, Math.sin(a) * radius]); }
        return pts;
      };
      for (const side of [-1, 1]) {
        const rr = rC + side * (wid / 2 - 0.02);
        for (const y of [hC + 1.08, hC + 0.56]) rails.add(tube(railPts(rr, y), 0.022, { segs: railSegs, caps: 'none' }));
        const nPost = Math.max(8, Math.round(TAU * rr / (hi ? 1.5 : mid ? 1.9 : 2.5)));
        for (let i = 0; i < nPost; i++) {
          const a = TAU * i / nPost;
          rails.add(cyl(0.025, 1.08, hi ? 8 : 5).at(Math.cos(a) * rr, hC + 0.54, Math.sin(a) * rr));
        }
      }
      /* ladder at the back, from the floor to the catwalk */
      const la = Math.PI, lr = rC - 0.15, lx = Math.cos(la) * lr, lz = Math.sin(la) * lr;
      const lh = hC - FLOOR_Y;
      for (const sz of [-1, 1]) {
        rails.add(tube([[lx + sz * 0.26, FLOOR_Y, lz], [lx + sz * 0.26, hC + 1.1, lz]], 0.026, { segs: hi ? 8 : 5, caps: 'flat' }));
      }
      const nRung = Math.max(4, Math.floor(lh / 0.3));
      for (let i = 0; i < nRung; i++) rails.add(cyl(0.018, 0.52, 6).rz(HALF).at(lx, FLOOR_Y + 0.2 + (lh - 0.25) * i / Math.max(1, nRung - 1), lz));
      if (hi) for (let i = 0; i < 3; i++) {
        const y = FLOOR_Y + lh * 0.55 + i * 0.65;
        rails.add(tube(railPts(0.35, y).map(p => [lx + p[0], p[1], lz + p[2]]), 0.014, { segs: 5, caps: 'none' }));
      }
    }

    /* Central nutrient core and light mast. */
    if (s.core) {
      const cy = FLOOR_Y;
      core.add(cyl(1.12, 1.18, hi ? 28 : 16, hi ? 0.05 : 0).at(0, cy + 0.59, 0));
      core.add(lathe([[1.12, 0], [1.08, 0.16], [0.92, 0.32], [0.55, 0.42], [0, 0.45]], hi ? 28 : 16).at(0, cy + 1.18, 0));
      core.add(cyl(1.2, 0.06, hi ? 28 : 16).at(0, cy + 1.18, 0));
      /* level window and control panel */
      glass.add(prism(P2.rect(0.42, 0.56), 0.03).ry(HALF).at(1.11, cy + 0.62, 0));
      core.add(rbox(0.08, 0.5, 0.72, 0.02, 2).at(1.15, cy + 0.68, 0));
      for (let i = 0; i < 4; i++) lamps.add(cyl(0.025, 0.02, 8).rx(HALF).at(1.2, cy + 0.5 + i * 0.11, 0.06));
      /* ring main around the core and four risers */
      pipes.add(tube(Array.from({ length: 33 }, (_, i) => [Math.cos(TAU * i / 32) * 1.55, cy + 0.22, Math.sin(TAU * i / 32) * 1.55]), 0.045,
        { segs: hi ? 10 : 6, caps: 'none' }));
      for (let i = 0; i < 4; i++) {
        const a = TAU * i / 4 + Math.PI / 4, x = Math.cos(a) * 1.55, z = Math.sin(a) * 1.55;
        pipes.add(tube([[x, cy + 0.22, z], [x, cy + 1.0, z], [x * 0.82, cy + 1.1, z * 0.82]], 0.032, { segs: hi ? 8 : 5, bend: 0.07, caps: 'flat' }));
        if (hi) fittings.add(rbox(0.10, 0.14, 0.09, 0.012, 2).at(x, cy + 0.62, z));
      }
      /* light mast and six high-bay fixtures */
      const mastH = 4.6;
      core.add(cyl(0.11, mastH, hi ? 12 : 8).at(0, cy + 1.55 + mastH / 2, 0));
      core.add(cyl(0.18, 0.07, hi ? 16 : 10).at(0, cy + 1.55 + mastH - 0.2, 0));
      for (let i = 0; i < 6; i++) {
        const a = TAU * i / 6, r = 0.62, x = Math.cos(a) * r, z = Math.sin(a) * r, y = cy + 1.55 + mastH - 0.55;
        core.add(beam([0, y + 0.2, 0], [x, y, z], P2.chamfer(0.035, 0.035, 0.006)));
        lamps.add(rbox(0.46, 0.14, 0.34, 0.025, 2), X(T(x, y - 0.08, z), RY(-a)));
        lenses.add(rbox(0.38, 0.015, 0.28, 0.006, 2), X(T(x, y - 0.16, z), RY(-a)));
      }
    }

    /* A few drain grates in the aisles. */
    if (lod !== 'low') for (let i = 0; i < 4; i++) {
      const a = TAU * i / 4 + Math.PI / 4, r = R * 0.42;
      deck.add(grating(0.55, 0.4), X(T(Math.cos(a) * r, FLOOR_Y + 0.005, Math.sin(a) * r), RY(-a)));
    }

    return {
      layers: [
        { name: 'Glazing', geo: glass, mat: glassMat },
        { name: 'Structure', geo: frame, mat: MAT.paint(s.color) },
        { name: 'Tension ring', geo: base, mat: MAT.steel },
        { name: 'Concrete', geo: concrete, mat: { color: '#6F6E67', rough: 0.92, metal: 0 } },
        { name: 'Floor', geo: floor, mat: { color: '#3A403D', rough: 0.88, metal: 0.02 } },
        { name: 'Catwalk', geo: deck, mat: MAT.galv },
        { name: 'Handrails', geo: rails, mat: MAT.paint('#D8A22A') },
        { name: 'Airlock', geo: airlock, mat: MAT.paint('#C6CBC4') },
        { name: 'Core', geo: core, mat: MAT.steel },
        { name: 'Service pipes', geo: pipes, mat: MAT.paint('#6C8E93') },
        { name: 'Light housings', geo: lamps, mat: { color: '#2A2D31', rough: 0.5, metal: 0.4 } },
        { name: 'Light lenses', geo: lenses, mat: { color: '#FF8FC4', rough: 0.3, metal: 0, glow: 2.2 } },
        { name: 'Markings', geo: marks, mat: MAT.mark('#E0B33A') },
        { name: 'Fittings', geo: fittings, mat: MAT.zinc },
        { name: 'Fasteners', geo: bolts, mat: MAT.zinc },
      ],
      figure: [R * 0.42, 0.4, 0],
    };
  },
};

/* =====================================================================
   LAYOUT — rows in concentric bays, with feed points for the pipe mains.
   ===================================================================== */
const layoutDefaults = {
  diameter: 24, bays: 8, innerBays: 5, rowsPerBay: 2, tiers: 4,
  crop: 'mixed', rowPitch: 1.15, color: '#D8DAD3', leafColor: '#4F8A3C',
};
/**
 * Place grow rows in a dome. Returns one entry per row:
 *   { spec, matrix, feed, ring, bay, angle }
 * `feed` is the world-space point at the bottom of the row's drip manifold,
 * ready to be joined to a branch from the pipes kit. Rows are tangential to
 * their ring; `matrix` is a world transform for createModel or createField.
 */
export function layoutRows(spec = {}) {
  const s = { ...layoutDefaults, ...spec }, R = s.diameter / 2, out = [];
  const doorHalf = Math.asin(clamp(1.6 / R, 0, 0.8));
  const rings = [
    { radius: R * 0.35, bays: s.innerBays, tiers: Math.max(2, s.tiers - 1), ring: 0 },
    { radius: R * 0.68, bays: s.bays, tiers: s.tiers, ring: 1 },
  ];
  const cropAt = (i, ring) => s.crop === 'mixed' ? CROP_ORDER[(i + ring * 2) % CROP_ORDER.length] : s.crop;
  for (const rg of rings) {
    if (!rg.bays) continue;
    const slot = TAU / rg.bays;
    for (let i = 0; i < rg.bays; i++) {
      const th = i * slot;
      if (ahead(th, 0) < slot * 0.52 + doorHalf * 0.4) continue;
      for (let k = 0; k < s.rowsPerBay; k++) {
        const r = rg.radius + (k - (s.rowsPerBay - 1) / 2) * s.rowPitch;
        const chord = 2 * r * Math.sin(Math.PI / rg.bays);
        const raw = clamp(chord * 0.78, 2.2, 10);
        const len = Math.round(raw * 2) / 2;
        const tan = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th));
        const rad = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
        const m = new THREE.Matrix4().makeBasis(tan, new THREE.Vector3(0, 1, 0), rad)
          .setPosition(Math.cos(th) * r, FLOOR_Y + 0.01, Math.sin(th) * r);
        const crop = cropAt(i + k, rg.ring);
        const rowSpec = {
          length: len, tiers: rg.tiers, width: 0.9, pitch: 0.65,
          crop, lights: true, tank: k === 0, color: s.color, leafColor: s.leafColor,
        };
        const feed = new THREE.Vector3(-len / 2 + 0.10, 0.2, 0.9 / 2 + 0.08).applyMatrix4(m);
        out.push({ spec: rowSpec, matrix: m, feed, ring: rg.ring, bay: i, angle: th });
      }
    }
  }
  return out;
}

/**
 * A whole greenhouse: the dome, its grow rows and a shared material cache.
 * Returns a THREE.Group; userData.dispose() frees the geometries and the
 * materials this function made. Rows are separate ProceduralModel groups;
 * for hundreds of rows, use layoutRows() + createField('grow-row', ...).
 */
export function createGreenhouse(spec = {}, opts = {}) {
  const s = { ...layoutDefaults, ...spec };
  const group = new THREE.Group();
  group.name = 'greenhouse';
  const cache = new Map();
  const materials = (layer) => {
    const key = JSON.stringify(layer);
    let m = cache.get(key);
    if (!m) { m = greenhouseMaterials(layer); cache.set(key, m); }
    return m;
  };
  const modelOpts = { ...opts, materials };
  const dome = createModel('greenhouse-dome', {
    diameter: s.diameter,
    rise: spec.rise,
    ribs: spec.ribs,
    bands: spec.bands,
    glazing: spec.glazing,
    airlock: spec.airlock,
    catwalk: spec.catwalk,
    core: spec.core,
    color: s.color,
    detail: opts.detail || 'high',
  }, modelOpts);
  group.add(dome);
  const rows = layoutRows(s);
  for (const row of rows) {
    const m = createModel('grow-row', { ...row.spec, detail: opts.detail || 'high' }, modelOpts);
    m.position.setFromMatrixPosition(row.matrix);
    m.quaternion.setFromRotationMatrix(row.matrix);
    m.name = `grow-row-${row.ring}-${row.bay}`;
    group.add(m);
  }
  group.userData = {
    dome, rows, feeds: rows.map(r => r.feed),
    dispose() {
      for (const c of [...group.children]) { if (c.dispose) c.dispose(); group.remove(c); }
      for (const m of cache.values()) m.dispose();
      cache.clear();
    },
  };
  return group;
}

/** Register both models with the procedural-models library. */
export function registerGreenhouse() {
  registerModel(growRow);
  registerModel(greenhouseDome);
  return ['greenhouse-dome', 'grow-row'];
}
