// Ambient weather sprites.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_color>
#include<vb_math>
#include<vb_sdf2d>
#include<vb_vfx>

varying vUV: vec2f;
varying vInfo: vec4f;

uniform ambientColor: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let kind = i32(fragmentInputs.vInfo.x + 0.5);
    let uv = fragmentInputs.vUV;
    let p = uv * 2.0 - 1.0;
    var a = 0.0;
    var col = uniforms.ambientColor.rgb;
    switch kind {
        case 0: {
            a = smoothstep(1.0, 0.0, abs(p.x)) * smoothstep(1.0, 0.2, abs(p.y)) * 0.45;
        }
        case 1: {
            a = spritePetal(uv);
            col = col * (0.85 + 0.25 * fragmentInputs.vInfo.y);
        }
        case 2: {
            a = sdFill(sdRhombus(p, vec2f(0.5, 0.8)), 0.1) * 0.8;
            col = col * (0.6 + 0.4 * fragmentInputs.vInfo.y);
        }
        case 3: {
            a = smoothstep(1.0, 0.2, length(p));
        }
        case 4, 5: {
            let r = length(p);
            a = pow(clamp(1.0 - r, 0.0, 1.0), 2.0);
            col = mix(col, vec3f(1.0, 0.9, 0.7), smoothstep(0.5, 0.0, r)) * 2.0;
        }
        default: {
            a = 0.0;
        }
    }
    a = a * fragmentInputs.vInfo.z * uniforms.ambientColor.a;
    if (a < 0.02) {
        discard;
    }
    fragmentOutputs.color = vec4f(col, a);
}
