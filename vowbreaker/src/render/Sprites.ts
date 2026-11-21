import { Buffer, Constants, Mesh, Scene, ShaderLanguage, ShaderMaterial, Vector3, VertexData } from '@babylonjs/core';

export const SK = {
  starburst: 0, ring: 1, flare: 2, seal: 3, smoke: 4, glyph: 5, slash: 6, bolt: 7, crane: 8, lantern: 9, orb: 10, talisman: 11,
  dust: 12, streak: 13, fire: 14, drop: 15, ripple: 16, moon: 17, gravity: 18,
} as const;

export interface SpriteSpec {
  kind: number;
  pos: Vector3;
  size: number;
  color: [number, number, number];
  intensity?: number;
  life: number;
  rot?: number;
  seed?: number;
  dir?: Vector3;
  /** 0 billboard, 1 ground, 2 ribbon pos -> pos + dir, 3 vertical card facing dir */
  mode?: number;
  /** follow a moving point (projectile visuals) */
  follow?: () => Vector3 | null;
  grow?: number;
  vel?: Vector3;
}

interface Live extends SpriteSpec {
  age: number;
  id: number;
}

const MAX = 512;

/** One instanced batch of procedural effect sprites (additive or alpha blended). */
class Batch {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  private data = new Float32Array(MAX * 16);
  private buffer: Buffer;
  count = 0;

  constructor(scene: Scene, readonly additive: boolean) {
    this.mesh = new Mesh(additive ? 'fxGlow' : 'fxMatter', scene);
    const vd = new VertexData();
    vd.positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0];
    vd.indices = [0, 1, 2, 0, 2, 3];
    vd.applyToMesh(this.mesh);
    const engine = scene.getEngine();
    this.buffer = new Buffer(engine, this.data, true, 16, false, true);
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('s0', 0, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('s1', 4, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('s2', 8, 4));
    this.mesh.setVerticesBuffer(this.buffer.createVertexBuffer('s3', 12, 4));
    this.mat = new ShaderMaterial('spriteMat' + (additive ? 'G' : 'M'), scene, { vertex: 'sprite', fragment: 'sprite' }, {
      attributes: ['position', 's0', 's1', 's2', 's3'],
      uniforms: ['viewProjection', 'view', 'cameraPosition', 'time'],
      defines: additive ? ['GLOW'] : [],
      shaderLanguage: ShaderLanguage.WGSL,
      needAlphaBlending: true,
    });
    this.mat.backFaceCulling = false;
    this.mat.disableDepthWrite = true;
    this.mat.alphaMode = additive ? Constants.ALPHA_ONEONE : Constants.ALPHA_COMBINE;
    this.mesh.material = this.mat;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.isPickable = false;
    this.mesh.forcedInstanceCount = 0;
    this.mesh.renderingGroupId = 1;
  }

  write(list: Live[], time: number): void {
    const d = this.data;
    let n = 0;
    for (const s of list) {
      if (n >= MAX) break;
      const o = n * 16;
      const life = Math.max(s.life, 1e-3);
      const grow = s.grow ? 1 + (s.age / life) * s.grow : 1;
      d[o] = s.pos.x;
      d[o + 1] = s.pos.y;
      d[o + 2] = s.pos.z;
      d[o + 3] = s.size * grow;
      d[o + 4] = s.color[0];
      d[o + 5] = s.color[1];
      d[o + 6] = s.color[2];
      d[o + 7] = s.intensity ?? 1;
      d[o + 8] = s.kind;
      d[o + 9] = s.age / life;
      d[o + 10] = s.rot ?? 0;
      d[o + 11] = s.seed ?? 0;
      const dir = s.dir;
      d[o + 12] = dir ? dir.x : 0;
      d[o + 13] = dir ? dir.y : 0;
      d[o + 14] = dir ? dir.z : 0;
      d[o + 15] = s.mode ?? 0;
      n++;
    }
    this.count = n;
    this.buffer.update(d);
    this.mesh.forcedInstanceCount = n;
    this.mesh.setEnabled(n > 0);
    this.mat.setFloat('time', time);
  }
}

/** Procedural effect sprites: two batches, light (additive) and matter (alpha). */
export class Sprites {
  private glow: Batch;
  private matter: Batch;
  private live: Live[] = [];
  private nextId = 1;
  time = 0;

  constructor(scene: Scene) {
    this.glow = new Batch(scene, true);
    this.matter = new Batch(scene, false);
  }

  static isMatter(kind: number): boolean {
    return kind === SK.smoke || kind === SK.glyph || kind === SK.crane || kind === SK.talisman || kind === SK.dust || kind === SK.drop;
  }

  spawn(s: SpriteSpec): number {
    const l: Live = { ...s, pos: s.pos.clone(), age: 0, id: this.nextId++, seed: s.seed ?? Math.random() };
    this.live.push(l);
    return l.id;
  }

  kill(id: number): void {
    const l = this.live.find((x) => x.id === id);
    if (l) l.age = l.life;
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.live) {
      s.age += dt;
      if (s.follow) {
        const p = s.follow();
        if (p) s.pos.copyFrom(p);
        else s.age = s.life;
      }
      if (s.vel) s.pos.addInPlace(s.vel.scale(dt));
    }
    this.live = this.live.filter((s) => s.age < s.life);
    const glow: Live[] = [];
    const matter: Live[] = [];
    for (const s of this.live) (Sprites.isMatter(s.kind) ? matter : glow).push(s);
    this.glow.write(glow, this.time);
    this.matter.write(matter, this.time);
  }

  clear(): void {
    this.live = [];
  }
}
