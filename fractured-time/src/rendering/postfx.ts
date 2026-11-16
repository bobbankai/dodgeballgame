import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const {
  pass, mrt, output, normalView, uniform, Fn, float, vec2, vec3, vec4, time, mix, smoothstep, screenUV, length, sin, floor,
  hash, clamp, dot, normalize, diffuseColor, velocity, metalness, roughness, clearcoat, clearcoatRoughness,
} = TSL as any;
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import type { Gfx } from './gfx';
import { VolumetricFog } from './volumetrics';
import type { Quality } from './quality';

/** Gameplay-driven look controls. Everything here is a uniform, so effects respond instantly to game state. */
type U = { value: number };
export interface PostUniforms {
  slow: U;       // time slow: cool desaturated grade, soft vignette
  rewind: U;     // rewind: aberration, magenta/cyan split, scan wobble
  fracture: U;   // timeline events: radial ripple + glitch bands
  flash: U;      // additive white flash (parry, transitions)
  hurt: U;       // red edge when damaged
  fade: U;       // 0 = visible, 1 = black
  vignette: U;
  saturation: U;
  contrast: U;
  tint: { value: THREE.Color }; // lift towards a chapter colour
  grain: U;
  focus: U;      // depth of field focus distance (m)
  focusRange: U;
  bokeh: U;
  bloomStrength: U;
  /** colour decision list per place (ASC CDL on the HDR image): out = (in * slope + offset) ^ power */
  slope: { value: THREE.Vector3 }; offset: { value: THREE.Vector3 }; power: { value: THREE.Vector3 };
}

/** Per-place grades: the look of each kind of place, eased between as Ethan moves (see `PostFX.grade`). */
export const GRADES = {
  neutral: { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], saturation: 1.0, contrast: 1.06 },
  // HELIX facility: clinical, cool whites, clean blacks
  facility: { slope: [0.98, 1.0, 1.04], offset: [0, 0.0006, 0.002], power: [1.0, 1.0, 0.99], saturation: 0.94, contrast: 1.08 },
  // the Engine chamber: the chronal cyan carries the room
  engine: { slope: [0.95, 1.0, 1.06], offset: [-0.001, 0.0008, 0.003], power: [1.02, 1.0, 0.98], saturation: 1.0, contrast: 1.12 },
  // the storm at nightfall: teal shadows, warm practical highlights (street lights, windows), restrained saturation
  dusk_storm: { slope: [1.06, 1.0, 0.92], offset: [-0.0025, 0.0012, 0.0035], power: [1.04, 1.0, 0.96], saturation: 0.9, contrast: 1.12 },
  // the arcology in 2089: high-key, cool glass and steel
  arcology: { slope: [0.99, 1.0, 1.03], offset: [0.001, 0.001, 0.002], power: [0.98, 0.98, 0.97], saturation: 0.92, contrast: 1.05 },
  // the same rooms twenty years abandoned: warm dust, faded colour
  arcology_ruin: { slope: [1.05, 1.0, 0.9], offset: [0.003, 0.002, 0.0], power: [1.03, 1.02, 1.0], saturation: 0.72, contrast: 1.04 },
  // the Nexus: deep violet shadows, the Engine's white-gold in the highlights, strong separation
  nexus: { slope: [1.03, 0.98, 1.04], offset: [0.0015, -0.0005, 0.004], power: [1.06, 1.02, 0.96], saturation: 1.05, contrast: 1.16 },
} as const;
export type GradeName = keyof typeof GRADES;

export class PostFX {
  pipeline: THREE.RenderPipeline;
  u: PostUniforms;
  /** volumetric fog lit by the sections' baked light volumes (null-op when the preset has no fog steps) */
  fog: VolumetricFog;
  volumetric = false;
  private features: string[] = [];

  constructor(private gfx: Gfx, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, q: Quality) {
    this.u = {
      slow: uniform(0), rewind: uniform(0), fracture: uniform(0), flash: uniform(0), hurt: uniform(0), fade: uniform(0),
      vignette: uniform(0.28), saturation: uniform(1.0), contrast: uniform(1.06), tint: uniform(new THREE.Color(1, 1, 1)),
      grain: uniform(0.35), focus: uniform(4), focusRange: uniform(6), bokeh: uniform(1.6), bloomStrength: uniform(0.16),
      slope: uniform(new THREE.Vector3(1, 1, 1)), offset: uniform(new THREE.Vector3(0, 0, 0)), power: uniform(new THREE.Vector3(1, 1, 1)),
    } as unknown as PostUniforms;
    this.pipeline = new THREE.RenderPipeline(gfx.renderer);
    this.fog = new VolumetricFog(camera);
    this.build(q);
  }

  /** (Re)build the effect chain for a quality preset. Optional effects fail soft: a broken effect is skipped, not fatal. */
  build(q: Quality): void {
    const u = this.u as any;
    this.features = [];
    const wantGI = q.ao === 'ssgi';
    const scenePass = pass(this.scene, this.camera);
    const mrtOut: Record<string, any> = { output, normal: normalView };
    if (wantGI) mrtOut.diffuse = diffuseColor;
    const wantTAA = q.antialias === 'taa';
    if (wantTAA) mrtOut.velocity = velocity;
    // reflections: how mirror-like each pixel is (the water film on wet streets, polished metal and floors) and its roughness
    if (q.ssr) {
      const coatR = clamp(clearcoatRoughness, 0.0, 1.0);
      const reflectivity = clearcoat.mul(smoothstep(0.35, 0.05, coatR))
        .max(metalness.mul(smoothstep(0.55, 0.12, roughness)))
        .max(smoothstep(0.32, 0.08, roughness).mul(0.25));
      mrtOut.refl = vec2(reflectivity.clamp(0, 1), mix(roughness, coatR, clearcoat.clamp(0, 1)));
    }
    scenePass.setMRT(mrt(mrtOut));
    const sceneColor = scenePass.getTextureNode('output');
    const sceneNormal = scenePass.getTextureNode('normal');
    const sceneDepth = scenePass.getTextureNode('depth');

    // 1. temporal distortion: sample the scene through a ripple + glitch displaced UV
    const warpedUV = Fn(() => {
      const d = screenUV.sub(vec2(0.5, 0.5));
      const r = length(d);
      const ripple = sin(r.mul(70.0).sub(time.mul(9.0))).mul(0.0045).mul(u.fracture).mul(smoothstep(0.0, 0.25, r));
      const band = floor(screenUV.y.mul(36.0).add(floor(time.mul(14.0))));
      const g = hash(band).sub(0.5).mul(0.05).mul(u.fracture).mul(smoothstep(0.55, 0.9, hash(band.add(7.0))));
      const wob = sin(screenUV.y.mul(240.0).add(time.mul(40.0))).mul(0.0012).mul(u.rewind);
      return screenUV.add(normalize(d.add(0.0001)).mul(ripple)).add(vec2(g.add(wob), 0.0));
    })();
    let color: any = sceneColor.sample(warpedUV);

    // 2. ambient occlusion / global illumination
    try {
      if (q.ao === 'gtao') {
        const aoPass = (ao as any)(sceneDepth, sceneNormal, this.camera);
        aoPass.resolutionScale = q.aoScale;
        aoPass.radius.value = 0.35;
        aoPass.distanceExponent.value = 1.4;
        aoPass.thickness.value = 0.8;
        color = vec4(color.rgb.mul(mix(float(1), aoPass.getTextureNode().r, 0.9)), color.a);
        this.features.push('gtao');
      } else if (wantGI) {
        const gi = (ssgi as any)(sceneColor, sceneDepth, sceneNormal, this.camera);
        gi.resolutionScale = q.aoScale;
        gi.sliceCount.value = 2;
        gi.stepCount.value = 8;
        gi.giIntensity.value = 6;
        gi.aoIntensity.value = 1.1;
        const diffuse = scenePass.getTextureNode('diffuse');
        color = vec4(color.rgb.mul(gi.getAONode()).add(diffuse.rgb.mul(gi.getGINode().rgb)), color.a);
        this.features.push('ssgi');
      }
    } catch (e) {
      console.warn('[postfx] AO/GI disabled:', e);
    }

    // 2a'. screen-space reflections (lights, neon and the street mirrored in puddles): one mirror ray per pixel, blurred by the
    //      surface roughness; pixels that reflect nothing are skipped
    if (q.ssr) {
      try {
        const rr = scenePass.getTextureNode('refl');
        const r = (ssr as any)(sceneColor, sceneDepth, sceneNormal, { metalnessNode: rr.r, roughnessNode: rr.g, camera: this.camera });
        r.maxDistance.value = 40;
        r.thickness.value = 0.35;
        r.resolutionScale = q.name === 'ultra' ? 1 : 0.5;
        r.quality.value = q.name === 'ultra' ? 0.6 : 0.4;
        r.maxLuminance.value = 40;
        color = vec4(color.rgb.add(r.rgb), color.a);
        this.features.push('ssr');
      } catch (e) {
        console.warn('[postfx] SSR disabled:', e);
      }
    }

    // 2a. volumetric fog: the medium between the camera and every surface, lit by the baked light volume (after AO: occlusion is a
    //     surface effect; before TRAA: the jittered march resolves over frames)
    this.volumetric = false;
    if (q.fogSteps > 0) {
      try {
        color = this.fog.node(color, sceneDepth, warpedUV, q.fogSteps);
        this.volumetric = true;
        this.features.push('volumetric');
      } catch (e) {
        console.warn('[postfx] volumetric fog disabled:', e);
      }
    }

    // 2b. temporal AA (jittered camera + reprojected history, in HDR before bloom): resolves sub-pixel hair, lashes, specular sparkle and
    //     thin geometry, and accumulates the AO noise. Needs a few frames to converge after a cut (call settle() for still shots).
    if (wantTAA) {
      try {
        color = (traa as any)(color, sceneDepth, scenePass.getTextureNode('velocity'), this.camera);
        this.features.push('traa');
      } catch (e) {
        console.warn('[postfx] TRAA disabled:', e);
      }
    }

    // 3. bloom (HDR emissives and lights bleed)
    if (q.bloom) {
      try {
        // threshold above diffuse white: only emitters and hot highlights bloom. Each pixel enters the bloom at most at BLOOM_CAP:
        // a sun in the sky (the day HDRI's ~450, the Nexus Engine's ~900) otherwise flooded every mip of the chain and laid a
        // white veil over the whole frame
        const BLOOM_CAP = 16.0;
        const peak = color.r.max(color.g).max(color.b).max(1e-4);
        const capped = vec4(color.rgb.mul(float(BLOOM_CAP).div(peak).min(1.0)), color.a);
        const b = (bloom as any)(capped, 0.16, 0.25, 1.8);
        b.strength = u.bloomStrength;
        color = vec4(color.rgb.add(b.rgb), color.a);
        this.features.push('bloom');
      } catch (e) {
        console.warn('[postfx] bloom disabled:', e);
      }
    }

    // 4. depth of field (cinematics and lock-on framing)
    if (q.dof) {
      try {
        const d = (dof as any)(color, scenePass.getViewZNode(), u.focus, u.focusRange, u.bokeh);
        color = vec4(d.rgb, color.a);
        this.features.push('dof');
      } catch (e) {
        console.warn('[postfx] dof disabled:', e);
      }
    }

    // 5. chromatic aberration: constant hint plus gameplay-driven bursts (rewind, fractures)
    if (q.chromatic) {
      try {
        const strength = u.rewind.mul(3.2).add(u.fracture.mul(1.6)).add(u.flash.mul(0.8)).add(0.05);
        const ca = (chromaticAberration as any)(color, strength, vec2(0.5, 0.5));
        color = vec4(ca.rgb, color.a);
        this.features.push('chromatic');
      } catch (e) {
        console.warn('[postfx] chromatic aberration disabled:', e);
      }
    }

    // 6. anti-aliasing
    try {
      if (q.antialias === 'smaa' || (wantTAA && !this.features.includes('traa'))) { color = (smaa as any)(color); this.features.push('smaa'); }
      else if (q.antialias === 'fxaa') { color = (fxaa as any)(color); this.features.push('fxaa'); }
    } catch (e) {
      console.warn('[postfx] AA disabled:', e);
    }

    // 7. grade: chapter tint, time-slow cooling, rewind split, contrast, vignette, hurt, flash, fade
    const graded = Fn(() => {
      const c = color.rgb.toVar();
      const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // saturation (time slow desaturates toward a cold monochrome)
      const sat = u.saturation.mul(float(1).sub(u.slow.mul(0.55)));
      c.assign(mix(vec3(lum), c, sat));
      c.assign(mix(c, c.mul(vec3(0.72, 0.88, 1.18)), u.slow));
      // rewind: magenta in the highlights, cyan in the shadows
      c.assign(mix(c, mix(c.mul(vec3(0.7, 0.95, 1.25)), c.mul(vec3(1.25, 0.8, 1.15)), smoothstep(0.1, 0.9, lum)), u.rewind.mul(0.75)));
      c.assign(c.mul(u.tint));
      // the place's grade (CDL)
      c.assign(c.mul(u.slope).add(u.offset).max(0.0).pow(u.power));
      // contrast around mid grey
      c.assign(mix(vec3(0.18), c, u.contrast));
      // vignette
      const d = length(screenUV.sub(vec2(0.5, 0.5))).mul(1.35);
      const v = smoothstep(0.35, 1.05, d);
      c.assign(c.mul(float(1).sub(v.mul(u.vignette.add(u.slow.mul(0.22))))));
      // damage edge
      c.assign(mix(c, vec3(0.8, 0.02, 0.03), v.mul(u.hurt).mul(0.8)));
      c.assign(c.add(u.flash.mul(1.4)));
      return vec4(c, color.a);
    })();

    let finalColor: any = graded;
    if (q.grain) {
      try {
        finalColor = (film as any)(graded, u.grain);
        this.features.push('film');
      } catch (e) {
        console.warn('[postfx] film grain disabled:', e);
      }
    }
    finalColor = vec4(finalColor.rgb.mul(float(1).sub(clamp(u.fade, 0, 1))), 1.0);
    this.pipeline.outputNode = finalColor;
    this.pipeline.needsUpdate = true;
  }

  describe(): string {
    return this.features.join(', ') || 'none';
  }

  private gradeTo: (typeof GRADES)[GradeName] = GRADES.neutral;
  private lastT = 0;
  /** Ease toward a place's grade (over ~2 s). */
  grade(name: GradeName): void { this.gradeTo = GRADES[name] ?? GRADES.neutral; }

  private stepGrade(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, this.lastT ? now - this.lastT : 0.016);
    this.lastT = now;
    const k = Math.min(1, dt * 1.6);
    const u = this.u;
    const g = this.gradeTo;
    u.slope.value.lerp(new THREE.Vector3(...g.slope), k);
    u.offset.value.lerp(new THREE.Vector3(...g.offset), k);
    u.power.value.lerp(new THREE.Vector3(...g.power), k);
    u.saturation.value += (g.saturation - u.saturation.value) * k;
    u.contrast.value += (g.contrast - u.contrast.value) * k;
  }

  render(): void {
    this.fog.update();
    this.stepGrade();
    this.pipeline.render();
  }

  /** Render n frames so temporal effects (TRAA history) converge, e.g. before a still capture or after a camera cut. */
  settle(n = 12): void {
    for (let i = 0; i < n; i++) { this.fog.update(); this.pipeline.render(); }
  }
}
