// Sun (cascaded shadow maps with soft Vogel-disk PCF and cascade blending) + a fixed pool of point
// lights handed to the nearest light sources each frame (the pool size never changes, so materials
// never recompile when torches come and go).
import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import * as csmShaderModule from 'three/examples/jsm/csm/CSMShader.js';
import type { Quality } from './Quality';
import type { ShadowCascade } from './FogPass';

// three r186's CSMShader.lights_fragment_begin is a stale copy of the core chunk: it lacks the DFG
// lookup and multi-scattering setup added to lights_fragment_begin, which leaves material.dfg = 0 and
// kills all image-based specular (metals render black). Splice CSM's directional-light cascade
// selection into the current core chunk instead of replacing the whole chunk.
const PRISTINE_LIGHTS_BEGIN = THREE.ShaderChunk.lights_fragment_begin;
function csmLightsFragmentBegin(): string {
  const core = PRISTINE_LIGHTS_BEGIN;
  const csm = (csmShaderModule as unknown as { CSMShader: { lights_fragment_begin: string } }).CSMShader.lights_fragment_begin;
  const coreStart = core.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const coreEnd = core.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  const csmStart = csm.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM )');
  const csmEnd = csm.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )');
  if (coreStart < 0 || coreEnd < 0 || csmStart < 0 || csmEnd < 0) {
    console.warn('CSM splice failed; falling back to the CSM chunk');
    return csm;
  }
  return core.slice(0, coreStart) + csm.slice(csmStart, csmEnd) + core.slice(coreEnd);
}
let SPLICED: string | null = null;
function fixCSMChunk(): void {
  SPLICED ??= csmLightsFragmentBegin();
  THREE.ShaderChunk.lights_fragment_begin = SPLICED;
}

export interface LightSource {
  position: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  /** 0..1 flicker amount (fire) */
  flicker?: number;
  /** a light that must always win a pool slot (the player's ember, a boss) */
  priority?: number;
  /** internal flicker phase */
  phase?: number;
}

export class Lighting {
  csm: CSM;
  readonly sources = new Set<LightSource>();
  private pool: THREE.PointLight[] = [];
  private tmp: { s: LightSource; d: number }[] = [];
  private sunIntensity = 3;
  private time = 0;
  /** extra flash multiplier (lightning) */
  flash = 0;
  readonly sunColor = new THREE.Color(1, 1, 1);
  readonly sunDir = new THREE.Vector3(0.3, 0.6, 0.2).normalize(); // toward the light

  constructor(private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, q: Quality) {
    this.csm = this.makeCSM(q);
    const n = q.name === 'performance' ? 4 : q.name === 'high' ? 6 : 8;
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      this.pool.push(l);
      scene.add(l);
    }
  }

  private makeCSM(q: Quality): CSM {
    const csm = new CSM({
      maxFar: q.shadowFar,
      cascades: q.cascades,
      mode: 'practical',
      parent: this.scene,
      shadowMapSize: q.shadowSize,
      lightDirection: this.sunDir.clone().negate(),
      camera: this.camera,
      lightIntensity: this.sunIntensity,
      lightNear: 1,
      lightFar: 600,
      lightMargin: 120,
    });
    csm.fade = true;
    fixCSMChunk();
    for (const l of csm.lights) {
      l.shadow.radius = q.shadowRadius;
      l.shadow.bias = -0.00012;
      l.shadow.normalBias = 0.035;
    }
    return csm;
  }

  rebuild(q: Quality, materials: Iterable<THREE.Material>, patch: (m: THREE.Material) => void): void {
    this.csm.remove();
    this.csm.dispose();
    this.csm = this.makeCSM(q);
    this.setSun(this.sunDir, this.sunColor, this.sunIntensity);
    for (const m of materials) patch(m);
  }

  setSun(dirToLight: THREE.Vector3, color: THREE.Color, intensity: number): void {
    this.sunDir.copy(dirToLight).normalize();
    this.sunColor.copy(color);
    this.sunIntensity = intensity;
    this.csm.lightDirection.copy(this.sunDir).negate();
    for (const l of this.csm.lights) {
      l.color.copy(color);
      l.intensity = intensity * (1 + this.flash);
    }
  }

  setupMaterial(m: THREE.Material): ((shader: THREE.WebGLProgramParametersWithUniforms) => void) {
    this.csm.setupMaterial(m);
    return m.onBeforeCompile as (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  }

  add(s: LightSource): LightSource { s.phase = Math.random() * 100; this.sources.add(s); return s; }
  remove(s: LightSource): void { this.sources.delete(s); }

  update(dt: number, focus: THREE.Vector3): void {
    this.time += dt;
    this.camera.updateMatrixWorld();
    this.csm.update();
    for (const l of this.csm.lights) l.intensity = this.sunIntensity * (1 + this.flash);
    // pool assignment: nearest (weighted by brightness / priority)
    this.tmp.length = 0;
    for (const s of this.sources) {
      const d = s.position.distanceTo(focus) - Math.sqrt(s.intensity) * 2 - (s.priority ?? 0) * 1000;
      this.tmp.push({ s, d });
    }
    this.tmp.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const e = this.tmp[i];
      if (!e) { l.intensity = 0; l.visible = false; continue; }
      const s = e.s;
      l.visible = true;
      l.position.copy(s.position);
      l.color.copy(s.color);
      l.distance = s.distance;
      let k = 1;
      if (s.flicker) {
        const t = this.time * 9 + (s.phase ?? 0);
        k = 1 - s.flicker * (0.5 + 0.5 * (Math.sin(t) * 0.5 + Math.sin(t * 2.3 + 1.7) * 0.3 + Math.sin(t * 5.1 + 0.3) * 0.2));
      }
      l.intensity = s.intensity * k;
    }
  }

  /** shadow maps + matrices for the volumetric fog */
  cascades(): ShadowCascade[] {
    const out: ShadowCascade[] = [];
    const far = this.csm.maxFar;
    const breaks = this.csm.breaks as number[];
    this.csm.lights.forEach((l, i) => {
      const map = l.shadow.map?.depthTexture;
      if (!map) return;
      out.push({ map, matrix: l.shadow.matrix, far: (breaks[i] ?? 1) * far });
    });
    return out;
  }

  dispose(): void {
    this.csm.remove();
    this.csm.dispose();
    for (const l of this.pool) l.removeFromParent();
  }
}
