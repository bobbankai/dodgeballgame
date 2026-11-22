import {
  Camera, Color3, Constants, EffectRenderer, EffectWrapper, Engine, Matrix, RenderTargetTexture, Scene, ShaderLanguage,
  Vector2, Vector3, Vector4, AbstractEngine,
} from '@babylonjs/core';
import type { GBufferPass } from './Passes';
import type { Lighting } from './Materials';
import type { Fluid } from './Fluid';

/** Every knob of the post chain; the director and the combat systems animate these. */
export class PostSettings {
  // ambient obscurance
  aoRadius = 0.9;
  aoIntensity = 1.0;
  aoStrength = 0.85;
  aoTint = new Color3(0.42, 0.45, 0.68);
  // ink lines
  lineWidth = 1.25;
  lineDepth = 0.06;
  lineNormal = 0.35;
  lineStrength = 0.9;
  lineBoilFps = 8;
  lineBoil = 0.6;
  lineBreakup = 0.35;
  lineFar = 45;
  lineColor = new Color3(0.06, 0.04, 0.07);
  // fog / aerial
  fogDensity = 0.012;
  fogFalloff = 0.12;
  fogBase = 0;
  fogMax = 0.85;
  fogColor = new Color3(0.42, 0.46, 0.6);
  aerialStart = 18;
  aerialEnd = 120;
  aerialDesat = 0.5;
  aerialStrength = 1;
  horizonColor = new Color3(0.5, 0.55, 0.7);
  // bloom
  bloomThreshold = 1.25;
  bloomKnee = 0.45;
  bloomIntensity = 0.55;
  bloomScatter = 0.7;
  bloomTint = new Color3(1, 1, 1);
  // light shafts
  raysOn = true;
  raysDensity = 0.85;
  raysDecay = 0.95;
  raysWeight = 0.06;
  raysExposure = 0.9;
  raysThreshold = 1.2;
  raysColor = new Color3(1.0, 0.85, 0.7);
  /** world position of the light that throws shafts (defaults to far along the sun direction) */
  raysSource: Vector3 | null = null;
  // depth of field
  dofAmount = 0;
  dofFocus = 4;
  dofRange = 2;
  dofMaxRadius = 9;
  // motion
  cameraBlur = 0;
  radialBlur = 0;
  radialCenter = new Vector2(0.5, 0.5);
  chromatic = 0.5;
  lensDistortion = 0;
  // grading
  exposure = 0;
  contrast = 1.08;
  saturation = 1.05;
  vibrance = 0.15;
  temperature = 0;
  tint = 0;
  hueShift = 0;
  splitStrength = 0.15;
  splitShadow = new Color3(0.35, 0.42, 0.75);
  splitHighlight = new Color3(1.0, 0.85, 0.7);
  lift = new Color3(0.0, 0.0, 0.01);
  gamma = new Color3(1, 1, 1);
  gain = new Color3(1, 1, 1);
  tonemapShoulder = 0.35;
  tonemapDesat = 0.35;
  tonemapCurve = 0;
  domainTint = new Vector4(1, 1, 1, 0);
  // anime fx
  impactMode = 1;
  impactAmount = 0;
  speedLines = 0;
  desatPulse = 0;
  fxCenter = new Vector2(0.5, 0.5);
  flashAmount = 0;
  flashColor = new Color3(1, 1, 1);
  vignette = 0.35;
  grain = 0.025;
  letterbox = 0;
  flashback = 0;
  flashbackHue = 0.0;
  flashbackPaper = 0.8;
  flashbackHalftone = 0.3;
  fadeBlack = 0;
  fadeWhite = 0;
  wipe = 0;
  wipeKind = 0;
  vowVignette = 0;
  domainTwist = 0;
  heatHaze = 0;
  /** up to 4 screen shockwaves: x, y (uv), radius, strength */
  shockwaves = new Float32Array(16);
  fxaa = true;
  // domain repaint front (composite)
  domainActive = 0;
  domainProgress = 0;
  domainRadius = 22;
  domainPalette = 0;
  domainCenter = new Vector3(0, 0, 0);
  /** ink and AO can be dropped on slow devices */
  quality: 'high' | 'medium' | 'low' = 'high';
  // volumetric light (raymarched through the shadow map)
  volumetric = 0;
  volDensity = 0.025;
  volAnisotropy = 0.55;
  volMaxDist = 60;
  volSteps = 20;
  volFalloff = 0.12;
  volBase = 0;
  volNoise = 0.5;
  // screen-space reflections on wet floors
  ssr = 0;
  ssrMaxDist = 18;
  ssrThickness = 0.5;
  ssrRoughness = 0.2;
  ssrSteps = 28;
  // lens
  flare = 0.35;
  flareThreshold = 1.4;
  flareGhosts = 5;
  flareSpacing = 0.35;
  flareDispersal = 0.004;
  flareHalo = 0.45;
  flareHaloAmount = 0.4;
  anamorphic = 0;
  anamorphicLength = 3;
  lensDirt = 0.6;
  starburst = 0.5;
  // auto exposure (eye adaptation)
  autoExposure = true;
  /** relative (default): hold the stage's graded level and answer changes; absolute: aim at a key */
  exposureMode: 'relative' | 'absolute' = 'relative';
  /** relative: how much of a change is compensated (0..1); absolute: the key value */
  exposureKey = 0.7;
  adaptUp = 3;
  adaptDown = 1.2;
  evMin = -1.5;
  evMax = 1;
  /** how much the volumetric pass dims what is behind it (the scene's own fog already does most) */
  volExtinction = 0.3;
  // grade look (vb_grade) and film
  look = 0;
  lookAmount = 1;
  halation = 0.15;
  grainSize = 1.5;
  // stylize (display-referred hand-made layer)
  screentone = 0;
  paper = 0;
  inkEdges = 0.25;
  painterly = 0;
  oldFilm = 0;
  lensRain = 0;
  frost = 0;
  lightLeak = 0;
  focusLines = 0;
  sparkle = 0;
  gloom = 0;
  panels = 0;
  mangaPage = 0;
  sfx = 0;
  betaFill = 0;
  mangaCenter = new Vector2(0.5, 0.55);
  sfxCenter = new Vector2(0.7, 0.7);
  paperColor = new Color3(0.98, 0.96, 0.9);
  sharpen = 0.35;
  /** ink in water over the screen (the fluid solver): amount, how much it bends the image, wash bands */
  fluidInk = 1;
  fluidRefract = 1;
  fluidBands = 4;
  /** cursed-energy auras round up to four characters (vbAuraMask, vbAura) */
  auras: AuraSlot[] = [];
  auraAmount = 1;
  /** scene transitions on real frames (vbTransition): kind 0 shatter, 1 ink, 2 burn, 3 slash, 4 talisman */
  transKind = 0;
  /** progress 0..1 while running, -1 when idle */
  transT = -1;
  transImpact = new Vector2(0.5, 0.5);
  transSeed = 0;
}

/** One burning aura: whose silhouette (G-buffer id base), its colours, style and size. */
export interface AuraSlot {
  idBase: number;
  color: [number, number, number];
  edge: [number, number, number];
  /** 0 flame, 1 static, 2 smoke, 3 halo */
  style: number;
  /** 0..1 */
  strength: number;
  /** how far the flames reach, in half-resolution pixels */
  reach: number;
}

/**
 * The post chain: scene (HDR, MSAA) -> SAO + bilateral blur -> composite (ink, AO, fog, domain front)
 * -> bloom mip chain, light shafts, depth of field -> final (lens, grading, anime FX) -> FXAA -> canvas.
 * All passes are WGSL effects drawn with an EffectRenderer into our own render targets.
 */
export class PostChain {
  readonly settings = new PostSettings();
  readonly hdr: RenderTargetTexture;
  private renderer: EffectRenderer;
  private targets: RenderTargetTexture[] = [];
  private ao!: RenderTargetTexture;
  private aoTmp!: RenderTargetTexture;
  private composite!: RenderTargetTexture;
  private bloomMips: RenderTargetTexture[] = [];
  private bloomUps: RenderTargetTexture[] = [];
  private rays!: RenderTargetTexture;
  private dofA!: RenderTargetTexture;
  private dofB!: RenderTargetTexture;
  private ldr!: RenderTargetTexture;
  private ldr2!: RenderTargetTexture;
  private vol!: RenderTargetTexture;
  private ssrT!: RenderTargetTexture;
  private flareT!: RenderTargetTexture;
  private auraMask!: RenderTargetTexture;
  private auraT!: RenderTargetTexture;
  private snapshot!: RenderTargetTexture;
  private snapshotWanted = false;
  private lum!: RenderTargetTexture;
  private reduce: RenderTargetTexture[] = [];
  private adapt: RenderTargetTexture[] = [];
  private adaptIndex = 0;
  private adaptReset = true;
  /** the ink-in-water solver whose dye the stylize pass lays over the image (set by Effects) */
  fluid: Fluid | null = null;
  private passes: Record<string, EffectWrapper> = {};
  private prevViewProj = Matrix.Identity();
  private frame = 0;
  private black: RenderTargetTexture;
  time = 0;
  /** set by the director on a camera cut so motion blur doesn't smear across it */
  cutPending = true;

  constructor(private engine: AbstractEngine, private scene: Scene, private camera: Camera, private gbuffer: GBufferPass, private lighting: Lighting) {
    this.renderer = new EffectRenderer(engine);
    this.hdr = new RenderTargetTexture('hdr', { width: engine.getRenderWidth(), height: engine.getRenderHeight() }, scene, {
      generateMipMaps: false, type: Constants.TEXTURETYPE_HALF_FLOAT, samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
      generateDepthBuffer: true, generateStencilBuffer: true, samples: 4, format: Constants.TEXTUREFORMAT_RGBA,
    });
    this.black = this.target('black', 4, 4);
    camera.outputRenderTarget = this.hdr;
    this.buildTargets();
    this.buildPasses();
  }

  private target(name: string, w: number, h: number, type = Constants.TEXTURETYPE_HALF_FLOAT): RenderTargetTexture {
    const t = new RenderTargetTexture(name, { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }, this.scene, {
      generateMipMaps: false, type, samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE, generateDepthBuffer: false,
      format: Constants.TEXTUREFORMAT_RGBA,
    });
    t.wrapU = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    t.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
    this.targets.push(t);
    return t;
  }

  private buildTargets(): void {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.ao = this.target('sao', w / 2, h / 2);
    this.aoTmp = this.target('saoTmp', w / 2, h / 2);
    this.composite = this.target('composite', w, h);
    this.bloomMips = [];
    this.bloomUps = [];
    let bw = w / 2;
    let bh = h / 2;
    for (let i = 0; i < 6; i++) {
      this.bloomMips.push(this.target('bloomDown' + i, bw, bh));
      this.bloomUps.push(this.target('bloomUp' + i, bw, bh));
      bw /= 2;
      bh /= 2;
    }
    this.rays = this.target('rays', w / 4, h / 4);
    this.dofA = this.target('dofA', w / 2, h / 2);
    this.dofB = this.target('dofB', w / 2, h / 2);
    this.ldr = this.target('ldr', w, h, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.ldr2 = this.target('ldr2', w, h, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.vol = this.target('vol', w / 2, h / 2);
    this.ssrT = this.target('ssr', w / 2, h / 2);
    this.flareT = this.target('flare', w / 4, h / 4);
    this.auraMask = this.target('auraMask', w / 2, h / 2);
    this.auraT = this.target('aura', w / 2, h / 2);
    this.snapshot = this.target('snapshot', w, h, Constants.TEXTURETYPE_UNSIGNED_BYTE);
    this.lum = this.target('lum', 64, 64);
    this.reduce = [this.target('lum16', 16, 16), this.target('lum4', 4, 4), this.target('lum1', 1, 1)];
    this.adapt = [this.target('adaptA', 1, 1), this.target('adaptB', 1, 1)];
    this.adaptReset = true;
  }

  private wrap(name: string, uniforms: string[], samplers: string[]): EffectWrapper {
    const fx = new EffectWrapper({
      engine: this.engine, name, fragmentShader: name, useShaderStore: true, uniformNames: uniforms, samplerNames: samplers,
      shaderLanguage: ShaderLanguage.WGSL,
    });
    this.passes[name] = fx;
    return fx;
  }

  private buildPasses(): void {
    this.wrap('vbSao', ['projParams', 'aoParams', 'screenParams'], ['gbuffer']);
    this.wrap('vbBilateral', ['blurDir', 'sharpness'], ['source']);
    this.wrap('vbComposite', ['projParams', 'screenParams', 'invView', 'cameraPos', 'aoParams', 'aoTint', 'lineParams', 'lineParams2', 'lineColor',
      'fogParams', 'fogColor', 'aerialParams', 'horizonColor', 'sunDir', 'sunColor', 'domainParams', 'domainCenter', 'time'], ['sceneTex', 'gbuffer', 'aoTex']);
    this.wrap('vbBloom', ['texel', 'bloomParams', 'scatter'], ['source', 'higher']);
    this.wrap('vbGodrays', ['lightUV', 'rayParams', 'rayThreshold', 'screenParams'], ['sceneTex', 'gbuffer']);
    this.wrap('vbDof', ['dofParams', 'screenParams'], ['source', 'gbuffer']);
    this.wrap('vbFinal', ['screenParams', 'projParams', 'invView', 'prevViewProj', 'motionParams', 'caParams', 'bloomParams', 'bloomTint', 'raysColor',
      'dofParams', 'grade1', 'grade2', 'lift', 'gamma', 'gain', 'splitShadow', 'splitHighlight', 'tonemapParams', 'fxParams', 'fxParams2', 'fxCenter',
      'flashColor', 'flashback', 'transition', 'shockwaves', 'extraParams', 'domainTint', 'volParams', 'lookParams', 'filmParams', 'auraAmount'],
    ['compositeTex', 'bloomTex', 'raysTex', 'dofTex', 'gbuffer', 'volTex', 'ssrTex', 'flareTex', 'exposureTex', 'auraTex']);
    this.wrap('vbFxaa', ['rcpFrame', 'fxaaParams'], ['source']);
    this.wrap('vbVolumetric', ['projParams', 'screenParams', 'invView', 'cameraPos', 'sunDir', 'sunColor', 'fogColor', 'lightViewProj', 'shadowParams',
      'volParams', 'volParams2', 'pointPos', 'pointCol'], ['gbuffer', 'shadowMap']);
    this.wrap('vbSsr', ['projParams', 'screenParams', 'ssrParams', 'ssrParams2'], ['sceneTex', 'gbuffer']);
    this.wrap('vbLensFlare', ['screenParams', 'flareParams', 'flareParams2', 'sunUV'], ['source']);
    this.wrap('vbLuminance', ['lumParams'], ['source', 'gbuffer']);
    this.wrap('vbReduce', ['texel'], ['source']);
    this.wrap('vbAdapt', ['adaptParams', 'adaptRange'], ['current', 'previous']);
    this.wrap('vbStylize', ['screenParams', 'styleParams', 'styleParams2', 'mangaParams', 'mangaParams2', 'mangaCenter', 'paperColor', 'fluidParams'], ['source', 'fluidDye', 'fluidVel']);
    this.wrap('vbSharpen', ['rcpFrame', 'sharpness'], ['source']);
    this.wrap('vbAuraMask', ['auraIds', 'texel'], ['gbuffer']);
    this.wrap('vbTransition', ['transParams', 'transImpact'], ['source', 'snapshot']);
    this.wrap('vbCopy', [], ['source']);
    this.wrap('vbAura', ['auraColors', 'auraEdges', 'auraParams', 'texel'], ['mask']);
  }

  isReady(): boolean {
    return Object.values(this.passes).every((p) => p.effect.isReady()) && this.hdr.isReady();
  }

  resize(): void {
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    this.hdr.resize({ width: w, height: h });
    for (const t of this.targets) if (t !== this.black) t.dispose();
    this.targets = [this.black];
    this.buildTargets();
  }

  /** Keep the next frame as the snapshot a scene transition will break away. */
  captureSnapshot(): void {
    this.snapshotWanted = true;
  }

  /** Forget the eye's adaptation (after a hard cut to a very different scene). */
  resetAdaptation(): void {
    this.adaptReset = true;
  }

  private run(name: string, out: RenderTargetTexture | null, set: (e: EffectWrapper) => void): void {
    const fx = this.passes[name];
    if (!fx.effect.isReady()) return;
    const obs = fx.onApplyObservable.addOnce(() => set(fx));
    if (out) this.renderer.render(fx, out);
    else this.renderer.render(fx);
    fx.onApplyObservable.remove(obs);
  }

  private projParams(): Vector4 {
    const cam = this.camera;
    const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
    return new Vector4(Math.tan(cam.fov / 2), aspect, cam.minZ, cam.maxZ);
  }

  /** Run the whole chain; call after scene.render(). */
  render(dt: number): void {
    const s = this.settings;
    this.time += dt;
    this.frame++;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    const proj = this.projParams();
    const view = this.camera.getViewMatrix();
    const invView = view.clone().invert();
    const gb = this.gbuffer.rtt;
    const L = this.lighting;
    const screen = new Vector4(w, h, 1 / w, 1 / h);

    // ambient obscurance
    const aoOn = s.quality !== 'low' && s.aoStrength > 0;
    if (aoOn) {
      this.run('vbSao', this.ao, (fx) => {
        const e = fx.effect;
        e.setTexture('gbuffer', gb);
        e.setVector4('projParams', proj);
        e.setVector4('aoParams', new Vector4(s.aoRadius, s.aoIntensity, 0.4, this.frame % 64));
        e.setVector4('screenParams', new Vector4(w, h, w / 2, h / 2));
      });
      for (const [src, dst, dir] of [[this.ao, this.aoTmp, new Vector2(2 / w, 0)], [this.aoTmp, this.ao, new Vector2(0, 2 / h)]] as const) {
        this.run('vbBilateral', dst, (fx) => {
          fx.effect.setTexture('source', src);
          fx.effect.setVector2('blurDir', dir);
          fx.effect.setFloat('sharpness', 40);
        });
      }
    }

    // composite
    this.run('vbComposite', this.composite, (fx) => {
      const e = fx.effect;
      e.setTexture('sceneTex', this.hdr);
      e.setTexture('gbuffer', gb);
      e.setTexture('aoTex', aoOn ? this.ao : this.black);
      e.setVector4('projParams', proj);
      e.setVector4('screenParams', screen);
      e.setMatrix('invView', invView);
      e.setVector3('cameraPos', this.camera.globalPosition);
      e.setVector4('aoParams', new Vector4(aoOn ? s.aoStrength : 0, 0, 0, 0));
      e.setColor3('aoTint', s.aoTint);
      e.setVector4('lineParams', new Vector4(s.lineWidth * (h / 720), s.lineDepth, s.lineNormal, s.quality === 'low' ? 0 : s.lineStrength));
      e.setVector4('lineParams2', new Vector4(s.lineBoilFps, s.lineBoil, s.lineBreakup, s.lineFar));
      e.setColor3('lineColor', s.lineColor);
      e.setVector4('fogParams', new Vector4(s.fogDensity, s.fogFalloff, s.fogBase, s.fogMax));
      e.setColor3('fogColor', s.fogColor);
      e.setVector4('aerialParams', new Vector4(s.aerialStart, s.aerialEnd, s.aerialDesat, s.aerialStrength));
      e.setColor3('horizonColor', s.horizonColor);
      e.setVector3('sunDir', L.sunDir);
      e.setColor3('sunColor', L.sunColor);
      e.setVector4('domainParams', new Vector4(s.domainProgress, s.domainRadius, s.domainPalette, s.domainActive));
      e.setVector3('domainCenter', s.domainCenter);
      e.setFloat('time', this.time);
    });

    // screen-space reflections on wet floors (half resolution)
    const ssrOn = s.ssr > 0.001 && s.quality === 'high';
    if (ssrOn) {
      this.run('vbSsr', this.ssrT, (fx) => {
        const e = fx.effect;
        e.setTexture('sceneTex', this.composite);
        e.setTexture('gbuffer', gb);
        e.setVector4('projParams', proj);
        e.setVector4('screenParams', new Vector4(w / 2, h / 2, 2 / w, 2 / h));
        e.setVector4('ssrParams', new Vector4(1, s.ssrMaxDist, s.ssrThickness, s.ssrRoughness));
        e.setVector4('ssrParams2', new Vector4(s.ssrSteps, 0.45, this.time, 0));
      });
    }

    // volumetric light through the shadow map (half resolution)
    const volOn = s.volumetric > 0.001 && s.quality !== 'low';
    if (volOn) {
      this.run('vbVolumetric', this.vol, (fx) => {
        const e = fx.effect;
        e.setTexture('gbuffer', gb);
        e.setTexture('shadowMap', (L.shadowMap as RenderTargetTexture | null) ?? this.black);
        e.setVector4('projParams', proj);
        e.setVector4('screenParams', new Vector4(w / 2, h / 2, 2 / w, 2 / h));
        e.setMatrix('invView', invView);
        e.setVector3('cameraPos', this.camera.globalPosition);
        e.setVector3('sunDir', L.sunDir);
        e.setColor3('sunColor', L.sunColor);
        e.setColor3('fogColor', s.fogColor);
        e.setMatrix('lightViewProj', L.lightViewProj);
        e.setVector4('shadowParams', new Vector4(L.shadowSize, L.shadowBias, 0, L.shadowMap ? L.shadowsOn : 0));
        e.setVector4('volParams', new Vector4(s.volDensity, s.volAnisotropy, s.volMaxDist, s.quality === 'high' ? s.volSteps : Math.max(8, s.volSteps / 2)));
        e.setVector4('volParams2', new Vector4(s.volFalloff, s.volBase, s.volNoise, this.time));
        e.setArray4('pointPos', Array.from(L.pointPos));
        e.setArray4('pointCol', Array.from(L.pointCol));
      });
    }

    // cursed-energy auras: mark the burning fighters, then grow flames off their silhouettes
    const auras = s.auras.filter((a) => a.strength > 0.01 && a.idBase >= 0).slice(0, 4);
    const auraOn = auras.length > 0 && s.auraAmount > 0 && s.quality !== 'low';
    if (auraOn) {
      const ids = [-1, -1, -1, -1];
      const cols: number[] = [];
      const edges: number[] = [];
      for (let k = 0; k < 4; k++) {
        const a = auras[k];
        if (a) ids[k] = a.idBase;
        cols.push(...(a ? a.color : [0, 0, 0]), a ? a.style + Math.min(a.strength, 0.99) : 0);
        edges.push(...(a ? a.edge : [0, 0, 0]), a ? a.reach : 0);
      }
      this.run('vbAuraMask', this.auraMask, (fx) => {
        fx.effect.setTexture('gbuffer', gb);
        fx.effect.setVector4('auraIds', new Vector4(ids[0], ids[1], ids[2], ids[3]));
        fx.effect.setVector2('texel', new Vector2(1 / w, 1 / h));
      });
      this.run('vbAura', this.auraT, (fx) => {
        fx.effect.setTexture('mask', this.auraMask);
        fx.effect.setArray4('auraColors', cols);
        fx.effect.setArray4('auraEdges', edges);
        fx.effect.setVector4('auraParams', new Vector4(this.time, w / h, 1, 0));
        fx.effect.setVector2('texel', new Vector2(2 / w, 2 / h));
      });
    }

    // the eye's adaptation: log luminance -> reduce to 1x1 -> ease into the previous value
    if (s.autoExposure) {
      this.run('vbLuminance', this.lum, (fx) => {
        fx.effect.setTexture('source', this.composite);
        fx.effect.setTexture('gbuffer', gb);
        fx.effect.setVector4('lumParams', new Vector4(1 / w, 1 / h, 1.5, 0.15));
      });
      let src: RenderTargetTexture = this.lum;
      let size = 64;
      for (const dst of this.reduce) {
        const s0 = size;
        const from = src;
        this.run('vbReduce', dst, (fx) => {
          fx.effect.setTexture('source', from);
          fx.effect.setVector2('texel', new Vector2(1 / s0, 1 / s0));
        });
        src = dst;
        size = size / 4;
      }
      const prev = this.adapt[this.adaptIndex];
      const next = this.adapt[1 - this.adaptIndex];
      this.run('vbAdapt', next, (fx) => {
        fx.effect.setTexture('current', this.reduce[this.reduce.length - 1]);
        fx.effect.setTexture('previous', prev);
        fx.effect.setVector4('adaptParams', new Vector4(Math.min(dt, 0.1), s.adaptUp, s.adaptDown, s.exposureKey));
        fx.effect.setVector4('adaptRange', new Vector4(s.evMin, s.evMax, this.adaptReset ? 1 : 0, s.exposureMode === 'absolute' ? 1 : 0));
      });
      this.adaptIndex = 1 - this.adaptIndex;
      this.adaptReset = false;
    }

    // bloom: prefilter into mip 0, downsample, then tent-upsample back up
    const mips = this.bloomMips;
    for (let i = 0; i < mips.length; i++) {
      const src = i === 0 ? this.composite : mips[i - 1];
      const srcW = i === 0 ? w : w / 2 ** i;
      const srcH = i === 0 ? h : h / 2 ** i;
      this.run('vbBloom', mips[i], (fx) => {
        fx.effect.setTexture('source', src);
        fx.effect.setTexture('higher', this.black);
        fx.effect.setVector2('texel', new Vector2(1 / srcW, 1 / srcH));
        fx.effect.setVector4('bloomParams', new Vector4(s.bloomThreshold, s.bloomKnee, i === 0 ? 0 : 1, 1));
        fx.effect.setFloat('scatter', s.bloomScatter);
      });
    }
    let up: RenderTargetTexture = mips[mips.length - 1];
    for (let i = mips.length - 2; i >= 0; i--) {
      const smallW = w / 2 ** (i + 2);
      const smallH = h / 2 ** (i + 2);
      const src = up;
      this.run('vbBloom', this.bloomUps[i], (fx) => {
        fx.effect.setTexture('source', src);
        fx.effect.setTexture('higher', mips[i]);
        fx.effect.setVector2('texel', new Vector2(1 / smallW, 1 / smallH));
        fx.effect.setVector4('bloomParams', new Vector4(s.bloomThreshold, s.bloomKnee, 2, 1));
        fx.effect.setFloat('scatter', s.bloomScatter);
      });
      up = this.bloomUps[i];
    }
    const bloom = up;

    // lens flare from the bright parts of the image (quarter resolution, from a blurred bloom level)
    const flareOn = s.flare > 0.001 && s.quality !== 'low';
    if (flareOn) {
      const sunScreen = (() => {
        const src = this.camera.globalPosition.add(L.sunDir.scale(500));
        const vp = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix());
        const c = Vector4.TransformCoordinates(src, vp);
        if (c.w <= 0) return new Vector4(0, 0, 0, 0);
        const x = c.x / c.w * 0.5 + 0.5;
        const y = c.y / c.w * 0.5 + 0.5;
        return new Vector4(x, y, x > 0 && x < 1 && y > 0 && y < 1 ? 1 : 0, s.starburst);
      })();
      this.run('vbLensFlare', this.flareT, (fx) => {
        fx.effect.setTexture('source', this.bloomUps[1] ?? this.bloomUps[0]);
        fx.effect.setVector4('screenParams', new Vector4(w / 4, h / 4, 4 / w, 4 / h));
        fx.effect.setVector4('flareParams', new Vector4(s.flareGhosts, s.flareSpacing, s.flareThreshold, s.flareDispersal));
        fx.effect.setVector4('flareParams2', new Vector4(s.flareHalo, s.flareHaloAmount, s.anamorphic, s.anamorphicLength));
        fx.effect.setVector4('sunUV', sunScreen);
      });
    }

    // light shafts toward the light's screen position
    let raysOn = false;
    if (s.raysOn && s.quality !== 'low') {
      const src = s.raysSource ?? this.camera.globalPosition.add(L.sunDir.scale(500));
      const vp = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix());
      const c = Vector4.TransformCoordinates(src, vp);
      if (c.w > 0) {
        const lu = new Vector3(c.x / c.w * 0.5 + 0.5, c.y / c.w * 0.5 + 0.5, 1);
        if (lu.x > -0.5 && lu.x < 1.5 && lu.y > -0.5 && lu.y < 1.5) {
          raysOn = true;
          this.run('vbGodrays', this.rays, (fx) => {
            fx.effect.setTexture('sceneTex', this.composite);
            fx.effect.setTexture('gbuffer', gb);
            fx.effect.setVector3('lightUV', lu);
            fx.effect.setVector4('rayParams', new Vector4(s.raysDensity, s.raysDecay, s.raysWeight, s.raysExposure));
            fx.effect.setFloat('rayThreshold', s.raysThreshold);
            fx.effect.setVector4('screenParams', new Vector4(w / 4, h / 4, 4 / w, 4 / h));
          });
        }
      }
    }

    // depth of field (cutscenes)
    const dofOn = s.dofAmount > 0.001;
    if (dofOn) {
      this.run('vbDof', this.dofA, (fx) => {
        fx.effect.setTexture('source', this.composite);
        fx.effect.setTexture('gbuffer', gb);
        fx.effect.setVector4('dofParams', new Vector4(s.dofFocus, s.dofRange, s.dofMaxRadius, 0));
        fx.effect.setVector4('screenParams', new Vector4(w / 2, h / 2, 2 / w, 2 / h));
      });
      this.run('vbDof', this.dofB, (fx) => {
        fx.effect.setTexture('source', this.dofA);
        fx.effect.setTexture('gbuffer', gb);
        fx.effect.setVector4('dofParams', new Vector4(s.dofFocus, s.dofRange, s.dofMaxRadius, 1));
        fx.effect.setVector4('screenParams', new Vector4(w / 2, h / 2, 2 / w, 2 / h));
      });
    }

    // final (no camera blur on the first frame or after a cut: there is no meaningful previous frame)
    const vpNow = view.multiply(this.camera.getProjectionMatrix());
    if (this.frame <= 1 || this.cutPending) {
      this.prevViewProj.copyFrom(vpNow);
      this.cutPending = false;
    }
    this.run('vbFinal', this.ldr, (fx) => {
      const e = fx.effect;
      e.setTexture('compositeTex', this.composite);
      e.setTexture('bloomTex', bloom);
      e.setTexture('raysTex', raysOn ? this.rays : this.black);
      e.setTexture('dofTex', dofOn ? this.dofB : this.black);
      e.setTexture('gbuffer', gb);
      e.setVector4('screenParams', screen);
      e.setVector4('projParams', proj);
      e.setMatrix('invView', invView);
      e.setMatrix('prevViewProj', this.prevViewProj);
      e.setVector4('motionParams', new Vector4(s.cameraBlur, s.radialBlur, s.radialCenter.x, s.radialCenter.y));
      e.setVector4('caParams', new Vector4(s.chromatic, s.lensDistortion, 0, 0));
      e.setVector4('bloomParams', new Vector4(s.bloomIntensity, 0, 0, 0));
      e.setColor3('bloomTint', s.bloomTint);
      e.setColor3('raysColor', s.raysColor);
      e.setVector4('dofParams', new Vector4(dofOn ? s.dofAmount : 0, 0, 0, 0));
      e.setVector4('grade1', new Vector4(s.exposure, s.contrast, s.saturation, s.vibrance));
      e.setVector4('grade2', new Vector4(s.temperature, s.tint, s.hueShift, s.splitStrength));
      e.setColor3('lift', s.lift);
      e.setColor3('gamma', s.gamma);
      e.setColor3('gain', s.gain);
      e.setColor3('splitShadow', s.splitShadow);
      e.setColor3('splitHighlight', s.splitHighlight);
      e.setVector4('tonemapParams', new Vector4(s.tonemapShoulder, s.tonemapDesat, s.tonemapCurve, 0));
      e.setVector4('fxParams', new Vector4(s.impactMode, s.impactAmount, s.speedLines, s.desatPulse));
      e.setVector4('fxParams2', new Vector4(s.flashAmount, s.vignette, s.grain, s.letterbox));
      e.setVector2('fxCenter', s.fxCenter);
      e.setColor3('flashColor', s.flashColor);
      e.setVector4('flashback', new Vector4(s.flashback, s.flashbackHue, s.flashbackPaper, s.flashbackHalftone));
      e.setVector4('transition', new Vector4(s.fadeBlack, s.fadeWhite, s.wipe, s.wipeKind));
      e.setArray4('shockwaves', Array.from(s.shockwaves));
      e.setVector4('extraParams', new Vector4(s.vowVignette, s.domainTwist, s.heatHaze, this.time));
      e.setVector4('domainTint', s.domainTint);
      e.setTexture('volTex', volOn ? this.vol : this.black);
      e.setTexture('ssrTex', ssrOn ? this.ssrT : this.black);
      e.setTexture('flareTex', flareOn ? this.flareT : this.black);
      e.setTexture('exposureTex', this.adapt[this.adaptIndex]);
      e.setTexture('auraTex', auraOn ? this.auraT : this.black);
      e.setFloat('auraAmount', auraOn ? s.auraAmount : 0);
      e.setVector4('volParams', new Vector4(volOn ? s.volumetric : 0, ssrOn ? s.ssr : 0, flareOn ? s.flare : 0, s.lensDirt));
      e.setVector4('lookParams', new Vector4(s.look, s.lookAmount, s.autoExposure ? 1 : 0, s.halation));
      e.setVector4('filmParams', new Vector4(s.grainSize, s.volExtinction, 0, 0));
    });
    this.prevViewProj.copyFrom(vpNow);

    // the hand-made layer: lens rain, painting, ink, screentone, paper, old film, manga marks
    this.run('vbStylize', this.ldr2, (fx) => {
      const e = fx.effect;
      e.setTexture('source', this.ldr);
      e.setVector4('screenParams', screen);
      e.setVector4('styleParams', new Vector4(s.screentone, s.paper, s.quality === 'low' ? 0 : s.inkEdges, s.painterly));
      e.setVector4('styleParams2', new Vector4(s.oldFilm, s.lensRain, s.frost, s.lightLeak));
      e.setVector4('mangaParams', new Vector4(s.focusLines, s.sparkle, s.gloom, s.panels));
      e.setVector4('mangaParams2', new Vector4(s.mangaPage, s.sfx, s.betaFill, this.time));
      e.setVector4('mangaCenter', new Vector4(s.mangaCenter.x, s.mangaCenter.y, s.sfxCenter.x, s.sfxCenter.y));
      e.setColor3('paperColor', s.paperColor);
      const fl = this.fluid;
      const fluidOn = !!fl && fl.active && s.fluidInk > 0;
      e.setTexture('fluidDye', fluidOn ? fl!.dyeTexture : this.black);
      e.setTexture('fluidVel', fluidOn ? fl!.velocityTexture : this.black);
      e.setVector4('fluidParams', new Vector4(fluidOn ? s.fluidInk : 0, s.fluidRefract, s.fluidBands, 0));
    });

    // FXAA, then contrast-adaptive sharpening to the canvas
    this.run('vbFxaa', this.ldr, (fx) => {
      fx.effect.setTexture('source', this.ldr2);
      fx.effect.setVector2('rcpFrame', new Vector2(1 / w, 1 / h));
      fx.effect.setVector4('fxaaParams', new Vector4(0.6, 0.166, 0.0312, s.fxaa ? 1 : 0));
    });
    // the frame a transition will break away, captured on request
    if (this.snapshotWanted) {
      this.snapshotWanted = false;
      this.run('vbCopy', this.snapshot, (fx) => fx.effect.setTexture('source', this.ldr));
    }
    // scene transitions: the snapshot covering the new scene breaks away
    let shown: RenderTargetTexture = this.ldr;
    if (s.transT >= 0 && s.transT < 1) {
      this.run('vbTransition', this.ldr2, (fx) => {
        fx.effect.setTexture('source', this.ldr);
        fx.effect.setTexture('snapshot', this.snapshot);
        fx.effect.setVector4('transParams', new Vector4(s.transKind, s.transT, w / h, s.transSeed));
        fx.effect.setVector2('transImpact', s.transImpact);
      });
      shown = this.ldr2;
    }
    (this.engine as Engine).restoreDefaultFramebuffer();
    this.run('vbSharpen', null, (fx) => {
      fx.effect.setTexture('source', shown);
      fx.effect.setVector2('rcpFrame', new Vector2(1 / w, 1 / h));
      fx.effect.setFloat('sharpness', s.quality === 'low' ? 0 : s.sharpen);
    });
  }
}
