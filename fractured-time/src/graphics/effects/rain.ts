import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { VolumetricFog } from '../atmosphere/fog';

/**
 * Rain, in three layers, all lit by the light that fills the air where they are (the section's baked light volume), so rain
 * flares under a lamp or in front of a neon sign and goes dark in an alley:
 *
 * - near drops: GPU-animated streaks falling through a box of air wrapped round the camera (world-anchored: moving through
 *   the rain parallaxes correctly), each a camera-facing ribbon along its fall, thinning to a hairline far off;
 * - far rain: curtains of streaks on three cylinders round the camera (25, 45, 75 m), scrolling down at the fall speed and
 *   depth-tested against the city, so a street keeps its rain density into the distance where single drops would alias;
 * - splash crowns where drops land, mostly in front of the camera.
 *
 * A height map of the first surface above (rays into the physics world round the camera) keeps rain from under roofs,
 * bridges and the underpass. The wind gusts (direction and strength drift). Rain runs on world time: in a time slow it hangs.
 */
const T = TSL as any;
const { Fn, uniform, attribute, float, vec2, vec3, vec4, fract, normalize, cross, length, max, smoothstep, sin, abs, uv, texture, positionLocal,
  cameraPosition, varying, clamp, PI, step, mix, floor, hash, positionWorld, time } = T;

const BOX = new THREE.Vector3(30, 18, 30);
const HMAP = 64; // shelter map: 64 x 64 cells of 1 m round the camera

export class Rain {
  readonly group = new THREE.Group();
  readonly u = {
    camPos: uniform(new THREE.Vector3()), t: uniform(0), intensity: uniform(0), wind: uniform(new THREE.Vector3(1.6, 0, 0.7)),
    hOrigin: uniform(new THREE.Vector2()),
  };
  private hdata = new Float32Array(HMAP * HMAP).fill(-1e4);
  private htex = new THREE.DataTexture(this.hdata, HMAP, HMAP, THREE.RedFormat, THREE.FloatType);
  private hOrigin = new THREE.Vector2(1e9, 1e9);
  private hNext = 0;
  private splashAttr: THREE.InstancedBufferAttribute;
  private splashCount: number;
  private dropCount: number;
  private time = 0;
  private curtains: THREE.Mesh[] = [];

  constructor(fog: VolumetricFog, private ground: (x: number, z: number, from: number) => number | null, density = 1) {
    this.htex.minFilter = this.htex.magFilter = THREE.NearestFilter;
    this.htex.needsUpdate = true;
    this.dropCount = Math.round(9000 * density);
    this.splashCount = Math.round(420 * density);
    const splashes = this.makeSplashes(fog);
    this.splashAttr = splashes.geometry.getAttribute('splash') as THREE.InstancedBufferAttribute;
    this.group.add(this.makeDrops(fog), splashes);
    for (const [r, k] of [[25, 1], [45, 0.8], [75, 0.6]] as const) {
      const c = this.makeCurtain(fog, r, k * Math.min(1, density + 0.3));
      this.curtains.push(c);
      this.group.add(c);
    }
    this.group.visible = false;
  }

  /** The first surface above world point p (the shelter map); -1e4 = open sky. */
  private shelterAt(p: any): any {
    const u = this.u as any;
    const c = p.xz.sub(u.hOrigin).div(HMAP).add(0.5);
    const inside = step(0.0, c.x).mul(step(0.0, c.y)).mul(step(c.x, 1.0)).mul(step(c.y, 1.0));
    return mix(float(-1e4), texture(this.htex, clamp(c, 0.0, 1.0)).r, inside);
  }

  private quadGeometry(count: number, attrs: Record<string, THREE.InstancedBufferAttribute>): THREE.InstancedBufferGeometry {
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    for (const [k, a] of Object.entries(attrs)) geo.setAttribute(k, a);
    geo.instanceCount = count;
    return geo;
  }

  private makeDrops(fog: VolumetricFog): THREE.Mesh {
    const n = this.dropCount;
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = this.quadGeometry(n, { seed: new THREE.InstancedBufferAttribute(seeds, 4) });
    const u = this.u as any;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const seed = attribute('seed', 'vec4');
    const fall = float(8.5).add(seed.w.mul(2.5));
    const vel = vec3(u.wind.x, fall.negate(), u.wind.z);
    const box = vec3(BOX.x, BOX.y, BOX.z);
    const centre = Fn(() => {
      const base = seed.xyz.mul(box).add(vel.mul(u.t));
      return u.camPos.add(fract(base.sub(u.camPos).div(box)).sub(0.5).mul(box));
    })();
    const vCentre = varying(centre, 'vRainCentre');
    mat.positionNode = Fn(() => {
      const c = centre;
      const ay = normalize(vel);
      const ax = normalize(cross(ay, normalize(cameraPosition.sub(c))));
      const dist = length(cameraPosition.sub(c));
      const len = float(0.32).add(seed.w.mul(0.38));
      const wid = max(float(0.006), dist.mul(0.0011));
      const open = float(1).sub(step(c.y, this.shelterAt(c).sub(0.05))); // under a roof: collapsed
      return c.add(ax.mul(positionLocal.x.mul(wid).mul(open))).add(ay.mul(positionLocal.y.mul(len).mul(open)));
    })();
    mat.colorNode = Fn(() => {
      const c = vCentre;
      const toCam = cameraPosition.sub(c);
      const dist = length(toCam);
      const light = fog.lightAt(c, normalize(toCam).negate());
      const core = smoothstep(1.0, 0.0, abs(uv().x.sub(0.5)).mul(2.0));
      const along = sin(uv().y.mul(PI));
      const fade = smoothstep(0.6, 2.0, dist).mul(smoothstep(BOX.x * 0.5, BOX.x * 0.3, dist));
      return light.mul(1.4).add(0.012).mul(core.mul(along).mul(fade).mul(u.intensity).mul(0.55));
    })();
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }

  /** A curtain of distant rain: streaks on an open cylinder of radius r round the camera. */
  private makeCurtain(fog: VolumetricFog, r: number, strength: number): THREE.Mesh {
    const u = this.u as any;
    const geo = new THREE.CylinderGeometry(r, r, 40, 64, 1, true);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide });
    const cols = Math.round(r * 9); // streak columns round the circumference (~0.7 m apart)
    mat.colorNode = Fn(() => {
      const q = uv();
      const x = q.x.mul(cols);
      const col = floor(x);
      const h = hash(col.add(r));
      // each column a broken streak falling at the fall speed, offset by its own phase and lean (the wind)
      const v = q.y.mul(40.0 / 1.6).add(u.t.mul(9.0 / 1.6)).add(h.mul(17.0));
      const seg = fract(v);
      const streak = smoothstep(0.0, 0.08, seg).mul(smoothstep(0.75, 0.25, seg)).mul(step(0.35, hash(floor(v).add(col.mul(7.1)))));
      const across = abs(fract(x).sub(0.5)).mul(2.0);
      const line = smoothstep(0.35, 0.0, across);
      const p = positionWorld;
      const light = fog.lightAt(p, normalize(cameraPosition.sub(p)).negate());
      // fade at the top and bottom of the shell and where the shell would cut through the ground near the camera
      const ends = smoothstep(0.0, 0.15, q.y).mul(smoothstep(1.0, 0.7, q.y));
      return light.mul(line.mul(streak).mul(ends).mul(u.intensity).mul(0.06 * strength));
    })();
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 4;
    return m;
  }

  private makeSplashes(fog: VolumetricFog): THREE.Mesh {
    const n = this.splashCount;
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4).fill(-1e4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    const geo = this.quadGeometry(n, { splash: attr });
    const u = this.u as any;
    const sp = attribute('splash', 'vec4'); // xyz landing point, w landing time
    const life = 0.32;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const phase = clamp(u.t.sub(sp.w).div(life), 0.0, 1.0);
    mat.positionNode = Fn(() => {
      const c = sp.xyz;
      const ax = normalize(cross(vec3(0, 1, 0), cameraPosition.sub(c)));
      const size = float(0.07).add(phase.mul(0.12));
      const alive = step(phase, 0.999).mul(step(0.0, u.t.sub(sp.w)));
      return c.add(ax.mul(positionLocal.x.mul(size).mul(alive))).add(vec3(0, 1, 0).mul(positionLocal.y.add(0.5).mul(size).mul(0.75).mul(alive)));
    })();
    const vC = varying(sp.xyz, 'vSplash');
    mat.colorNode = Fn(() => {
      // a crown: droplets thrown up and out on arcs, and a ring spreading on the ground
      const q = uv().sub(vec2(0.5, 0.0));
      let acc: any = float(0);
      for (let k = 0; k < 5; k++) {
        const a = (k / 4 - 0.5) * 1.6;
        const r = phase.mul(0.45);
        const h = phase.mul(float(1).sub(phase)).mul(2.6).mul(0.55 - Math.abs(a) * 0.18);
        acc = acc.add(smoothstep(0.06, 0.0, length(q.sub(vec2(Math.sin(a), 0.0).mul(r).add(vec2(0.0, h))))));
      }
      const ringD = abs(length(q.mul(vec2(1.0, 4.0))).sub(phase.mul(0.42)));
      acc = acc.add(smoothstep(0.035, 0.0, ringD).mul(smoothstep(0.1, 0.0, q.y)).mul(0.6));
      const fade = smoothstep(16.0, 9.0, length(cameraPosition.sub(vC))).mul(float(1).sub(phase));
      return fog.lightAt(vC).mul(1.6).add(0.01).mul(acc.mul(fade).mul(u.intensity).mul(0.7));
    })();
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }

  set intensity(v: number) { (this.u as any).intensity.value = v; this.group.visible = v > 0.001; }
  get intensity(): number { return (this.u as any).intensity.value; }

  /** Per frame: `worldDt` advances the fall (a time slow freezes the rain). */
  update(worldDt: number, cam: THREE.Camera): void {
    if (!this.group.visible) return;
    const u = this.u as any;
    this.time += worldDt;
    u.t.value = this.time;
    // gusts: the wind's direction and strength drift on slow incommensurate waves
    const t = this.time;
    const gust = 1 + 0.35 * Math.sin(t * 0.23) * Math.sin(t * 0.61 + 1.3);
    const ang = 0.41 + 0.25 * Math.sin(t * 0.07);
    u.wind.value.set(Math.cos(ang) * 1.75 * gust, 0, Math.sin(ang) * 1.75 * gust);
    const cp = cam.getWorldPosition(new THREE.Vector3());
    u.camPos.value.copy(cp);
    for (const c of this.curtains) c.position.set(cp.x, cp.y + 8, cp.z);
    // re-centre the shelter map after a quarter of it; refill a few rows per frame
    if (Math.abs(cp.x - this.hOrigin.x) > HMAP / 4 || Math.abs(cp.z - this.hOrigin.y) > HMAP / 4) {
      this.hOrigin.set(Math.round(cp.x), Math.round(cp.z));
      u.hOrigin.value.copy(this.hOrigin);
      this.hdata.fill(-1e4);
      this.hNext = 0;
    }
    for (let r = 0; r < 8 && this.hNext < HMAP; r++, this.hNext++) {
      const j = this.hNext;
      for (let i = 0; i < HMAP; i++) {
        const h = this.ground(this.hOrigin.x + i - HMAP / 2 + 0.5, this.hOrigin.y + j - HMAP / 2 + 0.5, cp.y + 40);
        this.hdata[i + j * HMAP] = h ?? -1e4;
      }
      this.htex.needsUpdate = true;
    }
    // splashes: restart finished ones at fresh landing points, mostly in front of the camera
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const a = this.splashAttr.array as Float32Array;
    let dirty = false;
    const per = 0.32 * (1 / Math.max(0.1, this.intensity));
    for (let i = 0; i < this.splashCount; i++) {
      if (this.time - a[i * 4 + 3] < per && a[i * 4 + 1] > -1e3) continue;
      const an = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5) * 2.4;
      const rr = 1.2 + Math.sqrt(Math.random()) * 13;
      const x = cp.x + Math.sin(an) * rr, z = cp.z + Math.cos(an) * rr;
      const y = this.ground(x, z, cp.y + 40);
      a[i * 4] = x; a[i * 4 + 1] = y ?? -1e4; a[i * 4 + 2] = z;
      a[i * 4 + 3] = this.time + Math.random() * per;
      dirty = true;
    }
    if (dirty) this.splashAttr.needsUpdate = true;
  }
}

void vec4; void time;
