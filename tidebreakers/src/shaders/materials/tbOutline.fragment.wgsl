// tbOutline — line colour is a darker, more saturated version of the surface colour (coloured ink).
#include<tbGlobals>
#include<tbCommon>
varying vColor: vec3f;
varying vViewZ: f32;
varying vNormalV: vec3f;
uniform fx: vec4f;
uniform inkColor: vec4f;   // rgb ink, w = how much of the surface colour bleeds into the line

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  if (uniforms.fx.x > 0.001 || input.frontFacing) { discard; }
  let surf = saturateColor(input.vColor * 0.32, 1.35);
  var c = mix(uniforms.inkColor.rgb, surf, uniforms.inkColor.w);
  c = c * (0.6 + 0.4 * globals.sunDir.w);
  fragmentOutputs.fragData0 = vec4f(c, 1.0);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(normalize(input.vNormalV)), input.vViewZ, uniforms.fx.w);
}
