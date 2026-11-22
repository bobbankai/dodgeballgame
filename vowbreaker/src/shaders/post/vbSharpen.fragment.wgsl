// Contrast-adaptive sharpening (after FXAA): a 3x3 cross whose sharpening weight shrinks where
// local contrast is already high, so ink lines get crisper without ringing and flat cel colour
// stays flat. The last pass, written to the canvas.
#define DISABLE_UNIFORMITY_ANALYSIS

varying vUV: vec2f;

var source: texture_2d<f32>;
var sourceSampler: sampler;

uniform rcpFrame: vec2f;
uniform sharpness: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let uv = fragmentInputs.vUV;
    let t = uniforms.rcpFrame;
    let e = textureSampleLevel(source, sourceSampler, uv, 0.0).rgb;
    if (uniforms.sharpness <= 0.0) {
        fragmentOutputs.color = vec4f(e, 1.0);
        return fragmentOutputs;
    }
    let b = textureSampleLevel(source, sourceSampler, uv + vec2f(0.0, -t.y), 0.0).rgb;
    let d = textureSampleLevel(source, sourceSampler, uv + vec2f(-t.x, 0.0), 0.0).rgb;
    let f = textureSampleLevel(source, sourceSampler, uv + vec2f(t.x, 0.0), 0.0).rgb;
    let h = textureSampleLevel(source, sourceSampler, uv + vec2f(0.0, t.y), 0.0).rgb;
    let mn = min(min(min(d, e), min(f, b)), h);
    let mx = max(max(max(d, e), max(f, b)), h);
    let amp = sqrt(clamp(min(mn, vec3f(1.0) - mx) / max(mx, vec3f(1e-4)), vec3f(0.0), vec3f(1.0)));
    let peak = -1.0 / mix(8.0, 5.0, clamp(uniforms.sharpness, 0.0, 1.0));
    let w = amp * peak;
    let rcpW = 1.0 / (1.0 + 4.0 * w);
    let outc = clamp((b * w + d * w + f * w + h * w + e) * rcpW, vec3f(0.0), vec3f(1.0));
    fragmentOutputs.color = vec4f(outc, 1.0);
}
