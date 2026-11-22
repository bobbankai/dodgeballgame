// Screen-space reflections (half resolution) for wet and polished floors: the neon alley after
// rain, the academy courtyard at night, the chapel's flooded nave, the subway's tiled platform.
// For each upward-facing pixel the view ray is reflected about the G-buffer normal and marched
// through the depth buffer in view space with a growing step, then refined by bisection. The hit
// is faded at the screen edges, by distance travelled, and when the reflected ray points back at
// the camera; the floor's roughness (from the stage's wetness) blurs it by jittering the ray.
// Output: reflected colour (rgb) and confidence (a).
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_color>
#include<vb_math>

varying vUV: vec2f;

var sceneTex: texture_2d<f32>;
var sceneTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform projParams: vec4f;       // tan(fovY/2), aspect, near, far
uniform screenParams: vec4f;     // half-res width, height, 1/w, 1/h
uniform ssrParams: vec4f;        // strength, max distance (m), thickness (m), roughness
uniform ssrParams2: vec4f;       // steps, min up-facing, time, -

fn viewPosAt(uv: vec2f, z: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * uniforms.projParams.x * uniforms.projParams.y * z, ndc.y * uniforms.projParams.x * z, z);
}

fn uvOf(vp: vec3f) -> vec2f {
    let z = max(vp.z, 1e-3);
    let ndc = vec2f(vp.x / (z * uniforms.projParams.x * uniforms.projParams.y), vp.y / (z * uniforms.projParams.x));
    return ndc * 0.5 + 0.5;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let g = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0);
    let z = g.b;
    fragmentOutputs.color = vec4f(0.0);
    if (z > 400.0 || uniforms.ssrParams.x <= 0.0) {
        return fragmentOutputs;
    }
    let nV = octDecode(g.rg);
    let vp = viewPosAt(uv, z);
    let v = normalize(vp);
    // only floors: the view-space normal must point "up" in the world; approximated via the view's y
    // (the post chain passes min up-facing for the camera's pitch)
    if (nV.y < uniforms.ssrParams2.y) {
        return fragmentOutputs;
    }
    let pixel = uv * uniforms.screenParams.xy;
    let time = uniforms.ssrParams2.z;
    let jit = hash22(pixel + vec2f(fract(time * 13.0) * 97.0)) - 0.5;
    var r = reflect(v, nV);
    r = normalize(r + vec3f(jit.x, 0.0, jit.y) * uniforms.ssrParams.w * 0.15);
    if (r.z < -0.2) {
        return fragmentOutputs;
    }
    let maxDist = uniforms.ssrParams.y;
    let thickness = uniforms.ssrParams.z;
    let steps = i32(uniforms.ssrParams2.x);
    var t = 0.05 + interleavedGradientNoise(pixel) * 0.1;
    var stepLen = maxDist / f32(steps) * 0.5;
    var hit = false;
    var hitUv = vec2f(0.0);
    var prevT = 0.0;
    for (var i = 0; i < steps; i++) {
        let p = vp + r * t;
        let suv = uvOf(p);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0 || p.z < 0.05) {
            break;
        }
        let sz = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0).b;
        let diff = p.z - sz;
        if (diff > 0.0 && diff < thickness + t * 0.02) {
            // refine between the previous and this step
            var a = prevT;
            var b = t;
            for (var k = 0; k < 5; k++) {
                let m = (a + b) * 0.5;
                let pm = vp + r * m;
                let mz = textureSampleLevel(gbuffer, gbufferSampler, uvOf(pm), 0.0).b;
                if (pm.z - mz > 0.0) {
                    b = m;
                } else {
                    a = m;
                }
            }
            hitUv = uvOf(vp + r * b);
            hit = true;
            break;
        }
        prevT = t;
        t = t + stepLen;
        stepLen = stepLen * 1.08;
        if (t > maxDist) {
            break;
        }
    }
    if (!hit) {
        return fragmentOutputs;
    }
    let edge = smoothstep(0.0, 0.08, hitUv.x) * smoothstep(1.0, 0.92, hitUv.x) * smoothstep(0.0, 0.08, hitUv.y) * smoothstep(1.0, 0.92, hitUv.y);
    let fadeDist = 1.0 - smoothstep(maxDist * 0.6, maxDist, t);
    let facing = smoothstep(-0.2, 0.2, r.z);
    let fres = pow(1.0 - clamp(dot(-v, nV), 0.0, 1.0), 3.0) * 0.7 + 0.3;
    let c = textureSampleLevel(sceneTex, sceneTexSampler, hitUv, 0.0).rgb;
    fragmentOutputs.color = vec4f(c, edge * fadeDist * facing * fres * uniforms.ssrParams.x);
    return fragmentOutputs;
}
