import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const {
  pass, mrt, output, normalView, uniform, Fn, float, vec2, vec3, vec4, time, mix, smoothstep, screenUV, length, sin, floor,
  hash, clamp, dot, normalize, diffuseColor, velocity,
} = TSL as any;
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
}

export class PostFX {
  pipeline: THREE.RenderPipeline;
  u: PostUniforms;
  private features: string[] = [];

  constructor(private gfx: Gfx, private scene: THREE.Scene, private camera: THREE.PerspectiveCamera, q: Quality) {
    this.u = {
      slow: uniform(0), rewind: uniform(0), fracture: uniform(0), flash: uniform(0), hurt: uniform(0), fade: uniform(0),
      vignette: uniform(0.28), saturation: uniform(1.0), contrast: uniform(1.06), tint: uniform(new THREE.Color(1, 1, 1)),
      grain: uniform(0.35), focus: uniform(4), focusRange: uniform(6), bokeh: uniform(1.6), bloomStrength: uniform(0.32),
    } as unknown as PostUniforms;
    this.pipeline = new THREE.RenderPipeline(gfx.renderer);
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
        const b = (bloom as any)(color, 0.32, 0.55, 0.92);
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

  render(): void {
    this.pipeline.render();
  }

  /** Render n frames so temporal effects (TRAA history) converge, e.g. before a still capture or after a camera cut. */
  settle(n = 12): void {
    for (let i = 0; i < n; i++) this.pipeline.render();
  }
}
