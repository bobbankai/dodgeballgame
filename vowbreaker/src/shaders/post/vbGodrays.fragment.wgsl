// Screen-space light shafts (Mitchell, GPU Gems 3): march from each pixel toward the light's screen
// position, accumulating a bright-sky mask with decay. The mask comes from the G-buffer (open sky)
// and the scene's brightness, so lanterns and the moon can also throw rays when asked.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_color>

varying vUV: vec2f;

var sceneTex: texture_2d<f32>;
var sceneTexSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform lightUV: vec3f;          // light position in uv, z = 1 when on screen / in front
uniform rayParams: vec4f;        // density, decay, weight, exposure
uniform rayThreshold: f32;
uniform screenParams: vec4f;

const RAY_SAMPLES: i32 = 40;

fn occluder(uv: vec2f) -> vec3f {
    let z = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0).b;
    let c = textureSampleLevel(sceneTex, sceneTexSampler, uv, 0.0).rgb;
    let open = step(500.0, z);
    let bright = smoothstep(uniforms.rayThreshold, uniforms.rayThreshold * 2.0 + 0.5, luma(c));
    return c * max(open * 0.6, bright) * select(0.25, 1.0, open > 0.5);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (uniforms.lightUV.z <= 0.0) {
        fragmentOutputs.color = vec4f(0.0, 0.0, 0.0, 1.0);
        return fragmentOutputs;
    }
    var uv = fragmentInputs.vUV;
    let delta = (uv - uniforms.lightUV.xy) * (uniforms.rayParams.x / f32(RAY_SAMPLES));
    let jitter = interleavedGradientNoise(uv * uniforms.screenParams.xy);
    uv = uv - delta * jitter;
    var illum = 1.0;
    var acc = vec3f(0.0);
    for (var i = 0; i < RAY_SAMPLES; i++) {
        uv = uv - delta;
        let s = occluder(clamp(uv, vec2f(0.001), vec2f(0.999)));
        acc = acc + s * illum * uniforms.rayParams.z;
        illum = illum * uniforms.rayParams.y;
    }
    // fade as the light leaves the screen
    let edge = 1.0 - smoothstep(0.4, 0.9, length(uniforms.lightUV.xy - 0.5));
    fragmentOutputs.color = vec4f(acc * uniforms.rayParams.w * edge * uniforms.lightUV.z, 1.0);
}
