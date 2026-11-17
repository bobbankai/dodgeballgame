import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { fbm } from '../shaders/common';

/**
 * Open sea, written for this game (it replaces a vendored kit).
 *
 * - Sheet: one mesh following the camera, a grid warped radially (uniform to 160 m, then stretched to 1.7 km), its origin
 *   snapped to the inner cell so vertices sit on a fixed world lattice and nothing swims.
 * - Swell: a sum of 12 Gerstner waves from a sea state (wavelengths in a geometric series from swell to chop, directions
 *   spread round the wind, amplitude ~ wavelength^0.85, normalised to the state's height); each wave fades out where the
 *   grid can no longer carry it. Waves shoal and die in shallow water (the seabed tile).
 * - Normals per pixel from the same waves at the pixel's rest position, plus two octaves of ripples that fade to flat by
 *   their own frequency against the pixel footprint (no shimmer far away).
 * - Optics: Schlick Fresnel between a planar mirror (three's `reflector`, half resolution, distorted by the normal, hazed
 *   toward the air colour with distance) and the water body: a deep / shallow colour by the water column (Beer-Lambert
 *   over a seabed tile baked from the level's height function), lit by the air's light, with light through the crests.
 * - Foam: on steep crests (the Gerstner fold), and round rocks and shores where the column is shallow; lit by the air.
 * - Sun: a GGX glint toward the sun direction the level's bake used.
 */
const T = TSL as any;
const { Fn, uniform, vec2, vec3, vec4, float, sin, cos, exp, pow, max, min, mix, smoothstep, clamp, dot, normalize, length, fwidth, texture,
  positionLocal, positionWorld, cameraPosition, varying, reflector, time, PI } = T;

export interface SeaState {
  /** significant height scale (m), wavelengths (longest, shortest, m), choppiness 0..1, wind direction (rad), spread (rad) */
  amplitude: number; wavelengths: [number, number]; choppiness: number; wind: number; spread: number;
  roughness: number; deep: number; shallow: number; absorb: number; foam: number;
}

export const SEA_STATES: Record<string, SeaState> = {
  'Calm coast': { amplitude: 0.35, wavelengths: [60, 4], choppiness: 0.35, wind: 0.3, spread: 0.5, roughness: 0.06, deep: 0x0a2a3a, shallow: 0x1f6f7a, absorb: 0.09, foam: 0.3 },
  'Coastal breeze': { amplitude: 1.0, wavelengths: [110, 5], choppiness: 0.62, wind: 0.3, spread: 0.6, roughness: 0.1, deep: 0x052a3a, shallow: 0x1f8f9a, absorb: 0.115, foam: 0.8 },
  'Storm swell': { amplitude: 3.2, wavelengths: [150, 6], choppiness: 0.85, wind: 0.9, spread: 0.7, roughness: 0.22, deep: 0x0a1a1e, shallow: 0x2c5a60, absorb: 0.24, foam: 1.6 },
};

const WAVES = 12;
const SEG = 256;
const INNER = 160;
const OUTER = 1700;

interface Wave { dir: [number, number]; k: number; a: number; q: number; c: number }

function waves(s: SeaState, seed = 7): Wave[] {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const [lmax, lmin] = s.wavelengths;
  const out: Wave[] = [];
  let sum = 0;
  for (let i = 0; i < WAVES; i++) {
    const L = lmax * (lmin / lmax) ** (i / (WAVES - 1));
    const ang = s.wind + (rnd() - 0.5) * 2 * s.spread;
    const k = (2 * Math.PI) / L;
    const a = (L / lmax) ** 0.85 * (0.75 + rnd() * 0.5);
    sum += a;
    out.push({ dir: [Math.cos(ang), Math.sin(ang)], k, a, q: 0, c: Math.sqrt(9.81 / k) });
  }
  for (const w of out) {
    w.a *= s.amplitude / sum;
    w.q = s.choppiness / (w.k * w.a * WAVES);
  }
  return out;
}

export interface OceanOptions {
  seaLevel: number;
  preset: string;
  /** seabed height at world (x, z) */
  heightAt: (x: number, z: number) => number;
  /** the air's colour (fog in-scatter): reflection haze and foam light */
  air: THREE.Color;
  mirrorScale: number;
}

export class Ocean {
  readonly mesh: THREE.Mesh;
  readonly u = {
    amp: uniform(1), roughness: uniform(0.1), deep: uniform(new THREE.Color()), shallow: uniform(new THREE.Color()), absorb: uniform(0.1),
    foam: uniform(0.8), air: uniform(new THREE.Color()), sunDir: uniform(new THREE.Vector3(0.4, 0.6, 0.3)), sunCol: uniform(new THREE.Color()),
    origin: uniform(new THREE.Vector2()), bedOrigin: uniform(new THREE.Vector2()), seaLevel: uniform(0),
    clocks: [] as any[],
  };
  private bedData = new Float32Array(256 * 256);
  private bed = new THREE.DataTexture(this.bedData, 256, 256, THREE.RedFormat, THREE.FloatType);
  private bedCentre = new THREE.Vector2(1e9, 1e9);
  private waves: Wave[];
  private mirror: any;
  private t = 0;
  private mask = 0;

  constructor(private scene: THREE.Scene, private o: OceanOptions) {
    const state = SEA_STATES[o.preset] ?? SEA_STATES['Coastal breeze'];
    this.waves = waves(state);
    this.u.clocks = this.waves.map(() => uniform(0));
    (this.u.seaLevel as any).value = o.seaLevel;
    this.bed.minFilter = this.bed.magFilter = THREE.LinearFilter;
    this.applyPreset(o.preset);
    this.mesh = new THREE.Mesh(this.sheet(), this.material());
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
  }

  /** The radially warped grid: square rings, uniform inside INNER, stretched out to OUTER. */
  private sheet(): THREE.BufferGeometry {
    const g = new THREE.PlaneGeometry(2, 2, SEG, SEG);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = Math.max(Math.abs(x), Math.abs(z));
      if (d < 1e-6) continue;
      const s = d < 0.55 ? (d / 0.55) * INNER : INNER + (OUTER - INNER) * ((d - 0.55) / 0.45) ** 2.2;
      p.setXYZ(i, (x / d) * s, 0, (z / d) * s);
    }
    g.computeBoundingSphere();
    return g;
  }

  private material(): THREE.MeshBasicNodeMaterial {
    const u = this.u as any;
    const m = new THREE.MeshBasicNodeMaterial();
    m.fog = true;
    m.depthWrite = true;
    // water column under a world point (bed tile: 4 m per texel over 1 km; outside it, deep)
    const column = (xz: any) => {
      const c = xz.sub(u.bedOrigin).div(1024.0).add(0.5);
      const inside = smoothstep(0.0, 0.02, min(min(c.x, c.y), min(float(1).sub(c.x), float(1).sub(c.y))));
      const bed = texture(this.bed, clamp(c, 0.0, 1.0)).r;
      return mix(float(60.0), max(u.seaLevel.sub(bed), 0.0), inside);
    };
    const rest = positionLocal.xz.add(u.origin); // world xz of the rest vertex
    const distCam = length(rest.sub(cameraPosition.xz));
    // displacement
    m.positionNode = Fn(() => {
      const shoal = smoothstep(0.0, 4.0, column(rest)); // waves die where the water runs out
      const disp = vec3(0).toVar();
      this.waves.forEach((w, i) => {
        const keep = smoothstep(float(2 * Math.PI / w.k * 12.0), float(2 * Math.PI / w.k * 4.0), distCam); // the grid's reach
        const ph = dot(vec2(w.dir[0], w.dir[1]), rest).mul(w.k).sub(u.clocks[i]);
        const a = float(w.a).mul(u.amp).mul(keep).mul(shoal);
        disp.addAssign(vec3(cos(ph).mul(a).mul(w.q * w.dir[0]), sin(ph).mul(a), cos(ph).mul(a).mul(w.q * w.dir[1])));
      });
      return vec3(positionLocal.x, u.seaLevel, positionLocal.z).add(disp);
    })();
    const vRest = varying(rest, 'vSeaRest');
    // the surface at this pixel: analytic swell normal at the rest position plus ripples, and the fold (crest steepness)
    const surf = Fn(() => {
      const xz = vRest;
      const shoal = smoothstep(0.0, 4.0, column(xz));
      const footprint = max(fwidth(xz.x), fwidth(xz.y));
      const sx = float(0).toVar(), sz = float(0).toVar(), fold = float(0).toVar();
      this.waves.forEach((w, i) => {
        const keep = smoothstep(float(2 * Math.PI / w.k * 0.5), float(2 * Math.PI / w.k * 0.12), footprint);
        const ph = dot(vec2(w.dir[0], w.dir[1]), xz).mul(w.k).sub(u.clocks[i]);
        const wa = float(w.k * w.a).mul(u.amp).mul(keep).mul(shoal);
        sx.addAssign(cos(ph).mul(wa).mul(w.dir[0]));
        sz.addAssign(cos(ph).mul(wa).mul(w.dir[1]));
        fold.addAssign(sin(ph).mul(wa).mul(w.q));
      });
      // ripples, each octave fading by its frequency against the pixel footprint
      const rq = vec3(xz.x, time.mul(0.4), xz.y);
      const r1 = smoothstep(0.25, 0.05, footprint), r2 = smoothstep(0.08, 0.015, footprint);
      const e = 0.04;
      const h = (q: any) => fbm(q, 0.9, 2).mul(r1).add(fbm(q, 3.7, 2).mul(0.35).mul(r2));
      const h0 = h(rq);
      sx.addAssign(h(rq.add(vec3(e, 0, 0))).sub(h0).div(e).mul(0.22));
      sz.addAssign(h(rq.add(vec3(0, 0, e))).sub(h0).div(e).mul(0.22));
      return vec4(normalize(vec3(sx.negate(), 1.0, sz.negate())), fold);
    })();
    const N = surf.xyz;
    const fold = surf.w;
    // the planar mirror (a fraction of the screen's resolution; it never reflects other mirrors), distorted by the surface
    this.mirror = reflector({ resolutionScale: this.o.mirrorScale, bounces: false });
    this.mirror.target.rotateX(-Math.PI / 2);
    this.mirror.target.position.y = this.o.seaLevel;
    this.scene.add(this.mirror.target);
    this.mirror.uvNode = this.mirror.uvNode.add(N.xz.mul(0.07));
    m.colorNode = Fn(() => {
      const xz = vRest;
      const P = positionWorld;
      const V = normalize(cameraPosition.sub(P));
      const nv = max(dot(N, V), 0.0);
      const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(nv), 5.0)));
      const dist = length(cameraPosition.sub(P));
      const refl = mix(this.mirror.rgb, u.air.mul(1.1), smoothstep(300.0, 1200.0, dist));
      // the body: deep or shallow by the water column, lit by the air; light through the crests
      const col = column(xz);
      const body = mix(u.shallow, u.deep, float(1).sub(exp(col.mul(u.absorb).negate()))).mul(u.air.mul(2.2).add(0.02));
      const sss = smoothstep(0.0, 0.6, fold).mul(max(dot(V, u.sunDir.negate()), 0.0).add(0.3)).mul(u.shallow).mul(u.sunCol).mul(0.06);
      // sun glint (GGX)
      const H = normalize(V.add(u.sunDir));
      const a2 = u.roughness.mul(u.roughness).max(0.0004);
      const nh = max(dot(N, H), 0.0);
      const dn = nh.mul(nh).mul(a2.sub(1.0)).add(1.0);
      const glint = a2.div(PI.mul(dn).mul(dn)).mul(F).min(40.0).mul(u.sunCol).mul(max(dot(N, u.sunDir), 0.0));
      // foam: steep crests and shallow water round rocks and shores
      const lace = fbm(vec3(xz.x, time.mul(0.15), xz.y), 0.35, 3);
      const crest = smoothstep(0.35, 0.75, fold.mul(u.foam)).mul(smoothstep(0.45, 0.7, lace));
      const shore = smoothstep(1.6, 0.2, col.add(lace.sub(0.5))).mul(smoothstep(0.35, 0.6, lace));
      const foam = max(crest, shore).clamp(0, 1);
      const water = mix(body.add(sss), refl, F).add(glint);
      return vec4(mix(water, u.air.mul(1.4).add(u.sunCol.mul(0.05)), foam.mul(0.85)), 1.0);
    })();
    return m;
  }

  applyPreset(name: string): void {
    const s = SEA_STATES[name] ?? SEA_STATES['Coastal breeze'];
    const u = this.u as any;
    // the spectrum's shape is fixed at build; a preset change rescales its height and repaints the water
    const base = SEA_STATES[this.o.preset] ?? SEA_STATES['Coastal breeze'];
    u.amp.value = s.amplitude / base.amplitude;
    u.roughness.value = s.roughness;
    u.deep.value.setHex(s.deep);
    u.shallow.value.setHex(s.shallow);
    u.absorb.value = s.absorb;
    u.foam.value = s.foam;
  }

  /** Which layers the mirror shows (the section's structure; the sky always reflects as the background). */
  setReflectionLayers(mask: number): void { this.mask = mask; }

  /** Bake the seabed tile round (x, z) now. */
  bakeBedNow(x: number, z: number): void {
    this.bedCentre.set(Math.round(x / 64) * 64, Math.round(z / 64) * 64);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      this.bedData[i + j * 256] = this.o.heightAt(this.bedCentre.x + (i + 0.5) * 4 - 512, this.bedCentre.y + (j + 0.5) * 4 - 512);
    }
    this.bed.needsUpdate = true;
    (this.u.bedOrigin as any).value.copy(this.bedCentre);
  }

  /** Per frame: clocks, follow the camera, the sun. `sunCol` 0 where no sun is visible (a storm deck). */
  update(camera: THREE.Camera, dt: number, sunDir: THREE.Vector3, sunCol: THREE.Color, air: THREE.Color): void {
    const u = this.u as any;
    this.t += dt;
    this.waves.forEach((w, i) => { u.clocks[i].value = (w.k * w.c * this.t) % (2 * Math.PI); });
    const cell = (2 * INNER) / (SEG * 0.55);
    const cx = Math.round(camera.position.x / cell) * cell, cz = Math.round(camera.position.z / cell) * cell;
    this.mesh.position.set(cx, 0, cz);
    u.origin.value.set(cx, cz);
    u.sunDir.value.copy(sunDir).normalize();
    u.sunCol.value.copy(sunCol);
    u.air.value.copy(air);
    if (Math.hypot(camera.position.x - this.bedCentre.x, camera.position.z - this.bedCentre.y) > 300) this.bakeBedNow(camera.position.x, camera.position.z);
    // the mirror's camera sees only the whitelisted layers (created on the mirror's first render)
    const vc = this.mirror?.reflector?.getVirtualCamera?.(camera);
    if (vc && this.mask) vc.layers.mask = this.mask;
  }

  dispose(): void {
    this.scene.remove(this.mesh, this.mirror.target);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.bed.dispose();
  }
}

void vec2; void cos;
