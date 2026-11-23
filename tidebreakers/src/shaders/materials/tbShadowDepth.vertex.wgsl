// tbShadowDepth — light-space depth for the sun shadow cascades (skinned, instanced, wind-swayed foliage).
attribute position: vec3f;
#include<bonesDeclaration>
#include<instancesDeclaration>
#include<tbGlobals>
uniform viewProjection: mat4x4f;
uniform sway: vec4f;   // x amount (foliage), y stiffness height
varying vDepth: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
#include<bonesVertex>
  var wp = finalWorld * vec4f(vertexInputs.position, 1.0);
  if (uniforms.sway.x > 0.0) {
    let h = max(vertexInputs.position.y, 0.0) / max(uniforms.sway.y, 0.01);
    let ph = globals.time.x * 1.7 + wp.x * 0.35 + wp.z * 0.27;
    let amt = uniforms.sway.x * h * h * globals.wind.z;
    wp = vec4f(wp.x + sin(ph) * amt * globals.wind.x, wp.y, wp.z + sin(ph * 1.3) * amt * globals.wind.y, wp.w);
  }
  let c = uniforms.viewProjection * wp;
  vertexOutputs.position = c;
  vertexOutputs.vDepth = c.z / c.w;
}
