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
var aoTexSampler: sampler;
var aoTex: texture_2d<f32>;
var dofTexSampler: sampler;
var dofTex: texture_2d<f32>;
var shaftTexSampler: sampler;
var shaftTex: texture_2d<f32>;
var ssrTexSampler: sampler;
var ssrTex: texture_2d<f32>;
uniform fxA: vec4f;   // x vignette, y chromatic aberration, z grain, w letterbox (0..1)
uniform fxB: vec4f;   // x fade to black, y impact frame (0/1 + mode), z speed lines, w radial blur
uniform fxC: vec4f;   // xy radial centre (uv), z bloom strength, w desaturate (memories)
uniform liftC: vec4f;  // rgb lift, w split-tone balance
uniform gammaC: vec4f; // rgb gamma
uniform gainC: vec4f;  // rgb gain, w = sepia (flashbacks)
uniform inkC: vec4f;   // x scenery ink strength, y line width (px)
uniform postC: vec4f;  // x ambient occlusion strength, y depth of field on, z sun shafts on, w rain on the lens
uniform aoTint: vec4f; // rgb colour of occlusion (cool, from the chapter's shadow tint)
uniform shockA: vec4f; // shockwaves: xy centre (uv), z radius (screen heights), w strength
uniform shockB: vec4f;
uniform shockC: vec4f;
uniform shockD: vec4f;
uniform postD: vec4f;  // x sea reflections on, y water object id, z lens flare strength, w reflection tint toward the sea colour
uniform flareC: vec4f; // xy sun position (uv), z how far on screen (0..1), w sun angular size factor

fn hexDist(p: vec2f) -> f32 {
  let q = abs(p);
  return max(q.x * 0.8660254 + q.y * 0.5, q.y);
}

// How much of the sun is unblocked: a small disc of taps around it in the G-buffer (sky has no depth).
fn sunVisibility(sun: vec2f) -> f32 {
  let aspect = globals.viewport.x / globals.viewport.y;
  var vis = 0.0;
  for (var i = 0; i < 12; i++) {
    let a = f32(i) * 2.3999632;
    let r = sqrt((f32(i) + 0.5) / 12.0) * 0.018;
    let o = vec2f(cos(a), sin(a)) * r / vec2f(aspect, 1.0);
    let z = textureSampleLevel(gbufTex, gbufTexSampler, clamp(sun + o, vec2f(0.0), vec2f(1.0)), 0.0).z;
    vis = vis + select(0.0, 1.0, z <= 0.0);
  }
  return vis / 12.0;
}

// Anime lens flare: a string of soft hexagonal ghosts with bright rims from the sun through the centre of
// the frame, a faint rainbow halo, a horizontal anamorphic streak and a starburst on the sun itself.
fn lensFlare(uv: vec2f, sun: vec2f, amount: f32) -> vec3f {
  let aspect = globals.viewport.x / globals.viewport.y;
  let a = vec2f(aspect, 1.0);
  let axis = vec2f(0.5) - sun;
  var c = vec3f(0.0);
  var ks = array<f32, 7>(0.42, 0.7, 0.86, 1.18, 1.42, 1.66, 2.1);
  var sizes = array<f32, 7>(0.035, 0.06, 0.022, 0.09, 0.045, 0.13, 0.07);
  var gains = array<f32, 7>(0.6, 0.35, 0.8, 0.25, 0.45, 0.16, 0.3);
  for (var i = 0; i < 7; i++) {
    let fi = f32(i);
    let pos = sun + axis * ks[i];
    let d = hexDist(rot2(0.3) * ((uv - pos) * a)) / sizes[i];
    if (d > 1.2) { continue; }
    let body = smoothstep(1.0, 0.9, d);
    let rim = exp(-sq((d - 0.94) / 0.05));
    let hue = fract(0.52 + fi * 0.137);
    c = c + hsv2rgb(vec3f(hue, 0.55 + 0.15 * fract(fi * 0.71), 1.0)) * (body * 0.35 + rim * 1.0) * gains[i];
  }
  let ds = length((uv - sun) * a);
  // halo around the sun with a prismatic edge
  let ring = exp(-sq((ds - 0.36) / 0.022));
  c = c + hsv2rgb(vec3f(fract(0.95 - (ds - 0.36) * 9.0), 0.7, 1.0)) * ring * 0.14;
  // anamorphic streak
  let dy = abs(uv.y - sun.y);
  let dx = abs(uv.x - sun.x) * aspect;
  c = c + vec3f(0.55, 0.75, 1.0) * exp(-dy * 320.0) * exp(-dx * 2.4) * 0.45;
  // starburst rays on the sun
  let ang = atan2(uv.y - sun.y, (uv.x - sun.x) * aspect);
  let rays = pow(abs(cos(ang * 3.0)), 90.0) + 0.6 * pow(abs(cos(ang * 3.0 + 0.5236)), 160.0) + 0.35 * hash11(floor(ang * 40.0)) * pow(abs(cos(ang * 20.0)), 8.0);
  c = c + globals.sunColor.rgb * rays * exp(-ds * 6.5) * 0.7;
  c = c + globals.sunColor.rgb * exp(-ds * 28.0) * 0.6;
  return c * amount;
}

// A shockwave ring bends the image outward where it passes, like heat over a blast.
fn shockOffset(uv: vec2f, s: vec4f) -> vec2f {
  if (s.w <= 0.0001) { return vec2f(0.0); }
  let aspect = globals.viewport.x / globals.viewport.y;
  let d = (uv - s.xy) * vec2f(aspect, 1.0);
  let r = length(d);
  let w = 0.035 + s.z * 0.12;
  let ring = exp(-sq((r - s.z) / w));
  return normalize(d + vec2f(1e-5)) / vec2f(aspect, 1.0) * ring * s.w * 0.03;
}

// Rain on the lens: slanted streaks falling at different speeds in layers, and a few beads that refract the
// image behind them.
fn rainStreaks(uv: vec2f, t: f32, amount: f32) -> f32 {
  var s = 0.0;
  for (var layer = 0; layer < 3; layer++) {
    let fl = f32(layer);
    let scale = 90.0 + fl * 70.0;
    let slant = 0.18 + fl * 0.05;
    let p = vec2f((uv.x + uv.y * slant) * scale, uv.y);
    let col = floor(p.x);
    let rnd = hash11(col * 1.37 + fl * 17.0);
    let speed = 1.6 + rnd * 1.8 + fl * 0.6;
    let y = fract(p.y * (2.0 + rnd) - t * speed + rnd * 13.0);
    let len = 0.06 + rnd * 0.08;
    let streak = smoothstep(0.0, len, y) * (1.0 - smoothstep(len, len * 1.4, y)) * step(0.55 - amount * 0.25, hash11(col * 3.1 + fl));
    let thin = 1.0 - abs(fract(p.x) - 0.5) * 2.0;
    s = s + streak * smoothstep(0.55, 1.0, thin) * (0.6 - fl * 0.15);
  }
  return s * amount;
}

fn lensBeads(uv: vec2f, t: f32, amount: f32) -> vec2f {
  let aspect = globals.viewport.x / globals.viewport.y;
  let g = uv * vec2f(aspect, 1.0) * 9.0;
  let cell = floor(g);
  let f = fract(g) - 0.5;
  let rnd = hash22(cell);
  let life = fract(t * 0.15 + rnd.x);
  let c = (rnd - 0.5) * 0.6;
  let d = f - c;
  let r = 0.12 * rnd.y * step(0.6, rnd.x) * (1.0 - smoothstep(0.7, 1.0, life));
  if (r < 0.01) { return vec2f(0.0); }
  let inside = 1.0 - smoothstep(r * 0.7, r, length(d));
  return -d * inside * 0.06 * amount;
}

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
  if (uniforms.postC.w > 0.001) { uv = clamp(uv + lensBeads(uv, globals.time.x, uniforms.postC.w), vec2f(0.0), vec2f(1.0)); }
  uv = clamp(uv - shockOffset(uv, uniforms.shockA) - shockOffset(uv, uniforms.shockB) - shockOffset(uv, uniforms.shockC) - shockOffset(uv, uniforms.shockD), vec2f(0.0), vec2f(1.0));
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
  // depth of field: blend toward the half-res bokeh by circle of confusion
  if (uniforms.postC.y > 0.5) {
    let d = textureSampleLevel(dofTex, dofTexSampler, uv, 0.0);
    col = mix(col, d.rgb, smoothstep(0.06, 0.4, d.a));
  }
  // sea reflections (half-res SSR): the ships, cliffs and people on the water, tinted by the sea
  if (uniforms.postD.x > 0.5) {
    let gw = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0).w;
    if (abs(gw - uniforms.postD.y) < 0.01) {
      // smeared vertically, the way reflections on moving water stretch toward the viewer
      var s = vec4f(0.0);
      var wsum = 0.0;
      for (var i = -3; i <= 3; i++) {
        let fi = f32(i);
        let wt = exp(-fi * fi * 0.18);
        let t = textureSampleLevel(ssrTex, ssrTexSampler, uv + vec2f(0.0, fi * px.y * 2.5), 0.0);
        s = s + vec4f(t.rgb * t.a, t.a) * wt;
        wsum = wsum + wt;
      }
      s = vec4f(s.rgb / max(s.a, 1e-4), s.a / wsum);
      let tint = mix(vec3f(1.0), globals.seaShallow.rgb * 1.6, uniforms.postD.w);
      col = mix(col, s.rgb * tint, saturate(s.a));
    }
  }
  // ambient occlusion as a cool wash rather than black (painted shadows), contact creases a bit deeper
  if (uniforms.postC.x > 0.0) {
    let a = textureSampleLevel(aoTex, aoTexSampler, uv, 0.0);
    let occ = saturate(a.x * mix(1.0, a.y, 0.8));
    let shade = mix(uniforms.aoTint.rgb, vec3f(1.0), occ);
    col = col * mix(vec3f(1.0), shade, uniforms.postC.x);
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
  if (uniforms.postC.z > 0.5) { col = col + textureSampleLevel(shaftTex, shaftTexSampler, uv, 0.0).rgb; }
  if (uniforms.postD.z > 0.001 && uniforms.flareC.z > 0.001) {
    let vis = sunVisibility(uniforms.flareC.xy);
    if (vis > 0.001) { col = col + lensFlare(input.vUV, uniforms.flareC.xy, uniforms.postD.z * vis * uniforms.flareC.z * globals.sunDir.w); }
  }
  if (uniforms.postC.w > 0.001) { col = col + vec3f(0.55, 0.62, 0.75) * rainStreaks(input.vUV, globals.time.x, uniforms.postC.w) * 0.35; }
  // debug views (globals.counts.y): 1 normals, 2 depth, 3 object ids, 4 raw HDR colour
  let dbg = i32(globals.counts.y);
  if (dbg > 0) {
    let gb = textureSampleLevel(gbufTex, gbufTexSampler, uv, 0.0);
    var o = col;
    if (dbg == 1) { o = vec3f(gb.xy, 0.5); }
    if (dbg == 2) { o = vec3f(fract(gb.z * 0.25), saturate(gb.z / 40.0), 0.0); }
    if (dbg == 3) { o = hsv2rgb(vec3f(fract(gb.w * 7.31), 0.7, step(0.001, gb.w))); }
    if (dbg == 5) { let a = textureSampleLevel(aoTex, aoTexSampler, uv, 0.0); o = vec3f(a.x * a.y); }
    if (dbg == 6) { o = textureSampleLevel(shaftTex, shaftTexSampler, uv, 0.0).rgb * 4.0; }
    if (dbg == 7) { o = vec3f(textureSampleLevel(dofTex, dofTexSampler, uv, 0.0).a); }
    if (dbg == 8) { let s = textureSampleLevel(ssrTex, ssrTexSampler, uv, 0.0); o = s.rgb * s.a; }
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
