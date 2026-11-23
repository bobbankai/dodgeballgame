// tbToon — skinned / instanced character and prop surfaces (vertex stage).
attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
attribute uv: vec2f;
attribute uv2: vec2f;
#include<bonesDeclaration>
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
uniform fx: vec4f;
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vColor: vec4f;
varying vUV: vec2f;
varying vAoCls: vec2f;
varying vViewZ: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
  let wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  vertexOutputs.position = uniforms.viewProjection * wp;
  vertexOutputs.vNormalW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
  vertexOutputs.vPosW = wp.xyz;
#ifdef VERTEXCOLOR
  vertexOutputs.vColor = vertexInputs.color;
#else
  vertexOutputs.vColor = vec4f(0.8, 0.8, 0.8, 0.0);
#endif
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.vAoCls = vertexInputs.uv2;
  vertexOutputs.vViewZ = (uniforms.view * wp).z;
}
