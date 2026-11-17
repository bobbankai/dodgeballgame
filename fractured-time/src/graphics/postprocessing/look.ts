import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';

const T = TSL as any;
const { uniform, Fn, float, vec2, vec3, length, sin, floor, hash, smoothstep, normalize, mix, dot, screenUV, time } = T;

/**
 * Gameplay-driven looks: everything the game itself pushes into the image (time slow, rewind, timeline fractures, hits,
 * fades) plus the camera's own controls (focus, vignette, grain). All uniforms: they respond the frame they are set.
 */
type U = { value: number };
export interface LookUniforms {
  /** time slow: a cold, desaturated grade and a tighter vignette (0..1) */
  slow: U;
  /** rewind: magenta/cyan split, scan wobble, aberration (0..1) */
  rewind: U;
  /** timeline events: radial ripple + glitch bands (0..1) */
  fracture: U;
  /** additive white flash (parries, transitions) */
  flash: U;
  /** red edge when hurt */
  hurt: U;
  /** 0 = visible, 1 = black */
  fade: U;
  vignette: U;
  grain: U;
  /** depth of field: focus distance (m), in-focus range (m), bokeh scale */
  focus: U; focusRange: U; bokeh: U;
  bloomStrength: U;
  /** multiply the whole image (a chapter tint) */
  tint: { value: THREE.Color };
}

export function createLook(): LookUniforms {
  return {
    slow: uniform(0), rewind: uniform(0), fracture: uniform(0), flash: uniform(0), hurt: uniform(0), fade: uniform(0),
    vignette: uniform(0.28), grain: uniform(0.35), focus: uniform(4), focusRange: uniform(6), bokeh: uniform(1.6),
    bloomStrength: uniform(0.16), tint: uniform(new THREE.Color(1, 1, 1)),
  } as unknown as LookUniforms;
}

/** Screen UV displaced by the fracture ripple, glitch bands and the rewind's scan wobble. */
export function warpedUV(look: LookUniforms): any {
  const u = look as any;
  return Fn(() => {
    const d = screenUV.sub(vec2(0.5, 0.5));
    const r = length(d);
    const ripple = sin(r.mul(70.0).sub(time.mul(9.0))).mul(0.0045).mul(u.fracture).mul(smoothstep(0.0, 0.25, r));
    const band = floor(screenUV.y.mul(36.0).add(floor(time.mul(14.0))));
    const g = hash(band).sub(0.5).mul(0.05).mul(u.fracture).mul(smoothstep(0.55, 0.9, hash(band.add(7.0))));
    const wob = sin(screenUV.y.mul(240.0).add(time.mul(40.0))).mul(0.0012).mul(u.rewind);
    return screenUV.add(normalize(d.add(0.0001)).mul(ripple)).add(vec2(g.add(wob), 0.0));
  })();
}

/** Scene-linear gameplay grade (after the place's grade, before tone mapping). */
export function gameplayGrade(look: LookUniforms, c0: any): any {
  const u = look as any;
  return Fn(() => {
    const c = vec3(c0).toVar();
    const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    // time slow: toward a cold monochrome
    c.assign(mix(c, mix(vec3(lum), c, float(0.45)).mul(vec3(0.72, 0.88, 1.18)), u.slow));
    // rewind: magenta in the highlights, cyan in the shadows
    const hl = smoothstep(0.05, 1.5, lum);
    c.assign(mix(c, mix(c.mul(vec3(0.7, 0.95, 1.25)), c.mul(vec3(1.25, 0.8, 1.15)), hl), u.rewind.mul(0.75)));
    c.assign(c.mul(u.tint));
    // vignette (optical falloff, so in linear light) and the damage edge
    const d = length(screenUV.sub(vec2(0.5, 0.5))).mul(1.35);
    const v = smoothstep(0.35, 1.05, d);
    c.assign(c.mul(float(1).sub(v.mul(u.vignette.add(u.slow.mul(0.22))))));
    c.assign(mix(c, vec3(0.7, 0.018, 0.026), v.mul(u.hurt).mul(0.8)));
    // the flash is scene light (it tone-maps to white through the shoulder, not a flat overlay)
    c.assign(c.add(u.flash.mul(3.0)));
    return c;
  })();
}
