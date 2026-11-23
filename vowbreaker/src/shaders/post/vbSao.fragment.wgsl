// Scalable Ambient Obscurance (McGuire, Mara, Luebke 2012) on the G-buffer: a spiral of samples in
// screen space around each pixel, each one compared against the pixel's tangent plane. Runs at half
// resolution; vbBilateral cleans it up. Output: r = visibility (1 open, 0 occluded), g = linear depth.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_math>

varying vUV: vec2f;

var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform projParams: vec4f;   // tan(fovY/2), aspect, near, far
uniform aoParams: vec4f;     // radius (m), intensity, bias, frame
uniform screenParams: vec4f; // full width, full height, ao width, ao height

const SAO_SAMPLES: i32 = 14;
const SAO_TURNS: f32 = 7.0;

fn gbufferAt(uv: vec2f) -> vec4f {
    return textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0);
}

fn viewPosAt(uv: vec2f, z: f32) -> vec3f {
    let ndc = uv * 2.0 - 1.0;
    return vec3f(ndc.x * uniforms.projParams.x * uniforms.projParams.y * z, ndc.y * uniforms.projParams.x * z, z);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let g = gbufferAt(uv);
    let z = g.b;
    if (z > 500.0 || z <= 0.0) {
        fragmentOutputs.color = vec4f(1.0, z, 0.0, 1.0);
        return fragmentOutputs;
    }
    let n = octDecode(g.rg);
    let P = viewPosAt(uv, z);
    let radius = uniforms.aoParams.x;
    // screen-space radius in uv units (vertical); clamp so close-ups don't sample the whole screen
    let ssR = min(radius / (z * uniforms.projParams.x * 2.0), 0.12);
    let pixel = uv * uniforms.screenParams.zw;
    let phi = interleavedGradientNoiseAnimated(pixel, uniforms.aoParams.w) * TAU;
    var sum = 0.0;
    for (var i = 0; i < SAO_SAMPLES; i++) {
        let alpha = (f32(i) + 0.5) / f32(SAO_SAMPLES);
        let angle = alpha * SAO_TURNS * TAU + phi;
        let r = ssR * alpha;
        let off = vec2f(cos(angle) / uniforms.projParams.y, sin(angle)) * r;
        let suv = uv + off;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
            continue;
        }
        let sz = gbufferAt(suv).b;
        if (sz > 500.0) {
            continue;
        }
        let Q = viewPosAt(suv, sz);
        let v = Q - P;
        let vv = dot(v, v);
        let vn = dot(v, n);
        let rr = radius * radius;
        let f = max(rr - vv, 0.0);
        sum = sum + f * f * f * max((vn - uniforms.aoParams.z * z * 0.02) / (0.01 + vv), 0.0);
    }
    let rr = radius * radius;
    let temp = rr * rr * rr * radius;
    var ao = max(0.0, 1.0 - sum * uniforms.aoParams.y * (5.0 / temp) / f32(SAO_SAMPLES));
    // a little contact darkening that fades over distance (keeps far scenery bright and painted)
    ao = mix(ao, 1.0, smoothstep(30.0, 70.0, z));
    fragmentOutputs.color = vec4f(ao, z, 0.0, 1.0);
}
