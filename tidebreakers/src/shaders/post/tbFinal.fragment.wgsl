// tbFinal — tone mapping, grading and screen effects. Writes display (sRGB-encoded) colour.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var bloomTexSampler: sampler;
var bloomTex: texture_2d<f32>;
var gbufTexSampler: sampler;
var gbufTex: texture_2d<f32>;
uniform fxA: vec4f;   // x vignette, y chromatic aberration, z grain, w letterbox (0..1)
uniform fxB: vec4f;   // x fade to black, y impact frame (0/1 + mode), z speed lines, w radial blur
uniform fxC: vec4f;   // xy radial centre (uv), z bloom strength, w desaturate (memories)
uniform liftC: vec4f;  // rgb lift, w split-tone balance
uniform gammaC: vec4f; // rgb gamma
uniform gainC: vec4f;  // rgb gain, w = sepia (flashbacks)
uniform inkC: vec4f;   // x scenery ink strength, y line width (px)

// Tone curve: linear through the mids (keeps flat anime colours true), soft shoulder for highlights,
// with highlights desaturating toward white like film.
fn tonemap(c: vec3f) -> vec3f {
  let l = max3(c);
  let k = 0.72;
  var m = l;
  if (l > k) { m = k + (1.0 - k) * (1.0 - exp(-(l - k) / (1.0 - k))); }
  var o = c * (m / max(l, 1e-5));
  let over = saturate((l - 1.0) * 0.25);
  o = mix(o, vec3f(m), over);
  return o;
}

fn grade(cIn: vec3f) -> vec3f {
  var c = cIn * globals.grade.x;
  // contrast around mid grey in log space
  let lc = log2(max(c, vec3f(1e-5)) / 0.18);
  c = exp2(lc * globals.grade.z) * 0.18;
  // warmth
  c = c * vec3f(1.0 + globals.grade.w * 0.08, 1.0, 1.0 - globals.grade.w * 0.08);
  c = saturateColor(c, globals.grade.y);
  return c;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  var uv = input.vUV;
  let px = globals.viewport.zw;
  // radial blur (dash / big impacts)
  var col = vec3f(0.0);
  let rb = uniforms.fxB.w;
  let ca = uniforms.fxA.y;
  if (rb > 0.001 || ca > 0.001) {
    let dir = uv - uniforms.fxC.xy;
    var acc = vec3f(0.0);
    for (var i = 0; i < 8; i++) {
      let t = f32(i) / 7.0;
      let o = dir * (t * rb * 0.08);
      let r = textureSampleLevel(colorTex, colorTexSampler, uv - o + dir * ca * 0.012, 0.0).r;
      let g = textureSampleLevel(colorTex, colorTexSampler, uv - o, 0.0).g;
      let b = textureSampleLevel(colorTex, colorTexSampler, uv - o - dir * ca * 0.012, 0.0).b;
      acc = acc + vec3f(r, g, b);
    }
    col = acc / 8.0;
  } else {
    col = textureSampleLevel(colorTex, colorTexSampler, uv, 0.0).rgb;
  }
  // screen-space ink lines for scenery (characters have their own hull outlines): depth and normal
  // discontinuities in the G-buffer, thinner and lighter with distance
  let g0 = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
  if (g0.z > 0.0 && uniforms.inkC.x > 0.0) {
    let o = px * uniforms.inkC.y;
    let ga = textureSampleLevel(gbufTex, gbufTexSampler, uv + vec2f(o.x, 0.0), 0.0);
    let gb2 = textureSampleLevel(gbufTex, gbufTexSampler, uv - vec2f(o.x, 0.0), 0.0);
    let gc = textureSampleLevel(gbufTex, gbufTexSampler, uv + vec2f(0.0, o.y), 0.0);
    let gd = textureSampleLevel(gbufTex, gbufTexSampler, uv - vec2f(0.0, o.y), 0.0);
    let dz = g0.z;
    let farA = select(1e4, ga.z, ga.z > 0.0);
    let farB = select(1e4, gb2.z, gb2.z > 0.0);
    let farC = select(1e4, gc.z, gc.z > 0.0);
    let farD = select(1e4, gd.z, gd.z > 0.0);
    let dEdge = max(max(abs(farA - dz), abs(farB - dz)), max(abs(farC - dz), abs(farD - dz))) / max(dz, 0.5);
    let n0 = decodeNormal(g0.xy);
    let nEdge = 1.0 - min(min(dot(n0, decodeNormal(ga.xy)), dot(n0, decodeNormal(gb2.xy))), min(dot(n0, decodeNormal(gc.xy)), dot(n0, decodeNormal(gd.xy))));
    let idEdge = select(0.0, 1.0, abs(ga.w - g0.w) + abs(gc.w - g0.w) > 0.001);
    var e = max(smoothstep(0.06, 0.16, dEdge), smoothstep(0.35, 0.6, nEdge) * 0.8);
    e = max(e, idEdge * 0.6);
    let isChar = g0.w > 0.0005 && g0.w < 0.5;
    e = e * select(1.0, 0.35, isChar) * (1.0 - smoothstep(25.0, 120.0, dz)) * uniforms.inkC.x;
    let ink = saturateColor(col * 0.22, 1.3) + vec3f(0.01, 0.006, 0.012);
    col = mix(col, ink, saturate(e));
  }
  col = col + textureSampleLevel(bloomTex, bloomTexSampler, uv, 0.0).rgb * uniforms.fxC.z;
  // debug views (globals.counts.y): 1 normals, 2 depth, 3 object ids, 4 raw HDR colour
  let dbg = i32(globals.counts.y);
  if (dbg > 0) {
    let gb = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
    var o = col;
    if (dbg == 1) { o = vec3f(gb.xy, 0.5); }
    if (dbg == 2) { o = vec3f(fract(gb.z * 0.25), saturate(gb.z / 40.0), 0.0); }
    if (dbg == 3) { o = hsv2rgb(vec3f(fract(gb.w * 7.31), 0.7, step(0.001, gb.w))); }
    fragmentOutputs.color = vec4f(linearToSrgb(o), 1.0);
    return fragmentOutputs;
  }
  col = col + globals.flash.rgb * globals.flash.w;
  col = grade(col);
  col = tonemap(col);
  // lift / gamma / gain (per chapter look)
  col = pow(max(col * uniforms.gainC.rgb + uniforms.liftC.rgb * (1.0 - col), vec3f(0.0)), 1.0 / max(uniforms.gammaC.rgb, vec3f(0.05)));
  // memories / flashbacks: desaturate and warm
  let mem = uniforms.fxC.w;
  if (mem > 0.0) {
    let l = luma(col);
    col = mix(col, vec3f(l) * vec3f(1.08, 0.98, 0.82), mem);
  }
  let sep = uniforms.gainC.w;
  if (sep > 0.0) { col = mix(col, vec3f(luma(col)) * vec3f(1.12, 0.96, 0.75), sep); }
  // speed lines (anime): radial streaks around the edges of the frame
  let sl = uniforms.fxB.z;
  if (sl > 0.001) {
    let d = uv - vec2f(0.5);
    let ang = atan2(d.y, d.x);
    let r = length(d * vec2f(globals.viewport.x / globals.viewport.y, 1.0));
    let n = hash11(floor(ang * 70.0 + floor(globals.time.x * 18.0) * 13.0));
    let streak = step(0.72, n) * smoothstep(0.28, 0.62, r + n * 0.12);
    col = mix(col, vec3f(1.0), streak * sl * 0.75);
  }
  // impact frame (anime): characters become black silhouettes on white (mode 1) or red (mode 2),
  // with radial streaks bursting from the hit
  let imp = uniforms.fxB.y;
  if (imp > 0.5) {
    let gb = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
    let isChar = gb.w > 0.0005 && gb.w < 0.5 && gb.z > 0.0;
    let d = uv - uniforms.fxC.xy;
    let ang = atan2(d.y, d.x);
    let rr = length(d * vec2f(globals.viewport.x / globals.viewport.y, 1.0));
    let ray = step(0.55, hash11(floor(ang * 48.0))) * smoothstep(0.08, 0.5, rr);
    let paper = select(vec3f(1.0, 0.97, 0.9), vec3f(0.95, 0.12, 0.08), imp > 1.5);
    var ic = mix(paper, paper * 0.55, ray);
    if (isChar) { ic = vec3f(0.02, 0.01, 0.03); }
    col = ic;
  }
  // vignette
  let vd = (uv - 0.5) * vec2f(1.0, globals.viewport.y / globals.viewport.x) * 1.6;
  col = col * mix(1.0, 1.0 - uniforms.fxA.x, smoothstep(0.35, 1.15, dot(vd, vd) * 1.6));
  // film grain + dither
  let g = (hash12(input.position.xy + fract(globals.time.x * 13.0) * 100.0) - 0.5) * uniforms.fxA.z;
  col = col + g * 0.08;
  col = max(col, vec3f(0.0));
  var outc = linearToSrgb(col);
  outc = outc + (ign(input.position.xy) - 0.5) / 255.0;
  // letterbox
  let lb = uniforms.fxA.w * 0.12;
  if (uv.y < lb || uv.y > 1.0 - lb) { outc = vec3f(0.0); }
  outc = outc * (1.0 - uniforms.fxB.x);
  fragmentOutputs.color = vec4f(outc, 1.0);
}
