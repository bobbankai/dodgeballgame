import * as THREE from 'three';
import type { QualityProfile } from '../config/quality';
import type { GradeSettings } from '../rendering/PostEffects';
import { Crowd } from './Crowd';
import { Scoreboard } from './ArenaKit';

export interface ArenaLook {
  background: THREE.Color | THREE.Texture | null;
  fog: THREE.Fog | THREE.FogExp2 | null;
  grade: Partial<GradeSettings>;
  bloom: number;
  envIntensity: number;
  /** where to bake the environment probe from */
  probe: THREE.Vector3;
}

export interface ArenaInfo {
  id: string;
  name: string;
  location: string;
  tagline: string;
  /** home/away short names for scoreboards */
  court: { halfWidth: number; halfLength: number };
}

/**
 * A built arena: meshes, lights, look (fog/grade/bloom), camera constraints and
 * animated elements (crowd, scoreboard, lights, props).
 */
export class Arena {
  readonly root = new THREE.Group();
  crowd: Crowd | null = null;
  scoreboards: Scoreboard[] = [];
  updaters: ((dt: number, t: number) => void)[] = [];
  /** Called on big plays: 0..1 intensity. */
  hypeHandlers: ((amount: number) => void)[] = [];
  keyLight: THREE.DirectionalLight | null = null;
  cameraBounds = new THREE.Box3(new THREE.Vector3(-14, 0.3, -18), new THREE.Vector3(14, 10, 18));
  blockers: THREE.Box3[] = [];
  /** Named points for cinematics (tunnel exits, spotlight marks...). */
  marks: Record<string, THREE.Vector3> = {};
  look: ArenaLook;
  envTexture: THREE.Texture | null = null;
  /** Materials that expose a uTime uniform. */
  timeUniforms: { value: number }[] = [];

  constructor(public info: ArenaInfo, public quality: QualityProfile) {
    this.look = {
      background: new THREE.Color(0x101216),
      fog: null,
      grade: {},
      bloom: 0.85,
      envIntensity: 1,
      probe: new THREE.Vector3(0, 2.5, 0),
    };
  }

  hype(amount: number) {
    this.crowd?.cheer(amount);
    for (const h of this.hypeHandlers) h(amount);
  }

  setScore(home: number, away: number, clock: string, round: number) {
    for (const s of this.scoreboards) s.set(home, away, clock, round);
  }

  update(dt: number, t: number) {
    this.crowd?.update(dt, t);
    for (const u of this.timeUniforms) u.value = t;
    for (const f of this.updaters) f(dt, t);
  }

  /** Render the arena into a PMREM so reflections match its lighting. */
  bakeEnvironment(renderer: THREE.WebGLRenderer) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tmp = new THREE.Scene();
    tmp.background = this.look.background instanceof THREE.Color ? this.look.background : new THREE.Color(0x202020);
    const parent = this.root.parent;
    tmp.add(this.root);
    // add a soft fill so the probe isn't pitch black in unlit areas
    const amb = new THREE.AmbientLight(0xffffff, 0.35);
    tmp.add(amb);
    const rt = pmrem.fromScene(tmp, 0.035, 0.1, 200, { position: this.look.probe, size: 256 } as any);
    tmp.remove(amb);
    if (parent) parent.add(this.root);
    else tmp.remove(this.root);
    pmrem.dispose();
    this.envTexture = rt.texture;
    return rt.texture;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const mats = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const mm of mats) {
        for (const v of Object.values(mm)) if (v instanceof THREE.Texture) v.dispose();
        mm.dispose();
      }
    });
    this.envTexture?.dispose();
  }
}
