// tbParticle — procedural particle shapes (no textures): glow, star spark, shock ring, smoke puff, streak,
// wind arc, droplet, shard, ink burst, telegraph ring. Output is additive HDR (blooms).
#include<tbGlobals>
#include<tbCommon>
#include<tbNoise>
varying vUV: vec2f;
varying vInfo: vec4f;
varying vCol: vec4f;
varying vWorld: vec3f;

// Flame: a teardrop whose outline is pushed around by rising turbulence, coloured by a ramp from a
// white-hot core through yellow and orange to a red rim, posterised into anime bands.
fn flame(p: vec2f, seed: f32, life: f32, t: f32) -> vec4f {
  var q = vec2f(p.x * 2.0, p.y * 2.0 + 0.35);          // y up, base near the bottom
  let rise = t * 2.6 + seed * 9.0;
  let turb = vec2f(gnoise2(vec2f(q.y * 3.0 - rise, seed * 7.0)), gnoise2(vec2f(q.x * 2.0, q.y * 2.5 - rise * 1.3)));
  q = q + turb * vec2f(0.28, 0.12) * smoothstep(-0.6, 0.8, q.y);
  // teardrop: wide round base, pointed top
  let w = mix(0.62, 0.05, smoothstep(-0.55, 0.9, q.y)) * (1.0 - 0.35 * life);
  let base = smoothstep(-0.75, -0.45, q.y);
  let d = abs(q.x) / max(w, 1e-3);
  let body = (1.0 - smoothstep(0.75, 1.0, d)) * base * (1.0 - smoothstep(0.75, 1.0, q.y));
  if (body <= 0.001) { return vec4f(0.0); }
  // heat: hottest low and in the middle
  var heat = saturate((1.0 - d) * 1.2 - (q.y + 0.4) * 0.45 + 0.15);
  heat = floor(heat * 4.0 + 0.5) / 4.0;
  let ramp = mix(mix(vec3f(0.9, 0.12, 0.04), vec3f(1.0, 0.45, 0.06), smoothstep(0.0, 0.35, heat)),
                 mix(vec3f(1.0, 0.82, 0.25), vec3f(1.0, 0.98, 0.85), smoothstep(0.75, 1.0, heat)), smoothstep(0.3, 0.75, heat));
  return vec4f(ramp * (1.5 + heat * 2.5), body);
}

// Lightning: a bright core along the segment with a wide violet-white glow.
fn boltSeg(p: vec2f) -> vec2f {
  let x = abs(p.x) * 2.0;
  let core = smoothstep(0.12, 0.0, x);
  let glow = pow(saturate(1.0 - x), 3.0) * 0.6;
  let ends = smoothstep(0.5, 0.42, abs(p.y));
  return vec2f(core, glow) * ends;
}

fn star(p: vec2f, points: f32, sharp: f32) -> f32 {
  let a = atan2(p.y, p.x);
  let r = length(p);
  let s = pow(abs(cos(a * points * 0.5)), sharp) * 0.85 + 0.15;
  return saturate(1.0 - r / (0.5 * s));
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  let p = input.vUV - 0.5;
  let r = length(p) * 2.0;
  let life = input.vInfo.y;
  let shape = i32(input.vInfo.z + 0.5);
  var a = 0.0;
  var col = input.vCol.rgb;
  if (shape == 0) {            // soft glow
    a = pow(saturate(1.0 - r), 2.2);
  } else if (shape == 1) {     // 4-point star spark with a hot core
    a = star(p, 4.0, 18.0) + pow(saturate(1.0 - r), 6.0);
    col = mix(col, vec3f(1.0), pow(saturate(1.0 - r * 1.5), 3.0));
  } else if (shape == 2) {     // shock ring (thins as it grows)
    let w = mix(0.22, 0.04, life);
    a = smoothstep(w, 0.0, abs(r - 0.82)) * smoothstep(1.0, 0.9, r);
  } else if (shape == 3) {     // smoke puff: lumpy noisy disc, lit from the sun side like a little cloud
    let n = fbm2(p * 4.0 + vec2f(input.vInfo.x * 3.0, life * 0.7), 3) * 0.5;
    a = smoothstep(0.95, 0.4, r + n * 0.6) * 0.75;
    // fake sphere normal from the disc, banded half-lambert toward the sun's screen direction
    let nz = sqrt(saturate(1.0 - r * r));
    let sd = normalize(vec2f(globals.sunDir.x, globals.sunDir.y) + vec2f(1e-4));
    let lit = saturate(dot(vec3f(p * 2.0, nz), normalize(vec3f(sd * 0.7, 0.7))) * 0.5 + 0.5);
    let band = smoothstep(0.45, 0.55, lit + n * 0.3);
    col = col * mix(vec3f(0.62, 0.62, 0.78), vec3f(1.15, 1.08, 1.0), band) * (0.8 + 0.2 * smoothstep(0.0, 0.8, r));
  } else if (shape == 4) {     // streak (velocity aligned elongated glow)
    let q = vec2f(p.x * 2.0, p.y);
    a = pow(saturate(1.0 - length(q) * 2.0), 1.6);
  } else if (shape == 5) {     // wind arc: a crescent band
    let ang = atan2(p.y, p.x);
    let band = smoothstep(0.08, 0.0, abs(r - 0.72)) * smoothstep(-0.2, 1.2, sin(ang + 1.2));
    let streaks = 0.6 + 0.4 * sin(ang * 9.0 + life * 20.0);
    a = band * streaks;
  } else if (shape == 6) {     // droplet with highlight
    a = smoothstep(1.0, 0.75, r);
    col = mix(col * 0.75, vec3f(1.0), smoothstep(0.35, 0.0, length(p - vec2f(-0.12, 0.12))));
  } else if (shape == 7) {     // shard (triangle)
    let q = p * 2.0;
    let d = max(abs(q.x) * 1.7 + q.y, -q.y - 0.5);
    a = smoothstep(0.5, 0.42, d);
  } else if (shape == 8) {     // ink splash: jagged blob (anime impact)
    let ang = atan2(p.y, p.x);
    let edge = 0.62 + 0.25 * sin(ang * 7.0 + input.vInfo.x * 5.0) * sin(ang * 3.0 + 1.3);
    a = smoothstep(edge, edge - 0.08, r);
  } else if (shape == 9) {     // telegraph ring with a pulsing fill
    let ring = smoothstep(0.07, 0.0, abs(r - 0.9));
    let fill = smoothstep(1.0, 0.85, r) * (0.18 + 0.18 * sin(globals.time.x * 18.0));
    a = ring + fill * smoothstep(0.0, 1.0, life);
  } else if (shape == 11) {    // flame
    let f = flame(p, input.vInfo.x, life, globals.time.x);
    a = f.a;
    col = f.rgb * input.vCol.rgb;
  } else if (shape == 12) {    // ember: hot point with a short fading tail
    a = pow(saturate(1.0 - r * 1.4), 3.0) + pow(saturate(1.0 - length(vec2f(p.x * 6.0, p.y * 1.2))), 4.0) * 0.6;
    col = mix(vec3f(1.0, 0.45, 0.1), vec3f(1.0, 0.95, 0.7), pow(saturate(1.0 - r * 2.0), 2.0)) * 3.0;
  } else if (shape == 13) {    // lightning bolt segment (velocity aligned)
    let b = boltSeg(p);
    a = b.x + b.y;
    col = mix(input.vCol.rgb * 0.7, vec3f(1.6, 1.6, 2.0), b.x / max(a, 1e-3)) * 3.0;
  } else if (shape == 14) {    // rain streak: a thin bright line
    a = smoothstep(0.08, 0.0, abs(p.x)) * smoothstep(0.5, 0.2, abs(p.y));
  } else if (shape == 15) {    // foam ring that breaks up as it spreads
    let ang = atan2(p.y, p.x);
    let brk = step(0.35, vnoise2(vec2f(ang * 3.0, input.vInfo.x * 10.0)) + (1.0 - life) * 0.4);
    a = smoothstep(0.1, 0.0, abs(r - 0.8)) * brk;
  } else if (shape == 16) {    // leaf: almond with a midrib, tumbling
    let q = vec2f(p.x * 2.2, p.y * 1.2);
    let leaf = smoothstep(0.52, 0.45, length(q) + abs(q.y) * 0.4);
    a = leaf * (1.0 - 0.4 * smoothstep(0.03, 0.0, abs(p.x)));
  } else {                     // glyph sparkle
    a = star(p, 6.0, 10.0);
  }
  // fade in quickly, out over life
  let fade = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.65, 1.0, life));
  a = a * input.vCol.a * fade;
  if (a < 0.003) { discard; }
  fragmentOutputs.fragData0 = vec4f(col * a, a);
  fragmentOutputs.fragData1 = vec4f(0.0);
}
