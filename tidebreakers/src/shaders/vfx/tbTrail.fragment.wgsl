// tbTrail — anime strike arcs: a hot white leading edge fading into the attack's colour and out toward the
// tail, broken into a few speed streaks. Additive, depth-tested, writes no G-buffer data (so no ink lines).
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
varying vCol: vec4f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let age = saturate(input.vUV.x);
  let across = saturate(input.vUV.y);
  // the leading edge is hot and thin; the body of the arc a soft gradient behind it
  let edge = smoothstep(0.72, 1.0, across);
  let body = smoothstep(0.0, 0.85, across);
  // streaks: thin lines along the arc, sliding back as it fades
  let st = hash11(floor(across * 9.0) + 3.0);
  let streak = smoothstep(0.55, 1.0, st) * smoothstep(0.0, 0.3, fract(across * 9.0)) * (1.0 - smoothstep(0.7, 1.0, fract(across * 9.0)));
  let tailFade = pow(1.0 - age, 1.6);
  var a = (body * 0.45 + edge * 0.9 + streak * 0.35 * (1.0 - age)) * tailFade * input.vCol.a;
  if (a < 0.004) { discard; }
  let hot = mix(input.vCol.rgb, vec3f(3.2, 3.1, 3.0), edge * (1.0 - age * 0.8));
  fragmentOutputs.fragData0 = vec4f(hot * a, a);
  fragmentOutputs.fragData1 = vec4f(0.0);
}
