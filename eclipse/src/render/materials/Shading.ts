import {
  Color3, Constants, PBRBaseMaterial, RegisterMaterialPlugin, type AbstractEngine, type Material, type MaterialDefines, type MaterialPluginBase,
  type Nullable, type RenderTargetTexture, type Scene, type UniformBuffer,
} from '@babylonjs/core';
import { EcPlugin, MatEnv, type PluginCode } from './EcPlugin';

/**
 * Scene-wide shading state: what the frame's depth pre-pass offers and how much of each screen-space
 * term the quality preset allows. Written by the Pipeline, read by every material's ShadingPlugin.
 */
export const Shade = {
  /** The camera's view-depth map (rendered before the colour pass), or null when contact shadows are off. */
  depth: null as Nullable<RenderTargetTexture>,
  /** Contact shadows: darkening 0..1, ray length scale, march steps, distance at which they have faded out. */
  contact: 0,
  contactLength: 1,
  contactSteps: 8,
  contactDistance: 45,
  /** Anti-tiling macro variation on world surfaces (0 = off). */
  macro: 1,
  frame: 0,
  /** Dev view: 1 shows the contact term, 2 the depth pre-pass against this fragment's own depth. */
  debug: 0,
};

const PLUGIN = 'EcShading';

/**
 * The game's shading model additions, on every PBR material (registered once, see `installShading`):
 *
 * - **Sun contact shadows.** The cascaded shadow map cannot resolve a boot on the ground, a strap on a
 *   cuirass or a pebble: each fragment marches a short ray toward the sun through the frame's depth
 *   pre-pass and darkens the sun's own shadow term (not the finished pixel), so fill light, local
 *   lights and reflections stay as they were. Skipped for surfaces facing away from the sun, faded
 *   with distance, and self-validating: if the depth under this pixel is not this fragment's (a
 *   reflection probe, a surface the depth pass skips) the term is 1.
 * - **Cloth fuzz** (`fuzz`): asperity scattering for rough non-metals, a soft bright rim toward
 *   grazing angles lit by the sun (wrapped) and the sky. Gear atlases mix plate and cloth in one
 *   material; the term keys on the texel's roughness and metalness so only the cloth picks it up.
 * - **Leaf translucency** (`leaf`): two-sided foliage lit from behind glows through, strongest looking
 *   toward the sun, shadowed by the canopy's own cascade shadows.
 * - **Macro variation** (`macro`): three octaves of world-space noise drift the albedo's brightness
 *   and warmth over metres, which breaks the visible repeat of tiled masonry and paving.
 */
export class ShadingPlugin extends EcPlugin {
  fuzz = 0;
  leaf = 0;
  leafTint = new Color3(0.75, 1.0, 0.35);
  macro = 0;
  /** Contact shadows on this material (off for things that never need them: sky cards, water). */
  contact = true;

  constructor(material: Material) {
    super(material, PLUGIN, 120, { EC_SHADE: false, EC_SHADE_CONTACT: false, EC_SHADE_FUZZ: false, EC_SHADE_LEAF: false, EC_SHADE_MACRO: false });
  }

  static of(material: Material | null | undefined): ShadingPlugin | null {
    return (material?.pluginManager?.getPlugin(PLUGIN) as ShadingPlugin | null) ?? null;
  }

  /** A cloned material keeps its shading setup (Babylon copies plugin state through this). */
  override copyTo(plugin: MaterialPluginBase): void {
    const p = plugin as ShadingPlugin;
    p.fuzz = this.fuzz;
    p.leaf = this.leaf;
    p.leafTint.copyFrom(this.leafTint);
    p.macro = this.macro;
    p.contact = this.contact;
  }

  /** Call after changing `fuzz` / `leaf` / `macro` / `contact` on a material that has already been drawn. */
  refresh(): void {
    this.markAllDefinesAsDirty();
  }

  override prepareDefines(defines: MaterialDefines): void {
    const contact = this.contact && Shade.contact > 0 && !!Shade.depth;
    defines.EC_SHADE_CONTACT = this.isEnabled && contact;
    defines.EC_SHADE_FUZZ = this.isEnabled && this.fuzz > 0;
    defines.EC_SHADE_LEAF = this.isEnabled && this.leaf > 0;
    defines.EC_SHADE_MACRO = this.isEnabled && this.macro > 0 && Shade.macro > 0;
    defines.EC_SHADE = defines.EC_SHADE_CONTACT || defines.EC_SHADE_FUZZ || defines.EC_SHADE_LEAF || defines.EC_SHADE_MACRO;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('ecSceneDepth');
  }

  override getUniforms() {
    return {
      ubo: [
        { name: 'ecShContact', size: 4, type: 'vec4' },
        { name: 'ecShScreen', size: 4, type: 'vec4' },
        { name: 'ecShSun', size: 4, type: 'vec4' },
        { name: 'ecShSunCol', size: 4, type: 'vec4' },
        { name: 'ecShFx', size: 4, type: 'vec4' },
        { name: 'ecShLeaf', size: 4, type: 'vec4' },
      ],
      fragment: `#ifdef EC_SHADE
uniform vec4 ecShContact;
uniform vec4 ecShScreen;
uniform vec4 ecShSun;
uniform vec4 ecShSunCol;
uniform vec4 ecShFx;
uniform vec4 ecShLeaf;
#endif`,
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, engine: AbstractEngine): void {
    if (!this.isEnabled) return;
    // only the main colour pass: the depth map belongs to the player's camera, so anything drawn into
    // another target (a light probe's cube faces) must not read it
    const main = Shade.depth ? Shade.depth.getSize().width === engine.getRenderWidth() : false;
    const contact = this.contact && Shade.depth && main ? Shade.contact : 0;
    ubo.updateFloat4('ecShContact', contact, Shade.contactLength, Shade.contactSteps, Shade.contactDistance, '');
    ubo.updateFloat4('ecShScreen', engine.getRenderWidth(), engine.getRenderHeight(), Shade.frame % 64, Shade.debug, '');
    ubo.updateFloat4('ecShSun', MatEnv.sunDir.x, MatEnv.sunDir.y, MatEnv.sunDir.z, 0, '');
    ubo.updateFloat4('ecShSunCol', MatEnv.sunColor.r, MatEnv.sunColor.g, MatEnv.sunColor.b, 0, '');
    ubo.updateFloat4('ecShFx', this.fuzz, this.leaf, this.macro * Shade.macro, 0, '');
    ubo.updateFloat4('ecShLeaf', this.leafTint.r, this.leafTint.g, this.leafTint.b, 0, '');
    if (Shade.depth) ubo.setTexture('ecSceneDepth', Shade.depth);
  }

  override getClassName(): string {
    return PLUGIN;
  }

  protected code(): PluginCode {
    // The sun is the only shadow-casting light, and Babylon computes `shadow` for a light only inside
    // its SHADOW<n> branch: code placed at the end of that branch touches the sun's term alone.
    const SUN = '!(#else\\s*shadow=1\\.;\\s*#endif\\s*aggShadow\\+=shadow;)';
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
#ifdef EC_SHADE
float ecShIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float ecShHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float ecShNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ecShHash(i), ecShHash(i + vec3(1, 0, 0)), f.x), mix(ecShHash(i + vec3(0, 1, 0)), ecShHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(ecShHash(i + vec3(0, 0, 1)), ecShHash(i + vec3(1, 0, 1)), f.x), mix(ecShHash(i + vec3(0, 1, 1)), ecShHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
#ifdef EC_SHADE_CONTACT
uniform sampler2D ecSceneDepth;
float ecContactShadow(vec3 P, vec3 N) {
  vec3 L = ecShSun.xyz;
  if (ecShContact.x <= 0.0 || dot(N, L) <= 0.02) return 1.0;
  vec2 uv0 = gl_FragCoord.xy / ecShScreen.xy;
  float d0 = abs((view * vec4(P, 1.0)).z);
  float s0 = abs(texture2D(ecSceneDepth, uv0).r);
  if (s0 < 1e-4 || abs(s0 - d0) > 0.05 + 0.02 * d0) return 1.0;
  float fade = 1.0 - smoothstep(ecShContact.w * 0.6, ecShContact.w, d0);
  if (fade <= 0.0) return 1.0;
  vec4 c0 = viewProjection * vec4(P, 1.0);
  vec2 n0 = c0.xy / c0.w;
  float fy = abs((0.5 - n0.y * 0.5) - uv0.y) < abs((n0.y * 0.5 + 0.5) - uv0.y) ? -1.0 : 1.0;
  float len = clamp(0.035 * d0, 0.2, 1.2) * ecShContact.y;
  float steps = ecShContact.z;
  float jitter = ecShIgn(gl_FragCoord.xy + ecShScreen.z * 5.588);
  vec3 origin = P + N * (0.012 + 0.0016 * d0);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    if (float(i) >= steps) break;
    float t = (float(i) + jitter) / steps;
    vec3 p = origin + L * (len * (t * t * 0.75 + t * 0.25));
    vec4 c = viewProjection * vec4(p, 1.0);
    vec2 uv = uv0 + (c.xy / c.w - n0) * vec2(0.5, 0.5 * fy);
    if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) break;
    float s = abs(texture2D(ecSceneDepth, uv).r);
    float delta = abs((view * vec4(p, 1.0)).z) - s;
    if (s > 1e-4 && delta > 0.012 + 0.0025 * d0 && delta < 0.25 + 0.02 * d0) occ = max(occ, 1.0 - t * 0.5);
  }
  return 1.0 - occ * fade * ecShContact.x;
}
#endif
#endif`,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `
#ifdef EC_SHADE_MACRO
{
  float ecM1 = ecShNoise(vPositionW * 0.23) - 0.5;
  float ecM2 = ecShNoise(vPositionW * 0.061 + 7.3) - 0.5;
  float ecM3 = ecShNoise(vPositionW * 0.9 + 3.1) - 0.5;
  float ecMv = (ecM1 * 0.7 + ecM2 + ecM3 * 0.3) * ecShFx.z;
  surfaceAlbedo *= max(1.0 + ecMv * 0.8, 0.4) * mix(vec3(1.0), vec3(1.08, 1.0, 0.88), clamp(ecM2 * 2.4 * ecShFx.z, -1.0, 1.0));
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: /* glsl */ `
#ifdef EC_SHADE
float ecSunShadow = 1.0;
float ecContact = 1.0;
#ifdef EC_SHADE_CONTACT
ecContact = ecContactShadow(vPositionW, geometricNormalW);
#endif
#endif`,
          [SUN]: /* glsl */ `
#ifdef EC_SHADE
shadow *= ecContact;
ecSunShadow = shadow;
#endif
$1`,
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: /* glsl */ `
#ifdef EC_SHADE_CONTACT
if (ecShScreen.w > 1.5) {
  float ecD0 = abs((view * vec4(vPositionW, 1.0)).z);
  float ecS0 = abs(texture2D(ecSceneDepth, gl_FragCoord.xy / ecShScreen.xy).r);
  finalColor = vec4(abs(ecS0 - ecD0) * 4.0, fract(ecS0 * 0.2), fract(ecD0 * 0.2), 1.0);
} else if (ecShScreen.w > 0.5) {
  finalColor = vec4(vec3(ecContact * 0.6), 1.0);
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `
#if defined(EC_SHADE) && !defined(UNLIT)
{
  vec3 ecL = ecShSun.xyz;
#ifdef EC_SHADE_FUZZ
  float ecMetal = 0.0;
#ifdef METALLICWORKFLOW
  ecMetal = reflectivityOut.metallic;
#endif
  float ecFz = pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.0) * (1.0 - ecMetal) * smoothstep(0.5, 0.85, roughness) * ecShFx.x;
  vec3 ecFzLight = ecShSunCol.rgb * clamp(dot(normalW, ecL) * 0.5 + 0.5, 0.0, 1.0) * mix(0.25, 1.0, ecSunShadow);
#ifdef REFLECTION
  ecFzLight += reflectionOut.environmentIrradiance;
#endif
  finalDiffuse += (surfaceAlbedo * 0.7 + vec3(0.1)) * ecFz * ecFzLight * 0.4;
#endif
#ifdef EC_SHADE_LEAF
  float ecBack = max(dot(-normalW, ecL), 0.0);
  float ecThrough = pow(max(dot(viewDirectionW, -ecL), 0.0), 3.0);
  finalDiffuse += surfaceAlbedo * ecShLeaf.rgb * ecShSunCol.rgb * ecSunShadow * ecBack * (0.55 + 0.9 * ecThrough) * ecShFx.y;
#endif
}
#endif`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: /* wgsl */ `
#ifdef EC_SHADE
fn ecShIgn(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn ecShHash(q: vec3f) -> f32 { var p = fract(q * 0.3183099 + 0.1); p = p * 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
fn ecShNoise(x: vec3f) -> f32 {
  let i = floor(x); var f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ecShHash(i), ecShHash(i + vec3f(1, 0, 0)), f.x), mix(ecShHash(i + vec3f(0, 1, 0)), ecShHash(i + vec3f(1, 1, 0)), f.x), f.y),
             mix(mix(ecShHash(i + vec3f(0, 0, 1)), ecShHash(i + vec3f(1, 0, 1)), f.x), mix(ecShHash(i + vec3f(0, 1, 1)), ecShHash(i + vec3f(1, 1, 1)), f.x), f.y), f.z);
}
#ifdef EC_SHADE_CONTACT
var ecSceneDepthSampler: sampler;
var ecSceneDepth: texture_2d<f32>;
fn ecContactShadow(P: vec3f, N: vec3f, frag: vec2f) -> f32 {
  let L = uniforms.ecShSun.xyz;
  if (uniforms.ecShContact.x <= 0.0 || dot(N, L) <= 0.02) { return 1.0; }
  let uv0 = frag / uniforms.ecShScreen.xy;
  let d0 = abs((scene.view * vec4f(P, 1.0)).z);
  let s0 = abs(textureSampleLevel(ecSceneDepth, ecSceneDepthSampler, uv0, 0.0).r);
  if (s0 < 1e-4 || abs(s0 - d0) > 0.05 + 0.02 * d0) { return 1.0; }
  let fade = 1.0 - smoothstep(uniforms.ecShContact.w * 0.6, uniforms.ecShContact.w, d0);
  if (fade <= 0.0) { return 1.0; }
  let c0 = scene.viewProjection * vec4f(P, 1.0);
  let n0 = c0.xy / c0.w;
  var fy = 1.0;
  if (abs((0.5 - n0.y * 0.5) - uv0.y) < abs((n0.y * 0.5 + 0.5) - uv0.y)) { fy = -1.0; }
  let len = clamp(0.035 * d0, 0.2, 1.2) * uniforms.ecShContact.y;
  let steps = uniforms.ecShContact.z;
  let jitter = ecShIgn(frag + uniforms.ecShScreen.z * 5.588);
  let origin = P + N * (0.012 + 0.0016 * d0);
  var occ = 0.0;
  for (var i = 0; i < 16; i++) {
    if (f32(i) >= steps) { break; }
    let t = (f32(i) + jitter) / steps;
    let p = origin + L * (len * (t * t * 0.75 + t * 0.25));
    let c = scene.viewProjection * vec4f(p, 1.0);
    let uv = uv0 + (c.xy / c.w - n0) * vec2f(0.5, 0.5 * fy);
    if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0) { break; }
    let s = abs(textureSampleLevel(ecSceneDepth, ecSceneDepthSampler, uv, 0.0).r);
    let delta = abs((scene.view * vec4f(p, 1.0)).z) - s;
    if (s > 1e-4 && delta > 0.012 + 0.0025 * d0 && delta < 0.25 + 0.02 * d0) { occ = max(occ, 1.0 - t * 0.5); }
  }
  return 1.0 - occ * fade * uniforms.ecShContact.x;
}
#endif
#endif`,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* wgsl */ `
#ifdef EC_SHADE_MACRO
{
  let ecM1 = ecShNoise(fragmentInputs.vPositionW * 0.23) - 0.5;
  let ecM2 = ecShNoise(fragmentInputs.vPositionW * 0.061 + 7.3) - 0.5;
  let ecM3 = ecShNoise(fragmentInputs.vPositionW * 0.9 + 3.1) - 0.5;
  let ecMv = (ecM1 * 0.7 + ecM2 + ecM3 * 0.3) * uniforms.ecShFx.z;
  surfaceAlbedo = surfaceAlbedo * max(1.0 + ecMv * 0.8, 0.4) * mix(vec3f(1.0), vec3f(1.08, 1.0, 0.88), clamp(ecM2 * 2.4 * uniforms.ecShFx.z, -1.0, 1.0));
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_LIGHTS: /* wgsl */ `
#ifdef EC_SHADE
var ecSunShadow: f32 = 1.0;
var ecContact: f32 = 1.0;
#ifdef EC_SHADE_CONTACT
ecContact = ecContactShadow(fragmentInputs.vPositionW, geometricNormalW, fragmentInputs.position.xy);
#endif
#endif`,
          [SUN]: /* wgsl */ `
#ifdef EC_SHADE
shadow *= ecContact;
ecSunShadow = shadow;
#endif
$1`,
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: /* wgsl */ `
#ifdef EC_SHADE_CONTACT
if (uniforms.ecShScreen.w > 1.5) {
  let ecD0 = abs((scene.view * vec4f(fragmentInputs.vPositionW, 1.0)).z);
  let ecS0 = abs(textureSampleLevel(ecSceneDepth, ecSceneDepthSampler, fragmentInputs.position.xy / uniforms.ecShScreen.xy, 0.0).r);
  finalColor = vec4f(abs(ecS0 - ecD0) * 4.0, fract(ecS0 * 0.2), fract(ecD0 * 0.2), 1.0);
} else if (uniforms.ecShScreen.w > 0.5) {
  finalColor = vec4f(vec3f(ecContact * 0.6), 1.0);
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* wgsl */ `
#if defined(EC_SHADE) && !defined(UNLIT)
{
  let ecL = uniforms.ecShSun.xyz;
#ifdef EC_SHADE_FUZZ
  var ecMetal: f32 = 0.0;
#ifdef METALLICWORKFLOW
  ecMetal = reflectivityOut.metallic;
#endif
  let ecFz = pow(1.0 - clamp(NdotV, 0.0, 1.0), 3.0) * (1.0 - ecMetal) * smoothstep(0.5, 0.85, roughness) * uniforms.ecShFx.x;
  var ecFzLight = uniforms.ecShSunCol.rgb * clamp(dot(normalW, ecL) * 0.5 + 0.5, 0.0, 1.0) * mix(0.25, 1.0, ecSunShadow);
#ifdef REFLECTION
  ecFzLight += reflectionOut.environmentIrradiance;
#endif
  finalDiffuse += (surfaceAlbedo * 0.7 + vec3f(0.1)) * ecFz * ecFzLight * 0.4;
#endif
#ifdef EC_SHADE_LEAF
  let ecBack = max(dot(-normalW, ecL), 0.0);
  let ecThrough = pow(max(dot(viewDirectionW, -ecL), 0.0), 3.0);
  finalDiffuse += surfaceAlbedo * uniforms.ecShLeaf.rgb * uniforms.ecShSunCol.rgb * ecSunShadow * ecBack * (0.55 + 0.9 * ecThrough) * uniforms.ecShFx.y;
#endif
}
#endif`,
        },
      },
    };
  }
}

let installed = false;

/**
 * Registers the shading plugin for every PBR material created from now on (call once, before any
 * material exists) and turns on geometric specular anti-aliasing, which widens the highlight where
 * the normal changes faster than a pixel instead of letting it sparkle.
 */
export function installShading(): void {
  if (installed) return;
  installed = true;
  RegisterMaterialPlugin(PLUGIN, (material) => {
    if (!(material instanceof PBRBaseMaterial)) return null;
    // (the material is still inside its constructor here; its own field defaults land after this)
    queueMicrotask(() => {
      (material as PBRBaseMaterial & { enableSpecularAntiAliasing?: boolean }).enableSpecularAntiAliasing = true;
    });
    return new ShadingPlugin(material);
  });
}

/** Re-evaluates every material's shading defines (after a quality change switches a term on or off). */
export function refreshShading(scene: Scene): void {
  scene.markAllMaterialsAsDirty(Constants.MATERIAL_MiscDirtyFlag);
  for (const m of scene.materials) ShadingPlugin.of(m)?.refresh();
}
