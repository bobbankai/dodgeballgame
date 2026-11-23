// Auto exposure, step 2: a weighted 4x4 box reduction (run repeatedly down to 1x1). R holds the
// log luminance, G the weight it carries.
#define DISABLE_UNIFORMITY_ANALYSIS

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform texel: vec2f;            // source texel size

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    var acc = 0.0;
    var wsum = 0.0;
    for (var j = 0; j < 4; j++) {
        for (var i = 0; i < 4; i++) {
            let o = (vec2f(f32(i), f32(j)) - 1.5) * uniforms.texel;
            let s = textureSampleLevel(source, sourceSampler, fragmentInputs.vUV + o, 0.0);
            acc = acc + s.r * s.g;
            wsum = wsum + s.g;
        }
    }
    fragmentOutputs.color = vec4f(acc / max(wsum, 1e-4), wsum / 16.0, 0.0, 1.0);
}
