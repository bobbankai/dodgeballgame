// tbOcean — a camera-centred grid displaced by Gerstner waves (tbWaves), denser near the camera.
attribute position: vec3f;
#include<tbGlobals>
#include<tbWaves>
uniform viewProjection: mat4x4f;
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vCrest: f32;
varying vViewZ: f32;
varying vBase: vec2f;
@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  // grid in [-1,1]^2 with quadratic spacing -> fine near the centre, wide far away
  let g = vertexInputs.position.xz;
  let r = length(g);
  let warp = g * (30.0 + 570.0 * r * r);
  let snap = floor(globals.camPos.xz / 2.0) * 2.0;
  let base = warp + snap;
  let w = gerstner(base, globals.time.x);
  // fade the waves out far away (and under fog)
  let fadeW = 1.0 - smoothstep(120.0, 380.0, length(base - globals.camPos.xz));
  let pos = mix(vec3f(base.x, globals.sea.x, base.y), w.pos, fadeW);
  vertexOutputs.position = uniforms.viewProjection * vec4f(pos, 1.0);
  vertexOutputs.vPosW = pos;
  vertexOutputs.vNormalW = normalize(mix(vec3f(0.0, 1.0, 0.0), w.normal, fadeW));
  vertexOutputs.vCrest = w.crest * fadeW;
  vertexOutputs.vViewZ = vertexOutputs.position.w;
  vertexOutputs.vBase = base;
}
