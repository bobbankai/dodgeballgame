// tbFinal — tone mapping, grading and screen effects. Writes display (sRGB-encoded) colour.
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
var colorTexSampler: sampler;
var colorTex: texture_2d<f32>;
var bloomTexSampler: sampler;
var bloomTex: texture_2d<f32>;
uniform fxA: vec4f;   // x vignette, y chromatic aberration, z grain, w letterbox (0..1)
uniform fxB: vec4f;   // x fade to black, y impact frame (0/1 + mode), z speed lines, w radial blur
uniform fxC: vec4f;   // xy radial centre (uv), z bloom strength, w desaturate (memories)
uniform liftC: vec4f;  // rgb lift, w split-tone balance
uniform gammaC: vec4f; // rgb gamma
uniform gainC: vec4f;  // rgb gain, w = sepia (flashbacks)

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
  col = col + textureSampleLevel(bloomTex, bloomTexSampler, uv, 0.0).rgb * uniforms.fxC.z;
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
  // impact frame: inverted two-tone flash for a couple of frames
  let imp = uniforms.fxB.y;
  if (imp > 0.5) {
    let l = luma(col);
    let inv = select(vec3f(0.02, 0.02, 0.04), vec3f(1.0, 0.97, 0.92), l < 0.42);
    col = mix(col, inv, select(0.85, 1.0, imp > 1.5));
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
