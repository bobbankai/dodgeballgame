// The renderer: WebGPU first (WebGL2 as a fallback), one HDR pipeline shared by fights and cutscenes.
import {
  AbstractEngine, Color3, Color4, DefaultRenderingPipeline, DirectionalLight, Engine, FreeCamera, HDRCubeTexture,
  ImageProcessingConfiguration, Scene, ShadowGenerator, SSAO2RenderingPipeline, Vector3, WebGPUEngine,
} from '@babylonjs/core';
import '@babylonjs/loaders/glTF';

export type Quality = 'low' | 'medium' | 'high';
const TIERS = {
  low: { scale: 1.6, shadow: 1024, msaa: 1, ssao: false, mirror: 384, pcss: false },
  medium: { scale: 1.2, shadow: 2048, msaa: 4, ssao: false, mirror: 640, pcss: false },
  high: { scale: 1.0, shadow: 2048, msaa: 4, ssao: true, mirror: 1024, pcss: true },
};

export interface Gfx {
  engine: AbstractEngine; scene: Scene; camera: FreeCamera; pipe: DefaultRenderingPipeline;
  key: DirectionalLight; shadow: ShadowGenerator; webgpu: boolean; quality: Quality; tier: (typeof TIERS)[Quality];
}

export async function createGfx(canvas: HTMLCanvasElement, quality: Quality, forceGL = false): Promise<Gfx> {
  let engine: AbstractEngine;
  let webgpu = false;
  if (!forceGL && (await WebGPUEngine.IsSupportedAsync)) {
    const e = new WebGPUEngine(canvas, { antialias: false, stencil: true, powerPreference: 'high-performance', adaptToDeviceRatio: false, enableAllFeatures: false, premultipliedAlpha: false });
    await e.initAsync();
    engine = e;
    webgpu = true;
  } else {
    engine = new Engine(canvas, false, { stencil: true, powerPreference: 'high-performance', adaptToDeviceRatio: false });
  }
  const tier = TIERS[quality];
  engine.setHardwareScalingLevel(tier.scale / Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // glTF space: no mirrored root node
  scene.clearColor = new Color4(0.01, 0.01, 0.015, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;

  const camera = new FreeCamera('cam', new Vector3(0, 1.4, 5), scene);
  camera.minZ = 0.1;
  camera.maxZ = 600;
  camera.fov = 0.6;
  camera.setTarget(new Vector3(0, 1.1, 0));

  const ip = scene.imageProcessingConfiguration;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = 1.0;
  ip.contrast = 1.1;

  const pipe = new DefaultRenderingPipeline('pipe', true, scene, [camera]);
  pipe.samples = tier.msaa;
  pipe.fxaaEnabled = true;
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = 0.85;
  pipe.bloomWeight = 0.35;
  pipe.bloomKernel = 64;
  pipe.bloomScale = 0.5;
  if (tier.ssao) {
    const ssao = new SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [camera]);
    ssao.radius = 0.6;
    ssao.totalStrength = 1.0;
    ssao.samples = 12;
    ssao.maxZ = 80;
  }

  const key = new DirectionalLight('key', new Vector3(-0.5, -1, -0.4).normalize(), scene);
  key.intensity = 3;
  key.autoUpdateExtends = false; // a fixed box round the fighters: every shadow texel goes to them
  key.orthoLeft = -5; key.orthoRight = 5; key.orthoTop = 5; key.orthoBottom = -5;
  key.shadowMinZ = 1; key.shadowMaxZ = 40;
  const shadow = new ShadowGenerator(tier.shadow, key);
  shadow.usePercentageCloserFiltering = !tier.pcss;
  shadow.useContactHardeningShadow = tier.pcss;
  shadow.contactHardeningLightSizeUVRatio = 0.04;
  shadow.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  shadow.bias = 0.0015;
  shadow.normalBias = 0.012;
  shadow.transparencyShadow = true;
  return { engine, scene, camera, pipe, key, shadow, webgpu, quality, tier };
}

/** Image based lighting from an equirect .hdr (prefiltered on load). */
export function setEnvironment(g: Gfx, url: string, intensity = 1, rotationY = 0): Promise<HDRCubeTexture> {
  return new Promise((resolve, reject) => {
    const tex = new HDRCubeTexture(url, g.scene, 256, false, true, false, true, () => resolve(tex), (m) => reject(new Error(m)));
    tex.rotationY = rotationY;
    g.scene.environmentTexture = tex;
    g.scene.environmentIntensity = intensity;
  });
}

/** Aim the key light and keep its shadow box centred on a point (snapped, so the shadow does not crawl). */
export function aimKey(g: Gfx, dir: Vector3, focus: Vector3, half = 5) {
  g.key.direction.copyFrom(dir).normalize();
  g.key.position.copyFrom(focus).subtractInPlace(g.key.direction.scale(20));
  g.key.orthoLeft = -half; g.key.orthoRight = half; g.key.orthoTop = half; g.key.orthoBottom = -half;
}
