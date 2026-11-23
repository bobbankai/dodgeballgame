// Separable depth-aware (bilateral) blur for the ambient obscurance buffer (r = value, g = depth).
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_color>
#include<vb_sampling>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform blurDir: vec2f;      // texel step along the blur axis
uniform sharpness: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let c = textureSampleLevel(source, sourceSampler, uv, 0.0);
    let z0 = c.g;
    var sum = c.r;
    var wsum = 1.0;
    for (var i = 1; i <= 4; i++) {
        let fi = f32(i);
        let gw = gaussianWeight(fi, 2.2);
        let a = textureSampleLevel(source, sourceSampler, uv + uniforms.blurDir * fi, 0.0);
        let b = textureSampleLevel(source, sourceSampler, uv - uniforms.blurDir * fi, 0.0);
        let wa = gw * bilateralDepthWeight(z0, a.g, uniforms.sharpness);
        let wb = gw * bilateralDepthWeight(z0, b.g, uniforms.sharpness);
        sum = sum + a.r * wa + b.r * wb;
        wsum = wsum + wa + wb;
    }
    fragmentOutputs.color = vec4f(sum / wsum, z0, 0.0, 1.0);
}
