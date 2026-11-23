import { Constants, Mesh, Scene, ShaderLanguage, ShaderMaterial, Vector3, Vector4, VertexBuffer, VertexData } from '@babylonjs/core';

const SEGS = 14;
/** ribbon segments per recorded point (Catmull-Rom between them) */
const RES = 3;
const N = SEGS * RES;

interface Trail {
  mesh: Mesh;
  mat: ShaderMaterial;
  pts: Vector3[];
  widths: number[];
  source: () => Vector3;
  width: number;
  active: boolean;
  fade: number;
  palette: number;
  spark: boolean;
  seed: number;
}

/**
 * Slash trails: ribbons that follow a fist, foot or blade while a move is active, then fade.
 * Each keeps its last SEGS positions; the ribbon is rebuilt every frame facing the camera.
 */
export class Trails {
  private pool: Trail[] = [];
  private time = 0;

  constructor(private scene: Scene) {}

  private make(): Trail {
    const mesh = new Mesh('trail', this.scene);
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i <= N; i++) {
      uv.set([i / N, 0, i / N, 1], i * 4);
    }
    const vd = new VertexData();
    vd.positions = pos;
    vd.uvs = uv;
    vd.indices = idx;
    vd.applyToMesh(mesh, true);
    const mat = new ShaderMaterial('trailMat', this.scene, { vertex: 'trail', fragment: 'trail' }, {
      attributes: ['position', 'uv'], uniforms: ['viewProjection', 'trailParams', 'trailParams2'], shaderLanguage: ShaderLanguage.WGSL, needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    // premultiplied: energy adds light, ink and paper cover what is behind
    mat.alphaMode = Constants.ALPHA_PREMULTIPLIED;
    mesh.material = mat;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.renderingGroupId = 1;
    return { mesh, mat, pts: [], widths: [], source: () => Vector3.Zero(), width: 0.3, active: false, fade: 0, palette: 0, spark: false, seed: 0 };
  }

  /** Start a trail following `source` until `stop` is called. Returns a handle. */
  start(source: () => Vector3, width: number, palette: number, spark = false): Trail {
    let t = this.pool.find((x) => !x.active && x.fade <= 0);
    if (!t) {
      t = this.make();
      this.pool.push(t);
    }
    t.source = source;
    t.width = width;
    t.palette = palette;
    t.spark = spark;
    t.seed = Math.random();
    t.active = true;
    t.fade = 1;
    const p = source();
    t.pts = Array.from({ length: SEGS + 1 }, () => p.clone());
    t.mesh.setEnabled(true);
    return t;
  }

  stop(t: Trail): void {
    t.active = false;
  }

  update(dt: number, camPos: Vector3): void {
    this.time += dt;
    for (const t of this.pool) {
      if (!t.active && t.fade <= 0) {
        t.mesh.setEnabled(false);
        continue;
      }
      if (t.active) {
        t.pts.unshift(t.source().clone());
        t.pts.length = SEGS + 1;
      } else {
        t.fade -= dt * 4;
        // the tail catches up with the head
        t.pts.push(t.pts[t.pts.length - 1]);
        t.pts.shift();
        t.pts.unshift(t.pts[0]);
        t.pts.length = SEGS + 1;
      }
      // a smooth curve through the recorded points (Catmull-Rom), RES samples per segment
      const curve: Vector3[] = [];
      for (let i = 0; i < SEGS; i++) {
        const p0 = t.pts[Math.max(i - 1, 0)];
        const p1 = t.pts[i];
        const p2 = t.pts[i + 1];
        const p3 = t.pts[Math.min(i + 2, SEGS)];
        for (let k = 0; k < RES; k++) curve.push(Vector3.CatmullRom(p0, p1, p2, p3, k / RES));
      }
      curve.push(t.pts[SEGS].clone());
      const pos = new Float32Array((N + 1) * 6);
      for (let i = 0; i <= N; i++) {
        const p = curve[i];
        const along = curve[Math.min(i + 1, N)].subtract(curve[Math.max(i - 1, 0)]);
        if (along.lengthSquared() < 1e-8) along.set(0, 1, 0);
        const toCam = camPos.subtract(p).normalize();
        const side = Vector3.Cross(along.normalize(), toCam).normalize();
        // full width at the head (the shader tapers the tail itself)
        const w = t.width * 0.5;
        pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6);
      }
      t.mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
      t.mat.setVector4('trailParams', new Vector4(t.palette, Math.max(0, t.fade), t.spark ? 1 : 0, this.time));
      t.mat.setVector4('trailParams2', new Vector4(t.seed, 0, 0, 0));
    }
  }

  clear(): void {
    for (const t of this.pool) {
      t.active = false;
      t.fade = 0;
      t.mesh.setEnabled(false);
    }
  }
}
