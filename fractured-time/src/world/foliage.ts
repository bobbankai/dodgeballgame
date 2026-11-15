import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { loadGLTF } from '@/assets/loader';
import { tex, type Recipe } from '@/rendering/charmat';
import type { VolumetricFog } from '@/rendering/volumetrics';
import { weather } from '@/rendering/wet';

const T = TSL as any;
const { Fn, float, vec3, vec4, texture, uv, attribute, positionLocal, positionWorld, normalWorld, cameraPosition, time, sin, dot,
  max, mix, normalize, uniform, instanceIndex, hash, faceDirection, reflect, pow } = T;

/**
 * Foliage (blender/props/foliage.py: Poly Haven's CC0 plants as real-time assets): instanced per level section, placed by the level
 * scripts (`<section>_foliage.json`, the same placements the lightmap bake saw, so the ground under a tree is shaded by it).
 * Plants are not lightmapped: they take the light of the section's baked light volume where they stand (ambient from fixtures and
 * sky, sun visibility through the canopy), wrapped diffuse for soft leaves, translucency when the sun or a lamp is behind them,
 * crown occlusion from the asset's vertex colours (inner, lower foliage darker), and sway in the wind on world time.
 * Placement data per asset: [x, y, z, yaw, scale] in three space.
 */
export const wind = { strength: uniform(1), dir: uniform(new THREE.Vector2(0.8, 0.6)) };

const cache = new Map<string, Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material }[]>>();

function foliageMaterial(r: Recipe, fog: VolumetricFog): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const map = tex(String(r.tex), true, false);
  const s = texture(map, uv());
  const col = attribute('color', 'vec4');
  const occl = col.y.mul(0.85).add(0.15);
  const tint = hash(instanceIndex.add(7)).sub(0.5).mul(0.16).add(1.0);
  const albedo = s.rgb.mul(tint);
  if (r.alpha) {
    m.alphaTest = 0.5;
    m.opacityNode = s.a;
    m.alphaToCoverage = true;
  }
  // wind: a gust and a flutter, phased by where the plant stands; roots stay planted (weight = colour R)
  const inst = Fn(() => {
    const w = col.x.mul(wind.strength).mul(weather.rain.mul(0.6).add(1.0));
    const ph = hash(instanceIndex).mul(6.283);
    const gust = sin(time.mul(1.1).add(ph)).mul(0.6).add(sin(time.mul(0.37).add(ph.mul(2.0))).mul(0.4));
    const flutter = sin(time.mul(5.3).add(positionLocal.y.mul(3.0)).add(ph)).mul(0.12);
    const amt = gust.add(flutter).mul(w).mul(0.09);
    return positionLocal.add(vec3(wind.dir.x.mul(amt), amt.abs().mul(-0.15), wind.dir.y.mul(amt)));
  })();
  m.positionNode = inst;
  m.colorNode = Fn(() => {
    const L = fog.lightTerms(positionWorld);
    const n = normalize(normalWorld).mul(faceDirection);
    const l = normalize(L.sunDir);
    const ndl = dot(n, l);
    const wrap = max(ndl.add(0.45).div(1.45), 0.0);
    const v = normalize(cameraPosition.sub(positionWorld));
    // light through the leaf when the source is behind it (sun: by direction; fixtures: a share of the ambient)
    const back = max(dot(v.negate(), l), 0.0).pow(3.0).mul(float(r.transl ?? 0.4));
    const sun = L.sunCol.mul(L.sunVis).mul(wrap.mul(occl).add(back));
    const amb = L.iso.mul(2.2).mul(occl).mul(float(1).add(float(r.transl ?? 0.4).mul(0.5)));
    // rain darkens the leaves and lays a water film on them: a Fresnel sheen of the light around (the volume's ambient stands in
    // for the sky and the fixtures) and a tight highlight of the sun or moon, both strongest on the outer, exposed leaves
    const wetK = weather.wet;
    const nv = max(dot(n, v), 0.0);
    const fres = pow(float(1).sub(nv), 5.0).mul(0.96).add(0.04);
    const sheen = L.iso.mul(3.2).mul(fres).mul(occl);
    const glint = pow(max(dot(reflect(l.negate(), n), v), 0.0), 48.0).mul(1.6);
    const spec = sheen.add(L.sunCol.mul(L.sunVis).mul(glint)).mul(wetK).mul(occl);
    const wet = mix(float(1), float(0.78), wetK);
    return vec4(albedo.mul(amb.add(sun)).mul(wet).add(spec), 1.0);
  })();
  return m;
}

async function loadAsset(name: string, fog: VolumetricFog): Promise<{ geo: THREE.BufferGeometry; mat: THREE.Material }[]> {
  let p = cache.get(name);
  if (!p) {
    p = loadGLTF(`props/foliage/${name}.glb`).then((g) => {
      const parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const raw = (mesh.material as THREE.Material).userData?.ft;
        const r: Recipe = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { type: 'foliage', tex: '' };
        const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        if (!geo.getAttribute('color')) {
          const n = geo.getAttribute('position').count;
          geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 4).fill(0.6), 4));
        }
        parts.push({ geo, mat: foliageMaterial(r, fog) });
      });
      return parts;
    });
    cache.set(name, p);
  }
  return p;
}

/** Instance a section's foliage under its root (so streaming adds and removes it with the section). */
export async function plantSection(root: THREE.Object3D, data: Record<string, number[][]>, fog: VolumetricFog): Promise<number> {
  let total = 0;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [name, list] of Object.entries(data)) {
    if (!list.length) continue;
    let parts;
    try { parts = await loadAsset(name, fog); } catch (e) { console.warn('[foliage] missing', name, e); continue; }
    for (const { geo, mat } of parts) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, yaw, s], i) => {
        q.setFromAxisAngle(up, yaw);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = true;
      im.userData.foliage = name;
      root.add(im);
    }
    total += list.length;
  }
  return total;
}


