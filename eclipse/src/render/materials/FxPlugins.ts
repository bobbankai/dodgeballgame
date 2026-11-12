import { Color3, Vector2, type Material, type MaterialDefines, type UniformBuffer } from '@babylonjs/core';
import { EcPlugin, MatEnv, type PluginCode } from './EcPlugin';
import { NOISE_FN_GLSL, NOISE_FN_WGSL } from './SurfaceLayers';

/**
 * Dissolve: noise-driven burn-away with a glowing edge (enemy deaths, boss phase changes, Ithra's
 * visions). `amount` 0 = solid, 1 = gone.
 */
export class DissolvePlugin extends EcPlugin {
  amount = 0;
  edge = 0.06;
  color = new Color3(1.0, 0.45, 0.1);
  intensity = 6;
  scale = 3.0;

  constructor(material: Material) {
    super(material, 'EcDissolve', 130, { EC_DISSOLVE: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_DISSOLVE = this.isEnabled && this.amount > 0;
  }
  override getUniforms() {
    return {
      ubo: [{ name: 'ecDis', size: 4, type: 'vec4' }, { name: 'ecDisColor', size: 3, type: 'vec3' }],
      fragment: `#ifdef EC_DISSOLVE
uniform vec4 ecDis;
uniform vec3 ecDisColor;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    ubo.updateFloat4('ecDis', this.amount, this.edge, this.intensity, this.scale, '');
    ubo.updateColor3('ecDisColor', this.color, '');
  }
  setAmount(v: number): void {
    const was = this.amount > 0;
    this.amount = v;
    if (was !== v > 0) this.markAllDefinesAsDirty();
  }
  override getClassName(): string {
    return 'EcDissolve';
  }
  protected code(): PluginCode {
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_GLSL,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* glsl */ `
#ifdef EC_DISSOLVE
float ecDisN = ecFbm(vPositionW.xz * ecDis.w + vPositionW.y * ecDis.w * 0.8) * 0.75 + ecFbm(vPositionW.zy * ecDis.w * 1.7) * 0.25;
if (ecDisN < ecDis.x) discard;
float ecDisEdge = 1.0 - smoothstep(0.0, ecDis.y, ecDisN - ecDis.x);
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `
#ifdef EC_DISSOLVE
finalEmissive += ecDisColor * ecDisEdge * ecDis.z;
finalDiffuse *= 1.0 - ecDisEdge * 0.8;
#endif`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_WGSL,
          CUSTOM_FRAGMENT_UPDATE_ALPHA: /* wgsl */ `
#ifdef EC_DISSOLVE
let ecWp = fragmentInputs.vPositionW;
let ecDisN = ecFbm(ecWp.xz * uniforms.ecDis.w + ecWp.y * uniforms.ecDis.w * 0.8) * 0.75 + ecFbm(ecWp.zy * uniforms.ecDis.w * 1.7) * 0.25;
if (ecDisN < uniforms.ecDis.x) { discard; }
let ecDisEdge = 1.0 - smoothstep(0.0, uniforms.ecDis.y, ecDisN - uniforms.ecDis.x);
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* wgsl */ `
#ifdef EC_DISSOLVE
finalEmissive += uniforms.ecDisColor * ecDisEdge * uniforms.ecDis.z;
finalDiffuse *= 1.0 - ecDisEdge * 0.8;
#endif`,
        },
      },
    };
  }
}

/**
 * Animated emission: pulsing, flowing noise through the emissive mask (lava, godspark seams,
 * magic runes) and a Fresnel rim (energy shields, spirits).
 */
export class EmissiveFxPlugin extends EcPlugin {
  pulseSpeed = 2;
  pulseAmount = 0.25;
  flowSpeed = 0.15;
  flowScale = 1.5;
  /** How much the flow noise modulates the emission (0 = steady). */
  flowAmount = 0.6;
  rimPower = 3;
  rimStrength = 0;
  rimColor = new Color3(1, 0.8, 0.5);
  intensity = 1;

  constructor(material: Material) {
    super(material, 'EcEmissiveFx', 140, { EC_EMFX: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_EMFX = this.isEnabled;
  }
  override getUniforms() {
    return {
      ubo: [
        { name: 'ecFxA', size: 4, type: 'vec4' },
        { name: 'ecFxB', size: 4, type: 'vec4' },
        { name: 'ecFxRim', size: 4, type: 'vec4' },
      ],
      fragment: `#ifdef EC_EMFX
uniform vec4 ecFxA;
uniform vec4 ecFxB;
uniform vec4 ecFxRim;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    ubo.updateFloat4('ecFxA', this.pulseSpeed, this.pulseAmount, this.flowSpeed, this.flowScale, '');
    ubo.updateFloat4('ecFxB', this.rimPower, this.rimStrength, MatEnv.time, this.intensity, '');
    ubo.updateFloat4('ecFxRim', this.rimColor.r, this.rimColor.g, this.rimColor.b, this.flowAmount, '');
  }
  override getClassName(): string {
    return 'EcEmissiveFx';
  }
  protected code(): PluginCode {
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_GLSL,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `
#ifdef EC_EMFX
{
  float t = ecFxB.z;
  vec3 wp = vPositionW;
  float pulse = 1.0 + ecFxA.y * sin(t * ecFxA.x + wp.y * 1.7 + wp.x * 0.4);
  float flow = ecFbm(wp.xz * ecFxA.w + vec2(t * ecFxA.z, -t * ecFxA.z * 0.7) + wp.y * 0.5);
  float fl = mix(1.0, 0.3 + 1.4 * flow * flow, ecFxRim.w);
  finalEmissive *= pulse * fl * ecFxB.w;
  float rim = pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), ecFxB.x) * ecFxB.y;
  finalEmissive += ecFxRim.rgb * rim * pulse;
}
#endif`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_WGSL,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* wgsl */ `
#ifdef EC_EMFX
{
  let t = uniforms.ecFxB.z;
  let wp = fragmentInputs.vPositionW;
  let pulse = 1.0 + uniforms.ecFxA.y * sin(t * uniforms.ecFxA.x + wp.y * 1.7 + wp.x * 0.4);
  let flow = ecFbm(wp.xz * uniforms.ecFxA.w + vec2f(t * uniforms.ecFxA.z, -t * uniforms.ecFxA.z * 0.7) + wp.y * 0.5);
  let fl = mix(1.0, 0.3 + 1.4 * flow * flow, uniforms.ecFxRim.w);
  finalEmissive *= pulse * fl * uniforms.ecFxB.w;
  let rim = pow(1.0 - clamp(dot(normalW, viewDirectionW), 0.0, 1.0), uniforms.ecFxB.x) * uniforms.ecFxB.y;
  finalEmissive += uniforms.ecFxRim.rgb * rim * pulse;
}
#endif`,
        },
      },
    };
  }
}

/**
 * Skin: a pre-integrated-style subsurface term (light wraps past the terminator and turns red, as
 * in skin lit by a low sun), plus back-light transmission through thin parts (ears, nostrils).
 * Use with a low clear-coat for the second, sharper "oily" specular lobe.
 */
export class SkinPlugin extends EcPlugin {
  scatter = 0.85;
  wrap = 0.55;
  transmission = 0.35;
  tint = new Color3(0.95, 0.28, 0.16);

  constructor(material: Material) {
    super(material, 'EcSkin', 150, { EC_SKIN: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_SKIN = this.isEnabled;
  }
  override getUniforms() {
    return {
      ubo: [
        { name: 'ecSkin', size: 4, type: 'vec4' },
        { name: 'ecSkinTint', size: 3, type: 'vec3' },
        { name: 'ecSunDir', size: 3, type: 'vec3' },
        { name: 'ecSunCol', size: 3, type: 'vec3' },
      ],
      fragment: `#ifdef EC_SKIN
uniform vec4 ecSkin;
uniform vec3 ecSkinTint;
uniform vec3 ecSunDir;
uniform vec3 ecSunCol;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    ubo.updateFloat4('ecSkin', this.scatter, this.wrap, this.transmission, 0, '');
    ubo.updateColor3('ecSkinTint', this.tint, '');
    ubo.updateFloat3('ecSunDir', MatEnv.sunDir.x, MatEnv.sunDir.y, MatEnv.sunDir.z, '');
    ubo.updateColor3('ecSunCol', MatEnv.sunColor, '');
  }
  override getClassName(): string {
    return 'EcSkin';
  }
  protected code(): PluginCode {
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `
#if defined(EC_SKIN) && !defined(UNLIT)
{
  float vis = clamp(aggShadow * numLights - (numLights - 1.0), 0.0, 1.0);
  float ndl = dot(normalW, ecSunDir);
  float w = ecSkin.y;
  float wrapped = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
  float band = max(wrapped * wrapped - clamp(ndl, 0.0, 1.0), 0.0);
  vec3 sss = ecSkinTint * band * ecSkin.x;
  float back = pow(clamp(dot(viewDirectionW, -ecSunDir), 0.0, 1.0), 6.0) * (1.0 - abs(dot(normalW, viewDirectionW)));
  sss += ecSkinTint * back * ecSkin.z;
  finalDiffuse += sss * surfaceAlbedo * ecSunCol * mix(0.25, 1.0, vis);
}
#endif`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* wgsl */ `
#if defined(EC_SKIN) && !defined(UNLIT)
{
  let vis = clamp(aggShadow * numLights - (numLights - 1.0), 0.0, 1.0);
  let ndl = dot(normalW, uniforms.ecSunDir);
  let w = uniforms.ecSkin.y;
  let wrapped = clamp((ndl + w) / (1.0 + w), 0.0, 1.0);
  let band = max(wrapped * wrapped - clamp(ndl, 0.0, 1.0), 0.0);
  var sss = uniforms.ecSkinTint * band * uniforms.ecSkin.x;
  let back = pow(clamp(dot(viewDirectionW, -uniforms.ecSunDir), 0.0, 1.0), 6.0) * (1.0 - abs(dot(normalW, viewDirectionW)));
  sss += uniforms.ecSkinTint * back * uniforms.ecSkin.z;
  finalDiffuse += sss * surfaceAlbedo * uniforms.ecSunCol * mix(0.25, 1.0, vis);
}
#endif`,
        },
      },
    };
  }
}

/**
 * Hair cards: Kajiya-Kay dual specular (a white primary lobe shifted towards the root, a tinted
 * secondary lobe shifted towards the tip, as in Marschner's R and TRT) along the strand direction
 * (UV v), plus forward scattering when back-lit. Pair with a lowered F0 so the isotropic GGX
 * highlight does not dominate.
 */
export class HairPlugin extends EcPlugin {
  shift1 = -0.08;
  shift2 = 0.12;
  exp1 = 180;
  exp2 = 40;
  // The terms are added in HDR and multiplied by the sun's colour * intensity (4 and more), so the
  // strengths are small: 0.35 / 0.6 blew the crown out to white speckle.
  strength1 = 0.03;
  strength2 = 0.2;
  scatter = 0.3;

  constructor(material: Material) {
    super(material, 'EcHair', 150, { EC_HAIR: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_HAIR = this.isEnabled;
  }
  override getUniforms() {
    return {
      ubo: [
        { name: 'ecHairA', size: 4, type: 'vec4' },
        { name: 'ecHairB', size: 4, type: 'vec4' },
        { name: 'ecHSunDir', size: 3, type: 'vec3' },
        { name: 'ecHSunCol', size: 3, type: 'vec3' },
      ],
      fragment: `#ifdef EC_HAIR
uniform vec4 ecHairA;
uniform vec4 ecHairB;
uniform vec3 ecHSunDir;
uniform vec3 ecHSunCol;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    ubo.updateFloat4('ecHairA', this.shift1, this.shift2, this.exp1, this.exp2, '');
    ubo.updateFloat4('ecHairB', this.strength1, this.strength2, this.scatter, 0, '');
    ubo.updateFloat3('ecHSunDir', MatEnv.sunDir.x, MatEnv.sunDir.y, MatEnv.sunDir.z, '');
    ubo.updateColor3('ecHSunCol', MatEnv.sunColor, '');
  }
  override getClassName(): string {
    return 'EcHair';
  }
  protected code(): PluginCode {
    return {
      glsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: /* glsl */ `
#ifdef EC_HAIR
float ecKK(vec3 T, vec3 N, vec3 H, float shift, float e) {
  vec3 t = normalize(T + N * shift);
  float th = dot(t, H);
  return pow(sqrt(max(1.0 - th * th, 0.0)), e) * smoothstep(-1.0, 0.0, th);
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* glsl */ `
#if defined(EC_HAIR) && defined(ALBEDO) && !defined(UNLIT)
{
  vec3 dp1 = dFdx(vPositionW), dp2 = dFdy(vPositionW);
  vec2 du1 = dFdx(vAlbedoUV), du2 = dFdy(vAlbedoUV);
  vec3 T = dp2 * du1.x - dp1 * du2.x;
  T = normalize(T - normalW * dot(T, normalW) + 1e-6);
  vec3 H = normalize(ecHSunDir + viewDirectionW);
  float vis = clamp(aggShadow * numLights - (numLights - 1.0), 0.0, 1.0);
  float ndl = clamp(dot(normalW, ecHSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float s1 = ecKK(T, normalW, H, ecHairA.x, ecHairA.z) * ecHairB.x;
  float s2 = ecKK(T, normalW, H, ecHairA.y, ecHairA.w) * ecHairB.y;
  vec3 spec = (vec3(s1) + s2 * surfaceAlbedo * 1.6) * ndl;
  float fwd = pow(clamp(dot(-viewDirectionW, ecHSunDir), 0.0, 1.0), 4.0) * ecHairB.z;
  finalDiffuse += (spec + surfaceAlbedo * fwd) * ecHSunCol * vis;
}
#endif`,
        },
      },
      wgsl: {
        fragment: {
          CUSTOM_FRAGMENT_DEFINITIONS: /* wgsl */ `
#ifdef EC_HAIR
fn ecKK(T: vec3f, N: vec3f, H: vec3f, shift: f32, e: f32) -> f32 {
  let t = normalize(T + N * shift);
  let th = dot(t, H);
  return pow(sqrt(max(1.0 - th * th, 0.0)), e) * smoothstep(-1.0, 0.0, th);
}
#endif`,
          CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: /* wgsl */ `
#if defined(EC_HAIR) && defined(ALBEDO) && !defined(UNLIT)
{
  let dp1 = dpdx(fragmentInputs.vPositionW);
  let dp2 = dpdy(fragmentInputs.vPositionW);
  let du1 = dpdx(fragmentInputs.vAlbedoUV);
  let du2 = dpdy(fragmentInputs.vAlbedoUV);
  var T = dp2 * du1.x - dp1 * du2.x;
  T = normalize(T - normalW * dot(T, normalW) + 1e-6);
  let H = normalize(uniforms.ecHSunDir + viewDirectionW);
  let vis = clamp(aggShadow * numLights - (numLights - 1.0), 0.0, 1.0);
  let ndl = clamp(dot(normalW, uniforms.ecHSunDir) * 0.5 + 0.5, 0.0, 1.0);
  let s1 = ecKK(T, normalW, H, uniforms.ecHairA.x, uniforms.ecHairA.z) * uniforms.ecHairB.x;
  let s2 = ecKK(T, normalW, H, uniforms.ecHairA.y, uniforms.ecHairA.w) * uniforms.ecHairB.y;
  let spec = (vec3f(s1) + s2 * surfaceAlbedo * 1.6) * ndl;
  let fwd = pow(clamp(dot(-viewDirectionW, uniforms.ecHSunDir), 0.0, 1.0), 4.0) * uniforms.ecHairB.z;
  finalDiffuse += (spec + surfaceAlbedo * fwd) * uniforms.ecHSunCol * vis;
}
#endif`,
        },
      },
    };
  }
}

/**
 * Wind for vegetation, banners and cloth props: a layered sway (trunk bend weighted by height,
 * gusts travelling across the world) and a high-frequency flutter along the normal for leaves.
 */
export class WindPlugin extends EcPlugin {
  /** Object-space height at which bending reaches full strength. */
  bendHeight = 4;
  flutter = 0.03;
  stiffness = 1;

  constructor(material: Material) {
    super(material, 'EcWind', 110, { EC_WIND: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_WIND = this.isEnabled;
  }
  override getUniforms() {
    return {
      ubo: [{ name: 'ecWindA', size: 4, type: 'vec4' }, { name: 'ecWindB', size: 4, type: 'vec4' }],
      vertex: `#ifdef EC_WIND
uniform vec4 ecWindA;
uniform vec4 ecWindB;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    const w = MatEnv.wind;
    ubo.updateFloat4('ecWindA', w.x, w.z, MatEnv.windStrength / this.stiffness, MatEnv.time, '');
    ubo.updateFloat4('ecWindB', this.bendHeight, this.flutter, 0, 0, '');
  }
  override getClassName(): string {
    return 'EcWind';
  }
  protected code(): PluginCode {
    return {
      glsl: {
        vertex: {
          CUSTOM_VERTEX_UPDATE_POSITION: /* glsl */ `
#ifdef EC_WIND
{
#ifdef INSTANCES
  mat4 ecW = mat4(world0, world1, world2, world3);
#else
  mat4 ecW = world;
#endif
  vec3 ip = ecW[3].xyz;
  vec3 wdir = normalize(transpose(mat3(ecW)) * vec3(ecWindA.x, 0.0, ecWindA.y));
  float h = clamp(positionUpdated.y / ecWindB.x, 0.0, 1.0); h *= h;
  float t = ecWindA.w;
  float ph = dot(ip.xz, vec2(0.13, 0.17));
  float gust = 0.55 + 0.45 * sin(t * 0.45 - dot(ip.xz, vec2(ecWindA.x, ecWindA.y)) * 0.05);
  float sway = sin(t * 1.3 + ph) * 0.6 + sin(t * 2.71 + ph * 1.7) * 0.25;
  vec3 off = wdir * ecWindA.z * h * (0.6 + sway) * gust;
  positionUpdated += off;
  positionUpdated.y -= dot(off, off) * 0.25;
#ifdef NORMAL
  float fl = sin(t * 9.0 + dot(positionUpdated, vec3(7.1, 5.3, 3.7))) * ecWindB.y * h * gust;
  positionUpdated += normalUpdated * fl;
#endif
}
#endif`,
        },
      },
      wgsl: {
        vertex: {
          CUSTOM_VERTEX_UPDATE_POSITION: /* wgsl */ `
#ifdef EC_WIND
{
#ifdef INSTANCES
  let ecW = mat4x4f(vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#else
  let ecW = mesh.world;
#endif
  let ip = ecW[3].xyz;
  let m3 = mat3x3f(ecW[0].xyz, ecW[1].xyz, ecW[2].xyz);
  let wdir = normalize(transpose(m3) * vec3f(uniforms.ecWindA.x, 0.0, uniforms.ecWindA.y));
  var h = clamp(positionUpdated.y / uniforms.ecWindB.x, 0.0, 1.0); h *= h;
  let t = uniforms.ecWindA.w;
  let ph = dot(ip.xz, vec2f(0.13, 0.17));
  let gust = 0.55 + 0.45 * sin(t * 0.45 - dot(ip.xz, vec2f(uniforms.ecWindA.x, uniforms.ecWindA.y)) * 0.05);
  let sway = sin(t * 1.3 + ph) * 0.6 + sin(t * 2.71 + ph * 1.7) * 0.25;
  let off = wdir * uniforms.ecWindA.z * h * (0.6 + sway) * gust;
  positionUpdated += off;
  positionUpdated.y -= dot(off, off) * 0.25;
#ifdef NORMAL
  let fl = sin(t * 9.0 + dot(positionUpdated, vec3f(7.1, 5.3, 3.7))) * uniforms.ecWindB.y * h * gust;
  positionUpdated += normalUpdated * fl;
#endif
}
#endif`,
        },
      },
    };
  }
}

/**
 * Molten rock: plates of cooling crust (the material's own dark rock albedo) drifting slowly over
 * glowing lava, with bright seams between the plates and open molten pools. The flow is a
 * domain-warped noise field in world XZ, so any flat or gently sloped mesh becomes a lava surface.
 * Emission is HDR (bloom picks it up) and ramps dark red -> orange -> yellow-white with heat.
 */
export class LavaPlugin extends EcPlugin {
  /** Flow speed (m/s) and direction. */
  flow = new Vector2(0.12, 0.05);
  /** Size of the crust plates (metres). */
  plate = 2.6;
  /** 0..1: how much of the surface is open molten pool. */
  molten = 0.35;
  intensity = 6;

  constructor(material: Material) {
    super(material, 'EcLava', 150, { EC_LAVA: false });
  }
  override prepareDefines(defines: MaterialDefines): void {
    defines.EC_LAVA = this.isEnabled;
  }
  override getUniforms() {
    return {
      ubo: [{ name: 'ecLava', size: 4, type: 'vec4' }, { name: 'ecLavaB', size: 4, type: 'vec4' }],
      fragment: `#ifdef EC_LAVA
uniform vec4 ecLava;
uniform vec4 ecLavaB;
#endif`,
    };
  }
  override bindForSubMesh(ubo: UniformBuffer): void {
    if (!this.isEnabled) return;
    ubo.updateFloat4('ecLava', this.flow.x, this.flow.y, 1 / this.plate, this.molten, '');
    ubo.updateFloat4('ecLavaB', MatEnv.time, this.intensity, 0, 0, '');
  }
  override getClassName(): string {
    return 'EcLava';
  }
  protected code(): PluginCode {
    const body = (L: 'glsl' | 'wgsl') => {
      const v2 = L === 'glsl' ? 'vec2' : 'vec2f';
      const v3 = L === 'glsl' ? 'vec3' : 'vec3f';
      const u = (n: string) => (L === 'glsl' ? n : `uniforms.${n}`);
      const decl = (n: string) => (L === 'glsl' ? `float ${n}` : `let ${n}`);
      const declv = (n: string) => (L === 'glsl' ? `${v2} ${n}` : `let ${n}`);
      const wp = L === 'glsl' ? 'vPositionW' : 'fragmentInputs.vPositionW';
      return `
#ifdef EC_LAVA
{
  ${decl('t')} = ${u('ecLavaB')}.x;
  ${declv('p')} = ${wp}.xz * ${u('ecLava')}.z - ${u('ecLava')}.xy * t * ${u('ecLava')}.z;
  ${declv('warp')} = ${v2}(ecFbm(p * 0.7 + ${v2}(t * 0.03, 0.0)), ecFbm(p * 0.7 + ${v2}(5.2, 1.3 - t * 0.02)));
  ${decl('n')} = ecFbm(p + warp * 1.3);
  // seams between crust plates, and open pools where the large-scale field runs hot
  ${decl('seam')} = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
  ${decl('pool')} = smoothstep(1.0 - ${u('ecLava')}.w - 0.1, 1.0 - ${u('ecLava')}.w + 0.12, ecFbm(p * 0.3 + warp * 0.4 + ${v2}(t * 0.01, 0.0)));
  ${decl('heat')} = clamp(max(seam * (0.6 + 0.4 * ecFbm(p * 3.0 + t * 0.2)), pool), 0.0, 1.0);
  ${decl('pulse')} = 0.85 + 0.15 * sin(t * 1.7 + n * 12.0);
  ${L === 'glsl' ? 'vec3' : 'let'} ramp = mix(${v3}(0.35, 0.02, 0.0), ${v3}(1.0, 0.32, 0.04), smoothstep(0.0, 0.55, heat));
  ${L === 'glsl' ? 'vec3' : 'let'} hot = mix(ramp, ${v3}(1.0, 0.82, 0.45), smoothstep(0.75, 1.0, heat));
  finalEmissive += hot * heat * heat * ${u('ecLavaB')}.y * pulse;
}
#endif`;
    };
    return {
      glsl: { fragment: { CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_GLSL, CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: body('glsl') } },
      wgsl: { fragment: { CUSTOM_FRAGMENT_DEFINITIONS: NOISE_FN_WGSL, CUSTOM_FRAGMENT_BEFORE_FINALCOLORCOMPOSITION: body('wgsl') } },
    };
  }
}
