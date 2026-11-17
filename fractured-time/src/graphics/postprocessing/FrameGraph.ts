import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { sss } from 'three/addons/tsl/display/SSSNode.js';
import type { GraphicsSettings } from '../config/presets';
import type { Capabilities } from '../core/capabilities';
import type { LookUniforms } from './look';
import { warpedUV, gameplayGrade } from './look';
import type { Grader } from './grade';
import type { AutoExposure } from './exposure';
import { toneMap } from './tonemap';

const T = TSL as any;
const {
  pass, mrt, output, normalView, diffuseColor, velocity, metalness, roughness, clearcoat, clearcoatRoughness, vec2, vec3, vec4, float,
  mix, smoothstep, clamp, dot, log2, max, screenUV, int, abs, fract,
} = T;

/** What the screen shows: the final image, or one of the buffers behind it. */
export type DebugView = 'final' | 'albedo' | 'normals' | 'depth' | 'ao' | 'gi' | 'reflections' | 'fog' | 'luminance' | 'clipping'
  | 'velocity' | 'unexposed' | 'shadowmap';
export const DEBUG_VIEWS: DebugView[] = ['final', 'albedo', 'normals', 'depth', 'ao', 'gi', 'reflections', 'fog', 'luminance', 'clipping',
  'velocity', 'unexposed', 'shadowmap'];

/** Atmosphere hook: the volumetric medium between the camera and every surface (scene-linear, before exposure). */
export interface FogStage {
  node(color: any, depthTex: any, uv: any, steps: number): any;
  /** per frame, before the graph renders (camera matrices, frame index) */
  update?(): void;
}

export interface FrameGraphInputs {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  settings: GraphicsSettings;
  caps: Capabilities;
  look: LookUniforms;
  grader: Grader;
  exposure: AutoExposure;
  fog: FogStage | null;
  debug: DebugView;
  /** the dynamic shadow map, for its debug view */
  shadowMap?: THREE.Texture | null;
  /** the dominant light (contact shadows march toward it) and how much of the light it carries (uniform node) */
  mainLight?: THREE.DirectionalLight | null;
  contactStrength?: any;
}

/**
 * The frame, as an ordered graph of stages compiled into one RenderPipeline output node:
 *
 *   scene (MRT: colour, view normal, [albedo], [velocity], [reflectivity])
 *   -> gameplay warp -> AO / GI -> SSR -> volumetric fog -> DOF -> TAA -> motion blur -> bloom (HDR)
 *   -> exposure -> place grade -> gameplay grade -> CA -> tone map -> sharpen -> FXAA/SMAA -> grain -> fade
 *   -> sRGB encode (the pipeline's output transform; the renderer itself does no tone mapping)
 *
 * Each optional stage is built inside its own guard: a stage that fails to build is skipped and recorded (`failures`), the
 * frame still renders. `features` lists what is live.
 */
export class FrameGraph {
  readonly pipeline: THREE.RenderPipeline;
  features: string[] = [];
  failures: { stage: string; error: string }[] = [];
  /** the HDR scene colour texture (for metering) */
  sceneTexture: THREE.Texture | null = null;
  /** true when the volumetric fog stage is live */
  fogLive = false;
  private traaNode: any = null;

  constructor(renderer: THREE.WebGPURenderer) {
    this.pipeline = new THREE.RenderPipeline(renderer);
  }

  private stage<R>(name: string, fn: () => R): R | null {
    try {
      const r = fn();
      this.features.push(name);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.failures.push({ stage: name, error: msg });
      console.warn(`[gfx] stage '${name}' disabled:`, e);
      return null;
    }
  }

  build(i: FrameGraphInputs): void {
    const s = i.settings;
    this.features = [];
    this.failures = [];
    const debug = i.debug;
    const wantGI = s.ao === 'ssgi';
    const wantTAA = s.antialias === 'taa';
    const wantVel = wantTAA || s.motionBlur || debug === 'velocity';
    const wantSSR = s.ssr !== 'off';

    // --- scene pass ---------------------------------------------------------------------------------------------------
    const scenePass = pass(i.scene, i.camera);
    const outs: Record<string, any> = { output, normal: normalView };
    if (wantGI || debug === 'albedo') outs.diffuse = diffuseColor;
    if (wantVel) outs.velocity = velocity;
    if (wantSSR || debug === 'reflections') {
      // how mirror-like each pixel is (water films, polished metal and floors) and how rough its reflection
      const coatR = clamp(clearcoatRoughness, 0.0, 1.0);
      const refl = clearcoat.mul(smoothstep(0.35, 0.05, coatR)).max(metalness.mul(smoothstep(0.55, 0.12, roughness)))
        .max(smoothstep(0.32, 0.08, roughness).mul(0.25));
      outs.refl = vec2(refl.clamp(0, 1), mix(roughness, coatR, clearcoat.clamp(0, 1)));
    }
    scenePass.setMRT(mrt(outs));
    const sceneColor = scenePass.getTextureNode('output');
    const sceneNormal = scenePass.getTextureNode('normal');
    const sceneDepth = scenePass.getTextureNode('depth');
    this.sceneTexture = scenePass.getTexture('output');

    const uv = warpedUV(i.look);
    let color: any = sceneColor.sample(uv);
    let aoNode: any = null;
    let giNode: any = null;
    let reflNode: any = null;

    // --- indirect light -----------------------------------------------------------------------------------------------
    if (s.ao === 'gtao') {
      this.stage('gtao', () => {
        const p = (ao as any)(sceneDepth, sceneNormal, i.camera);
        p.resolutionScale = s.aoScale;
        p.radius.value = 0.35;
        p.distanceExponent.value = 1.4;
        p.thickness.value = 0.8;
        aoNode = p.getTextureNode().r;
        color = vec4(color.rgb.mul(mix(float(1), aoNode, 0.9)), color.a);
      });
    } else if (wantGI) {
      this.stage('ssgi', () => {
        const gi = (ssgi as any)(sceneColor, sceneDepth, sceneNormal, i.camera);
        gi.resolutionScale = s.aoScale;
        gi.sliceCount.value = 2;
        gi.stepCount.value = 8;
        gi.giIntensity.value = 6;
        gi.aoIntensity.value = 1.1;
        const albedo = scenePass.getTextureNode('diffuse');
        aoNode = gi.getAONode();
        giNode = albedo.rgb.mul(gi.getGINode().rgb);
        color = vec4(color.rgb.mul(aoNode).add(giNode), color.a);
      });
    }

    // --- contact shadows: short screen-space rays toward the dominant light (feet on floors, fingers on faces, the
    //     detail the shadow map is too coarse for), as strong as that light's share --------------------------------------
    if (s.contactShadows && i.mainLight && i.contactStrength) {
      this.stage('contact shadows', () => {
        const c = (sss as any)(sceneDepth, i.camera, i.mainLight);
        c.maxDistance.value = 0.35;
        c.thickness.value = 0.02;
        c.quality.value = 0.5;
        c.useTemporalFiltering = s.antialias === 'taa';
        const occ = c.getTextureNode().r;
        color = vec4(color.rgb.mul(mix(float(1), occ, i.contactStrength.mul(0.8))), color.a);
      });
    }

    // --- reflections --------------------------------------------------------------------------------------------------
    if (wantSSR) {
      this.stage('ssr', () => {
        const rr = scenePass.getTextureNode('refl');
        const r = (ssr as any)(sceneColor, sceneDepth, sceneNormal, { metalnessNode: rr.r, roughnessNode: rr.g, camera: i.camera });
        r.maxDistance.value = 40;
        r.thickness.value = 0.35;
        r.resolutionScale = s.ssr === 'full' ? 1 : 0.5;
        r.quality.value = s.ssr === 'full' ? 0.6 : 0.4;
        r.maxLuminance.value = 40;
        reflNode = r.rgb;
        color = vec4(color.rgb.add(reflNode), color.a);
      });
    }

    // --- atmosphere ---------------------------------------------------------------------------------------------------
    this.fogLive = false;
    const preFog = color;
    if (s.fogSteps > 0 && i.fog) {
      this.stage('volumetric fog', () => {
        color = i.fog!.node(color, sceneDepth, uv, s.fogSteps);
        this.fogLive = true;
      });
    }

    // --- lens: depth of field before the temporal resolve (its noise resolves with the rest) --------------------------
    if (s.depthOfField) {
      this.stage('dof', () => {
        const u = i.look as any;
        const d = (dof as any)(color, scenePass.getViewZNode(), u.focus, u.focusRange, u.bokeh);
        color = vec4(d.rgb, color.a);
      });
    }

    // --- temporal resolve ---------------------------------------------------------------------------------------------
    this.traaNode = null;
    if (wantTAA) {
      this.stage('taa', () => {
        this.traaNode = (traa as any)(color, sceneDepth, scenePass.getTextureNode('velocity'), i.camera);
        color = this.traaNode;
      });
    }
    if (s.motionBlur) {
      this.stage('motion blur', () => {
        const v = scenePass.getTextureNode('velocity');
        // per-frame screen motion, scaled to a 180-degree shutter
        color = (motionBlur as any)(color, v.xy.mul(0.5), int(12));
      });
    }

    // --- bloom (HDR, energy capped so the sun or the Engine never veils the frame) ------------------------------------
    if (s.bloom) {
      this.stage('bloom', () => {
        const CAP = 16.0;
        const peak = color.r.max(color.g).max(color.b).max(1e-4);
        const capped = vec4(color.rgb.mul(float(CAP).div(peak).min(1.0)), color.a);
        const b = (bloom as any)(capped, 0.16, 0.25, 1.8);
        b.strength = (i.look as any).bloomStrength;
        color = vec4(color.rgb.add(b.rgb), color.a);
      });
    }

    // --- exposure, grading, tone mapping -------------------------------------------------------------------------------
    const unexposed = color;
    const exposed = color.rgb.mul(i.exposure.value);
    let graded: any = gameplayGrade(i.look, i.grader.apply(exposed));
    if (s.chromaticAberration) {
      this.stage('chromatic aberration', () => {
        const u = i.look as any;
        const strength = u.rewind.mul(3.2).add(u.fracture.mul(1.6)).add(u.flash.mul(0.8)).add(0.05);
        graded = (chromaticAberration as any)(vec4(graded, 1.0), strength, vec2(0.5, 0.5)).rgb;
      });
    }
    let display: any = vec4(i.grader.display(toneMap(s.toneMapper, graded, i.grader.look)), 1.0);
    this.features.push(`tonemap:${s.toneMapper}`);
    if (wantTAA && s.sharpen > 0) {
      this.stage('sharpen', () => { display = (sharpen as any)(display, float(2 * (1 - s.sharpen))); });
    }
    if (s.antialias === 'smaa' || (wantTAA && !this.features.includes('taa'))) this.stage('smaa', () => { display = (smaa as any)(display); });
    else if (s.antialias === 'fxaa') this.stage('fxaa', () => { display = (fxaa as any)(display); });
    if (s.filmGrain) this.stage('grain', () => { display = (film as any)(display, (i.look as any).grain); });
    let finalNode: any = vec4(display.rgb.mul(float(1).sub(clamp((i.look as any).fade, 0, 1))), 1.0);

    // --- debug views (display-linear; the pipeline still encodes them to sRGB) ----------------------------------------
    if (debug !== 'final') finalNode = this.debugNode(debug, { scenePass, sceneNormal, sceneDepth, aoNode, giNode, reflNode, preFog, color: unexposed,
      exposed, exposure: i.exposure.value, shadowMap: i.shadowMap }) ?? finalNode;

    this.pipeline.outputNode = finalNode;
    this.pipeline.outputColorTransform = true;
    this.pipeline.needsUpdate = true;
  }

  private debugNode(view: DebugView, b: Record<string, any>): any {
    // perceptual ramp: blue (dark) -> cyan -> green -> yellow -> red (bright)
    const heat = (t: any) => {
      const c = clamp(t, 0.0, 1.0).mul(4.0);
      return vec3(clamp(c.sub(2.0), 0.0, 1.0), clamp(c, 0.0, 1.0).mul(clamp(float(4.0).sub(c), 0.0, 1.0)), clamp(float(2.0).sub(c), 0.0, 1.0));
    };
    switch (view) {
      case 'albedo': return vec4(b.scenePass.getTextureNode('diffuse').rgb, 1.0);
      case 'normals': return vec4(b.sceneNormal.rgb.mul(0.5).add(0.5), 1.0);
      case 'depth': {
        const vz = b.scenePass.getViewZNode().negate();
        return vec4(vec3(clamp(log2(max(vz, 0.05)).div(8.0), 0.0, 1.0)), 1.0);
      }
      case 'ao': return b.aoNode ? vec4(vec3(b.aoNode), 1.0) : vec4(1.0);
      case 'gi': return b.giNode ? vec4(b.giNode.mul(b.exposure), 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
      case 'reflections': return b.reflNode ? vec4(b.reflNode.mul(b.exposure), 1.0) : vec4(b.scenePass.getTextureNode('refl').rg, 0.0, 1.0);
      case 'fog': return vec4(abs(b.color.rgb.sub(b.preFog.rgb)).mul(b.exposure).mul(4.0), 1.0);
      case 'luminance': {
        // exposed scene luminance in stops around mid grey: -6 EV (blue) .. +6 EV (red)
        const l = dot(b.exposed, vec3(0.2126, 0.7152, 0.0722));
        return vec4(heat(log2(max(l, 1e-5).div(0.18)).add(6.0).div(12.0)), 1.0);
      }
      case 'clipping': {
        // zebra over clipped highlights (>= 16x mid grey after exposure) and crushed shadows (< 1/64)
        const l = dot(b.exposed, vec3(0.2126, 0.7152, 0.0722));
        const z = fract(screenUV.x.add(screenUV.y).mul(60.0)).greaterThan(0.5);
        const over = l.greaterThan(2.88).and(z);
        const under = l.lessThan(0.0028).and(z);
        const base = vec3(dot(b.exposed.div(b.exposed.add(1.0)), vec3(0.33)));
        return vec4(over.select(vec3(1.0, 0.1, 0.1), under.select(vec3(0.1, 0.3, 1.0), base)), 1.0);
      }
      case 'velocity': {
        const v = b.scenePass.getTextureNode('velocity');
        return vec4(abs(v.xy).mul(40.0), 0.0, 1.0);
      }
      case 'unexposed': return vec4(b.color.rgb.div(b.color.rgb.add(1.0)), 1.0);
      case 'shadowmap': return b.shadowMap ? vec4(vec3(T.texture(b.shadowMap, screenUV).r.sub(0.4).mul(5.0)), 1.0) : null;
      default: return null;
    }
  }

  render(): void { this.pipeline.render(); }

  dispose(): void { this.pipeline.dispose(); }
}
