import { Engine, WebGPUEngine, type AbstractEngine } from '@babylonjs/core';
import { log } from './Log';

export type Backend = 'webgpu' | 'webgl2';

export interface EngineHostOptions {
  /** Force a backend (`?gl=webgl2` / `?gl=webgpu`); otherwise WebGPU when the browser offers it. */
  prefer?: Backend;
  /** Multisampling for the canvas back buffer; post-processes have their own sample counts. */
  antialias?: boolean;
}

/**
 * Creates the engine (WebGPU first, WebGL 2 as fallback), keeps the canvas sized to the window and
 * owns the render-resolution scale used by the adaptive resolution controller.
 */
export class EngineHost {
  readonly engine: AbstractEngine;
  readonly backend: Backend;
  readonly canvas: HTMLCanvasElement;
  /** 1 = native pixels (after the device-pixel-ratio cap); lower values render fewer pixels. */
  private _renderScale = 1;
  private _dprCap = 2;
  private _resizeObserver?: ResizeObserver;

  private constructor(engine: AbstractEngine, backend: Backend, canvas: HTMLCanvasElement) {
    this.engine = engine;
    this.backend = backend;
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement, opts: EngineHostOptions = {}): Promise<EngineHost> {
    const wantGPU = opts.prefer !== 'webgl2';
    if (wantGPU && (await EngineHost.webgpuAvailable())) {
      try {
        const engine = new WebGPUEngine(canvas, {
          antialias: opts.antialias ?? true,
          stencil: true,
          powerPreference: 'high-performance',
          adaptToDeviceRatio: false,
          // Ask for the adapter's real limits (desktop GPUs allow 28-32 inter-stage varyings; the
          // WebGPU default of 16 is too tight for PBR + cascaded shadows + effects).
          setMaximumLimits: true,
          // A lost device should not take the page down; the engine restores resources itself.
          enableGPUDebugMarkers: false,
        });
        await engine.initAsync();
        const host = new EngineHost(engine, 'webgpu', canvas);
        host.init();
        log.info(`engine: WebGPU (${engine.description})`);
        return host;
      } catch (err) {
        log.warn('WebGPU initialisation failed, falling back to WebGL 2', err);
      }
    }
    const engine = new Engine(canvas, opts.antialias ?? true, {
      stencil: true,
      powerPreference: 'high-performance',
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      disableWebGL2Support: false,
      doNotHandleContextLost: false,
    }, false);
    if (engine.webGLVersion < 2) throw new Error('This game needs WebGL 2 or WebGPU.');
    const host = new EngineHost(engine, 'webgl2', canvas);
    host.init();
    log.info(`engine: WebGL 2 (${engine.description})`);
    return host;
  }

  static async webgpuAvailable(): Promise<boolean> {
    try {
      if (!('gpu' in navigator)) return false;
      return await WebGPUEngine.IsSupportedAsync;
    } catch {
      return false;
    }
  }

  private init(): void {
    this.engine.enableOfflineSupport = false;
    this.engine.disableManifestCheck = true;
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    if ('ResizeObserver' in window) {
      this._resizeObserver = new ResizeObserver(onResize);
      this._resizeObserver.observe(this.canvas);
    }
    this.applyScaling();
  }

  get renderScale(): number {
    return this._renderScale;
  }

  /** Fraction of native resolution to render at (0.5 - 1). */
  set renderScale(v: number) {
    const c = Math.min(1, Math.max(0.4, v));
    if (Math.abs(c - this._renderScale) < 1e-3) return;
    this._renderScale = c;
    this.applyScaling();
  }

  /** Upper bound on the device pixel ratio used for rendering (phones report 3+). */
  set dprCap(v: number) {
    this._dprCap = v;
    this.applyScaling();
  }

  private applyScaling(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this._dprCap);
    // hardwareScalingLevel is the inverse of the pixel density.
    this.engine.setHardwareScalingLevel(1 / (dpr * this._renderScale));
    this.resize();
  }

  resize(): void {
    this.engine.resize(true);
  }

  get width(): number {
    return this.engine.getRenderWidth();
  }

  get height(): number {
    return this.engine.getRenderHeight();
  }

  dispose(): void {
    this._resizeObserver?.disconnect();
    this.engine.dispose();
  }
}
