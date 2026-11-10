// A stage: the arena model, its sky and image-based light, lamps, fog, weather and reflections.
// Arenas are built by tools/blender/build_stages.py; lighting moods for them are listed in STAGES.
import {
  AbstractMesh, AssetContainer, Color3, DynamicTexture, HemisphericLight, Light, LoadAssetContainerAsync, Mesh, MeshBuilder, MirrorTexture, PBRMaterial, Plane, PointLight,
  SpotLight, StandardMaterial, Texture, Vector3, Vector4,
} from '@babylonjs/core';
import { aimKey, Gfx, setEnvironment } from './gfx';
import { hex, libTexture, plugin, useSet } from './matlib';
import { effectMaterial, NOISE } from './sl';
import { SurfacePlugin, surfaceGlobals } from './surface';

type V3 = [number, number, number];
export interface Lamp { pos: V3; color: string; level: number; range: number; aim?: V3; angle?: number }
export interface StageDef {
  /** arena model in assets/stages, or '' for a bare floor */ glb: string;
  env: string; envLevel: number; envRot?: number;
  /** equirect picture behind everything */ sky?: string; skyLevel?: number; skyRot?: number;
  key: { dir: V3; color: string; level: number };
  /** soft light from above on everything (stands in for bounce the sky map cannot give a mirrored floor) */ fill: { sky: string; ground: string; level: number };
  lamps?: Lamp[];
  fog: [string, number];
  rim: [string, number];
  exposure: number; contrast?: number; bloom?: number;
  wet?: number; rain?: number; /** floor reflection strength */ mirror?: number;
  beds?: Record<string, number>;
  /** how far the camera may travel sideways */ bound?: number;
}

const ROOF_KEY: V3 = [-0.35, -0.8, -0.45];
export const STAGES: Record<string, StageDef> = {
  test: { glb: '', env: 'studio', envLevel: 0.8, key: { dir: [-0.45, -1, -0.6], color: '#fff4e6', level: 3 }, fill: { sky: '#8090a8', ground: '#403830', level: 0.3 },
          fog: ['#101216', 0.004], rim: ['#88aaff', 0.6], exposure: 1.0 },
  gym_dusk: { glb: 'gym', env: 'gym', envLevel: 0.55, key: { dir: [0.75, -0.62, -0.5], color: '#ffb072', level: 5.2 }, fill: { sky: '#ffcfa0', ground: '#5a3a28', level: 0.5 },
              lamps: [{ pos: [-3.2, 3.3, -1.5], color: '#ffd9a8', level: 16, range: 9 }, { pos: [3.4, 3.3, -1.5], color: '#ffd9a8', level: 14, range: 9 }],
              fog: ['#3a2a20', 0.012], rim: ['#ffb070', 0.9], exposure: 1.05, contrast: 1.12, bloom: 0.45, mirror: 0.25, beds: { room: 0.5 } },
  gym_dawn: { glb: 'gym', env: 'gym', envLevel: 0.7, key: { dir: [-0.7, -0.5, -0.55], color: '#ffe2c0', level: 5.5 }, fill: { sky: '#ffe8d0', ground: '#6a4a38', level: 0.7 },
              lamps: [{ pos: [0, 3.3, -1.5], color: '#fff0dc', level: 8, range: 10 }],
              fog: ['#544438', 0.01], rim: ['#ffe0b0', 1.0], exposure: 1.15, contrast: 1.06, bloom: 0.5, mirror: 0.25, beds: { room: 0.4 } },
  roof_rain: { glb: 'roof', env: 'roof_night', envLevel: 0.5, sky: 'roof_night', skyLevel: 0.55, key: { dir: ROOF_KEY, color: '#9db8ff', level: 2.6 },
               fill: { sky: '#3a4a70', ground: '#181a22', level: 0.35 },
               lamps: [{ pos: [-6.5, 4.2, -3.2], color: '#ff9a4a', level: 60, range: 16, aim: [-1, 0, 0.5], angle: 1.1 }, { pos: [6.8, 4.4, -2.8], color: '#6fb6ff', level: 55, range: 16, aim: [1.5, 0, 0.5], angle: 1.1 },
                       { pos: [0.5, 2.6, -4.6], color: '#ff3b5c', level: 9, range: 9 }],
               fog: ['#141a26', 0.022], rim: ['#7fb0ff', 1.3], exposure: 1.0, contrast: 1.16, bloom: 0.6, wet: 1, rain: 1, mirror: 0.75, beds: { rain: 0.5, wind: 0.2 } },
  roof_storm: { glb: 'roof', env: 'roof_night', envLevel: 0.38, sky: 'roof_night', skyLevel: 0.35, key: { dir: ROOF_KEY, color: '#8aa6ff', level: 2.0 },
                fill: { sky: '#2c3858', ground: '#14161c', level: 0.3 },
                lamps: [{ pos: [-6.5, 4.2, -3.2], color: '#ff8a3a', level: 50, range: 16, aim: [-1, 0, 0.5], angle: 1.1 }, { pos: [6.8, 4.4, -2.8], color: '#5fa6ff', level: 45, range: 16, aim: [1.5, 0, 0.5], angle: 1.1 }],
                fog: ['#10141e', 0.028], rim: ['#9fc0ff', 1.5], exposure: 0.95, contrast: 1.2, bloom: 0.65, wet: 1, rain: 1.6, mirror: 0.8, beds: { rain: 0.7, wind: 0.45 } },
  roof_dawn: { glb: 'roof', env: 'roof_dawn', envLevel: 0.9, sky: 'roof_dawn', skyLevel: 1.0, skyRot: 0.2, key: { dir: [0.82, -0.3, -0.48], color: '#ffc890', level: 5.5 },
               fill: { sky: '#b8c8e8', ground: '#4a4040', level: 0.5 },
               fog: ['#c9a890', 0.008], rim: ['#ffd0a0', 1.4], exposure: 1.1, contrast: 1.08, bloom: 0.55, wet: 0.8, rain: 0, mirror: 0.7, beds: { wind: 0.25 } },
  pit_blue: { glb: 'pit', env: 'pit', envLevel: 0.16, key: { dir: [-0.2, -1, -0.25], color: '#cfe2ff', level: 5.0 }, fill: { sky: '#2a3a4a', ground: '#101214', level: 0.25 },
              lamps: [{ pos: [-4.5, 5.2, 1.5], color: '#4fd0d8', level: 90, range: 14, aim: [-1, 0, 0], angle: 0.9 }, { pos: [4.5, 5.2, 1.5], color: '#4fd0d8', level: 90, range: 14, aim: [1, 0, 0], angle: 0.9 },
                      { pos: [0, 3.2, -5.4], color: '#ffb060', level: 12, range: 10 }],
              fog: ['#0a1014', 0.03], rim: ['#58d8e0', 1.5], exposure: 1.0, contrast: 1.2, bloom: 0.6, wet: 0.25, mirror: 0.35, beds: { crowd: 0.5, room: 0.4 } },
  pit_red: { glb: 'pit', env: 'pit', envLevel: 0.12, key: { dir: [0.15, -1, -0.2], color: '#ffe4c8', level: 5.6 }, fill: { sky: '#3a2420', ground: '#120c0c', level: 0.22 },
             lamps: [{ pos: [-4.5, 5.2, 1.5], color: '#ff4a32', level: 100, range: 14, aim: [-1, 0, 0], angle: 0.9 }, { pos: [4.5, 5.2, 1.5], color: '#ff7a3a', level: 90, range: 14, aim: [1, 0, 0], angle: 0.9 },
                     { pos: [0, 3.2, -5.4], color: '#ffb060', level: 10, range: 10 }],
             fog: ['#140a08', 0.034], rim: ['#ff6a40', 1.6], exposure: 1.0, contrast: 1.24, bloom: 0.65, wet: 0.25, mirror: 0.35, beds: { crowd: 0.65, room: 0.4 } },
};

const BEAM_V = `
attribute position: V3;
attribute normal: V3;
attribute uv: V2;
uniform world: M4;
uniform worldViewProjection: M4;
varying vN: V3;
varying vP: V3;
varying vUV: V2;
@vertex {
  OUT.position = U.worldViewProjection * V4(A.position, 1.0);
  OUT.vP = (U.world * V4(A.position, 1.0)).xyz;
  OUT.vN = (U.world * V4(A.normal, 0.0)).xyz;
  OUT.vUV = A.uv;
}`;
// a cone of light in dusty air: bright where you look along it, fading down its length, with drifting motes
const BEAM_F = NOISE + `
varying vN: V3;
varying vP: V3;
varying vUV: V2;
uniform eye: V3;
uniform tint: V4;
uniform time: F;
@fragment {
  let v: V3 = normalize(U.eye - IN.vP);
  let facing: F = abs(dot(normalize(IN.vN), v));
  let fall: F = pow(saturate(1.0 - IN.vUV.y), 1.6);
  let dustn: F = 0.65 + 0.35 * tbFbm(IN.vP.xy * 1.4 + V2(U.time * 0.05, -U.time * 0.11) + IN.vP.z);
  let a: F = pow(facing, 2.2) * fall * dustn * U.tint.a;
  COLOR = V4(U.tint.rgb * a, a);
}`;

const SKY_V = `
attribute position: V3;
attribute uv: V2;
uniform worldViewProjection: M4;
varying vUV: V2;
@vertex {
  OUT.position = U.worldViewProjection * V4(A.position, 1.0);
  OUT.vUV = A.uv;
}`;
// two skies cross-faded (night into dawn) and a flash of lightning behind the clouds
const SKY_F = NOISE + `
varying vUV: V2;
sampler skyA;
sampler skyB;
uniform mixv: V4;
@fragment {
  let a: V3 = TEX(skyA, IN.vUV).rgb;
  let b: V3 = TEX(skyB, IN.vUV).rgb;
  var c: V3 = mix(a * a * U.mixv.y, b * b * U.mixv.z, U.mixv.x);
  let cloud: F = tbFbm(IN.vUV * V2(18.0, 9.0)) * smoothstep(0.42, 0.8, IN.vUV.y);
  c += V3(0.75, 0.85, 1.0) * U.mixv.w * (0.35 + 2.4 * cloud);
  COLOR = V4(c, 1.0);
}`;

export class Stage {
  def: StageDef;
  private c: AssetContainer | null = null;
  private lights: Light[] = [];
  private extra: { dispose(): void }[] = [];
  private mirror: MirrorTexture | null = null;
  private ground: AbstractMesh[] = [];
  private plugins: SurfacePlugin[] = [];
  private sky: Mesh | null = null;
  /** lightning: 1 at the strike, decays */ bolt = 0;
  /** the crowd jumps: set to 1 on a big hit */ cheer = 0;
  /** 0 the stage's own sky .. 1 the second sky (see dawn()) */ skyMix = 0;
  private skyLevels = [1, 1];
  private time = 0;
  private beams: { tint: [number, number, number, number]; set(t: number, eye: Vector3): void }[] = [];

  private constructor(private g: Gfx, public id: string) { this.def = STAGES[id]; }

  static async load(g: Gfx, id: string): Promise<Stage> {
    const s = new Stage(g, id);
    await s.build();
    return s;
  }

  private async build() {
    const { g, def } = this;
    const scene = g.scene;
    const env = setEnvironment(g, `assets/env/${def.env}.hdr`, def.envLevel, def.envRot ?? 0);
    if (def.glb) {
      const c = this.c = await LoadAssetContainerAsync(`assets/stages/${def.glb}.glb`, scene);
      const ao = new Texture(`assets/stages/${def.glb}_ao.webp`, scene, false, false);
      ao.coordinatesIndex = 1;
      for (const m of c.materials) if (m instanceof PBRMaterial) this.material(m, ao);
      for (const m of c.meshes) {
        m.receiveShadows = true;
        m.freezeWorldMatrix();
        if (m.name === 'sky') continue;
        if (m.material && plugin(m.material)?.kind === 'ground') this.ground.push(m);
      }
      c.addAllToScene();
    } else {
      const floor = MeshBuilder.CreateGround('floor', { width: 60, height: 40 }, scene);
      const m = new PBRMaterial('floor', scene);
      m.albedoColor = new Color3(0.16, 0.16, 0.17); m.roughness = 0.55; m.metallic = 0;
      this.plugins.push(Object.assign(new SurfacePlugin(m, 'ground'), { porous: 1, sheen: 1, rim: 0 }));
      floor.material = m; floor.receiveShadows = true;
      this.ground.push(floor); this.extra.push(floor, m);
    }
    if (def.sky) this.makeSky(def.sky, def.skyLevel ?? 1, def.skyRot ?? 0);
    aimKey(g, new Vector3(...def.key.dir), new Vector3(0, 1, 0), 5.5);
    g.key.diffuse = hex(def.key.color); g.key.specular = hex(def.key.color); g.key.intensity = def.key.level;
    const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), scene);
    fill.diffuse = hex(def.fill.sky); fill.groundColor = hex(def.fill.ground); fill.specular = Color3.Black(); fill.intensity = def.fill.level;
    this.lights.push(fill);
    for (const [i, l] of (def.lamps ?? []).entries()) {
      const p = new Vector3(...l.pos);
      const light = l.aim ? new SpotLight('lamp' + i, p, new Vector3(...l.aim).subtract(p).normalize(), l.angle ?? 1, 1.5, scene) : new PointLight('lamp' + i, p, scene);
      light.diffuse = hex(l.color); light.specular = hex(l.color); light.intensity = l.level; light.range = l.range;
      light.falloffType = Light.FALLOFF_PHYSICAL;
      this.lights.push(light);
    }
    scene.fogMode = 2; // exponential squared
    scene.fogColor = hex(def.fog[0]); scene.fogDensity = def.fog[1];
    scene.clearColor = hex(def.fog[0]).toColor4(1);
    scene.imageProcessingConfiguration.exposure = def.exposure;
    scene.imageProcessingConfiguration.contrast = def.contrast ?? 1.1;
    g.pipe.bloomWeight = def.bloom ?? 0.35;
    surfaceGlobals.wet = def.wet ?? 0;
    surfaceGlobals.rim = hex(def.rim[0]).scale(def.rim[1]);
    if (def.mirror && g.tier.mirror && this.ground.length) this.makeMirror(def.mirror);
    await env;
  }

  /** arena materials: texture sets from the library, baked occlusion on the second UV set, glow for lamps and signs */
  private material(m: PBRMaterial, ao: Texture) {
    const scene = this.g.scene;
    const raw = m.metadata?.gltf?.extras?.tb;
    const tag = raw ? JSON.parse(raw) : { k: 'pbr' };
    if (tag.k === 'beam') { this.beam(m, tag); return; }
    if (tag.k === 'crowd') { this.crowd(m); return; }
    if (tag.img) { m.albedoTexture = libTexture(scene, tag.img, tag.s ?? 1); m.albedoTexture.hasAlpha = !!tag.cut; m.roughness = tag.r ?? 0.6; m.metallic = tag.m ?? 0; }
    if (tag.eimg) { m.emissiveTexture = libTexture(scene, tag.eimg, tag.s ?? 1); m.emissiveColor = Color3.White().scale(tag.ei ?? 2); m.albedoColor = hex(tag.c ?? '#050505'); m.roughness = 0.8; m.metallic = 0; }
    else if (tag.t) useSet(m, scene, tag.t, tag.s ?? 1, tag.c ? hex(tag.c) : Color3.White(), tag.r ?? 1, tag.m ?? 0);
    else { if (tag.c) m.albedoColor = hex(tag.c); m.roughness = tag.r ?? 0.6; m.metallic = tag.m ?? 0; }
    if (tag.e) { m.emissiveColor = hex(tag.e).scale(tag.ei ?? 4); m.emissiveIntensity = 1; if (tag.c) m.albedoColor = hex(tag.c); }
    else if (!tag.noao) { m.ambientTexture = ao; m.ambientTextureStrength = 1.0; m.useAmbientInGrayScale = true; }
    if (tag.alpha) { m.alpha = tag.alpha; m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND; }
    if (tag.cut) { m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHATEST; m.alphaCutOff = 0.5; m.useAlphaFromAlbedoTexture = true; m.backFaceCulling = false; }
    m.maxSimultaneousLights = 6;
    const p = new SurfacePlugin(m, tag.g ? 'ground' : 'hard');
    p.porous = tag.porous ?? (tag.m ? 0 : 1); p.sheen = tag.sheen ?? 1; p.rim = 0;
    this.plugins.push(p);
  }

  /** the crowd: rows of dark heads and shoulders behind the fence, a few phones alight, swaying a little */
  private crowd(m: PBRMaterial) {
    const scene = this.g.scene;
    const t = new DynamicTexture('crowd', { width: 1024, height: 256 }, scene, true);
    const c = t.getContext() as unknown as CanvasRenderingContext2D;
    c.clearRect(0, 0, 1024, 256);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let row = 0; row < 2; row++) for (let i = 0; i < 26; i++) {
      const x = (i + rnd() * 0.7) * 40 + row * 20, h = 150 + rnd() * 60 - row * 30, w = 30 + rnd() * 12;
      const shade = 10 + Math.floor(rnd() * 14) + row * 8;
      c.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
      c.beginPath(); c.ellipse(x, 256 - h, w * 0.36, w * 0.44, 0, 0, 7); c.fill();                 // head
      c.beginPath(); c.moveTo(x - w * 0.95, 256); c.quadraticCurveTo(x - w * 0.9, 256 - h + w * 0.55, x, 256 - h + w * 0.42);
      c.quadraticCurveTo(x + w * 0.9, 256 - h + w * 0.55, x + w * 0.95, 256); c.fill();           // shoulders
      if (rnd() < 0.12) { c.fillStyle = 'rgb(190,215,255)'; c.fillRect(x + w * 0.5, 256 - h - 10 - rnd() * 30, 5, 9); }
    }
    t.update(false);
    t.hasAlpha = true;
    t.wrapU = Texture.WRAP_ADDRESSMODE;
    const mat = new StandardMaterial('crowd', scene);
    mat.diffuseTexture = t; mat.emissiveTexture = t; mat.emissiveColor = new Color3(0.9, 0.9, 0.9);
    mat.disableLighting = true; mat.useAlphaFromDiffuseTexture = true; mat.backFaceCulling = false;
    mat.transparencyMode = 1; mat.alphaCutOff = 0.5;
    for (const mesh of this.c!.meshes) if (mesh.material === m) { mesh.material = mat; mesh.receiveShadows = false; mesh.unfreezeWorldMatrix(); this.swayers.push(mesh); }
    this.extra.push(mat, t);
  }
  private swayers: AbstractMesh[] = [];

  private beam(m: PBRMaterial, tag: { c?: string; a?: number }) {
    const mat = effectMaterial(this.g.scene, 'tbBeam' + this.beams.length, BEAM_V, BEAM_F, ['eye', 'tint', 'time']);
    mat.alphaMode = 1; // additive
    mat.backFaceCulling = false; mat.disableDepthWrite = true;
    const col = hex(tag.c ?? '#ffffff');
    const b = { tint: [col.r, col.g, col.b, tag.a ?? 0.5] as [number, number, number, number], set: (t: number, eye: Vector3) => { mat.setFloat('time', t); mat.setVector3('eye', eye); mat.setVector4('tint', new Vector4(...b.tint)); } };
    b.set(0, Vector3.Zero());
    this.beams.push(b);
    for (const mesh of this.c!.meshes) if (mesh.material === m) { mesh.material = mat; mesh.receiveShadows = false; }
    this.extra.push(mat);
  }

  private makeSky(tex: string, level: number, rot: number) {
    const scene = this.g.scene;
    const sky = this.sky = MeshBuilder.CreateSphere('sky', { diameter: 900, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
    const mat = effectMaterial(scene, 'tbSky', SKY_V, SKY_F, ['mixv'], ['skyA', 'skyB'], false);
    const a = new Texture(`assets/env/${tex}_sky.webp`, scene, true, true);
    mat.setTexture('skyA', a); mat.setTexture('skyB', a);
    mat.backFaceCulling = false; mat.fogEnabled = false;
    sky.material = mat; sky.rotation.y = rot; sky.infiniteDistance = true; sky.applyFog = false; sky.isPickable = false;
    this.skyLevels = [level, level];
    this.extra.push(sky, mat, a);
  }

  /** second sky to fade towards with skyMix (the night turning to morning) */
  dawn(tex: string, level: number) {
    const b = new Texture(`assets/env/${tex}_sky.webp`, this.g.scene, true, true);
    (this.sky!.material as ReturnType<typeof effectMaterial>).setTexture('skyB', b);
    this.skyLevels[1] = level;
    this.extra.push(b);
  }

  private makeMirror(level: number) {
    const scene = this.g.scene;
    const mirror = this.mirror = new MirrorTexture('mirror', this.g.tier.mirror, scene, true);
    mirror.mirrorPlane = new Plane(0, -1, 0, 0);
    mirror.level = level;
    mirror.adaptiveBlurKernel = 14;
    mirror.renderList = null;
    mirror.renderListPredicate = (m) => !this.ground.includes(m) && m.name !== 'sky' && m.isEnabled();
    for (const gm of this.ground) (gm.material as PBRMaterial).reflectionTexture = mirror;
  }

  /** Apply another mood of the same arena at once (lighting, fog, weather). The model stays. */
  mood(id: string) {
    this.id = id; this.def = STAGES[id];
    for (const l of this.lights) l.dispose();
    this.lights = [];
    const g = this.g, def = this.def;
    g.key.diffuse = hex(def.key.color); g.key.specular = hex(def.key.color); g.key.intensity = def.key.level;
    aimKey(g, new Vector3(...def.key.dir), new Vector3(0, 1, 0), 5.5);
    const fill = new HemisphericLight('fill', new Vector3(0, 1, 0), g.scene);
    fill.diffuse = hex(def.fill.sky); fill.groundColor = hex(def.fill.ground); fill.specular = Color3.Black(); fill.intensity = def.fill.level;
    this.lights.push(fill);
    for (const [i, l] of (def.lamps ?? []).entries()) {
      const p = new Vector3(...l.pos);
      const light = l.aim ? new SpotLight('lamp' + i, p, new Vector3(...l.aim).subtract(p).normalize(), l.angle ?? 1, 1.5, g.scene) : new PointLight('lamp' + i, p, g.scene);
      light.diffuse = hex(l.color); light.specular = hex(l.color); light.intensity = l.level; light.range = l.range; light.falloffType = Light.FALLOFF_PHYSICAL;
      this.lights.push(light);
    }
    g.scene.fogColor = hex(def.fog[0]); g.scene.fogDensity = def.fog[1]; g.scene.clearColor = hex(def.fog[0]).toColor4(1);
    g.scene.imageProcessingConfiguration.exposure = def.exposure; g.scene.imageProcessingConfiguration.contrast = def.contrast ?? 1.1;
    g.pipe.bloomWeight = def.bloom ?? 0.35;
    surfaceGlobals.wet = def.wet ?? 0; surfaceGlobals.rim = hex(def.rim[0]).scale(def.rim[1]);
    g.scene.environmentIntensity = def.envLevel;
    if (this.mirror) this.mirror.level = def.mirror ?? 0;
    void setEnvironment(g, `assets/env/${def.env}.hdr`, def.envLevel, def.envRot ?? 0);
  }

  update(dt: number, focus: Vector3) {
    this.time += dt;
    surfaceGlobals.time = this.time;
    const g = this.g;
    // the shadow box follows the fight, in whole texels so the edges do not swim
    const step = 11 / g.tier.shadow * 4;
    aimKey(g, g.key.direction, new Vector3(Math.round(focus.x / step) * step, 1, 0), 5.5);
    this.bolt = Math.max(0, this.bolt - dt * 3.2);
    const flash = this.bolt * this.bolt;
    g.key.intensity = this.def.key.level * (1 + 9 * flash);
    if (this.sky) {
      (this.sky.material as ReturnType<typeof effectMaterial>).setVector4('mixv', new Vector4(this.skyMix, this.skyLevels[0], this.skyLevels[1], flash));
    }
    for (const b of this.beams) b.set(this.time, g.camera.position);
    this.swayers.forEach((m, i) => { m.position.y = 0.035 * Math.sin(this.time * (1.7 + i * 0.37) + i * 2.1) + this.cheer * 0.12 * Math.abs(Math.sin(this.time * 9 + i)); });
    this.cheer = Math.max(0, this.cheer - dt * 1.2);
  }

  dispose() {
    for (const l of this.lights) l.dispose();
    for (const e of this.extra) e.dispose();
    this.mirror?.dispose();
    this.c?.dispose();
    this.g.scene.environmentTexture?.dispose();
    libTexture; // textures of the shared library stay cached for the next stage
  }
}
