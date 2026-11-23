import {
  Color3, Constants, Engine, Matrix, Mesh, Quaternion, Scene, ShaderLanguage, ShaderMaterial, Vector3, Vector4, VertexData,
} from '@babylonjs/core';
import type { Renderer } from './Renderer';

type RGB = [number, number, number];
type V4 = [number, number, number, number];

/** Effect kinds (match the dispatcher in vfx.fragment.wgsl). */
export const VK = {
  slash: 0, shockDome: 1, groundRing: 2, crater: 3, bell: 4, flame: 5, aura: 6, firenado: 7, bolt: 8, arcs: 9,
  beam: 10, column: 11, pillar: 12, smoke: 13, ink: 14, paper: 15, splash: 16, tendril: 17, crane: 18, seal: 19,
  portal: 20, gravity: 21, veil: 22, claw: 23, thrust: 24, crosscut: 25,
} as const;

/**
 * The unit shapes, and what their uv means:
 *   arc       a swept band in the XZ plane round the origin, centred on +Z (radius 0.55..1):
 *             u along the swing (0 start .. 1 end), v across (0 inner .. 1 outer)
 *   disc      a square in the XZ plane, -1..1: uv 0..1 (decals drawn by distance from the centre)
 *   dome      a hemisphere, radius 1: u azimuth, v 0 at the rim .. 1 at the pole
 *   sphere    radius 1: u azimuth, v 0 at the bottom .. 1 at the top
 *   cylinder  radius 1, height 0..1 open: u azimuth, v height
 *   ribbon    x -0.5..0.5, z 0..1: u across, v along (usually turned to the camera about z)
 *   quad      x, y -0.5..0.5: uv 0..1 (usually a camera-facing card)
 */
export type Shape = 'arc' | 'disc' | 'dome' | 'sphere' | 'cylinder' | 'ribbon' | 'quad';

export interface VfxPalette { body: RGB; core: RGB; edge: RGB }

export interface VfxSpec {
  kind: number;
  pos: Vector3;
  /** the effect's local +Z (slash forward, beam and ribbon axis) */
  dir?: Vector3;
  up?: Vector3;
  /** roll about dir, radians */
  roll?: number;
  scale: number | Vector3;
  /** the scale multiplier reached by the end of the effect's life (eased out) */
  grow?: number;
  life: number;
  color: VfxPalette;
  intensity?: number;
  seed?: number;
  p?: V4;
  q?: V4;
  shape?: Shape;
  /** 0 placed mesh, 1 camera-facing card, 2 ribbon turned to the camera about its axis */
  billboard?: number;
  /** metres over which the effect fades where it cuts into the scene */
  soft?: number;
  /** shape-specific (the water crown's flare) */
  flare?: number;
  blend?: 'add' | 'alpha';
  /** spin about up, radians per second */
  spin?: number;
  /** seconds before it appears */
  delay?: number;
  /** follow a moving point; when it returns null the effect winds down */
  follow?: () => Vector3 | null;
  /** keep pointing along a moving direction */
  followDir?: () => Vector3 | null;
}

interface Live {
  spec: VfxSpec;
  mesh: Mesh;
  mat: ShaderMaterial;
  age: number;
  base: Vector3;
  rot: Quaternion;
  spinAngle: number;
  id: number;
  ending: boolean;
  alpha: boolean;
}

const SHAPE_OF: Record<number, Shape> = {
  [VK.slash]: 'arc', [VK.shockDome]: 'sphere', [VK.groundRing]: 'disc', [VK.crater]: 'disc', [VK.bell]: 'dome',
  [VK.flame]: 'cylinder', [VK.aura]: 'sphere', [VK.firenado]: 'cylinder', [VK.bolt]: 'ribbon', [VK.arcs]: 'sphere',
  [VK.beam]: 'ribbon', [VK.column]: 'cylinder', [VK.pillar]: 'cylinder', [VK.smoke]: 'sphere', [VK.ink]: 'disc',
  [VK.paper]: 'cylinder', [VK.splash]: 'cylinder', [VK.tendril]: 'ribbon', [VK.crane]: 'ribbon', [VK.seal]: 'disc',
  [VK.portal]: 'quad', [VK.gravity]: 'sphere', [VK.veil]: 'dome', [VK.claw]: 'quad', [VK.thrust]: 'ribbon',
  [VK.crosscut]: 'quad',
};

const BILLBOARD_OF: Record<number, number> = {
  [VK.bolt]: 2, [VK.beam]: 2, [VK.tendril]: 2, [VK.crane]: 2, [VK.thrust]: 2, [VK.claw]: 1, [VK.crosscut]: 1,
};

/** Kinds (and styles) that are matter, drawn with alpha blending rather than added as light. */
function isAlpha(s: VfxSpec): boolean {
  const style = s.p?.[0] ?? 0;
  const q0 = s.q?.[0] ?? 0;
  const q1 = s.q?.[1] ?? 0;
  switch (s.kind) {
    case VK.crater: case VK.smoke: case VK.ink: case VK.paper: case VK.splash: case VK.tendril: case VK.crane:
    case VK.portal: case VK.gravity: case VK.veil:
      return true;
    case VK.slash: return style >= 1;
    case VK.flame: case VK.bolt: return style >= 1;
    case VK.shockDome: return q0 === 1;
    case VK.groundRing: return q0 >= 1;
    case VK.pillar: return q1 >= 1;
    default: return false;
  }
}

const MAX_LIVE = 96;
const UNIFORMS = ['world', 'viewProjection', 'view', 'cameraPosition', 'vfxTime', 'vfxA', 'vfxB', 'vfxC', 'vfxD', 'body', 'core', 'edge'];

/**
 * Mesh effects: slashes, shock domes, rings, craters, the bell, flames, auras, tornadoes, bolts,
 * beams, columns, pillars, smoke, ink, paper storms, water crowns, curse tendrils, crane trails,
 * seals, portals, gravity wells and the veil. Each live effect is a clone of a unit shape with
 * its own material (pooled), drawn after the scene's opaque pass and softened against the
 * G-buffer depth where it meets the world.
 */
export class Vfx {
  private shapes = new Map<Shape, Mesh>();
  private live: Live[] = [];
  private freeMeshes = new Map<Shape, Mesh[]>();
  private freeMats: { add: ShaderMaterial[]; alpha: ShaderMaterial[] } = { add: [], alpha: [] };
  private nextId = 1;
  private time = 0;
  /** hold every effect at this fraction of its life (stills, the gallery) */
  debugAge: number | null = null;

  constructor(private r: Renderer) {
    const scene = r.scene;
    this.shapes.set('arc', this.build(scene, 'vfxArc', arcData(64, 6, 0.55, 1.0, (200 * Math.PI) / 180)));
    this.shapes.set('disc', this.build(scene, 'vfxDisc', discData()));
    this.shapes.set('dome', this.build(scene, 'vfxDome', sphereData(64, 20, true)));
    this.shapes.set('sphere', this.build(scene, 'vfxSphere', sphereData(64, 32, false)));
    this.shapes.set('cylinder', this.build(scene, 'vfxCyl', cylinderData(64, 32)));
    this.shapes.set('ribbon', this.build(scene, 'vfxRibbon', ribbonData(64)));
    this.shapes.set('quad', this.build(scene, 'vfxQuad', quadData()));
  }

  private build(scene: Scene, name: string, vd: VertexData): Mesh {
    const m = new Mesh(name, scene);
    vd.applyToMesh(m, false);
    m.setEnabled(false);
    m.isPickable = false;
    return m;
  }

  private material(alpha: boolean): ShaderMaterial {
    const pool = alpha ? this.freeMats.alpha : this.freeMats.add;
    const reused = pool.pop();
    if (reused) return reused;
    const mat = new ShaderMaterial('vfx' + (alpha ? 'M' : 'G'), this.r.scene, { vertex: 'vfx', fragment: 'vfx' }, {
      attributes: ['position', 'normal', 'uv'],
      uniforms: UNIFORMS,
      samplers: ['gbuffer'],
      shaderLanguage: ShaderLanguage.WGSL,
      needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.alphaMode = alpha ? Constants.ALPHA_COMBINE : Constants.ALPHA_ONEONE;
    mat.setTexture('gbuffer', this.r.gbuffer.rtt);
    return mat;
  }

  private meshFor(shape: Shape): Mesh {
    const pool = this.freeMeshes.get(shape);
    const m = pool?.pop();
    if (m) {
      m.setEnabled(true);
      return m;
    }
    const base = this.shapes.get(shape)!;
    const c = base.clone(base.name + '_i', null, true, false) as Mesh;
    c.setEnabled(true);
    c.isPickable = false;
    c.alwaysSelectAsActiveMesh = true;
    c.renderingGroupId = 1;
    c.rotationQuaternion = new Quaternion();
    return c;
  }

  /** Start an effect; returns its id (for kill). */
  spawn(spec: VfxSpec): number {
    if (this.live.length >= MAX_LIVE) this.retire(this.live[0]);
    const shape = spec.shape ?? SHAPE_OF[spec.kind] ?? 'quad';
    const alpha = spec.blend ? spec.blend === 'alpha' : isAlpha(spec);
    const mesh = this.meshFor(shape);
    const mat = this.material(alpha);
    mesh.material = mat;
    const base = typeof spec.scale === 'number' ? new Vector3(spec.scale, spec.scale, spec.scale) : spec.scale.clone();
    const rot = orientation(spec.dir, spec.up, spec.roll ?? 0);
    const l: Live = { spec, mesh, mat, age: -(spec.delay ?? 0), base, rot, spinAngle: 0, id: this.nextId++, ending: false, alpha };
    this.live.push(l);
    this.place(l);
    mesh.setEnabled(l.age >= 0);
    return l.id;
  }

  /** Wind an effect down (it fades over its last fifth) or remove it at once. */
  kill(id: number, now = false): void {
    const l = this.live.find((x) => x.id === id);
    if (!l) return;
    if (now) this.retire(l);
    else this.windDown(l);
  }

  private windDown(l: Live): void {
    if (l.ending) return;
    l.ending = true;
    l.age = Math.max(l.age, l.spec.life * 0.8);
  }

  private retire(l: Live): void {
    this.live = this.live.filter((x) => x !== l);
    l.mesh.setEnabled(false);
    const shape = l.spec.shape ?? SHAPE_OF[l.spec.kind] ?? 'quad';
    if (!this.freeMeshes.has(shape)) this.freeMeshes.set(shape, []);
    this.freeMeshes.get(shape)!.push(l.mesh);
    (l.alpha ? this.freeMats.alpha : this.freeMats.add).push(l.mat);
  }

  private place(l: Live): void {
    const s = l.spec;
    const t = Math.min(1, Math.max(0, l.age / Math.max(s.life, 1e-3)));
    const g = s.grow ? 1 + (s.grow - 1) * (1 - Math.pow(1 - t, 3)) : 1;
    const m = l.mesh;
    m.position.copyFrom(s.pos);
    m.scaling.set(l.base.x * g, l.base.y * g, l.base.z * g);
    if (s.spin) {
      m.rotationQuaternion!.copyFrom(Quaternion.RotationAxis(Vector3.Up(), l.spinAngle).multiply(l.rot));
    } else {
      m.rotationQuaternion!.copyFrom(l.rot);
    }
  }

  update(dt: number): void {
    this.time += dt;
    const engine = this.r.scene.getEngine() as Engine;
    const w = engine.getRenderWidth();
    const h = engine.getRenderHeight();
    const cam = this.r.camera.globalPosition;
    for (const l of [...this.live]) {
      const s = l.spec;
      l.age += dt;
      if (l.age < 0) continue;
      if (!l.mesh.isEnabled()) l.mesh.setEnabled(true);
      if (s.follow) {
        const p = s.follow();
        if (p) s.pos.copyFrom(p);
        else this.windDown(l);
      }
      if (s.followDir) {
        const d = s.followDir();
        if (d && d.lengthSquared() > 1e-6) l.rot = orientation(d, s.up, s.roll ?? 0);
      }
      if (s.spin) l.spinAngle += s.spin * dt;
      if (this.debugAge !== null) l.age = Math.max(0, Math.min(this.debugAge, 0.999)) * s.life;
      if (l.age >= s.life) {
        this.retire(l);
        continue;
      }
      this.place(l);
      const alpha = l.alpha;
      const mat = l.mat;
      const p = s.p ?? [0, 0, 0, 0];
      const q = s.q ?? [0, 0, 0, 0];
      mat.setVector3('cameraPosition', cam);
      mat.setVector4('vfxTime', new Vector4(this.time, w, h, alpha ? 1 : 0));
      mat.setVector4('vfxA', new Vector4(s.kind, l.age / s.life, s.seed ?? (l.id * 0.618) % 1, s.intensity ?? 1));
      mat.setVector4('vfxB', new Vector4(p[0], p[1], p[2], p[3]));
      mat.setVector4('vfxC', new Vector4(q[0], q[1], q[2], q[3]));
      const decal = (s.shape ?? SHAPE_OF[s.kind]) === 'disc';
      mat.setVector4('vfxD', new Vector4(s.billboard ?? BILLBOARD_OF[s.kind] ?? 0, s.soft ?? (decal ? 0 : 0.35), s.flare ?? 0.8, s.roll ?? 0));
      mat.setColor3('body', toC3(s.color.body));
      mat.setColor3('core', toC3(s.color.core));
      mat.setColor3('edge', toC3(s.color.edge));
    }
  }

  clear(): void {
    for (const l of [...this.live]) this.retire(l);
  }

  get count(): number {
    return this.live.length;
  }
}

// --- helpers ---------------------------------------------------------------------------------------------------

function toC3(c: RGB): Color3 {
  return new Color3(c[0], c[1], c[2]);
}

/** A rotation taking local +Z to `dir` and local +Y as close to `up` as it can be, then rolled about Z. */
function orientation(dir: Vector3 | undefined, up: Vector3 | undefined, roll: number): Quaternion {
  const rollQ = roll ? Quaternion.RotationAxis(Vector3.Forward(), roll) : Quaternion.Identity();
  if (!dir || dir.lengthSquared() < 1e-8) return rollQ;
  const z = dir.normalizeToNew();
  let u = (up ?? Vector3.Up()).normalizeToNew();
  if (Math.abs(Vector3.Dot(z, u)) > 0.98) u = Math.abs(z.y) > 0.9 ? new Vector3(0, 0, 1) : Vector3.Up();
  const x = Vector3.Cross(u, z).normalize();
  const y = Vector3.Cross(z, x).normalize();
  // Babylon matrices take row vectors: row i is where local axis i goes
  const m = Matrix.FromValues(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1);
  return Quaternion.FromRotationMatrix(m).multiply(rollQ);
}

function arcData(nu: number, nv: number, r0: number, r1: number, span: number): VertexData {
  const pos: number[] = []; const nrm: number[] = []; const uv: number[] = []; const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const r = r0 + (r1 - r0) * v;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const a = -span / 2 + span * u;
      pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
      nrm.push(0, 1, 0);
      uv.push(u, v);
    }
  }
  grid(idx, nu, nv);
  return vd(pos, nrm, uv, idx);
}

function discData(): VertexData {
  return vd([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 0, 1, 0, 1, 1, 0, 1], [0, 2, 1, 0, 3, 2]);
}

function quadData(): VertexData {
  return vd([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], [0, 0, 1, 0, 1, 1, 0, 1], [0, 1, 2, 0, 2, 3]);
}

function sphereData(nu: number, nv: number, hemi: boolean): VertexData {
  const pos: number[] = []; const nrm: number[] = []; const uv: number[] = []; const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const el = hemi ? v * Math.PI / 2 : -Math.PI / 2 + v * Math.PI;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const a = u * Math.PI * 2;
      const x = Math.cos(el) * Math.cos(a), y = Math.sin(el), z = Math.cos(el) * Math.sin(a);
      pos.push(x, y, z);
      nrm.push(x, y, z);
      uv.push(u, v);
    }
  }
  grid(idx, nu, nv);
  return vd(pos, nrm, uv, idx);
}

function cylinderData(nu: number, nv: number): VertexData {
  const pos: number[] = []; const nrm: number[] = []; const uv: number[] = []; const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const a = u * Math.PI * 2;
      pos.push(Math.cos(a), v, Math.sin(a));
      nrm.push(Math.cos(a), 0, Math.sin(a));
      uv.push(u, v);
    }
  }
  grid(idx, nu, nv);
  return vd(pos, nrm, uv, idx);
}

function ribbonData(nv: number): VertexData {
  const pos: number[] = []; const nrm: number[] = []; const uv: number[] = []; const idx: number[] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= 2; i++) {
      const u = i / 2;
      pos.push(u - 0.5, 0, v);
      nrm.push(0, 1, 0);
      uv.push(u, v);
    }
  }
  grid(idx, 2, nv);
  return vd(pos, nrm, uv, idx);
}

function grid(idx: number[], nu: number, nv: number): void {
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
}

function vd(pos: number[], nrm: number[], uv: number[], idx: number[]): VertexData {
  const d = new VertexData();
  d.positions = pos;
  d.normals = nrm;
  d.uvs = uv;
  d.indices = idx;
  return d;
}
