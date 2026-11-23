// tbEnv — scenery fragment: painted procedural detail, toon light, shadows, fog; MRT output.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbShadow>
#include<tbLighting>
#include<tbSurface>
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vColor: vec4f;
varying vAoCls: vec2f;
varying vViewZ: f32;
varying vLocal: vec3f;
uniform view: mat4x4f;
uniform envFx: vec4f;
uniform envTint: vec4f;   // rgb tint, w = emissive boost for glow class

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var n = normalize(input.vNormalW);
  if (!input.frontFacing) { n = -n; }
  let pos = input.vPosW;
  let ecls = i32(round((1.0 - input.vAoCls.y) * 20.0));
  var albedo = input.vColor.rgb * uniforms.envTint.rgb;
  albedo = surfaceDetail(ecls, pos, n, albedo);
  var t: ToonInput;
  t.albedo = albedo;
  t.n = n;
  t.v = normalize(globals.camPos.xyz - pos);
  t.pos = pos;
  t.ao = input.vAoCls.x;
  t.cls = select(CLS_CLOTH, CLS_METAL, ecls == ECLS_METAL);
  t.shadow = sunShadow(pos, n, input.position.xy);
  t.rimMask = 0.35;
  t.emissive = vec3f(0.0);
  if (ecls == ECLS_GLOW) { t.emissive = albedo * (2.5 + uniforms.envTint.w * 3.0); }
  if (ecls == ECLS_FOLIAGE) {
    // light through leaves
    let back = saturate(dot(-t.v, globals.sunDir.xyz));
    t.emissive = t.emissive + albedo * globals.sunColor.rgb * pow(back, 4.0) * 0.6;
  }
  var col = toonShade(t);
  col = applyFog(col, pos);
  fragmentOutputs.fragData0 = vec4f(col, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.envFx.w);
}
