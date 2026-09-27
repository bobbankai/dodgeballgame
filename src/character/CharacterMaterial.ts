import * as THREE from 'three';
import { Appearance, SLOT, SLOT_COUNT } from './Appearance';
import { headCentre } from './sculpt/Anatomy';

const HEAD_C = headCentre();
let blankJersey: THREE.Texture | null = null;

/**
 * Palette-driven PBR material for athletes. One shared shader program for every
 * character; each athlete has its own uniform values (team colours, flash, dissolve...).
 * Per-slot roughness/metalness give distinct fabric/skin/rubber/eye responses.
 */
export class CharacterMaterial extends THREE.MeshStandardMaterial {
  readonly slotColors: THREE.Vector3[];
  readonly slotRough: number[];
  readonly slotMetal: number[];
  readonly slotEmissive: number[];
  /** per-slot shading model weights: subsurface (skin) and sheen (fabric/hair) */
  readonly slotSSS: number[];
  readonly slotSheen: number[];
  readonly u = {
    uRimColor: { value: new THREE.Color(0.6, 0.75, 1) },
    uRimStrength: { value: 0.18 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(0.4, 0.9, 1) },
    uEnergy: { value: 0 },
    uEnergyColor: { value: new THREE.Color(1, 0.5, 0.1) },
    uTime: { value: 0 },
    uGlowStrength: { value: 0 },
    uGhost: { value: 0 },
    // face: x blink (0 open → 1 shut), y/z gaze, w squint
    uFace: { value: new THREE.Vector4(0, 0, 0, 0) },
    // expression: x brow anger, y brow raise (m), z smile (-1..1), w mouth open (0..1)
    uExpr: { value: new THREE.Vector4(0, 0, 0.15, 0) },
    uIris: { value: new THREE.Color(0x3b2a1e) },
    uHeadC: { value: new THREE.Vector3(...HEAD_C) },
    uJersey: { value: null as THREE.Texture | null },
    uBulk: { value: 1 },
  };
  /** resting expression from the character's brow style (gameplay expressions add on top) */
  readonly baseExpr = new THREE.Vector4(0, 0, 0.15, 0);

  constructor(app: Appearance) {
    super({ roughness: 0.7, metalness: 0 });
    this.slotColors = Array.from({ length: SLOT_COUNT }, () => new THREE.Vector3(1, 1, 1));
    this.slotRough = new Array(SLOT_COUNT).fill(0.7);
    this.slotMetal = new Array(SLOT_COUNT).fill(0);
    this.slotEmissive = new Array(SLOT_COUNT).fill(0);
    this.slotSSS = new Array(SLOT_COUNT).fill(0);
    this.slotSheen = new Array(SLOT_COUNT).fill(0);
    this.setAppearance(app);

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uColors = { value: this.slotColors };
      shader.uniforms.uRough = { value: this.slotRough };
      shader.uniforms.uMetal = { value: this.slotMetal };
      shader.uniforms.uEmis = { value: this.slotEmissive };
      shader.uniforms.uSSS = { value: this.slotSSS };
      shader.uniforms.uSheen = { value: this.slotSheen };
      for (const [k, v] of Object.entries(this.u)) shader.uniforms[k] = v;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aSlot;
attribute vec2 aDetail;
varying float vSlot;
varying vec3 vObjPos;
varying vec2 vDetail;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vSlot = aSlot;
vObjPos = position;
vDetail = aDetail;`,
        );

      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_pars_fragment>', characterLightsChunk());
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vSlot;
varying vec3 vObjPos;
varying vec2 vDetail;
uniform vec4 uFace;
uniform vec4 uExpr;
uniform vec3 uIris;
uniform vec3 uHeadC;
uniform sampler2D uJersey;
uniform float uBulk;
uniform vec3 uColors[${SLOT_COUNT}];
uniform float uRough[${SLOT_COUNT}];
uniform float uMetal[${SLOT_COUNT}];
uniform float uEmis[${SLOT_COUNT}];
uniform float uSSS[${SLOT_COUNT}];
uniform float uSheen[${SLOT_COUNT}];
// shading-model globals read by the customised direct-light function below
float chSSS = 0.0;
float chSheen = 0.0;
vec3 chSheenColor = vec3(0.0);
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uEnergy;
uniform vec3 uEnergyColor;
uniform float uTime;
uniform float uGlowStrength;
uniform float uGhost;
float chHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float chNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(chHash(i + vec3(0,0,0)), chHash(i + vec3(1,0,0)), f.x),
                 mix(chHash(i + vec3(0,1,0)), chHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(chHash(i + vec3(0,0,1)), chHash(i + vec3(1,0,1)), f.x),
                 mix(chHash(i + vec3(0,1,1)), chHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float chSeg(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
// Illustrated face drawn straight onto the sculpted head (bind-space coordinates, metres).
vec3 paintFace(vec3 base, vec2 f, float aa) {
  vec3 ink = mix(base, vec3(0.06, 0.035, 0.03), 0.88);
  vec3 col = base;
  // soft cheek colour
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? 1.0 : -1.0;
    float bl = 1.0 - smoothstep(0.0, 0.02, length(f - vec2(0.05 * s, -0.024)));
    col = mix(col, col * vec3(1.06, 0.86, 0.84), bl * 0.35);
  }
  // lips: slightly deeper tone under the mouth line
  float lipMask = (1.0 - smoothstep(0.013, 0.019, abs(f.x))) * (1.0 - smoothstep(0.0, 0.006, abs(f.y + 0.0645)));
  col = mix(col, col * vec3(0.93, 0.72, 0.72), lipMask * 0.55);
  // eyes
  float blink = clamp(uFace.x, 0.0, 1.0);
  for (int i = 0; i < 2; i++) {
    float s = i == 0 ? 1.0 : -1.0;
    vec2 e = f - vec2(0.035 * s, 0.011);
    e.x *= s; // +x = outer corner on both sides
    vec2 r = vec2(0.0148, 0.0158 * (1.0 - uFace.w * 0.35));
    vec2 u = e / r;
    float L = mix(1.0, -0.35, blink);           // top of the opening (lid height)
    float inEll = length(u) - 1.0;
    float open = max(inEll * min(r.x, r.y), (u.y - L) * r.y);
    float cover = 1.0 - smoothstep(-aa, aa, open);
    // sclera with lid shadow, iris, pupil, catch-lights
    vec3 eyeC = mix(vec3(0.96, 0.95, 0.93), base * 0.85, smoothstep(L - 0.55, L, u.y) * 0.45);
    vec2 ic = vec2(uFace.y * 0.0045 * s, uFace.z * 0.0035 - 0.001);
    float di = length(e - ic);
    eyeC = mix(eyeC, uIris * (0.75 + 0.5 * smoothstep(0.0098, 0.002, di)), 1.0 - smoothstep(0.0095 - aa, 0.0095 + aa, di));
    eyeC = mix(eyeC, vec3(0.02), 1.0 - smoothstep(0.0046 - aa, 0.0046 + aa, di));
    eyeC = mix(eyeC, vec3(1.0), 1.0 - smoothstep(0.0021 - aa, 0.0021 + aa, length(e - ic - vec2(-0.0034 * s, 0.0042))));
    eyeC = mix(eyeC, vec3(1.0), (1.0 - smoothstep(0.0011 - aa, 0.0011 + aa, length(e - ic - vec2(0.003 * s, -0.003)))) * 0.8);
    col = mix(col, eyeC, cover);
    // upper lid line: follows the top of the opening, thick with a flick at the outer corner
    float topY = min(L, sqrt(max(0.0, 1.0 - u.x * u.x)));
    float lidD = abs(u.y - topY) * r.y;
    float w = 0.0019 + 0.0012 * smoothstep(0.2, 0.95, u.x);
    float lidLine = (1.0 - smoothstep(w - aa, w + aa, lidD)) * step(abs(u.x), 1.08);
    float tf;
    float flick = chSeg(e, vec2(r.x * 0.86, topY * r.y * 0.9), vec2(r.x * 1.3, topY * r.y + 0.0048), tf);
    lidLine = max(lidLine, 1.0 - smoothstep(0.0016 * (1.0 - tf * 0.6) - aa, 0.0016 * (1.0 - tf * 0.6) + aa, flick));
    // lower lash line (faint)
    float lowD = abs(u.y + sqrt(max(0.0, 1.0 - u.x * u.x))) * r.y;
    float lowLine = (1.0 - smoothstep(0.0009 - aa, 0.0009 + aa, lowD)) * smoothstep(1.0, 0.3, abs(u.x - 0.2)) * (1.0 - blink);
    col = mix(col, ink, max(lidLine, lowLine * 0.45));
    // brows (hair colour), shaped by the expression
    vec3 browC = mix(uColors[6], vec3(0.04), 0.35);
    float ang = uExpr.x, raise = uExpr.y;
    vec2 b0 = vec2(0.012, 0.031 - 0.0065 * ang + raise * 1.1);
    vec2 b1 = vec2(0.031, 0.0385 - 0.0012 * ang + raise * 1.2);
    vec2 b2 = vec2(0.05, 0.034 + 0.004 * ang + raise * 0.8);
    float t0, t1;
    vec2 ef = vec2(e.x + 0.035, e.y + 0.011);
    float d0 = chSeg(ef, b0, b1, t0);
    float d1 = chSeg(ef, b1, b2, t1);
    float wb0 = mix(0.0042, 0.0034, t0), wb1 = mix(0.0034, 0.0017, t1);
    float brow = max(1.0 - smoothstep(wb0 - aa, wb0 + aa, d0), 1.0 - smoothstep(wb1 - aa, wb1 + aa, d1));
    col = mix(col, browC, brow);
  }
  // mouth
  float smile = uExpr.z, mo = clamp(uExpr.w, 0.0, 1.0);
  float mw = 0.017 + 0.003 * abs(smile) + 0.005 * mo;
  float xn = f.x / mw;
  if (abs(xn) < 1.25) {
    float yc = -0.0585 + smile * 0.0085 * (xn * xn - 0.35);
    float bow = pow(max(0.0, 1.0 - xn * xn), 0.65);
    float lower = yc - mo * 0.03 * bow;
    float upper = yc + mo * 0.0055 * bow;
    float inside = step(abs(xn), 1.0) * smoothstep(lower - aa, lower + aa, f.y) * (1.0 - smoothstep(upper - aa, upper + aa, f.y));
    // dark mouth, a band of teeth under the upper lip, a tongue at the bottom
    vec3 mouthC = vec3(0.24, 0.05, 0.06);
    mouthC = mix(mouthC, vec3(0.72, 0.3, 0.32), smoothstep(lower + 0.006, lower + 0.001, f.y) * smoothstep(0.25, 0.5, mo) * (1.0 - smoothstep(0.55, 0.9, abs(xn))));
    mouthC = mix(mouthC, vec3(0.95, 0.93, 0.9), smoothstep(upper - 0.0042, upper - 0.003, f.y) * step(0.12, mo));
    col = mix(col, mouthC, inside * step(0.02, mo));
    float lineW = 0.0014 * (1.0 - 0.6 * smoothstep(0.7, 1.2, abs(xn)));
    float line = 1.0 - smoothstep(lineW - aa, lineW + aa, abs(f.y - upper));
    line *= 1.0 - smoothstep(1.0, 1.2, abs(xn));
    col = mix(col, ink * vec3(1.0, 0.8, 0.8), line * 0.9);
  }
  return col;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
int si = int(vSlot + 0.5);
diffuseColor.rgb = uColors[si];
// hand-painted edge accents from baked curvature: convex rims lighter, creases deeper
diffuseColor.rgb *= 1.0 + clamp(vDetail.y, -1.0, 1.0) * (si == 0 ? 0.07 : 0.12);
if (si == 0) {
  vec3 hp = vObjPos - uHeadC;
  if (hp.z > 0.055 && hp.y > -0.095 && hp.y < 0.075 && abs(hp.x) < 0.085) {
    float aa = max(max(fwidth(hp.x), fwidth(hp.y)) * 0.9, 0.00025);
    diffuseColor.rgb = paintFace(diffuseColor.rgb, hp.xy, aa);
  }
}
if (si == 1) {
  // printed name + number on the back, small number on the chest
  float xb = vObjPos.x / uBulk;
  vec2 uv = vec2(-1.0);
  if (vObjPos.z < -0.03 && abs(xb) < 0.16 && vObjPos.y > 1.08 && vObjPos.y < 1.45) uv = vec2(0.5 - xb / 0.3, (vObjPos.y - 1.08) / 0.36);
  else if (vObjPos.z > 0.05 && abs(xb - 0.075) < 0.05 && vObjPos.y > 1.26 && vObjPos.y < 1.38) uv = vec2(0.5 + (xb - 0.075) / 0.1, (vObjPos.y - 1.26) / 0.12 * 0.7 + 0.05);
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    vec4 jt = texture2D(uJersey, uv);
    diffuseColor.rgb = mix(diffuseColor.rgb, uColors[9], jt.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, uColors[2], max(jt.r, jt.b));
  }
}
chSSS = uSSS[si];
chSheen = uSheen[si];
chSheenColor = mix(diffuseColor.rgb, vec3(1.0), 0.45);
// soft low-frequency folds on fabric so large panels don't read as plastic
float fold = chNoise(vObjPos * vec3(7.0, 11.0, 7.0)) * 0.6 + chNoise(vObjPos * 23.0) * 0.4;
diffuseColor.rgb *= 1.0 - chSheen * 0.16 * (fold - 0.5) * 2.0 * 0.5 - chSheen * 0.03;
float dissolveEdge = 0.0;
if (uDissolve > 0.001) {
  float n = chNoise(vObjPos * 16.0) * 0.7 + chNoise(vObjPos * 5.0) * 0.3;
  float e = n - uDissolve * 1.08 + 0.04;
  if (e < 0.0) discard;
  dissolveEdge = 1.0 - smoothstep(0.0, 0.035, e);
}`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
roughnessFactor = uRough[si] + chSheen * 0.08 * (chNoise(vObjPos * 19.0) - 0.5);`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = uMetal[si];`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
{
  // baked sculpt occlusion: armpits, finger gaps, under the chin and hair, ear bowls
  float ao = clamp(vDetail.x, 0.0, 1.0);
  reflectedLight.indirectDiffuse *= ao;
  reflectedLight.indirectSpecular *= mix(1.0, ao, 0.8);
  reflectedLight.directDiffuse *= mix(1.0, ao, 0.45);
  reflectedLight.directSpecular *= mix(1.0, ao, 0.6);
}`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uColors[si] * uEmis[si] * uGlowStrength;
  // thin silhouette rim; on skin it is warmed and softened so foreshortened limbs don't go grey
  float rimK = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 4.0) * (1.0 - chSSS * 0.55);
  totalEmissiveRadiance += mix(uRimColor, uRimColor * vec3(1.15, 0.95, 0.8), chSSS) * rimK * uRimStrength;
  totalEmissiveRadiance += uFlashColor * uFlash;
  float pulse = 0.75 + 0.25 * sin(uTime * 16.0 + vObjPos.y * 24.0);
  totalEmissiveRadiance += uEnergyColor * (fres * 1.3 + 0.04) * uEnergy * pulse;
  totalEmissiveRadiance += uDissolveColor * dissolveEdge * 2.6;
}`,
        );
    };
  }

  override customProgramCacheKey() {
    return 'athlete-sculpt-v2';
  }

  /** Print the athlete's number (and name on the back) into a small mask texture. */
  setJersey(num: number, name: string, bulk = 1) {
    this.u.uBulk.value = bulk;
    const old = this.u.uJersey.value;
    if (old && old !== blankJersey) old.dispose();
    this.u.uJersey.value = jerseyTexture(num, name);
  }

  /** Resting brow/mouth from the appearance's brow style. */
  private applyBaseExpr(a: Appearance) {
    const e = this.baseExpr;
    e.set(0, 0, 0.15, 0);
    if (a.brow === 'angry') e.set(1, 0, -0.35, 0);
    else if (a.brow === 'calm') e.set(-0.35, 0.0006, 0.35, 0);
    else if (a.brow === 'raised') e.set(-0.2, 0.004, 0.2, 0);
    this.u.uExpr.value.copy(e);
  }

  override dispose() {
    const t = this.u.uJersey.value;
    if (t && t !== blankJersey) t.dispose();
    super.dispose();
  }

  setAppearance(a: Appearance) {
    this.applyBaseExpr(a);
    this.u.uIris.value.set(a.eyes ?? IRIS[Math.abs(Math.round(a.skin * 7 + a.hair * 3)) % IRIS.length]);
    if (!this.u.uJersey.value) this.u.uJersey.value = (blankJersey ??= jerseyTexture(-1, ''));
    const set = (slot: number, hex: number, rough: number, metal = 0, emis = 0) => {
      const c = new THREE.Color(hex);
      this.slotColors[slot].set(c.r, c.g, c.b);
      this.slotRough[slot] = rough;
      this.slotMetal[slot] = metal;
      this.slotEmissive[slot] = emis;
    };
    this.slotSSS.fill(0);
    this.slotSheen.fill(0);
    this.slotSSS[SLOT.skin] = 1;
    for (const f of [SLOT.jersey, SLOT.shorts, SLOT.socks]) this.slotSheen[f] = 0.55;
    this.slotSheen[SLOT.trim] = 0.3;
    this.slotSheen[SLOT.hair] = 0.4;
    set(SLOT.skin, a.skin, 0.52);
    set(SLOT.jersey, a.jersey, 0.78);
    set(SLOT.trim, a.trim, 0.72, 0, a.glow !== undefined ? 0.0 : 0);
    set(SLOT.shorts, a.shorts, 0.74);
    set(SLOT.shoes, a.shoes, 0.42);
    set(SLOT.sole, a.sole, 0.7);
    set(SLOT.hair, a.hair, 0.58);
    set(SLOT.eyes, a.eyes ?? 0x121418, 0.12);
    set(SLOT.socks, a.socks, 0.85);
    set(SLOT.accent, a.accent, 0.55, 0, a.glow !== undefined ? 1.6 : 0);
    set(SLOT.visor, 0x0b0d12, 0.08, 0.6, a.glow !== undefined ? 0.25 : 0);
    if (a.glow !== undefined) {
      const g = new THREE.Color(a.glow);
      this.slotColors[SLOT.accent].set(g.r, g.g, g.b);
      this.u.uGlowStrength.value = a.glowStrength ?? 1;
      this.u.uRimColor.value.set(a.glow);
      this.u.uRimStrength.value = 0.35;
    }
  }
}

const IRIS = [0x3b2a1e, 0x4a3322, 0x2f4a5e, 0x3d5a3a, 0x5a4020, 0x2a2a2a];

/** R = number fill, G = number outline, B = name lettering. */
function jerseyTexture(num: number, name: string): THREE.Texture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  if (num >= 0) {
    const txt = String(num);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `800 ${txt.length > 1 ? 176 : 190}px "Barlow Condensed", "Arial Narrow", sans-serif`;
    g.lineJoin = 'round';
    g.lineWidth = 16;
    // (texture flipY keeps canvas-top = top of the print)
    g.strokeStyle = '#00ff00';
    g.strokeText(txt, S / 2, 228);
    g.fillStyle = '#ff0000';
    g.fillText(txt, S / 2, 228);
    if (name) {
      g.font = '700 30px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.fillStyle = '#0000ff';
      g.fillText(name.toUpperCase().split('').join(String.fromCharCode(8202)), S / 2, 38);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * three.js physical lighting with two stylised shading models layered on top:
 *  - skin: wrapped, red-shifted diffuse (cheap subsurface scattering at the terminator)
 *  - fabric/hair: a grazing-angle sheen lobe that gives cloth its soft velvety edge
 */
let cachedChunk = '';
function characterLightsChunk(): string {
  if (cachedChunk) return cachedChunk;
  let c = THREE.ShaderChunk.lights_physical_pars_fragment;
  const a1 = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  const a2 = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if (!c.includes(a1) || !c.includes(a2)) {
    console.warn('[CharacterMaterial] lighting chunk changed; using stock lighting');
    cachedChunk = c;
    return c;
  }
  c = c.replace(
    a1,
    `float rawNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( rawNL );
	float wrapNL = saturate( ( rawNL + 0.45 ) / 1.45 );
	vec3 sssDiffuse = mix( vec3( dotNL ), wrapNL * mix( vec3( 1.0, 0.36, 0.24 ), vec3( 1.0 ), saturate( rawNL * 1.6 ) ), chSSS ) * directLight.color;`,
  );
  c = c.replace(
    a2,
    `reflectedLight.directDiffuse += sssDiffuse * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
	float chNV = saturate( dot( geometryNormal, geometryViewDir ) );
	reflectedLight.directSpecular += directLight.color * chSheenColor * ( chSheen * 0.5 * pow( 1.0 - chNV, 4.0 ) * saturate( rawNL + 0.4 ) );`,
  );
  cachedChunk = c;
  return c;
}
