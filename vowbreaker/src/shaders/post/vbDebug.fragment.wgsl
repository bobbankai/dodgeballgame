// Debug views of the renderer's buffers (?debug=<name>, PostSettings.debugView), drawn over the
// finished frame: G-buffer normals, linear depth, object ids, ambient obscurance, contact shadows,
// bounce light, auras, bloom. A legend strip at the bottom shows the depth / id scale.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_color>
#include<vb_math>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;
var aux: texture_2d<f32>;
var auxSampler: sampler;

uniform debugParams: vec4f;      // view, far depth for the scale, -, -

fn idColor(id: f32) -> vec3f {
    if (id < 0.5) {
        return vec3f(0.0);
    }
    let h = hash11(floor(id + 0.5) * 0.618);
    return hsvToRgb(vec3f(h, 0.65, 0.95));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let view = i32(uniforms.debugParams.x + 0.5);
    let base = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let g = textureSampleLevel(gbuffer, gbufferSampler, uv, 0.0);
    var col = base;
    switch view {
        case 1: { col = octDecode(g.rg) * 0.5 + 0.5; }
        case 2: {
            let z = g.b / max(uniforms.debugParams.y, 1.0);
            col = select(vec3f(pow(clamp(z, 0.0, 1.0), 0.45)), vec3f(0.15, 0.25, 0.6), g.b > 500.0);
        }
        case 3: {
            col = idColor(g.a);
            // fighters' id blocks are outlined in white
            if (g.a >= 999.5 && g.a < 1999.5) {
                col = mix(col, vec3f(1.0), 0.3);
            }
        }
        case 4, 5: { col = vec3f(textureSampleLevel(aux, auxSampler, uv, 0.0).r); }
        case 6, 7, 8: { col = textureSampleLevel(aux, auxSampler, uv, 0.0).rgb; }
        case 9: { col = textureSampleLevel(aux, auxSampler, uv, 0.0).rgb * 4.0; }
        default: {}
    }
    // a legend strip along the bottom
    if (view == 2 && uv.y < 0.025) {
        col = vec3f(pow(uv.x, 0.45));
    }
    fragmentOutputs.color = vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
