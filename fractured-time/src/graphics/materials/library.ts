import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { fbm, hash21 } from '../shaders/common';

/**
 * Procedural material templates (no texture sets): built from world position, so nothing tiles and every panel differs.
 * Used for test rooms, blockouts and props that carry no scanned set. Each preset is a parameter set for `surface()`;
 * variants are made by spreading a preset and changing a few values (`surface({ ...PRESETS.steel, base: 0x30343a })`).
 *
 * Layers, bottom to top: base (colour, roughness, metalness) -> large-scale shade drift -> panel layout (seams, per-panel
 * tone, corner bolts) -> scratches -> grime (low and in seams) -> dust (on up-facing faces) -> analytic bump.
 */
const T = TSL as any;
const { Fn, float, vec2, vec3, positionWorld, normalWorld, mix, smoothstep, abs, fract, floor, max, min, select, transformNormalToView, normalize, dot,
  color, time, sin } = T;

export interface SurfaceParams {
  base: number;
  rough?: number;
  metal?: number;
  /** panel size (m) and seam width (m); 0 = continuous */
  panel?: number;
  seam?: number;
  bolts?: boolean;
  grime?: number;
  scratch?: number;
  dust?: number;
  /** bump strength (0 = flat) and its scale (1/m) */
  bump?: number;
  bumpScale?: number;
  /** clear coat (lacquer, varnish) */
  coat?: number;
  /** a horizontal accent stripe colour */
  accent?: number;
  /** emissive colour and strength (HDR) */
  emissive?: number;
  emissiveStrength?: number;
  /** fabric-like sheen */
  sheen?: number;
}

export const PRESETS = {
  concrete: { base: 0x7d7b77, rough: 0.86, metal: 0, panel: 2.4, seam: 0.008, grime: 0.7, bump: 0.9, bumpScale: 9, dust: 0.3 },
  stone: { base: 0x8a8378, rough: 0.78, metal: 0, panel: 0.6, seam: 0.012, grime: 0.5, bump: 1.2, bumpScale: 14 },
  steel: { base: 0x6e737a, rough: 0.38, metal: 1, panel: 1.5, seam: 0.012, bolts: true, grime: 0.5, scratch: 0.6 },
  brushedSteel: { base: 0x9aa0a6, rough: 0.28, metal: 1, scratch: 0.9, grime: 0.2 },
  aluminium: { base: 0xb9bec4, rough: 0.32, metal: 1, panel: 1.2, seam: 0.006, scratch: 0.4, grime: 0.3 },
  paintedMetal: { base: 0x3d4650, rough: 0.5, metal: 0.15, panel: 1.8, seam: 0.012, bolts: true, grime: 0.8, scratch: 0.7, coat: 0.2 },
  hazard: { base: 0xc7861e, rough: 0.6, metal: 0.25, panel: 0.6, grime: 0.8, scratch: 0.6 },
  wood: { base: 0x6b4a32, rough: 0.6, metal: 0, panel: 0.18, seam: 0.003, grime: 0.3, bump: 0.5, bumpScale: 40, coat: 0.3 },
  fabric: { base: 0x4a4f57, rough: 0.92, metal: 0, bump: 0.4, bumpScale: 300, sheen: 0.7 },
  leather: { base: 0x2c211b, rough: 0.55, metal: 0, bump: 0.5, bumpScale: 120, coat: 0.15, scratch: 0.3 },
  rubber: { base: 0x161718, rough: 0.82, metal: 0, grime: 0.4, dust: 0.4 },
  lightPanel: { base: 0x101214, rough: 0.3, metal: 0, emissive: 0xdfeeff, emissiveStrength: 2.4 },
} satisfies Record<string, SurfaceParams>;

export function surface(o: SurfaceParams): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionWorld;
  const nW = normalWorld;
  const ay = abs(nW.y), ax = abs(nW.x), az = abs(nW.z);
  // the two world axes in the surface's plane
  const uvp = select(ay.greaterThan(max(ax, az)), vec2(p.x, p.z), select(ax.greaterThan(az), vec2(p.z, p.y), vec2(p.x, p.y)));
  const size = o.panel ?? 0;
  const seamW = o.seam ?? 0.012;
  const base = color(new THREE.Color(o.base));

  const layers = Fn(() => {
    const albedo = base.toVar();
    albedo.assign(albedo.mul(mix(float(0.8), float(1.1), fbm(p, 0.35, 2))).mul(mix(float(0.93), float(1.05), fbm(p, 4.0, 3))));
    const seam = float(0).toVar();
    const bolt = float(0).toVar();
    if (size > 0) {
      const g = uvp.div(size);
      const f = fract(g);
      const dEdge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(size);
      seam.assign(float(1).sub(smoothstep(seamW * 0.5, seamW, dEdge)));
      albedo.assign(albedo.mul(mix(float(0.9), float(1.08), hash21(floor(g)))));
      if (o.bolts) {
        const corner = vec2(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(size);
        bolt.assign(float(1).sub(smoothstep(0.006, 0.011, corner.sub(vec2(0.045, 0.045)).length())));
      }
    }
    const low = float(1).sub(smoothstep(0.0, 1.6, p.y));
    const grime = fbm(p.add(vec3(3.1, 7.7, 1.3)), 1.8, 3).mul(low.mul(0.8).add(0.35)).mul(o.grime ?? 0.5);
    albedo.assign(mix(albedo, albedo.mul(0.38), grime.mul(0.8)));
    albedo.assign(mix(albedo, albedo.mul(0.4), seam.mul(0.85)));
    albedo.assign(mix(albedo, albedo.mul(1.5), bolt.mul(0.5)));
    if (o.accent !== undefined) {
      const stripe = smoothstep(0.02, 0.0, abs(fract(p.y.mul(0.5)).sub(0.5)).sub(0.46));
      albedo.assign(mix(albedo, color(new THREE.Color(o.accent)), stripe.mul(0.8)));
    }
    if (o.dust) albedo.assign(mix(albedo, vec3(0.42, 0.4, 0.37), smoothstep(0.7, 0.98, nW.y).mul(fbm(p, 2.0, 2)).mul(o.dust)));
    return T.vec4(albedo, seam);
  })();
  m.colorNode = layers.rgb;
  const scratches = smoothstep(0.72, 0.9, fbm(vec3(uvp.x, uvp.y.mul(0.08), 5.0), 22.0, 2)).mul(o.scratch ?? 0.3);
  const worn = fbm(p, 2.4, 3);
  m.roughnessNode = float(o.rough ?? 0.6).add(worn.sub(0.5).mul(0.3)).sub(scratches.mul(0.25)).add(layers.a.mul(0.2)).clamp(0.04, 1.0);
  m.metalnessNode = float(o.metal ?? 0).add(scratches.mul(0.2)).clamp(0, 1);
  if ((o.bump ?? 0.5) > 0) {
    const k = o.bump ?? 0.5;
    const s = o.bumpScale ?? 9;
    m.normalNode = Fn(() => {
      const e = 0.5 / s;
      const h = (q: any) => fbm(q, s, 2).mul(0.6).add(fbm(q, s * 4.2, 2).mul(0.4));
      const h0 = h(p);
      const g = vec3(h(p.add(vec3(e, 0, 0))).sub(h0), h(p.add(vec3(0, e, 0))).sub(h0), h(p.add(vec3(0, 0, e))).sub(h0)).div(e);
      const tang = g.sub(nW.mul(dot(g, nW)));
      return transformNormalToView(normalize(nW.sub(tang.mul(0.012 * k * (9 / s)))));
    })();
  }
  if (o.coat) { m.clearcoat = o.coat; m.clearcoatRoughness = 0.12; }
  if (o.sheen) { m.sheen = o.sheen; m.sheenRoughness = 0.6; m.sheenColor = new THREE.Color(o.base).lerp(new THREE.Color(1, 1, 1), 0.4); }
  if (o.emissive !== undefined) m.emissiveNode = color(new THREE.Color(o.emissive)).mul(o.emissiveStrength ?? 2);
  return m;
}

/** Emissive panels and strips: HDR so bloom picks them up. */
export function emissivePanel(col: number, strength = 4): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.4 });
  m.emissiveNode = color(new THREE.Color(col)).mul(strength);
  return m;
}

/** Animated chronal energy: fracture seams, portals, anything the Engine touches. */
export function chronalEnergy(col = 0x5ad8ff, strength = 3): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const p = positionWorld;
  const flow = fbm(p.mul(1.2).add(vec3(0, time.mul(0.6), 0)), 3.0, 3);
  const bands = smoothstep(0.5, 0.95, sin(p.y.mul(6.0).add(time.mul(2.0)).add(flow.mul(5.0))).mul(0.5).add(0.5));
  m.colorNode = color(new THREE.Color(col)).mul(strength).mul(bands.mul(0.8).add(flow.mul(0.4)));
  m.opacityNode = bands.mul(0.7).add(0.15);
  return m;
}
