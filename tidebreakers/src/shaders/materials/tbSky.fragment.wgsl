#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbSkyModel>
varying vDir: vec3f;
uniform skyA: vec4f;   // zenith rgb, w cloud cover
uniform skyB: vec4f;   // horizon rgb, w cloud height
uniform skyC: vec4f;   // sun glow rgb, w sun disc size
uniform skyD: vec4f;   // cloud lit rgb, w stars
uniform skyE: vec4f;   // cloud shade rgb, w moon (0/1)
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let dir = normalize(input.vDir);
  var k = defaultSky();
  k.zenith = uniforms.skyA.rgb;
  k.horizon = uniforms.skyB.rgb;
  k.ground = globals.fogColor.rgb;
  k.sunGlow = uniforms.skyC.rgb;
  k.cloudLit = uniforms.skyD.rgb;
  k.cloudShade = uniforms.skyE.rgb;
  k.cloudCover = uniforms.skyA.w;
  k.cloudHeight = uniforms.skyB.w;
  var col = skyGradient(dir, k);
  // stars at night
  if (uniforms.skyD.w > 0.0 && dir.y > 0.0) {
    let sp = dir / max(abs(dir.y), 0.2) * 120.0;
    let cell = floor(sp.xz);
    let h = hash12(cell);
    let f = fract(sp.xz) - 0.5;
    let star = smoothstep(0.08, 0.0, length(f + (hash22(cell) - 0.5) * 0.6)) * step(0.985, h);
    col = col + vec3f(0.9, 0.95, 1.0) * star * uniforms.skyD.w * (0.6 + 0.4 * sin(globals.time.x * 3.0 + h * 50.0));
  }
  let disc = sunDisc(dir, uniforms.skyC.w);
  if (uniforms.skyE.w > 0.5) {
    col = col + vec3f(0.85, 0.9, 1.0) * disc * 1.5;
  } else {
    col = col + globals.sunColor.rgb * disc * 6.0;
  }
  let cl = skyClouds(dir, k, globals.time.x);
  col = mix(col, cl.rgb, cl.a);
  fragmentOutputs.fragData0 = vec4f(col, 1.0);
  fragmentOutputs.fragData1 = vec4f(0.5, 0.5, 0.0, 0.0);
}
