// Material factories. Every material is a WGSL ShaderMaterial bound to the shared globals block.
import { ShaderMaterial, ShaderLanguage, Vector4, Color3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import type { Renderer } from './Renderer';

export function hex(h: string): Color3 {
  return Color3.FromHexString(h).toLinearSpace();
}
export function v4(x: number, y = 0, z = 0, w = 0): Vector4 { return new Vector4(x, y, z, w); }
export function c4(c: Color3, w = 0): Vector4 { return new Vector4(c.r, c.g, c.b, w); }

let nextId = 1;
/** Character ids stay below 0.5 (the impact frame and outlines tell characters from scenery). */
export function newObjectId(): number { return ((nextId++ % 120) + 1) / 255; }
export const ENV_ID = 0.75;

const TOON_UNIFORMS = ['world', 'viewProjection', 'view', 'faceA', 'faceB', 'faceC', 'faceD', 'irisA', 'irisB', 'faceInk', 'faceMisc', 'tint', 'fx', 'glowColor', 'aura'];

function bindShadow(m: ShaderMaterial, r: Renderer): void {
  const [s0, s1] = r.shadowTextures;
  m.setTexture('shadowTex0', s0 as any);
  m.setTexture('shadowTex1', s1 as any);
}

export function toonMaterial(name: string, r: Renderer): ShaderMaterial {
  const m = new ShaderMaterial(name, r.scene, { vertex: 'tbToon', fragment: 'tbToon' }, {
    attributes: ['position', 'normal', 'uv', 'uv2'],
    uniforms: TOON_UNIFORMS,
    uniformBuffers: ['globals'],
    samplers: ['shadowTex0', 'shadowTex1'],
    shaderLanguage: ShaderLanguage.WGSL,
  });
  m.setUniformBuffer('globals', r.globals.ubo);
  bindShadow(m, r);
  m.setVector4('faceA', v4(1, 1, 0, 0));
  m.setVector4('faceB', v4(0, 0, 0, 0));
  m.setVector4('faceC', v4(1, 0, 0, 0));
  m.setVector4('faceD', v4(0, 1, 1, 0));
  m.setVector4('irisA', v4(0.1, 0.06, 0.03, 0.5));
  m.setVector4('irisB', v4(0.6, 0.35, 0.1, 0));
  m.setVector4('faceInk', v4(0.05, 0.03, 0.04, 1));
  m.setVector4('faceMisc', v4(0, 0, 0, 0));
  m.setVector4('tint', v4(1, 1, 1, 0));
  m.setVector4('fx', v4(0, 0, 0, newObjectId()));
  m.setVector4('glowColor', v4(0.4, 0.9, 1.0, 0));
  m.setVector4('aura', v4(0.6, 1.2, 2.2, 0));
  return m;
}

export function outlineMaterial(name: string, r: Renderer, widthPx = 2.2, ink = '#1a1020', bleed = 0.55): ShaderMaterial {
  const m = new ShaderMaterial(name, r.scene, { vertex: 'tbOutline', fragment: 'tbOutline' }, {
    attributes: ['position', 'normal', 'uv2'],
    uniforms: ['world', 'viewProjection', 'view', 'fx', 'inkColor'],
    uniformBuffers: ['globals'],
    shaderLanguage: ShaderLanguage.WGSL,
  });
  m.setUniformBuffer('globals', r.globals.ubo);
  // inverted hull: no cull state games (Babylon's cull state can leak between materials); the fragment
  // shader keeps only back faces
  m.backFaceCulling = false;
  const c = hex(ink);
  m.setVector4('inkColor', v4(c.r, c.g, c.b, bleed));
  m.setVector4('fx', v4(0, widthPx, 0, 0));
  return m;
}

export interface SkyLook {
  zenith: string; horizon: string; glow: string; cloudLit: string; cloudShade: string;
  cover: number; cloudHeight: number; sunSize: number; stars: number; moon: boolean;
}

export function skyMaterial(r: Renderer, s: SkyLook): ShaderMaterial {
  const m = new ShaderMaterial('sky', r.scene, { vertex: 'tbSky', fragment: 'tbSky' }, {
    attributes: ['position'],
    uniforms: ['viewProjection', 'skyA', 'skyB', 'skyC', 'skyD', 'skyE'],
    uniformBuffers: ['globals'],
    shaderLanguage: ShaderLanguage.WGSL,
  });
  m.setUniformBuffer('globals', r.globals.ubo);
  m.backFaceCulling = false;
  m.disableDepthWrite = true;
  applySky(m, s);
  return m;
}

export function applySky(m: ShaderMaterial, s: SkyLook): void {
  m.setVector4('skyA', c4(hex(s.zenith), s.cover));
  m.setVector4('skyB', c4(hex(s.horizon), s.cloudHeight));
  m.setVector4('skyC', c4(hex(s.glow), s.sunSize));
  m.setVector4('skyD', c4(hex(s.cloudLit), s.stars));
  m.setVector4('skyE', c4(hex(s.cloudShade), s.moon ? 1 : 0));
}

export function setMat(m: ShaderMaterial, _scene: Scene): ShaderMaterial { return m; }
