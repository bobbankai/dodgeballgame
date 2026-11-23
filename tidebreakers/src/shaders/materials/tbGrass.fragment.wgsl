// tbGrass — toon blades: a gradient from a dark, occluded root to a sunlit tip in the level's two grass
// tones, a little dry straw here and there, light through the blade when the sun is behind it, cast
// shadows and fog. Writes the G-buffer so scenery ink and AO see the grass too.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbShadow>
#include<tbLighting>
varying vUV: vec2f;
varying vPosW: vec3f;
varying vNormalW: vec3f;
varying vViewZ: f32;
varying vShade: vec4f;
uniform view: mat4x4f;
uniform grassA: vec4f;   // root colour rgb, w object id
uniform grassB: vec4f;   // tip colour rgb, w translucency
uniform grassC: vec4f;   // dry colour rgb, w unused

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  if (input.vShade.w < 0.5) { discard; }
  let t = input.vUV.y;
  // blade silhouette: rounded taper (alpha-tested edge for a crisp toon outline)
  let half = 1.0 - t * 0.92;
  if (abs(input.vUV.x) > half * 0.98 + 0.02) { discard; }
  var albedo = mixOklab(uniforms.grassA.rgb, uniforms.grassB.rgb, smoothstep(0.0, 0.9, t) * (0.75 + 0.25 * input.vShade.y));
  albedo = mix(albedo, uniforms.grassC.rgb, input.vShade.z * smoothstep(0.3, 1.0, t) * 0.7);
  let n = normalize(input.vNormalW);
  let v = normalize(globals.camPos.xyz - input.vPosW);
  var s: ToonInput;
  s.albedo = albedo;
  s.n = n;
  s.v = v;
  s.pos = input.vPosW;
  s.ao = input.vShade.x;
  s.cls = CLS_CLOTH;
  s.shadow = sunShadow(input.vPosW, n, input.position.xy);
  s.rimMask = 0.0;
  s.emissive = vec3f(0.0);
  var c = toonShade(s);
  // translucency: sun shining through the blade toward the viewer
  let back = pow(saturate(dot(-v, globals.sunDir.xyz)), 4.0) * t * uniforms.grassB.w;
  c = c + uniforms.grassB.rgb * globals.sunColor.rgb * back * s.shadow * 1.4;
  c = applyFog(c, input.vPosW);
  fragmentOutputs.fragData0 = vec4f(c, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.grassA.w);
}
