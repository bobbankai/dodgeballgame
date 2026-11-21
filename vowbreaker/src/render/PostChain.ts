import {
  Camera, Color3, Constants, EffectRenderer, EffectWrapper, Engine, Matrix, RenderTargetTexture, Scene, ShaderLanguage,
  Vector2, Vector3, Vector4, AbstractEngine,
} from '@babylonjs/core';
import type { GBufferPass } from './Passes';
import type { Lighting } from './Materials';

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
  bloomThreshold = 0.95;
  bloomKnee = 0.5;
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
  cameraBlur = 0.6;
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
      'flashColor', 'flashback', 'transition', 'shockwaves', 'extraParams', 'domainTint'], ['compositeTex', 'bloomTex', 'raysTex', 'dofTex', 'gbuffer']);
    this.wrap('vbFxaa', ['rcpFrame', 'fxaaParams'], ['source']);
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
    });
    this.prevViewProj.copyFrom(vpNow);

    // FXAA to the canvas
    (this.engine as Engine).restoreDefaultFramebuffer();
    this.run('vbFxaa', null, (fx) => {
      fx.effect.setTexture('source', this.ldr);
      fx.effect.setVector2('rcpFrame', new Vector2(1 / w, 1 / h));
      fx.effect.setVector4('fxaaParams', new Vector4(0.6, 0.166, 0.0312, s.fxaa ? 1 : 0));
    });
  }
}
