// tbEnv — scenery (kit pieces, props, foliage). Vertex colours carry albedo (rgb) and wind sway (a);
// TEXCOORD_1 carries (baked AO, material class / 20).
attribute position: vec3f;
attribute normal: vec3f;
#ifdef VERTEXCOLOR
attribute color: vec4f;
#endif
attribute uv2: vec2f;
#include<instancesDeclaration>
#include<tbGlobals>
uniform viewProjection: mat4x4f;
uniform envFx: vec4f;   // x sway scale, y sway height, z tint strength, w object id
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vColor: vec4f;
varying vAoCls: vec2f;
varying vViewZ: f32;
varying vLocal: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
#include<instancesVertex>
  var wp = finalWorld * vec4f(vertexInputs.position, 1.0);
#ifdef VERTEXCOLOR
  let col = vertexInputs.color;
#else
  let col = vec4f(0.7, 0.7, 0.7, 0.0);
#endif
  let sway = col.a * uniforms.envFx.x;
  if (sway > 0.0) {
    let ph = globals.time.x * 1.6 + wp.x * 0.31 + wp.z * 0.23;
    let gust = 0.6 + 0.4 * sin(globals.time.x * 0.45 + wp.x * 0.05);
    let s = sway * globals.wind.z * gust;
    wp = vec4f(wp.x + (sin(ph) * 0.06 + globals.wind.x * 0.05) * s, wp.y + sin(ph * 1.7) * 0.015 * s, wp.z + (sin(ph * 1.3 + 1.0) * 0.06 + globals.wind.y * 0.05) * s, wp.w);
  }
  vertexOutputs.position = uniforms.viewProjection * wp;
  vertexOutputs.vNormalW = normalize((finalWorld * vec4f(vertexInputs.normal, 0.0)).xyz);
  vertexOutputs.vPosW = wp.xyz;
  vertexOutputs.vColor = col;
  vertexOutputs.vAoCls = vertexInputs.uv2;
  vertexOutputs.vViewZ = vertexOutputs.position.w;
  vertexOutputs.vLocal = vertexInputs.position;
}
