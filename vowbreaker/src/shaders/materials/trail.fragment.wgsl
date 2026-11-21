// Slash trails: a hot core along the leading edge, the technique's palette behind it, torn into
// streaks by noise and dissolving toward the tail; the Black Spark variant is black with red fringe.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>

varying vUV: vec2f;

uniform trailParams: vec4f;   // palette, intensity, black spark (0/1), time

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let u = fragmentInputs.vUV.x;
    let v = fragmentInputs.vUV.y;
    let t = uniforms.trailParams.w;
    let pal = paletteFor(i32(uniforms.trailParams.x));
    let across = abs(v - 0.5) * 2.0;
    let streaks = valueNoise2(vec2f(u * 3.0 - t * 4.0, v * 18.0));
    let width = (1.0 - u) * (0.75 + 0.25 * streaks);
    let body = smoothstep(width, width * 0.6, across);
    let edge = smoothstep(0.25, 0.0, abs(v - 0.15)) * (1.0 - u);
    let dissolve = smoothstep(u * 1.1, u * 1.1 + 0.15, streaks);
    let heat = clamp((1.0 - u) * 1.2 - across * 0.4, 0.0, 1.0);
    var col = paletteRamp(pal, heat) * 2.0;
    if (uniforms.trailParams.z > 0.5) {
        col = mix(vec3f(1.0, 0.05, 0.12) * 2.5, vec3f(0.0), smoothstep(0.3, 0.0, across));
    }
    col = col + vec3f(1.0) * edge * 0.5;
    let a = body * dissolve * uniforms.trailParams.y;
    fragmentOutputs.color = vec4f(col * a, a * 0.5);
}
