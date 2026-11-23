// Domain dome and floor: the inside of a sorcerer's heart laid over the world.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vWorld: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
    vertexOutputs.position = uniforms.viewProjection * wp;
    vertexOutputs.vWorld = wp.xyz;
}
