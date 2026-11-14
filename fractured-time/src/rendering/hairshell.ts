import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

/**
 * Short coily hair as shells (fur-shell rendering): the exported scalp patch is stacked `n` times in ONE skinned geometry, each copy
 * tagged with its layer (0 = scalp .. 1 = hair tips) and pushed out along the skinned normal by layer * hair length (metres,
 * per vertex in COLOR_0.r: long on top, short in the fade). Each layer cuts strands out of a 3D cellular pattern sampled at the rest-pose scalp
 * position, so a strand is the same cell through every layer; the lookup point circles around the strand axis as the layer rises,
 * which twists every strand into a coil. Roots sit in the volume's self-shadow, tips catch the light.
 * Positions must be float metres (gltfpack -vpf), since the displacement and the pattern are in metres.
 */
const T = TSL as any;
const { attribute, positionLocal, normalLocal, positionGeometry, normalGeometry, vec3, float, mix, smoothstep, cos, sin, cross, normalize,
  floor, hash, dot, Fn, If, fract, transformNormalToView, fwidth } = T;

/** Integer cell -> three independent randoms in [0,1) (pcg hash chained per axis; +5000 keeps the seeds positive). */
const cellRand = (c: any) => {
  const hz = hash(c.z.add(5000.0));
  const hy = hash(c.y.add(5000.0).add(hz.mul(65536.0)));
  const hx = hash(c.x.add(5000.0).add(hy.mul(65536.0)));
  return [hx, hash(hx.mul(65536.0).add(17.0)), hash(hx.mul(65536.0).add(91.0))];
};

/**
 * Nearest strand to point x (in strand-cell units) on a surface with normal n, at shell height `layer`: one strand per 3D cell,
 * jittered; its centre circles the strand axis as the layer rises (a coil with its own phase per strand); distance is measured in the
 * tangent plane so a strand is a column through all layers. Searches the 2x2x2 nearest cells (cheap enough for many layers).
 * Returns vec4(distance, strand length 0..1, offset from the strand centre along t, along b) (offsets / distance = unit direction).
 */
const nearestStrand = Fn(([x, n, t, b, layer, coilR, turns]: any[]) => {
  const base = floor(x.sub(0.5));
  const best = float(9.0).toVar();
  const bestLen = float(1.0).toVar();
  const bestT = float(0.0).toVar();
  const bestB = float(0.0).toVar();
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
    const c = base.add(vec3(i, j, k));
    const [r1, r2, r3] = cellRand(c);
    const feat = c.add(vec3(r1, r2, r3).mul(0.8).add(0.1));
    const theta = layer.mul(turns).add(r1.mul(6.2831));
    const centre = feat.add(t.mul(cos(theta)).add(b.mul(sin(theta))).mul(coilR));
    const dl = x.sub(centre);
    const dp = dl.sub(n.mul(dot(dl, n))); // in the tangent plane
    const d = dp.length();
    If(d.lessThan(best), () => {
      best.assign(d);
      bestLen.assign(r2.mul(0.4).add(0.6).add(r3.mul(0.001)));
      bestT.assign(dot(dp, t));
      bestB.assign(dot(dp, b));
    });
  }
  return T.vec4(best, bestLen, bestT, bestB);
});

/** Repeat every vertex attribute, morph attribute and the index `n` times; add a per-vertex 'layer' attribute in [0, 1]. */
export function stackShells(src: THREE.BufferGeometry, n: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const count = src.getAttribute('position').count;
  const rep = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute => {
    const size = a.itemSize;
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      const out = new Float32Array(count * size * n); // de-interleave (values come back denormalised)
      for (let i = 0; i < count; i++) for (let c = 0; c < size; c++) {
        const v = a.getComponent(i, c);
        for (let k = 0; k < n; k++) out[(k * count + i) * size + c] = v;
      }
      return new THREE.BufferAttribute(out, size, false);
    }
    const arr = (a as THREE.BufferAttribute).array;
    const Ctor = (arr as any).constructor as { new (len: number): THREE.TypedArray };
    const out = new Ctor(arr.length * n);
    for (let k = 0; k < n; k++) out.set(arr as any, k * arr.length);
    return new THREE.BufferAttribute(out, size, a.normalized);
  };
  for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, rep(a as THREE.BufferAttribute));
  for (const [name, list] of Object.entries(src.morphAttributes)) (g.morphAttributes as any)[name] = list.map((a) => { const r = rep(a as THREE.BufferAttribute); r.name = a.name; return r; });
  g.morphTargetsRelative = src.morphTargetsRelative;
  const layer = new Float32Array(count * n);
  for (let k = 0; k < n; k++) layer.fill(n > 1 ? k / (n - 1) : 0, k * count, (k + 1) * count);
  g.setAttribute('layer', new THREE.BufferAttribute(layer, 1));
  if (src.index) {
    const si = src.index.array;
    const idx = new Uint32Array(si.length * n);
    for (let k = 0; k < n; k++) for (let i = 0; i < si.length; i++) idx[k * si.length + i] = (si[i] as number) + k * count;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.boundingSphere = src.boundingSphere?.clone() ?? null;
  return g;
}

export interface ShellLook {
  color: [number, number, number];
  strandSpacing?: number; // m between strand centres
  coilRadius?: number;    // m
  coilTurns?: number;     // turns over the full hair length
  maxLen?: number;        // m: hair length encoded as COLOR_0.r * maxLen (Ethan's crop: 25 mm; longer styles carry their own)
}

export function hairShellMaterial(look: ShellLook): THREE.Material {
  const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
  const layer = attribute('layer', 'float');
  const gc = attribute('color', 'vec4');
  const len = gc.r.mul(look.maxLen ?? 0.025); // COLOR_0.r = hair length / maxLen
  const growth = gc.g;         // COLOR_0.g = growth density (0 at the hairline edge / bottom of the fade)
  m.positionNode = positionLocal.add(normalLocal.mul(layer.mul(len)));

  const spacing = look.strandSpacing ?? 0.0005;
  const p = positionGeometry; // rest-pose scalp point (metres): the same strand cell through every layer
  const nb = normalize(normalGeometry);
  const t = normalize(cross(nb, vec3(0.31, 0.95, 0.05)));
  const b = cross(nb, t);
  const coilR = float((look.coilRadius ?? 0.0003) / spacing).mul(smoothstep(0.0, 0.25, layer)); // roots leave the scalp straight
  const s = nearestStrand(p.div(spacing), nb, t, b, layer, coilR, float((look.coilTurns ?? 2.6) * 6.2831));
  const radius = float(0.4).mul(float(1.0).sub(layer.mul(0.5)));
  const alive = smoothstep(s.y, s.y.sub(0.06), layer); // strands end at their own length
  const tone = fract(s.y.mul(731.7)).mul(0.35).add(0.8); // per-strand brightness
  // hairline / fade: fewer strands where the hair gets short, so the edge is made of single hairs, not a cut line
  const density = smoothstep(0.3, 0.85, growth).mul(smoothstep(0.0008, 0.0016, len));
  const present = fract(s.y.mul(917.3)).lessThan(density).select(float(1.0), float(0.0));
  const strand = smoothstep(radius, radius.mul(0.6), s.x).mul(alive).mul(present);
  m.opacityNode = strand;
  m.alphaTest = 0.5;
  // specular anti-aliasing: when strands shrink below a pixel the per-strand normals only make sparkle, so they fade toward the
  // smooth volume normal and the highlight widens (what the strands average to)
  const cellsPerPixel = fwidth(p.div(spacing)).length();
  const detail = smoothstep(1.4, 0.35, cellsPerPixel);

  const c = look.color;
  const depthShade = mix(float(0.18), float(1.0), layer.pow(0.7)); // roots in the self-shadow of the volume
  m.colorNode = vec3(c[0], c[1], c[2]).mul(depthShade).mul(tone);
  // each strand shaded as a cylinder: the normal leans toward the offset from its axis, so coils catch their own highlight
  const nS = normalize(normalLocal);
  const tS = normalize(cross(nS, vec3(0.31, 0.95, 0.05)));
  const bS = cross(nS, tS);
  const off = tS.mul(s.z).add(bS.mul(s.w)).div(s.x.max(1e-4));
  m.normalNode = transformNormalToView(normalize(nS.mul(0.6).add(off.mul(detail.mul(0.8)))));
  m.roughnessNode = mix(float(0.72), float(0.5), detail);
  m.specularIntensity = 0.13;
  m.sheen = 0.03;
  m.sheenRoughness = 0.6;
  m.sheenColor = new THREE.Color(0.11, 0.1, 0.095);
  return m;
}
