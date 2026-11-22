// The crowd (vb_crowd): flat cel figures lit by the festival. Yukata in a palette of festival
// colours and patterns, dark hair, faces left blank (they are background, the eye should slide off
// them), a rim of the lantern light, held lanterns glowing. Far figures sink into the fog.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_crowd>

varying vNormalW: vec3f;
varying vWorld: vec3f;
varying vUV: vec2f;
varying vPart: f32;
varying vLook: vec4f;

uniform cameraPosition: vec3f;
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform glowColor: vec3f;
uniform crowdFog: vec4f;       // fog colour rgb, density

fn crowdPalette(i: i32) -> vec3f {
    switch i % 8 {
        case 0: { return vec3f(0.12, 0.18, 0.45); }
        case 1: { return vec3f(0.75, 0.2, 0.25); }
        case 2: { return vec3f(0.9, 0.85, 0.75); }
        case 3: { return vec3f(0.25, 0.45, 0.35); }
        case 4: { return vec3f(0.55, 0.3, 0.6); }
        case 5: { return vec3f(0.92, 0.6, 0.25); }
        case 6: { return vec3f(0.15, 0.13, 0.16); }
        default: { return vec3f(0.6, 0.75, 0.85); }
    }
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let part = i32(fragmentInputs.vPart + 0.5);
    let pal = i32(fragmentInputs.vLook.x + 0.5);
    let pattern = i32(fragmentInputs.vLook.y + 0.5);
    let prop = i32(fragmentInputs.vLook.z + 0.5);
    let n = normalize(fragmentInputs.vNormalW);
    let V = normalize(uniforms.cameraPosition - fragmentInputs.vWorld);
    let base = crowdPalette(pal);
    let accent = mix(vec3f(0.95, 0.92, 0.85), crowdPalette(pal + 3), 0.4);
    var albedo = crowdFabric(fragmentInputs.vUV, pattern, base, accent);
    var emissive = vec3f(0.0);
    switch part {
        case 1: {
            // a head: dark hair above, skin below at the front
            let face = step(0.0, n.z) * step(fragmentInputs.vUV.y, 0.55);
            albedo = mix(vec3f(0.06, 0.05, 0.06), vec3f(0.85, 0.7, 0.6), face);
        }
        case 2, 3: {
            albedo = mix(albedo * 0.7, vec3f(0.35, 0.25, 0.18), step(fragmentInputs.vUV.y, 0.08));
        }
        case 6, 7, 8, 9: {
            if (prop == 1) {
                // a paper lantern held up: it glows
                albedo = vec3f(1.0, 0.75, 0.4);
                emissive = uniforms.glowColor * 1.8 * (0.85 + 0.15 * sin(fragmentInputs.vWorld.x * 3.0 + fragmentInputs.vLook.w * 30.0));
            } else if (prop == 2) {
                albedo = vec3f(0.95, 0.9, 0.8);
            } else if (prop == 4) {
                albedo = mix(vec3f(0.8, 0.15, 0.12), vec3f(0.95, 0.9, 0.8), step(0.5, fract(atan2(n.z, n.x) * 1.6)));
            } else {
                albedo = crowdPalette(pal + 5);
            }
        }
        default: {}
    }
    // festival light: warm from the lanterns above, cool sky fill, a lantern-coloured rim
    let l = normalize(uniforms.sunDir);
    let ndl = dot(n, l) * 0.5 + 0.5;
    let cel = smoothstep(0.45, 0.55, ndl);
    var col = albedo * mix(uniforms.skyColor * 0.8 + vec3f(0.05), uniforms.sunColor * 0.7 + uniforms.glowColor * 0.25, cel);
    let rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
    col = col + uniforms.glowColor * rim * 0.35 + emissive;
    // far figures sink into the night air
    let dist = length(fragmentInputs.vWorld - uniforms.cameraPosition);
    let fog = 1.0 - exp(-dist * uniforms.crowdFog.w);
    col = mix(col, uniforms.crowdFog.rgb, clamp(fog, 0.0, 0.9));
    fragmentOutputs.color = vec4f(col, 1.0);
}
