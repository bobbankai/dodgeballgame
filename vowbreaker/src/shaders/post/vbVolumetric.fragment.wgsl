// Volumetric light (half resolution): march each view ray through the air from the camera to the
// first surface, sampling the sun's shadow map so light shafts appear between buildings, through
// torii and temple eaves and the gaps in the chapel roof. The air's density falls off with height
// and drifts with a little noise (mist in the alley, smoke over the burning village); scattering
// follows a Henyey-Greenstein phase so the shafts are brightest looking toward the light. Point
// lights (lanterns, techniques) add their own glow halos in the same march. Output: in-scattered
// light (rgb) and transmittance (a); the final pass upsamples it with a depth-aware filter.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_sdf3d>
#include<vb_lighting>
#include<vb_toon>
#include<vb_atmosphere>
#include<vb_vfx>
#include<vb_shadow>

varying vUV: vec2f;

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;
var shadowMap: texture_2d<f32>;

uniform projParams: vec4f;       // tan(fovY/2), aspect, near, far
uniform screenParams: vec4f;     // half-res width, height, 1/w, 1/h
uniform invView: mat4x4f;
uniform cameraPos: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform fogColor: vec3f;
uniform lightViewProj: mat4x4f;
uniform shadowParams: vec4f;     // map size, bias, -, enabled
uniform volParams: vec4f;        // density, anisotropy g, max distance, steps
uniform volParams2: vec4f;       // height falloff, base height, noise amount, time
uniform pointPos: array<vec4f, 4>;
uniform pointCol: array<vec4f, 4>;

fn worldAt(uv: vec2f, z: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    let vp = vec3f(ndc.x * uniforms.projParams.x * uniforms.projParams.y * z, ndc.y * uniforms.projParams.x * z, z);
    return (uniforms.invView * vec4f(vp, 1.0)).xyz;
}

fn airDensity(p: vec3f, time: f32) -> f32 {
    let base = uniforms.volParams.x * exp(-max(p.y - uniforms.volParams2.y, 0.0) * uniforms.volParams2.x);
    let drift = vfbm3(p * 0.18 + vec3f(time * 0.06, 0.0, time * 0.03), 3);
    return base * mix(1.0, 0.4 + drift * 1.2, uniforms.volParams2.z);
}

fn sunVisibility(p: vec3f) -> f32 {
    if (uniforms.shadowParams.w < 0.5) {
        return 1.0;
    }
    let s = shadowProject(p, uniforms.lightViewProj, uniforms.shadowParams.x);
    if (s.inside < 0.5) {
        return 1.0;
    }
    return shadowCompareBilinear(shadowMap, s.uv, s.depth, uniforms.shadowParams.y * 2.0, uniforms.shadowParams.x);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let pixel = uv * uniforms.screenParams.xy;
    let time = uniforms.volParams2.w;
    let z = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0).b;
    let maxD = uniforms.volParams.z;
    let surf = worldAt(uv, min(z, 2000.0));
    let ro = uniforms.cameraPos;
    var rd = surf - ro;
    let sceneDist = length(rd);
    rd = rd / max(sceneDist, 1e-4);
    let dist = min(sceneDist, maxD);
    let steps = i32(uniforms.volParams.w);
    let stepLen = dist / f32(steps);
    let jitter = interleavedGradientNoise(pixel + vec2f(fract(time * 7.0) * 61.0));
    let cosSun = dot(rd, normalize(uniforms.sunDir));
    let phaseSun = phaseHenyeyGreenstein(cosSun, uniforms.volParams.y);
    var trans = 1.0;
    var scatter = vec3f(0.0);
    for (var i = 0; i < steps; i++) {
        let t = (f32(i) + jitter) * stepLen;
        let p = ro + rd * t;
        let dens = airDensity(p, time);
        if (dens > 1e-5) {
            let vis = sunVisibility(p);
            var light = uniforms.sunColor * vis * phaseSun + uniforms.fogColor * 0.15;
            for (var k = 0; k < 4; k++) {
                let lc = uniforms.pointCol[k];
                if (lc.w > 0.0) {
                    let lp = uniforms.pointPos[k];
                    let d = distance(lp.xyz, p);
                    light = light + lc.rgb * lc.w * glowFalloff(d, lp.w) * 0.25;
                }
            }
            let ext = dens * stepLen;
            scatter = scatter + light * dens * stepLen * trans;
            trans = trans * exp(-ext);
            if (trans < 0.02) {
                break;
            }
        }
    }
    fragmentOutputs.color = vec4f(scatter, trans);
}
