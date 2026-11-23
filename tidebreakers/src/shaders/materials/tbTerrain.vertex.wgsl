// tbTerrain — island heightfields (geometry displaced on the CPU). Vertex colour: r path, g grass
// lushness, b rock override, a wetness.
attribute position: vec3f;
attribute normal: vec3f;
attribute color: vec4f;
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vMask: vec4f;
varying vViewZ: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
  let wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * wp;
  vertexOutputs.vNormalW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
  vertexOutputs.vPosW = wp.xyz;
  vertexOutputs.vMask = vertexInputs.color;
  vertexOutputs.vViewZ = vertexOutputs.position.w;
}
