attribute position: vec3f;
attribute normal: vec3f;
#include<bonesDeclaration>
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
varying vNormalW: vec3f;
varying vViewZ: f32;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
  let wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * wp;
  vertexOutputs.vNormalW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
  vertexOutputs.vViewZ = (uniforms.view * wp).z;
}
