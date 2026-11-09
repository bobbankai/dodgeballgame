import {
  MaterialPluginBase, ShaderLanguage, type Material, type Nullable, Vector3, Color3,
} from '@babylonjs/core';

/**
 * Base class for the game's material plugins. Each plugin injects code into Babylon's PBR shader at
 * documented points (or at stable anchors via `!regex` keys) and provides both a WGSL and a GLSL
 * version, so the same material works on WebGPU and WebGL 2 without a shader transpiler.
 */
export interface PluginCode {
  glsl: { vertex?: Record<string, string>; fragment?: Record<string, string> };
  wgsl: { vertex?: Record<string, string>; fragment?: Record<string, string> };
}

export abstract class EcPlugin extends MaterialPluginBase {
  protected abstract code(): PluginCode;

  private _on = true;

  constructor(material: Material, name: string, priority: number, defines: Record<string, unknown>) {
    super(material, name, priority, defines, true, true);
  }

  /** Switching a plugin off removes its code from the shader (via its define). */
  get isEnabled(): boolean {
    return this._on;
  }

  set isEnabled(v: boolean) {
    if (v === this._on) return;
    this._on = v;
    this.markAllDefinesAsDirty();
  }

  override isCompatible(lang: ShaderLanguage): boolean {
    return lang === ShaderLanguage.GLSL || lang === ShaderLanguage.WGSL;
  }

  override getCustomCode(shaderType: string, lang?: ShaderLanguage): Nullable<Record<string, string>> {
    const c = this.code();
    const set = lang === ShaderLanguage.WGSL ? c.wgsl : c.glsl;
    return (shaderType === 'vertex' ? set.vertex : set.fragment) ?? null;
  }
}

/**
 * Scene-wide environment state the material plugins read (weather, wind, time). One instance per
 * game; levels and the weather system write to it.
 */
export class MaterialEnvironment {
  time = 0;
  /** 0 dry .. 1 soaked (darkens porous surfaces, lowers roughness, fills puddles). */
  wetness = 0;
  /** Top-down coverage layer (ash, snow, moss): amount 0..1 and its look. */
  coverAmount = 0;
  coverColor = new Color3(0.42, 0.4, 0.38);
  coverRoughness = 0.95;
  /** World-space scale of the coverage breakup noise. */
  coverScale = 0.35;
  /** Upward-facing threshold (dot(normal, up)) above which coverage starts. */
  coverThreshold = 0.35;
  /** Height of standing water (flooded levels): surfaces below it are soaked but hold no puddles. */
  waterLevel = -1e4;
  wind = new Vector3(1, 0, 0.3);
  windStrength = 0.3;
  /** Sun direction (towards the sun) and colour*intensity, for custom lighting terms. */
  sunDir = new Vector3(0, 1, 0);
  sunColor = new Color3(1, 1, 1);
  static readonly instance = new MaterialEnvironment();
}

export const MatEnv = MaterialEnvironment.instance;
