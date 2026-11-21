// Bokeh depth of field for cutscenes, two modes:
//   0 circle of confusion + premultiplied half-res colour (rgb * coc weight, a = signed coc)
//   1 gather: a golden-angle spiral of samples whose radius follows the CoC, with background
//     samples rejected where they'd bleed over sharper foreground (a la Jimenez / Abadie)
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_color>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform dofParams: vec4f;        // focus distance (m), focus range (m), max radius (px), mode
uniform screenParams: vec4f;     // width, height of this pass, 1/w, 1/h

const DOF_SAMPLES: i32 = 36;

fn cocAt(z: f32) -> f32 {
    // signed: negative in front of the focus plane, positive behind
    let d = z - uniforms.dofParams.x;
    let r = clamp((abs(d) - uniforms.dofParams.y * 0.5) / max(uniforms.dofParams.y, 0.01), 0.0, 1.0);
    return r * sign(d);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    if (uniforms.dofParams.w < 0.5) {
        let c = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
        let z = min(textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0).b, 400.0);
        let coc = cocAt(z);
        // bright pixels make the bokeh discs pop (a gentle Karis-like boost, clamped)
        let boost = 1.0 + clamp(luma(c) - 1.0, 0.0, 3.0) * 0.5;
        fragmentOutputs.color = vec4f(c * boost, coc);
        return fragmentOutputs;
    }
    let center = textureSampleLevel(source, sourceSampler, uv, 0.0);
    let maxR = uniforms.dofParams.z;
    let rCenter = abs(center.a) * maxR;
    var acc = center.rgb;
    var wsum = 1.0;
    let rot = interleavedGradientNoise(uv * uniforms.screenParams.xy) * TAU;
    for (var i = 0; i < DOF_SAMPLES; i++) {
        let fi = f32(i);
        let r = sqrt((fi + 0.5) / f32(DOF_SAMPLES)) * maxR;
        let a = fi * GOLDEN_ANGLE + rot;
        let off = vec2f(cos(a), sin(a)) * r * uniforms.screenParams.zw;
        let s = textureSampleLevel(source, sourceSampler, uv + off, 0.0);
        let rs = abs(s.a) * maxR;
        // a sample contributes if its own blur disc reaches this pixel; background samples can't
        // spread over a sharper foreground
        var w = smoothstep(r - 1.0, r + 1.0, rs);
        if (s.a > center.a + 0.05 && center.a < 0.0) {
            w = w * 0.0;
        }
        w = w * select(1.0, smoothstep(r - 1.0, r + 1.0, max(rCenter, rs)), s.a > 0.0);
        acc = acc + s.rgb * w;
        wsum = wsum + w;
    }
    let col = acc / wsum;
    fragmentOutputs.color = vec4f(col, abs(center.a));
}
