// Sumi-e (vb_sumie): the memories painted as ink on rice paper. Reads the display image and the
// G-buffer, repaints values as banded ink washes with wet edges and granulation, turns depth and
// normal breaks into brush strokes stretched along the edge, keeps one hue if asked, lays it all on
// fibrous paper with a deckled border. Blended with the plain image by sumieParams.x.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sumie>

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;
var gbuffer: texture_2d<f32>;
var gbufferSampler: sampler;

uniform screenParams: vec4f;    // width, height, 1/w, 1/h
uniform sumieParams: vec4f;     // amount, colour kept, ink density, time
uniform sumieParams2: vec4f;    // kept hue (negative = none), stroke width (px), seed, paper tint

fn lumAt(uv: vec2f) -> f32 {
    return luma(textureSampleLevel(source, sourceSampler, uv, 0.0).rgb);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let src = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    let amount = uniforms.sumieParams.x;
    if (amount <= 0.0) {
        fragmentOutputs.color = vec4f(src, 1.0);
        return fragmentOutputs;
    }
    let texel = uniforms.screenParams.zw;
    let pixel = uv * uniforms.screenParams.xy;
    let aspect = uniforms.screenParams.x * uniforms.screenParams.w;
    let seed = uniforms.sumieParams2.z;
    // the brush boils on slow twos (memories move less than the present)
    let st = floor(uniforms.sumieParams.w * 6.0);
    let wob = (vec2f(valueNoise2(pixel * 0.02 + st), valueNoise2(pixel * 0.02 + st + 9.0)) - 0.5) * 1.5 * texel;
    let suv = uv + wob;

    // --- washes from the image's values -----------------------------------------------------------------
    let n = vfbm2(pixel * 0.01 + seed, 3);
    let l = lumAt(suv);
    let tone = sumieWash(l, n) * uniforms.sumieParams.z;
    let r = 3.0;
    let tx = sumieWash(lumAt(suv + vec2f(texel.x * r, 0.0)), n) * uniforms.sumieParams.z;
    let ty = sumieWash(lumAt(suv + vec2f(0.0, texel.y * r)), n) * uniforms.sumieParams.z;
    var ink = sumieGranulate(tone, pixel, seed);
    ink = clamp(ink + sumieWetEdge(tone, tx, ty) * 0.45, 0.0, 1.0);

    // --- brush strokes on the edges ----------------------------------------------------------------------------
    let g = textureSampleLevel(gbuffer, gbufferSampler, suv, 0.0);
    let z = g.b;
    let w = uniforms.sumieParams2.y * mix(1.4, 0.5, smoothstep(3.0, 40.0, min(z, 200.0)));
    var edge = 0.0;
    var dir = vec2f(0.0);
    for (var k = 0; k < 4; k++) {
        let a = f32(k) * 0.785398;
        let o = vec2f(cos(a), sin(a)) * texel * w;
        let ga = textureSampleLevel(gbuffer, gbufferSampler, suv + o, 0.0);
        let gb = textureSampleLevel(gbuffer, gbufferSampler, suv - o, 0.0);
        let dz = abs(ga.b - gb.b) / max(min(ga.b, gb.b), 0.1);
        let dn = length(ga.rg - gb.rg);
        let dl = abs(lumAt(suv + o) - lumAt(suv - o));
        let e = max(smoothstep(0.08, 0.3, dz), max(smoothstep(0.35, 0.8, dn), smoothstep(0.25, 0.5, dl) * 0.7));
        if (e > edge) {
            edge = e;
            dir = vec2f(cos(a), sin(a));
        }
    }
    // no strokes on the empty sky (it is left as paper with a pale wash)
    let sky = step(500.0, z);
    let stroke = edge * sumieStrokeTexture(pixel, dir, seed + st * 0.1) * (1.0 - sky);
    ink = max(ink * (1.0 - sky * 0.7), stroke * 0.95);

    // --- paper, colour and the deckled border -------------------------------------------------------------------
    let paperTone = uniforms.sumieParams2.w;
    let paper = vec3f(0.95, 0.92, 0.85) * mix(1.0, 0.92, paperTone) * sumiePaper(pixel, seed);
    var col = mix(paper, sumieInkColor(ink), ink);
    // a faint wash of the original colour, and the one hue that is kept in full
    let keep = sumieKeepHue(src, uniforms.sumieParams2.x);
    col = mix(col, col * mix(vec3f(1.0), src / max(luma(src), 0.05), 0.5), uniforms.sumieParams.y * (1.0 - ink) * 0.5);
    col = mix(col, src * 1.1, keep * 0.9);
    let border = sumieBorder(uv, aspect, seed);
    col = mix(paper, col, border);
    fragmentOutputs.color = vec4f(mix(src, col, amount), 1.0);
}
