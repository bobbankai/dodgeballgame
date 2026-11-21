// Sky dome: a large sphere that follows the camera, drawn at the far plane.
#define DISABLE_UNIFORMITY_ANALYSIS

attribute position: vec3f;

uniform world: mat4x4f;
uniform viewProjection: mat4x4f;

varying vDir: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let wp = uniforms.world * vec4f(vertexInputs.position, 1.0);
    var clip = uniforms.viewProjection * wp;
    // pin to the far plane so the sky never occludes anything
    clip = vec4f(clip.xy, clip.w * 0.99999, clip.w);
    vertexOutputs.position = clip;
    vertexOutputs.vDir = vertexInputs.position;
}
