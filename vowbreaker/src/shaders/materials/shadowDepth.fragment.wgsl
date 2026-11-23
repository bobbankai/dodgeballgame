// Shadow map: the sun's orthographic depth (0 near .. 1 far, linear for an orthographic camera).
#define DISABLE_UNIFORMITY_ANALYSIS

varying vNormalV: vec3f;
varying vViewZ: f32;
varying vId: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let z = fragmentInputs.position.z;
    fragmentOutputs.color = vec4f(z, z, z, 1.0);
}
