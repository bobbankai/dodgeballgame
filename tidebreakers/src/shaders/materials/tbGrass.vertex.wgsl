// tbGrass — a field of grass clumps that follows the camera. The CPU wraps a fixed grid of clumps around
// the camera and writes each clump's ground position, height and width, plus how far the player is
// pushing it, into per-instance buffers. Here each blade is bent by layered wind (slow gusts rolling
// across the field plus a quick flutter, stronger toward the tip) and by the push, and gets its colour
// data for the fragment stage.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
attribute position: vec3f;     // z: per-blade curve / yaw variation
attribute uv: vec2f;           // x across the blade (-1..1), y along (0 root .. 1 tip)
attribute cell: vec4f;         // per instance: xyz ground position, w height (0 = hidden)
attribute cell2: vec4f;        // per instance: x random, yz push vector, w width
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
varying vUV: vec2f;
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vViewZ: f32;
varying vShade: vec4f;         // x root occlusion, y tint mix, z dry, w alive

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let root = vertexInputs.cell.xyz;
  let hgt = vertexInputs.cell.w;
  let r0 = vertexInputs.cell2.x;
  let r1 = fract(r0 * 17.31);
  let wid = vertexInputs.cell2.w * (0.7 + 0.6 * r1);
  let yaw = r0 * 6.2831853 + vertexInputs.position.z * 2.1;
  let fwd = vec2f(cos(yaw), sin(yaw));
  let side = vec2f(-fwd.y, fwd.x);
  let t = vertexInputs.uv.y;
  // wind: big slow gusts rolling across the field, plus a quick flutter
  let w = globals.wind;
  let wdir = normalize(w.xy + vec2f(1e-3, 0.0));
  let gust = gnoise2(root.xz * 0.045 - wdir * globals.time.x * 0.9) * 0.5 + 0.5;
  let flutter = sin(globals.time.x * 6.5 + r1 * 30.0 + root.x * 0.7) * 0.12;
  var bend = wdir * (0.22 + gust * 0.85 * max(w.z, 0.35) + flutter);
  bend = bend + vertexInputs.cell2.yz * 1.6;
  let curve = vertexInputs.position.z * 0.35;
  let lean = (fwd * curve + bend) * t * t * hgt;
  let across = side * vertexInputs.uv.x * wid * (1.0 - t * 0.92);
  let wp = vec3f(root.x + across.x + lean.x, root.y + t * hgt * (1.0 - 0.25 * min(length(bend), 1.5) * t), root.z + across.y + lean.y);
  vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
  vertexOutputs.vUV = vertexInputs.uv;
  vertexOutputs.vPosW = wp;
  vertexOutputs.vNormalW = normalize(vec3f(fwd.x * 0.35 + bend.x * 0.2, 1.0, fwd.y * 0.35 + bend.y * 0.2));
  vertexOutputs.vViewZ = vertexOutputs.position.w;
  let dry = smoothstep(0.55, 0.9, gnoise2(root.xz * 0.08 + 11.0) * 0.5 + 0.5);
  vertexOutputs.vShade = vec4f(mix(0.45, 1.0, t), r1, dry, step(0.01, hgt));
}
