import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

// TSL's static types are too strict for node-graph arithmetic; treat the node builders as dynamically typed.
const {
  Fn, float, vec2, vec3, positionWorld, positionGeometry, normalWorld, mix, smoothstep, abs, fract, floor, max, min, select,
  mx_fractal_noise_float, transformNormalToView, normalize, dot, color, uniform, vertexColor, time, sin,
} = TSL as any;

/**
 * Procedural PBR. The facility surfaces are authored in TSL: panel seams, bolts, grime and scratches are computed from world
 * position, so every wall panel has believable surface detail without shipping texture sets, and nothing visibly tiles.
 */

const N = (p: any, f: number, oct = 3) => mx_fractal_noise_float(p.mul(f), oct, 2.0, 0.5).mul(0.5).add(0.5);

export interface SurfaceOpts {
  base: number | string;
  rough?: number;
  metal?: number;
  /** panel size in metres (seams between panels); 0 = no seams */
  panel?: number;
  seam?: number;
  grime?: number;
  scratch?: number;
  bump?: number;
  emissive?: number | string;
  emissiveIntensity?: number;
  accent?: number | string;
}

export function surface(o: SurfaceOpts): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const base = color(new THREE.Color(o.base as any));
  const p = positionWorld;
  const nW = normalWorld;
  // choose the two world axes that lie in the surface plane
  const ay = abs(nW.y), ax = abs(nW.x), az = abs(nW.z);
  const uvp = select(ay.greaterThan(max(ax, az)), vec2(p.x, p.z), select(ax.greaterThan(az), vec2(p.z, p.y), vec2(p.x, p.y)));

  const size = o.panel ?? 0;
  const seamW = o.seam ?? 0.012;
  const grime = o.grime ?? 0.5;

  const pattern = Fn(() => {
    const albedo = base.toVar();
    // large-scale colour variation + fine mottling
    const big = N(p, 0.35, 2);
    const fine = N(p, 4.0, 3);
    albedo.assign(albedo.mul(mix(float(0.78), float(1.12), big)).mul(mix(float(0.92), float(1.06), fine)));
    const seamMask = float(0).toVar();
    const boltMask = float(0).toVar();
    if (size > 0) {
      const g = uvp.div(size);
      const f = fract(g);
      const dEdge = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(size);
      seamMask.assign(float(1).sub(smoothstep(seamW * 0.5, seamW, dEdge)));
      // per-panel tone offset
      const id = floor(g);
      const tone = fract(sin(dot(id, vec2(12.9898, 78.233))).mul(43758.5453));
      albedo.assign(albedo.mul(mix(float(0.9), float(1.08), tone)));
      // bolts near the panel corners
      const corner = vec2(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())).mul(size);
      const dc = corner.sub(vec2(0.045, 0.045));
      boltMask.assign(float(1).sub(smoothstep(0.006, 0.011, dc.length())));
    }
    // grime gathers low and in the seams
    const low = float(1).sub(smoothstep(0.0, 1.6, p.y));
    const gr = N(p.add(vec3(3.1, 7.7, 1.3)), 1.8, 3).mul(low.mul(0.8).add(0.35)).mul(grime);
    albedo.assign(mix(albedo, albedo.mul(0.38), gr.mul(0.8)));
    albedo.assign(mix(albedo, albedo.mul(0.4), seamMask.mul(0.85)));
    albedo.assign(mix(albedo, albedo.mul(1.5), boltMask.mul(0.5)));
    if (o.accent !== undefined) {
      const stripe = smoothstep(0.02, 0.0, abs(fract(p.y.mul(0.5)).sub(0.5)).sub(0.46));
      albedo.assign(mix(albedo, color(new THREE.Color(o.accent as any)), stripe.mul(0.8)));
    }
    return albedo;
  })();

  m.colorNode = pattern;
  const scr = N(uvp.mul(1.0).xyx.add(vec3(0, 5.0, 0)), 22.0, 2);
  const scratches = smoothstep(0.72, 0.9, scr).mul(o.scratch ?? 0.4);
  const worn = N(p, 2.4, 3);
  m.roughnessNode = float(o.rough ?? 0.6).add(worn.sub(0.5).mul(0.3)).sub(scratches.mul(0.25)).add(float(0.0)).clamp(0.05, 1.0);
  m.metalnessNode = float(o.metal ?? 0.0).add(scratches.mul(0.2)).clamp(0, 1);

  // analytic bump from the same noise (finite differences in world space, converted to view space)
  const bumpAmt = o.bump ?? 0.5;
  if (bumpAmt > 0) {
    m.normalNode = Fn(() => {
      const e = 0.02;
      const h = (q: any) => N(q, 9.0, 2).mul(0.6).add(N(q, 38.0, 2).mul(0.4));
      const h0 = h(p);
      const gx = h(p.add(vec3(e, 0, 0))).sub(h0);
      const gy = h(p.add(vec3(0, e, 0))).sub(h0);
      const gz = h(p.add(vec3(0, 0, e))).sub(h0);
      const g = vec3(gx, gy, gz).div(e);
      const tang = g.sub(nW.mul(dot(g, nW)));
      return transformNormalToView(normalize(nW.sub(tang.mul(0.012 * bumpAmt))));
    })();
  }
  if (o.emissive !== undefined) {
    m.emissiveNode = color(new THREE.Color(o.emissive as any)).mul(o.emissiveIntensity ?? 2.0);
  }
  return m;
}

/** Emissive light panels and indicator strips: HDR values so bloom picks them up. */
export function emissive(col: number | string, intensity = 4): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.4 });
  m.emissiveNode = color(new THREE.Color(col as any)).mul(intensity);
  return m;
}

export function glass(tint: number | string = 0x88ccff, opacity = 0.18): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({ color: new THREE.Color(tint as any), roughness: 0.04, metalness: 0, transparent: true, opacity, side: THREE.DoubleSide });
  m.clearcoat = 1;
  m.ior = 1.5;
  m.specularIntensity = 1;
  m.depthWrite = false;
  return m;
}

/** Animated chronal energy: used on fracture seams, portals and anything the Chronal Engine touches. */
export function chronal(col: number | string = 0x5ad8ff, intensity = 3): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const p = positionWorld;
  const flow = N(p.mul(1.2).add(vec3(0, time.mul(0.6), 0)), 3.0, 3);
  const bands = smoothstep(0.5, 0.95, sin(p.y.mul(6.0).add(time.mul(2.0)).add(flow.mul(5.0))).mul(0.5).add(0.5));
  m.colorNode = color(new THREE.Color(col as any)).mul(intensity).mul(bands.mul(0.8).add(flow.mul(0.4)));
  m.opacityNode = bands.mul(0.7).add(0.15);
  return m;
}

// --- characters -------------------------------------------------------------------------------------------------

const fabric = (rough: number) => Fn(() => {
  // woven micro-detail from the rest-pose position so the weave sticks to the body when it moves
  const p = positionGeometry;
  const w = sin(p.x.mul(900)).mul(sin(p.z.mul(900))).mul(0.5).add(0.5);
  const n = N(p, 60.0, 2);
  return float(rough).add(w.mul(0.05)).add(n.mul(0.06));
})();

/**
 * Replaces the glTF materials of a character with node materials chosen by material-name suffix. Vertex colours carry the
 * baked albedo and ambient occlusion, so the shading here adds roughness, sheen and micro-detail only.
 */
export function dressCharacter(root: THREE.Object3D, opts: { emissiveBoost?: number } = {}): void {
  const cache = new Map<string, THREE.Material>();
  const make = (name: string): THREE.Material => {
    const hit = cache.get(name);
    if (hit) return hit;
    let m: THREE.Material;
    const kind = name.split('_').slice(1).join('_');
    const isSkin = kind.startsWith('skin');
    if (isSkin) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.52, metalness: 0 });
      s.sheen = 0.5; s.sheenRoughness = 0.55; s.sheenColor = new THREE.Color(0xffb8a0);
      s.clearcoat = 0.06; s.clearcoatRoughness = 0.4;
      s.roughnessNode = float(0.5).add(N(positionGeometry, 220.0, 2).mul(0.12));
      m = s;
    } else if (kind.startsWith('cloth')) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, metalness: 0 });
      s.roughnessNode = fabric(0.82);
      s.sheen = 0.7; s.sheenRoughness = 0.7; s.sheenColor = new THREE.Color(0x889099);
      m = s;
    } else if (kind.startsWith('gear')) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, metalness: 0.28 });
      const scuff = N(positionGeometry, 55.0, 3);
      s.roughnessNode = float(0.42).add(scuff.mul(0.3));
      s.metalnessNode = float(0.22).add(smoothstep(0.62, 0.9, scuff).mul(0.5));
      m = s;
    } else if (kind.startsWith('boot')) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, metalness: 0.0 });
      s.roughnessNode = float(0.55).add(N(positionGeometry, 80.0, 2).mul(0.25));
      m = s;
    } else if (kind.startsWith('hair')) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 });
      s.sheen = 0.8; s.sheenRoughness = 0.35; s.sheenColor = new THREE.Color(0x706050);
      m = s;
    } else if (kind.startsWith('eye')) {
      const s = new THREE.MeshPhysicalNodeMaterial({ vertexColors: true, roughness: 0.08, metalness: 0 });
      s.clearcoat = 1; s.clearcoatRoughness = 0.02;
      m = s;
    } else if (kind.startsWith('glow')) {
      const s = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.3 });
      const pulse = sin(time.mul(2.2)).mul(0.25).add(1.0);
      s.emissiveNode = vertexColor().rgb.mul(pulse).mul(float(opts.emissiveBoost ?? 5));
      m = s;
    } else {
      m = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.7 });
    }
    m.name = name;
    cache.set(name, m);
    return m;
  };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const old = mesh.material as THREE.Material;
    mesh.material = make(old.name);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // skinned bounds are bind-pose; the characters are always near the camera anyway
  });
  void uniform;
}
