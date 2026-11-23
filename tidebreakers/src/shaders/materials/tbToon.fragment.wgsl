// tbToon — skinned / instanced character and prop surfaces (fragment stage).
// MRT: fragData0 = HDR colour, fragData1 = (octahedral view normal, linear depth, object id).
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbShadow>
#include<tbLighting>
#include<tbFace>

varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vColor: vec4f;
varying vUV: vec2f;
varying vAoCls: vec2f;
varying vViewZ: f32;

uniform view: mat4x4f;
uniform faceA: vec4f;
uniform faceB: vec4f;
uniform faceC: vec4f;
uniform faceD: vec4f;
uniform irisA: vec4f;
uniform irisB: vec4f;
uniform faceInk: vec4f;
uniform faceMisc: vec4f;
uniform tint: vec4f;      // rgb multiplier, w = hit flash (white)
uniform fx: vec4f;        // x dissolve 0..1, y outline width, z rim boost, w object id
uniform glowColor: vec4f; // rgb, w intensity for CLS_GLOW parts (Stormheart charge)
uniform aura: vec4f;      // rgb, w intensity: the storm wrapping Kai when he uses his specials

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  // derivatives first (uniform control flow)
  let fwUv = max(fwidth(input.vUV.x), fwidth(input.vUV.y)) * 1.2;
  let pos = input.vPosW;
  var n = normalize(input.vNormalW);
  if (!input.frontFacing) { n = -n; }
  let v = normalize(globals.camPos.xyz - pos);
  // dissolve (defeated enemies, ghosts): noise erosion with a glowing edge
  let dis = uniforms.fx.x;
  var edgeGlow = 0.0;
  if (dis > 0.001) {
    let nz = fbm3(pos * 7.0, 3) * 0.5 + 0.5;
    if (nz < dis) { discard; }
    edgeGlow = smoothstep(dis + 0.06, dis, nz);
  }
  let cls = i32(round((1.0 - input.vAoCls.y) * 10.0));  // glTF flips V on every UV set
  var albedo = input.vColor.rgb * uniforms.tint.rgb;
  let ao = input.vAoCls.x;
  var fp: FaceParams;
  fp.a = uniforms.faceA; fp.b = uniforms.faceB; fp.c = uniforms.faceC; fp.d = uniforms.faceD;
  fp.irisA = uniforms.irisA; fp.irisB = uniforms.irisB; fp.ink = uniforms.faceInk; fp.misc = uniforms.faceMisc;
  let face = drawFace(input.vUV, fwUv, fp, albedo, input.vColor.a * select(0.0, 1.0, cls == CLS_SKIN));
  albedo = mix(albedo, face.col, face.cover);
  var t: ToonInput;
  t.albedo = albedo;
  t.n = n;
  t.v = v;
  t.pos = pos;
  t.ao = ao;
  t.cls = cls;
  t.shadow = sunShadow(pos, n, input.position.xy);
  t.rimMask = 1.0 + uniforms.fx.z;
  t.emissive = vec3f(0.0);
  if (cls == CLS_GLOW) {
    t.emissive = albedo * (1.5 + uniforms.glowColor.w * 4.0) + uniforms.glowColor.rgb * uniforms.glowColor.w * 3.0;
  }
  var col = toonShade(t);
  // eyes and highlights keep their colour in shadow (painted look)
  let litEye = albedo * (globals.sunColor.rgb * globals.sunDir.w * 0.75 + hemiAmbient(n) * 0.35);
  col = mix(col, litEye, face.unlit);
  col = col + vec3f(1.0, 0.55, 0.2) * edgeGlow * 4.0;
  // storm aura: a flickering wind-blue shell on the silhouette, streaking upward
  if (uniforms.aura.w > 0.001) {
    let fr = pow(1.0 - saturate(dot(n, v)), 2.2);
    let sp = input.position.xy * 0.012 + vec2f(0.0, globals.time.x * 1.6);
    let streak = smoothstep(0.25, 0.75, gnoise2(sp * vec2f(3.0, 0.6)) * 0.5 + 0.5);
    let flick = 0.55 + 0.45 * sin(globals.time.x * 23.0 + pos.y * 9.0);
    col = col + uniforms.aura.rgb * uniforms.aura.w * fr * (0.35 + 0.65 * streak) * flick * 2.6;
  }
  col = mix(col, vec3f(1.6, 1.5, 1.4), uniforms.tint.w);
  col = applyFog(col, pos);
  fragmentOutputs.fragData0 = vec4f(col, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.fx.w);
}
