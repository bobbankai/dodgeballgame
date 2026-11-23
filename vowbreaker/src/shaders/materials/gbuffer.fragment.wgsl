// G-buffer for the post chain: octahedral view-space normal (rg), linear view depth in metres (b),
// object / material id (a). Read by ambient occlusion, ink edges, fog, depth of field, god rays.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_math>

varying vNormalV: vec3f;
varying vViewZ: f32;
varying vId: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let n = normalize(fragmentInputs.vNormalV);
    fragmentOutputs.color = vec4f(octEncode(n), fragmentInputs.vViewZ, fragmentInputs.vId);
}
