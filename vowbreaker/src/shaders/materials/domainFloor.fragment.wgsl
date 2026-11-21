// Domain floor: the ground of each domain, lit in the same toon style and receiving the fighters'
// shadows, revealed outward from the caster with a burning front.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_shadow>
#include<vb_toon>
#include<vb_water>
#include<vb_vfx>
#include<vb_atmosphere>
#include<vb_patterns>

varying vWorld: vec3f;

uniform cameraPosition: vec3f;
uniform domainParams: vec4f;   // id, reveal, time, intensity
uniform domainCenter: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;

var shadowMap: texture_2d<f32>;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let id = i32(uniforms.domainParams.x + 0.5);
    let reveal = uniforms.domainParams.y;
    let t = uniforms.domainParams.z;
    let P = fragmentInputs.vWorld;
    let dFront = length(P.xz - uniforms.domainCenter.xz);
    let front = reveal * 70.0;
    if (dFront > front && reveal < 0.999) {
        discard;
    }
    var sh = 1.0;
    if (uniforms.shadowParams.w > 0.5) {
        let s = shadowProject(P + vec3f(0.0, 0.03, 0.0), uniforms.lightViewProj, uniforms.shadowParams.x);
        sh = shadowEdgeFade(s, shadowPCF5(shadowMap, s, 0.002, 1.5));
    }
    let V = normalize(uniforms.cameraPosition - P);
    var col = vec3f(0.0);
    switch id {
        case 0: {
            // ash floor scored with the bell's concentric rings
            let r = length(P.xz - uniforms.domainCenter.xz);
            let rings = smoothstep(0.08, 0.0, abs(fract(r * 0.25 - t * 0.2) - 0.5) - 0.42);
            let ash = vfbm2(P.xz * 0.5, 4);
            col = mix(vec3f(0.18, 0.12, 0.1), vec3f(0.42, 0.32, 0.26), ash) + vec3f(1.4, 0.7, 0.2) * rings * 0.5;
            col = col * mix(0.45, 1.0, sh);
        }
        case 1: {
            // white paper, folded into a lattice; ink lines at the folds
            let g = abs(fract(P.xz * 0.5) - 0.5);
            let fold = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
            let diag = 1.0 - smoothstep(0.0, 0.015, abs(g.x - g.y));
            col = vec3f(0.95, 0.93, 0.89) * (0.92 + paperGrain(P.xz * 4.0) * 0.1) * (1.0 - fold * 0.25 - diag * 0.1);
            col = mix(col * vec3f(0.62, 0.62, 0.75), col, sh);
        }
        case 2: {
            // the mirror lake: reflect the moons; ripples spread from where the fighters step
            let rip = rainRipples(P.xz * 0.6, t * 0.4, 0.6);
            let n = normalize(vec3f(rip.x * 0.5, 1.0, rip.y * 0.5));
            let r = reflect(-V, n);
            let sky = mix(vec3f(0.05, 0.1, 0.22), vec3f(0.005, 0.01, 0.04), clamp(r.y, 0.0, 1.0));
            let moons = step(0.995, valueNoise2(r.xz / max(r.y, 0.05) * 3.0)) * 2.0;
            col = sky + vec3f(1.1, 1.15, 1.3) * moons + vec3f(0.5, 0.8, 1.0) * rip.z * 0.3;
            col = col * mix(0.5, 1.0, sh);
        }
        case 3: {
            // red lacquer boards and paper lantern light pooling on them
            var q = patternPlanks(P.xz, 0.4, 3.0);
            col = vec3f(0.35, 0.05, 0.04) * q.tint;
            let pool = 0.5 + 0.5 * sin(P.z * 0.8 + t);
            col = col + vec3f(1.0, 0.35, 0.1) * pool * 0.15;
            col = col * mix(0.4, 1.0, sh);
        }
        default: {
            // charred floorboards with embers in the cracks
            let q = patternCharred(P.xz, t, 0.9);
            col = vec3f(0.3) * q.tint + q.emissive;
            col = col * mix(0.5, 1.0, sh);
        }
    }
    let edge = smoothstep(front - 2.0, front, dFront) * step(reveal, 0.999);
    let pal = paletteFor(select(id, 0, id == 4));
    col = col + pal.body * edge * 3.0;
    fragmentOutputs.color = vec4f(col * uniforms.domainParams.w, 1.0);
}
