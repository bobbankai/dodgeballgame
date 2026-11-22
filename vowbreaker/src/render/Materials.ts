import type { GroundMarks } from './Marks';
import {
  AbstractMesh, BaseTexture, Color3, Constants, Matrix, Mesh, RawTexture, Scene, ShaderLanguage, ShaderMaterial, Vector2, Vector3, Vector4,
} from '@babylonjs/core';

/** Everything lighting-related that every material shares; the Renderer fills it once per frame. */
export class Lighting {
  sunDir = new Vector3(-0.4, 0.75, -0.5).normalize();
  sunColor = new Color3(1.0, 0.95, 0.88);
  skyColor = new Color3(0.32, 0.38, 0.55);
  groundColor = new Color3(0.16, 0.14, 0.13);
  shadowColor = new Color3(0.42, 0.45, 0.72);
  rimColor = new Color3(0.55, 0.7, 1.0);
  fogColor = new Color3(0.4, 0.45, 0.6);
  time = 0;
  /** up to 4 coloured point lights (cursed energy, lanterns): xyz/range, rgb/intensity */
  pointPos = new Float32Array(16);
  pointCol = new Float32Array(16);
  lightViewProj = Matrix.Identity();
  shadowMap: BaseTexture | null = null;
  shadowSize = 2048;
  shadowBias = 0.0015;
  shadowRadius = 1.5;
  shadowsOn = 1;
  domainAmount = 0;
  domainPalette = 0;
  /** pattern-shader extras: rain wetness 0..1, wind, puddles */
  wetness = 0;
  windDir = new Vector3(1, 0, 0.3);
  /** the wind characters' hems and hair feel (strength, m/s-ish) */
  windStrength = 1;
  /** what a fighter's nature does to the place (vb_env_transform): kind (1 paper, 2 stillness, 3 spark), amount, radius, seed */
  envTransform = new Vector4(0, 0, 0, 0);
  /** its centre and the time it began */
  envTransformPos = new Vector4(0, 0, 0, 0);
  /** set while the story holds a transformation (fight effects leave it alone) */
  envTransformLock = false;
  /** the cutscene light rig (vb_cine_light, 6 vec4s; amount 0 = off) */
  cine = new Float32Array(24);

  setPoint(i: number, pos: Vector3, range: number, color: Color3, intensity: number): void {
    this.pointPos.set([pos.x, pos.y, pos.z, range], i * 4);
    this.pointCol.set([color.r, color.g, color.b, intensity], i * 4);
  }

  clearPoints(): void {
    this.pointPos.fill(0);
    this.pointCol.fill(0);
  }
}

const TOON_UNIFORMS = [
  'world', 'viewProjection', 'view', 'cameraPosition', 'squash', 'pivot',
  'sunDir', 'sunColor', 'skyColor', 'groundColor', 'shadowColor', 'rimColor',
  'tint', 'flash', 'toonParams', 'toonParams2', 'energy', 'headRight', 'headUp', 'headForward',
  'lightViewProj', 'shadowParams', 'pointPos', 'pointCol', 'domainParams', 'surface', 'surface2', 'heights', 'curse', 'cine', 'wind', 'motion', 'smear', 'smearVel', 'eyeL', 'eyeR', 'eyeState', 'faceFx', 'faceFx2',
];

/** Per-character shading state, written by the fighter every frame and pushed to its materials. */
export class CharacterLook {
  tint = new Vector4(1, 1, 1, 1);
  flash = new Vector4(1, 1, 1, 0);
  /** x aura, y palette id, z vow, w dissolve */
  energy = new Vector4(0, 0, 0, 0);
  squash = new Vector4(1, 1, 1, 0);
  pivot = new Vector4(0, 0, 0, 0);
  headRight = new Vector3(1, 0, 0);
  headUp = new Vector3(0, 1, 0);
  headForward = new Vector3(0, 0, 1);
  /** threshold, softness, ao influence, rim */
  toon = new Vector4(0.5, 0.012, 0.45, 0.85);
  /** specular, hair ring strength, emissive boost */
  toon2 = new Vector4(1, 1, 0.5, 0);
  outlineWidth = 2.2;
  lineColor = new Vector4(0, 0, 0, 0);
  /** x wet (rain), y dust, z battle damage, w sweat */
  surface = new Vector4(0, 0, 0, 0);
  /** x paper creep (Shiragami), y memory (flashback drawing), z Black Spark crackle, w Stillwater */
  surface2 = new Vector4(0, 0, 0, 0);
  /** x figure height, y head height (object space), z hurt rim, w empty eyes */
  heights = new Vector4(1.7, 1.55, 0, 0);
  /** x curse surface kind (vb_toon_curse: 1 mud, 2 umbrella, 3 ghost, 4 paper, 5 acolyte) */
  curse = new Vector4(0, 0, 0, 0);
  /** x, z world velocity (smoothed), speed: hems and hair trail behind it */
  motion = new Vector4(0, 0, 0, 0);
  /** a striking limb smeared along its path: bone (world) and reach, velocity and amount */
  smear = new Vector4(0, 0, 0, 0);
  smearVel = new Vector4(0, 0, 0, 0);
  /** the eyes' centres (world) and iris radius (w 0 = unknown) */
  eyeL = new Vector4(0, 0, 0, 0);
  eyeR = new Vector4(0, 0, 0, 0);
  /** pupil size (0 pinprick .. 1 wide), sparkle (0..1) */
  eyeState = new Vector4(0.5, 0, 0, 0);
  /** expression marks: blush, gloom over the eyes, anger mark, sweat drop (0..1) */
  faceFx = new Vector4(0, 0, 0, 0);
  /** x pallor */
  faceFx2 = new Vector4(0, 0, 0, 0);
}

/** glTF models sit under a mirrored root (right- to left-handed): their triangles wind the other way. */
export function isMirrored(mesh: AbstractMesh): boolean {
  return mesh.computeWorldMatrix(true).determinant() < 0;
}

function attributesFor(mesh: AbstractMesh): { attributes: string[]; defines: string[] } {
  const attributes = ['position', 'normal'];
  const defines: string[] = [];
  if (mesh.isVerticesDataPresent('uv')) {
    attributes.push('uv');
    defines.push('UV1');
  }
  if (mesh.isVerticesDataPresent('uv2')) {
    attributes.push('uv2');
    defines.push('UV2');
  }
  return { attributes, defines };
}

/**
 * Creates and keeps track of the game's materials so the shared lighting state reaches all of them.
 * Every material here is a WGSL ShaderMaterial built from src/shaders.
 */
export class Materials {
  private toons: { mat: ShaderMaterial; look: CharacterLook }[] = [];
  private outlines: { mat: ShaderMaterial; look: CharacterLook }[] = [];
  private envs: ShaderMaterial[] = [];
  private custom: ((l: Lighting) => void)[] = [];
  readonly dummy: RawTexture;
  /** the fight's scars on the floor, read by every environment material (src/render/Marks.ts) */
  marks: GroundMarks | null = null;
  screenW = 1280;
  screenH = 720;

  constructor(readonly scene: Scene, readonly lighting: Lighting) {
    // half float, so the binding type matches the real shadow map (filterable float)
    this.dummy = new RawTexture(new Uint16Array([0x3c00, 0x3c00, 0x3c00, 0x3c00]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false,
      Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  }

  toon(mesh: AbstractMesh, look: CharacterLook): ShaderMaterial {
    const { attributes, defines } = attributesFor(mesh);
    const mat = new ShaderMaterial('toon_' + mesh.name, this.scene, { vertex: 'toon', fragment: 'toon' }, {
      attributes, defines, uniforms: TOON_UNIFORMS.slice(), samplers: ['shadowMap'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    mat.backFaceCulling = true;
    mat.setTexture('shadowMap', this.lighting.shadowMap ?? this.dummy);
    this.toons.push({ mat, look });
    this.pushToon(mat, look);
    mat.onDisposeObservable.addOnce(() => { this.toons = this.toons.filter((t) => t.mat !== mat); });
    return mat;
  }

  outline(mesh: AbstractMesh, look: CharacterLook): ShaderMaterial {
    const { attributes, defines } = attributesFor(mesh);
    const mat = new ShaderMaterial('outline_' + mesh.name, this.scene, { vertex: 'outline', fragment: 'outline' }, {
      attributes: attributes.filter((a) => a !== 'uv2'), defines: defines.filter((d) => d !== 'UV2'),
      uniforms: ['world', 'viewProjection', 'view', 'squash', 'pivot', 'outlineParams', 'screenSize', 'tint', 'flash', 'energy', 'lineColor', 'heights', 'wind', 'motion', 'smear', 'smearVel', 'sunDir', 'cameraPosition'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    mat.backFaceCulling = true;
    mat.cullBackFaces = false;
    this.outlines.push({ mat, look });
    this.pushOutline(mat, look);
    mat.onDisposeObservable.addOnce(() => { this.outlines = this.outlines.filter((t) => t.mat !== mat); });
    return mat;
  }

  /** A depth-like pass material (shadow map or G-buffer) for one mesh. */
  depthPass(mesh: AbstractMesh, kind: 'shadowDepth' | 'gbuffer', objectId = 0, look?: CharacterLook): ShaderMaterial {
    const mat = new ShaderMaterial(`${kind}_${mesh.name}`, this.scene, { vertex: 'depthPass', fragment: kind }, {
      attributes: ['position', 'normal'], defines: [], uniforms: ['world', 'viewProjection', 'view', 'squash', 'pivot', 'objectId'],
      shaderLanguage: ShaderLanguage.WGSL,
    });
    mat.setFloat('objectId', objectId);
    mat.setVector4('squash', look ? look.squash : new Vector4(1, 1, 1, 0));
    mat.setVector4('pivot', look ? look.pivot : new Vector4(0, 0, 0, 0));
    if (look) {
      mat.onBindObservable.add(() => {
        mat.setVector4('squash', look.squash);
        mat.setVector4('pivot', look.pivot);
      });
    }
    mat.backFaceCulling = kind === 'gbuffer';
    return mat;
  }

  registerEnv(mat: ShaderMaterial): void {
    this.envs.push(mat);
    mat.onDisposeObservable.addOnce(() => { this.envs = this.envs.filter((m) => m !== mat); });
  }

  /** A callback run every frame with the lighting state (for custom materials: sky, water, VFX). */
  onUpdate(fn: (l: Lighting) => void): () => void {
    this.custom.push(fn);
    return () => { this.custom = this.custom.filter((f) => f !== fn); };
  }

  private pushToon(mat: ShaderMaterial, look: CharacterLook): void {
    const l = this.lighting;
    mat.setVector3('sunDir', l.sunDir);
    mat.setColor3('sunColor', l.sunColor);
    mat.setColor3('skyColor', l.skyColor);
    mat.setColor3('groundColor', l.groundColor);
    mat.setColor3('shadowColor', l.shadowColor);
    mat.setColor3('rimColor', l.rimColor);
    mat.setMatrix('lightViewProj', l.lightViewProj);
    mat.setVector4('shadowParams', new Vector4(l.shadowSize, l.shadowBias, l.shadowRadius, l.shadowMap ? l.shadowsOn : 0));
    mat.setArray4('pointPos', Array.from(l.pointPos));
    mat.setArray4('pointCol', Array.from(l.pointCol));
    mat.setVector4('domainParams', new Vector4(l.domainAmount, l.domainPalette, 0, 0));
    mat.setVector4('tint', look.tint);
    mat.setVector4('flash', look.flash);
    mat.setVector4('energy', look.energy);
    mat.setVector4('squash', look.squash);
    mat.setVector4('pivot', look.pivot);
    mat.setVector3('headRight', look.headRight);
    mat.setVector3('headUp', look.headUp);
    mat.setVector3('headForward', look.headForward);
    mat.setVector4('toonParams', look.toon);
    mat.setVector4('toonParams2', new Vector4(look.toon2.x, look.toon2.y, look.toon2.z, l.time));
    mat.setVector4('surface', look.surface);
    mat.setVector4('surface2', look.surface2);
    mat.setVector4('heights', look.heights);
    mat.setVector4('curse', look.curse);
    mat.setArray4('cine', Array.from(l.cine));
    mat.setVector4('wind', new Vector4(l.windDir.x, l.windDir.z, l.windStrength, l.time));
    mat.setVector4('motion', look.motion);
    mat.setVector4('smear', look.smear);
    mat.setVector4('smearVel', look.smearVel);
    mat.setVector4('eyeL', look.eyeL);
    mat.setVector4('eyeR', look.eyeR);
    mat.setVector4('eyeState', look.eyeState);
    mat.setVector4('faceFx', look.faceFx);
    mat.setVector4('faceFx2', look.faceFx2);
    if (l.shadowMap) mat.setTexture('shadowMap', l.shadowMap);
  }

  private pushOutline(mat: ShaderMaterial, look: CharacterLook): void {
    mat.setVector4('squash', look.squash);
    mat.setVector4('pivot', look.pivot);
    mat.setVector4('outlineParams', new Vector4(look.outlineWidth, 6.0, 0.00002, 0.35));
    mat.setVector2('screenSize', new Vector2(this.screenW, this.screenH));
    mat.setVector4('tint', look.tint);
    mat.setVector4('flash', look.flash);
    mat.setVector4('energy', look.energy);
    mat.setVector4('lineColor', look.lineColor);
    const l = this.lighting;
    mat.setVector4('heights', look.heights);
    mat.setVector4('wind', new Vector4(l.windDir.x, l.windDir.z, l.windStrength, l.time));
    mat.setVector4('motion', look.motion);
    mat.setVector4('smear', look.smear);
    mat.setVector4('smearVel', look.smearVel);
    mat.setVector3('sunDir', l.sunDir);
    mat.setVector3('cameraPosition', this.scene.activeCamera?.globalPosition ?? Vector3.Zero());
  }

  update(): void {
    for (const t of this.toons) this.pushToon(t.mat, t.look);
    for (const o of this.outlines) this.pushOutline(o.mat, o.look);
    for (const fn of this.custom) fn(this.lighting);
  }

  get envMaterials(): readonly ShaderMaterial[] {
    return this.envs;
  }
}

/** Make the inverted-hull outline twin of a mesh (shares geometry and skeleton). */
export function makeOutline(mats: Materials, mesh: Mesh, look: CharacterLook): Mesh {
  const twin = mesh.clone(mesh.name + '_ink', mesh.parent, true, false)!;
  twin.hasVertexAlpha = false;
  twin.material = mats.outline(mesh, look);
  twin.isPickable = false;
  twin.metadata = { ink: true };
  return twin;
}
