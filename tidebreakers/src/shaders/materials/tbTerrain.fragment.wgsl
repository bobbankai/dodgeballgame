// tbTerrain — painted island ground: wet sand at the waterline, dry sand, grass in two tones with
// painterly clumps, dirt paths, rock on steep faces; toon light, shadows, fog.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
#include<tbShadow>
#include<tbLighting>
#include<tbSurface>
varying vNormalW: vec3f;
varying vPosW: vec3f;
varying vMask: vec4f;
varying vViewZ: f32;
uniform view: mat4x4f;
uniform palA: vec4f;   // grass light rgb, w sand height
uniform palB: vec4f;   // grass dark rgb, w beach width
uniform palC: vec4f;   // sand rgb, w rock slope threshold
uniform palD: vec4f;   // rock rgb, w path strength
uniform palE: vec4f;   // dirt rgb, w object id

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let n = normalize(input.vNormalW);
  let p = input.vPosW;
  let m = input.vMask;
  let sea = globals.sea.x;
  let hgt = p.y - sea;
  let slope = 1.0 - n.y;
  let n1 = fbm2(p.xz * 0.35, 4);
  let n2 = gnoise2(p.xz * 2.2);
  // grass: two tones broken into painterly clumps
  let clump = smoothstep(-0.15, 0.25, n1 + n2 * 0.25);
  var grass = mixOklab(uniforms.palB.rgb, uniforms.palA.rgb, clump * (0.6 + 0.4 * m.g));
  grass = grass * (0.92 + 0.12 * voronoi2(p.xz * 3.0).x);
  // sand: wet near the water
  var sand = uniforms.palC.rgb * (0.95 + 0.07 * n2);
  let wet = smoothstep(0.55, 0.0, hgt);
  sand = mix(sand, sand * vec3f(0.72, 0.7, 0.72), wet);
  let sandAmt = 1.0 - smoothstep(uniforms.palA.w, uniforms.palA.w + uniforms.palB.w, hgt + n1 * 0.6);
  var col = mix(grass, sand, sandAmt);
  // dirt paths
  let path = saturate(m.r * uniforms.palD.w + (n2 * 0.15)) ;
  col = mix(col, uniforms.palE.rgb * (0.9 + 0.12 * n1), smoothstep(0.35, 0.6, path));
  // rock on steep slopes (or painted)
  let rockAmt = max(smoothstep(uniforms.palC.w, uniforms.palC.w + 0.12, slope + n1 * 0.12), m.b);
  let rock = surfaceDetail(ECLS_ROCK, p, n, uniforms.palD.rgb);
  col = mix(col, rock, rockAmt);
  var t: ToonInput;
  t.albedo = col;
  t.n = n;
  t.v = normalize(globals.camPos.xyz - p);
  t.pos = p;
  t.ao = 1.0 - rockAmt * 0.2 * (1.0 - n.y);
  t.cls = CLS_CLOTH;
  t.shadow = sunShadow(p, n, input.position.xy);
  t.rimMask = 0.0;
  t.emissive = vec3f(0.0);
  var c = toonShade(t);
  c = applyFog(c, p);
  fragmentOutputs.fragData0 = vec4f(c, 1.0);
  let nv = normalize((uniforms.view * vec4f(n, 0.0)).xyz);
  fragmentOutputs.fragData1 = vec4f(encodeNormal(nv), input.vViewZ, uniforms.palE.w);
}
