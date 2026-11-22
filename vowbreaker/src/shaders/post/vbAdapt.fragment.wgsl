// Auto exposure, step 3: the eye adapts. The average log luminance this frame is eased into the
// previous adapted value (faster toward brighter, as the eye closes quickly and opens slowly)
// and turned into an exposure multiplier, clamped to a range so night scenes stay night.
//   relative mode (default): every stage is graded by hand, so the eye keeps a reference (the
//     level it settled on when the scene began, drifting slowly after it) and only answers
//     changes: a domain's flash, a burning house, a black-out. Steady state = the graded look.
//   absolute mode: aims the average at a key value (photographic auto exposure).
// Output (1x1): r = adapted log luminance, g = exposure scale, b = reference log luminance.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_color>
#include<vb_tonemap>

varying vUV: vec2f;

var current: texture_2d<f32>;
var currentSampler: sampler;
var previous: texture_2d<f32>;
var previousSampler: sampler;

uniform adaptParams: vec4f;      // dt, speed up, speed down, key (absolute) or strength (relative)
uniform adaptRange: vec4f;       // min EV, max EV, reset (1 = jump straight to the new value), mode (0 relative, 1 absolute)

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let cur = textureSampleLevel(current, currentSampler, vec2f(0.5), 0.0).r;
    let prevT = textureSampleLevel(previous, previousSampler, vec2f(0.5), 0.0);
    let dt = uniforms.adaptParams.x;
    var adapted = adaptLuminance(prevT.r, cur, dt, uniforms.adaptParams.y, uniforms.adaptParams.z);
    var reference = prevT.b;
    let reset = uniforms.adaptRange.z > 0.5 || !(abs(prevT.r) < 100.0) || !(abs(prevT.b) < 100.0);
    if (reset) {
        adapted = cur;
        reference = cur;
    }
    var scale = 1.0;
    if (uniforms.adaptRange.w > 0.5) {
        scale = autoExposureScale(adapted, uniforms.adaptParams.w, uniforms.adaptRange.x, uniforms.adaptRange.y);
    } else {
        // the reference drifts toward the adapted level over ~25 s, so lasting changes settle
        reference = mix(reference, adapted, 1.0 - exp(-dt / 25.0));
        let ev = clamp((reference - adapted) * uniforms.adaptParams.w, uniforms.adaptRange.x, uniforms.adaptRange.y);
        scale = exp2(ev);
    }
    fragmentOutputs.color = vec4f(adapted, scale, reference, 1.0);
}
