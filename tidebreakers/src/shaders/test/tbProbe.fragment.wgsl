varying vNormalW: vec3f;
varying vViewZ: f32;
struct Globals { sunDir: vec4f, time: vec4f };
var<uniform> globals: Globals;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(input.vNormalW);
  let ndl = dot(n, globals.sunDir.xyz);
  let lit = smoothstep(0.0, 0.04, ndl);
  let c = mix(vec3f(0.18, 0.22, 0.45), vec3f(1.0, 0.62, 0.32), lit);
  fragmentOutputs.fragData0 = vec4f(c, 1.0);
  fragmentOutputs.fragData1 = vec4f(n * 0.5 + 0.5, input.vViewZ);
}
