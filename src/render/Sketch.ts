import * as THREE from 'three';
import { G } from './Globals';
import { NOISE } from './glsl';

/**
 * Loose pencil strokes along line segments, drawn in the overlay pass: each segment is a ribbon
 * expanded in screen space, overshooting its ends and wobbling on every "boil" frame like a sketch.
 * Segments whose order value is below uProgress are drawn as ink instead of graphite.
 */
const VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aSeed;
uniform vec2 uRes;
uniform float uBoil;
uniform float uWidth;
uniform float uProgress;
uniform float uWobble;
varying float vSide;
varying float vU;
varying float vInk;
varying float vSeed;
${NOISE}
vec3 jit(float s) {
  return vec3(ibHash2(vec2(s, 1.0)), ibHash2(vec2(s, 2.0)), ibHash2(vec2(s, 3.0))) - 0.5;
}
void main() {
  float s = aSeed.x;
  vec3 dir = aB - aA;
  float boil = uBoil + floor(s * 3.0);
  vec3 A = aA - dir * (0.03 + 0.06 * ibHash2(vec2(s, 4.0))) + jit(s * 7.0 + boil) * uWobble;
  vec3 B = aB + dir * (0.03 + 0.07 * ibHash2(vec2(s, 5.0))) + jit(s * 9.0 + boil + 0.5) * uWobble;
  vec4 ca = projectionMatrix * modelViewMatrix * vec4(A, 1.0);
  vec4 cb = projectionMatrix * modelViewMatrix * vec4(B, 1.0);
  // keep both ends in front of the camera
  if (ca.w < 0.05 || cb.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 sa = ca.xy / ca.w * uRes * 0.5, sb = cb.xy / cb.w * uRes * 0.5;
  vec2 d = sb - sa;
  d = length(d) > 1e-4 ? normalize(d) : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float ink = step(aSeed.y, uProgress);
  float w = uWidth * mix(1.0, 1.6, ink) * (0.75 + 0.5 * ibHash2(vec2(s, 6.0)));
  vec4 c = mix(ca, cb, position.y);
  c.xy += n * position.x * w / (uRes * 0.5) * c.w;
  gl_Position = c;
  vSide = position.x;
  vU = position.y;
  vInk = ink;
  vSeed = s;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tPaper;
uniform float uAlpha;
uniform vec3 uColor;
uniform vec3 uInkColor;
varying float vSide;
varying float vU;
varying float vInk;
varying float vSeed;
${NOISE}
void main() {
  float prof = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
  float ends = smoothstep(0.0, 0.12, vU) * smoothstep(1.0, 0.85, vU);
  float press = 0.5 + 0.5 * ibNoise(vec3(vU * 5.0, vSeed * 13.0, 0.0));
  float grain = texture2D(tPaper, gl_FragCoord.xy / 512.0).g;
  float a = prof * mix(ends * press, 1.0, vInk * 0.75) * mix(0.55, 1.0, grain) * uAlpha;
  gl_FragColor = vec4(mix(uColor, uInkColor, vInk), a);
}
`;

export interface Segments {
  a: Float32Array;
  b: Float32Array;
  /** Per segment: random seed and its place in the inking order (0..1). */
  seed: Float32Array;
  count: number;
}

/** Feature edges of an object's meshes (world space), each drawn as `strokes` overlapping strokes. */
export function edgeSegments(root: THREE.Object3D, angle = 28, strokes = 2, axis?: THREE.Vector3): Segments {
  const pts: number[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const e = new THREE.EdgesGeometry(m.geometry, angle);
    const p = e.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      pts.push(v.x, v.y, v.z);
    }
    e.dispose();
  });
  const n = pts.length / 6;
  // order along the object's longest axis, so inking sweeps across it
  const box = new THREE.Box3();
  for (let i = 0; i < pts.length; i += 3) box.expandByPoint(new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]));
  const size = box.getSize(new THREE.Vector3());
  const ax = axis ?? (size.x >= size.y && size.x >= size.z ? new THREE.Vector3(1, 0, 0) : size.z >= size.y ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0));
  const lo = box.min.dot(ax), hi = box.max.dot(ax);
  const out: Segments = { a: new Float32Array(n * strokes * 3), b: new Float32Array(n * strokes * 3), seed: new Float32Array(n * strokes * 2), count: n * strokes };
  for (let i = 0; i < n; i++) {
    const a = new THREE.Vector3(pts[i * 6], pts[i * 6 + 1], pts[i * 6 + 2]);
    const b = new THREE.Vector3(pts[i * 6 + 3], pts[i * 6 + 4], pts[i * 6 + 5]);
    const t = THREE.MathUtils.clamp((a.clone().add(b).multiplyScalar(0.5).dot(ax) - lo) / Math.max(hi - lo, 1e-3), 0, 1);
    for (let k = 0; k < strokes; k++) {
      const j = i * strokes + k;
      out.a.set([a.x, a.y, a.z], j * 3);
      out.b.set([b.x, b.y, b.z], j * 3);
      out.seed[j * 2] = Math.random() * 100;
      out.seed[j * 2 + 1] = Math.min(0.999, t * 0.97 + Math.random() * 0.03);
    }
  }
  return out;
}

export class SketchLines extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  constructor(seg: Segments, opts: { width?: number; wobble?: number; color?: number; alpha?: number } = {}) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(seg.a, 3));
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(seg.b, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seg.seed, 2));
    g.instanceCount = seg.count;
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uRes: G.uRes,
        uBoil: G.uBoil,
        tPaper: G.tPaper,
        uWidth: { value: opts.width ?? 1.4 },
        uWobble: { value: opts.wobble ?? 0.025 },
        uProgress: { value: 0 },
        uAlpha: { value: opts.alpha ?? 0.85 },
        // overlay colours are written straight to the screen, so keep the hex values as given
        uColor: { value: new THREE.Color().setHex(opts.color ?? 0x5a5458, THREE.LinearSRGBColorSpace) },
        uInkColor: { value: new THREE.Color().setHex(0x1a161c, THREE.LinearSRGBColorSpace) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // the ribbon's winding depends on which way the stroke runs on screen
      side: THREE.DoubleSide,
    });
    super(g, m);
    this.frustumCulled = false;
  }

  get progress() {
    return this.material.uniforms.uProgress.value as number;
  }
  set progress(v: number) {
    this.material.uniforms.uProgress.value = v;
  }
  get alpha() {
    return this.material.uniforms.uAlpha.value as number;
  }
  set alpha(v: number) {
    this.material.uniforms.uAlpha.value = v;
  }

  /** Replace the segments (for strokes that are re-scribbled every frame, like the Smudge). */
  setSegments(seg: Segments) {
    const g = this.geometry;
    (g.attributes.aA as THREE.InstancedBufferAttribute).array.set(seg.a.subarray(0, seg.count * 3));
    (g.attributes.aB as THREE.InstancedBufferAttribute).array.set(seg.b.subarray(0, seg.count * 3));
    (g.attributes.aSeed as THREE.InstancedBufferAttribute).array.set(seg.seed.subarray(0, seg.count * 2));
    g.attributes.aA.needsUpdate = g.attributes.aB.needsUpdate = g.attributes.aSeed.needsUpdate = true;
    g.instanceCount = seg.count;
  }
}

/** Light pencil shading of a surface that hasn't been drawn properly yet: hatching plus a soft rim. */
export function ghostMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vV = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tPaper; uniform float uBoil; uniform float uAlpha; uniform vec3 uSunDir;
      varying vec3 vW; varying vec3 vN; varying vec3 vV;
      ${NOISE}
      float hatch(vec3 p, vec3 n, float f, float ang) {
        vec3 an = abs(n);
        vec2 uv = an.y > max(an.x, an.z) ? p.xz : (an.x > an.z ? p.zy : p.xy);
        float c = cos(ang), s = sin(ang);
        vec2 r = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
        float j = ibHash2(vec2(floor(r.y * f), uBoil)) * 0.3;
        float l = abs(fract(r.x * f + j + ibNoise(vec3(r * vec2(1.2, 2.0), uBoil * 0.3)) * 0.5) * 2.0 - 1.0);
        return smoothstep(0.72, 0.95, l);
      }
      void main() {
        vec3 N = normalize(vN); vec3 V = normalize(vV);
        if (!gl_FrontFacing) N = -N;
        float shade = 1.0 - smoothstep(-0.2, 0.7, dot(N, uSunDir));
        float h = hatch(vW, N, 6.0, 0.7) * (0.25 + 0.75 * shade);
        float rim = pow(1.0 - abs(dot(N, V)), 4.0);
        float grain = texture2D(tPaper, gl_FragCoord.xy / 512.0).g;
        float a = (h * 0.2 + rim * 0.3) * mix(0.6, 1.0, grain) * uAlpha;
        gl_FragColor = vec4(0.3, 0.28, 0.3, a);
      }`,
    uniforms: { tPaper: G.tPaper, uBoil: G.uBoil, uSunDir: G.uSunDir, uAlpha: { value: 1 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
