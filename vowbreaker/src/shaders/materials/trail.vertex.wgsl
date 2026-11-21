// Slash trails: ribbons built on the CPU from a bone's recent positions (head of the ribbon at the
// fist or foot, tail fading behind). uv.x runs head (0) to tail (1), uv.y across the ribbon.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;
attribute uv: vec2f;

uniform viewProjection: mat4x4f;

varying vUV: vec2f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.viewProjection * vec4f(vertexInputs.position, 1.0);
    vertexOutputs.vUV = vertexInputs.uv;
}
