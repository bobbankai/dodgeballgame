import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { VolumetricFog } from './volumetrics';

const T = TSL as any;
const {
  Fn, uniform, attribute, float, vec2, vec3, fract, normalize, cross, length, max, smoothstep, mix, sin, abs, uv, texture,
  positionLocal, cameraPosition, varying, clamp, PI, step,
} = T;

/** Box of air around the camera that the drops wrap through (m). */
const BOX = new THREE.Vector3(30, 18, 30);
const HMAP = 64; // rain-occlusion height map: HMAP x HMAP cells of 1 m, centred near the camera

/**
 * Rain: GPU-animated streaks that fall through a box of air wrapped around the camera (world-anchored, so moving through the
 * rain parallaxes correctly), lit by the light that fills the air at each drop (the section's baked light volume), so drops
 * flare as they pass under a lamp or in front of a neon sign; splash crowns where they land. A height map of the first surface
 * above (ray cast into the physics world around the camera) keeps rain out from under roofs, bridges and the underpass.
 * Rain runs on world time: in a time slow it hangs in the air.
 */
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
  private drops: THREE.Mesh;
  private splashes: THREE.Mesh;
  private splashAttr: THREE.InstancedBufferAttribute;
  private splashCount: number;
  private time = 0;
  private dropCount: number;

  constructor(fog: VolumetricFog, private ground: (x: number, z: number, from: number) => number | null, density = 1) {
    this.htex.minFilter = this.htex.magFilter = THREE.NearestFilter;
    this.htex.needsUpdate = true;
    this.dropCount = Math.round(9000 * density);
    this.splashCount = Math.round(420 * density);
    this.drops = this.makeDrops(fog);
    this.splashes = this.makeSplashes(fog);
    this.splashAttr = this.splashes.geometry.getAttribute('splash') as THREE.InstancedBufferAttribute;
    this.group.add(this.drops, this.splashes);
    this.group.visible = false;
  }

  /** The first surface above each point (the height map in the drop shader); world xz -> height, or -1e4 for open sky. */
  private heightAt(p: any): any {
    const u = this.u as any;
    const c = p.xz.sub(u.hOrigin).div(HMAP).add(0.5);
    const inside = step(0.0, c.x).mul(step(0.0, c.y)).mul(step(c.x, 1.0)).mul(step(c.y, 1.0));
    return mix(float(-1e4), texture(this.htex, clamp(c, 0.0, 1.0)).r, inside);
  }

  private makeDrops(fog: VolumetricFog): THREE.Mesh {
    const n = this.dropCount;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = n;
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
      const toCam = normalize(cameraPosition.sub(c));
      const ax = normalize(cross(ay, toCam));
      const dist = length(cameraPosition.sub(c));
      const len = float(0.32).add(seed.w.mul(0.38));
      const wid = max(float(0.006), dist.mul(0.0011));
      // below the first surface above this column (under a roof): collapse the drop
      const sheltered = step(c.y, this.heightAt(c).sub(0.05));
      const s = float(1).sub(sheltered);
      return c.add(ax.mul(positionLocal.x.mul(wid).mul(s))).add(ay.mul(positionLocal.y.mul(len).mul(s)));
    })();
    mat.colorNode = Fn(() => {
      const c = vCentre;
      const toCam = cameraPosition.sub(c);
      const dist = length(toCam);
      const light = fog.lightAt(c, normalize(toCam).negate());
      // thin bright core across the streak, tapered ends, fading out near the lens and at the box edge
      const across = abs(uv().x.sub(0.5)).mul(2.0);
      const core = smoothstep(1.0, 0.0, across);
      const along = sin(uv().y.mul(PI));
      const fade = smoothstep(0.6, 2.0, dist).mul(smoothstep(BOX.x * 0.5, BOX.x * 0.3, dist));
      return light.mul(1.4).add(0.012).mul(core.mul(along).mul(fade).mul(u.intensity).mul(0.55));
    })();
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }

  private makeSplashes(fog: VolumetricFog): THREE.Mesh {
    const n = this.splashCount;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const data = new Float32Array(n * 4).fill(-1e4);
    const attr = new THREE.InstancedBufferAttribute(data, 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('splash', attr);
    geo.instanceCount = n;
    const u = this.u as any;
    const sp = attribute('splash', 'vec4'); // xyz landing point, w landing time
    const life = 0.32;
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const phase = clamp(u.t.sub(sp.w).div(life), 0.0, 1.0);
    mat.positionNode = Fn(() => {
      const c = sp.xyz;
      const toCam = cameraPosition.sub(c);
      const ax = normalize(cross(vec3(0, 1, 0), toCam));
      const size = float(0.07).add(phase.mul(0.12));
      const alive = step(phase, 0.999).mul(step(0.0, u.t.sub(sp.w)));
      return c.add(ax.mul(positionLocal.x.mul(size).mul(alive))).add(vec3(0, 1, 0).mul(positionLocal.y.add(0.5).mul(size).mul(0.75).mul(alive)));
    })();
    const vC = varying(sp.xyz, 'vSplash');
    mat.colorNode = Fn(() => {
      // a crown: droplets thrown up and out on arcs, drawn as soft dots on the billboard
      const q = uv().sub(vec2(0.5, 0.0));
      let acc: any = float(0);
      for (let k = 0; k < 5; k++) {
        const a = (k / 4 - 0.5) * 1.6;
        const r = phase.mul(0.45);
        const h = phase.mul(float(1).sub(phase)).mul(2.6).mul(0.55 - Math.abs(a) * 0.18);
        const d = length(q.sub(vec2(Math.sin(a), 0.0).mul(r).add(vec2(0.0, h))));
        acc = acc.add(smoothstep(0.06, 0.0, d));
      }
      const ringD = abs(length(q.mul(vec2(1.0, 4.0))).sub(phase.mul(0.42)));
      acc = acc.add(smoothstep(0.035, 0.0, ringD).mul(smoothstep(0.1, 0.0, q.y)).mul(0.6));
      const dist = length(cameraPosition.sub(vC));
      const fade = smoothstep(16.0, 9.0, dist).mul(float(1).sub(phase));
      return fog.lightAt(vC).mul(1.6).add(0.01).mul(acc.mul(fade).mul(u.intensity).mul(0.7));
    })();
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 5;
    return m;
  }

  set intensity(v: number) { (this.u as any).intensity.value = v; this.group.visible = v > 0.001; }
  get intensity(): number { return (this.u as any).intensity.value; }

  /** Per frame: worldDt advances the fall (time-slow freezes the rain). */
  update(worldDt: number, cam: THREE.Camera): void {
    if (!this.group.visible) return;
    const u = this.u as any;
    this.time += worldDt;
    u.t.value = this.time;
    const cp = cam.getWorldPosition(new THREE.Vector3());
    u.camPos.value.copy(cp);
    // re-centre the shelter map when the camera has moved a quarter of it; refill it a few rows per frame
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
      const ang = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5) * 2.4;
      const r = 1.2 + Math.sqrt(Math.random()) * 13;
      const x = cp.x + Math.sin(ang) * r, z = cp.z + Math.cos(ang) * r;
      const y = this.ground(x, z, cp.y + 40);
      a[i * 4] = x; a[i * 4 + 1] = y ?? -1e4; a[i * 4 + 2] = z;
      a[i * 4 + 3] = this.time + Math.random() * per;
      dirty = true;
    }
    if (dirty) this.splashAttr.needsUpdate = true;
  }
}

