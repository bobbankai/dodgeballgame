import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { stackShells, hairShellMaterial } from './hairshell';
import { SkinNodeMaterial } from './skin';

/**
 * Character materials for WebGPU, rebuilt from the recipes the Blender export stores on each material (glTF extras -> userData.ft).
 * The same recipe drives the Cycles review render and the game, so what was approved in review is what the game draws.
 *   skin    : SSS translucency (MeshSSSNodeMaterial), baked colour + roughness, pore detail normal tiled over the UVs
 *   pbr     : photoscanned fabric/leather sets (Poly Haven, CC0): desaturate + tint, roughness remap, normal map, tiling
 *   armour  : procedural composite plates: aligned machined grooves, curvature edge wear, roughness breakup
 *   emissive: chronal light-lines (HDR so bloom catches them)
 *   hair    : alpha-tested cards with a procedural strand mask
 *   eye / cornea : eyeball + wet transparent cornea shell
 */
const T = TSL as any;
const { texture, uv, vec2, vec3, float, mix, dot, smoothstep, abs, fract, sin, positionGeometry, normalView, positionView, fwidth, length,
  normalMap, color, mx_fractal_noise_float, time, clamp } = T;

const loader = new THREE.TextureLoader();
const texCache = new Map<string, THREE.Texture>();
const pending = new Set<Promise<unknown>>();

/** Resolves when every texture requested by the character materials so far has loaded (or failed). Await before the first frame. */
export async function texturesReady(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
export const assetUrl = (p: string) => `${import.meta.env.BASE_URL}assets/${p}`.replace(/\/\/+/g, '/');

export function tex(path: string, srgb: boolean): THREE.Texture {
  const key = path + (srgb ? ':s' : ':l');
  let t = texCache.get(key);
  if (!t) {
    let done!: () => void;
    const p = new Promise<void>((r) => (done = r));
    pending.add(p);
    const finish = () => { pending.delete(p); done(); };
    t = loader.load(assetUrl(path), finish, undefined, (e) => { console.warn('[charmat] texture failed', path, e); finish(); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    texCache.set(key, t);
  }
  return t;
}

export interface Recipe { type: string; [k: string]: any }

function skin(r: Recipe, old: THREE.MeshStandardMaterial): THREE.Material {
  // Dual-lobe skin, as in production real-time skin shading:
  //   base lobe : the smooth surface normal (diffuse wraps softly over the face; no pore noise in the shading), broad specular
  //   clearcoat : a weaker, sharper oily lobe carrying the pore normal, so highlights break up across the pores
  //   cavity    : the pore height darkens the diffuse inside the pores and roughens them
  //   scatter   : red-wrapped diffuse at the terminator (src/rendering/skin.ts) + translucency of thin parts against back light
  const m = new SkinNodeMaterial();
  const u = uv();
  const pu = u.mul(r.pore_tile ?? 34);
  const poreH = texture(tex(r.pores.replace('_n.png', '_h.png'), false), pu).r; // 1 = skin surface, 0 = bottom of a pore
  const cavity = mix(float(0.86), float(1.0), smoothstep(0.15, 0.75, poreH));
  if (old.map) m.colorNode = texture(old.map, u).rgb.mul(cavity);
  let notScalp: any = float(1.0);
  let rough: any = float(0.55);
  if (old.roughnessMap) {
    rough = texture(old.roughnessMap, u).g;
    // the bake marks the scalp under the hair as roughness ~1: no specular or sheen there (it read as a grey sheen through the hair)
    notScalp = smoothstep(0.97, 0.9, rough);
  }
  m.roughnessNode = rough.add(cavity.oneMinus().mul(0.6)).clamp(0.3, 1.0);
  (m as any).specularIntensityNode = float(0.36).mul(notScalp);
  m.metalness = 0;
  // oily lobe: a little oilier where the bake made the skin smoother (T-zone), none on the scalp
  (m as any).clearcoatNode = smoothstep(0.72, 0.5, rough).mul(0.08).add(0.035).mul(notScalp);
  (m as any).clearcoatRoughnessNode = rough.mul(0.55).clamp(0.22, 0.6);
  (m as any).clearcoatNormalNode = normalMap(texture(tex(r.pores, false), pu), vec2(r.pore_strength ?? 0.5));
  const s = r.sss_color ?? [0.85, 0.3, 0.2];
  (m as any).thicknessColorNode = vec3(s[0], s[1], s[2]).mul(0.06);
  (m as any).thicknessDistortionNode = float(0.1);
  (m as any).thicknessAmbientNode = float(0.0);
  (m as any).thicknessAttenuationNode = float(0.5);
  (m as any).thicknessPowerNode = float(12.0);
  (m as any).thicknessScaleNode = float(1.5);
  return m;
}

export function pbr(r: Recipe): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const base = `textures/pbr/${r.tex}/${r.tex}`;
  const u = uv().mul(r.tile ?? 1);
  const d = texture(tex(`${base}_diff.jpg`, true), u).rgb;
  const lum = dot(d, vec3(0.2126, 0.7152, 0.0722));
  const c = r.desat === null || r.desat === undefined ? d : mix(vec3(lum), d, float(r.desat));
  const t = r.tint ?? [1, 1, 1];
  m.colorNode = c.mul(vec3(t[0], t[1], t[2]));
  m.roughnessNode = texture(tex(`${base}_rough.jpg`, false), u).r.mul(r.rough_mul ?? 1).add(r.rough_add ?? 0).clamp(0.04, 1);
  m.normalNode = normalMap(texture(tex(`${base}_nor_gl.jpg`, false), u), vec2(r.normal ?? 1));
  m.metalness = r.metal ?? 0;
  m.clearcoat = r.coat ?? 0;
  m.clearcoatRoughness = 0.35;
  return m;
}

export function armour(r: Recipe): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry; // rest pose: the pattern sticks to the plate while it moves
  const k = r.grooves ?? 9;
  // aligned machined grooves: horizontal bands every ~1/k m, plus a vertical centre seam
  const gy = abs(fract(p.y.mul(k)).sub(0.5));
  const gx = abs(p.x);
  const groove = smoothstep(0.47, 0.49, gy).max(float(1).sub(smoothstep(0.002, 0.0045, gx)));
  // screen-space curvature -> worn, lighter edges
  const curv = length(fwidth(normalView)).div(length(fwidth(positionView)).max(1e-5)).mul(0.004).clamp(0, 1);
  const n = mx_fractal_noise_float(p.mul(120.0), 3, 2.0, 0.5).mul(0.5).add(0.5);
  const b = r.base, e = r.edge;
  const wear = smoothstep(0.35, 0.9, curv).mul(n).mul(float(r.wear ?? 0.5).mul(1.6)).clamp(0, 1);
  m.colorNode = mix(vec3(b[0], b[1], b[2]), vec3(e[0], e[1], e[2]), wear).mul(float(1).sub(groove.mul(0.65)));
  m.roughnessNode = float(r.rough ?? 0.42).add(n.sub(0.5).mul(0.25)).add(groove.mul(0.2)).clamp(0.08, 1);
  m.metalness = 0.05;
  m.clearcoat = r.coat ?? 0.15;
  m.clearcoatRoughness = 0.3;
  return m;
}

export function emissive(r: Recipe): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050708, roughness: 0.25 });
  const c = r.color ?? [0.35, 0.85, 1];
  const pulse = sin(time.mul(1.7)).mul(0.12).add(0.88);
  m.emissiveNode = vec3(c[0], c[1], c[2]).mul(float(r.strength ?? 8).mul(0.45)).mul(pulse);
  return m;
}

function hair(r: Recipe): THREE.Material {
  // Cards are ribbons along real groomed strands (UV u across, v along; glTF flips v so uv().y = 1 at the root, 0 at the tip).
  // Normals come from the scalp (coherent volume shading); the exported tangent runs across the card, so a 90 degree anisotropy
  // rotation stretches the highlight along the strand (primary reflection). Coverage is alpha-hashed: TRAA resolves it into soft,
  // sub-pixel strands instead of hard alpha-tested flakes.
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const u = uv();
  const along = float(1).sub(u.y); // 0 root .. 1 tip
  const across = abs(fract(u.x.mul(3.0).add(sin(along.mul(11.0)).mul(0.06))).sub(0.5)); // three strands per card
  const strand = smoothstep(0.5, 0.16, across);
  const tip = smoothstep(1.0, 0.65, along);
  m.opacityNode = strand.mul(tip.mul(0.65).add(0.35));
  m.alphaHash = true;
  const c = r.color ?? [0.02, 0.015, 0.012];
  // roots sit in the volume's self-shadow; tips catch a touch more light
  m.colorNode = vec3(c[0], c[1], c[2]).mul(mix(float(0.55), float(1.2), along)).mul(strand.mul(0.25).add(0.85));
  // tightly coiled hair scatters light: mostly diffuse with a soft, broad sheen along the strands, not a glossy band
  m.roughness = 0.58;
  m.anisotropy = 0.6;
  m.anisotropyRotation = Math.PI / 2;
  m.specularIntensity = 0.22;
  m.sheen = 0.1;
  m.sheenRoughness = 0.6;
  m.sheenColor = new THREE.Color(0.3, 0.25, 0.21);
  return m;
}

function cornea(): THREE.Material {
  // The wet cornea adds only its reflection (lights + environment) on top of the eye: black diffuse, additive blending. A real cornea
  // transmits ~97% of light (F0 ~0.025 at IOR 1.376), so a "transparent white" layer reads as cataract milk; this does not.
  // a little roughness hides the facets of the low-poly cornea shell in reflections of big studio area lights
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x000000, roughness: 0.1, metalness: 0 });
  m.ior = 1.376;
  m.specularIntensity = 0.7;
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  return m;
}

/** Baked per-vertex occlusion (Blender lookdev.vertex_ao, in COLOR_0.r), or 1 when the mesh has none. */
const bakedAO = (has: boolean) => (has ? T.attribute('color', 'vec4').r : float(1));

function eye(old: THREE.MeshStandardMaterial, hasAO: boolean): THREE.Material {
  // MakeHuman eyeball: the texture holds sclera + iris; the corneal cap in front of the iris samples a disc with alpha 0, so it is cut
  // away (our wet cornea shell sits over it). The stock iris is a saturated orange-red: iris pixels (found by saturation) are rebuilt
  // as a luminance-driven dark brown (keeps the fibres and limbal ring, loses the hue); the sclera is taken off paper-white and
  // darkened by the baked lid + lash occlusion.
  const m = new THREE.MeshPhysicalNodeMaterial();
  if (old.map) {
    const t = texture(old.map, uv());
    const c = t.rgb;
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // the MakeHuman eye texture holds two eyeballs; pupils at these UVs (glTF v-down), iris radius ~0.113 (measured from the image)
    const u = uv();
    const d = u.sub(vec2(0.2915, 0.709)).length().min(u.sub(vec2(0.7075, 0.2969)).length());
    const irisMask = smoothstep(0.116, 0.104, d);
    const limbal = smoothstep(0.07, 0.112, d).mul(0.65).oneMinus(); // darker ring at the iris edge, as in real eyes
    const fibres = lum.mul(2.2).pow(1.1).min(0.32); // clamp: the stock texture has a painted highlight in the iris
    const iris = vec3(0.52, 0.3, 0.155).mul(fibres.mul(2.2)).mul(limbal).add(vec3(0.006, 0.0035, 0.002));
    const sclera = mix(vec3(lum), c, float(0.8)).mul(vec3(0.72, 0.68, 0.65));
    const ao = bakedAO(hasAO);
    m.colorNode = mix(sclera.mul(ao.mul(ao)), iris.mul(ao), irisMask);
    m.opacityNode = t.a;
    m.alphaTest = 0.5;
  }
  m.roughness = 0.35;
  m.specularIntensity = 0.25;
  return m;
}

function teeth(old: THREE.MeshStandardMaterial, hasAO: boolean): THREE.Material {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const base = old.map ? texture(old.map, uv()).rgb : vec3(0.8, 0.76, 0.7);
  const ao = bakedAO(hasAO);
  m.colorNode = base.mul(vec3(0.86, 0.82, 0.76)).mul(ao);
  m.roughness = 0.3;
  m.specularIntensity = 0.5;
  return m;
}

/** MakeHuman brows / lashes: alpha cards of fine hairs. Alpha-hashed so TRAA resolves them as soft hair instead of hard cut-outs. */
function hairCard(old: THREE.MeshStandardMaterial): THREE.Material {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const t = texture(old.map!, uv());
  m.colorNode = t.rgb.mul(0.6).add(vec3(0.012, 0.009, 0.007));
  m.opacityNode = t.a.mul(0.85);
  m.alphaHash = true;
  m.roughness = 0.5;
  m.specularIntensity = 0.3;
  return m;
}

/** Replace every material on a loaded character with the engine version of its recipe. */
export function dressCharacter(root: THREE.Object3D, opts: { hide?: string[] } = {}): Record<string, number> {
  const stats: Record<string, number> = {};
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    // glTF stores each mesh's default morph weights; faces must start neutral whatever the exporter wrote
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
    const hasAO = !!mesh.geometry.getAttribute('color');
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((old) => {
      const hit = cache.get(old);
      if (hit && !hasAO) return hit;
      const raw = (old.userData as any)?.ft;
      let made: THREE.Material = old;
      let type = 'gltf';
      if (raw) {
        const r: Recipe = typeof raw === 'string' ? JSON.parse(raw) : raw;
        type = r.type;
        if (r.type === 'skin') made = skin(r, old as THREE.MeshStandardMaterial);
        else if (r.type === 'pbr') made = pbr(r);
        else if (r.type === 'armour') made = armour(r);
        else if (r.type === 'emissive') made = emissive(r);
        else if (r.type === 'hair') made = hair(r);
        else if (r.type === 'cornea') made = cornea();
        else if (r.type === 'eye') made = eye(old as THREE.MeshStandardMaterial, hasAO);
        else if (r.type === 'teeth') made = teeth(old as THREE.MeshStandardMaterial, hasAO);
        else if (r.type === 'hairshell') {
          made = hairShellMaterial({ color: r.color ?? [0.018, 0.013, 0.011] });
          mesh.geometry = stackShells(mesh.geometry, r.shells ?? 24);
        }
      } else {
        // MakeHuman brows/lashes (alpha cards) and nails (opaque, kept as exported)
        const sm = old as THREE.MeshStandardMaterial;
        if (sm.map && (sm.transparent || sm.alphaTest > 0)) { made = hairCard(sm); type = 'haircard'; }
      }
      made.name = old.name;
      if (raw && made !== old) made.userData.ft = raw;
      stats[type] = (stats[type] ?? 0) + 1;
      cache.set(old, made);
      return made;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
    if (opts.hide && out.some((m) => opts.hide!.includes((JSON.parse(((m as any).userData?.ft as string) || '{}').type) || m.name))) mesh.visible = false;
  });
  void color; void clamp;
  return stats;
}
