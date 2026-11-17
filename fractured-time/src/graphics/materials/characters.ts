import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { resources } from '../core/resources';
import { weather } from '../atmosphere/weather';
import { soakedCloth } from '../shaders/surfaceLayers';
import { fbm, luminance } from '../shaders/common';
import { triplanar } from '../shaders/sampling';
import { SkinMaterial } from './skin';
import { hairShellMaterial, stackShells } from './hairShells';
import { scanned, chronalLight } from './environment';
import { materialQuality } from './quality';
import { recipeOf, type Recipe } from './recipes';

/**
 * Character materials, rebuilt from the recipes the Blender export writes (blender/characters/person.py et al.):
 *   skin      dual-lobe skin: a broad base lobe on the smooth normal, a sharper oily lobe (clear coat) on the pore normal,
 *             pore cavities darkening and roughening, curvature-aware scatter (skin.ts), rain beading
 *   pbr       photoscanned fabric and leather (the environment `scanned` template) + soaking
 *   armour    procedural composite plates: machined grooves, baked AO/edge masks, scanned breakup, edge wear to bare metal
 *   emissive  chronal light-lines
 *   hair      groomed cards with a strand mask, alpha-hashed so TAA resolves soft strands
 *   hairshell coily hair as shells (hairShells.ts)
 *   eye, cornea, teeth, brow/lash cards
 */
const T = TSL as any;
const { texture, uv, vec2, vec3, float, mix, dot, smoothstep, abs, fract, sin, positionGeometry, normalView, positionView, fwidth, length,
  normalMap, attribute, max, min, mx_worley_noise_float, dFdx, dFdy, normalGeometry } = T;

function skin(r: Recipe, old: THREE.MeshStandardMaterial): THREE.Material {
  const m = new SkinMaterial();
  const u = uv();
  const pu = u.mul(r.pore_tile ?? 34);
  const poreH = texture(resources.texture(String(r.pores).replace('_n.png', '_h.png'), false), pu).r; // 1 surface .. 0 pore floor
  const cavity = mix(float(0.86), float(1.0), smoothstep(0.15, 0.75, poreH));
  let notScalp: any = float(1.0);
  let rough: any = float(0.55);
  if (old.roughnessMap) {
    rough = texture(old.roughnessMap, u).g;
    // the bake marks the scalp under the hair as roughness ~1: no specular or sheen there
    notScalp = smoothstep(0.97, 0.9, rough);
  }
  // rain: skin darkens a touch; the oil lobe becomes a water film with beads standing on it
  const soak = (weather as any).soak;
  const beadF = mx_worley_noise_float(u.mul(r.bead_tile ?? 140));
  const bead = smoothstep(0.16, 0.06, beadF).mul(smoothstep(0.35, 0.8, soak));
  if (old.map) m.colorNode = texture(old.map, u).rgb.mul(cavity).mul(mix(float(1), float(0.9), soak));
  m.roughnessNode = rough.add(cavity.oneMinus().mul(0.6)).sub(soak.mul(0.12)).clamp(0.26, 1.0);
  // specular occlusion: no highlight from the floor of a pore, none on the scalp
  (m as any).specularIntensityNode = float(r.spec ?? 0.36).mul(notScalp).mul(mix(float(0.35), float(1.0), smoothstep(0.1, 0.6, poreH)));
  m.metalness = 0;
  // pores in the base lobe too, fading out with distance (they only alias far away); a finer micro layer for close-ups
  const poreTex = resources.texture(String(r.pores), false);
  const near = smoothstep(4.0, 0.6, length(positionView));
  const n1 = texture(poreTex, pu).xyz.mul(2.0).sub(1.0);
  const n2 = texture(poreTex, pu.mul(3.7).add(vec2(0.31, 0.57))).xyz.mul(2.0).sub(1.0);
  const micro = vec3(n1.xy.add(n2.xy.mul(0.6)), n1.z.mul(n2.z)).normalize();
  m.normalNode = normalMap(micro.mul(0.5).add(0.5), vec2(float(r.pore_base ?? 0.22).mul(near)));
  // the oily lobe: oilier where the bake made the skin smoother (the T-zone), none on the scalp; wet: a full water film
  (m as any).clearcoatNode = mix(smoothstep(0.72, 0.5, rough).mul(0.13).add(0.05), float(0.55), soak).mul(notScalp);
  (m as any).clearcoatRoughnessNode = mix(rough.mul(0.45).clamp(0.17, 0.5), float(0.08), soak.max(bead));
  const beadN = vec3(dFdx(beadF).mul(-40.0), dFdy(beadF).mul(-40.0), 1.0).mul(bead);
  (m as any).clearcoatNormalNode = normalMap(micro.add(beadN).normalize().mul(0.5).add(0.5), vec2(float(r.pore_strength ?? 0.65).add(bead.mul(0.6))));
  const s = (r.sss_color ?? [0.85, 0.3, 0.2]) as number[];
  (m as any).thicknessColorNode = vec3(s[0], s[1], s[2]).mul(0.06);
  (m as any).thicknessDistortionNode = float(0.1);
  (m as any).thicknessAmbientNode = float(0.0);
  (m as any).thicknessAttenuationNode = float(0.5);
  (m as any).thicknessPowerNode = float(12.0);
  (m as any).thicknessScaleNode = float(1.5);
  return m;
}

/** Composite armour plates (procedural; the pattern sticks to the plate in rest space while it moves). */
export function armour(r: Recipe, vertexMasks = false): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const p = positionGeometry;
  const k = r.grooves ?? 9;
  // machined grooves: horizontal bands every 1/k m plus a vertical centre seam (k = 0: the mesh carries real seams)
  const groove = k > 0 ? smoothstep(0.47, 0.49, abs(fract(p.y.mul(k)).sub(0.5))).max(float(1).sub(smoothstep(0.002, 0.0045, abs(p.x)))) : float(0);
  const n = fbm(p, 120.0, 3);
  const big = fbm(p, 3.0, 3);
  const b = r.base as number[], e = r.edge as number[];
  let edge: any, ao: any;
  if (r.masks) {
    // baked mask texture on the UV atlas: R = AO, G = edge proximity
    const c = texture(resources.texture(String(r.masks), false, false), uv());
    ao = c.r;
    edge = smoothstep(0.25, 0.85, c.g);
  } else if (vertexMasks) {
    // baked per vertex (COLOR_0): R = AO, G = convexity
    const c = attribute('color', 'vec4');
    ao = c.r;
    edge = smoothstep(0.2, 0.75, c.g);
  } else {
    // screen-space curvature
    edge = smoothstep(0.35, 0.9, length(fwidth(normalView)).div(max(length(fwidth(positionView)), 1e-5)).mul(0.004).clamp(0, 1));
    ao = float(1);
  }
  // scanned breakup projected triplanar in rest space (scratches, smudges, uneven paint)
  let scanLum: any = float(0.5), scanRough: any = float(0.5);
  if (r.detail) {
    const id = String(r.detail);
    const sc = float(r.detailScale ?? 1.4);
    scanRough = triplanar(resources.texture(`textures/pbr/${id}/${id}_rough.jpg`, false), p, normalGeometry, sc).r;
    scanLum = luminance(triplanar(resources.texture(`textures/pbr/${id}/${id}_diff.jpg`, true), p, normalGeometry, sc).rgb);
  }
  const wear = edge.mul(n.mul(0.7).add(0.3)).mul(scanRough.mul(0.8).add(0.6)).mul(float(r.wear ?? 0.5).mul(1.6)).clamp(0, 1);
  const grime = float(1).sub(ao).mul(big.mul(0.6).add(0.7)).clamp(0, 1);
  let paint: any = vec3(b[0], b[1], b[2]);
  if (r.stripes) {
    const st = smoothstep(0.48, 0.52, fract(p.x.add(p.y.mul(0.8)).add(p.z).mul(float(r.stripes))));
    paint = mix(vec3(0.62, 0.43, 0.05), vec3(0.022, 0.022, 0.024), st);
  }
  paint = paint.mul(big.mul(0.25).add(0.85)).mul(mix(float(0.8), float(1.12), smoothstep(0.15, 0.7, scanLum)));
  m.colorNode = mix(paint, vec3(e[0], e[1], e[2]), wear).mul(float(1).sub(groove.mul(0.65))).mul(float(1).sub(grime.mul(0.55)));
  m.roughnessNode = float(r.rough ?? 0.42).add(n.sub(0.5).mul(0.15)).add(scanRough.sub(0.5).mul(0.4)).add(groove.mul(0.2)).add(grime.mul(0.25))
    .sub(wear.mul(0.15)).clamp(0.08, 1);
  m.metalnessNode = wear.mul(0.85).add(0.03); // worn edges are bare metal
  if (vertexMasks || r.masks) m.aoNode = ao.mul(0.85).add(0.15);
  m.clearcoat = r.coat ?? 0.15;
  m.clearcoatRoughness = 0.3;
  return m;
}

function hairCards(r: Recipe): THREE.Material {
  // ribbons along groomed strands (u across, v along; uv().y = 1 at the root). Normals from the scalp (coherent volume
  // shading); the tangent runs across the card, so a 90 degree anisotropy rotation stretches the highlight along the strand
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const u = uv();
  const along = float(1).sub(u.y);
  const across = abs(fract(u.x.mul(3.0).add(sin(along.mul(11.0)).mul(0.06))).sub(0.5));
  const strand = smoothstep(0.5, 0.16, across);
  const tip = smoothstep(1.0, 0.65, along);
  m.opacityNode = strand.mul(tip.mul(0.65).add(0.35));
  m.alphaHash = true;
  const c = (r.color ?? [0.02, 0.015, 0.012]) as number[];
  m.colorNode = vec3(c[0], c[1], c[2]).mul(mix(float(0.55), float(1.2), along)).mul(strand.mul(0.25).add(0.85));
  m.roughness = 0.58;
  m.anisotropy = 0.6;
  m.anisotropyRotation = Math.PI / 2;
  m.specularIntensity = 0.22;
  m.sheen = 0.1;
  m.sheenRoughness = 0.6;
  m.sheenColor = new THREE.Color(0.3, 0.25, 0.21);
  return m;
}

/** Average split normals across coincident vertices (the low-poly cornea shell reflects in facets otherwise). */
function smoothNormals(mesh: THREE.Mesh): void {
  const g = mesh.geometry;
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const nor = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!pos || !nor || g.userData.smoothed) return;
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const sum = new Map<string, THREE.Vector3>();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    sum.set(k, (sum.get(k) ?? new THREE.Vector3()).add(v.fromBufferAttribute(nor, i)));
  }
  for (let i = 0; i < pos.count; i++) {
    const n = sum.get(key(i))!.clone().normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
  g.userData.smoothed = true;
}

function cornea(): THREE.Material {
  // the wet cornea adds only its reflection on top of the eye: black diffuse, additive. A real cornea transmits ~97 %
  // (F0 ~0.025 at IOR 1.376); sharp and physically weak, so the catchlight is tight and the iris is never veiled
  const m = new THREE.MeshPhysicalNodeMaterial({ color: 0x000000, roughness: 0.035, metalness: 0 });
  m.ior = 1.376;
  m.specularIntensity = 0.4;
  m.transparent = true;
  m.blending = THREE.AdditiveBlending;
  m.depthWrite = false;
  return m;
}

const bakedAO = (has: boolean) => (has ? attribute('color', 'vec4').r : float(1));

function eye(old: THREE.MeshStandardMaterial, hasAO: boolean): THREE.Material {
  // MakeHuman eyeball: sclera + iris in one texture, the corneal cap cut by its alpha (our cornea shell sits over it). The
  // stock iris is a saturated orange: brown irises are rebuilt from the texture's luminance (fibres and limbal ring kept),
  // blue and grey ones keep their own hue; the sclera is taken off paper-white and shaded by the baked lid occlusion.
  const m = new THREE.MeshPhysicalNodeMaterial();
  if (old.map) {
    const t = texture(old.map, uv());
    const c = t.rgb;
    const lum = luminance(c);
    const u = uv();
    const d = min(u.sub(vec2(0.2915, 0.709)).length(), u.sub(vec2(0.7075, 0.2969)).length());
    const irisMask = smoothstep(0.116, 0.104, d);
    const limbal = smoothstep(0.07, 0.112, d).mul(0.65).oneMinus();
    const fibres = lum.mul(2.2).pow(1.1).min(0.32);
    const brown = vec3(0.52, 0.3, 0.155).mul(fibres.mul(2.2)).mul(limbal).add(vec3(0.006, 0.0035, 0.002));
    const chroma = c.b.sub(c.r);
    const sat = max(max(c.r, c.g), c.b).sub(min(min(c.r, c.g), c.b));
    const cool = smoothstep(-0.02, 0.06, chroma).max(smoothstep(0.12, 0.05, sat));
    const own = mix(vec3(lum), c, float(0.85)).mul(fibres.mul(2.0).add(0.15)).mul(limbal).mul(mix(float(0.95), float(1.35), smoothstep(0.05, 0.12, sat)));
    const iris = mix(brown, own, cool.mul(irisMask));
    const sclera = mix(vec3(lum), c, float(0.8)).mul(vec3(0.6, 0.54, 0.5));
    const ao = bakedAO(hasAO);
    m.colorNode = mix(sclera.mul(ao.mul(ao)), iris.mul(ao), irisMask);
    m.opacityNode = t.a;
    m.alphaTest = 0.5;
    // the iris has no gloss of its own (the cornea carries it): a glossy low-poly iris dish mirrors the studio in facets
    m.specularIntensityNode = mix(float(0.25), float(0.0), irisMask);
  }
  m.roughness = 0.35;
  m.specularIntensity = 0.25;
  return m;
}

function teeth(old: THREE.MeshStandardMaterial, hasAO: boolean): THREE.Material {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const base = old.map ? texture(old.map, uv()).rgb : vec3(0.8, 0.76, 0.7);
  m.colorNode = base.mul(vec3(0.86, 0.82, 0.76)).mul(bakedAO(hasAO));
  m.roughness = 0.3;
  m.specularIntensity = 0.5;
  return m;
}

/** MakeHuman brows / lashes: alpha cards of fine hairs, alpha-hashed so TAA resolves them as soft hair. */
function browCard(old: THREE.MeshStandardMaterial, tint: number[] | null): THREE.Material {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const t = texture(old.map!, uv());
  if (tint) {
    // brows in the character's own hair colour (the stock brow texture is a reddish brown on everyone)
    m.colorNode = vec3(tint[0], tint[1], tint[2]).mul(luminance(t.rgb).mul(3.0).clamp(0.35, 1.0)).mul(0.8);
  } else m.colorNode = t.rgb.mul(0.6).add(vec3(0.012, 0.009, 0.007));
  m.opacityNode = t.a.mul(0.85);
  m.alphaHash = true;
  m.roughness = 0.5;
  m.specularIntensity = 0.3;
  return m;
}

/** Fabric and kit in the rain: soak the colour and roughness slots of a physical material. */
function soak(m: THREE.Material): void {
  const pm = m as THREE.MeshPhysicalNodeMaterial;
  if (!(pm as any).isMeshPhysicalNodeMaterial || pm.userData.soaked) return;
  pm.userData.soaked = true;
  const s = soakedCloth((pm.colorNode ?? T.materialColor).rgb, pm.roughnessNode ?? T.materialRoughness);
  pm.colorNode = s.color;
  pm.roughnessNode = s.roughness;
}

/** Replace every material on a loaded character with the engine version of its recipe. Returns counts per type. */
export function dressCharacter(root: THREE.Object3D, opts: { hide?: string[] } = {}): Record<string, number> {
  const stats: Record<string, number> = {};
  const cache = new Map<THREE.Material, THREE.Material>();
  let hairColor: number[] | null = null;
  root.traverse((o) => {
    const mm = (o as THREE.Mesh).material;
    for (const mt of Array.isArray(mm) ? mm : mm ? [mm] : []) {
      const r = recipeOf(mt);
      if (r && !hairColor && (r.type === 'hairshell' || r.type === 'hair') && Array.isArray(r.color)) hairColor = r.color;
    }
  });
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds are bind-pose
    if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0); // faces start neutral whatever the exporter wrote
    const hasAO = !!mesh.geometry.getAttribute('color');
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const out = mats.map((old) => {
      const hit = cache.get(old);
      if (hit && !hasAO) return hit;
      const r = recipeOf(old);
      let made: THREE.Material = old;
      let type = 'gltf';
      if (r) {
        type = r.type;
        if (r.type === 'skin') made = skin(r, old as THREE.MeshStandardMaterial);
        else if (r.type === 'pbr') made = scanned(r);
        else if (r.type === 'armour') made = armour(r, hasAO);
        else if (r.type === 'emissive') made = chronalLight(r);
        else if (r.type === 'hair') made = hairCards(r);
        else if (r.type === 'cornea') { made = cornea(); smoothNormals(mesh); }
        else if (r.type === 'eye') made = eye(old as THREE.MeshStandardMaterial, hasAO);
        else if (r.type === 'teeth') made = teeth(old as THREE.MeshStandardMaterial, hasAO);
        else if (r.type === 'hairshell') {
          made = hairShellMaterial({ color: r.color ?? [0.018, 0.013, 0.011], maxLen: r.maxLen, strandSpacing: r.strandSpacing,
            coilRadius: r.coilRadius, coilTurns: r.coilTurns, grey: r.grey });
          mesh.geometry = stackShells(mesh.geometry, Math.min(r.shells ?? 24, materialQuality.hairShells));
        }
      } else {
        // MakeHuman brows/lashes (alpha cards) and nails (opaque, kept as exported)
        const sm = old as THREE.MeshStandardMaterial;
        const brow = /brow/i.test(mesh.name) || /brow/i.test(sm.name);
        if (sm.map && (sm.transparent || sm.alphaTest > 0)) { made = browCard(sm, brow ? hairColor : null); type = brow ? 'browcard' : 'haircard'; }
      }
      if (type === 'pbr' || type === 'armour') soak(made);
      made.name = old.name;
      if (r && made !== old) made.userData.ft = (old.userData as any).ft;
      stats[type] = (stats[type] ?? 0) + 1;
      cache.set(old, made);
      return made;
    });
    mesh.material = Array.isArray(mesh.material) ? out : out[0];
    if (opts.hide && out.some((m) => opts.hide!.includes(recipeOf(m)?.type ?? m.name))) mesh.visible = false;
  });
  return stats;
}

void dot;
