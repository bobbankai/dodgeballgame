// tbTrail — motion trails behind strikes (vertex stage). Ribbons are built on the CPU each frame from the
// striking fist, foot or blade; uv.x is the sample's age along the trail (0 newest .. 1 oldest), uv.y runs
// across it (0 trailing edge .. 1 leading edge).
#include<tbGlobals>
attribute position: vec3f;
attribute uv: vec2f;
attribute color: vec4f;
uniform viewProjection: mat4x4f;
varying vUV: vec2f;
varying vCol: vec4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  vertexOutputs.position = uniforms.viewProjection * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.vCol = vertexInputs.color;
}
