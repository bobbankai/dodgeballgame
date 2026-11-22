import { Color3, Constants, Mesh, MeshBuilder, ShaderLanguage, ShaderMaterial, Vector2, Vector4 } from '@babylonjs/core';
import type { Renderer } from './Renderer';

type RGB = [number, number, number];

/** A body of water in a stage. */
export interface WaterDef {
  kind: 'sea' | 'pond' | 'canal';
  /** centre of the surface (three.js axes) */
  center: [number, number, number];
  /** width (x) and depth (z) in metres */
  size: [number, number];
  shallow: RGB;
  deep: RGB;
  foam?: RGB;
  /** metres of water to reach the deep colour */
  depth?: number;
  /** wave amplitude (steepness scale) and wavelength in metres (the sea) */
  waves?: [number, number];
  /** the current (canals), metres per second */
  flow?: [number, number];
  /** for ponds flush with the ground: metres of depth gained per metre from the rim */
  rim?: number;
}

const KIND = { sea: 0, pond: 1, canal: 2 } as const;

/** Toon water (water.vertex / water.fragment, vb_water_toon), alpha blended over the scene. */
export class Water {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private off: () => void;
  /** 0..1: rain rings on the surface */
  rain = 0;

  constructor(r: Renderer, readonly def: WaterDef) {
    const scene = r.scene;
    const subdiv = def.kind === 'sea' ? 160 : 24;
    this.mesh = MeshBuilder.CreateGround('water_' + def.kind, { width: def.size[0], height: def.size[1], subdivisions: subdiv }, scene);
    this.mesh.position.set(def.center[0], def.center[1], def.center[2]);
    this.mat = new ShaderMaterial('water', scene, { vertex: 'water', fragment: 'water' }, {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'viewProjection', 'view', 'cameraPosition', 'waterParams', 'waterParams2', 'waterSize', 'shallowColor', 'deepColor', 'foamColor',
        'sunDir', 'sunColor', 'skyColor', 'horizonColor', 'screenSize'],
      samplers: ['gbuffer'],
      shaderLanguage: ShaderLanguage.WGSL,
      needAlphaBlending: true,
    });
    this.mat.alphaMode = Constants.ALPHA_COMBINE;
    this.mat.disableDepthWrite = true;
    this.mat.backFaceCulling = false;
    this.mat.setTexture('gbuffer', r.gbuffer.rtt);
    this.mesh.material = this.mat;
    this.mesh.isPickable = false;
    const waves = def.waves ?? (def.kind === 'sea' ? [0.8, 10] : [0, 1]);
    const flow = def.flow ?? [0, 0];
    this.off = r.mats.onUpdate((l) => {
      const m = this.mat;
      const engine = scene.getEngine();
      m.setVector3('cameraPosition', r.camera.globalPosition);
      m.setVector4('waterParams', new Vector4(l.time, waves[0], waves[1], KIND[def.kind]));
      m.setVector4('waterParams2', new Vector4(def.depth ?? 3, flow[0], flow[1], this.rain));
      m.setVector4('waterSize', new Vector4(def.size[0], def.size[1], def.rim ?? 0, 0));
      m.setColor3('shallowColor', toC(def.shallow));
      m.setColor3('deepColor', toC(def.deep));
      m.setColor3('foamColor', toC(def.foam ?? [0.94, 0.96, 0.97]));
      m.setVector3('sunDir', l.sunDir);
      m.setColor3('sunColor', l.sunColor);
      m.setColor3('skyColor', l.skyColor);
      m.setColor3('horizonColor', r.post.settings.horizonColor);
      m.setVector2('screenSize', new Vector2(engine.getRenderWidth(), engine.getRenderHeight()));
    });
  }

  dispose(): void {
    this.off();
    this.mat.dispose();
    this.mesh.dispose();
  }
}

function toC(c: RGB): Color3 {
  return new Color3(c[0], c[1], c[2]);
}
