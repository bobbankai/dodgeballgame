import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { resources } from '../core/resources';
import { AO_SETS } from './aosets';
import { HIRES_SETS } from './hires';
import { fbm, luminance } from '../shaders/common';
import { parallax, untiled } from '../shaders/sampling';
import type { Recipe } from './recipes';
import { materialQuality } from './quality';

/**
 * Environment surfaces, rebuilt from the recipes the Blender export stores on each material (glTF extras -> userData.ft):
 * the same recipe drives the Cycles bake and the game, so the approved look is what draws.
 *
 *   scan     : photoscanned sets (Poly Haven, CC0): desaturate + tint, roughness remap, normal, the scan's AO, optional
 *              parallax occlusion, anti-tiling on large repeats, and a slow world-space macro variation (no two metres of a
 *              floor are the same shade)
 *   plain    : a flat dielectric/metal, optional lacquer (vehicles) or worn hazard striping
 *   screen   : a monitor: the image as emission with a faint scan flicker
 *   glass    : architectural glass, almost all reflection
 *   emissive : chronal light-lines (breathing) and practical lights (steady; lit window panes get an interior read)
 */
const T = TSL as any;
const { texture, uv, vec2, vec3, float, mix, dot, smoothstep, abs, fract, floor, sin, time, positionWorld, normalWorld, step, hash } = T;

const scanPath = (id: string) => `textures/pbr/${id}/${id}`;

export function scanned(r: Recipe): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const base = scanPath(String(r.tex));
  const tile = Number(r.tile ?? 1);
  const u0 = uv().mul(tile);
  const pom = Number(r.pom ?? 0) > 0 && materialQuality.pomSteps > 0;
  // large repeats (floors, walls tiled many times) break up their repetition; relief surfaces keep one coherent offset
  const antiTile = !pom && materialQuality.antiTiling && tile >= 0.6;
  const u = pom ? parallax(u0, resources.texture(`${base}_disp.jpg`, false), Number(r.pom), tile, materialQuality.pomSteps) : u0;
  const sample = (path: string, srgb: boolean) => (antiTile ? untiled(resources.texture(path, srgb), u) : texture(resources.texture(path, srgb), u));
  // the maps that carry visible detail at 2K where shipped (High and Ultra); AO and height stay 1K (low frequency)
  const hi = materialQuality.textureResolution === '2k' && HIRES_SETS.has(String(r.tex)) ? '_2k' : '';
  const d = sample(`${base}_diff${hi}.jpg`, true).rgb;
  const c = r.desat === null || r.desat === undefined ? d : mix(vec3(luminance(d)), d, float(r.desat));
  const t = (r.tint ?? [1, 1, 1]) as number[];
  // the scan's ambient occlusion at 0.8, as in the Blender material (grooves, seams, the gaps between bricks)
  const ao = AO_SETS.has(String(r.tex)) ? mix(float(1), sample(`${base}_ao.jpg`, false).r, float(0.8)) : float(1);
  // macro variation over metres, in world space: a slow drift of shade and polish
  const macro = fbm(positionWorld, 0.23, 2);
  m.colorNode = c.mul(vec3(t[0], t[1], t[2])).mul(ao).mul(mix(float(0.9), float(1.08), macro));
  m.roughnessNode = sample(`${base}_rough${hi}.jpg`, false).r.mul(r.rough_mul ?? 1).add(r.rough_add ?? 0).add(macro.sub(0.5).mul(0.08)).clamp(0.04, 1);
  m.normalNode = T.normalMap(sample(`${base}_nor_gl${hi}.jpg`, false), vec2(r.normal ?? 1));
  m.metalness = Number(r.metal ?? 0);
  m.clearcoat = Number(r.coat ?? 0);
  m.clearcoatRoughness = 0.35;
  // lit windows of facade sets at dusk: an emission map on its own tile
  if (r.emit) m.emissiveNode = texture(resources.texture(`${base}_emit.jpg`, true), uv().mul(r.emitTile ?? tile)).rgb.mul(float(r.emit));
  return m;
}

export function plain(r: Recipe): THREE.MeshPhysicalNodeMaterial {
  const c = (r.color ?? [0.5, 0.5, 0.5]) as number[];
  const m = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(c[0], c[1], c[2]), roughness: r.rough ?? 0.5, metalness: r.metal ?? 0 });
  if (r.coat) {
    // lacquer over paint (vehicles): a sharp second reflection the street's lights streak across
    m.clearcoat = Number(r.coat);
    m.clearcoatRoughness = 0.04;
  }
  const p = positionWorld;
  const n = fbm(p, 9.0, 3);
  if (r.stripes) {
    // painted hazard striping (world-space diagonal), worn: scuffed, roughness broken up
    const st = smoothstep(0.47, 0.53, fract(p.x.add(p.z).add(p.y.mul(0.5)).mul(float(r.stripes))));
    const scuff = smoothstep(0.62, 0.9, n);
    m.colorNode = mix(mix(vec3(c[0], c[1], c[2]), vec3(0.02, 0.02, 0.022), st), vec3(0.25, 0.25, 0.24), scuff.mul(0.6));
    m.roughnessNode = float(r.rough ?? 0.6).add(n.sub(0.5).mul(0.3));
  } else {
    // even a plain paint is never perfectly uniform: a faint mottle in shade and gloss
    m.colorNode = vec3(c[0], c[1], c[2]).mul(mix(float(0.94), float(1.04), fbm(p, 0.6, 2)));
    m.roughnessNode = float(r.rough ?? 0.5).add(n.sub(0.5).mul(0.06)).clamp(0.02, 1);
  }
  return m;
}

export function screen(r: Recipe): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.08 });
  const t = resources.texture(String(r.tex), true);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const c = texture(t, uv()).rgb;
  m.colorNode = c.mul(0.05);
  m.emissiveNode = c.mul(float(r.strength ?? 3).mul(sin(time.mul(37.0).add(uv().y.mul(420.0))).mul(0.04).add(0.96)));
  return m;
}

/** Architectural glass: thin, faintly tinted, almost all reflection (the section's probe, SSR and the lights). */
export function glass(r: Recipe): THREE.MeshPhysicalNodeMaterial {
  const t = (r.tint ?? [0.75, 0.85, 0.9]) as number[];
  const m = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(t[0] * 0.08, t[1] * 0.08, t[2] * 0.08),
    roughness: Math.max(0.03, r.rough ?? 0.05), metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  m.specularIntensity = 1;
  m.ior = 1.52;
  return m;
}

/** Chronal light-lines: HDR emission with a slow breath. */
export function chronalLight(r: Recipe): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050708, roughness: 0.25 });
  const c = (r.color ?? [0.35, 0.85, 1]) as number[];
  const pulse = sin(time.mul(1.7)).mul(0.12).add(0.88);
  m.emissiveNode = vec3(c[0], c[1], c[2]).mul(float(r.strength ?? 8).mul(0.45)).mul(pulse);
  return m;
}

/**
 * Practical lights (windows, shop interiors, lamps, neon, furnace mouths): steady. Lit window panes get an interior read
 * from the street: each pane its own brightness (hashed from its cell on the facade), brighter under the ceiling, mullions
 * every 1.3 m, three in ten behind blinds; the bake's own strength is far too hot for a window seen at night.
 */
export function practical(r: Recipe, name: string): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050708, roughness: 0.25 });
  const col = (r.color ?? [1, 0.9, 0.8]) as number[];
  const c = vec3(col[0], col[1], col[2]);
  const k = float(r.strength ?? 8).mul(0.45);
  if (!/^win_/.test(name)) { m.emissiveNode = c.mul(k); return m; }
  const p = positionWorld;
  const along = mix(p.x, p.z, step(0.5, abs(normalWorld.x)));
  const cell = floor(along.div(3.2)).add(floor(p.y.div(3.6)).mul(17.0));
  const h = hash(cell.add(0.37));
  const h2 = hash(cell.add(5.1));
  const level = h.mul(0.75).add(0.25);
  const ceiling = smoothstep(0.0, 1.0, fract(p.y.div(3.6))).mul(0.5).add(0.5);
  const mull = smoothstep(0.0, 0.04, abs(fract(along.div(1.3)).sub(0.5)).sub(0.46).negate());
  const slats = step(0.45, fract(p.y.mul(9.0))).mul(0.6).add(0.3);
  const blinds = mix(float(1), slats, step(h2, 0.3));
  m.emissiveNode = c.mul(k).mul(0.32).mul(level).mul(ceiling).mul(mull).mul(blinds);
  return m;
}

/** Material names that are practical fixtures rather than chronal light. */
export const PRACTICAL_NAMES = /^(win_|shop_|lamp_lens|neon_|m_lamp|m_chalk|c5_booth|furnace|molten|a_light|light_|n_engine)/;

void dot; void sin;
