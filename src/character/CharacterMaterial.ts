import * as THREE from 'three';
import { Appearance, SLOT, SLOT_COUNT } from './Appearance';

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
  };

  constructor(app: Appearance) {
    super({ roughness: 0.7, metalness: 0 });
    this.slotColors = Array.from({ length: SLOT_COUNT }, () => new THREE.Vector3(1, 1, 1));
    this.slotRough = new Array(SLOT_COUNT).fill(0.7);
    this.slotMetal = new Array(SLOT_COUNT).fill(0);
    this.slotEmissive = new Array(SLOT_COUNT).fill(0);
    this.setAppearance(app);

    this.onBeforeCompile = (shader) => {
      shader.uniforms.uColors = { value: this.slotColors };
      shader.uniforms.uRough = { value: this.slotRough };
      shader.uniforms.uMetal = { value: this.slotMetal };
      shader.uniforms.uEmis = { value: this.slotEmissive };
      for (const [k, v] of Object.entries(this.u)) shader.uniforms[k] = v;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aSlot;
varying float vSlot;
varying vec3 vObjPos;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vSlot = aSlot;
vObjPos = position;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vSlot;
varying vec3 vObjPos;
uniform vec3 uColors[${SLOT_COUNT}];
uniform float uRough[${SLOT_COUNT}];
uniform float uMetal[${SLOT_COUNT}];
uniform float uEmis[${SLOT_COUNT}];
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
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
int si = int(vSlot + 0.5);
diffuseColor.rgb = uColors[si];
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
roughnessFactor = uRough[si];`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
metalnessFactor = uMetal[si];`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normal, vdir), 0.0, 1.0), 3.0);
  totalEmissiveRadiance += uColors[si] * uEmis[si] * uGlowStrength;
  totalEmissiveRadiance += uRimColor * fres * uRimStrength;
  totalEmissiveRadiance += uFlashColor * uFlash;
  float pulse = 0.75 + 0.25 * sin(uTime * 16.0 + vObjPos.y * 24.0);
  totalEmissiveRadiance += uEnergyColor * (fres * 2.2 + 0.15) * uEnergy * pulse;
  totalEmissiveRadiance += uDissolveColor * dissolveEdge * 2.6;
}`,
        );
    };
  }

  override customProgramCacheKey() {
    return 'athlete-palette-v2';
  }

  setAppearance(a: Appearance) {
    const set = (slot: number, hex: number, rough: number, metal = 0, emis = 0) => {
      const c = new THREE.Color(hex);
      this.slotColors[slot].set(c.r, c.g, c.b);
      this.slotRough[slot] = rough;
      this.slotMetal[slot] = metal;
      this.slotEmissive[slot] = emis;
    };
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
