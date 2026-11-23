// tbParticle — camera-facing (or ground-aligned) particle quads, one thin instance per particle.
// pdata: xyz position, w size      pvel: xyz velocity (for streak stretch), w mode (0 billboard, 1 ground, 2 velocity-aligned)
// pinfo: x rotation, y life 0..1, z shape id, w stretch     pcol: rgba (HDR)
attribute position: vec3f;
attribute pdata: vec4f;
attribute pvel: vec4f;
attribute pinfo: vec4f;
attribute pcol: vec4f;
#include<instancesDeclaration>
uniform viewProjection: mat4x4f;
uniform view: mat4x4f;
varying vUV: vec2f;
varying vInfo: vec4f;
varying vCol: vec4f;
varying vWorld: vec3f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
  let corner = vertexInputs.position.xy;          // -0.5..0.5
  let c = vertexInputs.pdata.xyz;
  let size = vertexInputs.pdata.w;
  let rot = vertexInputs.pinfo.x;
  let cr = cos(rot);
  let sr = sin(rot);
  var q = vec2f(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr) * size;
  let right = vec3f(uniforms.view[0][0], uniforms.view[1][0], uniforms.view[2][0]);
  let up = vec3f(uniforms.view[0][1], uniforms.view[1][1], uniforms.view[2][1]);
  var wp = c + right * q.x + up * q.y;
  let mode = vertexInputs.pvel.w;
  if (mode > 0.5 && mode < 1.5) {
    wp = c + vec3f(q.x, 0.0, q.y);
  } else if (mode > 1.5) {
    let v = vertexInputs.pvel.xyz;
    let vl = length(v);
    if (vl > 1e-4) {
      let d = v / vl;
      let toCam = normalize(vec3f(uniforms.view[0][2], uniforms.view[1][2], uniforms.view[2][2]));
      let side = normalize(cross(d, toCam) + vec3f(1e-5));
      let stretch = 1.0 + vertexInputs.pinfo.w * vl * 0.05;
      wp = c + side * corner.x * size + d * corner.y * size * stretch;
    }
  }
  vertexOutputs.position = uniforms.viewProjection * vec4f(wp, 1.0);
  vertexOutputs.vUV = corner + 0.5;
  vertexOutputs.vInfo = vertexInputs.pinfo;
  vertexOutputs.vCol = vertexInputs.pcol;
  vertexOutputs.vWorld = wp;
}
