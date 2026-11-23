// tbSky — sky dome centred on the camera, drawn at the far plane.
attribute position: vec3f;
uniform viewProjection: mat4x4f;
#include<tbGlobals>
varying vDir: vec3f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let wp = vertexInputs.position * 900.0 + globals.camPos.xyz;
  var c = uniforms.viewProjection * vec4f(wp, 1.0);
  c = vec4f(c.xy, c.w * 0.99999, c.w);
  vertexOutputs.position = c;
  vertexOutputs.vDir = vertexInputs.position;
}
